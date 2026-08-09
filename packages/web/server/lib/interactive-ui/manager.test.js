import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  createExtensionPackage,
  generatePublisherKeyPair,
  publicKeyFingerprint,
} from './package-format.js';
import {
  InteractiveUIExtensionManagerError,
  createInteractiveUIExtensionManager,
} from './manager.js';

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
