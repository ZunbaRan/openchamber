import crypto from 'node:crypto';
import nodeFs from 'node:fs';
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
  createHostedOcixCacheIntegrity,
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  materializeHostedOcix,
  verifyHostedOcixCacheIntegrity,
  verifyHostedOcixManifest,
} from './hosted-ocix.js';
import { reconcileOpenCodeAgentRuntime } from './agent-runtime.js';
import { createInteractiveUIRuntime, normalizeExtensionManifest } from './runtime.js';
import {
  fetchRemoteOcixManifest,
  hostedSurfaceBindings,
  selectRemoteConnector,
  verifyRemoteOcixManifest,
} from './remote-ocix.js';
import { createRemoteResourceCache } from './remote-resource-cache.js';
import { safeRelativePath } from './hosted-ocix.js';

const STATE_SCHEMA = 'openchamber://extension-manager-state/v1';
const TRUST_SCHEMA = 'openchamber://extension-trust-store/v1';
const MARKETPLACES_SCHEMA = 'openchamber://extension-marketplaces/v1';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const BLOCKED_KEY_IDS = new Set(['__proto__', 'prototype', 'constructor']);

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

class InteractiveUIExtensionManagerError extends Error {
  constructor(message, code = 'extension_manager_error', status = 400, details = undefined) {
    super(message);
    this.name = 'InteractiveUIExtensionManagerError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const emptyState = () => ({ $schema: STATE_SCHEMA, extensions: {}, agentRuntime: { assets: {} } });
const emptyTrust = () => ({ $schema: TRUST_SCHEMA, publishers: {} });
const emptyMarketplaces = () => ({ $schema: MARKETPLACES_SCHEMA, marketplaces: {} });
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const packageHash = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

// No-follow/no-block open flags for manager-owned Hosted cache entry reads
// where the platform supports them (0 on Windows, degrading safely to
// O_RDONLY).
const MANAGED_MANIFEST_FILE = 'openchamber.extension.json';
// Narrow containment check using resolved paths and path components with
// the INJECTED pathImpl (never naive prefix string matching): true when the
// resolved directory IS the managed versions tree root (relative === '') or
// is a descendant of it. A first component that merely STARTS with two dots
// (for example '..managed') is a legitimate descendant name, so only an
// exact parent ('..') or a parent followed by the platform separator counts
// as outside.
const isWithinManagedVersionsTree = (resolvedDirectory, versionsDirectoryResolved, pathImplRef) => {
  const relative = pathImplRef.relative(versionsDirectoryResolved, resolvedDirectory);
  return relative === ''
    || (!pathImplRef.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${pathImplRef.sep}`));
};
const HOSTED_ENTRY_READ_FLAGS = (typeof nodeFs.constants?.O_NOFOLLOW === 'number' ? nodeFs.constants.O_NOFOLLOW : 0)
  | (typeof nodeFs.constants?.O_NONBLOCK === 'number' ? nodeFs.constants.O_NONBLOCK : 0);

const assertNamespacedId = (value, label) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new InteractiveUIExtensionManagerError(`${label} must be a namespaced identifier`, 'invalid_identifier');
  }
  return value;
};

const assertKeyId = (value) => {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value) || BLOCKED_KEY_IDS.has(value)) {
    throw new InteractiveUIExtensionManagerError('Key id is invalid', 'invalid_key_id');
  }
  return value;
};

const assertDisplayName = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new InteractiveUIExtensionManagerError(`${label} is required`, 'invalid_name');
  }
  return value.trim();
};

const normalizeRemoteUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new InteractiveUIExtensionManagerError(`${label} must be an absolute URL`, 'invalid_url');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) || parsed.username || parsed.password) {
    throw new InteractiveUIExtensionManagerError(`${label} must use HTTPS (HTTP is allowed only for loopback) and cannot contain credentials`, 'unsafe_url');
  }
  return parsed.toString();
};

const readJson = async (fsImpl, filePath, fallback, schema) => {
  try {
    const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
    if (!isRecord(parsed) || parsed.$schema !== schema) throw new Error('unsupported schema');
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback();
    throw new InteractiveUIExtensionManagerError(
      `Extension manager data is unreadable: ${nodePath.basename(filePath)}`,
      'manager_data_corrupt',
      500,
    );
  }
};

const atomicWriteJson = async (fsImpl, pathImpl, cryptoImpl, filePath, value) => {
  await fsImpl.mkdir(pathImpl.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${cryptoImpl.randomUUID()}.tmp`;
  try {
    await fsImpl.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fsImpl.rename(temporaryPath, filePath);
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const responseBytes = async (response, maxBytes, label) => {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new InteractiveUIExtensionManagerError(`${label} exceeds the size limit`, 'remote_content_too_large', 413);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new InteractiveUIExtensionManagerError(`${label} exceeds the size limit`, 'remote_content_too_large', 413);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new InteractiveUIExtensionManagerError(`${label} exceeds the size limit`, 'remote_content_too_large', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
};

const placeholderEnvironment = (manifest, environment) => {
  const result = { ...environment };
  const serialized = JSON.stringify(manifest);
  for (const match of serialized.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
    if (!result[match[1]]) result[match[1]] = 'https://extension-install.invalid';
  }
  return result;
};

const sanitizeTrust = (trust) => ({
  publishers: Object.values(trust.publishers ?? {}).map((publisher) => ({
    id: publisher.id,
    name: publisher.name,
    keys: Object.values(publisher.keys ?? {}).map(({ publicKey: _publicKey, ...key }) => key),
  })),
});

const sanitizeMarketplaces = (marketplaces) => ({
  marketplaces: Object.values(marketplaces.marketplaces ?? {}).map(({ publicKey: _publicKey, ...marketplace }) => marketplace),
});

const summarizeRemoteReview = (remote, trusted) => ({
  extension: {
    id: remote.extensionId,
    name: typeof remote.extension?.name === 'string' ? remote.extension.name : remote.extensionId,
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
  connector: remote.connector,
});

// trusted means the stored trust record for this publisher/keyId carries the
// SAME key as the candidate: the stored public key is re-normalized and
// re-fingerprinted locally and compared against the candidate fingerprint. A
// same publisher/keyId slot occupied by a different key is NOT trusted.
const remotePublisherTrusted = (trust, publisher, cryptoImpl) => {
  const stored = trust?.publishers?.[publisher?.id]?.keys?.[publisher?.keyId];
  if (!isRecord(stored) || typeof stored.publicKey !== 'string' || !stored.publicKey) return false;
  try {
    return publicKeyFingerprint(stored.publicKey, cryptoImpl) === publisher?.fingerprint;
  } catch {
    return false;
  }
};

// Metadata-only validation of the signed Remote manifest's extension document
// using the SAME single-sourced runtime normalization used at load time. It
// validates connectors (auth type/placement/baseUrl vs
// extension.permissions.network), actions and connector references,
// views/artifacts/dashboard/routing, Native trust.mode, duplicate identities,
// and every other pure-metadata rule — without reading any entry/resource
// bytes and without fetching resources. Runtime schema errors keep their
// stable codes (e.g. network_not_allowed, invalid_manifest).
const validateRemoteExtensionMetadata = (extension, environment) => {
  try {
    return normalizeExtensionManifest(extension, environment);
  } catch (error) {
    throw new InteractiveUIExtensionManagerError(
      `Remote extension metadata is invalid: ${error instanceof Error ? error.message : 'invalid manifest'}`,
      typeof error?.code === 'string' ? error.code : 'invalid_manifest',
      error?.status ?? 400,
    );
  }
};

// Runtime entry extension allowlists, mirroring resolveEntryPath exactly.
const REMOTE_ENTRY_EXTENSIONS = {
  declarative: ['.json'],
  native: ['.mjs', '.js'],
  artifact: ['.html'],
  icon: ['.svg', '.png'],
};

// Every shell-consumed resource reference (view/artifact/icon entries) must be
// a safe declared resources[] path using the SAME path rules as the Hosted
// OCIX kernel (safeRelativePath) and the runtime entry extension rules. This
// rejects traversal such as ../../escape.txt and missing/ambiguous resource
// references without reading or fetching any resource bytes.
const validateRemoteResourceEntries = (extension, resources) => {
  const resourceByPath = new Map(resources.map((resource) => [resource.path, resource]));
  const requireDeclaredResource = (entry, label, allowedExtensions) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry is missing`,
        'invalid_hosted_resource',
        400,
      );
    }
    const normalizedPath = safeRelativePath(entry);
    if (!normalizedPath) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry is not a safe relative path: ${entry}`,
        'invalid_hosted_resource',
        400,
        { path: entry },
      );
    }
    if (allowedExtensions && !allowedExtensions.some((extension) => normalizedPath.endsWith(extension))) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry has an unsupported file type: ${normalizedPath}`,
        'invalid_entry',
        400,
        { path: normalizedPath },
      );
    }
    if (!resourceByPath.has(normalizedPath)) {
      throw new InteractiveUIExtensionManagerError(
        `Remote extension ${label} entry is not declared in the manifest resources: ${normalizedPath}`,
        'invalid_hosted_resource',
        400,
        { path: normalizedPath },
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
  if (typeof extension?.icon === 'string' && extension.icon.trim()) {
    requireDeclaredResource(extension.icon, 'icon', REMOTE_ENTRY_EXTENSIONS.icon);
  }
};

// Single write-free Remote preflight shared by inspectRemote and connectRemote:
// complete runtime metadata validation, shell-consumed resource entry
// validation against the declared resources[], and the exact hosted Agent
// Runtime surface-tool binding constraints. Metadata-only: reads/fetches zero
// resource bytes. Runs before trust, staging, Manager state, Agent Runtime,
// or Secret Store writes.
const preflightRemoteShellMetadata = (remote, environment) => {
  const normalizedExtension = validateRemoteExtensionMetadata(remote.extension, environment);
  validateRemoteResourceEntries(remote.extension, remote.resources);
  hostedSurfaceBindings(remote.extension);
  return normalizedExtension;
};

// Phase R1 exact-one-api-key policy applied against the validated metadata:
// the normalized connector list must contain exactly the selected raw
// connector, with api-key auth. Keeps the raw selection (selectRemoteConnector)
// authoritative while preventing drift between the two validation layers.
const assertRemoteConnectorMatchesValidation = (connector, normalizedExtension) => {
  const normalizedConnectors = Array.isArray(normalizedExtension?.connectors)
    ? normalizedExtension.connectors
    : [];
  if (normalizedConnectors.length !== 1
    || normalizedConnectors[0]?.id !== connector.id
    || normalizedConnectors[0]?.auth?.type !== 'api-key') {
    throw new InteractiveUIExtensionManagerError(
      'Remote app connector does not match its validated metadata',
      'remote_connector_ambiguous',
      409,
    );
  }
  return normalizedConnectors[0];
};

// Redacts every manager-internal authority field from a CLONED extension
// record: fileHashes, the private lifecycle generationId, Hosted
// lastGood.integrity, and Remote installationId. This is the ONE reusable
// extension-output sanitizer and is applied to EVERY manager method result
// that can reach HTTP/API callers (list, installPackage,
// installFromMarketplace, refreshHosted, setEnabled, rollback, and the
// internal install paths). It is never applied to the internal structured
// root descriptors (getEnabledExtensionRoots) or the resolver authority,
// which must keep carrying provenance internally.
const sanitizeExtensionOutput = (extension) => {
  const result = clone(extension);
  for (const version of Object.values(result.versions ?? {})) {
    if (isRecord(version)) {
      delete version.fileHashes;
      delete version.generationId;
      if (isRecord(version.hosted?.lastGood)) delete version.hosted.lastGood.integrity;
      if (isRecord(version.remote)) delete version.remote.installationId;
    }
  }
  return result;
};

const sanitizeExtensions = (state, integrityByExtension = {}) => Object.values(state.extensions ?? {}).map((extension) => {
  const result = sanitizeExtensionOutput(extension);
  result.integrity = clone(integrityByExtension[extension.id] ?? { status: 'unknown' });
  return result;
});

const normalizeStoredFilePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  const normalized = nodePath.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
};

const summarizeAgentRouting = (manifest) => isRecord(manifest?.agentRouting)
  ? {
      domain: manifest.agentRouting.domain,
      intents: clone(manifest.agentRouting.intents),
      dataAuthority: manifest.agentRouting.dataAuthority,
      views: (Array.isArray(manifest.views) ? manifest.views : []).map((view) => ({
        id: view.id,
        tools: clone(view.tools ?? []),
        routing: isRecord(view.routing)
          ? {
              intents: clone(view.routing.intents ?? []),
              priority: view.routing.priority ?? 50,
              operation: view.routing.operation ?? 'read',
            }
          : null,
      })),
      artifacts: (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).map((artifact) => ({
        id: artifact.id,
        tools: clone(artifact.tools ?? []),
        routing: isRecord(artifact.routing)
          ? {
              intents: clone(artifact.routing.intents ?? []),
              priority: artifact.routing.priority ?? 50,
              operation: artifact.routing.operation ?? 'read',
            }
          : null,
      })),
    }
  : null;

const summarizeVerifiedPackage = (verified, hosted = null) => ({
  extension: {
    id: verified.manifest.id,
    name: verified.manifest.name,
    version: verified.manifest.version,
  },
  publisher: {
    id: verified.packageIndex.publisher.id,
    name: verified.packageIndex.publisher.name,
    keyId: verified.packageIndex.publisher.keyId,
    fingerprint: verified.publisherFingerprint,
    trusted: verified.publisherTrusted,
  },
  permissions: {
    network: Array.isArray(verified.manifest.permissions?.network)
      ? verified.manifest.permissions.network.filter((value) => typeof value === 'string')
      : [],
    nativeCode: hosted
      ? hosted.permissions.nativeCode === true
      : verified.manifest.trust?.mode === 'native-code',
    sandboxedArtifacts: Array.isArray(hosted?.extension?.artifacts)
      ? hosted.extension.artifacts.length > 0
      : Array.isArray(verified.manifest.artifacts) && verified.manifest.artifacts.length > 0,
  },
  agentRouting: summarizeAgentRouting(verified.manifest),
  agentRuntime: clone(verified.agentRuntime),
  delivery: verified.manifest.delivery?.type === 'hosted' ? 'hosted' : 'local',
  ...(hosted ? {
    hosted: {
      manifestUrl: verified.manifest.delivery.manifestUrl,
      ttlSeconds: verified.manifest.delivery.ttlSeconds,
      manifestHash: hosted.manifestHash,
      version: hosted.version,
      publishedAt: hosted.publishedAt,
      permissions: clone(hosted.permissions),
    },
  } : {}),
});

export const createInteractiveUIExtensionManager = ({
  dataDirectory,
  opencodeConfigDirectory,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = crypto,
  fetchImpl = globalThis.fetch,
  environment = process.env,
  logger = console,
  refreshOpenCode = async () => ({ reloaded: false, external: false }),
  builtInRuntime = null,
  runtimeVersion = '0.0.0',
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || typeof fetchImpl !== 'function') {
    throw new Error('Interactive UI extension manager dependencies are incomplete');
  }
  const root = pathImpl.resolve(dataDirectory);
  const managerDirectory = pathImpl.join(root, 'interactive-ui');
  const statePath = pathImpl.join(managerDirectory, 'installations.json');
  const trustPath = pathImpl.join(managerDirectory, 'trust.json');
  const marketplacesPath = pathImpl.join(managerDirectory, 'marketplaces.json');
  const versionsDirectory = pathImpl.join(root, 'extensions');
  const hostedCacheDirectory = pathImpl.join(managerDirectory, 'hosted-cache');
  // Remote Phase R2 lazy resource cache: lives OUTSIDE the managed Remote
  // shell/version directory so verifyInstalledVersionIntegrity and the
  // metadata-only shell remain valid.
  // Manager-owned, PROCESS-LIFETIME in-memory TTL resource cache (Remote
  // Phase R2). Intentionally non-durable: a process restart drops all entries
  // (safe early invalidation) and there is NO persistent filesystem
  // representation, so no cache directory is created or scanned.
  const remoteResourceCache = createRemoteResourceCache({
    fetchImpl,
    cryptoImpl,
  });
  const stagingDirectory = pathImpl.join(managerDirectory, 'staging');
  const trashDirectory = pathImpl.join(managerDirectory, 'trash');
  const resolvedOpenCodeConfigDirectory = pathImpl.resolve(
    opencodeConfigDirectory ?? pathImpl.join(managerDirectory, 'opencode-config'),
  );
  let builtInRuntimeStatus = builtInRuntime
    ? { id: builtInRuntime.extensionId, version: builtInRuntime.version, status: 'pending' }
    : { status: 'not-configured' };
  let mutationQueue = Promise.resolve();
  const reportedQuarantines = new Set();

  const mutate = (operation) => {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => {});
    return pending;
  };

  const readState = async () => {
    const state = await readJson(fsImpl, statePath, emptyState, STATE_SCHEMA);
    if (!isRecord(state.extensions)) throw new InteractiveUIExtensionManagerError('Extension manager state is invalid', 'manager_data_corrupt', 500);
    if (state.agentRuntime === undefined) state.agentRuntime = { assets: {} };
    if (!isRecord(state.agentRuntime) || !isRecord(state.agentRuntime.assets)) {
      throw new InteractiveUIExtensionManagerError('Extension manager Agent Runtime state is invalid', 'manager_data_corrupt', 500);
    }
    for (const [id, extension] of Object.entries(state.extensions)) {
      if (isRecord(extension) && extension.activationHistory === undefined) extension.activationHistory = [];
      if (isRecord(extension) && extension.enabled === undefined) extension.enabled = true;
      if (!ID_PATTERN.test(id) || !isRecord(extension) || extension.id !== id || typeof extension.enabled !== 'boolean'
        || !SEMVER_PATTERN.test(extension.activeVersion ?? '') || !isRecord(extension.versions)
        || !isRecord(extension.versions[extension.activeVersion]) || !Array.isArray(extension.activationHistory)
        || extension.activationHistory.some((version) => !SEMVER_PATTERN.test(version))) {
        throw new InteractiveUIExtensionManagerError('Extension manager state is invalid', 'manager_data_corrupt', 500);
      }
      for (const [version, metadata] of Object.entries(extension.versions)) {
        if (!SEMVER_PATTERN.test(version) || !isRecord(metadata) || metadata.version !== version) {
          throw new InteractiveUIExtensionManagerError('Extension manager state is invalid', 'manager_data_corrupt', 500);
        }
        if (metadata.fileHashes !== undefined && (!isRecord(metadata.fileHashes)
          || Object.entries(metadata.fileHashes).some(([filePath, hash]) => !normalizeStoredFilePath(filePath) || !SHA256_PATTERN.test(hash ?? '')))) {
          throw new InteractiveUIExtensionManagerError('Extension manager state is invalid', 'manager_data_corrupt', 500);
        }
      }
    }
    return state;
  };

  const commitStateWithAgentRuntime = async (previousState, nextState, { reload = true } = {}) => {
    const runtimeState = await createRuntimeSafeState(nextState);
    const deployment = await reconcileOpenCodeAgentRuntime({
      state: runtimeState,
      previousAssets: previousState.agentRuntime?.assets ?? {},
      configDirectory: resolvedOpenCodeConfigDirectory,
      versionsDirectory,
      hostedCacheDirectory,
      builtInRuntime,
      fsImpl,
      pathImpl,
      cryptoImpl,
    });
    nextState.agentRuntime = { assets: deployment.assets };
    try {
      await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, statePath, nextState);
    } catch (error) {
      await deployment.rollback();
      throw error;
    }
    if (!deployment.changed || !reload) return { changed: deployment.changed, reloaded: false, external: false };
    try {
      return { changed: true, ...await refreshOpenCode() };
    } catch (error) {
      logger.error?.('[InteractiveUI] Agent Runtime files changed, but OpenCode refresh failed', error);
      return {
        changed: true,
        reloaded: false,
        external: false,
        refreshError: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const readTrust = async () => {
    const trust = await readJson(fsImpl, trustPath, emptyTrust, TRUST_SCHEMA);
    if (!isRecord(trust.publishers)) throw new InteractiveUIExtensionManagerError('Publisher trust store is invalid', 'manager_data_corrupt', 500);
    return trust;
  };
  const readMarketplaces = async () => {
    const marketplaces = await readJson(fsImpl, marketplacesPath, emptyMarketplaces, MARKETPLACES_SCHEMA);
    if (!isRecord(marketplaces.marketplaces)) throw new InteractiveUIExtensionManagerError('Marketplace configuration is invalid', 'manager_data_corrupt', 500);
    return marketplaces;
  };

  const writeVerifiedFiles = async (directory, files) => {
    for (const [relativePath, content] of files) {
      const target = pathImpl.join(directory, ...relativePath.split('/'));
      const relative = pathImpl.relative(directory, target);
      if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
        throw new InteractiveUIExtensionManagerError('Package extraction escaped its staging directory', 'invalid_package_path');
      }
      await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true });
      await fsImpl.writeFile(target, content, { flag: 'wx', mode: 0o644 });
    }
  };

  const fileHashesFromPackageIndex = (packageIndex) => Object.fromEntries(
    (Array.isArray(packageIndex?.files) ? packageIndex.files : []).map((file) => [file.path, file.sha256]),
  );

  const collectInstalledFiles = async (directory, current = directory, result = []) => {
    const entries = await fsImpl.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = pathImpl.join(current, entry.name);
      const stat = await fsImpl.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new InteractiveUIExtensionManagerError('Installed extension contains a symlink', 'extension_integrity_failed', 409);
      }
      if (stat.isDirectory()) {
        await collectInstalledFiles(directory, absolute, result);
        continue;
      }
      if (!stat.isFile()) {
        throw new InteractiveUIExtensionManagerError('Installed extension contains an unsupported filesystem entry', 'extension_integrity_failed', 409);
      }
      result.push(pathImpl.relative(directory, absolute).split(pathImpl.sep).join('/'));
    }
    return result;
  };

  const verifyInstalledVersionIntegrity = async (extension, metadata, directory) => {
    if (!isRecord(metadata.fileHashes) || Object.keys(metadata.fileHashes).length === 0) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no signed file integrity record; reinstall the extension`,
        'extension_integrity_unavailable',
        409,
      );
    }
    const expectedPaths = Object.keys(metadata.fileHashes).sort();
    let actualPaths;
    try {
      actualPaths = (await collectInstalledFiles(directory)).sort();
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
    let verifiedManifestBytes = null;
    for (const relativePath of expectedPaths) {
      const target = pathImpl.join(directory, ...relativePath.split('/'));
      const relative = pathImpl.relative(directory, target);
      if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
        throw new InteractiveUIExtensionManagerError('Installed extension integrity path is invalid', 'extension_integrity_failed', 409);
      }
      const content = await fsImpl.readFile(target);
      if (packageHash(cryptoImpl, content) !== metadata.fileHashes[relativePath]) {
        throw new InteractiveUIExtensionManagerError(
          `${extension.id}@${metadata.version} has been modified since installation`,
          'extension_integrity_failed',
          409,
        );
      }
      // Retain the exact signed-and-hash-verified openchamber.extension.json
      // bytes read through THIS verification loop (no second unlocked
      // pathname read), so the Local authority classification can bind the
      // captured manifest to the signed current document.
      if (relativePath === MANAGED_MANIFEST_FILE) verifiedManifestBytes = content;
    }
    return { manifestBytes: verifiedManifestBytes };
  };

  const inspectInstalledVersionIntegrity = async (extension, metadata) => {
    const directory = pathImpl.join(versionsDirectory, extension.id, metadata.version);
    try {
      await verifyInstalledVersionIntegrity(extension, metadata, directory);
      return { status: 'ready' };
    } catch (error) {
      if (error?.code === 'extension_integrity_unavailable') {
        return { status: 'unavailable', code: error.code };
      }
      if (error?.code === 'extension_integrity_failed') {
        return { status: 'failed', code: error.code };
      }
      throw error;
    }
  };

  const createRuntimeSafeState = async (state) => {
    const runtimeState = clone(state);
    for (const extension of Object.values(runtimeState.extensions ?? {})) {
      if (!extension.enabled) continue;
      const active = extension.versions?.[extension.activeVersion];
      if (!active) continue;
      const integrity = await inspectInstalledVersionIntegrity(extension, active);
      if (integrity.status !== 'ready') extension.enabled = false;
      if (active.delivery === 'hosted' && extension.enabled) {
        const hostedIntegrity = await inspectHostedCacheIntegrity(extension, active);
        if (hostedIntegrity.status !== 'ready') extension.enabled = false;
      }
      if (active.delivery === 'remote' && extension.enabled) {
        const remoteIntegrity = await inspectRemoteShellIntegrity(extension, active);
        if (remoteIntegrity.status !== 'ready') extension.enabled = false;
      }
    }
    return runtimeState;
  };

  const validateExtensionRoot = async (directory, extensionId, manifest) => {
    const runtime = createInteractiveUIRuntime({
      fsPromises: fsImpl,
      path: pathImpl,
      crypto: cryptoImpl,
      fetchImpl,
      extensionRoots: [directory],
      environment: placeholderEnvironment(manifest, environment),
      logger: { warn() {}, info() {} },
    });
    const listed = await runtime.listExtensions();
    if (listed.errors.length || listed.extensions.length !== 1 || listed.extensions[0].id !== extensionId) {
      throw new InteractiveUIExtensionManagerError(
        listed.errors[0]?.error || 'Installed extension failed runtime validation',
        'extension_validation_failed',
      );
    }
    try {
      for (const view of listed.extensions[0].views) {
        await runtime.getViewDescriptor(view.id, view.tools[0] ?? '');
      }
      for (const artifact of listed.extensions[0].artifacts) {
        await runtime.getInstalledArtifactDescriptor(artifact.id, artifact.tools[0] ?? '');
        await runtime.getInstalledArtifactDocument(listed.extensions[0].id, artifact.id);
      }
    } catch (error) {
      throw new InteractiveUIExtensionManagerError(
        error instanceof Error ? error.message : 'Installed extension surface validation failed',
        'extension_validation_failed',
      );
    }
  };

  const validateStagedExtension = async (directory, verified) => (
    validateExtensionRoot(directory, verified.manifest.id, verified.manifest)
  );

  const fetchAndVerifyHosted = async (verifiedPackage) => {
    const delivery = verifiedPackage.manifest.delivery;
    if (delivery?.type !== 'hosted') return null;
    const minimumRuntimeVersion = delivery.minimumRuntimeVersion;
    const comparison = minimumRuntimeVersion
      ? compareSemver(runtimeVersion, minimumRuntimeVersion)
      : 0;
    if (comparison === null || comparison < 0) {
      throw new InteractiveUIExtensionManagerError(
        `Hosted OCIX requires OpenChamber ${minimumRuntimeVersion} or newer (current ${runtimeVersion})`,
        'hosted_runtime_incompatible',
        409,
        { minimumRuntimeVersion, runtimeVersion },
      );
    }
    const document = await fetchHostedOcixManifest({
      manifestUrl: delivery.manifestUrl,
      fetchImpl,
    });
    const hosted = verifyHostedOcixManifest({
      document,
      extensionId: verifiedPackage.manifest.id,
      publisherKeyId: verifiedPackage.packageIndex.publisher.keyId,
      publisherPublicKey: verifiedPackage.publisherPublicKey,
      cryptoImpl,
    });
    const undeclared = hostedPermissionExpansion(delivery.initialPermissions, hosted.permissions);
    if (undeclared) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted manifest requests permissions not declared by the thin package',
        'hosted_permission_mismatch',
        403,
        { addedPermissions: undeclared, permissions: hosted.permissions },
      );
    }
    return hosted;
  };

