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
  discardResponseBody,
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  materializeHostedOcix,
  normalizeHostedPermissions,
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
const TRUST_TRANSACTION_SCHEMA = 'openchamber://extension-trust-transaction/v1';
const MARKETPLACES_SCHEMA = 'openchamber://extension-marketplaces/v1';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const BLOCKED_KEY_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const STABLE_CODE_PATTERN = /^[a-z0-9_]+$/;

// Phase R3 Remote lifecycle probe cache defaults: process-lifetime 45-second
// TTL with a modest fixed cap and deterministic (oldest-first by cachedAt)
// eviction. Injectable in tests via the manager options. All boundaries are
// INCLUSIVE: a hit remains valid at now === expiresAt and expires only at
// expiresAt + 1.
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

class InteractiveUIExtensionManagerError extends Error {
  constructor(message, code = 'extension_manager_error', status = 400, details = undefined) {
    super(message);
    this.name = 'InteractiveUIExtensionManagerError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Phase R3 candidate-failure classification: deterministic signed-candidate
// validation failures (never transient network flakiness) with stable,
// actionable codes and fixed non-sensitive messages.
const REMOTE_CANDIDATE_FAILURES = {
  remote_update_version_reuse: { status: 409, message: 'Remote app reuses the current version with different signed content; the vendor must change the version' },
  remote_update_rollback_not_required: { status: 403, message: 'Remote app downgrade requires a signed required update' },
  remote_publisher_changed: { status: 403, message: 'Remote app publisher identity changed; reconnect after reviewing the new publisher' },
  remote_trust_conflict: { status: 403, message: 'Remote app signing key conflicts with the trusted key; do not replace a trusted key' },
  remote_connector_changed: { status: 409, message: 'Remote app connector identity changed; reconnect instead of updating' },
  remote_identity_mismatch: { status: 403, message: 'Remote app identity does not match the installed extension' },
  invalid_hosted_manifest: { status: 400, message: 'Remote app signed manifest is invalid' },
};

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

const emptyRemoteHealthProbe = (code = null) => ({
  status: 'unknown',
  checkedAt: null,
  ...(code ? { code } : {}),
});
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
    // Best-effort discard of the declared-oversized body so hostile/unbounded
    // bytes are never retained; cancellation failure must never mask the
    // authoritative size error.
    await discardResponseBody(response);
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
    // Defensive: a releaseLock failure must never mask the authoritative
    // read/overflow outcome.
    try {
      reader.releaseLock();
    } catch {
      // Best-effort only.
    }
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
      if (isRecord(version.remote)) {
        delete version.remote.installationId;
        // Raw persisted required-update block is stripped here; list() maps it
        // to the safe `remote.blocked` summary (never raw internal records).
        delete version.remote.blockedUpdate;
      }
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
  // Phase R3 Remote lifecycle probe cache: process-lifetime 45-second TTL
  // (injectable in tests). All cache time boundaries are INCLUSIVE and the
  // clock is validated before any read/write.
  remoteProbeTtlMs = REMOTE_LIFECYCLE_TTL_MS,
  now = Date.now,
  // Test-only/injected deterministic pause hook for the stale-clear TOCTOU
  // regression: runs OUTSIDE the mutation queue immediately before the
  // clearing mutate, so a test can interleave a newer persisted block between
  // the probe and the clearing comparison. Never used in production.
  beforeClearRemoteBlockedUpdate = null,
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || typeof fetchImpl !== 'function') {
    throw new Error('Interactive UI extension manager dependencies are incomplete');
  }
  const root = pathImpl.resolve(dataDirectory);
  const managerDirectory = pathImpl.join(root, 'interactive-ui');
  const statePath = pathImpl.join(managerDirectory, 'installations.json');
  const trustPath = pathImpl.join(managerDirectory, 'trust.json');
  // Durable publisher-trust transaction journal (key rotation): a bounded,
  // manager-owned, owner-only recovery record persisted BEFORE any candidate
  // trust write. It makes the candidate key NON-AUTHORITATIVE until the
  // transaction resolves against exact committed state. Never exposed
  // publicly; see resolveTrustTransaction below.
  const trustTransactionPath = pathImpl.join(managerDirectory, 'trust-transaction.json');
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
  // In-memory active publisher-trust transaction: exists ONLY while a
  // key-rotation apply is executing. It marks the candidate trust as
  // INTERNAL-ONLY — ordinary trust reads fail closed while it is set, and the
  // candidate is passed explicitly only into the apply's own verification
  // chain (verifyRemoteShellRoot/reverifyRemoteShell and the runtime-safe
  // state commit). Cleared (and the durable journal resolved) before the
  // apply returns; any trust read with no active transaction first resolves
  // the durable journal.
  let activeTrustTransaction = null;

  // Phase R3 Remote lifecycle probe cache (manager-owned, PROCESS-LIFETIME,
  // in-memory): stores ONLY safe success and safe failure probe results plus
  // the immutable probe subject (generation, accepted manifest hash,
  // appEntryUrl) that binds them to the exact installed state. Health and
  // ordinary probe cache entries are intentionally ephemeral — a process
  // restart drops all entries (safe early invalidation). No unbounded growth:
  // a modest fixed cap with deterministic oldest-first (by cachedAt) eviction.
  // Same-extension in-flight probes coalesce; manual force bypasses a settled
  // TTL entry but still joins the current in-flight probe.
  const remoteLifecycleCache = new Map();
  const remoteProbeInFlight = new Map();

  // Single source of truth for a VALID probe timestamp: a non-negative safe
  // integer within ECMAScript Date's representable range (so toISOString can
  // never throw), whose sum with ttlMs is ALSO a safe integer (so cachedAt +
  // ttlMs is exactly representable and equals the stored expiresAt).
  // NaN/Infinity, fractional, negative, out-of-Date-range, and
  // overflow-near-MAX_SAFE_INTEGER clocks read/write/cache nothing.
  const MAX_DATE_MS = 8_640_000_000_000_000;
  const isValidProbeTime = (value) => (
    Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_MS
    && Number.isSafeInteger(value + remoteProbeTtlMs)
  );

  const currentProbeTime = () => {
    const value = now();
    return isValidProbeTime(value) ? value : null;
  };

  const currentProbeIso = () => {
    const value = currentProbeTime();
    if (value === null) return null;
    try {
      return new Date(value).toISOString();
    } catch {
      return null; // defensive: invalid values produce checkedAt null, never throw
    }
  };

