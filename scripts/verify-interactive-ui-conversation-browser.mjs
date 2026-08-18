import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  HYBRID_CRM_FIXTURE,
  createHybridCrmPackage,
  startHybridCrmApi,
} from './lib/interactive-ui-hybrid-crm-fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = (process.env.OPENCHAMBER_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:47832').replace(/\/$/, '');
const model = (() => {
  const selector = process.env.OPENCHAMBER_ACCEPTANCE_MODEL || 'alibaba-coding-plan-cn/qwen3.7-plus';
  const slash = selector.indexOf('/');
  assert(slash > 0 && slash < selector.length - 1, `Invalid model selector ${selector}`);
  return { providerID: selector.slice(0, slash), modelID: selector.slice(slash + 1) };
})();
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-conversation-browser');
const reportPath = path.join(outputDirectory, 'report.json');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-conversation-browser-'));
const chromeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-conversation-chrome-'));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readResponse = async (response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const request = async (pathname, { method = 'GET', body, timeoutMs = 30_000 } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${payload?.code ?? String(payload).slice(0, 160)}`);
  }
  return payload;
};

const waitFor = async (operation, label, timeoutMs = 120_000, intervalMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError?.message ? `: ${lastError.message}` : ''}`);
};

const waitForTools = async (expected, timeoutMs = 120_000) => waitFor(async () => {
  const tools = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`, { timeoutMs: 10_000 });
  return HYBRID_CRM_FIXTURE.toolNames.every((tool) => tools.includes(tool)) === expected ? tools : null;
}, expected ? 'hybrid CRM tools' : 'hybrid CRM tool cleanup', timeoutMs, 750);

const waitForSession = async (sessionId, timeoutMs = 180_000) => waitFor(async () => {
  const [messages, statuses] = await Promise.all([
    request(`/api/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(projectRoot)}`),
    request(`/api/session/status?directory=${encodeURIComponent(projectRoot)}`).catch(() => ({})),
  ]);
  const assistantMessages = messages.filter((message) => message?.info?.role === 'assistant');
  const latest = assistantMessages.at(-1);
  const finished = ['stop', 'tool-calls', 'error', 'cancelled'].includes(latest?.info?.finish);
  return finished && (statuses?.[sessionId]?.type ?? 'idle') === 'idle' ? assistantMessages : null;
}, `session ${sessionId}`, timeoutMs, 750);

const runPrompt = async ({ title, prompt, expectedTool, expectedSchema, routingSystem }) => {
  const created = await request(`/api/session?directory=${encodeURIComponent(projectRoot)}`, {
    method: 'POST',
    body: { directory: projectRoot, title },
  });
  assert.equal(typeof created?.id, 'string');
  await request(`/api/session/${encodeURIComponent(created.id)}/prompt_async?directory=${encodeURIComponent(projectRoot)}`, {
    method: 'POST',
    body: {
      model,
      agent: 'build',
      system: routingSystem,
      parts: [{ type: 'text', text: prompt }],
    },
  });
  const messages = await waitForSession(created.id);
  const completedTools = messages
    .flatMap((message) => message.parts ?? [])
    .filter((part) => part?.type === 'tool' && part.state?.status === 'completed');
  const primary = completedTools.find((part) => part.tool === expectedTool && String(part.state?.output).includes(expectedSchema));
  assert(primary, `${model.providerID}/${model.modelID} did not complete ${expectedTool}`);
  return {
    sessionId: created.id,
    tool: primary.tool,
    outputSchema: expectedSchema,
    finishes: messages.map((message) => message.info?.finish).filter(Boolean),
  };
};

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
};

const findChrome = async () => {
  const candidates = [
    process.env.OPENCHAMBER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next reviewed browser path.
    }
  }
  throw new Error('Chrome/Chromium not found; set OPENCHAMBER_TEST_CHROME');
};

