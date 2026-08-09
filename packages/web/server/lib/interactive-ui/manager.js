import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
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
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  normalizeHostedPermissions,
  safeRelativePath,
} from './hosted-ocix.js';
import {
  fetchRemoteOcixManifest,
  hostedSurfaceBindings,
  selectRemoteConnector,
  verifyRemoteOcixManifest,
} from './remote-ocix.js';
import { createRemoteResourceCache } from './remote-resource-cache.js';

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
const REMOTE_LIFECYCLE_TTL_MS = 45_000;
const REMOTE_LIFECYCLE_MAX_ENTRIES = 128;

const compareSemver = (left, right) => {
  const parse = (value) => {
    if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) return null;
    const [core, prerelease = ''] = value.split('-', 2);
    return { core: core.split('.').map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
};

const REMOTE_CANDIDATE_FAILURES = {
  remote_update_version_reuse: { status: 409, message: 'Remote app reuses the current version with different signed content; the vendor must change the version' },
  remote_update_rollback_not_required: { status: 403, message: 'Remote app downgrade requires a signed required update' },
  remote_publisher_changed: { status: 403, message: 'Remote app publisher identity changed; reconnect after reviewing the new publisher' },
  remote_trust_conflict: { status: 403, message: 'Remote app signing key conflicts with the trusted key; do not replace a trusted key' },
  remote_connector_changed: { status: 409, message: 'Remote app connector identity changed; reconnect instead of updating' },
  remote_name_changed: { status: 409, message: 'Remote app extension name changed; reconnect instead of updating' },
  remote_identity_mismatch: { status: 403, message: 'Remote app identity does not match the installed extension' },
  invalid_hosted_manifest: { status: 400, message: 'Remote app signed manifest is invalid' },
};
// A candidate root is reserved with mkdir (which is atomic and never replaces
// an existing directory). This marker is deliberately excluded from the
// deterministic shell hash and remains bound to its matching durable pending
// record. Neither record grants state, consent, credential, or execution
// authority, including after an exact candidate becomes active.
const REMOTE_INCOMPLETE_MARKER_FILE = '.openchamber.remote-incomplete';
const REMOTE_PENDING_SCHEMA = 'openchamber://remote-candidate/v1';
const REMOTE_INCOMPLETE_MARKER_SCHEMA = 'openchamber://remote-candidate-marker/v1';
const REMOTE_PENDING_MAX_BYTES = 4 * 1024 * 1024;
const REMOTE_MARKER_MAX_BYTES = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOTE_PENDING_FIELDS = Object.freeze([
  '$schema',
  'transactionId',
  'extensionId',
  'extensionName',
  'version',
  'appEntryUrl',
  'manifestHash',
  'signedDocument',
  'fileHashes',
]);
const REMOTE_MARKER_FIELDS = Object.freeze([
  '$schema',
  'transactionId',
  'extensionId',
  'version',
  'manifestHash',
]);

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
const emptyState = () => ({
  $schema: STATE_SCHEMA,
  extensions: Object.create(null),
  agentRuntime: { assets: Object.create(null) },
});
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
      'blockedUpdate',
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
  let blockedUpdate;
  if (value.blockedUpdate !== undefined) {
    if (!isRecord(value.blockedUpdate)) {
      throw corruptState(`Extension ${extensionId}@${version} Remote blocked update is invalid`);
    }
    assertExactStateFields(
      value.blockedUpdate,
      new Set(['required', 'version', 'manifestHash', 'reason', 'observedAt']),
      `Extension ${extensionId}@${version} Remote blocked update`,
    );
    if (value.blockedUpdate.required !== true
      || typeof value.blockedUpdate.version !== 'string'
      || !SEMVER_PATTERN.test(value.blockedUpdate.version)
      || typeof value.blockedUpdate.manifestHash !== 'string'
      || !SHA256_PATTERN.test(value.blockedUpdate.manifestHash)
      || !['confirmation-required', 'required-observed', 'apply-failed'].includes(value.blockedUpdate.reason)
      || typeof value.blockedUpdate.observedAt !== 'string'
      || !Number.isFinite(Date.parse(value.blockedUpdate.observedAt))) {
      throw corruptState(`Extension ${extensionId}@${version} Remote blocked update is non-canonical`);
    }
    blockedUpdate = {
      required: true,
      version: value.blockedUpdate.version,
      manifestHash: value.blockedUpdate.manifestHash,
      reason: value.blockedUpdate.reason,
      observedAt: value.blockedUpdate.observedAt,
    };
  }
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
    ...(blockedUpdate ? { blockedUpdate } : {}),
  };
};

const validateAgentRuntimeAssets = (value, label) => {
  if (!isRecord(value)) throw corruptState(`${label} is invalid`);
  assertExactStateFields(value, new Set(['assets']), label);
  if (!isRecord(value.assets)) throw corruptState(`${label} assets are invalid`);
  const assets = Object.create(null);
  for (const [relativePath, descriptor] of Object.entries(value.assets)) {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.startsWith('/')) {
      throw corruptState(`${label} asset path is invalid`);
    }
    if (!isRecord(descriptor)) throw corruptState(`${label} asset descriptor is invalid`);
    assets[relativePath] = clone(descriptor);
  }
  return { assets };
};

