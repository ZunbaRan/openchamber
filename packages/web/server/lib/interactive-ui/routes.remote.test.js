import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  canonicalStringify,
} from './hosted-ocix.js';
import { createInteractiveUIExtensionManager } from './manager.js';
import { generatePublisherKeyPair } from './package-format.js';
import { registerInteractiveUIRoutes } from './routes.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

const manifestUrl = 'https://apps.example.com/manifest.json';

const createRemoteManifest = ({ keys = generatePublisherKeyPair(), version = '1.0.0' } = {}) => {
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.remote.overview',
    layout: { type: 'text', value: `Remote ${version}` },
  }));
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {
      id: 'com.acme.remote',
      version,
      publishedAt: '2026-08-05T00:00:00.000Z',
    },
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
      agentToolNames: [],
      clipboard: false,
      popups: false,
      nativeCode: false,
    },
    extension: {
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version,
      permissions: { network: ['https://api.example.com'] },
      connectors: [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
      }],
      actions: [{
        id: 'com.acme.remote.read',
        connector: 'crm',
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }],
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/overview.view.json',
        displayModes: ['inline'],
      }],
      trust: { mode: 'declarative', signature: 'production' },
    },
    resources: [{
      path: 'ui/overview.view.json',
      url: 'https://apps.example.com/ui/overview.view.json',
      mimeType: 'application/json',
      sha256: `sha256-${crypto.createHash('sha256').update(view).digest('base64')}`,
    }],
  };
  return {
    keys,
    document: {
      ...unsigned,
      signature: {
        algorithm: 'ed25519',
        keyId: 'release-2026',
        value: crypto.sign(
          null,
          Buffer.from(canonicalStringify(unsigned)),
          crypto.createPrivateKey(keys.privateKey),
        ).toString('base64'),
      },
    },
  };
};