const waitForDebugger = async (port, output) => waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
  return response?.ok ? true : null;
}, `Chrome DevTools (${output()})`, 15_000, 100);

const connectBrowser = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  const contexts = new Map();
  const childSessions = new Map();
  const runtimeErrors = [];
  let send;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Target.attachedToTarget') {
      childSessions.set(message.params.sessionId, message.params.targetInfo);
      void send?.('Runtime.enable', {}, message.params.sessionId);
    }
    if (message.method === 'Target.detachedFromTarget') childSessions.delete(message.params.sessionId);
    if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params.context;
      contexts.set(`${message.sessionId ?? 'root'}:${context.id}`, { ...context, sessionId: message.sessionId ?? null });
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      contexts.delete(`${message.sessionId ?? 'root'}:${message.params.executionContextId}`);
    }
    if (message.method === 'Runtime.executionContextsCleared') {
      for (const [key, context] of contexts) {
        if ((context.sessionId ?? null) === (message.sessionId ?? null)) contexts.delete(key);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  send = (method, params = {}, sessionId = null) => new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (expression, contextId, sessionId = null) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId ? { contextId } : {}),
    }, sessionId);
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result.result.value;
  };
  return { socket, send, evaluate, contexts, childSessions, runtimeErrors };
};

const waitForDocument = async (browser, url, expression, label) => {
  await browser.send('Page.navigate', { url });
  return waitFor(() => browser.evaluate(expression), label, 120_000, 250);
};

const dismissUnrelatedBrowserOverlays = async (browser) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await browser.evaluate(`(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
      const onboarding = dialogs.find((element) => /Add project directory/i.test(element.textContent || ''));
      const dismiss = Array.from(document.querySelectorAll('button'))
        .find((button) => button.offsetParent !== null && button.textContent?.trim() === 'Dismiss');
      dismiss?.click();
      return { onboarding: Boolean(onboarding), dismissedPwa: Boolean(dismiss) };
    })()`);
    if (state.onboarding) {
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    }
    if (!state.onboarding && !state.dismissedPwa) return;
    await delay(150);
  }
  const remaining = await browser.evaluate(`Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    .map((element) => element.textContent?.trim().slice(0, 120) || '')`);
  assert.deepEqual(remaining.filter((text) => /Add project directory/i.test(text)), []);
};

const readArtifactDocument = async (browser, contextId, context = null, sessionId = null) => {
  try {
    const state = await browser.evaluate(`({
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.trim() || '',
      status: document.getElementById('status')?.textContent?.trim() || '',
      customers: document.getElementById('customers')?.textContent?.trim() || '',
      opportunities: document.getElementById('opportunities')?.textContent?.trim() || '',
      businessReady: document.body?.dataset?.businessReady || '',
      metricsLabel: document.querySelector('.metrics')?.getAttribute('aria-label') || '',
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    })`, contextId, sessionId);
    if (state?.heading !== 'Simple CRM Explorer') return null;
    return {
      ...state,
      context: {
        id: contextId,
        frameId: context?.auxData?.frameId ?? null,
        isDefault: context?.auxData?.isDefault ?? null,
        type: context?.auxData?.type ?? 'isolated-world',
      },
    };
  } catch {
    return null;
  }
};

const flattenFrameTree = (frameTree) => frameTree
  ? [frameTree.frame, ...(frameTree.childFrames ?? []).flatMap(flattenFrameTree)]
  : [];

