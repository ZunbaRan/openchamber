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
const outputDirectory = path.join(projectRoot, '.tmp', 'artifact-runner-clipping-packaged');
const screenshotPath = path.join(outputDirectory, 'artifact-runner-scroll-clip-macos.png');
const dialogScreenshotPath = path.join(outputDirectory, 'artifact-runner-dialog-overlay-macos.png');
const dialogRestoredScreenshotPath = path.join(outputDirectory, 'artifact-runner-dialog-restored-macos.png');
const workspaceScreenshotPath = path.join(outputDirectory, 'artifact-runner-workspace-mode-macos.png');
const fullscreenScreenshotPath = path.join(outputDirectory, 'artifact-runner-fullscreen-mode-macos.png');
const restoredInlineScreenshotPath = path.join(outputDirectory, 'artifact-runner-restored-inline-macos.png');
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
  const { stdout } = await execFileAsync('/usr/bin/swift', ['-e', source], { timeout: 30_000 });
  const windowId = Number(stdout.trim());
  assert.equal(Number.isInteger(windowId) && windowId > 0, true, `Could not resolve window id for pid ${pid}`);
  return windowId;
};

const captureMacWindow = async ({ pid, outputPath }) => {
  const windowId = await resolveMacWindowId(pid);
  await execFileAsync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowId), outputPath], { timeout: 30_000 });
  await fs.access(outputPath);
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
const settingsPath = path.join(dataDirectory, 'settings.json');
await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(userDataDirectory, { recursive: true });
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
      OPENCODE_HOST: '127.0.0.1',
      OPENCODE_PORT: '9',
      OPENCODE_SKIP_START: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendOutput = (chunk) => { processOutput = `${processOutput}${String(chunk)}`.slice(-12_000); };
  appProcess.stdout?.on('data', appendOutput);
  appProcess.stderr?.on('data', appendOutput);
  appProcess.once('exit', () => { processExited = true; });

  const [, target] = await Promise.all([
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
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: '#00e5ff',
    });
    document.body.append(overlay);
    document.documentElement.classList.add('oc-dialog-open');
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
    document.documentElement.classList.remove('oc-dialog-open');
    document.querySelector('[data-ocix-test-dialog-overlay]')?.remove();
  })()`);
  await delay(750);
  await captureMacWindow({ pid: appProcess.pid, outputPath: dialogRestoredScreenshotPath });
  const dialogRestoredInspection = await inspectDialogRegion({ imagePath: dialogRestoredScreenshotPath, metrics: dialogMetrics });
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
    ok: inspection.magentaPixels === 0
      && inspection.greenRatio > 0.7
      && dialogInspection.cyanRatio > 0.7
      && dialogInspection.magentaRatio < 0.05
      && dialogRestoredInspection.magentaRatio > 0.7
      && modeLifecycleOk,
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