const validateState = (parsed, cryptoImpl) => {
  if (!isRecord(parsed) || parsed.$schema !== STATE_SCHEMA || !isRecord(parsed.extensions)) throw corruptState();
  assertExactStateFields(parsed, new Set(['$schema', 'extensions', 'agentRuntime']), 'Extension manager state');
  const agentRuntime = parsed.agentRuntime === undefined
    ? { assets: Object.create(null) }
    : validateAgentRuntimeAssets(parsed.agentRuntime, 'Extension manager Agent Runtime state');
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
  return { $schema: STATE_SCHEMA, extensions, agentRuntime };
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
      if (isRecord(metadata.remote.blockedUpdate)) {
        metadata.remote.blocked = clone(metadata.remote.blockedUpdate);
        delete metadata.remote.blockedUpdate;
      }
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
  remoteProbeTtlMs = REMOTE_LIFECYCLE_TTL_MS,
  now = Date.now,
  beforeClearRemoteBlockedUpdate = null,
} = {}) => {
  if (typeof dataDirectory !== 'string'
    || !dataDirectory.trim()
    || !fsImpl
    || !pathImpl
    || !cryptoImpl
    || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(fetchTimeoutMs)
    || fetchTimeoutMs <= 0
    || !Number.isSafeInteger(remoteProbeTtlMs)
    || remoteProbeTtlMs <= 0
    || typeof now !== 'function') {
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
  if (beforeClearRemoteBlockedUpdate !== null && typeof beforeClearRemoteBlockedUpdate !== 'function') {
    throw new Error('Interactive UI extension manager blocked-update hook is invalid');
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
  const remoteResourceCache = createRemoteResourceCache({
    fetchImpl,
    cryptoImpl,
  });
  const remoteLifecycleCache = new Map();
  const remoteProbeInFlight = new Map();
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

  const remotePendingPath = (extensionId, version) => (
    pathImpl.join(stagingDirectory, `${extensionId}--${version}.pending.json`)
  );

  const createRemotePendingRecord = (remote, expected, extensionName, appEntryUrl) => ({
    $schema: REMOTE_PENDING_SCHEMA,
    transactionId: cryptoImpl.randomUUID(),
    extensionId: remote.extensionId,
    extensionName,
    version: remote.version,
    appEntryUrl,
    manifestHash: remote.manifestHash,
    signedDocument: clone(remote.signedDocument),
    fileHashes: clone(expected.fileHashes),
  });

  const hasExactFields = (value, fields) => {
    if (!isRecord(value)) return false;
    const actual = Object.keys(value).sort(compareCodePoints);
    const expected = [...fields].sort(compareCodePoints);
    return actual.length === expected.length
      && actual.every((field, index) => field === expected[index]);
  };

  const canonicalRecordBytes = (record) => Buffer.from(`${canonicalStringify(record)}\n`);

  const sameFileIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;

  const readRegularFileNoFollow = async (target, maxBytes) => {
    let handle;
    try {
      handle = await fsImpl.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const before = await handle.stat();
      if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maxBytes) {
        throw new InteractiveUIExtensionManagerError(
          'Remote candidate transaction file is invalid',
          'remote_shell_integrity_failed',
          409,
        );
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (!sameFileIdentity(before, after) || after.size !== bytes.length) {
        throw new InteractiveUIExtensionManagerError(
          'Remote candidate transaction file changed while it was read',
          'remote_shell_integrity_failed',
          409,
        );
      }
      return bytes;
    } finally {
      await handle?.close();
    }
  };

  const fileNameHash = (value) => packageHash(cryptoImpl, value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

  const stageRemoteBytes = async (target, bytes) => {
    await ensureManagedDirectory(directory, 'Interactive UI Manager directory');
    await ensureManagedDirectory(stagingDirectory, 'Interactive UI staging directory');
    // A content-addressed name bounds inert residue to one directory entry per
    // target/payload pair. Including the target prevents two published files
    // from sharing an inode merely because their bytes match. Cleanup through
    // this mutable path would reintroduce the same parent-exchange race that
    // no-replace publication is designed to survive, so exact residue is
    // deliberately reusable instead.
    const targetKey = fileNameHash(Buffer.from(target));
    const contentKey = fileNameHash(bytes);
    const temporaryPath = pathImpl.join(stagingDirectory, `.remote-bytes-${targetKey}-${contentKey}.blob`);
    let handle;
    try {
      try {
        handle = await fsImpl.open(
          temporaryPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readRegularFileNoFollow(temporaryPath, Math.max(bytes.length, 1));
        const identity = await fsImpl.lstat(temporaryPath);
        if (!identity.isFile()
          || identity.isSymbolicLink()
          || identity.size !== bytes.length
          || !existing.equals(bytes)) {
          throw new InteractiveUIExtensionManagerError(
            'Remote candidate staging residue differs from its content-addressed bytes',
            'remote_shell_integrity_failed',
            409,
          );
        }
        return { path: temporaryPath, identity };
      }
      await handle.writeFile(bytes);
      await handle.sync();
      const identity = await handle.stat();
      if (!identity.isFile() || identity.isSymbolicLink() || identity.size !== bytes.length) {
        throw new InteractiveUIExtensionManagerError(
          'Remote candidate staging file could not be verified',
          'remote_shell_integrity_failed',
          409,
        );
      }
      return { path: temporaryPath, identity };
    } finally {
      await handle?.close();
    }
  };

  const publishRemoteBytesNoReplace = async (target, bytes, verifyParent = null) => {
    const staged = await stageRemoteBytes(target, bytes);
    if (verifyParent) await verifyParent();
    await fsImpl.link(staged.path, target);
    if (verifyParent) await verifyParent();
    const targetStat = await fsImpl.lstat(target);
    if (!targetStat.isFile()
      || targetStat.isSymbolicLink()
      || !sameFileIdentity(targetStat, staged.identity)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote candidate publication does not retain its staged file identity',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const published = await readRegularFileNoFollow(target, Math.max(bytes.length, 1));
    if (!published.equals(bytes)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote candidate publication differs from its staged bytes',
        'remote_shell_integrity_failed',
        409,
      );
    }
  };

  const assertRemoteWriteDirectory = async (target) => {
    const relative = pathImpl.relative(versionsDirectory, target);
    if (relative === '..' || relative.startsWith(`..${pathImpl.sep}`) || pathImpl.isAbsolute(relative)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote candidate write path escapes the managed version store',
        'hosted_agent_runtime_conflict',
        409,
      );
    }
    let current = versionsDirectory;
    for (const segment of relative ? relative.split(pathImpl.sep) : []) {
      current = pathImpl.join(current, segment);
      const stat = await fsImpl.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new InteractiveUIExtensionManagerError(
          'Remote OCIX shell contains an aliased directory',
          'hosted_agent_runtime_conflict',
          409,
        );
      }
    }
    const [resolvedVersions, resolvedTarget] = await Promise.all([
      fsImpl.realpath(versionsDirectory),
      fsImpl.realpath(target),
    ]);
    const resolvedRelative = pathImpl.relative(resolvedVersions, resolvedTarget);
    if (resolvedRelative === '..'
      || resolvedRelative.startsWith(`..${pathImpl.sep}`)
      || pathImpl.isAbsolute(resolvedRelative)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote candidate write path resolves outside the managed version store',
        'hosted_agent_runtime_conflict',
        409,
      );
    }
  };

  const ensureRemoteWriteChildDirectory = async (parent, name) => {
    await assertRemoteWriteDirectory(parent);
    const target = pathImpl.join(parent, name);
    try {
      await fsImpl.mkdir(target, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const identity = await fsImpl.lstat(target);
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw new InteractiveUIExtensionManagerError(
        'Remote OCIX shell contains an aliased directory',
        'hosted_agent_runtime_conflict',
        409,
      );
    }
    await assertRemoteWriteDirectory(target);
    return target;
  };

  const reserveRemoteWriteChildDirectory = async (parent, name, conflictMessage) => {
    await assertRemoteWriteDirectory(parent);
    const target = pathImpl.join(parent, name);
    try {
      await fsImpl.mkdir(target, { mode: 0o700 });
      const identity = await fsImpl.lstat(target);
      if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('invalid reserved directory');
      await assertRemoteWriteDirectory(target);
      return target;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new InteractiveUIExtensionManagerError(
          conflictMessage,
          'unmanaged_version_conflict',
          409,
        );
      }
      throw error;
    }
  };

  const writeExpectedRemoteShell = async (root, expected) => {
    try {
      await assertRemoteWriteDirectory(root);
      for (const relativePath of Object.keys(expected.files).sort(compareCodePoints)) {
        const normalized = safeRelativePath(relativePath, 'Remote shell file');
        const segments = normalized.split('/');
        let parent = root;
        for (const segment of segments.slice(0, -1)) {
          parent = await ensureRemoteWriteChildDirectory(parent, segment);
        }
        const target = pathImpl.join(parent, segments.at(-1));
        await assertRemoteWriteDirectory(parent);
        await publishRemoteBytesNoReplace(
          target,
          expected.files[relativePath],
          () => assertRemoteWriteDirectory(parent),
        );
        await assertRemoteWriteDirectory(parent);
        const published = await readRegularFileNoFollow(target, expected.files[relativePath].length);
        if (!published.equals(expected.files[relativePath])) {
          throw new InteractiveUIExtensionManagerError(
            'Remote OCIX shell contains unexpected file bytes',
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

  const fileHashesForDirectory = async (root, {
    ignoreRemoteIncompleteMarker = false,
    allowEmpty = false,
  } = {}) => {
    const hashes = Object.create(null);
    for (const relativePath of (await collectInstalledFiles(root)).sort(compareCodePoints)) {
      if (ignoreRemoteIncompleteMarker && relativePath === REMOTE_INCOMPLETE_MARKER_FILE) continue;
      hashes[relativePath] = packageHash(
        cryptoImpl,
        await fsImpl.readFile(pathImpl.join(root, ...relativePath.split('/'))),
      );
    }
    if (!allowEmpty && Object.keys(hashes).length === 0) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell contains no managed files',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return hashes;
  };

  const readRemotePendingCandidate = async (extensionId, version) => {
    if (!ID_PATTERN.test(extensionId ?? '') || !SEMVER_PATTERN.test(version ?? '')) return null;
    let bytes;
    try {
      bytes = await readRegularFileNoFollow(
        remotePendingPath(extensionId, version),
        REMOTE_PENDING_MAX_BYTES,
      );
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      return null;
    }
    try {
      const record = JSON.parse(bytes.toString('utf8'));
      if (!hasExactFields(record, REMOTE_PENDING_FIELDS)
        || record.$schema !== REMOTE_PENDING_SCHEMA
        || !UUID_PATTERN.test(record.transactionId ?? '')
        || record.extensionId !== extensionId
        || typeof record.extensionName !== 'string'
        || !record.extensionName.trim()
        || record.extensionName.length > MAX_DISPLAY_NAME_LENGTH
        || record.version !== version
        || typeof record.appEntryUrl !== 'string'
        || !SHA256_PATTERN.test(record.manifestHash ?? '')
        || !isRecord(record.signedDocument)
        || !isRecord(record.fileHashes)
        || !bytes.equals(canonicalRecordBytes(record))) return null;
      const remote = verifyRemoteOcixManifest({ document: record.signedDocument, cryptoImpl });
      const appEntryUrl = normalizeRemoteUrl(record.appEntryUrl, 'Remote app entry URL');
      if (appEntryUrl !== record.appEntryUrl) return null;
      remote.appEntryUrl = appEntryUrl;
      remote.connector = await preflightRemoteShellMetadata(remote);
      const expected = buildExpectedRemoteShell(remote);
      if (remote.extensionId !== extensionId
        || (remote.extension?.name ?? remote.extensionId) !== record.extensionName
        || remote.version !== version
        || remote.manifestHash !== record.manifestHash
        || !hashMapsEqual(record.fileHashes, expected.fileHashes)) return null;
      return { record, remote, expected };
    } catch {
      // A malformed or untrusted pending record grants no tolerance to a
      // sibling. The normal unmanaged-sibling verifier will fail closed.
      return null;
    }
  };

  const writeRemotePendingCandidate = async (record) => {
    await ensureManagedDirectory(directory, 'Interactive UI Manager directory');
    await ensureManagedDirectory(stagingDirectory, 'Interactive UI staging directory');
    const target = remotePendingPath(record.extensionId, record.version);
    const expectedBytes = canonicalRecordBytes(record);
    if (expectedBytes.length > REMOTE_PENDING_MAX_BYTES) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell pending candidate is too large',
        'remote_shell_integrity_failed',
        409,
      );
    }
    try {
      const existing = await readRegularFileNoFollow(target, REMOTE_PENDING_MAX_BYTES);
      if (existing.equals(expectedBytes)) return;
      throw new InteractiveUIExtensionManagerError(
        `${record.extensionId}@${record.version} has a different pending candidate`,
        'unmanaged_version_conflict',
        409,
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      // Hard-link publication is atomic and has true no-replace semantics.
      // A process crash can leave an unreferenced staging temp, never a
      // partially published authoritative journal.
      await publishRemoteBytesNoReplace(target, expectedBytes);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const existing = await readRegularFileNoFollow(target, REMOTE_PENDING_MAX_BYTES).catch(() => null);
        if (existing?.equals(expectedBytes)) return;
        throw new InteractiveUIExtensionManagerError(
          `${record.extensionId}@${record.version} has a different pending candidate`,
          'unmanaged_version_conflict',
          409,
        );
      }
      throw error;
    }
  };

  const remoteIncompleteMarkerRecord = (record) => ({
    $schema: REMOTE_INCOMPLETE_MARKER_SCHEMA,
    transactionId: record.transactionId,
    extensionId: record.extensionId,
    version: record.version,
    manifestHash: record.manifestHash,
  });

  const readRemoteIncompleteMarker = async (root, pendingRecord) => {
    const markerPath = pathImpl.join(root, REMOTE_INCOMPLETE_MARKER_FILE);
    let bytes;
    try {
      bytes = await readRegularFileNoFollow(markerPath, REMOTE_MARKER_MAX_BYTES);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let marker;
    try {
      marker = JSON.parse(bytes.toString('utf8'));
    } catch {
      marker = null;
    }
    const expected = remoteIncompleteMarkerRecord(pendingRecord);
    if (!hasExactFields(marker, REMOTE_MARKER_FIELDS)
      || !UUID_PATTERN.test(marker.transactionId ?? '')
      || !bytes.equals(canonicalRecordBytes(marker))
      || canonicalStringify(marker) !== canonicalStringify(expected)) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell pending marker is not bound to its exact transaction',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return marker;
  };

  const writeRemoteIncompleteMarker = async (root, pendingRecord) => {
    await assertRemoteWriteDirectory(root);
    const markerPath = pathImpl.join(root, REMOTE_INCOMPLETE_MARKER_FILE);
    const marker = remoteIncompleteMarkerRecord(pendingRecord);
    const expectedBytes = canonicalRecordBytes(marker);
    const existing = await readRemoteIncompleteMarker(root, pendingRecord).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) return;
    try {
      await publishRemoteBytesNoReplace(
        markerPath,
        expectedBytes,
        () => assertRemoteWriteDirectory(root),
      );
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await readRemoteIncompleteMarker(root, pendingRecord);
    }
    await assertRemoteWriteDirectory(root);
  };

  // Validate a directory reserved by a durable pending record without granting
  // it state or consent authority. Existing bytes must be an exact prefix of
  // the signed deterministic shell; empty roots and a truncated marker are
  // both safe, authority-less residues after a crash.
  const verifyRemotePendingResidue = async (extension, versionDirectory, pending) => {
    if (!pending
      || pending.record.extensionId !== extension.id
      || pending.record.extensionName !== extension.name) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell pending candidate identity is invalid',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const rootStat = await fsImpl.lstat(versionDirectory);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell pending candidate root is not a trusted directory',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const marker = await readRemoteIncompleteMarker(versionDirectory, pending.record);
    const actual = await fileHashesForDirectory(versionDirectory, {
      ignoreRemoteIncompleteMarker: true,
      allowEmpty: true,
    });
    for (const [relativePath, hash] of Object.entries(actual)) {
      if (pending.record.fileHashes[relativePath] !== hash) {
        throw new InteractiveUIExtensionManagerError(
          'Remote shell pending candidate contains bytes outside its signed prefix',
          'remote_shell_integrity_failed',
          409,
        );
      }
    }
    const complete = hashMapsEqual(actual, pending.expected.fileHashes);
    if (!marker && Object.keys(actual).length > 0 && !complete) {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell pending candidate has bytes without its transaction marker',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return { actual, markerPresent: Boolean(marker), complete };
  };

  const writeMissingExpectedRemoteFiles = async (root, expected) => {
    const actual = await fileHashesForDirectory(root, {
      ignoreRemoteIncompleteMarker: true,
      allowEmpty: true,
    });
    for (const [relativePath, hash] of Object.entries(actual)) {
      if (expected.fileHashes[relativePath] !== hash) {
        throw new InteractiveUIExtensionManagerError(
          'Remote shell pending candidate contains bytes outside its signed prefix',
          'remote_shell_integrity_failed',
          409,
        );
      }
    }
    const missingFiles = Object.create(null);
    for (const relativePath of Object.keys(expected.files).sort(compareCodePoints)) {
      if (!Object.prototype.hasOwnProperty.call(actual, relativePath)) {
        missingFiles[relativePath] = expected.files[relativePath];
      }
    }
    if (Object.keys(missingFiles).length > 0) {
      await writeExpectedRemoteShell(root, { files: missingFiles });
    }
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

  const verifyRemoteShellSnapshot = async (extension, metadata, extensionRoot, enforceSingleVersion = true) => {
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
        || (enforceSingleVersion && (rootEntries.length !== 1
          || rootEntries[0].name !== metadata.version
          || !rootEntries[0].isDirectory()))) {
        throw new Error('invalid Remote shell root');
      }
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell root is missing, aliased, or contains unmanaged versions',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const markerPresent = await fsImpl.lstat(
      pathImpl.join(versionDirectory, REMOTE_INCOMPLETE_MARKER_FILE),
    ).then(() => true, (error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
    if (markerPresent) {
      const pending = await readRemotePendingCandidate(extension.id, metadata.version);
      if (!pending
        || pending.record.appEntryUrl !== metadata.remote.appEntryUrl
        || pending.record.manifestHash !== metadata.packageHash
        || !hashMapsEqual(pending.expected.fileHashes, metadata.fileHashes)) {
        throw new InteractiveUIExtensionManagerError(
          'Remote shell retained marker is not bound to its exact pending transaction',
          'remote_shell_integrity_failed',
          409,
        );
      }
      await readRemoteIncompleteMarker(versionDirectory, pending.record);
    }
    let actualHashes;
    try {
      actualHashes = await fileHashesForDirectory(versionDirectory, { ignoreRemoteIncompleteMarker: true });
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

  // Validate a state-less candidate left by a failed Remote update. Such an
  // orphan is tolerated only when it is itself a complete deterministic shell
  // for its signed manifest; arbitrary sibling files/directories remain a
  // managed-root integrity failure and are never treated as authority.
  const verifyRemoteOrphanShell = async (extension, extensionRoot, siblingName) => {
    const versionDirectory = pathImpl.join(extensionRoot, siblingName);
    let remote;
    try {
      const stat = await fsImpl.lstat(versionDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('orphan is not a directory');
      const hasIncompleteMarker = await fsImpl.lstat(
        pathImpl.join(versionDirectory, REMOTE_INCOMPLETE_MARKER_FILE),
      ).then(() => true, (error) => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      });
      if (hasIncompleteMarker) throw new Error('orphan has an incomplete transaction marker');
      const signedDocument = JSON.parse(await fsImpl.readFile(
        pathImpl.join(versionDirectory, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
        'utf8',
      ));
      remote = verifyRemoteOcixManifest({ document: signedDocument, cryptoImpl });
      remote.connector = await preflightRemoteShellMetadata(remote);
      if (remote.extensionId !== extension.id || remote.version !== siblingName) throw new Error('orphan identity mismatch');
      const expected = buildExpectedRemoteShell(remote);
      const actual = await fileHashesForDirectory(versionDirectory, { ignoreRemoteIncompleteMarker: true });
      if (!hashMapsEqual(actual, expected.fileHashes)) throw new Error('orphan bytes differ');
      return true;
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell root contains an unmanaged or invalid sibling',
        'remote_shell_integrity_failed',
        409,
      );
    }
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
    const extensionRoot = pathImpl.join(versionsDirectory, extension.id);
    let entries;
    try {
      const rootStat = await fsImpl.lstat(extensionRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('invalid extension root');
      entries = await fsImpl.readdir(extensionRoot, { withFileTypes: true });
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote shell root is missing, aliased, or contains unmanaged versions',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const knownVersions = new Set(Object.values(extension.versions ?? {})
      .filter((candidate) => candidate?.delivery === 'remote')
      .map((candidate) => candidate.version));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new InteractiveUIExtensionManagerError(
          'Remote shell root contains an unmanaged or aliased sibling',
          'remote_shell_integrity_failed',
          409,
        );
      }
      if (!knownVersions.has(entry.name)) {
        const pending = await readRemotePendingCandidate(extension.id, entry.name);
        if (pending) {
          // A strictly validated journal grants no execution/state authority;
          // its destination is therefore excluded from authorization of the
          // already installed active versions. Resume performs the full marker
          // and exact-prefix validation before writing or adopting any byte.
          continue;
        } else {
          await verifyRemoteOrphanShell(extension, extensionRoot, entry.name);
        }
      }
    }
    for (const candidate of Object.values(extension.versions ?? {})) {
      if (candidate?.delivery !== 'remote') continue;
      await verifyRemoteShellSnapshot(extension, candidate, extensionRoot, false);
    }
    return pathImpl.join(extensionRoot, metadata.version);
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
        || entries.length === 0
        || entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
        throw new Error('invalid reusable Remote shell root');
      }
      const markerPresent = await fsImpl.lstat(pathImpl.join(versionDirectory, REMOTE_INCOMPLETE_MARKER_FILE)).then(() => true, (error) => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      });
      if (markerPresent) {
        const pending = await readRemotePendingCandidate(remote.extensionId, remote.version);
        if (!pending
          || pending.record.appEntryUrl !== remote.appEntryUrl
          || pending.record.manifestHash !== remote.manifestHash
          || !hashMapsEqual(pending.expected.fileHashes, expected.fileHashes)) {
          throw new Error('retained Remote marker is not bound to the confirmed shell');
        }
        await readRemoteIncompleteMarker(versionDirectory, pending.record);
      }
      if (!hashMapsEqual(await fileHashesForDirectory(versionDirectory, { ignoreRemoteIncompleteMarker: true }), expected.fileHashes)) {
        throw new Error('reusable Remote shell bytes differ');
      }
      // Any retained sibling is admissible only as an exact deterministic
      // signed orphan. It has no state/consent authority until a subsequent
      // fresh confirmation adopts its own exact target version.
      for (const entry of entries) {
        if (entry.name === remote.version) continue;
        const sibling = pathImpl.join(extensionRoot, entry.name);
        const pending = await readRemotePendingCandidate(remote.extensionId, entry.name);
        if (pending) {
          // Pending siblings have no authority and are validated only by their
          // exact resume transaction. They cannot make another exact shell
          // reusable or unusable.
          continue;
        }
        const document = JSON.parse(await fsImpl.readFile(
          pathImpl.join(sibling, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
          'utf8',
        ));
        const candidate = verifyRemoteOcixManifest({ document, cryptoImpl });
        candidate.connector = await preflightRemoteShellMetadata(candidate);
        if (candidate.extensionId !== remote.extensionId || candidate.version !== entry.name) {
          throw new Error('reusable sibling identity mismatch');
        }
        if (!hashMapsEqual(await fileHashesForDirectory(sibling, { ignoreRemoteIncompleteMarker: true }), buildExpectedRemoteShell(candidate).fileHashes)) {
          throw new Error('reusable sibling bytes differ');
        }
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
    let assets;
    if (deployment.assets !== undefined) {
      if (!isRecord(deployment.assets)) {
        throw new InteractiveUIExtensionManagerError(
          'Extension activation reconciler returned invalid Agent Runtime assets',
          'extension_activation_contract_invalid',
          500,
        );
      }
      assets = clone(deployment.assets);
    }
    return {
      openCode: {
        changed: deployment.openCode?.changed === true,
        reloaded: deployment.openCode?.reloaded === true,
        external: deployment.openCode?.external === true,
      },
      assets,
      rollback: deployment.rollback,
    };
  };

  const commitStateWithActivation = async (previousState, nextState) => {
    const deployment = await prepareActivation(previousState, nextState);
    // Authoritative previousAssets for the next restart live only in durable
    // Manager state. Ownership records beside OpenCode files never authorize
    // deletion on their own — the caller-supplied map (here, the last
    // committed assets) is the only deletion authority.
    if (deployment.assets !== undefined) {
      nextState.agentRuntime = { assets: deployment.assets };
    } else if (!isRecord(nextState.agentRuntime) || !isRecord(nextState.agentRuntime.assets)) {
      nextState.agentRuntime = clone(previousState.agentRuntime) ?? { assets: Object.create(null) };
    }
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

  // Deploy or re-validate the configured Agent Runtime materializer against
  // the current durable extension set (including the empty set + built-in).
  // Production wiring calls this once at server start so previousAssets and
  // built-in Tools/Skills survive process restart.
  const initialize = () => mutate(async () => {
    const previousState = await readState();
    const nextState = clone(previousState);
    return commitStateWithActivation(previousState, nextState);
  });

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
        if (!hashMapsEqual(await fileHashesForDirectory(destination, { ignoreRemoteIncompleteMarker: true }), expectedShell.fileHashes)) {
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
        // Verify the installation under the Manager mutate queue, then call the
        // credential runtime OUTSIDE that queue. The runtime re-enters Manager
        // via authorizeExtensionAuthority/loadExtensions (also mutate-backed);
        // nesting those under withCurrentRemoteInstallation deadlocks the queue.
        configureCredential: async (accessKey) => {
          await withCurrentRemoteInstallation(
            installed.extension.id,
            remote.connector.id,
            installationId,
            async () => null,
          );
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
        removeCredential: async () => {
          await withCurrentRemoteInstallation(
            installed.extension.id,
            remote.connector.id,
            installationId,
            async () => null,
          );
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
    await remoteResourceCache.clearExtension(id);
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

  // ---- Request-bound Remote lifecycle (health and update probes) ----
  // Probes capture the active generation, accepted manifest hash, and
  // request URL before network I/O. A response is cached only after that
  // complete subject is re-read and still matches, so stale completions never
  // overwrite a newer installation contract.
  const emptyRemoteUpdateProbe = () => ({
    status: 'none',
    remoteVersion: null,
    remoteManifestHash: null,
    changeSummary: null,
    permissionDelta: 'none',
    addedPermissions: null,
    keyChanged: false,
    requiresUserConfirmation: false,
    publisherFingerprint: null,
    failure: null,
  });

  const captureRemoteUpdateSnapshot = async (extensionId) => {
    const state = await readState();
    const extension = state.extensions[extensionId];
    if (!extension) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    const metadata = extension.versions?.[extension.activeVersion];
    if (!metadata || metadata.delivery !== 'remote' || !isRecord(metadata.remote)) {
      throw new InteractiveUIExtensionManagerError(
        'Extension is not a Remote OCIX app',
        'remote_extension_required',
        409,
      );
    }
    const accepted = metadata.remote.acceptedManifest;
    const connector = metadata.remote.connectorRefs?.[0];
    if (!isRecord(accepted) || !SHA256_PATTERN.test(accepted.manifestHash ?? '')
      || typeof metadata.generationId !== 'string' || !isRecord(connector)) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no valid Remote state`,
        'remote_shell_integrity_failed',
        409,
      );
    }
    return Object.freeze({
      extensionId,
      extensionName: extension.name,
      activeVersion: metadata.version,
      generationId: metadata.generationId,
      appEntryUrl: metadata.remote.appEntryUrl,
      installationId: metadata.remote.installationId,
      acceptedManifest: Object.freeze({
        version: accepted.version,
        manifestHash: accepted.manifestHash,
      }),
      publisher: Object.freeze({
        id: metadata.publisher.id,
        name: metadata.publisher.name,
        keyId: metadata.publisher.keyId,
        fingerprint: metadata.publisher.fingerprint,
      }),
      publisherPublicKey: metadata.remote.publisherPublicKey,
      connector: Object.freeze({ id: connector.id, origin: connector.origin, authType: connector.authType }),
      approvedPermissions: clone(metadata.remote.approvedPermissions),
      persistedBlockedUpdate: isRecord(metadata.remote.blockedUpdate)
        ? clone(metadata.remote.blockedUpdate)
        : null,
    });
  };

  const classifyPermissionDelta = (approvedValue, candidateValue) => {
    const added = hostedPermissionExpansion(approvedValue, candidateValue);
    if (added) return { delta: 'expanded', added };
    const approved = normalizeHostedPermissions(approvedValue);
    const candidate = normalizeHostedPermissions(candidateValue);
    const lists = ['resourceOrigins', 'networkOrigins', 'externalLinkOrigins', 'credentialScopes', 'actionIds', 'agentToolNames'];
    const reduced = lists.some((key) => (
      approved[key].some((item) => !candidate[key].includes(item))
      || candidate[key].some((item) => !approved[key].includes(item))
    )) || (approved.clipboard && !candidate.clipboard)
      || (approved.popups && !candidate.popups)
      || (approved.nativeCode && !candidate.nativeCode);
    return { delta: reduced ? 'reduced' : 'none', added: null };
  };

  const validProbeTime = (value) => Number.isSafeInteger(value)
    && value >= 0
    && value <= 8_640_000_000_000_000
    && Number.isSafeInteger(value + remoteProbeTtlMs);
  const probeNow = () => {
    const value = now();
    return validProbeTime(value) ? value : null;
  };
  const probeIso = () => {
    const value = probeNow();
    if (value === null) return null;
    try { return new Date(value).toISOString(); } catch { return null; }
  };
  const subjectFor = (snapshot) => ({
    generation: snapshot.generationId,
    acceptedManifestHash: snapshot.acceptedManifest.manifestHash,
    appEntryUrl: snapshot.appEntryUrl,
  });
  const subjectsEqual = (left, right) => left?.generation === right?.generation
    && left?.acceptedManifestHash === right?.acceptedManifestHash
    && left?.appEntryUrl === right?.appEntryUrl;
  const storeRemoteLifecycle = (extensionId, entry) => {
    remoteLifecycleCache.delete(extensionId);
    remoteLifecycleCache.set(extensionId, entry);
    while (remoteLifecycleCache.size > REMOTE_LIFECYCLE_MAX_ENTRIES) {
      let oldestKey;
      let oldest = Infinity;
      for (const [key, candidate] of remoteLifecycleCache) {
        if (candidate.cachedAt < oldest) {
          oldest = candidate.cachedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) break;
      remoteLifecycleCache.delete(oldestKey);
    }
  };
  const readCachedRemoteLifecycle = (extensionId, snapshot) => {
    const entry = remoteLifecycleCache.get(extensionId);
    const current = probeNow();
    if (!entry || current === null || !subjectsEqual(entry.subject, subjectFor(snapshot))
      || !Number.isSafeInteger(entry.cachedAt) || !Number.isSafeInteger(entry.expiresAt)
      || entry.expiresAt !== entry.cachedAt + remoteProbeTtlMs
      || current < entry.cachedAt || current > entry.expiresAt) {
      if (entry) remoteLifecycleCache.delete(extensionId);
      return null;
    }
    return entry;
  };

  // Probe output is a public lifecycle document. Adapter/library error codes
  // are never passed through merely because they match a safe-looking regex;
  // only this phase-specific fixed vocabulary is observable.
  const REMOTE_PROBE_TRANSPORT_CODES = new Set([
    'hosted_manifest_unavailable',
    'hosted_manifest_origin_changed',
    'hosted_payload_too_large',
    'invalid_hosted_url',
  ]);
  const REMOTE_PROBE_TRUST_CODES = new Set([
    'invalid_hosted_manifest',
    'invalid_hosted_signature',
    'hosted_signature_identity_mismatch',
    'invalid_hosted_publisher_key',
    'hosted_identity_mismatch',
    'invalid_hosted_resources',
    'invalid_hosted_resource',
    'invalid_hosted_permissions',
    'hosted_permission_mismatch',
    'hosted_native_trust_required',
    'invalid_hosted_agent_tool',
    'invalid_hosted_delivery',
    'invalid_manifest',
    'invalid_entry',
    'invalid_routing',
    'invalid_dashboard_contract',
    'invalid_workbench_contract',
    'duplicate_view',
    'duplicate_connector',
    'duplicate_action',
    'duplicate_artifact',
    'duplicate_surface',
    'network_not_allowed',
    'native_code_trust_required',
    'remote_connector_required',
    'remote_connector_ambiguous',
  ]);
  const safeProbeCode = (error, phase) => {
    const code = typeof error?.code === 'string' ? error.code : '';
    const allowed = phase === 'transport' ? REMOTE_PROBE_TRANSPORT_CODES : REMOTE_PROBE_TRUST_CODES;
    if (allowed.has(code)) return code;
    return phase === 'transport' ? 'hosted_manifest_unavailable' : 'invalid_hosted_manifest';
  };
  const runRemoteLifecycleProbe = async (snapshot) => {
    const checkedAt = probeIso();
    let document;
    try {
      document = await fetchHostedOcixManifest({ manifestUrl: snapshot.appEntryUrl, fetchImpl });
    } catch (error) {
      return {
        health: { status: 'unreachable', checkedAt, code: safeProbeCode(error, 'transport') },
        update: emptyRemoteUpdateProbe(),
      };
    }
    let remote;
    try {
      remote = verifyRemoteOcixManifest({ document, cryptoImpl });
      remote.connector = await preflightRemoteShellMetadata(remote);
    } catch (error) {
      const code = safeProbeCode(error, 'trust');
      return {
        health: { status: 'trust_invalid', checkedAt, code },
        update: { ...emptyRemoteUpdateProbe(), failure: { code } },
      };
    }
    if (remote.extensionId !== snapshot.extensionId) {
      const code = 'remote_identity_mismatch';
      return { health: { status: 'trust_invalid', checkedAt, code }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    if ((remote.extension?.name ?? remote.extensionId) !== snapshot.extensionName) {
      const code = 'remote_name_changed';
      return { health: { status: 'reachable', checkedAt }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    if (remote.publisher.id !== snapshot.publisher.id) {
      const code = 'remote_publisher_changed';
      return { health: { status: 'trust_invalid', checkedAt, code }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    if (remote.connector.id !== snapshot.connector.id
      || remote.connector.origin !== snapshot.connector.origin
      || remote.connector.authType !== 'api-key') {
      const code = 'remote_connector_changed';
      return { health: { status: 'reachable', checkedAt }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    if (remote.publisher.keyId === snapshot.publisher.keyId) {
      if (remote.publisher.fingerprint !== snapshot.publisher.fingerprint
        || remote.publisher.publicKey !== snapshot.publisherPublicKey) {
        const code = 'remote_trust_conflict';
        return { health: { status: 'trust_invalid', checkedAt, code }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
      }
    } else {
      // A new key id is a scoped re-consent candidate. A pre-existing global
      // slot with different bytes is still a conflict, but no global trust is
      // required for a first-time Remote key.
      const trust = await readTrustStore();
      const slot = trust.publishers?.[remote.publisher.id]?.keys?.[remote.publisher.keyId];
      if (slot && slot.fingerprint !== remote.publisher.fingerprint) {
        const code = 'remote_trust_conflict';
        return { health: { status: 'trust_invalid', checkedAt, code }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
      }
    }
    if (remote.version === snapshot.acceptedManifest.version) {
      const update = remote.manifestHash === snapshot.acceptedManifest.manifestHash
        ? emptyRemoteUpdateProbe()
        : { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_update_version_reuse' } };
      return { health: { status: 'reachable', checkedAt }, update };
    }
    const comparison = compareSemver(remote.version, snapshot.acceptedManifest.version);
    if (comparison === null) {
      const code = 'invalid_hosted_manifest';
      return { health: { status: 'reachable', checkedAt }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    if (comparison < 0 && remote.update.required !== true) {
      const code = 'remote_update_rollback_not_required';
      return { health: { status: 'reachable', checkedAt }, update: { ...emptyRemoteUpdateProbe(), failure: { code } } };
    }
    const { delta, added } = classifyPermissionDelta(snapshot.approvedPermissions, remote.permissions);
    const keyChanged = remote.publisher.keyId !== snapshot.publisher.keyId;
    return {
      health: { status: 'reachable', checkedAt },
      update: {
        status: remote.update.required === true ? 'required' : 'available',
        remoteVersion: remote.version,
        remoteManifestHash: remote.manifestHash,
        changeSummary: remote.update.changeSummary,
        permissionDelta: delta,
        addedPermissions: added,
        keyChanged,
        requiresUserConfirmation: keyChanged || delta === 'expanded',
        publisherFingerprint: remote.publisher.fingerprint,
        failure: null,
      },
    };
  };

  const runRemoteProbeOnce = async (extensionId, initialSnapshot) => {
    let snapshot = initialSnapshot;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const probe = await runRemoteLifecycleProbe(snapshot);
      const current = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      if (subjectsEqual(subjectFor(snapshot), subjectFor(current))) {
        const cachedAt = probeNow();
        if (cachedAt !== null) {
          storeRemoteLifecycle(extensionId, {
            extensionId,
            cachedAt,
            expiresAt: cachedAt + remoteProbeTtlMs,
            subject: subjectFor(current),
            probe,
          });
        }
        return { probe, snapshot: current, subject: subjectFor(current) };
      }
      snapshot = current;
    }
    throw new InteractiveUIExtensionManagerError(
      'Remote app changed while its update state was being verified',
      'remote_update_generation_changed',
      409,
    );
  };

  const resolveRemoteLifecycle = async (extensionId, { force = false } = {}) => {
    const existing = remoteProbeInFlight.get(extensionId);
    if (existing) {
      const result = await existing;
      const current = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      if (subjectsEqual(result.subject, subjectFor(current))) return { probe: result.probe, snapshot: current };
      const refreshed = await resolveRemoteLifecycle(extensionId, { force: true });
      return refreshed;
    }
    const snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
    const cached = !force && readCachedRemoteLifecycle(extensionId, snapshot);
    if (cached) return { probe: cached.probe, snapshot };
    const promise = runRemoteProbeOnce(extensionId, snapshot);
    remoteProbeInFlight.set(extensionId, promise);
    try {
      return await promise;
    } finally {
      if (remoteProbeInFlight.get(extensionId) === promise) remoteProbeInFlight.delete(extensionId);
    }
  };

  const buildLifecycleResult = ({ probe, snapshot }) => {
    const failure = probe.update.failure;
    let status = probe.update.status;
    let blocked = failure ? { code: failure.code } : null;
    const persisted = snapshot.persistedBlockedUpdate;
    if (!blocked && persisted) {
      const superseded = probe.health.status === 'reachable' && probe.update.status !== 'required';
      if (!superseded) {
        status = 'required';
        blocked = {
          code: 'remote_update_required_blocked',
          required: true,
          version: persisted.version,
          manifestHash: persisted.manifestHash,
          reason: persisted.reason,
        };
      }
    }
    return {
      status,
      currentVersion: snapshot.activeVersion,
      currentManifestHash: snapshot.acceptedManifest.manifestHash,
      remoteVersion: probe.update.remoteVersion,
      remoteManifestHash: probe.update.remoteManifestHash,
      changeSummary: probe.update.changeSummary,
      permissionDelta: probe.update.permissionDelta,
      addedPermissions: probe.update.addedPermissions ? clone(probe.update.addedPermissions) : null,
      keyChanged: probe.update.keyChanged,
      requiresUserConfirmation: probe.update.requiresUserConfirmation,
      publisherFingerprint: probe.update.publisherFingerprint,
      health: clone(probe.health),
      ...(blocked ? { blocked } : {}),
    };
  };
  const throwLifecycleCandidateFailure = (lifecycle) => {
    const code = lifecycle.blocked?.code;
    if (!code || code === 'remote_update_required_blocked') return;
    const failure = REMOTE_CANDIDATE_FAILURES[code];
    throw new InteractiveUIExtensionManagerError(
      failure?.message ?? 'Remote app update is invalid',
      code,
      failure?.status ?? 409,
    );
  };
  const requiredBlockedError = (lifecycle) => new InteractiveUIExtensionManagerError(
    'A required Remote app update is pending; review and apply it before using this app',
    'remote_update_required_blocked',
    409,
    {
      blocked: true,
      currentVersion: lifecycle.currentVersion,
      currentManifestHash: lifecycle.currentManifestHash,
      ...(lifecycle.remoteVersion ? { version: lifecycle.remoteVersion, manifestHash: lifecycle.remoteManifestHash } : {}),
      changeSummary: lifecycle.changeSummary,
      addedPermissions: lifecycle.addedPermissions,
      keyChanged: lifecycle.keyChanged,
      requiresUserConfirmation: lifecycle.requiresUserConfirmation,
    },
  );

  const persistRemoteBlockedUpdate = async (snapshot, lifecycle, reason) => mutate(async () => {
    const state = await readState();
    const extension = state.extensions[snapshot.extensionId];
    const metadata = extension?.versions?.[extension?.activeVersion];
    if (!extension || !metadata || metadata.delivery !== 'remote'
      || metadata.generationId !== snapshot.generationId
      || metadata.remote?.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash
      || metadata.remote?.appEntryUrl !== snapshot.appEntryUrl) return false;
    metadata.remote.blockedUpdate = {
      required: true,
      version: lifecycle.remoteVersion ?? snapshot.acceptedManifest.version,
      manifestHash: lifecycle.remoteManifestHash ?? snapshot.acceptedManifest.manifestHash,
      reason,
      observedAt: probeIso() ?? new Date().toISOString(),
    };
    await writeState(state);
    return true;
  });
  const blockedIdentity = (value) => isRecord(value) ? canonicalStringify({
    required: value.required === true,
    version: value.version,
    manifestHash: value.manifestHash,
    reason: value.reason,
    observedAt: value.observedAt,
  }) : null;
  const clearRemoteBlockedUpdate = async (snapshot) => {
    if (beforeClearRemoteBlockedUpdate) await beforeClearRemoteBlockedUpdate(snapshot.extensionId);
    return mutate(async () => {
      const state = await readState();
      const extension = state.extensions[snapshot.extensionId];
      const metadata = extension?.versions?.[extension?.activeVersion];
      if (!extension || !metadata || metadata.delivery !== 'remote'
        || metadata.generationId !== snapshot.generationId
        || metadata.remote?.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash) return false;
      const current = metadata.remote.blockedUpdate;
      if (current === undefined) return true;
      if (blockedIdentity(current) !== blockedIdentity(snapshot.persistedBlockedUpdate)) return false;
      delete metadata.remote.blockedUpdate;
      await writeState(state);
      return true;
    });
  };

  const applyRemoteUpdateState = async ({ snapshot, remote, connector, keyChanged, confirmationRequired }) => {
    const previousState = await readState();
    const extension = previousState.extensions[snapshot.extensionId];
    const metadata = extension?.versions?.[extension.activeVersion];
    if (!extension || !metadata || metadata.delivery !== 'remote') {
      throw new InteractiveUIExtensionManagerError('Extension is not a Remote OCIX app', 'remote_extension_required', 409);
    }
    if (metadata.generationId !== snapshot.generationId
      || metadata.remote.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash
      || metadata.remote.appEntryUrl !== snapshot.appEntryUrl) {
      throw new InteractiveUIExtensionManagerError('Remote app changed while the update was being applied', 'remote_update_generation_changed', 409);
    }
    const expected = buildExpectedRemoteShell(remote);
    const destination = pathImpl.join(versionsDirectory, extension.id, remote.version);
    const existing = extension.versions[remote.version];
    let reused = false;
    let consentTransaction = null;
    try {
      let agentRuntime = expected.agentRuntime;
      let fileHashes = expected.fileHashes;
      if (existing) {
        if (existing.packageHash !== remote.manifestHash || existing.delivery !== 'remote') {
          throw new InteractiveUIExtensionManagerError(`${extension.id}@${remote.version} is already installed from different package content`, 'version_conflict', 409);
        }
        await verifyRemoteShellSnapshot(extension, existing, pathImpl.join(versionsDirectory, extension.id), false);
        agentRuntime = clone(existing.agentRuntime);
        fileHashes = clone(existing.fileHashes);
        reused = true;
      } else {
        await ensureManagedDirectory(dataRoot, 'Manager data root');
        await ensureManagedDirectory(directory, 'Interactive UI Manager directory');
        await ensureManagedDirectory(versionsDirectory, 'Interactive UI versions directory');
        const extensionRoot = await ensureRemoteWriteChildDirectory(versionsDirectory, extension.id);
        let destinationExists = false;
        try {
          await fsImpl.lstat(destination);
          destinationExists = true;
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        let pending = await readRemotePendingCandidate(extension.id, remote.version);
        let pendingRecord = pending?.record ?? null;
        if (pending && (pending.record.appEntryUrl !== snapshot.appEntryUrl
          || pending.record.manifestHash !== remote.manifestHash
          || !hashMapsEqual(pending.expected.fileHashes, expected.fileHashes))) {
          throw new InteractiveUIExtensionManagerError(
            'Remote shell pending candidate belongs to a different app entry',
            'unmanaged_version_conflict',
            409,
          );
        }
        if (destinationExists) {
          if (pending) {
            // A previous write failed after reserving this exact path. Resume
            // only its exact signed prefix; arbitrary bytes never become
            // authority and are never overwritten.
            const residue = await verifyRemotePendingResidue(extension, destination, pending);
            if (!residue.complete) {
              if (!residue.markerPresent) {
                await writeRemoteIncompleteMarker(destination, pending.record);
              }
              await writeMissingExpectedRemoteFiles(destination, expected);
            }
            if (!hashMapsEqual(await fileHashesForDirectory(destination, { ignoreRemoteIncompleteMarker: true }), expected.fileHashes)) {
              throw new InteractiveUIExtensionManagerError(
                'Remote shell bytes differ from the deterministic signed shell',
                'remote_shell_integrity_failed',
                409,
              );
            }
          } else {
            // A prior failed activation may have left an exact deterministic
            // candidate orphan. A fresh, exact confirmation may adopt it; any
            // arbitrary/modified sibling still fails closed.
            await verifyReusableRemoteShell(remote, expected, pathImpl.join(versionsDirectory, extension.id));
          }
        } else {
          // Persist the candidate contract before making its deterministic
          // destination visible. This closes the crash window between mkdir
          // and marker creation: restart can tolerate only this exact,
          // authority-less pending prefix.
          pendingRecord ??= createRemotePendingRecord(
            remote,
            expected,
            snapshot.extensionName,
            snapshot.appEntryUrl,
          );
          if (!pending) {
            await writeRemotePendingCandidate(pendingRecord);
            pending = await readRemotePendingCandidate(extension.id, remote.version);
          }
          if (!pending || pending.record.transactionId !== pendingRecord.transactionId) {
            throw new InteractiveUIExtensionManagerError(
              'Remote shell pending candidate could not be verified',
              'remote_shell_integrity_failed',
              409,
            );
          }
          // mkdir is atomic and has no replace semantics on POSIX/macOS.
          // Never substitute a check-then-rename promotion here.
          await reserveRemoteWriteChildDirectory(
            extensionRoot,
            remote.version,
            `${extension.id}@${remote.version} already exists outside Manager state`,
          );
          await writeRemoteIncompleteMarker(destination, pendingRecord);
          await writeExpectedRemoteShell(destination, expected);
          if (!hashMapsEqual(await fileHashesForDirectory(destination, { ignoreRemoteIncompleteMarker: true }), expected.fileHashes)) {
            throw new InteractiveUIExtensionManagerError(
              'Remote shell bytes differ from the deterministic signed shell',
              'remote_shell_integrity_failed',
              409,
            );
          }
        }
      }
      const installedAt = new Date().toISOString();
      const nextState = clone(previousState);
      const nextExtension = nextState.extensions[snapshot.extensionId];
      const previousActive = nextExtension.activeVersion;
      // A required block belongs to the superseded active contract. Once the
      // exact candidate commits successfully, remove that historical marker
      // so a later legitimate rollback does not resurrect an already-applied
      // requirement or quarantine the old, still-verifiable shell.
      if (nextExtension.versions[previousActive]?.remote?.blockedUpdate) {
        delete nextExtension.versions[previousActive].remote.blockedUpdate;
      }
      const nextMetadata = {
        version: remote.version,
        packageHash: remote.manifestHash,
        installedAt,
        generationId: cryptoImpl.randomUUID(),
        source: { type: 'remote', appEntryUrl: snapshot.appEntryUrl },
        publisher: {
          id: remote.publisher.id,
          name: remote.publisher.name,
          keyId: remote.publisher.keyId,
          fingerprint: remote.publisher.fingerprint,
        },
        delivery: 'remote',
        agentRuntime: clone(agentRuntime),
        fileHashes: clone(fileHashes),
        remote: {
          appEntryUrl: snapshot.appEntryUrl,
          installationId: metadata.remote.installationId,
          publisherPublicKey: remote.publisher.publicKey,
          connectorRefs: [clone(connector)],
          acceptedManifest: {
            version: remote.version,
            manifestHash: remote.manifestHash,
            publishedAt: remote.publishedAt,
            keyId: remote.publisher.keyId,
            fetchedAt: installedAt,
          },
          approvedPermissions: clone(remote.permissions),
          status: 'active',
          connectedAt: metadata.remote.connectedAt,
          lastConsentAt: confirmationRequired ? installedAt : metadata.remote.lastConsentAt,
        },
      };
      nextExtension.name = snapshot.extensionName;
      nextExtension.versions[remote.version] = nextMetadata;
      nextExtension.activeVersion = remote.version;
      nextExtension.activationHistory = nextExtension.activationHistory.filter((candidate) => candidate !== remote.version);
      if (previousActive !== remote.version) nextExtension.activationHistory.push(previousActive);
      consentTransaction = await addRemoteConsent(nextExtension, nextMetadata);
      await verifyRemoteShellRoot(nextExtension, nextMetadata);
      const openCode = await commitStateWithActivation(previousState, nextState);
      await remoteResourceCache.clearExtension(snapshot.extensionId);
      return { extension: sanitizeExtension(nextExtension), applied: true, previousVersion: previousActive, openCode };
    } catch (error) {
      if (consentTransaction?.added) {
        await removeRemoteConsent(consentTransaction.record).catch(() => {});
      }
      // Never recursively delete or rename a candidate after an asynchronous
      // failure. A reserved root plus its durable pending record has no
      // state/consent authority, is ignored by root discovery, and can be
      // resumed or cleaned separately without making the prior active Remote
      // unavailable.
      throw error;
    }
  };

  const applyRemoteUpdateInternal = async (snapshot, options = {}) => {
    const remote = await fetchRemoteOcixManifest({ appEntryUrl: snapshot.appEntryUrl, fetchImpl, cryptoImpl });
    remote.appEntryUrl = snapshot.appEntryUrl;
    let connector;
    try {
      connector = await preflightRemoteShellMetadata(remote);
    } catch (error) {
      const code = safeProbeCode(error, 'trust');
      const status = code === 'invalid_hosted_manifest'
        ? 400
        : code === 'remote_connector_required' || code === 'remote_connector_ambiguous'
          ? 409
          : 403;
      throw new InteractiveUIExtensionManagerError(
        REMOTE_CANDIDATE_FAILURES[code]?.message ?? 'Remote app signed manifest is invalid',
        code,
        status,
      );
    }
    if (remote.extensionId !== snapshot.extensionId) {
      throw new InteractiveUIExtensionManagerError('Remote app identity does not match the installed extension', 'remote_identity_mismatch', 403);
    }
    if ((remote.extension?.name ?? remote.extensionId) !== snapshot.extensionName) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app extension name changed; reconnect instead of updating',
        'remote_name_changed',
        409,
      );
    }
    if (remote.publisher.id !== snapshot.publisher.id) {
      throw new InteractiveUIExtensionManagerError('Remote app publisher identity changed', 'remote_publisher_changed', 403);
    }
    if (connector.id !== snapshot.connector.id
      || connector.origin !== snapshot.connector.origin
      || connector.authType !== 'api-key') {
      throw new InteractiveUIExtensionManagerError('Remote app connector identity changed; reconnect instead of updating', 'remote_connector_changed', 409);
    }
    if (remote.publisher.keyId === snapshot.publisher.keyId
      && (remote.publisher.fingerprint !== snapshot.publisher.fingerprint || remote.publisher.publicKey !== snapshot.publisherPublicKey)) {
      throw new InteractiveUIExtensionManagerError('Remote app signing key conflicts with the trusted key', 'remote_trust_conflict', 403);
    }
    if (remote.publisher.keyId !== snapshot.publisher.keyId) {
      const trust = await readTrustStore();
      const slot = trust.publishers?.[remote.publisher.id]?.keys?.[remote.publisher.keyId];
      if (slot && slot.fingerprint !== remote.publisher.fingerprint) {
        throw new InteractiveUIExtensionManagerError('Remote app signing key conflicts with the trusted key', 'remote_trust_conflict', 403);
      }
    }
    if (remote.version === snapshot.acceptedManifest.version) {
      if (remote.manifestHash === snapshot.acceptedManifest.manifestHash) {
        throw new InteractiveUIExtensionManagerError('Remote app has no pending update', 'remote_update_none', 409);
      }
      throw new InteractiveUIExtensionManagerError(REMOTE_CANDIDATE_FAILURES.remote_update_version_reuse.message, 'remote_update_version_reuse', 409);
    }
    const comparison = compareSemver(remote.version, snapshot.acceptedManifest.version);
    if (comparison === null) throw new InteractiveUIExtensionManagerError('Remote app signed manifest is invalid', 'invalid_hosted_manifest', 400);
    if (comparison < 0 && remote.update.required !== true) {
      throw new InteractiveUIExtensionManagerError(REMOTE_CANDIDATE_FAILURES.remote_update_rollback_not_required.message, 'remote_update_rollback_not_required', 403);
    }
    const { delta, added } = classifyPermissionDelta(snapshot.approvedPermissions, remote.permissions);
    const keyChanged = remote.publisher.keyId !== snapshot.publisher.keyId;
    const confirmationRequired = keyChanged || delta === 'expanded';
    if (confirmationRequired
      && (options.confirmedManifestHash !== remote.manifestHash
        || options.confirmedPublisherFingerprint !== remote.publisher.fingerprint)) {
      if (remote.update.required === true) {
        await persistRemoteBlockedUpdate(snapshot, { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash }, 'confirmation-required');
      }
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher fingerprint and manifest hash must be confirmed before applying this update',
        'remote_confirmation_required',
        403,
        { update: { version: remote.version, manifestHash: remote.manifestHash, changeSummary: remote.update.changeSummary, permissionDelta: delta, addedPermissions: added, keyChanged } },
      );
    }
    if (remote.update.required === true) {
      const persisted = await persistRemoteBlockedUpdate(snapshot, { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash }, confirmationRequired ? 'confirmation-required' : 'required-observed');
      if (!persisted) throw new InteractiveUIExtensionManagerError('Remote app changed while the update was being applied', 'remote_update_generation_changed', 409);
    }
    try {
      return await mutate(() => applyRemoteUpdateState({ snapshot, remote, connector, keyChanged, confirmationRequired }));
    } catch (error) {
      if (remote.update.required === true) {
        await persistRemoteBlockedUpdate(snapshot, { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash }, 'apply-failed').catch(() => {});
      }
      throw error;
    }
  };

  const checkRemoteUpdate = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    let resolved;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      resolved = await resolveRemoteLifecycle(extensionId, { force: attempt === 0 && options.force === true || attempt > 0 });
      const lifecycle = buildLifecycleResult(resolved);
      throwLifecycleCandidateFailure(lifecycle);
      if (resolved.probe.update.status === 'required' && !resolved.probe.update.failure) {
        const persisted = await persistRemoteBlockedUpdate(resolved.snapshot, lifecycle, lifecycle.requiresUserConfirmation ? 'confirmation-required' : 'required-observed');
        if (!persisted) continue;
        resolved.snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      }
      if (resolved.snapshot.persistedBlockedUpdate && lifecycle.status !== 'required'
        && lifecycle.health.status === 'reachable') {
        if (await clearRemoteBlockedUpdate(resolved.snapshot)) {
          resolved.snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
        } else continue;
      }
      return buildLifecycleResult(resolved);
    }
    throw new InteractiveUIExtensionManagerError('Remote app changed while its update state was being verified', 'remote_update_generation_changed', 409);
  };

  const applyRemoteUpdate = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    const snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
    const result = await applyRemoteUpdateInternal(snapshot, options);
    return { extension: result.extension, applied: true, previousVersion: result.previousVersion, openCode: result.openCode };
  };

  const prepareRemoteUse = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resolved = await resolveRemoteLifecycle(extensionId, { force: attempt > 0 || options.force === true });
      const lifecycle = buildLifecycleResult(resolved);
      if (lifecycle.health.status === 'trust_invalid') {
        throw new InteractiveUIExtensionManagerError('Remote app trust is invalid; reconnect or re-consent before use', 'remote_trust_invalid', 403, { code: lifecycle.health.code });
      }
      throwLifecycleCandidateFailure(lifecycle);
      // A fresh reachable, valid non-required candidate supersedes an old
      // durable required block. Clear only the exact block captured by this
      // subject; a concurrent newer block loses the race and is re-resolved.
      if (resolved.snapshot.persistedBlockedUpdate
        && lifecycle.health.status === 'reachable'
        && resolved.probe.update.status !== 'required'
        && !lifecycle.blocked) {
        if (!await clearRemoteBlockedUpdate(resolved.snapshot)) continue;
        resolved.snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      }
      const eligibleRequired = lifecycle.status === 'required'
        && lifecycle.requiresUserConfirmation === false
        && lifecycle.health.status === 'reachable'
        && resolved.probe.update.status === 'required'
        && !resolved.probe.update.failure;
      if (lifecycle.blocked?.code === 'remote_update_required_blocked' && !eligibleRequired) throw requiredBlockedError(lifecycle);
      if (lifecycle.blocked && !eligibleRequired) throwLifecycleCandidateFailure(lifecycle);
      if (lifecycle.status === 'required') {
        if (lifecycle.requiresUserConfirmation) {
          await persistRemoteBlockedUpdate(resolved.snapshot, lifecycle, 'confirmation-required');
          throw requiredBlockedError(lifecycle);
        }
        try {
          const applied = await applyRemoteUpdateInternal(resolved.snapshot, { trigger: options.trigger });
          return { ...lifecycle, applied: true, previousVersion: applied.previousVersion };
        } catch (error) {
          if (error?.code === 'remote_update_generation_changed') continue;
          const fresh = await resolveRemoteLifecycle(extensionId, { force: true });
          const freshLifecycle = buildLifecycleResult(fresh);
          if (freshLifecycle.status === 'required' || freshLifecycle.health.status !== 'reachable' || freshLifecycle.blocked) {
            await persistRemoteBlockedUpdate(fresh.snapshot, freshLifecycle, 'apply-failed');
            throw requiredBlockedError(freshLifecycle);
          }
          return freshLifecycle;
        }
      }
      if (lifecycle.status === 'available') {
        if (lifecycle.requiresUserConfirmation) return lifecycle;
        try {
          const applied = await applyRemoteUpdateInternal(resolved.snapshot, { trigger: options.trigger });
          return { ...lifecycle, applied: true, previousVersion: applied.previousVersion };
        } catch (error) {
          if (error?.code === 'remote_update_generation_changed') continue;
          const fresh = await resolveRemoteLifecycle(extensionId, { force: true });
          const freshLifecycle = buildLifecycleResult(fresh);
          if (freshLifecycle.health.status === 'trust_invalid') throw new InteractiveUIExtensionManagerError('Remote app trust is invalid; reconnect or re-consent before use', 'remote_trust_invalid', 403, { code: freshLifecycle.health.code });
          throwLifecycleCandidateFailure(freshLifecycle);
          if (freshLifecycle.status === 'required') {
            await persistRemoteBlockedUpdate(fresh.snapshot, freshLifecycle, 'apply-failed');
            throw requiredBlockedError(freshLifecycle);
          }
          return freshLifecycle;
        }
      }
      if (resolved.snapshot.persistedBlockedUpdate) throw requiredBlockedError(lifecycle);
      return lifecycle;
    }
    throw new InteractiveUIExtensionManagerError('Remote app update state is unstable; retry', 'remote_update_required_blocked', 409);
  };

  const getRemoteLifecycle = async (extensionId) => {
    assertNamespacedId(extensionId, 'Extension id');
    return buildLifecycleResult(await resolveRemoteLifecycle(extensionId));
  };

  const getEnabledRemoteExtensionIds = async () => {
    const state = await readState();
    return Object.values(state.extensions).filter((extension) => {
      const active = extension.versions?.[extension.activeVersion];
      return extension.enabled === true && active?.delivery === 'remote';
    }).map((extension) => extension.id).sort(compareCodePoints);
  };

  const getBlockedRemoteCatalogEntries = async () => {
    const state = await readState();
    const entries = [];
    for (const extension of Object.values(state.extensions)) {
      if (extension.enabled !== true) continue;
      const metadata = extension.versions?.[extension.activeVersion];
      if (!metadata || metadata.delivery !== 'remote') continue;
      let shellBlocked = isRecord(metadata.remote?.blockedUpdate);
      let verifiedRoot = null;
      try {
        // Even an intentionally blocked app must bind every catalog surface
        // to its installed state, scoped consent, signed manifest, and exact
        // deterministic shell before any disk-derived metadata is exposed.
        verifiedRoot = await verifyRemoteShellRoot(extension, metadata);
      } catch {
        shellBlocked = true;
      }
      if (!shellBlocked) continue;
      const entry = { id: extension.id, name: extension.name, version: metadata.version, surfaces: [] };
      try {
        if (!verifiedRoot) throw new Error('Remote shell is not bound to its installed consent');
        const document = JSON.parse(await fsImpl.readFile(pathImpl.join(verifiedRoot, HOSTED_OCIX_SIGNED_MANIFEST_FILE), 'utf8'));
        const remote = verifyRemoteOcixManifest({ document, cryptoImpl });
        for (const view of remote.extension?.views ?? []) {
          if (isRecord(view) && typeof view.id === 'string') entry.surfaces.push({ surfaceId: view.id, surfaceKind: 'view', form: 'interactive-ui', runtime: view.runtime === 'native' ? 'native' : 'declarative', title: view.title ?? view.id });
        }
        for (const artifact of remote.extension?.artifacts ?? []) {
          if (isRecord(artifact) && typeof artifact.id === 'string') entry.surfaces.push({
            surfaceId: artifact.id,
            surfaceKind: 'artifact',
            form: 'html-artifact',
            runtime: 'artifact',
            title: typeof artifact.title === 'string' && artifact.title.trim() ? artifact.title.trim() : artifact.id,
          });
        }
      } catch {
        // Minimal blocked entry remains visible when shell re-verification fails.
      }
      entries.push(entry);
    }
    return entries;
  };

  const isWithin = (child, parent) => {
    const relative = pathImpl.relative(pathImpl.resolve(parent), pathImpl.resolve(child));
    return relative === '' || (!pathImpl.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathImpl.sep}`));
  };

  // Central authority classifier shared by runtime authorization and Remote
  // resource postflight. It never widens global trust: Remote identity is
  // anchored solely by installation metadata + consent.
  const classifyExtensionAuthority = async ({ extensionId, authority }) => {
    if (!isRecord(authority)
      || typeof authority.directory !== 'string'
      || typeof authority.extensionHash !== 'string'
      || !SHA256_PATTERN.test(authority.extensionHash)) {
      return { ok: false, code: 'remote_resource_authority_invalid', status: 409, message: 'Remote resource authority is invalid' };
    }
    const state = await readState();
    const extension = state.extensions[extensionId];
    const resolvedDirectory = pathImpl.resolve(authority.directory);
    if (!extension) {
      if (isRecord(authority.provenance) || isWithin(resolvedDirectory, versionsDirectory)) {
        return { ok: false, code: 'remote_shell_missing', status: 404, message: 'Remote extension is not installed' };
      }
      return { ok: true, kind: 'ordinary' };
    }
    if (!isRecord(authority.provenance) || typeof authority.provenance.generation !== 'string') {
      return { ok: false, code: 'remote_shell_integrity_failed', status: 409, message: 'Remote shell provenance is missing' };
    }
    const metadata = extension.versions?.[extension.activeVersion];
    if (!metadata || extension.enabled !== true) {
      return { ok: false, code: extension.enabled === false ? 'remote_shell_disabled' : 'remote_shell_integrity_failed', status: 409, message: 'Remote extension is unavailable' };
    }
    if (metadata.generationId !== authority.provenance.generation) {
      return { ok: false, code: 'remote_shell_integrity_failed', status: 409, message: 'Remote shell generation does not match the current installation' };
    }
    const activeDirectory = pathImpl.resolve(pathImpl.join(versionsDirectory, extension.id, extension.activeVersion));
    if (resolvedDirectory !== activeDirectory) {
      return { ok: false, code: 'remote_shell_integrity_failed', status: 409, message: 'Remote shell root does not match the active version' };
    }
    if (metadata.delivery === 'local') {
      try {
        await verifyInstalledVersionIntegrity(extension, metadata);
        const bytes = await fsImpl.readFile(pathImpl.join(activeDirectory, 'openchamber.extension.json'));
        const canonicalHash = packageHash(cryptoImpl, Buffer.from(canonicalStringify(JSON.parse(bytes.toString('utf8')))));
        if (canonicalHash !== authority.extensionHash) throw new Error('manifest authority mismatch');
      } catch (error) {
        return { ok: false, code: typeof error?.code === 'string' ? error.code : 'extension_integrity_failed', status: 409, message: 'Local extension integrity verification failed' };
      }
      return { ok: true, kind: 'local', extension, metadata };
    }
    if (metadata.delivery !== 'remote' || !isRecord(metadata.remote)) {
      return { ok: false, code: 'remote_shell_integrity_failed', status: 409, message: 'Remote shell state is invalid' };
    }
    if (metadata.remote.blockedUpdate) {
      return { ok: false, code: 'remote_update_required_blocked', status: 409, message: 'Remote extension is blocked by a required update' };
    }
    if (authority.signedManifestHash !== metadata.remote.acceptedManifest.manifestHash) {
      return { ok: false, code: 'remote_shell_integrity_failed', status: 409, message: 'Remote shell signed manifest does not match the accepted manifest' };
    }
    try {
      await verifyRemoteShellRoot(extension, metadata);
      const signedDocument = JSON.parse(await fsImpl.readFile(pathImpl.join(activeDirectory, HOSTED_OCIX_SIGNED_MANIFEST_FILE), 'utf8'));
      const remote = verifyRemoteOcixManifest({ document: signedDocument, cryptoImpl });
      const canonicalHash = packageHash(cryptoImpl, Buffer.from(canonicalStringify(remote.extension)));
      if (canonicalHash !== authority.extensionHash) throw new Error('manifest authority mismatch');
      return { ok: true, kind: 'remote', extension, metadata, manifest: remote };
    } catch (error) {
      return { ok: false, code: typeof error?.code === 'string' ? error.code : 'remote_shell_integrity_failed', status: 409, message: 'Remote shell integrity verification failed' };
    }
  };

  const throwAuthority = (decision) => {
    throw new InteractiveUIExtensionManagerError(decision.message, decision.code, decision.status);
  };
  const authorizeExtensionAuthority = (extensionId, authority) => mutate(async () => {
    assertNamespacedId(extensionId, 'Extension id');
    const decision = await classifyExtensionAuthority({ extensionId, authority });
    if (!decision.ok) throwAuthority(decision);
    return { authorized: true, kind: decision.kind, extensionId };
  });

  const resolveExtensionResource = async (extensionId, relativePath, authority) => {
    assertNamespacedId(extensionId, 'Extension id');
    const plan = await mutate(async () => {
      const decision = await classifyExtensionAuthority({ extensionId, authority });
      if (!decision.ok) throwAuthority(decision);
      if (decision.kind === 'ordinary' || decision.kind === 'local') return null;
      const normalizedPath = safeRelativePath(relativePath);
      if (!normalizedPath) throw new InteractiveUIExtensionManagerError('Remote resource path is invalid', 'invalid_hosted_resource', 400);
      const resource = decision.manifest.resources.find((candidate) => candidate.path === normalizedPath);
      if (!resource) throw new InteractiveUIExtensionManagerError('Remote resource is not declared in the signed manifest', 'invalid_hosted_resource', 404);
      const origin = new URL(resource.url).origin;
      if (!decision.metadata.remote.approvedPermissions.resourceOrigins.includes(origin)) {
        throw new InteractiveUIExtensionManagerError('Remote resource origin is not approved', 'hosted_permission_mismatch', 403);
      }
      return Object.freeze({
        extensionId,
        resource: Object.freeze({ path: resource.path, url: resource.url, mimeType: resource.mimeType, sha256: resource.sha256 }),
        manifestHash: decision.metadata.remote.acceptedManifest.manifestHash,
        authority: Object.freeze({
          directory: authority.directory,
          extensionHash: authority.extensionHash,
          signedManifestHash: authority.signedManifestHash,
          provenance: Object.freeze({ generation: authority.provenance?.generation }),
        }),
      });
    });
    if (plan === null) return null;
    const bytes = await remoteResourceCache.resolve({
      extensionId: plan.extensionId,
      resource: plan.resource,
      manifestHash: plan.manifestHash,
    });
    return mutate(async () => {
      const decision = await classifyExtensionAuthority({ extensionId, authority: plan.authority });
      if (!decision.ok || decision.kind !== 'remote') throwAuthority(decision.ok ? { message: 'Remote resource is no longer current', code: 'remote_shell_integrity_failed', status: 409 } : decision);
      const currentResource = decision.manifest.resources.find((candidate) => candidate.path === plan.resource.path);
      if (!currentResource
        || currentResource.url !== plan.resource.url
        || currentResource.mimeType !== plan.resource.mimeType
        || currentResource.sha256 !== plan.resource.sha256
        || decision.metadata.remote.acceptedManifest.manifestHash !== plan.manifestHash) {
        throw new InteractiveUIExtensionManagerError('Remote resource is no longer current', 'remote_shell_integrity_failed', 409);
      }
      return bytes;
    });
  };

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
      if (metadata.delivery === 'remote' && metadata.remote?.blockedUpdate) {
        throw new InteractiveUIExtensionManagerError(
          `${id}@${metadata.version} is blocked by a required update; apply it before use`,
          'remote_update_required_blocked',
          409,
        );
      }
    }
    if (previousExtension.versions[previousExtension.activeVersion]?.delivery === 'remote') {
      await remoteResourceCache.clearExtension(id);
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
    const activeMetadata = previousExtension.versions?.[previousExtension.activeVersion];
    if (activeMetadata?.delivery === 'remote' && activeMetadata.remote?.blockedUpdate) {
      throw new InteractiveUIExtensionManagerError(
        `${id}@${activeMetadata.version} is blocked by a required update; apply it before rollback`,
        'remote_update_required_blocked',
        409,
      );
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
    if (targetMetadata.delivery === 'remote' && targetMetadata.remote?.blockedUpdate) {
      throw new InteractiveUIExtensionManagerError(
        `${id}@${targetMetadata.version} is blocked by a required update; rollback target is unavailable`,
        'remote_update_required_blocked',
        409,
      );
    }
    if (targetMetadata.delivery === 'remote') {
      await verifyRemoteShellRoot(nextExtension, targetMetadata);
    } else {
      await verifyInstalledVersionIntegrity(nextExtension, targetMetadata);
    }
    const currentVersion = nextExtension.activeVersion;
    if (targetMetadata.delivery === 'remote' || nextExtension.versions[currentVersion]?.delivery === 'remote') {
      await remoteResourceCache.clearExtension(id);
    }
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
      if (remoteLifecycle) await remoteResourceCache.clearExtension(id);
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
      if (metadata.delivery === 'remote' && metadata.remote?.blockedUpdate) continue;
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
    initialize,
    inspectPackage,
    trustPublisher,
    removeTrustedPublisherKey,
    installPackage,
    inspectRemote,
    connectRemote,
    classifyExtensionAuthority,
    authorizeExtensionAuthority,
    resolveExtensionResource,
    checkRemoteUpdate,
    applyRemoteUpdate,
    prepareRemoteUse,
    getRemoteLifecycle,
    getEnabledRemoteExtensionIds,
    getBlockedRemoteCatalogEntries,
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
