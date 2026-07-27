import React from 'react';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { copyTextToClipboard } from '@/lib/clipboard';
import { openExternalUrl } from '@/lib/url';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';
import {
  getInstalledHTMLArtifactDescriptor,
  materializeHTMLArtifact,
} from '@/lib/interactive-ui/client';
import type { HTMLArtifactDisplayMode, HTMLArtifactResultEnvelope } from '@/lib/interactive-ui/artifactResult';
import {
  INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
  type InstalledHTMLArtifactResultEnvelope,
} from '@/lib/interactive-ui/installedArtifactResult';
import type { InteractiveToolContext } from '@/lib/interactive-ui/types';
import {
  canRetryHTMLArtifactFailure,
  classifyHTMLArtifactError,
  type HTMLArtifactFailureState,
} from '@/lib/interactive-ui/artifactState';
import {
  createHTMLArtifactBridgeRateLimiter,
  createHTMLArtifactBusinessResultMessage,
  createHTMLArtifactHostInitMessage,
  isHTMLArtifactBrokerNavigationMessage,
  parseHTMLArtifactBridgeMessage,
} from '@/lib/interactive-ui/artifactBridge';
import { sessionEvents } from '@/lib/sessionEvents';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { isElectronShell } from '@/lib/desktop';
import { recordRoutingArtifactObservation } from '@/lib/interactive-ui/routingInspector';
import { HTMLArtifactStateNotice } from './HTMLArtifactStateNotice';
import { ArtifactExecutionSurface, type ArtifactExecutionSurfaceHandle } from './ArtifactExecutionSurface';

interface HTMLArtifactViewProps {
  envelope: HTMLArtifactResultEnvelope | InstalledHTMLArtifactResultEnvelope;
  fallback: React.ReactNode;
  sessionId?: string;
  toolPartId: string;
  tool?: Pick<InteractiveToolContext, 'id' | 'name'>;
  workbench?: {
    projectId: string;
    tileId: string;
  };
  onDashboardEmit?: (eventId: string, payload: Record<string, unknown>) => Promise<void>;
  onPopoutChange?: (poppedOut: boolean) => void;
  layoutEpoch?: string | number;
  presentation?: 'standalone' | 'workbench';
}

export interface HTMLArtifactViewHandle {
  canPopout(): boolean;
  popout(): Promise<boolean>;
  restore(): Promise<boolean>;
}

interface ResolvedHTMLArtifact {
  scripts: boolean;
  inlineHeight: number;
  allowExpand: boolean;
  displayModes: HTMLArtifactDisplayMode[];
  documentPath: string;
  title: string;
  extensionId?: string;
  artifactId?: string;
}

const ARTIFACT_HEARTBEAT_INTERVAL_MS = 1_000;
// The isolated Desktop Runner keeps its own hard 15-minute lease. This
// renderer-side watchdog only detects a stalled Broker heartbeat, so allow
// enough scheduling jitter for dense workbenches, focus transitions, and
// native dialog animations without terminating a healthy Runner.
const ARTIFACT_HEARTBEAT_TIMEOUT_MS = 20_000;
const ARTIFACT_EXECUTION_LEASE_MS = 15 * 60_000;

const OCIX_ARTIFACT_TOKENS = [
  '--ocix-surface',
  '--ocix-surface-muted',
  '--ocix-surface-subtle',
  '--ocix-foreground',
  '--ocix-muted-foreground',
  '--ocix-border',
  '--ocix-selection',
  '--ocix-selection-foreground',
  '--ocix-focus-ring',
  '--ocix-primary',
  '--ocix-primary-foreground',
  '--ocix-success',
  '--ocix-success-background',
  '--ocix-success-border',
  '--ocix-warning',
  '--ocix-warning-background',
  '--ocix-warning-border',
  '--ocix-error',
  '--ocix-error-background',
  '--ocix-error-border',
  '--ocix-info',
  '--ocix-info-background',
  '--ocix-info-border',
  '--ocix-chart-1',
  '--ocix-chart-2',
  '--ocix-chart-3',
  '--ocix-chart-4',
  '--ocix-chart-5',
];

