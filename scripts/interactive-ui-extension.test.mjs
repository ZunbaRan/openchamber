import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildMarketplaceCatalog,
  generateSigningKeys,
  packExtension,
  scaffoldExtension,
  validateExtension,
  verifyPackageFile,
} from './interactive-ui-extension.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('validates the bundled generated, Declarative, and Native examples', async () => {
  const examples = ['builtin-visualization', 'acme-crm', 'acme-sales'];
  for (const name of examples) {
    const report = await validateExtension(path.join(repoRoot, 'examples', 'interactive-ui', name));
    assert.equal(report.warnings.length, 0, `${name} should not require validator exceptions`);
  }
});

test('scaffolds and validates a Declarative plus Trusted Native extension', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-'));
  const target = path.join(temporaryRoot, 'operations');
  try {
    const scaffold = await scaffoldExtension({
      targetDirectory: target,
      extensionId: 'com.acme.operations',
      name: 'Acme Operations',
      toolPrefix: 'operations',
    });
    assert.equal(scaffold.extensionId, 'com.acme.operations');

    const manifest = JSON.parse(await readFile(path.join(target, 'openchamber.extension.json'), 'utf8'));
    assert.deepEqual(manifest.connectors[0].auth, {
      type: 'api-key',
      placement: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    });
    assert.deepEqual(manifest.connectors[0].test, { method: 'GET', path: '/interactive-ui/health' });

    const report = await validateExtension(target);
    assert.deepEqual(report.declarativeViews, ['com.acme.operations.overview']);
    assert.deepEqual(report.nativeViews, ['com.acme.operations.workspace']);
    assert.deepEqual(report.actions, ['com.acme.operations.overview.query', 'com.acme.operations.item.approve']);
    assert.equal(report.warnings.length, 0);

    await assert.rejects(
      scaffoldExtension({
        targetDirectory: target,
        extensionId: 'com.acme.second',
        name: 'Second',
        toolPrefix: 'second',
      }),
      /refusing to overwrite/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('validates issued-key provisioning without requiring a real setup code or network request', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-issued-key-'));
  const target = path.join(temporaryRoot, 'operations');
  try {
    await scaffoldExtension({
      targetDirectory: target,
      extensionId: 'com.acme.operations',
      name: 'Acme Operations',
      toolPrefix: 'operations',
    });
    const manifestPath = path.join(target, 'openchamber.extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.connectors[0].auth = {
      type: 'issued-key',
      provisioningUrl: '${OCIX_CREDENTIAL_ISSUER_URL}',
      placement: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    };
    manifest.permissions.network.push('${OCIX_CREDENTIAL_ISSUER_URL}');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const report = await validateExtension(target);
    assert.equal(report.warnings.length, 0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('reports the exact location of an unsupported Declarative primitive', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-invalid-'));
  const target = path.join(temporaryRoot, 'operations');
  try {
    await scaffoldExtension({
      targetDirectory: target,
      extensionId: 'com.acme.operations',
      name: 'Acme Operations',
      toolPrefix: 'operations',
    });
    const viewPath = path.join(target, 'ui', 'declarative', 'overview.view.json');
    const view = JSON.parse(await readFile(viewPath, 'utf8'));
    view.layout.children[0].type = 'arbitrary-html';
    await writeFile(viewPath, `${JSON.stringify(view, null, 2)}\n`);

    await assert.rejects(validateExtension(target), /layout\.children\[0\]\.type: unsupported primitive arbitrary-html/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('generates offline signing keys and round-trips a production .ocix package', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-signing-'));
  const target = path.join(temporaryRoot, 'operations');
  const keysDirectory = path.join(temporaryRoot, 'offline-keys');
  const packagePath = path.join(temporaryRoot, 'dist', 'operations.ocix');
  try {
    await scaffoldExtension({
      targetDirectory: target,
      extensionId: 'com.acme.operations',
      name: 'Acme Operations',
      toolPrefix: 'operations',
    });
    const keys = await generateSigningKeys({ outputDirectory: keysDirectory });
    const packed = await packExtension({
      extensionDirectory: target,
      outputPath: packagePath,
      privateKeyPath: keys.privateKeyPath,
      publisherId: 'com.acme.publisher',
      publisherName: 'Acme',
      keyId: 'release-2026',
    });
    const verified = await verifyPackageFile({
      packagePath,
      publicKeyPath: keys.publicKeyPath,
      publisherId: 'com.acme.publisher',
      keyId: 'release-2026',
    });

    assert.equal(verified.extensionId, packed.extensionId);
    assert.equal(verified.packageHash, packed.packageHash);
    assert.equal((await stat(keys.privateKeyPath)).mode & 0o777, 0o600);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('builds a signed static marketplace catalog for independent hosting', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-catalog-'));
  try {
    const marketplaceKeys = await generateSigningKeys({ outputDirectory: path.join(temporaryRoot, 'market-keys') });
    const publisherKeys = await generateSigningKeys({ outputDirectory: path.join(temporaryRoot, 'publisher-keys') });
    const entriesPath = path.join(temporaryRoot, 'entries.json');
    const catalogPath = path.join(temporaryRoot, 'catalog.json');
    await writeFile(entriesPath, JSON.stringify([{
      id: 'com.acme.operations',
      name: 'Acme Operations',
      version: '1.0.0',
      packageUrl: 'https://extensions.example.com/operations.ocix',
      packageHash: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      publisher: {
        id: 'com.acme.publisher',
        name: 'Acme',
        keyId: 'release-2026',
        publicKey: await readFile(publisherKeys.publicKeyPath, 'utf8'),
      },
    }]));
    const result = await buildMarketplaceCatalog({
      entriesPath,
      outputPath: catalogPath,
      privateKeyPath: marketplaceKeys.privateKeyPath,
      marketplaceId: 'com.acme.marketplace',
      marketplaceName: 'Acme Marketplace',
      keyId: 'catalog-2026',
    });

    assert.equal(result.entries, 1);
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    assert.equal(catalog.marketplace.id, 'com.acme.marketplace');
    assert.equal(catalog.signature.algorithm, 'ed25519');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
