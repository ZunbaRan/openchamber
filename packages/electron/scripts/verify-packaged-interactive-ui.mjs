import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  HYBRID_CRM_FIXTURE,
  assertHybridCrmFixtureAvailable,
  createHybridCrmPackage,
  startHybridCrmApi,
} from '../../../scripts/lib/interactive-ui-hybrid-crm-fixture.mjs';

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(electronRoot, '../..');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-packaged-desktop');
const reportPath = path.join(outputDirectory, 'report.json');
const execFileAsync = promisify(execFile);

try {
  await assertHybridCrmFixtureAvailable();
} catch (error) {
  const missingPath = error && typeof error === 'object' && 'path' in error
    ? ` (${String(error.path)})`
    : '';
  console.log(
    `[electron] skipped packaged Interactive UI CRM fixture verification: `
      + `the optional workspace fixture is not installed${missingPath}`,
  );
  process.exit(0);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  assert.equal(Number.isInteger(windowId) && windowId > 0, true, `Could not resolve OpenChamber window id for pid ${pid}`);
  return windowId;
};

const captureMacWindow = async ({ pid, outputPath }) => {
  const windowId = await resolveMacWindowId(pid);
  await execFileAsync('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowId), outputPath], {
    timeout: 30_000,
  });
  await fs.access(outputPath);
};

const inspectClipGuard = async (screenshotPath, metrics) => {
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
  if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${payload?.code ?? 'unknown'}`);
  return payload;
};

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
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return path.resolve(candidate);
    } catch {
      // Try the next known electron-builder output directory.
    }
  }
  throw new Error('Packaged OpenChamber.app not found; build an unpacked macOS app or set OPENCHAMBER_PACKAGED_APP');
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const waitForHealth = async ({ settingsPath, processExited, processOutput }) => {
  const deadline = Date.now() + 60_000;
  let lastHealth = null;
  while (Date.now() < deadline) {
    if (processExited()) {
      throw new Error(`Packaged OpenChamber exited before health was ready:\n${processOutput().slice(-3_000)}`);
    }
    const settings = await readJson(settingsPath);
    const port = Number(settings?.desktopLocalPort);
    if (Number.isInteger(port) && port > 0) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(1_500),
        });
        if (response.ok) {
          lastHealth = await response.json();
          if (lastHealth?.openCodeRunning === true && lastHealth?.opencodeBinarySource === 'bundled') {
            return { port, health: lastHealth };
          }
        }
      } catch {
        // The in-process server or managed OpenCode child is still starting.
      }
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for packaged OpenCode health${lastHealth ? ` (source=${lastHealth.opencodeBinarySource || 'unknown'}, running=${String(lastHealth.openCodeRunning)})` : ''}`);
};

const waitForDebuggerTarget = async ({ debugPort, processExited, processOutput }) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processExited()) {
      throw new Error(`Packaged OpenChamber exited before DevTools was ready:\n${processOutput().slice(-3_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {
      // Electron has not opened its renderer target yet.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for packaged Electron DevTools target:\n${processOutput().slice(-3_000)}`);
};

const connect = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params?.exceptionDetails?.text || 'Runtime exception');
    }
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
    if (reply.error) throw new Error(`Electron Runtime.evaluate failed: ${reply.error.message}`);
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  return { socket, send, evaluate, runtimeErrors };
};

const waitFor = async (browser, expression, label, attempts = 240) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await browser.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const waitForExit = (child, timeoutMs) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve(true);
    return;
  }
  const timer = setTimeout(() => {
    child.off('exit', onExit);
    resolve(false);
  }, timeoutMs);
  const onExit = () => {
    clearTimeout(timer);
    resolve(true);
  };
  child.once('exit', onExit);
});

const waitForPortClosed = async (port) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return true;
    }
    await delay(100);
  }
  return false;
};

