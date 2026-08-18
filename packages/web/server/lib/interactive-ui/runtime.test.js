import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import { createInteractiveUIRuntime } from './runtime.js';
import { HOSTED_OCIX_MAX_MANIFEST_BYTES, HOSTED_OCIX_SIGNED_MANIFEST_FILE, canonicalStringify } from './hosted-ocix.js';

const temporaryDirectories = [];
const viewTool = { id: 'runtime-test-view-tool', name: 'crm_open' };
const artifactTool = { id: 'runtime-test-artifact-tool', name: 'crm_open_explorer' };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createFixture = async (fetchImpl, {
  headerName = 'X-API-Key',
  authType = 'api-key',
  routing = false,
  actionRisk = 'read',
  actionPermission = 'allow',
  actionPath = '/customers',
  networkPermissions = ['https://crm.example.com'],
  artifacts = false,
  views = true,
  dashboard = false,
  version = '1.0.0',
  baseUrl = 'https://crm.example.com/api/',
  environment = undefined,
  testable = true,
  now = undefined,
  healthTtlMs = undefined,
  prepareExtensionUse = undefined,
  getExtensionLifecycle = undefined,
} = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-auth-'));
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-auth-data-'));
  temporaryDirectories.push(root, dataDirectory);
  await fs.mkdir(path.join(root, 'ui'), { recursive: true });
  await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id: 'com.acme.crm',
    name: 'Acme CRM',
    ...(dashboard ? { shortName: 'CRM' } : {}),
    version,
    ...(routing ? {
      agentRouting: {
        domain: 'crm',
        intents: ['crm.overview', 'crm.pipeline.view'],
        examples: { en: ['show the pipeline'] },
        dataAuthority: 'connected-business-system',
      },
    } : {}),
    connectors: [{
      id: 'crm-api',
      type: 'http',
      baseUrl,
      auth: authType === 'issued-key'
        ? {
            type: 'issued-key',
            provisioningUrl: 'https://crm.example.com/.well-known/ocix/v1/credentials',
            placement: { type: 'header', name: headerName },
          }
        : {
            type: 'api-key',
            placement: { type: 'header', name: headerName },
          },
      ...(testable ? { test: { method: 'GET', path: '/health' } } : {}),
    }],
    views: views ? [{
      id: 'com.acme.crm.overview',
      runtime: 'declarative',
      entry: 'ui/view.json',
      tools: ['crm_open'],
      ...(dashboard ? {
        title: 'Customer list',
        dashboard: {
          inputSchema: {
            type: 'object',
            properties: { region: { type: 'string', enum: ['all', 'apac'] } },
            required: ['region'],
          },
          defaultContext: { region: 'all' },
          events: {
            emits: [{
              id: 'customer.selected',
              payloadSchema: {
                type: 'object',
                properties: { customerId: { type: 'string' } },
                required: ['customerId'],
              },
            }],
            accepts: [],
          },
          migrations: [{
            fromVersion: '^0.0.0',
            operations: [{ op: 'rename', from: 'territory', to: 'region' }],
          }],
        },
      } : {}),
      ...(routing ? { routing: { intents: ['crm.overview', 'crm.pipeline.view'], priority: 90, operation: 'read' } } : {}),
    }] : [],
    ...(artifacts ? {
      artifacts: [{
        id: 'com.acme.crm.explorer',
        title: 'CRM Explorer',
        entry: 'ui/explorer.html',
        tools: ['crm_open_explorer'],
        ...(routing ? { routing: { intents: ['crm.pipeline.view'], priority: 92, operation: 'read' } } : {}),
        displayModes: ['inline', 'workspace'],
        inlineHeight: 480,
        capabilities: { scripts: true, businessActions: ['com.acme.crm.query'] },
        ...(dashboard ? {
          dashboard: {
            inputSchema: {
              type: 'object',
              properties: { customerId: { type: 'string', minLength: 1 } },
              required: ['customerId'],
            },
            events: { emits: [], accepts: ['customer.selected'] },
          },
        } : {}),
      }],
    } : {}),
    ...(dashboard && artifacts ? {
      links: [{
        id: 'customer-list-to-detail',
        from: 'com.acme.crm.overview',
        event: 'customer.selected',
        to: 'com.acme.crm.explorer',
        map: { customerId: '$event.payload.customerId' },
        relationship: 'customer',
        placement: 'adjacent',
      }],
    } : {}),
    actions: [{
      id: 'com.acme.crm.query',
      connector: 'crm-api',
      risk: actionRisk,
      permission: actionPermission,
      request: { method: 'POST', path: actionPath },
      confirmation: { title: 'Confirm CRM change', description: 'Review the business change before sending it.' },
    }],
    permissions: { network: networkPermissions },
    trust: { mode: 'declarative', signature: 'test' },
  }));
  await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.crm.overview',
    layout: { type: 'text', value: 'CRM' },
  }));
  if (artifacts) {
    await fs.writeFile(path.join(root, 'ui', 'explorer.html'), '<!doctype html><html><body><button>Load</button><script>window.openchamber.business.query("com.acme.crm.query", {})</script></body></html>');
  }
  const connectionStore = createInteractiveUIConnectionStore({
    dataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    fetchImpl,
  });
  const runtime = createInteractiveUIRuntime({
    fsPromises: fs,
    path,
    crypto,
    fetchImpl,
    extensionRoots: [root],
    connectionStore,
    ...(environment ? { environment } : {}),
    ...(now ? { now } : {}),
    ...(healthTtlMs ? { healthTtlMs } : {}),
    ...(prepareExtensionUse ? { prepareExtensionUse } : {}),
    ...(getExtensionLifecycle ? { getExtensionLifecycle } : {}),
    logger: { info() {}, warn() {} },
  });
  return { runtime, root, dataDirectory };
};

