import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_KEYS,
  startHybridCrmApi,
} from './lib/interactive-ui-hybrid-crm-fixture.mjs';
import {
  createExtensionPackage,
  generatePublisherKeyPair,
} from '../packages/web/server/lib/interactive-ui/package-format.js';
import { HOSTED_OCIX_MANIFEST_SCHEMA } from '../packages/web/server/lib/interactive-ui/hosted-ocix.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledOpenCodePath = path.join(projectRoot, 'packages', 'electron', 'resources', 'opencode-cli', 'opencode');
const outputDirectory = path.join(projectRoot, '.tmp', 'hosted-ocix-functional');
const reportPath = path.join(outputDirectory, 'report.json');

const fixture = Object.freeze({
  extensionId: 'com.demo.hosted.crm',
  publisherId: 'com.demo.hosted.crm.publisher',
  publisherName: 'Hosted CRM Demo',
  keyId: 'release-2026',
  connectorId: 'crm-api',
  viewId: 'com.demo.hosted.crm.overview',
  artifactId: 'com.demo.hosted.crm.explorer',
  queryActionId: 'com.demo.hosted.crm.dashboard.query',
  writeActionId: 'com.demo.hosted.crm.opportunity.advance',
  noteActionId: 'com.demo.hosted.crm.customer.note',
  viewTool: 'hosted_crm_open_overview',
  artifactTool: 'hosted_crm_open_explorer',
  expandedTool: 'hosted_crm_open_detail',
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().flatMap((key) => value[key] === undefined
      ? []
      : [[key, canonicalize(value[key])]]),
  );
};

const sha256 = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;

const assertNoSecretMaterial = (value, label, secretValues) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secretValues) {
    assert.equal(serialized.includes(secret), false, `${label} exposed credential material`);
  }
  assert.equal(serialized.includes('BEGIN PUBLIC KEY'), false, `${label} exposed publisher key material`);
  assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false, `${label} exposed signing key material`);
};

const readResponseBody = async (response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const createClient = (baseUrl, secretValues) => async (pathname, {
  method = 'GET',
  body,
  timeoutMs = 15_000,
} = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponseBody(response);
  assertNoSecretMaterial(payload, `${method} ${pathname}`, secretValues);
  return { status: response.status, payload };
};

const expectStatus = (result, status, label) => {
  assert.equal(
    result.status,
    status,
    `${label} returned ${result.status} (${result.payload?.code ?? 'no-code'})`,
  );
  return result.payload;
};

const waitFor = async (operation, label, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}${lastError?.message ? `: ${lastError.message}` : ''}`);
};

const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture did not expose a TCP port');
  return `http://127.0.0.1:${address.port}`;
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
});

const createDeclarativeView = (version) => ({
  $schema: 'openchamber://declarative-view/v1',
  id: fixture.viewId,
  title: `Hosted CRM ${version}`,
  queries: {
    dashboard: {
      action: fixture.queryActionId,
      input: { scope: { $path: 'context.scope', fallback: 'default' } },
    },
  },
  layout: {
    type: 'stack',
    children: [
      {
        type: 'metric-grid',
        columns: { default: 3 },
        items: [
          { label: '客户数', value: { $path: 'query.dashboard.customerCount', fallback: 0, format: 'number' } },
          { label: '活跃商机', value: { $path: 'query.dashboard.openOpportunityCount', fallback: 0, format: 'number' } },
          { label: '商机金额', value: { $path: 'query.dashboard.pipelineValue', fallback: 0, format: 'currency:CNY' } },
        ],
      },
      {
        type: 'data-table',
        title: '商机管道',
        data: { $path: 'query.dashboard.opportunities', fallback: [] },
        rowKey: 'id',
        columns: [
          { key: 'name', label: '商机' },
          { key: 'customer', label: '客户' },
          { key: 'amount', label: '金额', format: 'currency:CNY' },
          { key: 'stageLabel', label: '阶段', render: 'status' },
        ],
      },
    ],
  },
});

