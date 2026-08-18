import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureMacosLaunchServicesRegistration,
  resolveContainingAppBundle,
} from './macos-launch-services-registration.mjs';

test('resolves the containing app bundle and rejects executables outside one', () => {
  assert.equal(
    resolveContainingAppBundle('/Applications/OpenChamber.app/Contents/MacOS/OpenChamber'),
    '/Applications/OpenChamber.app',
  );
  assert.equal(resolveContainingAppBundle('/usr/local/bin/openchamber'), null);
});

test('skips development, other platforms, and app bundles outside installed application roots', async () => {
  let calls = 0;
  const runRegistration = async () => { calls += 1; return { ok: true }; };
  const base = {
    platform: 'darwin',
    isPackaged: true,
    execPath: '/Applications/OpenChamber.app/Contents/MacOS/OpenChamber',
    version: '1.18.3',
    userDataPath: '/tmp/openchamber-test-user-data',
    homeDirectory: '/Users/tester',
    readMarker: async () => null,
    writeMarker: async () => {},
    runRegistration,
  };

  assert.equal((await ensureMacosLaunchServicesRegistration({ ...base, platform: 'linux' })).status, 'skipped');
  assert.equal((await ensureMacosLaunchServicesRegistration({ ...base, isPackaged: false })).status, 'skipped');
  assert.equal((await ensureMacosLaunchServicesRegistration({
    ...base,
    execPath: '/Volumes/OpenChamber/OpenChamber.app/Contents/MacOS/OpenChamber',
  })).status, 'skipped');
  assert.equal(calls, 0);
});

test('registers once for an installed version and path, then uses the success marker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-ls-registration-'));
  const calls = [];
  const input = {
    platform: 'darwin',
    isPackaged: true,
    execPath: '/Applications/OpenChamber.app/Contents/MacOS/OpenChamber',
    version: '1.18.3',
    userDataPath: root,
    homeDirectory: '/Users/tester',
    runRegistration: async (appPath) => {
      calls.push(appPath);
      return { ok: true };
    },
  };

  try {
    assert.equal((await ensureMacosLaunchServicesRegistration(input)).status, 'registered');
    assert.equal((await ensureMacosLaunchServicesRegistration(input)).status, 'already-registered');
    assert.deepEqual(calls, ['/Applications/OpenChamber.app']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('does not persist a failed registration and retries on the next launch', async () => {
  let calls = 0;
  let marker = null;
  const input = {
    platform: 'darwin',
    isPackaged: true,
    execPath: '/Applications/OpenChamber.app/Contents/MacOS/OpenChamber',
    version: '1.18.3',
    userDataPath: '/tmp/openchamber-test-user-data',
    homeDirectory: '/Users/tester',
    readMarker: async () => marker,
    writeMarker: async (value) => { marker = value; },
    runRegistration: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, error: 'temporary failure' } : { ok: true };
    },
  };

  const failed = await ensureMacosLaunchServicesRegistration(input);
  assert.equal(failed.status, 'failed');
  assert.equal(marker, null);
  assert.equal((await ensureMacosLaunchServicesRegistration(input)).status, 'registered');
  assert.equal(calls, 2);
});

test('a version or installation-path change requires a fresh registration', async () => {
  let marker = {
    schemaVersion: 1,
    appPath: '/Applications/OpenChamber.app',
    version: '1.18.2',
  };
  let calls = 0;
  const result = await ensureMacosLaunchServicesRegistration({
    platform: 'darwin',
    isPackaged: true,
    execPath: '/Users/tester/Applications/OpenChamber.app/Contents/MacOS/OpenChamber',
    version: '1.18.3',
    userDataPath: '/tmp/openchamber-test-user-data',
    homeDirectory: '/Users/tester',
    readMarker: async () => marker,
    writeMarker: async (value) => { marker = value; },
    runRegistration: async () => { calls += 1; return { ok: true }; },
  });

  assert.equal(result.status, 'registered');
  assert.equal(calls, 1);
  assert.equal(marker.appPath, '/Users/tester/Applications/OpenChamber.app');
  assert.equal(marker.version, '1.18.3');
});
