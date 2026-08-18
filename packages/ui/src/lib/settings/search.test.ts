import { describe, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import { getSettingsPageMeta, resolveSettingsSlug, type SettingsRuntimeContext } from './metadata';
import { buildSettingsSearchResults } from './search';

const baseCtx: SettingsRuntimeContext & {
  isDesktopLocalOrigin: boolean;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  isWindowsArm64: boolean;
} = {
  isVSCode: false,
  isWeb: false,
  isDesktop: true,
  isMobile: false,
  isDesktopLocalOrigin: true,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isWindowsArm64: false,
};

const t = (key: I18nKey): string => key;
const getPageTitle = (slug: string): string => slug === 'interactive-ui.extensions' ? 'Applications' : slug;

describe('Applications settings metadata', () => {
  test('registers interactive-ui.extensions as a single content page for non-VSCode runtimes', () => {
    const meta = getSettingsPageMeta('interactive-ui.extensions');
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe('Applications');
    expect(meta?.group).toBe('content');
    expect(meta?.kind).toBe('single');
    expect(meta?.isAvailable?.({ ...baseCtx, isVSCode: true })).toBe(false);
    expect(meta?.isAvailable?.({ ...baseCtx, isVSCode: false })).toBe(true);
  });

  test('resolveSettingsSlug resolves the Applications slug directly', () => {
    expect(resolveSettingsSlug('interactive-ui.extensions')).toBe('interactive-ui.extensions');
    expect(resolveSettingsSlug('INTERACTIVE-UI.EXTENSIONS')).toBe('interactive-ui.extensions');
  });
});

describe('Applications settings search', () => {
  test('finds the seven maintained Applications entries for non-VSCode runtimes', () => {
    const results = buildSettingsSearchResults({
      query: 'Applications',
      runtimeCtx: baseCtx,
      t,
      getPageTitle,
    });
    const ids = results.map((result) => result.id).sort();
    expect(ids).toEqual([
      'interactive-ui.connections',
      'interactive-ui.installed',
      'interactive-ui.marketplaces',
      'interactive-ui.publishers',
      'interactive-ui.remote',
      'interactive-ui.routing-inspector',
      'interactive-ui.stylePreset',
    ]);
  });

  test('hides every Applications entry when the page is unavailable in VS Code', () => {
    const results = buildSettingsSearchResults({
      query: 'ocix',
      runtimeCtx: { ...baseCtx, isVSCode: true },
      t,
      getPageTitle,
    });
    expect(results.some((result) => result.page === 'interactive-ui.extensions')).toBe(false);
  });

  test('matches each Applications entry by its own keywords', () => {
    const byQuery = (q: string) => buildSettingsSearchResults({
      query: q,
      runtimeCtx: baseCtx,
      t,
      getPageTitle,
    }).map((result) => result.id);

    expect(byQuery('marketplace')).toContain('interactive-ui.marketplaces');
    expect(byQuery('publisher')).toContain('interactive-ui.publishers');
    expect(byQuery('routing inspector')).toContain('interactive-ui.routing-inspector');
    expect(byQuery('business connection')).toContain('interactive-ui.connections');
    expect(byQuery('rollback')).toContain('interactive-ui.installed');
    expect(byQuery('access key')).toContain('interactive-ui.remote');
    expect(byQuery('style preset')).toContain('interactive-ui.stylePreset');
  });
});

describe('v1.18.1 search preservation', () => {
  test('keeps every target search item reachable', () => {
    const macCtx = { ...baseCtx, isMac: true };
    const cases: Array<[string, string, typeof baseCtx]> = [
      ['autosave', 'appearance.auto-save-enabled', baseCtx],
      ['walkthrough', 'sessions.walkthrough-model', baseCtx],
      ['window controls style', 'sessions.desktop-window-controls-style', baseCtx],
      ['openai-compatible', 'providers.custom', baseCtx],
      ['dock badge', 'appearance.dock-badge', macCtx],
      ['dock icon', 'appearance.dock-icon', macCtx],
    ];
    for (const [query, expectedId, ctx] of cases) {
      const results = buildSettingsSearchResults({
        query,
        runtimeCtx: ctx,
        t,
        getPageTitle,
      });
      expect(results.map((result) => result.id)).toContain(expectedId);
    }
  });

  test('does not surface hidden external CLI controls', () => {
    const hiddenIds = new Set([
      'sessions.opencode-binary',
      'sessions.opencode-update-notifications',
      'sessions.agent-control-tool',
    ]);
    const queries = ['opencode binary', 'update notifications', 'agent control'];

    for (const query of queries) {
      const results = buildSettingsSearchResults({ query, runtimeCtx: baseCtx, t, getPageTitle });
      expect(results.some((result) => hiddenIds.has(result.id))).toBe(false);
    }
  });

  test('keeps the dock badge macOS-only rule and the PWA-only install name rule', () => {
    const macCtx = { ...baseCtx, isMac: true, isWindows: false, isLinux: false };
    const linuxCtx = { ...baseCtx, isMac: false, isWindows: false, isLinux: true };
    const webCtx = { ...baseCtx, isDesktop: false, isWeb: true, isDesktopLocalOrigin: false };

    expect(buildSettingsSearchResults({ query: 'dock badge', runtimeCtx: macCtx, t, getPageTitle }).some((r) => r.id === 'appearance.dock-badge')).toBe(true);
    expect(buildSettingsSearchResults({ query: 'dock badge', runtimeCtx: linuxCtx, t, getPageTitle }).some((r) => r.id === 'appearance.dock-badge')).toBe(false);
    expect(buildSettingsSearchResults({ query: 'dock icon', runtimeCtx: macCtx, t, getPageTitle }).some((r) => r.id === 'appearance.dock-icon')).toBe(true);
    expect(buildSettingsSearchResults({ query: 'dock icon', runtimeCtx: linuxCtx, t, getPageTitle }).some((r) => r.id === 'appearance.dock-icon')).toBe(false);
    expect(buildSettingsSearchResults({ query: 'dock icon', runtimeCtx: { ...macCtx, isDesktopLocalOrigin: false }, t, getPageTitle }).some((r) => r.id === 'appearance.dock-icon')).toBe(false);
    expect(buildSettingsSearchResults({ query: 'installed app', runtimeCtx: webCtx, t, getPageTitle }).some((r) => r.id === 'appearance.pwa-install-name')).toBe(true);
    expect(buildSettingsSearchResults({ query: 'installed app', runtimeCtx: baseCtx, t, getPageTitle }).some((r) => r.id === 'appearance.pwa-install-name')).toBe(false);
  });
});