describe('Interactive UI connector authentication', () => {
  it('keeps an extension catalogued when its endpoint environment variable is unset and activates a user endpoint without restart', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url, init) => {
      upstream.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, {
      baseUrl: '${OCIX_CRM_API_URL}',
      networkPermissions: ['${OCIX_CRM_API_URL}'],
      environment: {},
    });

    expect((await runtime.getWorkbenchCatalog()).extensions).toHaveLength(1);
    expect((await runtime.listConnections()).connections[0]).toMatchObject({
      credential: {
        configured: false,
        endpointConfigured: false,
        endpoint: null,
      },
    });

    await runtime.configureConnection('com.acme.crm', 'crm-api', {
      accessKey: 'crm-secret',
      endpoint: 'http://127.0.0.1:51810/api/',
      headers: { 'X-Tenant-ID': 'acme' },
    });
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(upstream[0].url).toBe('http://127.0.0.1:51810/api/health');
    expect(upstream[0].init.headers.get('X-Tenant-ID')).toBe('acme');
    expect(upstream[0].init.headers.get('X-API-Key')).toBe('crm-secret');
    expect((await runtime.listConnections()).connections[0]).toMatchObject({
      credential: {
        configured: true,
        endpointSource: 'user',
        endpoint: 'http://127.0.0.1:51810/api/',
      },
    });
  });

  it('publishes a redacted routing context and updates connector availability', async () => {
    const { runtime } = await createFixture(async () => new Response(JSON.stringify({ ok: true })), { routing: true });
    const before = await runtime.getRoutingCapabilities();
    expect(before.extensions[0]).toMatchObject({
      id: 'com.acme.crm',
      connection: { required: true, status: 'unconfigured' },
    });
    expect(before.system).toContain('tool=crm_open');
    expect(before.system).not.toContain('crm.example.com');
    expect(before.system).not.toContain('show the pipeline');

    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'routing-secret' });
    const after = await runtime.getRoutingCapabilities();
    expect(after.extensions[0].connection.status).toBe('configured');
    expect(after.revision).not.toBe(before.revision);
    expect(JSON.stringify(after)).not.toContain('routing-secret');
  });

  it('keeps API keys out of management responses and injects them only in upstream requests', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url, init) => {
      upstream.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const before = await runtime.listConnections();
    expect(before.connections[0].credential.configured).toBe(false);
    expect(before.connections[0].health).toEqual({ status: 'unknown', checkedAt: null });
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({ code: 'connector_unconfigured' });

    const configured = await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'crm-secret' });
    expect(JSON.stringify(configured)).not.toContain('crm-secret');
    expect(JSON.stringify(await runtime.listConnections())).not.toContain('crm-secret');

    expect((await runtime.testConnection('com.acme.crm', 'crm-api')).ok).toBe(true);
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'reachable',
      checkedAt: expect.any(String),
    });
    await runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    });
    expect(upstream).toHaveLength(2);
    expect(upstream[0].init.headers.get('X-API-Key')).toBe('crm-secret');
    expect(upstream[1].init.headers.get('X-API-Key')).toBe('crm-secret');
  });

  it('loads an installed HTML Artifact and brokers only its declared business actions', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url, init) => {
      upstream.push({ url: String(url), init });
      return new Response(JSON.stringify({ customers: 4 }), { status: 200 });
    }, { artifacts: true, routing: true });

    const descriptor = await runtime.getInstalledArtifactDescriptor('com.acme.crm.explorer', 'crm_open_explorer');
    expect(descriptor).toMatchObject({
      extension: { id: 'com.acme.crm' },
      artifact: {
        id: 'com.acme.crm.explorer',
        inlineHeight: 480,
        scripts: true,
        business: true,
      },
    });
    const document = await runtime.getInstalledArtifactDocument('com.acme.crm', 'com.acme.crm.explorer');
    expect(document.source).toContain('Object.defineProperty(window,"openchamber"');
    expect(document.source).toContain("connect-src 'none'");
    expect(document.source).not.toContain('crm-secret');

    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'crm-secret' });
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      artifactId: 'com.acme.crm.explorer',
      instanceId: 'artifact-instance',
      tool: artifactTool,
      input: { stage: 'qualified' },
    })).resolves.toMatchObject({ data: { customers: 4 } });
    // The first action runs the required cached/coalesced connector test
    // (the connector declares one), then the real business request.
    expect(upstream[0].url).toBe('https://crm.example.com/api/health');
    expect(upstream[0].init.headers.get('X-API-Key')).toBe('crm-secret');
    expect(upstream[1].init.headers.get('X-API-Key')).toBe('crm-secret');
    await expect(runtime.invokeAction('com.acme.crm.undeclared', {
      extensionId: 'com.acme.crm',
      artifactId: 'com.acme.crm.explorer',
      instanceId: 'artifact-instance',
      tool: artifactTool,
      input: {},
    })).rejects.toMatchObject({ code: 'action_not_allowed' });
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      artifactId: 'com.acme.crm.explorer',
      instanceId: 'forged-artifact-instance',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({ code: 'tool_artifact_mismatch', status: 403 });
    expect(upstream).toHaveLength(2);
  });

  it('accepts an Artifact-only OCIX extension', async () => {
    const { runtime } = await createFixture(async () => new Response('{}'), {
      artifacts: true,
      views: false,
      routing: true,
    });
    const registry = await runtime.listExtensions();
    expect(registry.errors).toEqual([]);
    expect(registry.extensions[0].views).toEqual([]);
    expect(registry.extensions[0].artifacts.map((artifact) => artifact.id)).toEqual(['com.acme.crm.explorer']);
    expect((await runtime.getRoutingCapabilities()).extensions[0].tools[0]).toMatchObject({
      name: 'crm_open_explorer',
      forms: ['html-artifact'],
    });
  });

  it('publishes a normalized Workbench catalog without weakening Tool-bound descriptors', async () => {
    const { runtime } = await createFixture(async () => new Response('{}'), {
      artifacts: true,
      routing: true,
      dashboard: true,
    });
    const catalog = await runtime.getWorkbenchCatalog();
    expect(catalog.errors).toEqual([]);
    expect(catalog.extensions[0]).toMatchObject({
      id: 'com.acme.crm',
      shortName: 'CRM',
      links: [{ id: 'customer-list-to-detail' }],
      surfaces: [
        {
          surfaceId: 'com.acme.crm.overview',
          form: 'interactive-ui',
          title: 'Customer list',
          manualLaunch: { enabled: true },
        },
        {
          surfaceId: 'com.acme.crm.explorer',
          form: 'html-artifact',
          manualLaunch: { enabled: false, missingRequiredPaths: ['customerId'] },
        },
      ],
    });

    await expect(runtime.getViewDescriptor('com.acme.crm.overview'))
      .rejects.toMatchObject({ code: 'tool_view_mismatch' });
    await expect(runtime.getViewDescriptor('com.acme.crm.overview', '', { launchSource: 'workbench' }))
      .resolves.toMatchObject({
        view: {
          id: 'com.acme.crm.overview',
          title: 'Customer list',
          dashboard: { manualLaunch: { enabled: true } },
        },
      });
    await expect(runtime.prepareWorkbenchTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.overview',
      },
      form: 'interactive-ui',
      context: { region: 'all', undeclared: 'removed' },
    })).resolves.toMatchObject({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.overview',
        compatibleVersion: '^1.0.0',
      },
      context: { region: 'all' },
      layout: { column: 0, row: 0, columns: 6, rows: 4 },
      contextDigest: expect.stringMatching(/^sha256-/),
    });
    await expect(runtime.prepareWorkbenchTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.explorer',
      },
      form: 'html-artifact',
      context: {},
    })).rejects.toMatchObject({
      code: 'invalid_dashboard_contract',
      status: 400,
    });

    await expect(runtime.migrateWorkbenchTile({
      tileId: 'tile-legacy',
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.overview',
        compatibleVersion: '^0.0.0',
      },
      form: 'interactive-ui',
      context: { territory: 'apac' },
      layout: { column: 9, row: 2, columns: 3, rows: 2 },
      displayMode: 'tile',
      relationship: null,
      origin: null,
    })).resolves.toMatchObject({
      tileId: 'tile-legacy',
      source: { compatibleVersion: '^1.0.0' },
      context: { region: 'apac' },
      layout: { column: 8, row: 2, columns: 4, rows: 3 },
    });
  });

  it('maps third-party 401 and 403 responses without implementing business permissions', async () => {
    let status = 401;
    const { runtime } = await createFixture(async () => new Response(JSON.stringify({ error: 'denied by CRM' }), { status }));
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });

    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true })).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unauthorized');
    status = 403;
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true })).rejects.toMatchObject({ code: 'connector_forbidden', status: 403 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('forbidden');
    // invokeAction requires a cached/coalesced connector test before any
    // business request: the fresh 403 evidence blocks the action with the
    // SAME actionable error and sends zero business requests.
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({
      code: 'connector_forbidden',
      status: 403,
      message: 'Access key does not have permission',
    });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('forbidden');
  });

  it('maps other failed action responses to unreachable health while preserving their status', async () => {
    let status = 409;
    const { runtime } = await createFixture(async () => new Response(JSON.stringify({ error: 'conflict' }), { status }), {
      testable: false,
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });

    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 409,
      message: 'Business system rejected the request (409)',
    });
    // A failing response is never labeled reachable.
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unreachable');
  });

  it('exchanges an issued-key setup code on the server and exposes status only', async () => {
    const calls = [];
    const { runtime } = await createFixture(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/.well-known/')) {
        return new Response(JSON.stringify({
          $schema: 'openchamber://credential-response/v1',
          credentialType: 'api-key',
          accessKey: 'server-issued-secret',
          display: { name: 'CRM sales scope' },
        }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }, { authType: 'issued-key' });

    const result = await runtime.provisionConnection('com.acme.crm', 'crm-api', { setupCode: 'single-use-code' });
    expect(result.credential).toMatchObject({ configured: true, source: 'provisioned', displayName: 'CRM sales scope' });
    const publicSnapshot = JSON.stringify(await runtime.listConnections());
    expect(publicSnapshot).not.toContain('server-issued-secret');
    expect(publicSnapshot).not.toContain('single-use-code');
    expect(publicSnapshot).not.toContain('.well-known');

    await runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    });
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      $schema: 'openchamber://credential-request/v1',
      setupCode: 'single-use-code',
    });
    expect(calls[1].init.headers.get('X-API-Key')).toBe('server-issued-secret');
  });

  it('rejects unsafe credential headers during manifest validation with sanitized public errors', async () => {
    const { runtime } = await createFixture(async () => new Response('{}'), { headerName: 'Cookie' });
    const registry = await runtime.listExtensions();
    expect(registry.extensions).toEqual([]);
    // Public load errors carry only a stable code + fixed message, never the
    // manifest path or raw filesystem/validator text.
    expect(registry.errors[0]).toMatchObject({ code: 'invalid_manifest', message: 'Extension could not be loaded' });
    expect(JSON.stringify(registry.errors)).not.toContain('unsafe credential header');
    expect(JSON.stringify(registry.errors)).not.toContain('/');
  });

  it('rejects cross-extension action contexts before contacting the business system', async () => {
    let upstreamCalls = 0;
    const { runtime } = await createFixture(async () => {
      upstreamCalls += 1;
      return new Response('{}');
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });

    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.attacker.extension',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({ code: 'extension_view_mismatch', status: 403 });
    await expect(runtime.invokeAction('com.attacker.delete', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({ code: 'action_not_allowed', status: 403 });
    expect(upstreamCalls).toBe(0);
  });

  it('requires explicit confirmation for ask actions and enforces deny without an upstream request', async () => {
    let askCalls = 0;
    // No connector test declared: every upstream call IS a business request,
    // so the counters below prove ask/deny send zero unauthorized requests.
    const { runtime: askRuntime } = await createFixture(async () => {
      askCalls += 1;
      return new Response(JSON.stringify({ ok: true }));
    }, { actionRisk: 'write', actionPermission: 'ask', testable: false });
    await askRuntime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });
    const actionContext = { extensionId: 'com.acme.crm', viewId: 'com.acme.crm.overview', tool: viewTool, input: { stage: 'won' } };

    let confirmationToken;
    await expect(askRuntime.invokeAction('com.acme.crm.query', actionContext)).rejects.toMatchObject({
      code: 'confirmation_required',
      status: 409,
      details: {
        confirmationRequired: true,
        confirmationToken: expect.any(String),
        confirmationExpiresAt: expect.any(Number),
      },
    });
    try {
      await askRuntime.invokeAction('com.acme.crm.query', actionContext);
    } catch (error) {
      confirmationToken = error.details.confirmationToken;
    }
    expect(askCalls).toBe(0);
    await expect(askRuntime.invokeAction('com.acme.crm.query', { ...actionContext, confirmationToken }))
      .resolves.toMatchObject({ data: { ok: true } });
    expect(askCalls).toBe(1);
    await expect(askRuntime.invokeAction('com.acme.crm.query', { ...actionContext, confirmationToken }))
      .rejects.toMatchObject({ code: 'confirmation_required', status: 409 });

    let denyCalls = 0;
    const { runtime: denyRuntime } = await createFixture(async () => {
      denyCalls += 1;
      return new Response('{}');
    }, { actionRisk: 'destructive', actionPermission: 'deny', testable: false });
    await denyRuntime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });
    await expect(denyRuntime.invokeAction('com.acme.crm.query', { ...actionContext, confirmationToken: 'not-used' }))
      .rejects.toMatchObject({ code: 'action_denied', status: 403 });
    expect(denyCalls).toBe(0);
  });

  it('rejects undeclared network origins and connector-escaping action paths at manifest load', async () => {
    const { runtime: missingNetworkPermission } = await createFixture(async () => new Response('{}'), {
      networkPermissions: [],
    });
    const missingPermissionRegistry = await missingNetworkPermission.listExtensions();
    expect(missingPermissionRegistry.extensions).toEqual([]);
    // Public load errors: allow-shaped stable code + fixed message only.
    expect(missingPermissionRegistry.errors[0]).toMatchObject({
      code: 'network_not_allowed',
      message: 'Extension could not be loaded',
    });
    expect(JSON.stringify(missingPermissionRegistry.errors)).not.toContain('not declared in permissions.network');

    const { runtime: escapingAction } = await createFixture(async () => new Response('{}'), {
      actionPath: '/../admin',
    });
    const escapingActionRegistry = await escapingAction.listExtensions();
    expect(escapingActionRegistry.extensions).toEqual([]);
    expect(escapingActionRegistry.errors[0]).toMatchObject({
      code: expect.stringMatching(/^[a-z0-9_]+$/),
      message: 'Extension could not be loaded',
    });
    expect(JSON.stringify(escapingActionRegistry.errors)).not.toContain('fixed connector-relative path');
  });
});

