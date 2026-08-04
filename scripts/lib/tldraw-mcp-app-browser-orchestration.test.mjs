import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACCEPTANCE_MCP_SERVER_NAME,
  ACCEPTANCE_OPENCODE_CLI_PATH_ENV,
  acceptanceOpenCodeCliStagedPath,
  assessAcceptanceOpenCodeCliMismatch,
  buildAcceptanceMcpConfigContent,
  captureSpawnedProcessEvidence,
  readAcceptanceOpenCodeCliVersion,
  selectAcceptanceOpenCodeCliPath,
  validateAcceptanceMcpUrl,
} from './tldraw-mcp-app-browser-orchestration.mjs';

const makeFixtureRoot = async () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'openchamber-cli-selection-'));

const makeExecutable = async (filePath, { mode = 0o755, content = '#!/bin/sh\n' } = {}) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
  await fs.promises.chmod(filePath, mode);
  return filePath;
};

test('explicit selection honors OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH and canonicalizes it', async () => {
  const root = await makeFixtureRoot();
  try {
    const real = await makeExecutable(path.join(root, 'explicit', 'opencode'));
    const link = path.join(root, 'link', 'opencode');
    await fs.promises.mkdir(path.dirname(link), { recursive: true });
    await fs.promises.symlink(real, link);

    const selection = await selectAcceptanceOpenCodeCliPath({
      projectRoot: root,
      env: { [ACCEPTANCE_OPENCODE_CLI_PATH_ENV]: link },
    });
    assert.equal(selection.source, 'explicit');
    assert.equal(selection.requested, link);
    assert.equal(selection.resolved, fs.realpathSync(real));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('staged default resolves packages/electron/resources/opencode-cli under the project root', async () => {
  const root = await makeFixtureRoot();
  try {
    const staged = await makeExecutable(acceptanceOpenCodeCliStagedPath(root));
    const selection = await selectAcceptanceOpenCodeCliPath({ projectRoot: root, env: {} });
    assert.equal(selection.source, 'staged-default');
    assert.equal(selection.requested, acceptanceOpenCodeCliStagedPath(root));
    assert.equal(selection.resolved, fs.realpathSync(staged));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('missing explicit path fails closed with an actionable message naming the env variable', async () => {
  const root = await makeFixtureRoot();
  try {
    const missing = path.join(root, 'no-such-opencode');
    await assert.rejects(
      selectAcceptanceOpenCodeCliPath({ projectRoot: root, env: { [ACCEPTANCE_OPENCODE_CLI_PATH_ENV]: missing } }),
      (error) => (
        /is missing/.test(error.message)
        && error.message.includes(missing)
        && error.message.includes(ACCEPTANCE_OPENCODE_CLI_PATH_ENV)
        && /fails closed/.test(error.message)
      ),
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('missing staged default fails closed with the staged path in the message', async () => {
  const root = await makeFixtureRoot();
  try {
    await assert.rejects(
      selectAcceptanceOpenCodeCliPath({ projectRoot: root, env: {} }),
      (error) => (
        error.message.includes(acceptanceOpenCodeCliStagedPath(root))
        && error.message.includes(ACCEPTANCE_OPENCODE_CLI_PATH_ENV)
      ),
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('a directory is rejected as not a file', async () => {
  const root = await makeFixtureRoot();
  try {
    await assert.rejects(
      selectAcceptanceOpenCodeCliPath({ projectRoot: root, env: { [ACCEPTANCE_OPENCODE_CLI_PATH_ENV]: root } }),
      /is not a file/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('a non-executable file is rejected on non-Windows platforms', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await makeFixtureRoot();
  try {
    const filePath = await makeExecutable(path.join(root, 'opencode'), { mode: 0o644 });
    await assert.rejects(
      selectAcceptanceOpenCodeCliPath({ projectRoot: root, env: { [ACCEPTANCE_OPENCODE_CLI_PATH_ENV]: filePath } }),
      /is not executable/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('empty explicit value falls back to the staged default', async () => {
  const root = await makeFixtureRoot();
  try {
    const staged = await makeExecutable(acceptanceOpenCodeCliStagedPath(root));
    const selection = await selectAcceptanceOpenCodeCliPath({
      projectRoot: root,
      env: { [ACCEPTANCE_OPENCODE_CLI_PATH_ENV]: '   ' },
    });
    assert.equal(selection.source, 'staged-default');
    assert.equal(selection.resolved, fs.realpathSync(staged));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('mismatch assessment accepts the exact selected canonical path', () => {
  assert.deepEqual(assessAcceptanceOpenCodeCliMismatch({
    selectedPath: '/acceptance/opencode',
    reportedPath: '/acceptance/opencode',
  }), { match: true, reason: null });
  assert.deepEqual(assessAcceptanceOpenCodeCliMismatch({
    selectedPath: '/acceptance/../acceptance/opencode',
    reportedPath: '/acceptance/opencode',
  }), { match: true, reason: null });
});

test('mismatch assessment is fatal for a different or unreported resolved path', () => {
  const different = assessAcceptanceOpenCodeCliMismatch({
    selectedPath: '/acceptance/staged/opencode',
    reportedPath: '/Users/me/.opencode/bin/opencode',
  });
  assert.equal(different.match, false);
  assert.match(different.reason, /reports opencodeBinaryResolved/);
  assert.match(different.reason, /selected/);

  for (const reportedPath of [null, undefined, '', '   ']) {
    const verdict = assessAcceptanceOpenCodeCliMismatch({
      selectedPath: '/acceptance/opencode',
      reportedPath,
    });
    assert.equal(verdict.match, false, JSON.stringify(reportedPath));
    assert.match(verdict.reason, /did not report opencodeBinaryResolved/);
  }
});

test('version identity is recorded from the first --version token', async () => {
  // process.execPath (node) supports --version, giving a real executable run.
  const version = await readAcceptanceOpenCodeCliVersion({ cliPath: process.execPath });
  assert.match(version, /^v?\d/);
});

test('process evidence captures role, pid, and spawnedAt for a spawned child', async () => {
  const child = spawn(process.execPath, ['--version'], { stdio: 'ignore' });
  child.spawnedAt = '2026-08-05T01:08:00.000Z';
  const evidence = captureSpawnedProcessEvidence(child, 'tldraw-mcp');
  assert.equal(evidence.role, 'tldraw-mcp');
  assert.ok(Number.isSafeInteger(evidence.pid) && evidence.pid > 0);
  assert.equal(evidence.spawnedAt, '2026-08-05T01:08:00.000Z');
  await new Promise((resolve) => child.once('exit', resolve));
});

test('process evidence is null when the child was never spawned', () => {
  assert.equal(captureSpawnedProcessEvidence(null, 'tldraw-mcp'), null);
  assert.equal(captureSpawnedProcessEvidence(undefined, 'openchamber-demo'), null);
  assert.equal(captureSpawnedProcessEvidence({}, 'browser-verifier'), null);
});

test('MCP config content is deterministic and names exactly the interop-tldraw-2026 remote server', () => {
  const url = 'http://127.0.0.1:39512/mcp';
  const expected = JSON.stringify({
    mcp: {
      [ACCEPTANCE_MCP_SERVER_NAME]: {
        type: 'remote',
        url,
        oauth: false,
        timeout: 30000,
        enabled: true,
      },
    },
  }, null, 2);
  assert.equal(buildAcceptanceMcpConfigContent({ mcpUrl: url }), expected);
  assert.equal(buildAcceptanceMcpConfigContent({ mcpUrl: url }), expected); // deterministic across calls
});

test('MCP config content parses to one server with the exact fork schema fields', () => {
  const parsed = JSON.parse(buildAcceptanceMcpConfigContent({ mcpUrl: 'https://example.com/mcp' }));
  assert.deepEqual(Object.keys(parsed.mcp), [ACCEPTANCE_MCP_SERVER_NAME]);
  assert.deepEqual(parsed.mcp[ACCEPTANCE_MCP_SERVER_NAME], {
    type: 'remote',
    url: 'https://example.com/mcp',
    oauth: false,
    timeout: 30000,
    enabled: true,
  });
});

test('MCP config URL validation accepts http(s) and rejects invalid or other schemes', () => {
  assert.equal(validateAcceptanceMcpUrl('http://127.0.0.1:1/mcp'), 'http://127.0.0.1:1/mcp');
  assert.equal(validateAcceptanceMcpUrl(' https://example.com/mcp '), 'https://example.com/mcp');
  for (const bad of [
    'ws://127.0.0.1:1/mcp',
    'file:///tmp/mcp',
    'ftp://example.com/mcp',
    'not a url',
    '',
    '   ',
    null,
    undefined,
    42,
  ]) {
    assert.throws(() => validateAcceptanceMcpUrl(bad), undefined, `validate ${JSON.stringify(bad)}`);
    assert.throws(() => buildAcceptanceMcpConfigContent({ mcpUrl: bad }), undefined, `build ${JSON.stringify(bad)}`);
  }
});
