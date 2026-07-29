import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/icon/Icon";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useEffectiveDirectory } from "@/hooks/useEffectiveDirectory";
import { useUIStore } from "@/stores/useUIStore";
import { useSessionDisplayStore } from "@/stores/useSessionDisplayStore";
import { SIDEBAR_PRIMARY_NAV_ITEMS } from "./sidebarNavigationConfig";

type Props = {
  hideDirectoryControls: boolean;
  showRecentControls: boolean;
  openNewSessionDraft: () => void;
  canOpenMultiRun: boolean;
  openMultiRunLauncher: () => void;
  isSessionSearchOpen: boolean;
  setIsSessionSearchOpen: (
    open: boolean | ((prev: boolean) => boolean),
  ) => void;
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>;
  sessionSearchQuery: string;
  setSessionSearchQuery: (value: string) => void;
  hasSessionSearchQuery: boolean;
  searchMatchCount: number;
  collapseAllProjects: () => void;
  expandAllProjects: () => void;
  openScheduledTasksDialog: () => void;
  selectionModeEnabled: boolean;
  onToggleSelectionMode: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
};

const navButtonClass =
  "group flex h-7 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-interactive-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

const navIconClass =
  "size-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-foreground";

export function SidebarNavigation({
  hideDirectoryControls,
  showRecentControls,
  openNewSessionDraft,
  canOpenMultiRun,
  openMultiRunLauncher,
  isSessionSearchOpen,
  setIsSessionSearchOpen,
  sessionSearchInputRef,
  sessionSearchQuery,
  setSessionSearchQuery,
  hasSessionSearchQuery,
  searchMatchCount,
  collapseAllProjects,
  expandAllProjects,
  openScheduledTasksDialog,
  selectionModeEnabled,
  onToggleSelectionMode,
  onOpenSettings,
  onOpenShortcuts,
  onOpenAbout,
}: Props): React.ReactNode {
  const { t } = useI18n();
  const settingsPage = useUIStore((state) => state.settingsPage);
  const isSettingsDialogOpen = useUIStore(
    (state) => state.isSettingsDialogOpen,
  );
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const setSettingsDialogOpen = useUIStore(
    (state) => state.setSettingsDialogOpen,
  );
  const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen);
  const setRightSidebarOpen = useUIStore((state) => state.setRightSidebarOpen);
  const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
  const effectiveDirectory = useEffectiveDirectory() ?? "";
  const normalizedEffectiveDirectory = React.useMemo(() => {
    if (!effectiveDirectory) return "";
    const raw = effectiveDirectory.replace(/\\/g, "/");
    const hadUncPrefix = raw.startsWith("//");
    let normalized = raw.replace(/\/+$/g, "").replace(/\/+/g, "/");
    if (hadUncPrefix && !normalized.startsWith("//"))
      normalized = `/${normalized}`;
    return normalized || (raw.startsWith("/") ? "/" : "");
  }, [effectiveDirectory]);
  const contextPanelState = useUIStore((state) =>
    normalizedEffectiveDirectory
      ? state.contextPanelByDirectory[normalizedEffectiveDirectory]
      : undefined,
  );
  const activeContextTab = contextPanelState?.tabs.find(
    (tab) => tab.id === contextPanelState.activeTabId,
  );

  const showRecentSection = useSessionDisplayStore(
    (state) => state.showRecentSection,
  );
  const showArchivedSessions = useSessionDisplayStore(
    (state) => state.showArchivedSessions,
  );
  const toggleRecentSection = useSessionDisplayStore(
    (state) => state.toggleRecentSection,
  );
  const toggleArchivedSessions = useSessionDisplayStore(
    (state) => state.toggleArchivedSessions,
  );
  const projectSortOrder = useSessionDisplayStore(
    (state) => state.projectSortOrder,
  );
  const setProjectSortOrder = useSessionDisplayStore(
    (state) => state.setProjectSortOrder,
  );

  const openSettingsPage = React.useCallback(
    (page: string) => {
      setSettingsPage(page);
      setSettingsDialogOpen(true);
    },
    [setSettingsDialogOpen, setSettingsPage],
  );

  const handleNavItem = React.useCallback(
    (id: (typeof SIDEBAR_PRIMARY_NAV_ITEMS)[number]["id"]) => {
      if (id === "git") {
        if (effectiveDirectory) {
          openContextPanelTab(effectiveDirectory, {
            mode: "git",
            dedupeKey: "git",
            label: t("layout.rightSidebar.git"),
          });
        }
        setRightSidebarOpen(true);
        return;
      }
      if (id === "scheduled") {
        openScheduledTasksDialog();
        return;
      }
      const item = SIDEBAR_PRIMARY_NAV_ITEMS.find(
        (candidate) => candidate.id === id,
      );
      if (item) {
        openSettingsPage(item.target);
      }
    },
    [
      effectiveDirectory,
      openContextPanelTab,
      openScheduledTasksDialog,
      openSettingsPage,
      setRightSidebarOpen,
      t,
    ],
  );

  const labels = React.useMemo<
    Record<(typeof SIDEBAR_PRIMARY_NAV_ITEMS)[number]["id"], string>
  >(
    () => ({
      projects: t("shell.navigation.projects"),
      git: t("shell.navigation.git"),
      scheduled: t("shell.navigation.scheduled"),
      applications: t("shell.navigation.applications"),
      plugins: t("shell.navigation.plugins"),
    }),
    [t],
  );

  if (hideDirectoryControls) {
    return null;
  }

  return (
    <div className="select-none shrink-0 px-3 pb-2">
      <div className="mb-2 flex h-11 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-2 py-1 text-left text-[19px] font-semibold tracking-[-0.02em] text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={t("shell.brand.menu")}
            >
              <span className="truncate">OpenChamber</span>
              <Icon
                name="arrow-down-s"
                className="size-4 text-muted-foreground"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Icon name="settings-3" className="size-4" />
              <span>{t("sessions.sidebar.footer.actions.settings")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenShortcuts}>
              <Icon name="command" className="size-4" />
              <span>{t("sessions.sidebar.footer.actions.shortcuts")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenAbout}>
              <Icon name="information" className="size-4" />
              <span>
                {t("sessions.sidebar.footer.actions.aboutOpenChamber")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => setIsSessionSearchOpen((previous) => !previous)}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            isSessionSearchOpen &&
              "bg-interactive-selection text-interactive-selection-foreground",
          )}
          aria-label={t("sessions.sidebar.header.actions.searchSessions")}
          aria-expanded={isSessionSearchOpen}
        >
          <Icon name="search" className="size-5" />
        </button>
      </div>

      {isSessionSearchOpen ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between px-1 typography-micro text-muted-foreground/80">
            {hasSessionSearchQuery ? (
              <span>
                {searchMatchCount === 1
                  ? t("sessions.sidebar.header.search.matchCountSingle", {
                      count: searchMatchCount,
                    })
                  : t("sessions.sidebar.header.search.matchCountPlural", {
                      count: searchMatchCount,
                    })}
              </span>
            ) : (
              <span />
            )}
            <span>{t("sessions.sidebar.header.search.escapeHint")}</span>
          </div>
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={sessionSearchInputRef}
              value={sessionSearchQuery}
              onChange={(event) => setSessionSearchQuery(event.target.value)}
              placeholder={t("sessions.sidebar.header.search.placeholder")}
              className="h-9 w-full rounded-[10px] border border-border/60 bg-transparent pl-9 pr-8 typography-ui-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                if (hasSessionSearchQuery) {
                  setSessionSearchQuery("");
                } else {
                  setIsSessionSearchOpen(false);
                }
              }}
            />
            {sessionSearchQuery.length > 0 ? (
              <button
                type="button"
                onClick={() => setSessionSearchQuery("")}
                className="absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label={t("sessions.sidebar.header.search.clear")}
              >
                <Icon name="close" className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav
        className="flex flex-col gap-0.5"
        aria-label={t("shell.navigation.primaryAria")}
      >
        <div className="group/new-task flex h-7 items-center rounded-lg hover:bg-interactive-hover/60 focus-within:ring-2 focus-within:ring-primary/50">
          <button
            type="button"
            onClick={openNewSessionDraft}
            className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-l-lg px-2.5 text-left text-sm text-foreground focus-visible:outline-none"
          >
            <Icon name="chat-new" className={navIconClass} />
            <span className="truncate">{t("shell.navigation.newTask")}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mr-0.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-interactive-hover hover:text-foreground group-hover/new-task:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                aria-label={t("shell.navigation.newTaskMenu")}
              >
                <Icon name="more" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[230px]">
              <DropdownMenuItem onClick={openNewSessionDraft}>
                <Icon name="chat-new" className="size-4" />
                <span>{t("shell.navigation.newTask")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={openMultiRunLauncher}
                disabled={!canOpenMultiRun}
              >
                <Icon name="git-merge" className="size-4" />
                <div className="flex min-w-0 flex-col">
                  <span>{t("shell.navigation.compareModels")}</span>
                  <span className="typography-micro text-muted-foreground">
                    {t("shell.navigation.advanced")}
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {SIDEBAR_PRIMARY_NAV_ITEMS.map((item) => {
          const active =
            item.id === "git"
              ? isRightSidebarOpen && activeContextTab?.mode === "git"
              : item.id !== "scheduled" &&
                isSettingsDialogOpen &&
                settingsPage === item.target;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavItem(item.id)}
              className={cn(
                navButtonClass,
                active &&
                  "bg-interactive-selection text-interactive-selection-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.icon} className={navIconClass} />
              <span className="truncate">{labels[item.id]}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex h-9 items-center justify-between px-2">
        <span className="typography-micro font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("shell.navigation.tasks")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={t("shell.navigation.tasksMenu")}
            >
              <Icon name="more" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem onClick={onToggleSelectionMode}>
              <Icon name="checkbox-multiple" className="size-4" />
              <span>
                {selectionModeEnabled
                  ? t("sessions.sidebar.header.actions.exitSelection")
                  : t("sessions.sidebar.header.actions.selectSessions")}
              </span>
              {selectionModeEnabled ? (
                <Icon name="check" className="ml-auto size-4 text-primary" />
              ) : null}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="sort-desc" className="size-4" />
                <span>{t("sessions.sidebar.header.actions.sortProjects")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[180px]">
                {(
                  [
                    ["manual", "sessions.sidebar.header.projectSort.manual"],
                    ["a-z", "sessions.sidebar.header.projectSort.aToZ"],
                    ["z-a", "sessions.sidebar.header.projectSort.zToA"],
                    [
                      "date-added",
                      "sessions.sidebar.header.projectSort.dateAdded",
                    ],
                    ["recent", "sessions.sidebar.header.projectSort.recent"],
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => setProjectSortOrder(value)}
                  >
                    <span>{t(label)}</span>
                    {projectSortOrder === value ? (
                      <Icon
                        name="check"
                        className="ml-auto size-4 text-primary"
                      />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="equalizer-2" className="size-4" />
                <span>{t("sessions.sidebar.header.displayMode.label")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[210px]">
                {showRecentControls ? (
                  <>
                    <DropdownMenuItem onClick={toggleRecentSection}>
                      <span>
                        {t("sessions.sidebar.header.displayMode.showRecent")}
                      </span>
                      {showRecentSection ? (
                        <Icon
                          name="check"
                          className="ml-auto size-4 text-primary"
                        />
                      ) : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={toggleArchivedSessions}>
                      <span>
                        {t("sessions.sidebar.header.displayMode.showArchived")}
                      </span>
                      {showArchivedSessions ? (
                        <Icon
                          name="check"
                          className="ml-auto size-4 text-primary"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={collapseAllProjects}>
              <Icon name="contract-up-down" className="size-4" />
              <span>
                {t("sessions.sidebar.header.displayMode.collapseAll")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={expandAllProjects}>
              <Icon name="expand-up-down" className="size-4" />
              <span>{t("sessions.sidebar.header.displayMode.expandAll")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
