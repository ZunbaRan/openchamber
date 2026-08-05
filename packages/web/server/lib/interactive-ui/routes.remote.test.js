import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createInteractiveUIExtensionManager } from './manager.js';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import { createInteractiveUIRuntime } from './runtime.js';
import { registerInteractiveUIRoutes } from './routes.js';
import { generatePublisherKeyPair } from './package-format.js';
import { HOSTED_OCIX_MANIFEST_SCHEMA } from './hosted-ocix.js';

const temporaryDirectories = [];
// Every explicit test HTTP server, closed in afterEach BEFORE temporary
// directories are removed so no request can reach a removed data directory.
const httpServers = [];

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
    else resolve();
  });
});

afterEach(async () => {
  await Promise.all(httpServers.splice(0).map(closeServer));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createTemporaryDirectory = async (prefix) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const createRemoteManifest = (keys) => {
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.remote.overview',
    layout: { type: 'text', value: 'Remote' },
  }));
  const iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const resources = [{
    path: 'ui/overview.view.json',
    url: 'https://apps.example.com/ui/overview.view.json',
    mimeType: 'application/json',
    sha256: `sha256-${crypto.createHash('sha256').update(view).digest('base64')}`,
  }, {
    path: 'ui/icon.svg',
    url: 'https://apps.example.com/ui/icon.svg',
    mimeType: 'image/svg+xml',
    sha256: `sha256-${crypto.createHash('sha256').update(iconBytes).digest('base64')}`,
  }];
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: { id: 'com.acme.remote', version: '1.0.0', publishedAt: '2026-08-05T00:00:00.000Z' },
    publisher: {
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2026',
      publicKey: keys.publicKey,
    },
    permissions: {
      resourceOrigins: ['https://apps.example.com'],
      networkOrigins: ['https://api.example.com'],
      externalLinkOrigins: [],
      credentialScopes: ['crm.read'],
      actionIds: ['com.acme.remote.read'],
      agentToolNames: ['remote_open'],
      clipboard: false,
      popups: false,
      nativeCode: false,
    },
    extension: {
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '1.0.0',
      icon: 'ui/icon.svg',
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
      }],
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/overview.view.json',
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
      trust: { mode: 'declarative', signature: 'production' },
    },
    resources,
  };
  const signature = crypto.sign(
    null,
    Buffer.from(JSON.stringify(canonicalize(unsigned))),
    crypto.createPrivateKey(keys.privateKey),
  ).toString('base64');
  return {
    document: {
      ...unsigned,
      signature: { algorithm: 'ed25519', keyId: 'release-2026', value: signature },
    },
    icon: iconBytes,
  };
};

