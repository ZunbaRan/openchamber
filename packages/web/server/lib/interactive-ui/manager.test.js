import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  createSignedExtensionCatalog,
  createExtensionPackage,
  generatePublisherKeyPair,
  publicKeyFingerprint,
} from './package-format.js';
import {
  InteractiveUIExtensionManagerError,
  createInteractiveUIExtensionManager,
} from './manager.js';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  HOSTED_OCIX_SIGNED_MANIFEST_FILE,
} from './hosted-ocix.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const managerAt = (dataDirectory, options = {}) => createInteractiveUIExtensionManager({
  dataDirectory,
  fsImpl: fs,
  pathImpl: path,
  cryptoImpl: crypto,
  ...options,
});

const createManager = async (options = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-'));
  temporaryDirectories.push(dataDirectory);
  return { dataDirectory, manager: managerAt(dataDirectory, options) };
};

const trustPathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'trust.json');
const statePathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'installations.json');
const marketplacesPathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'marketplaces.json');
const remoteConsentsPathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'remote-consents.json');
const versionsPathFor = (dataDirectory) => path.join(dataDirectory, 'extensions');
const stagingPathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'staging');
const trashPathFor = (dataDirectory) => path.join(dataDirectory, 'interactive-ui', 'trash');

const createExtension = async ({ extensionId = 'com.acme.operations', version = '1.0.0', delivery } = {}) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-extension-'));
  temporaryDirectories.push(directory);
  // View/surface ids derive from the extension id so over-bound fixtures stay
  // signable: dashboard surfaces must start with `${manifest.id}.`.
  const viewId = `${extensionId}.overview`;
  await fs.mkdir(path.join(directory, 'ui'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agent-runtime', 'tools'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agent-runtime', 'skills', 'acme-operations'), { recursive: true });
  await fs.writeFile(path.join(directory, 'openchamber.extension.json'), JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id: extensionId,
    name: 'Acme Operations',
    version,
    connectors: [],
    views: [{ id: viewId, runtime: 'declarative', entry: 'ui/view.json', tools: ['operations_open'] }],
    actions: [],
    permissions: { network: [] },
    trust: { mode: 'declarative', signature: 'production' },
    ...(delivery === undefined ? {} : { delivery }),
  }, null, 2));
  await fs.writeFile(path.join(directory, 'ui', 'view.json'), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: viewId,
    layout: { type: 'text', value: 'Hello' },
  }));
  await fs.writeFile(
    path.join(directory, 'agent-runtime', 'tools', 'operations_open.ts'),
    `export default { description: "Open operations ${version}" };\n`,
  );
  await fs.writeFile(path.join(directory, 'agent-runtime', 'skills', 'acme-operations', 'SKILL.md'), '---\nname: acme-operations\ndescription: Open operations views.\n---\n');
  return directory;
};

const signPackage = async ({
  keys = generatePublisherKeyPair(),
  keyId = 'release-2026',
  publisherId = 'com.acme.publisher',
  publisherName = 'Acme',
  extensionId = 'com.acme.operations',
  version = '1.0.0',
  delivery,
} = {}) => {
  const packed = await createExtensionPackage({
    extensionDirectory: await createExtension({ extensionId, version, delivery }),
    privateKey: keys.privateKey,
    publisherId,
    publisherName,
    keyId,
    createdAt: '2026-07-18T00:00:00.000Z',
  });
  return { ...packed, keys };
};

const createMarketplaceFixture = async ({
  marketplaceKeys = generatePublisherKeyPair(),
  publisherKeys = generatePublisherKeyPair(),
  marketplaceId = 'com.acme.marketplace',
  marketplaceName = 'Acme Marketplace',
  marketplaceKeyId = 'catalog-2026',
  extensionId = 'com.acme.operations',
  extensionName = 'Acme Operations',
  version = '1.0.0',
  publisherId = 'com.acme.publisher',
  publisherName = 'Acme',
  publisherKeyId = 'release-2026',
  packageUrl = 'https://extensions.example.com/operations.ocix',
} = {}) => {
  const packed = await signPackage({
    keys: publisherKeys,
    keyId: publisherKeyId,
    publisherId,
    publisherName,
    extensionId,
    version,
  });
  const entry = {
    id: extensionId,
    name: extensionName,
    version,
    packageUrl,
    packageHash: packed.packageHash,
    publisher: {
      id: publisherId,
      name: publisherName,
      keyId: publisherKeyId,
      publicKey: publisherKeys.publicKey,
    },
  };
  const catalog = createSignedExtensionCatalog({
    marketplaceId,
    marketplaceName,
    keyId: marketplaceKeyId,
    privateKey: marketplaceKeys.privateKey,
    entries: [entry],
    generatedAt: '2026-08-09T00:00:00.000Z',
  });
  return { marketplaceKeys, publisherKeys, packed, entry, catalog };
};

// Targeted Remote fixtures. Remote consent is installation-scoped in the
// current Manager: the metadata adapter is deliberately injected by each
// test rather than relying on the production runtime validator.
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const hostedSha256 = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;

const createRemoteManifest = ({
  keys,
  version = '1.0.0',
  native = false,
  connectors,
  publisherKeyId = 'release-2026',
  publisherId = 'com.acme.publisher',
  publisherName = 'Acme',
  extensionId = 'com.acme.remote',
  extensionName = 'Acme Remote',
  toolName = 'remote_open',
  extensionNetwork = ['https://api.example.com'],
  viewEntry,
  resourcePath,
  viewText,
  extensionExtra = {},
  topLevelExtra = {},
} = {}) => {
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: `${extensionId}.overview`,
    layout: { type: 'text', value: viewText ?? `Remote ${version}` },
  }));
  const entryPath = viewEntry ?? (native ? 'ui/overview.view.mjs' : 'ui/overview.view.json');
  const entryMimeType = native ? 'text/javascript' : 'application/json';
  const declaredResourcePath = resourcePath ?? entryPath;
  const resolvedConnectors = connectors ?? [{
    id: 'crm',
    type: 'http',
    baseUrl: 'https://api.example.com',
    auth: { type: 'api-key' },
  }];
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {
      id: extensionId,
      version,
      publishedAt: `2026-08-0${version === '1.0.0' ? '5' : '6'}T00:00:00.000Z`,
    },
    publisher: {
      id: publisherId,
      name: publisherName,
      keyId: publisherKeyId,
      publicKey: keys.publicKey,
    },
    permissions: {
      resourceOrigins: ['https://apps.example.com'],
      networkOrigins: [...extensionNetwork],
      externalLinkOrigins: [],
      credentialScopes: ['crm.read'],
      actionIds: ['com.acme.remote.read'],
      agentToolNames: [toolName],
      clipboard: false,
      popups: false,
      nativeCode: native,
    },
    extension: {
      $schema: 'openchamber://extension/v1',
      id: extensionId,
      name: extensionName,
      version,
      agentRouting: {
        domain: 'remote',
        intents: ['remote.overview'],
        examples: { en: ['Open Acme Remote'] },
        dataAuthority: 'user-provided',
      },
      connectors: resolvedConnectors,
      views: [{
        id: `${extensionId}.overview`,
        runtime: native ? 'native' : 'declarative',
        entry: entryPath,
        tools: [toolName],
        routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }],
      actions: [{
        id: 'com.acme.remote.read',
        connector: 'crm',
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }],
      permissions: { network: extensionNetwork },
      trust: { mode: native ? 'native-code' : 'declarative', signature: 'production' },
      ...extensionExtra,
    },
    resources: [{
      path: declaredResourcePath,
      url: `https://apps.example.com/${declaredResourcePath}`,
      mimeType: entryMimeType,
      sha256: hostedSha256(view),
    }],
    ...topLevelExtra,
  };
  const signature = crypto.sign(
    null,
    Buffer.from(JSON.stringify(canonicalize(unsigned))),
    crypto.createPrivateKey(keys.privateKey),
  ).toString('base64');
  return {
    document: {
      ...unsigned,
      signature: { algorithm: 'ed25519', keyId: publisherKeyId, value: signature },
    },
    view,
  };
};

const remoteFetch = (manifest, requested = []) => async (url) => {
  const value = String(url);
  requested.push(value);
  if (value === 'https://apps.example.com/manifest.json') {
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (value.startsWith('https://apps.example.com/ui/')) {
    return new Response('resource fetch is not allowed before connect', { status: 500 });
  }
  return new Response('not found', { status: 404 });
};

const validateRemoteTestMetadata = async ({ extension }) => {
  const allowed = new Set([
    '$schema',
    'id',
    'name',
    'version',
    'agentRouting',
    'connectors',
    'views',
    'artifacts',
    'actions',
    'permissions',
    'trust',
    'icon',
  ]);
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)
    || Object.keys(extension).some((field) => !allowed.has(field))) {
    throw new InteractiveUIExtensionManagerError(
      'Remote extension metadata is invalid',
      'invalid_manifest',
      400,
    );
  }
  return { connectors: extension.connectors };
};

const remoteManagerAt = (dataDirectory, options = {}) => managerAt(dataDirectory, {
  validateRemoteMetadata: validateRemoteTestMetadata,
  reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
  ...options,
});

