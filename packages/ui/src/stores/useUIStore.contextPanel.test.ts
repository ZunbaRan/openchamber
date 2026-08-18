import { beforeEach, describe, expect, test } from 'bun:test';
import { CONTEXT_SURFACES, sortContextSurfaces } from '../lib/surfaces/registry';
import type { OcixStylePreset } from '../lib/interactive-ui/stylePresets';
import { getSafeStorage } from './utils/safeStorage';
import { useUIStore } from './useUIStore';

beforeEach(() => {
  useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [] });
  useUIStore.setState({ isRightSidebarOpen: false, rightSidebarTab: 'git', ocixStylePreset: 'linear' });
});

describe('useUIStore context panel tabs', () => {
  test('updates readOnly when an existing chat tab is reopened', () => {
    const directory = '/repo';

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:ses_1',
      label: 'Session',
      readOnly: true,
    });

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:ses_1',
      label: 'Session',
      readOnly: false,
    });

    const tabs = useUIStore.getState().contextPanelByDirectory[directory]?.tabs ?? [];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.readOnly).toBe(false);
  });
});

describe('useUIStore openContextSurface', () => {
  const directory = '/repo';

  test('opens a fresh singleton tab when none of that mode exists', () => {
    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['diff']);
  });

  test('activates the existing tab of the requested mode instead of duplicating it', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });
    useUIStore.getState().openContextPanelTab(directory, { mode: 'file', targetPath: '/repo/a.ts' });

    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.tabs.filter((tab) => tab.mode === 'diff')).toHaveLength(1);
    expect(state?.activeTabId).toBe('diff');
    expect(state?.isOpen).toBe(true);
  });

  test('toggles the panel closed when the requested mode is already active and open', () => {
    useUIStore.getState().openContextSurface(directory, 'diff');
    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['diff']);
  });

  test('does nothing for content-driven modes without existing content', () => {
    useUIStore.getState().openContextSurface(directory, 'preview');
    useUIStore.getState().openContextSurface(directory, 'chat');

    expect(useUIStore.getState().contextPanelByDirectory[directory]).toBe(undefined);
  });

  test('opens an empty editor tab that a real file later replaces', () => {
    useUIStore.getState().openContextSurface(directory, 'file');

    let state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['file']);
    expect(state?.tabs[0]?.targetPath).toBe(null);

    useUIStore.getState().openContextFile(directory, '/repo/a.ts');

    state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.tabs.filter((tab) => tab.mode === 'file')).toHaveLength(1);
    expect(state?.tabs.find((tab) => tab.mode === 'file')?.targetPath).toBe('/repo/a.ts');
  });

  test('activates the most recently touched tab of a content-driven mode', () => {
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextFile(directory, '/repo/b.ts');
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });

    useUIStore.getState().openContextSurface(directory, 'file');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
    expect(activeTab?.mode).toBe('file');
    expect(activeTab?.targetPath).toBe('/repo/b.ts');
  });
});

describe('useUIStore closeContextPanelTab surface stability', () => {
  const directory = '/repo';

  test('closing an active file tab activates another file tab, not another surface', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextFile(directory, '/repo/b.ts');

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTabId = stateBefore?.activeTabId as string;
    useUIStore.getState().closeContextPanelTab(directory, activeTabId);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
    expect(activeTab?.mode).toBe('file');
    expect(activeTab?.targetPath).toBe('/repo/a.ts');
    expect(state?.isOpen).toBe(true);
  });

  test('closing the last tab of the active surface closes the panel', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    useUIStore.getState().closeContextPanelTab(directory, stateBefore?.activeTabId as string);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['terminal']);
  });

  test('closing an inactive tab keeps the active tab untouched', () => {
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });

    const state0 = useUIStore.getState().contextPanelByDirectory[directory];
    const fileTab = state0?.tabs.find((tab) => tab.mode === 'file');
    useUIStore.getState().closeContextPanelTab(directory, fileTab?.id as string);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.activeTabId).toBe('terminal');
    expect(state?.isOpen).toBe(true);
  });
});

describe('useUIStore per-surface panel widths', () => {
  const directory = '/repo';

  test('setContextPanelWidth stores a clamped manual width for one mode only', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });
    useUIStore.getState().setContextPanelWidth(directory, 'diff', 700);
    useUIStore.getState().setContextPanelWidth(directory, 'git', 100);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.widthByMode.diff).toBe(700);
    expect(state?.widthByMode.git).toBe(380);
    expect(state?.widthByMode.browser).toBe(undefined);
  });
});

