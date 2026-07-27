import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(electronRoot, '../..');
const workspaceRoot = path.dirname(projectRoot);
const outputDirectory = path.join(projectRoot, '.tmp', 'artifact-runner-clipping-packaged');
const screenshotPath = path.join(outputDirectory, 'artifact-runner-scroll-clip-macos.png');
const dialogScreenshotPath = path.join(outputDirectory, 'artifact-runner-dialog-overlay-macos.png');
const dialogRestoredScreenshotPath = path.join(outputDirectory, 'artifact-runner-dialog-restored-macos.png');
const workspaceScreenshotPath = path.join(outputDirectory, 'artifact-runner-workspace-mode-macos.png');
const fullscreenScreenshotPath = path.join(outputDirectory, 'artifact-runner-fullscreen-mode-macos.png');
const restoredInlineScreenshotPath = path.join(outputDirectory, 'artifact-runner-restored-inline-macos.png');
const workbenchScreenshotPath = path.join(outputDirectory, 'artifact-runner-workbench-header-clip-macos.png');
const workbenchPackagePath = path.join(
  workspaceRoot,
  'extension',
  'dist',
  'com.openchamber.lab.ops-1.0.2.ocix',
);
const reportPath = path.join(outputDirectory, 'report.json');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const resolvePackagedApp = async () => {
  const configured = process.env.OPENCHAMBER_PACKAGED_APP?.trim();
  const candidates = [
    configured,
    path.join(electronRoot, 'dist', 'mac-arm64', 'OpenChamber.app'),
    path.join(electronRoot, 'dist', 'mac', 'OpenChamber.app'),
    path.join(electronRoot, 'dist', 'mac-universal', 'OpenChamber.app'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return path.resolve(candidate);
    } catch {
      // Try the next packaged output.
    }
  }
  throw new Error('Packaged OpenChamber.app not found; run bun run electron:build first');
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const waitForServer = async ({ settingsPath, processExited, processOutput }) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processExited()) throw new Error(`Packaged OpenChamber exited before server readiness:\n${processOutput()}`);
    const settings = await readJson(settingsPath);
    const port = Number(settings?.desktopLocalPort);
    if (Number.isInteger(port) && port > 0) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) return port;
      } catch {
        // The in-process server is still starting.
      }
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for packaged OpenChamber server');
};

