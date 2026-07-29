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
  fetchHostedOcixManifest,
  hostedPermissionExpansion,
  materializeHostedOcix,
  verifyHostedOcixManifest,
} from './hosted-ocix.js';
import { reconcileOpenCodeAgentRuntime } from './agent-runtime.js';
import { createInteractiveUIRuntime } from './runtime.js';

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
const HOSTED_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const RESERVED_TOOL_NAMES = new Set([
  'apply_patch', 'bash', 'edit', 'glob', 'grep', 'html_artifact', 'interactive_ui',
  'list', 'read', 'skill', 'task', 'todo', 'webfetch', 'write',
]);
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

const sanitizeExtensions = (state, integrityByExtension = {}) => Object.values(state.extensions ?? {}).map((extension) => {
  const result = clone(extension);
  for (const version of Object.values(result.versions ?? {})) {
    if (isRecord(version)) delete version.fileHashes;
  }
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
    nativeCode: verified.manifest.trust?.mode === 'native-code',
    sandboxedArtifacts: Array.isArray(verified.manifest.artifacts) && verified.manifest.artifacts.length > 0,
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
    }
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
      if (active.delivery === 'hosted') {
        const hostedRoot = typeof active.hosted?.lastGood?.version === 'string'
          ? pathImpl.join(hostedCacheDirectory, extension.id, active.hosted.lastGood.version)
          : null;
        if (!hostedRoot || !(await fsImpl.stat(hostedRoot).catch(() => null))?.isDirectory()) {
          extension.enabled = false;
        }
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

  const hostedSurfaceBindings = (extension) => {
    const bindings = new Map();
    for (const [kind, surfaces] of [
      ['view', Array.isArray(extension.views) ? extension.views : []],
      ['artifact', Array.isArray(extension.artifacts) ? extension.artifacts : []],
    ]) {
      for (const surface of surfaces) {
        if (!isRecord(surface) || typeof surface.id !== 'string') continue;
        for (const name of Array.isArray(surface.tools) ? surface.tools : []) {
          if (typeof name !== 'string'
            || !HOSTED_TOOL_NAME_PATTERN.test(name)
            || RESERVED_TOOL_NAMES.has(name)) {
            throw new InteractiveUIExtensionManagerError(
              `Hosted surface ${surface.id} declares an invalid or reserved Agent Tool`,
              'invalid_hosted_agent_tool',
            );
          }
          const existing = bindings.get(name);
          if (existing && (existing.surfaceId !== surface.id || existing.kind !== kind)) {
            throw new InteractiveUIExtensionManagerError(
              `Hosted Agent Tool ${name} is bound to more than one surface`,
              'invalid_hosted_agent_tool',
            );
          }
          bindings.set(name, {
            name,
            kind,
            surfaceId: surface.id,
            title: typeof surface.title === 'string' && surface.title.trim()
              ? surface.title.trim()
              : surface.id,
            defaultContext: isRecord(surface.dashboard?.defaultContext)
              ? clone(surface.dashboard.defaultContext)
              : {},
          });
        }
      }
    }
    return [...bindings.values()];
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
    const agentDirectory = pathImpl.join(directory, 'agent-runtime', 'tools');
    await fsImpl.mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    for (const binding of tools) {
      await fsImpl.writeFile(
        pathImpl.join(agentDirectory, `${binding.name}.ts`),
        hostedToolSource(binding),
        { flag: 'wx', mode: 0o600 },
      );
    }
    return {
      tools: tools.map(({ name }) => ({ name, entry: `agent-runtime/tools/${name}.ts` })),
      skills: [],
      unresolvedSurfaceTools: [],
      unresolvedViewTools: [],
    };
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
        const openCode = await commitStateWithAgentRuntime(previousState, nextState);
        return { extension: clone(nextState.extensions[id]), installed: false, openCode };
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
      if (hosted) {
        hostedRoot = await materializeHostedCandidate(hosted);
        agentRuntime = await installHostedAgentRuntime(hostedRoot, hosted);
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
            },
            pendingUpdate: null,
            lastError: null,
          },
        } : {}),
      };
      nextState.extensions[id] = next;
      const openCode = await commitStateWithAgentRuntime(previousState, nextState);
      return { extension: clone(next), installed: true, openCode };
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
    const currentRoot = typeof metadata.hosted.lastGood?.version === 'string'
      ? pathImpl.join(hostedCacheDirectory, extension.id, metadata.hosted.lastGood.version)
      : null;
    const usableCurrentRoot = currentRoot && (await fsImpl.stat(currentRoot).catch(() => null))?.isDirectory()
      ? currentRoot
      : null;
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
      };
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
      throw error;
    }
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
          if (refreshed.root) roots.push(refreshed.root);
        } catch (error) {
          const quarantineKey = `${extension.id}@${extension.activeVersion}:${error?.code ?? 'hosted_refresh_failed'}`;
          if (!reportedQuarantines.has(quarantineKey)) {
            reportedQuarantines.add(quarantineKey);
            logger.warn?.(`[InteractiveUI] Hosted OCIX ${extension.id} is unavailable: ${error?.code ?? error}`);
          }
        }
        continue;
      }
      if ((await fsImpl.stat(directory)).isDirectory()) {
        roots.push(directory);
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
    return { extension: clone(extension), fallback: result.fallback === true, openCode };
  });

  const initialize = () => mutate(async () => {
    try {
      const previousState = await readState();
      const nextState = clone(previousState);
      const openCode = await commitStateWithAgentRuntime(previousState, nextState, { reload: false });
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
        return [extension.id, active
          ? await inspectInstalledVersionIntegrity(extension, active)
          : { status: 'failed', code: 'extension_integrity_failed' }];
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
    }
    extension.enabled = enabled;
    const openCode = await commitStateWithAgentRuntime(previousState, nextState);
    return { ...clone(extension), openCode };
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
    return { ...clone(extension), openCode };
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
    trustPublisher,
    removeTrustedPublisherKey,
    inspectPackage,
    installPackage,
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
