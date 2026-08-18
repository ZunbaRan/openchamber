import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenCodeCliLock } from './opencode-cli-lock.mjs';
import { assertOpenCodeCliBinary } from './opencode-cli-self-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const binaryName = () => process.platform === 'win32' ? 'opencode.exe' : 'opencode';

const expectedVersionFor = (binaryPath, lock) => {
  if (!process.env.OPENCHAMBER_OPENCODE_CLI_PATH?.trim()) return lock.version;

  const distributionPath = path.join(path.dirname(binaryPath), 'distribution.json');
  if (!fs.existsSync(distributionPath)) {
    throw new Error(`Local OpenCode CLI distribution metadata not found: ${distributionPath}`);
  }
  const distribution = JSON.parse(fs.readFileSync(distributionPath, 'utf8'));
  if (
    distribution?.localOverride !== true ||
    distribution.releaseTag !== 'local-override' ||
    typeof distribution.version !== 'string' ||
    !/^\S+$/.test(distribution.version)
  ) {
    throw new Error(`Invalid local OpenCode CLI distribution metadata: ${distributionPath}`);
  }
  return distribution.version;
};

const findPackagedBinaries = () => {
  const distDir = path.join(electronRoot, 'dist');
  if (!fs.existsSync(distDir)) return [];

  const candidates = [];
  const targetBinary = binaryName().toLowerCase();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name.toLowerCase() !== targetBinary) continue;
      const parent = path.basename(path.dirname(fullPath)).toLowerCase();
      if (parent === 'opencode-cli') {
        candidates.push(fullPath);
      }
    }
  };
  visit(distDir);
  return candidates;
};

const usage = () => {
  console.error('Usage: node scripts/verify-opencode-cli.mjs --staged|--packaged');
  process.exit(2);
};

const main = () => {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--packaged') usage();

  const lock = readOpenCodeCliLock();
  if (mode === '--staged') {
    const binaryPath = path.join(electronRoot, 'resources', 'opencode-cli', binaryName());
    assertOpenCodeCliBinary(binaryPath, expectedVersionFor(binaryPath, lock));
    return;
  }

  const packagedBinaries = findPackagedBinaries();
  if (packagedBinaries.length === 0) {
    throw new Error('No packaged OpenCode CLI found under packages/electron/dist');
  }
  for (const packagedBinary of packagedBinaries) {
    assertOpenCodeCliBinary(packagedBinary, expectedVersionFor(packagedBinary, lock));
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
