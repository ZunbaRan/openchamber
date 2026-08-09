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

const TRUST_SCHEMA = 'openchamber://extension-trust-store/v1';
const STATE_SCHEMA = 'openchamber://extension-manager-state/v1';
const MARKETPLACES_SCHEMA = 'openchamber://extension-marketplaces/v1';
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
const MANUAL_SOURCE = 'manual';
const PACKAGE_CONFIRMATION_SOURCE = 'package-confirmation';

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

const validateState = (parsed) => {
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
      if (metadata.publisher.name !== publisherName || metadata.delivery !== 'local' || !isRecord(metadata.agentRuntime)) {
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
      versions[version] = {
        version: normalizedVersion,
        packageHash: metadata.packageHash,
        installedAt: assertStoredInstalledAt(metadata.installedAt),
        generationId: metadata.generationId,
        source,
        publisher: {
          id: publisherId,
          name: publisherName,
          keyId,
          fingerprint: assertStoredFingerprint(metadata.publisher.fingerprint),
        },
        delivery: 'local',
        agentRuntime: clone(metadata.agentRuntime),
        fileHashes,
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

const sanitizeExtension = (extension) => {
  const result = clone(extension);
  for (const metadata of Object.values(result.versions ?? {})) {
    if (!isRecord(metadata)) continue;
    delete metadata.fileHashes;
    delete metadata.generationId;
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
  if (reconcileActivation !== null && typeof reconcileActivation !== 'function') {
    throw new Error('Interactive UI extension manager activation reconciler is invalid');
  }
  const directory = pathImpl.join(pathImpl.resolve(dataDirectory), 'interactive-ui');
  const trustPath = pathImpl.join(directory, 'trust.json');
  const statePath = pathImpl.join(directory, 'installations.json');
  const marketplacesPath = pathImpl.join(directory, 'marketplaces.json');
  const versionsDirectory = pathImpl.join(pathImpl.resolve(dataDirectory), 'extensions');
  const stagingDirectory = pathImpl.join(directory, 'staging');
  const trashDirectory = pathImpl.join(directory, 'trash');
  let mutationQueue = Promise.resolve();
  const reportedQuarantines = new Set();

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
    return validateState(parsed);
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
      await verifyInstalledVersionIntegrity(
        previousExtension,
        previousExtension.versions[previousExtension.activeVersion],
      );
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
    await verifyInstalledVersionIntegrity(nextExtension, nextExtension.versions[targetVersion]);
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
    if (!previousState.extensions[id]) {
      throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    }
    const source = pathImpl.join(versionsDirectory, id);
    const trashPath = pathImpl.join(trashDirectory, `${id}-${cryptoImpl.randomUUID()}`);
    let moved = false;
    await fsImpl.mkdir(trashDirectory, { recursive: true, mode: 0o700 });
    try {
      await fsImpl.rename(source, trashPath);
      moved = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const nextState = clone(previousState);
    delete nextState.extensions[id];
    try {
      const openCode = await commitStateWithActivation(previousState, nextState);
      return {
        removed: true,
        recoveryId: moved ? pathImpl.basename(trashPath) : null,
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
        const versionDirectory = await verifyInstalledVersionIntegrity(extension, metadata);
        roots.push({ directory: versionDirectory, provenance: { generation: metadata.generationId } });
      } catch (error) {
        if (error?.code !== 'extension_integrity_failed' && error?.code !== 'extension_integrity_unavailable') throw error;
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
