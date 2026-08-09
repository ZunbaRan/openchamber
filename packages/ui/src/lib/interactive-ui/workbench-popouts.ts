const MAX_WORKBENCH_POPOUTS = 3;
const reservations = new Set<string>();

export class WorkbenchPopoutLimitError extends Error {
  readonly code = 'workbench_popout_limit';

  constructor() {
    super(`Extension Workbench supports at most ${MAX_WORKBENCH_POPOUTS} open system windows`);
    this.name = 'WorkbenchPopoutLimitError';
  }
}

export const reserveWorkbenchPopout = (tileId: string): boolean => {
  if (reservations.has(tileId)) return false;
  if (reservations.size >= MAX_WORKBENCH_POPOUTS) throw new WorkbenchPopoutLimitError();
  reservations.add(tileId);
  return true;
};

export const releaseWorkbenchPopout = (tileId: string): void => {
  reservations.delete(tileId);
};

export const getWorkbenchPopoutCount = (): number => reservations.size;

export const resetWorkbenchPopoutsForTests = (): void => {
  reservations.clear();
};
