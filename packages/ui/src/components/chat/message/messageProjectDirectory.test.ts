import { describe, expect, test } from 'bun:test';

import { resolveMessageProjectDirectory } from './messageProjectDirectory';

describe('resolveMessageProjectDirectory', () => {
  test('prefers the repository root over a sandbox or worktree cwd', () => {
    expect(resolveMessageProjectDirectory({
      path: { cwd: '/work/repo/.worktrees/feature', root: '/work/repo' },
    })).toBe('/work/repo');
  });

  test('uses cwd for global or non-git sessions whose root is filesystem root', () => {
    expect(resolveMessageProjectDirectory({
      path: { cwd: '/work/standalone', root: '/' },
    })).toBe('/work/standalone');
  });

  test('rejects missing and non-string paths', () => {
    expect(resolveMessageProjectDirectory({ path: { cwd: 42 } })).toBe(undefined);
    expect(resolveMessageProjectDirectory(null)).toBe(undefined);
  });
});