describe('Interactive UI runtime Remote lazy resolution', () => {
  const declarativeBytes = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.remote.overview',
    layout: { type: 'text', value: 'Remote' },
  }));
  const nativeBytes = Buffer.from('export const extension = () => null;\n');
  const artifactBytes = Buffer.from('<!doctype html><html><body><button>Load</button><script>document.body.dataset.ready="true"</script></body></html>');
  const iconSvgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const iconPngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(4),
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from([0, 0, 0, 8]),
  ]);

  // A Remote shell: manifest (and host-managed Agent Runtime) exist on disk,
  // but every runtime resource entry is missing — the lazy resolver supplies
  // them exactly as the manager-owned Remote cache does.
  const createRemoteShellRoot = async ({ iconEntry = 'ui/icon.svg' } = {}) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-remote-shell-'));
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '1.0.0',
      icon: iconEntry,
      agentRouting: {
        domain: 'remote',
        intents: ['remote.overview', 'remote.dashboard', 'remote.explore'],
        examples: { en: ['Open Acme Remote'] },
        dataAuthority: 'user-provided',
      },
      connectors: [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
      }],
      views: [
        {
          id: 'com.acme.remote.overview',
          runtime: 'declarative',
          entry: 'ui/view.json',
          tools: ['remote_open'],
          routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
          displayModes: ['inline', 'workspace'],
        },
        {
          id: 'com.acme.remote.dashboard',
          runtime: 'native',
          entry: 'ui/native.mjs',
          tools: ['remote_dashboard'],
          routing: { intents: ['remote.dashboard'], priority: 81, operation: 'read' },
          displayModes: ['inline', 'workspace'],
        },
      ],
      artifacts: [{
        id: 'com.acme.remote.explorer',
        title: 'Remote Explorer',
        entry: 'ui/artifact.html',
        tools: ['remote_explore'],
        routing: { intents: ['remote.explore'], priority: 82, operation: 'read' },
        displayModes: ['inline', 'workspace'],
        inlineHeight: 420,
        capabilities: { scripts: true, businessActions: [] },
      }],
      actions: [],
      permissions: { network: ['https://api.example.com'] },
      trust: { mode: 'native-code', signature: 'production' },
    }));
    return root;
  };

  const createRemoteRuntime = async ({
    resolveExtensionResource,
    root,
    fsImpl = fs,
  }) => {
    const shellRoot = root ?? await createRemoteShellRoot();
    return {
      runtime: createInteractiveUIRuntime({
        fsPromises: fsImpl,
        path,
        crypto,
        fetchImpl: async () => {
          throw new Error('runtime fetch must not be used for Remote resources');
        },
        extensionRoots: [shellRoot],
        resolveExtensionResource,
        logger: { info() {}, warn() {} },
      }),
    };
  };

  const defaultResolver = (calls) => async (extensionId, entry) => {
    calls.push([extensionId, entry]);
    const bytes = {
      'ui/view.json': declarativeBytes,
      'ui/native.mjs': nativeBytes,
      'ui/artifact.html': artifactBytes,
      'ui/icon.svg': iconSvgBytes,
    }[entry];
    return bytes ?? null;
  };

  it('resolves a missing-on-disk declarative view through the resolver and keeps the existing semantic validation', async () => {
    const calls = [];
    const { runtime } = await createRemoteRuntime({ resolveExtensionResource: defaultResolver(calls) });

    const descriptor = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(descriptor.view.runtime).toBe('declarative');
    expect(descriptor.declarative).toMatchObject({ $schema: 'openchamber://declarative-view/v1' });
    expect(calls).toEqual([['com.acme.remote', 'ui/view.json']]);

    // The existing semantic validation still applies after resolution: invalid
    // JSON is rejected, and so is a definition that does not match the view.
    const invalid = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.from('{not json'),
    });
    await expect(invalid.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'invalid_json', status: 400 });
    const mismatched = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.from(JSON.stringify({
        $schema: 'openchamber://declarative-view/v1',
        id: 'com.acme.remote.other',
        layout: { type: 'text', value: 'x' },
      })),
    });
    await expect(mismatched.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'invalid_view', status: 400 });
  });

  it('resolves missing-on-disk native bundles (descriptor and asset route) through the resolver with size checks', async () => {
    const calls = [];
    const { runtime } = await createRemoteRuntime({ resolveExtensionResource: defaultResolver(calls) });

    const descriptor = await runtime.getViewDescriptor('com.acme.remote.dashboard', 'remote_dashboard');
    expect(descriptor.view.runtime).toBe('native');
    expect(descriptor.native.integrity).toBe(
      `sha256-${crypto.createHash('sha256').update(nativeBytes).digest('base64')}`,
    );
    const bundle = await runtime.getNativeBundle('com.acme.remote', 'com.acme.remote.dashboard');
    expect(bundle.source).toBe(nativeBytes.toString('utf8'));
    expect(bundle.integrity).toBe(descriptor.native.integrity);
    expect(calls).toEqual([
      ['com.acme.remote', 'ui/native.mjs'],
      ['com.acme.remote', 'ui/native.mjs'],
    ]);

    // The existing native bundle size limit still applies after resolution.
    const oversize = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(oversize.runtime.getViewDescriptor('com.acme.remote.dashboard', 'remote_dashboard'))
      .rejects.toMatchObject({ code: 'entry_too_large', status: 413 });
  });

  it('resolves missing-on-disk HTML Artifacts (descriptor and document) through the resolver with semantic validation', async () => {
    const calls = [];
    const { runtime } = await createRemoteRuntime({ resolveExtensionResource: defaultResolver(calls) });

    const descriptor = await runtime.getInstalledArtifactDescriptor('com.acme.remote.explorer', 'remote_explore');
    expect(descriptor.artifact.title).toBe('Remote Explorer');
    expect(descriptor.integrity).toBe(
      `sha256-${crypto.createHash('sha256').update(artifactBytes).digest('base64')}`,
    );
    const document = await runtime.getInstalledArtifactDocument('com.acme.remote', 'com.acme.remote.explorer');
    expect(document.source).toContain('openchamberArtifact');
    expect(calls).toEqual([
      ['com.acme.remote', 'ui/artifact.html'],
      ['com.acme.remote', 'ui/artifact.html'],
    ]);

    // The existing HTML hardening still applies after resolution.
    const invalidHtml = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.from('<script>fetch("https://evil.example.com")</script>'),
    });
    await expect(invalidHtml.runtime.getInstalledArtifactDescriptor('com.acme.remote.explorer', 'remote_explore'))
      .rejects.toMatchObject({ code: 'prohibited_artifact_capability' });
  });

  it('resolves missing-on-disk SVG and PNG icons through the resolver with existing validation', async () => {
    const calls = [];
    const { runtime } = await createRemoteRuntime({ resolveExtensionResource: defaultResolver(calls) });

    const icon = await runtime.getExtensionIcon('com.acme.remote');
    expect(icon.content).toEqual(iconSvgBytes);
    expect(icon.contentType).toBe('image/svg+xml');
    expect(calls).toEqual([['com.acme.remote', 'ui/icon.svg']]);

    // PNG icons pass the existing signature/dimension validation.
    const pngRuntime = await createRemoteRuntime({
      root: await createRemoteShellRoot({ iconEntry: 'ui/icon.png' }),
      resolveExtensionResource: async () => iconPngBytes,
    });
    const png = await pngRuntime.runtime.getExtensionIcon('com.acme.remote');
    expect(png.contentType).toBe('image/png');
    expect(png.content).toEqual(iconPngBytes);

    // Active/external SVG content is rejected after resolution.
    const activeSvg = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await expect(activeSvg.runtime.getExtensionIcon('com.acme.remote'))
      .rejects.toMatchObject({ code: 'invalid_extension_icon', status: 400 });

    // The existing icon size limit still applies after resolution.
    const oversize = await createRemoteRuntime({
      resolveExtensionResource: async () => Buffer.alloc(256 * 1024 + 1),
    });
    await expect(oversize.runtime.getExtensionIcon('com.acme.remote'))
      .rejects.toMatchObject({ code: 'entry_too_large', status: 413 });
  });

  it('consults the resolver first and falls back to disk only when it returns null (authorized Local only)', async () => {
    const calls = [];
    const resolver = async (extensionId, entry) => {
      calls.push([extensionId, entry]);
      return null; // authorized current Local: authoritative null -> exact disk path.
    };
    const { root } = await createFixture(async () => new Response('{}'), { artifacts: true });
    const diskRuntime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: async () => new Response('{}'),
      extensionRoots: [root],
      resolveExtensionResource: resolver,
      logger: { info() {}, warn() {} },
    });
    await expect(diskRuntime.getViewDescriptor('com.acme.crm.overview', 'crm_open')).resolves.toMatchObject({
      view: { runtime: 'declarative' },
    });
    await expect(diskRuntime.getInstalledArtifactDescriptor('com.acme.crm.explorer', 'crm_open_explorer'))
      .resolves.toMatchObject({ artifact: { title: 'CRM Explorer' } });
    // The resolver is authoritative and was consulted for every entry kind
    // (declarative view, artifact descriptor); it returned null without any
    // remote fetch/cache and disk bytes were served.
    expect(calls).toEqual([
      ['com.acme.crm', 'ui/view.json'],
      ['com.acme.crm', 'ui/explorer.html'],
    ]);
    // A fixture without an icon still fails at the manifest level as before.
    await expect(diskRuntime.getExtensionIcon('com.acme.crm')).rejects.toMatchObject({ code: 'asset_not_found' });
  });

  it('ignores disk-present malicious files in favor of authoritative resolver bytes', async () => {
    // A Remote shell whose runtime entries EXIST on disk with hostile content:
    // the resolver is authoritative, so its verified bytes win over disk and
    // an inserted file/symlink can never serve unverified bytes.
    const calls = [];
    const resolver = async (extensionId, entry) => {
      calls.push([extensionId, entry]);
      return {
        'ui/view.json': declarativeBytes,
        'ui/native.mjs': nativeBytes,
        'ui/artifact.html': artifactBytes,
        'ui/icon.svg': iconSvgBytes,
      }[entry] ?? null;
    };
    const shellRoot = await createRemoteShellRoot();
    // Disk-present hostile versions of every resource kind.
    await fs.mkdir(path.join(shellRoot, 'ui'), { recursive: true });
    await fs.writeFile(path.join(shellRoot, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.evil',
      layout: { type: 'text', value: 'evil' },
    }));
    await fs.writeFile(path.join(shellRoot, 'ui', 'native.mjs'), 'export const extension = () => { throw new Error("evil native executed"); };\n');
    await fs.writeFile(path.join(shellRoot, 'ui', 'artifact.html'), '<script>fetch("https://evil.example.com")</script>');
    await fs.writeFile(path.join(shellRoot, 'ui', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { runtime } = await createRemoteRuntime({ root: shellRoot, resolveExtensionResource: resolver });

    // Declarative view: resolver bytes win over the disk-present evil file.
    const descriptor = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(descriptor.declarative).toMatchObject({ $schema: 'openchamber://declarative-view/v1', id: 'com.acme.remote.overview' });
    // Native bundle: resolver bytes win over the disk-present evil bundle.
    const native = await runtime.getViewDescriptor('com.acme.remote.dashboard', 'remote_dashboard');
    expect(native.native.integrity).toBe(
      `sha256-${crypto.createHash('sha256').update(nativeBytes).digest('base64')}`,
    );
    const bundle = await runtime.getNativeBundle('com.acme.remote', 'com.acme.remote.dashboard');
    expect(bundle.source).toBe(nativeBytes.toString('utf8'));
    // Installed HTML Artifact: resolver bytes win over the disk-present evil file.
    const artifact = await runtime.getInstalledArtifactDescriptor('com.acme.remote.explorer', 'remote_explore');
    expect(artifact.integrity).toBe(
      `sha256-${crypto.createHash('sha256').update(artifactBytes).digest('base64')}`,
    );
    // Icon: resolver bytes win over the disk-present active-SVG file.
    const icon = await runtime.getExtensionIcon('com.acme.remote');
    expect(icon.content).toEqual(iconSvgBytes);
    expect(calls).toEqual([
      ['com.acme.remote', 'ui/view.json'],
      ['com.acme.remote', 'ui/native.mjs'],
      ['com.acme.remote', 'ui/native.mjs'],
      ['com.acme.remote', 'ui/artifact.html'],
      ['com.acme.remote', 'ui/icon.svg'],
    ]);
  });

  it('fails sanitized instead of serving disk when the resolver throws with a disk-present file', async () => {
    const shellRoot = await createRemoteShellRoot();
    // A disk-present file that WOULD be loadable if disk-first were used.
    await fs.mkdir(path.join(shellRoot, 'ui'), { recursive: true });
    await fs.writeFile(path.join(shellRoot, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'disk-present' },
    }));
    const { runtime } = await createRemoteRuntime({
      root: shellRoot,
      resolveExtensionResource: async () => {
        const error = new Error('secret upstream detail: /var/lib/openchamber/secrets/key.txt');
        error.code = 'hosted_resource_integrity_failed';
        error.status = 403;
        throw error;
      },
    });
    // The resolver is authoritative: its failure is a stable sanitized error
    // and the disk-present file is NEVER served.
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'hosted_resource_integrity_failed', status: 403 });
    try {
      await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    } catch (error) {
      expect(error.message).toBe('Remote extension resource is unavailable');
      expect(error.message).not.toContain('secret upstream detail');
      expect(error.message).not.toContain('/var/lib/openchamber');
    }
    // Native and icon entries are equally protected: resolver failure never
    // falls back to a disk-present file.
    const failingResolver = async () => {
      const error = new Error('raw failure');
      error.code = 'hosted_resource_unavailable';
      error.status = 502;
      throw error;
    };
    const { runtime: nativeRuntime } = await createRemoteRuntime({
      root: await createRemoteShellRoot(),
      resolveExtensionResource: failingResolver,
    });
    await expect(nativeRuntime.getViewDescriptor('com.acme.remote.dashboard', 'remote_dashboard'))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable', status: 502 });
    await expect(nativeRuntime.getExtensionIcon('com.acme.remote'))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable', status: 502 });
  });

  it('preserves the non-Remote missing-file failure when the resolver is absent or returns null', async () => {
    const { runtime: noResolver } = await createRemoteRuntime({});
    await expect(noResolver.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const { runtime: nullResolver } = await createRemoteRuntime({
      resolveExtensionResource: async () => null,
    });
    await expect(nullResolver.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('turns resolver failures into a stable sanitized runtime error', async () => {
    const { runtime } = await createRemoteRuntime({
      resolveExtensionResource: async () => {
        const error = new Error('secret upstream detail: /var/lib/openchamber/secrets/key.txt');
        error.code = 'hosted_resource_integrity_failed';
        error.status = 403;
        throw error;
      },
    });
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({
        code: 'hosted_resource_integrity_failed',
        status: 403,
      });
    try {
      await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    } catch (error) {
      expect(error.message).toBe('Remote extension resource is unavailable');
      expect(error.message).not.toContain('secret upstream detail');
      expect(error.message).not.toContain('/var/lib/openchamber');
    }

    // Failures without a stable code/status collapse to the generic code.
    const { runtime: generic } = await createRemoteRuntime({
      resolveExtensionResource: async () => {
        throw new Error('raw failure');
      },
    });
    await expect(generic.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'remote_resource_unavailable', status: 502 });
  });

  it('captures the authority extensionHash as the canonical hash of the parsed manifest document (key-order/whitespace invariant)', async () => {
    // The authority hash must be the TRUE canonical JSON digest of the parsed
    // pre-normalization document: key order and whitespace differences in the
    // shell manifest cannot change it (and never leak into responses).
    const reverseKeys = (value) => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort().reverse()) out[key] = reverseKeys(value[key]);
        return out;
      }
      return value;
    };
    const canonicalHashOf = (text) => `sha256-${crypto.createHash('sha256').update(
      Buffer.from(canonicalStringify(JSON.parse(text))),
    ).digest('base64')}`;

    const shellRoot = await createRemoteShellRoot();
    const originalText = await fs.readFile(path.join(shellRoot, 'openchamber.extension.json'), 'utf8');
    const canonicalHash = canonicalHashOf(originalText);

    // Rewrite the same manifest with reversed key order and compact
    // whitespace: semantically identical, different bytes.
    const reorderedText = JSON.stringify(reverseKeys(JSON.parse(originalText)));
    expect(reorderedText).not.toBe(originalText);
    expect(canonicalHashOf(reorderedText)).toBe(canonicalHash);
    await fs.writeFile(path.join(shellRoot, 'openchamber.extension.json'), reorderedText);

    let forwarded;
    const { runtime } = await createRemoteRuntime({
      root: shellRoot,
      resolveExtensionResource: async (extensionId, entry, authority) => {
        forwarded = authority;
        return null; // disk fallback (the entry is missing on disk)
      },
    });
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(forwarded).toBeTruthy();
    // The forwarded authority hash is the canonical hash of the captured
    // parsed document and is invariant to key order/whitespace.
    expect(forwarded.extensionHash).toBe(canonicalHash);
    expect(forwarded.extensionHash).toBe(canonicalHashOf(reorderedText));
    expect(forwarded.directory).toBe(shellRoot);
  });

  it('captures the sibling signed-manifest hash only through a bounded single open handle (oversized/symlinked/shrunk fail closed)', async () => {
    // A forwarding resolver that records the captured authority and falls back
    // to disk (the entries are missing), so we can inspect what was captured.
    const capturingResolver = (captured) => async (extensionId, entry, authority) => {
      captured.push(authority);
      return null;
    };
    const shaOf = async (filePath) => `sha256-${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('base64')}`;

    // Valid sibling: the exact digest is forwarded.
    {
      const captured = [];
      const shellRoot = await createRemoteShellRoot();
      const signedPath = path.join(shellRoot, HOSTED_OCIX_SIGNED_MANIFEST_FILE);
      await fs.writeFile(signedPath, Buffer.from('{"valid":true}'));
      const { runtime } = await createRemoteRuntime({
        root: shellRoot,
        resolveExtensionResource: capturingResolver(captured),
      });
      await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(captured[0].signedManifestHash).toBe(await shaOf(signedPath));
    }

    // Oversized sibling (> 2 MiB): never allocated/read; capture is null.
    {
      const captured = [];
      const shellRoot = await createRemoteShellRoot();
      const signedPath = path.join(shellRoot, HOSTED_OCIX_SIGNED_MANIFEST_FILE);
      const handle = await fs.open(signedPath, 'w');
      await handle.truncate(HOSTED_OCIX_MAX_MANIFEST_BYTES + 1);
      await handle.close();
      const { runtime } = await createRemoteRuntime({
        root: shellRoot,
        resolveExtensionResource: capturingResolver(captured),
      });
      await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(captured[0].signedManifestHash).toBeNull();
    }

    // Symlinked sibling: never followed; capture is null and the target is
    // untouched.
    {
      const captured = [];
      const shellRoot = await createRemoteShellRoot();
      const signedPath = path.join(shellRoot, HOSTED_OCIX_SIGNED_MANIFEST_FILE);
      const outside = path.join(shellRoot, 'outside-signed.json');
      await fs.writeFile(outside, Buffer.from('{"outside":true}'));
      await fs.symlink(outside, signedPath);
      const { runtime } = await createRemoteRuntime({
        root: shellRoot,
        resolveExtensionResource: capturingResolver(captured),
      });
      await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(captured[0].signedManifestHash).toBeNull();
      await expect(fs.stat(outside)).resolves.toBeTruthy();
    }

    // Shrunk-under-open (short read): the single-handle read fails closed with
    // null instead of hashing a partial prefix.
    {
      const captured = [];
      const shellRoot = await createRemoteShellRoot();
      await fs.writeFile(path.join(shellRoot, HOSTED_OCIX_SIGNED_MANIFEST_FILE), Buffer.from('{"valid":true}'));
      const fsImpl = {
        ...fs,
        async open(target, flags, mode) {
          const handle = await fs.open(target, flags, mode);
          if (String(target).includes(HOSTED_OCIX_SIGNED_MANIFEST_FILE)) {
            const originalRead = handle.read.bind(handle);
            handle.read = async (buffer, offset, length, position) => {
              if (position === 0 && length > 0) return { bytesRead: 0, buffer };
              return originalRead(buffer, offset, length, position);
            };
          }
          return handle;
        },
      };
      const { runtime } = await createRemoteRuntime({
        root: shellRoot,
        fsImpl,
        resolveExtensionResource: capturingResolver(captured),
      });
      await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(captured[0].signedManifestHash).toBeNull();
    }
  });
});

