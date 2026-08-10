import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import crypto from 'node:crypto';

const TOOL_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'];
const MANAGED_HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const OWNERSHIP_RECORD_SUFFIX = '.agent-runtime.v1.json';
const TRANSACTION_RECORD_NAME = '.agent-runtime.transaction.v1.json';
const MAX_OWNERSHIP_RECORD_BYTES = 1024 * 1024;
const MAX_MANAGED_ASSETS = 4096;

// Never use localeCompare for durable ownership records. Its ordering varies
// with the process locale and would make an otherwise identical installation
// produce different record bytes (and therefore different hashes).
const compareCodePoints = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

class InteractiveUIAgentRuntimeError extends Error {
  constructor(message, code = 'agent_runtime_error', status = 400) {
    super(message);
    this.name = 'InteractiveUIAgentRuntimeError';
    this.code = code;
    this.status = status;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hash = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

const normalizeTarget = (pathImpl, value) => {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime target is invalid', 'invalid_agent_runtime_target');
  }
  const normalized = pathImpl.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime target escaped the OpenCode config directory', 'invalid_agent_runtime_target');
  }
  return normalized;
};

const assertExtensionId = (value, label = 'Managed Agent Runtime extension ID') => {
  if (typeof value !== 'string' || !EXTENSION_ID_PATTERN.test(value)) {
    throw new InteractiveUIAgentRuntimeError(`${label} is invalid`, 'agent_runtime_state_invalid', 500);
  }
  return value;
};

const assertVersion = (value, label = 'Managed Agent Runtime version') => {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new InteractiveUIAgentRuntimeError(`${label} is invalid`, 'agent_runtime_state_invalid', 500);
  }
  return value;
};

const assertToolName = (value, label = 'Agent Tool name') => {
  if (typeof value !== 'string' || !TOOL_NAME_PATTERN.test(value)) {
    throw new InteractiveUIAgentRuntimeError(`${label} is invalid`, 'agent_runtime_source_invalid', 500);
  }
  return value;
};

const assertSkillName = (value, label = 'Agent Skill name') => {
  if (typeof value !== 'string' || !SKILL_NAME_PATTERN.test(value)) {
    throw new InteractiveUIAgentRuntimeError(`${label} is invalid`, 'agent_runtime_source_invalid', 500);
  }
  return value;
};

const assertToolEntry = (pathImpl, value) => {
  const entry = normalizeTarget(pathImpl, value);
  const extension = pathImpl.posix.extname(entry);
  if (!entry.startsWith('agent-runtime/tools/')
    || entry.slice('agent-runtime/tools/'.length).includes('/')
    || !TOOL_EXTENSIONS.includes(extension)) {
    throw new InteractiveUIAgentRuntimeError('Agent Tool source path is invalid', 'invalid_agent_runtime_target', 500);
  }
  return entry;
};