const waitForDebuggerTarget = async ({ debugPort, processExited, processOutput }) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processExited()) throw new Error(`Packaged OpenChamber exited before DevTools readiness:\n${processOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      // Electron has not exposed the renderer target yet.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for packaged Electron DevTools target');
};

const connect = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++requestId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (reply.error) throw new Error(reply.error.message);
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  return { socket, send, evaluate };
};

const waitFor = async (browser, expression, label) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await browser.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const resolveMacWindowId = async (pid) => {
  const source = `
import CoreGraphics
import Foundation
let targetPID = ${Number(pid)}
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let entries = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var bestID = 0
var bestArea = 0.0
for entry in entries {
  let ownerPID = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1
  let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
  guard ownerPID == targetPID, layer == 0,
        let number = (entry[kCGWindowNumber as String] as? NSNumber)?.intValue,
        let bounds = entry[kCGWindowBounds as String] as? NSDictionary,
        let width = (bounds["Width"] as? NSNumber)?.doubleValue,
        let height = (bounds["Height"] as? NSNumber)?.doubleValue else { continue }
  let area = width * height
  if area > bestArea { bestArea = area; bestID = number }
}
print(bestID)
`;
  const deadline = Date.now() + 15_000;
  let lastOutput = '';
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync('/usr/bin/swift', ['-e', source], { timeout: 30_000 });
    lastOutput = stdout.trim();
    const windowId = Number(lastOutput);
    if (Number.isInteger(windowId) && windowId > 0) return windowId;
    // Electron can expose DevTools and finish navigation just before WindowServer
    // publishes the native window. Treat that hand-off as eventual, not a failure.
    await delay(250);
  }
  assert.fail(`Could not resolve window id for pid ${pid}; last WindowServer result: ${lastOutput || '<empty>'}`);
};

const captureMacWindow = async ({ pid, outputPath }) => {
  const windowId = await resolveMacWindowId(pid);
  await execFileAsync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowId), outputPath], { timeout: 30_000 });
  await fs.access(outputPath);
};

const postMacMouseEvent = async ({ pid, x, y, click = false }) => {
  const source = `
import CoreGraphics
import Foundation
let targetPID = ${Number(pid)}
let pointX: Double = ${Number(x)}
let pointY: Double = ${Number(y)}
let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let entry = entries
  .filter { (($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1) == targetPID
    && (($0[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1) == 0 }
  .max { left, right in
    let leftBounds = left[kCGWindowBounds as String] as? NSDictionary
    let rightBounds = right[kCGWindowBounds as String] as? NSDictionary
    let leftArea = ((leftBounds?["Width"] as? NSNumber)?.doubleValue ?? 0)
      * ((leftBounds?["Height"] as? NSNumber)?.doubleValue ?? 0)
    let rightArea = ((rightBounds?["Width"] as? NSNumber)?.doubleValue ?? 0)
      * ((rightBounds?["Height"] as? NSNumber)?.doubleValue ?? 0)
    return leftArea < rightArea
  }
guard let bounds = entry?[kCGWindowBounds as String] as? NSDictionary,
      let originX = (bounds["X"] as? NSNumber)?.doubleValue,
      let originY = (bounds["Y"] as? NSNumber)?.doubleValue else {
  exit(2)
}
let location = CGPoint(x: originX + pointX, y: originY + pointY)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left)?.post(tap: .cghidEventTap)
${click ? `
usleep(60_000)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: location, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(60_000)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: location, mouseButton: .left)?.post(tap: .cghidEventTap)
` : ''}
`;
  await execFileAsync('/usr/bin/swift', ['-e', source], { timeout: 30_000 });
};

const requestJson = async (port, pathname, { method = 'GET', body, timeoutMs = 30_000 } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${payload?.code || payload?.error || 'unknown'}`);
  }
  return payload;
};

const inspectClipGuard = async (metrics) => {
  const { data, info } = await sharp(screenshotPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scaleX = info.width / metrics.outerWidth;
  const scaleY = info.height / metrics.outerHeight;
  const contentLeft = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
  const contentTop = Math.max(0, metrics.outerHeight - metrics.innerHeight);
  const x0 = Math.max(0, Math.floor((contentLeft + metrics.guard.left + 12) * scaleX));
  const y0 = Math.max(0, Math.floor((contentTop + metrics.guard.top + 12) * scaleY));
  const x1 = Math.min(info.width, Math.ceil((contentLeft + metrics.guard.right - 12) * scaleX));
  const y1 = Math.min(info.height, Math.ceil((contentTop + metrics.guard.bottom - 12) * scaleY));
  let magentaPixels = 0;
  let greenPixels = 0;
  let sampledPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 210 && green < 70 && blue > 160) magentaPixels += 1;
      if (red < 110 && green > 190 && blue < 100) greenPixels += 1;
      sampledPixels += 1;
    }
  }
  return {
    magentaPixels,
    greenPixels,
    sampledPixels,
    greenRatio: sampledPixels > 0 ? greenPixels / sampledPixels : 0,
    sampleBounds: { x0, y0, x1, y1 },
    imageSize: { width: info.width, height: info.height },
  };
};

