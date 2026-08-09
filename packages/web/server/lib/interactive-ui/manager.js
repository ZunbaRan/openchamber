import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import {
  InteractiveUIPackageError,
  normalizeEd25519PublicKey,
  publicKeyFingerprint,
  verifyExtensionPackage,
  verifySignedExtensionCatalog,
} from './package-format.js';
import {
  HOSTED_OCIX_SIGNED_MANIFEST_FILE,
  canonicalStringify,
  normalizeHostedPermissions,
  safeRelativePath,
} from './hosted-ocix.js';
import {
  fetchRemoteOcixManifest,
  hostedSurfaceBindings,
  selectRemoteConnector,
  verifyRemoteOcixManifest,
} from './remote-ocix.js';

const TRUST_SCHEMA = 'openchamber://extension-trust-store/v1';
const STATE_SCHEMA = 'openchamber://extension-manager-state/v1';
const MARKETPLACES_SCHEMA = 'openchamber://extension-marketplaces/v1';
const REMOTE_CONSENTS_SCHEMA = 'openchamber://remote-consent-store/v1';
const REMOTE_CONSENT_SUBJECT_SCHEMA = 'openchamber://remote-consent-subject/v1';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_URL_LENGTH = 4_096;
const MAX_ID_CODE_UNITS = 128;
const MAX_DISPLAY_NAME_LENGTH = 200;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const MARKETPLACE_SOURCE_PREFIX = 'marketplace:';
const BLOCKED_KEY_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INSTALLATION_ID_PATTERN = /^[^\u0000-\u001F\u007F]{1,128}$/;
const MANUAL_SOURCE = 'manual';
const PACKAGE_CONFIRMATION_SOURCE = 'package-confirmation';

const REMOTE_ENTRY_EXTENSIONS = Object.freeze({
  declarative: ['.json'],
  native: ['.mjs', '.js'],
  artifact: ['.html'],
  icon: ['.svg', '.png'],
});

export class InteractiveUIExtensionManagerError extends Error {
  constructor(message, code = 'extension_manager_error', status = 400, details = undefined) {
    super(message);
    this.name = 'InteractiveUIExtensionManagerError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

const emptyTrust = () => ({ $schema: TRUST_SCHEMA, publishers: Object.create(null) });
const emptyState = () => ({ $schema: STATE_SCHEMA, extensions: Object.create(null) });
const emptyMarketplaces = () => ({ $schema: MARKETPLACES_SCHEMA, marketplaces: Object.create(null) });
const emptyRemoteConsents = () => ({ $schema: REMOTE_CONSENTS_SCHEMA, consents: Object.create(null) });

const corruptStore = (message = 'Extension trust store is invalid') =>
  new InteractiveUIExtensionManagerError(message, 'manager_data_corrupt', 500);

const corruptState = (message = 'Extension manager state is invalid') =>
  new InteractiveUIExtensionManagerError(message, 'manager_data_corrupt', 500);

const corruptMarketplaces = (message = 'Extension marketplace store is invalid') =>
  new InteractiveUIExtensionManagerError(message, 'manager_data_corrupt', 500);

// Deterministic code-point ordering. localeCompare is locale-dependent and
// must never order trust identifiers.
const compareCodePoints = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const assertNamespacedId = (value, label) => {
  if (typeof value !== 'string' || !value || value.length > MAX_ID_CODE_UNITS || !ID_PATTERN.test(value)) {
    throw new InteractiveUIExtensionManagerError(`${label} must be a namespaced identifier`, 'invalid_identifier');
  }
  return value;
};

// Key ids are exact strings: regex-valid names that collide with
// Object.prototype (toString, hasOwnProperty, valueOf, ...) remain valid and
// are stored as OWN slots; only the three prototype-escaping names are
// rejected. Non-string values never pass through here (a signed array key id
// cannot coerce into a trusted string slot).
const assertKeyId = (value) => {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value) || BLOCKED_KEY_IDS.has(value)) {
    throw new InteractiveUIExtensionManagerError('Key id is invalid', 'invalid_key_id');
  }
  return value;
};

const assertDisplayName = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    throw new InteractiveUIExtensionManagerError(`${label} is required`, 'invalid_name');
  }
  return value.trim();
};

const normalizeRemoteUrl = (value, label) => {
  if (typeof value !== 'string' || !value || value.length > MAX_REMOTE_URL_LENGTH || value !== value.trim()) {
    throw new InteractiveUIExtensionManagerError(`${label} must be an absolute URL`, 'invalid_url');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new InteractiveUIExtensionManagerError(`${label} must be an absolute URL`, 'invalid_url');
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    || parsed.username
    || parsed.password
    || parsed.hash) {
    throw new InteractiveUIExtensionManagerError(
      `${label} must use credential-free HTTPS (HTTP is allowed only for loopback) and cannot contain a fragment`,
      'unsafe_url',
    );
  }
  return parsed.toString();
};

const assertConnectorId = (value, label = 'Remote connector id') => {
  if (typeof value !== 'string' || !CONNECTOR_ID_PATTERN.test(value)) {
    throw new InteractiveUIExtensionManagerError(`${label} is invalid`, 'remote_connector_required', 409);
  }
  return value;
};

const normalizeRemoteOrigin = (value, label = 'Remote connector origin') => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new InteractiveUIExtensionManagerError(`${label} is invalid`, 'remote_connector_required', 409);
  }
  const normalized = normalizeRemoteUrl(parsed.origin, label);
  if (parsed.origin !== new URL(normalized).origin || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new InteractiveUIExtensionManagerError(`${label} must be an origin`, 'remote_connector_required', 409);
  }
  return parsed.origin;
};

