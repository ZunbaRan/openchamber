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
const STATE_SCHEMA = 'openchamber://extension-manager-state/v1';
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

const corruptStore = (message = 'Extension trust store is invalid') =>
  new InteractiveUIExtensionManagerError(message, 'manager_data_corrupt', 500);

const corruptState = (message = 'Extension manager state is invalid') =>
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
      if (!isRecord(metadata.source) || metadata.source.type !== 'file' || Object.keys(metadata.source).length !== 1) {
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
        source: { type: 'file' },
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
  validateStagedPackage = null,
  reconcileActivation = null,
  logger = console,
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || !fsImpl || !pathImpl || !cryptoImpl) {
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
    return publisher.keys[keyId] ?? null;
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

  const installPackage = (buffer) => mutate(async () => {
    const verified = await verifyTrustedPackage(buffer);
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
          error instanceof Error ? error.message : 'Staged extension validation failed',
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
        source: { type: 'file' },
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

  const list = async () => {
    const [store, state] = await Promise.all([readTrustStore(), readState()]);
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
    return { apiVersion: 1, extensions, publishers, marketplaces: [] };
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
    installPackage,
    setEnabled,
    rollback,
    uninstall,
    getEnabledExtensionRoots,
    list,
  };
};
