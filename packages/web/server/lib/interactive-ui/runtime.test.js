import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import { createInteractiveUIRuntime } from './runtime.js';

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
      baseUrl: 'https://crm.example.com/api/',
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
    logger: { info() {}, warn() {} },
  });
  return { runtime };
};

describe('Interactive UI connector authentication', () => {
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

  it('rejects unsafe credential headers during manifest validation', async () => {
    const { runtime } = await createFixture(async () => new Response('{}'), { headerName: 'Cookie' });
    const registry = await runtime.listExtensions();
    expect(registry.extensions).toEqual([]);
    expect(registry.errors[0].error).toContain('unsafe credential header');
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
    expect(missingPermissionRegistry.errors[0].error).toContain('not declared in permissions.network');

    const { runtime: escapingAction } = await createFixture(async () => new Response('{}'), {
      actionPath: '/../admin',
    });
    const escapingActionRegistry = await escapingAction.listExtensions();
    expect(escapingActionRegistry.extensions).toEqual([]);
    expect(escapingActionRegistry.errors[0].error).toContain('fixed connector-relative path');
  });
});
