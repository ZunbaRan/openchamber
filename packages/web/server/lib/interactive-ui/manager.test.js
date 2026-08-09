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

const createExtension = async ({ extensionId = 'com.acme.operations' } = {}) => {
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
    version: '1.0.0',
    connectors: [],
    views: [{ id: viewId, runtime: 'declarative', entry: 'ui/view.json', tools: ['operations_open'] }],
    actions: [],
    permissions: { network: [] },
    trust: { mode: 'declarative', signature: 'production' },
  }, null, 2));
  await fs.writeFile(path.join(directory, 'ui', 'view.json'), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: viewId,
    layout: { type: 'text', value: 'Hello' },
  }));
  await fs.writeFile(path.join(directory, 'agent-runtime', 'tools', 'operations_open.ts'), 'export default { description: "Open operations" };\n');
  await fs.writeFile(path.join(directory, 'agent-runtime', 'skills', 'acme-operations', 'SKILL.md'), '---\nname: acme-operations\ndescription: Open operations views.\n---\n');
  return directory;
};

const signPackage = async ({
  keys = generatePublisherKeyPair(),
  keyId = 'release-2026',
  publisherId = 'com.acme.publisher',
  publisherName = 'Acme',
  extensionId = 'com.acme.operations',
} = {}) => {
  const packed = await createExtensionPackage({
    extensionDirectory: await createExtension({ extensionId }),
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
