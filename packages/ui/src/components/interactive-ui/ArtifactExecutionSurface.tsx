import React from 'react';
import { canUseElectronDesktopIPC, invokeDesktop, listenDesktopEvent } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import {
  resolveArtifactRunnerGeometry,
  resolveArtifactRunnerVisibility,
  scrollArtifactBoundaryCandidates,
  type ArtifactRunnerClipRegion,
  type ArtifactRunnerGeometry,
  type ArtifactRunnerRect,
} from './artifactRunnerGeometry';

export interface ArtifactExecutionSurfaceHandle {
  postMessage(message: unknown): void;
  getViewport(): { width: number; height: number };
  popout(options?: { title?: string; width?: number; height?: number }): Promise<boolean>;
  restore(): Promise<boolean>;
  isNativeRunner(): boolean;
}

interface ArtifactExecutionSurfaceProps {
  url: string;
  title: string;
  scripts: boolean;
  ready: boolean;
  layoutEpoch?: string | number;
  className?: string;
  style?: React.CSSProperties;
  onLoad(): void;
  onMessage(message: unknown, metadata: { userActivated: boolean }): void;
  onTerminated(reason: string): void;
  onPopoutChange?(poppedOut: boolean): void;
}

type RunnerEvent = {
  runnerId: string;
  type: 'loaded' | 'message' | 'terminated' | 'popout-opened' | 'popout-closed' | 'wheel-boundary';
  message?: unknown;
  userActivated?: boolean;
  reason?: string;
  deltaX?: number;
  deltaY?: number;
};

const asRunnerEvent = (value: unknown): RunnerEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (typeof event.runnerId !== 'string'
    || !['loaded', 'message', 'terminated', 'popout-opened', 'popout-closed', 'wheel-boundary'].includes(String(event.type))) {
    return null;
  }
  return event as unknown as RunnerEvent;
};

const CLIPPING_OVERFLOW = new Set(['auto', 'clip', 'hidden', 'scroll']);
const NATIVE_SURFACE_OCCLUDER_SELECTOR = '[data-oc-native-surface-occluder="true"]';

const asRect = (rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>): ArtifactRunnerRect => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

const collectClippingAncestors = (element: HTMLElement): HTMLElement[] => {
  const ancestors: HTMLElement[] = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (CLIPPING_OVERFLOW.has(style.overflowX) || CLIPPING_OVERFLOW.has(style.overflowY)) ancestors.push(ancestor);
    // A viewport-fixed workbench tile has escaped the board's scrolling
    // containing block. Preserve clipping inside the focused tile itself, but
    // do not intersect the native Runner with stale overflow ancestors above
    // that fixed boundary.
    if (style.position === 'fixed') break;
  }
  return ancestors;
};

const scrollArtifactBoundary = (element: HTMLElement, event: RunnerEvent): void => {
  const candidates = collectClippingAncestors(element).filter((ancestor) => {
    const style = window.getComputedStyle(ancestor);
    return style.overflowX === 'auto' || style.overflowX === 'scroll'
      || style.overflowY === 'auto' || style.overflowY === 'scroll';
  });
  const root = document.scrollingElement;
  if (root instanceof HTMLElement && !candidates.includes(root)) candidates.push(root);
  scrollArtifactBoundaryCandidates(candidates, {
    deltaX: Number(event.deltaX) || 0,
    deltaY: Number(event.deltaY) || 0,
  });
};

const measureNativeRunner = (element: HTMLElement): ArtifactRunnerGeometry => {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const clipRegions: ArtifactRunnerClipRegion[] = [{
    rect: { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight },
    clipX: true,
    clipY: true,
  }];
  for (const ancestor of collectClippingAncestors(element)) {
    const style = window.getComputedStyle(ancestor);
    const rect = ancestor.getBoundingClientRect();
    const left = rect.left + ancestor.clientLeft;
    const top = rect.top + ancestor.clientTop;
    clipRegions.push({
      rect: {
        left,
        top,
        right: left + ancestor.clientWidth,
        bottom: top + ancestor.clientHeight,
      },
      clipX: CLIPPING_OVERFLOW.has(style.overflowX),
      clipY: CLIPPING_OVERFLOW.has(style.overflowY),
    });
  }
  return resolveArtifactRunnerGeometry(asRect(element.getBoundingClientRect()), clipRegions);
};

