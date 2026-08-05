import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIConnectionStore, validateRemoteAccessKey } from './connection-store.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createStore = async (options = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-connections-'));
  temporaryDirectories.push(dataDirectory);
  return {
    dataDirectory,
    store: createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      ...options,
    }),
  };
};

describe('Interactive UI connection secret store', () => {
  it('validates opaque Remote access keys byte-for-byte and rejects unsafe controls', async () => {
    // Exact preservation: spaces and empty-looking strings are credential
    // material and must survive untouched.
    expect(validateRemoteAccessKey(' key ')).toBe(' key ');
    expect(validateRemoteAccessKey('   ')).toBe('   ');
    expect(validateRemoteAccessKey('sk-opaque-key')).toBe('sk-opaque-key');
    expect(validateRemoteAccessKey('a'.repeat(16 * 1024))).toBe('a'.repeat(16 * 1024));

    expect(() => validateRemoteAccessKey(undefined)).toThrow(expect.objectContaining({
      code: 'remote_access_key_required',
      status: 400,
    }));
    expect(() => validateRemoteAccessKey('')).toThrow(expect.objectContaining({ code: 'remote_access_key_required' }));
    expect(() => validateRemoteAccessKey(42)).toThrow(expect.objectContaining({ code: 'remote_access_key_required' }));
    expect(() => validateRemoteAccessKey('a'.repeat(16 * 1024 + 1))).toThrow(expect.objectContaining({
      code: 'remote_access_key_invalid',
      status: 400,
    }));
    for (const unsafe of ['key\r\nmore', 'key\0more', 'key\tmore', 'key\x1bmore', 'key\x7fmore']) {
      expect(() => validateRemoteAccessKey(unsafe)).toThrow(expect.objectContaining({ code: 'remote_access_key_invalid' }));
    }
  });

  it('setRemoteCredential stores the exact Remote access key without trimming', async () => {
    const { dataDirectory, store } = await createStore();
    const status = await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', ' key ');
    expect(status).toMatchObject({ configured: true, source: 'manual' });
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: ' key ' });
    const filePath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe(' key ');
    // The same validator rejects unsafe keys at the store too.
    await expect(store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key\0more'))
      .rejects.toMatchObject({ code: 'remote_access_key_invalid', status: 400 });
    await expect(store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', ''))
      .rejects.toMatchObject({ code: 'remote_access_key_required', status: 400 });
    // The original exact key is untouched after rejected replacements.
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: ' key ' });
  });

  it('persists manual keys with owner-only permissions and never returns the key in status', async () => {
    const { dataDirectory, store } = await createStore();
    const status = await store.setManualCredential('com.acme.crm', 'crm-api', 'top-secret-key');

    expect(status).toMatchObject({ configured: true, expired: false, source: 'manual' });
    expect(JSON.stringify(status)).not.toContain('top-secret-key');
    expect(await store.resolveCredential('com.acme.crm', 'crm-api')).toEqual({ accessKey: 'top-secret-key' });

    const filePath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(filePath, 'utf8')).toContain('top-secret-key');

    expect(await store.removeCredential('com.acme.crm', 'crm-api')).toEqual({ removed: true });
    expect(await store.resolveCredential('com.acme.crm', 'crm-api')).toBeNull();
  });

  it('stores a user endpoint and optional headers beside the key without exposing their values in status', async () => {
    const { store } = await createStore();
    const status = await store.setManualCredential('com.acme.crm', 'crm-api', {
      accessKey: 'top-secret-key',
      endpoint: 'http://127.0.0.1:51810/api/',
      headers: { 'X-Tenant-ID': 'acme' },
    });

    expect(status).toMatchObject({
      configured: true,
      endpoint: 'http://127.0.0.1:51810/api/',
      headerNames: ['X-Tenant-ID'],
    });
    expect(JSON.stringify(status)).not.toContain('top-secret-key');
    expect(JSON.stringify(status)).not.toContain('"acme"');
    expect(await store.getConfiguration('com.acme.crm', 'crm-api')).toEqual({
      accessKey: 'top-secret-key',
      endpoint: 'http://127.0.0.1:51810/api/',
      name: null,
      headers: { 'X-Tenant-ID': 'acme' },
    });
  });

  it('provisions a scoped key with the v1 server contract and preserves the old key on failure', async () => {
    const requests = [];
    let validResponse = true;
    const { store } = await createStore({
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return validResponse
          ? new Response(JSON.stringify({
              $schema: 'openchamber://credential-response/v1',
              credentialType: 'api-key',
              accessKey: 'issued-secret',
              expiresAt: '2099-01-01T00:00:00.000Z',
              display: { name: 'CRM production key' },
            }))
          : new Response(JSON.stringify({ accessKey: 'replacement-secret' }));
      },
    });
    const connector = {
      id: 'crm-api',
      auth: { type: 'issued-key', provisioningUrl: 'https://crm.example.com/.well-known/ocix/v1/credentials' },
    };

    const status = await store.provisionCredential('com.acme.crm', connector, 'one-time-code');
    expect(status).toMatchObject({ configured: true, source: 'provisioned', displayName: 'CRM production key' });
    expect(requests[0]).toMatchObject({
      $schema: 'openchamber://credential-request/v1',
      extensionId: 'com.acme.crm',
      connectorId: 'crm-api',
      setupCode: 'one-time-code',
    });
    expect(typeof requests[0].installationId).toBe('string');
    expect(await store.resolveCredential('com.acme.crm', 'crm-api')).toEqual({ accessKey: 'issued-secret' });

    validResponse = false;
    await expect(store.provisionCredential('com.acme.crm', connector, 'second-code'))
      .rejects.toMatchObject({ code: 'invalid_credential_response' });
    expect(await store.resolveCredential('com.acme.crm', 'crm-api')).toEqual({ accessKey: 'issued-secret' });
  });

  it('binds Remote credentials to their installation id and keeps it private', async () => {
    const { dataDirectory, store } = await createStore();
    const status = await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key-a');
    expect(status).toMatchObject({ configured: true, source: 'manual' });
    expect(JSON.stringify(status)).not.toContain('installation-a');
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: 'key-a' });
    expect(JSON.stringify(await store.getStatus('com.acme.remote', 'crm'))).not.toContain('installation-a');
    expect(JSON.stringify(await store.getConfiguration('com.acme.remote', 'crm'))).not.toContain('installation-a');
    const filePath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).connections['com.acme.remote:crm'].installationId)
      .toBe('installation-a');
  });

  it('refuses to overwrite a Remote credential that belongs to a different installation', async () => {
    const { store } = await createStore();
    await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key-a');
    await expect(store.setRemoteCredential('com.acme.remote', 'crm', 'installation-b', 'key-b'))
      .rejects.toMatchObject({ code: 'remote_installation_conflict', status: 409 });
    // The original record and its key are untouched.
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: 'key-a' });
    // The same installation may replace its own credential.
    await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key-a-replacement');
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: 'key-a-replacement' });
  });

  it('conditional removal deletes only the exact installation record', async () => {
    const { store } = await createStore();
    await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key-a');
    // A stale installation's cleanup cannot delete the current credential.
    expect(await store.removeRemoteCredential('com.acme.remote', 'crm', 'installation-stale'))
      .toEqual({ removed: false, mismatch: true });
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: 'key-a' });
    // The owning installation removes it.
    expect(await store.removeRemoteCredential('com.acme.remote', 'crm', 'installation-a'))
      .toEqual({ removed: true });
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toBeNull();
    expect(await store.removeRemoteCredential('com.acme.remote', 'crm', 'installation-a'))
      .toEqual({ removed: false });
  });

  it('an old conditional cleanup cannot delete a replacement credential', async () => {
    const { store } = await createStore();
    // Installation A stores its key, then the extension is uninstalled
    // (removing all credentials) and reconnected as installation B.
    await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-a', 'key-a');
    await store.removeExtensionCredentials('com.acme.remote');
    await store.setRemoteCredential('com.acme.remote', 'crm', 'installation-b', 'key-b');
    // A's late cleanup must leave B's credential intact.
    expect(await store.removeRemoteCredential('com.acme.remote', 'crm', 'installation-a'))
      .toEqual({ removed: false, mismatch: true });
    expect(await store.resolveCredential('com.acme.remote', 'crm')).toEqual({ accessKey: 'key-b' });
  });

  it('removes every credential owned by an uninstalled extension', async () => {
    const { store } = await createStore();
    await store.setManualCredential('com.acme.crm', 'primary-api', 'one');
    await store.setManualCredential('com.acme.crm', 'secondary-api', 'two');
    await store.setManualCredential('com.acme.sales', 'sales-api', 'three');

    expect(await store.removeExtensionCredentials('com.acme.crm')).toEqual({ removed: 2 });
    expect(await store.resolveCredential('com.acme.crm', 'primary-api')).toBeNull();
    expect(await store.resolveCredential('com.acme.sales', 'sales-api')).toEqual({ accessKey: 'three' });
  });
});
