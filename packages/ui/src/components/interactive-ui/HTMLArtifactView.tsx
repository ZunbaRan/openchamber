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
import { materializeHTMLArtifact, type HTMLArtifactMaterialization } from '@/lib/interactive-ui/client';
import type { HTMLArtifactDisplayMode, HTMLArtifactResultEnvelope } from '@/lib/interactive-ui/artifactResult';
import {
  canRetryHTMLArtifactFailure,
  classifyHTMLArtifactError,
  type HTMLArtifactFailureState,
} from '@/lib/interactive-ui/artifactState';
import {
  createHTMLArtifactBridgeRateLimiter,
  createHTMLArtifactHostInitMessage,
  isHTMLArtifactBrokerNavigationMessage,
  parseHTMLArtifactBridgeMessage,
} from '@/lib/interactive-ui/artifactBridge';
import { sessionEvents } from '@/lib/sessionEvents';
import { isRelayModeActive } from '@/lib/relay/runtime-tunnel';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { recordRoutingArtifactObservation } from '@/lib/interactive-ui/routingInspector';
import { HTMLArtifactStateNotice } from './HTMLArtifactStateNotice';

interface HTMLArtifactViewProps {
  envelope: HTMLArtifactResultEnvelope;
  fallback: React.ReactNode;
  sessionId?: string;
  toolPartId: string;
}

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