const assertSkillEntry = (pathImpl, skillName, value) => {
  const entry = normalizeTarget(pathImpl, value);
  const prefix = `agent-runtime/skills/${skillName}/`;
  if (!entry.startsWith(prefix) || !entry.slice(prefix.length)) {
    throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill path is invalid: ${value}`, 'invalid_agent_runtime_target', 500);
  }
  return entry;
};

const statOrNull = async (fsImpl, target) => {
  try {
    return await fsImpl.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const statSourceWithoutSymlinks = async (fsImpl, pathImpl, rootDirectory, entry) => {
  let current = pathImpl.resolve(rootDirectory);
  const rootStat = await statOrNull(fsImpl, current);
  if (!rootStat) return null;
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(
      'Installed Agent Runtime source root is not a regular directory',
      'agent_runtime_source_invalid',
      500,
    );
  }
  const components = entry.split('/');
  for (const [index, component] of components.entries()) {
    current = pathImpl.join(current, component);
    const stat = await statOrNull(fsImpl, current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) {
      throw new InteractiveUIAgentRuntimeError(
        'Installed Agent Runtime source contains a symbolic link',
        'agent_runtime_source_invalid',
        500,
      );
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new InteractiveUIAgentRuntimeError(
        'Installed Agent Runtime source path is not a directory',
        'agent_runtime_source_invalid',
        500,
      );
    }
  }
  return await statOrNull(fsImpl, current);
};

const statContainedPathWithoutSymlinks = async (
  fsImpl,
  pathImpl,
  rootDirectory,
  target,
  {
    code = 'agent_runtime_conflict',
    status = 409,
    label = 'Managed OpenCode path',
  } = {},
) => {
  const root = pathImpl.resolve(rootDirectory);
  const resolvedTarget = pathImpl.resolve(target);
  const relative = pathImpl.relative(root, resolvedTarget);
  if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
    throw new InteractiveUIAgentRuntimeError(`${label} escaped its managed root`, code, status);
  }
  const rootStat = await statOrNull(fsImpl, root);
  if (!rootStat) return null;
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(`${label} root is not a regular directory`, code, status);
  }
  let current = root;
  const components = relative.split(pathImpl.sep);
  for (const [index, component] of components.entries()) {
    current = pathImpl.join(current, component);
    const stat = await statOrNull(fsImpl, current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) {
      throw new InteractiveUIAgentRuntimeError(`${label} contains a symbolic link`, code, status);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new InteractiveUIAgentRuntimeError(`${label} has a non-directory ancestor`, code, status);
    }
    if (index === components.length - 1) return stat;
  }
  return null;
};

const normalizePreviousAssets = (pathImpl, previousAssets) => {
  const normalized = Object.create(null);
  for (const [relativeTarget, asset] of Object.entries(previousAssets)) {
    const target = normalizeTarget(pathImpl, relativeTarget);
    if (!isRecord(asset)) {
      throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
    }
    if (Object.keys(asset).some((field) => !['extensionId', 'version', 'kind', 'name', 'sha256'].includes(field))) {
      throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
    }
    const extensionId = assertExtensionId(asset.extensionId);
    const version = assertVersion(asset.version);
    if (!['tool', 'skill'].includes(asset.kind) || typeof asset.name !== 'string'
      || !MANAGED_HASH_PATTERN.test(asset.sha256 ?? '')) {
      throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
    }
    if (asset.kind === 'tool') {
      const name = assertToolName(asset.name);
      const extension = pathImpl.posix.extname(target);
      if (!target.startsWith('tools/')
        || target.slice('tools/'.length) !== `${name}${extension}`
        || !TOOL_EXTENSIONS.includes(extension)) {
        throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
      }
    } else {
      const name = assertSkillName(asset.name);
      const prefix = `skills/${name}/`;
      if (!target.startsWith(prefix) || !target.slice(prefix.length)) {
        throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
      }
    }
    // Persist only the validated shape. Unknown fields are intentionally
    // discarded so a future manager cannot accidentally make them part of the
    // ownership hash or rollback contract.
    normalized[target] = {
      extensionId,
      version,
      kind: asset.kind,
      name: asset.name,
      sha256: asset.sha256,
    };
  }
  return normalized;
};

const sameAssetDescriptor = (left, right) => left?.extensionId === right?.extensionId
  && left?.version === right?.version
  && left?.kind === right?.kind
  && left?.name === right?.name
  && left?.sha256 === right?.sha256;

const parseOwnershipRecord = (pathImpl, value, expectedExtensionId) => {
  if (!isRecord(value)
    || Object.keys(value).some((field) => !['schemaVersion', 'managedBy', 'extensionId', 'versions', 'assets'].includes(field))
    || value.schemaVersion !== 1
    || value.managedBy !== 'openchamber'
    || value.extensionId !== expectedExtensionId
    || !Array.isArray(value.versions)
    || value.versions.length === 0
    || !Array.isArray(value.assets)
    || value.assets.length === 0
    || value.assets.length > MAX_MANAGED_ASSETS) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} is invalid`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  assertExtensionId(value.extensionId);
  const versions = value.versions.map((version) => assertVersion(version));
  const sortedVersions = [...new Set(versions)].sort(compareCodePoints);
  if (versions.length !== sortedVersions.length
    || versions.some((version, index) => version !== sortedVersions[index])) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} has invalid versions`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  // OpenChamber 1.17.1 wrote the record-level version once and omitted the
  // per-asset version.  Recognize only that exact, unambiguous shape.  A
  // record with mixed old/new assets is never repaired by guessing which
  // descriptors are authoritative.
  const assetHasVersion = value.assets.map((asset) => (
    isRecord(asset) && Object.prototype.hasOwnProperty.call(asset, 'version')
  ));
  if (assetHasVersion.some((hasVersion) => hasVersion !== assetHasVersion[0])) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} mixes legacy and canonical assets`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  const legacy = assetHasVersion[0] === false;
  if (legacy && versions.length !== 1) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} has ambiguous legacy versions`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  const rawAssets = Object.create(null);
  for (const asset of value.assets) {
    if (!isRecord(asset)
      || Object.keys(asset).some((field) => !(legacy
        ? ['target', 'kind', 'name', 'sha256'].includes(field)
        : ['target', 'version', 'kind', 'name', 'sha256'].includes(field)))
      || typeof asset.target !== 'string'
      || Object.prototype.hasOwnProperty.call(rawAssets, asset.target)) {
      throw new InteractiveUIAgentRuntimeError(
        `OCIX ownership record for ${expectedExtensionId} contains an invalid asset`,
        'agent_runtime_state_invalid',
        500,
      );
    }
    rawAssets[asset.target] = {
      extensionId: expectedExtensionId,
      version: legacy ? versions[0] : asset.version,
      kind: asset.kind,
      name: asset.name,
      sha256: asset.sha256,
    };
  }
  const assets = normalizePreviousAssets(pathImpl, rawAssets);
  if (Object.values(assets).some((asset) => (
    !Object.prototype.hasOwnProperty.call(asset, 'version')
      || !sortedVersions.includes(asset.version)
  ))) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} has incomplete asset versions`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  const assetVersions = Array.from(new Set(Object.values(assets).map((asset) => asset.version)))
    .sort(compareCodePoints);
  if (assetVersions.length !== sortedVersions.length
    || assetVersions.some((version, index) => version !== sortedVersions[index])) {
    throw new InteractiveUIAgentRuntimeError(
      `OCIX ownership record for ${expectedExtensionId} versions do not match its assets`,
      'agent_runtime_state_invalid',
      500,
    );
  }
  return { assets, legacy };
};

const readRecordedAssets = async ({ configDirectory, fsImpl, pathImpl }) => {
  const ownershipRoot = pathImpl.join(configDirectory, 'openchamber');
  const rootStat = await statContainedPathWithoutSymlinks(
    fsImpl,
    pathImpl,
    configDirectory,
    ownershipRoot,
    { label: 'OpenChamber ownership directory' },
  );
  if (!rootStat) return { assets: Object.create(null), legacyExtensions: new Set() };
  if (!rootStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(
      'OpenChamber ownership directory is not a regular directory',
      'agent_runtime_conflict',
      409,
    );
  }
  const entries = await fsImpl.readdir(ownershipRoot, { withFileTypes: true });
  if (entries.some((entry) => entry.name === TRANSACTION_RECORD_NAME
    || (entry.name.includes('.agent-runtime') && entry.name.endsWith('.tmp')))) {
    throw new InteractiveUIAgentRuntimeError(
      'Managed Agent Runtime has an incomplete transaction',
      'agent_runtime_recovery_required',
      500,
    );
  }
  const recordEntries = entries.filter((entry) => entry.name.endsWith(OWNERSHIP_RECORD_SUFFIX));
  if (recordEntries.length > MAX_MANAGED_ASSETS) {
    throw new InteractiveUIAgentRuntimeError(
      'OpenChamber Agent Runtime ownership inventory is too large',
      'agent_runtime_state_invalid',
      500,
    );
  }
  const recorded = Object.create(null);
  const legacyExtensions = new Set();
  let recordedCount = 0;
  for (const entry of recordEntries.sort((left, right) => compareCodePoints(left.name, right.name))) {
    if (!entry.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        'OpenChamber Agent Runtime ownership record is not a regular file',
        'agent_runtime_conflict',
        409,
      );
    }
    const extensionId = entry.name.slice(0, -OWNERSHIP_RECORD_SUFFIX.length);
    assertExtensionId(extensionId);
    const target = pathImpl.join(ownershipRoot, entry.name);
    const stat = await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      configDirectory,
      target,
      { label: 'OpenChamber Agent Runtime ownership record' },
    );
    if (!stat?.isFile() || stat.size > MAX_OWNERSHIP_RECORD_BYTES) {
      throw new InteractiveUIAgentRuntimeError(
        `OCIX ownership record for ${extensionId} is invalid`,
        'agent_runtime_state_invalid',
        500,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(await fsImpl.readFile(target, 'utf8'));
    } catch {
      throw new InteractiveUIAgentRuntimeError(
        `OCIX ownership record for ${extensionId} is invalid`,
        'agent_runtime_state_invalid',
        500,
      );
    }
    const parsedRecord = parseOwnershipRecord(pathImpl, parsed, extensionId);
    const assets = parsedRecord.assets;
    if (parsedRecord.legacy) legacyExtensions.add(extensionId);
    for (const [relativeTarget, asset] of Object.entries(assets)) {
      if (recordedCount >= MAX_MANAGED_ASSETS) {
        throw new InteractiveUIAgentRuntimeError(
          'OpenChamber Agent Runtime ownership inventory is too large',
          'agent_runtime_state_invalid',
          500,
        );
      }
      if (Object.prototype.hasOwnProperty.call(recorded, relativeTarget)) {
        throw new InteractiveUIAgentRuntimeError(
          `OCIX ownership records conflict for ${relativeTarget}`,
          'agent_runtime_state_invalid',
          500,
        );
      }
      recorded[relativeTarget] = asset;
      recordedCount += 1;
    }
  }
  return { assets: recorded, legacyExtensions };
};