const createChannelId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const collectThemeContext = (element: HTMLElement | null, themeOverride?: 'light' | 'dark') => {
  const tokens: Record<string, string> = {};
  if (element && typeof getComputedStyle === 'function') {
    const styles = getComputedStyle(element);
    for (const token of OCIX_ARTIFACT_TOKENS) {
      const value = styles.getPropertyValue(token).trim();
      if (value) tokens[token] = value;
    }
  }
  const dark = typeof document !== 'undefined'
    && (document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark');
  return { tokens, theme: themeOverride ?? (dark ? 'dark' as const : 'light' as const) };
};

const hasRecentUserActivation = (): boolean => (
  typeof navigator !== 'undefined'
  && (navigator.userActivation?.isActive ?? false)
);

export const HTMLArtifactView = React.forwardRef<HTMLArtifactViewHandle, HTMLArtifactViewProps>(({
  envelope,
  fallback,
  sessionId,
  toolPartId,
  tool,
  workbench,
  onDashboardEmit,
  onPopoutChange,
  layoutEpoch,
  presentation = 'standalone',
}, forwardedRef) => {
  const { t, locale } = useI18n();
  const runtime = React.useContext(RuntimeAPIContext);
  const themeSystem = useOptionalThemeSystem();
  const themeVariant = themeSystem?.currentTheme.metadata.variant === 'dark' ? 'dark' : 'light';
  const mobileSurface = isMobileSurfaceRuntime();
  const hostRef = React.useRef<HTMLDialogElement>(null);
  const executionSurfaceRef = React.useRef<ArtifactExecutionSurfaceHandle>(null);
  const lastSequenceRef = React.useRef(0);
  const lastHeartbeatRef = React.useRef(0);
  const executionLeaseRef = React.useRef({ id: createChannelId(), expiresAt: 0 });
  const loadedOnceRef = React.useRef(false);
  const [channelId] = React.useState(createChannelId);
  const [bridgeRateLimiter] = React.useState(createHTMLArtifactBridgeRateLimiter);
  const businessRequestsRef = React.useRef(new Set<string>());
  const installed = envelope.$schema === INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA;
  const embeddedInWorkbench = presentation === 'workbench';
  const generatedEnvelope = installed ? null : envelope;
  const [materialization, setMaterialization] = React.useState<ResolvedHTMLArtifact | null>(null);
  const [failure, setFailure] = React.useState<HTMLArtifactFailureState | null>(null);
  const [ready, setReady] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [mode, setMode] = React.useState<HTMLArtifactDisplayMode>(
    embeddedInWorkbench || installed ? 'inline' : envelope.display.preferred,
  );
  const [height, setHeight] = React.useState(installed ? 420 : envelope.display.inlineHeight);
  const [poppedOut, setPoppedOut] = React.useState(false);
  const handlePopoutChange = React.useCallback((nextPoppedOut: boolean) => {
    setPoppedOut(nextPoppedOut);
    onPopoutChange?.(nextPoppedOut);
  }, [onPopoutChange]);

  React.useImperativeHandle(forwardedRef, () => ({
    canPopout() {
      return Boolean(materialization?.scripts && executionSurfaceRef.current?.isNativeRunner());
    },
    async popout() {
      const target = executionSurfaceRef.current;
      if (!materialization?.scripts || !target?.isNativeRunner()) return false;
      const viewport = target.getViewport();
      return target.popout({
        title: materialization.title,
        width: Math.max(720, viewport.width),
        height: Math.max(520, viewport.height),
      });
    },
    async restore() {
      return executionSurfaceRef.current?.restore() ?? false;
    },
  }), [materialization]);

  React.useEffect(() => {
    let active = true;
    setMaterialization(null);
    setFailure(null);
    setReady(false);
    setPoppedOut(false);
    setMode(embeddedInWorkbench || installed ? 'inline' : envelope.display.preferred);
    lastSequenceRef.current = 0;
    lastHeartbeatRef.current = Date.now();
    executionLeaseRef.current = {
      id: createChannelId(),
      expiresAt: Date.now() + ARTIFACT_EXECUTION_LEASE_MS,
    };
    bridgeRateLimiter.reset();
    businessRequestsRef.current.clear();
    loadedOnceRef.current = false;
    recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'materializing' });
    if (runtime?.runtime.isVSCode || isRelayModeActive()) {
      setFailure('unsupported');
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      return () => { active = false; };
    }
    if (!installed && envelope.capabilities.scripts && mobileSurface) {
      setFailure('scripts-disabled');
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      return () => { active = false; };
    }
    const resolveArtifact = installed
      ? (tool || workbench
        ? getInstalledHTMLArtifactDescriptor(
          envelope.artifact,
          tool?.name ?? '',
          workbench ? { launchSource: 'workbench' } : undefined,
        ).then((descriptor): ResolvedHTMLArtifact => ({
          scripts: true,
          inlineHeight: descriptor.artifact.inlineHeight,
          allowExpand: descriptor.artifact.displayModes.length > 1,
          displayModes: descriptor.artifact.displayModes,
          documentPath: descriptor.documentPath,
          title: descriptor.artifact.title,
          extensionId: descriptor.extension.id,
          artifactId: descriptor.artifact.id,
        }))
        : Promise.reject(new Error('Installed HTML Artifact requires a Tool or Workbench context')))
      : materializeHTMLArtifact(envelope, sessionId).then((result): ResolvedHTMLArtifact => ({
        scripts: result.scripts,
        inlineHeight: result.inlineHeight,
        allowExpand: envelope.display.allowExpand,
        displayModes: envelope.display.allowExpand ? ['inline', 'workspace', 'fullscreen'] : [envelope.display.preferred],
        documentPath: result.documentPath,
        title: envelope.title,
      }));
    void resolveArtifact.then((result) => {
      if (active) {
        lastHeartbeatRef.current = Date.now();
        setMaterialization(result);
        setHeight(result.inlineHeight);
      }
    }).catch((nextError) => {
      if (active) {
        setFailure(classifyHTMLArtifactError(nextError));
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      }
    });
    return () => { active = false; };
  }, [
    attempt,
    bridgeRateLimiter,
    envelope,
    embeddedInWorkbench,
    installed,
    mobileSurface,
    runtime?.runtime.isVSCode,
    sessionId,
    tool,
    toolPartId,
    workbench,
  ]);

  const documentUrl = React.useMemo(() => materialization
    ? getRuntimeUrlResolver().authenticatedAsset(materialization.documentPath)
    : null, [materialization]);

  const sendHostInit = React.useCallback(() => {
    const target = executionSurfaceRef.current;
    if (!target) return;
    const { tokens, theme } = collectThemeContext(hostRef.current, themeVariant);
    const viewport = target.getViewport();
    target.postMessage(createHTMLArtifactHostInitMessage({
      channelId,
      mode,
      locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
      theme,
      tokens,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
      executionLease: {
        id: executionLeaseRef.current.id,
        expiresAt: executionLeaseRef.current.expiresAt,
        heartbeatIntervalMs: ARTIFACT_HEARTBEAT_INTERVAL_MS,
      },
      ...(installed && envelope.context !== undefined ? { context: envelope.context } : {}),
    }));
  }, [channelId, envelope, installed, locale, mode, themeVariant]);

  const handleArtifactMessage = React.useCallback((data: unknown, metadata: { userActivated: boolean }) => {
      if (!materialization?.scripts) return;
      const now = Date.now();
      if (!bridgeRateLimiter.allowMessage(now)) return;

      if (isHTMLArtifactBrokerNavigationMessage(data, channelId)) {
        setFailure('blocked');
        setReady(false);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
        return;
      }

      const message = parseHTMLArtifactBridgeMessage(data, channelId, lastSequenceRef.current, {
        allowBusiness: installed,
      });
      if (!message) return;
      lastSequenceRef.current = message.sequence;
      if (message.type === 'artifact.ready') {
        lastHeartbeatRef.current = now;
        setReady(true);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'rendered' });
        return;
      }
      if (message.type === 'artifact.heartbeat') {
        if (message.payload.leaseId === executionLeaseRef.current.id) lastHeartbeatRef.current = now;
        return;
      }
      if (message.type === 'artifact.resize') {
        if (!bridgeRateLimiter.allowResize(now)) return;
        if (!embeddedInWorkbench) {
          setHeight(Math.max(120, Math.min(900, message.payload.height)));
        }
        return;
      }
      if (message.type === 'artifact.requestExpand' && materialization.allowExpand) {
        if (embeddedInWorkbench) return;
        if (!metadata.userActivated && !hasRecentUserActivation()) return;
        if (!materialization.displayModes.includes(message.payload.mode)) return;
        setMode(message.payload.mode);
        return;
      }
      if (message.type === 'artifact.businessRequest') {
        const target = executionSurfaceRef.current;
        const respond = (result: Parameters<typeof createHTMLArtifactBusinessResultMessage>[0]) => {
          target?.postMessage(createHTMLArtifactBusinessResultMessage(result));
        };
        if (!installed || (!tool && !workbench) || !materialization.extensionId || !materialization.artifactId) {
          respond({
            channelId,
            requestId: message.payload.requestId,
            ok: false,
            error: 'Business API is unavailable for this Artifact',
            code: 'business_api_unavailable',
          });
          return;
        }
        if (businessRequestsRef.current.has(message.payload.requestId) || businessRequestsRef.current.size >= 4) {
          respond({
            channelId,
            requestId: message.payload.requestId,
            ok: false,
            error: 'Too many business requests',
            code: 'business_request_limited',
          });
          return;
        }
        businessRequestsRef.current.add(message.payload.requestId);
        void import('./artifactBusinessRequest').then(({ executeArtifactBusinessRequest }) => executeArtifactBusinessRequest({
          extensionId: materialization.extensionId!,
          artifactId: materialization.artifactId!,
          instanceId: channelId,
          action: message.payload.action,
          input: message.payload.input,
          intent: message.payload.intent,
          tool,
          workbench,
        })).then((result) => {
          respond({ channelId, requestId: message.payload.requestId, ...result });
        }).catch((requestError) => {
          respond({
            channelId,
            requestId: message.payload.requestId,
            ok: false,
            error: requestError instanceof Error ? requestError.message : 'Business request failed',
          });
        }).finally(() => {
          businessRequestsRef.current.delete(message.payload.requestId);
        });
        return;
      }
      if (message.type === 'artifact.dashboardEvent') {
        if (!installed || !onDashboardEmit) return;
        void onDashboardEmit(message.payload.eventId, message.payload.payload).catch((eventError) => {
          toast.error(eventError instanceof Error ? eventError.message : 'Dashboard event failed');
        });
        return;
      }
      if (message.type === 'artifact.proposeFollowUp') {
        if (!metadata.userActivated && !hasRecentUserActivation()) return;
        sessionEvents.requestComposerPrefill({ sessionId, text: message.payload.text });
        toast.info(t('interactiveUI.artifact.followUpPrepared'));
        return;
      }
      if (message.type === 'artifact.copyText') {
        if (!metadata.userActivated && !hasRecentUserActivation()) return;
        void copyTextToClipboard(message.payload.text);
        return;
      }
      if (message.type === 'artifact.openExternal') {
        if (!metadata.userActivated && !hasRecentUserActivation()) return;
        void openExternalUrl(message.payload.url);
        return;
      }
      if (message.type === 'artifact.reportError') {
        setFailure('crashed');
        setReady(false);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
        if (process.env.NODE_ENV === 'development') console.warn('HTML Artifact reported an error.', message.payload);
      }
  }, [
    bridgeRateLimiter,
    channelId,
    embeddedInWorkbench,
    installed,
    materialization,
    onDashboardEmit,
    sessionId,
    t,
    tool,
    toolPartId,
    workbench,
  ]);

  const handleArtifactLoad = React.useCallback(() => {
    if (loadedOnceRef.current) {
      setFailure('blocked');
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      return;
    }
    loadedOnceRef.current = true;
    if (materialization?.scripts) sendHostInit();
    else {
      setReady(true);
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'rendered' });
    }
  }, [materialization?.scripts, sendHostInit, sessionId, toolPartId]);

  const handleExecutionTerminated = React.useCallback((reason: string) => {
    setReady(false);
    setFailure(reason === 'stopped'
      ? 'stopped'
      : reason === 'lease-expired'
        ? 'timed-out'
        : reason === 'navigation-blocked'
          ? 'blocked'
          : 'crashed');
    businessRequestsRef.current.clear();
    recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
  }, [sessionId, toolPartId]);

  React.useEffect(() => {
    if (!materialization?.scripts || failure) return;
    const checkExecution = () => {
      const now = Date.now();
      if (now <= executionLeaseRef.current.expiresAt && now - lastHeartbeatRef.current <= ARTIFACT_HEARTBEAT_TIMEOUT_MS) return;
      setReady(false);
      setFailure('timed-out');
      businessRequestsRef.current.clear();
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
    };
    const timer = window.setInterval(checkExecution, ARTIFACT_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [failure, materialization?.scripts, sessionId, toolPartId]);

  React.useEffect(() => {
    if (!materialization?.scripts || !ready) return;
    const frame = window.requestAnimationFrame(sendHostInit);
    return () => window.cancelAnimationFrame(frame);
  }, [layoutEpoch, materialization?.scripts, mode, ready, sendHostInit]);

  const expanded = !embeddedInWorkbench && mode !== 'inline';
  const frameHeight = embeddedInWorkbench || expanded ? '100%' : `${height}px`;
  const state = failure ?? (ready ? 'ready' : materialization ? 'loading' : 'materializing');

  React.useLayoutEffect(() => {
    const dialog = hostRef.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (expanded) dialog.showModal();
    else dialog.show();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [expanded]);

  return (
    <dialog
      ref={hostRef}
      role={expanded ? 'dialog' : 'group'}
      aria-modal={expanded || undefined}
      data-ocix-artifact-host
      data-ocix-artifact-mode={mode}
      data-ocix-artifact-presentation={presentation}
      data-ocix-artifact-state={state}
      data-ocix-artifact-scripts={String(materialization?.scripts ?? generatedEnvelope?.capabilities.scripts ?? true)}
      data-ocix-artifact-source={installed ? 'third-party-extension' : 'agent-generated'}
      onCancel={(event) => {
        event.preventDefault();
        setMode('inline');
      }}
      className={cn(
        'ocix-artifact-dialog ocix-scope tool-output-surface relative m-0 min-w-0 w-full max-w-none overflow-hidden rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-0 text-inherit',
        embeddedInWorkbench && 'h-full rounded-none border-0',
        mode === 'workspace' && 'fixed left-[5vw] top-[8vh] flex h-[84vh] max-h-none w-[90vw] flex-col shadow-2xl',
        mode === 'fullscreen' && 'fixed inset-0 flex h-[100dvh] max-h-none w-screen flex-col rounded-none',
      )}
    >
      {!embeddedInWorkbench ? (
      <div className="flex min-h-12 items-start justify-between gap-3 border-b border-[var(--ocix-border)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="typography-ui-label font-semibold text-[var(--ocix-foreground)]">
              {materialization?.title ?? (installed ? envelope.artifact : envelope.title)}
            </h3>
            <span className="rounded-full border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] px-2 py-0.5 typography-micro text-[var(--ocix-muted-foreground)]">
              {installed
                ? t('interactiveUI.artifact.interactive')
                : envelope.capabilities.scripts
                  ? isElectronShell()
                    ? t('interactiveUI.artifact.interactive')
                    : `${t('interactiveUI.artifact.interactive')} · ${t('interactiveUI.artifact.experimental')}`
                  : t('interactiveUI.artifact.static')}
            </span>
          </div>
          {envelope.summary ? (
            <p className="mt-1 typography-meta text-[var(--ocix-muted-foreground)]" data-ocix-artifact-summary>
              {envelope.summary}
            </p>
          ) : null}
        </div>
        {(materialization?.scripts && !failure) || materialization?.allowExpand ? (
          <div className="flex shrink-0 items-center gap-1">
            {materialization?.scripts && !failure ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setReady(false);
                  setFailure('stopped');
                  businessRequestsRef.current.clear();
                  recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
                }}
                aria-label={t('interactiveUI.artifact.stop')}
                data-ocix-artifact-action="stop"
              >
                <Icon name="close-circle" />
              </Button>
            ) : null}
            {materialization?.allowExpand ? <>
            {mode !== 'fullscreen' ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setMode('fullscreen')}
                aria-label={t('interactiveUI.artifact.fullscreen')}
                data-ocix-artifact-action="fullscreen"
              >
                <Icon name="fullscreen" />
              </Button>
            ) : null}
            {expanded ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setMode('inline');
                }}
                aria-label={t('interactiveUI.artifact.exitExpanded')}
                data-ocix-artifact-action="inline"
              >
                <Icon name={mode === 'fullscreen' ? 'fullscreen-exit' : 'close'} />
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setMode('workspace')}
                aria-label={t('interactiveUI.artifact.workspace')}
                data-ocix-artifact-action="workspace"
              >
                <Icon name="expand-up-down" />
              </Button>
            )}
            </> : null}
          </div>
        ) : null}
      </div>
      ) : null}

      <div className={cn(
        'relative min-h-[120px] bg-transparent',
        expanded && 'min-h-0 flex-1',
        embeddedInWorkbench && 'h-full min-h-0',
      )}>
        {!materialization && !failure ? (
          <div className="space-y-3 p-4" aria-label={t('common.loading')} aria-busy="true">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : null}
        {failure ? (
          <div className="space-y-3 p-4">
            <HTMLArtifactStateNotice
              state={failure}
              onRetry={canRetryHTMLArtifactFailure(failure) ? () => setAttempt((value) => value + 1) : undefined}
            />
            <details
              data-ocix-artifact-fallback
              className="overflow-hidden rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)]"
            >
              <summary className="cursor-pointer px-3 py-2 typography-meta font-medium text-[var(--ocix-muted-foreground)] outline-none hover:bg-[var(--ocix-surface-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ocix-focus-ring)]">
                {t('interactiveUI.artifact.originalToolOutput')}
              </summary>
              <div className="max-h-80 overflow-auto border-t border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3">
                {fallback}
              </div>
            </details>
          </div>
        ) : null}
        {materialization && documentUrl && !failure ? (
          <>
            {!ready ? <Skeleton className="absolute inset-3 z-10" /> : null}
            <ArtifactExecutionSurface
              ref={executionSurfaceRef}
              title={materialization.title}
              url={documentUrl}
              scripts={materialization.scripts}
              ready={ready}
              layoutEpoch={layoutEpoch}
              className={cn('block w-full border-0 bg-transparent transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
              style={{ height: frameHeight, colorScheme: themeVariant }}
              onLoad={handleArtifactLoad}
              onMessage={handleArtifactMessage}
              onTerminated={handleExecutionTerminated}
              onPopoutChange={handlePopoutChange}
            />
            {poppedOut ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--ocix-surface)] p-6 text-center">
                <p className="typography-ui-caption text-[var(--ocix-muted-foreground)]">
                  {t('interactiveUI.artifact.poppedOut')}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </dialog>
  );
});

HTMLArtifactView.displayName = 'HTMLArtifactView';
