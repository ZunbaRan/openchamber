import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIConnectionStore } from './connection-store.js';

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
