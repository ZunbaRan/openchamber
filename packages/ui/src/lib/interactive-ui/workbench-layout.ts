import type {
  WorkbenchTile,
  WorkbenchTileLayout,
} from './workbench';

export const WORKBENCH_GRID_COLUMNS = 12;
export const WORKBENCH_DEFAULT_COLUMNS = 6;
export const WORKBENCH_DEFAULT_ROWS = 4;
export const WORKBENCH_MIN_COLUMNS = 2;
export const WORKBENCH_MIN_ROWS = 2;
export const WORKBENCH_MAX_ROWS = 24;

type LayoutBounds = {
  minColumns?: number;
  maxColumns?: number;
  minRows?: number;
  maxRows?: number;
};

const integer = (value: number, fallback: number): number => (
  Number.isFinite(value) ? Math.round(value) : fallback
);

export const clampWorkbenchLayout = (
  layout: Partial<WorkbenchTileLayout>,
  bounds: LayoutBounds = {},
): WorkbenchTileLayout => {
  const minColumns = Math.max(1, integer(bounds.minColumns ?? WORKBENCH_MIN_COLUMNS, WORKBENCH_MIN_COLUMNS));
  const maxColumns = Math.min(
    WORKBENCH_GRID_COLUMNS,
    Math.max(minColumns, integer(bounds.maxColumns ?? WORKBENCH_GRID_COLUMNS, WORKBENCH_GRID_COLUMNS)),
  );
  const minRows = Math.max(1, integer(bounds.minRows ?? WORKBENCH_MIN_ROWS, WORKBENCH_MIN_ROWS));
  const maxRows = Math.max(minRows, integer(bounds.maxRows ?? WORKBENCH_MAX_ROWS, WORKBENCH_MAX_ROWS));
  const columns = Math.min(
    maxColumns,
    Math.max(minColumns, integer(layout.columns ?? WORKBENCH_DEFAULT_COLUMNS, WORKBENCH_DEFAULT_COLUMNS)),
  );
  const rows = Math.min(
    maxRows,
    Math.max(minRows, integer(layout.rows ?? WORKBENCH_DEFAULT_ROWS, WORKBENCH_DEFAULT_ROWS)),
  );
  const column = Math.min(
    WORKBENCH_GRID_COLUMNS - columns,
    Math.max(0, integer(layout.column ?? 0, 0)),
  );
  const row = Math.max(0, integer(layout.row ?? 0, 0));

  return { column, row, columns, rows };
};

export const layoutsOverlap = (
  left: WorkbenchTileLayout,
  right: WorkbenchTileLayout,
): boolean => (
  left.column < right.column + right.columns
  && left.column + left.columns > right.column
  && left.row < right.row + right.rows
  && left.row + left.rows > right.row
);

const isVacant = (
  candidate: WorkbenchTileLayout,
  occupied: WorkbenchTileLayout[],
): boolean => occupied.every((entry) => !layoutsOverlap(candidate, entry));

export const findNearestWorkbenchSlot = (
  size: Pick<WorkbenchTileLayout, 'columns' | 'rows'>,
  occupied: WorkbenchTileLayout[],
  preferred?: Pick<WorkbenchTileLayout, 'column' | 'row'>,
): WorkbenchTileLayout => {
  const normalized = clampWorkbenchLayout({
    column: preferred?.column ?? 0,
    row: preferred?.row ?? 0,
    columns: size.columns,
    rows: size.rows,
  });
  const preferredRow = normalized.row;
  const preferredColumn = normalized.column;
  if (isVacant(normalized, occupied)) return normalized;

  for (let radius = 0; radius <= WORKBENCH_MAX_ROWS * 4; radius += 1) {
    const minRow = Math.max(0, preferredRow - radius);
    const maxRow = preferredRow + radius;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = 0; column <= WORKBENCH_GRID_COLUMNS - normalized.columns; column += 1) {
        if (radius > 0
          && Math.abs(row - preferredRow) + Math.abs(column - preferredColumn) > radius) {
          continue;
        }
        const candidate = { ...normalized, column, row };
        if (isVacant(candidate, occupied)) return candidate;
      }
    }
  }

  const lastRow = occupied.reduce(
    (maximum, entry) => Math.max(maximum, entry.row + entry.rows),
    0,
  );
  return { ...normalized, column: 0, row: lastRow };
};

export const compactWorkbenchLayouts = (
  tiles: Array<Pick<WorkbenchTile, 'tileId' | 'layout'>>,
): Map<string, WorkbenchTileLayout> => {
  const placed: WorkbenchTileLayout[] = [];
  const result = new Map<string, WorkbenchTileLayout>();

  for (const tile of tiles) {
    const normalized = clampWorkbenchLayout(tile.layout);
    const next = findNearestWorkbenchSlot(
      normalized,
      placed,
      { column: normalized.column, row: normalized.row },
    );
    placed.push(next);
    result.set(tile.tileId, next);
  }

  return result;
};

export const planWorkbenchTileSwap = (
  active: WorkbenchTileLayout,
  target: WorkbenchTileLayout,
  occupied: WorkbenchTileLayout[],
): { active: WorkbenchTileLayout; target: WorkbenchTileLayout } => {
  const normalizedActive = clampWorkbenchLayout(active);
  const normalizedTarget = clampWorkbenchLayout(target);
  if (normalizedActive.columns === normalizedTarget.columns
    && normalizedActive.rows === normalizedTarget.rows) {
    return {
      active: {
        ...normalizedActive,
        column: normalizedTarget.column,
        row: normalizedTarget.row,
      },
      target: {
        ...normalizedTarget,
        column: normalizedActive.column,
        row: normalizedActive.row,
      },
    };
  }

  const nextActive = findNearestWorkbenchSlot(
    normalizedActive,
    occupied,
    { column: normalizedTarget.column, row: normalizedTarget.row },
  );
  const nextTarget = findNearestWorkbenchSlot(
    normalizedTarget,
    [...occupied, nextActive],
    { column: normalizedActive.column, row: normalizedActive.row },
  );
  return { active: nextActive, target: nextTarget };
};

export const getWorkbenchGridHeight = (
  layouts: Iterable<WorkbenchTileLayout>,
  rowHeight: number,
  gap: number,
): number => {
  let rows = 1;
  for (const layout of layouts) {
    rows = Math.max(rows, layout.row + layout.rows);
  }
  return rows * rowHeight + Math.max(0, rows - 1) * gap;
};
