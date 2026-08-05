import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  HOSTED_OCIX_SIGNED_MANIFEST_FILE,
  createHostedOcixCacheIntegrity,
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  materializeHostedOcix,
  normalizeHostedDelivery,
  verifyHostedOcixCacheIntegrity,
  verifyHostedOcixManifest,
} from './hosted-ocix.js';
import {
  fetchRemoteOcixManifest,
  selectRemoteConnector,
  verifyRemoteOcixManifest,
} from './remote-ocix.js';
import { publicKeyFingerprint } from './package-format.js';

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

  it('rejects remote resources in host-reserved namespaces', () => {
    const { keys, document } = fixture();
    for (const [resourcePath, reservedNamespace] of [
      ['agent-runtime/tools/hosted_open.ts', 'agent-runtime'],
      ['agent-runtime', 'agent-runtime'],
      ['.openchamber/cache.json', '.openchamber'],
      ['.openchamber.hosted-manifest.json', '.openchamber'],
      ['openchamber.extension.json', 'openchamber.extension.json'],
      ['openchamber.extension.json/ui.json', 'openchamber.extension.json'],
    ]) {
      const bytes = Buffer.from('reserved');
      const reservedDocument = sign({
        ...document,
        resources: [
          ...document.resources,
          {
            path: resourcePath,
            url: `https://apps.example.com/${resourcePath}`,
            mimeType: 'text/plain',
            sha256: `sha256-${crypto.createHash('sha256').update(bytes).digest('base64')}`,
          },
        ],
      }, keys.privateKey);
      expect(() => verifyHostedOcixManifest({
        document: reservedDocument,
        extensionId: 'com.acme.hosted',
        publisherKeyId: 'release-2026',
        publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      })).toThrow(expect.objectContaining({
        code: 'invalid_hosted_resource',
        status: 400,
        details: { path: resourcePath, reservedNamespace },
      }));
    }
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
        const contentType = String(url).endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json';
        return new Response(body ?? 'missing', {
          status: body ? 200 : 404,
          headers: { 'content-type': contentType },
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
    expect(JSON.parse(await fs.readFile(
      path.join(destination, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
      'utf8',
    )).signature).toMatchObject({
      algorithm: 'ed25519',
      keyId: 'release-2026',
    });
  });

  it('rejects a resource whose HTTP Content-Type does not match the signed MIME type', async () => {
    const { keys, document, bodies } = fixture();
    const verified = verifyHostedOcixManifest({
      document,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-ocix-mime-'));
    temporaryDirectories.push(directory);
    await expect(materializeHostedOcix({
      verified,
      cacheDirectory: directory,
      fetchImpl: async (url) => new Response(bodies.get(String(url)), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    })).rejects.toMatchObject({
      code: 'hosted_resource_mime_mismatch',
      status: 403,
    });
  });

  it('requires explicit native-code trust and permission for Hosted Native surfaces', () => {
    const { keys, document } = fixture();
    const nativeDocument = sign({
      ...document,
      permissions: {
        ...document.permissions,
        nativeCode: true,
      },
      extension: {
        ...document.extension,
        trust: { mode: 'native-code', signature: 'hosted-release' },
        views: document.extension.views.map((view) => ({ ...view, runtime: 'native' })),
      },
    }, keys.privateKey);
    const verified = verifyHostedOcixManifest({
      document: nativeDocument,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    });
    expect(verified.permissions.nativeCode).toBe(true);
    expect(hostedPermissionExpansion({
      ...verified.permissions,
      nativeCode: false,
    }, verified.permissions)).toEqual({ nativeCode: true });

    const untrustedDocument = sign({
      ...nativeDocument,
      extension: {
        ...nativeDocument.extension,
        trust: { mode: 'declarative', signature: 'hosted-release' },
      },
    }, keys.privateKey);
    expect(() => verifyHostedOcixManifest({
      document: untrustedDocument,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    })).toThrow(/trust\.mode = native-code/);
  });

  it('recomputes every materialized cache file before reuse', async () => {
    const { keys, document, bodies } = fixture();
    const verified = verifyHostedOcixManifest({
      document,
      extensionId: 'com.acme.hosted',
      publisherKeyId: 'release-2026',
      publisherPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-ocix-cache-'));
    temporaryDirectories.push(directory);
    const destination = await materializeHostedOcix({
      verified,
      cacheDirectory: directory,
      fetchImpl: async (url) => new Response(bodies.get(String(url)), {
        status: 200,
        headers: {
          'content-type': String(url).endsWith('.html') ? 'text/html' : 'application/json',
        },
      }),
    });
    const toolSource = 'export default { description: "Hosted" };\n';
    await fs.mkdir(path.join(destination, 'agent-runtime', 'tools'), { recursive: true });
    await fs.writeFile(path.join(destination, 'agent-runtime', 'tools', 'hosted_open.ts'), toolSource);
    const integrity = createHostedOcixCacheIntegrity({
      verified,
      additionalFiles: new Map([['agent-runtime/tools/hosted_open.ts', toolSource]]),
    });
    await expect(verifyHostedOcixCacheIntegrity({
      directory: destination,
      integrity,
    })).resolves.toMatchObject({ status: 'ready' });

    const signedManifestPath = path.join(destination, HOSTED_OCIX_SIGNED_MANIFEST_FILE);
    const signedManifest = await fs.readFile(signedManifestPath);
    await fs.writeFile(signedManifestPath, JSON.stringify({
      ...document,
      app: { ...document.app, version: '2.0.1' },
    }));
    await expect(verifyHostedOcixCacheIntegrity({
      directory: destination,
      integrity,
    })).rejects.toMatchObject({ code: 'hosted_cache_integrity_failed' });
    await fs.writeFile(signedManifestPath, signedManifest);
    await expect(verifyHostedOcixCacheIntegrity({
      directory: destination,
      integrity,
    })).resolves.toMatchObject({ status: 'ready' });

    await fs.writeFile(path.join(destination, 'ui', 'artifact.html'), '<h1>Tampered</h1>');
    await expect(verifyHostedOcixCacheIntegrity({
      directory: destination,
      integrity,
    })).rejects.toMatchObject({ code: 'hosted_cache_integrity_failed' });
  });
});

describe('Remote OCIX manifest verification', () => {
  const publicKeyPem = (keys) => keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const remoteFixture = ({
    keys = crypto.generateKeyPairSync('ed25519'),
    keyId = 'release-2026',
    publisherId = 'com.acme.publisher',
    publisherName = 'Acme',
    connectors = [{ id: 'crm', type: 'http', baseUrl: 'https://api.example.com', auth: { type: 'api-key' } }],
    native = false,
  } = {}) => {
    const view = Buffer.from(JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'Remote' },
    }));
    const resources = [{
      path: 'ui/overview.view.json',
      url: 'https://apps.example.com/ui/overview.view.json',
      mimeType: 'application/json',
      sha256: `sha256-${crypto.createHash('sha256').update(view).digest('base64')}`,
    }];
    const unsigned = {
      $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
      app: {
        id: 'com.acme.remote',
        version: '1.0.0',
        publishedAt: '2026-08-05T00:00:00.000Z',
      },
      publisher: {
        id: publisherId,
        name: publisherName,
        keyId,
        publicKey: publicKeyPem(keys),
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
        nativeCode: native,
      },
      extension: {
        $schema: 'openchamber://extension/v1',
        id: 'com.acme.remote',
        name: 'Remote CRM',
        version: '1.0.0',
        agentRouting: { domain: 'remote', intents: ['remote.overview'], dataAuthority: 'user-provided' },
        connectors,
        views: [{
          id: 'com.acme.remote.overview',
          runtime: native ? 'native' : 'declarative',
          entry: 'ui/overview.view.json',
          tools: ['remote_open'],
        }],
        actions: [{
          id: 'com.acme.remote.read',
          connector: 'crm',
          risk: 'read',
          request: { method: 'GET', path: '/crm' },
        }],
        permissions: { network: ['https://api.example.com'] },
        trust: { mode: native ? 'native-code' : 'declarative', signature: 'production' },
      },
      resources,
    };
    const signature = crypto.sign(
      null,
      Buffer.from(JSON.stringify(canonicalize(unsigned))),
      keys.privateKey,
    ).toString('base64');
    return {
      keys,
      document: {
        ...unsigned,
        signature: { algorithm: 'ed25519', keyId, value: signature },
      },
    };
  };

  it('verifies the manifest with the embedded publisher key and derives the fingerprint locally', () => {
    const { keys, document } = remoteFixture({ native: true });
    const verified = verifyRemoteOcixManifest({ document });
    expect(verified.extensionId).toBe('com.acme.remote');
    expect(verified.version).toBe('1.0.0');
    expect(verified.publisher).toMatchObject({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2026',
    });
    expect(verified.publisher.publicKey).toBe(publicKeyPem(keys));
    expect(verified.publisher.fingerprint).toBe(publicKeyFingerprint(publicKeyPem(keys)));
    expect(verified.permissions.nativeCode).toBe(true);
    expect(verified.permissions.actionIds).toEqual(['com.acme.remote.read']);
  });

  it('rejects a manifest without a valid publisher envelope before any verification', () => {
    const { keys, document } = remoteFixture();
    for (const publisher of [
      undefined,
      null,
      { id: 'bad id', name: 'Acme', keyId: 'release-2026', publicKey: publicKeyPem(keys) },
      { id: 'com.acme.publisher', name: '', keyId: 'release-2026', publicKey: publicKeyPem(keys) },
      { id: 'com.acme.publisher', name: 'Acme', keyId: '__proto__', publicKey: publicKeyPem(keys) },
    ]) {
      expect(() => verifyRemoteOcixManifest({
        document: { ...document, publisher },
      })).toThrow(expect.objectContaining({ code: 'invalid_hosted_manifest' }));
    }
    expect(() => verifyRemoteOcixManifest({ document: {} }))
      .toThrow(expect.objectContaining({ code: 'invalid_hosted_manifest' }));
    expect(() => verifyRemoteOcixManifest({
      document: {
        ...document,
        publisher: { ...document.publisher, publicKey: 'not-a-key' },
      },
    })).toThrow(expect.objectContaining({ code: 'invalid_hosted_publisher_key' }));
  });

  it('rejects a signature keyId that does not match the publisher keyId', () => {
    const { keys, document } = remoteFixture();
    expect(() => verifyRemoteOcixManifest({
      document: {
        ...document,
        publisher: { ...document.publisher, keyId: 'release-2025' },
      },
    })).toThrow(expect.objectContaining({
      code: 'hosted_signature_identity_mismatch',
      status: 403,
    }));
  });

  it('rejects an invalid embedded Ed25519 public key', () => {
    const { keys, document } = remoteFixture();
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => verifyRemoteOcixManifest({
      document: {
        ...document,
        publisher: {
          ...document.publisher,
          publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
      },
    })).toThrow(expect.objectContaining({
      code: 'invalid_hosted_publisher_key',
      status: 403,
    }));
  });

  it('rejects a manifest signed by a different key than the embedded publisher key', () => {
    const { keys, document } = remoteFixture();
    const other = crypto.generateKeyPairSync('ed25519');
    const tampered = {
      ...document,
      publisher: {
        ...document.publisher,
        publicKey: other.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    };
    expect(() => verifyRemoteOcixManifest({ document: tampered }))
      .toThrow(expect.objectContaining({
        code: 'invalid_hosted_signature',
        status: 403,
      }));
    // The same embedded key must fail when the signed payload was modified.
    expect(() => verifyRemoteOcixManifest({
      document: { ...document, app: { ...document.app, version: '1.0.1' } },
    })).toThrow(expect.objectContaining({ code: 'invalid_hosted_signature' }));
  });

  it('rejects an unsigned manifest and an extension identity mismatch', () => {
    const { keys, document } = remoteFixture();
    const { signature: _signature, ...unsigned } = document;
    expect(() => verifyRemoteOcixManifest({ document: unsigned }))
      .toThrow(expect.objectContaining({ code: 'invalid_hosted_manifest' }));
    const resign = (value) => {
      const { signature: _oldSignature, ...payload } = value;
      return {
        ...payload,
        signature: {
          algorithm: 'ed25519',
          keyId: document.signature.keyId,
          value: crypto.sign(
            null,
            Buffer.from(JSON.stringify(canonicalize(payload))),
            keys.privateKey,
          ).toString('base64'),
        },
      };
    };
    expect(() => verifyRemoteOcixManifest({
      document: resign({
        ...document,
        extension: { ...document.extension, id: 'com.acme.other' },
      }),
    })).toThrow(expect.objectContaining({
      code: 'hosted_identity_mismatch',
      status: 403,
    }));
  });

  it('selects exactly one api-key connector and rejects zero or multiple connectors', () => {
    const { document } = remoteFixture();
    expect(selectRemoteConnector(document.extension)).toEqual({
      id: 'crm',
      origin: 'https://api.example.com',
      authType: 'api-key',
    });
    expect(() => selectRemoteConnector({ ...document.extension, connectors: [] }))
      .toThrow(expect.objectContaining({ code: 'remote_connector_required', status: 409 }));
    expect(() => selectRemoteConnector({
      ...document.extension,
      connectors: [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
      }, {
        id: 'crm2',
        type: 'http',
        baseUrl: 'https://api2.example.com',
        auth: { type: 'api-key' },
      }],
    })).toThrow(expect.objectContaining({ code: 'remote_connector_ambiguous', status: 409 }));
    expect(() => selectRemoteConnector({
      ...document.extension,
      connectors: [{ id: 'crm', type: 'http', baseUrl: 'https://api.example.com', auth: { type: 'issued-key' } }],
    })).toThrow(expect.objectContaining({ code: 'remote_connector_required', status: 409 }));
  });

  it('fetches only the signed manifest and never remote resources', async () => {
    const { document } = remoteFixture();
    const requested = [];
    const verified = await fetchRemoteOcixManifest({
      appEntryUrl: 'https://apps.example.com/manifest.json',
      fetchImpl: async (url) => {
        requested.push(String(url));
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    expect(verified.manifestHash).toMatch(/^sha256-/);
    expect(requested).toEqual(['https://apps.example.com/manifest.json']);
  });
});
