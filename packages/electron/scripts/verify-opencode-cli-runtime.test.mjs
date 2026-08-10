import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenCodeCliLock } from './opencode-cli-lock.mjs';
import { resolveExpectedCliIdentity } from './verify-opencode-cli-runtime.mjs';

const lock = readOpenCodeCliLock();

const validOverride = {
  schema: lock.schema,
  repository: lock.repository,
  releaseTag: 'local-override',
  version: lock.version,
  upstreamCommit: lock.upstreamCommit,
  forkCommit: 'local-uncommitted',
  target: 'linux-x64',
  sha256: 'a'.repeat(64),
  localOverride: true,
};

test('without an explicit override the runtime identity is exactly the immutable lock', () => {
  assert.deepEqual(resolveExpectedCliIdentity(lock), {
    distribution: lock.repository,
    version: lock.version,
    upstreamCommit: lock.upstreamCommit,
    forkCommit: lock.forkCommit,
    localOverride: false,
  });
});

test('a valid staged local-override distribution.json supplies the runtime identity', () => {
  assert.deepEqual(resolveExpectedCliIdentity(lock, validOverride), {
    distribution: lock.repository,
    version: lock.version,
    upstreamCommit: lock.upstreamCommit,
    forkCommit: 'local-uncommitted',
    sha256: validOverride.sha256,
    localOverride: true,
  });
});

test('missing local-override metadata fails closed', () => {
  assert.throws(() => resolveExpectedCliIdentity(lock, null), /metadata is missing/);
});

test('malformed local-override metadata fails closed', () => {
  assert.throws(() => resolveExpectedCliIdentity(lock, 'not json'), /metadata is malformed/);
  assert.throws(() => resolveExpectedCliIdentity(lock, ['local-override']), /metadata is malformed/);
});

test('schema drift in local-override metadata fails closed', () => {
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, schema: 'com.other.schema.v1' }),
    /distribution schema must be/,
  );
});

test('repository drift in local-override metadata fails closed', () => {
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, repository: 'anomalyco/opencode' }),
    /distribution repository must be/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, repository: '' }),
    /distribution repository must be/,
  );
});

test('missing or malformed sha256 in local-override metadata fails closed', () => {
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, sha256: undefined }),
    /valid SHA256/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, sha256: 'a'.repeat(63) }),
    /valid SHA256/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, sha256: 'A'.repeat(64) }),
    /valid SHA256/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, sha256: 'z'.repeat(64) }),
    /valid SHA256/,
  );
});

test('mismatched local-override metadata fails closed', () => {
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, localOverride: false }),
    /not a local override/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, releaseTag: 'v1.18.10-oc.1' }),
    /releaseTag must be local-override/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, version: ' ' }),
    /non-blank version/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, upstreamCommit: undefined }),
    /non-blank upstreamCommit/,
  );
  assert.throws(
    () => resolveExpectedCliIdentity(lock, { ...validOverride, forkCommit: 'a b' }),
    /non-blank forkCommit/,
  );
});
