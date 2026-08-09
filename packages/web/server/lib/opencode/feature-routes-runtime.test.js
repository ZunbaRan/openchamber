import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import express from 'express';
import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createFeatureRoutesRuntime } from './feature-routes-runtime.js';
import { HOSTED_OCIX_MANIFEST_SCHEMA } from '../interactive-ui/hosted-ocix.js';
import { generatePublisherKeyPair } from '../interactive-ui/package-format.js';

// Production wiring contract for the Interactive UI runtime, validated ONLY
// through the public createFeatureRoutesRuntime(...).registerRoutes path (the
// internal createInteractiveUIRuntimeForRoutes seam is module-private):
//
// registerRoutes composes the runtime extension roots from the built-in Agent
// Runtime, the manager-owned enabled extension roots, and the configured
// OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR roots, and it binds the
// manager-owned Remote Phase R2 lazy resolver. The Remote resolver is
// AUTHORITATIVE and is consulted before any disk read: it returns verified
// bytes for a connected Remote extension's exact entry and for an authorized
// current Hosted install (also verified Buffers), null ONLY for ordinary
// configured/built-in roots and authorized current Local installs (which fall
// back to their exact disk path without any remote fetch/cache), and it never
// fetches resources for connect/registry/list metadata.

const temporaryDirectories = [];
// Every explicit test HTTP server (the app server and the Remote fixture),
// closed in afterEach BEFORE temporary directories are removed so no request
// can reach a removed data directory.
const httpServers = [];

afterEach(async () => {
  await Promise.all(httpServers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  })));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createTemporaryDirectory = async (prefix) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

// A valid Local extension shell with a disk-present declarative view.
const writeLocalExtension = async (root, {
  id,
  name,
  viewId,
  entry = 'ui/view.json',
  tool,
}) => {
  await fs.mkdir(path.join(root, 'ui'), { recursive: true });
  await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id,
    name,
    version: '1.0.0',
    views: [{
      id: viewId,
      runtime: 'declarative',
      entry,
      tools: [tool],
    }],
    actions: [],
    permissions: { network: [] },
    trust: { mode: 'declarative', signature: 'test' },
  }));
  await fs.writeFile(path.join(root, entry), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: viewId,
    layout: { type: 'text', value: name },
  }));
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const hostedSha256 = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;

// A REAL loopback HTTP Remote fixture: signed Hosted OCIX manifest plus the
// declared lazy resources, all served over http://127.0.0.1 (loopback HTTP is
// allowed by the Remote/Hosted URL rules). The manager inside registerRoutes
// uses global fetch, so the resource URLs must be genuinely reachable.
const startRemoteFixture = async () => {
  const keys = generatePublisherKeyPair();
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.remote.overview',
    layout: { type: 'text', value: 'Remote' },
  }));
  const iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const resourceRequests = [];
  let document;
  let manifestRequests = 0;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/manifest.json') {
      manifestRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(document));
      return;
    }
    if (pathname === '/ui/overview.view.json') {
      resourceRequests.push(pathname);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(view);
      return;
    }
    if (pathname === '/ui/icon.svg') {
      resourceRequests.push(pathname);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(iconBytes);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  httpServers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
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
      resourceOrigins: [origin],
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
    resources: [{
      path: 'ui/overview.view.json',
      url: `${origin}/ui/overview.view.json`,
      mimeType: 'application/json',
      sha256: hostedSha256(view),
    }, {
      path: 'ui/icon.svg',
      url: `${origin}/ui/icon.svg`,
      mimeType: 'image/svg+xml',
      sha256: hostedSha256(iconBytes),
    }],
  };
  document = {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      keyId: 'release-2026',
      value: crypto.sign(
        null,
        Buffer.from(JSON.stringify(canonicalize(unsigned))),
        crypto.createPrivateKey(keys.privateKey),
      ).toString('base64'),
    },
  };
  return {
    origin,
    view,
    iconBytes,
    resourceRequests,
    keys,
    manifestRequests: () => manifestRequests,
    publish: (nextDocument) => {
      document = nextDocument;
    },
  };
};

