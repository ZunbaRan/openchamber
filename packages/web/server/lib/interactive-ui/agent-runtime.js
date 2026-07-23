import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import crypto from 'node:crypto';

const TOOL_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'];
const MANAGED_HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

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

const statOrNull = async (fsImpl, target) => {
  try {
    return await fsImpl.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const normalizePreviousAssets = (pathImpl, previousAssets) => {
  const normalized = {};
  for (const [relativeTarget, asset] of Object.entries(previousAssets)) {
    const target = normalizeTarget(pathImpl, relativeTarget);
    if ((!target.startsWith('tools/') && !target.startsWith('skills/'))
      || !isRecord(asset)
      || typeof asset.extensionId !== 'string'
      || typeof asset.version !== 'string'
      || !['tool', 'skill'].includes(asset.kind)
      || typeof asset.name !== 'string'
      || !MANAGED_HASH_PATTERN.test(asset.sha256 ?? '')) {
      throw new InteractiveUIAgentRuntimeError('Managed Agent Runtime ownership state is invalid', 'agent_runtime_state_invalid', 500);
    }
    normalized[target] = asset;
  }
  return normalized;
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

const writeAtomic = async (fsImpl, pathImpl, cryptoImpl, target, content) => {
  await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true });
  const temporary = `${target}.${cryptoImpl.randomUUID()}.tmp`;
  try {
    await fsImpl.writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await fsImpl.rename(temporary, target);
  } catch (error) {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

const addDesiredAsset = (desired, relativeTarget, asset) => {
  const existing = desired.get(relativeTarget);
  if (existing) {
    throw new InteractiveUIAgentRuntimeError(
      `Agent Runtime target ${relativeTarget} is declared by both ${existing.extensionId} and ${asset.extensionId}`,
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
  if (typeof extensionId !== 'string' || !extensionId || typeof version !== 'string' || !version
    || typeof extensionDirectory !== 'string' || !extensionDirectory || !isRecord(agentRuntime)) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime source descriptor is invalid', 'agent_runtime_source_invalid', 500);
  }

  for (const tool of Array.isArray(agentRuntime.tools) ? agentRuntime.tools : []) {
    if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name || typeof tool.entry !== 'string') {
      throw new InteractiveUIAgentRuntimeError('Agent Tool source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    const source = resolveRuntimeSource(pathImpl, extensionDirectory, tool.entry);
    const sourceStat = await statOrNull(fsImpl, source);
    if (!sourceStat?.isFile()) {
      throw new InteractiveUIAgentRuntimeError(`Installed Agent Tool is missing: ${tool.name}`, 'agent_runtime_source_missing', 500);
    }
    const extensionName = pathImpl.extname(tool.entry);
    const relativeTarget = normalizeTarget(pathImpl, `tools/${tool.name}${extensionName}`);
    const content = await fsImpl.readFile(source);
    addDesiredAsset(desired, relativeTarget, {
      extensionId,
      version,
      kind: 'tool',
      name: tool.name,
      content,
      sha256: hash(cryptoImpl, content),
      adoptableSha256: Array.isArray(legacyAssets[relativeTarget])
        ? legacyAssets[relativeTarget].filter((value) => MANAGED_HASH_PATTERN.test(value))
        : [],
    });
  }

  for (const skill of Array.isArray(agentRuntime.skills) ? agentRuntime.skills : []) {
    if (!isRecord(skill) || typeof skill.name !== 'string' || !skill.name) {
      throw new InteractiveUIAgentRuntimeError('Agent Skill source descriptor is invalid', 'agent_runtime_source_invalid', 500);
    }
    const prefix = `agent-runtime/skills/${skill.name}/`;
    for (const entry of Array.isArray(skill.files) ? skill.files : []) {
      if (typeof entry !== 'string' || !entry.startsWith(prefix)) {
        throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill path is invalid: ${entry}`, 'invalid_agent_runtime_target', 500);
      }
      const skillRelative = entry.slice(prefix.length);
      const source = resolveRuntimeSource(pathImpl, extensionDirectory, entry);
      const content = await fsImpl.readFile(source).catch((error) => {
        if (error?.code === 'ENOENT') {
          throw new InteractiveUIAgentRuntimeError(`Installed Agent Skill file is missing: ${entry}`, 'agent_runtime_source_missing', 500);
        }
        throw error;
      });
      const relativeTarget = normalizeTarget(pathImpl, `skills/${skill.name}/${skillRelative}`);
      addDesiredAsset(desired, relativeTarget, {
        extensionId,
        version,
        kind: 'skill',
        name: skill.name,
        content,
        sha256: hash(cryptoImpl, content),
        adoptableSha256: Array.isArray(legacyAssets[relativeTarget])
          ? legacyAssets[relativeTarget].filter((value) => MANAGED_HASH_PATTERN.test(value))
          : [],
      });
    }
  }
};

const buildDesiredAssets = async ({ state, versionsDirectory, builtInRuntime, fsImpl, pathImpl, cryptoImpl }) => {
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
  for (const extension of Object.values(state.extensions ?? {})) {
    if (!extension?.enabled) continue;
    const version = extension.activeVersion;
    const metadata = extension.versions?.[version];
    const agentRuntime = metadata?.agentRuntime;
    if (!isRecord(agentRuntime)) continue;
    await addRuntimeAssets({
      desired,
      extensionId: extension.id,
      version,
      extensionDirectory: pathImpl.join(versionsDirectory, extension.id, version),
      agentRuntime,
      fsImpl,
      pathImpl,
      cryptoImpl,
    });
  }
  return desired;
};

const validateExistingTargets = async ({ desired, previousAssets, configDirectory, fsImpl, pathImpl, cryptoImpl }) => {
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
  for (const [relativeTarget, previous] of Object.entries(previousAssets)) {
    const target = pathImpl.join(configDirectory, ...relativeTarget.split('/'));
    const targetStat = await statOrNull(fsImpl, target);
    if (targetStat && !targetStat.isFile()) {
      throw new InteractiveUIAgentRuntimeError(
        `Managed OpenCode target is not a regular file: ${relativeTarget}`,
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
      if (await statOrNull(fsImpl, candidate) && !previousAssets[relativeCandidate]) {
        const desiredAsset = desired.get(relativeCandidate);
        const existingContent = desiredAsset ? await readFileOrNull(fsImpl, candidate) : null;
        const existingSha256 = existingContent ? hash(cryptoImpl, existingContent) : null;
        if (desiredAsset && existingSha256 && (
          existingSha256 === desiredAsset.sha256
          || desiredAsset.adoptableSha256.includes(existingSha256)
        )) continue;
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
        if (desiredAsset && existingSha256 && (
          existingSha256 === desiredAsset.sha256
          || desiredAsset.adoptableSha256.includes(existingSha256)
        )) continue;
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
  const directories = Array.from(new Set(targets.map((target) => pathImpl.dirname(target))))
    .sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    if (directory === configDirectory || !directory.startsWith(`${configDirectory}${pathImpl.sep}`)) continue;
    await fsImpl.rmdir(directory).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
    });
  }
};

export const reconcileOpenCodeAgentRuntime = async ({
  state,
  previousAssets = {},
  configDirectory,
  versionsDirectory,
  builtInRuntime = null,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = crypto,
} = {}) => {
  if (!isRecord(state?.extensions) || !isRecord(previousAssets) || typeof configDirectory !== 'string' || !configDirectory.trim()) {
    throw new InteractiveUIAgentRuntimeError('Agent Runtime deployment dependencies are incomplete', 'agent_runtime_unavailable', 500);
  }
  const resolvedConfigDirectory = pathImpl.resolve(configDirectory);
  const normalizedPreviousAssets = normalizePreviousAssets(pathImpl, previousAssets);
  const desired = await buildDesiredAssets({ state, versionsDirectory, builtInRuntime, fsImpl, pathImpl, cryptoImpl });
  await validateExistingTargets({ desired, previousAssets: normalizedPreviousAssets, configDirectory: resolvedConfigDirectory, fsImpl, pathImpl, cryptoImpl });

  const allRelativeTargets = new Set([...Object.keys(normalizedPreviousAssets), ...desired.keys()]);
  const backups = new Map();
  const changedTargets = [];
  for (const relativeTarget of allRelativeTargets) {
    const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
    backups.set(target, await readFileOrNull(fsImpl, target));
  }

  const rollback = async () => {
    for (const target of changedTargets.slice().reverse()) {
      const previous = backups.get(target);
      if (previous === null) await fsImpl.rm(target, { force: true }).catch(() => {});
      else await writeAtomic(fsImpl, pathImpl, cryptoImpl, target, previous).catch(() => {});
    }
    await removeEmptyParents(fsImpl, pathImpl, resolvedConfigDirectory, changedTargets).catch(() => {});
  };

  try {
    for (const relativeTarget of Object.keys(normalizedPreviousAssets)) {
      if (desired.has(relativeTarget)) continue;
      const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
      if (await statOrNull(fsImpl, target)) {
        await fsImpl.rm(target, { force: true });
        changedTargets.push(target);
      }
    }
    for (const [relativeTarget, asset] of desired) {
      const target = pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'));
      const current = await readFileOrNull(fsImpl, target);
      if (current && hash(cryptoImpl, current) === asset.sha256) continue;
      await writeAtomic(fsImpl, pathImpl, cryptoImpl, target, asset.content);
      changedTargets.push(target);
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  await removeEmptyParents(
    fsImpl,
    pathImpl,
    resolvedConfigDirectory,
    Object.keys(normalizedPreviousAssets).filter((relativeTarget) => !desired.has(relativeTarget))
      .map((relativeTarget) => pathImpl.join(resolvedConfigDirectory, ...relativeTarget.split('/'))),
  );

  return {
    assets: Object.fromEntries(Array.from(desired, ([relativeTarget, asset]) => [relativeTarget, {
      extensionId: asset.extensionId,
      version: asset.version,
      kind: asset.kind,
      name: asset.name,
      sha256: asset.sha256,
    }])),
    changed: changedTargets.length > 0,
    rollback,
  };
};