const reconcilePreviousAssets = (supplied, recorded) => {
  const suppliedEntries = Object.entries(supplied);
  const recordedEntries = Object.entries(recorded);
  if (suppliedEntries.length !== recordedEntries.length
    || suppliedEntries.some(([target, asset]) => !sameAssetDescriptor(asset, recorded[target]))) {
    throw new InteractiveUIAgentRuntimeError(
      'Managed Agent Runtime state does not match its durable ownership records',
      'agent_runtime_state_invalid',
      500,
    );
  }
  return supplied;
};

const assertAssetNamespace = (assets) => {
  const owners = new Map();
  for (const [target, asset] of Object.entries(assets)) {
    const key = `${asset.kind}:${asset.name}`;
    const owner = owners.get(key);
    if (owner && (owner.extensionId !== asset.extensionId || owner.version !== asset.version)) {
      throw new InteractiveUIAgentRuntimeError(
        `Managed Agent Runtime namespace conflict between ${owner.target} and ${target}`,
        'agent_runtime_state_invalid',
        500,
      );
    }
    owners.set(key, { target, extensionId: asset.extensionId, version: asset.version });
  }
};

const readFileOrNull = async (fsImpl, target) => {
  try {
    return await fsImpl.readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const walkFiles = async (fsImpl, pathImpl, directory, relative = '') => {
  const entries = await fsImpl.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const target = pathImpl.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fsImpl, pathImpl, target, nextRelative));
    else if (entry.isFile()) files.push(nextRelative);
    else throw new InteractiveUIAgentRuntimeError(`Unsupported existing OpenCode config entry: ${target}`, 'agent_runtime_conflict', 409);
  }
  return files;
};

const writeAtomic = async (fsImpl, pathImpl, cryptoImpl, target, content, managedRoot = null) => {
  if (managedRoot) {
    const current = await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      managedRoot,
      target,
      { label: 'Managed OpenCode write target' },
    );
    if (current && !current.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed OpenCode write target is not a regular file',
        'agent_runtime_conflict',
        409,
      );
    }
  }
  await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true });
  if (managedRoot) {
    const current = await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      managedRoot,
      target,
      { label: 'Managed OpenCode write target' },
    );
    if (current && !current.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed OpenCode write target is not a regular file',
        'agent_runtime_conflict',
        409,
      );
    }
  }
  const temporary = `${target}.${cryptoImpl.randomUUID()}.tmp`;
  try {
    await fsImpl.writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await fsImpl.rename(temporary, target);
  } catch (error) {
    try {
      await fsImpl.rm(temporary, { force: true });
    } catch (cleanupError) {
      const failure = new InteractiveUIAgentRuntimeError(
        'Managed Agent Runtime temporary file cleanup failed',
        'agent_runtime_rollback_failed',
        500,
      );
      failure.cause = cleanupError;
      failure.operationCause = error;
      throw failure;
    }
    throw error;
  }
};

const ownershipRecordContent = (extensionId, assets) => {
  const versions = Array.from(new Set(assets.map((asset) => asset.version))).sort(compareCodePoints);
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    managedBy: 'openchamber',
    extensionId,
    versions,
    assets: assets
      .map((asset) => ({
        target: asset.target,
        version: asset.version,
        kind: asset.kind,
        name: asset.name,
        sha256: asset.sha256,
      }))
      .sort((left, right) => compareCodePoints(left.target, right.target)),
  }, null, 2)}\n`);
};

// Exact bytes emitted by the 1.17.1 ownership writer. Legacy migration is
// deliberately tied to this serialization rather than treating any
// semantically equivalent JSON as historical evidence.
const legacyOwnershipRecordContent = (extensionId, assets) => {
  // Preserve the historical writer's default string ordering and
  // localeCompare target ordering byte-for-byte.  The current writer above
  // intentionally uses code-point ordering; migration must instead match the
  // already-persisted 1.17.1 bytes exactly.
  const versions = Array.from(new Set(assets.map((asset) => asset.version))).sort();
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    managedBy: 'openchamber',
    extensionId,
    versions,
    assets: assets
      .map((asset) => ({
        target: asset.target,
        kind: asset.kind,
        name: asset.name,
        sha256: asset.sha256,
      }))
      .sort((left, right) => left.target.localeCompare(right.target)),
  }, null, 2)}\n`);
};

const groupOwnershipRecords = (assets) => {
  const grouped = new Map();
  for (const [target, asset] of assets) {
    assertExtensionId(asset.extensionId);
    assertVersion(asset.version);
    const entries = grouped.get(asset.extensionId) ?? [];
    entries.push({ target, ...asset });
    grouped.set(asset.extensionId, entries);
  }
  return grouped;
};

