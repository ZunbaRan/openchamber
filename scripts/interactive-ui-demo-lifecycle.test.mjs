import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandRunsDemo,
  descendantsOf,
  parseProcessTable,
  projectRoot,
} from './lib/interactive-ui-demo-lifecycle.mjs';

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
