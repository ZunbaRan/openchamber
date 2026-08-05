import { describe, expect, test } from 'bun:test';

import { resolveWorkbenchPinProject } from './workbenchPinProject';

const projects = [
  { id: 'home', path: '/Users/example' },
  { id: 'workspace', path: '/Users/example/openchamber' },
];

describe('resolveWorkbenchPinProject', () => {
  test('pins a conversation surface to its owning project before the active project', () => {
    expect(resolveWorkbenchPinProject(
      projects,
      'home',
      '/Users/example/openchamber/',
    )).toEqual(projects[1]);
  });

  test('normalizes Windows separators when matching the owning project', () => {
    expect(resolveWorkbenchPinProject(
      [{ id: 'workspace', path: 'C:/work/openchamber' }],
      null,
      'C:\\work\\openchamber\\',
    )).toEqual({ id: 'workspace', path: 'C:/work/openchamber' });
  });

  test('uses the nearest registered ancestor when the exact worktree is not registered', () => {
    expect(resolveWorkbenchPinProject(
      projects,
      'home',
      '/Users/example/openchamber/.worktrees/feature-a',
    )).toEqual(projects[1]);
  });

  test('fails closed instead of pinning an authoritative directory into an unrelated active project', () => {
    expect(resolveWorkbenchPinProject(projects, 'home', '/tmp/unknown')).toBeNull();
  });
});