const isElementAllowedVisible = (element: HTMLElement): boolean => {
  const ownDialog = element.closest('dialog');
  const blockingNativeDialogOpen = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open][aria-modal="true"]'))
    .some((dialog) => dialog !== ownDialog);
  const ownNativeSurfaceOccluder = element.closest(NATIVE_SURFACE_OCCLUDER_SELECTOR);
  const blockingNativeSurfaceOccluder = Array.from(
    document.querySelectorAll<HTMLElement>(NATIVE_SURFACE_OCCLUDER_SELECTOR),
  ).some((occluder) => occluder !== ownNativeSurfaceOccluder && !occluder.contains(element));
  const focusedWorkbenchTile = document.querySelector<HTMLElement>(
    '[data-workbench-tile][aria-modal="true"]',
  );
  const obscuredByFocusedWorkbenchTile = Boolean(
    focusedWorkbenchTile && !focusedWorkbenchTile.contains(element),
  );
  return resolveArtifactRunnerVisibility({
    documentVisible: document.visibilityState === 'visible',
    baseDialogOpen: document.documentElement.classList.contains('oc-dialog-open'),
    blockingNativeDialogOpen: blockingNativeDialogOpen || obscuredByFocusedWorkbenchTile,
    blockingNativeSurfaceOccluder,
  });
};

