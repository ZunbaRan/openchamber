import { describe, expect, test } from 'bun:test';

import { areRenderRelevantMessagesEqual } from './renderCompare';

const record = (path: { cwd: string; root: string }) => ({
  info: {
    id: 'message-1',
    role: 'assistant',
    sessionID: 'session-1',
    path,
    time: { created: 1, completed: 2 },
  },
  parts: [],
}) as unknown as Parameters<typeof areRenderRelevantMessagesEqual>[0];

describe('message render comparison', () => {
  test('invalidates cached message rendering when the owning project path changes', () => {
    expect(areRenderRelevantMessagesEqual(
      record({ cwd: '/work/repo-a', root: '/work/repo-a' }),
      record({ cwd: '/work/repo-b', root: '/work/repo-b' }),
    )).toBe(false);
  });

  test('retains the fast path when cwd and root are unchanged', () => {
    expect(areRenderRelevantMessagesEqual(
      record({ cwd: '/work/repo', root: '/work/repo' }),
      record({ cwd: '/work/repo', root: '/work/repo' }),
    )).toBe(true);
  });
});