describe('Interactive UI runtime Remote lifecycle triggers (Phase R3)', () => {
  const createLifecycleFixture = async ({
    fetchImpl,
    prepareExtensionUse,
    getExtensionLifecycle,
    now,
    healthTtlMs,
    extensionRoots,
    version = '1.0.0',
    testable = true,
    extra = {},
    listEnabledRemoteExtensions = undefined,
  } = {}) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-r3-'));
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-r3-data-'));
    temporaryDirectories.push(root, dataDirectory);
    await fs.mkdir(path.join(root, 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version,
      agentRouting: {
        domain: 'remote',
        intents: ['remote.overview'],
        examples: { en: ['Open Acme Remote'] },
        dataAuthority: 'user-provided',
      },
      connectors: [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
        ...(testable ? { test: { method: 'GET', path: '/health' } } : {}),
      }],
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['remote_open'],
        routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }],
      actions: [{
        id: 'com.acme.remote.read',
        connector: 'crm',
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }],
      permissions: { network: ['https://api.example.com'] },
      trust: { mode: 'declarative', signature: 'test' },
      ...extra,
    }, null, 2));
    await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: `Remote ${version}` },
    }));
    const connectionStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    });
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
      extensionRoots: extensionRoots ?? [root],
      connectionStore,
      ...(prepareExtensionUse ? { prepareExtensionUse } : {}),
      ...(getExtensionLifecycle ? { getExtensionLifecycle } : {}),
      ...(listEnabledRemoteExtensions ? { listEnabledRemoteExtensions } : {}),
      ...(now ? { now } : {}),
      ...(healthTtlMs ? { healthTtlMs } : {}),
      logger: { info() {}, warn() {} },
    });
    return { runtime, root };
  };

  it('caches and coalesces connector tests with inclusive TTL boundaries and invalidates on credential reset', async () => {
    let healthCalls = 0;
    let currentTime = 1_000_000;
    const { runtime } = await createLifecycleFixture({
      now: () => currentTime,
      healthTtlMs: 45_000,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/health')) healthCalls += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await runtime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-r3' });
    await expect(runtime.testConnection('com.acme.remote', 'crm', { force: true })).resolves.toMatchObject({ ok: true });
    expect(healthCalls).toBe(1);
    // Settled TTL hit: no new network probe.
    await expect(runtime.testConnection('com.acme.remote', 'crm')).resolves.toMatchObject({ ok: true });
    expect(healthCalls).toBe(1);
    // INCLUSIVE upper boundary: still a hit at exactly expiresAt.
    currentTime += 45_000;
    await expect(runtime.testConnection('com.acme.remote', 'crm')).resolves.toMatchObject({ ok: true });
    expect(healthCalls).toBe(1);
    // expiresAt + 1: fresh probe.
    currentTime += 1;
    await expect(runtime.testConnection('com.acme.remote', 'crm')).resolves.toMatchObject({ ok: true });
    expect(healthCalls).toBe(2);
    // Credential replacement resets health and the probe cache (epoch).
    await runtime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-r3-rotated' });
    await expect(runtime.testConnection('com.acme.remote', 'crm')).resolves.toMatchObject({ ok: true });
    expect(healthCalls).toBe(3);

    // Same-key in-flight coalescing: two concurrent forced tests share ONE
    // probe (synchronous check-and-set, no duplicate network work).
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    let gatedCalls = 0;
    const gatedFixture = await createLifecycleFixture({
      fetchImpl: async () => {
        gatedCalls += 1;
        if (gateActive) await gate;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const gatedRuntime = gatedFixture.runtime;
    await gatedRuntime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-gated' });
    gateActive = true;
    const first = gatedRuntime.testConnection('com.acme.remote', 'crm', { force: true });
    const second = gatedRuntime.testConnection('com.acme.remote', 'crm', { force: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gatedCalls).toBe(1);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(gatedCalls).toBe(1);
  });

  it('prepares Remote lifecycle before surface loads and reloads discovery when an automatic update applies', async () => {
    let prepareCount = 0;
    const { runtime, root } = await createLifecycleFixture({
      prepareExtensionUse: async (extensionId, options) => {
        prepareCount += 1;
        expect(options.trigger).toBe('surface');
        if (prepareCount === 1) {
          // Simulate an automatic metadata-only update: the manifest on disk
          // switches to a new version before the reload.
          const manifestPath = path.join(root, 'openchamber.extension.json');
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          manifest.version = '2.0.0';
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
          return { applied: true };
        }
        return { applied: false };
      },
    });

    const descriptor = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(descriptor.extension.version).toBe('2.0.0');
    expect(prepareCount).toBe(1);
    // Subsequent loads stay on the reloaded discovery.
    const again = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(again.extension.version).toBe('2.0.0');
    expect(prepareCount).toBe(2);
  });

  it('fails closed for required-blocked and trust_invalid prepares while unreachable keeps the old contract', async () => {
    const blocked = await createLifecycleFixture({
      prepareExtensionUse: async () => {
        const error = new Error('A required Remote app update is pending; review and apply it before using this app');
        error.code = 'remote_update_required_blocked';
        error.status = 409;
        throw error;
      },
    });
    await expect(blocked.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked', status: 409 });

    const trustInvalid = await createLifecycleFixture({
      prepareExtensionUse: async () => {
        const error = new Error('Remote app trust is invalid; reconnect or re-consent before use');
        error.code = 'remote_trust_invalid';
        error.status = 403;
        throw error;
      },
    });
    await expect(trustInvalid.runtime.getInstalledArtifactDescriptor ? trustInvalid.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open') : Promise.resolve(null))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });

    // Unreachable entry health: prepare returns normally and the old signed
    // surface still renders.
    let prepareCalls = 0;
    const unreachable = await createLifecycleFixture({
      prepareExtensionUse: async (extensionId, options) => {
        prepareCalls += 1;
        return {
          status: 'none',
          health: { status: 'unreachable', checkedAt: '2026-08-05T00:00:00.000Z', code: 'hosted_manifest_unavailable' },
        };
      },
    });
    const descriptor = await unreachable.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(descriptor.extension.version).toBe('1.0.0');
    expect(prepareCalls).toBe(1);
    // Non-Remote extensions are a prepare no-op (callback contract).
    const localOnly = await createLifecycleFixture({
      prepareExtensionUse: async () => {
        const error = new Error('Extension is not a Remote OCIX app');
        error.code = 'remote_extension_required';
        throw error;
      },
    });
    await expect(localOnly.runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .resolves.toMatchObject({ extension: { version: '1.0.0' } });
  });

  it('requires a cached/coalesced connector test before business actions and serves actions from the cache', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url, init) => {
      upstream.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-cache' });

    await runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    });
    // Health probe (required before the first action) + the business request.
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
    ]);
    // A second action inside the TTL serves the CACHED health evidence: no
    // new health probe, only the business request.
    await runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    });
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
      'https://crm.example.com/api/customers',
    ]);
  });

  it('includes safe extension-level lifecycle summaries in the Workbench catalog with per-extension isolation', async () => {
    const { runtime } = await createLifecycleFixture({
      prepareExtensionUse: async () => ({ applied: false }),
      getExtensionLifecycle: async (extensionId) => ({
        status: 'required',
        currentVersion: '1.0.0',
        currentManifestHash: 'sha256-current',
        remoteVersion: '2.0.0',
        remoteManifestHash: 'sha256-remote',
        changeSummary: 'Mandatory fix',
        permissionDelta: 'none',
        addedPermissions: null,
        keyChanged: false,
        requiresUserConfirmation: true,
        publisherFingerprint: 'sha256-fingerprint',
        health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
        blocked: { code: 'remote_update_required_blocked' },
      }),
    });
    const catalog = await runtime.getWorkbenchCatalog();
    expect(catalog.extensions[0].lifecycle).toEqual({
      status: 'required',
      health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
      blocked: { code: 'remote_update_required_blocked' },
      requiresUserConfirmation: true,
    });
    expect(JSON.stringify(catalog)).not.toContain('sha256-remote');
    expect(JSON.stringify(catalog)).not.toContain('Mandatory fix');

    // A broken lifecycle callback never blocks unrelated catalog entries.
    const broken = await createLifecycleFixture({
      getExtensionLifecycle: async () => {
        throw new Error('broken remote');
      },
    });
    const brokenCatalog = await broken.runtime.getWorkbenchCatalog();
    expect(brokenCatalog.extensions[0].lifecycle).toBeUndefined();
    expect(brokenCatalog.errors).toEqual([]);
  });

  it('warms Remote lifecycles and connector tests in the background with bounded concurrency and per-extension isolation', async () => {
    const prepared = [];
    const healthCalls = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const { runtime } = await createLifecycleFixture({
      prepareExtensionUse: async (extensionId, options) => {
        prepared.push([extensionId, options.trigger]);
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => ['com.acme.remote'],
      fetchImpl: async (url) => {
        healthCalls.push(String(url));
        if (gateActive) await gate;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await runtime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-warm' });
    gateActive = true;
    const warming = runtime.warmRemoteLifecycle({ concurrency: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Concurrency 1: only the first connector probe may be in flight.
    expect(healthCalls).toHaveLength(1);
    release();
    await warming;
    expect(prepared).toEqual([['com.acme.remote', 'startup']]);
    expect(healthCalls).toHaveLength(1);
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');

    // A broken prepare for one extension never blocks the warm-up.
    const broken = await createLifecycleFixture({
      prepareExtensionUse: async () => {
        const error = new Error('blocked');
        error.code = 'remote_update_required_blocked';
        throw error;
      },
      listEnabledRemoteExtensions: async () => ['com.acme.remote'],
    });
    await expect(broken.runtime.warmRemoteLifecycle({ concurrency: 4 })).resolves.toEqual({ warmed: 1 });
  });

  it('uses the enabled Remote id seam as the exclusive startup warm-up allowlist', async () => {
    const local = await createLifecycleFixture({
      extra: {
        id: 'com.acme.local',
        name: 'Acme Local',
        agentRouting: {
          domain: 'local',
          intents: ['local.overview'],
          examples: { en: ['Open Acme Local'] },
          dataAuthority: 'user-provided',
        },
        connectors: [{
          id: 'local-crm',
          type: 'http',
          baseUrl: 'https://local.example.com',
          auth: { type: 'api-key' },
          test: { method: 'GET', path: '/health' },
        }],
        views: [{
          id: 'com.acme.local.overview',
          runtime: 'declarative',
          entry: 'ui/view.json',
          tools: ['local_open'],
          routing: { intents: ['local.overview'], priority: 80, operation: 'read' },
          displayModes: ['inline', 'workspace'],
        }],
        actions: [],
        permissions: { network: ['https://local.example.com'] },
      },
    });
    const prepared = [];
    const upstream = [];
    let remoteRoot;
    const mixed = await createLifecycleFixture({
      extensionRoots: async () => [remoteRoot, local.root],
      prepareExtensionUse: async (extensionId, options) => {
        prepared.push([extensionId, options.trigger]);
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => ['com.acme.remote'],
      fetchImpl: async (url) => {
        upstream.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    remoteRoot = mixed.root;
    await mixed.runtime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-remote' });
    await mixed.runtime.configureConnection('com.acme.local', 'local-crm', { accessKey: 'sk-local' });

    await expect(mixed.runtime.warmRemoteLifecycle({ concurrency: 4 })).resolves.toEqual({ warmed: 1 });
    expect(prepared).toEqual([['com.acme.remote', 'startup']]);
    expect(upstream).toEqual(['https://api.example.com/health']);
    expect((await mixed.runtime.listConnections()).connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        extension: expect.objectContaining({ id: 'com.acme.remote' }),
        health: expect.objectContaining({ status: 'reachable' }),
      }),
      expect.objectContaining({
        extension: expect.objectContaining({ id: 'com.acme.local' }),
        health: expect.objectContaining({ status: 'unknown' }),
      }),
    ]));
  });

  it('does no startup warm-up work when the enabled Remote id seam is absent, empty, or throws', async () => {
    const cases = [
      { name: 'absent', seam: undefined },
      { name: 'empty', seam: async () => [] },
      { name: 'invalid', seam: async () => [null, 42, '', 'notnamespaced'] },
      { name: 'non-array', seam: async () => 'com.acme.remote' },
      { name: 'throws', seam: async () => { throw new Error('seam broken'); } },
    ];
    for (const testCase of cases) {
      const prepared = [];
      const upstream = [];
      const fixture = await createLifecycleFixture({
        prepareExtensionUse: async (extensionId) => {
          prepared.push(extensionId);
          return { applied: false };
        },
        listEnabledRemoteExtensions: testCase.seam,
        fetchImpl: async (url) => {
          upstream.push(String(url));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      });
      await fixture.runtime.configureConnection('com.acme.remote', 'crm', { accessKey: `sk-${testCase.name}` });
      await expect(fixture.runtime.warmRemoteLifecycle({ concurrency: 4 }), testCase.name)
        .resolves.toEqual({ warmed: 0 });
      expect(prepared, testCase.name).toEqual([]);
      expect(upstream, testCase.name).toEqual([]);
    }
  });

  it('warms enabled manager-owned Remote ids whose executable root is excluded, with isolation and concurrency bounds', async () => {
    const prepared = [];
    const upstream = [];
    const { runtime } = await createLifecycleFixture({
      prepareExtensionUse: async (extensionId, options) => {
        prepared.push([extensionId, options.trigger]);
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => ['com.acme.remote', 'com.acme.blocked'],
      fetchImpl: async (url) => {
        upstream.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    await runtime.configureConnection('com.acme.remote', 'crm', { accessKey: 'sk-warm-seam' });
    await runtime.warmRemoteLifecycle({ concurrency: 2 });
    // The discovered app prepares and tests; the excluded (blocked) app id is
    // covered by the seam even though its executable root is not discoverable.
    expect(prepared).toContainEqual(['com.acme.remote', 'startup']);
    expect(prepared).toContainEqual(['com.acme.blocked', 'startup']);
    expect(upstream).toEqual(['https://api.example.com/health']);
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');

    // A broken seam or a broken per-entity prepare never blocks warm-up.
    const brokenPrepared = [];
    const broken = await createLifecycleFixture({
      prepareExtensionUse: async (extensionId) => {
        brokenPrepared.push(extensionId);
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => {
        throw new Error('seam broken');
      },
    });
    await expect(broken.runtime.warmRemoteLifecycle({ concurrency: 4 })).resolves.toEqual({ warmed: 0 });
    expect(brokenPrepared).toEqual([]);
  });

  it('deduplicates and rejects invalid enabled Remote ids before creating warm-up jobs', async () => {
    const prepared = [];
    const { runtime } = await createLifecycleFixture({
      extensionRoots: [],
      prepareExtensionUse: async (extensionId) => {
        prepared.push(extensionId);
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => [
        'com.acme.remote',
        'com.acme.remote',
        '',
        'notnamespaced',
        ' com.acme.spaced ',
        null,
        42,
      ],
    });
    await expect(runtime.warmRemoteLifecycle({ concurrency: 4 })).resolves.toEqual({ warmed: 1 });
    expect(prepared).toEqual(['com.acme.remote']);
  });

  it('caps warm-up concurrency at 4 for every caller input, with per-entity isolation and zero-job settling', async () => {
    let active = 0;
    let maxActive = 0;
    const started = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const ids = ['com.acme.r1', 'com.acme.r2', 'com.acme.r3', 'com.acme.r4', 'com.acme.r5', 'com.acme.bad'];
    const { runtime } = await createLifecycleFixture({
      // No discoverable extension: all jobs come from the enumeration seam.
      extensionRoots: [],
      prepareExtensionUse: async (extensionId) => {
        started.push(extensionId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (gateActive) await gate;
        active -= 1;
        if (extensionId === 'com.acme.bad') {
          const error = new Error('blocked');
          error.code = 'remote_update_required_blocked';
          throw error;
        }
        return { applied: false };
      },
      listEnabledRemoteExtensions: async () => ids,
    });
    // concurrency:99 must clamp to the frozen cap of 4 workers.
    gateActive = true;
    const warming = runtime.warmRemoteLifecycle({ concurrency: 99 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(maxActive).toBe(4);
    expect(started).toHaveLength(4);
    release();
    await warming;
    // All six jobs settle (the broken one isolated), observed max never
    // exceeds 4.
    expect(started.sort()).toEqual([...ids].sort());
    expect(maxActive).toBe(4);
    // Invalid inputs also clamp (Infinity) and zero-job runs settle.
    await expect(runtime.warmRemoteLifecycle({ concurrency: Infinity })).resolves.toEqual({ warmed: 6 });
    const empty = await createLifecycleFixture({
      extensionRoots: [],
      listEnabledRemoteExtensions: async () => [],
    });
    await expect(empty.runtime.warmRemoteLifecycle({ concurrency: 99 })).resolves.toEqual({ warmed: 0 });
  });

  it('safeCatalogLifecycle is an allowlist normalizer: malicious callback shapes never leak into the Workbench catalog', async () => {
    const sentinel = 'SENTINEL-SECRET';
    const { runtime } = await createLifecycleFixture({
      getExtensionLifecycle: async () => ({
        status: { nested: sentinel },
        currentVersion: sentinel,
        remoteManifestHash: sentinel,
        publisherFingerprint: sentinel,
        addedPermissions: { actionIds: [sentinel] },
        changeSummary: sentinel,
        health: {
          status: [sentinel, 'reachable'],
          checkedAt: { nested: sentinel },
          code: { nested: sentinel },
        },
        blocked: { code: { nested: sentinel } },
        requiresUserConfirmation: 'yes',
        secret: sentinel,
        paths: { internal: sentinel },
      }),
    });
    const catalog = await runtime.getWorkbenchCatalog();
    // Only the allowlisted scalar shape survives; every object/array/unknown
    // value is dropped or defaulted.
    expect(catalog.extensions[0].lifecycle).toEqual({
      status: 'none',
      health: { status: 'unknown', checkedAt: null },
      requiresUserConfirmation: false,
    });
    expect(JSON.stringify(catalog)).not.toContain(sentinel);

    // A legitimate lifecycle still normalizes to the exact documented shape.
    const legit = await createLifecycleFixture({
      getExtensionLifecycle: async () => ({
        status: 'required',
        currentVersion: '1.0.0',
        currentManifestHash: 'sha256-x',
        remoteVersion: '2.0.0',
        remoteManifestHash: 'sha256-y',
        health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z', code: 'hosted_manifest_unavailable' },
        blocked: { code: 'remote_update_required_blocked' },
        requiresUserConfirmation: true,
      }),
    });
    const legitCatalog = await legit.runtime.getWorkbenchCatalog();
    expect(legitCatalog.extensions[0].lifecycle).toEqual({
      status: 'required',
      health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z', code: 'hosted_manifest_unavailable' },
      blocked: { code: 'remote_update_required_blocked' },
      requiresUserConfirmation: true,
    });
    // A non-record lifecycle is dropped entirely.
    const dropped = await createLifecycleFixture({
      getExtensionLifecycle: async () => 'garbage',
    });
    const droppedCatalog = await dropped.runtime.getWorkbenchCatalog();
    expect(droppedCatalog.extensions[0].lifecycle).toBeUndefined();
  });

  it('Workbench catalog prepare runs with a hard concurrency cap of 4 and per-extension isolation', async () => {
    let active = 0;
    let maxActive = 0;
    const prepared = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const ids = ['com.acme.r1', 'com.acme.r2', 'com.acme.r3', 'com.acme.r4', 'com.acme.r5', 'com.acme.r6'];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-catalog-cap-'));
    temporaryDirectories.push(root);
    for (const id of ids) {
      const dir = path.join(root, id);
      await fs.mkdir(path.join(dir, 'ui'), { recursive: true });
      await fs.writeFile(path.join(dir, 'openchamber.extension.json'), JSON.stringify({
        $schema: 'openchamber://extension/v1',
        id,
        name: id,
        version: '1.0.0',
        views: [{
          id: `${id}.overview`,
          runtime: 'declarative',
          entry: 'ui/view.json',
          tools: ['open'],
        }],
        actions: [],
        permissions: { network: [] },
        trust: { mode: 'declarative', signature: 'test' },
      }, null, 2));
      await fs.writeFile(path.join(dir, 'ui', 'view.json'), JSON.stringify({
        $schema: 'openchamber://declarative-view/v1',
        id: `${id}.overview`,
        layout: { type: 'text', value: 'x' },
      }));
    }
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      extensionRoots: [root],
      prepareExtensionUse: async (extensionId) => {
        prepared.push(extensionId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (gateActive) await gate;
        active -= 1;
        return { applied: false };
      },
      logger: { info() {}, warn() {} },
    });
    gateActive = true;
    const catalog = runtime.getWorkbenchCatalog();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(maxActive).toBe(4); // hard cap, never the full fan-out
    expect(prepared).toHaveLength(4);
    release();
    await catalog;
    expect(prepared.sort()).toEqual([...ids].sort());
    expect(maxActive).toBe(4);
  });
});

describe('Interactive UI runtime lifecycle corrections (Phase R3 review)', () => {
  it('classifies action responses by status before parsing and never leaves preflight reachable after a failed request', async () => {
    let status = 401;
    let body = 'not json';
    const upstream = [];
    const { runtime } = await createFixture(async (url) => {
      upstream.push(String(url));
      return new Response(body, { status });
    }, { testable: false });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-classify' });
    const actionContext = {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    };

    // Non-JSON 401 still classifies as unauthorized (never invalid JSON).
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unauthorized');
    expect(upstream).toHaveLength(1);

    // Non-JSON 403 still classifies as forbidden.
    status = 403;
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'connector_forbidden', status: 403 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('forbidden');
    expect(upstream).toHaveLength(2);

    // Oversized 2xx response: unreachable evidence with a stable code.
    status = 200;
    body = 'x'.repeat(2 * 1024 * 1024 + 1);
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'upstream_response_too_large', status: 502 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unreachable');
    expect(upstream).toHaveLength(3);

    // Invalid JSON on a 2xx: unreachable evidence with a stable code.
    body = 'not json';
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'invalid_upstream_response', status: 502 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unreachable');
    expect(upstream).toHaveLength(4);
  });

  it('never leaves preflight reachable standing after a real action request fails', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url) => {
      upstream.push(String(url));
      if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('boom', { status: 500 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-preflight' });

    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
      message: 'Business system rejected the request (500)',
    });
    // The preflight probe proved reachable, but the ACTION failed: health must
    // be unreachable, never the stale reachable evidence.
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_error',
    });
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
    ]);
  });

});

describe('Interactive UI connector-test authority safety (Phase R3 review)', () => {
  // Mirrors runtime.js's upstream response bound (2 MiB).
  const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
  const waitFor = async (predicate, timeoutMs = 2000) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('detaches an in-flight connector test on credential replacement: new callers never join and the stale result never repopulates health or cache', async () => {
    const requests = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const { runtime } = await createFixture(async (url, init) => {
      requests.push({ url: String(url), key: init?.headers?.get('X-API-Key') });
      if (gateActive) await gate;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-old' });
    const healthRequests = () => requests.filter((entry) => entry.url.endsWith('/health'));

    gateActive = true;
    const oldCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    expect(healthRequests()[0].key).toBe('sk-old');
    // Credential replacement while the old test is in flight: the old probe
    // is detached (not joinable) and its result can only settle for its
    // original caller.
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-new' });
    const newCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);
    expect(healthRequests()[1].key).toBe('sk-new');
    release();
    await expect(oldCaller).resolves.toMatchObject({ ok: true });
    await expect(newCaller).resolves.toMatchObject({ ok: true });
    expect(healthRequests().map((entry) => entry.key)).toEqual(['sk-old', 'sk-new']);
    // The stale old result must not overwrite health: the NEW probe evidence
    // is authoritative, and a subsequent non-forced test is a NEW cache hit
    // (no third network probe).
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(2);
  });

  it('never reuses settled or in-flight connector-test evidence when the effective connector subject changes', async () => {
    const requests = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const { runtime, root } = await createFixture(async (url) => {
      requests.push(String(url));
      if (gateActive) await gate;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const healthRequests = () => requests.filter((url) => url.includes('/health'));
    const manifestPath = path.join(root, 'openchamber.extension.json');
    const setBaseUrl = async (baseUrl) => {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.connectors[0].baseUrl = baseUrl;
      // The new origin must be declared in permissions.network or the
      // manifest fails runtime validation (network_not_allowed).
      manifest.permissions.network = [new URL(baseUrl).origin];
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    };

    // IN-FLIGHT subject change: the first probe runs against crm.example.com;
    // the manifest switches to api2.example.com mid-flight (a Remote metadata
    // update keeping the connector id/auth type). The second caller must NOT
    // join the old probe.
    gateActive = true;
    const first = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    await setBaseUrl('https://api2.example.com/');
    const second = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);
    expect(healthRequests()).toContain('https://crm.example.com/api/health');
    expect(healthRequests()).toContain('https://api2.example.com/health');
    release();
    await Promise.all([first, second]);

    // SETTLED subject change: a non-forced call with the OLD subject would be
    // a cache hit; after another manifest change it must probe fresh.
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(2);
    await setBaseUrl('https://api3.example.com/');
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toContain('https://api3.example.com/health');
    expect(healthRequests()).toHaveLength(3);
  });

  it('bulk removeExtensionConnections invalidates health, settled cache, and in-flight joinability without leaving reusable evidence', async () => {
    const requests = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const { runtime } = await createFixture(async (url) => {
      requests.push(String(url));
      if (gateActive) await gate;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const healthRequests = () => requests.filter((url) => url.includes('/health'));

    // In-flight probe + settled evidence, then bulk removal mid-flight.
    gateActive = true;
    const inFlight = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    await runtime.removeExtensionConnections('com.acme.crm');
    // The extension is still discoverable, but its health evidence is gone.
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unknown', checkedAt: null });
    // Same-id reinstall: restore the credential, then probe again. The new
    // caller must NOT join the detached old in-flight probe, and no old
    // health/cache may be reused.
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk2' });
    const afterRemoval = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);
    release();
    await expect(inFlight).resolves.toMatchObject({ ok: true });
    await expect(afterRemoval).resolves.toMatchObject({ ok: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    // The reinstall probe is cached normally (no third fetch on a repeat).
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(2);
  });

  it('preserves the true network probe checkedAt on joins and cache hits without refreshing evidence time', async () => {
    let currentTime = 1_000_000;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    let fetchCount = 0;
    const { runtime } = await createFixture(async () => {
      fetchCount += 1;
      if (gateActive) await gate;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, { now: () => currentTime, healthTtlMs: 45_000 });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });

    gateActive = true;
    const first = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    const second = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => fetchCount === 1); // joined, one network probe
    currentTime += 5_000; // the probe completes later
    release();
    const [joinedA, joinedB] = await Promise.all([first, second]);
    const probeCheckedAt = new Date(1_005_000).toISOString();
    expect(joinedA.checkedAt).toBe(probeCheckedAt);
    expect(joinedB.checkedAt).toBe(probeCheckedAt);
    // Cache access at a later clock must NOT refresh evidence time.
    currentTime += 40_000;
    const hit = await runtime.testConnection('com.acme.crm', 'crm-api');
    expect(hit.checkedAt).toBe(probeCheckedAt);
    expect((await runtime.listConnections()).connections[0].health.checkedAt).toBe(probeCheckedAt);
    expect(fetchCount).toBe(1);
  });

  it('action failure invalidates stale reachable preflight evidence; the next attempt re-tests and a failing fresh test sends zero business requests', async () => {
    const upstream = [];
    let healthStatus = 200;
    const { runtime } = await createFixture(async (url) => {
      upstream.push(String(url));
      if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: healthStatus });
      return new Response('boom', { status: 500 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const actionContext = {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    };

    // First action: preflight proves reachable, the real business request
    // fails with 500. The failure must detach the reachable preflight
    // evidence (cache + in-flight + epoch).
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
    ]);
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_error',
    });
    // The next action must NOT blindly reuse the stale reachable preflight:
    // it re-tests. Make the fresh safe test FAIL: zero second business action
    // is sent.
    healthStatus = 500;
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({
        code: 'upstream_error',
        status: 502,
        message: 'Business system rejected the connection test (500)',
      });
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
      'https://crm.example.com/api/health',
    ]);
    expect(upstream.filter((url) => url.endsWith('/customers'))).toHaveLength(1);
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_error',
    });
  });

  it('maps non-ok connector-test responses before consuming the body and wraps 2xx body-read failures with cached checkedAt', async () => {
    let mode = 'unauthorized';
    let fetchCount = 0;
    const { runtime } = await createFixture(async (url) => {
      fetchCount += 1;
      if (String(url).endsWith('/health')) {
        if (mode === 'unauthorized') {
          return { ok: false, status: 401, arrayBuffer: () => { throw new Error('hostile body'); } };
        }
        if (mode === 'forbidden') {
          return { ok: false, status: 403, arrayBuffer: () => { throw new Error('hostile body'); } };
        }
        if (mode === 'read-fail') {
          return { ok: true, status: 200, arrayBuffer: () => { throw new Error('body read failed'); } };
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });

    // Non-ok with a throwing body: the status is classified BEFORE the body
    // is consumed, so unauthorized/forbidden mapping survives.
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unauthorized');
    mode = 'forbidden';
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'connector_forbidden', status: 403 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('forbidden');

    // A throwing 2xx body is a stable unreachable upstream failure, cached
    // with the true checkedAt: a later non-forced call is a cache hit with no
    // new network probe.
    mode = 'read-fail';
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'upstream_unavailable', status: 502 });
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_unavailable',
      checkedAt: expect.any(String),
    });
    const before = fetchCount;
    await expect(runtime.testConnection('com.acme.crm', 'crm-api'))
      .rejects.toMatchObject({ code: 'upstream_unavailable', status: 502 });
    expect(fetchCount).toBe(before);
  });

  it('maps action responses before consuming the body and wraps 2xx body-read failures with preflight invalidation', async () => {
    const upstream = [];
    let actionMode = 'unauthorized';
    let healthMode = 'ok';
    const { runtime } = await createFixture(async (url) => {
      upstream.push(String(url));
      if (String(url).endsWith('/health')) {
        if (healthMode === 'fail') {
          return { ok: false, status: 500, arrayBuffer: () => { throw new Error('hostile'); } };
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (actionMode === 'unauthorized') {
        return { ok: false, status: 401, arrayBuffer: () => { throw new Error('hostile body'); } };
      }
      if (actionMode === 'read-fail') {
        return { ok: true, status: 200, arrayBuffer: () => { throw new Error('body read failed'); } };
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const actionContext = {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    };

    // Non-ok throwing body: unauthorized mapping survives and the body is
    // never consumed.
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unauthorized');
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
    ]);

    // Throwing 2xx body: stable unreachable failure; prior preflight
    // evidence is detached before recording it.
    actionMode = 'read-fail';
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({
        code: 'upstream_unavailable',
        status: 502,
        message: 'Business system response could not be read',
      });
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_unavailable',
    });

    // The failure invalidated the preflight cache: the next action MUST
    // re-test; a failing fresh test sends zero business requests.
    healthMode = 'fail';
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect(upstream).toEqual([
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
      'https://crm.example.com/api/health',
      'https://crm.example.com/api/customers',
      'https://crm.example.com/api/health',
    ]);
    expect(upstream.filter((url) => url.endsWith('/customers'))).toHaveLength(2);
  });

  it('validates connector-test clocks: invalid/out-of-range/overflow values yield checkedAt null and no caching; backward time is a miss; inclusive expiresAt retained', async () => {
    let currentTime = 1_000_000;
    let fetchCount = 0;
    const { runtime } = await createFixture(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, { now: () => currentTime, healthTtlMs: 45_000 });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });

    for (const bad of [NaN, Infinity, -Infinity, 1.5, -1, 8_640_000_000_000_001, Number.MAX_SAFE_INTEGER - 1000]) {
      currentTime = bad;
      const result = await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
      expect(result.ok).toBe(true);
      expect(result.checkedAt).toBeNull();
    }
    expect(fetchCount).toBe(7);

    currentTime = 1_000_000;
    const first = await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    expect(first.checkedAt).toBe(new Date(1_000_000).toISOString());
    expect(fetchCount).toBe(8);
    await runtime.testConnection('com.acme.crm', 'crm-api'); // hit
    expect(fetchCount).toBe(8);
    currentTime = 1_045_000; // inclusive expiresAt boundary
    await runtime.testConnection('com.acme.crm', 'crm-api');
    expect(fetchCount).toBe(8);
    currentTime = 1_045_001; // expired
    await runtime.testConnection('com.acme.crm', 'crm-api');
    expect(fetchCount).toBe(9);
    currentTime = 999_999; // backward clock regression: miss, never a hit
    await runtime.testConnection('com.acme.crm', 'crm-api');
    expect(fetchCount).toBe(10);
  });

  it('records live health (with checkedAt null) under invalid clocks while still probing fresh each call', async () => {
    let currentTime = NaN;
    let mode = 'ok';
    let fetchCount = 0;
    const { runtime } = await createFixture(async () => {
      fetchCount += 1;
      if (mode === 'fail') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, { now: () => currentTime, healthTtlMs: 45_000 });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });

    // Reachable status is recorded with an EXPLICIT null checkedAt even
    // though the clock is invalid; caching alone is skipped (each call probes
    // fresh).
    const result = await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    expect(result.ok).toBe(true);
    expect(result.checkedAt).toBeNull();
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'reachable', checkedAt: null });
    const before = fetchCount;
    await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    expect(fetchCount).toBe(before + 1); // no caching under an invalid clock

    // Failure status is recorded too, with checkedAt null.
    mode = 'fail';
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unreachable', code: 'upstream_error', checkedAt: null });
  });

  it('reverse settlement after credential replacement: the new probe completing FIRST wins and the old detached probe completing LAST never overwrites health or cache', async () => {
    const requests = [];
    let releaseOld;
    let releaseNew;
    const gateOld = new Promise((resolve) => { releaseOld = resolve; });
    const gateNew = new Promise((resolve) => { releaseNew = resolve; });
    let gateMode = 'none';
    const { runtime } = await createFixture(async (url, init) => {
      requests.push({ url: String(url), key: init?.headers?.get('X-API-Key') });
      if (String(url).endsWith('/health')) {
        if (gateMode === 'old') {
          await gateOld;
          return new Response('nope', { status: 401 });
        }
        if (gateMode === 'new') {
          await gateNew;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-old' });
    const healthRequests = () => requests.filter((entry) => entry.url.endsWith('/health'));

    gateMode = 'old';
    const oldCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk-new' });
    gateMode = 'new';
    const newCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);
    expect(healthRequests()[1].key).toBe('sk-new');

    // NEW completes FIRST (reachable), OLD completes LAST (401).
    releaseNew();
    await expect(newCaller).resolves.toMatchObject({ ok: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    releaseOld();
    await expect(oldCaller).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    // The stale old result never overwrote health or the cache: the repeat is
    // a NEW cache hit with no extra fetch and health stays reachable.
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    const before = healthRequests().length;
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(before);
  });

  it('reverse settlement after bulk removal + same-id reinstall: the old detached probe completing LAST never overwrites the reinstall evidence', async () => {
    const requests = [];
    let releaseOld;
    let releaseNew;
    const gateOld = new Promise((resolve) => { releaseOld = resolve; });
    const gateNew = new Promise((resolve) => { releaseNew = resolve; });
    let gateMode = 'none';
    const { runtime } = await createFixture(async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/health')) {
        if (gateMode === 'old') {
          await gateOld;
          return new Response('nope', { status: 401 });
        }
        if (gateMode === 'new') {
          await gateNew;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const healthRequests = () => requests.filter((url) => url.includes('/health'));

    gateMode = 'old';
    const oldCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    // Uninstall-style bulk removal (deletes tokens too), then same-id
    // reinstall with a new credential.
    await runtime.removeExtensionConnections('com.acme.crm');
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk2' });
    gateMode = 'new';
    const newCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);

    releaseNew();
    await expect(newCaller).resolves.toMatchObject({ ok: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    releaseOld();
    await expect(oldCaller).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    // The deleted/rotated token can never equal the old probe's token: health
    // and cache remain the reinstall evidence, and a repeat is a cache hit.
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    const before = healthRequests().length;
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(before);
  });

  it('reverse settlement after a subject change: the subject-B probe completing FIRST wins and subject-A completing LAST never overwrites B health or cache', async () => {
    const requests = [];
    let releaseOld;
    let releaseNew;
    const gateOld = new Promise((resolve) => { releaseOld = resolve; });
    const gateNew = new Promise((resolve) => { releaseNew = resolve; });
    let gateMode = 'none';
    const { runtime, root } = await createFixture(async (url) => {
      requests.push(String(url));
      if (String(url).includes('/health')) {
        if (gateMode === 'old') {
          await gateOld;
          return new Response('nope', { status: 401 });
        }
        if (gateMode === 'new') {
          await gateNew;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const healthRequests = () => requests.filter((url) => url.includes('/health'));
    const manifestPath = path.join(root, 'openchamber.extension.json');
    const setBaseUrl = async (baseUrl) => {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.connectors[0].baseUrl = baseUrl;
      manifest.permissions.network = [new URL(baseUrl).origin];
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    };

    gateMode = 'old';
    const oldCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 1);
    expect(healthRequests()[0]).toBe('https://crm.example.com/api/health');
    // Remote metadata update: the effective connector subject changes while
    // the old probe is in flight.
    await setBaseUrl('https://api2.example.com/');
    gateMode = 'new';
    const newCaller = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);
    expect(healthRequests()[1]).toBe('https://api2.example.com/health');

    releaseNew();
    await expect(newCaller).resolves.toMatchObject({ ok: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    releaseOld();
    await expect(oldCaller).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    // The subject-A probe was detached by the subject-B rotation: health and
    // cache remain B and a repeat is a B cache hit with no extra fetch.
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    const before = healthRequests().length;
    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(before);
  });

  it('one generation contract: a non-force caller during a forced refresh joins the refresh and the old settled success never resurrects', async () => {
    const upstream = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    let mode = 'ok';
    const { runtime } = await createFixture(async (url) => {
      upstream.push(String(url));
      if (String(url).endsWith('/health')) {
        if (gateActive) await gate;
        if (mode === 'fail') return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const healthRequests = () => upstream.filter((url) => url.includes('/health'));

    // Prime a reachable settled cache entry.
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .resolves.toMatchObject({ ok: true });
    expect(healthRequests()).toHaveLength(1);

    // Start a gated FORCED refresh that will FAIL: the token is rotated and
    // the old settled cache is deleted BEFORE the network work starts.
    mode = 'fail';
    gateActive = true;
    const forced = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    await waitFor(() => healthRequests().length === 2);

    // A NON-force caller arrives during the forced refresh: it must STAY
    // PENDING and JOIN the forced probe — it must never be served the old
    // settled reachable entry. The outcome wrapper never rejects (both
    // branches resolve an outcome record), so no unhandled-rejection window
    // exists while the probe is still pending.
    let nonForceSettled = false;
    let nonForceOutcome = null;
    const nonForce = runtime.testConnection('com.acme.crm', 'crm-api').then(
      (result) => { nonForceSettled = true; nonForceOutcome = { ok: true, result }; return nonForceOutcome; },
      (error) => { nonForceSettled = true; nonForceOutcome = { ok: false, error }; return nonForceOutcome; },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nonForceSettled).toBe(false);
    expect(healthRequests()).toHaveLength(2); // joined: no extra fetch

    release();
    // Both observe the FRESH failure (never the old success).
    await expect(forced).rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    const joinedOutcome = await nonForce;
    expect(joinedOutcome.ok).toBe(false);
    expect(joinedOutcome.error).toMatchObject({ code: 'upstream_error', status: 502 });
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_error',
    });
    // The old reachable cache never resurrects: a later call gets the CACHED
    // FRESH failure (same token generation) with no extra fetch — not the old
    // success.
    await expect(runtime.testConnection('com.acme.crm', 'crm-api'))
      .rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect(healthRequests()).toHaveLength(2);
  });

  it('one generation contract invalid-clock variant: a forced refresh with an invalid clock deletes the old settled cache and a later call performs a fresh network probe', async () => {
    let currentTime = 1_000_000;
    let fetchCount = 0;
    let mode = 'ok';
    const { runtime } = await createFixture(async () => {
      fetchCount += 1;
      if (mode === 'fail') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, { now: () => currentTime, healthTtlMs: 45_000 });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });

    // Prime a reachable cache with a valid clock.
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .resolves.toMatchObject({ ok: true });
    expect(fetchCount).toBe(1);

    // The clock becomes invalid; a forced refresh rotates the token and
    // DELETES the old settled cache BEFORE network work, and cannot re-cache
    // (live health still recorded with checkedAt null).
    currentTime = NaN;
    mode = 'fail';
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect(fetchCount).toBe(2);
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unreachable', code: 'upstream_error', checkedAt: null });

    // The old reachable entry never resurrects: the later non-force call
    // performs a FRESH network probe (no cache to serve) and succeeds.
    mode = 'ok';
    const later = await runtime.testConnection('com.acme.crm', 'crm-api');
    expect(later.ok).toBe(true);
    expect(later.checkedAt).toBeNull(); // invalid clock: explicit null
    expect(fetchCount).toBe(3);
  });

  it('authentication/credential-resolution failure records a sanitized safe failure, invalidates old reachable evidence, and never sends the test request', async () => {
    let fetchCount = 0;
    const { runtime } = await createFixture(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    // Prime reachable evidence.
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    // Remove the credential: the next test's authentication fails.
    await runtime.removeConnection('com.acme.crm', 'crm-api');
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'connector_unconfigured', status: 503 });
    // The sanitized safe failure replaced the old reachable health; no
    // credential text is exposed; ZERO test requests were sent.
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unreachable', code: 'connector_unconfigured', checkedAt: expect.any(String) });
    expect(fetchCount).toBe(1);
    expect(JSON.stringify(await runtime.listConnections())).not.toContain('sk');
  });

  it('invokeAction authentication failure after a successful preflight detaches evidence and replaces reachable health, sending zero business requests', async () => {
    const upstream = [];
    let credentialCalls = 0;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-authfail-'));
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-authfail-data-'));
    temporaryDirectories.push(root, dataDirectory);
    await fs.mkdir(path.join(root, 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.crm',
      name: 'Acme CRM',
      version: '1.0.0',
      connectors: [{
        id: 'crm-api',
        type: 'http',
        baseUrl: 'https://crm.example.com/api/',
        auth: { type: 'api-key', placement: { type: 'header', name: 'X-API-Key' } },
        test: { method: 'GET', path: '/health' },
      }],
      views: [{
        id: 'com.acme.crm.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['crm_open'],
      }],
      actions: [{
        id: 'com.acme.crm.query',
        connector: 'crm-api',
        risk: 'read',
        request: { method: 'POST', path: '/customers' },
      }],
      permissions: { network: ['https://crm.example.com'] },
      trust: { mode: 'declarative', signature: 'test' },
    }, null, 2));
    await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.crm.overview',
      layout: { type: 'text', value: 'x' },
    }));
    const realStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    // The credential resolution succeeds once (the preflight) and then fails
    // (the action's own authentication) — simulating a credential removed in
    // between.
    const failingStore = {
      ...realStore,
      getConfiguration: async (extensionId, connectorId) => {
        credentialCalls += 1;
        // The ACTION's connector resolution (call 1) returns a configuration
        // WITHOUT an access key (simulating a credential removed before the
        // action's own authentication); the PREFLIGHT's resolution (call 2)
        // still sees the stored configuration, so the safe test succeeds.
        if (credentialCalls === 1) return { headers: {} };
        return realStore.getConfiguration(extensionId, connectorId);
      },
    };
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: async (url) => {
        upstream.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      extensionRoots: [root],
      connectionStore: failingStore,
      logger: { info() {}, warn() {} },
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    const actionContext = {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    };
    await expect(runtime.invokeAction('com.acme.crm.query', actionContext))
      .rejects.toMatchObject({ code: 'connector_unconfigured', status: 503 });
    // The preflight reachable evidence was detached and health replaced with
    // the proper non-reachable state; the business request was NEVER sent.
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unreachable', code: 'connector_unconfigured', checkedAt: expect.any(String) });
    expect(upstream).toEqual(['https://crm.example.com/api/health']);
    expect(JSON.stringify(await runtime.listConnections())).not.toContain('sk');
  });

  it('invokeAction EARLY connector/credential-resolution failure detaches stale reachable evidence, sanitizes health, and sends zero upstream requests', async () => {
    const upstream = [];
    let failResolve = false;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-earlyresolve-'));
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-earlyresolve-data-'));
    temporaryDirectories.push(root, dataDirectory);
    await fs.mkdir(path.join(root, 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.crm',
      name: 'Acme CRM',
      version: '1.0.0',
      connectors: [{
        id: 'crm-api',
        type: 'http',
        baseUrl: 'https://crm.example.com/api/',
        auth: { type: 'api-key', placement: { type: 'header', name: 'X-API-Key' } },
        test: { method: 'GET', path: '/health' },
      }],
      views: [{
        id: 'com.acme.crm.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['crm_open'],
      }],
      actions: [{
        id: 'com.acme.crm.query',
        connector: 'crm-api',
        risk: 'read',
        request: { method: 'POST', path: '/customers' },
      }],
      permissions: { network: ['https://crm.example.com'] },
      trust: { mode: 'declarative', signature: 'test' },
    }, null, 2));
    await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.crm.overview',
      layout: { type: 'text', value: 'x' },
    }));
    const realStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const RAW_SECRET = 'sk-live-9f8e7d6c5b4a3f2e1d0c9b8a';
    const failingStore = {
      ...realStore,
      getConfiguration: async (extensionId, connectorId) => {
        if (failResolve) {
          // RAW secret-bearing configuration-store failure: must never leak
          // into any response/error surface.
          throw new Error(`credential store I/O failed for ${connectorId}: ${RAW_SECRET} at ${path.join(dataDirectory, 'secrets.json')}`);
        }
        return realStore.getConfiguration(extensionId, connectorId);
      },
    };
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: async (url) => {
        upstream.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      extensionRoots: [root],
      connectionStore: failingStore,
      logger: { info() {}, warn() {} },
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    // Prime reachable connector-test evidence.
    await runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('reachable');
    const upstreamBefore = upstream.length;
    expect(upstreamBefore).toBe(1); // only the primed health probe
    // The INITIAL effective-connector resolution now rejects with a raw
    // secret-bearing error (before any test/preflight or business request).
    failResolve = true;
    const actionContext = {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      tool: viewTool,
      input: {},
    };
    const actionError = await runtime.invokeAction('com.acme.crm.query', actionContext)
      .catch((error) => error);
    expect(actionError).toMatchObject({ code: 'credential_unavailable', status: 502 });
    expect(actionError.message).toBe('Connector credentials are unavailable');
    expect(actionError.message).not.toContain(RAW_SECRET);
    // Stale reachable evidence was detached and health replaced with the
    // sanitized non-reachable state — never stale reachable.
    expect((await runtime.listConnections()).connections[0].health)
      .toEqual({ status: 'unreachable', code: 'credential_unavailable', checkedAt: expect.any(String) });
    // ZERO NEW upstream requests: no connector test, no business request.
    expect(upstream).toHaveLength(upstreamBefore);
    expect(upstream).toEqual(['https://crm.example.com/api/health']);
    // No raw secret/error/path text in any JSON output.
    const serialized = JSON.stringify(await runtime.listConnections());
    expect(serialized).not.toContain(RAW_SECRET);
    expect(serialized).not.toContain('credential store I/O failed');
    expect(serialized).not.toContain('secrets.json');
  });

  it('migrateWorkbenchTile never falls back to a stale pre-update descriptor after an automatic apply', async () => {
    let prepareCalls = 0;
    const { runtime, root } = await createFixture(async () => new Response('{}', { status: 200 }), {
      dashboard: true,
      prepareExtensionUse: async () => {
        prepareCalls += 1;
        if (prepareCalls === 1) {
          // Simulate the automatic update REMOVING the app from discovery:
          // the reloaded discovery has no entry for it.
          await fs.rm(path.join(root, 'openchamber.extension.json'), { force: true });
          return { applied: true };
        }
        return { applied: false };
      },
    });
    await expect(runtime.migrateWorkbenchTile({
      tileId: 'tile-1',
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.overview',
        compatibleVersion: '^0.0.0',
      },
      form: 'interactive-ui',
      context: {},
      layout: { column: 0, row: 0, columns: 4, rows: 3 },
      displayMode: 'tile',
      relationship: null,
      origin: null,
    })).rejects.toMatchObject({ code: 'workbench_migration_unavailable', status: 409 });
    expect(prepareCalls).toBe(1);
  });

  it('bounded 2xx body reads: Content-Length early rejection and chunk overflow cancel the stream with stable codes', async () => {
    let cancelled = false;
    const oversizedChunks = (() => {
      const chunk = Buffer.alloc(512 * 1024);
      const chunks = [];
      for (let i = 0; i < 5; i += 1) chunks.push(chunk);
      return chunks;
    })();
    let readerIndex = 0;
    const chunkedResponse = {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-length' ? null : null) },
      body: {
        getReader: () => ({
          read: async () => {
            if (readerIndex >= oversizedChunks.length) return { done: true };
            const value = oversizedChunks[readerIndex];
            readerIndex += 1;
            return { done: false, value };
          },
          cancel: async () => { cancelled = true; },
          releaseLock: () => {},
        }),
      },
      arrayBuffer: async () => { throw new Error('must not use arrayBuffer'); },
    };
    const { runtime } = await createFixture(async (url) => {
      if (String(url).endsWith('/health')) return chunkedResponse;
      return new Response('{}', { status: 200 });
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    await expect(runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'upstream_response_too_large', status: 502 });
    expect(cancelled).toBe(true);
    expect((await runtime.listConnections()).connections[0].health).toMatchObject({
      status: 'unreachable',
      code: 'upstream_response_too_large',
    });
    // Content-Length early rejection: no body chunks are consumed.
    let contentLengthCancelled = false;
    const earlyResponse = {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-length' ? String(MAX_UPSTREAM_BYTES + 1) : null) },
      body: {
        getReader: () => ({
          read: async () => {
            contentLengthCancelled = true;
            return { done: true };
          },
          cancel: async () => { contentLengthCancelled = true; },
          releaseLock: () => {},
        }),
        cancel: async () => { contentLengthCancelled = true; },
      },
      arrayBuffer: async () => { throw new Error('must not use arrayBuffer'); },
    };
    const earlyFixture = await createFixture(async (url) => {
      if (String(url).endsWith('/health')) return earlyResponse;
      return new Response('{}', { status: 200 });
    });
    await earlyFixture.runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    await expect(earlyFixture.runtime.testConnection('com.acme.crm', 'crm-api', { force: true }))
      .rejects.toMatchObject({ code: 'upstream_response_too_large', status: 502 });
    expect(contentLengthCancelled).toBe(true);
  });

  it('await-free check-and-reserve: two concurrent forced tests with gated credential resolution share exactly one authentication and one probe', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    let fetchCount = 0;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-reserve-'));
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-reserve-data-'));
    temporaryDirectories.push(root, dataDirectory);
    await fs.mkdir(path.join(root, 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.crm',
      name: 'Acme CRM',
      version: '1.0.0',
      connectors: [{
        id: 'crm-api',
        type: 'http',
        baseUrl: 'https://crm.example.com/api/',
        auth: { type: 'api-key', placement: { type: 'header', name: 'X-API-Key' } },
        test: { method: 'GET', path: '/health' },
      }],
      views: [{
        id: 'com.acme.crm.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['crm_open'],
      }],
      actions: [],
      permissions: { network: ['https://crm.example.com'] },
      trust: { mode: 'declarative', signature: 'test' },
    }, null, 2));
    await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.crm.overview',
      layout: { type: 'text', value: 'x' },
    }));
    const realStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      // The network probe is the equivalent barrier AFTER the initial
      // empty-slot decision: with an await in the check/reserve region (e.g.
      // credential resolution before the reserve), both concurrent forced
      // callers would pass the empty-slot check and start TWO probes; with
      // the await-free reserve boundary, the second caller joins the first
      // caller's reserved probe and exactly ONE fetch/auth happens.
      fetchImpl: async () => {
        fetchCount += 1;
        if (gateActive) await gate;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      extensionRoots: [root],
      connectionStore: realStore,
      logger: { info() {}, warn() {} },
    });
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'sk' });
    gateActive = true;
    const first = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    const second = runtime.testConnection('com.acme.crm', 'crm-api', { force: true });
    for (let i = 0; i < 200 && fetchCount === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Exactly ONE probe was started (the second caller joined the first
    // caller's reserved entry instead of passing an empty slot itself).
    expect(fetchCount).toBe(1);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(fetchCount).toBe(1); // exactly one network probe, both settled from it
  });
});