export const ArtifactExecutionSurface = React.forwardRef<ArtifactExecutionSurfaceHandle, ArtifactExecutionSurfaceProps>(({
  url,
  title,
  scripts,
  ready,
  layoutEpoch,
  className,
  style,
  onLoad,
  onMessage,
  onTerminated,
  onPopoutChange,
}, ref) => {
  const elementRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const runnerIdRef = React.useRef<string | null>(null);
  const readyRef = React.useRef(ready);
  const onLoadRef = React.useRef(onLoad);
  const onMessageRef = React.useRef(onMessage);
  const onTerminatedRef = React.useRef(onTerminated);
  const onPopoutChangeRef = React.useRef(onPopoutChange);
  const pendingEventsRef = React.useRef<RunnerEvent[]>([]);
  const lastNativeUpdateRef = React.useRef('');
  const [nativeRunner, setNativeRunner] = React.useState(scripts && canUseElectronDesktopIPC());
  const [runnerStarted, setRunnerStarted] = React.useState(false);
  readyRef.current = ready;
  onLoadRef.current = onLoad;
  onMessageRef.current = onMessage;
  onTerminatedRef.current = onTerminated;
  onPopoutChangeRef.current = onPopoutChange;

  const postNativeUpdate = React.useCallback(() => {
    const element = elementRef.current;
    const runnerId = runnerIdRef.current;
    if (!element || !runnerId) return;
    const geometry = measureNativeRunner(element);
    const visible = readyRef.current && geometry.visible && isElementAllowedVisible(element);
    const updateKey = JSON.stringify([geometry.bounds, geometry.clipBounds, visible]);
    if (lastNativeUpdateRef.current === updateKey) return;
    lastNativeUpdateRef.current = updateKey;
    void invokeDesktop('desktop_artifact_runner_update', {
      runnerId,
      bounds: geometry.bounds,
      clipBounds: geometry.clipBounds,
      visible,
    }).catch(() => {
      if (lastNativeUpdateRef.current === updateKey) lastNativeUpdateRef.current = '';
    });
  }, []);

  React.useImperativeHandle(ref, () => ({
    postMessage(message) {
      if (runnerIdRef.current) {
        void invokeDesktop('desktop_artifact_runner_post', { runnerId: runnerIdRef.current, message }).catch(() => undefined);
      } else {
        iframeRef.current?.contentWindow?.postMessage(message, '*');
      }
    },
    getViewport() {
      const element = elementRef.current ?? iframeRef.current;
      return { width: Math.max(0, Math.round(element?.clientWidth ?? 0)), height: Math.max(0, Math.round(element?.clientHeight ?? 0)) };
    },
    async popout(options) {
      const runnerId = runnerIdRef.current;
      if (!nativeRunner || !runnerId) return false;
      const result = await invokeDesktop<{ opened?: boolean; poppedOut?: boolean }>(
        'desktop_artifact_runner_popout',
        { runnerId, ...options },
      );
      return result?.poppedOut === true;
    },
    async restore() {
      const runnerId = runnerIdRef.current;
      if (!nativeRunner || !runnerId) return false;
      const result = await invokeDesktop<{ restored?: boolean; poppedOut?: boolean }>(
        'desktop_artifact_runner_restore',
        { runnerId },
      );
      return result?.restored === true || result?.poppedOut === false;
    },
    isNativeRunner() {
      return nativeRunner && Boolean(runnerIdRef.current);
    },
  }), [nativeRunner]);

  React.useEffect(() => {
    if (!nativeRunner) return;
    let active = true;
    let unlisten: () => void = () => undefined;
    const dispatch = (event: RunnerEvent) => {
      if (event.type === 'loaded') onLoadRef.current();
      else if (event.type === 'message') onMessageRef.current(event.message, { userActivated: event.userActivated === true });
      else if (event.type === 'terminated') onTerminatedRef.current(event.reason || 'terminated');
      else if (event.type === 'popout-opened') onPopoutChangeRef.current?.(true);
      else if (event.type === 'popout-closed') onPopoutChangeRef.current?.(false);
      else if (event.type === 'wheel-boundary' && elementRef.current) scrollArtifactBoundary(elementRef.current, event);
    };
    void listenDesktopEvent('openchamber:artifact-runner-event', (payload) => {
      const event = asRunnerEvent(payload);
      if (!active || !event) return;
      if (!runnerIdRef.current) {
        pendingEventsRef.current.push(event);
        return;
      }
      if (event.runnerId === runnerIdRef.current) dispatch(event);
    }).then((stopListening) => {
      if (!active) stopListening();
      else unlisten = stopListening;
    }).catch(() => { setNativeRunner(false); });

    const start = async () => {
      const element = elementRef.current;
      if (!element) return;
      const geometry = measureNativeRunner(element);
      try {
        const result = await invokeDesktop<{ id?: string }>('desktop_artifact_runner_start', {
          url,
          bounds: geometry.bounds,
          clipBounds: geometry.clipBounds,
          visible: false,
        });
        if (!active || typeof result?.id !== 'string') {
          if (result?.id) void invokeDesktop('desktop_artifact_runner_stop', { runnerId: result.id }).catch(() => undefined);
          if (active) setNativeRunner(false);
          return;
        }
        runnerIdRef.current = result.id;
        lastNativeUpdateRef.current = '';
        setRunnerStarted(true);
        for (const event of pendingEventsRef.current.splice(0)) {
          if (event.runnerId === result.id) dispatch(event);
        }
        postNativeUpdate();
      } catch {
        if (active) setNativeRunner(false);
      }
    };
    void start();
    return () => {
      active = false;
      unlisten();
      pendingEventsRef.current = [];
      const runnerId = runnerIdRef.current;
      runnerIdRef.current = null;
      lastNativeUpdateRef.current = '';
      if (runnerId) void invokeDesktop('desktop_artifact_runner_stop', { runnerId }).catch(() => undefined);
    };
  }, [nativeRunner, postNativeUpdate, url]);

  React.useLayoutEffect(() => {
    if (!nativeRunner || !runnerStarted || !elementRef.current || !runnerIdRef.current) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        postNativeUpdate();
      });
    };
    const scheduleSettledLayout = () => {
      lastNativeUpdateRef.current = '';
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(elementRef.current);
    const clippingAncestors = collectClippingAncestors(elementRef.current);
    for (const ancestor of clippingAncestors) observer.observe(ancestor);
    const modalObserver = new MutationObserver(schedule);
    modalObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    modalObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['open', 'aria-modal', 'data-oc-native-surface-occluder'],
    });
    const layoutObserver = new MutationObserver(schedule);
    const scrollContainer = clippingAncestors.at(0);
    if (scrollContainer) {
      layoutObserver.observe(scrollContainer, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('blur', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    const settleTimer = window.setTimeout(scheduleSettledLayout, 180);
    return () => {
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      modalObserver.disconnect();
      layoutObserver.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('blur', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [layoutEpoch, nativeRunner, postNativeUpdate, ready, runnerStarted]);

  React.useEffect(() => {
    if (nativeRunner || !scripts) return;
    const receive = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow) onMessageRef.current(event.data, { userActivated: false });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [nativeRunner, scripts]);

  if (nativeRunner) {
    return <div ref={elementRef} role="group" aria-label={title} className={cn('block w-full bg-transparent', className)} style={style} data-ocix-artifact-backend="desktop-runner" />;
  }
  return (
    <iframe
      ref={iframeRef}
      title={title}
      src={url}
      sandbox={scripts ? 'allow-scripts' : ''}
      referrerPolicy="no-referrer"
      className={className}
      style={style}
      data-ocix-artifact-backend="browser-iframe"
      onLoad={() => onLoadRef.current()}
    />
  );
});

ArtifactExecutionSurface.displayName = 'ArtifactExecutionSurface';
