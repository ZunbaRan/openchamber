import React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

type UIState = {
  contextPanelByDirectory: Record<string, unknown>;
  isRightSidebarOpen: boolean;
  closeContextPanel: () => void;
  openContextPanelTab: () => void;
  toggleContextPanelExpanded: () => void;
  setContextPanelWidth: () => void;
  setActiveContextPanelTab: () => void;
  reorderContextPanelTabs: () => void;
  contextEditorTreeVisible: boolean;
  toggleContextEditorTree: () => void;
  allowPromptingSubagentSessions: boolean;
};

const directory = '/repo';
const noop = () => undefined;
const uiState: UIState = {
  contextPanelByDirectory: {
    [directory]: {
      isOpen: true,
      expanded: false,
      activeTabId: 'extensions',
      tabs: [{ id: 'extensions', mode: 'extensions', targetPath: null, touchedAt: 1 }],
      widthByMode: {},
      touchedAt: 1,
    },
  },
  // The removed right-sidebar implementation may still persist this legacy
  // value. ContextPanel must not use it as the visibility authority.
  isRightSidebarOpen: false,
  closeContextPanel: noop,
  openContextPanelTab: noop,
  toggleContextPanelExpanded: noop,
  setContextPanelWidth: noop,
  setActiveContextPanelTab: noop,
  reorderContextPanelTabs: noop,
  contextEditorTreeVisible: false,
  toggleContextEditorTree: noop,
  allowPromptingSubagentSessions: false,
};

mock.module('@/stores/useUIStore', () => ({
  CONTEXT_PANEL_DEFAULT_WIDTH: 640,
  CONTEXT_PANEL_MAX_WIDTH: 960,
  CONTEXT_PANEL_MIN_WIDTH: 320,
  useUIStore: (selector: (state: UIState) => unknown) => selector(uiState),
}));

mock.module('@/hooks/useEffectiveDirectory', () => ({
  useEffectiveDirectory: () => directory,
}));

mock.module('@/lib/i18n', () => ({
  formatMessage: (_dictionary: unknown, key: string) => key,
  useI18nStore: { getState: () => ({ dictionary: {} }) },
  useI18n: () => ({ t: (key: string) => key }),
}));

mock.module('@/contexts/useThemeSystem', () => ({
  useThemeSystem: () => ({
    themeMode: 'dark',
    setThemeMode: noop,
    lightThemeId: 'light',
    darkThemeId: 'dark',
    currentTheme: {},
  }),
}));

mock.module('@/stores/useFilesViewTabsStore', () => ({
  useFilesViewTabsStore: (selector: (state: { setSelectedPath: () => void }) => unknown) =>
    selector({ setSelectedPath: noop }),
}));

mock.module('@/stores/useTerminalStore', () => ({
  useTerminalStore: (selector: (state: { createTab: () => string }) => unknown) =>
    selector({ createTab: () => 'terminal-1' }),
}));

mock.module('@/sync/sync-context', () => ({
  setActiveSession: noop,
  setExternallyViewedSession: noop,
  useDirectoryStore: () => ({
    subscribe: () => noop,
    getState: () => ({ session: [] }),
  }),
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({}),
}));

mock.module('@/sync/input-store', () => ({
  useInputStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({}),
}));

mock.module('@/sync/notification-store', () => ({ markSessionViewed: noop }));

mock.module('@/lib/chunkLoadRecovery', () => ({
  lazyWithChunkRecovery: () => () => null,
}));

mock.module('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props, children),
}));

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => children,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => children,
  DropdownMenuItem: ({ children }: React.PropsWithChildren) => children,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => children,
}));

mock.module('@/components/ui/sortable-tabs-strip', () => ({
  SortableTabsStrip: () => null,
}));

mock.module('@/components/icon/Icon', () => ({ Icon: () => null }));
mock.module('@/components/icons/FileTypeIcon', () => ({ FileTypeIcon: () => null }));
mock.module('@/components/icons/DiffIcon', () => ({ DiffViewIcon: () => null }));
mock.module('@/components/ui/OpenChamberLogo', () => ({ OpenChamberLogo: () => null }));
mock.module('@/components/views/PullRequestView', () => ({ PullRequestView: () => null }));
mock.module('@/components/views/TerminalView', () => ({ TerminalView: () => null }));
mock.module('@/components/interactive-ui/workbench/ExtensionWorkbench', () => ({ ExtensionWorkbench: () => null }));
mock.module('../RightSidebarTabs', () => ({ ProjectContextPanel: () => React.createElement('div', null, 'notes') }));
mock.module('../SidebarFilesTree', () => ({ SidebarFilesTree: () => null }));
mock.module('../ContextSidebarTab', () => ({ ContextPanelContent: () => null }));
mock.module('@/components/ui', () => ({ toast: { error: noop } }));

const { ContextPanel } = await import('../ContextPanel');

describe('ContextPanel visibility authority', () => {
  test('opens the App board from directory-scoped state even when the legacy sidebar flag is false', () => {
    const markup = renderToStaticMarkup(React.createElement(ContextPanel));
    const aside = markup.match(/<aside[^>]*data-context-panel="true"[^>]*>/)?.[0];

    expect(aside).toBeDefined();
    expect(aside).not.toContain('inert=""');
    expect(aside).not.toContain('width:0');
    expect(aside).toContain('width:min(var(--oc-context-panel-width), 100%)');
  });
});