describe('useUIStore contextRailOrder', () => {
  test('setContextRailOrder drops empty and duplicate ids', () => {
    useUIStore.getState().setContextRailOrder(['diff', 'diff', '', 'editor']);
    expect(useUIStore.getState().contextRailOrder).toEqual(['diff', 'editor']);
  });

  test('sortContextSurfaces applies persisted order and appends missing surfaces', () => {
    const ordered = sortContextSurfaces(['browser', 'unknown-id', 'diff']);
    const ids = ordered.map((surface) => surface.id);

    expect(ids.slice(0, 2)).toEqual(['browser', 'diff']);
    // Assert against the registry itself so this test cannot go stale when a
    // surface is added or removed.
    expect(new Set(ids)).toEqual(new Set(CONTEXT_SURFACES.map((surface) => surface.id)));
    expect(ids).toHaveLength(CONTEXT_SURFACES.length);
  });
});

describe('useUIStore right-sidebar and OCIX preset fork state', () => {
  test('initial defaults are closed sidebar, git tab, linear preset', () => {
    const initial = useUIStore.getInitialState();
    expect(initial.isRightSidebarOpen).toBe(false);
    expect(initial.rightSidebarTab).toBe('git');
    expect(initial.ocixStylePreset).toBe('linear');
  });

  test('setRightSidebarOpen and setRightSidebarTab store the raw values', () => {
    useUIStore.getState().setRightSidebarOpen(true);
    useUIStore.getState().setRightSidebarTab('extensions');

    const state = useUIStore.getState();
    expect(state.isRightSidebarOpen).toBe(true);
    expect(state.rightSidebarTab).toBe('extensions');
  });

  test('setOcixStylePreset stores a valid preset and normalizes unknown ids', () => {
    useUIStore.getState().setOcixStylePreset('vercel');
    expect(useUIStore.getState().ocixStylePreset).toBe('vercel');

    useUIStore.getState().setOcixStylePreset('bogus' as OcixStylePreset);
    expect(useUIStore.getState().ocixStylePreset).toBe('linear');
  });
});

describe('useUIStore persisted fork state sanitization', () => {
  const drainDeferredWrites = async () => {
    // The store persists through a deferred storage that flushes on a
    // zero-delay timer; wait for any queued flush so a seeded value cannot
    // be shadowed by an in-flight write.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const seedAndRehydrate = async (state: Record<string, unknown>, version: number) => {
    await drainDeferredWrites();
    getSafeStorage().setItem('ui-store', JSON.stringify({ state, version }));
    await useUIStore.persist.rehydrate();
  };

  test('v13 migration sanitizes malformed open/tab/preset and drops obsolete width', async () => {
    await seedAndRehydrate({
      theme: 'dark',
      messageLimit: 250,
      isRightSidebarOpen: 'yes',
      rightSidebarTab: 'bogus',
      ocixStylePreset: 'bogus',
      rightSidebarWidth: 500,
    }, 13);

    const state = useUIStore.getState();
    expect(state.isRightSidebarOpen).toBe(false);
    expect(state.rightSidebarTab).toBe('git');
    expect(state.ocixStylePreset).toBe('linear');
    expect((state as unknown as Record<string, unknown>).rightSidebarWidth).toBe(undefined);
    // Unrelated persisted state is preserved across the migration.
    expect(state.theme).toBe('dark');
    expect(state.messageLimit).toBe(250);
  });

  test('v13 migration keeps valid persisted fork values', async () => {
    await seedAndRehydrate({
      isRightSidebarOpen: true,
      rightSidebarTab: 'extensions',
      ocixStylePreset: 'vercel',
    }, 13);

    const state = useUIStore.getState();
    expect(state.isRightSidebarOpen).toBe(true);
    expect(state.rightSidebarTab).toBe('extensions');
    expect(state.ocixStylePreset).toBe('vercel');
  });

  test('context panel tabs using the new modes survive sanitization', async () => {
    await seedAndRehydrate({
      contextPanelByDirectory: {
        '/repo': {
          isOpen: true,
          expanded: false,
          tabs: [
            { id: 'extensions', mode: 'extensions', targetPath: null, dedupeKey: 'extensions', label: 'Applications', sessionTitleFallback: null, readOnly: false, stagedDiff: false, diffScope: 'working', touchedAt: 1 },
            { id: 'files-root', mode: 'files-root', targetPath: null, dedupeKey: 'files-root', label: 'Files', sessionTitleFallback: null, readOnly: false, stagedDiff: false, diffScope: 'working', touchedAt: 2 },
          ],
          activeTabId: 'files-root',
          widthByMode: { extensions: 700, 'files-root': 100 },
          touchedAt: 3,
        },
      },
    }, 13);

    const state = useUIStore.getState().contextPanelByDirectory['/repo'];
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['extensions', 'files-root']);
    expect(state?.activeTabId).toBe('files-root');
    expect(state?.widthByMode.extensions).toBe(700);
    expect(state?.widthByMode['files-root']).toBe(380);
  });
});
