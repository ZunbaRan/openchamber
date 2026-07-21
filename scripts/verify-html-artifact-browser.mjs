import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { learningRateSimulatorArtifact } from '../examples/interactive-ui/artifact-fixtures.mjs';
import { createHTMLArtifactStore } from '../packages/web/server/lib/interactive-ui/artifact-store.js';
import { registerInteractiveUIRoutes } from '../packages/web/server/lib/interactive-ui/routes.js';

const scriptsProbeEnabled = process.env.OPENCHAMBER_TEST_ARTIFACT_SCRIPTS === 'true';

const staticSecurityProbeArtifact = {
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Static Artifact security probe',
  summary: 'CSP must block every relative subresource without issuing a request',
  html: `<!doctype html><html><head><style>
    @import "/artifact-security-target?kind=style-import";
    .probe { background-image: url("/artifact-security-target?kind=background"); }
  </style></head><body>
    <div class="probe">static-ready</div>
    <img alt="" src="/artifact-security-target?kind=image" srcset="/artifact-security-target?kind=srcset 1x">
    <video poster="/artifact-security-target?kind=poster"></video>
  </body></html>`,
  capabilities: { scripts: false },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 320 },
};

const securityProbeArtifact = {
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Artifact security probe',
  summary: 'Deterministic browser enforcement probe',
  html: `<!doctype html><html><body><script>
  (() => {
    const outcomes = {};
    const target = __OPENCHAMBER_SECURITY_TARGET__;
    const targetUrl = (kind) => target + '?kind=' + kind;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const rejects = async (operation) => {
      try { await operation(); return false; } catch { return true; }
    };
    const finish = async () => {
      outcomes.parentDom = (() => { try { parent.document.body.dataset.compromised = 'true'; return false; } catch { return true; } })();
      outcomes.localStorage = (() => { try { localStorage.setItem('probe', '1'); return false; } catch { return true; } })();
      outcomes.indexedDB = (() => { try { indexedDB.open('probe'); return false; } catch { return true; } })();
      outcomes.cookie = (() => { try { document.cookie = 'probe=1'; return document.cookie === ''; } catch { return true; } })();
      outcomes.popup = (() => { try { return window.open(targetUrl('popup')) === null; } catch { return true; } })();
      outcomes.topNavigation = (() => { try { top.location = targetUrl('top'); return false; } catch { return true; } })();
      outcomes.dynamicEval = (() => { try { window['ev' + 'al']('1'); return false; } catch { return true; } })();
      outcomes.functionConstructor = (() => { try { window['Fun' + 'ction']('return 1')(); return false; } catch { return true; } })();
      outcomes.networkFetch = await rejects(() => window['fet' + 'ch'](targetUrl('fetch')));
      outcomes.xhr = await new Promise((resolve) => {
        try {
          const Request = window['XML' + 'HttpRequest'];
          const request = new Request();
          request.open('GET', targetUrl('xhr'));
          request.timeout = 300;
          request.onload = () => resolve(false);
          request.onerror = () => resolve(true);
          request.ontimeout = () => resolve(true);
          request.send();
        } catch { resolve(true); }
      });
      outcomes.webSocket = await new Promise((resolve) => {
        try {
          const Socket = window['Web' + 'Socket'];
          const socket = new Socket(target.replace(/^http/, 'ws') + '?kind=websocket');
          const timer = setTimeout(() => { try { socket.close(); } catch {} resolve(true); }, 500);
          socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false); };
          socket.onerror = () => { clearTimeout(timer); resolve(true); };
        } catch { resolve(true); }
      });
      outcomes.beacon = (() => {
        try { navigator['send' + 'Beacon'](targetUrl('beacon'), 'probe'); return true; }
        catch { return true; }
      })();
      outcomes.worker = await new Promise((resolve) => {
        try {
          const WorkerConstructor = window['Wor' + 'ker'];
          const source = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
          const thread = new WorkerConstructor(source);
          const timer = setTimeout(() => { thread.terminate(); URL.revokeObjectURL(source); resolve(true); }, 500);
          thread.onmessage = () => { clearTimeout(timer); thread.terminate(); URL.revokeObjectURL(source); resolve(false); };
          thread.onerror = () => { clearTimeout(timer); thread.terminate(); URL.revokeObjectURL(source); resolve(true); };
        } catch { resolve(true); }
      });
      outcomes.serviceWorker = await rejects(() => navigator['service' + 'Worker'].register(targetUrl('service-worker')));
      outcomes.wasm = await rejects(() => window['Web' + 'Assembly'].compile(new Uint8Array([0,97,115,109,1,0,0,0])));
      outcomes.clipboardRead = !navigator.clipboard || await rejects(() => navigator.clipboard.readText());

      await wait(100);
      top.postMessage({ source: 'artifact-security-result', outcomes }, '*');
    };
    void finish();
  })();
  </script></body></html>`,
  capabilities: { scripts: true },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 420 },
};