  const hostedToolSource = (binding) => {
    const schema = binding.kind === 'view'
      ? 'openchamber://interactive-result/v1'
      : 'openchamber://installed-html-artifact-result/v1';
    const surfaceKey = binding.kind === 'view' ? 'view' : 'artifact';
    const summary = `Open hosted ${binding.title}`;
    return `import { tool } from '@opencode-ai/plugin';

export default tool({
  description: ${JSON.stringify(`Open the installed Hosted OCIX surface “${binding.title}”. Use contextJson only for parameters explicitly supplied or inferred from the user. The page calls business APIs through OpenChamber Business Gateway; never invent replacement business data.`)},
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

  const installHostedAgentRuntime = async (directory, hosted) => {
    const tools = hostedSurfaceBindings(hosted.extension);
    if (tools.length === 0) {
      return {
        tools: [],
        skills: [],
        unresolvedSurfaceTools: [],
        unresolvedViewTools: [],
      };
    }
    const runtimeDirectory = pathImpl.join(directory, 'agent-runtime');
    const agentDirectory = pathImpl.join(runtimeDirectory, 'tools');
    try {
      await fsImpl.mkdir(runtimeDirectory, { mode: 0o700 });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX Agent Runtime conflicts with an existing host-managed path',
          'hosted_agent_runtime_conflict',
          409,
        );
      }
      throw error;
    }
    try {
      await fsImpl.mkdir(agentDirectory, { mode: 0o700 });
      for (const binding of tools) {
        await fsImpl.writeFile(
          pathImpl.join(agentDirectory, `${binding.name}.ts`),
          hostedToolSource(binding),
          { flag: 'wx', mode: 0o600 },
        );
      }
    } catch (error) {
      await fsImpl.rm(runtimeDirectory, { recursive: true, force: true }).catch(() => {});
      if (['EEXIST', 'EISDIR', 'ENOTDIR'].includes(error?.code)) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX Agent Runtime conflicts with an existing host-managed path',
          'hosted_agent_runtime_conflict',
          409,
        );
      }
      throw error;
    }
    return {
      tools: tools.map(({ name }) => ({ name, entry: `agent-runtime/tools/${name}.ts` })),
      skills: [],
      unresolvedSurfaceTools: [],
      unresolvedViewTools: [],
    };
  };

  const createHostedCacheIntegrity = (hosted) => createHostedOcixCacheIntegrity({
    verified: hosted,
    additionalFiles: new Map(hostedSurfaceBindings(hosted.extension).map((binding) => [
      `agent-runtime/tools/${binding.name}.ts`,
      hostedToolSource(binding),
    ])),
    cryptoImpl,
  });

  const verifyHostedCacheRoot = async (extension, metadata) => {
    const lastGood = metadata.hosted?.lastGood;
    const integrity = lastGood?.integrity;
    if (!isRecord(lastGood)
      || !isRecord(integrity)
      || integrity.extensionId !== extension.id
      || integrity.version !== lastGood.version
      || integrity.manifestHash !== lastGood.manifestHash) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no valid Hosted cache integrity record; refresh or reinstall the extension`,
        'hosted_cache_integrity_unavailable',
        409,
      );
    }
    const directory = pathImpl.join(hostedCacheDirectory, extension.id, lastGood.version);
    let reverified;
    let expectedIntegrity;
    try {
      const trust = await readTrust();
      const trustedKey = trust.publishers?.[metadata.publisher?.id]
        ?.keys?.[metadata.publisher?.keyId]?.publicKey;
      if (!trustedKey) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX publisher key is no longer trusted',
          'publisher_untrusted',
          403,
        );
      }
      let signedDocument;
      try {
        signedDocument = JSON.parse(await fsImpl.readFile(
          pathImpl.join(directory, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
          'utf8',
        ));
      } catch (error) {
        throw new InteractiveUIExtensionManagerError(
          error?.code === 'ENOENT'
            ? 'Hosted OCIX cache is missing its signed manifest'
            : 'Hosted OCIX cached signed manifest is invalid JSON',
          'hosted_cache_integrity_failed',
          409,
        );
      }
      reverified = verifyHostedOcixManifest({
        document: signedDocument,
        extensionId: extension.id,
        publisherKeyId: metadata.publisher.keyId,
        publisherPublicKey: trustedKey,
        cryptoImpl,
      });
      if (reverified.version !== lastGood.version
        || reverified.manifestHash !== lastGood.manifestHash) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX cached signed manifest does not match the active last-good version',
          'hosted_cache_integrity_failed',
          409,
        );
      }
      expectedIntegrity = createHostedCacheIntegrity(reverified);
      if (canonicalStringify(expectedIntegrity) !== canonicalStringify(integrity)) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX cache integrity record does not match the reverified signed manifest',
          'hosted_cache_integrity_failed',
          409,
        );
      }
      await verifyHostedOcixCacheIntegrity({
        directory,
        integrity,
        fsImpl,
        pathImpl,
        cryptoImpl,
      });
    } catch (error) {
      throw new InteractiveUIExtensionManagerError(
        error instanceof Error ? error.message : 'Hosted OCIX cache integrity verification failed',
        typeof error?.code === 'string' ? error.code : 'hosted_cache_integrity_failed',
        error?.status ?? 409,
      );
    }
    // Returns the verified cache root plus the reverified signed Hosted
    // document and its expected integrity file map, so callers inside the
    // manager mutation queue can read single files and hash them against the
    // CURRENT signed document without any unlocked pathname fallback.
    return { directory, document: reverified, integrity: expectedIntegrity };
  };

  const inspectHostedCacheIntegrity = async (extension, metadata) => {
    try {
      await verifyHostedCacheRoot(extension, metadata);
      return { status: 'ready' };
    } catch (error) {
      if (error?.code === 'hosted_cache_integrity_unavailable') {
        return { status: 'unavailable', code: error.code };
      }
      return {
        status: 'failed',
        code: typeof error?.code === 'string' ? error.code : 'hosted_cache_integrity_failed',
      };
    }
  };

  const materializeHostedCandidate = async (hosted) => materializeHostedOcix({
    verified: hosted,
    cacheDirectory: hostedCacheDirectory,
    fetchImpl,
    fsImpl,
    pathImpl,
    cryptoImpl,
    validate: (directory) => validateExtensionRoot(directory, hosted.extensionId, hosted.extension),
  });

  // Re-reads and re-verifies the CURRENT active installed Remote shell: the
  // persisted signed manifest is verified against the CURRENT trusted
  // publisher key and must exactly match the accepted manifest hash/keyId and
  // the persisted extension/version/publisher identity/fingerprint, and the
  // shell file set must pass the signed file-hash integrity scan. Returns the
  // shell directory plus the reverified signed manifest (its resources are
  // the only authoritative resource metadata for lazy resolution). Fails
  // closed on any mismatch.
  const reverifyRemoteShell = async (extension, metadata) => {
    const remote = metadata.remote;
    if (!isRecord(remote)
      || typeof remote.appEntryUrl !== 'string'
      || !isRecord(remote.acceptedManifest)
      || !SHA256_PATTERN.test(remote.acceptedManifest.manifestHash ?? '')
      || typeof remote.acceptedManifest.keyId !== 'string'
      || typeof remote.installationId !== 'string'
      || !remote.installationId
      || remote.installationId.length > 128
      || !isRecord(metadata.publisher)
      || !ID_PATTERN.test(metadata.publisher.id ?? '')
      || !KEY_ID_PATTERN.test(metadata.publisher.keyId ?? '')
      || !SHA256_PATTERN.test(metadata.publisher.fingerprint ?? '')) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no valid Remote state`,
        'remote_shell_integrity_failed',
        409,
      );
    }
    await verifyInstalledVersionIntegrity(
      extension,
      metadata,
      pathImpl.join(versionsDirectory, extension.id, metadata.version),
    );
    const trust = await readTrust();
    const storedKey = trust.publishers?.[metadata.publisher.id]
      ?.keys?.[metadata.publisher.keyId];
    if (!isRecord(storedKey) || typeof storedKey.publicKey !== 'string' || !storedKey.publicKey) {
      throw new InteractiveUIExtensionManagerError(
        'Remote OCIX publisher key is no longer trusted',
        'publisher_untrusted',
        403,
      );
    }
    // The shell must be signed by the CURRENT trusted key: normalize the
    // stored trust-record public key and derive its fingerprint locally, then
    // require the reverified embedded publisher identity to match it exactly.
    let trustedKeyPem;
    let trustedFingerprint;
    try {
      trustedKeyPem = normalizeEd25519PublicKey(storedKey.publicKey, cryptoImpl);
      trustedFingerprint = publicKeyFingerprint(trustedKeyPem, cryptoImpl);
    } catch {
      throw new InteractiveUIExtensionManagerError(
        'Remote OCIX publisher key is no longer trusted',
        'publisher_untrusted',
        403,
      );
    }
    let signedDocument;
    try {
      signedDocument = JSON.parse(await fsImpl.readFile(
        pathImpl.join(versionsDirectory, extension.id, metadata.version, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
        'utf8',
      ));
    } catch (error) {
      throw new InteractiveUIExtensionManagerError(
        error?.code === 'ENOENT'
          ? 'Remote OCIX shell is missing its signed manifest'
          : 'Remote OCIX shell signed manifest is invalid JSON',
        'remote_shell_integrity_failed',
        409,
      );
    }
    const reverified = verifyRemoteOcixManifest({ document: signedDocument, cryptoImpl });
    if (reverified.extensionId !== extension.id
      || reverified.version !== metadata.version
      || reverified.manifestHash !== remote.acceptedManifest.manifestHash
      || reverified.publisher.id !== metadata.publisher.id
      || reverified.publisher.keyId !== metadata.publisher.keyId
      || reverified.publisher.keyId !== remote.acceptedManifest.keyId
      || reverified.publisher.fingerprint !== metadata.publisher.fingerprint
      || reverified.publisher.fingerprint !== trustedFingerprint
      || reverified.publisher.publicKey !== trustedKeyPem) {
      throw new InteractiveUIExtensionManagerError(
        'Remote OCIX shell was not signed by the currently trusted publisher key',
        'remote_shell_integrity_failed',
        409,
      );
    }
    return {
      directory: pathImpl.join(versionsDirectory, extension.id, metadata.version),
      manifest: reverified,
    };
  };

  const verifyRemoteShellRoot = async (extension, metadata) => {
    const { directory } = await reverifyRemoteShell(extension, metadata);
    return directory;
  };

  const inspectRemoteShellIntegrity = async (extension, metadata) => {
    try {
      await verifyRemoteShellRoot(extension, metadata);
      return { status: 'ready' };
    } catch (error) {
      if (error?.code === 'remote_shell_integrity_failed') {
        return { status: 'failed', code: error.code };
      }
      return {
        status: 'failed',
        code: typeof error?.code === 'string' ? error.code : 'remote_shell_integrity_failed',
      };
    }
  };

  // Central manager authority classification shared by BOTH the public
  // authorizeExtensionAuthority callback (used by the runtime to authorize a
  // manifest BEFORE any metadata/operation exposure) and
  // resolveExtensionResource (used before any entry read/fetch). Always runs
  // inside the manager-scoped mutate queue and NEVER fetches Remote
  // resources. Contract:
  // - no manager state record + no provenance => ordinary configured/built-in
  //   root ONLY when the resolved root is outside the managed versions tree by
  //   BOTH lexical and (when the versions tree exists) canonical realpath
  //   containment AND the authority root still canonicalizes; otherwise (a
  //   managed-tree path, a symlink/alias into it, or a vanished/changed root)
  //   fail closed. Authorize succeeds and the resolver may return null only in
  //   the genuine ordinary case.
  // - no record + manager provenance => stale manager root: fail closed.
  // - existing record + missing/invalid provenance => configured-root ID
  //   collision: fail closed.
  // - existing record => enabled, valid active metadata/delivery, exact
  //   current root, and exact current lifecycle generation are mandatory;
  //   unknown/corrupt delivery fails closed.
  const classifyExtensionAuthority = async ({ extensionId, authority }) => {
    if (!isRecord(authority)
      || typeof authority.directory !== 'string'
      || typeof authority.extensionHash !== 'string'
      || !SHA256_PATTERN.test(authority.extensionHash ?? '')) {
      return {
        ok: false,
        code: 'remote_resource_authority_invalid',
        status: 409,
        message: 'Remote resource authority is invalid',
      };
    }
    const state = await readState();
    const extension = state.extensions[extensionId];
    const resolvedRoot = pathImpl.resolve(authority.directory);
    const metadata = extension ? extension.versions?.[extension.activeVersion] : undefined;
    if (!extension) {
      // No manager record: a captured root that resolves to the managed
      // versions tree ITSELF or anywhere below it is a stale/recreated
      // managed path — fail closed (remote_shell_missing) REGARDLESS of
      // provenance, so a plain configured root pointed at a recreated managed
      // path after uninstall can never be authorized or null disk-fallback.
      // Only a no-record, no-provenance root OUTSIDE the managed versions
      // tree is an ordinary configured/built-in root.
      const versionsTree = pathImpl.resolve(versionsDirectory);
      const lexicallyManaged = isWithinManagedVersionsTree(resolvedRoot, versionsTree, pathImpl);
      if (isRecord(authority.provenance) || lexicallyManaged) {
        return {
          ok: false,
          code: 'remote_shell_missing',
          status: 404,
          message: 'Remote extension is not installed',
        };
      }
      // CANONICAL ALIAS DEFENSE: an outside LEXICAL configured root that is a
      // symlink/alias to the managed tree or a descendant must not be treated
      // as ordinary. If the authority root cannot be canonicalized because it
      // vanished/changed, fail closed with a controlled error. A missing
      // versions tree skips only the canonical-base comparison (the lexical
      // containment check above still runs).
      let realRoot;
      try {
        realRoot = await fsImpl.realpath(resolvedRoot);
      } catch {
        return {
          ok: false,
          code: 'remote_shell_missing',
          status: 404,
          message: 'Remote extension is not installed',
        };
      }
      let realVersionsTree;
      try {
        realVersionsTree = await fsImpl.realpath(versionsTree);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          return {
            ok: false,
            code: 'remote_shell_integrity_failed',
            status: 409,
            message: 'Remote shell state is invalid',
          };
        }
        realVersionsTree = null;
      }
      if (realVersionsTree !== null
        && isWithinManagedVersionsTree(realRoot, realVersionsTree, pathImpl)) {
        return {
          ok: false,
          code: 'remote_shell_missing',
          status: 404,
          message: 'Remote extension is not installed',
        };
      }
      return { ok: true, kind: 'ordinary' };
    }
    if (!isRecord(authority.provenance) || typeof authority.provenance.generation !== 'string') {
      return {
        ok: false,
        code: 'remote_shell_integrity_failed',
        status: 409,
        message: 'Remote shell provenance is missing',
      };
    }
    if (!isRecord(metadata)) {
      return {
        ok: false,
        code: 'remote_shell_integrity_failed',
        status: 409,
        message: 'Remote shell state is invalid',
      };
    }
    if (extension.enabled !== true) {
      return {
        ok: false,
        code: 'remote_shell_disabled',
        status: 409,
        message: `${extension.id}@${metadata.version} Remote extension is disabled`,
      };
    }
    const activeManagedDirectory = pathImpl.resolve(
      pathImpl.join(versionsDirectory, extension.id, extension.activeVersion),
    );
    if (metadata.delivery === 'local') {
      const generation = typeof metadata.generationId === 'string' ? metadata.generationId : null;
      if (generation === null || authority.provenance.generation !== generation) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell generation does not match the current installation',
        };
      }
      if (resolvedRoot !== activeManagedDirectory) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell root does not match the active version',
        };
      }
      // Reverify the current signed installed-file integrity so a
      // quarantined/tampered Local shell is never authorized for exposure,
      // and BIND the captured manifest authority to the exact
      // signed-and-hash-verified openchamber.extension.json bytes retained
      // by that same verification loop: a swapped-in malicious manifest (or
      // restore-current-before-authorize window) can never make the runtime
      // retain attacker metadata while the current tree verification passes.
      try {
        const { manifestBytes } = await verifyInstalledVersionIntegrity(extension, metadata, activeManagedDirectory);
        if (!Buffer.isBuffer(manifestBytes)) {
          return {
            ok: false,
            code: 'remote_shell_integrity_failed',
            status: 409,
            message: 'Local shell is missing its verified manifest',
          };
        }
        let verifiedCanonicalHash;
        try {
          verifiedCanonicalHash = packageHash(
            cryptoImpl,
            Buffer.from(canonicalStringify(JSON.parse(manifestBytes.toString('utf8')))),
          );
        } catch {
          return {
            ok: false,
            code: 'remote_shell_integrity_failed',
            status: 409,
            message: 'Local shell verified manifest is not canonical JSON',
          };
        }
        if (authority.extensionHash !== verifiedCanonicalHash) {
          return {
            ok: false,
            code: 'remote_shell_integrity_failed',
            status: 409,
            message: 'Local shell authority does not match the signed installed manifest',
          };
        }
      } catch (error) {
        return {
          ok: false,
          code: typeof error?.code === 'string' ? error.code : 'extension_integrity_failed',
          status: 409,
          message: error instanceof Error ? error.message : 'Local shell integrity verification failed',
        };
      }
      return { ok: true, kind: 'local', extension, metadata };
    }
    if (metadata.delivery === 'hosted') {
      const generation = hostedGeneration(metadata);
      if (generation === null || authority.provenance.generation !== generation) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell generation does not match the current installation',
        };
      }
      let verified;
      try {
        verified = await verifyHostedCacheRoot(extension, metadata);
      } catch (error) {
        return {
          ok: false,
          code: typeof error?.code === 'string' ? error.code : 'hosted_cache_integrity_failed',
          status: 409,
          message: error instanceof Error ? error.message : 'Hosted OCIX cache integrity verification failed',
        };
      }
      if (resolvedRoot !== verified.directory) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell root does not match the active version',
        };
      }
      // Bind the captured authority to the CURRENT reverified signed Hosted
      // document: canonical extension document hash and sibling
      // signed-manifest hash must both match.
      const canonicalExtensionHash = packageHash(
        cryptoImpl,
        Buffer.from(canonicalStringify(verified.document.extension)),
      );
      if (authority.extensionHash !== canonicalExtensionHash
        || authority.signedManifestHash !== verified.document.manifestHash) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Hosted shell authority does not match the current signed manifest',
        };
      }
      return {
        ok: true,
        kind: 'hosted',
        extension,
        metadata,
        document: verified.document,
        integrity: verified.integrity,
        directory: verified.directory,
      };
    }
    if (metadata.delivery === 'remote') {
      // The lifecycle generation is the private persisted generationId set
      // ONLY by the current connect (never migrated/synthesized). There is NO
      // installationId compatibility fallback: a Remote record without a real
      // generationId fails closed (no root is issued / no authorization)
      // until it is reconnected. installationId keeps its separate
      // credential/rollback ownership role.
      const generation = typeof metadata.generationId === 'string' ? metadata.generationId : null;
      if (generation === null || authority.provenance.generation !== generation) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell generation does not match the current installation',
        };
      }
      // UNCONDITIONAL current Remote exact-root invariant: the captured root
      // must be the exact active managed version directory regardless of the
      // lexical path classification (an outside-root capture is stale/forged).
      if (resolvedRoot !== activeManagedDirectory) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell root does not match the active version',
        };
      }
      if (!isRecord(metadata.remote)) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell state is invalid',
        };
      }
      // The captured signed-manifest hash must equal the accepted manifest
      // hash (generation binding), then the current shell is re-read and
      // re-verified against the CURRENT trusted publisher key, and the
      // captured canonical extension-document hash must equal the reverified
      // manifest's extension document.
      const acceptedManifestHash = metadata.remote.acceptedManifest?.manifestHash;
      if (!SHA256_PATTERN.test(acceptedManifestHash ?? '')
        || authority.signedManifestHash !== acceptedManifestHash) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell signed manifest does not match the accepted manifest',
        };
      }
      let reverified;
      try {
        reverified = await reverifyRemoteShell(extension, metadata);
      } catch (error) {
        return {
          ok: false,
          code: typeof error?.code === 'string' ? error.code : 'remote_shell_integrity_failed',
          status: typeof error?.status === 'number' ? error.status : 409,
          message: error instanceof Error ? error.message : 'Remote shell reverification failed',
        };
      }
      const canonicalExtensionHash = packageHash(
        cryptoImpl,
        Buffer.from(canonicalStringify(reverified.manifest.extension)),
      );
      if (authority.extensionHash !== canonicalExtensionHash) {
        return {
          ok: false,
          code: 'remote_shell_integrity_failed',
          status: 409,
          message: 'Remote shell extension document does not match the accepted manifest',
        };
      }
      return {
        ok: true,
        kind: 'remote',
        extension,
        metadata,
        manifest: reverified.manifest,
      };
    }
    // Unknown/corrupt delivery: fail closed everywhere.
    return {
      ok: false,
      code: 'remote_shell_integrity_failed',
      status: 409,
      message: 'Remote shell state is invalid',
    };
  };

  const throwClassification = (decision) => {
    throw new InteractiveUIExtensionManagerError(decision.message, decision.code, decision.status);
  };

  // Public authorization callback: the runtime awaits this for EVERY
  // discovered manifest (after capturing the authority, before exposing any
  // metadata/operation). Runs in the mutate queue and never fetches Remote
  // resources. An authorization error makes the runtime skip that manifest
  // through its existing errors path, so disabled/quarantined manager
  // extensions cannot be resurrected by a configured root reusing their
  // extension/surface/connector IDs.
  const authorizeExtensionAuthority = (extensionId, authority) => mutate(async () => {
    assertNamespacedId(extensionId, 'Extension id');
    const decision = await classifyExtensionAuthority({ extensionId, authority });
    if (!decision.ok) throwClassification(decision);
    return { authorized: true, kind: decision.kind, extensionId };
  });

  // Reads ONE authorized manager-owned Hosted entry inside the SAME mutate
  // operation that authorized the current generation/root: the exact cached
  // file is opened no-follow/nonblocking where supported, fstat verified as a
  // regular non-empty file within an explicit 8 MiB manager bound before
  // allocation, read with a bounded loop from that same handle, and the exact
  // bytes are hashed against the current signed/integrity file map before
  // being returned. No unlocked pathname fallback is ever used for Hosted;
  // arbitrary/undeclared paths fail closed. The runtime keeps its smaller
  // per-kind limits on top.
  const MAX_HOSTED_ENTRY_BYTES = 8 * 1024 * 1024;
  const readHostedVerifiedEntry = async ({ directory, integrity, relativePath }) => {
    const normalizedPath = safeRelativePath(relativePath);
    if (!normalizedPath) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted resource path is invalid',
        'invalid_hosted_resource',
        400,
        { path: relativePath },
      );
    }
    const fileMap = integrity?.files;
    const expectedHash = isRecord(fileMap) ? fileMap[normalizedPath] : undefined;
    if (typeof expectedHash !== 'string' || !SHA256_PATTERN.test(expectedHash)) {
      throw new InteractiveUIExtensionManagerError(
        `Hosted resource is not declared in the signed cache: ${normalizedPath}`,
        'invalid_hosted_resource',
        404,
        { path: normalizedPath },
      );
    }
    const target = pathImpl.join(directory, ...normalizedPath.split('/'));
    const relative = pathImpl.relative(directory, target);
    if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted resource path escapes its cache root',
        'invalid_hosted_resource',
        400,
        { path: normalizedPath },
      );
    }
    let handle;
    try {
      handle = await fsImpl.open(target, HOSTED_ENTRY_READ_FLAGS);
    } catch (error) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted cached resource is unavailable',
        'hosted_cache_integrity_failed',
        409,
      );
    }
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > MAX_HOSTED_ENTRY_BYTES) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted cached resource is not a bounded regular file',
          'hosted_cache_integrity_failed',
          409,
        );
      }
      const buffer = Buffer.alloc(fileStat.size);
      let offset = 0;
      while (offset < fileStat.size) {
        const { bytesRead } = await handle.read(buffer, offset, fileStat.size - offset, offset);
        if (bytesRead === 0) {
          throw new InteractiveUIExtensionManagerError(
            'Hosted cached resource shrank during read',
            'hosted_cache_integrity_failed',
            409,
          );
        }
        offset += bytesRead;
      }
      const afterStat = await handle.stat();
      if (afterStat.size !== fileStat.size || !afterStat.isFile()) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted cached resource changed during read',
          'hosted_cache_integrity_failed',
          409,
        );
      }
      if (packageHash(cryptoImpl, buffer) !== expectedHash) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted cached resource does not match its signed hash',
          'hosted_resource_integrity_failed',
          403,
        );
      }
      return buffer;
    } finally {
      await handle.close().catch(() => {});
    }
  };

  // Phase R2 resource resolution — TWO-PHASE queue contract. The SHORT phase
  // A (inside mutate) and SHORT phase C (inside mutate) frame the
  // network/cache phase B, which runs OUTSIDE the manager-global mutation
  // queue so one slow/broken Remote cannot block unrelated extensions or
  // lifecycle mutations (entity isolation). Phase A runs the SAME central
  // classifier as authorizeExtensionAuthority and captures an IMMUTABLE plan
  // (extensionId, an allowlisted deep SCALAR snapshot of the authority fields
  // the classifier consumes — directory, extensionHash, signedManifestHash,
  // provenance.generation — never the caller-owned reference, exact signed
  // resource tuple, accepted manifestHash, approved origin). Phase B awaits the in-memory TTL cache's
  // verified fetch — NO global queue is held during network I/O. Phase C
  // re-runs the SAME classification against the ORIGINAL captured authority
  // and fails closed with a stable sanitized code if the extension was
  // removed, disabled, reconnected with a different accepted manifest,
  // replaced by another delivery, or its exact resource tuple/origin changed,
  // and only then returns the already verified bytes — so a stale in-flight
  // resolve NEVER serves bytes after uninstall/rollback/reconnect/disable.
  // Ordinary/current Local roots keep their short queued null and authorized
  // current Hosted verified reads keep their short queued bounded read; only
  // the Remote branch is split. Lifecycle safety: uninstall and failed-connect
  // rollback proceed while a Remote fetch is paused; the cache's per-extension
  // clear epoch stops the old in-flight fetch from repopulating after clear;
  // phase C never clears a replacement installation's cache on postflight
  // denial.
  const resolveExtensionResource = async (extensionId, relativePath, authority) => {
    assertNamespacedId(extensionId, 'Extension id');
    // Phase A (SHORT, inside mutate): classify + validate + capture the plan.
    const plan = await mutate(async () => {
      const decision = await classifyExtensionAuthority({ extensionId, authority });
      if (!decision.ok) throwClassification(decision);
      if (decision.kind === 'ordinary' || decision.kind === 'local') return null;
      if (decision.kind === 'hosted') {
        return readHostedVerifiedEntry({
          directory: decision.directory,
          integrity: decision.integrity,
          relativePath,
        });
      }
      const { metadata, manifest } = decision;
      const normalizedPath = safeRelativePath(relativePath);
      if (!normalizedPath) {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource path is invalid',
          'invalid_hosted_resource',
          400,
          { path: relativePath },
        );
      }
      const resource = manifest.resources.find((candidate) => candidate.path === normalizedPath);
      if (!resource) {
        throw new InteractiveUIExtensionManagerError(
          `Remote resource is not declared in the signed manifest: ${normalizedPath}`,
          'invalid_hosted_resource',
          404,
          { path: normalizedPath },
        );
      }
      const origin = new URL(resource.url).origin;
      const approvedOrigins = Array.isArray(metadata.remote.approvedPermissions?.resourceOrigins)
        ? metadata.remote.approvedPermissions.resourceOrigins
        : [];
      if (!approvedOrigins.includes(origin)) {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource origin is not approved',
          'hosted_permission_mismatch',
          403,
          { origin },
        );
      }
      // Allowlisted deep SCALAR snapshot of exactly the authority fields the
      // central classifier consumes (directory, extensionHash,
      // signedManifestHash, provenance.generation): the plan must NEVER
      // retain a reference to the caller-owned authority object, so a
      // caller-side mutation during phase B cannot change the postflight
      // subject. The nested provenance, the authority snapshot, and the
      // resource tuple are all frozen; the plan itself is frozen below.
      const capturedAuthority = Object.freeze({
        directory: typeof authority.directory === 'string' ? authority.directory : undefined,
        extensionHash: typeof authority.extensionHash === 'string' ? authority.extensionHash : undefined,
        signedManifestHash: typeof authority.signedManifestHash === 'string' ? authority.signedManifestHash : undefined,
        provenance: Object.freeze(
          isRecord(authority.provenance)
            ? { generation: typeof authority.provenance.generation === 'string' ? authority.provenance.generation : undefined }
            : {},
        ),
      });
      return Object.freeze({
        extensionId,
        // IMMUTABLE snapshot only — the caller-owned `authority` reference is
        // never retained in the plan.
        capturedAuthority,
        // Immutable plan: the EXACT resource tuple and accepted manifest hash
        // captured under the current reverified manifest.
        resource: Object.freeze({
          path: resource.path,
          url: resource.url,
          mimeType: resource.mimeType,
          sha256: resource.sha256,
        }),
        manifestHash: metadata.remote.acceptedManifest?.manifestHash,
        origin,
      });
    });
    if (plan === null || Buffer.isBuffer(plan)) return plan;
    // Phase B (OUTSIDE mutate): verified network/cache resolution. The
    // manager-global mutation queue is NOT held during network I/O, so
    // unrelated extensions and lifecycle mutations proceed while this fetch
    // is in flight.
    const bytes = await remoteResourceCache.resolve({
      extensionId: plan.extensionId,
      resource: plan.resource,
      manifestHash: plan.manifestHash,
    });
    // Phase C (SHORT, inside mutate): re-verify before returning bytes. Uses
    // ONLY the immutable capturedAuthority snapshot from phase A — never the
    // caller-owned authority reference — so the postflight subject is exactly
    // what phase A validated.
    return mutate(async () => {
      const decision = await classifyExtensionAuthority({ extensionId, authority: plan.capturedAuthority });
      if (!decision.ok) throwClassification(decision);
      if (decision.kind !== 'remote') {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource is no longer current',
          'remote_shell_integrity_failed',
          409,
        );
      }
      const { metadata, manifest } = decision;
      const currentManifestHash = metadata.remote.acceptedManifest?.manifestHash;
      if (currentManifestHash !== plan.manifestHash) {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource is no longer current',
          'remote_shell_integrity_failed',
          409,
        );
      }
      const resource = manifest.resources.find((candidate) => candidate.path === plan.resource.path);
      if (!resource
        || resource.url !== plan.resource.url
        || resource.mimeType !== plan.resource.mimeType
        || resource.sha256 !== plan.resource.sha256) {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource is no longer current',
          'remote_shell_integrity_failed',
          409,
        );
      }
      const origin = new URL(resource.url).origin;
      const approvedOrigins = Array.isArray(metadata.remote.approvedPermissions?.resourceOrigins)
        ? metadata.remote.approvedPermissions.resourceOrigins
        : [];
      if (!approvedOrigins.includes(origin)) {
        throw new InteractiveUIExtensionManagerError(
          'Remote resource origin is no longer approved',
          'hosted_permission_mismatch',
          403,
          { origin },
        );
      }
      return bytes;
    });
  };

  const installRemoteShell = async ({
    remote,
    appEntryUrl,
    connector,
    installationId,
    previousState,
    nextState,
  }) => {
    const { id, name, version } = summarizeRemoteReview(remote, false).extension;
    if (id === builtInRuntime?.extensionId) {
      throw new InteractiveUIExtensionManagerError('Built-in Interactive UI cannot be replaced by an OCIX package', 'reserved_extension', 409);
    }
    const destination = pathImpl.join(versionsDirectory, id, version);
    if (nextState.extensions[id]?.versions?.[version]) {
      throw new InteractiveUIExtensionManagerError(
        `${id}@${version} is already installed from a different delivery`,
        'version_conflict',
        409,
      );
    }
    const stagingPath = pathImpl.join(stagingDirectory, cryptoImpl.randomUUID());
    let moved = false;
    try {
      await fsImpl.mkdir(stagingPath, { recursive: true, mode: 0o700 });
      await fsImpl.writeFile(
        pathImpl.join(stagingPath, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
        Buffer.from(canonicalStringify(remote.signedDocument)),
        { flag: 'wx', mode: 0o600 },
      );
      await fsImpl.writeFile(
        pathImpl.join(stagingPath, 'openchamber.extension.json'),
        Buffer.from(`${JSON.stringify(remote.extension, null, 2)}\n`),
        { flag: 'wx', mode: 0o600 },
      );
      const agentRuntime = await installHostedAgentRuntime(stagingPath, remote);
      const fileHashes = Object.fromEntries(await Promise.all(
        (await collectInstalledFiles(stagingPath)).map(async (relativePath) => [
          relativePath,
          packageHash(cryptoImpl, await fsImpl.readFile(
            pathImpl.join(stagingPath, ...relativePath.split('/')),
          )),
        ]),
      ));
      await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true, mode: 0o700 });
      await fsImpl.rename(stagingPath, destination);
      moved = true;

      const installedAt = new Date().toISOString();
      const next = {
        id,
        name,
        enabled: true,
        activeVersion: version,
        activationHistory: [],
        versions: {},
      };
      next.versions[version] = {
        version,
        packageHash: remote.manifestHash,
        installedAt,
        // Private lifecycle generation: changes across every connect, even for
        // identical id/version/package, and is issued to the runtime only
        // through the structured root descriptors it never sees in public
        // output (sanitized from list()/registry/API responses).
        generationId: cryptoImpl.randomUUID(),
        source: { type: 'remote', appEntryUrl },
        publisher: {
          id: remote.publisher.id,
          name: remote.publisher.name,
          keyId: remote.publisher.keyId,
          fingerprint: remote.publisher.fingerprint,
        },
        delivery: 'remote',
        agentRuntime,
        fileHashes,
        remote: {
          appEntryUrl,
          installationId,
          connectorRefs: [{
            id: connector.id,
            origin: connector.origin,
            authType: connector.authType,
          }],
          acceptedManifest: {
            version: remote.version,
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
      nextState.extensions[id] = next;
      await verifyRemoteShellRoot(next, next.versions[version]);
      const openCode = await commitStateWithAgentRuntime(previousState, nextState);
      return { extension: sanitizeExtensionOutput(next), installed: true, openCode };
    } catch (error) {
      if (moved) await fsImpl.rm(destination, { recursive: true, force: true }).catch(() => {});
      await fsImpl.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };

  const trustPublisherInDocument = (trust, { id, name, keyId, publicKey, source = 'manual' }) => {
    const publisherId = assertNamespacedId(id, 'Publisher id');
    const normalizedKeyId = assertKeyId(keyId);
    const normalizedName = assertDisplayName(name, 'Publisher name');
    const normalizedKey = normalizeEd25519PublicKey(publicKey, cryptoImpl);
    const fingerprint = publicKeyFingerprint(normalizedKey, cryptoImpl);
    const existing = trust.publishers[publisherId]?.keys?.[normalizedKeyId];
    if (existing && existing.fingerprint !== fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        `Publisher key ${publisherId}/${normalizedKeyId} already exists with a different fingerprint`,
        'publisher_key_conflict',
        409,
      );
    }
    trust.publishers[publisherId] ??= { id: publisherId, name: normalizedName, keys: {} };
    trust.publishers[publisherId].name = normalizedName;
    trust.publishers[publisherId].keys[normalizedKeyId] ??= {
      keyId: normalizedKeyId,
      publicKey: normalizedKey,
      fingerprint,
      source,
      trustedAt: new Date().toISOString(),
    };
    return { publisherId, keyId: normalizedKeyId, fingerprint, added: !existing };
  };

  const installVerifiedPackage = async ({
    verified,
    hosted,
    source,
    previousState,
    nextState,
  }) => {
    const { id, name, version } = verified.manifest;
    if (id === builtInRuntime?.extensionId) {
      throw new InteractiveUIExtensionManagerError('Built-in Interactive UI cannot be replaced by an OCIX package', 'reserved_extension', 409);
    }
    const destination = pathImpl.join(versionsDirectory, id, version);
    const existingVersion = nextState.extensions[id]?.versions?.[version];
    if (existingVersion) {
      if (existingVersion.packageHash === verified.packageHash) {
        await verifyInstalledVersionIntegrity(
          { id },
          existingVersion,
          destination,
        );
        if (hosted) {
          const hostedRoot = await materializeHostedCandidate(hosted);
          existingVersion.agentRuntime = await installHostedAgentRuntime(hostedRoot, hosted);
          existingVersion.hosted.approvedPermissions = clone(hosted.permissions);
          existingVersion.hosted.lastGood = {
            version: hosted.version,
            manifestHash: hosted.manifestHash,
            publishedAt: hosted.publishedAt,
            fetchedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + verified.manifest.delivery.ttlSeconds * 1_000).toISOString(),
            integrity: createHostedCacheIntegrity(hosted),
          };
          existingVersion.hosted.refreshAfter = existingVersion.hosted.lastGood.expiresAt;
          existingVersion.hosted.pendingUpdate = null;
          existingVersion.hosted.lastError = null;
          await verifyHostedCacheRoot(nextState.extensions[id], existingVersion);
        }
        const openCode = await commitStateWithAgentRuntime(previousState, nextState);
        return { extension: sanitizeExtensionOutput(nextState.extensions[id]), installed: false, openCode };
      }
      throw new InteractiveUIExtensionManagerError(`${id}@${version} is already installed from different package content`, 'version_conflict', 409);
    }

    const stagingPath = pathImpl.join(stagingDirectory, cryptoImpl.randomUUID());
    let moved = false;
    try {
      await fsImpl.mkdir(stagingPath, { recursive: true, mode: 0o700 });
      await writeVerifiedFiles(stagingPath, verified.files);
      let hostedRoot = null;
      let agentRuntime = clone(verified.agentRuntime);
      let hostedIntegrity = null;
      if (hosted) {
        hostedRoot = await materializeHostedCandidate(hosted);
        agentRuntime = await installHostedAgentRuntime(hostedRoot, hosted);
        hostedIntegrity = createHostedCacheIntegrity(hosted);
      } else {
        await validateStagedExtension(stagingPath, verified);
      }
      await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true });
      try {
        await fsImpl.stat(destination);
        throw new InteractiveUIExtensionManagerError(`${id}@${version} already exists outside manager state`, 'unmanaged_version_conflict', 409);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await fsImpl.rename(stagingPath, destination);
      moved = true;

      const installedAt = new Date().toISOString();
      const previous = nextState.extensions[id];
      const next = previous ?? {
        id,
        name,
        enabled: true,
        activeVersion: version,
        activationHistory: [],
        versions: {},
      };
      if (previous?.activeVersion && previous.activeVersion !== version) next.activationHistory.push(previous.activeVersion);
      next.name = name;
      next.activeVersion = version;
      next.versions[version] = {
        version,
        packageHash: verified.packageHash,
        installedAt,
        // Private lifecycle generation: changes across every install, even for
        // identical id/version/package, and is issued to the runtime only
        // through the structured root descriptors it never sees in public
        // output (sanitized from list()/registry/API responses).
        generationId: cryptoImpl.randomUUID(),
        source,
        publisher: {
          id: verified.packageIndex.publisher.id,
          name: verified.packageIndex.publisher.name,
          keyId: verified.packageIndex.publisher.keyId,
          fingerprint: verified.publisherFingerprint,
        },
        delivery: hosted ? 'hosted' : 'local',
        agentRuntime,
        fileHashes: fileHashesFromPackageIndex(verified.packageIndex),
        ...(hosted ? {
          hosted: {
            manifestUrl: verified.manifest.delivery.manifestUrl,
            ttlSeconds: verified.manifest.delivery.ttlSeconds,
            minimumRuntimeVersion: verified.manifest.delivery.minimumRuntimeVersion ?? null,
            approvedPermissions: clone(hosted.permissions),
            lastGood: {
              version: hosted.version,
              manifestHash: hosted.manifestHash,
              publishedAt: hosted.publishedAt,
              fetchedAt: installedAt,
              expiresAt: new Date(Date.now() + verified.manifest.delivery.ttlSeconds * 1_000).toISOString(),
              integrity: hostedIntegrity,
            },
            pendingUpdate: null,
            lastError: null,
          },
        } : {}),
      };
      nextState.extensions[id] = next;
      if (hosted) await verifyHostedCacheRoot(next, next.versions[version]);
      const openCode = await commitStateWithAgentRuntime(previousState, nextState);
      return { extension: sanitizeExtensionOutput(next), installed: true, openCode };
    } catch (error) {
      if (moved) await fsImpl.rm(destination, { recursive: true, force: true }).catch(() => {});
      await fsImpl.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };

  const verifyPackageAgainstTrust = async (buffer, trust) => verifyExtensionPackage({
    buffer,
    cryptoImpl,
    allowEmbeddedPublisherKey: true,
    resolveTrustedPublisherKey: async (publisherId, keyId) => trust.publishers[publisherId]?.keys?.[keyId]?.publicKey,
  });

  const inspectPackage = async (buffer) => {
    const trust = await readTrust();
    const verified = await verifyPackageAgainstTrust(buffer, trust);
    const hosted = await fetchAndVerifyHosted(verified);
    return summarizeVerifiedPackage(verified, hosted);
  };

  const installPackageInternal = async (buffer, {
    source = { type: 'file' },
    catalogPublisher,
    confirmedPublisherFingerprint,
    confirmedHostedManifestHash,
  } = {}) => {
    const originalTrust = await readTrust();
    const trust = clone(originalTrust);
    let catalogTrust;
    if (catalogPublisher) catalogTrust = trustPublisherInDocument(trust, catalogPublisher);
    const verified = await verifyPackageAgainstTrust(buffer, trust);
    const hosted = await fetchAndVerifyHosted(verified);
    if (hosted && confirmedHostedManifestHash !== hosted.manifestHash) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted OCIX permissions and remote manifest must be confirmed before installation',
        'hosted_manifest_confirmation_required',
        403,
        summarizeVerifiedPackage(verified, hosted),
      );
    }
    let packageTrust;
    if (!verified.publisherTrusted && !catalogTrust) {
      if (confirmedPublisherFingerprint !== verified.publisherFingerprint) {
        throw new InteractiveUIExtensionManagerError(
          'Publisher trust confirmation is required before installing this extension',
          'publisher_confirmation_required',
          403,
          summarizeVerifiedPackage(verified),
        );
      }
      packageTrust = trustPublisherInDocument(trust, {
        id: verified.packageIndex.publisher.id,
        name: verified.packageIndex.publisher.name,
        keyId: verified.packageIndex.publisher.keyId,
        publicKey: verified.publisherPublicKey,
        source: 'package-confirmation',
      });
    }
    const previousState = await readState();
    const nextState = clone(previousState);
    const trustAdded = Boolean(catalogTrust?.added || packageTrust?.added);
    if (trustAdded) await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, trust);
    try {
      return await installVerifiedPackage({
        verified,
        hosted,
        source,
        previousState,
        nextState,
      });
    } catch (error) {
      if (trustAdded) {
        await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, originalTrust).catch((rollbackError) => {
          logger.error?.('[InteractiveUI] Failed to roll back publisher trust', rollbackError);
        });
      }
      throw error;
    }
  };

  const refreshHostedMetadata = async (
    extension,
    metadata,
    trust,
    { force = false, confirmedManifestHash } = {},
  ) => {
    if (metadata.delivery !== 'hosted' || !isRecord(metadata.hosted)) {
      throw new InteractiveUIExtensionManagerError('Extension is not delivered as Hosted OCIX', 'hosted_extension_required', 409);
    }
    const now = Date.now();
    let usableCurrentRoot = null;
    let currentIntegrityError = null;
    try {
      usableCurrentRoot = (await verifyHostedCacheRoot(extension, metadata)).directory;
    } catch (error) {
      currentIntegrityError = error;
    }
    const refreshAfter = Date.parse(metadata.hosted.refreshAfter ?? metadata.hosted.lastGood?.expiresAt ?? '');
    if (!force && usableCurrentRoot && Number.isFinite(refreshAfter) && refreshAfter > now) {
      return { root: usableCurrentRoot, changed: false, runtimeChanged: false, confirmationRequired: false };
    }

    const trustedKey = trust.publishers?.[metadata.publisher?.id]?.keys?.[metadata.publisher?.keyId]?.publicKey;
    if (!trustedKey) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted OCIX publisher key is no longer trusted',
        'publisher_untrusted',
        403,
      );
    }

    try {
      const document = await fetchHostedOcixManifest({
        manifestUrl: metadata.hosted.manifestUrl,
        fetchImpl,
      });
      const candidate = verifyHostedOcixManifest({
        document,
        extensionId: extension.id,
        publisherKeyId: metadata.publisher.keyId,
        publisherPublicKey: trustedKey,
        cryptoImpl,
      });
      const addedPermissions = hostedPermissionExpansion(
        metadata.hosted.approvedPermissions,
        candidate.permissions,
      );
      if (addedPermissions && confirmedManifestHash !== candidate.manifestHash) {
        metadata.hosted.pendingUpdate = {
          version: candidate.version,
          manifestHash: candidate.manifestHash,
          publishedAt: candidate.publishedAt,
          permissions: clone(candidate.permissions),
          addedPermissions,
          detectedAt: new Date(now).toISOString(),
        };
        metadata.hosted.refreshAfter = new Date(now + metadata.hosted.ttlSeconds * 1_000).toISOString();
        metadata.hosted.lastError = null;
        return {
          root: usableCurrentRoot,
          changed: true,
          runtimeChanged: false,
          confirmationRequired: true,
          pendingUpdate: clone(metadata.hosted.pendingUpdate),
        };
      }

      if (candidate.manifestHash === metadata.hosted.lastGood?.manifestHash && usableCurrentRoot) {
        metadata.hosted.lastGood.expiresAt = new Date(now + metadata.hosted.ttlSeconds * 1_000).toISOString();
        metadata.hosted.refreshAfter = metadata.hosted.lastGood.expiresAt;
        metadata.hosted.pendingUpdate = null;
        metadata.hosted.lastError = null;
        return {
          root: usableCurrentRoot,
          changed: true,
          runtimeChanged: false,
          confirmationRequired: false,
        };
      }

      const rootDirectory = await materializeHostedCandidate(candidate);
      metadata.agentRuntime = await installHostedAgentRuntime(rootDirectory, candidate);
      if (addedPermissions) metadata.hosted.approvedPermissions = clone(candidate.permissions);
      metadata.hosted.lastGood = {
        version: candidate.version,
        manifestHash: candidate.manifestHash,
        publishedAt: candidate.publishedAt,
        fetchedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + metadata.hosted.ttlSeconds * 1_000).toISOString(),
        integrity: createHostedCacheIntegrity(candidate),
      };
      await verifyHostedCacheRoot(extension, metadata);
      metadata.hosted.refreshAfter = metadata.hosted.lastGood.expiresAt;
      metadata.hosted.pendingUpdate = null;
      metadata.hosted.lastError = null;
      return {
        root: rootDirectory,
        changed: true,
        runtimeChanged: true,
        confirmationRequired: false,
      };
    } catch (error) {
      metadata.hosted.lastError = {
        code: typeof error?.code === 'string' ? error.code : 'hosted_refresh_failed',
        message: error instanceof Error ? error.message : 'Hosted OCIX refresh failed',
        occurredAt: new Date(now).toISOString(),
      };
      metadata.hosted.refreshAfter = new Date(
        now + Math.min(metadata.hosted.ttlSeconds, 5 * 60) * 1_000,
      ).toISOString();
      if (usableCurrentRoot) {
        return {
          root: usableCurrentRoot,
          changed: true,
          runtimeChanged: false,
          confirmationRequired: false,
          fallback: true,
        };
      }
      if (currentIntegrityError) throw currentIntegrityError;
      throw error;
    }
  };

  // Internal Hosted lifecycle generation: changes whenever the accepted
  // last-good signed manifest changes (refresh/update), so a stale Hosted
  // cache root captured before an update can never fall back.
  const hostedGeneration = (metadata) => {
    const lastGood = metadata.hosted?.lastGood;
    if (typeof metadata.generationId !== 'string'
      || !isRecord(lastGood)
      || !SHA256_PATTERN.test(lastGood.manifestHash ?? '')) return null;
    return `${metadata.generationId}:${lastGood.manifestHash}`;
  };

  const getEnabledExtensionRoots = () => mutate(async () => {
    const previousState = await readState();
    const state = clone(previousState);
    const trust = await readTrust();
    const roots = [];
    let stateChanged = false;
    let runtimeChanged = false;
    for (const extension of Object.values(state.extensions ?? {})) {
      if (!extension.enabled) continue;
      const active = extension.versions?.[extension.activeVersion];
      if (!active) continue;
      const directory = pathImpl.join(versionsDirectory, extension.id, extension.activeVersion);
      const integrity = await inspectInstalledVersionIntegrity(extension, active);
      if (integrity.status !== 'ready') {
        const quarantineKey = `${extension.id}@${extension.activeVersion}:${integrity.code}`;
        if (!reportedQuarantines.has(quarantineKey)) {
          reportedQuarantines.add(quarantineKey);
          logger.warn?.(`[InteractiveUI] Quarantined ${extension.id}@${extension.activeVersion}: ${integrity.code}`);
        }
        continue;
      }
      if (active.delivery === 'hosted') {
        try {
          const refreshed = await refreshHostedMetadata(extension, active, trust);
          stateChanged ||= refreshed.changed;
          runtimeChanged ||= refreshed.runtimeChanged;
          const generation = hostedGeneration(active);
          if (refreshed.root && generation !== null) roots.push({
            directory: refreshed.root,
            provenance: { generation },
          });
        } catch (error) {
          const quarantineKey = `${extension.id}@${extension.activeVersion}:${error?.code ?? 'hosted_refresh_failed'}`;
          if (!reportedQuarantines.has(quarantineKey)) {
            reportedQuarantines.add(quarantineKey);
            logger.warn?.(`[InteractiveUI] Hosted OCIX ${extension.id} is unavailable: ${error?.code ?? error}`);
          }
        }
        continue;
      }
      if (active.delivery === 'remote') {
        try {
          if (typeof active.generationId !== 'string') {
            // No private lifecycle generation: a record that predates the
            // current install/connect (or was hand-stripped) fails closed, do
            // not issue the root (no installationId compatibility fallback);
            // it is usable again only after reconnect/reinstall.
            throw new InteractiveUIExtensionManagerError(
              `${extension.id}@${extension.activeVersion} has no lifecycle generation; reconnect`,
              'remote_shell_integrity_failed',
              409,
            );
          }
          roots.push({
            directory: await verifyRemoteShellRoot(extension, active),
            provenance: { generation: active.generationId },
          });
        } catch (error) {
          const quarantineKey = `${extension.id}@${extension.activeVersion}:${error?.code ?? 'remote_shell_integrity_failed'}`;
          if (!reportedQuarantines.has(quarantineKey)) {
            reportedQuarantines.add(quarantineKey);
            logger.warn?.(`[InteractiveUI] Remote OCIX ${extension.id} is unavailable: ${error?.code ?? error}`);
          }
        }
        continue;
      }
      if ((await fsImpl.stat(directory)).isDirectory()) {
        // Local: only issue the root when a private lifecycle generation
        // exists (legacy records without one fail closed at resolution).
        if (typeof active.generationId === 'string') {
          roots.push({ directory, provenance: { generation: active.generationId } });
        }
      }
    }
    if (stateChanged) {
      await commitStateWithAgentRuntime(previousState, state, { reload: runtimeChanged });
    }
    return roots;
  });

  const refreshHosted = (id, options = {}) => mutate(async () => {
    assertNamespacedId(id, 'Extension id');
    const previousState = await readState();
    const nextState = clone(previousState);
    const extension = nextState.extensions[id];
    if (!extension) throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    const metadata = extension.versions?.[extension.activeVersion];
    const trust = await readTrust();
    const result = await refreshHostedMetadata(extension, metadata, trust, {
      force: true,
      confirmedManifestHash: options.confirmedManifestHash,
    });
    const openCode = await commitStateWithAgentRuntime(previousState, nextState, {
      reload: result.runtimeChanged,
    });
    if (result.confirmationRequired) {
      throw new InteractiveUIExtensionManagerError(
        'Hosted OCIX update requests additional permissions',
        'hosted_permission_confirmation_required',
        403,
        { ...result.pendingUpdate, openCode },
      );
    }
    return { extension: sanitizeExtensionOutput(extension), fallback: result.fallback === true, openCode };
  });

  const initialize = () => mutate(async () => {
    try {
      const previousState = await readState();
      const nextState = clone(previousState);
      // Normal state reconciliation shape ONLY: initialize must never
      // synthesize a private lifecycle generationId for any pre-existing
      // record (parent AGENTS.md: no compatibility layers/fallbacks/
      // migrations). generationId is created ONLY by current install/connect;
      // any Local/Hosted/Remote record missing it stays fail-closed (no
      // managed root, no authorization of manager-owned bytes) until it is
      // reinstalled/reconnected. Public sanitizers still remove it.
      const openCode = await commitStateWithAgentRuntime(
        previousState,
        nextState,
        { reload: false },
      );
      builtInRuntimeStatus = builtInRuntime
        ? { id: builtInRuntime.extensionId, version: builtInRuntime.version, status: 'ready' }
        : { status: 'not-configured' };
      return openCode;
    } catch (error) {
      builtInRuntimeStatus = builtInRuntime
        ? {
            id: builtInRuntime.extensionId,
            version: builtInRuntime.version,
            status: error?.status === 409 ? 'conflict' : 'error',
            errorCode: typeof error?.code === 'string' ? error.code : 'agent_runtime_error',
          }
        : { status: 'not-configured' };
      throw error;
    }
  });

  const list = async () => {
    const [state, trust, marketplaces] = await Promise.all([readState(), readTrust(), readMarketplaces()]);
    const integrityByExtension = Object.fromEntries(await Promise.all(
      Object.values(state.extensions ?? {}).map(async (extension) => {
        const active = extension.versions?.[extension.activeVersion];
        if (!active) {
          return [extension.id, { status: 'failed', code: 'extension_integrity_failed' }];
        }
        const packageIntegrity = await inspectInstalledVersionIntegrity(extension, active);
        if (packageIntegrity.status !== 'ready') {
          return [extension.id, packageIntegrity];
        }
        if (active.delivery === 'hosted') {
          return [extension.id, await inspectHostedCacheIntegrity(extension, active)];
        }
        if (active.delivery === 'remote') {
          return [extension.id, await inspectRemoteShellIntegrity(extension, active)];
        }
        return [extension.id, packageIntegrity];
      }),
    ));
    return {
      apiVersion: 1,
      builtInRuntime: clone(builtInRuntimeStatus),
      extensions: sanitizeExtensions(state, integrityByExtension),
      ...sanitizeTrust(trust),
      ...sanitizeMarketplaces(marketplaces),
    };
  };

  const trustPublisher = (publisher) => mutate(async () => {
    const trust = await readTrust();
    const result = trustPublisherInDocument(trust, publisher);
    if (result.added) await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, trust);
    return result;
  });

  const removeTrustedPublisherKey = (publisherId, keyId) => mutate(async () => {
    assertNamespacedId(publisherId, 'Publisher id');
    assertKeyId(keyId);
    const [state, trust] = await Promise.all([readState(), readTrust()]);
    const inUse = Object.values(state.extensions ?? {}).some((extension) => Object.values(extension.versions ?? {}).some(
      (version) => version.publisher?.id === publisherId && version.publisher?.keyId === keyId,
    ));
    if (inUse) throw new InteractiveUIExtensionManagerError('Publisher key is still used by an installed extension', 'publisher_key_in_use', 409);
    const publisher = trust.publishers[publisherId];
    if (!publisher?.keys?.[keyId]) throw new InteractiveUIExtensionManagerError('Publisher key was not found', 'publisher_key_not_found', 404);
    delete publisher.keys[keyId];
    if (Object.keys(publisher.keys).length === 0) delete trust.publishers[publisherId];
    await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, trust);
    return { removed: true };
  });

  const installPackage = (buffer, options) => mutate(() => installPackageInternal(buffer, options));

  const inspectRemote = async (appEntryUrlValue) => {
    const appEntryUrl = normalizeRemoteUrl(appEntryUrlValue, 'Remote app entry URL');
    const remote = await fetchRemoteOcixManifest({ appEntryUrl, fetchImpl, cryptoImpl });
    // Single write-free preflight (metadata + resource entries + Agent Runtime
    // tool bindings) before any trust/install/secret write.
    const normalizedExtension = preflightRemoteShellMetadata(remote, environment);
    const connector = selectRemoteConnector(remote.extension);
    assertRemoteConnectorMatchesValidation(connector, normalizedExtension);
    const trust = await readTrust();
    const trusted = remotePublisherTrusted(trust, remote.publisher, cryptoImpl);
    return summarizeRemoteReview({ ...remote, appEntryUrl, connector }, trusted);
  };

  // The second (private/internal) argument binds the EXACT credential
  // runtime (the route's runtime) once at connect creation; the opaque
  // capability then exposes only zero-redirection operations that close over
  // it and this connect's installationId. Direct connects without a bound
  // runtime can still roll back, but configure/remove fail closed with a
  // controlled non-sensitive error instead of touching arbitrary objects.
  const connectRemote = (input, credentialRuntime = null) => mutate(async () => {
    const appEntryUrl = normalizeRemoteUrl(input?.appEntryUrl, 'Remote app entry URL');
    // TOCTOU safe: connect always refetches and reverifies the signed
    // manifest instead of trusting the earlier inspection response.
    const remote = await fetchRemoteOcixManifest({ appEntryUrl, fetchImpl, cryptoImpl });
    // Single write-free preflight BEFORE trust, shell, Manager state,
    // Agent Runtime, or Secret Store writes.
    const normalizedExtension = preflightRemoteShellMetadata(remote, environment);
    const previousState = await readState();
    if (previousState.extensions[remote.extensionId]) {
      throw new InteractiveUIExtensionManagerError(
        `Remote app ${remote.extensionId} is already installed`,
        'remote_extension_installed',
        409,
      );
    }
    const connector = selectRemoteConnector(remote.extension);
    assertRemoteConnectorMatchesValidation(connector, normalizedExtension);
    const originalTrust = await readTrust();
    const trusted = remotePublisherTrusted(originalTrust, remote.publisher, cryptoImpl);
    const review = summarizeRemoteReview({ ...remote, appEntryUrl, connector }, trusted);
    if (input?.confirmedPublisherFingerprint !== remote.publisher.fingerprint
      || input?.confirmedManifestHash !== remote.manifestHash) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher fingerprint and manifest hash must be confirmed before connecting',
        'remote_confirmation_required',
        403,
        review,
      );
    }
    const trust = clone(originalTrust);
    const trustResult = trustPublisherInDocument(trust, {
      id: remote.publisher.id,
      name: remote.publisher.name,
      keyId: remote.publisher.keyId,
      publicKey: remote.publisher.publicKey,
      source: 'remote-confirmation',
    });
    if (trustResult.added) {
      await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, trust);
    }
    // One cryptographically random installation identity per connect
    // operation. It binds the Remote shell metadata, the credential record,
    // and the failure-atomic rollback; it is route-internal bookkeeping and
    // never appears in public snapshots, responses, logs, or errors.
    const installationId = cryptoImpl.randomUUID();
    try {
      const nextState = clone(previousState);
      const installed = await installRemoteShell({
        remote,
        appEntryUrl,
        connector,
        installationId,
        previousState,
        nextState,
      });
      const connected = {
        extension: {
          id: installed.extension.id,
          name: installed.extension.name,
          version: installed.extension.activeVersion,
        },
        connector,
      };
      // Opaque manager-owned capability bound to EXACTLY this connect's
      // installation: exposes operations (configure/remove/rollback), never
      // the raw installationId/trustAdded, and is non-enumerable so the
      // normal result serializes only to the intended public extension/
      // connector fields. The underlying rollback still validates the current
      // installation identity (stale-replacement refusal) and the runtime
      // credential store binds the installation, so a forged/reused
      // capability cannot affect a different installation.
      Object.defineProperty(connected, 'capability', {
        value: Object.freeze({
          // The credential runtime is bound at connect creation and is NEVER
          // caller-supplied: the capability accepts no runtime/store/manager
          // argument, so a fake runtime cannot redirect these operations or
          // capture the hidden installationId.
          configureCredential: async (accessKey) => {
            if (!credentialRuntime) {
              throw new InteractiveUIExtensionManagerError(
                'Remote credential runtime is unavailable',
                'remote_credential_runtime_unavailable',
                409,
              );
            }
            return credentialRuntime.configureRemoteConnection(
              installed.extension.id,
              connector.id,
              installationId,
              accessKey,
            );
          },
          removeCredential: async () => {
            if (!credentialRuntime) {
              throw new InteractiveUIExtensionManagerError(
                'Remote credential runtime is unavailable',
                'remote_credential_runtime_unavailable',
                409,
              );
            }
            return credentialRuntime.removeRemoteConnection(
              installed.extension.id,
              connector.id,
              installationId,
            );
          },
          rollback: async () => rollbackRemoteConnect(installed.extension.id, {
            trustAdded: trustResult.added === true,
            installationId,
          }),
        }),
        enumerable: false,
        configurable: false,
        writable: false,
      });
      return connected;
    } catch (error) {
      if (trustResult.added) {
        await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, originalTrust).catch((rollbackError) => {
          logger.error?.('[InteractiveUI] Failed to roll back Remote publisher trust', rollbackError);
        });
      }
      throw error;
    }
  });

  const rollbackRemoteConnect = (extensionId, options = {}) => mutate(async () => {
    assertNamespacedId(extensionId, 'Extension id');
    const installationId = options.installationId;
    if (typeof installationId !== 'string' || !installationId || installationId.length > 128) {
      throw new InteractiveUIExtensionManagerError(
        'Remote rollback requires its installation identity',
        'remote_rollback_installation_changed',
        409,
      );
    }
    const previousState = await readState();
    const nextState = clone(previousState);
    const extension = nextState.extensions[extensionId];
    if (!extension) throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    const metadata = extension.versions?.[extension.activeVersion];
    if (!metadata || metadata.delivery !== 'remote') {
      throw new InteractiveUIExtensionManagerError(
        'Extension was not installed by Remote connect; refusing to remove it',
        'remote_rollback_unavailable',
        409,
      );
    }
    // Refuse all mutation when the current active Remote metadata belongs to
    // a different installation: a stale rollback must never remove a
    // replacement shell or its trust.
    if (metadata.remote?.installationId !== installationId) {
      throw new InteractiveUIExtensionManagerError(
        'Remote installation changed since this connect; rollback refused',
        'remote_rollback_installation_changed',
        409,
      );
    }
    const source = pathImpl.join(versionsDirectory, extensionId);
    const trash = pathImpl.join(trashDirectory, `${extensionId}-${Date.now()}-${cryptoImpl.randomUUID()}`);
    let moved = false;
    await fsImpl.mkdir(trashDirectory, { recursive: true, mode: 0o700 });
    try {
      await fsImpl.rename(source, trash);
      moved = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    delete nextState.extensions[extensionId];
    try {
      // The lazy Remote resource cache is cleared BEFORE the durable state
      // removal: a cache-clear failure aborts the rollback while the shell is
      // still restorable, keeping rollback failure-atomic. Losing only the
      // cache later would be safe (it is re-fetchable), but a stale durable
      // removal must not be claimed when cleanup failed.
      await remoteResourceCache.clearExtension(extensionId);
      const openCode = await commitStateWithAgentRuntime(previousState, nextState);
      let trustRolledBack = false;
      let trustRetainedInUse = false;
      if (options.trustAdded === true) {
        // Race-safe: this key may only be removed when no remaining installed
        // version references this publisher id/keyId after this extension is
        // gone. nextState is the authoritative post-removal state because all
        // mutations share the serialized mutation queue.
        const publisherId = metadata.publisher?.id;
        const keyId = metadata.publisher?.keyId;
        const stillInUse = Object.values(nextState.extensions ?? {}).some((candidate) => (
          isRecord(candidate)
          && Object.values(candidate.versions ?? {}).some((version) => (
            isRecord(version)
            && version.publisher?.id === publisherId
            && version.publisher?.keyId === keyId
          ))
        ));
        if (!stillInUse) {
          try {
            const trust = await readTrust();
            const publisher = trust.publishers?.[publisherId];
            if (publisher?.keys?.[keyId]) {
              delete publisher.keys[keyId];
              if (Object.keys(publisher.keys).length === 0) delete trust.publishers[publisherId];
              await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, trust);
              trustRolledBack = true;
            }
          } catch (error) {
            logger.error?.('[InteractiveUI] Failed to roll back Remote publisher trust', error);
          }
        } else {
          trustRetainedInUse = true;
        }
      }
      await fsImpl.rm(trash, { recursive: true, force: true }).catch(() => {});
      return {
        removed: true,
        trustRolledBack,
        ...(trustRetainedInUse ? { trustRetainedInUse: true } : {}),
        openCode,
      };
    } catch (error) {
      if (moved) await fsImpl.rename(trash, source).catch(() => {});
      throw error;
    }
  });

  const setEnabled = (id, enabled) => mutate(async () => {
    assertNamespacedId(id, 'Extension id');
    if (typeof enabled !== 'boolean') throw new InteractiveUIExtensionManagerError('Enabled must be a boolean', 'invalid_enabled');
    const previousState = await readState();
    const nextState = clone(previousState);
    const extension = nextState.extensions[id];
    if (!extension) throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    if (enabled) {
      const active = extension.versions?.[extension.activeVersion];
      await verifyInstalledVersionIntegrity(
        extension,
        active,
        pathImpl.join(versionsDirectory, extension.id, extension.activeVersion),
      );
      if (active.delivery === 'hosted') {
        const trust = await readTrust();
        const refreshed = await refreshHostedMetadata(extension, active, trust);
        if (refreshed.confirmationRequired && !refreshed.root) {
          throw new InteractiveUIExtensionManagerError(
            'Hosted OCIX requires permission confirmation before it can be enabled',
            'hosted_permission_confirmation_required',
            403,
            refreshed.pendingUpdate,
          );
        }
      }
      if (active.delivery === 'remote') {
        await verifyRemoteShellRoot(extension, active);
      }
    }
    extension.enabled = enabled;
    const openCode = await commitStateWithAgentRuntime(previousState, nextState);
    return { ...sanitizeExtensionOutput(extension), openCode };
  });

  const rollback = (id) => mutate(async () => {
    assertNamespacedId(id, 'Extension id');
    const previousState = await readState();
    const nextState = clone(previousState);
    const extension = nextState.extensions[id];
    if (!extension) throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    let previous;
    while (extension.activationHistory.length && !previous) {
      const candidate = extension.activationHistory.pop();
      if (candidate !== extension.activeVersion && extension.versions[candidate]) previous = candidate;
    }
    if (!previous) throw new InteractiveUIExtensionManagerError('No previously active version is available', 'rollback_unavailable', 409);
    await verifyInstalledVersionIntegrity(
      extension,
      extension.versions[previous],
      pathImpl.join(versionsDirectory, extension.id, previous),
    );
    const previousMetadata = extension.versions[previous];
    if (previousMetadata.delivery === 'hosted') {
      const trust = await readTrust();
      const refreshed = await refreshHostedMetadata(extension, previousMetadata, trust);
      if (refreshed.confirmationRequired && !refreshed.root) {
        throw new InteractiveUIExtensionManagerError(
          'Hosted OCIX rollback target requires permission confirmation',
          'hosted_permission_confirmation_required',
          403,
          refreshed.pendingUpdate,
        );
      }
    }
    const current = extension.activeVersion;
    extension.activeVersion = previous;
    extension.activationHistory.push(current);
    const openCode = await commitStateWithAgentRuntime(previousState, nextState);
    return { ...sanitizeExtensionOutput(extension), openCode };
  });

  const uninstall = (id) => mutate(async () => {
    assertNamespacedId(id, 'Extension id');
    const previousState = await readState();
    const nextState = clone(previousState);
    const extension = nextState.extensions[id];
    if (!extension) throw new InteractiveUIExtensionManagerError('Extension was not found', 'extension_not_found', 404);
    const source = pathImpl.join(versionsDirectory, id);
    const trash = pathImpl.join(trashDirectory, `${id}-${Date.now()}-${cryptoImpl.randomUUID()}`);
    let moved = false;
    await fsImpl.mkdir(trashDirectory, { recursive: true, mode: 0o700 });
    try {
      await fsImpl.rename(source, trash);
      moved = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    delete nextState.extensions[id];
    try {
      // The lazy Remote resource cache is cleared BEFORE the durable state
      // removal ONLY when the uninstalled extension has a Remote version: a
      // corrupt/symlinked Remote cache must never block an unrelated Local or
      // Hosted uninstall. A cache-clear failure still aborts a Remote
      // uninstall while the shell is restorable (failure-atomic). The Hosted
      // OCIX cache below stays best-effort (existing behavior).
      const hasRemoteVersion = Object.values(extension.versions ?? {}).some(
        (version) => isRecord(version) && version.delivery === 'remote',
      );
      if (hasRemoteVersion) {
        await remoteResourceCache.clearExtension(id);
      }
      const openCode = await commitStateWithAgentRuntime(previousState, nextState);
      await fsImpl.rm(pathImpl.join(hostedCacheDirectory, id), { recursive: true, force: true }).catch((error) => {
        logger.warn?.(`[InteractiveUI] Failed to remove Hosted OCIX cache for ${id}`, error);
      });
      return { removed: true, recoveryPath: moved ? trash : null, openCode };
    } catch (error) {
      if (moved) await fsImpl.rename(trash, source).catch(() => {});
      throw error;
    }
  });

  const downloadAndVerifyCatalog = async (catalogUrl, publicKey) => {
    let response;
    try {
      response = await fetchImpl(catalogUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new InteractiveUIExtensionManagerError('Marketplace catalog request failed', 'marketplace_unavailable', 502);
    }
    if (!response.ok) throw new InteractiveUIExtensionManagerError(`Marketplace catalog request failed (${response.status})`, 'marketplace_unavailable', 502);
    const bytes = await responseBytes(response, MAX_CATALOG_BYTES, 'Marketplace catalog');
    let catalog;
    try {
      catalog = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new InteractiveUIExtensionManagerError('Marketplace catalog is not valid JSON', 'invalid_catalog', 502);
    }
    const verified = verifySignedExtensionCatalog({ catalog, publicKey, cryptoImpl });
    return { catalog, verified };
  };

  const inspectMarketplaceInternal = async (catalogUrlValue) => {
    const catalogUrl = normalizeRemoteUrl(catalogUrlValue, 'Marketplace catalog URL');
    const { catalog, verified } = await downloadAndVerifyCatalog(catalogUrl);
    return {
      id: catalog.marketplace.id,
      name: catalog.marketplace.name,
      keyId: catalog.marketplace.keyId,
      catalogUrl,
      publicKey: normalizeEd25519PublicKey(catalog.marketplace.publicKey, cryptoImpl),
      fingerprint: verified.fingerprint,
      extensionCount: catalog.entries.length,
    };
  };

  const inspectMarketplace = async (catalogUrl) => {
    const { publicKey: _publicKey, ...inspection } = await inspectMarketplaceInternal(catalogUrl);
    return inspection;
  };

  const addMarketplace = (input) => mutate(async () => {
    const inspected = input?.publicKey
      ? {
          id: assertNamespacedId(input?.id, 'Marketplace id'),
          name: assertDisplayName(input?.name, 'Marketplace name'),
          keyId: assertKeyId(input?.keyId),
          catalogUrl: normalizeRemoteUrl(input?.catalogUrl, 'Marketplace catalog URL'),
          publicKey: normalizeEd25519PublicKey(input?.publicKey, cryptoImpl),
        }
      : await inspectMarketplaceInternal(input?.catalogUrl);
    const id = assertNamespacedId(inspected.id, 'Marketplace id');
    const name = assertDisplayName(inspected.name, 'Marketplace name');
    const keyId = assertKeyId(inspected.keyId);
    const { catalogUrl, publicKey } = inspected;
    const fingerprint = publicKeyFingerprint(publicKey, cryptoImpl);
    if (!input?.publicKey && input?.confirmedFingerprint !== fingerprint) {
      throw new InteractiveUIExtensionManagerError(
        'Marketplace trust confirmation is required before adding this catalog',
        'marketplace_confirmation_required',
        403,
        { id, name, keyId, catalogUrl, fingerprint, extensionCount: inspected.extensionCount },
      );
    }
    const marketplaces = await readMarketplaces();
    const existing = marketplaces.marketplaces[id];
    if (existing && existing.fingerprint !== fingerprint) {
      throw new InteractiveUIExtensionManagerError('Marketplace already exists with a different signing key', 'marketplace_key_conflict', 409);
    }
    marketplaces.marketplaces[id] = {
      id,
      name,
      keyId,
      catalogUrl,
      publicKey,
      fingerprint,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, marketplacesPath, marketplaces);
    return { id, name, keyId, catalogUrl, fingerprint };
  });

  const removeMarketplace = (id) => mutate(async () => {
    assertNamespacedId(id, 'Marketplace id');
    const marketplaces = await readMarketplaces();
    if (!marketplaces.marketplaces[id]) throw new InteractiveUIExtensionManagerError('Marketplace was not found', 'marketplace_not_found', 404);
    delete marketplaces.marketplaces[id];
    await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, marketplacesPath, marketplaces);
    return { removed: true };
  });

  const fetchMarketplaceCatalogInternal = async (id) => {
    assertNamespacedId(id, 'Marketplace id');
    const marketplaces = await readMarketplaces();
    const marketplace = marketplaces.marketplaces[id];
    if (!marketplace) throw new InteractiveUIExtensionManagerError('Marketplace was not found', 'marketplace_not_found', 404);
    const { catalog, verified } = await downloadAndVerifyCatalog(marketplace.catalogUrl, marketplace.publicKey);
    if (catalog.marketplace.id !== marketplace.id || catalog.marketplace.keyId !== marketplace.keyId) {
      throw new InteractiveUIExtensionManagerError('Marketplace catalog identity does not match its configuration', 'catalog_identity_mismatch', 403);
    }
    return { marketplace: { id: marketplace.id, name: marketplace.name, fingerprint: verified.fingerprint }, catalog };
  };

  const fetchMarketplaceCatalog = (id) => fetchMarketplaceCatalogInternal(id);

  const installFromMarketplace = (marketplaceId, extensionId, version) => mutate(async () => {
    assertNamespacedId(extensionId, 'Extension id');
    const { catalog } = await fetchMarketplaceCatalogInternal(marketplaceId);
    const entry = catalog.entries.find((candidate) => candidate.id === extensionId && candidate.version === version);
    if (!entry) throw new InteractiveUIExtensionManagerError('Marketplace extension version was not found', 'marketplace_entry_not_found', 404);
    const packageUrl = normalizeRemoteUrl(entry.packageUrl, 'Extension package URL');
    let response;
    try {
      response = await fetchImpl(packageUrl, { headers: { Accept: 'application/vnd.openchamber.ocix+zip' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new InteractiveUIExtensionManagerError('Extension package download failed', 'package_download_failed', 502);
    }
    if (!response.ok) throw new InteractiveUIExtensionManagerError(`Extension package download failed (${response.status})`, 'package_download_failed', 502);
    const buffer = await responseBytes(response, MAX_PACKAGE_BYTES, 'Extension package');
    if (packageHash(cryptoImpl, buffer) !== entry.packageHash) {
      throw new InteractiveUIPackageError('Downloaded extension package hash does not match the signed catalog', 'catalog_package_hash_mismatch', 403);
    }
    return installPackageInternal(buffer, {
      source: { type: 'marketplace', marketplaceId, packageUrl },
      catalogPublisher: { ...entry.publisher, source: `marketplace:${marketplaceId}` },
    });
  });

  return {
    initialize,
    list,
    getEnabledExtensionRoots,
    authorizeExtensionAuthority,
    resolveExtensionResource,
    trustPublisher,
    removeTrustedPublisherKey,
    inspectPackage,
    installPackage,
    inspectRemote,
    connectRemote,
    setEnabled,
    refreshHosted,
    rollback,
    uninstall,
    addMarketplace,
    inspectMarketplace,
    removeMarketplace,
    fetchMarketplaceCatalog,
    installFromMarketplace,
  };
};
