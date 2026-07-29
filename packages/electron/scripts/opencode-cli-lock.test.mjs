import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactForTarget,
  readOpenCodeCliLock,
  targetKey,
  validateOpenCodeCliLock,
} from './opencode-cli-lock.mjs';

test('the managed OpenCode lock binds the fork CLI and SDK to one release', () => {
  const lock = readOpenCodeCliLock();
  assert.equal(lock.repository, 'ZunbaRan/opencode');
  assert.equal(lock.releaseTag, `v${lock.version}`);
  assert.equal(lock.sdk.version, lock.version);
  assert.match(lock.sdk.sha256, /^[a-f0-9]{64}$/);

  const expected = [
    ['darwin', 'arm64', 'opencode-darwin-arm64.zip'],
    ['darwin', 'x64', 'opencode-darwin-x64.zip'],
    ['win32', 'arm64', 'opencode-windows-arm64.zip'],
    ['win32', 'x64', 'opencode-windows-x64.zip'],
    ['linux', 'arm64', 'opencode-linux-arm64.tar.gz'],
    ['linux', 'x64', 'opencode-linux-x64.tar.gz'],
  ];
  for (const [platform, arch, file] of expected) {
    const artifact = artifactForTarget(lock, platform, arch);
    assert.equal(artifact.key, targetKey(platform, arch));
    assert.equal(artifact.file, file);
    assert.equal(
      artifact.url,
      `https://github.com/ZunbaRan/opencode/releases/download/${lock.releaseTag}/${file}`,
    );
  }
});

test('lock validation rejects SDK/CLI version drift and non-fork artifact URLs', () => {
  const lock = structuredClone(readOpenCodeCliLock());
  lock.sdk.version = '1.18.9-oc.999';
  assert.throws(
    () => validateOpenCodeCliLock(lock, 'fixture'),
    /SDK lock must match CLI version/,
  );

  const unsafe = structuredClone(readOpenCodeCliLock());
  unsafe.artifacts['darwin-arm64'].url = 'https://github.com/anomalyco/opencode/releases/download/v1.18.9/opencode-darwin-arm64.zip';
  assert.throws(
    () => validateOpenCodeCliLock(unsafe, 'fixture'),
    /artifact URL is not bound/,
  );
});