const addDesiredAsset = (desired, relativeTarget, asset) => {
  if (desired.size >= MAX_MANAGED_ASSETS) {
    throw new InteractiveUIAgentRuntimeError(
      'Agent Runtime declares too many managed assets',
      'agent_runtime_source_invalid',
      500,
    );
  }
  const existing = desired.get(relativeTarget);
  if (existing) {
    throw new InteractiveUIAgentRuntimeError(
      `Agent Runtime target ${relativeTarget} is declared by both ${existing.extensionId} and ${asset.extensionId}`,
      'agent_runtime_conflict',
      409,
    );
  }
  for (const [otherTarget, other] of desired) {
    if (other.kind !== asset.kind || other.name !== asset.name || other.extensionId === asset.extensionId) continue;
    throw new InteractiveUIAgentRuntimeError(
      `Agent Runtime ${asset.kind} name ${asset.name} is declared by both ${other.extensionId} (${otherTarget}) and ${asset.extensionId} (${relativeTarget})`,
      'agent_runtime_conflict',
      409,
    );
  }
  desired.set(relativeTarget, asset);
};

const resolveRuntimeSource = (pathImpl, rootDirectory, entry) => {
  const normalizedEntry = normalizeTarget(pathImpl, entry);
  const root = pathImpl.resolve(rootDirectory);
  const source = pathImpl.resolve(root, ...normalizedEntry.split('/'));
  const relative = pathImpl.relative(root, source);
  if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime source escaped its extension directory', 'invalid_agent_runtime_target', 500);
  }
  return source;
};

const resolveManagedRuntimeDirectory = async ({
  baseDirectory,
  segments,
  fsImpl,
  pathImpl,
}) => {
  if (typeof baseDirectory !== 'string' || !baseDirectory.trim()) {
    throw new InteractiveUIAgentRuntimeError(
      'Managed Agent Runtime source root is unavailable',
      'agent_runtime_unavailable',
      500,
    );
  }
  const root = pathImpl.resolve(baseDirectory);
  const entry = segments.join('/');
  const target = pathImpl.resolve(root, ...segments);
  const relative = pathImpl.relative(root, target);
  if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
    throw new InteractiveUIAgentRuntimeError(
      'Managed Agent Runtime source escaped its managed cache',
      'agent_runtime_source_invalid',
      500,
    );
  }
  const stat = await statSourceWithoutSymlinks(fsImpl, pathImpl, root, entry);
  if (!stat) {
    throw new InteractiveUIAgentRuntimeError(
      'Installed Agent Runtime source directory is missing',
      'agent_runtime_source_missing',
      500,
    );
  }
  if (!stat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(
      'Installed Agent Runtime source directory is invalid',
      'agent_runtime_source_invalid',
      500,
    );
  }
  return target;
};

const addRuntimeAssets = async ({
  desired,
  extensionId,
  version,
  extensionDirectory,
  agentRuntime,
  legacyAssets = {},
  fsImpl,
  pathImpl,
  cryptoImpl,
}) => {
  if (typeof extensionDirectory !== 'string' || !extensionDirectory || !isRecord(agentRuntime)) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime source descriptor is invalid', 'agent_runtime_source_invalid', 500);
  }
  assertExtensionId(extensionId);
  assertVersion(version);
  if (!Array.isArray(agentRuntime.tools) || !Array.isArray(agentRuntime.skills)) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime source descriptor is invalid', 'agent_runtime_source_invalid', 500);
  }
  const extensionRootStat = await statOrNull(fsImpl, pathImpl.resolve(extensionDirectory));
  if (!extensionRootStat) {
    throw new InteractiveUIAgentRuntimeError('Installed Agent Runtime source directory is missing', 'agent_runtime_source_missing', 500);
  }
  if (!extensionRootStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError('Installed Agent Runtime source directory is invalid', 'agent_runtime_source_invalid', 500);
  }

  const toolNames = new Set();
  for (const tool of agentRuntime.tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name || typeof tool.entry !== 'string') {
      throw new InteractiveUIAgentRuntimeError('Agent Tool source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    if (Object.keys(tool).some((field) => !['name', 'entry'].includes(field))) {
      throw new InteractiveUIAgentRuntimeError('Agent Tool source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    const name = assertToolName(tool.name);
    if (toolNames.has(name)) {
      throw new InteractiveUIAgentRuntimeError(`Duplicate Agent Tool ${name}`, 'agent_runtime_source_invalid', 500);
    }
    toolNames.add(name);
    const entry = assertToolEntry(pathImpl, tool.entry);
    const source = resolveRuntimeSource(pathImpl, extensionDirectory, entry);
    const sourceStat = await statSourceWithoutSymlinks(fsImpl, pathImpl, extensionDirectory, entry);
    if (!sourceStat) {
      throw new InteractiveUIAgentRuntimeError(`Installed Agent Tool is missing: ${name}`, 'agent_runtime_source_missing', 500);
    }
    if (!sourceStat.isFile()) {
      throw new InteractiveUIAgentRuntimeError(`Installed Agent Tool is not a regular file: ${name}`, 'agent_runtime_source_invalid', 500);
    }
    const extensionName = pathImpl.posix.extname(entry);
    const relativeTarget = normalizeTarget(pathImpl, `tools/${name}${extensionName}`);
    const content = await fsImpl.readFile(source).catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new InteractiveUIAgentRuntimeError(`Installed Agent Tool is missing: ${name}`, 'agent_runtime_source_missing', 500);
      }
      throw error;
    });
    addDesiredAsset(desired, relativeTarget, {
      extensionId,
      version,
      kind: 'tool',
      name,
      content,
      sha256: hash(cryptoImpl, content),
      adoptableSha256: Array.isArray(legacyAssets[relativeTarget])
        ? legacyAssets[relativeTarget].filter((value) => MANAGED_HASH_PATTERN.test(value))
        : [],
    });
  }

  const skillNames = new Set();
  for (const skill of agentRuntime.skills) {
    if (!isRecord(skill) || typeof skill.name !== 'string' || !skill.name) {
      throw new InteractiveUIAgentRuntimeError('Agent Skill source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    if (Object.keys(skill).some((field) => !['name', 'entry', 'files'].includes(field))) {
      throw new InteractiveUIAgentRuntimeError('Agent Skill source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    const name = assertSkillName(skill.name);
    if (skillNames.has(name)) {
      throw new InteractiveUIAgentRuntimeError(`Duplicate Agent Skill ${name}`, 'agent_runtime_source_invalid', 500);
    }
    skillNames.add(name);
    if (!Array.isArray(skill.files)
      || !skill.files.includes(`agent-runtime/skills/${name}/SKILL.md`)) {
      throw new InteractiveUIAgentRuntimeError(`Agent Skill ${name} is missing SKILL.md`, 'agent_runtime_source_invalid', 500);
    }
    const prefix = `agent-runtime/skills/${name}/`;
    for (const entry of skill.files) {
      if (typeof entry !== 'string') {
        throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill path is invalid: ${entry}`, 'invalid_agent_runtime_target', 500);
      }
      const normalizedEntry = assertSkillEntry(pathImpl, name, entry);
      const skillRelative = normalizedEntry.slice(prefix.length);
      const source = resolveRuntimeSource(pathImpl, extensionDirectory, normalizedEntry);
      const sourceStat = await statSourceWithoutSymlinks(fsImpl, pathImpl, extensionDirectory, normalizedEntry);
      if (!sourceStat) {
        throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill file is missing: ${normalizedEntry}`, 'agent_runtime_source_missing', 500);
      }
      if (!sourceStat.isFile()) {
        throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill file is not a regular file: ${normalizedEntry}`, 'agent_runtime_source_invalid', 500);
      }
      const content = await fsImpl.readFile(source).catch((error) => {
        if (error?.code === 'ENOENT') {
          throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill file is missing: ${normalizedEntry}`, 'agent_runtime_source_missing', 500);
        }
        throw error;
      });
      const relativeTarget = normalizeTarget(pathImpl, `skills/${name}/${skillRelative}`);
      addDesiredAsset(desired, relativeTarget, {
        extensionId,
        version,
        kind: 'skill',
        name,
        content,
        sha256: hash(cryptoImpl, content),
        adoptableSha256: Array.isArray(legacyAssets[relativeTarget])
          ? legacyAssets[relativeTarget].filter((value) => MANAGED_HASH_PATTERN.test(value))
          : [],
      });
    }
  }
};