const readArtifactFrame = async (browser) => {
  for (const [sessionId, target] of browser.childSessions) {
    if (!String(target.url).includes('/api/interactive-ui/extensions/')) continue;
    const state = await readArtifactDocument(browser, null, {
      auxData: { frameId: target.targetId, isDefault: true, type: target.type },
    }, sessionId);
    if (state) return state;
  }

  for (const context of browser.contexts.values()) {
    const state = await readArtifactDocument(browser, context.id, context, context.sessionId);
    if (state) return state;
  }

  const treeResponse = await browser.send('Page.getFrameTree');
  const frames = flattenFrameTree(treeResponse.result?.frameTree);
  for (const frame of frames) {
    if (!String(frame.url).includes('/api/interactive-ui/extensions/')) continue;
    try {
      const world = await browser.send('Page.createIsolatedWorld', {
        frameId: frame.id,
        worldName: 'openchamber-acceptance',
        grantUniveralAccess: false,
      });
      const contextId = world.result?.executionContextId;
      if (!contextId) continue;
      const state = await readArtifactDocument(browser, contextId, {
        auxData: { frameId: frame.id, isDefault: false, type: 'isolated-world' },
      });
      if (state) return state;
    } catch {
      // The OOPIF can be replaced while the Artifact document is loading.
    }
  }
  return null;
};

const inspectBrowserContexts = async (browser) => {
  const results = [];
  for (const context of browser.contexts.values()) {
    try {
      results.push({
        id: context.id,
        sessionId: context.sessionId,
        name: context.name,
        origin: context.origin,
        auxData: context.auxData,
        document: await browser.evaluate(`({
          url: location.href,
          title: document.title,
          heading: document.querySelector('h1')?.textContent?.trim() || '',
          status: document.getElementById('status')?.textContent?.trim() || '',
          businessReady: document.body?.dataset?.businessReady || '',
          text: document.body?.innerText?.slice(0, 500) || ''
        })`, context.id, context.sessionId),
      });
    } catch (error) {
      results.push({ id: context.id, sessionId: context.sessionId, name: context.name, origin: context.origin, auxData: context.auxData, error: error.message });
    }
  }
  results.push(...Array.from(browser.childSessions, ([sessionId, target]) => ({ sessionId, target })));
  return results;
};

const archiveSession = (sessionId) => request(`/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(projectRoot)}`, {
  method: 'PATCH',
  body: { time: { archived: Date.now() } },
}).catch(() => null);

let crmApi;
let chromeProcess;
let browser;
let installedByTest = false;
let publisherWasTrusted = false;
const sessions = [];