describe('Interactive UI extension trust manager', () => {
  it('rejects incomplete construction dependencies and supports default construction', async () => {
    expect(() => createInteractiveUIExtensionManager({})).toThrow('dependencies are incomplete');
    expect(() => createInteractiveUIExtensionManager({ dataDirectory: '/tmp', fsImpl: null })).toThrow('dependencies are incomplete');
    expect(() => createInteractiveUIExtensionManager({ dataDirectory: '/tmp', pathImpl: null })).toThrow('dependencies are incomplete');
    expect(() => createInteractiveUIExtensionManager({ dataDirectory: '/tmp', cryptoImpl: null })).toThrow('dependencies are incomplete');

    // The frozen interface supplies fs/path/crypto defaults: construction with
    // only dataDirectory succeeds and the defaults are fully functional.
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-'));
    temporaryDirectories.push(dataDirectory);
    const manager = createInteractiveUIExtensionManager({ dataDirectory });
    expect(await manager.list()).toEqual({ apiVersion: 1, extensions: [], publishers: [], marketplaces: [] });
  });

  it('treats a missing trust file as an empty store', async () => {
    const { manager } = await createManager();
    expect(await manager.list()).toEqual({ apiVersion: 1, extensions: [], publishers: [], marketplaces: [] });
  });

  it('trusts a publisher key durably and lists only sanitized own records', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const result = await manager.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2026',
      publicKey: keys.publicKey,
    });
    expect(result).toEqual({
      publisherId: 'com.acme.publisher',
      keyId: 'release-2026',
      fingerprint: publicKeyFingerprint(keys.publicKey),
      added: true,
    });

    const trustFile = trustPathFor(dataDirectory);
    const stored = JSON.parse(await fs.readFile(trustFile, 'utf8'));
    expect(stored.$schema).toBe('openchamber://extension-trust-store/v1');
    const storedKey = stored.publishers['com.acme.publisher'].keys['release-2026'];
    expect(storedKey.publicKey).toBe(keys.publicKey);
    expect(storedKey.fingerprint).toBe(result.fingerprint);
    expect(storedKey.source).toBe('manual');
    expect(typeof storedKey.trustedAt).toBe('string');
    expect((await fs.stat(trustFile)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(trustFile))).mode & 0o777).toBe(0o700);

    const listed = await manager.list();
    expect(listed).toEqual({
      apiVersion: 1,
      extensions: [],
      publishers: [{
        id: 'com.acme.publisher',
        name: 'Acme',
        keys: [{
          keyId: 'release-2026',
          fingerprint: result.fingerprint,
          source: 'manual',
          trustedAt: storedKey.trustedAt,
        }],
      }],
      marketplaces: [],
    });
    expect(Object.keys(listed.publishers[0].keys[0])).toEqual(['keyId', 'fingerprint', 'source', 'trustedAt']);
    expect(JSON.stringify(listed)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(listed)).not.toContain(dataDirectory);
    expect(JSON.stringify(listed)).not.toContain('trust.json');
  });

  it('stores toString as an own trusted key slot on a new publisher', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const result = await manager.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'toString',
      publicKey: keys.publicKey,
    });
    expect(result.added).toBe(true);

    const stored = JSON.parse(await fs.readFile(trustPathFor(dataDirectory), 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(stored.publishers['com.acme.publisher'].keys, 'toString')).toBe(true);
    expect(stored.publishers['com.acme.publisher'].keys.toString.keyId).toBe('toString');
    expect(stored.publishers['com.acme.publisher'].keys.toString.fingerprint).toBe(publicKeyFingerprint(keys.publicKey));

    const listed = await manager.list();
    expect(listed.publishers[0].keys).toEqual([expect.objectContaining({
      keyId: 'toString',
      fingerprint: publicKeyFingerprint(keys.publicKey),
      source: 'manual',
    })]);
  });

  it('adds toString as an additional own key on an existing publisher', async () => {
    const { manager } = await createManager();
    const releaseKeys = generatePublisherKeyPair();
    const toStringKeys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: releaseKeys.publicKey });
    const added = await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: toStringKeys.publicKey });

    expect(added).toMatchObject({ added: true, keyId: 'toString' });
    const listed = await manager.list();
    expect(listed.publishers).toHaveLength(1);
    expect(listed.publishers[0].keys.map((key) => key.keyId)).toEqual(['release-2026', 'toString']);
    expect(listed.publishers[0].keys[1].fingerprint).toBe(publicKeyFingerprint(toStringKeys.publicKey));
  });

  it('treats hasOwnProperty and valueOf as generic own key ids', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'hasOwnProperty', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'valueOf', publicKey: keys.publicKey });

    const stored = JSON.parse(await fs.readFile(trustPathFor(dataDirectory), 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(stored.publishers['com.acme.publisher'].keys, 'hasOwnProperty')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(stored.publishers['com.acme.publisher'].keys, 'valueOf')).toBe(true);

    const reloaded = managerAt(dataDirectory);
    expect(await reloaded.removeTrustedPublisherKey('com.acme.publisher', 'valueOf')).toEqual({ removed: true });
    expect(await reloaded.list()).toMatchObject({
      publishers: [{ id: 'com.acme.publisher', keys: [{ keyId: 'hasOwnProperty' }] }],
    });
  });

  it('is idempotent for the same own slot and fingerprint', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const first = await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });
    const before = await fs.readFile(trustPathFor(dataDirectory), 'utf8');
    const second = await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });

    expect(second).toEqual({ ...first, added: false });
    expect(await fs.readFile(trustPathFor(dataDirectory), 'utf8')).toBe(before);
  });

  it('rejects a different fingerprint on the same own slot with a 409 conflict', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const otherKeys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });

    await expect(manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: otherKeys.publicKey }))
      .rejects.toMatchObject({ code: 'publisher_key_conflict', status: 409 });
    const listed = await manager.list();
    expect(listed.publishers[0].keys).toEqual([expect.objectContaining({
      keyId: 'toString',
      fingerprint: publicKeyFingerprint(keys.publicKey),
    })]);

    // The same public key under a different key id is a new slot, not a conflict.
    await expect(manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2', publicKey: keys.publicKey }))
      .resolves.toMatchObject({ added: true, keyId: 'release-2' });
  });

  it('accepts only manual, package-confirmation, and marketplace:<namespaced-id> sources', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const base = { id: 'com.acme.publisher', name: 'Acme', publicKey: keys.publicKey };
    for (const [keyId, source] of [
      ['k-manual', 'manual'],
      ['k-confirm', 'package-confirmation'],
      ['k-market', 'marketplace:com.acme.market'],
      ['k-market-upper', 'marketplace:COM.ACME.MARKET'],
    ]) {
      await expect(manager.trustPublisher({ ...base, keyId, source })).resolves.toMatchObject({ added: true, keyId });
    }
    for (const source of [
      'unknown',
      'marketplace:',
      'marketplace:plain',
      'marketplace:com..acme',
      'marketplace:com.acme.',
      `marketplace:com.acme.${'x'.repeat(130)}`,
      'Marketplace:com.acme.market',
      42,
      null,
    ]) {
      await expect(manager.trustPublisher({ ...base, keyId: 'k-bad', source }))
        .rejects.toMatchObject({ code: 'invalid_source', status: 400 });
    }
  });

  it('never lets a legacy Marketplace-scoped trust slot authorize a Local package', async () => {
    const { dataDirectory, manager } = await createManager();
    const packed = await signPackage();
    await manager.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2026',
      publicKey: packed.keys.publicKey,
      source: 'marketplace:com.acme.market',
    });
    const trustBefore = await fs.readFile(trustPathFor(dataDirectory));

    await expect(manager.installPackage(packed.buffer))
      .rejects.toMatchObject({ code: 'publisher_untrusted', status: 403 });
    expect(await fs.readFile(trustPathFor(dataDirectory))).toEqual(trustBefore);
    expect((await manager.list()).extensions).toEqual([]);
  });

  it('rejects invalid publisher ids, key ids, names, and public keys', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const base = { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey };

    await expect(manager.trustPublisher({ ...base, id: 'plain' })).rejects.toMatchObject({ code: 'invalid_identifier' });
    await expect(manager.trustPublisher({ ...base, id: `com.acme.${'x'.repeat(130)}` })).rejects.toMatchObject({ code: 'invalid_identifier' });
    for (const keyId of ['__proto__', 'prototype', 'constructor', 'bad id', '9'.repeat(129)]) {
      await expect(manager.trustPublisher({ ...base, keyId })).rejects.toMatchObject({ code: 'invalid_key_id' });
    }
    await expect(manager.trustPublisher({ ...base, name: '   ' })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(manager.trustPublisher({ ...base, name: 'n'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(manager.trustPublisher({ ...base, name: 'n'.repeat(200) })).resolves.toMatchObject({ added: true });
    await expect(manager.trustPublisher({ ...base, keyId: 'k2', publicKey: 'not-a-key' })).rejects.toMatchObject({
      code: 'invalid_public_key',
      status: 400,
    });
    await expect(manager.trustPublisher({ ...base, keyId: 'k3', publicKey: 42 })).rejects.toMatchObject({ code: 'invalid_public_key' });

    // Not-namespaced matches the frozen ID grammar (single hyphen separator).
    await expect(manager.trustPublisher({ ...base, id: 'not-namespaced' })).resolves.toMatchObject({ added: true });
    // Prototype-style names remain valid key ids end to end.
    await expect(manager.trustPublisher({ ...base, keyId: 'toString' })).resolves.toMatchObject({ added: true, keyId: 'toString' });
  });

  it('orders publishers and keys by code-point comparison, not locale order', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.zeta', name: 'Zeta', keyId: 'k10', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.Alpha', name: 'Alpha', keyId: 'k2', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.zeta', name: 'Zeta', keyId: 'K2', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.zeta', name: 'Zeta', keyId: 'a-key', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.zeta', name: 'Zeta', keyId: 'A-key', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.zeta', name: 'Zeta', keyId: 'k2', publicKey: keys.publicKey });

    const listed = await manager.list();
    expect(listed.publishers.map((publisher) => publisher.id)).toEqual(['com.acme.Alpha', 'com.acme.zeta']);
    expect(listed.publishers[1].keys.map((key) => key.keyId)).toEqual(['A-key', 'K2', 'a-key', 'k10', 'k2']);
  });

  it('removes an exact own key slot exactly once and then reports 404', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });

    expect(await manager.removeTrustedPublisherKey('com.acme.publisher', 'toString')).toEqual({ removed: true });
    await expect(manager.removeTrustedPublisherKey('com.acme.publisher', 'toString')).rejects.toMatchObject({
      code: 'publisher_key_not_found',
      status: 404,
    });
    await expect(manager.removeTrustedPublisherKey('com.acme.missing', 'toString')).rejects.toMatchObject({
      code: 'publisher_key_not_found',
      status: 404,
    });
    // The last key removal deletes the publisher record entirely.
    expect(await manager.list()).toEqual({ apiVersion: 1, extensions: [], publishers: [], marketplaces: [] });
  });

  it('keeps the publisher record until its last own key is removed', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const otherKeys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey });
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: otherKeys.publicKey });

    expect(await manager.removeTrustedPublisherKey('com.acme.publisher', 'release-2026')).toEqual({ removed: true });
    expect((await manager.list()).publishers[0].keys.map((key) => key.keyId)).toEqual(['toString']);
    expect(await manager.removeTrustedPublisherKey('com.acme.publisher', 'toString')).toEqual({ removed: true });
    expect(await manager.list()).toEqual({ apiVersion: 1, extensions: [], publishers: [], marketplaces: [] });
  });

  it('preserves prior durable state and cleans the temp file when the atomic write fails', async () => {
    const { dataDirectory } = await createManager();
    const keys = generatePublisherKeyPair();
    // Seed one durable record with the healthy implementation.
    await managerAt(dataDirectory).trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey });
    const before = await fs.readFile(trustPathFor(dataDirectory), 'utf8');

    const failingFs = {
      ...fs,
      writeFile: async (filePath, ...rest) => {
        if (String(filePath).endsWith('.tmp')) throw new Error('simulated disk failure');
        return fs.writeFile(filePath, ...rest);
      },
    };
    const failingManager = managerAt(dataDirectory, { fsImpl: failingFs });
    await expect(failingManager.trustPublisher({ id: 'com.acme.other', name: 'Other', keyId: 'k1', publicKey: keys.publicKey }))
      .rejects.toMatchObject({ code: 'manager_write_failed', status: 500 });

    expect(await fs.readFile(trustPathFor(dataDirectory), 'utf8')).toBe(before);
    const leftovers = (await fs.readdir(path.dirname(trustPathFor(dataDirectory)))).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('serializes concurrent trust mutations without losing records', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    await Promise.all([
      manager.trustPublisher({ id: 'com.acme.one', name: 'One', keyId: 'k1', publicKey: keys.publicKey }),
      manager.trustPublisher({ id: 'com.acme.two', name: 'Two', keyId: 'k1', publicKey: keys.publicKey }),
      manager.trustPublisher({ id: 'com.acme.three', name: 'Three', keyId: 'k1', publicKey: keys.publicKey }),
    ]);
    expect((await manager.list()).publishers.map((publisher) => publisher.id))
      .toEqual(['com.acme.one', 'com.acme.three', 'com.acme.two']);
  });

  it('reloads trusted records in a new manager instance over the same data directory', async () => {
    const { dataDirectory } = await createManager();
    const keys = generatePublisherKeyPair();
    const first = managerAt(dataDirectory);
    const trusted = await first.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'toString',
      publicKey: keys.publicKey,
    });

    const reloaded = managerAt(dataDirectory);
    const listed = await reloaded.list();
    expect(listed.publishers).toEqual([{
      id: 'com.acme.publisher',
      name: 'Acme',
      keys: [{ keyId: 'toString', fingerprint: trusted.fingerprint, source: 'manual', trustedAt: expect.any(String) }],
    }]);
  });

  it('revalidates and re-fingerprints canonically stored keys on every read', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const fingerprint = publicKeyFingerprint(keys.publicKey);
    await fs.mkdir(path.dirname(trustPathFor(dataDirectory)), { recursive: true });
    // A manually stored CANONICAL PEM with a correct fingerprint is accepted
    // and re-fingerprinted on read.
    await fs.writeFile(trustPathFor(dataDirectory), JSON.stringify({
      $schema: 'openchamber://extension-trust-store/v1',
      publishers: {
        'com.acme.publisher': {
          id: 'com.acme.publisher',
          name: 'Acme',
          keys: {
            toString: {
              keyId: 'toString',
              publicKey: keys.publicKey,
              fingerprint,
              source: 'manual',
              trustedAt: '2026-07-18T00:00:00.000Z',
            },
          },
        },
      },
    }));
    expect(await manager.list()).toEqual({
      apiVersion: 1,
      extensions: [],
      publishers: [{
        id: 'com.acme.publisher',
        name: 'Acme',
        keys: [{ keyId: 'toString', fingerprint, source: 'manual', trustedAt: '2026-07-18T00:00:00.000Z' }],
      }],
      marketplaces: [],
    });
  });

  it('rejects non-canonical durable names and public keys as corrupt', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const fingerprint = publicKeyFingerprint(keys.publicKey);
    const writeTrust = async (publishers) => {
      await fs.mkdir(path.dirname(trustPathFor(dataDirectory)), { recursive: true });
      await fs.writeFile(trustPathFor(dataDirectory), JSON.stringify({
        $schema: 'openchamber://extension-trust-store/v1',
        publishers,
      }));
    };
    const publisher = (name, key = {
      keyId: 'release-2026',
      publicKey: keys.publicKey,
      fingerprint,
      source: 'manual',
      trustedAt: '2026-07-18T00:00:00.000Z',
    }) => ({ id: 'com.acme.publisher', name, keys: { 'release-2026': key } });

    // An untrimmed display name is not the canonical stored form.
    await writeTrust({ 'com.acme.publisher': publisher(' Acme ') });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    // A padded PEM is an equivalent but non-canonical stored form.
    await writeTrust({ 'com.acme.publisher': publisher('Acme', {
      keyId: 'release-2026',
      publicKey: `\n${keys.publicKey}\n`,
      fingerprint,
      source: 'manual',
      trustedAt: '2026-07-18T00:00:00.000Z',
    }) });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    // A JWK-like object is not the canonical PEM string form.
    await writeTrust({ 'com.acme.publisher': publisher('Acme', {
      keyId: 'release-2026',
      publicKey: { kty: 'OKP', crv: 'Ed25519' },
      fingerprint,
      source: 'manual',
      trustedAt: '2026-07-18T00:00:00.000Z',
    }) });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });
  });

  it('fails visibly on corrupt, unknown-field, non-canonical, and fingerprint-mismatched durable state', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const fingerprint = publicKeyFingerprint(keys.publicKey);
    const validKey = {
      keyId: 'release-2026',
      publicKey: keys.publicKey,
      fingerprint,
      source: 'manual',
      trustedAt: '2026-07-18T00:00:00.000Z',
    };
    const writeTrust = async (publishers, extraFields = {}) => {
      await fs.mkdir(path.dirname(trustPathFor(dataDirectory)), { recursive: true });
      await fs.writeFile(trustPathFor(dataDirectory), JSON.stringify({
        $schema: 'openchamber://extension-trust-store/v1',
        publishers,
        ...extraFields,
      }));
    };

    await fs.mkdir(path.dirname(trustPathFor(dataDirectory)), { recursive: true });
    await fs.writeFile(trustPathFor(dataDirectory), '{not json');
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({}, { extra: 1 });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': validKey }, extra: 1 } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, extra: 1 } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, fingerprint: `sha256-${'A'.repeat(43)}=` } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, publicKey: 'not-a-key' } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.other', name: 'Acme', keys: { 'release-2026': validKey } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, keyId: 'release-9' } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { constructor: { ...validKey, keyId: 'constructor' } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, source: 'nope' } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    await writeTrust({ 'com.acme.publisher': { id: 'com.acme.publisher', name: 'Acme', keys: { 'release-2026': { ...validKey, trustedAt: 'yesterday' } } } });
    await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

    // A corrupt store also fails signed-package inspection visibly.
    const packed = await signPackage();
    await expect(manager.inspectPackage(packed.buffer)).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });
  });

  it('inspects an untrusted signed package using only its embedded key for self-consistency', async () => {
    const { dataDirectory, manager } = await createManager();
    const keys = generatePublisherKeyPair();
    const packed = await signPackage({ keys, keyId: 'valueOf' });

    const inspected = await manager.inspectPackage(packed.buffer);
    expect(inspected).toEqual({
      extension: { id: 'com.acme.operations', name: 'Acme Operations', version: '1.0.0' },
      publisher: {
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'valueOf',
        fingerprint: publicKeyFingerprint(keys.publicKey),
        trusted: false,
      },
      permissions: { network: [], nativeCode: false },
      agentRuntime: {
        tools: [{ name: 'operations_open', entry: 'agent-runtime/tools/operations_open.ts' }],
        skills: [{
          name: 'acme-operations',
          entry: 'agent-runtime/skills/acme-operations/SKILL.md',
          files: ['agent-runtime/skills/acme-operations/SKILL.md'],
        }],
        unresolvedSurfaceTools: [],
        unresolvedViewTools: [],
      },
    });
    expect(Object.keys(inspected.publisher)).toEqual(['id', 'name', 'keyId', 'fingerprint', 'trusted']);
    expect(Object.keys(inspected.permissions)).toEqual(['network', 'nativeCode']);
    // Public snapshots never expose key material or host paths.
    expect(JSON.stringify(inspected)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(inspected)).not.toContain(dataDirectory);
    expect(JSON.stringify(inspected)).not.toContain('trust.json');
  });

  it('resolves trust only from the exact own durable slot during inspection', async () => {
    const { dataDirectory } = await createManager();
    const keys = generatePublisherKeyPair();
    const trusted = await managerAt(dataDirectory).trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'toString',
      publicKey: keys.publicKey,
      source: 'package-confirmation',
    });

    const reloaded = managerAt(dataDirectory);
    const packed = await signPackage({ keys, keyId: 'toString' });
    const inspected = await reloaded.inspectPackage(packed.buffer);
    expect(inspected.publisher).toEqual({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'toString',
      fingerprint: trusted.fingerprint,
      trusted: true,
    });
  });

  it('never resolves trust from another publisher slot', async () => {
    const { manager } = await createManager();
    const otherKeys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.other', name: 'Other', keyId: 'toString', publicKey: otherKeys.publicKey });

    const packed = await signPackage({ keys: otherKeys, keyId: 'toString' });
    const inspected = await manager.inspectPackage(packed.buffer);
    expect(inspected.publisher).toMatchObject({ id: 'com.acme.publisher', keyId: 'toString', trusted: false });
  });

  it('fails closed when a signed embedded key conflicts with the trusted own slot', async () => {
    const { manager } = await createManager();
    const trustedKeys = generatePublisherKeyPair();
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: trustedKeys.publicKey });

    const otherKeys = generatePublisherKeyPair();
    const packed = await signPackage({ keys: otherKeys, keyId: 'toString' });
    await expect(manager.inspectPackage(packed.buffer)).rejects.toMatchObject({
      code: 'publisher_key_conflict',
      status: 409,
    });
  });

  it('rejects a signed array key id without coercing it into a trusted slot', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    // The store contains a trusted own 'toString' slot for the same publisher:
    // a signed array key id must never coerce into that string slot.
    await manager.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });

    const packed = await signPackage({ keys, keyId: ['toString'] });
    await expect(manager.inspectPackage(packed.buffer)).rejects.toMatchObject({ code: 'invalid_key_id', status: 400 });
    // The durable own slot is untouched and was never consulted as trusted.
    expect((await manager.list()).publishers[0].keys).toEqual([expect.objectContaining({ keyId: 'toString' })]);
  });

  it('rejects signed packages with over-bound extension or publisher ids', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();

    const overBoundExtension = await signPackage({ keys, extensionId: `com.acme.${'x'.repeat(130)}` });
    await expect(manager.inspectPackage(overBoundExtension.buffer)).rejects.toMatchObject({
      code: 'invalid_identifier',
      status: 400,
    });

    const overBoundPublisher = await signPackage({ keys, publisherId: `com.acme.${'y'.repeat(130)}` });
    await expect(manager.inspectPackage(overBoundPublisher.buffer)).rejects.toMatchObject({
      code: 'invalid_identifier',
      status: 400,
    });
  });

  it('rejects a signed package whose publisher display name exceeds the frozen bound', async () => {
    const { manager } = await createManager();
    const keys = generatePublisherKeyPair();
    // createExtensionPackage accepts any non-blank publisher name, so a
    // correctly signed 201-code-unit name reaches the Manager's display-name
    // assertion boundary and must be rejected before public output.
    const packed = await signPackage({ keys, publisherName: 'n'.repeat(201) });
    await expect(manager.inspectPackage(packed.buffer)).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
  });

  it('wraps package-format failures in the manager error class', async () => {
    const { manager } = await createManager();
    await expect(manager.inspectPackage(Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'invalid_archive' });
    await expect(manager.inspectPackage('not a buffer')).rejects.toMatchObject({ code: 'package_too_large', status: 413 });

    const packed = await signPackage();
    const archive = new AdmZip(packed.buffer);
    const indexEntry = archive.getEntries().find((entry) => entry.entryName === 'openchamber.package.json');
    const index = JSON.parse(indexEntry.getData().toString('utf8'));
    index.signature.value = Buffer.alloc(64).toString('base64');
    archive.updateFile('openchamber.package.json', Buffer.from(JSON.stringify(index)));
    await expect(manager.inspectPackage(archive.toBuffer())).rejects.toMatchObject({
      code: 'invalid_signature',
      status: 403,
    });
  });

  describe('Local extension lifecycle', () => {
    it('requires trusted package authority before extraction and validates injected adapter types', async () => {
      expect(() => managerAt('/tmp', { validateStagedPackage: true })).toThrow('staged validator is invalid');
      expect(() => managerAt('/tmp', { reconcileActivation: true })).toThrow('activation reconciler is invalid');

      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      let validationCalls = 0;
      let activationCalls = 0;
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => { validationCalls += 1; },
        reconcileActivation: async () => {
          activationCalls += 1;
          return { openCode: {}, rollback: async () => {} };
        },
      });

      await expect(manager.installPackage(packed.buffer)).rejects.toMatchObject({
        code: 'publisher_untrusted',
        status: 403,
      });
      expect(validationCalls).toBe(0);
      expect(activationCalls).toBe(0);

      await manager.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      const unknownDelivery = await signPackage({ keys: packed.keys, delivery: {} });
      await expect(manager.installPackage(unknownDelivery.buffer)).rejects.toMatchObject({
        code: 'unsupported_delivery',
        status: 409,
      });
      expect(validationCalls).toBe(0);
      expect(activationCalls).toBe(0);
      await expect(fs.stat(stagingPathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(versionsPathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('installs only after staging validation and commits sanitized durable state plus a verified root', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      const events = [];
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async ({ directory, verified }) => {
          events.push('validate');
          expect(directory.startsWith(stagingPathFor(dataDirectory))).toBe(true);
          expect(verified.publisherTrusted).toBe(true);
          expect(await fs.readFile(path.join(directory, 'openchamber.extension.json'), 'utf8')).toContain('com.acme.operations');
          await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
        },
        reconcileActivation: async ({ previousState, nextState, versionsDirectory }) => {
          events.push('activate');
          expect(previousState.extensions).toEqual({});
          expect(nextState.extensions['com.acme.operations'].activeVersion).toBe('1.0.0');
          expect(versionsDirectory).toBe(versionsPathFor(dataDirectory));
          await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
          return {
            openCode: { changed: true, reloaded: true, external: false, managedPath: dataDirectory },
            rollback: async () => { events.push('rollback'); },
          };
        },
      });
      await manager.trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: packed.keys.publicKey,
      });

      const installed = await manager.installPackage(packed.buffer);
      expect(events).toEqual(['validate', 'activate']);
      expect(installed).toMatchObject({
        installed: true,
        extension: { id: 'com.acme.operations', enabled: true, activeVersion: '1.0.0' },
        openCode: { changed: true, reloaded: true, external: false },
      });
      expect(JSON.stringify(installed)).not.toContain('fileHashes');
      expect(JSON.stringify(installed)).not.toContain('generationId');
      expect(JSON.stringify(installed)).not.toContain(dataDirectory);

      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      expect(state.$schema).toBe('openchamber://extension-manager-state/v1');
      expect(state.extensions['com.acme.operations'].versions['1.0.0']).toMatchObject({
        delivery: 'local',
        source: { type: 'file' },
        publisher: { id: 'com.acme.publisher', keyId: 'release-2026' },
      });
      expect(Object.keys(state.extensions['com.acme.operations'].versions['1.0.0'].fileHashes).length).toBeGreaterThan(1);
      expect(typeof state.extensions['com.acme.operations'].versions['1.0.0'].generationId).toBe('string');
      expect((await fs.stat(statePathFor(dataDirectory))).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(statePathFor(dataDirectory)))).mode & 0o777).toBe(0o700);

      const listed = await manager.list();
      expect(listed.extensions).toEqual([expect.objectContaining({ id: 'com.acme.operations', activeVersion: '1.0.0' })]);
      expect(JSON.stringify(listed)).not.toContain('fileHashes');
      expect(JSON.stringify(listed)).not.toContain('generationId');
      expect(JSON.stringify(listed)).not.toContain(dataDirectory);
      expect(JSON.stringify(listed)).not.toContain('BEGIN PUBLIC KEY');

      const roots = await managerAt(dataDirectory).getEnabledExtensionRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0].directory).toBe(path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.0.0'));
      expect(roots[0].provenance.generation).toBe(state.extensions['com.acme.operations'].versions['1.0.0'].generationId);
    });

    it('updates, preserves idempotence, rejects same-version substitution, toggles, rolls back, and recoverably uninstalls', async () => {
      const { dataDirectory } = await createManager();
      const keys = generatePublisherKeyPair();
      const versionOne = await signPackage({ keys, version: '1.0.0' });
      const versionTwo = await signPackage({ keys, version: '1.1.0' });
      const substituted = await signPackage({ keys, version: '1.0.0', publisherName: 'Acme Changed' });
      const activations = [];
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async ({ nextState }) => {
          const extension = nextState.extensions['com.acme.operations'];
          activations.push(extension
            ? { activeVersion: extension.activeVersion, enabled: extension.enabled }
            : { removed: true });
          return { openCode: { changed: true }, rollback: async () => {} };
        },
      });
      await manager.trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: keys.publicKey,
      });

      expect((await manager.installPackage(versionOne.buffer)).installed).toBe(true);
      expect((await manager.installPackage(versionOne.buffer)).installed).toBe(false);
      expect(activations).toHaveLength(1);
      await expect(manager.installPackage(substituted.buffer)).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
      expect(activations).toHaveLength(1);

      const updated = await manager.installPackage(versionTwo.buffer);
      expect(updated.extension.activeVersion).toBe('1.1.0');
      expect(updated.extension.activationHistory).toEqual(['1.0.0']);
      expect(Object.keys(updated.extension.versions)).toEqual(['1.0.0', '1.1.0']);

      expect((await manager.setEnabled('com.acme.operations', false)).enabled).toBe(false);
      expect(await manager.getEnabledExtensionRoots()).toEqual([]);
      expect((await manager.setEnabled('com.acme.operations', true)).enabled).toBe(true);

      const rolledBack = await manager.rollback('com.acme.operations');
      expect(rolledBack.activeVersion).toBe('1.0.0');
      expect(rolledBack.activationHistory).toEqual(['1.1.0']);
      expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.operations', '1.0.0'))).toBe(true);

      const removed = await manager.uninstall('com.acme.operations');
      expect(removed.removed).toBe(true);
      expect(typeof removed.recoveryId).toBe('string');
      expect('recoveryPath' in removed).toBe(false);
      expect(removed.recoveryId).not.toContain(dataDirectory);
      expect(JSON.stringify(removed)).not.toContain(dataDirectory);
      expect((await fs.stat(path.join(trashPathFor(dataDirectory), removed.recoveryId))).isDirectory()).toBe(true);
      expect((await manager.list()).extensions).toEqual([]);
      expect(await manager.getEnabledExtensionRoots()).toEqual([]);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(activations).toEqual([
        { activeVersion: '1.0.0', enabled: true },
        { activeVersion: '1.1.0', enabled: true },
        { activeVersion: '1.1.0', enabled: false },
        { activeVersion: '1.1.0', enabled: true },
        { activeVersion: '1.0.0', enabled: true },
        { removed: true },
      ]);
    });

    it('cleans staging and performs no activation when staged validation fails', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      await managerAt(dataDirectory).trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: packed.keys.publicKey,
      });
      let activationCalls = 0;
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => { throw new Error('invalid staged runtime'); },
        reconcileActivation: async () => {
          activationCalls += 1;
          return { openCode: {}, rollback: async () => {} };
        },
      });

      await expect(manager.installPackage(packed.buffer)).rejects.toMatchObject({ code: 'extension_validation_failed' });
      expect(activationCalls).toBe(0);
      expect(await fs.readdir(stagingPathFor(dataDirectory))).toEqual([]);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses an unmanaged destination without overwriting or activating it', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      await managerAt(dataDirectory).trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      const destination = path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.0.0');
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'user-owned.txt'), 'preserve');
      let activationCalls = 0;
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => {
          activationCalls += 1;
          return { openCode: {}, rollback: async () => {} };
        },
      });

      await expect(manager.installPackage(packed.buffer)).rejects.toMatchObject({
        code: 'unmanaged_version_conflict',
        status: 409,
      });
      expect(activationCalls).toBe(0);
      expect(await fs.readFile(path.join(destination, 'user-owned.txt'), 'utf8')).toBe('preserve');
      expect(await fs.readdir(stagingPathFor(dataDirectory))).toEqual([]);
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('removes the moved version and preserves empty durable state when activation rejects atomically', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      await managerAt(dataDirectory).trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      let selfRollback = false;
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => {
          selfRollback = true;
          throw new InteractiveUIExtensionManagerError('activation failed', 'activation_failed', 500);
        },
      });

      await expect(manager.installPackage(packed.buffer)).rejects.toMatchObject({ code: 'activation_failed' });
      expect(selfRollback).toBe(true);
      expect(await fs.readdir(stagingPathFor(dataDirectory))).toEqual([]);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rolls activation back and removes a new version when the durable state write fails', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      await managerAt(dataDirectory).trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      const failingFs = {
        ...fs,
        writeFile: async (filePath, ...rest) => {
          if (String(filePath).includes('installations.json.') && String(filePath).endsWith('.tmp')) {
            throw new Error('simulated state failure');
          }
          return fs.writeFile(filePath, ...rest);
        },
      };
      let rollbacks = 0;
      const manager = managerAt(dataDirectory, {
        fsImpl: failingFs,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({
          openCode: { changed: true },
          rollback: async () => { rollbacks += 1; },
        }),
      });

      await expect(manager.installPackage(packed.buffer)).rejects.toMatchObject({ code: 'manager_write_failed', status: 500 });
      expect(rollbacks).toBe(1);
      expect(await fs.readdir(stagingPathFor(dataDirectory))).toEqual([]);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.readdir(path.dirname(statePathFor(dataDirectory))))
        .filter((name) => name.startsWith('installations.json.') && name.endsWith('.tmp'))).toEqual([]);
      expect((await managerAt(dataDirectory).list()).publishers).toHaveLength(1);
    });

    it('preserves the previous version and exact state when an update state write fails', async () => {
      const { dataDirectory } = await createManager();
      const keys = generatePublisherKeyPair();
      const versionOne = await signPackage({ keys, version: '1.0.0' });
      const versionTwo = await signPackage({ keys, version: '1.1.0' });
      const healthy = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      await healthy.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey,
      });
      await healthy.installPackage(versionOne.buffer);
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');
      const failingFs = {
        ...fs,
        writeFile: async (filePath, ...rest) => {
          if (String(filePath).includes('installations.json.') && String(filePath).endsWith('.tmp')) throw new Error('disk full');
          return fs.writeFile(filePath, ...rest);
        },
      };
      let rollbacks = 0;
      const failing = managerAt(dataDirectory, {
        fsImpl: failingFs,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => { rollbacks += 1; } }),
      });

      await expect(failing.installPackage(versionTwo.buffer)).rejects.toMatchObject({ code: 'manager_write_failed' });
      expect(rollbacks).toBe(1);
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
      expect((await healthy.list()).extensions[0].activeVersion).toBe('1.0.0');
      expect((await fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.0.0'))).isDirectory()).toBe(true);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.1.0')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('restores the managed version tree when uninstall state persistence fails', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      const healthy = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      await healthy.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      await healthy.installPackage(packed.buffer);
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');
      const failingFs = {
        ...fs,
        writeFile: async (filePath, ...rest) => {
          if (String(filePath).includes('installations.json.') && String(filePath).endsWith('.tmp')) throw new Error('disk full');
          return fs.writeFile(filePath, ...rest);
        },
      };
      let rollbacks = 0;
      const failing = managerAt(dataDirectory, {
        fsImpl: failingFs,
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => { rollbacks += 1; } }),
      });

      await expect(failing.uninstall('com.acme.operations')).rejects.toMatchObject({ code: 'manager_write_failed' });
      expect(rollbacks).toBe(1);
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
      expect((await fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.0.0'))).isDirectory()).toBe(true);
      expect(await fs.readdir(trashPathFor(dataDirectory))).toEqual([]);
    });

    it('serializes concurrent installs without overlapping validation or losing either version', async () => {
      const { dataDirectory } = await createManager();
      const keys = generatePublisherKeyPair();
      const versionOne = await signPackage({ keys, version: '1.0.0' });
      const versionTwo = await signPackage({ keys, version: '1.1.0' });
      let activeValidations = 0;
      let maximumActiveValidations = 0;
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {
          activeValidations += 1;
          maximumActiveValidations = Math.max(maximumActiveValidations, activeValidations);
          await Promise.resolve();
          activeValidations -= 1;
        },
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      await manager.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey,
      });

      await Promise.all([manager.installPackage(versionOne.buffer), manager.installPackage(versionTwo.buffer)]);
      expect(maximumActiveValidations).toBe(1);
      const extension = (await manager.list()).extensions[0];
      expect(extension.activeVersion).toBe('1.1.0');
      expect(Object.keys(extension.versions)).toEqual(['1.0.0', '1.1.0']);
      expect(extension.activationHistory).toEqual(['1.0.0']);
    });

    it('fails closed on tampered rollback/enable targets and quarantines a corrupt active root per extension', async () => {
      const { dataDirectory } = await createManager();
      const keys = generatePublisherKeyPair();
      const versionOne = await signPackage({ keys, version: '1.0.0' });
      const versionTwo = await signPackage({ keys, version: '1.1.0' });
      const warnings = [];
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
        logger: { warn: (message) => warnings.push(message) },
      });
      await manager.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: keys.publicKey,
      });
      await manager.installPackage(versionOne.buffer);
      await manager.installPackage(versionTwo.buffer);
      await fs.writeFile(
        path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.0.0', 'ui', 'view.json'),
        '{"tampered":true}',
      );

      await expect(manager.rollback('com.acme.operations')).rejects.toMatchObject({ code: 'extension_integrity_failed' });
      expect((await manager.list()).extensions[0].activeVersion).toBe('1.1.0');

      await fs.writeFile(
        path.join(versionsPathFor(dataDirectory), 'com.acme.operations', '1.1.0', 'ui', 'view.json'),
        '{"tampered":true}',
      );
      expect(await manager.getEnabledExtensionRoots()).toEqual([]);
      expect(await manager.getEnabledExtensionRoots()).toEqual([]);
      expect(warnings).toHaveLength(1);
      await manager.setEnabled('com.acme.operations', false);
      await expect(manager.setEnabled('com.acme.operations', true)).rejects.toMatchObject({ code: 'extension_integrity_failed' });
      expect((await manager.list()).extensions[0].enabled).toBe(false);
    });

    it('rejects corrupt or widened durable installation state instead of exposing it', async () => {
      const { dataDirectory } = await createManager();
      const packed = await signPackage();
      const manager = managerAt(dataDirectory, {
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      await manager.trustPublisher({
        id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: packed.keys.publicKey,
      });
      await manager.installPackage(packed.buffer);
      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      state.extensions['com.acme.operations'].versions['1.0.0'].managedPath = '/tmp/leak';
      await fs.writeFile(statePathFor(dataDirectory), JSON.stringify(state));

      await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });
      await expect(manager.getEnabledExtensionRoots()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });
    });
  });

  describe('signed Marketplace manager flow', () => {
    it('requires fingerprint confirmation and persists only a sanitized reloadable Marketplace record', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const fetchImpl = async (url) => String(url) === catalogUrl
        ? new Response(JSON.stringify(fixture.catalog), { status: 200 })
        : new Response('not found', { status: 404 });
      const manager = managerAt(dataDirectory, { fetchImpl });

      const inspection = await manager.inspectMarketplace(catalogUrl);
      expect(inspection).toEqual({
        id: 'com.acme.marketplace',
        name: 'Acme Marketplace',
        keyId: 'catalog-2026',
        catalogUrl,
        fingerprint: publicKeyFingerprint(fixture.marketplaceKeys.publicKey),
        extensionCount: 1,
      });
      expect(JSON.stringify(inspection)).not.toContain('BEGIN PUBLIC KEY');
      await expect(manager.addMarketplace({ catalogUrl }))
        .rejects.toMatchObject({ code: 'marketplace_confirmation_required', details: inspection });
      await expect(manager.addMarketplace({
        catalogUrl,
        confirmedFingerprint: inspection.fingerprint,
        publicKey: fixture.marketplaceKeys.publicKey,
      })).rejects.toMatchObject({ code: 'invalid_marketplace_input' });

      expect(await manager.addMarketplace({
        catalogUrl,
        confirmedFingerprint: inspection.fingerprint,
      })).toEqual({
        id: 'com.acme.marketplace',
        name: 'Acme Marketplace',
        keyId: 'catalog-2026',
        catalogUrl,
        fingerprint: inspection.fingerprint,
      });
      expect((await fs.stat(marketplacesPathFor(dataDirectory))).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(marketplacesPathFor(dataDirectory)))).mode & 0o777).toBe(0o700);

      const snapshot = await managerAt(dataDirectory, { fetchImpl }).list();
      expect(snapshot.marketplaces).toEqual([expect.objectContaining({
        id: 'com.acme.marketplace',
        keyId: 'catalog-2026',
        catalogUrl,
        fingerprint: inspection.fingerprint,
      })]);
      const fetched = await manager.fetchMarketplaceCatalog('com.acme.marketplace');
      expect(fetched.catalog.entries[0]).toMatchObject({
        id: 'com.acme.operations',
        version: '1.0.0',
        publisher: {
          id: 'com.acme.publisher',
          name: 'Acme',
          keyId: 'release-2026',
          fingerprint: publicKeyFingerprint(fixture.publisherKeys.publicKey),
        },
      });
      const serialized = JSON.stringify({ snapshot, fetched });
      expect(serialized).not.toContain('BEGIN PUBLIC KEY');
      expect(serialized).not.toContain(dataDirectory);
      expect(serialized).not.toContain(fixture.entry.packageUrl);

      expect(await manager.removeMarketplace('com.acme.marketplace')).toEqual({ removed: true });
      expect((await manager.list()).marketplaces).toEqual([]);
      await expect(manager.removeMarketplace('com.acme.marketplace'))
        .rejects.toMatchObject({ code: 'marketplace_not_found', status: 404 });
    });

    it('installs an exactly catalog-bound package with scoped trust and Marketplace provenance', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const fetchImpl = async (url) => {
        if (String(url) === catalogUrl) return new Response(JSON.stringify(fixture.catalog), { status: 200 });
        if (String(url) === fixture.entry.packageUrl) return new Response(fixture.packed.buffer, { status: 200 });
        return new Response('not found', { status: 404 });
      };
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({
          openCode: { changed: true, reloaded: true, external: false },
          rollback: async () => {},
        }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });

      const installed = await manager.installFromMarketplace(
        'com.acme.marketplace',
        'com.acme.operations',
        '1.0.0',
      );
      expect(installed.installed).toBe(true);
      expect(installed.extension.versions['1.0.0'].source).toEqual({
        type: 'marketplace',
        marketplaceId: 'com.acme.marketplace',
      });
      const snapshot = await manager.list();
      expect(snapshot.publishers).toEqual([]);
      expect(snapshot.extensions[0].versions['1.0.0'].source).toEqual({
        type: 'marketplace',
        marketplaceId: 'com.acme.marketplace',
      });
      const durable = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      expect(durable.extensions['com.acme.operations'].versions['1.0.0'].source).toEqual({
        type: 'marketplace',
        marketplaceId: 'com.acme.marketplace',
      });
      expect(JSON.stringify({ installed, snapshot })).not.toContain('BEGIN PUBLIC KEY');
      expect(JSON.stringify({ installed, snapshot })).not.toContain(dataDirectory);
      expect(JSON.stringify({ installed, snapshot })).not.toContain(fixture.entry.packageUrl);

      const uncatalogued = await signPackage({
        keys: fixture.publisherKeys,
        extensionId: 'com.acme.uncatalogued',
      });
      await expect(manager.installPackage(uncatalogued.buffer))
        .rejects.toMatchObject({ code: 'publisher_untrusted', status: 403 });
      await manager.removeMarketplace('com.acme.marketplace');
      await expect(manager.installPackage(uncatalogued.buffer))
        .rejects.toMatchObject({ code: 'publisher_untrusted', status: 403 });
      expect((await manager.list()).publishers).toEqual([]);
    });

    it('rejects unsafe catalog and package URLs before trusting or downloading package bytes', async () => {
      const { dataDirectory } = await createManager();
      let fetchCalls = 0;
      const manager = managerAt(dataDirectory, { fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected'); } });
      for (const value of [
        'http://extensions.example.com/catalog.json',
        'https://user:secret@extensions.example.com/catalog.json',
        'https://extensions.example.com/catalog.json#signed-but-not-sent',
      ]) {
        await expect(manager.inspectMarketplace(value)).rejects.toMatchObject({ code: 'unsafe_url' });
      }
      expect(fetchCalls).toBe(0);

      const unsafeFixture = await createMarketplaceFixture({
        packageUrl: 'http://extensions.example.com/operations.ocix',
      });
      const unsafeManager = managerAt(dataDirectory, {
        fetchImpl: async () => new Response(JSON.stringify(unsafeFixture.catalog), { status: 200 }),
      });
      await expect(unsafeManager.inspectMarketplace('https://extensions.example.com/catalog.json'))
        .rejects.toMatchObject({ code: 'unsafe_url' });
    });

    it('forbids redirects for both catalog and package transport', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const redirects = [];
      let redirectCatalog = true;
      let redirectPackage = false;
      const redirected = (url) => ({
        ok: true,
        status: 200,
        redirected: true,
        url,
        body: { cancel: async () => {} },
      });
      const fetchImpl = async (url, options) => {
        redirects.push(options.redirect);
        if (String(url) === catalogUrl) {
          if (redirectCatalog) return redirected('http://remote.example.com/catalog.json');
          return new Response(JSON.stringify(fixture.catalog), { status: 200 });
        }
        if (redirectPackage) return redirected('http://remote.example.com/operations.ocix');
        return new Response(fixture.packed.buffer, { status: 200 });
      };
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });

      await expect(manager.inspectMarketplace(catalogUrl))
        .rejects.toMatchObject({ code: 'remote_redirect_not_allowed', status: 502 });
      redirectCatalog = false;
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      redirectPackage = true;
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'remote_redirect_not_allowed', status: 502 });
      expect(redirects.every((value) => value === 'error')).toBe(true);
    });

    it('enforces its own shared deadline even when injected transport ignores abort', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      let mode = 'fetch-hang';
      let bodyCancelled = false;
      const never = () => new Promise(() => {});
      const fetchImpl = async (url) => {
        if (mode === 'fetch-hang') return never();
        if (String(url) === catalogUrl) {
          if (mode === 'body-hang') {
            return {
              ok: true,
              status: 200,
              headers: { get: () => null },
              body: {
                getReader: () => ({
                  read: never,
                  cancel: async () => { bodyCancelled = true; },
                  releaseLock: () => {},
                }),
              },
            };
          }
          return new Response(JSON.stringify(fixture.catalog), { status: 200 });
        }
        if (mode === 'package-hang') return never();
        return new Response(fixture.packed.buffer, { status: 200 });
      };
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        fetchTimeoutMs: 20,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });

      await expect(manager.inspectMarketplace(catalogUrl))
        .rejects.toMatchObject({ code: 'remote_timeout', status: 504 });
      mode = 'ok';
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      mode = 'body-hang';
      await expect(manager.fetchMarketplaceCatalog('com.acme.marketplace'))
        .rejects.toMatchObject({ code: 'remote_timeout', status: 504 });
      expect(bodyCancelled).toBe(true);
      mode = 'package-hang';
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'remote_timeout', status: 504 });
      mode = 'ok';
      await expect(manager.fetchMarketplaceCatalog('com.acme.marketplace')).resolves.toBeDefined();
    });

    it('cancels non-OK and oversized Marketplace bodies without consuming or masking them', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const discarded = { catalog: false, declared: false, package: false, packageDeclared: false };
      const consumed = { catalog: false, declared: false, package: false, packageDeclared: false };
      const discardBody = (slot) => ({
        cancel: async () => { discarded[slot] = true; },
        getReader: () => { consumed[slot] = true; throw new Error('must not consume'); },
      });
      let streamCancelled = false;
      let packageStreamCancelled = false;
      let releaseCalled = false;
      const reader = {
        read: async () => ({ done: false, value: Buffer.alloc(2 * 1024 * 1024 + 1) }),
        cancel: async () => { streamCancelled = true; },
        releaseLock: () => { releaseCalled = true; throw new Error('release failure'); },
      };
      let mode = 'ok';
      const fetchImpl = async (url) => {
        if (String(url) === catalogUrl) {
          if (mode === 'catalog-non-ok') return { ok: false, status: 500, body: discardBody('catalog') };
          if (mode === 'catalog-declared') {
            return {
              ok: true,
              status: 200,
              headers: { get: () => String(2 * 1024 * 1024 + 1) },
              body: discardBody('declared'),
            };
          }
          if (mode === 'catalog-stream') {
            return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } };
          }
          return new Response(JSON.stringify(fixture.catalog), { status: 200 });
        }
        if (mode === 'package-non-ok') return { ok: false, status: 503, body: discardBody('package') };
        if (mode === 'package-declared') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => String(20 * 1024 * 1024 + 1) },
            body: discardBody('packageDeclared'),
          };
        }
        if (mode === 'package-stream') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: {
              getReader: () => ({
                read: async () => ({ done: false, value: { byteLength: 20 * 1024 * 1024 + 1 } }),
                cancel: async () => { packageStreamCancelled = true; },
                releaseLock: () => {},
              }),
            },
          };
        }
        return new Response(fixture.packed.buffer, { status: 200 });
      };
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });

      mode = 'catalog-non-ok';
      await expect(manager.inspectMarketplace(catalogUrl)).rejects.toMatchObject({ code: 'marketplace_unavailable' });
      expect(discarded.catalog).toBe(true);
      expect(consumed.catalog).toBe(false);
      mode = 'catalog-declared';
      await expect(manager.inspectMarketplace(catalogUrl)).rejects.toMatchObject({ code: 'remote_content_too_large' });
      expect(discarded.declared).toBe(true);
      expect(consumed.declared).toBe(false);
      mode = 'catalog-stream';
      const overflow = await manager.inspectMarketplace(catalogUrl).catch((error) => error);
      expect(overflow).toMatchObject({ code: 'remote_content_too_large', status: 413 });
      expect(overflow.message).toBe('Marketplace catalog exceeds the size limit');
      expect(streamCancelled).toBe(true);
      expect(releaseCalled).toBe(true);
      mode = 'package-non-ok';
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'package_download_failed', status: 502 });
      expect(discarded.package).toBe(true);
      expect(consumed.package).toBe(false);
      mode = 'package-declared';
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'remote_content_too_large', status: 413 });
      expect(discarded.packageDeclared).toBe(true);
      expect(consumed.packageDeclared).toBe(false);
      mode = 'package-stream';
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'remote_content_too_large', status: 413 });
      expect(packageStreamCancelled).toBe(true);
    });

    it('rejects catalog key substitution, package hash substitution, and exact tuple mismatch', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const substitutedCatalog = (await createMarketplaceFixture({
        publisherKeys: fixture.publisherKeys,
      })).catalog;
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      let catalog = fixture.catalog;
      let packageBytes = fixture.packed.buffer;
      const fetchImpl = async (url) => String(url) === catalogUrl
        ? new Response(JSON.stringify(catalog), { status: 200 })
        : new Response(packageBytes, { status: 200 });
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });

      catalog = substitutedCatalog;
      await expect(manager.fetchMarketplaceCatalog('com.acme.marketplace'))
        .rejects.toMatchObject({ code: 'marketplace_key_conflict', status: 409 });
      catalog = fixture.catalog;
      packageBytes = Buffer.concat([fixture.packed.buffer, Buffer.from('substitution')]);
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'catalog_package_hash_mismatch', status: 403 });

      const tupleFixture = await createMarketplaceFixture({
        marketplaceKeys: fixture.marketplaceKeys,
        publisherKeys: fixture.publisherKeys,
        extensionName: 'Catalog Alias',
      });
      catalog = tupleFixture.catalog;
      packageBytes = tupleFixture.packed.buffer;
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'catalog_package_identity_mismatch', status: 403 });
      expect((await manager.list()).extensions).toEqual([]);
    });

    it('does not leak publisher keys on signed tuple mismatch', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      let catalog = fixture.catalog;
      const fetchImpl = async (url) => String(url) === catalogUrl
        ? new Response(JSON.stringify(catalog), { status: 200 })
        : new Response(fixture.packed.buffer, { status: 200 });
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      catalog = createSignedExtensionCatalog({
        marketplaceId: 'com.acme.marketplace',
        marketplaceName: 'Acme Marketplace',
        keyId: 'catalog-2026',
        privateKey: fixture.marketplaceKeys.privateKey,
        generatedAt: '2026-08-09T00:00:00.000Z',
        entries: [{
          ...fixture.entry,
          publisher: {
            ...fixture.entry.publisher,
            id: 'com.acme.substituted-publisher',
          },
        }],
      });

      const error = await manager.installFromMarketplace(
        'com.acme.marketplace',
        'com.acme.operations',
        '1.0.0',
      ).catch((caught) => caught);
      expect(error).toMatchObject({ code: 'catalog_package_identity_mismatch', status: 403 });
      const publicError = JSON.stringify({ message: error.message, code: error.code, details: error.details });
      expect(publicError).not.toContain('BEGIN PUBLIC KEY');
      expect(publicError).not.toContain(dataDirectory);
    });

    it('preserves compatible global trust and rejects a conflicting global slot before package download', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      let packageFetches = 0;
      const fetchImpl = async (url) => {
        if (String(url) === catalogUrl) return new Response(JSON.stringify(fixture.catalog), { status: 200 });
        packageFetches += 1;
        return new Response(fixture.packed.buffer, { status: 200 });
      };
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      await manager.trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: fixture.publisherKeys.publicKey,
      });
      await manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0');
      expect((await manager.list()).publishers[0].keys[0].source).toBe('manual');

      const conflictingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-'));
      temporaryDirectories.push(conflictingDirectory);
      let conflictingPackageFetches = 0;
      const conflicting = managerAt(conflictingDirectory, {
        fetchImpl: async (url) => {
          if (String(url) === catalogUrl) return new Response(JSON.stringify(fixture.catalog), { status: 200 });
          conflictingPackageFetches += 1;
          return new Response(fixture.packed.buffer, { status: 200 });
        },
        validateStagedPackage: async () => {},
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const conflictingInspection = await conflicting.inspectMarketplace(catalogUrl);
      await conflicting.addMarketplace({ catalogUrl, confirmedFingerprint: conflictingInspection.fingerprint });
      await conflicting.trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: generatePublisherKeyPair().publicKey,
      });
      await expect(conflicting.installFromMarketplace(
        'com.acme.marketplace',
        'com.acme.operations',
        '1.0.0',
      )).rejects.toMatchObject({ code: 'publisher_key_conflict', status: 409 });
      expect(conflictingPackageFetches).toBe(0);
      expect(packageFetches).toBe(1);
    });

    it('keeps Marketplace verification request-scoped when installation fails and serializes public snapshots', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const fetchImpl = async (url) => String(url) === catalogUrl
        ? new Response(JSON.stringify(fixture.catalog), { status: 200 })
        : new Response(fixture.packed.buffer, { status: 200 });
      let releaseValidation;
      let validationStarted;
      const started = new Promise((resolve) => { validationStarted = resolve; });
      const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
      let failValidation = false;
      const manager = managerAt(dataDirectory, {
        fetchImpl,
        validateStagedPackage: async () => {
          validationStarted();
          await validationGate;
          if (failValidation) throw new Error('invalid staged runtime');
        },
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
      });
      const inspection = await manager.inspectMarketplace(catalogUrl);
      await manager.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      const installing = manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0');
      await started;
      let listSettled = false;
      const listing = manager.list().then((value) => { listSettled = true; return value; });
      await Promise.resolve();
      expect(listSettled).toBe(false);
      releaseValidation();
      await installing;
      expect((await listing).extensions).toHaveLength(1);
      expect((await manager.list()).publishers).toEqual([]);

      await manager.uninstall('com.acme.operations');
      failValidation = true;
      releaseValidation = () => {};
      await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
        .rejects.toMatchObject({ code: 'extension_validation_failed' });
      expect((await manager.list()).publishers).toEqual([]);
      await expect(fs.stat(path.join(versionsPathFor(dataDirectory), 'com.acme.operations')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('fails visibly on corrupt Marketplace state without mutating global trust', async () => {
      const { dataDirectory } = await createManager();
      const fixture = await createMarketplaceFixture();
      const catalogUrl = 'https://extensions.example.com/catalog.json';
      const fetchImpl = async (url) => String(url) === catalogUrl
        ? new Response(JSON.stringify(fixture.catalog), { status: 200 })
        : new Response(fixture.packed.buffer, { status: 200 });
      const healthy = managerAt(dataDirectory, { fetchImpl });
      const inspection = await healthy.inspectMarketplace(catalogUrl);
      await healthy.addMarketplace({ catalogUrl, confirmedFingerprint: inspection.fingerprint });
      const stored = JSON.parse(await fs.readFile(marketplacesPathFor(dataDirectory), 'utf8'));
      stored.marketplaces['com.acme.marketplace'].publicKey = 'not-a-key';
      await fs.writeFile(marketplacesPathFor(dataDirectory), JSON.stringify(stored));
      await expect(healthy.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });

      stored.marketplaces['com.acme.marketplace'].publicKey = fixture.marketplaceKeys.publicKey;
      await fs.writeFile(marketplacesPathFor(dataDirectory), JSON.stringify(stored));
      let trustWrites = 0;
      const failingFs = {
        ...fs,
        writeFile: async (filePath, ...rest) => {
          if (String(filePath).includes('trust.json.') && String(filePath).endsWith('.tmp')) {
            trustWrites += 1;
            if (trustWrites === 2) throw new Error('rollback disk failure');
          }
          return fs.writeFile(filePath, ...rest);
        },
      };
      const failing = managerAt(dataDirectory, {
        fsImpl: failingFs,
        fetchImpl,
        validateStagedPackage: async ({ directory }) => { throw new Error(directory); },
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
        logger: { error: () => {} },
      });
      const validationError = await failing.installFromMarketplace(
        'com.acme.marketplace',
        'com.acme.operations',
        '1.0.0',
      ).catch((error) => error);
      expect(validationError).toMatchObject({ code: 'extension_validation_failed', status: 400 });
      expect(validationError.message).toBe('Staged extension validation failed');
      expect(validationError.message).not.toContain(dataDirectory);
      expect(trustWrites).toBe(0);
      expect((await failing.list()).publishers).toEqual([]);
    });
  });

  describe('Remote OCIX manager regression contract', () => {
    const appEntryUrl = 'https://apps.example.com/manifest.json';

    it('inspects one signed manifest without writes or resource fetches', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-inspect-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const requested = [];
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document, requested) });

      const inspection = await manager.inspectRemote(appEntryUrl);
      expect(inspection).toMatchObject({
        extension: { id: 'com.acme.remote', version: '1.0.0' },
        publisher: {
          id: 'com.acme.publisher',
          keyId: 'release-2026',
          fingerprint: expect.stringMatching(/^sha256-/),
          trusted: false,
        },
        manifest: { appEntryUrl, manifestHash: expect.stringMatching(/^sha256-/) },
        connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      });
      expect(requested).toEqual([appEntryUrl]);
      expect((await manager.list()).extensions).toEqual([]);
      expect((await manager.list()).publishers).toEqual([]);
      await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(requested.some((url) => url.includes('/ui/'))).toBe(false);
    });

    it('refetches before connect and requires exact current fingerprint plus manifest hash', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-refetch-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const first = createRemoteManifest({ keys, viewText: 'first' });
      const second = createRemoteManifest({ keys, viewText: 'second' });
      const requested = [];
      let calls = 0;
      const manager = remoteManagerAt(dataDirectory, {
        fetchImpl: async (url) => {
          calls += 1;
          requested.push(String(url));
          return new Response(JSON.stringify(calls === 1 ? first.document : second.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const inspection = await manager.inspectRemote(appEntryUrl);

      await expect(manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'remote_confirmation_required', status: 403 });
      expect(calls).toBe(2);
      expect(requested).toEqual([appEntryUrl, appEntryUrl]);
      expect((await manager.list()).extensions).toEqual([]);
      expect((await manager.list()).publishers).toEqual([]);
      await expect(fs.stat(path.join(dataDirectory, 'extensions'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('connects a Remote with strict metadata-only shell and no global trust mutation', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-connect-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys, native: true });
      const requested = [];
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document, requested) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const connected = await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });

      expect(Object.keys(connected).sort()).toEqual(['connector', 'extension']);
      expect(JSON.stringify(connected)).not.toContain('installationId');
      expect(connected).toMatchObject({
        extension: { id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' },
        connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      });
      expect(requested).toEqual([appEntryUrl, appEntryUrl]);

      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      const metadata = state.extensions['com.acme.remote'].versions['1.0.0'];
      expect(metadata).toMatchObject({
        delivery: 'remote',
        source: { type: 'remote', appEntryUrl },
        publisher: { id: 'com.acme.publisher', keyId: 'release-2026', fingerprint: inspection.publisher.fingerprint },
        remote: {
          appEntryUrl,
          connectorRefs: [{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }],
          acceptedManifest: { version: '1.0.0', manifestHash: inspection.manifest.manifestHash, keyId: 'release-2026' },
          approvedPermissions: { nativeCode: true },
          status: 'active',
        },
      });
      expect(metadata.remote.publisherPublicKey).toBe(keys.publicKey);
      expect((await manager.list()).publishers).toEqual([]);
      const consentStore = JSON.parse(await fs.readFile(remoteConsentsPathFor(dataDirectory), 'utf8'));
      expect(Object.values(consentStore.consents)).toHaveLength(1);
      expect(Object.values(consentStore.consents)[0]).toMatchObject({
        extensionId: 'com.acme.remote',
        consentDigest: expect.stringMatching(/^sha256-/),
      });
      expect(JSON.stringify(consentStore)).not.toContain('BEGIN PUBLIC KEY');
      expect(JSON.stringify(consentStore)).not.toContain(appEntryUrl);

      const shell = path.join(versionsPathFor(dataDirectory), 'com.acme.remote', '1.0.0');
      expect(JSON.parse(await fs.readFile(path.join(shell, HOSTED_OCIX_SIGNED_MANIFEST_FILE), 'utf8')).app.id)
        .toBe('com.acme.remote');
      expect(JSON.parse(await fs.readFile(path.join(shell, 'openchamber.extension.json'), 'utf8')).id)
        .toBe('com.acme.remote');
      expect(await fs.readFile(path.join(shell, 'agent-runtime', 'tools', 'remote_open.ts'), 'utf8'))
        .toContain('openchamber://interactive-result/v1');
      await expect(fs.stat(path.join(shell, 'ui'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await manager.getEnabledExtensionRoots())[0].directory).toBe(shell);
    });

    it('reloads a connected Remote and sanitizes private state from public list snapshots', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-restart-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });

      const restarted = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const snapshot = await restarted.list();
      const serialized = JSON.stringify(snapshot);
      expect(snapshot.publishers).toEqual([]);
      expect(snapshot.extensions[0].versions['1.0.0']).not.toHaveProperty('generationId');
      expect(snapshot.extensions[0].versions['1.0.0'].remote).not.toHaveProperty('installationId');
      expect(snapshot.extensions[0].versions['1.0.0'].remote).not.toHaveProperty('publisherPublicKey');
      expect(serialized).not.toContain('BEGIN PUBLIC KEY');
      expect(serialized).not.toContain(dataDirectory);
      expect((await restarted.getEnabledExtensionRoots())).toHaveLength(1);
    });

    it('rejects signed Remote documents with unknown or corrupt fields before any write', async () => {
      const cases = [
        { extensionExtra: { id: 'com.acme.other' } },
        { topLevelExtra: { resources: { corrupt: true } } },
      ];
      for (const [index, options] of cases.entries()) {
        const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `ocix-manager-remote-schema-${index}-`));
        temporaryDirectories.push(dataDirectory);
        const keys = generatePublisherKeyPair();
        const remote = createRemoteManifest({ keys, ...options });
        const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
        await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
          code: expect.stringMatching(/^(invalid_|hosted_)/),
        });
        expect((await manager.list()).extensions).toEqual([]);
        expect((await manager.list()).publishers).toEqual([]);
        await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });

    it('fails closed and quarantines roots after signed shell, file, or private-key tampering', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-tamper-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });
      const shell = path.join(versionsPathFor(dataDirectory), 'com.acme.remote', '1.0.0');
      await fs.writeFile(path.join(shell, HOSTED_OCIX_SIGNED_MANIFEST_FILE), '{"tampered":true}');
      expect(await manager.getEnabledExtensionRoots()).toEqual([]);

      const cleanDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-file-tamper-'));
      temporaryDirectories.push(cleanDirectory);
      const cleanManager = remoteManagerAt(cleanDirectory, { fetchImpl: remoteFetch(remote.document) });
      const cleanInspection = await cleanManager.inspectRemote(appEntryUrl);
      await cleanManager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: cleanInspection.publisher.fingerprint,
        confirmedManifestHash: cleanInspection.manifest.manifestHash,
      });
      await fs.writeFile(path.join(versionsPathFor(cleanDirectory), 'com.acme.remote', '1.0.0', 'openchamber.extension.json'), '{}');
      expect(await cleanManager.getEnabledExtensionRoots()).toEqual([]);

      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      state.extensions['com.acme.remote'].versions['1.0.0'].remote.publisherPublicKey = generatePublisherKeyPair().publicKey;
      await fs.writeFile(statePathFor(dataDirectory), JSON.stringify(state));
      await expect(manager.list()).rejects.toMatchObject({ code: 'manager_data_corrupt', status: 500 });
    });

    it('rejects missing, invalid, and preflight Remote adapters without writes', async () => {
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const cases = [
        { options: { validateRemoteMetadata: null }, code: 'remote_metadata_validation_unavailable' },
        { options: { validateRemoteMetadata: async () => null }, code: 'remote_metadata_validation_invalid' },
        { options: { validateRemoteMetadata: async () => { throw new InteractiveUIExtensionManagerError('bad preflight', 'preflight_failed', 422); } }, code: 'preflight_failed' },
      ];
      for (const [index, testCase] of cases.entries()) {
        const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `ocix-manager-remote-adapter-${index}-`));
        temporaryDirectories.push(dataDirectory);
        const manager = managerAt(dataDirectory, {
          fetchImpl: remoteFetch(remote.document),
          reconcileActivation: async () => ({ openCode: {}, rollback: async () => {} }),
          ...testCase.options,
        });
        await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({ code: testCase.code });
        expect((await manager.list()).extensions).toEqual([]);
        expect((await manager.list()).publishers).toEqual([]);
        await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });

    it('handles global same-slot, conflicting-slot, and toString key ids without prototype coercion', async () => {
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys, publisherKeyId: 'toString', extensionId: 'com.acme.remote.tostring' });
      const sameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-own-slot-'));
      temporaryDirectories.push(sameDirectory);
      const same = remoteManagerAt(sameDirectory, { fetchImpl: remoteFetch(remote.document) });
      await same.trustPublisher({ id: 'com.acme.publisher', name: 'Acme', keyId: 'toString', publicKey: keys.publicKey });
      const sameInspection = await same.inspectRemote(appEntryUrl);
      await expect(same.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: sameInspection.publisher.fingerprint,
        confirmedManifestHash: sameInspection.manifest.manifestHash,
      })).resolves.toMatchObject({ extension: { id: 'com.acme.remote.tostring' } });
      expect((await same.list()).publishers[0].keys).toEqual([expect.objectContaining({ keyId: 'toString' })]);

      const conflictDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-slot-conflict-'));
      temporaryDirectories.push(conflictDirectory);
      const conflict = remoteManagerAt(conflictDirectory, { fetchImpl: remoteFetch(remote.document) });
      await conflict.trustPublisher({
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'toString',
        publicKey: generatePublisherKeyPair().publicKey,
      });
      const conflictInspection = await conflict.inspectRemote(appEntryUrl);
      await expect(conflict.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: conflictInspection.publisher.fingerprint,
        confirmedManifestHash: conflictInspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'publisher_key_conflict', status: 409 });
      expect((await conflict.list()).extensions).toEqual([]);
    });

    it('leaves no active state, consent, or trust after failure and retains the exact reusable shell', async () => {
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const activationDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-activation-fail-'));
      temporaryDirectories.push(activationDirectory);
      const activationManager = remoteManagerAt(activationDirectory, {
        fetchImpl: remoteFetch(remote.document),
        reconcileActivation: async () => { throw new InteractiveUIExtensionManagerError('activation failed', 'activation_failed', 500); },
      });
      const activationInspection = await activationManager.inspectRemote(appEntryUrl);
      await expect(activationManager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: activationInspection.publisher.fingerprint,
        confirmedManifestHash: activationInspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'activation_failed' });
      await expect(fs.stat(path.join(
        versionsPathFor(activationDirectory),
        'com.acme.remote',
        '1.0.0',
        HOSTED_OCIX_SIGNED_MANIFEST_FILE,
      ))).resolves.toBeTruthy();
      await expect(fs.stat(statePathFor(activationDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await fs.readFile(remoteConsentsPathFor(activationDirectory), 'utf8')).consents).toEqual({});
      expect((await activationManager.list()).publishers).toEqual([]);

      const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-state-fail-'));
      temporaryDirectories.push(stateDirectory);
      const failingFs = {
        ...fs,
        writeFile: async (filePath, ...rest) => {
          if (String(filePath).includes('installations.json.') && String(filePath).endsWith('.tmp')) throw new Error('disk full');
          return fs.writeFile(filePath, ...rest);
        },
      };
      let rollbacks = 0;
      const stateManager = remoteManagerAt(stateDirectory, {
        fsImpl: failingFs,
        fetchImpl: remoteFetch(remote.document),
        reconcileActivation: async () => ({ openCode: {}, rollback: async () => { rollbacks += 1; } }),
      });
      const stateInspection = await stateManager.inspectRemote(appEntryUrl);
      await expect(stateManager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: stateInspection.publisher.fingerprint,
        confirmedManifestHash: stateInspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'manager_write_failed', status: 500 });
      expect(rollbacks).toBe(1);
      await expect(fs.stat(path.join(
        versionsPathFor(stateDirectory),
        'com.acme.remote',
        '1.0.0',
        HOSTED_OCIX_SIGNED_MANIFEST_FILE,
      ))).resolves.toBeTruthy();
      await expect(fs.stat(statePathFor(stateDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await fs.readFile(remoteConsentsPathFor(stateDirectory), 'utf8')).consents).toEqual({});
      expect((await stateManager.list()).publishers).toEqual([]);
    });

    it('rejects an already-installed reconnect without changing the durable snapshot', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-reconnect-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const options = {
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      };
      await manager.connectRemote(options);
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');
      await expect(manager.connectRemote(options)).rejects.toMatchObject({ code: 'remote_extension_installed', status: 409 });
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
      expect((await manager.list()).extensions).toHaveLength(1);
    });

    it('rejects a Local package from joining a Direct Remote extension lifecycle', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-local-conflict-'));
      temporaryDirectories.push(dataDirectory);
      const remoteKeys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys: remoteKeys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');

      const localKeys = generatePublisherKeyPair();
      await manager.trustPublisher({
        id: 'com.local.publisher',
        name: 'Local Publisher',
        keyId: 'release-2026',
        publicKey: localKeys.publicKey,
      });
      const local = await signPackage({
        keys: localKeys,
        publisherId: 'com.local.publisher',
        publisherName: 'Local Publisher',
        extensionId: 'com.acme.remote',
        version: '2.0.0',
      });
      await expect(manager.installPackage(local.buffer)).rejects.toMatchObject({
        code: 'extension_delivery_conflict',
        status: 409,
      });
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
      expect((await manager.getEnabledExtensionRoots())).toHaveLength(1);
    });

    it('never adopts an aliased versions root for a Remote installation', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-alias-'));
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-outside-'));
      temporaryDirectories.push(dataDirectory, outside);
      await fs.symlink(outside, versionsPathFor(dataDirectory));
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);

      await expect(manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'manager_path_conflict', status: 409 });
      expect(await fs.readdir(outside)).toEqual([]);
      expect((await manager.list()).extensions).toEqual([]);
      expect((await manager.list()).publishers).toEqual([]);
    });

    it('refuses rollback when an unmanaged sibling appears and preserves every byte', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-sibling-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const connected = await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });
      const sibling = path.join(versionsPathFor(dataDirectory), 'com.acme.remote', '2.0.0');
      await fs.mkdir(sibling);
      const externalFile = path.join(sibling, 'external.txt');
      await fs.writeFile(externalFile, 'external owner\n');
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');

      await expect(connected.capability.rollback()).rejects.toMatchObject({
        code: 'remote_shell_integrity_failed',
        status: 409,
      });
      await expect(fs.readFile(externalFile, 'utf8')).resolves.toBe('external owner\n');
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
    });

    it('derives Remote shell and Agent Runtime hashes independently of co-tampered state', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-cotamper-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });
      const toolPath = path.join(
        versionsPathFor(dataDirectory),
        'com.acme.remote',
        '1.0.0',
        'agent-runtime',
        'tools',
        'remote_open.ts',
      );
      const tamperedTool = Buffer.from('export default { execute: () => "external code" };\n');
      await fs.writeFile(toolPath, tamperedTool);
      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      state.extensions['com.acme.remote'].versions['1.0.0']
        .fileHashes['agent-runtime/tools/remote_open.ts'] = hostedSha256(tamperedTool);
      await fs.writeFile(statePathFor(dataDirectory), JSON.stringify(state));

      const restarted = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      expect(await restarted.getEnabledExtensionRoots()).toEqual([]);
      await expect(fs.readFile(toolPath, 'utf8')).resolves.toContain('external code');
    });

    it('rejects a state and shell identity substitution against the independent consent anchor', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-identity-substitution-'));
      temporaryDirectories.push(dataDirectory);
      const originalKeys = generatePublisherKeyPair();
      const original = createRemoteManifest({ keys: originalKeys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(original.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });

      const attackerKeys = generatePublisherKeyPair();
      const attacker = createRemoteManifest({
        keys: attackerKeys,
        publisherName: 'Attacker Publisher',
        extensionName: 'Attacker Remote',
      });
      const shell = path.join(versionsPathFor(dataDirectory), 'com.acme.remote', '1.0.0');
      const signedBytes = Buffer.from(JSON.stringify(canonicalize(attacker.document)));
      const extensionBytes = Buffer.from(`${JSON.stringify(attacker.document.extension, null, 2)}\n`);
      await fs.writeFile(path.join(shell, HOSTED_OCIX_SIGNED_MANIFEST_FILE), signedBytes);
      await fs.writeFile(path.join(shell, 'openchamber.extension.json'), extensionBytes);

      const state = JSON.parse(await fs.readFile(statePathFor(dataDirectory), 'utf8'));
      const extension = state.extensions['com.acme.remote'];
      const metadata = extension.versions['1.0.0'];
      const attackerManifestHash = hostedSha256(signedBytes);
      extension.name = 'Attacker Remote';
      metadata.packageHash = attackerManifestHash;
      metadata.publisher.name = 'Attacker Publisher';
      metadata.publisher.fingerprint = publicKeyFingerprint(attackerKeys.publicKey);
      metadata.remote.publisherPublicKey = attackerKeys.publicKey;
      metadata.remote.acceptedManifest.manifestHash = attackerManifestHash;
      metadata.fileHashes[HOSTED_OCIX_SIGNED_MANIFEST_FILE] = hostedSha256(signedBytes);
      metadata.fileHashes['openchamber.extension.json'] = hostedSha256(extensionBytes);
      await fs.writeFile(statePathFor(dataDirectory), JSON.stringify(state));

      const restarted = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(attacker.document) });
      await expect(restarted.list()).rejects.toMatchObject({
        code: 'remote_consent_integrity_failed',
        status: 409,
      });
      await expect(restarted.getEnabledExtensionRoots()).rejects.toMatchObject({
        code: 'remote_consent_integrity_failed',
        status: 409,
      });
      await expect(fs.readFile(path.join(shell, 'openchamber.extension.json'), 'utf8'))
        .resolves.toContain('Attacker Remote');
    });

    it('preserves an external replacement when activation fails during Remote install cleanup', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-install-race-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const extensionRoot = path.join(versionsPathFor(dataDirectory), 'com.acme.remote');
      const preservedOriginal = path.join(dataDirectory, 'preserved-original-shell');
      const externalFile = path.join(extensionRoot, '1.0.0', 'external.txt');
      const manager = remoteManagerAt(dataDirectory, {
        fetchImpl: remoteFetch(remote.document),
        reconcileActivation: async () => {
          await fs.rename(extensionRoot, preservedOriginal);
          await fs.mkdir(path.dirname(externalFile), { recursive: true });
          await fs.writeFile(externalFile, 'external owner\n');
          throw new InteractiveUIExtensionManagerError('activation failed', 'activation_failed', 500);
        },
      });
      const inspection = await manager.inspectRemote(appEntryUrl);

      await expect(manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      })).rejects.toMatchObject({ code: 'activation_failed', status: 500 });
      await expect(fs.readFile(externalFile, 'utf8')).resolves.toBe('external owner\n');
      await expect(fs.stat(path.join(preservedOriginal, '1.0.0', HOSTED_OCIX_SIGNED_MANIFEST_FILE)))
        .resolves.toBeTruthy();
      await expect(fs.stat(statePathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('never moves a Remote shell when external content appears while rollback activation awaits', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-retained-shell-race-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      let activationCalls = 0;
      const shellRoot = path.join(versionsPathFor(dataDirectory), 'com.acme.remote');
      const externalFile = path.join(shellRoot, '2.0.0', 'external.txt');
      const manager = remoteManagerAt(dataDirectory, {
        fetchImpl: remoteFetch(remote.document),
        reconcileActivation: async () => {
          activationCalls += 1;
          if (activationCalls === 2) {
            await fs.mkdir(path.dirname(externalFile), { recursive: true });
            await fs.writeFile(externalFile, 'external owner\n');
          }
          return { openCode: {}, rollback: async () => {} };
        },
      });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const connected = await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });

      await expect(connected.capability.rollback()).resolves.toMatchObject({
        removed: true,
        cleanupPending: true,
      });
      await expect(fs.readFile(externalFile, 'utf8')).resolves.toBe('external owner\n');
      await expect(fs.stat(path.join(shellRoot, '1.0.0', HOSTED_OCIX_SIGNED_MANIFEST_FILE)))
        .resolves.toBeTruthy();
      expect((await manager.list()).extensions).toEqual([]);
    });

    it('never uses recursive deletion for a Remote rollback tombstone', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-no-recursive-delete-'));
      temporaryDirectories.push(dataDirectory);
      let recursiveRemovals = 0;
      const guardedFs = {
        ...fs,
        rm: async (target, options) => {
          if (options?.recursive) {
            recursiveRemovals += 1;
            throw new Error(`unexpected recursive removal: ${target}`);
          }
          return fs.rm(target, options);
        },
      };
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, {
        fsImpl: guardedFs,
        fetchImpl: remoteFetch(remote.document),
      });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const connected = await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });

      await expect(connected.capability.rollback()).resolves.toMatchObject({
        removed: true,
        cleanupPending: true,
      });
      expect(recursiveRemovals).toBe(0);
      expect((await manager.list()).extensions).toEqual([]);
      await expect(fs.stat(path.join(
        versionsPathFor(dataDirectory),
        'com.acme.remote',
        '1.0.0',
        HOSTED_OCIX_SIGNED_MANIFEST_FILE,
      ))).resolves.toBeTruthy();
      await expect(fs.stat(trashPathFor(dataDirectory))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await fs.readFile(remoteConsentsPathFor(dataDirectory), 'utf8')).consents).toEqual({});
    });

    it('keeps capability non-enumerable, reports unbound runtime failure, and rolls back exactly', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-capability-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const connected = await manager.connectRemote({
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      });
      expect(Object.keys(connected)).not.toContain('capability');
      expect(JSON.stringify(connected)).not.toContain('capability');
      await expect(connected.capability.configureCredential('sk-secret')).rejects.toMatchObject({
        code: 'remote_credential_runtime_unavailable',
        status: 409,
      });
      await expect(connected.capability.rollback()).resolves.toMatchObject({ removed: true });
      expect((await manager.list()).extensions).toEqual([]);
      expect((await manager.list()).publishers).toEqual([]);
      await expect(fs.stat(path.join(
        versionsPathFor(dataDirectory),
        'com.acme.remote',
        '1.0.0',
        HOSTED_OCIX_SIGNED_MANIFEST_FILE,
      ))).resolves.toBeTruthy();
    });

    it('refuses a stale Remote rollback from deleting a replacement installation', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-stale-rollback-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const options = {
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      };
      const first = await manager.connectRemote(options);
      await first.capability.rollback();
      const replacement = await manager.connectRemote(options);
      const before = await fs.readFile(statePathFor(dataDirectory), 'utf8');
      await expect(first.capability.rollback()).rejects.toMatchObject({
        code: 'remote_rollback_installation_changed',
        status: 409,
      });
      expect(await fs.readFile(statePathFor(dataDirectory), 'utf8')).toBe(before);
      expect((await manager.list()).extensions[0].activeVersion).toBe(replacement.extension.version);
      expect((await manager.getEnabledExtensionRoots())).toHaveLength(1);
    });

    it('refuses stale credential capabilities after a replacement installation', async () => {
      const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-manager-remote-stale-capability-'));
      temporaryDirectories.push(dataDirectory);
      const keys = generatePublisherKeyPair();
      const remote = createRemoteManifest({ keys });
      const calls = [];
      const credentialRuntime = {
        configureRemoteConnection: async (...args) => {
          calls.push(['configure', ...args]);
          return { credential: { configured: true } };
        },
        removeRemoteConnection: async (...args) => {
          calls.push(['remove', ...args]);
          return { removed: true };
        },
      };
      const manager = remoteManagerAt(dataDirectory, { fetchImpl: remoteFetch(remote.document) });
      const inspection = await manager.inspectRemote(appEntryUrl);
      const options = {
        appEntryUrl,
        confirmedPublisherFingerprint: inspection.publisher.fingerprint,
        confirmedManifestHash: inspection.manifest.manifestHash,
      };
      const first = await manager.connectRemote(options, credentialRuntime);
      await first.capability.rollback();
      const replacement = await manager.connectRemote(options, credentialRuntime);

      await expect(first.capability.configureCredential('stale-secret')).rejects.toMatchObject({
        code: 'remote_installation_changed',
        status: 409,
      });
      await expect(first.capability.removeCredential()).rejects.toMatchObject({
        code: 'remote_installation_changed',
        status: 409,
      });
      expect(calls).toEqual([]);
      await expect(replacement.capability.configureCredential('current-secret')).resolves.toMatchObject({
        credential: { configured: true },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('configure');
      expect(calls[0]).not.toContain('stale-secret');
    });
  });

  it('exposes the manager error class with code, status, and optional details', async () => {
    const error = new InteractiveUIExtensionManagerError('boom', 'manager_data_corrupt', 500, { field: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InteractiveUIExtensionManagerError');
    expect(error.message).toBe('boom');
    expect(error.code).toBe('manager_data_corrupt');
    expect(error.status).toBe(500);
    expect(error.details).toEqual({ field: 'x' });

    const { manager } = await createManager();
    await expect(manager.trustPublisher({})).rejects.toBeInstanceOf(InteractiveUIExtensionManagerError);
  });
});
