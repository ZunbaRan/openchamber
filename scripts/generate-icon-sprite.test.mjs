import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generator = path.join(repoRoot, 'scripts', 'generate-icon-sprite.mjs');
const sprite = path.join(repoRoot, 'packages', 'ui', 'src', 'components', 'icon', 'sprite.ts');
const declarativeView = path.join(
  repoRoot,
  'packages',
  'ui',
  'src',
  'components',
  'interactive-ui',
  'DeclarativeInteractiveView.tsx',
);

const runGenerator = () => {
  const result = spawnSync(process.execPath, [generator], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
};

const roundedOverrideNames = [
  'apps-2-ai',
  'archive',
  'arrows-merge',
  'calendar-schedule',
  'chat-4',
  'chat-new',
  'checkbox-multiple',
  'donut-chart-fill',
  'equalizer-2',
  'file-text',
  'folder-3',
  'folder-add',
  'git-branch',
  'git-pull-request',
  'global',
  'layout-left',
  'layout-right',
  'route',
  'search',
  'server',
  'sticky-note',
  'terminal-box',
];

test('icon generation retains literals from a nested Icon name expression', () => {
  const original = fs.readFileSync(sprite, 'utf8');
  const consumer = fs.readFileSync(declarativeView, 'utf8');
  assert.match(
    consumer,
    /name=\{[^}]*\?[^}]*'arrow-up'[^}]*'arrow-down'[^}]*'sort-desc'[^}]*\}/s,
    'fixture must exercise a nested JSX name expression',
  );

  try {
    runGenerator();
    const first = fs.readFileSync(sprite, 'utf8');
    for (const name of roundedOverrideNames) {
      const entryPattern = new RegExp('^  "' + name + '": ', 'gm');
      assert.equal(
        [...first.matchAll(entryPattern)].length,
        1,
        `${name} must have exactly one generated sprite entry`,
      );
      assert.match(
        first,
        new RegExp(
          '^  "' + name + '": `<g fill="none" stroke="currentColor" stroke-width="1\\.75" stroke-linecap="round" stroke-linejoin="round">',
          'm',
        ),
      );
    }
    assert.match(first, /^  "sort-desc": `<path /m);

    runGenerator();
    const second = fs.readFileSync(sprite, 'utf8');
    assert.equal(second, first, 'a second generator run must be byte-identical');
    assert.equal(second, original, 'checked-in sprite must already match generated output');
  } finally {
    fs.writeFileSync(sprite, original);
  }
});
