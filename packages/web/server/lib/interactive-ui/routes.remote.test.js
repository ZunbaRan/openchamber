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
import { InteractiveUIRuntimeError } from './runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

const manifestUrl = 'https://apps.example.com/manifest.json';

const createRemoteManifest = ({
  keys = generatePublisherKeyPair(),
  version = '1.0.0',
  extraAction = false,
  update = undefined,
} = {}) => {
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
    ...(update !== undefined ? { update } : {}),
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
      actionIds: extraAction
        ? ['com.acme.remote.read', 'com.acme.remote.export']
        : ['com.acme.remote.read'],
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
      actions: extraAction
        ? [{
          id: 'com.acme.remote.read',
          connector: 'crm',
          risk: 'read',
          request: { method: 'GET', path: '/crm' },
        }, {
          id: 'com.acme.remote.export',
          connector: 'crm',
          risk: 'write',
          request: { method: 'POST', path: '/crm/export' },
        }]
        : [{
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
    let credentialStatusReads = 0;
    const { app, dataDirectory } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => {
          const error = new Error('credential configuration failed');
          error.code = 'credential_configure_failed';
          Object.defineProperty(error, 'status', {
            get() {
              credentialStatusReads += 1;
              return 599;
            },
          });
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
    expect(credentialStatusReads).toBe(0);
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
    let credentialGetterReads = 0;
    const credential = {
      configured: true,
      source: 'manual',
      name: 'CRM',
      endpoint: 'https://api.example.com/crm?accessKey=sk-endpoint-secret#install-success',
      accessKey: 'sk-success-secret',
      installationId: 'install-success',
      path: '/private/secret',
      arbitrary: { secret: 'nested-leak' },
    };
    Object.defineProperty(credential, 'displayName', {
      enumerable: true,
      get() {
        credentialGetterReads += 1;
        return 'sk-summary-getter-secret';
      },
    });
    const { app } = await createApp({
      runtimeOverrides: {
        configureRemoteConnection: async () => ({
          credential,
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
      name: 'CRM',
    });
    expect(credentialGetterReads).toBe(0);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('sk-success-secret');
    expect(serialized).not.toContain('install-success');
    expect(serialized).not.toContain('/private/secret');
    expect(serialized).not.toContain('nested-leak');
    expect(serialized).not.toContain('runtime-secret');
    expect(serialized).not.toContain('sk-endpoint-secret');
    expect(serialized).not.toContain('sk-summary-getter-secret');
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

  test('pins the canonical Remote trust error and strips hostile nested diagnostics', async () => {
    const accessKey = 'sk-inner-route-secret';
    const privatePath = '/private/interactive-ui/connection-secrets.json';
    const installationId = 'install-inner-route';
    const inheritedSecret = 'sk-inherited-route-secret';
    const extension = Object.create({ name: inheritedSecret });
    extension.id = 'com.acme.safe';
    extension.version = '1.0.0';
    let nestedGetterReads = 0;
    const hostilePermissions = {};
    Object.defineProperty(hostilePermissions, 'networkOrigins', {
      enumerable: true,
      get() {
        nestedGetterReads += 1;
        return [`https://user:${accessKey}@example.test/${installationId}`];
      },
    });
    const unsafePermissions = {
      networkOrigins: [`https://user:${accessKey}@example.test/private/${installationId}`],
      credentialScopes: [privatePath],
      actionIds: [`/private/${installationId}`],
      agentToolNames: [`sk_${installationId}`],
    };
    const { app } = await createApp({
      runtimeOverrides: {
        getRoutingCapabilities: async () => {
          throw new InteractiveUIRuntimeError(
            'Remote trust failed',
            403,
            'remote_trust_invalid',
            {
            // This is the shape produced when Manager wraps a lifecycle
            // health reason.  It must not replace the outer stable code.
            code: 'remote_trust_conflict',
            error: 'spoofed outer error',
            message: 'spoofed outer message',
            status: 200,
            accessKey,
            path: privatePath,
            installationId,
              authority: '/private/authority',
              extension,
              permissions: hostilePermissions,
              addedPermissions: unsafePermissions,
            },
          );
        },
      },
    });

    const response = await request(app)
      .get('/api/interactive-ui/capabilities')
      .expect(403);

    expect(response.body).toMatchObject({
      error: 'Remote trust failed',
      code: 'remote_trust_invalid',
      reason: 'remote_trust_conflict',
      extension: { id: 'com.acme.safe', version: '1.0.0' },
    });
    expect(response.body.extension.name).toBeUndefined();
    expect(response.body.authority).toBeUndefined();
    expect(response.body.permissions).toBeUndefined();
    expect(response.body.addedPermissions).toBeUndefined();
    expect(response.body.status).toBeUndefined();
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(accessKey);
    expect(serialized).not.toContain(privatePath);
    expect(serialized).not.toContain(installationId);
    expect(serialized).not.toContain(inheritedSecret);
    expect(serialized).not.toContain('spoofed outer');
    expect(nestedGetterReads).toBe(0);
  });

  test('maps untrusted adapter errors to a fixed envelope without reading hostile details', async () => {
    const outerSecret = 'sk-outer-route-secret';
    const privatePath = '/private/manager-state.json';
    let getterReads = 0;
    const hostileDetails = {};
    Object.defineProperty(hostileDetails, 'extension', {
      enumerable: true,
      get() {
        getterReads += 1;
        return { id: 'com.acme.safe', name: outerSecret };
      },
    });
    const { app } = await createApp({
      runtimeOverrides: {
        getRoutingCapabilities: async () => {
          const error = new Error(`accessKey=${outerSecret} path=${privatePath}`);
          error.status = 403;
          error.code = 'remote_trust_invalid';
          error.details = hostileDetails;
          throw error;
        },
      },
    });

    const response = await request(app)
      .get('/api/interactive-ui/capabilities')
      .expect(500);

    expect(response.body).toEqual({
      error: 'Interactive UI request failed',
      code: 'internal_error',
    });
    expect(getterReads).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain(outerSecret);
    expect(JSON.stringify(response.body)).not.toContain(privatePath);
  });

  test('does not invoke accessors on a trusted error envelope', async () => {
    const secret = 'sk-trusted-accessor-secret';
    let getterReads = 0;
    const { app } = await createApp({
      runtimeOverrides: {
        getRoutingCapabilities: async () => {
          const error = new InteractiveUIRuntimeError(
            'initial safe message',
            403,
            'remote_trust_invalid',
          );
          Object.defineProperty(error, 'message', {
            configurable: true,
            get() {
              getterReads += 1;
              return secret;
            },
          });
          Object.defineProperty(error, 'details', {
            configurable: true,
            get() {
              getterReads += 1;
              return { extension: { id: 'com.acme.safe', name: secret } };
            },
          });
          throw error;
        },
      },
    });

    const response = await request(app)
      .get('/api/interactive-ui/capabilities')
      .expect(403);

    expect(response.body).toEqual({
      error: 'Interactive UI request failed',
      code: 'remote_trust_invalid',
    });
    expect(getterReads).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  test('keeps route-owned validation failures on their stable 400 contracts', async () => {
    const { app } = await createApp();

    const invalidPackage = await request(app)
      .post('/api/interactive-ui/manager/packages/inspect')
      .send({ packageBase64: 'not-base64' })
      .expect(400);
    expect(invalidPackage.body).toEqual({
      error: 'Extension package must be valid base64',
      code: 'invalid_package_encoding',
    });

    const invalidConnect = await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send([])
      .expect(400);
    expect(invalidConnect.body).toEqual({
      error: 'Remote connect body is invalid',
      code: 'remote_connect_body_invalid',
    });
  });
});

describe('Direct Remote update routes (issue-013)', () => {
  const connect = async (app) => {
    const inspection = await request(app)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: manifestUrl })
      .expect(200);
    await request(app)
      .post('/api/interactive-ui/manager/remote/connect')
      .send(connectBody(inspection))
      .expect(201);
    return inspection;
  };

  test('update-check classifies an expansion without applying; update-apply requires exact confirmation', async () => {
    const initialManifest = createRemoteManifest();
    const { app, holder } = await createApp({ initialManifest });
    await connect(app);

    holder.document = createRemoteManifest({
      keys: initialManifest.keys,
      version: '2.0.0',
      extraAction: true,
      update: { changeSummary: 'Adds export action' },
    }).document;
    const check = await request(app)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-check')
      .send({ force: true })
      .expect(200);
    expect(check.body).toMatchObject({
      status: 'available',
      currentVersion: '1.0.0',
      remoteVersion: '2.0.0',
      permissionDelta: 'expanded',
      requiresUserConfirmation: true,
      health: { status: 'reachable' },
      changeSummary: 'Adds export action',
    });
    expect(check.body.addedPermissions).toMatchObject({
      actionIds: ['com.acme.remote.export'],
    });
    expect(JSON.stringify(check.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(check.body)).not.toContain('installationId');

    const rejected = await request(app)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-apply')
      .send({})
      .expect(403);
    expect(rejected.body.code).toBe('remote_confirmation_required');

    const applied = await request(app)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-apply')
      .send({
        confirmedManifestHash: check.body.remoteManifestHash,
        confirmedPublisherFingerprint: check.body.publisherFingerprint,
      })
      .expect(200);
    expect(applied.body).toMatchObject({ applied: true, previousVersion: '1.0.0' });

    const snapshot = await request(app)
      .get('/api/interactive-ui/manager')
      .expect(200);
    expect(snapshot.body.extensions[0]).toMatchObject({
      activeVersion: '2.0.0',
      versions: {
        '2.0.0': {
          delivery: 'remote',
          remote: { acceptedManifest: { version: '2.0.0' } },
        },
      },
    });
    expect(JSON.stringify(snapshot.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(snapshot.body)).not.toContain('installationId');
  });

  test('manual connection test can include a safe Remote update summary', async () => {
    const initialManifest = createRemoteManifest();
    const { app, holder } = await createApp({
      initialManifest,
      runtimeOverrides: {
        testConnection: async () => ({ ok: true }),
      },
    });
    await connect(app);

    holder.document = createRemoteManifest({
      keys: initialManifest.keys,
      version: '2.0.0',
      extraAction: true,
    }).document;
    const response = await request(app)
      .post('/api/interactive-ui/connections/com.acme.remote/crm/test')
      .send({ checkForUpdates: true })
      .expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      update: {
        status: 'available',
        remoteVersion: '2.0.0',
        permissionDelta: 'expanded',
        requiresUserConfirmation: true,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(response.body)).not.toContain('installationId');
  });

  test('required Remote update persists a blocked state before the route reports success', async () => {
    const initialManifest = createRemoteManifest();
    const { app, holder } = await createApp({ initialManifest });
    await connect(app);

    holder.document = createRemoteManifest({
      keys: initialManifest.keys,
      version: '2.0.0',
      extraAction: true,
      update: { required: true, changeSummary: 'Mandatory export fix' },
    }).document;
    const check = await request(app)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-check')
      .send({ force: true })
      .expect(200);
    expect(check.body).toMatchObject({
      status: 'required',
      remoteVersion: '2.0.0',
      requiresUserConfirmation: true,
      blocked: {
        code: 'remote_update_required_blocked',
        required: true,
        version: '2.0.0',
        reason: 'confirmation-required',
      },
    });
    const snapshot = await request(app)
      .get('/api/interactive-ui/manager')
      .expect(200);
    expect(snapshot.body.extensions[0]).toMatchObject({
      activeVersion: '1.0.0',
      versions: {
        '1.0.0': {
          remote: {
            blocked: {
              required: true,
              version: '2.0.0',
              reason: 'confirmation-required',
            },
          },
        },
      },
    });
    expect(JSON.stringify(check.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(snapshot.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(snapshot.body)).not.toContain('installationId');
  });
});
