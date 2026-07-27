import { create } from 'zustand';
import { getRuntimeKey } from '@/lib/runtime-switch';
import {
  createWorkbenchTile,
  deleteWorkbenchTile,
  fetchWorkbenchCatalog,
  fetchWorkbenchSnapshot,
  getActiveWorkbenchBoard,
  migrateWorkbenchTile as requestWorkbenchTileMigration,
  patchWorkbenchTile,
  patchWorkbenchTileLayouts,
  WorkbenchRequestError,
  type WorkbenchCatalog,
  type WorkbenchDisplayMode,
  type WorkbenchSnapshot,
  type WorkbenchTile,
  type WorkbenchTileDraft,
  type WorkbenchTileLayout,
  type WorkbenchTileRelationship,
} from '@/lib/interactive-ui/workbench';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface ExtensionWorkbenchStore {
  runtimeKey: string;
  projectId: string | null;
  catalog: WorkbenchCatalog | null;
  snapshot: WorkbenchSnapshot | null;
  loadState: LoadState;
  mutationPending: boolean;
  error: string | null;
  load: (projectId: string, options?: { force?: boolean }) => Promise<void>;
  pin: (projectId: string, tile: WorkbenchTileDraft) => Promise<{ tile: WorkbenchTile; created: boolean }>;
  updateTile: (
    projectId: string,
    tileId: string,
    patch: {
      layout?: WorkbenchTileLayout;
      displayMode?: WorkbenchDisplayMode;
      relationship?: WorkbenchTileRelationship | null;
    },
  ) => Promise<WorkbenchTile>;
  updateTileLayouts: (
    projectId: string,
    layouts: Array<{ tileId: string; layout: WorkbenchTileLayout }>,
  ) => Promise<WorkbenchTile[]>;
  migrateTile: (projectId: string, tileId: string) => Promise<WorkbenchTile>;
  removeTile: (projectId: string, tileId: string) => Promise<void>;
  resetForRuntimeSwitch: () => void;
}

let generation = 0;
let mutationRevision = 0;
let mutationQueue = Promise.resolve();

const runtimeIdentity = () => getRuntimeKey().trim() || 'default';

const activeRevision = (snapshot: WorkbenchSnapshot | null): number => (
  getActiveWorkbenchBoard(snapshot)?.revision ?? 0
);

const serializeMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = mutationQueue;
  let release: (() => void) | undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
  }
};