const createMinimalRouteDependencies = ({ openchamberDataDir, opencodeConfigDirectory, configuredRoot }) => ({
  crypto,
  fs: nodeFs,
  os,
  path,
  fsPromises: fs,
  spawn: () => ({}),
  resolveGitBinaryForSpawn: async () => null,
  createFsSearchRuntime: () => ({}),
  openchamberDataDir,
  openchamberUserConfigRoot: path.join(openchamberDataDir, 'user-config'),
  normalizeDirectoryPath: (value) => path.resolve(value),
  resolveProjectDirectory: async () => path.join(openchamberDataDir, 'project'),
  resolveOptionalProjectDirectory: async () => path.join(openchamberDataDir, 'project'),
  validateDirectoryPath: () => {},
  readCustomThemesFromDisk: async () => ({}),
  refreshOpenCodeAfterConfigChange: async () => ({ reloaded: false, external: false }),
  getOpenCodeResolutionSnapshot: async () => ({}),
  getOpenCodeUpgradeCapability: () => ({ supported: false, reason: 'test' }),
  formatSettingsResponse: async (value) => value,
  readSettingsFromDisk: async () => ({}),
  readSettingsFromDiskMigrated: async () => ({}),
  persistSettings: async () => {},
  sanitizeProjects: (value) => value,
  sanitizeSkillCatalogs: (value) => value,
  isUnsafeSkillRelativePath: () => false,
  buildOpenCodeUrl: () => 'http://127.0.0.1:1',
  getOpenCodeAuthHeaders: () => ({}),
  getOpenCodePort: () => 1,
  buildAugmentedPath: (value) => value,
  projectConfigRuntime: {},
  scheduledTasksRuntime: {},
  scheduledTaskService: {},
  openChamberSessionService: {},
  openChamberControlService: {},
  waitForOpenCodeReady: async () => {},
  getOpenChamberEventClients: () => [],
  writeSseEvent: () => {},
  emitSessionCreatedEvent: () => {},
  permissionAutoAcceptRuntime: {},
  express,
  processLike: {
    env: {
      OPENCHAMBER_DATA_DIR: openchamberDataDir,
      OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: opencodeConfigDirectory,
      OPENCHAMBER_OPENCODE_CWD: path.join(openchamberDataDir, 'project'),
      OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR: configuredRoot,
    },
  },
  uiAuthController: {},
  openchamberVersion: '1.17.1',
  clientReloadDelayMs: 0,
});

