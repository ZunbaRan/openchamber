import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const electronRoot = path.resolve(__dirname, '..');
export const lockPath = path.join(electronRoot, 'opencode-cli.lock.json');

const VERSION_RE = /^\d+\.\d+\.\d+-oc\.\d+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const REQUIRED_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'windows-arm64',
  'windows-x64',
  'linux-arm64',
  'linux-x64',
];

export const validateOpenCodeCliLock = (lock, source = lockPath) => {
  if (lock?.schema !== 'com.openchamber.opencode-cli-lock.v1') {
    throw new Error(`Unsupported OpenCode CLI lock schema in ${source}`);
  }
  if (lock.repository !== 'ZunbaRan/opencode') {
    throw new Error(`OpenCode CLI lock repository must be ZunbaRan/opencode, got: ${lock.repository || '(missing)'}`);
  }
  if (!VERSION_RE.test(lock.version) || lock.releaseTag !== `v${lock.version}`) {
    throw new Error(`Invalid OpenCode fork version/tag in ${source}`);
  }
  if (lock.sdk?.package !== '@zunbaran/opencode-sdk' || lock.sdk?.version !== lock.version) {
    throw new Error(`OpenCode SDK lock must match CLI version ${lock.version}`);
  }
  if (!SHA256_RE.test(lock.sdk?.sha256)) {
    throw new Error(`OpenCode SDK lock must contain a valid SHA256 in ${source}`);
  }
  if (!/^[a-f0-9]{40}$/.test(lock.upstreamCommit) || !/^[a-f0-9]{40}$/.test(lock.forkCommit)) {
    throw new Error('OpenCode CLI lock must contain exact upstream and fork commits');
  }
  for (const target of REQUIRED_TARGETS) {
    if (!lock.artifacts?.[target]) {
      throw new Error(`OpenCode CLI lock must contain ${target}`);
    }
  }
  for (const [target, artifact] of Object.entries(lock.artifacts || {})) {
    if (!artifact || typeof artifact !== 'object') throw new Error(`Invalid artifact lock for ${target}`);
    if (!SHA256_RE.test(artifact.sha256)) throw new Error(`Invalid SHA256 for OpenCode artifact ${target}`);
    const expectedPrefix = `https://github.com/${lock.repository}/releases/download/${lock.releaseTag}/`;
    if (artifact.url !== `${expectedPrefix}${artifact.file}`) {
      throw new Error(`OpenCode artifact URL is not bound to ${lock.repository}/${lock.releaseTag}: ${target}`);
    }
  }
  return lock;
};

export const readOpenCodeCliLock = () => validateOpenCodeCliLock(
  JSON.parse(fs.readFileSync(lockPath, 'utf8')),
  lockPath,
);

export const targetKey = (platform, arch) => {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `darwin-${arch}`;
  if (platform === 'win32' && (arch === 'arm64' || arch === 'x64')) return `windows-${arch}`;
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) return `linux-${arch}`;
  throw new Error(`Unsupported OpenCode CLI target: ${platform}/${arch}`);
};

export const artifactForTarget = (lock, platform, arch) => {
  const key = targetKey(platform, arch);
  const artifact = lock.artifacts?.[key];
  if (!artifact) throw new Error(`OpenCode CLI lock has no artifact for ${key}`);
  return { key, ...artifact };
};
