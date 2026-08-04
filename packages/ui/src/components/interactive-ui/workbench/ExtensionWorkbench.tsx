import React from 'react';
import type { ToolPart } from '@opencode-ai/sdk/v2';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n';
import {
  getActiveWorkbenchBoard,
  fetchWorkbenchGeneratedSnapshot,
  type WorkbenchGeneratedSnapshot,
  type WorkbenchExtensionDescriptor,
  type WorkbenchSurfaceDescriptor,
  type WorkbenchTile,
  type WorkbenchTileLayout,
} from '@/lib/interactive-ui/workbench';
import {
  WORKBENCH_GRID_COLUMNS,
  clampWorkbenchLayout,
  compactWorkbenchLayouts,
  findNearestWorkbenchSlot,
  getWorkbenchGridHeight,
  planWorkbenchTileSwap,
} from '@/lib/interactive-ui/workbench-layout';
import { cn } from '@/lib/utils';
import { useExtensionWorkbenchStore } from '@/stores/useExtensionWorkbenchStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { InteractiveUIView } from '@/components/interactive-ui/InteractiveUIView';
import {
  McpAppRenderer,
  type McpAppRendererHandle,
} from '@/components/interactive-ui/McpAppRenderer';
import {
  HTMLArtifactView,
  type HTMLArtifactViewHandle,
} from '@/components/interactive-ui/HTMLArtifactView';
import { INTERACTIVE_RESULT_SCHEMA } from '@/lib/interactive-ui/types';
import {
  INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
  type InstalledHTMLArtifactResultEnvelope,
} from '@/lib/interactive-ui/installedArtifactResult';
import {
  advanceWorkbenchEventTrace,
  createWorkbenchEventTrace,
  resolveWorkbenchEvent,
  validateWorkbenchSchemaValue,
  type WorkbenchEventTrace,
  WorkbenchEventError,
} from '@/lib/interactive-ui/workbench-events';
import { isWorkbenchVersionCompatible } from '@/lib/interactive-ui/workbench-version';
import {
  parseMcpAppBinding,
  persistMcpAppEnvelopeToToolPart,
  type McpAppResultEnvelope,
} from '@/lib/interactive-ui/mcpApp';
import { opencodeClient } from '@/lib/opencode/client';
import {
  releaseWorkbenchPopout,
  reserveWorkbenchPopout,
} from '@/lib/interactive-ui/workbench-popouts';

const BOARD_GAP = 12;
const BOARD_ROW_HEIGHT = 48;
const BUILT_IN_INTERACTIVE_UI_EXTENSION_ID = 'com.openchamber.builtin.interactive-ui';
const CATALOG_DEFAULT_WIDTH = 240;
const CATALOG_MIN_WIDTH = 200;
const CATALOG_MAX_WIDTH = 480;
const CATALOG_WIDTH_STORAGE_KEY = 'openchamber.workbench.catalogWidth';
const RELATIONSHIP_COLORS = [
  'var(--ocix-chart-1)',
  'var(--ocix-chart-2)',
  'var(--ocix-chart-3)',
  'var(--ocix-chart-4)',
  'var(--ocix-chart-5)',
];

// eslint-disable-next-line react-refresh/only-export-components -- Pure App Board routing helper is covered by focused tests.
export const resolveWorkbenchPrimaryDisplayAction = (
  form: WorkbenchTile['form'],
  focused = false,
): 'focus' | 'mcp-fullscreen' | 'exit-focus' => {
  if (focused) return 'exit-focus';
  return form === 'mcp-app' ? 'mcp-fullscreen' : 'focus';
};

// eslint-disable-next-line react-refresh/only-export-components -- Pure App Board/MCP display-mode routing helper is covered by focused tests.
export const resolveWorkbenchMcpAppFocusDisplayMode = (
  form: WorkbenchTile['form'],
  focused: boolean,
  wasFocused: boolean,
): 'fullscreen' | 'inline' | null => {
  if (form !== 'mcp-app') return null;
  if (focused) return 'fullscreen';
  return wasFocused ? 'inline' : null;
};

const isSameMcpAppBinding = (
  current: McpAppResultEnvelope,
  next: McpAppResultEnvelope,
) => current.binding.server === next.binding.server
  && current.binding.resourceUri === next.binding.resourceUri
  && current.binding.toolKey === next.binding.toolKey;

// eslint-disable-next-line react-refresh/only-export-components -- Pure same-binding snapshot reducer is covered by focused tests.
export const refreshMcpAppWorkbenchSnapshot = (
  snapshot: WorkbenchGeneratedSnapshot,
  nextEnvelope: McpAppResultEnvelope,
): WorkbenchGeneratedSnapshot => {
  if (
    snapshot.form !== 'mcp-app'
    || snapshot.envelope.$schema !== 'openchamber://mcp-app-result/v1'
    || !isSameMcpAppBinding(snapshot.envelope, nextEnvelope)
  ) return snapshot;
  return {
    ...snapshot,
    envelope: nextEnvelope,
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- Pure persistence gate is covered by focused tests.
export const persistMcpAppWorkbenchSnapshot = async (
  current: WorkbenchGeneratedSnapshot | null,
  nextEnvelope: McpAppResultEnvelope,
  persist: (envelope: McpAppResultEnvelope) => Promise<WorkbenchGeneratedSnapshot>,
): Promise<WorkbenchGeneratedSnapshot> => {
  const next = current
    ? refreshMcpAppWorkbenchSnapshot(current, nextEnvelope)
    : current;
  if (!current || next === current) {
    throw new Error('MCP App snapshot binding changed before it could be persisted');
  }
  return persist(nextEnvelope);
};

// eslint-disable-next-line react-refresh/only-export-components -- Origin binding and canonical ToolPart persistence are covered by focused tests.
export const persistMcpAppOriginToolPart = async (
  originPart: ToolPart,
  envelope: McpAppResultEnvelope,
  persist: (part: ToolPart) => Promise<ToolPart>,
) => {
  const state = originPart.state;
  const metadata = state.status === 'running'
    || state.status === 'completed'
    || state.status === 'error'
    ? state.metadata
    : undefined;
  const originBinding = parseMcpAppBinding(metadata);
  if (!originBinding
    || originBinding.server !== envelope.binding.server
    || originBinding.resourceUri !== envelope.binding.resourceUri
    || originBinding.toolKey !== envelope.binding.toolKey) {
    throw new Error('Pinned MCP App origin binding no longer matches');
  }
  const persisted = await persist(
    persistMcpAppEnvelopeToToolPart(originPart, envelope),
  );
  if (persisted.type !== 'tool') {
    throw new Error('Pinned MCP App origin did not persist as a tool part');
  }
  return persisted;
};

const workbenchCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) return pointerWithin(args);
  return closestCenter(args);
};

const surfaceKey = (extensionId: string, surfaceId: string): string => (
  `${extensionId}:${surfaceId}`
);