describe('Interactive UI runtime production wiring (public registerRoutes path)', () => {
  // One self-contained registered server per test: the production call site
  // (registerRoutes) executes inside, so any undeclared identifier (the R2
  // regression: fetchImpl) is a hard ReferenceError here.
  const createRegisteredServer = async ({ configuredRootSeed = null } = {}) => {
    const openchamberDataDir = await createTemporaryDirectory('feature-routes-register-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('feature-routes-register-opencode-');
    const configuredRoot = await createTemporaryDirectory('feature-routes-register-configured-');
    // A disk-present Local extension in the configured roots proves production
    // root composition end-to-end and stays resolver-free (unless a custom
    // seed replaces it).
    if (configuredRootSeed) {
      await configuredRootSeed(configuredRoot);
    } else {
      await writeLocalExtension(configuredRoot, {
        id: 'com.acme.configured',
        name: 'Acme Configured',
        viewId: 'com.acme.configured.overview',
        tool: 'configured_open',
      });
    }
    const dependencies = createMinimalRouteDependencies({
      openchamberDataDir,
      opencodeConfigDirectory,
      configuredRoot,
    });
    const app = express();
    const server = http.createServer(app);
    httpServers.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const featureRuntime = createFeatureRoutesRuntime(dependencies);
    await featureRuntime.registerRoutes(app, dependencies);
    return { server, dependencies };
  };

  const connectRemoteThroughRoutes = async (server, fixture) => {
    const inspection = await request(server)
      .post('/api/interactive-ui/manager/remote/inspect')
      .send({ appEntryUrl: `${fixture.origin}/manifest.json` });
    expect(inspection.status).toBe(200);
    const connect = await request(server)
      .post('/api/interactive-ui/manager/remote/connect')
      .send({
        appEntryUrl: `${fixture.origin}/manifest.json`,
        accessKey: 'sk-register-routes-secret',
        confirmedPublisherFingerprint: inspection.body.publisher.fingerprint,
        confirmedManifestHash: inspection.body.manifest.manifestHash,
      });
    expect(connect.status).toBe(201);
  };

  it('registerRoutes builds the composed runtime and serves real interactive-ui requests', async () => {
    const { server } = await createRegisteredServer();

    // The manager is wired and serves its list through the registered route.
    const managerResponse = await request(server).get('/api/interactive-ui/manager');
    expect(managerResponse.status).toBe(200);
    expect(managerResponse.body.extensions).toEqual([]);

    // Roots are composed: the built-in Agent Runtime and the configured
    // extension root are both discoverable through the registered runtime.
    const registry = await request(server).get('/api/interactive-ui/extensions');
    expect(registry.status).toBe(200);
    const ids = registry.body.extensions.map((extension) => extension.id).sort();
    expect(ids).toContain('com.openchamber.builtin.interactive-ui');
    expect(ids).toContain('com.acme.configured');
  });

  it('connects a Remote extension through the registered routes with metadata-only behavior', async () => {
    const { server } = await createRegisteredServer();
    const fixture = await startRemoteFixture();

    await connectRemoteThroughRoutes(server, fixture);

    // Connect/list stay metadata-only: no resource URL was fetched.
    expect(fixture.resourceRequests).toEqual([]);

    // The manager-owned enabled root now appears in the registry: the
    // connected Remote shell is composed from manager.getEnabledExtensionRoots.
    const registry = await request(server).get('/api/interactive-ui/extensions');
    expect(registry.status).toBe(200);
    const ids = registry.body.extensions.map((extension) => extension.id).sort();
    expect(ids).toContain('com.openchamber.builtin.interactive-ui');
    expect(ids).toContain('com.acme.configured');
    expect(ids).toContain('com.acme.remote');
    // Registry listing also stays metadata-only.
    expect(fixture.resourceRequests).toEqual([]);
  });

  it('lazily resolves only missing Remote entries through the registered runtime', async () => {
    const { server } = await createRegisteredServer();
    const fixture = await startRemoteFixture();
    await connectRemoteThroughRoutes(server, fixture);

    // The first actual load of the Remote declarative view resolves the exact
    // missing-on-disk entry through the manager-owned resolver: exactly ONE
    // resource fetch, and the declared bytes are served.
    const view = await request(server).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(view.status).toBe(200);
    expect(view.body.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
    });
    expect(fixture.resourceRequests).toEqual(['/ui/overview.view.json']);

    // A repeated load inside the verified TTL is a cache hit: no second fetch.
    const again = await request(server).get('/api/interactive-ui/views/com.acme.remote.overview?tool=remote_open');
    expect(again.status).toBe(200);
    expect(fixture.resourceRequests).toEqual(['/ui/overview.view.json']);

    // The icon is a separate lazy fetch of exactly its own signed resource.
    const icon = await request(server).get('/api/interactive-ui/extensions/com.acme.remote/icon');
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toBe('image/svg+xml');
    expect(fixture.resourceRequests).toEqual(['/ui/overview.view.json', '/ui/icon.svg']);

    // A disk-present Local extension view resolves from disk after the
    // manager resolver returned null (no remote fetch/cache): the fixture saw
    // no additional resource request.
    const localView = await request(server).get('/api/interactive-ui/views/com.acme.configured.overview?tool=configured_open');
    expect(localView.status).toBe(200);
    expect(localView.body.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.configured.overview',
    });
    expect(fixture.resourceRequests).toEqual(['/ui/overview.view.json', '/ui/icon.svg']);
  });

  it('sanitizes public load errors through the registered routes (no paths, no raw markers)', async () => {
    const rawMarker = 'RAW_LOAD_MARKER_XYZ';
    const { server, dependencies } = await createRegisteredServer({
      configuredRootSeed: async (configuredRoot) => {
        // A malformed configured manifest whose raw validation error contains
        // the injected marker and whose manifest PATH contains a marker
        // directory: neither may ever reach public HTTP output.
        const markerDirectory = path.join(configuredRoot, `RAW_DIR_${rawMarker}`);
        await fs.mkdir(path.join(markerDirectory, 'ui'), { recursive: true });
        await fs.writeFile(path.join(markerDirectory, 'openchamber.extension.json'), JSON.stringify({
          $schema: 'openchamber://extension/v1',
          id: 'com.acme.raw',
          name: 'Raw',
          version: '1.0.0',
          views: [{
            id: 'com.acme.raw.overview',
            runtime: 'declarative',
            entry: 'ui/view.json',
            tools: ['raw_open'],
          }],
          actions: [],
          connectors: [{
            id: 'raw',
            type: 'http',
            baseUrl: `https://${rawMarker}.example.com`,
            auth: { type: 'api-key' },
          }],
          permissions: { network: [] },
          trust: { mode: 'declarative', signature: 'test' },
        }));
      },
    });
    const dataDirectory = dependencies.processLike.env.OPENCHAMBER_DATA_DIR;
    const configuredRoot = dependencies.processLike.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR;
    const opencodeConfigDirectory = dependencies.processLike.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR;

    for (const route of ['/api/interactive-ui/extensions', '/api/interactive-ui/workbench/catalog', '/api/interactive-ui/connections']) {
      const response = await request(server).get(route);
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(rawMarker);
      expect(serialized).not.toContain(`RAW_DIR_${rawMarker}`);
      expect(serialized).not.toContain(configuredRoot);
      expect(serialized).not.toContain(dataDirectory);
      expect(serialized).not.toContain(opencodeConfigDirectory);
    }
    // The registry reports the sanitized load error (fixed message, no path).
    const registry = await request(server).get('/api/interactive-ui/extensions');
    const loadError = (registry.body.errors ?? []).find((error) => error.extensionId === 'com.acme.raw' || error.code);
    expect(loadError).toBeTruthy();
    expect(loadError.message).toBe('Extension could not be loaded');
    expect(JSON.stringify(registry.body)).not.toContain('/');
  });

  it('sanitizes manager authorization failures through the registered routes', async () => {
    const { server, dependencies } = await createRegisteredServer({});
    const fixture = await startRemoteFixture();
    await connectRemoteThroughRoutes(server, fixture);
    // Disable the manager-owned Remote, then seed a configured copy reusing
    // the SAME extension/surface/tool ids: authorization at discovery must
    // reject it and the public responses must stay sanitized.
    await request(server).patch('/api/interactive-ui/manager/extensions/com.acme.remote')
      .send({ enabled: false });
    const configuredRoot = dependencies.processLike.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR;
    await fs.rm(path.join(configuredRoot, 'com.acme.configured'), { recursive: true, force: true });
    await fs.mkdir(path.join(configuredRoot, 'com.acme.remote'), { recursive: true });
    await fs.writeFile(path.join(configuredRoot, 'com.acme.remote', 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '9.9.9',
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['remote_open'],
      }],
      actions: [],
      permissions: { network: [] },
      trust: { mode: 'declarative', signature: 'production' },
    }));
    await fs.mkdir(path.join(configuredRoot, 'com.acme.remote', 'ui'), { recursive: true });
    await fs.writeFile(path.join(configuredRoot, 'com.acme.remote', 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'configured-copy' },
    }));

    for (const route of ['/api/interactive-ui/extensions', '/api/interactive-ui/workbench/catalog', '/api/interactive-ui/connections']) {
      const response = await request(server).get(route);
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(configuredRoot);
      expect(serialized).not.toContain(dependencies.processLike.env.OPENCHAMBER_DATA_DIR);
      expect(serialized).not.toContain('configured-copy');
    }
  });

  it('wires Remote lifecycle prepare/getLifecycle and the background warm-up through the registered runtime', async () => {
    const { server } = await createRegisteredServer();
    const fixture = await startRemoteFixture();
    await connectRemoteThroughRoutes(server, fixture);
    const before = fixture.manifestRequests();
    // The Workbench catalog trigger runs prepareExtensionUse + getExtension-
    // Lifecycle through the wired production callbacks: the Remote lifecycle
    // probe runs (coalesced/cached) and the safe summary appears.
    const catalog = await request(server).get('/api/interactive-ui/workbench/catalog');
    expect(catalog.status).toBe(200);
    expect(fixture.manifestRequests()).toBeGreaterThan(before);
    const remoteEntry = catalog.body.extensions.find((entry) => entry.id === 'com.acme.remote');
    expect(remoteEntry.lifecycle).toMatchObject({
      status: 'none',
      health: { status: 'reachable' },
    });
    expect(JSON.stringify(catalog.body)).not.toContain('BEGIN PUBLIC KEY');

    // Publish a permission-expansion update signed by the same key and apply
    // it through the production route (metadata-only, zero resource bytes).
    const unsigned = JSON.parse(JSON.stringify(fixture.view)); // placeholder
    const buildV2 = () => {
      const base = JSON.parse(JSON.stringify({
        $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
        app: { id: 'com.acme.remote', version: '2.0.0', publishedAt: '2026-08-06T00:00:00.000Z' },
        update: { required: false, changeSummary: 'Adds export action' },
        publisher: {
          id: 'com.acme.publisher',
          name: 'Acme',
          keyId: 'release-2026',
          publicKey: fixture.keys.publicKey,
        },
        permissions: {
          resourceOrigins: [fixture.origin],
          networkOrigins: ['https://api.example.com'],
          externalLinkOrigins: [],
          credentialScopes: ['crm.read'],
          actionIds: ['com.acme.remote.read', 'com.acme.remote.export'],
          agentToolNames: ['remote_open'],
          clipboard: false,
          popups: false,
          nativeCode: false,
        },
        extension: {
          $schema: 'openchamber://extension/v1',
          id: 'com.acme.remote',
          name: 'Acme Remote',
          version: '2.0.0',
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
          }, {
            id: 'com.acme.remote.export',
            connector: 'crm',
            risk: 'write',
            request: { method: 'POST', path: '/crm/export' },
          }],
          permissions: { network: ['https://api.example.com'] },
          trust: { mode: 'declarative', signature: 'production' },
        },
        resources: [{
          path: 'ui/overview.view.json',
          url: `${fixture.origin}/ui/overview.view.json`,
          mimeType: 'application/json',
          sha256: hostedSha256(fixture.view),
        }, {
          path: 'ui/icon.svg',
          url: `${fixture.origin}/ui/icon.svg`,
          mimeType: 'image/svg+xml',
          sha256: hostedSha256(fixture.iconBytes),
        }],
      }));
      const signature = crypto.sign(
        null,
        Buffer.from(JSON.stringify(canonicalize(base))),
        crypto.createPrivateKey(fixture.keys.privateKey),
      ).toString('base64');
      return {
        ...base,
        signature: { algorithm: 'ed25519', keyId: 'release-2026', value: signature },
      };
    };
    fixture.publish(buildV2());
    const check = await request(server)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-check')
      .send({ force: true });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'expanded',
      requiresUserConfirmation: true,
    });
    const apply = await request(server)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-apply')
      .send({
        confirmedManifestHash: check.body.remoteManifestHash,
        confirmedPublisherFingerprint: check.body.publisherFingerprint,
      });
    expect(apply.status).toBe(200);
    expect(apply.body).toMatchObject({ applied: true, previousVersion: '1.0.0' });
    // ZERO declared resource bytes were fetched by the update path.
    expect(fixture.resourceRequests).toEqual([]);
    const manager = await request(server).get('/api/interactive-ui/manager');
    expect(manager.body.extensions[0].activeVersion).toBe('2.0.0');
    expect(JSON.stringify(manager.body)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(manager.body)).not.toContain('installationId');
  });

  it('recovers a superseded persisted required block through real production triggers without ever issuing the blocked root first', async () => {
    const { server } = await createRegisteredServer();
    const fixture = await startRemoteFixture();
    await connectRemoteThroughRoutes(server, fixture);

    const buildDocument = ({ version, update, extraAction }) => {
      const base = JSON.parse(JSON.stringify({
        $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
        app: { id: 'com.acme.remote', version, publishedAt: '2026-08-06T00:00:00.000Z' },
        ...(update ? { update } : {}),
        publisher: {
          id: 'com.acme.publisher',
          name: 'Acme',
          keyId: 'release-2026',
          publicKey: fixture.keys.publicKey,
        },
        permissions: {
          resourceOrigins: [fixture.origin],
          networkOrigins: ['https://api.example.com'],
          externalLinkOrigins: [],
          credentialScopes: ['crm.read'],
          actionIds: extraAction
            ? ['com.acme.remote.read', 'com.acme.remote.export']
            : ['com.acme.remote.read'],
          agentToolNames: ['remote_open'],
          clipboard: false,
          popups: false,
          nativeCode: false,
        },
        extension: {
          $schema: 'openchamber://extension/v1',
          id: 'com.acme.remote',
          name: 'Acme Remote',
          version,
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
          actions: extraAction ? [{
            id: 'com.acme.remote.read',
            connector: 'crm',
            risk: 'read',
            request: { method: 'GET', path: '/crm' },
          }, {
            id: 'com.acme.remote.export',
            connector: 'crm',
            risk: 'write',
            request: { method: 'POST', path: '/crm/export' },
          }] : [{
            id: 'com.acme.remote.read',
            connector: 'crm',
            risk: 'read',
            request: { method: 'GET', path: '/crm' },
          }],
          permissions: { network: ['https://api.example.com'] },
          trust: { mode: 'declarative', signature: 'production' },
        },
        resources: [{
          path: 'ui/overview.view.json',
          url: `${fixture.origin}/ui/overview.view.json`,
          mimeType: 'application/json',
          sha256: hostedSha256(fixture.view),
        }, {
          path: 'ui/icon.svg',
          url: `${fixture.origin}/ui/icon.svg`,
          mimeType: 'image/svg+xml',
          sha256: hostedSha256(fixture.iconBytes),
        }],
      }));
      const signature = crypto.sign(
        null,
        Buffer.from(JSON.stringify(canonicalize(base))),
        crypto.createPrivateKey(fixture.keys.privateKey),
      ).toString('base64');
      return {
        ...base,
        signature: { algorithm: 'ed25519', keyId: 'release-2026', value: signature },
      };
    };

    // Publish a REQUIRED + expansion update and trigger the Workbench catalog
    // path: the manager prepare persists the block and fails closed
    // per-extension, while the catalog still serves with the blocked summary.
    fixture.publish(buildDocument({ version: '2.0.0', update: { required: true }, extraAction: true }));
    const catalog = await request(server).get('/api/interactive-ui/workbench/catalog');
    expect(catalog.status).toBe(200);
    const blockedEntry = catalog.body.extensions.find((entry) => entry.id === 'com.acme.remote');
    expect(blockedEntry.lifecycle).toMatchObject({
      status: 'required',
      blocked: { code: 'remote_update_required_blocked' },
    });
    // While blocked, the executable root is NEVER issued: the registry cannot
    // see the app even though it is enabled and manager-owned.
    const blockedRegistry = await request(server).get('/api/interactive-ui/extensions');
    expect(blockedRegistry.status).toBe(200);
    expect(blockedRegistry.body.extensions.some((entry) => entry.id === 'com.acme.remote')).toBe(false);

    // The vendor publishes a valid REACHABLE non-required candidate: a manual
    // update-check supersedes and clears the obsolete persisted block
    // (classification only), so the dynamic root returns.
    fixture.publish(buildDocument({ version: '2.0.0', update: { changeSummary: 'Now optional' }, extraAction: false }));
    const check = await request(server)
      .post('/api/interactive-ui/manager/extensions/com.acme.remote/remote/update-check')
      .send({ force: true });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      requiresUserConfirmation: false,
      health: { status: 'reachable' },
    });
    const unblockedRegistry = await request(server).get('/api/interactive-ui/extensions');
    expect(unblockedRegistry.status).toBe(200);
    expect(unblockedRegistry.body.extensions.some((entry) => entry.id === 'com.acme.remote')).toBe(true);
    // Zero declared resource bytes were fetched by the whole lifecycle path.
    expect(fixture.resourceRequests).toEqual([]);
  });
});
