import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenCodeCliLock } from './opencode-cli-lock.mjs';

const LOCAL_OVERRIDE_TAG = 'local-override';
const NON_BLANK_RE = /^\S+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const assertNonBlank = (value, field) => {
  if (typeof value !== 'string' || !NON_BLANK_RE.test(value)) {
    throw new Error(`Local OpenCode CLI override distribution metadata must include a non-blank ${field}`);
  }
  return value;
};

/**
 * Resolve the runtime identity a managed OpenCode CLI must report.
 *
 * - `overrideDistribution === undefined`: no explicit local override is in
 *   effect, so the immutable lock alone owns the identity (distribution,
 *   version, upstream and fork commits).
 * - `overrideDistribution === null`: an explicit local override was requested
 *   but no staged metadata is present; fail closed.
 * - Otherwise the staged local-override `distribution.json` must be a plain
 *   object whose schema and repository exactly match the lock, carrying
 *   `localOverride: true`, `releaseTag: 'local-override'`, a 64-lowercase-hex
 *   `sha256` of the staged executable, and non-blank version/upstream/fork
 *   commit fields; schema/repository drift, missing, malformed, or mismatched
 *   metadata fails closed.
 */
export const resolveExpectedCliIdentity = (lock, overrideDistribution) => {
  if (overrideDistribution === undefined) {
    return {
      distribution: lock.repository,
      version: lock.version,
      upstreamCommit: lock.upstreamCommit,
      forkCommit: lock.forkCommit,
      localOverride: false,
    };
  }
  if (overrideDistribution === null) {
    throw new Error('Local OpenCode CLI override distribution metadata is missing');
  }
  if (typeof overrideDistribution !== 'object' || Array.isArray(overrideDistribution)) {
    throw new Error('Local OpenCode CLI override distribution metadata is malformed');
  }
  if (overrideDistribution.schema !== lock.schema) {
    throw new Error(`Local OpenCode CLI override distribution schema must be ${lock.schema}`);
  }
  if (overrideDistribution.repository !== lock.repository) {
    throw new Error(`Local OpenCode CLI override distribution repository must be ${lock.repository}`);
  }
  if (overrideDistribution.localOverride !== true) {
    throw new Error('Local OpenCode CLI override distribution is not a local override');
  }
  if (overrideDistribution.releaseTag !== LOCAL_OVERRIDE_TAG) {
    throw new Error(`Local OpenCode CLI override releaseTag must be ${LOCAL_OVERRIDE_TAG}`);
  }
  const sha256 = overrideDistribution.sha256;
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new Error('Local OpenCode CLI override distribution metadata must include a valid SHA256');
  }
  return {
    distribution: lock.repository,
    version: assertNonBlank(overrideDistribution.version, 'version'),
    upstreamCommit: assertNonBlank(overrideDistribution.upstreamCommit, 'upstreamCommit'),
    forkCommit: assertNonBlank(overrideDistribution.forkCommit, 'forkCommit'),
    sha256,
    localOverride: true,
  };
};

const main = async () => {
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

  const explicitOverride = process.env.OPENCHAMBER_OPENCODE_CLI_PATH?.trim();
  let identity;
  if (explicitOverride) {
    const distributionPath = path.join(path.dirname(executable), 'distribution.json');
    let distribution;
    try {
      distribution = JSON.parse(await fs.readFile(distributionPath, 'utf8'));
    } catch (error) {
      throw new Error(
        error?.code === 'ENOENT'
          ? `Local OpenCode CLI override distribution metadata not found: ${distributionPath}`
          : `Local OpenCode CLI override distribution metadata is malformed: ${distributionPath}`,
      );
    }
    identity = resolveExpectedCliIdentity(lock, distribution);
  } else {
    identity = resolveExpectedCliIdentity(lock);
  }

  if (identity.localOverride) {
    const actualSha256 = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    if (actualSha256 !== identity.sha256) {
      throw new Error(
        `Local OpenCode CLI override SHA256 mismatch for ${executable}: expected ${identity.sha256}, got ${actualSha256}`,
      );
    }
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-opencode-runtime-'));
  const openCodeConfig = path.join(temporaryRoot, 'opencode-config');
  const xdgConfig = path.join(temporaryRoot, 'xdg-config');
  const xdgData = path.join(temporaryRoot, 'xdg-data');
  const xdgState = path.join(temporaryRoot, 'xdg-state');
  const xdgCache = path.join(temporaryRoot, 'xdg-cache');
  const toolDirectory = path.join(openCodeConfig, 'tools');
  await Promise.all([
    fs.mkdir(toolDirectory, { recursive: true }),
    fs.mkdir(xdgConfig, { recursive: true }),
    fs.mkdir(xdgData, { recursive: true }),
    fs.mkdir(xdgState, { recursive: true }),
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
      XDG_STATE_HOME: xdgState,
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
    assert.equal(capabilities.payload.distribution, identity.distribution);
    assert.equal(capabilities.payload.version, identity.version);
    assert.equal(capabilities.payload.upstreamCommit, identity.upstreamCommit);
    assert.equal(capabilities.payload.forkCommit, identity.forkCommit);
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
      upstreamCommit: capabilities.payload.upstreamCommit,
      forkCommit: capabilities.payload.forkCommit,
      sha256: identity.sha256,
      localOverride: identity.localOverride,
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
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
