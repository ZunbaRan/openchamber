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
      test: { method: 'GET', path: '/health' },
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
    expect(upstream[0].init.headers.get('X-API-Key')).toBe('crm-secret');
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
    expect(upstream).toHaveLength(1);
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

    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    expect((await runtime.listConnections()).connections[0].health.status).toBe('unauthorized');
    status = 403;
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
    status = 409;
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
    const { runtime: askRuntime } = await createFixture(async () => {
      askCalls += 1;
      return new Response(JSON.stringify({ ok: true }));
    }, { actionRisk: 'write', actionPermission: 'ask' });
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
    }, { actionRisk: 'destructive', actionPermission: 'deny' });
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