const validateRemoteResourceEntries = (extension, resources) => {
  const resourceByPath = new Map(resources.map((resource) => [resource.path, resource]));
  const requireDeclaredResource = (entry, label, allowedExtensions) => {
    const normalizedPath = safeRelativePath(entry);
    if (!normalizedPath) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry is not a safe relative path`,
        'invalid_hosted_resource',
        400,
      );
    }
    if (!allowedExtensions.some((extensionName) => normalizedPath.endsWith(extensionName))) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry has an unsupported file type`,
        'invalid_entry',
        400,
      );
    }
    if (!resourceByPath.has(normalizedPath)) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry is not declared in the signed resource index`,
        'invalid_hosted_resource',
        400,
      );
    }
  };
  for (const view of Array.isArray(extension?.views) ? extension.views : []) {
    if (!isRecord(view) || typeof view.id !== 'string') continue;
    requireDeclaredResource(
      view.entry,
      `view ${view.id}`,
      REMOTE_ENTRY_EXTENSIONS[view.runtime === 'native' ? 'native' : 'declarative'],
    );
  }
  for (const artifact of Array.isArray(extension?.artifacts) ? extension.artifacts : []) {
    if (!isRecord(artifact) || typeof artifact.id !== 'string') continue;
    requireDeclaredResource(artifact.entry, `artifact ${artifact.id}`, REMOTE_ENTRY_EXTENSIONS.artifact);
  }
  if (extension?.icon !== undefined) {
    requireDeclaredResource(extension.icon, 'icon', REMOTE_ENTRY_EXTENSIONS.icon);
  }
};

const summarizeRemoteReview = (remote, trusted) => ({
  extension: {
    id: remote.extensionId,
    name: typeof remote.extension?.name === 'string' && remote.extension.name.trim()
      ? remote.extension.name.trim()
      : remote.extensionId,
    version: remote.version,
  },
  publisher: {
    id: remote.publisher.id,
    name: remote.publisher.name,
    keyId: remote.publisher.keyId,
    fingerprint: remote.publisher.fingerprint,
    trusted,
  },
  permissions: clone(remote.permissions),
  manifest: {
    appEntryUrl: remote.appEntryUrl,
    manifestHash: remote.manifestHash,
    publishedAt: remote.publishedAt,
  },
  connector: clone(remote.connector),
});

const ownSlot = (record, key) => (
  isRecord(record) && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null
);

const remotePublisherTrusted = (trust, publisher, cryptoImpl) => {
  const publisherRecord = ownSlot(trust?.publishers, publisher?.id);
  const stored = ownSlot(publisherRecord?.keys, publisher?.keyId);
  if (!isRecord(stored) || typeof stored.publicKey !== 'string') return false;
  try {
    return publicKeyFingerprint(stored.publicKey, cryptoImpl) === publisher.fingerprint;
  } catch {
    return false;
  }
};

// Source values are exactly manual, package-confirmation, or
// marketplace:<namespaced-id>; nothing else is accepted or persisted. The
// prefix is exact lowercase; the namespaced suffix keeps the frozen
// case-insensitive ID grammar.
const assertSource = (value) => {
  if (value === MANUAL_SOURCE || value === PACKAGE_CONFIRMATION_SOURCE) return value;
  if (typeof value === 'string' && value.startsWith(MARKETPLACE_SOURCE_PREFIX)) {
    const suffix = value.slice(MARKETPLACE_SOURCE_PREFIX.length);
    if (suffix && suffix.length <= MAX_ID_CODE_UNITS && ID_PATTERN.test(suffix)) return value;
  }
  throw new InteractiveUIExtensionManagerError('Publisher key source is invalid', 'invalid_source');
};

const assertInstallSource = (value) => {
  if (isRecord(value) && value.type === 'file' && Object.keys(value).length === 1) {
    return { type: 'file' };
  }
  if (isRecord(value) && value.type === 'marketplace' && Object.keys(value).length === 2) {
    return {
      type: 'marketplace',
      marketplaceId: assertNamespacedId(value.marketplaceId, 'Marketplace id'),
    };
  }
  throw new InteractiveUIExtensionManagerError('Extension install source is invalid', 'invalid_install_source');
};

const assertStoredNamespacedId = (value) => {
  try {
    return assertNamespacedId(value, 'Publisher id');
  } catch {
    throw corruptStore('Extension trust store contains an invalid publisher id');
  }
};

const assertStoredKeyId = (value) => {
  try {
    return assertKeyId(value);
  } catch {
    throw corruptStore('Extension trust store contains an invalid key id');
  }
};

const assertStoredDisplayName = (value) => {
  try {
    return assertDisplayName(value, 'Publisher name');
  } catch {
    throw corruptStore('Extension trust store contains an invalid publisher name');
  }
};

const assertStoredSource = (value) => {
  try {
    return assertSource(value);
  } catch {
    throw corruptStore('Extension trust store contains an invalid key source');
  }
};

const assertStoredTrustedAt = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw corruptStore('Extension trust store contains an invalid trustedAt timestamp');
  }
  return value;
};

// Strict durable validation: unknown own fields are rejected at the document,
// publisher, and key levels; map keys must match the canonical stored id;
// stored display names must already be trimmed and stored public keys must
// already be the exact canonical normalized SPKI PEM string (equivalent
// padded/alternative forms are corrupt); every stored public key is
// re-fingerprinted on EVERY read, so a stale or lying fingerprint record
// fails closed.
const validateTrustStore = (parsed, cryptoImpl) => {
  if (!isRecord(parsed) || parsed.$schema !== TRUST_SCHEMA || !isRecord(parsed.publishers)) {
    throw corruptStore();
  }
  for (const field of Object.keys(parsed)) {
    if (field !== '$schema' && field !== 'publishers') {
      throw corruptStore(`Extension trust store has an unknown field: ${field}`);
    }
  }
  const publishers = Object.create(null);
  for (const [publisherId, publisherRecord] of Object.entries(parsed.publishers)) {
    if (!isRecord(publisherRecord)) throw corruptStore(`Publisher ${publisherId} is invalid`);
    for (const field of Object.keys(publisherRecord)) {
      if (field !== 'id' && field !== 'name' && field !== 'keys') {
        throw corruptStore(`Publisher ${publisherId} has an unknown field: ${field}`);
      }
    }
    const id = assertStoredNamespacedId(publisherId);
    if (publisherRecord.id !== id) {
      throw corruptStore(`Publisher ${publisherId} has a non-canonical stored id`);
    }
    const name = assertStoredDisplayName(publisherRecord.name);
    if (publisherRecord.name !== name) {
      throw corruptStore(`Publisher ${publisherId} has a non-canonical stored name`);
    }
    if (!isRecord(publisherRecord.keys)) throw corruptStore(`Publisher ${publisherId} keys are invalid`);
    const keys = Object.create(null);
    for (const [keyId, keyRecord] of Object.entries(publisherRecord.keys)) {
      if (!isRecord(keyRecord)) throw corruptStore(`Publisher ${publisherId} key ${keyId} is invalid`);
      for (const field of Object.keys(keyRecord)) {
        if (field !== 'keyId' && field !== 'publicKey' && field !== 'fingerprint' && field !== 'source' && field !== 'trustedAt') {
          throw corruptStore(`Publisher ${publisherId} key ${keyId} has an unknown field: ${field}`);
        }
      }
      const normalizedKeyId = assertStoredKeyId(keyId);
      if (keyRecord.keyId !== normalizedKeyId) {
        throw corruptStore(`Publisher ${publisherId} key ${keyId} has a non-canonical stored keyId`);
      }
      if (typeof keyRecord.publicKey !== 'string') {
        throw corruptStore(`Publisher ${publisherId} key ${keyId} has a non-canonical stored public key`);
      }
      let publicKey;
      try {
        publicKey = normalizeEd25519PublicKey(keyRecord.publicKey, cryptoImpl);
      } catch {
        throw corruptStore(`Publisher ${publisherId} key ${keyId} has an invalid stored public key`);
      }
      if (keyRecord.publicKey !== publicKey) {
        throw corruptStore(`Publisher ${publisherId} key ${keyId} has a non-canonical stored public key`);
      }
      const fingerprint = publicKeyFingerprint(publicKey, cryptoImpl);
      if (keyRecord.fingerprint !== fingerprint) {
        throw corruptStore(`Publisher ${publisherId} key ${keyId} fingerprint does not match its stored public key`);
      }
      keys[keyId] = {
        keyId: normalizedKeyId,
        publicKey,
        fingerprint,
        source: assertStoredSource(keyRecord.source),
        trustedAt: assertStoredTrustedAt(keyRecord.trustedAt),
      };
    }
    publishers[publisherId] = { id, name, keys };
  }
  return { $schema: TRUST_SCHEMA, publishers };
};

const validateMarketplaceStore = (parsed, cryptoImpl) => {
  if (!isRecord(parsed) || parsed.$schema !== MARKETPLACES_SCHEMA || !isRecord(parsed.marketplaces)) {
    throw corruptMarketplaces();
  }
  for (const field of Object.keys(parsed)) {
    if (field !== '$schema' && field !== 'marketplaces') {
      throw corruptMarketplaces(`Extension marketplace store has an unknown field: ${field}`);
    }
  }
  const marketplaces = Object.create(null);
  for (const [marketplaceId, record] of Object.entries(parsed.marketplaces)) {
    if (!isRecord(record)) throw corruptMarketplaces(`Marketplace ${marketplaceId} is invalid`);
    for (const field of Object.keys(record)) {
      if (!['id', 'name', 'keyId', 'catalogUrl', 'publicKey', 'fingerprint', 'addedAt'].includes(field)) {
        throw corruptMarketplaces(`Marketplace ${marketplaceId} has an unknown field: ${field}`);
      }
    }
    let id;
    let name;
    let keyId;
    let catalogUrl;
    let publicKey;
    try {
      id = assertNamespacedId(marketplaceId, 'Marketplace id');
      name = assertDisplayName(record.name, 'Marketplace name');
      keyId = assertKeyId(record.keyId);
      catalogUrl = normalizeRemoteUrl(record.catalogUrl, 'Marketplace catalog URL');
      publicKey = normalizeEd25519PublicKey(record.publicKey, cryptoImpl);
    } catch {
      throw corruptMarketplaces(`Marketplace ${marketplaceId} contains invalid identity or key data`);
    }
    if (record.id !== id
      || record.name !== name
      || record.catalogUrl !== catalogUrl
      || record.publicKey !== publicKey) {
      throw corruptMarketplaces(`Marketplace ${marketplaceId} contains non-canonical data`);
    }
    const fingerprint = publicKeyFingerprint(publicKey, cryptoImpl);
    if (record.fingerprint !== fingerprint) {
      throw corruptMarketplaces(`Marketplace ${marketplaceId} fingerprint does not match its stored public key`);
    }
    if (typeof record.addedAt !== 'string' || !Number.isFinite(Date.parse(record.addedAt))) {
      throw corruptMarketplaces(`Marketplace ${marketplaceId} addedAt timestamp is invalid`);
    }
    marketplaces[id] = { id, name, keyId, catalogUrl, publicKey, fingerprint, addedAt: record.addedAt };
  }
  return { $schema: MARKETPLACES_SCHEMA, marketplaces };
};

const discardResponseBody = (response) => {
  try {
    const pending = response?.body?.cancel?.();
    Promise.resolve(pending).catch(() => {});
  } catch {
    // Remote cleanup is best-effort and must never delay the authoritative error.
  }
};

const cancelReader = (reader) => {
  try {
    const pending = reader?.cancel?.();
    Promise.resolve(pending).catch(() => {});
  } catch {
    // Remote cleanup is best-effort and must never delay the authoritative error.
  }
};

const createRemoteDeadline = (timeoutMs, label) => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new InteractiveUIExtensionManagerError(`${label} timed out`, 'remote_timeout', 504));
    }, timeoutMs);
    timer.unref?.();
  });
  return {
    signal: controller.signal,
    run: (operation) => Promise.race([Promise.resolve(operation), timeout]),
    close: () => clearTimeout(timer),
  };
};

const assertUnredirectedResponse = (response, requestedUrl, label) => {
  let mismatched = response?.redirected === true;
  if (!mismatched && typeof response?.url === 'string' && response.url) {
    try {
      mismatched = normalizeRemoteUrl(response.url, `${label} response URL`) !== requestedUrl;
    } catch {
      mismatched = true;
    }
  }
  if (mismatched) {
    discardResponseBody(response);
    throw new InteractiveUIExtensionManagerError(
      `${label} redirects are not allowed`,
      'remote_redirect_not_allowed',
      502,
    );
  }
};

const responseBytes = async (response, maxBytes, label, deadline) => {
  const contentLength = response?.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      discardResponseBody(response);
      throw new InteractiveUIExtensionManagerError(`${label} response length is invalid`, 'remote_response_invalid', 502);
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      discardResponseBody(response);
      throw new InteractiveUIExtensionManagerError(`${label} exceeds the size limit`, 'remote_content_too_large', 413);
    }
  }
  if (!response?.body?.getReader) {
    discardResponseBody(response);
    throw new InteractiveUIExtensionManagerError(`${label} response is not a readable stream`, 'remote_response_invalid', 502);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await deadline.run(reader.read());
      if (done) break;
      if (!value || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
        throw new InteractiveUIExtensionManagerError(`${label} response stream is invalid`, 'remote_response_invalid', 502);
      }
      total += value.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) {
        throw new InteractiveUIExtensionManagerError(`${label} exceeds the size limit`, 'remote_content_too_large', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile releaseLock implementation must not mask the authoritative result.
    }
  }
  return Buffer.concat(chunks, total);
};

const invalidCatalog = (message) =>
  new InteractiveUIExtensionManagerError(message, 'invalid_catalog', 400);

const assertCatalogFields = (record, expected, label) => {
  if (!isRecord(record)) throw invalidCatalog(`${label} is invalid`);
  for (const field of Object.keys(record)) {
    if (!expected.has(field)) throw invalidCatalog(`${label} has an unknown field: ${field}`);
  }
  for (const field of expected) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw invalidCatalog(`${label} is missing ${field}`);
    }
  }
};

const normalizeVerifiedCatalog = (catalog, verified, cryptoImpl) => {
  assertCatalogFields(
    catalog,
    new Set(['$schema', 'marketplace', 'generatedAt', 'entries', 'signature']),
    'Marketplace catalog',
  );
  assertCatalogFields(
    catalog.marketplace,
    new Set(['id', 'name', 'keyId', 'publicKey']),
    'Marketplace catalog identity',
  );
  assertCatalogFields(
    catalog.signature,
    new Set(['algorithm', 'value']),
    'Marketplace catalog signature',
  );
  if (typeof catalog.generatedAt !== 'string' || !Number.isFinite(Date.parse(catalog.generatedAt))) {
    throw invalidCatalog('Marketplace catalog generatedAt timestamp is invalid');
  }
  const marketplace = {
    id: assertNamespacedId(catalog.marketplace.id, 'Marketplace id'),
    name: assertDisplayName(catalog.marketplace.name, 'Marketplace name'),
    keyId: assertKeyId(catalog.marketplace.keyId),
    publicKey: normalizeEd25519PublicKey(catalog.marketplace.publicKey, cryptoImpl),
    fingerprint: verified.fingerprint,
  };
  if (publicKeyFingerprint(marketplace.publicKey, cryptoImpl) !== marketplace.fingerprint) {
    throw invalidCatalog('Marketplace catalog fingerprint is invalid');
  }
  const entries = catalog.entries.map((entry, index) => {
    assertCatalogFields(
      entry,
      new Set(['id', 'name', 'version', 'packageUrl', 'packageHash', 'publisher']),
      `Marketplace catalog entry ${index}`,
    );
    assertCatalogFields(
      entry.publisher,
      new Set(['id', 'name', 'keyId', 'publicKey']),
      `Marketplace catalog entry ${index} publisher`,
    );
    const version = entry.version;
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      throw invalidCatalog(`Marketplace catalog entry ${index} version is invalid`);
    }
    if (typeof entry.packageHash !== 'string' || !SHA256_PATTERN.test(entry.packageHash)) {
      throw invalidCatalog(`Marketplace catalog entry ${index} package hash is invalid`);
    }
    const publisherPublicKey = normalizeEd25519PublicKey(entry.publisher.publicKey, cryptoImpl);
    return {
      id: assertNamespacedId(entry.id, 'Extension id'),
      name: assertDisplayName(entry.name, 'Extension name'),
      version,
      packageUrl: normalizeRemoteUrl(entry.packageUrl, 'Extension package URL'),
      packageHash: entry.packageHash,
      publisher: {
        id: assertNamespacedId(entry.publisher.id, 'Publisher id'),
        name: assertDisplayName(entry.publisher.name, 'Publisher name'),
        keyId: assertKeyId(entry.publisher.keyId),
        publicKey: publisherPublicKey,
        fingerprint: publicKeyFingerprint(publisherPublicKey, cryptoImpl),
      },
    };
  });
  return {
    $schema: catalog.$schema,
    marketplace,
    generatedAt: catalog.generatedAt,
    entries,
  };
};

const assertExactStateFields = (record, allowed, label) => {
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) throw corruptState(`${label} has an unknown field: ${field}`);
  }
};

const validateRemoteConsentStore = (parsed) => {
  if (!isRecord(parsed)
    || parsed.$schema !== REMOTE_CONSENTS_SCHEMA
    || !isRecord(parsed.consents)) {
    throw corruptState('Remote consent store is invalid');
  }
  assertExactStateFields(parsed, new Set(['$schema', 'consents']), 'Remote consent store');
  const consents = Object.create(null);
  for (const [consentDigest, record] of Object.entries(parsed.consents)) {
    if (!isRecord(record)) throw corruptState('Remote consent record is invalid');
    assertExactStateFields(
      record,
      new Set(['installationId', 'extensionId', 'consentDigest', 'confirmedAt']),
      `Remote consent ${consentDigest}`,
    );
    let extensionId;
    try {
      extensionId = assertNamespacedId(record.extensionId, 'Remote consent extension id');
    } catch {
      throw corruptState('Remote consent extension identity is invalid');
    }
    if (!INSTALLATION_ID_PATTERN.test(record.installationId ?? '')
      || record.consentDigest !== consentDigest
      || !SHA256_PATTERN.test(consentDigest)
      || typeof record.confirmedAt !== 'string'
      || !Number.isFinite(Date.parse(record.confirmedAt))) {
      throw corruptState(`Remote consent ${consentDigest} is non-canonical`);
    }
    consents[consentDigest] = {
      installationId: record.installationId,
      extensionId,
      consentDigest: record.consentDigest,
      confirmedAt: record.confirmedAt,
    };
  }
  return { $schema: REMOTE_CONSENTS_SCHEMA, consents };
};

const assertStoredVersion = (value, label = 'Extension version') => {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    throw corruptState(`${label} is invalid`);
  }
  return value;
};

const assertStoredFingerprint = (value) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw corruptState('Extension publisher fingerprint is invalid');
  }
  return value;
};

const assertStoredInstalledAt = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw corruptState('Extension installedAt timestamp is invalid');
  }
  return value;
};

const normalizeStoredFilePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  const normalized = nodePath.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
};

const normalizeStoredRemoteMetadata = ({
  value,
  extensionId,
  version,
  packageHash: storedPackageHash,
  source,
  publisher,
  cryptoImpl,
}) => {
  if (!isRecord(value)) throw corruptState(`Extension ${extensionId}@${version} Remote metadata is invalid`);
  assertExactStateFields(
    value,
    new Set([
      'appEntryUrl',
      'installationId',
      'publisherPublicKey',
      'connectorRefs',
      'acceptedManifest',
      'approvedPermissions',
      'status',
      'connectedAt',
      'lastConsentAt',
    ]),
    `Extension ${extensionId}@${version} Remote metadata`,
  );
  let appEntryUrl;
  let publisherPublicKey;
  try {
    appEntryUrl = normalizeRemoteUrl(value.appEntryUrl, 'Remote app entry URL');
    publisherPublicKey = normalizeEd25519PublicKey(value.publisherPublicKey, cryptoImpl);
  } catch {
    throw corruptState(`Extension ${extensionId}@${version} Remote identity is invalid`);
  }
  if (value.appEntryUrl !== appEntryUrl
    || source.type !== 'remote'
    || source.appEntryUrl !== appEntryUrl
    || value.publisherPublicKey !== publisherPublicKey
    || publicKeyFingerprint(publisherPublicKey, cryptoImpl) !== publisher.fingerprint
    || typeof value.installationId !== 'string'
    || !INSTALLATION_ID_PATTERN.test(value.installationId)
    || value.status !== 'active') {
    throw corruptState(`Extension ${extensionId}@${version} Remote identity is non-canonical`);
  }
  if (!Array.isArray(value.connectorRefs) || value.connectorRefs.length !== 1) {
    throw corruptState(`Extension ${extensionId}@${version} Remote connector binding is invalid`);
  }
  const connector = value.connectorRefs[0];
  if (!isRecord(connector)) throw corruptState(`Extension ${extensionId}@${version} Remote connector binding is invalid`);
  assertExactStateFields(
    connector,
    new Set(['id', 'origin', 'authType']),
    `Extension ${extensionId}@${version} Remote connector binding`,
  );
  let connectorId;
  let connectorOrigin;
  try {
    connectorId = assertConnectorId(connector.id);
    connectorOrigin = normalizeRemoteOrigin(connector.origin);
  } catch {
    throw corruptState(`Extension ${extensionId}@${version} Remote connector binding is invalid`);
  }
  if (connector.authType !== 'api-key' || connector.origin !== connectorOrigin) {
    throw corruptState(`Extension ${extensionId}@${version} Remote connector binding is non-canonical`);
  }
  if (!isRecord(value.acceptedManifest)) {
    throw corruptState(`Extension ${extensionId}@${version} accepted Remote manifest is invalid`);
  }
  assertExactStateFields(
    value.acceptedManifest,
    new Set(['version', 'manifestHash', 'publishedAt', 'keyId', 'fetchedAt']),
    `Extension ${extensionId}@${version} accepted Remote manifest`,
  );
  const accepted = value.acceptedManifest;
  if (accepted.version !== version
    || accepted.manifestHash !== storedPackageHash
    || accepted.keyId !== publisher.keyId
    || !SHA256_PATTERN.test(accepted.manifestHash ?? '')
    || typeof accepted.publishedAt !== 'string'
    || !Number.isFinite(Date.parse(accepted.publishedAt))
    || typeof accepted.fetchedAt !== 'string'
    || !Number.isFinite(Date.parse(accepted.fetchedAt))) {
    throw corruptState(`Extension ${extensionId}@${version} accepted Remote manifest is invalid`);
  }
  let approvedPermissions;
  try {
    approvedPermissions = normalizeHostedPermissions(value.approvedPermissions);
  } catch {
    throw corruptState(`Extension ${extensionId}@${version} approved Remote permissions are invalid`);
  }
  if (canonicalStringify(approvedPermissions) !== canonicalStringify(value.approvedPermissions)
    || !approvedPermissions.networkOrigins.includes(connectorOrigin)) {
    throw corruptState(`Extension ${extensionId}@${version} approved Remote permissions are non-canonical`);
  }
  const connectedAt = assertStoredInstalledAt(value.connectedAt);
  const lastConsentAt = assertStoredInstalledAt(value.lastConsentAt);
  return {
    appEntryUrl,
    installationId: value.installationId,
    publisherPublicKey,
    connectorRefs: [{ id: connectorId, origin: connectorOrigin, authType: 'api-key' }],
    acceptedManifest: {
      version,
      manifestHash: accepted.manifestHash,
      publishedAt: accepted.publishedAt,
      keyId: publisher.keyId,
      fetchedAt: accepted.fetchedAt,
    },
    approvedPermissions,
    status: 'active',
    connectedAt,
    lastConsentAt,
  };
};

const validateState = (parsed, cryptoImpl) => {
  if (!isRecord(parsed) || parsed.$schema !== STATE_SCHEMA || !isRecord(parsed.extensions)) throw corruptState();
  assertExactStateFields(parsed, new Set(['$schema', 'extensions']), 'Extension manager state');
  const extensions = Object.create(null);
  for (const [extensionId, extensionRecord] of Object.entries(parsed.extensions)) {
    if (!isRecord(extensionRecord)) throw corruptState(`Extension ${extensionId} is invalid`);
    assertExactStateFields(
      extensionRecord,
      new Set(['id', 'name', 'enabled', 'activeVersion', 'activationHistory', 'versions']),
      `Extension ${extensionId}`,
    );
    let id;
    let name;
    try {
      id = assertNamespacedId(extensionId, 'Extension id');
      name = assertDisplayName(extensionRecord.name, 'Extension name');
    } catch {
      throw corruptState(`Extension ${extensionId} identity is invalid`);
    }
    if (extensionRecord.id !== id || extensionRecord.name !== name || typeof extensionRecord.enabled !== 'boolean') {
      throw corruptState(`Extension ${extensionId} identity is non-canonical`);
    }
    const activeVersion = assertStoredVersion(extensionRecord.activeVersion, `Extension ${extensionId} active version`);
    if (!Array.isArray(extensionRecord.activationHistory) || !isRecord(extensionRecord.versions)) {
      throw corruptState(`Extension ${extensionId} lifecycle is invalid`);
    }
    const versions = Object.create(null);
    for (const [version, metadata] of Object.entries(extensionRecord.versions)) {
      if (!isRecord(metadata)) throw corruptState(`Extension ${extensionId}@${version} metadata is invalid`);
      assertExactStateFields(
        metadata,
        new Set([
          'version',
          'packageHash',
          'installedAt',
          'generationId',
          'source',
          'publisher',
          'delivery',
          'agentRuntime',
          'fileHashes',
          'remote',
        ]),
        `Extension ${extensionId}@${version}`,
      );
      const normalizedVersion = assertStoredVersion(version, `Extension ${extensionId} version`);
      if (metadata.version !== normalizedVersion || !SHA256_PATTERN.test(metadata.packageHash ?? '')) {
        throw corruptState(`Extension ${extensionId}@${version} package identity is invalid`);
      }
      if (typeof metadata.generationId !== 'string' || !metadata.generationId) {
        throw corruptState(`Extension ${extensionId}@${version} generation is invalid`);
      }
      let source;
      if (isRecord(metadata.source)
        && metadata.source.type === 'file'
        && Object.keys(metadata.source).length === 1) {
        source = { type: 'file' };
      } else if (isRecord(metadata.source)
        && metadata.source.type === 'marketplace'
        && Object.keys(metadata.source).length === 2) {
        let marketplaceId;
        try {
          marketplaceId = assertNamespacedId(metadata.source.marketplaceId, 'Marketplace id');
        } catch {
          throw corruptState(`Extension ${extensionId}@${version} Marketplace source is invalid`);
        }
        source = { type: 'marketplace', marketplaceId };
      } else if (isRecord(metadata.source)
        && metadata.source.type === 'remote'
        && Object.keys(metadata.source).length === 2) {
        let appEntryUrl;
        try {
          appEntryUrl = normalizeRemoteUrl(metadata.source.appEntryUrl, 'Remote app entry URL');
        } catch {
          throw corruptState(`Extension ${extensionId}@${version} Remote source is invalid`);
        }
        if (metadata.source.appEntryUrl !== appEntryUrl) {
          throw corruptState(`Extension ${extensionId}@${version} Remote source is non-canonical`);
        }
        source = { type: 'remote', appEntryUrl };
      } else {
        throw corruptState(`Extension ${extensionId}@${version} source is invalid`);
      }
      if (!isRecord(metadata.publisher)) throw corruptState(`Extension ${extensionId}@${version} publisher is invalid`);
      assertExactStateFields(
        metadata.publisher,
        new Set(['id', 'name', 'keyId', 'fingerprint']),
        `Extension ${extensionId}@${version} publisher`,
      );
      let publisherId;
      let publisherName;
      let keyId;
      try {
        publisherId = assertNamespacedId(metadata.publisher.id, 'Publisher id');
        publisherName = assertDisplayName(metadata.publisher.name, 'Publisher name');
        keyId = assertKeyId(metadata.publisher.keyId);
      } catch {
        throw corruptState(`Extension ${extensionId}@${version} publisher identity is invalid`);
      }
      if (metadata.publisher.name !== publisherName
        || !['local', 'remote'].includes(metadata.delivery)
        || !isRecord(metadata.agentRuntime)) {
        throw corruptState(`Extension ${extensionId}@${version} contract is invalid`);
      }
      if (!isRecord(metadata.fileHashes) || Object.keys(metadata.fileHashes).length === 0) {
        throw corruptState(`Extension ${extensionId}@${version} file integrity record is invalid`);
      }
      const fileHashes = Object.create(null);
      for (const [filePath, hash] of Object.entries(metadata.fileHashes)) {
        if (!normalizeStoredFilePath(filePath) || typeof hash !== 'string' || !SHA256_PATTERN.test(hash)) {
          throw corruptState(`Extension ${extensionId}@${version} file integrity record is invalid`);
        }
        fileHashes[filePath] = hash;
      }
      const publisher = {
        id: publisherId,
        name: publisherName,
        keyId,
        fingerprint: assertStoredFingerprint(metadata.publisher.fingerprint),
      };
      let remote;
      if (metadata.delivery === 'local') {
        if (metadata.remote !== undefined || source.type === 'remote') {
          throw corruptState(`Extension ${extensionId}@${version} Local contract is invalid`);
        }
      } else {
        if (source.type !== 'remote') {
          throw corruptState(`Extension ${extensionId}@${version} Remote source is invalid`);
        }
        remote = normalizeStoredRemoteMetadata({
          value: metadata.remote,
          extensionId,
          version: normalizedVersion,
          packageHash: metadata.packageHash,
          source,
          publisher,
          cryptoImpl,
        });
      }
      versions[version] = {
        version: normalizedVersion,
        packageHash: metadata.packageHash,
        installedAt: assertStoredInstalledAt(metadata.installedAt),
        generationId: metadata.generationId,
        source,
        publisher,
        delivery: metadata.delivery,
        agentRuntime: clone(metadata.agentRuntime),
        fileHashes,
        ...(remote ? { remote } : {}),
      };
    }
    if (!versions[activeVersion]) throw corruptState(`Extension ${extensionId} active version is missing`);
    const seenHistory = new Set();
    const activationHistory = extensionRecord.activationHistory.map((version) => {
      const normalizedVersion = assertStoredVersion(version, `Extension ${extensionId} activation history version`);
      if (normalizedVersion === activeVersion || !versions[normalizedVersion] || seenHistory.has(normalizedVersion)) {
        throw corruptState(`Extension ${extensionId} activation history is invalid`);
      }
      seenHistory.add(normalizedVersion);
      return normalizedVersion;
    });
    extensions[id] = { id, name, enabled: extensionRecord.enabled, activeVersion, activationHistory, versions };
  }
  return { $schema: STATE_SCHEMA, extensions };
};

const packageHash = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

const remoteConsentRecordFor = (extension, metadata, cryptoImpl) => {
  const remote = metadata?.remote;
  const subject = {
    $schema: REMOTE_CONSENT_SUBJECT_SCHEMA,
    installationId: remote.installationId,
    extension: {
      id: extension.id,
      name: extension.name,
      version: metadata.version,
    },
    source: clone(metadata.source),
    manifestHash: metadata.packageHash,
    publisher: {
      ...clone(metadata.publisher),
      publicKey: remote.publisherPublicKey,
    },
    connector: clone(remote.connectorRefs[0]),
    permissions: clone(remote.approvedPermissions),
    acceptedManifest: clone(remote.acceptedManifest),
  };
  return {
    installationId: remote.installationId,
    extensionId: extension.id,
    consentDigest: packageHash(cryptoImpl, Buffer.from(canonicalStringify(subject))),
    confirmedAt: remote.lastConsentAt,
  };
};

const sanitizeExtension = (extension) => {
  const result = clone(extension);
  for (const metadata of Object.values(result.versions ?? {})) {
    if (!isRecord(metadata)) continue;
    delete metadata.fileHashes;
    delete metadata.generationId;
    if (isRecord(metadata.remote)) {
      delete metadata.remote.installationId;
      delete metadata.remote.publisherPublicKey;
    }
  }
  return result;
};

const sanitizePermissions = (manifest) => ({
  network: Array.isArray(manifest?.permissions?.network)
    ? manifest.permissions.network.filter((value) => typeof value === 'string')
    : [],
  nativeCode: manifest?.trust?.mode === 'native-code',
});

export const createInteractiveUIExtensionManager = ({
  dataDirectory,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = crypto,
  fetchImpl = globalThis.fetch,
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
  validateStagedPackage = null,
  validateRemoteMetadata = null,
  reconcileActivation = null,
  logger = console,
} = {}) => {
  if (typeof dataDirectory !== 'string'
    || !dataDirectory.trim()
    || !fsImpl
    || !pathImpl
    || !cryptoImpl
    || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(fetchTimeoutMs)
    || fetchTimeoutMs <= 0) {
    throw new Error('Interactive UI extension manager dependencies are incomplete');
  }
  if (validateStagedPackage !== null && typeof validateStagedPackage !== 'function') {
    throw new Error('Interactive UI extension manager staged validator is invalid');
  }
  if (validateRemoteMetadata !== null && typeof validateRemoteMetadata !== 'function') {
    throw new Error('Interactive UI extension manager Remote metadata validator is invalid');
  }
  if (reconcileActivation !== null && typeof reconcileActivation !== 'function') {
    throw new Error('Interactive UI extension manager activation reconciler is invalid');
  }
  const dataRoot = pathImpl.resolve(dataDirectory);
  const directory = pathImpl.join(dataRoot, 'interactive-ui');
  const trustPath = pathImpl.join(directory, 'trust.json');
  const statePath = pathImpl.join(directory, 'installations.json');
  const marketplacesPath = pathImpl.join(directory, 'marketplaces.json');
  const remoteConsentsPath = pathImpl.join(directory, 'remote-consents.json');
  const versionsDirectory = pathImpl.join(dataRoot, 'extensions');
  const stagingDirectory = pathImpl.join(directory, 'staging');
  const trashDirectory = pathImpl.join(directory, 'trash');
  let mutationQueue = Promise.resolve();
  const reportedQuarantines = new Set();

  const ensureManagedDirectory = async (target, label) => {
    await fsImpl.mkdir(target, { recursive: true, mode: 0o700 });
    const stat = await fsImpl.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new InteractiveUIExtensionManagerError(
        `${label} is not a trusted directory`,
        'manager_path_conflict',
        409,
      );
    }
  };

  // Serializes every trust mutation: concurrent trust/remove calls apply one
  // at a time and each one re-reads the durable file, so no mutation is lost.
  const mutate = (operation) => {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => {});
    return pending;
  };

  const readTrustStore = async () => {
    let content;
    try {
      content = await fsImpl.readFile(trustPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyTrust();
      throw new InteractiveUIExtensionManagerError('Extension trust store is unreadable', 'manager_data_corrupt', 500);
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new InteractiveUIExtensionManagerError('Extension trust store is not valid JSON', 'manager_data_corrupt', 500);
    }
    return validateTrustStore(parsed, cryptoImpl);
  };

  // Atomic durable write: owner-only directories/files, unique temp name,
  // rename over the target, and temp cleanup on ANY failure. A failed write
  // never touches the previous trust.json.
  const writeTrustStore = async (store) => {
    let temporaryPath;
    try {
      await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryPath = `${trustPath}.${cryptoImpl.randomUUID()}.tmp`;
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fsImpl.rename(temporaryPath, trustPath);
    } catch (error) {
      if (temporaryPath) await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw new InteractiveUIExtensionManagerError('Extension trust store could not be written', 'manager_write_failed', 500);
    }
  };

  const readMarketplaceStore = async () => {
    let content;
    try {
      content = await fsImpl.readFile(marketplacesPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyMarketplaces();
      throw corruptMarketplaces('Extension marketplace store is unreadable');
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw corruptMarketplaces('Extension marketplace store is not valid JSON');
    }
    return validateMarketplaceStore(parsed, cryptoImpl);
  };

  const writeMarketplaceStore = async (store) => {
    let temporaryPath;
    try {
      await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryPath = `${marketplacesPath}.${cryptoImpl.randomUUID()}.tmp`;
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fsImpl.rename(temporaryPath, marketplacesPath);
    } catch {
      if (temporaryPath) await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw new InteractiveUIExtensionManagerError('Extension marketplace store could not be written', 'manager_write_failed', 500);
    }
  };

  const readRemoteConsentStore = async () => {
    let content;
    try {
      content = await fsImpl.readFile(remoteConsentsPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRemoteConsents();
      throw corruptState('Remote consent store is unreadable');
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw corruptState('Remote consent store is not valid JSON');
    }
    return validateRemoteConsentStore(parsed);
  };

  const writeRemoteConsentStore = async (store) => {
    let temporaryPath;
    try {
      await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryPath = `${remoteConsentsPath}.${cryptoImpl.randomUUID()}.tmp`;
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await fsImpl.rename(temporaryPath, remoteConsentsPath);
    } catch {
      if (temporaryPath) await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw new InteractiveUIExtensionManagerError(
        'Remote consent store could not be written',
        'manager_write_failed',
        500,
      );
    }
  };

  const assertRemoteConsent = async (extension, metadata, store = null) => {
    const expected = remoteConsentRecordFor(extension, metadata, cryptoImpl);
    const record = (store ?? await readRemoteConsentStore()).consents[expected.consentDigest];
    if (!record
      || record.installationId !== expected.installationId
      || record.extensionId !== expected.extensionId
      || record.confirmedAt !== expected.confirmedAt) {
      throw new InteractiveUIExtensionManagerError(
        'Remote installation consent no longer matches its accepted identity',
        'remote_consent_integrity_failed',
        409,
      );
    }
    return expected;
  };

  const addRemoteConsent = async (extension, metadata) => {
    const expected = remoteConsentRecordFor(extension, metadata, cryptoImpl);
    const store = await readRemoteConsentStore();
    const existing = store.consents[expected.consentDigest];
    if (existing) {
      if (existing.installationId !== expected.installationId
        || existing.extensionId !== expected.extensionId
        || existing.confirmedAt !== expected.confirmedAt) {
        throw new InteractiveUIExtensionManagerError(
          'Remote consent digest conflicts with another installation',
          'remote_consent_conflict',
          409,
        );
      }
      return { record: expected, added: false };
    }
    store.consents[expected.consentDigest] = expected;
    await writeRemoteConsentStore(store);
    return { record: expected, added: true };
  };

  const removeRemoteConsent = async (expected) => {
    const store = await readRemoteConsentStore();
    const record = store.consents[expected.consentDigest];
    if (!record) return false;
    if (record.installationId !== expected.installationId
      || record.extensionId !== expected.extensionId
      || record.confirmedAt !== expected.confirmedAt) {
      throw new InteractiveUIExtensionManagerError(
        'Remote consent cleanup refused a changed record',
        'remote_consent_cleanup_conflict',
        409,
      );
    }
    delete store.consents[expected.consentDigest];
    await writeRemoteConsentStore(store);
    return true;
  };

  const assertStateRemoteConsents = async (state) => {
    const remoteVersions = [];
    for (const extension of Object.values(state.extensions)) {
      for (const metadata of Object.values(extension.versions)) {
        if (metadata.delivery === 'remote') remoteVersions.push([extension, metadata]);
      }
    }
    if (remoteVersions.length === 0) return;
    const store = await readRemoteConsentStore();
    for (const [extension, metadata] of remoteVersions) {
      await assertRemoteConsent(extension, metadata, store);
    }
  };

  const readState = async () => {
    let content;
    try {
      content = await fsImpl.readFile(statePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState();
      throw corruptState('Extension manager state is unreadable');
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw corruptState('Extension manager state is not valid JSON');
    }
    const state = validateState(parsed, cryptoImpl);
    await assertStateRemoteConsents(state);
    return state;
  };

  const writeState = async (state) => {
    let temporaryPath;
    try {
      await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryPath = `${statePath}.${cryptoImpl.randomUUID()}.tmp`;
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fsImpl.rename(temporaryPath, statePath);
    } catch {
      if (temporaryPath) await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw new InteractiveUIExtensionManagerError('Extension manager state could not be written', 'manager_write_failed', 500);
    }
  };

  const writeVerifiedFiles = async (stagingPath, files) => {
    for (const [relativePath, content] of files) {
      if (!normalizeStoredFilePath(relativePath) || !Buffer.isBuffer(content)) {
        throw new InteractiveUIExtensionManagerError('Verified package contains an invalid file entry', 'invalid_package_path');
      }
      const target = pathImpl.join(stagingPath, ...relativePath.split('/'));
      const relative = pathImpl.relative(stagingPath, target);
      if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
        throw new InteractiveUIExtensionManagerError('Package extraction escaped its staging directory', 'invalid_package_path');
      }
      await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true, mode: 0o700 });
      await fsImpl.writeFile(target, content, { flag: 'wx', mode: 0o600 });
    }
  };

  const fileHashesFromPackageIndex = (packageIndex) => {
    const hashes = Object.create(null);
    for (const file of Array.isArray(packageIndex?.files) ? packageIndex.files : []) {
      if (!normalizeStoredFilePath(file?.path) || typeof file?.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) {
        throw new InteractiveUIExtensionManagerError('Verified package contains an invalid file index', 'invalid_package_index');
      }
      hashes[file.path] = file.sha256;
    }
    if (Object.keys(hashes).length === 0) {
      throw new InteractiveUIExtensionManagerError('Verified package contains no signed files', 'invalid_package_index');
    }
    return hashes;
  };

  const preflightRemoteShellMetadata = async (remote) => {
    if (!validateRemoteMetadata) {
      throw new InteractiveUIExtensionManagerError(
        'Remote extension metadata validation is not configured',
        'remote_metadata_validation_unavailable',
        503,
      );
    }
    let normalized;
    try {
      normalized = await validateRemoteMetadata({
        extension: clone(remote.extension),
        resources: clone(remote.resources),
        permissions: clone(remote.permissions),
      });
    } catch (error) {
      if (error instanceof InteractiveUIExtensionManagerError) throw error;
      throw new InteractiveUIExtensionManagerError(
        'Remote extension metadata is invalid',
        typeof error?.code === 'string' ? error.code : 'invalid_manifest',
        Number.isInteger(error?.status) ? error.status : 400,
      );
    }
    if (!isRecord(normalized)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote extension metadata validator returned an invalid result',
        'remote_metadata_validation_invalid',
        500,
      );
    }
    validateRemoteResourceEntries(remote.extension, remote.resources);
    hostedSurfaceBindings(remote.extension);
    const connector = selectRemoteConnector(remote.extension);
    const connectorId = assertConnectorId(connector.id);
    const origin = normalizeRemoteOrigin(connector.origin);
    const normalizedConnectors = Array.isArray(normalized.connectors) ? normalized.connectors : [];
    if (normalizedConnectors.length !== 1
      || normalizedConnectors[0]?.id !== connectorId
      || normalizedConnectors[0]?.auth?.type !== 'api-key'
      || !remote.permissions.networkOrigins.includes(origin)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app connector does not match its validated metadata and approved permissions',
        'remote_connector_ambiguous',
        409,
      );
    }
    return { id: connectorId, origin, authType: 'api-key' };
  };

  const hostedToolSource = (binding) => {
    const schema = binding.kind === 'view'
      ? 'openchamber://interactive-result/v1'
      : 'openchamber://installed-html-artifact-result/v1';
    const surfaceKey = binding.kind === 'view' ? 'view' : 'artifact';
    const summary = `Open hosted ${binding.title}`;
    return `import { tool } from '@opencode-ai/plugin';