const createArtifactDocument = (version) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Hosted CRM Explorer ${version}</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; padding: 20px; background: transparent; color: CanvasText; }
      .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .metric { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 14px; }
      strong { display: block; margin-top: 6px; font-size: 24px; }
      @media (max-width: 560px) { .metrics { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <h1>Hosted CRM Explorer ${version}</h1>
    <p id="status">Waiting for Host</p>
    <section class="metrics" aria-label="Hosted CRM live metrics">
      <article class="metric">Customers<strong id="customers">—</strong></article>
      <article class="metric">Opportunities<strong id="opportunities">—</strong></article>
      <article class="metric">Pipeline<strong id="pipeline">—</strong></article>
    </section>
    <script>
      addEventListener('openchamber:host-init', async (event) => {
        try {
          const data = await window.openchamber.business.query(
            '${fixture.queryActionId}',
            { scope: event.detail.context?.scope || 'default' },
          );
          document.getElementById('customers').textContent = String(data.customerCount);
          document.getElementById('opportunities').textContent = String(data.openOpportunityCount);
          document.getElementById('pipeline').textContent = String(data.pipelineValue);
          document.getElementById('status').textContent = 'Connected';
          document.body.dataset.businessReady = 'true';
        } catch (error) {
          document.getElementById('status').textContent = error?.message || 'Unavailable';
          document.body.dataset.businessReady = 'false';
        }
      }, { once: true });
    </script>
  </body>
</html>
`;

const createRemoteManifest = ({
  apiUrl,
  remoteUrl,
  keys,
  version,
  expanded = false,
}) => {
  const view = Buffer.from(`${JSON.stringify(createDeclarativeView(version), null, 2)}\n`);
  const artifact = Buffer.from(createArtifactDocument(version));
  const resourceEntries = [
    {
      path: 'ui/declarative/overview.view.json',
      url: `${remoteUrl}/ui/declarative/overview.view.json`,
      mimeType: 'application/json',
      sha256: sha256(view),
    },
    {
      path: 'ui/artifacts/explorer.html',
      url: `${remoteUrl}/ui/artifacts/explorer.html`,
      mimeType: 'text/html',
      sha256: sha256(artifact),
    },
  ];
  const toolNames = [
    fixture.viewTool,
    fixture.artifactTool,
    ...(expanded ? [fixture.expandedTool] : []),
  ];
  const actionIds = [
    fixture.queryActionId,
    fixture.writeActionId,
    ...(expanded ? [fixture.noteActionId] : []),
  ];
  const permissions = {
    resourceOrigins: [remoteUrl],
    networkOrigins: [apiUrl],
    externalLinkOrigins: [],
    credentialScopes: expanded ? ['crm.read', 'crm.write', 'crm.note.write'] : ['crm.read', 'crm.write'],
    actionIds,
    agentToolNames: toolNames,
    clipboard: false,
    popups: expanded,
  };
  const extension = {
    $schema: 'openchamber://extension/v1',
    id: fixture.extensionId,
    name: 'Hosted CRM',
    shortName: 'Hosted CRM',
    version,
    agentRouting: {
      domain: 'crm',
      intents: ['crm.overview', 'crm.opportunity.advance', 'crm.explorer'],
      examples: { en: ['Open Hosted CRM'] },
      dataAuthority: 'connected-business-system',
    },
    connectors: [{
      id: fixture.connectorId,
      type: 'http',
      baseUrl: apiUrl,
      auth: {
        type: 'api-key',
        placement: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
      },
      test: { method: 'GET', path: '/health' },
    }],
    views: [{
      id: fixture.viewId,
      title: 'Hosted CRM Overview',
      runtime: 'declarative',
      entry: 'ui/declarative/overview.view.json',
      tools: [fixture.viewTool, ...(expanded ? [fixture.expandedTool] : [])],
      routing: { intents: ['crm.overview', 'crm.opportunity.advance'], priority: 90, operation: 'mixed' },
      displayModes: ['inline', 'workspace', 'fullscreen'],
      dashboard: {
        description: 'Hosted CRM live overview',
        inputSchema: {
          type: 'object',
          properties: { scope: { type: 'string', minLength: 1, maxLength: 80 } },
        },
        defaultContext: { scope: 'default' },
        layout: { columns: 6, rows: 6, minColumns: 4, maxColumns: 12, minRows: 4, maxRows: 12, overflow: 'auto' },
        instances: 'byContext',
        refresh: { mode: 'manual', minimumIntervalSeconds: 30 },
        events: { emits: [], accepts: [] },
        popout: { supported: true },
      },
    }],
    artifacts: [{
      id: fixture.artifactId,
      title: 'Hosted CRM Explorer',
      entry: 'ui/artifacts/explorer.html',
      tools: [fixture.artifactTool],
      routing: { intents: ['crm.explorer'], priority: 92, operation: 'mixed' },
      displayModes: ['inline', 'workspace', 'fullscreen'],
      inlineHeight: 520,
      capabilities: {
        scripts: true,
        businessActions: [fixture.queryActionId, fixture.writeActionId],
      },
      dashboard: {
        description: 'Hosted CRM sandboxed explorer',
        inputSchema: {
          type: 'object',
          properties: { scope: { type: 'string', minLength: 1, maxLength: 80 } },
        },
        defaultContext: { scope: 'default' },
        layout: { columns: 6, rows: 7, minColumns: 4, maxColumns: 12, minRows: 4, maxRows: 16, overflow: 'auto' },
        instances: 'byContext',
        refresh: { mode: 'manual', minimumIntervalSeconds: 30 },
        events: { emits: [], accepts: [] },
        popout: { supported: true },
      },
    }],
    actions: [
      {
        id: fixture.queryActionId,
        connector: fixture.connectorId,
        risk: 'read',
        permission: 'allow',
        request: { method: 'POST', path: '/dashboard' },
      },
      {
        id: fixture.writeActionId,
        connector: fixture.connectorId,
        risk: 'write',
        permission: 'ask',
        request: { method: 'POST', path: '/opportunities/advance' },
        confirmation: {
          title: 'Advance opportunity?',
          description: 'This updates the connected CRM.',
        },
      },
      ...(expanded ? [{
        id: fixture.noteActionId,
        connector: fixture.connectorId,
        risk: 'write',
        permission: 'ask',
        request: { method: 'POST', path: '/customer-notes' },
      }] : []),
    ],
    permissions: { network: [apiUrl] },
    trust: { mode: 'declarative', signature: 'production' },
  };
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {
      id: fixture.extensionId,
      version,
      publishedAt: version === '2.0.0'
        ? '2026-07-29T00:00:00.000Z'
        : version === '2.0.1'
          ? '2026-07-29T01:00:00.000Z'
          : version === '2.1.0'
            ? '2026-07-29T02:00:00.000Z'
            : '2026-07-29T03:00:00.000Z',
    },
    permissions,
    extension,
    resources: resourceEntries,
  };
  const signature = crypto.sign(
    null,
    Buffer.from(JSON.stringify(canonicalize(unsigned))),
    crypto.createPrivateKey(keys.privateKey),
  ).toString('base64');
  return {
    document: {
      ...unsigned,
      signature: { algorithm: 'ed25519', keyId: fixture.keyId, value: signature },
    },
    permissions,
    resources: {
      '/ui/declarative/overview.view.json': { body: view, mimeType: 'application/json' },
      '/ui/artifacts/explorer.html': { body: artifact, mimeType: 'text/html' },
    },
  };
};

const startHostedRemote = async ({ apiUrl, keys }) => {
  const state = {
    version: '2.0.0',
    expanded: false,
    available: true,
    tamperResources: false,
  };
  let baseUrl;
  const server = http.createServer((request, response) => {
    if (!state.available) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Hosted fixture unavailable' }));
      return;
    }
    const current = createRemoteManifest({
      apiUrl,
      remoteUrl: baseUrl,
      keys,
      version: state.version,
      expanded: state.expanded,
    });
    if (request.method === 'GET' && request.url === '/manifest.json') {
      const body = Buffer.from(JSON.stringify(current.document));
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openchamber.hosted-ocix+json',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }
    const resource = current.resources[request.url];
    if (request.method === 'GET' && resource) {
      const body = state.tamperResources
        ? Buffer.from(`tampered:${state.version}:${request.url}`)
        : resource.body;
      response.writeHead(200, {
        'Content-Type': resource.mimeType,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  baseUrl = await listen(server);
  return {
    url: baseUrl,
    state,
    buildCurrent: () => createRemoteManifest({
      apiUrl,
      remoteUrl: baseUrl,
      keys,
      version: state.version,
      expanded: state.expanded,
    }),
    close: () => closeServer(server),
  };
};

const createThinPackage = async ({
  temporaryRoot,
  keys,
  manifestUrl,
  initialPermissions,
}) => {
  const extensionDirectory = path.join(temporaryRoot, 'hosted-thin-package');
  await fs.mkdir(extensionDirectory, { recursive: true });
  await fs.writeFile(path.join(extensionDirectory, 'openchamber.extension.json'), `${JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id: fixture.extensionId,
    name: 'Hosted CRM',
    shortName: 'Hosted CRM',
    version: '1.0.0',
    delivery: {
      type: 'hosted',
      manifestUrl,
      ttlSeconds: 60,
      minimumRuntimeVersion: '1.16.3',
      initialPermissions,
    },
    permissions: { network: [] },
    trust: { mode: 'declarative', signature: 'production' },
  }, null, 2)}\n`);
  return createExtensionPackage({
    extensionDirectory,
    privateKey: keys.privateKey,
    publisherId: fixture.publisherId,
    publisherName: fixture.publisherName,
    keyId: fixture.keyId,
    createdAt: '2026-07-29T00:00:00.000Z',
  });
};

await fs.access(bundledOpenCodePath);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-hosted-ocix-functional-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const openCodeConfigDirectory = path.join(temporaryRoot, 'opencode-config');
const xdgConfigDirectory = path.join(temporaryRoot, 'xdg-config');
const xdgDataDirectory = path.join(temporaryRoot, 'xdg-data');
const xdgCacheDirectory = path.join(temporaryRoot, 'xdg-cache');
await Promise.all([
  fs.mkdir(dataDirectory, { recursive: true }),
  fs.mkdir(openCodeConfigDirectory, { recursive: true }),
  fs.mkdir(xdgConfigDirectory, { recursive: true }),
  fs.mkdir(xdgDataDirectory, { recursive: true }),
  fs.mkdir(xdgCacheDirectory, { recursive: true }),
  fs.rm(outputDirectory, { recursive: true, force: true }),
]);
await fs.mkdir(outputDirectory, { recursive: true });

for (const key of [
  'OPENCODE_HOST',
  'OPENCODE_PORT',
  'OPENCODE_SKIP_START',
  'OPENCHAMBER_SKIP_OPENCODE_START',
  'OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR',
]) {
  delete process.env[key];
}
Object.assign(process.env, {
  OPENCHAMBER_DATA_DIR: dataDirectory,
  OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
  OPENCHAMBER_OPENCODE_CWD: projectRoot,
  OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
  OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'false',
  OPENCHAMBER_RUNTIME: 'web',
  OPENCODE_BINARY: bundledOpenCodePath,
  OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
  OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
  OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  XDG_CONFIG_HOME: xdgConfigDirectory,
  XDG_DATA_HOME: xdgDataDirectory,
  XDG_CACHE_HOME: xdgCacheDirectory,
});

let crmApi;
let hostedRemote;
let openchamber;
let completed = false;
let failure;

try {
  const keys = generatePublisherKeyPair();
  crmApi = await startHybridCrmApi();
  hostedRemote = await startHostedRemote({ apiUrl: crmApi.url, keys });
  const initialRemote = hostedRemote.buildCurrent();
  const thinPackage = await createThinPackage({
    temporaryRoot,
    keys,
    manifestUrl: `${hostedRemote.url}/manifest.json`,
    initialPermissions: initialRemote.permissions,
  });
  const secretValues = Object.values(DEMO_KEYS);

  const { startWebUiServer } = await import('../packages/web/server/index.js');
  openchamber = await startWebUiServer({
    host: '127.0.0.1',
    port: 0,
    attachSignals: false,
    exitOnShutdown: false,
  });
  const baseUrl = `http://127.0.0.1:${openchamber.getPort()}`;
  const request = createClient(baseUrl, secretValues);

  await waitFor(async () => {
    const response = await request('/health');
    return response.status === 200 && response.payload?.openCodeRunning === true;
  }, 'managed bundled OpenCode readiness');

  const readTools = async () => {
    const result = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`);
    return result.status === 200 && Array.isArray(result.payload) ? result.payload : null;
  };
  const waitForTools = (expectedPresent, expectedAbsent = []) => waitFor(async () => {
    const tools = await readTools();
    if (!tools) return null;
    return expectedPresent.every((name) => tools.includes(name))
      && expectedAbsent.every((name) => !tools.includes(name))
      ? tools
      : null;
  }, `Agent Tool inventory (${expectedPresent.join(', ') || 'removed'})`);

  await waitForTools(['interactive_ui', 'html_artifact'], [
    fixture.viewTool,
    fixture.artifactTool,
    fixture.expandedTool,
  ]);

  const inspection = expectStatus(await request('/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64: thinPackage.buffer.toString('base64') },
  }), 200, 'inspect Hosted OCIX thin package');
  assert.equal(inspection.delivery, 'hosted');
  assert.equal(inspection.hosted.version, '2.0.0');
  assert.deepEqual(inspection.hosted.permissions.agentToolNames, [fixture.artifactTool, fixture.viewTool].sort());

  const missingHostedConfirmation = await request('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64: thinPackage.buffer.toString('base64'),
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    },
    timeoutMs: 60_000,
  });
  assert.equal(missingHostedConfirmation.status, 403);
  assert.equal(missingHostedConfirmation.payload.code, 'hosted_manifest_confirmation_required');

  const installed = expectStatus(await request('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64: thinPackage.buffer.toString('base64'),
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    },
    timeoutMs: 60_000,
  }), 201, 'install Hosted OCIX');
  assert.equal(installed.extension.activeVersion, '1.0.0');
  assert.equal(installed.extension.versions['1.0.0'].delivery, 'hosted');
  await waitForTools(['interactive_ui', 'html_artifact', fixture.viewTool, fixture.artifactTool], [fixture.expandedTool]);

  const registry = expectStatus(await request('/api/interactive-ui/extensions'), 200, 'Hosted OCIX registry');
  const registered = registry.extensions.find((extension) => extension.id === fixture.extensionId);
  assert.equal(registered.version, '2.0.0');
  assert.deepEqual(registered.views.map((view) => view.id), [fixture.viewId]);
  assert.deepEqual(registered.artifacts.map((artifact) => artifact.id), [fixture.artifactId]);

  const viewDescriptor = expectStatus(await request(
    `/api/interactive-ui/views/${fixture.viewId}?tool=${fixture.viewTool}`,
  ), 200, 'Hosted Interactive UI descriptor');
  assert.equal(viewDescriptor.declarative.id, fixture.viewId);
  assert.equal(viewDescriptor.declarative.title, 'Hosted CRM 2.0.0');

  const artifactDescriptor = expectStatus(await request(
    `/api/interactive-ui/installed-artifacts/${fixture.artifactId}?tool=${fixture.artifactTool}`,
  ), 200, 'Hosted HTML Artifact descriptor');
  assert.equal(artifactDescriptor.artifact.id, fixture.artifactId);
  assert.equal(artifactDescriptor.artifact.business, true);
  const artifactDocumentResponse = await fetch(`${baseUrl}${artifactDescriptor.documentPath}`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(artifactDocumentResponse.status, 200);
  const artifactDocument = await artifactDocumentResponse.text();
  assert.match(artifactDocument, /data-ocix-artifact-broker/);
  assert.match(artifactDocument, /host\.businessResult/);
  assertNoSecretMaterial(artifactDocument, 'Hosted Artifact broker', secretValues);

  const viewContext = {
    extensionId: fixture.extensionId,
    viewId: fixture.viewId,
    instanceId: 'hosted-functional-view',
    tool: { id: 'hosted-functional-view-tool', name: fixture.viewTool },
  };
  const artifactContext = {
    extensionId: fixture.extensionId,
    artifactId: fixture.artifactId,
    instanceId: 'hosted-functional-artifact',
    tool: { id: 'hosted-functional-artifact-tool', name: fixture.artifactTool },
  };
  const callAction = (actionId, context, input, confirmationToken) => request(
    `/api/interactive-ui/actions/${actionId}`,
    {
      method: 'POST',
      body: {
        ...context,
        input,
        ...(confirmationToken ? { confirmationToken } : {}),
      },
    },
  );
  const queryFromView = () => callAction(
    fixture.queryActionId,
    viewContext,
    { scope: 'default' },
  );
  const queryFromArtifact = () => callAction(
    fixture.queryActionId,
    artifactContext,
    { scope: 'default' },
  );

  const unconfigured = await queryFromView();
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.payload.code, 'connector_unconfigured');

  expectStatus(await request(
    `/api/interactive-ui/connections/${fixture.extensionId}/${fixture.connectorId}`,
    { method: 'PUT', body: { accessKey: DEMO_KEYS.full } },
  ), 200, 'configure Hosted CRM connection');
  expectStatus(await request(
    `/api/interactive-ui/connections/${fixture.extensionId}/${fixture.connectorId}/test`,
    { method: 'POST' },
  ), 200, 'test Hosted CRM connection');

  const viewData = expectStatus(await queryFromView(), 200, 'Hosted Interactive UI live query').data;
  const artifactData = expectStatus(await queryFromArtifact(), 200, 'Hosted Artifact live query').data;
  assert.equal(viewData.customerCount, 4);
  assert.equal(viewData.opportunities.length, 4);
  assert.equal(artifactData.customerCount, 4);
  assert(viewData.pipelineValue > 0);

  const writeInput = { opportunityId: 'OP-2001', revision: 4 };
  const confirmation = await callAction(fixture.writeActionId, artifactContext, writeInput);
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.payload.code, 'confirmation_required');
  const beforeWrite = expectStatus(await queryFromView(), 200, 'query after cancelled Hosted write').data;
  assert.equal(beforeWrite.opportunities.find((item) => item.id === 'OP-2001')?.revision, 4);
  const write = expectStatus(await callAction(
    fixture.writeActionId,
    artifactContext,
    writeInput,
    confirmation.payload.confirmationToken,
  ), 200, 'confirmed Hosted Artifact write').data;
  assert.equal(write.opportunity.revision, 5);
  const afterWrite = expectStatus(await queryFromView(), 200, 'query after Hosted write').data;
  assert.equal(afterWrite.opportunities.find((item) => item.id === 'OP-2001')?.revision, 5);

  hostedRemote.state.version = '2.0.1';
  const stableRefresh = expectStatus(await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}/hosted/refresh`,
    { method: 'POST', body: {}, timeoutMs: 60_000 },
  ), 200, 'permission-equivalent Hosted update');
  assert.equal(stableRefresh.fallback, false);
  assert.equal(stableRefresh.extension.versions['1.0.0'].hosted.lastGood.version, '2.0.1');
  const stableView = expectStatus(await request(
    `/api/interactive-ui/views/${fixture.viewId}?tool=${fixture.viewTool}`,
  ), 200, 'permission-equivalent Hosted view');
  assert.equal(stableView.declarative.title, 'Hosted CRM 2.0.1');

  hostedRemote.state.version = '2.1.0';
  hostedRemote.state.expanded = true;
  const expandedRefresh = await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}/hosted/refresh`,
    { method: 'POST', body: {}, timeoutMs: 60_000 },
  );
  assert.equal(expandedRefresh.status, 403);
  assert.equal(expandedRefresh.payload.code, 'hosted_permission_confirmation_required');
  assert.deepEqual(expandedRefresh.payload.addedPermissions.actionIds, [fixture.noteActionId]);
  assert.deepEqual(expandedRefresh.payload.addedPermissions.agentToolNames, [fixture.expandedTool]);
  assert.deepEqual(expandedRefresh.payload.addedPermissions.credentialScopes, ['crm.note.write']);
  assert.equal(expandedRefresh.payload.addedPermissions.popups, true);
  await waitForTools(
    ['interactive_ui', 'html_artifact', fixture.viewTool, fixture.artifactTool],
    [fixture.expandedTool],
  );

  const confirmedRefresh = expectStatus(await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}/hosted/refresh`,
    {
      method: 'POST',
      body: { confirmedManifestHash: expandedRefresh.payload.manifestHash },
      timeoutMs: 60_000,
    },
  ), 200, 'confirmed Hosted permission expansion');
  assert.equal(confirmedRefresh.fallback, false);
  assert.equal(confirmedRefresh.extension.versions['1.0.0'].hosted.lastGood.version, '2.1.0');
  await waitForTools([
    'interactive_ui',
    'html_artifact',
    fixture.viewTool,
    fixture.artifactTool,
    fixture.expandedTool,
  ]);

  hostedRemote.state.version = '2.2.0';
  hostedRemote.state.tamperResources = true;
  const integrityFallback = expectStatus(await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}/hosted/refresh`,
    { method: 'POST', body: {}, timeoutMs: 60_000 },
  ), 200, 'Hosted integrity fallback');
  assert.equal(integrityFallback.fallback, true);
  assert.equal(
    integrityFallback.extension.versions['1.0.0'].hosted.lastGood.version,
    '2.1.0',
  );
  assert.equal(
    integrityFallback.extension.versions['1.0.0'].hosted.lastError.code,
    'hosted_resource_integrity_failed',
  );
  const lastGoodView = expectStatus(await request(
    `/api/interactive-ui/views/${fixture.viewId}?tool=${fixture.viewTool}`,
  ), 200, 'last-good Hosted view after tamper');
  assert.equal(lastGoodView.declarative.title, 'Hosted CRM 2.1.0');

  hostedRemote.state.tamperResources = false;
  hostedRemote.state.available = false;
  const offlineFallback = expectStatus(await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}/hosted/refresh`,
    { method: 'POST', body: {}, timeoutMs: 60_000 },
  ), 200, 'Hosted offline fallback');
  assert.equal(offlineFallback.fallback, true);
  assert.equal(
    offlineFallback.extension.versions['1.0.0'].hosted.lastGood.version,
    '2.1.0',
  );
  assert.equal(
    offlineFallback.extension.versions['1.0.0'].hosted.lastError.code,
    'hosted_manifest_unavailable',
  );
  hostedRemote.state.available = true;

  const capabilities = expectStatus(
    await request('/api/interactive-ui/capabilities'),
    200,
    'Hosted capabilities',
  );
  assert.equal(JSON.stringify(capabilities).includes(crmApi.url), false);
  assert.equal(JSON.stringify(capabilities).includes(hostedRemote.url), false);
  assert.equal(
    capabilities.extensions.find((extension) => extension.id === fixture.extensionId)
      ?.tools.some((tool) => tool.name === fixture.expandedTool),
    true,
  );

  const uninstalled = expectStatus(await request(
    `/api/interactive-ui/manager/extensions/${fixture.extensionId}`,
    { method: 'DELETE', timeoutMs: 60_000 },
  ), 200, 'uninstall Hosted OCIX');
  assert.equal(uninstalled.removed, true);
  assert.equal(uninstalled.credentials.removed, 1);
  await waitForTools(['interactive_ui', 'html_artifact'], [
    fixture.viewTool,
    fixture.artifactTool,
    fixture.expandedTool,
  ]);
  const afterUninstall = expectStatus(
    await request('/api/interactive-ui/connections'),
    200,
    'connections after Hosted uninstall',
  );
  assert.equal(
    afterUninstall.connections.some((connection) => connection.extension.id === fixture.extensionId),
    false,
  );

  const report = {
    ok: true,
    runtime: 'full-server-real-http',
    isolation: {
      openChamberData: true,
      openCodeConfig: true,
      temporarySigningKeys: true,
      loopbackOnly: true,
    },
    delivery: {
      thinPackageSignature: 'passed',
      publisherConfirmation: 'passed',
      hostedManifestConfirmation: 'passed',
      resourceIntegrity: 'passed',
      generatedToolShim: [fixture.viewTool, fixture.artifactTool, fixture.expandedTool],
    },
    surfaces: {
      interactiveUI: 'resolved',
      htmlArtifact: 'resolved',
      broker: 'ready',
    },
    businessGateway: {
      customers: viewData.customerCount,
      opportunities: viewData.opportunities.length,
      artifactQuery: 'passed',
      confirmation: 'required',
      cancelledWritePreservedData: true,
      confirmedWrite: 'passed',
    },
    updates: {
      permissionEquivalent: 'automatic',
      permissionExpansion: 'confirmed',
      addedAction: fixture.noteActionId,
      addedTool: fixture.expandedTool,
      integrityFailure: 'last-good',
      offline: 'last-good',
      finalLastGoodVersion: '2.1.0',
    },
    uninstall: {
      agentRuntimeRemoved: true,
      credentialsRemoved: true,
    },
    secretScan: 'passed',
  };
  assertNoSecretMaterial(report, 'Hosted OCIX functional report', secretValues);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  completed = true;
} catch (error) {
  failure = error;
} finally {
  if (openchamber) await openchamber.stop().catch(() => undefined);
  if (hostedRemote) await hostedRemote.close().catch(() => undefined);
  if (crmApi) await crmApi.close().catch(() => undefined);
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => undefined);
  if (!completed) await fs.rm(reportPath, { force: true }).catch(() => undefined);
}

if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);