try {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  const health = await request('/health');
  assert.equal(health?.openCodeRunning, true, `OpenChamber is not ready at ${baseUrl}`);

  const initialManager = await request('/api/interactive-ui/manager');
  assert.equal(initialManager.extensions.some((extension) => extension.id === HYBRID_CRM_FIXTURE.extensionId), false,
    'The browser acceptance test will not replace an existing Simple CRM installation');
  publisherWasTrusted = initialManager.publishers.some((publisher) => publisher.id === 'com.demo.simple.crm.publisher'
    && publisher.keys.some((key) => key.id === 'release-2026'));

  crmApi = await startHybridCrmApi();
  const fixturePackage = await createHybridCrmPackage({
    temporaryRoot,
    crmApiUrl: crmApi.url,
    version: '1.3.0-browser.1',
  });
  const packageBase64 = fixturePackage.buffer.toString('base64');
  const inspection = await request('/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64 },
    timeoutMs: 60_000,
  });
  await request('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    },
    timeoutMs: 60_000,
  });
  installedByTest = true;
  await waitForTools(true);
  await request(`/api/interactive-ui/connections/${HYBRID_CRM_FIXTURE.extensionId}/${HYBRID_CRM_FIXTURE.connectorId}`, {
    method: 'PUT',
    body: { accessKey: crmApi.keys.full },
  });
  await request(`/api/interactive-ui/connections/${HYBRID_CRM_FIXTURE.extensionId}/${HYBRID_CRM_FIXTURE.connectorId}/test`, {
    method: 'POST',
  });

  const [routing, providers] = await Promise.all([
    request('/api/interactive-ui/capabilities'),
    request('/api/config/providers'),
  ]);
  assert.equal(typeof routing?.system, 'string');
  const provider = providers.providers.find((entry) => entry.id === model.providerID);
  assert(provider?.models?.[model.modelID], `${model.providerID}/${model.modelID} is not connected`);

  const explorer = await runPrompt({
    title: `OCIX ToolPart browser · ${model.modelID} · Artifact`,
    prompt: '请使用 simple_crm_open_explorer 打开已安装的 CRM 可视化探索器。只调用这个工具一次，不要用 generic html_artifact 重复绘制。',
    expectedTool: HYBRID_CRM_FIXTURE.explorerToolName,
    expectedSchema: 'openchamber://installed-html-artifact-result/v1',
    routingSystem: routing.system,
  });
  sessions.push(explorer.sessionId);
  const overview = await runPrompt({
    title: `OCIX ToolPart browser · ${model.modelID} · Interactive UI`,
    prompt: '请使用 simple_crm_open_overview 打开已安装 CRM 的实时客户和商机概览。只调用这个工具一次。',
    expectedTool: 'simple_crm_open_overview',
    expectedSchema: 'openchamber://interactive-result/v1',
    routingSystem: routing.system,
  });
  sessions.push(overview.sessionId);

  const debugPort = await reservePort();
  const chromeBinary = await findChrome();
  let browserOutput = '';
  chromeProcess = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', (chunk) => {
    browserOutput = `${browserOutput}${String(chunk)}`.slice(-8_000);
  });
  await waitForDebugger(debugPort, () => browserOutput);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  assert.equal(targetResponse.ok, true);
  browser = await connectBrowser(await targetResponse.json());
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');
  await browser.send('Log.enable');
  await browser.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  const artifactHost = await waitForDocument(
    browser,
    `${baseUrl}/?session=${encodeURIComponent(explorer.sessionId)}`,
    `(() => {
      const host = document.querySelector('[data-ocix-artifact-host]');
      if (!host || host.getAttribute('data-ocix-artifact-state') !== 'ready') return null;
      return {
        source: host.getAttribute('data-ocix-artifact-source'),
        state: host.getAttribute('data-ocix-artifact-state'),
        mode: host.getAttribute('data-ocix-artifact-mode'),
        sandbox: host.querySelector('iframe')?.getAttribute('sandbox') || '',
        iframeTitle: host.querySelector('iframe')?.getAttribute('title')?.trim() || '',
        controlsMissingName: Array.from(host.querySelectorAll('button, a[href], input, select, textarea'))
          .filter((element) => !(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)?.trim()).length,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        count: document.querySelectorAll('[data-ocix-artifact-host]').length
      };
    })()`,
    'installed Artifact in the normal conversation ToolPart',
  );
  assert.equal(artifactHost.source, 'third-party-extension');
  assert.equal(artifactHost.state, 'ready');
  assert.equal(artifactHost.mode, 'inline');
  assert.equal(artifactHost.sandbox, 'allow-scripts');
  assert.equal(artifactHost.iframeTitle, 'Simple CRM Explorer');
  assert.equal(artifactHost.controlsMissingName, 0);
  assert.equal(artifactHost.pageOverflow, false);
  assert.equal(artifactHost.count, 1);
  let artifactFrame;
  try {
    artifactFrame = await waitFor(async () => {
      const state = await readArtifactFrame(browser);
      return state?.businessReady === 'true' ? state : null;
    }, 'live CRM data inside the installed Artifact sandbox', 20_000, 250);
  } catch (error) {
    const contextDiagnostics = await inspectBrowserContexts(browser);
    await fs.writeFile(
      path.join(outputDirectory, 'artifact-context-diagnostics.json'),
      `${JSON.stringify(contextDiagnostics, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    throw new Error(`${error.message}; contexts=${JSON.stringify(contextDiagnostics).slice(0, 4_000)}`);
  }
  assert.deepEqual(
    { status: artifactFrame.status, customers: artifactFrame.customers, opportunities: artifactFrame.opportunities },
    { status: 'Connected', customers: '4', opportunities: '4' },
  );
  assert.equal(artifactFrame.metricsLabel, 'CRM live metrics');
  assert.equal(artifactFrame.pageOverflow, false);
  await dismissUnrelatedBrowserOverlays(browser);
  const artifactScreenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await fs.writeFile(path.join(outputDirectory, 'third-party-html-artifact-conversation.png'), Buffer.from(artifactScreenshot.result.data, 'base64'));

  const interactiveView = await waitForDocument(
    browser,
    `${baseUrl}/?session=${encodeURIComponent(overview.sessionId)}`,
    `(() => {
      const metadata = document.querySelector('[data-ocix-view-metadata]');
      const rows = document.querySelectorAll('tbody tr').length;
      if (!metadata || rows === 0) return null;
      return {
        metadata: metadata.textContent?.trim() || '',
        rows,
        views: document.querySelectorAll('[data-ocix-view-metadata]').length,
        controlsMissingName: Array.from(metadata.closest('.ocix-scope')?.querySelectorAll('button, a[href], input, select, textarea') || [])
          .filter((element) => !(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)?.trim()).length,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        body: document.body.innerText.slice(0, 1600)
      };
    })()`,
    'installed Interactive UI in the normal conversation ToolPart',
  );
  assert.equal(interactiveView.views, 1);
  assert.equal(interactiveView.rows > 0, true);
  assert.equal(interactiveView.controlsMissingName, 0);
  assert.equal(interactiveView.pageOverflow, false);
  assert.match(interactiveView.metadata, /Live data/i);
  assert.match(interactiveView.body, /Simple CRM|CRM/);
  await dismissUnrelatedBrowserOverlays(browser);
  const interactiveScreenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await fs.writeFile(path.join(outputDirectory, 'installed-interactive-ui-conversation.png'), Buffer.from(interactiveScreenshot.result.data, 'base64'));

  const report = {
    $schema: 'openchamber://interactive-ui-conversation-browser-report/v1',
    generatedAt: new Date().toISOString(),
    baseUrl: new URL(baseUrl).origin,
    model: `${model.providerID}/${model.modelID}`,
    package: { id: HYBRID_CRM_FIXTURE.extensionId, version: inspection.extension.version },
    conversations: { explorer, overview },
    assertions: {
      installedArtifactToolPart: artifactHost,
      installedArtifactLiveData: artifactFrame,
      installedInteractiveUIToolPart: {
        metadata: interactiveView.metadata,
        rows: interactiveView.rows,
        views: interactiveView.views,
        controlsMissingName: interactiveView.controlsMissingName,
        pageOverflow: interactiveView.pageOverflow,
      },
      runtimeErrors: browser.runtimeErrors,
    },
    screenshots: [
      'third-party-html-artifact-conversation.png',
      'installed-interactive-ui-conversation.png',
    ],
    ok: true,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, reportPath: path.relative(projectRoot, reportPath), model: report.model }, null, 2));
} finally {
  if (browser) browser.socket.close();
  if (chromeProcess && chromeProcess.exitCode === null) {
    chromeProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chromeProcess.once('exit', resolve)),
      delay(2_000),
    ]);
    if (chromeProcess.exitCode === null) chromeProcess.kill('SIGKILL');
  }
  await Promise.all(sessions.map(archiveSession));
  if (installedByTest) {
    await request(`/api/interactive-ui/manager/extensions/${HYBRID_CRM_FIXTURE.extensionId}`, {
      method: 'DELETE',
      timeoutMs: 60_000,
    }).catch(() => null);
    await waitForTools(false).catch(() => null);
  }
  if (!publisherWasTrusted) {
    await request('/api/interactive-ui/manager/publishers/com.demo.simple.crm.publisher/keys/release-2026', {
      method: 'DELETE',
    }).catch(() => null);
  }
  await crmApi?.close().catch(() => null);
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  await fs.rm(chromeDirectory, { recursive: true, force: true });
}