const createApp = async ({
  runtimeOverrides = {},
  uiAuthController = null,
  initialManifest = createRemoteManifest(),
} = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-remote-routes-'));
  temporaryDirectories.push(dataDirectory);
  const holder = { document: initialManifest.document };
  const requested = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    requested.push(value);
    if (value === manifestUrl) {
      return new Response(JSON.stringify(holder.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const manager = createInteractiveUIExtensionManager({
    dataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    fetchImpl,
    validateStagedPackage: async () => {},
    validateRemoteMetadata: async ({ extension }) => extension,
    reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
  });
  const connectionStore = createInteractiveUIConnectionStore({
    dataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    fetchImpl,
  });
  const runtime = {
    configureRemoteConnection: async (...args) => ({
      credential: await connectionStore.setRemoteCredential(...args),
    }),
    removeRemoteConnection: (...args) => connectionStore.removeRemoteCredential(...args),
    getRoutingCapabilities: async () => ({ remote: true }),
    ...runtimeOverrides,
  };
  const app = express();
  if (typeof uiAuthController?.requireAuth === 'function') {
    app.use('/api', (req, res, next) => {
      Promise.resolve(uiAuthController.requireAuth(req, res, next)).catch(next);
    });
  }
  registerInteractiveUIRoutes(app, {
    express,
    runtime,
    manager,
    artifactStore: {
      getCapabilities: () => ({ scriptsMode: 'unsupported' }),
      materialize: async () => ({ cacheHit: false, artifactId: 'unused' }),
      getDocument: async () => { throw new Error('unused'); },
      getMetadata: async () => { throw new Error('unused'); },
      clear: async () => ({ removed: 0 }),
      releaseSession: async () => ({ released: 0 }),
    },
  });
  return {
    app,
    dataDirectory,
    holder,
    initialManifest,
    manager,
    requested,
  };
};

const connectBody = (inspection, accessKey = 'sk-route-secret') => ({
  appEntryUrl: manifestUrl,
  accessKey,
  confirmedPublisherFingerprint: inspection.body.publisher.fingerprint,
  confirmedManifestHash: inspection.body.manifest.manifestHash,
});

const managerPaths = (dataDirectory) => ({
  trust: path.join(dataDirectory, 'interactive-ui', 'trust.json'),
  state: path.join(dataDirectory, 'interactive-ui', 'installations.json'),
  secrets: path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json'),
});

describe('Direct Remote OCIX routes', () => {
  test('composes with the global local/tunnel auth gate and keeps inspect write-free', async () => {
    const calls = [];
    const { app, dataDirectory, requested, initialManifest } = await createApp({
      uiAuthController: {
        requireAuth(req, res, next) {
          calls.push(`${req.method} ${req.originalUrl}`);
          if (req.headers.authorization !== 'Bearer test-client'
            && !req.headers.cookie?.includes('oc_tunnel_session=test-tunnel')) {
            res.status(401).json({ locked: true });
            return;
          }
          next();
        },
      },
    });

    const body = { appEntryUrl: manifestUrl };
    await request(app).post('/api/interactive-ui/manager/remote/inspect').send(body).expect(401);
    const local = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .set('Authorization', 'Bearer test-client')
      .send(body)
      .expect(200);
    const tunnel = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .set('Cookie', 'oc_tunnel_session=test-tunnel')
      .send(body)
      .expect(200);

    expect(local.body.extension).toMatchObject({ id: 'com.acme.remote', version: '1.0.0' });
    expect(tunnel.body.manifest.manifestHash).toBe(local.body.manifest.manifestHash);
    expect(tunnel.body.publisher).toMatchObject({
      id: 'com.acme.publisher',
      keyId: 'release-2026',
      trusted: false,
    });
    expect(JSON.stringify(local.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(local.body)).not.toContain(dataDirectory);
    expect(JSON.stringify(local.body)).not.toContain(initialManifest.keys.privateKey);
    expect(calls).toEqual([
      'POST /api/interactive-ui/manager/remote/inspect',
      'POST /api/interactive-ui/manager/remote/inspect',
      'POST /api/interactive-ui/manager/remote/inspect',
    ]);
    expect(requested).toEqual([manifestUrl, manifestUrl]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('inspect returns a sanitized review without resource fetches, trust, state, or secret writes', async () => {
    const { app, dataDirectory, requested, initialManifest } = await createApp();
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);

    expect(response.body).toMatchObject({
      extension: { id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', trusted: false },
      permissions: { networkOrigins: ['https://api.example.com'] },
      manifest: { appEntryUrl: manifestUrl },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
    });
    expect(response.body.publisher.fingerprint).toMatch(/^sha256-/);
    expect(JSON.stringify(response.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(response.body)).not.toContain(initialManifest.keys.privateKey);
    expect(requested).toEqual([manifestUrl]);
    const paths = managerPaths(dataDirectory);
    for (const file of Object.values(paths)) {
      await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  test('connect refetches and binds exact manifest consent while keeping opaque keys server-side', async () => {
    const initialManifest = createRemoteManifest();
    const { app, dataDirectory, holder, requested, manager } = await createApp({ initialManifest });
    const firstInspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const staleBody = connectBody(firstInspection, ' sk-route-secret ');

    holder.document = createRemoteManifest({ keys: initialManifest.keys, version: '2.0.0' }).document;
    const stale = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(staleBody)
      .expect(403);
    expect(stale.body.code).toBe('remote_confirmation_required');
    expect(stale.body.extension.version).toBe('2.0.0');
    expect(JSON.stringify(stale.body)).not.toContain('sk-route-secret');
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });

    const currentInspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    let connectedResult;
    const originalConnect = manager.connectRemote.bind(manager);
    manager.connectRemote = async (...args) => {
      connectedResult = await originalConnect(...args);
      return connectedResult;
    };
    const connected = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(currentInspection, ' sk-route-secret '))
      .expect(201);

    expect(requested.filter((url) => url === manifestUrl)).toHaveLength(4);
    expect(connected.body).toMatchObject({
      extension: { id: 'com.acme.remote', version: '2.0.0' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      credential: { configured: true, source: 'manual' },
    });
    expect(Object.keys(connectedResult)).toEqual(['extension', 'connector']);
    expect(Object.prototype.propertyIsEnumerable.call(connectedResult, 'capability')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(connectedResult, 'installationId')).toBe(false);

    const paths = managerPaths(dataDirectory);
    const secretRecord = JSON.parse(await fs.readFile(paths.secrets, 'utf8')).connections['com.acme.remote:crm'];
    expect(secretRecord.accessKey).toBe(' sk-route-secret ');
    const managerSnapshot = await request(app).get('/api/interactive-ui/manager').expect(200);
    const serialized = JSON.stringify({ connected: connected.body, manager: managerSnapshot.body });
    expect(serialized).not.toContain('sk-route-secret');
    expect(serialized).not.toContain('installationId');
    expect(serialized).not.toContain('BEGIN PUBLIC KEY');
    expect(serialized).not.toContain(dataDirectory);
    expect(managerSnapshot.body.publishers).toEqual([]);
    await expect(fs.stat(paths.trust)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('wrong confirmation and invalid access key reject before any durable mutation', async () => {
    const { app, dataDirectory, requested } = await createApp();
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const wrongConfirmation = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send({
        ...connectBody(inspection),
        confirmedPublisherFingerprint: `sha256-${'0'.repeat(44)}`,
      })
      .expect(403);
    expect(wrongConfirmation.body.code).toBe('remote_confirmation_required');
    expect(JSON.stringify(wrongConfirmation.body)).not.toContain('sk-route-secret');

    const invalidKey = 'bad\u0007key';
    const invalid = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, invalidKey))
      .expect(400);
    expect(invalid.body.code).toBe('remote_access_key_invalid');
    expect(JSON.stringify(invalid.body)).not.toContain('bad');
    expect(requested).toHaveLength(2); // inspect + confirmation refetch; invalid key is pre-manager.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('credential configure failure rolls back only the new shell and leaves global trust untouched', async () => {
    const { app, dataDirectory } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => {
          const error = new Error('credential configuration failed');
          error.code = 'credential_configure_failed';
          error.status = 502;
          throw error;
        },
        removeRemoteConnection: async () => ({ removed: false }),
      },
    });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-failing-secret'))
      .expect(502);

    expect(response.body).toMatchObject({
      code: 'remote_credential_configure_failed',
      credentialRemoved: false,
      extensionRemoved: true,
      trustRolledBack: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('sk-failing-secret');
    expect(JSON.stringify(response.body)).not.toContain('installationId');
    expect(JSON.stringify(response.body)).not.toContain(dataDirectory);
    const snapshot = await request(app).get('/api/interactive-ui/manager').expect(200);
    expect(snapshot.body.extensions).toEqual([]);
    expect(snapshot.body.publishers).toEqual([]);
    const paths = managerPaths(dataDirectory);
    await expect(fs.stat(paths.secrets)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(paths.trust)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves the new shell when conditional credential cleanup reports an installation mismatch', async () => {
    const { app, dataDirectory } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => {
          const error = new Error('accessKey=sk-mismatch-secret path=/private/secret installationId=install-mismatch');
          error.code = 'credential_configure_failed';
          error.status = 502;
          error.details = {
            accessKey: 'sk-mismatch-secret',
            path: '/private/secret',
            installationId: 'install-mismatch',
          };
          throw error;
        },
        removeRemoteConnection: async () => ({ removed: false, mismatch: true }),
      },
    });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-mismatch-secret'))
      .expect(502);

    expect(response.body).toMatchObject({
      error: 'Remote credential configuration failed',
      code: 'remote_credential_configure_failed',
      credentialRemoved: false,
      credentialMismatch: true,
      extensionRemoved: false,
      rollbackSkipped: true,
      trustRolledBack: false,
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('sk-mismatch-secret');
    expect(serialized).not.toContain('/private/secret');
    expect(serialized).not.toContain('install-mismatch');
    const snapshot = await request(app).get('/api/interactive-ui/manager').expect(200);
    expect(snapshot.body.extensions).toHaveLength(1);
    expect(snapshot.body.publishers).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves the new shell when conditional credential cleanup throws and returns only safe recovery fields', async () => {
    const { app, dataDirectory } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => {
          const error = new Error('runtime leaked sk-remove-secret at /private/runtime');
          error.code = 'runtime_credential_failure';
          error.status = 503;
          error.details = {
            accessKey: 'sk-remove-secret',
            path: '/private/runtime',
            installationId: 'install-remove',
          };
          throw error;
        },
        removeRemoteConnection: async () => {
          const error = new Error('remove leaked sk-remove-secret at /private/remove');
          error.code = 'remove_credential_failure';
          error.details = {
            accessKey: 'sk-remove-secret',
            path: '/private/remove',
            installationId: 'install-remove',
          };
          throw error;
        },
      },
    });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-remove-secret'))
      .expect(503);

    expect(response.body).toMatchObject({
      error: 'Remote credential configuration failed',
      code: 'remote_credential_configure_failed',
      credentialRemoved: false,
      extensionRemoved: false,
      rollbackSkipped: true,
      trustRolledBack: false,
      credentialRollbackError: 'remote_credential_rollback_failed',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('runtime leaked');
    expect(serialized).not.toContain('remove leaked');
    expect(serialized).not.toContain('sk-remove-secret');
    expect(serialized).not.toContain('/private/');
    expect(serialized).not.toContain('install-remove');
    const snapshot = await request(app).get('/api/interactive-ui/manager').expect(200);
    expect(snapshot.body.extensions).toHaveLength(1);
    expect(snapshot.body.publishers).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('allowlists successful credential summaries before returning them', async () => {
    const { app } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => ({
          credential: {
            configured: true,
            source: 'manual',
            displayName: 'CRM',
            accessKey: 'sk-success-secret',
            installationId: 'install-success',
            path: '/private/secret',
            arbitrary: { secret: 'nested-leak' },
          },
          runtimeSecret: 'runtime-secret',
        }),
      },
    });
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    const response = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-success-secret'))
      .expect(201);

    expect(response.body.credential).toEqual({
      configured: true,
      source: 'manual',
      displayName: 'CRM',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('sk-success-secret');
    expect(serialized).not.toContain('install-success');
    expect(serialized).not.toContain('/private/secret');
    expect(serialized).not.toContain('nested-leak');
    expect(serialized).not.toContain('runtime-secret');
  });

  test('a failed reconnect preserves an existing valid shell and credential', async () => {
    const { app, dataDirectory } = await createApp();
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-original-secret'))
      .expect(201);

    const reconnect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection, 'sk-replacement-secret'))
      .expect(409);
    expect(reconnect.body.code).toBe('remote_extension_installed');
    expect(JSON.stringify(reconnect.body)).not.toContain('sk-replacement-secret');
    const paths = managerPaths(dataDirectory);
    const record = JSON.parse(await fs.readFile(paths.secrets, 'utf8')).connections['com.acme.remote:crm'];
    expect(record.accessKey).toBe('sk-original-secret');
    const snapshot = await request(app).get('/api/interactive-ui/manager').expect(200);
    expect(snapshot.body.extensions).toHaveLength(1);
    expect(snapshot.body.extensions[0]).toMatchObject({ id: 'com.acme.remote', activeVersion: '1.0.0' });
    expect(snapshot.body.publishers).toEqual([]);
  });
});
