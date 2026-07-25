import { describe, expect, test } from 'bun:test';
import {
  clampWorkbenchLayout,
  compactWorkbenchLayouts,
  findNearestWorkbenchSlot,
  getWorkbenchGridHeight,
  layoutsOverlap,
} from './workbench-layout';

describe('Extension Workbench layout', () => {
  test('defaults to two tiles per 12-column row', () => {
    expect(clampWorkbenchLayout({})).toEqual({
      column: 0,
      row: 0,
      columns: 6,
      rows: 4,
    });
  });

  test('clamps layouts to their declared bounds and the 12-column board', () => {
    expect(clampWorkbenchLayout(
      { column: 11, row: -3, columns: 20, rows: 1 },
      { minColumns: 4, maxColumns: 8, minRows: 3, maxRows: 7 },
    )).toEqual({
      column: 4,
      row: 0,
      columns: 8,
      rows: 3,
    });
  });

  test('detects real rectangle overlap but not touching edges', () => {
    const left = { column: 0, row: 0, columns: 6, rows: 4 };
    expect(layoutsOverlap(left, { column: 5, row: 3, columns: 3, rows: 2 })).toBe(true);
    expect(layoutsOverlap(left, { column: 6, row: 0, columns: 6, rows: 4 })).toBe(false);
  });

  test('places the second default tile beside the first and the third below', () => {
    const first = { column: 0, row: 0, columns: 6, rows: 4 };
    const second = findNearestWorkbenchSlot({ columns: 6, rows: 4 }, [first], { column: 6, row: 0 });
    const third = findNearestWorkbenchSlot({ columns: 6, rows: 4 }, [first, second], { column: 0, row: 0 });
    expect(second).toEqual({ column: 6, row: 0, columns: 6, rows: 4 });
    expect(third).toEqual({ column: 0, row: 4, columns: 6, rows: 4 });
  });

  test('honors an empty preferred adjacent slot instead of snapping to column zero', () => {
    expect(findNearestWorkbenchSlot(
      { columns: 6, rows: 5 },
      [],
      { column: 6, row: 0 },
    )).toEqual({
      column: 6,
      row: 0,
      columns: 6,
      rows: 5,
    });
  });

  test('compacts invalid overlapping persisted layouts deterministically', () => {
    const layouts = compactWorkbenchLayouts([
      { tileId: 'one', layout: { column: 0, row: 0, columns: 6, rows: 4 } },
      { tileId: 'two', layout: { column: 0, row: 0, columns: 6, rows: 4 } },
      { tileId: 'three', layout: { column: 0, row: 0, columns: 6, rows: 4 } },
    ]);
    expect(layouts.get('one')).toEqual({ column: 0, row: 0, columns: 6, rows: 4 });
    expect(layouts.get('two')).toEqual({ column: 6, row: 0, columns: 6, rows: 4 });
    expect(layouts.get('three')).toEqual({ column: 0, row: 4, columns: 6, rows: 4 });
    expect(getWorkbenchGridHeight(layouts.values(), 48, 12)).toBe(468);
  });
});