const buildDesiredAssets = async ({
  state,
  versionsDirectory,
  hostedCacheDirectory,
  builtInRuntime,
  fsImpl,
  pathImpl,
  cryptoImpl,
}) => {
  const hasEnabledExtension = Object.values(state.extensions ?? {}).some((extension) => extension?.enabled);
  if (hasEnabledExtension && (typeof versionsDirectory !== 'string' || !versionsDirectory.trim())) {
    throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime versions directory is unavailable', 'agent_runtime_unavailable', 500);
  }
  if (hostedCacheDirectory !== null
    && hostedCacheDirectory !== undefined
    && (typeof hostedCacheDirectory !== 'string' || !hostedCacheDirectory.trim())) {
    throw new InteractiveUIAgentRuntimeError('Managed Hosted Agent Runtime cache directory is invalid', 'agent_runtime_unavailable', 500);
  }
  const desired = new Map();
  if (builtInRuntime !== null && builtInRuntime !== undefined) {
    await addRuntimeAssets({
      desired,
      extensionId: builtInRuntime.extensionId,
      version: builtInRuntime.version,
      extensionDirectory: builtInRuntime.rootDirectory,
      agentRuntime: builtInRuntime.agentRuntime,
      legacyAssets: isRecord(builtInRuntime.legacyAssets) ? builtInRuntime.legacyAssets : {},
      fsImpl,
      pathImpl,
      cryptoImpl,
    });
  }
  for (const [stateExtensionId, extension] of Object.entries(state.extensions ?? {})) {
    if (!extension?.enabled) continue;
    const version = extension.activeVersion;
    const metadata = extension.versions?.[version];
    const agentRuntime = metadata?.agentRuntime;
    if (!isRecord(agentRuntime)) continue;
    const extensionId = extension.id;
    assertExtensionId(extensionId);
    if (stateExtensionId !== extensionId) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed Agent Runtime extension state identity is inconsistent',
        'agent_runtime_state_invalid',
        500,
      );
    }
    assertVersion(version);
    if (metadata.version !== version) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed Agent Runtime active version metadata is inconsistent',
        'agent_runtime_state_invalid',
        500,
      );
    }
    if (!['local', 'hosted', 'remote'].includes(metadata.delivery)) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed Agent Runtime delivery metadata is invalid',
        'agent_runtime_state_invalid',
        500,
      );
    }
    let extensionDirectory;
    let runtimeVersion = version;
    if (metadata.delivery === 'hosted') {
      const hostedVersion = assertVersion(
        metadata.hosted?.lastGood?.version,
        'Managed Hosted Agent Runtime version',
      );
      runtimeVersion = hostedVersion;
      extensionDirectory = await resolveManagedRuntimeDirectory({
        baseDirectory: hostedCacheDirectory,
        segments: [extensionId, hostedVersion],
        fsImpl,
        pathImpl,
      });
    } else {
      // Local and Direct Remote shells are both Manager-owned trees under the
      // canonical versions directory.  Remote deliberately does not use the
      // Hosted cache: its signed shell and generated Tool shims are installed
      // at versionsDirectory/<extensionId>/<version> and are verified by the
      // Manager before this loader is invoked.
      extensionDirectory = await resolveManagedRuntimeDirectory({
        baseDirectory: versionsDirectory,
        segments: [extensionId, version],
        fsImpl,
        pathImpl,
      });
    }
    await addRuntimeAssets({
      desired,
      extensionId,
      version: runtimeVersion,
      extensionDirectory,
      agentRuntime,
      fsImpl,
      pathImpl,
      cryptoImpl,
    });
  }
  return desired;
};