const listen = (app) => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
  server.once('error', reject);
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await close(server);
  return port;
};

const findChrome = async () => {
  const candidates = [
    process.env.OPENCHAMBER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next reviewed browser path.
    }
  }
  throw new Error('Chrome/Chromium not found; set OPENCHAMBER_TEST_CHROME to an executable path');
};

const waitForDebugger = async (port, processOutput) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Chrome DevTools did not start: ${processOutput().slice(-2_000)}`);
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
  const consoleMessages = [];
  const logEntries = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(message.params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '));
    }
    if (message.method === 'Log.entryAdded') logEntries.push(message.params.entry.text);
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
  const evaluate = async (expression, contextId = undefined) => {
    const reply = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      ...(contextId ? { contextId } : {}),
    });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result.result.value;
  };
  return { socket, send, evaluate, runtimeErrors, consoleMessages, logEntries };
};

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-browser-data-'));
const chromeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-browser-chrome-'));
let artifactServer;
let chromeProcess;

try {
  const app = express();
  const blockedNetworkRequests = [];
  let staticDocumentPath = '';
  let interactiveDocumentPath = '';
  let interactiveArtifactId = '';
  let securityDocumentPaths = [];
  const artifactStore = createHTMLArtifactStore({
    dataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    environment: { OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: scriptsProbeEnabled ? 'true' : 'false' },
  });
  registerInteractiveUIRoutes(app, { express, runtime: {}, manager: {}, artifactStore });
  app.all('/artifact-security-target', (req, res) => {
    blockedNetworkRequests.push({ method: req.method, url: req.originalUrl });
    res.status(204).end();
  });
  app.get('/artifact-static-host', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    res.type('html').send(`<!doctype html><html><body>
      <iframe id="artifact" sandbox src="${staticDocumentPath}"></iframe>
      <script>
        document.getElementById('artifact').addEventListener('load', () => { window.__artifactFrameLoaded = true; });
      </script>
    </body></html>`);
  });
  app.get('/artifact-interactive-host', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    res.type('html').send(`<!doctype html><html><body>
      <iframe id="artifact" sandbox="allow-scripts" src="${interactiveDocumentPath}"></iframe>
      <script>
        const frame = document.getElementById('artifact');
        const channelId = 'browser-probe-channel-0001';
        frame.addEventListener('load', () => frame.contentWindow.postMessage({
          source: 'openchamber-host', direction: 'host-to-artifact', bridgeVersion: 1,
          channelId, sequence: 1, type: 'host.init',
          payload: { mode: 'inline', locale: 'en', timezone: 'UTC', reducedMotion: true,
            theme: 'light', tokens: {}, viewport: { width: 800, height: 420 } }
        }, '*'));
        addEventListener('message', (event) => {
          if (event.source === frame.contentWindow && event.data?.source === 'openchamber-artifact'
            && event.data.channelId === channelId && event.data.type === 'artifact.ready') window.__artifactReady = true;
        });
      </script>
    </body></html>`);
  });
  app.get('/artifact-test-raw', async (_req, res) => {
    const artifact = await artifactStore.getDocument(interactiveArtifactId);
    res.type('html').send(artifact.html);
  });
  app.get('/artifact-security-host', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    res.type('html').send(`<!doctype html><html><body><script>
      window.__artifactAttackMarkers = [];
      window.__artifactBrokerSignals = [];
      const paths = ${JSON.stringify(securityDocumentPaths)};
      for (const [index, source] of paths.entries()) {
        const frame = document.createElement('iframe');
        const channelId = 'security-probe-channel-' + String(index).padStart(4, '0');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.src = source;
        frame.addEventListener('load', () => frame.contentWindow.postMessage({
          source: 'openchamber-host', direction: 'host-to-artifact', bridgeVersion: 1,
          channelId, sequence: 1, type: 'host.init',
          payload: { mode: 'inline', locale: 'en', timezone: 'UTC', reducedMotion: true,
            theme: 'light', tokens: {}, viewport: { width: 800, height: 420 } }
        }, '*'));
        document.body.append(frame);
      }
      addEventListener('message', (event) => {
        if (event.data?.source === 'artifact-attack-started') window.__artifactAttackMarkers.push(event.data.kind);
        if (event.data?.source === 'artifact-security-result') window.__artifactSecurityResults = event.data.outcomes;
        if (event.data?.source === 'openchamber-artifact-broker') window.__artifactBrokerSignals.push(event.data.type);
      });
    </script></body></html>`);
  });
  artifactServer = await listen(app);
  const address = artifactServer.address();
  assert(address && typeof address !== 'string');
  const gateway = `http://127.0.0.1:${address.port}`;

  const staticResponse = await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staticSecurityProbeArtifact),
  });
  const staticMaterialized = await staticResponse.json();
  assert.equal(staticResponse.status, 201, JSON.stringify(staticMaterialized));
  staticDocumentPath = staticMaterialized.documentPath;

  const navigationResponse = await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...staticSecurityProbeArtifact,
      html: '<a href="/artifact-security-target?kind=navigation">navigate</a>',
    }),
  });
  const navigationFailure = await navigationResponse.json();
  assert.equal(navigationResponse.status, 400, JSON.stringify(navigationFailure));
  assert.equal(navigationFailure.code, 'prohibited_artifact_navigation');

  let materialized = null;
  if (scriptsProbeEnabled) {
    const materialize = async (artifact) => {
      const response = await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(artifact),
      });
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      return result;
    };
    const materializedResponse = await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(learningRateSimulatorArtifact),
    });
    assert.equal(materializedResponse.status, 201);
    materialized = await materializedResponse.json();
    interactiveDocumentPath = materialized.documentPath;
    interactiveArtifactId = materialized.artifactId;

    const encodedTarget = Buffer.from(`${gateway}/artifact-security-target`, 'utf8').toString('base64');
    const targetExpression = `atob('${encodedTarget}')`;
    const runtimeSecurityProbe = {
      ...securityProbeArtifact,
      html: securityProbeArtifact.html.replace('__OPENCHAMBER_SECURITY_TARGET__', targetExpression),
    };
    const attackArtifact = (kind, attack) => ({
      ...securityProbeArtifact,
      title: `Artifact ${kind} attack probe`,
      html: `<!doctype html><html><body><script>
        const target = ${targetExpression};
        top.postMessage({ source: 'artifact-attack-started', kind: ${JSON.stringify(kind)} }, '*');
        ${attack}
      </script></body></html>`,
    });
    const attackArtifacts = [
      attackArtifact('form', "const form=document.createElement('form');form.action=target+'?kind=form';form.method='post';document.body.append(form);form.submit();"),
      attackArtifact('frame', "const frame=document.createElement('iframe');frame.src=target+'?kind=frame';document.body.append(frame);"),
      attackArtifact('download', "const link=document.createElement('a');link.href=target+'?kind=download';link.download='probe.txt';document.body.append(link);link.click();"),
      attackArtifact('self-navigation', "location.href=target+'?kind=self-navigation';"),
      attackArtifact('meta-refresh', "const meta=document.createElement('meta');meta.httpEquiv='refresh';meta.content='0;url='+target+'?kind=meta-refresh';document.head.append(meta);"),
    ];
    const securityMaterializations = [];
    for (const artifact of [runtimeSecurityProbe, ...attackArtifacts]) {
      securityMaterializations.push(await materialize(artifact));
    }
    securityDocumentPaths = securityMaterializations.map((result) => result.documentPath);
  } else {
    const scriptsDisabledResponse = await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(learningRateSimulatorArtifact),
    });
    const scriptsDisabled = await scriptsDisabledResponse.json();
    assert.equal(scriptsDisabledResponse.status, 409, JSON.stringify(scriptsDisabled));
    assert.equal(scriptsDisabled.code, 'artifact_scripts_unsupported');
  }

  const debugPort = await reservePort();
  const chromeBinary = await findChrome();
  let browserOutput = '';
  chromeProcess = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', (chunk) => {
    browserOutput = `${browserOutput}${String(chunk)}`.slice(-8_000);
  });
  await waitForDebugger(debugPort, () => browserOutput);

  const staticHostUrl = `${gateway}/artifact-static-host`;
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(staticHostUrl)}`, {
    method: 'PUT',
  });
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  const browser = await connect(target);
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');
  await browser.send('Log.enable');

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await browser.evaluate('document.readyState === "complete" && window.__artifactFrameLoaded === true');
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const staticHostState = await browser.evaluate(`({
    ready: document.readyState,
    frameLoaded: window.__artifactFrameLoaded === true,
    sandbox: document.getElementById('artifact')?.getAttribute('sandbox'),
    source: document.getElementById('artifact')?.getAttribute('src')
  })`);
  assert.equal(staticHostState.ready, 'complete');
  assert.equal(staticHostState.frameLoaded, true);
  assert.equal(staticHostState.sandbox, '');
  assert.equal(staticHostState.source, staticDocumentPath);
  assert.deepEqual(blockedNetworkRequests, [], 'Static Artifact CSP must prevent every subresource request');

  let before = null;
  let after = null;
  let securityResults = null;
  let brokerNavigationSignals = [];
  if (scriptsProbeEnabled) {
    assert(materialized);
    await browser.send('Page.navigate', { url: `${gateway}/artifact-test-raw` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await browser.evaluate('document.readyState');
      if (ready === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    before = await browser.evaluate(`({
      ready: document.readyState,
      value: document.getElementById('rate-value').textContent,
      path: document.getElementById('curve').getAttribute('d'),
      revision: document.getElementById('curve').dataset.renderValue
    })`);
    after = await browser.evaluate(`(() => {
      const slider = document.getElementById('rate');
      slider.value = '80';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        value: document.getElementById('rate-value').textContent,
        path: document.getElementById('curve').getAttribute('d'),
        revision: document.getElementById('curve').dataset.renderValue
      };
    })()`);

    assert.equal(before.ready, 'complete');
    assert.equal(before.revision, '30');
    assert.notEqual(before.value, after.value);
    assert.notEqual(before.path, after.path);
    assert.equal(after.revision, '80');

    await browser.send('Page.navigate', { url: `${gateway}/artifact-interactive-host` });
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const ready = await browser.evaluate('window.__artifactReady === true');
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(await browser.evaluate('window.__artifactReady === true'), true);

    await browser.send('Page.navigate', { url: `${gateway}/artifact-security-host` });
    for (let attempt = 0; attempt < 160; attempt += 1) {
      securityResults = await browser.evaluate('window.__artifactSecurityResults ?? null');
      if (securityResults) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!securityResults) {
      const frameTree = await browser.send('Page.getFrameTree');
      const hostState = await browser.evaluate(`({
        frameCount: document.querySelectorAll('iframe').length,
        attackMarkers: window.__artifactAttackMarkers || [],
        brokerSignals: window.__artifactBrokerSignals || [],
        body: document.body.innerHTML.slice(0, 500)
      })`);
      throw new Error(`Artifact security probe did not finish: ${JSON.stringify({
        frameTree,
        hostState,
        runtimeErrors: browser.runtimeErrors,
        consoleMessages: browser.consoleMessages,
        logEntries: browser.logEntries,
      })}`);
    }
    for (const [capability, blocked] of Object.entries(securityResults)) {
      assert.equal(blocked, true, `${capability} should be blocked inside the Artifact sandbox`);
    }
    let attackMarkers = [];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      attackMarkers = await browser.evaluate('window.__artifactAttackMarkers ?? []');
      if (attackMarkers.length === 5) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.deepEqual([...attackMarkers].sort(), ['download', 'form', 'frame', 'meta-refresh', 'self-navigation']);
    await new Promise((resolve) => setTimeout(resolve, 800));
    brokerNavigationSignals = await browser.evaluate('window.__artifactBrokerSignals ?? []');
    assert.deepEqual(blockedNetworkRequests, [], 'Artifact sandbox/CSP must prevent all target requests');
  }
  assert.equal(browser.runtimeErrors.length, 0);

  console.log(JSON.stringify({
    ok: true,
    mode: scriptsProbeEnabled ? 'scripts-security-probe' : 'static-production',
    scriptsMode: artifactStore.getCapabilities().scriptsMode,
    static: {
      frameLoaded: staticHostState.frameLoaded,
      sandbox: staticHostState.sandbox,
      navigationRejected: navigationFailure.code,
    },
    ...(scriptsProbeEnabled ? {
      fixture: 'learningRateSimulatorArtifact',
      before: { value: before.value, pathLength: before.path.length, revision: before.revision },
      after: { value: after.value, pathLength: after.path.length, revision: after.revision },
      blockedCapabilities: Object.keys(securityResults).sort(),
      brokerNavigationSignals,
    } : {}),
    blockedNetworkRequests: blockedNetworkRequests.length,
    runtimeErrors: browser.runtimeErrors.length,
  }, null, 2));

  browser.socket.close();
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
} finally {
  if (chromeProcess && chromeProcess.exitCode === null) {
    chromeProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chromeProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (artifactServer) await close(artifactServer);
  await fs.rm(dataDirectory, { recursive: true, force: true });
  await fs.rm(chromeDirectory, { recursive: true, force: true });
}