const inspectDialogRegion = async ({ imagePath, metrics }) => {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scaleX = info.width / metrics.outerWidth;
  const scaleY = info.height / metrics.outerHeight;
  const contentLeft = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
  const contentTop = Math.max(0, metrics.outerHeight - metrics.innerHeight);
  const x0 = Math.max(0, Math.floor((contentLeft + metrics.runner.left + 32) * scaleX));
  const y0 = Math.max(0, Math.floor((contentTop + metrics.runner.top + 32) * scaleY));
  const x1 = Math.min(info.width, Math.ceil((contentLeft + metrics.runner.right - 32) * scaleX));
  const y1 = Math.min(info.height, Math.ceil((contentTop + metrics.runner.bottom - 32) * scaleY));
  let cyanPixels = 0;
  let magentaPixels = 0;
  let sampledPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red < 60 && green > 180 && blue > 190) cyanPixels += 1;
      if (red > 210 && green < 70 && blue > 160) magentaPixels += 1;
      sampledPixels += 1;
    }
  }
  return {
    cyanPixels,
    magentaPixels,
    sampledPixels,
    cyanRatio: sampledPixels > 0 ? cyanPixels / sampledPixels : 0,
    magentaRatio: sampledPixels > 0 ? magentaPixels / sampledPixels : 0,
    sampleBounds: { x0, y0, x1, y1 },
    imageSize: { width: info.width, height: info.height },
  };
};

if (process.platform !== 'darwin') throw new Error('This native clipping acceptance requires macOS');

const appPath = await resolvePackagedApp();
const executablePath = path.join(appPath, 'Contents', 'MacOS', 'OpenChamber');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-clipping-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const userDataDirectory = path.join(temporaryRoot, 'electron-user-data');
const homeDirectory = path.join(temporaryRoot, 'home');
const xdgConfigDirectory = path.join(temporaryRoot, 'xdg-config');
const xdgDataDirectory = path.join(temporaryRoot, 'xdg-data');
const xdgCacheDirectory = path.join(temporaryRoot, 'xdg-cache');
const openCodeConfigDirectory = path.join(temporaryRoot, 'opencode-config');
const settingsPath = path.join(dataDirectory, 'settings.json');
await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(userDataDirectory, { recursive: true });
await fs.mkdir(homeDirectory, { recursive: true });
await fs.mkdir(xdgConfigDirectory, { recursive: true });
await fs.mkdir(xdgDataDirectory, { recursive: true });
await fs.mkdir(xdgCacheDirectory, { recursive: true });
await fs.mkdir(openCodeConfigDirectory, { recursive: true });
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const debugPort = await reservePort();
let processOutput = '';
let processExited = false;
let appProcess;
let browser;
let artifactBrowser;
let failure;