export const useExtensionWorkbenchStore = create<ExtensionWorkbenchStore>((set, get) => ({
  runtimeKey: runtimeIdentity(),
  projectId: null,
  catalog: null,
  snapshot: null,
  loadState: 'idle',
  mutationPending: false,
  error: null,

  load: async (projectId, options) => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) return;
    const currentRuntime = runtimeIdentity();
    const current = get();
    if (!options?.force
      && current.runtimeKey === currentRuntime
      && current.projectId === normalizedProjectId
      && (current.loadState === 'loading' || current.loadState === 'ready')) {
      return;
    }
    const operationGeneration = ++generation;
    const loadMutationRevision = mutationRevision;
    set({
      runtimeKey: currentRuntime,
      projectId: normalizedProjectId,
      loadState: 'loading',
      error: null,
      ...(current.runtimeKey === currentRuntime && current.projectId === normalizedProjectId
        ? {}
        : { catalog: null, snapshot: null }),
    });
    try {
      const [catalog, snapshot] = await Promise.all([
        fetchWorkbenchCatalog(),
        fetchWorkbenchSnapshot(normalizedProjectId),
      ]);
      if (operationGeneration !== generation
        || currentRuntime !== runtimeIdentity()
        || get().projectId !== normalizedProjectId
        || loadMutationRevision !== mutationRevision) {
        return;
      }
      set({ catalog, snapshot, loadState: 'ready', error: null });
    } catch (error) {
      if (operationGeneration !== generation || currentRuntime !== runtimeIdentity() || get().projectId !== normalizedProjectId) {
        return;
      }
      set({
        loadState: 'error',
        error: error instanceof Error ? error.message : 'Extension Workbench could not be loaded',
      });
    }
  },

  pin: async (projectId, tileDraft) => serializeMutation(async () => {
    const normalizedProjectId = projectId.trim();
    const currentRuntime = runtimeIdentity();
    if (!normalizedProjectId) throw new Error('projectId is required');
    if (get().runtimeKey !== currentRuntime || get().projectId !== normalizedProjectId || !get().snapshot) {
      await get().load(normalizedProjectId, { force: true });
    }
    const snapshot = get().snapshot;
    if (!snapshot) throw new Error(get().error || 'Extension Workbench is unavailable');
    set({ mutationPending: true, error: null });
    try {
      const result = await createWorkbenchTile(
        normalizedProjectId,
        activeRevision(snapshot),
        tileDraft,
      );
      mutationRevision += 1;
      if (currentRuntime === runtimeIdentity() && get().projectId === normalizedProjectId) {
        set({ snapshot: result.snapshot, loadState: 'ready', mutationPending: false });
      }
      return { tile: result.tile, created: result.created };
    } catch (error) {
      set({
        mutationPending: false,
        error: error instanceof Error ? error.message : 'Workbench tile could not be pinned',
      });
      if (error instanceof WorkbenchRequestError && error.code === 'workbench_revision_conflict') {
        await get().load(normalizedProjectId, { force: true });
      }
      throw error;
    }
  }),

  updateTile: async (projectId, tileId, patch) => serializeMutation(async () => {
    const normalizedProjectId = projectId.trim();
    const snapshot = get().projectId === normalizedProjectId ? get().snapshot : null;
    if (!snapshot) throw new Error('Extension Workbench is not loaded for this project');
    const currentRuntime = runtimeIdentity();
    set({ mutationPending: true, error: null });
    try {
      const result = await patchWorkbenchTile(
        normalizedProjectId,
        tileId,
        activeRevision(snapshot),
        patch,
      );
      mutationRevision += 1;
      if (currentRuntime === runtimeIdentity() && get().projectId === normalizedProjectId) {
        set({ snapshot: result.snapshot, loadState: 'ready', mutationPending: false });
      }
      return result.tile;
    } catch (error) {
      set({
        mutationPending: false,
        error: error instanceof Error ? error.message : 'Workbench tile could not be updated',
      });
      if (error instanceof WorkbenchRequestError && error.code === 'workbench_revision_conflict') {
        await get().load(normalizedProjectId, { force: true });
      }
      throw error;
    }
  }),

  updateTileLayouts: async (projectId, layouts) => serializeMutation(async () => {
    const normalizedProjectId = projectId.trim();
    const snapshot = get().projectId === normalizedProjectId ? get().snapshot : null;
    if (!snapshot) throw new Error('Extension Workbench is not loaded for this project');
    const currentRuntime = runtimeIdentity();
    set({ mutationPending: true, error: null });
    try {
      const result = await patchWorkbenchTileLayouts(
        normalizedProjectId,
        activeRevision(snapshot),
        layouts,
      );
      mutationRevision += 1;
      if (currentRuntime === runtimeIdentity() && get().projectId === normalizedProjectId) {
        set({ snapshot: result.snapshot, loadState: 'ready', mutationPending: false });
      }
      return result.tiles;
    } catch (error) {
      set({
        mutationPending: false,
        error: error instanceof Error ? error.message : 'Workbench tile layouts could not be updated',
      });
      if (error instanceof WorkbenchRequestError && error.code === 'workbench_revision_conflict') {
        await get().load(normalizedProjectId, { force: true });
      }
      throw error;
    }
  }),

  migrateTile: async (projectId, tileId) => serializeMutation(async () => {
    const normalizedProjectId = projectId.trim();
    const snapshot = get().projectId === normalizedProjectId ? get().snapshot : null;
    if (!snapshot) throw new Error('Extension Workbench is not loaded for this project');
    const currentRuntime = runtimeIdentity();
    set({ mutationPending: true, error: null });
    try {
      const result = await requestWorkbenchTileMigration(
        normalizedProjectId,
        tileId,
        activeRevision(snapshot),
      );
      mutationRevision += 1;
      if (currentRuntime === runtimeIdentity() && get().projectId === normalizedProjectId) {
        set({ snapshot: result.snapshot, loadState: 'ready', mutationPending: false });
      }
      return result.tile;
    } catch (error) {
      set({
        mutationPending: false,
        error: error instanceof Error ? error.message : 'Workbench tile migration failed',
      });
      if (error instanceof WorkbenchRequestError && error.code === 'workbench_revision_conflict') {
        await get().load(normalizedProjectId, { force: true });
      }
      throw error;
    }
  }),

  removeTile: async (projectId, tileId) => serializeMutation(async () => {
    const normalizedProjectId = projectId.trim();
    const snapshot = get().projectId === normalizedProjectId ? get().snapshot : null;
    if (!snapshot) throw new Error('Extension Workbench is not loaded for this project');
    const currentRuntime = runtimeIdentity();
    set({ mutationPending: true, error: null });
    try {
      const result = await deleteWorkbenchTile(
        normalizedProjectId,
        tileId,
        activeRevision(snapshot),
      );
      mutationRevision += 1;
      if (currentRuntime === runtimeIdentity() && get().projectId === normalizedProjectId) {
        set({ snapshot: result.snapshot, loadState: 'ready', mutationPending: false });
      }
    } catch (error) {
      set({
        mutationPending: false,
        error: error instanceof Error ? error.message : 'Workbench tile could not be removed',
      });
      if (error instanceof WorkbenchRequestError && error.code === 'workbench_revision_conflict') {
        await get().load(normalizedProjectId, { force: true });
      }
      throw error;
    }
  }),

  resetForRuntimeSwitch: () => {
    generation += 1;
    mutationRevision += 1;
    set({
      runtimeKey: runtimeIdentity(),
      projectId: null,
      catalog: null,
      snapshot: null,
      loadState: 'idle',
      mutationPending: false,
      error: null,
    });
  },
}));
