import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenCodeCliLock } from './opencode-cli-lock.mjs';

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(electronRoot, '..', '..');
const executable = path.join(
  electronRoot,
  'resources',
  'opencode-cli',
  process.platform === 'win32' ? 'opencode.exe' : 'opencode',
);
const builtInTools = path.join(
  projectRoot,
  'packages',
  'web',
  'server',
  'lib',
  'interactive-ui',
  'builtin',
  'agent-runtime',
  'tools',
);
const expectedTools = ['html_artifact', 'interactive_ui'];
const lock = readOpenCodeCliLock();

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-opencode-runtime-'));
const openCodeConfig = path.join(temporaryRoot, 'opencode-config');
const xdgConfig = path.join(temporaryRoot, 'xdg-config');
const xdgData = path.join(temporaryRoot, 'xdg-data');
const xdgCache = path.join(temporaryRoot, 'xdg-cache');
const toolDirectory = path.join(openCodeConfig, 'tools');
await Promise.all([
  fs.mkdir(toolDirectory, { recursive: true }),
  fs.mkdir(xdgConfig, { recursive: true }),
  fs.mkdir(xdgData, { recursive: true }),
  fs.mkdir(xdgCache, { recursive: true }),
]);
await fs.cp(builtInTools, toolDirectory, { recursive: true });

const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    OPENCODE_CONFIG_DIR: openCodeConfig,
    OPENCODE_DISABLE_CHANNEL_DB: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    XDG_CACHE_HOME: xdgCache,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
const appendLogs = (chunk) => {
  logs = `${logs}${String(chunk)}`.slice(-64 * 1024);
};
child.stdout.on('data', appendLogs);
child.stderr.on('data', appendLogs);

const waitForPort = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = logs.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/i);
    if (match) return Number(match[1]);
    if (child.exitCode !== null) {
      throw new Error(`Managed OpenCode exited with ${child.exitCode}\n${logs}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for managed OpenCode\n${logs}`);
};

const readJson = async (url, init) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
};

try {
  const port = await waitForPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const capabilities = await readJson(`${baseUrl}/global/capabilities`);
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.payload.distribution, lock.repository);
  assert.equal(capabilities.payload.version, lock.version);
  assert.equal(capabilities.payload.upstreamCommit, lock.upstreamCommit);
  assert.equal(capabilities.payload.forkCommit, lock.forkCommit);
  assert.equal(capabilities.payload.apiVersion, '2');
  assert.equal(capabilities.payload.managedUpdate, true);
  assert.equal(capabilities.payload.features?.mcpLegacy, true);
  assert.equal(capabilities.payload.features?.mcp20260728, true);
  assert.equal(capabilities.payload.features?.mcpApps, true);
  assert.equal(capabilities.payload.features?.mcpAppToolCall, true);

  const tools = await readJson(
    `${baseUrl}/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`,
  );
  assert.equal(
    tools.response.status,
    200,
    `Managed Tool discovery failed: ${JSON.stringify(tools.payload)}\n${logs}`,
  );
  assert(Array.isArray(tools.payload), 'Managed Tool discovery did not return an array');
  for (const tool of expectedTools) {
    assert(tools.payload.includes(tool), `Managed Tool discovery omitted ${tool}`);
  }

  const upgrade = await readJson(`${baseUrl}/global/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(upgrade.response.ok, false, 'Managed OpenCode accepted an independent upgrade');
  assert.equal(upgrade.payload?.success, false);

  const dataFiles = await fs.readdir(xdgData, { recursive: true });
  assert.deepEqual(
    dataFiles.filter((name) => /opencode-.*\.db$/i.test(name)),
    [],
    'Managed OpenCode created a channel-specific database',
  );

  console.log(JSON.stringify({
    ok: true,
    version: capabilities.payload.version,
    distribution: capabilities.payload.distribution,
    features: capabilities.payload.features,
    tools: expectedTools,
    independentUpgradeStatus: upgrade.response.status,
    channelDatabases: [],
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
