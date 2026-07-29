import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargetArchitecture } from './target-architecture.mjs';
import { artifactForTarget, readOpenCodeCliLock } from './opencode-cli-lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const outputDir = path.join(electronRoot, 'resources', 'opencode-cli');
const cacheRoot = path.join(electronRoot, '.cache', 'opencode-cli');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
    throw new Error(`Command failed: ${command} ${args.join(' ')}${stderr}${stdout}`);
  }
  return result;
};

const outputBinaryPath = (binaryName) => path.join(outputDir, binaryName);

const readBinaryVersion = (binaryPath) => {
  if (!fs.existsSync(binaryPath)) return null;
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split(/\s+/)[0] || null;
};

const ensureExecutable = (filePath) => {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
};

const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const assertHash = (filePath, expected) => {
  const actual = sha256(filePath);
  if (actual !== expected) {
    throw new Error(`OpenCode CLI artifact SHA256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
};

const download = async (url, destination, expectedSha256) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const temp = `${destination}.tmp`;
  fs.writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
  assertHash(temp, expectedSha256);
  fs.renameSync(temp, destination);
};

const extractArchive = (archivePath, destination) => {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      run('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
      ]);
      return;
    }
    run('unzip', ['-q', archivePath, '-d', destination]);
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    run('tar', ['-xzf', archivePath, '-C', destination]);
    return;
  }
  throw new Error(`Unsupported OpenCode CLI archive: ${archivePath}`);
};

const findBinary = (root, binaryName) => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === binaryName.toLowerCase()) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
};

const main = async () => {
  const lock = readOpenCodeCliLock();
  const version = lock.version;
  const targetArchitecture = resolveTargetArchitecture();
  const artifact = artifactForTarget(lock, process.platform, targetArchitecture.opencode);
  const binary = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const outputBinary = outputBinaryPath(binary);
  const existingVersion = readBinaryVersion(outputBinary);
  if (existingVersion === version) {
    console.log(`[electron] bundled OpenCode CLI already prepared: ${outputBinary} (${version})`);
    return;
  }

  const cacheDir = path.join(cacheRoot, version, `${process.platform}-${targetArchitecture.opencode}`);
  const archivePath = path.join(cacheDir, artifact.file);
  if (!fs.existsSync(archivePath)) {
    console.log(`[electron] downloading managed OpenCode CLI ${version}: ${artifact.file}`);
    await download(artifact.url, archivePath, artifact.sha256);
  } else {
    assertHash(archivePath, artifact.sha256);
    console.log(`[electron] using cached OpenCode CLI archive: ${archivePath}`);
  }

  const extractDir = path.join(cacheDir, 'extract');
  extractArchive(archivePath, extractDir);
  const extractedBinary = findBinary(extractDir, binary);
  if (!extractedBinary) {
    throw new Error(`Archive ${archivePath} did not contain ${binary}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir)) {
    if (entry === '.gitkeep') continue;
    fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
  }
  fs.copyFileSync(extractedBinary, outputBinary);
  ensureExecutable(outputBinary);

  const preparedVersion = readBinaryVersion(outputBinary);
  if (preparedVersion !== version) {
    throw new Error(`Prepared OpenCode CLI version mismatch: expected ${version}, got ${preparedVersion || 'unknown'}`);
  }

  fs.writeFileSync(
    path.join(outputDir, 'distribution.json'),
    `${JSON.stringify({
      schema: lock.schema,
      repository: lock.repository,
      releaseTag: lock.releaseTag,
      version: lock.version,
      upstreamCommit: lock.upstreamCommit,
      forkCommit: lock.forkCommit,
      target: artifact.key,
      sha256: artifact.sha256,
    }, null, 2)}\n`,
  );
  console.log(`[electron] prepared managed OpenCode CLI ${version}: ${outputBinary}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