export default tool({
  description: ${JSON.stringify(`Open the installed Remote OCIX surface “${binding.title}”. Use contextJson only for parameters explicitly supplied or inferred from the user. Business API calls remain mediated by OpenChamber.`)},
  args: {
    contextJson: tool.schema.string().optional().describe('Optional JSON object containing the surface parameters'),
  },
  async execute(args) {
    let context = ${JSON.stringify(binding.defaultContext)};
    if (args.contextJson) {
      let parsed;
      try {
        parsed = JSON.parse(args.contextJson);
      } catch {
        throw new Error('contextJson must be valid JSON');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('contextJson must contain a JSON object');
      }
      context = { ...context, ...parsed };
    }
    return JSON.stringify({
      $schema: ${JSON.stringify(schema)},
      schemaVersion: 1,
      ${surfaceKey}: ${JSON.stringify(binding.surfaceId)},
      mode: 'live',
      summary: ${JSON.stringify(summary)},
      context,
      updatedAt: new Date().toISOString(),
    });
  },
});
`;
  };

  const collectInstalledFiles = async (root, current = root, result = []) => {
    const entries = await fsImpl.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = pathImpl.join(current, entry.name);
      const stat = await fsImpl.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new InteractiveUIExtensionManagerError('Installed extension contains a symlink', 'extension_integrity_failed', 409);
      }
      if (stat.isDirectory()) {
        await collectInstalledFiles(root, absolute, result);
        continue;
      }
      if (!stat.isFile()) {
        throw new InteractiveUIExtensionManagerError(
          'Installed extension contains an unsupported filesystem entry',
          'extension_integrity_failed',
          409,
        );
      }
      result.push(pathImpl.relative(root, absolute).split(pathImpl.sep).join('/'));
    }
    return result;
  };

  const buildExpectedRemoteShell = (remote) => {
    const bindings = hostedSurfaceBindings(remote.extension);
    const files = Object.create(null);
    files[HOSTED_OCIX_SIGNED_MANIFEST_FILE] = Buffer.from(canonicalStringify(remote.signedDocument));
    files['openchamber.extension.json'] = Buffer.from(`${JSON.stringify(remote.extension, null, 2)}\n`);
    for (const binding of bindings) {
      files[`agent-runtime/tools/${binding.name}.ts`] = Buffer.from(hostedToolSource(binding));
    }
    const fileHashes = Object.create(null);
    for (const relativePath of Object.keys(files).sort(compareCodePoints)) {
      fileHashes[relativePath] = packageHash(cryptoImpl, files[relativePath]);
    }
    return {
      files,
      fileHashes,
      agentRuntime: {
        tools: bindings.map(({ name }) => ({ name, entry: `agent-runtime/tools/${name}.ts` })),
        skills: [],
        unresolvedSurfaceTools: [],
        unresolvedViewTools: [],
      },
    };
  };

  const writeExpectedRemoteShell = async (root, expected) => {
    try {
      const rootStat = await fsImpl.lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new InteractiveUIExtensionManagerError(
          'Remote OCIX shell root is not a trusted directory',
          'hosted_agent_runtime_conflict',
          409,
        );
      }
      for (const relativePath of Object.keys(expected.files).sort(compareCodePoints)) {
        const normalized = safeRelativePath(relativePath, 'Remote shell file');
        const segments = normalized.split('/');
        let parent = root;
        for (const segment of segments.slice(0, -1)) {
          parent = pathImpl.join(parent, segment);
          try {
            await fsImpl.mkdir(parent, { mode: 0o700 });
          } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
          }
          const parentStat = await fsImpl.lstat(parent);
          if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
            throw new InteractiveUIExtensionManagerError(
              'Remote OCIX shell contains an aliased directory',
              'hosted_agent_runtime_conflict',
              409,
            );
          }
        }
        const target = pathImpl.join(parent, segments.at(-1));
        await fsImpl.writeFile(target, expected.files[relativePath], { flag: 'wx', mode: 0o600 });
        const targetStat = await fsImpl.lstat(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
          throw new InteractiveUIExtensionManagerError(
            'Remote OCIX shell contains an unsupported file entry',
            'hosted_agent_runtime_conflict',
            409,
          );
        }
      }
    } catch (error) {
      if (['EEXIST', 'EISDIR', 'ENOTDIR'].includes(error?.code)) {
        throw new InteractiveUIExtensionManagerError(
          'Remote OCIX shell conflicts with a host-managed path',
          'hosted_agent_runtime_conflict',
          409,
        );
      }
      throw error;
    }
  };

  const hashMapsEqual = (left, right) => {
    const leftPaths = Object.keys(left ?? {}).sort(compareCodePoints);
    const rightPaths = Object.keys(right ?? {}).sort(compareCodePoints);
    return leftPaths.length === rightPaths.length
      && leftPaths.every((relativePath, index) => (
        relativePath === rightPaths[index] && left[relativePath] === right[relativePath]
      ));
  };

  const fileHashesForDirectory = async (root) => {
    const hashes = Object.create(null);
    for (const relativePath of (await collectInstalledFiles(root)).sort(compareCodePoints)) {
      hashes[relativePath] = packageHash(
        cryptoImpl,
        await fsImpl.readFile(pathImpl.join(root, ...relativePath.split('/'))),
      );
    }
    if (Object.keys(hashes).length === 0) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell contains no managed files',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return hashes;
  };

  const verifyInstalledVersionIntegrity = async (extension, metadata) => {
    const versionDirectory = pathImpl.join(versionsDirectory, extension.id, metadata.version);
    const expectedPaths = Object.keys(metadata.fileHashes ?? {}).sort(compareCodePoints);
    if (expectedPaths.length === 0) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no signed file integrity record; reinstall the extension`,
        'extension_integrity_unavailable',
        409,
      );
    }
    let actualPaths;
    try {
      actualPaths = (await collectInstalledFiles(versionDirectory)).sort(compareCodePoints);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new InteractiveUIExtensionManagerError(
          `${extension.id}@${metadata.version} is missing from the managed version store`,
          'extension_integrity_failed',
          409,
        );
      }
      throw error;
    }
    if (expectedPaths.length !== actualPaths.length || expectedPaths.some((filePath, index) => filePath !== actualPaths[index])) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has been modified since installation`,
        'extension_integrity_failed',
        409,
      );
    }
    for (const relativePath of expectedPaths) {
      const target = pathImpl.join(versionDirectory, ...relativePath.split('/'));
      const relative = pathImpl.relative(versionDirectory, target);
      if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
        throw new InteractiveUIExtensionManagerError('Installed extension integrity path is invalid', 'extension_integrity_failed', 409);
      }
      let content;
      try {
        content = await fsImpl.readFile(target);
      } catch {
        throw new InteractiveUIExtensionManagerError(
          `${extension.id}@${metadata.version} has been modified since installation`,
          'extension_integrity_failed',
          409,
        );
      }
      if (packageHash(cryptoImpl, content) !== metadata.fileHashes[relativePath]) {
        throw new InteractiveUIExtensionManagerError(
          `${extension.id}@${metadata.version} has been modified since installation`,
          'extension_integrity_failed',
          409,
        );
      }
    }
    return versionDirectory;
  };

  const verifyRemoteShellSnapshot = async (extension, metadata, extensionRoot) => {
    if (!isRecord(metadata) || metadata.delivery !== 'remote' || !isRecord(metadata.remote)) {
      throw new InteractiveUIExtensionManagerError(
        'Extension is not a managed Remote shell',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const versionDirectory = pathImpl.join(extensionRoot, metadata.version);
    try {
      const [extensionStat, versionStat, rootEntries] = await Promise.all([
        fsImpl.lstat(extensionRoot),
        fsImpl.lstat(versionDirectory),
        fsImpl.readdir(extensionRoot, { withFileTypes: true }),
      ]);
      if (!extensionStat.isDirectory() || extensionStat.isSymbolicLink()
        || !versionStat.isDirectory() || versionStat.isSymbolicLink()
        || rootEntries.length !== 1
        || rootEntries[0].name !== metadata.version
        || !rootEntries[0].isDirectory()) {
        throw new Error('invalid Remote shell root');
      }
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell root is missing, aliased, or contains unmanaged versions',
        'remote_shell_integrity_failed',
        409,
      );
    }
    let actualHashes;
    try {
      actualHashes = await fileHashesForDirectory(versionDirectory);
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell file index cannot be verified',
        'remote_shell_integrity_failed',
        409,
      );
    }
    let signedDocument;
    try {
      signedDocument = JSON.parse(await fsImpl.readFile(
        pathImpl.join(versionDirectory, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
        'utf8',
      ));
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell signed manifest is missing or invalid',
        'remote_shell_integrity_failed',
        409,
      );
    }
    let remote;
    try {
      remote = verifyRemoteOcixManifest({ document: signedDocument, cryptoImpl });
      remote.connector = await preflightRemoteShellMetadata(remote);
    } catch (error) {
      if (error?.code === 'remote_metadata_validation_unavailable') throw error;
      throw new InteractiveUIExtensionManagerError(
        'Remote shell signed manifest no longer satisfies its accepted contract',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const expectedShell = buildExpectedRemoteShell(remote);
    if (!hashMapsEqual(actualHashes, expectedShell.fileHashes)
      || !hashMapsEqual(metadata.fileHashes, expectedShell.fileHashes)
      || canonicalStringify(metadata.agentRuntime) !== canonicalStringify(expectedShell.agentRuntime)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell files or Agent Runtime differ from the signed deterministic shell',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const accepted = metadata.remote.acceptedManifest;
    const connector = metadata.remote.connectorRefs?.[0];
    if (remote.extensionId !== extension.id
      || (remote.extension?.name ?? remote.extensionId) !== extension.name
      || remote.version !== metadata.version
      || remote.manifestHash !== metadata.packageHash
      || remote.manifestHash !== accepted?.manifestHash
      || remote.publishedAt !== accepted?.publishedAt
      || remote.publisher.id !== metadata.publisher.id
      || remote.publisher.name !== metadata.publisher.name
      || remote.publisher.keyId !== metadata.publisher.keyId
      || remote.publisher.keyId !== accepted?.keyId
      || remote.publisher.fingerprint !== metadata.publisher.fingerprint
      || remote.publisher.publicKey !== metadata.remote.publisherPublicKey
      || remote.connector.id !== connector?.id
      || remote.connector.origin !== connector?.origin
      || remote.connector.authType !== connector?.authType
      || canonicalStringify(remote.permissions) !== canonicalStringify(metadata.remote.approvedPermissions)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell does not match its accepted signed identity and consent',
        'remote_shell_integrity_failed',
        409,
      );
    }
    await assertRemoteConsent(extension, metadata);
    return versionDirectory;
  };

  const verifyRemoteShellRoot = async (extension, metadata) => {
    let versionsStat;
    try {
      versionsStat = await fsImpl.lstat(versionsDirectory);
    } catch {
      versionsStat = null;
    }
    if (!versionsStat?.isDirectory() || versionsStat.isSymbolicLink()) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell versions root is missing or aliased',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return verifyRemoteShellSnapshot(
      extension,
      metadata,
      pathImpl.join(versionsDirectory, extension.id),
    );
  };

  // A state-less Remote shell can exist after a fail-closed transaction or a
  // deliberate rollback. A later, freshly confirmed connect may adopt it only
  // when every byte is exactly the deterministic shell derived from the
  // current signed manifest. No path is moved, overwritten, or deleted.
  const verifyReusableRemoteShell = async (remote, expected, extensionRoot) => {
    const versionDirectory = pathImpl.join(extensionRoot, remote.version);
    try {
      const [rootStat, versionStat, entries] = await Promise.all([
        fsImpl.lstat(extensionRoot),
        fsImpl.lstat(versionDirectory),
        fsImpl.readdir(extensionRoot, { withFileTypes: true }),
      ]);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
        || !versionStat.isDirectory() || versionStat.isSymbolicLink()
        || entries.length !== 1
        || entries[0].name !== remote.version
        || !entries[0].isDirectory()) {
        throw new Error('invalid reusable Remote shell root');
      }
      if (!hashMapsEqual(await fileHashesForDirectory(versionDirectory), expected.fileHashes)) {
        throw new Error('reusable Remote shell bytes differ');
      }
      return versionDirectory;
    } catch {
      throw new InteractiveUIExtensionManagerError(
        `${remote.extensionId} has files outside the exact confirmed Remote shell`,
        'unmanaged_version_conflict',
        409,
      );
    }
  };

  const prepareActivation = async (previousState, nextState) => {
    if (!reconcileActivation) {
      throw new InteractiveUIExtensionManagerError(
        'Extension activation reconciliation is not configured',
        'extension_activation_unavailable',
        503,
      );
    }
    const deployment = await reconcileActivation({
      previousState: clone(previousState),
      nextState: clone(nextState),
      versionsDirectory,
    });
    if (!isRecord(deployment) || typeof deployment.rollback !== 'function') {
      throw new InteractiveUIExtensionManagerError(
        'Extension activation reconciler returned an invalid transaction',
        'extension_activation_contract_invalid',
        500,
      );
    }
    return {
      openCode: {
        changed: deployment.openCode?.changed === true,
        reloaded: deployment.openCode?.reloaded === true,
        external: deployment.openCode?.external === true,
      },
      rollback: deployment.rollback,
    };
  };

  const commitStateWithActivation = async (previousState, nextState) => {
    const deployment = await prepareActivation(previousState, nextState);
    try {
      await writeState(nextState);
    } catch (stateError) {
      try {
        await deployment.rollback();
      } catch {
        throw new InteractiveUIExtensionManagerError(
          'Extension activation could not be rolled back after state commit failed',
          'extension_activation_rollback_failed',
          500,
        );
      }
      throw stateError;
    }
    return deployment.openCode;
  };

  // Own-slot trust resolution. Publishers and key maps are null-prototype
  // objects, so a regex-valid key id such as toString/hasOwnProperty/valueOf
  // is found ONLY when an own durable record exists; an inherited
  // Object.prototype member is never a trusted slot. Primitive/bounded
  // validation runs BEFORE the lookup, so a non-string or over-bound id can
  // never coerce into a trusted string slot.
  const resolveTrustedKey = async (publisherId, keyId) => {
    if (typeof publisherId !== 'string' || !publisherId || publisherId.length > MAX_ID_CODE_UNITS || !ID_PATTERN.test(publisherId)) {
      return null;
    }
    if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId) || BLOCKED_KEY_IDS.has(keyId)) {
      return null;
    }
    const store = await readTrustStore();
    const publisher = store.publishers[publisherId];
    if (!publisher) return null;
    const trustedSlot = publisher.keys[keyId] ?? null;
    // Marketplace-delegated keys, if present in an older durable store, are
    // never global Local-package authority. Marketplace installs verify the
    // exact signed catalog entry in their own request-bound transaction.
    if (trustedSlot?.source?.startsWith(MARKETPLACE_SOURCE_PREFIX)) return null;
    return trustedSlot;
  };

  const verifyTrustedPackage = async (buffer) => {
    try {
      return await verifyExtensionPackage({
        buffer,
        cryptoImpl,
        resolveTrustedPublisherKey: async (publisherId, keyId) => {
          const trustedSlot = await resolveTrustedKey(publisherId, keyId);
          return trustedSlot?.publicKey ?? null;
        },
      });
    } catch (error) {
      if (error instanceof InteractiveUIPackageError) {
        throw new InteractiveUIExtensionManagerError(error.message, error.code, error.status, error.details);
      }
      throw error;
    }
  };

  const trustPublisher = (input) => mutate(async () => {
    const options = isRecord(input) ? input : {};
    const publisherId = assertNamespacedId(options.id, 'Publisher id');
    const normalizedKeyId = assertKeyId(options.keyId);
    const normalizedName = assertDisplayName(options.name, 'Publisher name');
    const source = assertSource(options.source === undefined ? MANUAL_SOURCE : options.source);
    let normalizedKey;
    try {
      normalizedKey = normalizeEd25519PublicKey(options.publicKey, cryptoImpl);
    } catch (error) {
      if (error instanceof InteractiveUIPackageError) {
        throw new InteractiveUIExtensionManagerError(error.message, error.code, error.status, error.details);
      }
      throw error;
    }
    const fingerprint = publicKeyFingerprint(normalizedKey, cryptoImpl);
    const store = await readTrustStore();
    const existing = store.publishers[publisherId]?.keys?.[normalizedKeyId];
    if (existing && existing.fingerprint !== fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        `Publisher key ${publisherId}/${normalizedKeyId} already exists with a different fingerprint`,
        'publisher_key_conflict',
        409,
      );
    }
    if (!existing) {
      const publisher = store.publishers[publisherId] ?? { id: publisherId, name: normalizedName, keys: Object.create(null) };
      publisher.name = normalizedName;
      publisher.keys[normalizedKeyId] = {
        keyId: normalizedKeyId,
        publicKey: normalizedKey,
        fingerprint,
        source,
        trustedAt: new Date().toISOString(),
      };
      store.publishers[publisherId] = publisher;
      await writeTrustStore(store);
    }
    return { publisherId, keyId: normalizedKeyId, fingerprint, added: !existing };
  });

  const removeTrustedPublisherKey = (publisherId, keyId) => mutate(async () => {
    const normalizedPublisherId = assertNamespacedId(publisherId, 'Publisher id');
    const normalizedKeyId = assertKeyId(keyId);
    const store = await readTrustStore();
    const publisher = store.publishers[normalizedPublisherId];
    const key = publisher?.keys?.[normalizedKeyId];
    if (!key) {
      // Only an OWN exact slot exists; an inherited Object.prototype member is
      // never present and never removable.
      throw new InteractiveUIExtensionManagerError('Publisher key was not found', 'publisher_key_not_found', 404);
    }
    delete publisher.keys[normalizedKeyId];
    if (Object.keys(publisher.keys).length === 0) delete store.publishers[normalizedPublisherId];
    await writeTrustStore(store);
    return { removed: true };
  });

  const installVerifiedPackage = async (verified, { source: sourceValue = { type: 'file' } } = {}) => {
    const source = assertInstallSource(sourceValue);
    if (verified.manifest.delivery !== undefined) {
      throw new InteractiveUIExtensionManagerError(
        'Only Local OCIX packages are supported by this lifecycle',
        'unsupported_delivery',
        409,
      );
    }
    const id = assertNamespacedId(verified.manifest.id, 'Extension id');
    const name = assertDisplayName(verified.manifest.name, 'Extension name');
    const version = verified.manifest.version;
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      throw new InteractiveUIExtensionManagerError('Extension version is invalid', 'invalid_version');
    }
    const publisherId = assertNamespacedId(verified.packageIndex.publisher?.id, 'Publisher id');
    const publisherName = assertDisplayName(verified.packageIndex.publisher?.name, 'Publisher name');
    const publisherKeyId = assertKeyId(verified.packageIndex.publisher?.keyId);
    const previousState = await readState();
    const existingExtension = previousState.extensions[id];
    if (existingExtension
      && Object.values(existingExtension.versions).some((metadata) => metadata.delivery !== 'local')) {
      throw new InteractiveUIExtensionManagerError(
        'Local and Remote versions cannot share one extension lifecycle',
        'extension_delivery_conflict',
        409,
      );
    }
    const existingVersion = previousState.extensions[id]?.versions?.[version];
    if (existingVersion) {
      if (existingVersion.packageHash !== verified.packageHash) {
        throw new InteractiveUIExtensionManagerError(
          `${id}@${version} is already installed from different package content`,
          'version_conflict',
          409,
        );
      }
      await verifyInstalledVersionIntegrity(previousState.extensions[id], existingVersion);
      return {
        extension: sanitizeExtension(previousState.extensions[id]),
        installed: false,
        openCode: { changed: false, reloaded: false, external: false },
      };
    }

    const stagingPath = pathImpl.join(stagingDirectory, cryptoImpl.randomUUID());
    const destination = pathImpl.join(versionsDirectory, id, version);
    let moved = false;
    try {
      await fsImpl.mkdir(stagingPath, { recursive: true, mode: 0o700 });
      await writeVerifiedFiles(stagingPath, verified.files);
      if (!validateStagedPackage) {
        throw new InteractiveUIExtensionManagerError(
          'Staged extension validation is not configured',
          'extension_validation_unavailable',
          503,
        );
      }
      try {
        await validateStagedPackage({ directory: stagingPath, verified });
      } catch (error) {
        if (error instanceof InteractiveUIExtensionManagerError) throw error;
        throw new InteractiveUIExtensionManagerError(
          'Staged extension validation failed',
          'extension_validation_failed',
          400,
        );
      }
      await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true, mode: 0o700 });
      try {
        await fsImpl.lstat(destination);
        throw new InteractiveUIExtensionManagerError(
          `${id}@${version} already exists outside manager state`,
          'unmanaged_version_conflict',
          409,
        );
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await fsImpl.rename(stagingPath, destination);
      moved = true;

      const nextState = clone(previousState);
      const previousExtension = nextState.extensions[id];
      const nextExtension = previousExtension ?? {
        id,
        name,
        enabled: true,
        activeVersion: version,
        activationHistory: [],
        versions: {},
      };
      if (previousExtension?.activeVersion && previousExtension.activeVersion !== version) {
        nextExtension.activationHistory = nextExtension.activationHistory.filter(
          (candidate) => candidate !== previousExtension.activeVersion,
        );
        nextExtension.activationHistory.push(previousExtension.activeVersion);
      }
      nextExtension.name = name;
      nextExtension.activeVersion = version;
      nextExtension.versions[version] = {
        version,
        packageHash: verified.packageHash,
        installedAt: new Date().toISOString(),
        generationId: cryptoImpl.randomUUID(),
        source,
        publisher: {
          id: publisherId,
          name: publisherName,
          keyId: publisherKeyId,
          fingerprint: verified.publisherFingerprint,
        },
        delivery: 'local',
        agentRuntime: clone(verified.agentRuntime),
        fileHashes: fileHashesFromPackageIndex(verified.packageIndex),
      };
      nextState.extensions[id] = nextExtension;
      const openCode = await commitStateWithActivation(previousState, nextState);
      return { extension: sanitizeExtension(nextExtension), installed: true, openCode };
    } catch (error) {
      if (moved) {
        await fsImpl.rm(destination, { recursive: true, force: true }).catch(() => {});
        // A failed first install must not leave an empty extension-id root.
        // On an update this rmdir safely fails because accepted versions are
        // still present and must remain untouched.
        await fsImpl.rmdir(pathImpl.dirname(destination)).catch(() => {});
      }
      await fsImpl.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };

  const installPackageInternal = async (buffer) => {
    const verified = await verifyTrustedPackage(buffer);
    return installVerifiedPackage(verified);
  };

  const installPackage = (buffer) => mutate(() => installPackageInternal(buffer));

  const installRemoteShell = async ({
    remote,
    appEntryUrl,
    connector,
    installationId,
    previousState,
  }) => {
    const id = assertNamespacedId(remote.extensionId, 'Extension id');
    const name = assertDisplayName(remote.extension?.name ?? remote.extensionId, 'Extension name');
    const version = remote.version;
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      throw new InteractiveUIExtensionManagerError('Remote extension version is invalid', 'invalid_version');
    }
    const expectedShell = buildExpectedRemoteShell(remote);
    await ensureManagedDirectory(dataRoot, 'Manager data root');
    await ensureManagedDirectory(directory, 'Interactive UI Manager directory');
    await ensureManagedDirectory(versionsDirectory, 'Interactive UI versions directory');
    const extensionRoot = pathImpl.join(versionsDirectory, id);
    const destination = pathImpl.join(versionsDirectory, id, version);
    let reusableShell = false;
    try {
      await fsImpl.lstat(extensionRoot);
      await verifyReusableRemoteShell(remote, expectedShell, extensionRoot);
      reusableShell = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const installedAt = new Date().toISOString();
    const nextExtension = {
      id,
      name,
      enabled: true,
      activeVersion: version,
      activationHistory: [],
      versions: Object.create(null),
    };
    nextExtension.versions[version] = {
      version,
      packageHash: remote.manifestHash,
      installedAt,
      generationId: cryptoImpl.randomUUID(),
      source: { type: 'remote', appEntryUrl },
      publisher: {
        id: remote.publisher.id,
        name: remote.publisher.name,
        keyId: remote.publisher.keyId,
        fingerprint: remote.publisher.fingerprint,
      },
      delivery: 'remote',
      agentRuntime: clone(expectedShell.agentRuntime),
      fileHashes: clone(expectedShell.fileHashes),
      remote: {
        appEntryUrl,
        installationId,
        // Installation-scoped consent. This key is private Manager state,
        // never global Local-package authority and never part of public
        // snapshots.
        publisherPublicKey: remote.publisher.publicKey,
        connectorRefs: [clone(connector)],
        acceptedManifest: {
          version,
          manifestHash: remote.manifestHash,
          publishedAt: remote.publishedAt,
          keyId: remote.publisher.keyId,
          fetchedAt: installedAt,
        },
        approvedPermissions: clone(remote.permissions),
        status: 'active',
        connectedAt: installedAt,
        lastConsentAt: installedAt,
      },
    };
    let consentTransaction = null;
    try {
      consentTransaction = await addRemoteConsent(nextExtension, nextExtension.versions[version]);
      if (!reusableShell) {
        try {
          await fsImpl.mkdir(extensionRoot, { mode: 0o700 });
          await fsImpl.mkdir(destination, { mode: 0o700 });
        } catch (error) {
          if (error?.code === 'EEXIST') {
            throw new InteractiveUIExtensionManagerError(
              `${id} already has files outside Manager state`,
              'unmanaged_version_conflict',
              409,
            );
          }
          throw error;
        }
        await writeExpectedRemoteShell(destination, expectedShell);
        if (!hashMapsEqual(await fileHashesForDirectory(destination), expectedShell.fileHashes)) {
          throw new InteractiveUIExtensionManagerError(
            'Remote shell bytes differ from the deterministic signed shell',
            'remote_shell_integrity_failed',
            409,
          );
        }
      }

      const nextState = clone(previousState);
      nextState.extensions[id] = nextExtension;
      // Re-read and reverify the exact published or adopted shell before it can reach the
      // activation adapter or durable state.
      await verifyRemoteShellRoot(nextExtension, nextExtension.versions[version]);
      const openCode = await commitStateWithActivation(previousState, nextState);
      return { extension: sanitizeExtension(nextExtension), installed: true, openCode };
    } catch (error) {
      let cleanupError = null;
      if (consentTransaction?.added) {
        try {
          await removeRemoteConsent(consentTransaction.record);
        } catch (candidate) {
          cleanupError ??= candidate;
        }
      }
      if (cleanupError) throw cleanupError;
      throw error;
    }
  };

  const inspectRemoteInternal = async (appEntryUrlValue) => {
    if (!validateRemoteMetadata) {
      throw new InteractiveUIExtensionManagerError(
        'Remote extension metadata validation is not configured',
        'remote_metadata_validation_unavailable',
        503,
      );
    }
    const appEntryUrl = normalizeRemoteUrl(appEntryUrlValue, 'Remote app entry URL');
    const remote = await fetchRemoteOcixManifest({ appEntryUrl, fetchImpl, cryptoImpl });
    const connector = await preflightRemoteShellMetadata(remote);
    const trust = await readTrustStore();
    return {
      remote: { ...remote, appEntryUrl, connector },
      review: summarizeRemoteReview(
        { ...remote, appEntryUrl, connector },
        remotePublisherTrusted(trust, remote.publisher, cryptoImpl),
      ),
      trust,
    };
  };

  // Inspection is queued with trust/state reads so it cannot observe a
  // half-published Local/Marketplace/Remote Manager mutation. It performs one
  // signed-manifest fetch and no resource, shell, trust, state, or credential
  // write.
  const inspectRemote = (appEntryUrlValue) => mutate(async () => (
    (await inspectRemoteInternal(appEntryUrlValue)).review
  ));

  let rollbackRemoteConnect;

  const withCurrentRemoteInstallation = (extensionId, connectorId, installationId, operation) => mutate(async () => {
    const state = await readState();
    const extension = state.extensions[extensionId];
    const metadata = extension?.versions?.[extension?.activeVersion];
    const connector = metadata?.remote?.connectorRefs?.[0];
    if (!extension
      || metadata?.delivery !== 'remote'
      || metadata.remote?.installationId !== installationId
      || connector?.id !== connectorId) {
      throw new InteractiveUIExtensionManagerError(
        'Remote installation changed before the credential operation completed',
        'remote_installation_changed',
        409,
      );
    }
    await verifyRemoteShellRoot(extension, metadata);
    return operation();
  });

  const connectRemote = (input, credentialRuntime = null) => mutate(async () => {
    const inspected = await inspectRemoteInternal(input?.appEntryUrl);
    const { remote, review, trust } = inspected;
    const previousState = await readState();
    if (previousState.extensions[remote.extensionId]) {
      throw new InteractiveUIExtensionManagerError(
        `Remote app ${remote.extensionId} is already installed`,
        'remote_extension_installed',
        409,
      );
    }
    const publisherRecord = ownSlot(trust.publishers, remote.publisher.id);
    const existingSlot = ownSlot(publisherRecord?.keys, remote.publisher.keyId);
    if (existingSlot && existingSlot.fingerprint !== remote.publisher.fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        `Publisher key ${remote.publisher.id}/${remote.publisher.keyId} conflicts with the confirmed Remote key`,
        'publisher_key_conflict',
        409,
      );
    }
    if (input?.confirmedPublisherFingerprint !== remote.publisher.fingerprint
      || input?.confirmedManifestHash !== remote.manifestHash) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher fingerprint and manifest hash must be confirmed before connecting',
        'remote_confirmation_required',
        403,
        review,
      );
    }
    const installationId = cryptoImpl.randomUUID();
    const installed = await installRemoteShell({
      remote,
      appEntryUrl: remote.appEntryUrl,
      connector: remote.connector,
      installationId,
      previousState,
    });
    const connected = {
      extension: {
        id: installed.extension.id,
        name: installed.extension.name,
        version: installed.extension.activeVersion,
      },
      connector: clone(remote.connector),
    };
    Object.defineProperty(connected, 'capability', {
      value: Object.freeze({
        configureCredential: async (accessKey) => withCurrentRemoteInstallation(
          installed.extension.id,
          remote.connector.id,
          installationId,
          async () => {
          if (!credentialRuntime || typeof credentialRuntime.configureRemoteConnection !== 'function') {
            throw new InteractiveUIExtensionManagerError(
              'Remote credential runtime is unavailable',
              'remote_credential_runtime_unavailable',
              409,
            );
          }
          return credentialRuntime.configureRemoteConnection(
            installed.extension.id,
            remote.connector.id,
            installationId,
            accessKey,
          );
          },
        ),
        removeCredential: async () => withCurrentRemoteInstallation(
          installed.extension.id,
          remote.connector.id,
          installationId,
          async () => {
          if (!credentialRuntime || typeof credentialRuntime.removeRemoteConnection !== 'function') {
            throw new InteractiveUIExtensionManagerError(
              'Remote credential runtime is unavailable',
              'remote_credential_runtime_unavailable',
              409,
            );
          }
          return credentialRuntime.removeRemoteConnection(
            installed.extension.id,
            remote.connector.id,
            installationId,
          );
          },
        ),
        rollback: async () => rollbackRemoteConnect(installed.extension.id, { installationId }),
      }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return connected;
  });

  rollbackRemoteConnect = (extensionId, { installationId } = {}) => mutate(async () => {
    const id = assertNamespacedId(extensionId, 'Extension id');
    if (typeof installationId !== 'string' || !INSTALLATION_ID_PATTERN.test(installationId)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote rollback requires its installation identity',
        'remote_rollback_installation_changed',
        409,
      );
    }
    const previousState = await readState();
    const extension = previousState.extensions[id];
    if (!extension) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    const metadata = extension.versions?.[extension.activeVersion];
    if (!metadata || metadata.delivery !== 'remote') {
      throw new InteractiveUIExtensionManagerError(
        'Extension was not installed by Remote connect',
        'remote_rollback_unavailable',
        409,
      );
    }
    if (metadata.remote?.installationId !== installationId) {
      throw new InteractiveUIExtensionManagerError(
        'Remote installation changed since this connect; rollback refused',
        'remote_rollback_installation_changed',
        409,
      );
    }
    await verifyRemoteShellRoot(extension, metadata);
    const nextState = clone(previousState);
    delete nextState.extensions[id];
    const openCode = await commitStateWithActivation(previousState, nextState);
    try {
      await removeRemoteConsent(remoteConsentRecordFor(extension, metadata, cryptoImpl));
    } catch {
      // State no longer references this installation. A retained consent
      // anchor grants nothing and is safer than reporting a false rollback.
    }
    return {
      removed: true,
      trustRolledBack: false,
      // The exact shell stays in the versions store as a non-active reusable
      // orphan. This avoids every rename/delete restoration race.
      cleanupPending: true,
      openCode,
    };
  });

  const setEnabled = (extensionId, enabled) => mutate(async () => {
    const id = assertNamespacedId(extensionId, 'Extension id');
    if (typeof enabled !== 'boolean') {
      throw new InteractiveUIExtensionManagerError('Enabled must be a boolean', 'invalid_enabled');
    }
    const previousState = await readState();
    const previousExtension = previousState.extensions[id];
    if (!previousExtension) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    if (previousExtension.enabled === enabled) {
      return {
        ...sanitizeExtension(previousExtension),
        openCode: { changed: false, reloaded: false, external: false },
      };
    }
    if (enabled) {
      const metadata = previousExtension.versions[previousExtension.activeVersion];
      if (metadata.delivery === 'remote') await verifyRemoteShellRoot(previousExtension, metadata);
      else await verifyInstalledVersionIntegrity(previousExtension, metadata);
    }
    const nextState = clone(previousState);
    nextState.extensions[id].enabled = enabled;
    const openCode = await commitStateWithActivation(previousState, nextState);
    return { ...sanitizeExtension(nextState.extensions[id]), openCode };
  });

  const rollback = (extensionId) => mutate(async () => {
    const id = assertNamespacedId(extensionId, 'Extension id');
    const previousState = await readState();
    const previousExtension = previousState.extensions[id];
    if (!previousExtension) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    const nextState = clone(previousState);
    const nextExtension = nextState.extensions[id];
    let targetVersion = null;
    while (nextExtension.activationHistory.length && !targetVersion) {
      const candidate = nextExtension.activationHistory.pop();
      if (candidate !== nextExtension.activeVersion && nextExtension.versions[candidate]) targetVersion = candidate;
    }
    if (!targetVersion) {
      throw new InteractiveUIExtensionManagerError(
        'No previously active version is available',
        'rollback_unavailable',
        409,
      );
    }
    const targetMetadata = nextExtension.versions[targetVersion];
    if (targetMetadata.delivery === 'remote') {
      await verifyRemoteShellRoot(nextExtension, targetMetadata);
    } else {
      await verifyInstalledVersionIntegrity(nextExtension, targetMetadata);
    }
    const currentVersion = nextExtension.activeVersion;
    nextExtension.activeVersion = targetVersion;
    nextExtension.activationHistory = nextExtension.activationHistory.filter((candidate) => candidate !== currentVersion);
    nextExtension.activationHistory.push(currentVersion);
    const openCode = await commitStateWithActivation(previousState, nextState);
    return { ...sanitizeExtension(nextExtension), openCode };
  });

  const uninstall = (extensionId) => mutate(async () => {
    const id = assertNamespacedId(extensionId, 'Extension id');
    const previousState = await readState();
    const previousExtension = previousState.extensions[id];
    if (!previousExtension) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    const remoteConsents = Object.values(previousExtension.versions)
      .filter((metadata) => metadata.delivery === 'remote')
      .map((metadata) => remoteConsentRecordFor(previousExtension, metadata, cryptoImpl));
    const remoteLifecycle = remoteConsents.length > 0;
    const source = pathImpl.join(versionsDirectory, id);
    const trashPath = pathImpl.join(trashDirectory, `${id}-${cryptoImpl.randomUUID()}`);
    let moved = false;
    if (!remoteLifecycle) {
      await fsImpl.mkdir(trashDirectory, { recursive: true, mode: 0o700 });
      try {
        await fsImpl.rename(source, trashPath);
        moved = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const nextState = clone(previousState);
    delete nextState.extensions[id];
    try {
      const openCode = await commitStateWithActivation(previousState, nextState);
      let cleanupPending = remoteLifecycle;
      for (const consent of remoteConsents) {
        try {
          await removeRemoteConsent(consent);
        } catch {
          cleanupPending = true;
        }
      }
      return {
        removed: true,
        recoveryId: moved ? pathImpl.basename(trashPath) : null,
        cleanupPending,
        openCode,
      };
    } catch (error) {
      if (moved) {
        try {
          await fsImpl.rename(trashPath, source);
        } catch {
          throw new InteractiveUIExtensionManagerError(
            'Extension files could not be restored after uninstall failed',
            'extension_uninstall_restore_failed',
            500,
          );
        }
      }
      throw error;
    }
  });

  // Internal runtime authority only. Unlike public list/install/lifecycle
  // results, this deliberately carries managed paths and must never be
  // serialized through an HTTP response.
  const getEnabledExtensionRoots = () => mutate(async () => {
    const state = await readState();
    const roots = [];
    for (const extensionId of Object.keys(state.extensions).sort(compareCodePoints)) {
      const extension = state.extensions[extensionId];
      if (!extension.enabled) continue;
      const metadata = extension.versions[extension.activeVersion];
      try {
        const versionDirectory = metadata.delivery === 'remote'
          ? await verifyRemoteShellRoot(extension, metadata)
          : await verifyInstalledVersionIntegrity(extension, metadata);
        roots.push({ directory: versionDirectory, provenance: { generation: metadata.generationId } });
      } catch (error) {
        if (![
          'extension_integrity_failed',
          'extension_integrity_unavailable',
          'remote_shell_integrity_failed',
        ].includes(error?.code)) throw error;
        const quarantineKey = `${extension.id}@${extension.activeVersion}:${error.code}`;
        if (!reportedQuarantines.has(quarantineKey)) {
          reportedQuarantines.add(quarantineKey);
          logger?.warn?.(`[InteractiveUI] Quarantined ${extension.id}@${extension.activeVersion}: ${error.code}`);
        }
      }
    }
    return roots;
  });

  const downloadAndVerifyCatalog = async (catalogUrl, publicKey) => {
    const deadline = createRemoteDeadline(fetchTimeoutMs, 'Marketplace catalog request');
    let bytes;
    try {
      let response;
      try {
        response = await deadline.run(fetchImpl(catalogUrl, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: deadline.signal,
        }));
      } catch (error) {
        if (error instanceof InteractiveUIExtensionManagerError) throw error;
        throw new InteractiveUIExtensionManagerError('Marketplace catalog request failed', 'marketplace_unavailable', 502);
      }
      assertUnredirectedResponse(response, catalogUrl, 'Marketplace catalog');
      if (!response?.ok) {
        discardResponseBody(response);
        throw new InteractiveUIExtensionManagerError(
          `Marketplace catalog request failed (${Number.isInteger(response?.status) ? response.status : 'invalid response'})`,
          'marketplace_unavailable',
          502,
        );
      }
      bytes = await responseBytes(response, MAX_CATALOG_BYTES, 'Marketplace catalog', deadline);
    } catch (error) {
      if (error instanceof InteractiveUIExtensionManagerError) throw error;
      throw new InteractiveUIExtensionManagerError('Marketplace catalog request failed', 'marketplace_unavailable', 502);
    } finally {
      deadline.close();
    }
    let catalog;
    try {
      catalog = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new InteractiveUIExtensionManagerError('Marketplace catalog is not valid JSON', 'invalid_catalog', 502);
    }
    try {
      const verified = verifySignedExtensionCatalog({ catalog, publicKey, cryptoImpl });
      return { catalog: normalizeVerifiedCatalog(catalog, verified, cryptoImpl), verified };
    } catch (error) {
      if (error instanceof InteractiveUIPackageError) {
        throw new InteractiveUIExtensionManagerError(error.message, error.code, error.status, error.details);
      }
      throw error;
    }
  };

  const inspectMarketplaceInternal = async (catalogUrlValue) => {
    const catalogUrl = normalizeRemoteUrl(catalogUrlValue, 'Marketplace catalog URL');
    const { catalog } = await downloadAndVerifyCatalog(catalogUrl);
    return {
      id: catalog.marketplace.id,
      name: catalog.marketplace.name,
      keyId: catalog.marketplace.keyId,
      catalogUrl,
      publicKey: catalog.marketplace.publicKey,
      fingerprint: catalog.marketplace.fingerprint,
      extensionCount: catalog.entries.length,
    };
  };

  const inspectMarketplace = async (catalogUrl) => {
    const { publicKey: _publicKey, ...inspection } = await inspectMarketplaceInternal(catalogUrl);
    return inspection;
  };

  const addMarketplace = (input) => mutate(async () => {
    if (!isRecord(input)) {
      throw new InteractiveUIExtensionManagerError('Marketplace input is invalid', 'invalid_marketplace_input');
    }
    for (const field of Object.keys(input)) {
      if (field !== 'catalogUrl' && field !== 'confirmedFingerprint') {
        throw new InteractiveUIExtensionManagerError(`Marketplace input has an unknown field: ${field}`, 'invalid_marketplace_input');
      }
    }
    const inspected = await inspectMarketplaceInternal(input.catalogUrl);
    if (input.confirmedFingerprint !== inspected.fingerprint) {
      const { publicKey: _publicKey, ...details } = inspected;
      throw new InteractiveUIExtensionManagerError(
        'Marketplace trust confirmation is required before adding this catalog',
        'marketplace_confirmation_required',
        403,
        details,
      );
    }
    const store = await readMarketplaceStore();
    const existing = store.marketplaces[inspected.id];
    if (existing
      && (existing.fingerprint !== inspected.fingerprint || existing.keyId !== inspected.keyId)) {
      throw new InteractiveUIExtensionManagerError(
        'Marketplace already exists with a different signing identity',
        'marketplace_key_conflict',
        409,
      );
    }
    store.marketplaces[inspected.id] = {
      id: inspected.id,
      name: inspected.name,
      keyId: inspected.keyId,
      catalogUrl: inspected.catalogUrl,
      publicKey: inspected.publicKey,
      fingerprint: inspected.fingerprint,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    await writeMarketplaceStore(store);
    const { publicKey: _publicKey, addedAt: _addedAt, extensionCount: _extensionCount, ...result } = {
      ...store.marketplaces[inspected.id],
      extensionCount: inspected.extensionCount,
    };
    return result;
  });

  const removeMarketplace = (marketplaceId) => mutate(async () => {
    const id = assertNamespacedId(marketplaceId, 'Marketplace id');
    const store = await readMarketplaceStore();
    if (!store.marketplaces[id]) {
      throw new InteractiveUIExtensionManagerError('Marketplace was not found', 'marketplace_not_found', 404);
    }
    delete store.marketplaces[id];
    await writeMarketplaceStore(store);
    return { removed: true };
  });

  const fetchMarketplaceCatalogInternal = async (marketplaceId) => {
    const id = assertNamespacedId(marketplaceId, 'Marketplace id');
    const store = await readMarketplaceStore();
    const marketplace = store.marketplaces[id];
    if (!marketplace) {
      throw new InteractiveUIExtensionManagerError('Marketplace was not found', 'marketplace_not_found', 404);
    }
    const { catalog } = await downloadAndVerifyCatalog(marketplace.catalogUrl, marketplace.publicKey);
    if (catalog.marketplace.id !== marketplace.id
      || catalog.marketplace.name !== marketplace.name
      || catalog.marketplace.keyId !== marketplace.keyId
      || catalog.marketplace.fingerprint !== marketplace.fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        'Marketplace catalog identity does not match its trusted configuration',
        'catalog_identity_mismatch',
        403,
      );
    }
    return { marketplace, catalog };
  };

  const sanitizeMarketplaceCatalog = ({ marketplace, catalog }) => ({
    marketplace: {
      id: marketplace.id,
      name: marketplace.name,
      keyId: marketplace.keyId,
      catalogUrl: marketplace.catalogUrl,
      fingerprint: marketplace.fingerprint,
      addedAt: marketplace.addedAt,
    },
    catalog: {
      $schema: catalog.$schema,
      marketplace: {
        id: catalog.marketplace.id,
        name: catalog.marketplace.name,
        keyId: catalog.marketplace.keyId,
        fingerprint: catalog.marketplace.fingerprint,
      },
      generatedAt: catalog.generatedAt,
      entries: catalog.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        packageHash: entry.packageHash,
        publisher: {
          id: entry.publisher.id,
          name: entry.publisher.name,
          keyId: entry.publisher.keyId,
          fingerprint: entry.publisher.fingerprint,
        },
      })),
    },
  });

  const fetchMarketplaceCatalog = (marketplaceId) =>
    mutate(async () => sanitizeMarketplaceCatalog(await fetchMarketplaceCatalogInternal(marketplaceId)));

  const verifyMarketplacePackage = async (buffer, entry) => {
    let verified;
    try {
      verified = await verifyExtensionPackage({
        buffer,
        cryptoImpl,
        resolveTrustedPublisherKey: async (publisherId, keyId) =>
          publisherId === entry.publisher.id && keyId === entry.publisher.keyId
            ? entry.publisher.publicKey
            : null,
      });
    } catch (error) {
      if (error instanceof InteractiveUIPackageError) {
        throw new InteractiveUIExtensionManagerError(
          'Downloaded extension package failed signed catalog verification',
          'catalog_package_identity_mismatch',
          403,
        );
      }
      throw error;
    }
    if (verified.packageHash !== entry.packageHash
      || verified.packageIndex.extension?.id !== entry.id
      || verified.packageIndex.extension?.name !== entry.name
      || verified.packageIndex.extension?.version !== entry.version
      || verified.packageIndex.publisher?.id !== entry.publisher.id
      || verified.packageIndex.publisher?.name !== entry.publisher.name
      || verified.packageIndex.publisher?.keyId !== entry.publisher.keyId
      || verified.publisherFingerprint !== entry.publisher.fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        'Downloaded extension package identity does not match the signed catalog entry',
        'catalog_package_identity_mismatch',
        403,
      );
    }
    return verified;
  };

  const assertMarketplacePublisherTrustCompatible = async (entry) => {
    const store = await readTrustStore();
    const existing = store.publishers[entry.publisher.id]?.keys?.[entry.publisher.keyId];
    if (existing && existing.fingerprint !== entry.publisher.fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        `Publisher key ${entry.publisher.id}/${entry.publisher.keyId} already exists with a different fingerprint`,
        'publisher_key_conflict',
        409,
      );
    }
  };

  const installFromMarketplace = (marketplaceIdValue, extensionIdValue, versionValue) => mutate(async () => {
    const marketplaceId = assertNamespacedId(marketplaceIdValue, 'Marketplace id');
    const extensionId = assertNamespacedId(extensionIdValue, 'Extension id');
    if (typeof versionValue !== 'string' || !SEMVER_PATTERN.test(versionValue)) {
      throw new InteractiveUIExtensionManagerError('Extension version is invalid', 'invalid_version');
    }
    const { catalog } = await fetchMarketplaceCatalogInternal(marketplaceId);
    const entry = catalog.entries.find(
      (candidate) => candidate.id === extensionId && candidate.version === versionValue,
    );
    if (!entry) {
      throw new InteractiveUIExtensionManagerError(
        'Marketplace extension version was not found',
        'marketplace_entry_not_found',
        404,
      );
    }
    await assertMarketplacePublisherTrustCompatible(entry);
    const deadline = createRemoteDeadline(fetchTimeoutMs, 'Extension package download');
    let buffer;
    try {
      let response;
      try {
        response = await deadline.run(fetchImpl(entry.packageUrl, {
          headers: { Accept: 'application/vnd.openchamber.ocix+zip' },
          redirect: 'error',
          signal: deadline.signal,
        }));
      } catch (error) {
        if (error instanceof InteractiveUIExtensionManagerError) throw error;
        throw new InteractiveUIExtensionManagerError('Extension package download failed', 'package_download_failed', 502);
      }
      assertUnredirectedResponse(response, entry.packageUrl, 'Extension package');
      if (!response?.ok) {
        discardResponseBody(response);
        throw new InteractiveUIExtensionManagerError(
          `Extension package download failed (${Number.isInteger(response?.status) ? response.status : 'invalid response'})`,
          'package_download_failed',
          502,
        );
      }
      buffer = await responseBytes(response, MAX_PACKAGE_BYTES, 'Extension package', deadline);
    } catch (error) {
      if (error instanceof InteractiveUIExtensionManagerError) throw error;
      throw new InteractiveUIExtensionManagerError('Extension package download failed', 'package_download_failed', 502);
    } finally {
      deadline.close();
    }
    if (packageHash(cryptoImpl, buffer) !== entry.packageHash) {
      throw new InteractiveUIExtensionManagerError(
        'Downloaded extension package hash does not match the signed catalog',
        'catalog_package_hash_mismatch',
        403,
      );
    }
    const verified = await verifyMarketplacePackage(buffer, entry);
    return installVerifiedPackage(verified, {
      source: { type: 'marketplace', marketplaceId },
    });
  });

  const list = () => mutate(async () => {
    const [store, state, marketplaceStore] = await Promise.all([
      readTrustStore(),
      readState(),
      readMarketplaceStore(),
    ]);
    const publishers = Object.keys(store.publishers).sort(compareCodePoints).map((publisherId) => {
      const publisher = store.publishers[publisherId];
      return {
        id: publisher.id,
        name: publisher.name,
        keys: Object.keys(publisher.keys).sort(compareCodePoints).map((keyId) => {
          const { keyId: normalizedKeyId, fingerprint, source, trustedAt } = publisher.keys[keyId];
          return { keyId: normalizedKeyId, fingerprint, source, trustedAt };
        }),
      };
    });
    const extensions = Object.keys(state.extensions)
      .sort(compareCodePoints)
      .map((extensionId) => sanitizeExtension(state.extensions[extensionId]));
    const marketplaces = Object.keys(marketplaceStore.marketplaces)
      .sort(compareCodePoints)
      .map((marketplaceId) => {
        const { publicKey: _publicKey, ...marketplace } = marketplaceStore.marketplaces[marketplaceId];
        return marketplace;
      });
    return { apiVersion: 1, extensions, publishers, marketplaces };
  });

  const inspectPackageInternal = async (buffer) => {
    // Embedded keys verify only package self-consistency. Host trust comes
    // exclusively from the resolver, which returns the stored public key of an
    // OWN exact durable publisher/key slot (or null).
    let verified;
    try {
      verified = await verifyExtensionPackage({
        buffer,
        allowEmbeddedPublisherKey: true,
        cryptoImpl,
        resolveTrustedPublisherKey: async (publisherId, keyId) => {
          const trustedSlot = await resolveTrustedKey(publisherId, keyId);
          return trustedSlot?.publicKey ?? null;
        },
      });
    } catch (error) {
      if (error instanceof InteractiveUIPackageError) {
        throw new InteractiveUIExtensionManagerError(error.message, error.code, error.status, error.details);
      }
      throw error;
    }
    // A signed package never widens the frozen grammar: the public snapshot
    // contains only validated string ids, and the publisher display name is
    // re-asserted (trimmed, non-empty, <=200 code units) after verification
    // but BEFORE any output decision. Over-bound ids and coerced non-string
    // key ids are likewise rejected before any trust or output decision is
    // derived from them.
    const extensionId = assertNamespacedId(verified.packageIndex.extension?.id, 'Extension id');
    const publisherId = assertNamespacedId(verified.packageIndex.publisher?.id, 'Publisher id');
    const keyId = assertKeyId(verified.packageIndex.publisher?.keyId);
    const publisherName = assertDisplayName(verified.packageIndex.publisher?.name, 'Publisher name');
    return {
      extension: {
        id: extensionId,
        name: verified.packageIndex.extension.name,
        version: verified.packageIndex.extension.version,
      },
      publisher: {
        id: publisherId,
        name: publisherName,
        keyId,
        fingerprint: verified.publisherFingerprint,
        trusted: verified.publisherTrusted === true,
      },
      permissions: sanitizePermissions(verified.manifest),
      agentRuntime: verified.agentRuntime,
    };
  };

  // Inspection reads the same trust authority as installation. Queue it with
  // mutations so a Marketplace delegation that later rolls back is never
  // exposed as a transient trusted snapshot.
  const inspectPackage = (buffer) => mutate(() => inspectPackageInternal(buffer));

  return {
    inspectPackage,
    trustPublisher,
    removeTrustedPublisherKey,
    installPackage,
    inspectRemote,
    connectRemote,
    inspectMarketplace,
    addMarketplace,
    removeMarketplace,
    fetchMarketplaceCatalog,
    installFromMarketplace,
    setEnabled,
    rollback,
    uninstall,
    getEnabledExtensionRoots,
    list,
  };
};
