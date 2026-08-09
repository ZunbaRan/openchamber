import { afterEach, describe, expect, test } from 'bun:test';
import {
  getWorkbenchPopoutCount,
  releaseWorkbenchPopout,
  reserveWorkbenchPopout,
  resetWorkbenchPopoutsForTests,
  WorkbenchPopoutLimitError,
} from './workbench-popouts';

afterEach(resetWorkbenchPopoutsForTests);

describe('Workbench Popout coordinator', () => {
  test('allows three unique windows and idempotently retains a tile reservation', () => {
    expect(reserveWorkbenchPopout('tile-1')).toBe(true);
    expect(reserveWorkbenchPopout('tile-1')).toBe(false);
    expect(reserveWorkbenchPopout('tile-2')).toBe(true);
    expect(reserveWorkbenchPopout('tile-3')).toBe(true);
    expect(getWorkbenchPopoutCount()).toBe(3);
  });

  test('rejects the fourth window and releases capacity on restore', () => {
    reserveWorkbenchPopout('tile-1');
    reserveWorkbenchPopout('tile-2');
    reserveWorkbenchPopout('tile-3');
    expect(() => reserveWorkbenchPopout('tile-4')).toThrow(WorkbenchPopoutLimitError);
    releaseWorkbenchPopout('tile-2');
    expect(reserveWorkbenchPopout('tile-4')).toBe(true);
  });
});