  const storeRemoteLifecycle = (extensionId, entry) => {
    if (remoteLifecycleCache.has(extensionId)) remoteLifecycleCache.delete(extensionId);
    remoteLifecycleCache.set(extensionId, entry);
    while (remoteLifecycleCache.size > REMOTE_LIFECYCLE_MAX_ENTRIES) {
      let oldestKey = null;
      let oldestCachedAt = Infinity;
      for (const [key, candidate] of remoteLifecycleCache) {
        if (candidate.cachedAt < oldestCachedAt) {
          oldestCachedAt = candidate.cachedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      remoteLifecycleCache.delete(oldestKey);
    }
  };

  const readCachedRemoteLifecycle = (extensionId, snapshot) => {
    const nowValue = currentProbeTime();
    if (nowValue === null) return null;
    const cached = remoteLifecycleCache.get(extensionId);
    // Backward-clock regression (now < cachedAt) is a MISS, never a hit;
    // inclusive upper boundary retained (a hit remains valid at now ===
    // expiresAt and expires only at expiresAt + 1).
    if (!cached || nowValue < cached.cachedAt || nowValue > cached.expiresAt) return null;
    if (cached.subject.generation !== snapshot.generationId
      || cached.subject.acceptedManifestHash !== snapshot.acceptedManifest.manifestHash
      || cached.subject.appEntryUrl !== snapshot.appEntryUrl) {
      return null;
    }
    return cached;
  };

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

  const commitStateWithAgentRuntime = async (previousState, nextState, { reload = true, trustOverride = null } = {}) => {
    const runtimeState = await createRuntimeSafeState(nextState, trustOverride);
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
  // Durable publisher-trust transaction (key rotation): BEFORE the candidate
  // key is written, a bounded manager-owned journal durably records the
  // transaction id, the extension id, the prior/candidate contract identity,
  // and the exact original/candidate trust documents (owner-only via
  // atomicWriteJson). The journal makes the candidate key NON-AUTHORITATIVE
  // until the transaction resolves: every trust read with no matching
  // in-memory active transaction resolves the journal against exact committed
  // manager state, deletes it only AFTER read-back verification, and FAILS
  // CLOSED when recovery I/O cannot complete. The journal is never exposed
  // publicly (it lives outside trust/state/marketplace documents).
  const readTrustTransaction = async () => {
    const journal = await readJson(fsImpl, trustTransactionPath, () => null, TRUST_TRANSACTION_SCHEMA);
    if (!journal) return null;
    if (!isRecord(journal.candidate) || !isRecord(journal.originalTrust) || !isRecord(journal.candidateTrust)
      || typeof journal.transactionId !== 'string' || !journal.transactionId
      || typeof journal.extensionId !== 'string' || !journal.extensionId
      || typeof journal.candidate.version !== 'string' || !journal.candidate.version
      || !SHA256_PATTERN.test(journal.candidate.manifestHash ?? '')
      || typeof journal.candidate.publisherKeyId !== 'string' || !journal.candidate.publisherKeyId) {
      throw new InteractiveUIExtensionManagerError('Publisher trust transaction is invalid', 'manager_data_corrupt', 500);
    }
    return journal;
  };

  // Resolves a durable trust transaction against the EXACT committed manager
  // state — never a guess: the candidate contract is committed only when the
  // active version, its publisher key id, and its accepted manifest hash all
  // match the journal's candidate exactly. Retains the candidate trust when
  // committed, otherwise restores the exact original trust, VERIFIES the
  // selected authoritative trust by read-back, and only then deletes the
  // journal. Any I/O failure throws (fail closed): the journal stays and the
  // candidate key authorizes nothing until recovery succeeds.
  const resolveTrustTransaction = async (journal) => {
    const state = await readState();
    const extension = state.extensions?.[journal.extensionId];
    const committed = isRecord(extension)
      && extension.activeVersion === journal.candidate.version
      && isRecord(extension.versions?.[journal.candidate.version])
      && isRecord(extension.versions[journal.candidate.version].publisher)
      && extension.versions[journal.candidate.version].publisher.keyId === journal.candidate.publisherKeyId
      && isRecord(extension.versions[journal.candidate.version].remote?.acceptedManifest)
      && extension.versions[journal.candidate.version].remote.acceptedManifest.manifestHash === journal.candidate.manifestHash;
    const authoritative = committed ? journal.candidateTrust : journal.originalTrust;
    await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, authoritative);
    const stored = await readJson(fsImpl, trustPath, emptyTrust, TRUST_SCHEMA);
    if (!isRecord(stored.publishers) || canonicalStringify(stored) !== canonicalStringify(authoritative)) {
      throw new InteractiveUIExtensionManagerError(
        'Publisher trust recovery could not be verified',
        'remote_update_trust_rollback_failed',
        500,
      );
    }
    // Deletion only after verified restoration; a failed delete leaves an
    // idempotent journal that the next resolution re-verifies and retries.
    await fsImpl.rm(trustTransactionPath, { force: true }).catch(() => {});
  };

  // Every ordinary trust read (and manager initialization) must resolve a
  // durable trust transaction when NO matching in-memory transaction is
  // active. While an apply executes, its in-memory transaction makes the
  // candidate trust INTERNAL-ONLY: ordinary reads fail closed (see readTrust)
  // and never resolve/delete the journal mid-apply; the candidate is passed
  // explicitly only into the apply's own internal verification chain, and the
  // transaction resolves (success finalize or journal recovery) before the
  // apply returns.
  const resolveTrustTransactionIfPresent = async () => {
    if (activeTrustTransaction) return;
    const journal = await readTrustTransaction();
    if (journal) await resolveTrustTransaction(journal);
  };

  const readTrust = async () => {
    if (activeTrustTransaction) {
      // In-flight key-rotation candidate trust is INTERNAL-ONLY: ordinary
      // reads must never treat a not-yet-committed signing key as ordinary
      // trusted publisher state, must not resolve/delete the journal
      // mid-apply, and must never expose/sanitize/cache the candidate. Fail
      // closed with a stable non-sensitive error; the apply resolves the
      // transaction (success finalize or journal recovery) before it returns.
      throw new InteractiveUIExtensionManagerError(
        'Publisher trust is temporarily unavailable while a Remote app update is in progress',
        'remote_trust_transaction_in_progress',
        503,
      );
    }
    await resolveTrustTransactionIfPresent();
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

  const createRuntimeSafeState = async (state, trustOverride = null) => {
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
        // The trust override (when passed) is the in-flight candidate trust
        // document: original trust plus the confirmed new key, so every Remote
        // extension validated by the same commit call verifies identically.
        const remoteIntegrity = await inspectRemoteShellIntegrity(extension, active, trustOverride);
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
  const reverifyRemoteShell = async (extension, metadata, trustOverride = null) => {
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
    // Narrow internal trust override: only the in-flight key-rotation apply
    // passes its candidate trust here (scoped to its own commit call); all
    // other callers read ordinary trust.
    const trust = trustOverride ?? await readTrust();
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

  const verifyRemoteShellRoot = async (extension, metadata, trustOverride = null) => {
    const { directory } = await reverifyRemoteShell(extension, metadata, trustOverride);
    return directory;
  };

  const inspectRemoteShellIntegrity = async (extension, metadata, trustOverride = null) => {
    try {
      await verifyRemoteShellRoot(extension, metadata, trustOverride);
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

  // ---- Phase R3 Remote lifecycle (health/update probes) ----
  //
  // Contract: capture the current Remote authority/trust state under a SHORT
  // mutate-queue phase, perform ALL network verification OUTSIDE the global
  // mutation queue (one slow/broken Remote must not block unrelated manager
  // operations), then revalidate the current generation/hash inside a short
  // mutate phase before any store/apply. Probe results (safe success AND safe
  // failure status) are cached process-lifetime with a 45s TTL, bounded
  // storage, and same-extension in-flight coalescing; manual force bypasses a
  // settled TTL entry but still joins the current in-flight probe.

  // Immutable scalar snapshot of the current Remote authority/trust state,
  // captured inside mutate and consumed by the network probe and by apply.
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
    const acceptedManifest = metadata.remote.acceptedManifest;
    const connectorRef = Array.isArray(metadata.remote.connectorRefs)
      ? metadata.remote.connectorRefs[0]
      : undefined;
    if (!isRecord(acceptedManifest)
      || !SHA256_PATTERN.test(acceptedManifest.manifestHash ?? '')
      || typeof acceptedManifest.version !== 'string'
      || typeof metadata.generationId !== 'string'
      || !isRecord(metadata.publisher)
      || !ID_PATTERN.test(metadata.publisher.id ?? '')
      || !KEY_ID_PATTERN.test(metadata.publisher.keyId ?? '')
      || !SHA256_PATTERN.test(metadata.publisher.fingerprint ?? '')
      || typeof metadata.remote.appEntryUrl !== 'string'
      || !isRecord(metadata.remote.approvedPermissions)
      || !isRecord(connectorRef)
      || typeof connectorRef.id !== 'string'
      || connectorRef.authType !== 'api-key') {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no valid Remote state`,
        'remote_shell_integrity_failed',
        409,
      );
    }
    return Object.freeze({
      extensionId,
      extensionName: typeof extension.name === 'string' ? extension.name : extension.id,
      activeVersion: extension.activeVersion,
      generationId: metadata.generationId,
      appEntryUrl: metadata.remote.appEntryUrl,
      // Private credential-binding identity, reused verbatim across updates
      // (never exposed in public output) so the installation-bound Secret
      // Store record stays valid.
      installationId: metadata.remote.installationId,
      acceptedManifest: Object.freeze({
        version: acceptedManifest.version,
        manifestHash: acceptedManifest.manifestHash,
      }),
      publisher: Object.freeze({
        id: metadata.publisher.id,
        name: metadata.publisher.name,
        keyId: metadata.publisher.keyId,
        fingerprint: metadata.publisher.fingerprint,
      }),
      connector: Object.freeze({ id: connectorRef.id }),
      approvedPermissions: clone(metadata.remote.approvedPermissions),
      persistedBlockedUpdate: isRecord(metadata.remote.blockedUpdate)
        ? clone(metadata.remote.blockedUpdate)
        : null,
    });
  };

  // Permission delta classification over the existing COMPLETE Hosted
  // permission model: any added list item or false→true boolean is expanded;
  // no additions plus any removal/true→false is reduced; exact equality is
  // none. nativeCode 0→1 is an expansion (hostedPermissionExpansion returns
  // it in added.nativeCode) and is surfaced separately by the UI.
  const classifyPermissionDelta = (approvedValue, candidateValue) => {
    const added = hostedPermissionExpansion(approvedValue, candidateValue);
    if (added) return { delta: 'expanded', added };
    const approved = normalizeHostedPermissions(approvedValue);
    const candidate = normalizeHostedPermissions(candidateValue);
    let reduced = false;
    for (const key of [
      'resourceOrigins',
      'networkOrigins',
      'externalLinkOrigins',
      'credentialScopes',
      'actionIds',
      'agentToolNames',
    ]) {
      const prior = new Set(approved[key]);
      if (candidate[key].some((item) => !prior.has(item))
        || approved[key].some((item) => !candidate[key].includes(item))) {
        reduced = true;
        break;
      }
    }
    if (!reduced && approved.clipboard && !candidate.clipboard) reduced = true;
    if (!reduced && approved.popups && !candidate.popups) reduced = true;
    if (!reduced && approved.nativeCode && !candidate.nativeCode) reduced = true;
    return { delta: reduced ? 'reduced' : 'none', added: null };
  };

  // The network probe: fetch + fully verify the candidate signed manifest and
  // classify trust/update state against the captured snapshot. NEVER throws
  // for classification conditions (per-extension isolation) and NEVER exposes
  // public keys, signed documents, internal paths, credentials, or raw
  // upstream bodies. Deterministic candidate validation failures (version
  // reuse, unauthorized rollback, publisher/trust/connector changes) are
  // represented as update.failure with a stable code.
  // DETERMINISTIC signed-content/trust failures (never transient network
  // flakiness): invalid signature, publisher envelope/key/fingerprint
  // identity, malformed signed manifest/update metadata, and signed
  // runtime-invalid candidates classify trust_invalid and fail closed.
  // Genuine network/timeout/HTTP-availability failures (including non-JSON
  // transport bodies and origin/URL policy rejections) remain unreachable.
  const TRUST_INVALID_CODES = new Set([
    'invalid_hosted_manifest',
    'invalid_hosted_signature',
    'hosted_signature_identity_mismatch',
    'invalid_hosted_publisher_key',
    'hosted_identity_mismatch',
    'invalid_hosted_resources',
    'invalid_hosted_resource',
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
    'remote_identity_mismatch',
    'remote_publisher_changed',
    'remote_trust_conflict',
    'invalid_hosted_url',
  ]);
  const safeProbeCode = (error, fallback) => (
    typeof error?.code === 'string' && STABLE_CODE_PATTERN.test(error.code) ? error.code : fallback
  );

  const runRemoteLifecycleProbe = async (snapshot) => {
    const checkedAt = currentProbeIso();
    const trust = await readTrust().catch(() => null);
    const storedKey = trust?.publishers?.[snapshot.publisher.id]?.keys?.[snapshot.publisher.keyId];
    if (!isRecord(storedKey) || typeof storedKey.publicKey !== 'string' || !storedKey.publicKey) {
      return {
        health: { status: 'trust_invalid', checkedAt, code: 'publisher_untrusted' },
        update: emptyRemoteUpdateProbe(),
      };
    }
    // SPLIT the transport phase from the signed-content verification phase so
    // a transport outage is never misclassified as a trust failure.
    let document;
    try {
      document = await fetchHostedOcixManifest({ manifestUrl: snapshot.appEntryUrl, fetchImpl });
    } catch (error) {
      // Genuine network/timeout/HTTP-availability failures (and non-JSON
      // transport bodies, origin/URL policy, payload-size) remain
      // unreachable: the old signed contract stays usable.
      return {
        health: {
          status: 'unreachable',
          checkedAt,
          code: safeProbeCode(error, 'hosted_manifest_unavailable'),
        },
        update: emptyRemoteUpdateProbe(),
      };
    }
    let remote;
    try {
      remote = verifyRemoteOcixManifest({ document, cryptoImpl });
    } catch (error) {
      // DETERMINISTIC signed-content/trust failure: invalid signature,
      // publisher envelope/key/fingerprint identity, malformed signed
      // manifest/update metadata → trust_invalid, never reachable.
      const code = safeProbeCode(error, 'invalid_hosted_manifest');
      return {
        health: { status: 'trust_invalid', checkedAt, code },
        update: { ...emptyRemoteUpdateProbe(), failure: { code } },
      };
    }
    if (remote.extensionId !== snapshot.extensionId) {
      return {
        health: { status: 'trust_invalid', checkedAt, code: 'remote_identity_mismatch' },
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_identity_mismatch' } },
      };
    }
    if (remote.publisher.id !== snapshot.publisher.id) {
      return {
        health: { status: 'trust_invalid', checkedAt, code: 'remote_publisher_changed' },
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_publisher_changed' } },
      };
    }
    // Write-free preflight (metadata + resource entries + Agent Runtime
    // bindings) and the exact-one-api-key connector selection: a signed but
    // runtime-invalid candidate is a deterministic failure.
    let connector;
    try {
      const normalizedExtension = preflightRemoteShellMetadata(remote, environment);
      connector = selectRemoteConnector(remote.extension);
      assertRemoteConnectorMatchesValidation(connector, normalizedExtension);
    } catch (error) {
      // A signed but runtime-invalid candidate is a DETERMINISTIC trust
      // failure (controlled blocked; prepare fails closed), never reachable.
      const code = safeProbeCode(error, 'invalid_hosted_manifest');
      return {
        health: { status: 'trust_invalid', checkedAt, code },
        update: { ...emptyRemoteUpdateProbe(), failure: { code } },
      };
    }
    if (connector.id !== snapshot.connector.id || connector.authType !== 'api-key') {
      return {
        health: { status: 'reachable', checkedAt },
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_connector_changed' } },
      };
    }
    const health = { status: 'reachable', checkedAt };
    // Key identity: a NEW keyId is a key rotation requiring re-consent; the
    // SAME keyId with a different fingerprint is a trust conflict and fails
    // trust_invalid (a trusted key is never silently replaced). A DIFFERENT
    // current keyId whose SLOT is already occupied in the publisher trust
    // store by a different fingerprint/public key is ALSO a trust conflict:
    // re-consent would be impossible (the slot can never be overwritten), so
    // it is classified trust_invalid instead of offered as a rotation. The
    // old key stays in the trust store so rollback remains verifiable.
    let keyChanged = false;
    if (remote.publisher.keyId === snapshot.publisher.keyId) {
      if (!remotePublisherTrusted(trust, remote.publisher, cryptoImpl)) {
        return {
          health: { status: 'trust_invalid', checkedAt, code: 'remote_trust_conflict' },
          update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_trust_conflict' } },
        };
      }
    } else {
      const candidateSlotTrusted = remotePublisherTrusted(trust, remote.publisher, cryptoImpl);
      if (!candidateSlotTrusted
        && isRecord(trust.publishers?.[remote.publisher.id]?.keys?.[remote.publisher.keyId])) {
        // The candidate keyId already exists with a DIFFERENT key: trust
        // conflict, never an impossible re-consent.
        return {
          health: { status: 'trust_invalid', checkedAt, code: 'remote_trust_conflict' },
          update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_trust_conflict' } },
        };
      }
      keyChanged = true;
    }
    if (remote.version === snapshot.acceptedManifest.version) {
      if (remote.manifestHash === snapshot.acceptedManifest.manifestHash) {
        return { health, update: emptyRemoteUpdateProbe() };
      }
      return {
        health,
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_update_version_reuse' } },
      };
    }
    const versionComparison = compareSemver(remote.version, snapshot.acceptedManifest.version);
    if (versionComparison === null) {
      return {
        health,
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'invalid_hosted_manifest' } },
      };
    }
    if (versionComparison < 0 && remote.update.required !== true) {
      return {
        health,
        update: { ...emptyRemoteUpdateProbe(), failure: { code: 'remote_update_rollback_not_required' } },
      };
    }
    const { delta, added } = classifyPermissionDelta(snapshot.approvedPermissions, remote.permissions);
    return {
      health,
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

  // Core probe runner: runs the network probe and stores the safe result
  // under a validated clock. Returns the probe plus its SUBJECT (the snapshot
  // it was classified against). Never re-enters the in-flight slot.
  const runRemoteProbeOnce = async (extensionId, snapshot) => {
    // Bounded TWO-ATTEMPT network loop, revalidating AFTER EACH attempt: each
    // attempt probes its captured snapshot, then a SHORT mutate/capture phase
    // compares the CURRENT generation + accepted manifest hash + appEntryUrl
    // with the probed snapshot BEFORE storing or returning. A changed
    // contract DISCARDS the stale probe (never cached) and retries against
    // the captured CURRENT snapshot. After attempt 2, a further change caches
    // NOTHING and fails closed with a stable controlled error rather than
    // returning stale data. Network verification NEVER runs under the
    // mutation queue (one slow Remote never blocks unrelated operations).
    let attemptSnapshot = snapshot;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const probe = await runRemoteLifecycleProbe(attemptSnapshot);
      const current = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      if (current.generationId === attemptSnapshot.generationId
        && current.acceptedManifest.manifestHash === attemptSnapshot.acceptedManifest.manifestHash
        && current.appEntryUrl === attemptSnapshot.appEntryUrl) {
        // Store/return ONLY a probe whose snapshot passed the immediate
        // post-network comparison. The probe is valid for the same immutable
        // contract, but the RETURNED snapshot is the freshly captured
        // post-network `current`: it carries the latest same-contract
        // persistedBlockedUpdate and other safe state, so callers NEVER act
        // on a stale pre-network block snapshot. The full subject
        // (generation + acceptedManifestHash + appEntryUrl) is derived from
        // the matched contract (identical values on both captures).
        const cachedAt = currentProbeTime();
        if (cachedAt !== null) {
          storeRemoteLifecycle(extensionId, {
            extensionId,
            cachedAt,
            expiresAt: cachedAt + remoteProbeTtlMs,
            subject: {
              generation: current.generationId,
              acceptedManifestHash: current.acceptedManifest.manifestHash,
              appEntryUrl: current.appEntryUrl,
            },
            probe,
          });
        }
        return {
          probe,
          snapshot: current,
          subject: {
            generation: current.generationId,
            acceptedManifestHash: current.acceptedManifest.manifestHash,
            appEntryUrl: current.appEntryUrl,
          },
        };
      }
      // Contract changed while this attempt was in flight: discard the stale
      // probe and retry against the captured current snapshot.
      attemptSnapshot = current;
    }
    // Bounded retries exhausted while the contract kept changing: cache
    // NOTHING and fail closed with a stable controlled error rather than
    // returning stale data.
    throw new InteractiveUIExtensionManagerError(
      'Remote app changed while its update state was being verified',
      'remote_update_generation_changed',
      409,
    );
  };

  // Coalesced standalone probe: same-extension concurrent probes share ONE
  // in-flight promise; used only where no slot is already reserved.
  const probeRemoteLifecycle = (extensionId, snapshot, { force = false } = {}) => {
    const inFlight = remoteProbeInFlight.get(extensionId);
    if (inFlight) return inFlight;
    const promise = runRemoteProbeOnce(extensionId, snapshot);
    remoteProbeInFlight.set(extensionId, promise);
    promise.then(() => {
      if (remoteProbeInFlight.get(extensionId) === promise) remoteProbeInFlight.delete(extensionId);
    }, () => {
      if (remoteProbeInFlight.get(extensionId) === promise) remoteProbeInFlight.delete(extensionId);
    });
    return promise;
  };

  // Race-free lifecycle resolution: the in-flight slot is checked and
  // reserved SYNCHRONOUSLY before any await, so concurrent callers for the
  // same extension ALWAYS join one probe (no duplicate network work). The
  // settled TTL cache is honored inside the reserved probe unless force
  // bypasses it. A joined probe whose subject no longer matches the CURRENT
  // state is discarded and re-probed (bounded to one retry).
  const resolveRemoteLifecycle = async (extensionId, { force = false } = {}) => {
    // Only a GENUINE network probe occupies the in-flight slot. A settled-
    // cache resolution is NOT network work and never does — so a force:true
    // caller arriving during a non-force cache resolution can never join it:
    // force always bypasses a settled TTL entry while still joining a real
    // current network probe.
    const existing = remoteProbeInFlight.get(extensionId);
    if (existing) {
      const settled = await existing;
      const current = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
      // FULL subject comparison (generation + acceptedManifestHash +
      // appEntryUrl).
      if (settled.subject.generation === current.generationId
        && settled.subject.acceptedManifestHash === current.acceptedManifest.manifestHash
        && settled.subject.appEntryUrl === current.appEntryUrl) {
        return { probe: settled.probe, snapshot: current };
      }
      // The fresh runner may have revalidated onto a LATER effective
      // snapshot: ALWAYS propagate fresh.snapshot/fresh.subject, never pair a
      // fresh probe with an earlier snapshot.
      const fresh = await probeRemoteLifecycle(extensionId, current, { force: true });
      return { probe: fresh.probe, snapshot: fresh.snapshot, subject: fresh.subject };
    }
    const snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
    const cached = readCachedRemoteLifecycle(extensionId, snapshot);
    if (!force && cached) {
      return {
        probe: cached.probe,
        snapshot,
        subject: {
          generation: snapshot.generationId,
          acceptedManifestHash: snapshot.acceptedManifest.manifestHash,
          appEntryUrl: snapshot.appEntryUrl,
        },
      };
    }
    // Genuine network probe: probeRemoteLifecycle's synchronous check-and-set
    // guarantees same-extension coalescing (one network probe per current
    // subject), and runRemoteProbeOnce revalidates the contract AFTER the
    // network before storing/returning.
    const entry = await probeRemoteLifecycle(extensionId, snapshot, { force });
    return { probe: entry.probe, snapshot: entry.snapshot, subject: entry.subject };
  };

  // Assembles the SAFE lifecycle result from a probe + the current persisted
  // block state. Never exposes keys, signed documents, internal paths,
  // installationId/generationId, credentials, raw upstream bodies, or
  // unsanitized error text.
  const buildLifecycleResult = ({
    probe,
    currentVersion,
    currentManifestHash,
    persistedBlockedUpdate = null,
  }) => {
    const failure = probe.update.failure;
    let status = probe.update.status;
    let blocked = failure ? { code: failure.code } : null;
    if (!blocked && persistedBlockedUpdate) {
      // A previously observed required update governs until the CURRENT
      // verified probe is a reachable, valid, non-required candidate (the
      // publisher's signed manifest is authoritative again). In particular an
      // unreachable probe must never bypass the persisted required block.
      const superseded = probe.health.status === 'reachable'
        && probe.update.status !== 'required';
      if (!superseded) {
        status = 'required';
        blocked = {
          code: 'remote_update_required_blocked',
          required: true,
          ...(typeof persistedBlockedUpdate.version === 'string' ? { version: persistedBlockedUpdate.version } : {}),
          ...(typeof persistedBlockedUpdate.manifestHash === 'string' ? { manifestHash: persistedBlockedUpdate.manifestHash } : {}),
          ...(typeof persistedBlockedUpdate.reason === 'string' ? { reason: persistedBlockedUpdate.reason } : {}),
        };
      }
    }
    return {
      status,
      currentVersion,
      currentManifestHash,
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

  // Deterministic candidate failures throw stable actionable errors from
  // checkRemoteUpdate (the manual UI check); lifecycle consumers (getRemote-
  // Lifecycle / prepareRemoteUse) classify them instead. remote_update_required_blocked
  // is a persisted state and never throws from the check. Unknown blocked
  // codes fail closed with a stable generic error.
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
      ...(typeof lifecycle.remoteVersion === 'string'
        ? { version: lifecycle.remoteVersion, manifestHash: lifecycle.remoteManifestHash }
        : {}),
      changeSummary: lifecycle.changeSummary,
      addedPermissions: lifecycle.addedPermissions,
      keyChanged: lifecycle.keyChanged,
      requiresUserConfirmation: lifecycle.requiresUserConfirmation,
      publisherFingerprint: lifecycle.publisherFingerprint,
    },
  );

  // Persists ONLY the safe pending/blocked metadata needed to prevent bypass
  // of a previously observed required update (no migration for old records).
  // Subject-safe persistence: writes the safe blockedUpdate metadata ONLY
  // when the CURRENT active contract (generation + acceptedManifestHash +
  // appEntryUrl) still matches the captured snapshot, atomically inside the
  // mutation queue. Returns true when written, false when the contract
  // changed concurrently (callers must discard the stale observation and
  // re-resolve boundedly against the current state).
  const persistRemoteBlockedUpdate = async (snapshot, lifecycle, reason) => mutate(async () => {
    const state = await readState();
    const extension = state.extensions[snapshot.extensionId];
    const metadata = extension?.versions?.[extension.activeVersion];
    if (!extension || !metadata || metadata.delivery !== 'remote'
      || metadata.generationId !== snapshot.generationId
      || metadata.remote?.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash
      || metadata.remote?.appEntryUrl !== snapshot.appEntryUrl) {
      return false; // superseded concurrently: nothing to persist
    }
    metadata.remote.blockedUpdate = {
      required: true,
      version: lifecycle.remoteVersion ?? snapshot.acceptedManifest.version,
      manifestHash: lifecycle.remoteManifestHash ?? snapshot.acceptedManifest.manifestHash,
      reason,
      observedAt: currentProbeIso() ?? new Date().toISOString(),
    };
    await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, statePath, state);
    return true;
  });

  // Canonical safe identity of a persisted required block: ONLY the
  // documented safe fields participate, so hand-edited unknown fields can
  // never change the comparison and no secret/internal material is hashed.
  const remoteBlockedUpdateIdentity = (blocked) => {
    if (!isRecord(blocked)) return null;
    return canonicalStringify({
      required: blocked.required === true,
      ...(typeof blocked.version === 'string' ? { version: blocked.version } : {}),
      ...(typeof blocked.manifestHash === 'string' ? { manifestHash: blocked.manifestHash } : {}),
      ...(typeof blocked.reason === 'string' ? { reason: blocked.reason } : {}),
      ...(typeof blocked.observedAt === 'string' ? { observedAt: blocked.observedAt } : {}),
    });
  };

  // Exact-match clearing: only the block captured in the snapshot may be
  // deleted. A NEWER required observation persisted under the same installed
  // generation/hash (different version/hash/reason/observedAt) must never be
  // deleted by a stale clear — the mutate slot re-reads the state and
  // compares the CURRENT persisted block to the snapshot's block before
  // deleting, so the read-compare-delete is atomic on the queue. Returns
  // true when the captured block is gone (or was already absent), false when
  // the persisted block changed under us (callers fail closed / re-resolve).
  const clearRemoteBlockedUpdate = async (snapshot) => {
    if (typeof beforeClearRemoteBlockedUpdate === 'function') {
      await beforeClearRemoteBlockedUpdate(snapshot.extensionId);
    }
    return mutate(async () => {
      const state = await readState();
      const extension = state.extensions[snapshot.extensionId];
      const metadata = extension?.versions?.[extension.activeVersion];
      if (!extension || !metadata || metadata.delivery !== 'remote'
        || metadata.generationId !== snapshot.generationId
        || metadata.remote?.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash) {
        return false; // the installed contract changed: nothing to clear here
      }
      const current = metadata.remote.blockedUpdate;
      if (current === undefined) return true; // already absent
      if (remoteBlockedUpdateIdentity(current)
        !== remoteBlockedUpdateIdentity(snapshot.persistedBlockedUpdate)) {
        return false; // stale clear loses the race: never delete a newer block
      }
      delete metadata.remote.blockedUpdate;
      await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, statePath, state);
      return true;
    });
  };

  const summarizeRemoteUpdateReview = ({ snapshot, remote, connector, delta, added, keyChanged }) => ({
    extension: {
      id: snapshot.extensionId,
      name: snapshot.extensionName,
      version: snapshot.activeVersion,
    },
    update: {
      version: remote.version,
      manifestHash: remote.manifestHash,
      publishedAt: remote.publishedAt,
      changeSummary: remote.update.changeSummary,
      permissionDelta: delta,
      addedPermissions: added ? clone(added) : null,
      keyChanged,
    },
    publisher: {
      id: remote.publisher.id,
      name: remote.publisher.name,
      keyId: remote.publisher.keyId,
      fingerprint: remote.publisher.fingerprint,
    },
    connector: { id: connector.id, authType: connector.authType },
  });

  // Atomic metadata-only apply of a verified candidate (TOCTOU-safe):
  // refetch/reverify happens in the caller-provided network phase OUTSIDE the
  // mutation queue; this mutate phase REVALIDATES the current generation/
  // accepted manifest hash before installing a new metadata-only Remote
  // shell (signed manifest + openchamber.extension.json + host-generated
  // Agent Runtime shims ONLY; ZERO declared UI/artifact/resource bytes), reuses
  // the current installation-bound credential identity, generates a new
  // private lifecycle generation, switches acceptedManifest/approvedPermissions
  // ONLY after all verification/staging succeeds, and preserves the previous
  // version for rollback. Any failure preserves the exact previous active
  // version, acceptedManifest, approvedPermissions, trust, Agent Runtime
  // state, and usable shell.
  const applyRemoteUpdateState = async ({
    snapshot,
    remote,
    connector,
    delta,
    added,
    keyChanged,
    confirmationRequired,
  }) => {
    const previousState = await readState();
    const extension = previousState.extensions[snapshot.extensionId];
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
    // Revalidate the current generation/hash BEFORE any write: a concurrent
    // rollback/uninstall/reconnect/apply invalidates the captured snapshot.
    if (metadata.generationId !== snapshot.generationId
      || metadata.remote.acceptedManifest?.manifestHash !== snapshot.acceptedManifest.manifestHash
      || metadata.remote.appEntryUrl !== snapshot.appEntryUrl) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app changed while the update was being verified',
        'remote_update_generation_changed',
        409,
      );
    }
    if (typeof metadata.remote.installationId !== 'string' || !metadata.remote.installationId) {
      throw new InteractiveUIExtensionManagerError(
        `${extension.id}@${metadata.version} has no valid Remote installation identity`,
        'remote_shell_integrity_failed',
        409,
      );
    }
    const nextState = clone(previousState);
    const next = nextState.extensions[snapshot.extensionId];
    const destination = pathImpl.join(versionsDirectory, snapshot.extensionId, remote.version);
    const existingVersion = next.versions[remote.version];
    let agentRuntime;
    let fileHashes;
    let reuseExisting = false;
    let moved = false;
    if (existingVersion && existingVersion.packageHash === remote.manifestHash) {
      // Same signed manifest already installed (e.g. after a rollback):
      // re-verify and reuse the existing shell instead of restaging.
      await verifyInstalledVersionIntegrity(next, existingVersion, destination);
      agentRuntime = clone(existingVersion.agentRuntime);
      fileHashes = existingVersion.fileHashes;
      reuseExisting = true;
    } else {
      if (existingVersion) {
        throw new InteractiveUIExtensionManagerError(
          `${snapshot.extensionId}@${remote.version} is already installed from different package content`,
          'version_conflict',
          409,
        );
      }
      const stagingPath = pathImpl.join(stagingDirectory, cryptoImpl.randomUUID());
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
        agentRuntime = await installHostedAgentRuntime(stagingPath, remote);
        fileHashes = Object.fromEntries(await Promise.all(
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
      } catch (error) {
        await fsImpl.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    // Key rotation: the NEW key may be trusted only after the exact
    // fingerprint+manifest confirmation (enforced by the caller's network
    // phase). The OLD key is kept so rollback remains verifiable. A durable
    // trust-transaction journal is persisted BEFORE the candidate key so the
    // candidate stays NON-AUTHORITATIVE until the transaction resolves.
    const originalTrust = await readTrust();
    let stateCommitted = false;
    // Internal-only candidate trust: passed ONLY into this apply's own
    // candidate-shell verification and runtime-safe-state commit so the
    // in-flight key is never visible to ordinary reads.
    let activeCandidateTrust = null;
    try {
      if (keyChanged) {
        const candidateTrust = clone(originalTrust);
        trustPublisherInDocument(candidateTrust, {
          id: remote.publisher.id,
          name: remote.publisher.name,
          keyId: remote.publisher.keyId,
          publicKey: remote.publisher.publicKey,
          source: 'remote-update-confirmation',
        });
        const transaction = {
          $schema: TRUST_TRANSACTION_SCHEMA,
          transactionId: cryptoImpl.randomUUID(),
          extensionId: snapshot.extensionId,
          prior: {
            version: metadata.version,
            manifestHash: metadata.remote.acceptedManifest?.manifestHash ?? null,
            publisherKeyId: metadata.publisher?.keyId ?? null,
            appEntryUrl: metadata.remote.appEntryUrl ?? null,
          },
          candidate: {
            version: remote.version,
            manifestHash: remote.manifestHash,
            publisherKeyId: remote.publisher.keyId,
            appEntryUrl: snapshot.appEntryUrl,
          },
          originalTrust,
          candidateTrust,
        };
        // Durable journal FIRST: a crash at ANY later point is recoverable by
        // exact committed-state proof, never by guessing. The in-memory active
        // transaction is set immediately (no await gap) so ordinary trust
        // reads fail closed; the candidate is passed explicitly only to this
        // apply's internal verification below.
        await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustTransactionPath, transaction);
        activeTrustTransaction = transaction;
        activeCandidateTrust = candidateTrust;
        await atomicWriteJson(fsImpl, pathImpl, cryptoImpl, trustPath, candidateTrust);
      }
      const installedAt = new Date(currentProbeTime() ?? Date.now()).toISOString();
      const previousActive = next.activeVersion;
      next.name = typeof remote.extension?.name === 'string' ? remote.extension.name : next.name;
      next.versions[remote.version] = {
        version: remote.version,
        packageHash: remote.manifestHash,
        installedAt,
        // New private lifecycle generation per apply: stale captured roots
        // (and in-flight resource resolutions) fail closed immediately.
        generationId: cryptoImpl.randomUUID(),
        source: { type: 'remote', appEntryUrl: snapshot.appEntryUrl },
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
          appEntryUrl: snapshot.appEntryUrl,
          // Reuse the current installation-bound credential identity: the
          // Secret Store record stays bound and is never rebound.
          installationId: metadata.remote.installationId,
          connectorRefs: metadata.remote.connectorRefs,
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
          updatedAt: installedAt,
        },
      };
      if (previousActive !== remote.version) next.activationHistory.push(previousActive);
      next.activeVersion = remote.version;
      await verifyRemoteShellRoot(next, next.versions[remote.version], activeCandidateTrust);
      const openCode = await commitStateWithAgentRuntime(previousState, nextState, {
        trustOverride: activeCandidateTrust,
      });
      stateCommitted = true;
      if (activeTrustTransaction) {
        // COMMIT POINT: installations.json now durably records the exact
        // candidate contract. Everything after this is BEST-EFFORT
        // finalization: the in-memory active transaction is cleared FIRST so
        // no fallible verification/cleanup can ever make a committed apply
        // report failure. If the candidate-trust read-back cannot be verified
        // or the journal cannot be deleted, the idempotent durable journal is
        // RETAINED and the next ordinary trust read (or a fresh manager)
        // resolves it from exact committed-state proof — retaining candidate
        // trust, never an erroneous rollback. The apply still returns the
        // successful result.
        const committedCandidateTrust = activeTrustTransaction.candidateTrust;
        activeTrustTransaction = null;
        let finalizeVerified = false;
        try {
          const stored = await readJson(fsImpl, trustPath, emptyTrust, TRUST_SCHEMA);
          finalizeVerified = isRecord(stored.publishers)
            && canonicalStringify(stored) === canonicalStringify(committedCandidateTrust);
        } catch (finalizeError) {
          logger.error?.('[InteractiveUI] Remote app update committed but publisher trust finalization read failed; the durable journal was retained for recovery', finalizeError);
        }
        if (finalizeVerified) {
          await fsImpl.rm(trustTransactionPath, { force: true }).catch(() => {});
        } else {
          logger.error?.('[InteractiveUI] Remote app update committed but publisher trust finalization could not be verified; the durable journal was retained for recovery');
        }
      }
      return {
        extension: sanitizeExtensionOutput(next),
        applied: true,
        previousVersion: previousActive,
        openCode,
      };
    } catch (error) {
      if (activeTrustTransaction) {
        // Make the candidate key non-authoritative: clear the in-memory
        // transaction, remove the staged candidate shell FIRST (finally-safe,
        // so an I/O-blocked recovery can never leave it behind), then resolve
        // the durable journal. If recovery I/O cannot complete, surface the
        // controlled error and LEAVE the journal so every later trust read
        // stays blocked until recovery succeeds; the candidate key is never
        // claimed to be trusted in this state.
        activeTrustTransaction = null;
        if (!stateCommitted && !reuseExisting && moved) {
          await fsImpl.rm(destination, { recursive: true, force: true }).catch(() => {});
        }
        try {
          await resolveTrustTransactionIfPresent();
        } catch {
          throw new InteractiveUIExtensionManagerError(
            'Remote app update failed and publisher trust recovery is incomplete; trust is blocked until recovery succeeds',
            'remote_update_trust_rollback_failed',
            500,
            { causeCode: typeof error?.code === 'string' ? error.code : 'remote_update_failed' },
          );
        }
      } else if (!stateCommitted && !reuseExisting && moved) {
        // Never remove a shell whose state commit already succeeded: the
        // committed active version directory is authoritative once
        // installations.json recorded it.
        await fsImpl.rm(destination, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  };

  // Full TOCTOU-safe apply: short mutate snapshot capture, network
  // refetch/reverify OUTSIDE the queue, exact confirmation checks, then a
  // short mutate revalidation + atomic install. Throws stable actionable
  // errors; on any failure the previous active version, accepted manifest,
  // approved permissions, trust, Agent Runtime state, and shell stay exactly
  // as they were.
  const applyRemoteUpdateInternal = async (snapshot, options = {}) => {
    const confirmedManifestHash = typeof options.confirmedManifestHash === 'string'
      ? options.confirmedManifestHash
      : null;
    const confirmedPublisherFingerprint = typeof options.confirmedPublisherFingerprint === 'string'
      ? options.confirmedPublisherFingerprint
      : null;
    // PHASE 2 (OUTSIDE mutate): refetch + fully verify the candidate.
    const remote = await fetchRemoteOcixManifest({ appEntryUrl: snapshot.appEntryUrl, fetchImpl, cryptoImpl });
    const normalizedExtension = preflightRemoteShellMetadata(remote, environment);
    const connector = selectRemoteConnector(remote.extension);
    assertRemoteConnectorMatchesValidation(connector, normalizedExtension);
    if (remote.extensionId !== snapshot.extensionId || remote.publisher.id !== snapshot.publisher.id) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher identity changed',
        'remote_publisher_changed',
        403,
      );
    }
    const trust = await readTrust();
    const storedKey = trust.publishers?.[snapshot.publisher.id]?.keys?.[snapshot.publisher.keyId];
    if (!isRecord(storedKey) || typeof storedKey.publicKey !== 'string' || !storedKey.publicKey) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher key is no longer trusted',
        'publisher_untrusted',
        403,
      );
    }
    let keyChanged = false;
    if (remote.publisher.keyId === snapshot.publisher.keyId) {
      if (!remotePublisherTrusted(trust, remote.publisher, cryptoImpl)) {
        throw new InteractiveUIExtensionManagerError(
          'Remote app signing key conflicts with the trusted key',
          'remote_trust_conflict',
          403,
        );
      }
    } else {
      const candidateSlotTrusted = remotePublisherTrusted(trust, remote.publisher, cryptoImpl);
      if (!candidateSlotTrusted
        && isRecord(trust.publishers?.[remote.publisher.id]?.keys?.[remote.publisher.keyId])) {
        // The candidate keyId slot is occupied by a DIFFERENT key: trust
        // conflict — re-consent would be impossible (the slot can never be
        // overwritten), so this is never offered as a rotation.
        throw new InteractiveUIExtensionManagerError(
          'Remote app signing key conflicts with the trusted key',
          'remote_trust_conflict',
          403,
        );
      }
      keyChanged = true;
    }
    if (connector.id !== snapshot.connector.id || connector.authType !== 'api-key') {
      throw new InteractiveUIExtensionManagerError(
        'Remote app connector identity changed; reconnect instead of updating',
        'remote_connector_changed',
        409,
      );
    }
    if (remote.version === snapshot.acceptedManifest.version) {
      if (remote.manifestHash === snapshot.acceptedManifest.manifestHash) {
        throw new InteractiveUIExtensionManagerError('Remote app has no pending update', 'remote_update_none', 409);
      }
      throw new InteractiveUIExtensionManagerError(
        'Remote app reuses the current version with different signed content; the vendor must change the version',
        'remote_update_version_reuse',
        409,
      );
    }
    const versionComparison = compareSemver(remote.version, snapshot.acceptedManifest.version);
    if (versionComparison === null) {
      throw new InteractiveUIExtensionManagerError('Remote app version is invalid', 'invalid_hosted_manifest', 400);
    }
    if (versionComparison < 0 && remote.update.required !== true) {
      throw new InteractiveUIExtensionManagerError(
        'Remote app downgrade requires a signed required update',
        'remote_update_rollback_not_required',
        403,
      );
    }
    const { delta, added } = classifyPermissionDelta(snapshot.approvedPermissions, remote.permissions);
    const confirmationRequired = keyChanged || delta === 'expanded';
    if (confirmationRequired
      && (confirmedManifestHash !== remote.manifestHash
        || confirmedPublisherFingerprint !== remote.publisher.fingerprint)) {
      // DIRECT REQUIRED OBSERVATION: if the apply refetch verified a REQUIRED
      // candidate but the exact confirmation is missing/mismatched,
      // subject-safely persist the same safe required block BEFORE returning
      // the controlled confirmation error (a concurrent contract switch must
      // not persist stale metadata — the subject-safe guard returns false and
      // nothing is written). Never persists secrets/raw manifests.
      if (remote.update.required === true) {
        await persistRemoteBlockedUpdate(
          snapshot,
          { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash },
          'confirmation-required',
        );
      }
      throw new InteractiveUIExtensionManagerError(
        'Remote app publisher fingerprint and manifest hash must be confirmed before applying this update',
        'remote_confirmation_required',
        403,
        summarizeRemoteUpdateReview({ snapshot, remote, connector, delta, added, keyChanged }),
      );
    }
    // VERIFIED REQUIRED CANDIDATE: persist the durable required block
    // subject-safely BEFORE any staging/state-commit attempt that can fail —
    // whether the exact confirmation was correctly supplied or no
    // confirmation is needed. A verified required update that cannot apply
    // must stay durably blocked; there must never be a window where the
    // verified required observation is unpreserved. If the captured contract
    // was superseded (persistence returns false), never stage/apply stale
    // content: fail with the stable generation-changed behavior.
    let requiredBlockPersisted = false;
    if (remote.update.required === true) {
      const persisted = await persistRemoteBlockedUpdate(
        snapshot,
        { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash },
        confirmationRequired ? 'confirmation-required' : 'required-observed',
      );
      if (!persisted) {
        throw new InteractiveUIExtensionManagerError(
          'Remote app changed while the update was being applied',
          'remote_update_generation_changed',
          409,
        );
      }
      requiredBlockPersisted = true;
    }
    // PHASE 3 (mutate): revalidate the current generation/hash and apply
    // atomically. On failure the durable required block stays fail-closed
    // (its reason is updated truthfully to apply-failed, best-effort) and the
    // ORIGINAL apply error propagates — never a silent success.
    let applyResult;
    try {
      applyResult = await mutate(() => applyRemoteUpdateState({
        snapshot,
        remote,
        connector,
        delta,
        added,
        keyChanged,
        confirmationRequired,
      }));
    } catch (error) {
      if (requiredBlockPersisted) {
        // Subject-safe: only updates when the old contract is still current
        // (a concurrent apply leaves the historical block in place).
        await persistRemoteBlockedUpdate(
          snapshot,
          { remoteVersion: remote.version, remoteManifestHash: remote.manifestHash },
          'apply-failed',
        ).catch(() => {});
      }
      throw error;
    }
    return applyResult;
  };

  // Stale-clear race handling for superseded persisted blocks: attempts the
  // EXACT-match clear of the block captured in `resolved.snapshot`; when a
  // newer required block replaced it under the same installed contract, the
  // clear returns false and this helper RE-RESOLVES (forced, bounded) against
  // the CURRENT state so callers never act on a stale snapshot. `changed` is
  // true whenever a re-resolve happened (the returned lifecycle/snapshot are
  // then fresh). Returns `stable: false` when bounded retries are exhausted
  // while a newer block kept replacing ours (callers must fail closed, never
  // report unblocked).
  const settleSupersededBlock = async (extensionId, resolved, lifecycle) => {
    let changed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!resolved.snapshot.persistedBlockedUpdate || lifecycle.blocked) {
        return { resolved, lifecycle, stable: true, changed };
      }
      const cleared = await clearRemoteBlockedUpdate(resolved.snapshot);
      if (cleared) {
        return { resolved, lifecycle, stable: true, changed };
      }
      resolved = await resolveRemoteLifecycle(extensionId, { force: true });
      lifecycle = buildLifecycleResult({
        probe: resolved.probe,
        currentVersion: resolved.snapshot.activeVersion,
        currentManifestHash: resolved.snapshot.acceptedManifest.manifestHash,
        persistedBlockedUpdate: resolved.snapshot.persistedBlockedUpdate,
      });
      throwLifecycleCandidateFailure(lifecycle);
      changed = true;
    }
    return { resolved, lifecycle, stable: false, changed: true };
  };

  // Public Phase R3 manager APIs.
  const checkRemoteUpdate = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    const force = options.force === true;
    // Bounded stabilization loop: every freshly verified, reachable,
    // structurally valid signed candidate whose RAW probe status is
    // "required" atomically persists safe blockedUpdate metadata BEFORE the
    // API reports success (classification-only with respect to applying
    // contracts/resources — nothing is applied and no resource bytes are
    // fetched). If the active contract changes while the required observation
    // is being persisted, the stale result is discarded (nothing written) and
    // the current state is re-resolved boundedly; exhaustion fails closed
    // with a stable actionable error.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let resolved = await resolveRemoteLifecycle(extensionId, { force: attempt === 0 ? force : true });
      let lifecycle = buildLifecycleResult({
        probe: resolved.probe,
        currentVersion: resolved.snapshot.activeVersion,
        currentManifestHash: resolved.snapshot.acceptedManifest.manifestHash,
        persistedBlockedUpdate: resolved.snapshot.persistedBlockedUpdate,
      });
      throwLifecycleCandidateFailure(lifecycle);
      if (resolved.probe.update.status === 'required' && !resolved.probe.update.failure) {
        const persisted = await persistRemoteBlockedUpdate(
          resolved.snapshot,
          lifecycle,
          lifecycle.requiresUserConfirmation ? 'confirmation-required' : 'required-observed',
        );
        if (persisted === false) continue; // contract changed: discard + re-resolve
        // Rebuild against the durable state (same contract) so the returned
        // lifecycle is consistent with the persisted block: re-capture the
        // current snapshot and re-verify the subject before returning it.
        const current = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
        if (current.generationId !== resolved.snapshot.generationId
          || current.acceptedManifest.manifestHash !== resolved.snapshot.acceptedManifest.manifestHash
          || current.appEntryUrl !== resolved.snapshot.appEntryUrl) {
          continue;
        }
        resolved = { probe: resolved.probe, snapshot: current, subject: resolved.subject };
        lifecycle = buildLifecycleResult({
          probe: resolved.probe,
          currentVersion: current.activeVersion,
          currentManifestHash: current.acceptedManifest.manifestHash,
          persistedBlockedUpdate: current.persistedBlockedUpdate,
        });
      }
      // A fresh verified REACHABLE non-required candidate supersedes an
      // obsolete persisted required block (buildLifecycleResult omits
      // `blocked` exactly in that case): clear it so the dynamic root can
      // return and the next surface trigger can auto-apply. Classification
      // only — nothing is applied by a check. An unreachable probe or a
      // candidate failure keeps the block fail-closed, and a lost stale-clear
      // race re-resolves so this check NEVER reports 'unblocked' while a
      // newer block remains (the settled lifecycle is fresh when `changed`).
      const settled = await settleSupersededBlock(extensionId, resolved, lifecycle);
      if (!settled.stable) {
        throw requiredBlockedError({ ...settled.lifecycle, status: 'required' });
      }
      return settled.lifecycle;
    }
    // Bounded stabilization exhausted while the contract kept changing: fail
    // closed with a stable actionable error.
    throw new InteractiveUIExtensionManagerError(
      'Remote app changed while its update state was being verified',
      'remote_update_generation_changed',
      409,
    );
  };

  const applyRemoteUpdate = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    const snapshot = await mutate(() => captureRemoteUpdateSnapshot(extensionId));
    const result = await applyRemoteUpdateInternal(snapshot, {
      trigger: 'manual',
      confirmedManifestHash: options?.confirmedManifestHash,
      confirmedPublisherFingerprint: options?.confirmedPublisherFingerprint,
    });
    return {
      extension: result.extension,
      applied: true,
      previousVersion: result.previousVersion,
      openCode: result.openCode,
    };
  };

  // Runtime-facing prepare: performs the check and automatically applies only
  // same-key none/reduced candidates. An ordinary available update awaiting
  // consent keeps the old contract usable. A required update that cannot
  // apply, or required+expansion awaiting consent, is BLOCKED with an
  // actionable stable error; trust_invalid and deterministic candidate
  // failures fail closed too. Unreachable entry health still allows the old
  // signed contract to render UNLESS a previously observed required update is
  // persisted (fail closed: the network cannot be used to bypass it).
  // TOCTOU reclassification for a failed auto-apply: re-resolves FORCED
  // against the CURRENT signed candidate (bypassing the stale 45s TTL entry)
  // and builds the fresh lifecycle. Callers decide persist/block vs
  // old-contract-usable based on the FRESH classification; deterministic
  // invalid/trust candidate changes stay visible in `lifecycle.blocked`.
  const reclassifyForced = async (extensionId) => {
    const fresh = await resolveRemoteLifecycle(extensionId, { force: true });
    const lifecycle = buildLifecycleResult({
      probe: fresh.probe,
      currentVersion: fresh.snapshot.activeVersion,
      currentManifestHash: fresh.snapshot.acceptedManifest.manifestHash,
      persistedBlockedUpdate: fresh.snapshot.persistedBlockedUpdate,
    });
    return { resolved: fresh, lifecycle };
  };

  const prepareRemoteUse = async (extensionId, options = {}) => {
    assertNamespacedId(extensionId, 'Extension id');
    const force = options.force === true;
    const trigger = typeof options.trigger === 'string' && options.trigger
      ? options.trigger
      : 'surface';
    // Bounded re-evaluation loop: a lost stale-clear race (a newer required
    // block replacing the captured one under the same installed contract)
    // re-resolves against the CURRENT state instead of acting on a stale
    // snapshot; the loop never reports 'unblocked' while a newer block
    // remains and fails closed when retries are exhausted.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resolved = await resolveRemoteLifecycle(extensionId, { force: attempt === 0 ? force : true });
      const snapshot = resolved.snapshot;
      const lifecycle = buildLifecycleResult({
        probe: resolved.probe,
        currentVersion: snapshot.activeVersion,
        currentManifestHash: snapshot.acceptedManifest.manifestHash,
        persistedBlockedUpdate: snapshot.persistedBlockedUpdate,
      });
      if (lifecycle.health.status === 'trust_invalid') {
        throw new InteractiveUIExtensionManagerError(
          'Remote app trust is invalid; reconnect or re-consent before use',
          'remote_trust_invalid',
          403,
          { code: lifecycle.health.code },
        );
      }
      // A persisted required block does NOT deadlock the automatic apply when
      // the CURRENT RAW probe is reachable, valid, status=required, and
      // requiresUserConfirmation=false: prepareRemoteUse proceeds through the
      // existing metadata-only automatic apply (covering both a manual check
      // observation and an earlier apply-failed block). The block is NOT
      // bypassed for unreachable/trust-invalid/candidate-failure/RAW
      // non-required probes, and required+confirmation stays blocked until an
      // explicit apply.
      const requiredApplyEligible = lifecycle.status === 'required'
        && lifecycle.requiresUserConfirmation === false
        && lifecycle.health.status === 'reachable'
        && resolved.probe.update.status === 'required'
        && resolved.probe.update.failure === null;
      if (lifecycle.blocked?.code === 'remote_update_required_blocked'
        && lifecycle.status === 'required'
        && !requiredApplyEligible) {
        throw requiredBlockedError(lifecycle);
      }
      if (lifecycle.blocked && !requiredApplyEligible) {
        const failure = REMOTE_CANDIDATE_FAILURES[lifecycle.blocked.code];
        throw new InteractiveUIExtensionManagerError(
          failure?.message ?? 'Remote app update is invalid',
          lifecycle.blocked.code,
          failure?.status ?? 409,
        );
      }
      // A concurrent apply may have already switched the active manifest
      // between the probe and the apply: the auto-apply then reports no
      // pending update, which is a safe no-op (the old signed contract stays
      // usable). remote_update_generation_changed means the ACTIVE CONTRACT
      // changed while this prepare was in flight (e.g. a concurrent prepare
      // applied): signal applied:true/contractChanged so every runtime
      // trigger re-runs discovery and never continues with the stale
      // pre-prepare descriptor/authority — this caller did not perform the
      // write, but the current contract is no longer the captured one. Never
      // persist a block from a stale snapshot; the next trigger re-probes
      // the current state.
      const catchConcurrentApply = (error) => {
        if (error?.code === 'remote_update_none') {
          return { ...lifecycle, status: 'none', remoteVersion: null, remoteManifestHash: null, applied: false };
        }
        if (error?.code === 'remote_update_generation_changed') {
          return { ...lifecycle, applied: true, contractChanged: true };
        }
        throw error;
      };
      if (lifecycle.status === 'required') {
        if (lifecycle.requiresUserConfirmation) {
          await persistRemoteBlockedUpdate(snapshot, lifecycle, 'confirmation-required');
          throw requiredBlockedError(lifecycle);
        }
        // Same-key none/reduced required update: automatic metadata-only apply.
        try {
          const applied = await applyRemoteUpdateInternal(snapshot, { trigger });
          return { ...lifecycle, applied: true, previousVersion: applied.previousVersion };
        } catch (error) {
          if (error?.code === 'remote_update_none' || error?.code === 'remote_update_generation_changed') {
            return catchConcurrentApply(error);
          }
          // REQUIRED update TOCTOU: reclassify FORCED against the current
          // signed candidate (bypassing the stale 45s entry) instead of
          // blindly persisting the stale initial required block. A reachable
          // valid NON-required candidate supersedes the initial observation
          // and remains old-contract-usable (pending consent when it
          // expands); a FRESH required candidate persists/blocks; unreachable
          // or invalid cannot bypass the previously observed required update
          // and must persist/block using the safe verified metadata. The
          // exact previous active version, accepted manifest, approved
          // permissions, trust, and shell are preserved by the failed apply.
          const reclassified = await reclassifyForced(extensionId);
          const freshLifecycle = reclassified.lifecycle;
          if (freshLifecycle.status === 'required') {
            await persistRemoteBlockedUpdate(
              reclassified.resolved.snapshot,
              freshLifecycle,
              freshLifecycle.requiresUserConfirmation ? 'confirmation-required' : 'apply-failed',
            );
            throw requiredBlockedError(freshLifecycle);
          }
          if (freshLifecycle.health.status !== 'reachable' || freshLifecycle.blocked) {
            // Unreachable or invalid/trust: the current signed candidate
            // cannot be verified as a valid non-required supersession — the
            // previously observed required update cannot be bypassed.
            await persistRemoteBlockedUpdate(snapshot, lifecycle, 'apply-failed');
            throw requiredBlockedError(lifecycle);
          }
          // Fresh verified reachable non-required candidate: superseded —
          // old contract stays usable (pending consent when it expands); any
          // stale persisted block is cleared via the exact-match settle.
          if (reclassified.resolved.snapshot.persistedBlockedUpdate) {
            const settled = await settleSupersededBlock(extensionId, reclassified.resolved, freshLifecycle);
            if (!settled.stable || settled.lifecycle.blocked) {
              throw requiredBlockedError({ ...settled.lifecycle, status: 'required' });
            }
            return settled.lifecycle;
          }
          return freshLifecycle;
        }
      }
      if (lifecycle.status === 'available') {
        if (snapshot.persistedBlockedUpdate) {
          const settled = await settleSupersededBlock(extensionId, resolved, lifecycle);
          if (!settled.stable || settled.lifecycle.blocked) {
            throw requiredBlockedError({ ...settled.lifecycle, status: 'required' });
          }
          if (settled.changed) continue; // re-evaluate the fresh classification
        }
        if (lifecycle.requiresUserConfirmation) {
          // Ordinary available update awaiting consent: old contract stays
          // usable; nothing is applied.
          return lifecycle;
        }
        try {
          const applied = await applyRemoteUpdateInternal(snapshot, { trigger });
          return { ...lifecycle, applied: true, previousVersion: applied.previousVersion };
        } catch (error) {
          if (error?.code === 'remote_update_none' || error?.code === 'remote_update_generation_changed') {
            return catchConcurrentApply(error);
          }
          // OPTIONAL update TOCTOU: an ordinary available update may attempt
          // automatic apply, but ANY failed optional apply must preserve and
          // continue serving the exact old accepted contract — it must never
          // make the Surface/Workbench/action fail merely because an OPTIONAL
          // update could not be staged/applied. Reclassify FORCED (bypassing
          // the stale 45s entry): a fresh confirmation-required candidate
          // returns as ordinary pending-consent (old contract usable); a
          // fresh unreachable candidate stays usable; a still-present valid
          // candidate returns as NOT applied without a tight retry loop (a
          // later trigger may retry); only a FRESH required candidate
          // persists/blocks, and deterministic invalid/trust candidate
          // changes fail closed.
          const reclassified = await reclassifyForced(extensionId);
          const freshLifecycle = reclassified.lifecycle;
          // Fail closed on fresh trust_invalid exactly like the normal
          // top-level path (e.g. publisher_untrusted with no update.failure):
          // the old surface must NOT continue when trust became invalid
          // between the optional probe and the reclassification.
          if (freshLifecycle.health.status === 'trust_invalid') {
            throw new InteractiveUIExtensionManagerError(
              'Remote app trust is invalid; reconnect or re-consent before use',
              'remote_trust_invalid',
              403,
              { code: freshLifecycle.health.code },
            );
          }
          throwLifecycleCandidateFailure(freshLifecycle);
          if (freshLifecycle.blocked?.code === 'remote_update_required_blocked'
            && freshLifecycle.status === 'required') {
            throw requiredBlockedError(freshLifecycle);
          }
          if (freshLifecycle.status === 'required') {
            await persistRemoteBlockedUpdate(
              reclassified.resolved.snapshot,
              freshLifecycle,
              freshLifecycle.requiresUserConfirmation ? 'confirmation-required' : 'apply-failed',
            );
            throw requiredBlockedError(freshLifecycle);
          }
          // Ordinary pending consent / none / unreachable: the exact old
          // accepted contract stays usable; nothing was applied.
          return freshLifecycle;
        }
      }
      // status 'none': the persisted required block is authoritative when the
      // probe cannot prove a valid non-required candidate (unreachable).
      if (snapshot.persistedBlockedUpdate) {
        if (lifecycle.health.status === 'reachable') {
          const settled = await settleSupersededBlock(extensionId, resolved, lifecycle);
          if (!settled.stable || settled.lifecycle.blocked) {
            throw requiredBlockedError({ ...settled.lifecycle, status: 'required' });
          }
          if (settled.changed) continue;
        } else {
          throw requiredBlockedError({ ...lifecycle, status: 'required' });
        }
      }
      return lifecycle;
    }
    // Bounded re-evaluations exhausted while the persisted state kept
    // changing: fail closed rather than ever reporting unblocked.
    throw new InteractiveUIExtensionManagerError(
      'Remote app update state is unstable; retry',
      'remote_update_required_blocked',
      409,
    );
  };

  const getRemoteLifecycle = async (extensionId) => {
    assertNamespacedId(extensionId, 'Extension id');
    const { probe, snapshot } = await resolveRemoteLifecycle(extensionId, { force: false });
    return buildLifecycleResult({
      probe,
      currentVersion: snapshot.activeVersion,
      currentManifestHash: snapshot.acceptedManifest.manifestHash,
      persistedBlockedUpdate: snapshot.persistedBlockedUpdate,
    });
  };

  // Minimal safe enumeration seam for startup warm-up: enabled manager-owned
  // Remote extension ids EVEN when their executable root is currently excluded
  // (e.g. a persisted required-update block). Ids only — never paths, keys,
  // secrets, or internal authority material. The runtime warm-up runs the
  // lifecycle prepare for these ids so a superseded persisted block can clear
  // and the dynamic root can return; blocked/unreachable entities fail closed
  // per-entity.
  // Catalog-only seam: write-free, safe descriptors for ENABLED Remote apps
  // whose persisted status (a required block or trust-invalid) EXCLUDES their
  // executable root from getEnabledExtensionRoots — so the Workbench catalog
  // keeps them VISIBLE as blocked after a fresh manager/runtime restart. This
  // seam grants NO resolver/launch authority, exposes NO internal
  // paths/keys/hashes beyond the safe lifecycle contract, and fetches ZERO
  // Remote resources. Surfaces are derived ONLY from the reverified signed
  // shell metadata (a reverify failure yields a minimal entry with no
  // surfaces rather than failing the catalog).
  const getBlockedRemoteCatalogEntries = async () => {
    const state = await readState();
    const trust = await readTrust();
    const entries = [];
    for (const extension of Object.values(state.extensions ?? {})) {
      if (extension.enabled !== true) continue;
      const metadata = extension.versions?.[extension.activeVersion];
      if (!metadata || metadata.delivery !== 'remote' || typeof metadata.generationId !== 'string') continue;
      const blocked = isRecord(metadata.remote?.blockedUpdate);
      // SAME exact public-key/fingerprint comparison as the authoritative
      // remotePublisherTrusted helper (and reverifyRemoteShell): a same
      // publisher id + keyId slot occupied by a DIFFERENT valid key is
      // trust-invalid, so the safe minimal catalog entry stays visible (shell
      // reverify fails closed => no surfaces) instead of vanishing after
      // restart. The stored fingerprint is never trusted; the stored public
      // key is re-normalized and re-fingerprinted locally.
      const trustInvalid = !remotePublisherTrusted(trust, metadata.publisher, cryptoImpl);
      if (!blocked && !trustInvalid) continue;
      const entry = {
        id: extension.id,
        name: typeof extension.name === 'string' ? extension.name : extension.id,
        version: extension.activeVersion,
        surfaces: [],
      };
      try {
        const { manifest } = await reverifyRemoteShell(extension, metadata);
        for (const view of Array.isArray(manifest.extension?.views) ? manifest.extension.views : []) {
          if (!isRecord(view) || typeof view.id !== 'string') continue;
          entry.surfaces.push({
            surfaceId: view.id,
            surfaceKind: 'view',
            form: 'interactive-ui',
            runtime: view.runtime === 'native' ? 'native' : 'declarative',
            title: typeof view.title === 'string' && view.title.trim() ? view.title.trim() : view.id,
          });
        }
        for (const artifact of Array.isArray(manifest.extension?.artifacts) ? manifest.extension.artifacts : []) {
          if (!isRecord(artifact) || typeof artifact.id !== 'string') continue;
          entry.surfaces.push({
            surfaceId: artifact.id,
            surfaceKind: 'artifact',
            form: 'html-artifact',
            runtime: 'artifact',
            title: typeof artifact.title === 'string' && artifact.title.trim() ? artifact.title.trim() : artifact.id,
          });
        }
      } catch {
        // No surfaces: the entry stays visible as blocked with name/version.
      }
      entries.push(entry);
    }
    return entries;
  };

  const getEnabledRemoteExtensionIds = async () => {
    const state = await readState();
    return Object.values(state.extensions ?? {}).flatMap((extension) => {
      if (extension.enabled !== true) return [];
      const active = extension.versions?.[extension.activeVersion];
      if (!active || active.delivery !== 'remote' || typeof active.generationId !== 'string') return [];
      return [extension.id];
    });
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
          // Phase R3: a Remote root is NEVER issued while its persisted
          // status is blocked by a required update (fail closed; the runtime
          // additionally fails closed through prepareRemoteUse).
          if (isRecord(active.remote?.blockedUpdate)) {
            throw new InteractiveUIExtensionManagerError(
              `${extension.id}@${extension.activeVersion} is blocked by a required update; apply it before use`,
              'remote_update_required_blocked',
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
      // Resolve any durable publisher-trust transaction left by a crashed or
      // I/O-blocked key-rotation apply before reconciling: initialization
      // must never observe or propagate non-authoritative candidate trust.
      await resolveTrustTransactionIfPresent();
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
    // Phase R3: merge the SAFE cached lifecycle summary (never triggering
    // network work in a read-only list) and the persisted required-update
    // block into the sanitized Remote metadata so the Extension Manager UI
    // can render health/update state and last check without accepting any
    // secret or internal authority material.
    const extensions = sanitizeExtensions(state, integrityByExtension).map((extension) => {
      const active = extension.versions?.[extension.activeVersion];
      if (active?.delivery !== 'remote' || !isRecord(active.remote)) return extension;
      const acceptedManifestHash = isRecord(active.remote.acceptedManifest)
        ? active.remote.acceptedManifest.manifestHash
        : null;
      const cached = acceptedManifestHash && readCachedRemoteLifecycle(extension.id, {
        generationId: state.extensions[extension.id]?.versions?.[extension.activeVersion]?.generationId,
        acceptedManifest: { manifestHash: acceptedManifestHash },
        appEntryUrl: active.remote.appEntryUrl,
      });
      if (cached) {
        active.remote.lifecycle = buildLifecycleResult({
          probe: cached.probe,
          currentVersion: active.version,
          currentManifestHash: acceptedManifestHash,
          persistedBlockedUpdate: null,
        });
      }
      const blockedUpdate = state.extensions[extension.id]?.versions?.[extension.activeVersion]?.remote?.blockedUpdate;
      if (isRecord(blockedUpdate)) {
        active.remote.blocked = {
          required: true,
          ...(typeof blockedUpdate.version === 'string' ? { version: blockedUpdate.version } : {}),
          ...(typeof blockedUpdate.manifestHash === 'string' ? { manifestHash: blockedUpdate.manifestHash } : {}),
          ...(typeof blockedUpdate.reason === 'string' ? { reason: blockedUpdate.reason } : {}),
          ...(typeof blockedUpdate.observedAt === 'string' ? { observedAt: blockedUpdate.observedAt } : {}),
        };
      }
      return extension;
    });
    return {
      apiVersion: 1,
      builtInRuntime: clone(builtInRuntimeStatus),
      extensions,
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
        // Phase R3: enabling must fail closed while a required update is
        // persisted as blocked (it cannot be bypassed by a disable/enable
        // cycle).
        if (isRecord(active.remote?.blockedUpdate)) {
          throw new InteractiveUIExtensionManagerError(
            `${extension.id}@${extension.activeVersion} is blocked by a required update; apply it before use`,
            'remote_update_required_blocked',
            409,
          );
        }
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
    if (!response.ok) {
      // Best-effort discard of the non-OK body so hostile/unbounded bytes are
      // never retained/consumed before the controlled rejection.
      await discardResponseBody(response);
      throw new InteractiveUIExtensionManagerError(`Marketplace catalog request failed (${response.status})`, 'marketplace_unavailable', 502);
    }
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
    if (!response.ok) {
      // Best-effort discard of the non-OK package body so hostile/unbounded
      // bytes are never retained/consumed before the controlled rejection.
      await discardResponseBody(response);
      throw new InteractiveUIExtensionManagerError(`Extension package download failed (${response.status})`, 'package_download_failed', 502);
    }
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
    checkRemoteUpdate,
    applyRemoteUpdate,
    prepareRemoteUse,
    getRemoteLifecycle,
    getEnabledRemoteExtensionIds,
    getBlockedRemoteCatalogEntries,
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
