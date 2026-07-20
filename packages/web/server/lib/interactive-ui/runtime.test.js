import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import { createInteractiveUIRuntime } from './runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createFixture = async (fetchImpl, { headerName = 'X-API-Key', authType = 'api-key' } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-auth-'));
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-runtime-auth-data-'));
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
    views: [{ id: 'com.acme.crm.overview', runtime: 'declarative', entry: 'ui/view.json', tools: ['crm_open'] }],
    actions: [{
      id: 'com.acme.crm.query',
      connector: 'crm-api',
      risk: 'read',
      permission: 'allow',
      request: { method: 'POST', path: '/customers' },
    }],
    permissions: { network: ['https://crm.example.com'] },
    trust: { mode: 'declarative', signature: 'test' },
  }));
  await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.crm.overview',
    layout: { type: 'text', value: 'CRM' },
  }));
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
  it('keeps API keys out of management responses and injects them only in upstream requests', async () => {
    const upstream = [];
    const { runtime } = await createFixture(async (url, init) => {
      upstream.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const before = await runtime.listConnections();
    expect(before.connections[0].credential.configured).toBe(false);
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      input: {},
    })).rejects.toMatchObject({ code: 'connector_unconfigured' });

    const configured = await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'crm-secret' });
    expect(JSON.stringify(configured)).not.toContain('crm-secret');
    expect(JSON.stringify(await runtime.listConnections())).not.toContain('crm-secret');

    expect((await runtime.testConnection('com.acme.crm', 'crm-api')).ok).toBe(true);
    await runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      input: {},
    });
    expect(upstream).toHaveLength(2);
    expect(upstream[0].init.headers.get('X-API-Key')).toBe('crm-secret');
    expect(upstream[1].init.headers.get('X-API-Key')).toBe('crm-secret');
  });

  it('maps third-party 401 and 403 responses without implementing business permissions', async () => {
    let status = 401;
    const { runtime } = await createFixture(async () => new Response(JSON.stringify({ error: 'denied by CRM' }), { status }));
    await runtime.configureConnection('com.acme.crm', 'crm-api', { accessKey: 'scoped-key' });

    await expect(runtime.testConnection('com.acme.crm', 'crm-api')).rejects.toMatchObject({ code: 'connector_unauthorized', status: 401 });
    status = 403;
    await expect(runtime.invokeAction('com.acme.crm.query', {
      extensionId: 'com.acme.crm',
      viewId: 'com.acme.crm.overview',
      input: {},
    })).rejects.toMatchObject({ code: 'connector_forbidden', status: 403 });
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
});
