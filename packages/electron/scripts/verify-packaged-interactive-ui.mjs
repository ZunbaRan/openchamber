import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HYBRID_CRM_FIXTURE,
  createHybridCrmPackage,
  startHybridCrmApi,
} from '../../../scripts/lib/interactive-ui-hybrid-crm-fixture.mjs';

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(electronRoot, '../..');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-packaged-desktop');
const reportPath = path.join(outputDirectory, 'report.json');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  const deadline = Date.now() + 60_000;
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
const settingsPath = path.join(dataDirectory, 'settings.json');
await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(userDataDirectory, { recursive: true });
await fs.mkdir(openCodeConfigDirectory, { recursive: true });
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

let crmApi;
let hybridCrmPackage;

const debugPort = await reservePort();
const childEnvironment = {
  ...process.env,
  OPENCHAMBER_DATA_DIR: dataDirectory,
  OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
  OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'false',
  OPENCHAMBER_TEST_BUNDLED_OPENCODE_ONLY: 'true',
  OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
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
    processOutput = `${processOutput}${String(chunk)}`.slice(-12_000);
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
  assert.equal(capabilities.scripts, false);
  assert.equal(capabilities.scriptsMode, 'unsupported');
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
  assert.deepEqual(manager.builtInRuntime, {
    id: 'com.openchamber.builtin.interactive-ui',
    version: '1.0.0',
    status: 'ready',
  });
  const packageBase64 = hybridCrmPackage.buffer.toString('base64');
  const inspection = await requestJson(port, '/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64 },
    timeoutMs: 60_000,
  });
  assert.equal(inspection.extension.id, HYBRID_CRM_FIXTURE.extensionId);
  assert.equal(inspection.permissions.sandboxedArtifacts, true);
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
  assert.equal(extensions.extensions?.some((extension) => extension.id === 'com.openchamber.builtin.interactive-ui'), true);
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

  await navigate('artifact-interactive');
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="scripts-disabled"]') !== null`, 'packaged scripts-disabled fallback');
  const disabled = await browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-host]');
    const notice = document.querySelector('[data-ocix-artifact-failure="scripts-disabled"]');
    const fallback = host?.querySelector('details[data-ocix-artifact-fallback]');
    return {
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      role: notice?.getAttribute('role') || '',
      iframeCount: host?.querySelectorAll('iframe').length ?? -1,
      fallbackPresent: Boolean(fallback),
      fallbackOpen: fallback?.hasAttribute('open') ?? false,
    };
  })()`);
  assert.deepEqual(disabled, {
    state: 'scripts-disabled',
    role: 'status',
    iframeCount: 0,
    fallbackPresent: true,
    fallbackOpen: false,
  });

  await navigate('artifact-installed', {
    artifact: HYBRID_CRM_FIXTURE.artifactId,
    tool: HYBRID_CRM_FIXTURE.explorerToolName,
  });
  await waitFor(browser, `document.querySelector('[data-ocix-artifact-source="third-party-extension"][data-ocix-artifact-state="ready"]') !== null`, 'packaged installed Artifact ready');
  const installedArtifact = await browser.evaluate(`(() => {
    const host = document.querySelector('[data-ocix-artifact-source="third-party-extension"]');
    const frame = host?.querySelector('iframe');
    return {
      state: host?.getAttribute('data-ocix-artifact-state') || '',
      source: host?.getAttribute('data-ocix-artifact-source') || '',
      sandbox: frame?.getAttribute('sandbox') || '',
      title: frame?.getAttribute('title') || '',
      iframeCount: host?.querySelectorAll('iframe').length ?? 0,
    };
  })()`);
  assert.deepEqual(installedArtifact, {
    state: 'ready',
    source: 'third-party-extension',
    sandbox: 'allow-scripts',
    title: 'Simple CRM Explorer',
    iframeCount: 1,
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
    processOutput = `${processOutput}${String(chunk)}`.slice(-12_000);
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
  assert.equal(restartedManager.builtInRuntime?.status, 'ready');
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
      scriptsFallback: disabled.state,
      cspRevision: capabilities.cspRevision,
      appRestart: 'ready-with-same-content-id',
      installed: {
        package: `${HYBRID_CRM_FIXTURE.extensionId}@${inspection.extension.version}`,
        tools: HYBRID_CRM_FIXTURE.toolNames.filter((toolId) => hybridToolIds.includes(toolId)),
        gatewayCustomerCount: installedGatewayQuery.data.customerCount,
        appRestart: 'ready',
      },
    },
    screenshots: [screenshotPath, installedScreenshotPath],
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