try {
  appProcess = spawn(executablePath, [
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
  ], {
    env: {
      ...process.env,
      OPENCHAMBER_DATA_DIR: dataDirectory,
      OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
      OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
      OPENCODE_HOST: '127.0.0.1',
      OPENCODE_PORT: '9',
      OPENCODE_SKIP_START: 'true',
      HOME: homeDirectory,
      XDG_CONFIG_HOME: xdgConfigDirectory,
      XDG_DATA_HOME: xdgDataDirectory,
      XDG_CACHE_HOME: xdgCacheDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendOutput = (chunk) => { processOutput = `${processOutput}${String(chunk)}`.slice(-12_000); };
  appProcess.stdout?.on('data', appendOutput);
  appProcess.stderr?.on('data', appendOutput);
  appProcess.once('exit', () => { processExited = true; });

  const [serverPort, target] = await Promise.all([
    waitForServer({ settingsPath, processExited: () => processExited, processOutput: () => processOutput }),
    waitForDebuggerTarget({ debugPort, processExited: () => processExited, processOutput: () => processOutput }),
  ]);
  browser = await connect(target);
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');
  const query = new URLSearchParams({
    runtime: 'artifact-interactive',
    session: 'ses_packaged_artifact_clip_only',
    clipTest: 'true',
    theme: 'dark',
    locale: 'zh-CN',
  });
  const navigation = await browser.send('Page.navigate', {
    url: `openchamber-ui://app/interactive-ui-demo.html?${query}`,
  });
  assert.equal(Boolean(navigation.result?.errorText), false, navigation.result?.errorText || 'navigation failed');
  await waitFor(browser, `document.readyState === 'complete'`, 'clip fixture document');
  const initialFocusReply = await browser.send('Runtime.evaluate', {
    expression: `window.__OPENCHAMBER_DESKTOP__.invoke('desktop_focus_main_window')`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(Boolean(initialFocusReply.result?.exceptionDetails), false);
  await delay(250);
  const updaterPolicy = await browser.evaluate(`(() => ({
    exposed: typeof window.__OPENCHAMBER_DESKTOP__ === 'object',
    enabled: window.__OPENCHAMBER_DESKTOP__?.updatesEnabled,
  }))()`);
  assert.deepEqual(updaterPolicy, { exposed: true, enabled: true });
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"] [data-ocix-artifact-backend="desktop-runner"]') !== null`, 'Scripts Artifact Runner');

  assert.equal(await browser.evaluate(`(() => {
    const scroller = document.querySelector('[data-ocix-clip-test-scroller]');
    const runner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    if (!(scroller instanceof HTMLElement) || !(runner instanceof HTMLElement)) return false;
    scroller.scrollTop = 80;
    return scroller.scrollTop === 80;
  })()`), true);
  await delay(500);
  const metrics = await browser.evaluate(`(() => {
    const scroller = document.querySelector('[data-ocix-clip-test-scroller]');
    const runner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    const guard = document.querySelector('[data-ocix-clip-test-guard]');
    if (!(scroller instanceof HTMLElement) || !(runner instanceof HTMLElement) || !(guard instanceof HTMLElement)) return null;
    const rect = (node) => { const value = node.getBoundingClientRect(); return { left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height }; };
    return { innerWidth:window.innerWidth,innerHeight:window.innerHeight,outerWidth:window.outerWidth,outerHeight:window.outerHeight,scroller:rect(scroller),runner:rect(runner),guard:rect(guard) };
  })()`);
  assert.notEqual(metrics, null);
  const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await targetsResponse.json();
  const artifactTarget = targets.find((entry) => entry.type === 'page'
    && /\/api\/interactive-ui\/artifacts\/[a-f0-9]{64}\/document/.test(entry.url || ''));
  assert.notEqual(artifactTarget, undefined, `Artifact debugger target missing: ${JSON.stringify(targets.map((entry) => entry.url))}`);
  artifactBrowser = await connect(artifactTarget);
  const brokerDiagnostics = await artifactBrowser.evaluate(`(() => {
    const frame = document.querySelector('body[data-ocix-artifact-broker] > iframe');
    const rect = frame?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      style: frame?.getAttribute('style') || '',
      frameRect: rect ? { left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height } : null,
    };
  })()`);
  assert.equal(
    metrics.runner.bottom > metrics.scroller.bottom,
    true,
    `fixture must cross the clipping edge: ${JSON.stringify({ metrics, brokerDiagnostics })}`,
  );
  assert.equal(metrics.guard.top > metrics.scroller.bottom, true, 'guard must remain outside the scroller');

  await captureMacWindow({ pid: appProcess.pid, outputPath: screenshotPath });
  const inspection = await inspectClipGuard(metrics);

  const dialogMetrics = await browser.evaluate(`(() => {
    const runner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    if (!(runner instanceof HTMLElement)) return null;
    const overlay = document.createElement('div');
    overlay.setAttribute('data-ocix-test-dialog-overlay', '');
    overlay.setAttribute('data-oc-native-surface-occluder', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: '#00e5ff',
    });
    document.body.append(overlay);
    const rect = runner.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      runner: { left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height },
    };
  })()`);
  assert.notEqual(dialogMetrics, null);
  await delay(750);
  await captureMacWindow({ pid: appProcess.pid, outputPath: dialogScreenshotPath });
  const dialogInspection = await inspectDialogRegion({ imagePath: dialogScreenshotPath, metrics: dialogMetrics });
  assert.equal(dialogInspection.cyanRatio > 0.7, true, `Dialog overlay was covered by the native Runner: ${JSON.stringify(dialogInspection)}`);
  assert.equal(dialogInspection.magentaRatio < 0.05, true, `Native Runner remained visible over the dialog: ${JSON.stringify(dialogInspection)}`);

  await browser.evaluate(`(() => {
    document.querySelector('[data-ocix-test-dialog-overlay]')?.remove();
  })()`);
  let dialogRestoredInspection = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await delay(250);
    await captureMacWindow({ pid: appProcess.pid, outputPath: dialogRestoredScreenshotPath });
    dialogRestoredInspection = await inspectDialogRegion({
      imagePath: dialogRestoredScreenshotPath,
      metrics: dialogMetrics,
    });
    if (dialogRestoredInspection.magentaRatio > 0.7) break;
  }
  assert.notEqual(dialogRestoredInspection, null);
  assert.equal(dialogRestoredInspection.magentaRatio > 0.7, true, `Native Runner did not return after the dialog closed: ${JSON.stringify(dialogRestoredInspection)}`);

  artifactBrowser.socket.close();
  artifactBrowser = null;

  const modeQuery = new URLSearchParams({
    runtime: 'artifact-interactive',
    session: 'ses_packaged_artifact_mode_lifecycle',
    theme: 'dark',
    locale: 'zh-CN',
  });
  const modeNavigation = await browser.send('Page.navigate', {
    url: `openchamber-ui://app/interactive-ui-demo.html?${modeQuery}`,
  });
  assert.equal(Boolean(modeNavigation.result?.errorText), false, modeNavigation.result?.errorText || 'mode fixture navigation failed');
  await waitFor(browser, `document.readyState === 'complete'`, 'mode fixture document');
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"] [data-ocix-artifact-backend="desktop-runner"]') !== null`, 'mode fixture Scripts Artifact Runner');
  assert.equal(await browser.evaluate(`(() => {
    window.__artifactModeRunner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    return Boolean(window.__artifactModeRunner);
  })()`), true);

  const readModeState = async () => browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-host]');
    const runner = host?.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    return {
      mode: host?.getAttribute('data-ocix-artifact-mode') || '',
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      sameRunnerElement: runner === window.__artifactModeRunner,
      stopPresent: Boolean(host?.querySelector('[data-ocix-artifact-action="stop"]')),
      fullscreenPresent: Boolean(host?.querySelector('[data-ocix-artifact-action="fullscreen"]')),
      workspacePresent: Boolean(host?.querySelector('[data-ocix-artifact-action="workspace"]')),
      inlinePresent: Boolean(host?.querySelector('[data-ocix-artifact-action="inline"]')),
      failurePresent: Boolean(host?.querySelector('[data-ocix-artifact-fallback]')),
    };
  })()`);
  const enterMode = async (mode, outputPath) => {
    await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="${mode}"]')?.click()`);
    await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="${mode}"]') !== null`, `${mode} mode`);
    await delay(750);
    const state = await readModeState();
    assert.equal(state.state, 'ready', `${mode} must preserve the ready Runner: ${JSON.stringify(state)}`);
    assert.equal(state.sameRunnerElement, true, `${mode} must preserve the Runner host element`);
    assert.equal(state.stopPresent, true, `${mode} must preserve the stop/restart control`);
    assert.equal(state.failurePresent, false, `${mode} must not show the safety failure fallback`);
    assert.equal(state.inlinePresent, true, `${mode} must provide an exit control`);
    await captureMacWindow({ pid: appProcess.pid, outputPath });
    return state;
  };
  const restoreInline = async (label) => {
    await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="inline"]')?.click()`);
    await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="inline"][data-ocix-artifact-state="ready"]') !== null`, `${label} inline restore`);
    await delay(750);
    const state = await readModeState();
    assert.equal(state.sameRunnerElement, true, `${label} exit must preserve the Runner host element`);
    assert.equal(state.stopPresent, true, `${label} exit must restore the stop/restart control`);
    assert.equal(state.workspacePresent, true, `${label} exit must restore the workspace control`);
    assert.equal(state.fullscreenPresent, true, `${label} exit must restore the fullscreen control`);
    assert.equal(state.failurePresent, false, `${label} exit must not show a failure fallback`);
    return state;
  };

  const workspaceState = await enterMode('workspace', workspaceScreenshotPath);
  const workspaceRestoreState = await restoreInline('workspace');
  const fullscreenState = await enterMode('fullscreen', fullscreenScreenshotPath);
  const fullscreenRestoreState = await restoreInline('fullscreen');
  const repeatedWorkspaceState = await enterMode('workspace', workspaceScreenshotPath);
  const repeatedWorkspaceRestoreState = await restoreInline('repeated workspace');
  await captureMacWindow({ pid: appProcess.pid, outputPath: restoredInlineScreenshotPath });
  const modeLifecycleOk = [
    workspaceState,
    workspaceRestoreState,
    fullscreenState,
    fullscreenRestoreState,
    repeatedWorkspaceState,
    repeatedWorkspaceRestoreState,
  ].every((state) => state.state === 'ready'
    && state.sameRunnerElement
    && state.stopPresent
    && !state.failurePresent);

  await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="stop"]')?.click()`);
  await waitFor(
    browser,
    `document.querySelector('[data-ocix-artifact-backend="desktop-runner"]') === null`,
    'mode fixture Runner cleanup',
  );
  await delay(500);

  await fs.access(workbenchPackagePath);
  const packageBase64 = (await fs.readFile(workbenchPackagePath)).toString('base64');
  const packageInspection = await requestJson(serverPort, '/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64 },
    timeoutMs: 60_000,
  });
  const installedPackage = await requestJson(serverPort, '/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64,
      confirmedPublisherFingerprint: packageInspection.publisher.fingerprint,
    },
    timeoutMs: 60_000,
  });
  assert.equal(installedPackage.installed, true);

  const workbenchProjectId = 'packaged-workbench-shell-acceptance';
  let workbenchSnapshot = await requestJson(
    serverPort,
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(workbenchProjectId)}`,
  );
  const revisionOf = (snapshot) => snapshot.boards
    .find((board) => board.id === snapshot.activeBoardId)?.revision ?? 0;
  const tileDrafts = Array.from({ length: 6 }, (_, index) => ({
    source: {
      kind: 'third-party-extension',
      extensionId: 'com.openchamber.lab.ops',
      surfaceId: index === 0
        ? 'com.openchamber.lab.ops.topology'
        : 'com.openchamber.lab.ops.overview',
    },
    form: index === 0 ? 'html-artifact' : 'interactive-ui',
    context: { environment: `acceptance-${index + 1}` },
    displayMode: 'tile',
  }));
  for (const tile of tileDrafts) {
    const result = await requestJson(
      serverPort,
      `/api/interactive-ui/workbench/boards/${encodeURIComponent(workbenchProjectId)}/tiles`,
      {
        method: 'POST',
        body: { expectedRevision: revisionOf(workbenchSnapshot), tile },
      },
    );
    workbenchSnapshot = result.snapshot;
  }

  const workbenchQuery = new URLSearchParams({
    runtime: 'workbench',
    project: workbenchProjectId,
    dragRegionTest: 'true',
    theme: 'dark',
    locale: 'zh-CN',
  });
  const workbenchNavigation = await browser.send('Page.navigate', {
    url: `openchamber-ui://app/interactive-ui-demo.html?${workbenchQuery}`,
  });
  assert.equal(
    Boolean(workbenchNavigation.result?.errorText),
    false,
    workbenchNavigation.result?.errorText || 'workbench fixture navigation failed',
  );
  await waitFor(browser, `document.readyState === 'complete'`, 'workbench fixture document');
  await waitFor(
    browser,
    `document.querySelectorAll('[data-workbench-tile]').length === 6`,
    'six Workbench tiles',
  );
  try {
    await waitFor(
      browser,
      `document.querySelector('[data-workbench-tile] [data-ocix-artifact-state="ready"] [data-ocix-artifact-backend="desktop-runner"]') !== null`,
      'Workbench Scripts Artifact Runner',
    );
  } catch (error) {
    const diagnostic = await browser.evaluate(`Array.from(document.querySelectorAll('[data-workbench-tile]')).map((tile) => ({
      title: tile.querySelector('h3')?.textContent?.trim() || '',
      artifactState: tile.querySelector('[data-ocix-artifact-state]')?.getAttribute('data-ocix-artifact-state') || '',
      artifactBackend: tile.querySelector('[data-ocix-artifact-backend]')?.getAttribute('data-ocix-artifact-backend') || '',
      text: tile.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 500) || '',
    }))`);
    await captureMacWindow({ pid: appProcess.pid, outputPath: workbenchScreenshotPath });
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }

  const workbenchScrollMetrics = await browser.evaluate(`(() => {
    const header = document.querySelector('[data-workbench-board-header]');
    const scroller = document.querySelector('[data-workbench-board-scroller]');
    if (!(header instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;
    scroller.scrollTop = Math.min(300, scroller.scrollHeight - scroller.clientHeight);
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return { left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height };
    };
    return {
      header: rect(header),
      scroller: rect(scroller),
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  })()`);
  assert.notEqual(workbenchScrollMetrics, null);
  assert.equal(workbenchScrollMetrics.scrollTop > 0, true, 'Workbench fixture must produce a scrolling board');
  assert.equal(
    Math.abs(workbenchScrollMetrics.header.bottom - workbenchScrollMetrics.scroller.top) <= 1,
    true,
    `Workbench header and scroller must be adjacent: ${JSON.stringify(workbenchScrollMetrics)}`,
  );
  await delay(750);
  const workbenchHeaderHit = await browser.evaluate(`(() => {
    const header = document.querySelector('[data-workbench-board-header]');
    if (!(header instanceof HTMLElement)) return null;
    const rect = header.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      headerOwnsPoint: Boolean(hit?.closest('[data-workbench-board-header]')),
      tileOwnsPoint: Boolean(hit?.closest('[data-workbench-tile]')),
    };
  })()`);
  assert.deepEqual(workbenchHeaderHit, { headerOwnsPoint: true, tileOwnsPoint: false });
  await captureMacWindow({ pid: appProcess.pid, outputPath: workbenchScreenshotPath });

  await browser.evaluate(`(() => {
    const scroller = document.querySelector('[data-workbench-board-scroller]');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  })()`);
  await delay(250);
  await browser.evaluate(`(() => {
    const tile = Array.from(document.querySelectorAll('[data-workbench-tile]'))
      .find((candidate) => candidate.querySelector('[data-ocix-artifact-source="third-party-extension"]'));
    tile?.querySelector('[data-workbench-tile-controls] button')?.click();
  })()`);
  await waitFor(
    browser,
    `document.querySelector('[data-workbench-tile][aria-modal="true"]') !== null`,
    'focused Workbench tile',
  );
  await waitFor(
    browser,
    `document.querySelector('[data-workbench-tile][aria-modal="true"] [data-ocix-artifact-state="ready"]') !== null`,
    'focused Workbench Artifact ready',
  );
  const focusReply = await browser.send('Runtime.evaluate', {
    expression: `window.__OPENCHAMBER_DESKTOP__.invoke('desktop_focus_main_window')`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(Boolean(focusReply.result?.exceptionDetails), false);
  const focusedControls = await browser.evaluate(`(() => {
    const tile = document.querySelector('[data-workbench-tile][aria-modal="true"]');
    const controls = tile?.querySelector('[data-workbench-tile-controls]');
    if (!(tile instanceof HTMLElement) || !(controls instanceof HTMLElement)) return null;
    const buttons = Array.from(controls.querySelectorAll('button'));
    return {
      tileAppRegion: getComputedStyle(tile).getPropertyValue('-webkit-app-region'),
      controlsAppRegion: getComputedStyle(controls).getPropertyValue('-webkit-app-region'),
      points: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }),
    };
  })()`);
  assert.notEqual(focusedControls, null);
  assert.equal(focusedControls.tileAppRegion, 'no-drag');
  assert.equal(focusedControls.controlsAppRegion, 'no-drag');
  assert.equal(focusedControls.points.length, 3);

  const actualMouseHover = [];
  for (let index = 0; index < focusedControls.points.length; index += 1) {
    const point = focusedControls.points[index];
    await postMacMouseEvent({ pid: appProcess.pid, x: point.x, y: point.y });
    await delay(180);
    actualMouseHover.push(await browser.evaluate(`(() => {
      const controls = document.querySelector('[data-workbench-tile][aria-modal="true"] [data-workbench-tile-controls]');
      const buttons = Array.from(controls?.querySelectorAll('button') ?? []);
      const button = buttons[${index}];
      if (!(button instanceof HTMLButtonElement)) return {
        buttonCount: buttons.length,
        labels: buttons.map((candidate) => candidate.getAttribute('aria-label') || ''),
        missing: true,
      };
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: button.getAttribute('aria-label') || '',
        hovered: button.matches(':hover'),
        centerHit: hit === button || Boolean(hit?.closest('button') === button),
        hitLabel: hit?.closest('button')?.getAttribute('aria-label') || '',
      };
    })()`));
  }
  assert.equal(
    actualMouseHover.every((entry) => entry?.hovered && entry.centerHit),
    true,
    `Focused Workbench controls lost actual macOS pointer hover: ${JSON.stringify(actualMouseHover)}`,
  );
  await browser.evaluate(`document.querySelector(
    '[data-workbench-tile][aria-modal="true"] [data-workbench-tile-controls] button',
  )?.click()`);
  await waitFor(
    browser,
    `document.querySelector('[data-workbench-tile][aria-modal="true"]') === null`,
    'actual macOS pointer exits Workbench focus',
  );

  const report = {
    $schema: 'openchamber://artifact-runner-clipping-acceptance/v1',
    generatedAt: new Date().toISOString(),
    appPath,
    updaterPolicy,
    screenshotPath,
    metrics,
    inspection,
    dialogOcclusion: {
      ok: dialogInspection.cyanRatio > 0.7
        && dialogInspection.magentaRatio < 0.05
        && dialogRestoredInspection.magentaRatio > 0.7,
      dialogScreenshotPath,
      dialogRestoredScreenshotPath,
      dialogInspection,
      dialogRestoredInspection,
    },
    modeLifecycle: {
      ok: modeLifecycleOk,
      workspaceState,
      workspaceRestoreState,
      fullscreenState,
      fullscreenRestoreState,
      repeatedWorkspaceState,
      repeatedWorkspaceRestoreState,
      workspaceScreenshotPath,
      fullscreenScreenshotPath,
      restoredInlineScreenshotPath,
    },
    workbench: {
      package: `${packageInspection.extension.id}@${packageInspection.extension.version}`,
      tiles: tileDrafts.length,
      headerScrollerBoundary: workbenchScrollMetrics,
      headerHit: workbenchHeaderHit,
      actualMouseHover,
      actualMouseExitFocus: true,
      screenshotPath: workbenchScreenshotPath,
    },
    ok: inspection.magentaPixels === 0
      && inspection.greenRatio > 0.7
      && dialogInspection.cyanRatio > 0.7
      && dialogInspection.magentaRatio < 0.05
      && dialogRestoredInspection.magentaRatio > 0.7
      && modeLifecycleOk
      && workbenchHeaderHit.headerOwnsPoint
      && actualMouseHover.every((entry) => entry?.hovered && entry.centerHit),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  assert.equal(inspection.magentaPixels, 0, `Native Runner escaped into the guard (${inspection.magentaPixels} magenta pixels)`);
  assert.equal(inspection.greenRatio > 0.7, true, `Clip guard green ratio was ${inspection.greenRatio.toFixed(3)}`);
} catch (error) {
  failure = error;
} finally {
  try { browser?.socket.close(); } catch {}
  try { artifactBrowser?.socket.close(); } catch {}
  if (appProcess && appProcess.exitCode === null && appProcess.signalCode === null) {
    appProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => appProcess.once('exit', resolve)),
      delay(10_000),
    ]);
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill('SIGKILL');
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

if (failure) throw failure;