const createApp = async ({
  fsImpl = fs,
  secretStoreFsImpl = fs,
  beforeRoutes = null,
  workbenchStore = null,
}) => {
  const dataDirectory = await createTemporaryDirectory('ocix-remote-routes-');
  const opencodeConfigDirectory = await createTemporaryDirectory('ocix-remote-routes-opencode-');
  const keys = generatePublisherKeyPair();
  const manifest = createRemoteManifest(keys);
  const requested = [];
  const requests = [];
  let resourceMode = 'ok';
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    requested.push(value);
    requests.push({ url: value, headers: { ...(init?.headers ?? {}) } });
    if (value === 'https://apps.example.com/manifest.json') {
      return new Response(JSON.stringify(manifest.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value === 'https://apps.example.com/ui/overview.view.json') {
      const headers = resourceMode === 'mime'
        ? { 'Content-Type': 'text/plain' }
        : { 'Content-Type': 'application/json' };
      return new Response(JSON.stringify({
        $schema: 'openchamber://declarative-view/v1',
        id: 'com.acme.remote.overview',
        layout: { type: 'text', value: 'Remote' },
      }), {
        status: 200,
        headers,
      });
    }
    if (value === 'https://apps.example.com/ui/icon.svg') {
      return new Response(manifest.icon, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const manager = createInteractiveUIExtensionManager({
    dataDirectory,
    opencodeConfigDirectory,
    fsImpl,
    fetchImpl,
  });
  const connectionStore = createInteractiveUIConnectionStore({
    dataDirectory,
    fsImpl: secretStoreFsImpl,
    pathImpl: path,
    cryptoImpl: crypto,
  });
  const runtime = createInteractiveUIRuntime({
    fsPromises: fs,
    path,
    crypto,
    fetchImpl,
    extensionRoots: async () => [...await manager.getEnabledExtensionRoots()],
    connectionStore,
    // Production wiring (feature-routes-runtime.js): the shared runtime
    // receives the manager-owned Remote Phase R2 lazy resource resolver with
    // the captured authority context forwarded exactly.
    resolveExtensionResource: (extensionId, relativePath, authority) => (
      manager.resolveExtensionResource(extensionId, relativePath, authority)
    ),
  });
  const app = express();
  if (beforeRoutes) beforeRoutes(app);
  registerInteractiveUIRoutes(app, {
    express,
    runtime,
    manager,
    workbenchStore,
    artifactStore: {
      getCapabilities: () => ({ scriptsMode: 'unsupported' }),
      materialize: async () => ({ cacheHit: false, artifactId: 'unused' }),
      getDocument: async () => { throw new Error('unused'); },
      getMetadata: async () => { throw new Error('unused'); },
      clear: async () => ({ removed: 0 }),
      releaseSession: async () => ({ released: 0 }),
    },
  });
  // Deterministic HTTP target: supertest's bare-app auto-listen binds the
  // ephemeral port on :: (IPv6) while an unrelated local service can own the
  // SAME numeric port on 127.0.0.1 (IPv4); supertest then hardcodes requests
  // to http://127.0.0.1:<port>, which can reach that unrelated service (its
  // 401/404). Binding the explicit server to 127.0.0.1 (IPv4) eliminates the
  // address-family collision entirely.
  const server = http.createServer(app);
  httpServers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    // The HTTP target passed to supertest. Despite the name, this is the
    // explicit node:http server (IPv4 loopback), not the Express app.
    app: server,
    dataDirectory,
    opencodeConfigDirectory,
    requested,
    requests,
    runtime,
    manager,
    setResourceMode: (mode) => {
      resourceMode = mode;
    },
  };
};

const connectBody = (inspection, accessKey = 'sk-route-secret') => ({
  appEntryUrl: 'https://apps.example.com/manifest.json',
  accessKey,
  confirmedPublisherFingerprint: inspection.body.publisher.fingerprint,
  confirmedManifestHash: inspection.body.manifest.manifestHash,
});

describe('Remote OCIX routes', () => {
  test('the test HTTP target is bound to IPv4 loopback so requests cannot hit unrelated services', async () => {
    // Contract guard: if this ever regresses to supertest's bare-app
    // auto-listen, the ephemeral port binds on :: (IPv6) and requests
    // hardcoded to 127.0.0.1 can reach an unrelated local IPv4 service.
    const { app } = await createApp({});
    const address = app.address();
    expect(address).not.toBeNull();
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
  });

  test('inspect returns a sanitized review without fetching resources or writing state', async () => {
    const { app, dataDirectory, requested } = await createApp({});
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      extension: { id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', trusted: false },
      permissions: { nativeCode: false, networkOrigins: ['https://api.example.com'] },
      manifest: { appEntryUrl: 'https://apps.example.com/manifest.json' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
    });
    expect(response.body.publisher.fingerprint).toMatch(/^sha256-/);
    expect(JSON.stringify(response.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(requested).toEqual(['https://apps.example.com/manifest.json']);
    expect(await fs.readdir(dataDirectory).then((entries) => entries.includes('interactive-ui'))).toBe(false);
  });

  test('connect stores the key server-side, exposes only metadata, and never fetches resources', async () => {
    const { app, dataDirectory, requested } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection));
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      extension: { id: 'com.acme.remote', version: '1.0.0' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      credential: { configured: true, source: 'manual' },
    });
    expect(JSON.stringify(response.body)).not.toContain('sk-route-secret');
    expect(JSON.stringify(response.body)).not.toContain('trustAdded');
    // The ACTUAL installation identity is hidden behind the opaque capability:
    // the connect HTTP body never contains the stored installationId value or
    // the field name, while the installation-bound credential IS stored.
    const storedId = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json'),
      'utf8',
    )).connections['com.acme.remote:crm'].installationId;
    expect(typeof storedId).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain(storedId);
    expect(JSON.stringify(response.body)).not.toContain('installationId');

    const connections = await request(app).get('/api/interactive-ui/connections');
    expect(connections.body.connections).toEqual([expect.objectContaining({
      extension: expect.objectContaining({ id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' }),
      connector: expect.objectContaining({ id: 'crm', origin: 'https://api.example.com', authType: 'api-key', configurable: true }),
      credential: expect.objectContaining({ configured: true, source: 'manual' }),
    })]);
    expect(JSON.stringify(connections.body)).not.toContain('sk-route-secret');

    const secrets = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json'),
      'utf8',
    ));
    expect(secrets.connections['com.acme.remote:crm'].accessKey).toBe('sk-route-secret');
    expect(secrets.connections['com.acme.remote:crm'].source).toBe('manual');

    const managerSnapshot = await request(app).get('/api/interactive-ui/manager');
    expect(JSON.stringify(managerSnapshot.body)).not.toContain('sk-route-secret');
    expect(managerSnapshot.body.extensions[0].versions['1.0.0'].delivery).toBe('remote');
    expect(managerSnapshot.body.extensions[0].versions['1.0.0'].source).toEqual({
      type: 'remote',
      appEntryUrl: 'https://apps.example.com/manifest.json',
    });
    expect(managerSnapshot.body.extensions[0].versions['1.0.0'].remote).toMatchObject({
      status: 'active',
      connectorRefs: [{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }],
    });
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  test('connect with a wrong confirmation performs no write and returns a sanitized review', async () => {
    const { app, dataDirectory } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send({
        ...connectBody(inspection),
        confirmedManifestHash: 'sha256-wrong',
      });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('remote_confirmation_required');
    expect(response.body.extension.id).toBe('com.acme.remote');
    expect(response.body.connector.id).toBe('crm');
    expect(JSON.stringify(response.body)).not.toContain('sk-route-secret');
    expect(await fs.readdir(dataDirectory).then((entries) => entries.includes('interactive-ui'))).toBe(false);
  });

  test('connect without an access key is rejected before any trust or install write', async () => {
    const { app, dataDirectory, requested } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    for (const accessKey of [undefined, '']) {
      const body = connectBody(inspection);
      if (accessKey === undefined) delete body.accessKey;
      else body.accessKey = accessKey;
      const response = await request(app)
        .post('/api/interactive-ui/manager/remote/connect')
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('remote_access_key_required');
    }
    expect(JSON.stringify(await (await request(app).get('/api/interactive-ui/manager')).body)).not.toContain('sk-route-secret');
    expect((await request(app).get('/api/interactive-ui/manager')).body.extensions).toEqual([]);
    expect(await fs.readdir(dataDirectory).then((entries) => entries.includes('interactive-ui'))).toBe(false);
    expect(requested.filter((url) => url === 'https://apps.example.com/manifest.json').length).toBe(1);
  });

  test('connect preserves an opaque access key with surrounding spaces byte-for-byte', async () => {
    const { app, dataDirectory } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const opaqueKey = ' sk-opaque-key ';
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, opaqueKey));
    expect(response.status).toBe(201);
    expect(response.body.credential.configured).toBe(true);

    // The Secret Store file contains the EXACT string, spaces included.
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    const record = JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'];
    expect(record.accessKey).toBe(' sk-opaque-key ');
    expect(record.accessKey).not.toBe('sk-opaque-key');
    // The key (with and without its spaces) never reaches responses or snapshots.
    expect(JSON.stringify(response.body)).not.toContain(' sk-opaque-key ');
    expect(JSON.stringify(response.body)).not.toContain('sk-opaque-key');
    expect(JSON.stringify(await (await request(app).get('/api/interactive-ui/manager')).body)).not.toContain('sk-opaque-key');
    expect(JSON.stringify((await request(app).get('/api/interactive-ui/connections')).body)).not.toContain('sk-opaque-key');
  });

  test('oversized and control-character access keys reject 400 before any Manager write', async () => {
    const { app, dataDirectory, opencodeConfigDirectory, requested } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const invalidKeys = [
      'a'.repeat(16 * 1024 + 1),
      'key\r\nmore',
      'key\0more',
      'key\tmore',
      'key\x1bmore',
      'key\x7fmore',
    ];
    for (const invalidKey of invalidKeys) {
      const response = await request(app)
        .post('/api/interactive-ui/manager/remote/connect')
        .send(connectBody(inspection, invalidKey));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('remote_access_key_invalid');
      expect(JSON.stringify(response.body)).not.toContain(invalidKey);
      expect(JSON.stringify(response.body)).not.toContain(invalidKey.slice(0, 16));
    }

    // Rejected BEFORE manager.connectRemote: no trust, no state, no shell, no
    // Agent Runtime shim, no credential file, and no additional Manifest fetch.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await request(app).get('/api/interactive-ui/manager')).body.extensions).toEqual([]);
    expect((await request(app).get('/api/interactive-ui/manager')).body.publishers).toEqual([]);
    expect(requested.filter((url) => url === 'https://apps.example.com/manifest.json').length).toBe(1);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  test('a paused Remote connect serializes against a generic PUT, cleans up first, and a later reconnect succeeds', async () => {
    let putArrived;
    const putArrivedGate = new Promise((resolve) => { putArrived = resolve; });
    const { app, dataDirectory, runtime } = await createApp({
      beforeRoutes: (app) => {
        app.use('/api/interactive-ui/connections/:extensionId/:connectorId', (req, _res, next) => {
          if (req.method === 'PUT') putArrived();
          next();
        });
      },
    });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });

    // Seam: A's Remote connect completes the Manager shell install, then
    // pauses BEFORE credential configuration while holding the real mutation
    // coordinator. Releasing the gate injects a credential failure so A's
    // cleanup + rollback completes before any other queued mutation runs.
    let releaseA;
    let reachedConfigure;
    let gated = false;
    const gate = new Promise((resolve) => { releaseA = resolve; });
    const reachedGate = new Promise((resolve) => { reachedConfigure = resolve; });
    const originalConfigure = runtime.configureRemoteConnection.bind(runtime);
    runtime.configureRemoteConnection = async (extensionId, connectorId, installationId, accessKey) => {
      if (gated) return originalConfigure(extensionId, connectorId, installationId, accessKey);
      gated = true;
      reachedConfigure();
      await gate;
      const error = new Error('injected remote configuration failure');
      error.code = 'remote_configuration_failed';
      error.status = 500;
      throw error;
    };

    const requestA = request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-key-a'));
    const reachedOrFailed = await Promise.race([
      reachedGate.then(() => true),
      requestA.then(() => false, () => false),
    ]);
    if (!reachedOrFailed) throw new Error('connect A did not reach credential configuration');

    // B's generic PUT reaches Express during the pause (proven by the
    // pre-route middleware) and must wait on the coordinator. Promise.resolve
    // forces supertest to dispatch the request immediately.
    const requestB = Promise.resolve(request(app)
      .put('/api/interactive-ui/connections/com.acme.remote/crm')
      .send({ accessKey: 'sk-put-key' }));
    await putArrivedGate;

    // Release A: its failure surfaces, cleanup + rollback complete, and only
    // then does B's queued mutation run.
    releaseA();
    const responseA = await requestA;
    expect(responseA.status).toBe(500);
    expect(responseA.body.code).toBe('remote_configuration_failed');
    expect(responseA.body).toMatchObject({
      credentialRemoved: false,
      extensionRemoved: true,
      trustRolledBack: true,
    });
    const serializedA = JSON.stringify(responseA.body);
    expect(serializedA).not.toContain('sk-key-a');
    expect(serializedA).not.toContain('installationId');
    expect(serializedA).not.toContain('trustAdded');

    // B fails safely: the shell is gone, so no credential can be written.
    const responseB = await requestB;
    expect(responseB.status).toBe(404);
    expect(responseB.body.code).toBe('extension_not_found');
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    await expect(fs.stat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' });

    // The queue continues after the errors: a normal reconnect C succeeds.
    const connectC = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-key-c'));
    expect(connectC.status).toBe(201);
    expect(connectC.body.credential.configured).toBe(true);
    expect(JSON.stringify(connectC.body)).not.toContain('sk-key-c');
    expect(JSON.stringify(connectC.body)).not.toContain('installationId');
    const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    expect(secrets.connections['com.acme.remote:crm'].accessKey).toBe('sk-key-c');
    const connections = await request(app).get('/api/interactive-ui/connections');
    expect(connections.body.connections[0].credential.configured).toBe(true);
    expect(JSON.stringify(connections.body)).not.toContain('sk-key-c');
  });

  test('credential failure rolls back the shell and freshly added trust without exposing the key', async () => {
    let failSecretWrite = false;
    const failingSecretFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (source, destination) => {
            if (failSecretWrite && destination.endsWith('connection-secrets.json')) {
              const error = new Error('injected secret store failure');
              error.code = 'connection_store_failed';
              error.status = 500;
              throw error;
            }
            return target.rename(source, destination);
          };
        }
        return target[property];
      },
    });
    const { app, dataDirectory } = await createApp({ secretStoreFsImpl: failingSecretFs });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    failSecretWrite = true;

    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection));
    expect(response.status).toBe(500);
    expect(response.body.code).toBe('connection_store_failed');
    expect(response.body).toMatchObject({
      credentialRemoved: false,
      extensionRemoved: true,
      trustRolledBack: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('sk-route-secret');

    const managerSnapshot = await request(app).get('/api/interactive-ui/manager');
    expect(managerSnapshot.body.extensions).toEqual([]);
    expect(managerSnapshot.body.publishers).toEqual([]);
    const connections = await request(app).get('/api/interactive-ui/connections');
    expect(connections.body.connections).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('generic PUT after a Remote connect replaces the key but reuses the installation identity', async () => {
    const { app, dataDirectory } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-first-key'));
    expect(connect.status).toBe(201);
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    const firstRecord = JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'];
    expect(firstRecord.accessKey).toBe('sk-first-key');

    const put = await request(app)
      .put('/api/interactive-ui/connections/com.acme.remote/crm')
      .send({ accessKey: 'sk-replacement-key' });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain('sk-replacement-key');
    const secondRecord = JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'];
    expect(secondRecord.accessKey).toBe('sk-replacement-key');
    // The generic manual setter keeps the existing installation identity.
    expect(secondRecord.installationId).toBe(firstRecord.installationId);
  });

  test('generic DELETE removes an orphan credential after the shell is gone', async () => {
    const { app, dataDirectory } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-orphan-key'));
    expect(connect.status).toBe(201);
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect(JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe('sk-orphan-key');

    // Lose the shell/manifest while the credential record still exists.
    await fs.rm(path.join(dataDirectory, 'extensions', 'com.acme.remote'), { recursive: true, force: true });
    const del = await request(app).delete('/api/interactive-ui/connections/com.acme.remote/crm');
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ removed: true });
    const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    expect(secrets.connections['com.acme.remote:crm']).toBeUndefined();
  });

  test('Remote conditional cleanup removes an orphan credential without the shell', async () => {
    const { app, dataDirectory, runtime } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-orphan-key'));
    expect(connect.status).toBe(201);
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    const installationId = JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].installationId;

    await fs.rm(path.join(dataDirectory, 'extensions', 'com.acme.remote'), { recursive: true, force: true });
    const removed = await runtime.removeRemoteConnection('com.acme.remote', 'crm', installationId);
    expect(removed).toEqual({ removed: true });
    const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    expect(secrets.connections['com.acme.remote:crm']).toBeUndefined();
  });

  test('uninstall cleanup failure leaves the extension and its secret owner in place and never claims removal', async () => {
    const { app, dataDirectory, runtime, manager } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-uninstall-key'));
    expect(connect.status).toBe(201);
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');

    let uninstallCalls = 0;
    const originalUninstall = manager.uninstall.bind(manager);
    manager.uninstall = async (extensionId) => {
      uninstallCalls += 1;
      return originalUninstall(extensionId);
    };
    const originalRemove = runtime.removeExtensionConnections.bind(runtime);
    runtime.removeExtensionConnections = async () => {
      const error = new Error('injected credential cleanup failure');
      error.code = 'credential_cleanup_failed';
      error.status = 500;
      throw error;
    };

    const del = await request(app).delete('/api/interactive-ui/manager/extensions/com.acme.remote');
    expect(del.status).toBe(500);
    expect(del.body.code).toBe('credential_cleanup_failed');
    expect(del.body.extensionRemoved).toBe(false);
    expect(JSON.stringify(del.body)).not.toContain('sk-uninstall-key');
    // The managed extension was never removed: the secret still has an owner.
    expect(uninstallCalls).toBe(0);
    expect((await request(app).get('/api/interactive-ui/manager')).body.extensions[0].id).toBe('com.acme.remote');
    expect(JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe('sk-uninstall-key');

    // A later retry with working cleanup succeeds.
    runtime.removeExtensionConnections = originalRemove;
    const retry = await request(app).delete('/api/interactive-ui/manager/extensions/com.acme.remote');
    expect(retry.status).toBe(200);
    expect(retry.body.removed).toBe(true);
    expect(uninstallCalls).toBe(1);
  });

  test('workbench cleanup failure leaves the extension installed and the secret owned', async () => {
    let failWorkbench = true;
    const workbenchStore = {
      removeExtensionTiles: async () => {
        if (failWorkbench) {
          const error = new Error('injected workbench cleanup failure');
          error.code = 'workbench_cleanup_failed';
          error.status = 500;
          throw error;
        }
        return { removed: 0, projects: 0 };
      },
    };
    const { app, dataDirectory } = await createApp({ workbenchStore });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-workbench-key'));
    expect(connect.status).toBe(201);
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');

    const del = await request(app).delete('/api/interactive-ui/manager/extensions/com.acme.remote');
    expect(del.status).toBe(500);
    expect(del.body.code).toBe('workbench_cleanup_failed');
    expect(del.body.extensionRemoved).toBe(false);
    expect(JSON.stringify(del.body)).not.toContain('sk-workbench-key');
    // The shell was never removed, and the credential was already cleaned up
    // (or still owned) — never an ownerless secret.
    expect((await request(app).get('/api/interactive-ui/manager')).body.extensions[0].id).toBe('com.acme.remote');
    const secretsAfterFailure = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    if (secretsAfterFailure.connections?.['com.acme.remote:crm']) {
      expect(secretsAfterFailure.connections['com.acme.remote:crm'].accessKey).toBe('sk-workbench-key');
    }

    failWorkbench = false;
    const retry = await request(app).delete('/api/interactive-ui/manager/extensions/com.acme.remote');
    expect(retry.status).toBe(200);
    expect(retry.body.removed).toBe(true);
  });

  test('coordinators are scoped per manager: app B mutations do not wait on app A', async () => {
    const { app: appA, runtime: runtimeA } = await createApp({});
    const { app: appB } = await createApp({});
    let releaseA;
    let reached;
    let gated = false;
    const gate = new Promise((resolve) => { releaseA = resolve; });
    const reachedGate = new Promise((resolve) => { reached = resolve; });
    const original = runtimeA.configureRemoteConnection.bind(runtimeA);
    runtimeA.configureRemoteConnection = async (...args) => {
      if (gated) return original(...args);
      gated = true;
      reached();
      await gate;
      return original(...args);
    };

    const inspectionA = await request(appA)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const requestA = Promise.resolve(request(appA)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspectionA, 'sk-a')));
    const reachedOrFailed = await Promise.race([
      reachedGate.then(() => true),
      requestA.then(() => false, () => false),
    ]);
    if (!reachedOrFailed) throw new Error('connect A did not reach credential configuration');

    // App B's full Remote connect (including its Secret Store write) completes
    // while app A's secret operation is paused on its own coordinator.
    const inspectionB = await request(appB)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connectB = await request(appB)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspectionB, 'sk-b'));
    expect(connectB.status).toBe(201);
    expect(connectB.body.credential.configured).toBe(true);
    expect(JSON.stringify(connectB.body)).not.toContain('sk-b');

    releaseA();
    const responseA = await requestA;
    expect(responseA.status).toBe(201);
    expect(responseA.body.credential.configured).toBe(true);
    expect(JSON.stringify(responseA.body)).not.toContain('sk-a');
    expect(JSON.stringify(responseA.body)).not.toContain('installationId');
  });

  test('a connected Remote view and icon are lazily fetched and served through the runtime APIs', async () => {
    const { app, requested } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection));
    expect(connect.status).toBe(201);
    // Connect/list remain metadata-only: no resource URL was requested.
    expect(requested.some((url) => url.includes('/ui/'))).toBe(false);

    // The registry lists the metadata-only shell without fetching resources.
    const registry = await request(app).get('/api/interactive-ui/extensions');
    expect(registry.status).toBe(200);
    expect(registry.body.extensions[0]).toMatchObject({ id: 'com.acme.remote', iconPath: '/api/interactive-ui/extensions/com.acme.remote/icon' });
    expect(requested.some((url) => url.includes('/ui/'))).toBe(false);

    // The first actual view load fetches ONLY the declared view resource and
    // serves it through the existing descriptor route.
    const view = await request(app).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(view.status).toBe(200);
    expect(view.body.declarative).toMatchObject({ $schema: 'openchamber://declarative-view/v1' });
    expect(requested.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(1);
    expect(requested.some((url) => url === 'https://apps.example.com/ui/icon.svg')).toBe(false);

    // A repeated load inside the TTL is a verified cache hit: no second fetch.
    const again = await request(app).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(again.status).toBe(200);
    expect(requested.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(1);

    // The icon is a separate lazy fetch served through the existing icon route.
    const icon = await request(app).get('/api/interactive-ui/extensions/com.acme.remote/icon');
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toBe('image/svg+xml');
    // Icon responses are binary: assert on the raw body, never on .text.
    const iconBody = Buffer.isBuffer(icon.body) ? icon.body : Buffer.from(icon.text ?? '');
    expect(iconBody.toString('utf8')).toContain('<svg');
    expect(requested.filter((url) => url === 'https://apps.example.com/ui/icon.svg')).toHaveLength(1);

    // The metadata-only shell still has no materialized resource tree.
    const managerSnapshot = await request(app).get('/api/interactive-ui/manager');
    expect(managerSnapshot.body.extensions[0].integrity).toEqual({ status: 'ready' });
  });

  test('a failing Remote resource load returns a stable sanitized error and never serves or caches bytes', async () => {
    const { app, requested, setResourceMode } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection));
    expect(connect.status).toBe(201);

    // The upstream serves a Content-Type that does not match the signed
    // mimeType: the route must fail closed with a stable sanitized error that
    // never leaks upstream details.
    setResourceMode('mime');
    const failing = await request(app).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(failing.status).toBe(403);
    expect(failing.body.code).toBe('hosted_resource_mime_mismatch');
    expect(failing.body.error).toBe('Remote extension resource is unavailable');
    expect(JSON.stringify(failing.body)).not.toContain('apps.example.com');

    // The failed attempt left no usable cache: a corrected upstream refetches.
    setResourceMode('ok');
    const retry = await request(app).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(retry.status).toBe(200);
    expect(requested.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(2);
  });

  test('Remote resource fetches, cache bytes, and served bytes never contain the connector Access Key', async () => {
    const { app, dataDirectory, requests } = await createApp({});
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: 'https://apps.example.com/manifest.json' });
    const connect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-lazy-secret-42'));
    expect(connect.status).toBe(201);

    // Sanity: the connector Access Key IS stored, owned by the connection.
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect(JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe('sk-lazy-secret-42');

    // Lazy resource loads through the runtime APIs.
    const view = await request(app).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    const icon = await request(app).get('/api/interactive-ui/extensions/com.acme.remote/icon');
    expect(icon.status).toBe(200);

    // The Access Key never enters resource request URLs or headers or served
    // responses. The Remote cache is manager-owned, process-lifetime, and
    // IN-MEMORY: no on-disk cache directory is ever created.
    for (const record of requests) {
      expect(record.url).not.toContain('sk-lazy-secret-42');
      expect(JSON.stringify(record.headers)).not.toContain('sk-lazy-secret-42');
    }
    expect(JSON.stringify(view.body)).not.toContain('sk-lazy-secret-42');
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