const relationshipColor = (groupId: string | undefined): string | undefined => {
  if (!groupId) return undefined;
  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = ((hash << 5) - hash + groupId.charCodeAt(index)) | 0;
  }
  return RELATIONSHIP_COLORS[Math.abs(hash) % RELATIONSHIP_COLORS.length];
};

const getActiveProjectId = (
  activeProjectId: string | null,
  projects: Array<{ id: string }>,
): string | null => activeProjectId || projects[0]?.id || null;

const getSurfaceLabel = (surface: WorkbenchSurfaceDescriptor): string => (
  surface.form === 'html-artifact' ? 'HTML Artifact' : 'Interactive UI'
);

const clampCatalogWidth = (width: number): number => (
  Math.min(CATALOG_MAX_WIDTH, Math.max(CATALOG_MIN_WIDTH, Math.round(width)))
);

const getStoredCatalogWidth = (): number => {
  if (typeof window === 'undefined') return CATALOG_DEFAULT_WIDTH;
  try {
    const stored = Number.parseInt(window.localStorage.getItem(CATALOG_WIDTH_STORAGE_KEY) ?? '', 10);
    return Number.isFinite(stored) ? clampCatalogWidth(stored) : CATALOG_DEFAULT_WIDTH;
  } catch {
    return CATALOG_DEFAULT_WIDTH;
  }
};

const isTileCompatibleWithSurface = (
  tile: WorkbenchTile,
  surface: WorkbenchSurfaceDescriptor,
): boolean => {
  if (tile.source.kind !== 'third-party-extension'
    || !surface.dashboard
    || !isWorkbenchVersionCompatible(tile.source.compatibleVersion, surface.extensionVersion)) {
    return false;
  }
  const { layout } = surface.dashboard;
  if (tile.layout.columns < layout.minColumns
    || tile.layout.columns > layout.maxColumns
    || tile.layout.rows < layout.minRows
    || tile.layout.rows > layout.maxRows) {
    return false;
  }
  try {
    validateWorkbenchSchemaValue(surface.dashboard.inputSchema, tile.context);
    return true;
  } catch {
    return false;
  }
};

const useSurfaceIndex = (
  extensions: WorkbenchExtensionDescriptor[],
): Map<string, WorkbenchSurfaceDescriptor> => React.useMemo(() => {
  const result = new Map<string, WorkbenchSurfaceDescriptor>();
  for (const extension of extensions) {
    for (const surface of extension.surfaces) {
      result.set(surfaceKey(extension.id, surface.surfaceId), surface);
    }
  }
  return result;
}, [extensions]);

interface WorkbenchCatalogProps {
  extensions: WorkbenchExtensionDescriptor[];
  onLaunch: (extension: WorkbenchExtensionDescriptor, surface: WorkbenchSurfaceDescriptor) => void;
}

