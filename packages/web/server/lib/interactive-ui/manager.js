import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import {
  InteractiveUIPackageError,
  normalizeEd25519PublicKey,
  publicKeyFingerprint,
  verifyExtensionPackage,
} from './package-format.js';

const TRUST_SCHEMA = 'openchamber://extension-trust-store/v1';
const MAX_ID_CODE_UNITS = 128;
const MAX_DISPLAY_NAME_LENGTH = 200;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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

const emptyTrust = () => ({ $schema: TRUST_SCHEMA, publishers: Object.create(null) });

const corruptStore = (message = 'Extension trust store is invalid') =>
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
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || !fsImpl || !pathImpl || !cryptoImpl) {
    throw new Error('Interactive UI extension manager dependencies are incomplete');
  }
  const directory = pathImpl.join(pathImpl.resolve(dataDirectory), 'interactive-ui');
  const trustPath = pathImpl.join(directory, 'trust.json');
  let mutationQueue = Promise.resolve();

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
    return publisher.keys[keyId] ?? null;
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

  const list = async () => {
    const store = await readTrustStore();
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
    return { apiVersion: 1, extensions: [], publishers, marketplaces: [] };
  };

  const inspectPackage = async (buffer) => {
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

  return {
    inspectPackage,
    trustPublisher,
    removeTrustedPublisherKey,
    list,
  };
};