export const HTMLArtifactView: React.FC<HTMLArtifactViewProps> = ({ envelope, fallback, sessionId, toolPartId }) => {
  const { t, locale } = useI18n();
  const runtime = React.useContext(RuntimeAPIContext);
  const themeSystem = useOptionalThemeSystem();
  const themeVariant = themeSystem?.currentTheme.metadata.variant === 'dark' ? 'dark' : 'light';
  const mobileSurface = isMobileSurfaceRuntime();
  const hostRef = React.useRef<HTMLDialogElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const lastSequenceRef = React.useRef(0);
  const loadedOnceRef = React.useRef(false);
  const [channelId] = React.useState(createChannelId);
  const [bridgeRateLimiter] = React.useState(createHTMLArtifactBridgeRateLimiter);
  const [materialization, setMaterialization] = React.useState<HTMLArtifactMaterialization | null>(null);
  const [failure, setFailure] = React.useState<HTMLArtifactFailureState | null>(null);
  const [ready, setReady] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [mode, setMode] = React.useState<HTMLArtifactDisplayMode>(envelope.display.preferred);
  const [height, setHeight] = React.useState(envelope.display.inlineHeight);

  React.useEffect(() => {
    let active = true;
    setMaterialization(null);
    setFailure(null);
    setReady(false);
    lastSequenceRef.current = 0;
    bridgeRateLimiter.reset();
    loadedOnceRef.current = false;
    recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'materializing' });
    if (runtime?.runtime.isVSCode || isRelayModeActive()) {
      setFailure('unsupported');
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      return () => { active = false; };
    }
    if (envelope.capabilities.scripts && mobileSurface) {
      setFailure('scripts-disabled');
      recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
      return () => { active = false; };
    }
    void materializeHTMLArtifact(envelope, sessionId).then((result) => {
      if (active) {
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
  }, [attempt, bridgeRateLimiter, envelope, mobileSurface, runtime?.runtime.isVSCode, sessionId, t, toolPartId]);

  const documentUrl = React.useMemo(() => materialization
    ? getRuntimeUrlResolver().authenticatedAsset(materialization.documentPath)
    : null, [materialization]);

  const sendHostInit = React.useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    const { tokens, theme } = collectThemeContext(hostRef.current, themeVariant);
    target.postMessage(createHTMLArtifactHostInitMessage({
      channelId,
      mode,
      locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
      theme,
      tokens,
      viewport: {
        width: Math.max(0, Math.round(iframeRef.current?.clientWidth ?? 0)),
        height: Math.max(0, Math.round(iframeRef.current?.clientHeight ?? 0)),
      },
    }), '*');
  }, [channelId, locale, mode, themeVariant]);

  React.useEffect(() => {
    if (!materialization?.scripts) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const now = Date.now();
      if (!bridgeRateLimiter.allowMessage(now)) return;

      if (isHTMLArtifactBrokerNavigationMessage(event.data, channelId)) {
        setFailure('blocked');
        setReady(false);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
        return;
      }

      const message = parseHTMLArtifactBridgeMessage(event.data, channelId, lastSequenceRef.current);
      if (!message) return;
      lastSequenceRef.current = message.sequence;
      if (message.type === 'artifact.ready') {
        setReady(true);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'rendered' });
        return;
      }
      if (message.type === 'artifact.resize') {
        if (!bridgeRateLimiter.allowResize(now)) return;
        setHeight(Math.max(120, Math.min(900, message.payload.height)));
        return;
      }
      if (message.type === 'artifact.requestExpand' && envelope.display.allowExpand) {
        if (!hasRecentUserActivation()) return;
        setMode(message.payload.mode);
        return;
      }
      if (message.type === 'artifact.proposeFollowUp') {
        if (!hasRecentUserActivation()) return;
        sessionEvents.requestComposerPrefill({ sessionId, text: message.payload.text });
        toast.info(t('interactiveUI.artifact.followUpPrepared'));
        return;
      }
      if (message.type === 'artifact.copyText') {
        if (!hasRecentUserActivation()) return;
        void copyTextToClipboard(message.payload.text);
        return;
      }
      if (message.type === 'artifact.openExternal') {
        if (!hasRecentUserActivation()) return;
        void openExternalUrl(message.payload.url);
        return;
      }
      if (message.type === 'artifact.reportError') {
        setFailure('crashed');
        setReady(false);
        recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
        if (process.env.NODE_ENV === 'development') console.warn('HTML Artifact reported an error.', message.payload);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bridgeRateLimiter, channelId, envelope.display.allowExpand, materialization?.scripts, sessionId, t, toolPartId]);

  React.useEffect(() => {
    if (materialization?.scripts && ready) sendHostInit();
  }, [materialization?.scripts, mode, ready, sendHostInit]);

  const expanded = mode !== 'inline';
  const frameHeight = expanded ? '100%' : `${height}px`;
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
      data-ocix-artifact-state={state}
      data-ocix-artifact-scripts={String(envelope.capabilities.scripts)}
      onCancel={(event) => {
        event.preventDefault();
        setMode('inline');
      }}
      className={cn(
        'ocix-artifact-dialog ocix-scope tool-output-surface relative m-0 min-w-0 w-full max-w-none overflow-hidden rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-0 text-inherit',
        mode === 'workspace' && 'fixed left-[5vw] top-[8vh] flex h-[84vh] max-h-none w-[90vw] flex-col shadow-2xl',
        mode === 'fullscreen' && 'fixed inset-0 flex h-[100dvh] max-h-none w-screen flex-col rounded-none',
      )}
    >
      <div className="flex min-h-12 items-start justify-between gap-3 border-b border-[var(--ocix-border)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="typography-ui-label font-semibold text-[var(--ocix-foreground)]">{envelope.title}</h3>
            <span className="rounded-full border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] px-2 py-0.5 typography-micro text-[var(--ocix-muted-foreground)]">
              {envelope.capabilities.scripts
                ? `${t('interactiveUI.artifact.interactive')} · ${t('interactiveUI.artifact.experimental')}`
                : t('interactiveUI.artifact.static')}
            </span>
          </div>
          {envelope.summary ? (
            <p className="mt-1 typography-meta text-[var(--ocix-muted-foreground)]" data-ocix-artifact-summary>
              {envelope.summary}
            </p>
          ) : null}
        </div>
        {envelope.display.allowExpand && materialization ? (
          <div className="flex shrink-0 items-center gap-1">
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
          </div>
        ) : null}
      </div>

      <div className={cn('relative min-h-[120px] bg-transparent', expanded && 'min-h-0 flex-1')}>
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
            <iframe
              ref={iframeRef}
              title={envelope.title}
              src={documentUrl}
              sandbox={materialization.scripts ? 'allow-scripts' : ''}
              referrerPolicy="no-referrer"
              className={cn('block w-full border-0 bg-transparent transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
              style={{ height: frameHeight, colorScheme: themeVariant }}
              onLoad={() => {
                if (loadedOnceRef.current) {
                  setFailure('blocked');
                  recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'failed' });
                  return;
                }
                loadedOnceRef.current = true;
                if (materialization.scripts) sendHostInit();
                else {
                  setReady(true);
                  recordRoutingArtifactObservation({ sessionId, toolPartId, status: 'rendered' });
                }
              }}
            />
          </>
        ) : null}
      </div>
    </dialog>
  );
};
