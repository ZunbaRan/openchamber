import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bundledOpenCodeBinaryPath,
  commandRunsDemo,
  configureDemoOpenCodeBinary,
  descendantsOf,
  parseProcessTable,
  projectRoot,
} from './lib/interactive-ui-demo-lifecycle.mjs';

test('demo selects the bundled OpenChamber fork unless an explicit CLI override exists', () => {
  const explicit = { OPENCODE_BINARY: '/custom/opencode' };
  assert.deepEqual(configureDemoOpenCodeBinary({ env: explicit }), {
    source: 'environment',
    envName: 'OPENCODE_BINARY',
    path: '/custom/opencode',
  });

  const bundled = {};
  const expected = bundledOpenCodeBinaryPath();
  assert.deepEqual(configureDemoOpenCodeBinary({ env: bundled }), {
    source: 'bundled-fork',
    envName: 'OPENCODE_BINARY',
    path: expected,
  });
  assert.equal(bundled.OPENCODE_BINARY, expected);
});

test('demo preserves every supported external CLI override without replacing it', () => {
  for (const envName of [
    'OPENCODE_PATH',
    'OPENCHAMBER_OPENCODE_PATH',
    'OPENCHAMBER_OPENCODE_BIN',
  ]) {
    const env = { [envName]: `/custom/${envName.toLowerCase()}` };
    const selected = configureDemoOpenCodeBinary({ env });
    assert.equal(selected.source, 'environment');
    assert.equal(selected.envName, envName);
    assert.equal(selected.path, env[envName]);
    assert.equal(env.OPENCODE_BINARY, undefined);
  }
});

test('parseProcessTable preserves process tree identity and commands', () => {
  const table = parseProcessTable(`
  101  10  101 node ${projectRoot}/scripts/interactive-ui-demo.mjs --managed-demo-token=abc
  102 101  102 opencode serve --port 4096
`);

  assert.deepEqual(table, [
    {
      pid: 101,
      parentPid: 10,
      processGroupId: 101,
      command: `node ${projectRoot}/scripts/interactive-ui-demo.mjs --managed-demo-token=abc`,
    },
    {
      pid: 102,
      parentPid: 101,
      processGroupId: 102,
      command: 'opencode serve --port 4096',
    },
  ]);
});

test('commandRunsDemo only accepts the Interactive UI demo entrypoint', () => {
  assert.equal(commandRunsDemo(`node ${projectRoot}/scripts/interactive-ui-demo.mjs`), true);
  assert.equal(commandRunsDemo('node scripts/interactive-ui-demo.mjs'), true);
  assert.equal(commandRunsDemo('node --inspect scripts/interactive-ui-demo.mjs'), true);
  assert.equal(commandRunsDemo('zsh -c "node --check scripts/interactive-ui-demo.mjs && bun run demo:interactive-ui:stop"'), false);
  assert.equal(commandRunsDemo('node scripts/interactive-ui-demo-stop.mjs'), false);
  assert.equal(commandRunsDemo('node packages/web/server/index.js'), false);
});

test('descendantsOf returns all descendants without including siblings', () => {
  const table = [
    { pid: 2, parentPid: 1 },
    { pid: 3, parentPid: 2 },
    { pid: 4, parentPid: 1 },
    { pid: 5, parentPid: 3 },
  ];

  assert.deepEqual(descendantsOf(2, table).map((entry) => entry.pid), [3, 5]);
});