const waitForBuiltInAgentRuntime = async ({ port, directory }) => {
  const deadline = Date.now() + 30_000;
  let lastToolIds = [];
  let lastSkills = [];
  while (Date.now() < deadline) {
    try {
      const query = `directory=${encodeURIComponent(directory)}`;
      const [toolResponse, skillResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/api/experimental/tool/ids?${query}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(2_000),
        }),
        fetch(`http://127.0.0.1:${port}/api/config/skills?${query}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(2_000),
        }),
      ]);
      if (toolResponse.ok) lastToolIds = await toolResponse.json();
      if (skillResponse.ok) lastSkills = (await skillResponse.json())?.skills ?? [];
      if (Array.isArray(lastToolIds)
        && lastToolIds.includes('interactive_ui')
        && lastToolIds.includes('html_artifact')
        && Array.isArray(lastSkills)
        && lastSkills.some((skill) => skill?.name === 'interactive-ui-visualization')) {
        return { toolIds: lastToolIds, skills: lastSkills };
      }
    } catch {
      // OpenCode may still be indexing the newly deployed global runtime.
    }
    await delay(100);
  }
  throw new Error(`Bundled OpenCode did not discover the built-in Interactive UI runtime (tools=${lastToolIds.length}, skills=${lastSkills.length})`);
};

const waitForHybridCrmRuntime = async ({ port, directory, processOutput = () => '' }) => {
  // Installing an Agent Runtime intentionally restarts bundled OpenCode. A cold,
  // isolated packaged profile may need longer than the ordinary API startup
  // window while the binary rebuilds its runtime index.
  const deadline = Date.now() + 120_000;
  let lastToolIds = [];
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastToolIds = await requestJson(port, `/api/experimental/tool/ids?directory=${encodeURIComponent(directory)}`, {
        timeoutMs: 2_000,
      });
      if (HYBRID_CRM_FIXTURE.toolNames.every((tool) => lastToolIds.includes(tool))) return lastToolIds;
    } catch (error) {
      lastError = error;
      // The managed bundled OpenCode process restarts after OCIX Agent Runtime reconciliation.
    }
    await delay(150);
  }
  throw new Error(`Bundled OpenCode did not discover the hybrid CRM runtime (tools=${lastToolIds.length}, lastError=${lastError?.message ?? 'none'})\n${processOutput().slice(-5_000)}`);
};

if (process.platform !== 'darwin') {
  throw new Error('Packaged Interactive UI acceptance currently supports the macOS .app output only');
}

const appPath = await resolvePackagedApp();
const executablePath = path.join(appPath, 'Contents', 'MacOS', 'OpenChamber');
const expectedBundledBinary = path.join(appPath, 'Contents', 'Resources', 'opencode-cli', 'opencode');
await fs.access(executablePath);
await fs.access(expectedBundledBinary);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-packaged-acceptance-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const userDataDirectory = path.join(temporaryRoot, 'electron-user-data');
const openCodeConfigDirectory = path.join(temporaryRoot, 'opencode-config');
const homeDirectory = path.join(temporaryRoot, 'home');
const xdgConfigDirectory = path.join(temporaryRoot, 'xdg-config');
const xdgDataDirectory = path.join(temporaryRoot, 'xdg-data');
const xdgCacheDirectory = path.join(temporaryRoot, 'xdg-cache');
const settingsPath = path.join(dataDirectory, 'settings.json');
await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(userDataDirectory, { recursive: true });
await fs.mkdir(openCodeConfigDirectory, { recursive: true });
await fs.mkdir(homeDirectory, { recursive: true });
await fs.mkdir(xdgConfigDirectory, { recursive: true });
await fs.mkdir(xdgDataDirectory, { recursive: true });
await fs.mkdir(xdgCacheDirectory, { recursive: true });
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

let crmApi;
let hybridCrmPackage;

const debugPort = await reservePort();
const childEnvironment = {
  ...process.env,
  OPENCHAMBER_DATA_DIR: dataDirectory,
  OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
  OPENCHAMBER_TEST_BUNDLED_OPENCODE_ONLY: 'true',
  OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
  OPENCHAMBER_OPENCODE_CWD: temporaryRoot,
  OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
  OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  HOME: homeDirectory,
  XDG_CONFIG_HOME: xdgConfigDirectory,
  XDG_DATA_HOME: xdgDataDirectory,
  XDG_CACHE_HOME: xdgCacheDirectory,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
};
for (const key of [
  'OPENCODE_BINARY',
  'OPENCODE_PATH',
  'OPENCHAMBER_OPENCODE_PATH',
  'OPENCHAMBER_OPENCODE_BIN',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_HOST',
  'OPENCODE_PORT',
  'OPENCODE_SKIP_START',
  'OPENCHAMBER_SKIP_OPENCODE_START',
]) {
  delete childEnvironment[key];
}

let processOutput = '';
let processExited = false;
let appProcess;
let browser;
let serverPort = 0;
let failure;
let clipGuardInspection;
let clipScreenshotPath;

try {
  crmApi = await startHybridCrmApi();
  hybridCrmPackage = await createHybridCrmPackage({
    temporaryRoot,
    crmApiUrl: crmApi.url,
    version: '1.3.0-packaged.1',
  });
  appProcess = spawn(executablePath, [
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
  ], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendOutput = (chunk) => {
    processOutput = `${processOutput}${String(chunk)}`.slice(-50_000);
  };
  appProcess.stdout?.on('data', appendOutput);
  appProcess.stderr?.on('data', appendOutput);
  appProcess.once('exit', () => {
    processExited = true;
  });

  const [{ port, health }, target] = await Promise.all([
    waitForHealth({ settingsPath, processExited: () => processExited, processOutput: () => processOutput }),
    waitForDebuggerTarget({ debugPort, processExited: () => processExited, processOutput: () => processOutput }),
  ]);
  serverPort = port;

  assert.equal(health.runtime, 'desktop');
  assert.equal(health.openCodeRunning, true);
  assert.equal(health.opencodeBinarySource, 'bundled');
  assert.equal(path.resolve(health.opencodeBinaryResolved), path.resolve(expectedBundledBinary));
  assert.equal(path.resolve(health.lastOpenCodeLaunchDiagnostics?.binary || ''), path.resolve(expectedBundledBinary));

  const capabilitiesResponse = await fetch(`http://127.0.0.1:${port}/api/interactive-ui/artifacts/capabilities`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(capabilitiesResponse.ok, true);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.static, true);
  assert.equal(capabilities.scripts, true);
  assert.equal(capabilities.scriptsMode, 'supported');
  assert.equal(capabilities.cspRevision, 3);
  const openCodeHealthResponse = await fetch(`http://127.0.0.1:${port}/api/opencode/version`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(openCodeHealthResponse.ok, true);
  const openCodeHealth = await openCodeHealthResponse.json();
  assert.equal(typeof openCodeHealth.version, 'string');
  const managerResponse = await fetch(`http://127.0.0.1:${port}/api/interactive-ui/manager`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(managerResponse.ok, true);
  const manager = await managerResponse.json();
  // The manager contract no longer reports builtInRuntime
  // ({ apiVersion, extensions, publishers, marketplaces }); built-in presence
  // and version are asserted from the runtime extension list below.
  assert.equal(manager.apiVersion, 1);
  const packageBase64 = hybridCrmPackage.buffer.toString('base64');
  const inspection = await requestJson(port, '/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64 },
    timeoutMs: 60_000,
  });
  assert.equal(inspection.extension.id, HYBRID_CRM_FIXTURE.extensionId);
  // The sanitized package permission contract is now exactly { network,
  // nativeCode }; the fixture declares the loopback CRM origin and native-code
  // trust mode, so the exact current shape is asserted.
  assert.deepEqual(inspection.permissions, {
    network: [crmApi.url],
    nativeCode: true,
  });
  const trustedPublisher = await requestJson(port, '/api/interactive-ui/manager/publishers', {
    method: 'POST',
    body: {
      id: HYBRID_CRM_FIXTURE.publisherId,
      name: HYBRID_CRM_FIXTURE.publisherName,
      keyId: HYBRID_CRM_FIXTURE.keyId,
      publicKey: hybridCrmPackage.publisherKeys.publicKey,
    },
  });
  assert.equal(trustedPublisher.publisherId, HYBRID_CRM_FIXTURE.publisherId);
  assert.equal(trustedPublisher.keyId, HYBRID_CRM_FIXTURE.keyId);
  assert.equal(trustedPublisher.fingerprint, inspection.publisher.fingerprint);
  assert.equal(trustedPublisher.added, true);
  const installedPackage = await requestJson(port, '/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    },
    timeoutMs: 60_000,
  });
  assert.equal(installedPackage.installed, true);
  const hybridToolIds = await waitForHybridCrmRuntime({
    port,
    directory: temporaryRoot,
    processOutput: () => processOutput,
  });
  await requestJson(port, `/api/interactive-ui/connections/${HYBRID_CRM_FIXTURE.extensionId}/${HYBRID_CRM_FIXTURE.connectorId}`, {
    method: 'PUT',
    body: { accessKey: crmApi.keys.full },
  });
  await requestJson(port, `/api/interactive-ui/connections/${HYBRID_CRM_FIXTURE.extensionId}/${HYBRID_CRM_FIXTURE.connectorId}/test`, {
    method: 'POST',
  });
  const extensionsResponse = await fetch(`http://127.0.0.1:${port}/api/interactive-ui/extensions`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(extensionsResponse.ok, true);
  const extensions = await extensionsResponse.json();
  assert.equal(extensions.errors?.length, 0);
  const builtInExtension = extensions.extensions?.find((extension) => extension.id === 'com.openchamber.builtin.interactive-ui');
  assert.notEqual(builtInExtension, undefined, 'built-in Interactive UI runtime must be listed');
  assert.equal(builtInExtension.version, '1.3.0', 'built-in Interactive UI runtime version');
  const agentRuntime = await waitForBuiltInAgentRuntime({ port, directory: temporaryRoot });

  browser = await connect(target);
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');

  const navigate = async (runtime, additional = {}) => {
    const query = new URLSearchParams({
      runtime,
      theme: 'light',
      locale: 'zh-CN',
      ocPanel: 'session-chat',
      themeMode: 'light',
      themeVariant: 'light',
      ...additional,
    });
    const reply = await browser.send('Page.navigate', {
      url: `openchamber-ui://app/interactive-ui-demo.html?${query}`,
    });
    assert.equal(Boolean(reply.result?.errorText), false, reply.result?.errorText || 'navigation failed');
    await waitFor(browser, `document.readyState === 'complete'`, `${runtime} document load`);
  };

  await navigate('generated');
  await waitFor(browser, `document.querySelector('[data-ocix-view-metadata]') !== null`, 'packaged Generated Interactive UI ready');
  const generated = await browser.evaluate(`(() => ({
    summary: document.querySelector('[data-ocix-view-summary]')?.textContent?.trim() || '',
    metadata: document.querySelector('[data-ocix-view-metadata]')?.textContent?.trim() || '',
    fallbackVisible: Array.from(document.querySelectorAll('pre')).some((node) => node.textContent?.includes('openchamber://interactive-result/v1')),
  }))()`);
  assert.notEqual(generated.summary, '');
  assert.notEqual(generated.metadata, '');
  assert.equal(generated.fallbackVisible, false);

  await navigate('artifact-static');
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"]') !== null`, 'packaged static Artifact ready');
  const initialStatic = await browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-host]');
    const frame = host?.querySelector('iframe');
    return {
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      mode: host?.getAttribute('data-ocix-artifact-mode') || '',
      sandbox: frame?.getAttribute('sandbox') ?? null,
      src: frame?.getAttribute('src') || '',
      documentPath: frame?.src ? new URL(frame.src).pathname : '',
      summary: document.querySelector('[data-ocix-artifact-summary]')?.textContent?.trim() || '',
      iframeCount: host?.querySelectorAll('iframe').length ?? 0,
    };
  })()`);
  assert.deepEqual({ state: initialStatic.state, mode: initialStatic.mode, sandbox: initialStatic.sandbox }, {
    state: 'ready',
    mode: 'inline',
    sandbox: '',
  });
  assert.equal(initialStatic.iframeCount, 1);
  assert.notEqual(initialStatic.src, '');
  assert.notEqual(initialStatic.summary, '');

  await browser.evaluate(`(() => {
    window.__packagedArtifactFrame = document.querySelector('[data-ocix-artifact-host] iframe');
    return Boolean(window.__packagedArtifactFrame);
  })()`);
  for (const mode of ['workspace', 'fullscreen']) {
    await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="${mode}"]')?.click()`);
    await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="${mode}"]') !== null`, `packaged static ${mode}`);
    assert.equal(await browser.evaluate(`window.__packagedArtifactFrame === document.querySelector('[data-ocix-artifact-host] iframe')`), true);
    await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="inline"]')?.click()`);
    await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="inline"]') !== null`, 'packaged static inline restore');
  }

  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  assert.equal(typeof screenshot.result?.data, 'string');
  const screenshotPath = path.join(outputDirectory, 'static-artifact-packaged-macos.png');
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));

  const clearResponse = await fetch(`http://127.0.0.1:${port}/api/interactive-ui/artifacts/cache`, { method: 'DELETE' });
  assert.equal(clearResponse.ok, true);
  await navigate('artifact-static');
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"]') !== null`, 'packaged static Artifact rebuilt');
  const rebuiltDocumentPath = await browser.evaluate(`(() => {
    const frame = document.querySelector('[data-ocix-artifact-host] iframe');
    return frame?.src ? new URL(frame.src).pathname : '';
  })()`);
  assert.equal(rebuiltDocumentPath, initialStatic.documentPath);

  await navigate('artifact-interactive', {
    session: 'ses_packaged_generated_artifact_clip_test',
    clipTest: 'true',
  });
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"] [data-ocix-artifact-backend="desktop-runner"]') !== null`, 'packaged Scripts Artifact Desktop Runner');
  const scriptsRunner = await browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-host]');
    const runner = host?.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    return {
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      backend: runner?.getAttribute('data-ocix-artifact-backend') || '',
      iframeCount: host?.querySelectorAll('iframe').length ?? 0,
      stopPresent: Boolean(host?.querySelector('[data-ocix-artifact-action="stop"]')),
    };
  })()`);
  assert.deepEqual(scriptsRunner, {
    state: 'ready',
    backend: 'desktop-runner',
    iframeCount: 0,
    stopPresent: true,
  });
  const focusReply = await browser.send('Runtime.evaluate', {
    expression: `window.__OPENCHAMBER_DESKTOP__.invoke('desktop_focus_main_window')`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(Boolean(focusReply.result?.exceptionDetails), false, focusReply.result?.exceptionDetails?.text || 'focus main window failed');
  await delay(500);
  await browser.evaluate(`(() => {
    const scroller = document.querySelector('[data-ocix-clip-test-scroller]');
    const runner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    if (!(scroller instanceof HTMLElement) || !(runner instanceof HTMLElement)) return false;
    scroller.scrollTop = 80;
    return scroller.scrollTop === 80;
  })()`);
  await delay(500);
  const clipMetrics = await browser.evaluate(`(() => {
    const scroller = document.querySelector('[data-ocix-clip-test-scroller]');
    const runner = document.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    const guard = document.querySelector('[data-ocix-clip-test-guard]');
    if (!(scroller instanceof HTMLElement) || !(runner instanceof HTMLElement) || !(guard instanceof HTMLElement)) return null;
    const toJSON = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      scroller: toJSON(scroller.getBoundingClientRect()),
      runner: toJSON(runner.getBoundingClientRect()),
      guard: toJSON(guard.getBoundingClientRect()),
    };
  })()`);
  assert.notEqual(clipMetrics, null);
  assert.equal(clipMetrics.outerWidth > 0 && clipMetrics.outerHeight > 0, true, 'packaged clipping capture requires a visible main window');
  assert.equal(clipMetrics.runner.bottom > clipMetrics.scroller.bottom, true, 'fixture must place the Runner across the clipping edge');
  assert.equal(clipMetrics.guard.top > clipMetrics.scroller.bottom, true, 'guard must remain outside the clipping scroller');
  clipScreenshotPath = path.join(outputDirectory, 'scripts-artifact-scroll-clipping-packaged-macos.png');
  await captureMacWindow({ pid: appProcess.pid, outputPath: clipScreenshotPath });
  clipGuardInspection = await inspectClipGuard(clipScreenshotPath, clipMetrics);
  if (clipGuardInspection.greenRatio <= 0.7) {
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await targetResponse.json();
    const artifactTarget = targets.find((entry) => entry.type === 'page'
      && /\/api\/interactive-ui\/artifacts\/[a-f0-9]{64}\/document/.test(entry.url || ''));
    let artifactSurface = null;
    if (artifactTarget?.webSocketDebuggerUrl) {
      const artifactBrowser = await connect(artifactTarget);
      artifactSurface = await artifactBrowser.evaluate(`(() => {
        const frame = document.querySelector('body[data-ocix-artifact-broker] > iframe');
        const rect = frame?.getBoundingClientRect();
        return {
          readyState: document.readyState,
          bodyAttributes: Array.from(document.body.attributes).map(({ name, value }) => [name, value]),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          frameRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
          frameStyle: frame?.getAttribute('style') || '',
        };
      })()`);
      artifactBrowser.socket.close();
    }
    await fs.writeFile(path.join(outputDirectory, 'clip-diagnostics.json'), JSON.stringify({
      clipMetrics,
      clipGuardInspection,
      targets: targets.map(({ id, type, title, url }) => ({ id, type, title, url })),
      artifactSurface,
    }, null, 2));
  }
  assert.equal(
    clipGuardInspection.magentaPixels,
    0,
    `Native Runner escaped its scroll clip (${clipGuardInspection.magentaPixels} magenta pixels in guard)`,
  );
  assert.equal(
    clipGuardInspection.greenRatio > 0.7,
    true,
    `Clip guard was not visually preserved (${clipGuardInspection.greenRatio.toFixed(3)} green ratio)`,
  );
  await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="stop"]')?.click()`);
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="stopped"]') !== null`, 'packaged Scripts Artifact forced stop');

  await navigate('artifact-installed', {
    artifact: HYBRID_CRM_FIXTURE.artifactId,
    tool: HYBRID_CRM_FIXTURE.explorerToolName,
  });
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-source="third-party-extension"][data-ocix-artifact-state="ready"]') !== null`, 'packaged installed Artifact ready');
  const installedArtifact = await browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-source="third-party-extension"]');
    const runner = host?.querySelector('[data-ocix-artifact-backend="desktop-runner"]');
    return {
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      source: host?.getAttribute('data-ocix-artifact-source') || '',
      backend: runner?.getAttribute('data-ocix-artifact-backend') || '',
      title: runner?.getAttribute('aria-label') || '',
      iframeCount: host?.querySelectorAll('iframe').length ?? 0,
    };
  })()`);
  assert.deepEqual(installedArtifact, {
    state: 'ready',
    source: 'third-party-extension',
    backend: 'desktop-runner',
    title: 'Simple CRM Explorer',
    iframeCount: 0,
  });
  const installedGatewayQuery = await requestJson(port, `/api/interactive-ui/actions/${HYBRID_CRM_FIXTURE.queryActionId}`, {
    method: 'POST',
    body: {
      extensionId: HYBRID_CRM_FIXTURE.extensionId,
      artifactId: HYBRID_CRM_FIXTURE.artifactId,
      instanceId: 'packaged-desktop-acceptance',
      tool: { id: 'packaged-desktop-tool', name: HYBRID_CRM_FIXTURE.explorerToolName },
      input: { scope: 'packaged-acceptance' },
    },
  });
  assert.equal(installedGatewayQuery.data.customerCount, 4);
  await delay(500);
  const installedScreenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const installedScreenshotPath = path.join(outputDirectory, 'installed-artifact-packaged-macos.png');
  await fs.writeFile(installedScreenshotPath, Buffer.from(installedScreenshot.result.data, 'base64'));
  assert.equal(browser.runtimeErrors.length, 0, browser.runtimeErrors.join('\n'));

  browser.socket.close();
  browser = null;
  appProcess.kill('SIGTERM');
  assert.equal(await waitForExit(appProcess, 10_000), true, 'first packaged app process must stop cleanly');
  assert.equal(await waitForPortClosed(port), true, 'first packaged server must stop with the app');

  const restartDebugPort = await reservePort();
  processExited = false;
  processOutput = '';
  appProcess = spawn(executablePath, [
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${restartDebugPort}`,
    '--no-first-run',
  ], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendRestartOutput = (chunk) => {
    processOutput = `${processOutput}${String(chunk)}`.slice(-50_000);
  };
  appProcess.stdout?.on('data', appendRestartOutput);
  appProcess.stderr?.on('data', appendRestartOutput);
  appProcess.once('exit', () => {
    processExited = true;
  });
  const [{ port: restartPort, health: restartHealth }, restartTarget] = await Promise.all([
    waitForHealth({ settingsPath, processExited: () => processExited, processOutput: () => processOutput }),
    waitForDebuggerTarget({ debugPort: restartDebugPort, processExited: () => processExited, processOutput: () => processOutput }),
  ]);
  serverPort = restartPort;
  assert.equal(restartHealth.opencodeBinarySource, 'bundled');
  assert.equal(restartHealth.openCodeRunning, true);
  const restartedManagerResponse = await fetch(`http://127.0.0.1:${restartPort}/api/interactive-ui/manager`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(restartedManagerResponse.ok, true);
  const restartedManager = await restartedManagerResponse.json();
  const restartedExtensionsResponse = await fetch(`http://127.0.0.1:${restartPort}/api/interactive-ui/extensions`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(restartedExtensionsResponse.ok, true);
  const restartedExtensions = await restartedExtensionsResponse.json();
  assert.equal(restartedExtensions.errors?.length, 0);
  const restartedBuiltInExtension = restartedExtensions.extensions?.find((extension) => extension.id === 'com.openchamber.builtin.interactive-ui');
  assert.notEqual(restartedBuiltInExtension, undefined, 'built-in Interactive UI runtime must be listed after app restart');
  assert.equal(restartedBuiltInExtension.version, '1.3.0', 'built-in Interactive UI runtime version after app restart');
  assert.equal(restartedManager.extensions.some((extension) => extension.id === HYBRID_CRM_FIXTURE.extensionId
    && extension.enabled === true), true);
  await waitForBuiltInAgentRuntime({ port: restartPort, directory: temporaryRoot });
  await waitForHybridCrmRuntime({
    port: restartPort,
    directory: temporaryRoot,
    processOutput: () => processOutput,
  });
  browser = await connect(restartTarget);
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');
  await navigate('artifact-static');
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"]') !== null`, 'packaged static Artifact after app restart');
  const restartedDocumentPath = await browser.evaluate(`(() => {
    const frame = document.querySelector('[data-ocix-artifact-host] iframe');
    return frame?.src ? new URL(frame.src).pathname : '';
  })()`);
  assert.equal(restartedDocumentPath, initialStatic.documentPath);
  await navigate('artifact-installed', {
    artifact: HYBRID_CRM_FIXTURE.artifactId,
    tool: HYBRID_CRM_FIXTURE.explorerToolName,
  });
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-source="third-party-extension"][data-ocix-artifact-state="ready"]') !== null`, 'packaged installed Artifact after app restart');
  assert.equal(browser.runtimeErrors.length, 0, browser.runtimeErrors.join('\n'));

  const report = {
    $schema: 'openchamber://interactive-ui-packaged-desktop-report/v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    platform: `${process.platform}-${process.arch}`,
    runtime: health.runtime,
    bundledOpenCode: {
      source: health.opencodeBinarySource,
      version: openCodeHealth.version,
      running: health.openCodeRunning,
      tools: ['interactive_ui', 'html_artifact'].filter((toolId) => agentRuntime.toolIds.includes(toolId)),
      skill: agentRuntime.skills.some((skill) => skill?.name === 'interactive-ui-visualization')
        ? 'interactive-ui-visualization'
        : null,
    },
    generated: 'ready',
    artifact: {
      static: 'ready',
      cacheRebuild: 'same-content-id',
      displayModes: ['inline', 'workspace', 'fullscreen'],
      scriptsMode: capabilities.scriptsMode,
      scriptsRunner: `${scriptsRunner.backend}:ready-then-stopped`,
      scriptsRunnerScrollClip: clipGuardInspection,
      cspRevision: capabilities.cspRevision,
      appRestart: 'ready-with-same-content-id',
      installed: {
        package: `${HYBRID_CRM_FIXTURE.extensionId}@${inspection.extension.version}`,
        tools: HYBRID_CRM_FIXTURE.toolNames.filter((toolId) => hybridToolIds.includes(toolId)),
        gatewayCustomerCount: installedGatewayQuery.data.customerCount,
        appRestart: 'ready',
      },
    },
    screenshots: [screenshotPath, clipScreenshotPath, installedScreenshotPath],
    runtimeErrors: browser.runtimeErrors.length,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath: path.relative(projectRoot, reportPath) }, null, 2));
} catch (error) {
  failure = error;
} finally {
  try {
    browser?.socket.close();
  } catch {
    // Best-effort CDP teardown.
  }
  if (appProcess && appProcess.exitCode === null && appProcess.signalCode === null) {
    appProcess.kill('SIGTERM');
    if (!(await waitForExit(appProcess, 10_000))) {
      appProcess.kill('SIGKILL');
      await waitForExit(appProcess, 5_000);
    }
  }
  if (serverPort > 0) {
    assert.equal(await waitForPortClosed(serverPort), true, 'packaged OpenChamber server must stop with the app');
  }
  await crmApi?.close().catch(() => null);
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

if (failure) throw failure;
