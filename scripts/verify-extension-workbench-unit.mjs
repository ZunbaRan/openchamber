import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const startedAt = new Date().toISOString();
const reportDirectory = path.join(root, '.tmp', 'extension-workbench', 'unit');
const reportPath = path.join(reportDirectory, 'report.json');

const collectTests = async (directory, pattern, recursive = false) => {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      result.push(...await collectTests(relative, pattern, true));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      result.push(relative);
    }
  }
  return result;
};

const testFiles = [
  ...await collectTests('packages/web/server/lib/interactive-ui', /\.test\.js$/),
  ...await collectTests('packages/ui/src/lib/interactive-ui', /\.test\.ts$/),
  ...await collectTests('packages/ui/src/components/interactive-ui', /\.test\.tsx?$/, true),
  'packages/electron/artifact-runner.test.mjs',
  'scripts/interactive-ui-extension.test.mjs',
].sort();

const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
let output = '';
const child = spawn('bun', ['test', ...testFiles], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    output += chunk;
    (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
  });
}
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});

const readCount = (label) => {
  const matches = [...output.matchAll(new RegExp(`(\\d+) ${label}`, 'g'))];
  return matches.length > 0 ? Number(matches.at(-1)[1]) : null;
};
const report = {
  $schema: 'openchamber://extension-workbench-test-report/v1',
  suite: 'unit',
  ok: exitCode === 0,
  complete: exitCode === 0,
  build: {
    packageVersion: packageJson.version,
    sourceIdentity: process.env.OPENCHAMBER_BUILD_ID || `workspace-${packageJson.version}`,
  },
  platform: {
    os: process.platform,
    architecture: process.arch,
    release: os.release(),
  },
  runtime: {
    node: process.version,
    bun: process.env.BUN_VERSION || 'bun',
  },
  startedAt,
  finishedAt: new Date().toISOString(),
  cases: {
    files: testFiles,
    pass: readCount('pass'),
    fail: readCount('fail'),
    assertions: readCount('expect\\(\\) calls'),
  },
  artifacts: [],
  externalBlockers: [],
  unverifiedPlatforms: process.platform === 'darwin' ? ['win32', 'linux'] : ['darwin', 'win32', 'linux'].filter((entry) => entry !== process.platform),
};

await fs.mkdir(reportDirectory, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Extension Workbench unit report: ${reportPath}`);
if (!report.ok) process.exitCode = 1;