const WorkbenchCatalog: React.FC<WorkbenchCatalogProps> = ({
  extensions,
  onLaunch,
}) => {
  const { t } = useI18n();
  const [width, setWidth] = React.useState(getStoredCatalogWidth);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeStartRef = React.useRef<{ x: number; width: number } | null>(null);
  const widthRef = React.useRef(width);

  React.useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const persistWidth = React.useCallback((nextWidth: number) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CATALOG_WIDTH_STORAGE_KEY, String(clampCatalogWidth(nextWidth)));
    } catch {
      // Persistence is optional in restricted browser storage contexts.
    }
  }, []);

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort across browser and Electron runtimes.
    }
    resizeStartRef.current = { x: event.clientX, width };
    setIsResizing(true);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const nextWidth = clampCatalogWidth(start.width + event.clientX - start.x);
    widthRef.current = nextWidth;
    setWidth(nextWidth);
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The platform may have already released the pointer.
    }
    setIsResizing(false);
    persistWidth(widthRef.current);
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextWidth = clampCatalogWidth(widthRef.current + (event.key === 'ArrowRight' ? 16 : -16));
    widthRef.current = nextWidth;
    setWidth(nextWidth);
    persistWidth(nextWidth);
  };

  const resetWidth = () => {
    widthRef.current = CATALOG_DEFAULT_WIDTH;
    setWidth(CATALOG_DEFAULT_WIDTH);
    persistWidth(CATALOG_DEFAULT_WIDTH);
  };

  return (
    <aside
      className={cn(
        'relative min-h-0 shrink-0 border-r border-border/50 bg-[var(--surface-sidebar)]',
        !isResizing && 'transition-[width] duration-200',
      )}
      style={{ width: `${width}px` }}
      aria-label={t('workbench.catalog.aria')}
    >
      <div className="flex h-11 items-center justify-between border-b border-border/50 px-2">
        <span className="truncate typography-ui-label font-semibold">
          {t('workbench.catalog.title')}
        </span>
      </div>
      <div className="h-[calc(100%-2.75rem)] overflow-y-auto p-2">
        {extensions.length === 0 ? (
          <p className="px-2 py-5 typography-ui-caption text-muted-foreground">
            {t('workbench.catalog.empty')}
          </p>
        ) : extensions.map((extension) => (
          <section key={extension.id} className="mb-4">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--surface-elevated)] typography-micro font-semibold"
                aria-hidden
              >
                {extension.shortName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="truncate typography-ui-label font-semibold">{extension.shortName}</h3>
                <p className="truncate typography-micro text-muted-foreground">{extension.name}</p>
              </div>
            </div>
            <div className="space-y-1">
              {extension.surfaces.map((surface) => {
                const disabled = !surface.manualLaunch.enabled;
                const reason = surface.manualLaunch.reason
                  || (disabled ? t('workbench.catalog.requiresContext') : undefined);
                return (
                  <button
                    key={surface.surfaceId}
                    type="button"
                    disabled={disabled}
                    title={reason}
                    aria-describedby={disabled ? `${surface.surfaceId}-reason` : undefined}
                    onClick={() => onLaunch(extension, surface)}
                    className={cn(
                      'group w-full rounded-lg px-2 py-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                      disabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-interactive-hover active:bg-interactive-active',
                    )}
                  >
                    <span className="block truncate typography-ui-caption font-medium">{surface.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 typography-micro text-muted-foreground">
                      <span>{getSurfaceLabel(surface)}</span>
                      {disabled && (
                        <span id={`${surface.surfaceId}-reason`} className="truncate">
                          · {reason}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div
        className={cn(
          'absolute -right-1 top-0 z-50 h-full w-2 cursor-col-resize touch-none',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2',
          'after:bg-transparent after:transition-colors hover:after:bg-[var(--interactive-border)]',
          'focus-visible:outline-none focus-visible:after:bg-[var(--interactive-border)]',
          isResizing && 'after:bg-[var(--interactive-border)]',
        )}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onDoubleClick={resetWidth}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('workbench.catalog.aria')}
        aria-valuemin={CATALOG_MIN_WIDTH}
        aria-valuemax={CATALOG_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
      />
    </aside>
  );
};

const GeneratedWorkbenchSurface = React.forwardRef<McpAppRendererHandle, {
  projectId: string;
  tile: WorkbenchTile & { source: { kind: 'agent-generated'; snapshotRef: string } };
  focused: boolean;
  onTitleChange?: (title: string | null) => void;
}>(function GeneratedWorkbenchSurface({ projectId, tile, focused, onTitleChange }, forwardedRef) {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const updateGeneratedTileEnvelope = useExtensionWorkbenchStore(
    (state) => state.updateGeneratedTileEnvelope,
  );
  const directory = projects.find((project) => project.id === projectId)?.path ?? '';
  const [snapshot, setSnapshot] = React.useState<WorkbenchGeneratedSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const latestSnapshotRef = React.useRef<WorkbenchGeneratedSnapshot | null>(null);
  const originSessionId = tile.origin?.sessionId;
  const originMessageId = tile.origin?.messageId;
  const originToolCallId = tile.origin?.toolCallId;

  React.useEffect(() => {
    const current = latestSnapshotRef.current;
    if (current?.snapshotRef === tile.source.snapshotRef) {
      setSnapshot(current);
      return;
    }
    let active = true;
    latestSnapshotRef.current = null;
    setSnapshot(null);
    setError(null);
    void fetchWorkbenchGeneratedSnapshot(tile.source.snapshotRef)
      .then((next) => {
        if (!active) return;
        latestSnapshotRef.current = next;
        setSnapshot(next);
        onTitleChange?.(
          next.form === 'mcp-app'
            && next.envelope.$schema === 'openchamber://mcp-app-result/v1'
            ? next.envelope.title
            : null,
        );
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : t('workbench.pin.failed'));
        }
      });
    return () => {
      active = false;
    };
  }, [onTitleChange, t, tile.source.snapshotRef]);

  const handlePersistableEnvelopeChange = React.useCallback((
    nextEnvelope: McpAppResultEnvelope,
  ) => {
    return persistMcpAppWorkbenchSnapshot(
      latestSnapshotRef.current,
      nextEnvelope,
      async (envelope) => {
        if (directory && originSessionId && originMessageId && originToolCallId) {
          const originPart = await opencodeClient.getMessagePart({
            directory,
            sessionId: originSessionId,
            messageId: originMessageId,
            partId: originToolCallId,
          });
          if (originPart.type !== 'tool') {
            throw new Error('Pinned MCP App origin is not a tool part');
          }
          await persistMcpAppOriginToolPart(
            originPart,
            envelope,
            async (part) => opencodeClient.updateMessagePart({
              directory,
              sessionId: originSessionId,
              messageId: originMessageId,
              partId: originToolCallId,
              part,
            }).then((persisted) => {
              if (persisted.type !== 'tool') {
                throw new Error('Pinned MCP App origin did not persist as a tool part');
              }
              return persisted;
            }),
          );
        }
        return updateGeneratedTileEnvelope(
          projectId,
          tile.tileId,
          'mcp-app',
          envelope,
        );
      },
    ).then((persisted) => {
      latestSnapshotRef.current = persisted;
      setSnapshot(persisted);
      onTitleChange?.(
        persisted.envelope.$schema === 'openchamber://mcp-app-result/v1'
          ? persisted.envelope.title
          : null,
      );
    });
  }, [
    directory,
    onTitleChange,
    originMessageId,
    originSessionId,
    originToolCallId,
    projectId,
    tile.tileId,
    updateGeneratedTileEnvelope,
  ]);

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 typography-ui-caption text-[var(--status-error)]">
        {error}
      </div>
    );
  }
  if (!snapshot) {
    return <div className="typography-ui-caption text-muted-foreground">{t('workbench.loading')}</div>;
  }
  if (snapshot.form === 'interactive-ui'
    && snapshot.envelope.$schema === 'openchamber://interactive-result/v1') {
    return (
      <InteractiveUIView
        envelope={snapshot.envelope}
        workbench={{ projectId, tileId: tile.tileId }}
        fallback={(
          <pre className="whitespace-pre-wrap typography-micro">
            {JSON.stringify(snapshot.envelope, null, 2)}
          </pre>
        )}
        isMobile={false}
        traceContext={{ toolPartId: tile.tileId }}
      />
    );
  }
  if (snapshot.form === 'html-artifact'
    && snapshot.envelope.$schema === 'openchamber://html-artifact-result/v1') {
    return (
      <HTMLArtifactView
        envelope={snapshot.envelope}
        fallback={(
          <pre className="whitespace-pre-wrap typography-micro">
            {JSON.stringify(snapshot.envelope, null, 2)}
          </pre>
        )}
        toolPartId={tile.tileId}
        presentation="workbench"
      />
    );
  }
  if (snapshot.form === 'mcp-app'
    && snapshot.envelope.$schema === 'openchamber://mcp-app-result/v1') {
    if (
      !directory
      || !tile.origin?.sessionId
      || !tile.origin?.messageId
      || !tile.origin?.toolCallId
    ) {
      return (
        <div className="typography-ui-caption text-[var(--status-error)]">
          {t('workbench.tile.generatedSnapshotUnavailable')}
        </div>
      );
    }
    return (
      <McpAppRenderer
        ref={forwardedRef}
        envelope={snapshot.envelope}
        directory={directory}
        sessionId={tile.origin.sessionId}
        messageId={tile.origin.messageId}
        partId={tile.origin.toolCallId}
        className="h-full min-h-0"
        presentation="workbench"
        layoutEpoch={focused ? 'focused' : 'tile'}
        requestedDisplayMode={focused ? 'fullscreen' : 'inline'}
        onPersistableEnvelopeChange={handlePersistableEnvelopeChange}
        fallback={(
          <pre className="whitespace-pre-wrap typography-micro">
            {JSON.stringify(snapshot.envelope.result, null, 2)}
          </pre>
        )}
      />
    );
  }
  return (
    <div className="typography-ui-caption text-[var(--status-error)]">
      {t('workbench.tile.generatedSnapshotUnavailable')}
    </div>
  );
});

interface WorkbenchTileCardProps {
  projectId: string;
  tile: WorkbenchTile;
  surface: WorkbenchSurfaceDescriptor | null;
  surfaceCompatible: boolean;
  layout: WorkbenchTileLayout;
  onResize: (layout: WorkbenchTileLayout) => void;
  onRemove: () => void;
  onFocus: () => void;
  focused: boolean;
  onExitFocus: () => void;
  onDashboardEmit: (eventId: string, payload: Record<string, unknown>) => Promise<void>;
  onDisplayModeChange: (mode: 'tile' | 'popout') => void;
  onMigrate: () => void;
}

const WorkbenchDragPreview: React.FC<{
  title: string;
  subtitle: string;
}> = ({ title, subtitle }) => (
  <div
    data-workbench-drag-overlay
    className={cn(
      'pointer-events-none flex h-14 w-[min(360px,72vw)] items-center gap-3 overflow-hidden rounded-xl',
      'border border-border bg-[var(--surface-elevated)] px-3 shadow-2xl',
    )}
  >
    <Icon name="draggable" className="size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0">
      <div className="truncate typography-ui-caption font-semibold">{title}</div>
      <div className="truncate typography-micro text-muted-foreground">{subtitle}</div>
    </div>
  </div>
);

const WorkbenchTileCard: React.FC<WorkbenchTileCardProps> = ({
  projectId,
  tile,
  surface,
  surfaceCompatible,
  layout,
  onResize,
  onRemove,
  onFocus,
  focused,
  onExitFocus,
  onDashboardEmit,
  onDisplayModeChange,
  onMigrate,
}) => {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({ id: tile.tileId, disabled: focused });
  const {
    setNodeRef: setDroppableNodeRef,
    isOver,
  } = useDroppable({ id: tile.tileId, disabled: focused });
  const cardRef = React.useRef<HTMLElement | null>(null);
  const focusButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const wasFocusedRef = React.useRef(false);
  const resizeStart = React.useRef<{
    x: number;
    y: number;
    layout: WorkbenchTileLayout;
    width: number;
  } | null>(null);
  const [previewLayout, setPreviewLayout] = React.useState(layout);
  const artifactViewRef = React.useRef<HTMLArtifactViewHandle>(null);
  const mcpAppRendererRef = React.useRef<McpAppRendererHandle>(null);
  const interactivePopoutRef = React.useRef<Window | null>(null);
  const popoutPollRef = React.useRef<number | null>(null);
  const [poppedOut, setPoppedOut] = React.useState(false);
  const [generatedSnapshotTitle, setGeneratedSnapshotTitle] = React.useState<string | null>(null);
  const generatedSnapshotRef = tile.source.kind === 'agent-generated'
    ? tile.source.snapshotRef
    : null;
  const initialDisplayModeRef = React.useRef(tile.displayMode);
  const onDisplayModeChangeRef = React.useRef(onDisplayModeChange);
  onDisplayModeChangeRef.current = onDisplayModeChange;

  React.useEffect(() => {
    if (initialDisplayModeRef.current === 'popout') onDisplayModeChangeRef.current('tile');
    // A native system window does not survive an app restart. Reconcile a
    // stale persisted Popout marker once, without touching live transitions.
  }, []);

  const finishInteractivePopout = React.useCallback((closeWindow: boolean) => {
    if (popoutPollRef.current !== null) {
      window.clearInterval(popoutPollRef.current);
      popoutPollRef.current = null;
    }
    const popoutWindow = interactivePopoutRef.current;
    interactivePopoutRef.current = null;
    if (closeWindow && popoutWindow && !popoutWindow.closed) popoutWindow.close();
    releaseWorkbenchPopout(tile.tileId);
    setPoppedOut(false);
    onDisplayModeChangeRef.current('tile');
  }, [tile.tileId]);

  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | null;
      if (event.origin === window.location.origin
        && message?.source === 'openchamber-workbench-popout'
        && message.type === 'closed'
        && message.tileId === tile.tileId) {
        finishInteractivePopout(false);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      if (popoutPollRef.current !== null) window.clearInterval(popoutPollRef.current);
      if (interactivePopoutRef.current && !interactivePopoutRef.current.closed) {
        interactivePopoutRef.current.close();
      }
      releaseWorkbenchPopout(tile.tileId);
    };
  }, [finishInteractivePopout, tile.tileId]);

  React.useEffect(() => setPreviewLayout(layout), [layout]);

  React.useEffect(() => {
    setGeneratedSnapshotTitle(null);
  }, [generatedSnapshotRef]);

  React.useEffect(() => {
    if (focused) {
      wasFocusedRef.current = true;
      window.requestAnimationFrame(() => focusButtonRef.current?.focus());
      return;
    }
    if (wasFocusedRef.current) {
      wasFocusedRef.current = false;
      window.requestAnimationFrame(() => focusButtonRef.current?.focus());
    }
  }, [focused]);

  const setCardNode = React.useCallback((node: HTMLElement | null) => {
    cardRef.current = node;
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }, [setDraggableNodeRef, setDroppableNodeRef]);

  const trapFocusedTab = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!focused || event.key !== 'Tab' || !cardRef.current) return;
    const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('aria-hidden'));
    if (focusable.length === 0) {
      event.preventDefault();
      cardRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const card = event.currentTarget.closest<HTMLElement>('[data-workbench-tile]');
    resizeStart.current = {
      x: event.clientX,
      y: event.clientY,
      layout: previewLayout,
      width: card?.parentElement?.clientWidth || 720,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    const columnWidth = (start.width - (WORKBENCH_GRID_COLUMNS - 1) * BOARD_GAP) / WORKBENCH_GRID_COLUMNS;
    const columnsDelta = Math.round((event.clientX - start.x) / (columnWidth + BOARD_GAP));
    const rowsDelta = Math.round((event.clientY - start.y) / (BOARD_ROW_HEIGHT + BOARD_GAP));
    setPreviewLayout(clampWorkbenchLayout({
      ...start.layout,
      columns: start.layout.columns + columnsDelta,
      rows: start.layout.rows + rowsDelta,
    }, {
      minColumns: surface?.dashboard?.layout.minColumns,
      maxColumns: surface?.dashboard?.layout.maxColumns,
      minRows: surface?.dashboard?.layout.minRows,
      maxRows: surface?.dashboard?.layout.maxRows,
    }));
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer can be released by the platform during a resize cancel.
    }
    onResize(previewLayout);
  };

  const title = surface?.title
    || generatedSnapshotTitle
    || (tile.source.kind === 'agent-generated' ? t('workbench.tile.generated') : tile.source.surfaceId);
  const handleGeneratedSnapshotTitleChange = React.useCallback((nextTitle: string | null) => {
    setGeneratedSnapshotTitle(nextTitle);
  }, []);
  const workbenchContext = React.useMemo(() => ({
    projectId,
    tileId: tile.tileId,
  }), [projectId, tile.tileId]);
  const installedArtifactEnvelope = React.useMemo<InstalledHTMLArtifactResultEnvelope | null>(() => {
    if (tile.source.kind !== 'third-party-extension' || tile.form !== 'html-artifact') return null;
    return {
      $schema: INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
      schemaVersion: 1,
      artifact: tile.source.surfaceId,
      mode: 'live',
      summary: surface?.description ?? undefined,
      context: tile.context,
    };
  }, [surface?.description, tile.context, tile.form, tile.source]);

  const groupColor = relationshipColor(tile.relationship?.groupId);
  const popoutDeclared = surface?.dashboard?.popout.supported === true;
  const workbenchPopoutSupported = popoutDeclared && (
    tile.form === 'html-artifact'
    || (tile.form === 'interactive-ui' && surface?.runtime === 'declarative')
  );
  const systemPopoutSupported = workbenchPopoutSupported;
  const primaryDisplayAction = resolveWorkbenchPrimaryDisplayAction(tile.form, focused);

  const wasWorkbenchFocusedRef = React.useRef(focused);
  React.useEffect(() => {
    const wasFocused = wasWorkbenchFocusedRef.current;
    wasWorkbenchFocusedRef.current = focused;
    const requestedMode = resolveWorkbenchMcpAppFocusDisplayMode(
      tile.form,
      focused,
      wasFocused,
    );
    if (!requestedMode) return;

    // Pinning a conversation App opens and focuses its board tile in the same
    // React commit that mounts the renderer. The renderer ref can therefore be
    // assigned one frame after this parent effect. Retry briefly so a focused
    // MCP tile always negotiates true MCP fullscreen instead of leaving a
    // full-size host card around an inline/preview App.
    let cancelled = false;
    let attempts = 0;
    let frame = 0;
    const apply = () => {
      if (cancelled) return;
      const mode = mcpAppRendererRef.current?.requestDisplayMode(requestedMode);
      if (mode === requestedMode || attempts >= 20) return;
      attempts += 1;
      frame = window.requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [focused, tile.form]);

  const handlePrimaryDisplayToggle = () => {
    if (primaryDisplayAction === 'exit-focus') {
      if (tile.form === 'mcp-app') {
        mcpAppRendererRef.current?.requestDisplayMode('inline');
      }
      onExitFocus();
      return;
    }
    if (primaryDisplayAction === 'mcp-fullscreen') {
      const mode = mcpAppRendererRef.current?.requestDisplayMode('fullscreen');
      if (mode !== 'fullscreen') toast.info(t('workbench.tile.surfaceUnavailable'));
      return;
    }
    if (focused) onExitFocus();
    else onFocus();
  };

  const handlePopoutToggle = async () => {
    if (workbenchPopoutSupported) {
      if (poppedOut) {
        finishInteractivePopout(true);
        return;
      }
      try {
        reserveWorkbenchPopout(tile.tileId);
        const url = new URL('/workbench-popout.html', window.location.href);
        url.searchParams.set('projectId', projectId);
        url.searchParams.set('tileId', tile.tileId);
        const popoutWindow = window.open(
          url.toString(),
          `openchamber-workbench-${tile.tileId}`,
          'popup=yes,width=960,height=720,resizable=yes,scrollbars=yes',
        );
        if (!popoutWindow) {
          releaseWorkbenchPopout(tile.tileId);
          toast.error(t('workbench.tile.popoutUnavailable'));
          return;
        }
        interactivePopoutRef.current = popoutWindow;
        setPoppedOut(true);
        onDisplayModeChange('popout');
        popoutPollRef.current = window.setInterval(() => {
          if (popoutWindow.closed) finishInteractivePopout(false);
        }, 400);
      } catch (error) {
        releaseWorkbenchPopout(tile.tileId);
        toast.error(error instanceof Error ? error.message : t('workbench.tile.popoutUnavailable'));
      }
      return;
    }
    const target = artifactViewRef.current;
    if (!target) return;
    try {
      if (!poppedOut) reserveWorkbenchPopout(tile.tileId);
      const changed = poppedOut ? await target.restore() : await target.popout();
      if (!changed) {
        if (!poppedOut) releaseWorkbenchPopout(tile.tileId);
        toast.info(t('workbench.tile.popoutUnavailable'));
      }
    } catch (error) {
      if (!poppedOut) releaseWorkbenchPopout(tile.tileId);
      toast.error(error instanceof Error ? error.message : t('workbench.tile.popoutUnavailable'));
    }
  };

  return (
    <article
      ref={setCardNode}
      data-workbench-tile={tile.tileId}
      data-workbench-dragging={isDragging || undefined}
      data-workbench-drop-target={(isOver && !isDragging) || undefined}
      role={focused ? 'dialog' : undefined}
      aria-modal={focused || undefined}
      tabIndex={focused ? -1 : undefined}
      onKeyDown={trapFocusedTab}
      className={cn(
        'group relative min-h-0 overflow-hidden rounded-xl border border-border/70 bg-[var(--surface-elevated)]',
        'shadow-[0_1px_0_color-mix(in_srgb,var(--border)_45%,transparent)]',
        isDragging && 'ring-2 ring-ring/55',
        isOver && !isDragging && 'ring-2 ring-ring shadow-lg',
        focused && [
          'app-region-no-drag fixed inset-x-6 bottom-6 top-[var(--oc-header-height,3rem)]',
          'z-[2147483001] shadow-2xl',
        ],
      )}
      style={{
        gridColumn: focused ? undefined : `${previewLayout.column + 1} / span ${previewLayout.columns}`,
        gridRow: focused ? undefined : `${previewLayout.row + 1} / span ${previewLayout.rows}`,
        ...(groupColor ? { borderColor: groupColor } : {}),
      }}
    >
      <header
        className={cn(
          'flex h-10 select-none items-center gap-2 border-b border-border/50 px-2.5',
          'bg-[var(--surface-secondary)]',
        )}
      >
        <div
          {...(focused ? {} : attributes)}
          {...(focused ? {} : listeners)}
          className={cn(
            'flex min-w-0 flex-1 touch-none items-center gap-2 self-stretch',
            !focused && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <Icon name="draggable" className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="flex min-w-0 items-center gap-1.5 truncate typography-ui-caption font-semibold">
              {groupColor && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: groupColor }}
                  aria-hidden
                />
              )}
              <span className="truncate">{title}</span>
            </h3>
          </div>
          <span className="hidden truncate typography-micro text-muted-foreground @xl:block">
            {surface ? getSurfaceLabel(surface) : tile.form}
          </span>
        </div>
        <div
          className="app-region-no-drag -mr-1 isolate z-30 flex shrink-0 items-center gap-0.5"
          data-workbench-tile-controls
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            ref={focusButtonRef}
            size="icon"
            variant="ghost"
            className="relative z-20 size-9 shrink-0"
            disabled={poppedOut && !focused}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handlePrimaryDisplayToggle}
            aria-label={focused ? t('workbench.tile.exitFocus') : t('workbench.tile.focus')}
            data-workbench-display-action={primaryDisplayAction}
          >
            <Icon
              name={focused ? 'fullscreen-exit' : 'fullscreen'}
              className="pointer-events-none size-4"
            />
          </Button>
          {surface?.dashboard && (popoutDeclared || surface.runtime === 'native') ? (
            <Button
              size="icon"
              variant="ghost"
              className="relative z-20 size-9 shrink-0"
              disabled={!systemPopoutSupported}
              title={!systemPopoutSupported ? t('workbench.tile.popoutUnavailable') : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void handlePopoutToggle()}
              aria-label={poppedOut ? t('workbench.tile.restorePopout') : t('workbench.tile.popout')}
            >
              <Icon
                name={poppedOut ? 'window' : 'external-link'}
                className="pointer-events-none size-4"
              />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="relative z-20 size-9 shrink-0"
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={t('workbench.tile.more')}
              >
                <Icon name="more-2" className="pointer-events-none size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRemove}>
                {t('workbench.tile.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="h-[calc(100%-2.5rem)] min-h-0 overflow-auto overscroll-contain p-3">
        {poppedOut ? (
          <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border/70 p-4 text-center typography-ui-caption text-muted-foreground">
            {t('workbench.tile.poppedOut')}
          </div>
        ) : tile.source.kind === 'agent-generated' ? (
          <GeneratedWorkbenchSurface
            ref={mcpAppRendererRef}
            projectId={projectId}
            tile={tile as WorkbenchTile & {
              source: { kind: 'agent-generated'; snapshotRef: string };
            }}
            focused={focused}
            onTitleChange={handleGeneratedSnapshotTitleChange}
          />
        ) : !surface ? (
          <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border/70 p-4 text-center typography-ui-caption text-muted-foreground">
            {t('workbench.tile.surfaceUnavailable')}
          </div>
        ) : !surfaceCompatible ? (
          <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border/70 p-4 text-center">
            <div className="max-w-sm">
              <p className="typography-ui-caption text-muted-foreground">
                {t('workbench.tile.surfaceUnavailable')}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={onMigrate}
              >
                <Icon name="refresh" className="size-4" />
                {t('interactiveUI.state.retry')}
              </Button>
            </div>
          </div>
        ) : tile.form === 'interactive-ui' ? (
          <InteractiveUIView
            envelope={{
              $schema: INTERACTIVE_RESULT_SCHEMA,
              schemaVersion: 1,
              view: tile.source.surfaceId,
              mode: 'live',
              summary: surface.description ?? undefined,
              context: tile.context,
            }}
            workbench={{ projectId, tileId: tile.tileId }}
            fallback={(
              <pre className="whitespace-pre-wrap typography-micro">
                {JSON.stringify(tile.context, null, 2)}
              </pre>
            )}
            isMobile={false}
            traceContext={{ toolPartId: tile.tileId }}
            onDashboardEmit={onDashboardEmit}
          />
        ) : (
          <HTMLArtifactView
            ref={artifactViewRef}
            envelope={installedArtifactEnvelope!}
            workbench={workbenchContext}
            fallback={(
              <pre className="whitespace-pre-wrap typography-micro">
                {JSON.stringify(tile.context, null, 2)}
              </pre>
            )}
            toolPartId={tile.tileId}
            layoutEpoch={`${focused ? 'focused' : 'tile'}:${previewLayout.columns}:${previewLayout.rows}`}
            presentation="workbench"
            onDashboardEmit={onDashboardEmit}
            onPopoutChange={(nextPoppedOut) => {
              if (nextPoppedOut) {
                try {
                  reserveWorkbenchPopout(tile.tileId);
                } catch {
                  // The click path reserves first. A duplicate event is a no-op.
                }
              } else {
                releaseWorkbenchPopout(tile.tileId);
              }
              setPoppedOut(nextPoppedOut);
              onDisplayModeChange(nextPoppedOut ? 'popout' : 'tile');
            }}
          />
        )}
      </div>
      <button
        type="button"
        className={cn(
          'absolute bottom-0 right-0 size-6 cursor-nwse-resize touch-none',
          'after:absolute after:bottom-1 after:right-1 after:size-2.5 after:border-b-2 after:border-r-2 after:border-muted-foreground/70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          focused && 'hidden',
        )}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        aria-label={t('workbench.tile.resize')}
      />
    </article>
  );
};

export const ExtensionWorkbench: React.FC = () => {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projectId = getActiveProjectId(activeProjectId, projects);
  const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen);
  const catalog = useExtensionWorkbenchStore((state) => state.catalog);
  const snapshot = useExtensionWorkbenchStore((state) => state.snapshot);
  const loadState = useExtensionWorkbenchStore((state) => state.loadState);
  const mutationPending = useExtensionWorkbenchStore((state) => state.mutationPending);
  const error = useExtensionWorkbenchStore((state) => state.error);
  const load = useExtensionWorkbenchStore((state) => state.load);
  const pin = useExtensionWorkbenchStore((state) => state.pin);
  const updateTile = useExtensionWorkbenchStore((state) => state.updateTile);
  const updateTileLayouts = useExtensionWorkbenchStore((state) => state.updateTileLayouts);
  const migrateTile = useExtensionWorkbenchStore((state) => state.migrateTile);
  const removeTile = useExtensionWorkbenchStore((state) => state.removeTile);
  const [catalogCollapsed, setCatalogCollapsed] = React.useState(false);
  const [focusedTileId, setFocusedTileId] = React.useState<string | null>(null);
  const [activeDragTileId, setActiveDragTileId] = React.useState<string | null>(null);
  const [layoutOverrides, setLayoutOverrides] = React.useState<Map<string, WorkbenchTileLayout>>(
    () => new Map(),
  );
  const boardRef = React.useRef<HTMLDivElement | null>(null);
  const recentEventsRef = React.useRef(new Map<string, number>());
  const eventTraceByTileRef = React.useRef(new Map<string, WorkbenchEventTrace>());
  const eventRateRef = React.useRef<Array<{
    at: number;
    extensionId: string;
    tileId: string;
  }>>([]);

  React.useEffect(() => {
    if (projectId) void load(projectId);
  }, [load, projectId]);

  React.useEffect(() => {
    if (!isRightSidebarOpen) {
      setFocusedTileId(null);
    }
  }, [isRightSidebarOpen]);

  const extensions = React.useMemo(() => catalog?.extensions ?? [], [catalog?.extensions]);
  const applicationExtensions = React.useMemo(
    () => extensions.filter((extension) => extension.id !== BUILT_IN_INTERACTIVE_UI_EXTENSION_ID),
    [extensions],
  );
  const surfaceIndex = useSurfaceIndex(extensions);
  const board = getActiveWorkbenchBoard(snapshot);
  const tiles = React.useMemo(() => board?.tiles ?? [], [board?.tiles]);
  const compactedLayoutByTile = React.useMemo(() => compactWorkbenchLayouts(tiles), [tiles]);
  const layoutByTile = React.useMemo(() => {
    if (layoutOverrides.size === 0) return compactedLayoutByTile;
    const result = new Map(compactedLayoutByTile);
    for (const [tileId, layout] of layoutOverrides) {
      if (result.has(tileId)) result.set(tileId, layout);
    }
    return result;
  }, [compactedLayoutByTile, layoutOverrides]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleLaunch = React.useCallback(async (
    extension: WorkbenchExtensionDescriptor,
    surface: WorkbenchSurfaceDescriptor,
  ) => {
    if (!projectId || !surface.dashboard || !surface.manualLaunch.enabled) return;
    const occupied = Array.from(layoutByTile.values());
    const preferred = findNearestWorkbenchSlot(
      surface.dashboard.layout,
      occupied,
      { column: 0, row: 0 },
    );
    const result = await pin(projectId, {
      source: {
        kind: 'third-party-extension',
        extensionId: extension.id,
        surfaceId: surface.surfaceId,
      },
      form: surface.form,
      context: surface.dashboard.defaultContext,
      layout: preferred,
    });
    setFocusedTileId(result.created ? null : result.tile.tileId);
  }, [layoutByTile, pin, projectId]);

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragTileId(String(event.active.id));
  }, []);

  const handleDragCancel = React.useCallback(() => {
    setActiveDragTileId(null);
  }, []);

  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    setActiveDragTileId(null);
    if (!projectId || !event.active || !boardRef.current) return;
    const tile = tiles.find((entry) => entry.tileId === event.active.id);
    if (!tile) return;
    const current = layoutByTile.get(tile.tileId) || tile.layout;
    const targetTile = event.over && event.over.id !== event.active.id
      ? tiles.find((entry) => entry.tileId === event.over?.id)
      : null;
    let updates: Array<{ tileId: string; layout: WorkbenchTileLayout }>;
    if (targetTile) {
      const targetCurrent = layoutByTile.get(targetTile.tileId) || targetTile.layout;
      const occupied = tiles
        .filter((entry) => entry.tileId !== tile.tileId && entry.tileId !== targetTile.tileId)
        .map((entry) => layoutByTile.get(entry.tileId) || entry.layout);
      const swapped = planWorkbenchTileSwap(current, targetCurrent, occupied);
      updates = [
        { tileId: tile.tileId, layout: swapped.active },
        { tileId: targetTile.tileId, layout: swapped.target },
      ];
    } else {
      const width = boardRef.current.clientWidth;
      const columnWidth = (width - (WORKBENCH_GRID_COLUMNS - 1) * BOARD_GAP) / WORKBENCH_GRID_COLUMNS;
      const target = clampWorkbenchLayout({
        ...current,
        column: current.column + Math.round(event.delta.x / (columnWidth + BOARD_GAP)),
        row: current.row + Math.round(event.delta.y / (BOARD_ROW_HEIGHT + BOARD_GAP)),
      });
      const next = findNearestWorkbenchSlot(
        target,
        tiles
          .filter((entry) => entry.tileId !== tile.tileId)
          .map((entry) => layoutByTile.get(entry.tileId) || entry.layout),
        target,
      );
      updates = [{ tileId: tile.tileId, layout: next }];
    }

    const hasChange = updates.some(({ tileId, layout }) => {
      const persisted = tiles.find((entry) => entry.tileId === tileId)?.layout;
      return persisted && JSON.stringify(layout) !== JSON.stringify(persisted);
    });
    if (!hasChange) return;
    setLayoutOverrides(new Map(updates.map((entry) => [entry.tileId, entry.layout])));
    try {
      await updateTileLayouts(projectId, updates);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Workbench tile layout could not be saved');
    } finally {
      setLayoutOverrides(new Map());
    }
  }, [layoutByTile, projectId, tiles, updateTileLayouts]);

  const handleResize = React.useCallback((tile: WorkbenchTile, layout: WorkbenchTileLayout) => {
    if (!projectId || JSON.stringify(layout) === JSON.stringify(tile.layout)) return;
    const next = findNearestWorkbenchSlot(
      layout,
      tiles
        .filter((entry) => entry.tileId !== tile.tileId)
        .map((entry) => layoutByTile.get(entry.tileId) || entry.layout),
      layout,
    );
    void updateTile(projectId, tile.tileId, { layout: next });
  }, [layoutByTile, projectId, tiles, updateTile]);

  const handleDashboardEmit = React.useCallback(async (
    sourceTile: WorkbenchTile,
    eventId: string,
    payload: Record<string, unknown>,
  ) => {
    if (!projectId || sourceTile.source.kind !== 'third-party-extension') {
      throw new WorkbenchEventError(
        'Generated surfaces do not participate in automatic dashboard links',
        'workbench_event_source_not_installed',
      );
    }
    const sourceExtensionId = sourceTile.source.extensionId;
    const sourceSurfaceId = sourceTile.source.surfaceId;
    const extension = extensions.find((candidate) => candidate.id === sourceExtensionId);
    if (!extension) {
      throw new WorkbenchEventError('Extension is unavailable', 'workbench_extension_unavailable');
    }
    const dedupeKey = `${sourceTile.tileId}:${eventId}:${JSON.stringify(payload)}`;
    const now = Date.now();
    eventRateRef.current = eventRateRef.current.filter((entry) => now - entry.at < 5_000);
    const tileEventCount = eventRateRef.current.filter((entry) => entry.tileId === sourceTile.tileId).length;
    const extensionEventCount = eventRateRef.current.filter(
      (entry) => entry.extensionId === sourceExtensionId,
    ).length;
    if (tileEventCount >= 20 || extensionEventCount >= 100) {
      throw new WorkbenchEventError(
        'Dashboard event rate limit was reached',
        'workbench_event_rate_limited',
      );
    }
    eventRateRef.current.push({
      at: now,
      extensionId: sourceExtensionId,
      tileId: sourceTile.tileId,
    });
    const previous = recentEventsRef.current.get(dedupeKey) ?? 0;
    if (now - previous < 750) {
      throw new WorkbenchEventError('Duplicate dashboard event was ignored', 'workbench_event_duplicate');
    }
    recentEventsRef.current.set(dedupeKey, now);
    for (const [key, timestamp] of recentEventsRef.current) {
      if (now - timestamp > 5_000) recentEventsRef.current.delete(key);
    }

    const resolved = resolveWorkbenchEvent({
      extension,
      sourceSurfaceId,
      eventId,
      payload,
      sourceContext: sourceTile.context,
      hostContext: { project: { id: projectId } },
    });
    if (resolved.length === 0) return;

    const groupId = sourceTile.relationship?.groupId
      ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `group_${crypto.randomUUID()}`
        : `group_${Date.now().toString(36)}`);
    const existingTrace = eventTraceByTileRef.current.get(sourceTile.tileId);
    const sourceTrace = existingTrace && existingTrace.expiresAt > now
      ? existingTrace
      : createWorkbenchEventTrace(now);
    if (!sourceTile.relationship) {
      await updateTile(projectId, sourceTile.tileId, {
        relationship: {
          groupId,
          kind: resolved[0].link.relationship,
          parentTileId: null,
        },
      });
    }

    for (const entry of resolved.slice(0, 8)) {
      const targetTrace = advanceWorkbenchEventTrace(sourceTrace, entry.link.id, now);
      const sourceLayout = layoutByTile.get(sourceTile.tileId) || sourceTile.layout;
      const preferredColumn = entry.link.placement === 'adjacent'
        && sourceLayout.column + sourceLayout.columns + entry.target.dashboard!.layout.columns <= WORKBENCH_GRID_COLUMNS
        ? sourceLayout.column + sourceLayout.columns
        : sourceLayout.column;
      const preferredRow = preferredColumn === sourceLayout.column + sourceLayout.columns
        ? sourceLayout.row
        : sourceLayout.row + sourceLayout.rows;
      const placement = findNearestWorkbenchSlot(
        entry.target.dashboard!.layout,
        tiles
          .filter((tile) => tile.tileId !== sourceTile.tileId)
          .map((tile) => layoutByTile.get(tile.tileId) || tile.layout),
        { column: preferredColumn, row: preferredRow },
      );
      const result = await pin(projectId, {
        source: {
          kind: 'third-party-extension',
          extensionId: extension.id,
          surfaceId: entry.target.surfaceId,
        },
        form: entry.target.form,
        context: entry.context,
        layout: placement,
        relationship: {
          groupId,
          kind: entry.link.relationship,
          parentTileId: sourceTile.tileId,
        },
      });
      eventTraceByTileRef.current.set(result.tile.tileId, targetTrace);
      if (!result.created && !result.tile.relationship) {
        await updateTile(projectId, result.tile.tileId, {
          relationship: {
            groupId,
            kind: entry.link.relationship,
            parentTileId: sourceTile.tileId,
          },
        });
      }
      setFocusedTileId(result.tile.tileId);
    }
  }, [extensions, layoutByTile, pin, projectId, tiles, updateTile]);

  const gridHeight = getWorkbenchGridHeight(layoutByTile.values(), BOARD_ROW_HEIGHT, BOARD_GAP);
  const activeDragTile = activeDragTileId
    ? tiles.find((tile) => tile.tileId === activeDragTileId) ?? null
    : null;
  const activeDragSurface = activeDragTile?.source.kind === 'third-party-extension'
    ? surfaceIndex.get(surfaceKey(activeDragTile.source.extensionId, activeDragTile.source.surfaceId)) ?? null
    : null;
  const activeDragTitle = activeDragSurface?.title
    || (activeDragTile?.source.kind === 'agent-generated'
      ? t('workbench.tile.generated')
      : activeDragTile?.source.surfaceId)
    || '';
  const activeDragSubtitle = activeDragSurface
    ? getSurfaceLabel(activeDragSurface)
    : activeDragTile?.form === 'html-artifact'
      ? 'HTML Artifact'
      : activeDragTile?.form === 'mcp-app'
        ? 'MCP App'
        : 'Interactive UI';

  React.useEffect(() => {
    if (!focusedTileId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedTileId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedTileId]);

  React.useEffect(() => {
    const handleFocusRequest = (event: Event) => {
      const tileId = (event as CustomEvent<{ tileId?: unknown }>).detail?.tileId;
      if (typeof tileId === 'string' && tiles.some((tile) => tile.tileId === tileId)) {
        setFocusedTileId(tileId);
      }
    };
    window.addEventListener('openchamber:workbench-focus-tile', handleFocusRequest);
    return () => window.removeEventListener('openchamber:workbench-focus-tile', handleFocusRequest);
  }, [tiles]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center typography-ui-caption text-muted-foreground">
        {t('workbench.noProject')}
      </div>
    );
  }

  return (
    <div className="ocix-scope flex h-full min-h-0 overflow-hidden bg-background">
      {!catalogCollapsed && (
        <WorkbenchCatalog
          extensions={applicationExtensions}
          onLaunch={(extension, surface) => void handleLaunch(extension, surface)}
        />
      )}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/50 bg-background/95 px-3 backdrop-blur"
          data-workbench-board-header
        >
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              onClick={() => setCatalogCollapsed((value) => !value)}
              aria-label={catalogCollapsed ? t('workbench.catalog.expand') : t('workbench.catalog.collapse')}
            >
              <Icon name={catalogCollapsed ? 'arrow-right-s' : 'arrow-left-s'} className="size-4" />
            </Button>
            <div className="min-w-0">
              <h2 className="truncate typography-ui-label font-semibold">{t('workbench.board.title')}</h2>
              <p className="truncate typography-micro text-muted-foreground">
                {t('workbench.board.subtitle', { count: tiles.length })}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={loadState === 'loading' || mutationPending}
            onClick={() => void load(projectId, { force: true })}
          >
            <Icon name="refresh" className="size-4" />
            {t('workbench.refresh')}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto" data-workbench-board-scroller>
          {error && (
            <div className="m-3 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 typography-ui-caption text-[var(--status-error)]">
              {error}
            </div>
          )}

          {loadState === 'loading' && !snapshot ? (
            <div className="p-6 typography-ui-caption text-muted-foreground">{t('workbench.loading')}</div>
          ) : tiles.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <Icon name="apps-2-ai" className="mx-auto size-8 text-muted-foreground" />
                <h3 className="mt-3 typography-ui-label font-semibold">{t('workbench.board.emptyTitle')}</h3>
                <p className="mt-1 typography-ui-caption text-muted-foreground">
                  {t('workbench.board.emptyDescription')}
                </p>
              </div>
            </div>
          ) : (
            <>
              {focusedTileId && (
                <button
                  type="button"
                  className="app-region-no-drag fixed inset-0 z-[2147483000] cursor-default bg-black/65"
                  onClick={() => setFocusedTileId(null)}
                  aria-label={t('workbench.tile.exitFocus')}
                />
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={workbenchCollisionDetection}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={(event) => void handleDragEnd(event)}
              >
                <div
                  ref={boardRef}
                  className="grid grid-cols-12 gap-3 p-3"
                  style={{
                    gridAutoRows: `${BOARD_ROW_HEIGHT}px`,
                    minHeight: `${gridHeight + 24}px`,
                  }}
                >
                  {tiles.map((tile) => {
                    const surface = tile.source.kind === 'third-party-extension'
                      ? surfaceIndex.get(surfaceKey(tile.source.extensionId, tile.source.surfaceId)) || null
                      : null;
                    const surfaceCompatible = tile.source.kind === 'agent-generated'
                      || (surface !== null && isTileCompatibleWithSurface(tile, surface));
                    const layout = layoutByTile.get(tile.tileId) || tile.layout;
                    return (
                      <WorkbenchTileCard
                        key={tile.tileId}
                        projectId={projectId}
                        tile={tile}
                        surface={surface}
                        surfaceCompatible={surfaceCompatible}
                        layout={layout}
                        onResize={(next) => handleResize(tile, next)}
                        onRemove={() => void removeTile(projectId, tile.tileId)}
                        onFocus={() => setFocusedTileId(tile.tileId)}
                        focused={focusedTileId === tile.tileId}
                        onExitFocus={() => setFocusedTileId(null)}
                        onDashboardEmit={(eventId, payload) => handleDashboardEmit(tile, eventId, payload)}
                        onDisplayModeChange={(displayMode) => {
                          if (tile.displayMode !== displayMode) {
                            void updateTile(projectId, tile.tileId, { displayMode });
                          }
                        }}
                        onMigrate={() => {
                          void migrateTile(projectId, tile.tileId)
                            .catch((nextError) => {
                              toast.error(
                                nextError instanceof Error
                                  ? nextError.message
                                  : t('workbench.tile.surfaceUnavailable'),
                              );
                            });
                        }}
                      />
                    );
                  })}
                </div>
                <DragOverlay dropAnimation={null} zIndex={2147482990}>
                  {activeDragTile && (
                    <WorkbenchDragPreview
                      title={activeDragTitle}
                      subtitle={activeDragSubtitle}
                    />
                  )}
                </DragOverlay>
              </DndContext>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