const validateExistingTargets = async ({ desired, previousAssets, configDirectory, fsImpl, pathImpl, cryptoImpl }) => {
  const configStat = await statOrNull(fsImpl, configDirectory);
  if (configStat && !configStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(
      'OpenCode config directory is not a regular directory',
      'agent_runtime_conflict',
      409,
    );
  }
  for (const rootName of ['tools', 'skills']) {
    const root = pathImpl.join(configDirectory, rootName);
    const rootStat = await statOrNull(fsImpl, root);
    if (rootStat && !rootStat.isDirectory()) {
      throw new InteractiveUIAgentRuntimeError(
        `OpenCode ${rootName} root is not a regular directory`,
        'agent_runtime_conflict',
        409,
      );
    }
  }
  const ownershipRoot = pathImpl.join(configDirectory, 'openchamber');
  const ownershipStat = await statOrNull(fsImpl, ownershipRoot);
  if (ownershipStat && !ownershipStat.isDirectory()) {
    throw new InteractiveUIAgentRuntimeError(
      'OpenChamber ownership directory is not a regular directory',
      'agent_runtime_conflict',
      409,
    );
  }
  for (const [relativeTarget, previous] of Object.entries(previousAssets)) {
    const target = pathImpl.join(configDirectory, ...relativeTarget.split('/'));
    const targetStat = await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      configDirectory,
      target,
      {
        code: 'agent_runtime_modified',
        label: `Managed OpenCode target ${relativeTarget}`,
      },
    );
    if (!targetStat || !targetStat.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        `Managed OpenCode target is missing or is not a regular file: ${relativeTarget}`,
        'agent_runtime_modified',
        409,
      );
    }
    const content = await readFileOrNull(fsImpl, target);
    if (content && hash(cryptoImpl, content) !== previous.sha256) {
      throw new InteractiveUIAgentRuntimeError(
        `Managed OpenCode file was modified outside OpenChamber: ${relativeTarget}`,
        'agent_runtime_modified',
        409,
      );
    }
  }

  const desiredTools = new Map();
  const desiredSkills = new Set();
  for (const [relativeTarget, asset] of desired) {
    if (asset.kind === 'tool') desiredTools.set(asset.name, relativeTarget);
    if (asset.kind === 'skill') desiredSkills.add(asset.name);
    const previous = previousAssets[relativeTarget];
    if (previous && previous.extensionId !== asset.extensionId) {
      throw new InteractiveUIAgentRuntimeError(`Agent Runtime ownership conflict for ${relativeTarget}`, 'agent_runtime_conflict', 409);
    }
  }

  for (const [name] of desiredTools) {
    for (const extension of TOOL_EXTENSIONS) {
      const relativeCandidate = `tools/${name}${extension}`;
      const candidate = pathImpl.join(configDirectory, 'tools', `${name}${extension}`);
      const candidateStat = await statOrNull(fsImpl, candidate);
      if (candidateStat && !candidateStat.isFile()) {
        throw new InteractiveUIAgentRuntimeError(
          `OpenCode Tool ${name} conflicts with a non-regular existing entry`,
          'agent_tool_conflict',
          409,
        );
      }
      if (candidateStat && !previousAssets[relativeCandidate]) {
        const desiredAsset = desired.get(relativeCandidate);
        const existingContent = desiredAsset ? await readFileOrNull(fsImpl, candidate) : null;
        const existingSha256 = existingContent ? hash(cryptoImpl, existingContent) : null;
        if (desiredAsset && existingSha256
          && desiredAsset.adoptableSha256.includes(existingSha256)) continue;
        throw new InteractiveUIAgentRuntimeError(
          `OpenCode Tool ${name} already exists and is not managed by OCIX`,
          'agent_tool_conflict',
          409,
        );
      }
    }
  }

  for (const name of desiredSkills) {
    const skillDirectory = pathImpl.join(configDirectory, 'skills', name);
    const stat = await statOrNull(fsImpl, skillDirectory);
    if (!stat) continue;
    if (!stat.isDirectory()) {
      throw new InteractiveUIAgentRuntimeError(`OpenCode Skill ${name} conflicts with an existing file`, 'agent_skill_conflict', 409);
    }
    const existingFiles = await walkFiles(fsImpl, pathImpl, skillDirectory);
    for (const file of existingFiles) {
      const relativeCandidate = `skills/${name}/${file}`;
      if (!previousAssets[relativeCandidate]) {
        const desiredAsset = desired.get(relativeCandidate);
        const existingContent = desiredAsset
          ? await readFileOrNull(fsImpl, pathImpl.join(configDirectory, ...relativeCandidate.split('/')))
          : null;
        const existingSha256 = existingContent ? hash(cryptoImpl, existingContent) : null;
        if (desiredAsset && existingSha256
          && desiredAsset.adoptableSha256.includes(existingSha256)) continue;
        throw new InteractiveUIAgentRuntimeError(
          `OpenCode Skill ${name} already exists and is not managed by OCIX`,
          'agent_skill_conflict',
          409,
        );
      }
    }
  }
};

const removeEmptyParents = async (fsImpl, pathImpl, configDirectory, targets) => {
  const candidates = new Set();
  for (const target of targets) {
    let directory = pathImpl.dirname(target);
    while (directory !== configDirectory && directory.startsWith(`${configDirectory}${pathImpl.sep}`)) {
      candidates.add(directory);
      directory = pathImpl.dirname(directory);
    }
  }
  const directories = Array.from(candidates)
    .sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    const stat = await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      configDirectory,
      directory,
      { label: 'Managed OpenCode cleanup directory' },
    );
    if (!stat) continue;
    if (!stat.isDirectory()) {
      throw new InteractiveUIAgentRuntimeError(
        'Managed OpenCode cleanup path is not a regular directory',
        'agent_runtime_conflict',
        409,
      );
    }
    await fsImpl.rmdir(directory).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
    });
  }
};

const readManagedFileOrNull = async (fsImpl, pathImpl, configDirectory, target, label) => {
  const stat = await statContainedPathWithoutSymlinks(
    fsImpl,
    pathImpl,
    configDirectory,
    target,
    { label },
  );
  if (!stat) return null;
  if (!stat.isFile()) {
    throw new InteractiveUIAgentRuntimeError(
      `${label} is not a regular file`,
      'agent_runtime_conflict',
      409,
    );
  }
  return fsImpl.readFile(target);
};

