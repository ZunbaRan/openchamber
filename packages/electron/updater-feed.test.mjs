import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLoopbackUpdaterUrl,
  resolveUpdaterFeed,
} from './updater-feed.mjs';

const overrideEnvironment = {
  OPENCHAMBER_E2E: '1',
  OPENCHAMBER_UPDATER_E2E_URL: 'http://127.0.0.1:49152/updates/',
};

test('production and incomplete E2E builds have no updater feed', () => {
  const cases = [
    {},
    { environment: overrideEnvironment },
    { environment: { OPENCHAMBER_E2E: '1' }, testBuild: true },
    {
      environment: { OPENCHAMBER_UPDATER_E2E_URL: overrideEnvironment.OPENCHAMBER_UPDATER_E2E_URL },
      testBuild: true,
    },
    { environment: overrideEnvironment, testBuild: false },
  ];
  for (const input of cases) assert.equal(resolveUpdaterFeed(input), null);
});

test('accepts only credential-free loopback HTTP(S) URLs', () => {
  assert.equal(parseLoopbackUpdaterUrl('http://127.0.0.1:8080/feed'), 'http://127.0.0.1:8080/feed');
  assert.equal(parseLoopbackUpdaterUrl('https://127.255.0.1/feed/'), 'https://127.255.0.1/feed/');
  assert.equal(parseLoopbackUpdaterUrl('http://[::1]:8080/feed'), 'http://[::1]:8080/feed');

  for (const value of [
    'http://localhost:8080/feed',
    'http://0.0.0.0:8080/feed',
    'http://192.168.1.5:8080/feed',
    'https://example.com/feed',
    'file:///tmp/feed',
    'ftp://127.0.0.1/feed',
    'http://user:secret@127.0.0.1/feed',
    'http://127.0.0.1/feed?token=secret',
    'http://127.0.0.1/feed#fragment',
    'not-a-url',
  ]) assert.equal(parseLoopbackUpdaterUrl(value), null, value);
});

test('uses a generic feed only when every test-only gate is valid', () => {
  assert.deepEqual(resolveUpdaterFeed({
    environment: overrideEnvironment,
    testBuild: true,
  }), {
    provider: 'generic',
    url: 'http://127.0.0.1:49152/updates/',
  });
});

test('invalid E2E URLs do not fall back to an external feed', () => {
  for (const url of ['https://example.com/feed', 'http://localhost/feed', '']) {
    assert.equal(resolveUpdaterFeed({
      environment: { ...overrideEnvironment, OPENCHAMBER_UPDATER_E2E_URL: url },
      testBuild: true,
    }), null);
  }
});
