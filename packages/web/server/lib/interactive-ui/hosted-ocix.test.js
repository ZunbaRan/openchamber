import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  materializeHostedOcix,
  normalizeHostedDelivery,
  verifyHostedOcixManifest,
} from './hosted-ocix.js';

const temporaryDirectories = [];

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const sign = (document, privateKey, keyId = 'release-2026') => {
  const unsigned = { ...document };
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      keyId,
      value: crypto.sign(
        null,
        Buffer.from(JSON.stringify(canonicalize(unsigned))),
        privateKey,
      ).toString('base64'),
    },
  };
};

const fixture = () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const html = Buffer.from('<!doctype html><h1>Hosted CRM</h1>');
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://view/v1',
    id: 'com.acme.hosted.overview',
    runtime: 'declarative',
    layout: { type: 'text', text: 'Hosted' },
  }));
  const resource = (resourcePath, bytes, mimeType) => ({
    path: resourcePath,
    url: `https://apps.example.com/${resourcePath}`,
    mimeType,
    sha256: `sha256-${crypto.createHash('sha256').update(bytes).digest('base64')}`,
  });
  const document = sign({
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {
      id: 'com.acme.hosted',
      version: '2.0.0',
      publishedAt: '2026-07-29T00:00:00.000Z',
    },
    permissions: {
      resourceOrigins: ['https://apps.example.com'],
      networkOrigins: ['https://api.example.com'],
      actionIds: ['com.acme.hosted.read'],
      credentialScopes: ['crm.read'],
    },
    extension: {
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.hosted',
      name: 'Hosted CRM',
      version: '2.0.0',
      permissions: { network: ['https://api.example.com'] },
      connectors: [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
      }],
      actions: [{
        id: 'com.acme.hosted.read',
        connector: 'crm',
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }],
      views: [{
        id: 'com.acme.hosted.overview',
        runtime: 'declarative',
        entry: 'ui/overview.view.json',
      }],
      artifacts: [{
        id: 'com.acme.hosted.artifact',
        title: 'Hosted Artifact',
        entry: 'ui/artifact.html',
        capabilities: { scripts: true, businessActions: ['com.acme.hosted.read'] },
      }],
    },
    resources: [
      resource('ui/overview.view.json', view, 'application/json'),
      resource('ui/artifact.html', html, 'text/html'),
    ],
  }, keys.privateKey);
  return {
    keys,
    document,
    bodies: new Map([
      ['https://apps.example.com/ui/overview.view.json', view],
      ['https://apps.example.com/ui/artifact.html', html],
    ]),
  };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('Hosted OCIX', () => {
  it('normalizes a thin-package delivery declaration', () => {
    expect(normalizeHostedDelivery({
      delivery: {
        type: 'hosted',
        manifestUrl: 'https://apps.example.com/manifest.json',
        ttlSeconds: 600,
        initialPermissions: {
          resourceOrigins: ['https://apps.example.com'],
          credentialScopes: ['crm.read'],
        },
      },
    })).toMatchObject({
      type: 'hosted',
      ttlSeconds: 600,
      updatePolicy: 'permission-stable',
      initialPermissions: {
        resourceOrigins: ['https://apps.example.com'],
        credentialScopes: ['crm.read'],
      },
    });
  });

  it('verifies the remote manifest and detects permission expansion', () => {
    const { keys, document } = fixture();
    const verified = verifyHostedOcixManifest({
      document,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    });
    expect(verified.version).toBe('2.0.0');
    expect(verified.permissions.actionIds).toEqual(['com.acme.hosted.read']);
    expect(hostedPermissionExpansion(verified.permissions, {
      ...verified.permissions,
      actionIds: [...verified.permissions.actionIds, 'com.acme.hosted.write'],
      popups: true,
    })).toEqual({
      actionIds: ['com.acme.hosted.write'],
      popups: true,
    });
  });

  it('rejects a modified signed manifest', () => {
    const { keys, document } = fixture();
    expect(() => verifyHostedOcixManifest({
      document: { ...document, app: { ...document.app, version: '2.0.1' } },
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    })).toThrow(/signature verification failed/);
  });

  it('rejects a hosted manifest redirect to a different origin', async () => {
    await expect(fetchHostedOcixManifest({
      manifestUrl: 'https://apps.example.com/manifest.json',
      fetchImpl: async () => {
        const response = new Response('{}', { status: 200 });
        Object.defineProperty(response, 'url', { value: 'https://cdn.example.net/manifest.json' });
        return response;
      },
    })).rejects.toMatchObject({ code: 'hosted_manifest_origin_changed' });
  });

  it('downloads only same-origin, hash-matching resources and materializes a runtime root', async () => {
    const { keys, document, bodies } = fixture();
    const verified = verifyHostedOcixManifest({
      document,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-ocix-'));
    temporaryDirectories.push(directory);
    let validated = false;
    const destination = await materializeHostedOcix({
      verified,
      cacheDirectory: directory,
      fetchImpl: async (url) => {
        const body = bodies.get(String(url));
        return new Response(body ?? 'missing', {
          status: body ? 200 : 404,
          headers: { 'content-type': 'application/octet-stream' },
        });
      },
      validate: async (root) => {
        validated = true;
        expect(JSON.parse(await fs.readFile(path.join(root, 'openchamber.extension.json'), 'utf8')).id)
          .toBe('com.acme.hosted');
      },
    });
    expect(validated).toBe(true);
    expect(await fs.readFile(path.join(destination, 'ui/artifact.html'), 'utf8'))
      .toContain('Hosted CRM');
  });
});