export const reconcileOpenCodeAgentRuntime = async ({
  state,
  previousAssets = {},
  configDirectory,
  versionsDirectory,
  hostedCacheDirectory = null,
  builtInRuntime = null,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = crypto,
} = {}) => {
  if (!isRecord(state?.extensions) || !isRecord(previousAssets) || typeof configDirectory !== 'string' || !configDirectory.trim()) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime deployment dependencies are incomplete', 'agent_runtime_unavailable', 500);
  }
  const resolvedConfigDirectory = pathImpl.resolve(configDirectory);
  const suppliedPreviousAssets = normalizePreviousAssets(pathImpl, previousAssets);
  const recordedState = await readRecordedAssets({
    configDirectory: resolvedConfigDirectory,
    fsImpl,
    pathImpl,
  });
  const recordedPreviousAssets = recordedState.assets;
  const legacyOwnershipExtensions = recordedState.legacyExtensions;
  const normalizedPreviousAssets = reconcilePreviousAssets(
    suppliedPreviousAssets,
    recordedPreviousAssets,
  );
  assertAssetNamespace(normalizedPreviousAssets);
  const desired = await buildDesiredAssets({
    state,
    versionsDirectory,
    hostedCacheDirectory,
    builtInRuntime,
    fsImpl,
    pathImpl,
    cryptoImpl,
  });
  await validateExistingTargets({ desired, previousAssets: normalizedPreviousAssets, configDirectory: resolvedConfigDirectory, fsImpl, pathImpl, cryptoImpl });

  const allRelativeTargets = new Set([...Object.keys(normalizedPreviousAssets), ...desired.keys()]);
  const previousOwnership = groupOwnershipRecords(Object.entries(normalizedPreviousAssets));
  const desiredOwnership = groupOwnershipRecords(desired.entries());
  const ownershipIds = new Set([...previousOwnership.keys(), ...desiredOwnership.keys()]);
  const ownershipTargets = new Map(Array.from(ownershipIds, (extensionId) => [
    extensionId,
    pathImpl.join(resolvedConfigDirectory, 'openchamber', `${extensionId}${OWNERSHIP_RECORD_SUFFIX}`),
  ]));
  for (const target of ownershipTargets.values()) {
    const stat = await statOrNull(fsImpl, target);
    if (stat && !stat.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        'OpenChamber Agent Runtime ownership record is not a regular file',
        'agent_runtime_conflict',
        409,
      );
    }
  }
  const backups = new Map();
  // Keep the exact bytes that a successful deployment published for every
  // changed target.  A rollback must first prove that all of these targets
  // still contain those bytes (or that a prior rollback already restored the
  // original backup) before it mutates any target.  Paths alone are not
  // sufficient: an external writer could otherwise cause rollback to delete
  // or overwrite user content.
  const changedTargets = [];
  const recordChangedTarget = (target, expected) => {
    const previous = backups.has(target) ? backups.get(target) : null;
    changedTargets.push({ target, previous, expected });
  };
  const stateEquals = (left, right) => {
    if (left === null || right === null) return left === right;
    return Buffer.from(left).equals(Buffer.from(right));
  };
  for (const relativeTarget of allRelativeTargets) {
    const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
    backups.set(target, await readManagedFileOrNull(
      fsImpl,
      pathImpl,
      resolvedConfigDirectory,
      target,
      `Managed OpenCode target ${relativeTarget}`,
    ));
  }
  for (const target of ownershipTargets.values()) {
    backups.set(target, await readManagedFileOrNull(
      fsImpl,
      pathImpl,
      resolvedConfigDirectory,
      target,
      'OpenChamber Agent Runtime ownership record',
    ));
  }
  const transactionTarget = pathImpl.join(
    resolvedConfigDirectory,
    'openchamber',
    TRANSACTION_RECORD_NAME,
  );
  let transactionStarted = false;
  const beginTransaction = async () => {
    if (transactionStarted) return;
    const content = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      transactionId: cryptoImpl.randomUUID(),
      previousAssetsHash: hash(cryptoImpl, Buffer.from(JSON.stringify(normalizedPreviousAssets))),
      desiredAssetsHash: hash(cryptoImpl, Buffer.from(JSON.stringify(Object.fromEntries(
        Array.from(desired.entries()).map(([target, asset]) => [target, {
          extensionId: asset.extensionId,
          version: asset.version,
          kind: asset.kind,
          name: asset.name,
          sha256: asset.sha256,
        }]),
      )))),
    }, null, 2)}\n`);
    await writeAtomic(
      fsImpl,
      pathImpl,
      cryptoImpl,
      transactionTarget,
      content,
      resolvedConfigDirectory,
    );
    transactionStarted = true;
  };
  const clearTransaction = async () => {
    if (!transactionStarted) return;
    await statContainedPathWithoutSymlinks(
      fsImpl,
      pathImpl,
      resolvedConfigDirectory,
      transactionTarget,
      { label: 'Managed Agent Runtime transaction record' },
    );
    await fsImpl.rm(transactionTarget, { force: true });
    transactionStarted = false;
  };

  const makeRollbackFailure = (cause) => {
    if (cause?.code === 'agent_runtime_rollback_failed') return cause;
    const failure = new InteractiveUIAgentRuntimeError(
      'Managed Agent Runtime rollback failed',
      'agent_runtime_rollback_failed',
      500,
    );
    failure.cause = cause;
    return failure;
  };

  const rollback = async ({ preserveTransaction = false } = {}) => {
    if (changedTargets.length > 0 && !transactionStarted) {
      try {
        await beginTransaction();
      } catch (error) {
        // If the marker cannot be established, do not attempt to mutate any
        // deployment target.  The caller must observe the rollback failure
        // instead of being told that restoration succeeded.
        throw makeRollbackFailure(error);
      }
    }

    // Fail closed before the first target mutation.  Every changed target
    // must still be exactly the bytes we published, or already equal its
    // original backup from an interrupted/idempotent retry.  In particular,
    // a newly-created target replaced by a user is never removed, and an
    // overwritten managed target changed by a user is never restored over.
    const rollbackSnapshot = [];
    try {
      for (const record of changedTargets) {
        const current = await readManagedFileOrNull(
          fsImpl,
          pathImpl,
          resolvedConfigDirectory,
          record.target,
          'Managed OpenCode rollback target',
        );
        if (!stateEquals(current, record.expected) && !stateEquals(current, record.previous)) {
          const relativeTarget = pathImpl.relative(resolvedConfigDirectory, record.target)
            .split(pathImpl.sep)
            .join('/');
          throw new InteractiveUIAgentRuntimeError(
            `Managed OpenCode rollback target was modified outside OpenChamber: ${relativeTarget}`,
            'agent_runtime_modified',
            409,
          );
        }
        rollbackSnapshot.push({ record, current });
      }
    } catch (error) {
      // Leave the transaction marker in place.  It is the durable signal that
      // recovery is required, and no deployment target has been touched yet.
      throw makeRollbackFailure(error);
    }

    let rollbackCause = null;
    for (const { record, current } of rollbackSnapshot.slice().reverse()) {
      const { target, previous } = record;
      // A previous rollback may already have restored this target.  Treat that
      // state as a successful no-op rather than writing it again.
      if (stateEquals(current, previous)) continue;
      try {
        if (previous === null) {
          await statContainedPathWithoutSymlinks(
            fsImpl,
            pathImpl,
            resolvedConfigDirectory,
            target,
            { label: 'Managed OpenCode rollback target' },
          );
          await fsImpl.rm(target, { force: true });
        } else {
          await writeAtomic(
            fsImpl,
            pathImpl,
            cryptoImpl,
            target,
            previous,
            resolvedConfigDirectory,
          );
        }
      } catch (error) {
        rollbackCause ??= error;
      }
    }
    // A failed atomic write may have created an empty parent before its
    // temporary file was published, so clean parents for every candidate,
    // not only paths whose rename completed.
    const cleanupTargets = [
      ...Array.from(allRelativeTargets, (relativeTarget) =>
        pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'))),
      ...ownershipTargets.values(),
      ...changedTargets.map(({ target }) => target),
      transactionTarget,
    ];
    try {
      await removeEmptyParents(fsImpl, pathImpl, resolvedConfigDirectory, cleanupTargets);
    } catch (error) {
      rollbackCause ??= error;
    }
    if (!rollbackCause && !preserveTransaction) {
      try {
        await clearTransaction();
        await removeEmptyParents(
          fsImpl,
          pathImpl,
          resolvedConfigDirectory,
          [transactionTarget],
        );
      } catch (error) {
        rollbackCause ??= error;
      }
    }
    if (rollbackCause) throw makeRollbackFailure(rollbackCause);
  };

  const ownershipChanges = [];
  for (const extensionId of ownershipIds) {
    const target = ownershipTargets.get(extensionId);
    const current = backups.get(target);
    const previous = previousOwnership.has(extensionId)
      ? ownershipRecordContent(extensionId, previousOwnership.get(extensionId))
      : null;
    const next = desiredOwnership.has(extensionId)
      ? ownershipRecordContent(extensionId, desiredOwnership.get(extensionId))
      : null;
    const isLegacyRecord = legacyOwnershipExtensions.has(extensionId);
    const expectedLegacy = isLegacyRecord && previousOwnership.has(extensionId)
      ? legacyOwnershipRecordContent(extensionId, previousOwnership.get(extensionId))
      : null;
    if ((previous === null && current !== null)
      || (previous !== null && isLegacyRecord && !current?.equals(expectedLegacy))
      || (previous !== null && !isLegacyRecord && !current?.equals(previous))) {
      throw new InteractiveUIAgentRuntimeError(
        `OCIX ownership record for ${extensionId} was modified outside OpenChamber`,
        'agent_runtime_conflict',
        409,
      );
    }
    if ((current === null && next === null)
      || (current !== null && next !== null && current.equals(next))) continue;
    ownershipChanges.push({ target, current, next });
  }

  try {
    for (const relativeTarget of Object.keys(normalizedPreviousAssets)) {
      if (desired.has(relativeTarget)) continue;
      const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
      const targetStat = await statContainedPathWithoutSymlinks(
        fsImpl,
        pathImpl,
        resolvedConfigDirectory,
        target,
        {
          code: 'agent_runtime_modified',
          label: `Managed OpenCode target ${relativeTarget}`,
        },
      );
      if (targetStat) {
        await beginTransaction();
        recordChangedTarget(target, null);
        await fsImpl.rm(target, { force: true });
      }
    }
    for (const [relativeTarget, asset] of desired) {
      const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
      const current = await readManagedFileOrNull(
        fsImpl,
        pathImpl,
        resolvedConfigDirectory,
        target,
        `Managed OpenCode target ${relativeTarget}`,
      );
      if (current && hash(cryptoImpl, current) === asset.sha256) continue;
      await beginTransaction();
      await writeAtomic(
        fsImpl,
        pathImpl,
        cryptoImpl,
        target,
        asset.content,
        resolvedConfigDirectory,
      );
      recordChangedTarget(target, asset.content);
    }
    // Ownership is the commit record: publish or remove it only after every
    // corresponding Tool/Skill byte has reached its final target.
    for (const { target, current, next } of ownershipChanges) {
      await beginTransaction();
      if (next === null) {
        if (current !== null) {
          recordChangedTarget(target, null);
          await statContainedPathWithoutSymlinks(
            fsImpl,
            pathImpl,
            resolvedConfigDirectory,
            target,
            { label: 'OpenChamber Agent Runtime ownership record' },
          );
          await fsImpl.rm(target, { force: true });
        }
      } else {
        await writeAtomic(fsImpl, pathImpl, cryptoImpl, target, next, resolvedConfigDirectory);
        recordChangedTarget(target, next);
      }
    }
    await clearTransaction();
  } catch (error) {
    await rollback({ preserveTransaction: error?.code === 'agent_runtime_rollback_failed' });
    throw error;
  }

  try {
    await removeEmptyParents(
      fsImpl,
      pathImpl,
      resolvedConfigDirectory,
      [
        ...Object.keys(normalizedPreviousAssets).filter((relativeTarget) => !desired.has(relativeTarget))
          .map((relativeTarget) => pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'))),
        ...Array.from(ownershipTargets.entries())
          .filter(([extensionId]) => !desiredOwnership.has(extensionId))
          .map(([, target]) => target),
      ],
    );
  } catch (error) {
    await rollback();
    throw error;
  }

  return {
    assets: Object.fromEntries(
      Array.from(desired.entries())
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([relativeTarget, asset]) => [relativeTarget, {
          extensionId: asset.extensionId,
          version: asset.version,
          kind: asset.kind,
          name: asset.name,
          sha256: asset.sha256,
        }]),
    ),
    changed: changedTargets.length > 0,
    rollback,
  };
};
