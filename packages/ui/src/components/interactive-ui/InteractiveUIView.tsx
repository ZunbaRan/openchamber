import React from 'react';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { toast } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  getInteractiveViewDescriptor,
  InteractiveUIRequestError,
  invokeInteractiveAction,
} from '@/lib/interactive-ui/client';
import type {
  InteractiveConfirmation,
  InteractiveResultEnvelope,
  InteractiveToolContext,
  InteractiveViewDescriptor,
  InteractiveViewHost,
  NativeViewComponent,
} from '@/lib/interactive-ui/types';
import { classifyInteractiveUIError } from '@/lib/interactive-ui/state';
import { DeclarativeInteractiveView } from './DeclarativeInteractiveView';
import { InteractiveUIStateNotice } from './InteractiveUIStateNotice';
import { getRegisteredNativeView, loadNativeExtension } from './nativeRegistry';
import { recordRoutingViewObservation } from '@/lib/interactive-ui/routingInspector';

interface InteractiveUIViewProps {
  envelope: InteractiveResultEnvelope;
  tool: InteractiveToolContext;
  fallback: React.ReactNode;
  isMobile: boolean;
  traceContext?: {
    sessionId?: string;
    toolPartId: string;
  };
}

const confirmInBrowser = async (options: InteractiveConfirmation): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  const message = [options.title, options.description].filter(Boolean).join('\n\n');
  return window.confirm(message);
};

class NativeViewErrorBoundary extends React.Component<{
  fallback: React.ReactNode;
  resetKey: string;
  children: React.ReactNode;
  onError?: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: Error) {
    this.props.onError?.();
    if (process.env.NODE_ENV === 'development') console.warn('Interactive UI native view failed.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const createInstanceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ocix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const InteractiveUIView: React.FC<InteractiveUIViewProps> = ({ envelope, tool, fallback, isMobile, traceContext }) => {
  const { t, locale } = useI18n();
  const runtime = React.useContext(RuntimeAPIContext);
  const [descriptor, setDescriptor] = React.useState<InteractiveViewDescriptor | null>(null);
  const [nativeComponent, setNativeComponent] = React.useState<NativeViewComponent | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [descriptorAttempt, setDescriptorAttempt] = React.useState(0);
  const [instanceId] = React.useState(createInstanceId);

  React.useEffect(() => {
    let active = true;
    setDescriptor(null);
    setNativeComponent(null);
    setError(null);
    recordRoutingViewObservation({
      sessionId: traceContext?.sessionId,
      toolPartId: traceContext?.toolPartId ?? tool.id,
      viewId: envelope.view,
      status: 'loading',
    });
    void getInteractiveViewDescriptor(envelope.view, tool.name).then(async (next) => {
      if (!active) return;
      setDescriptor(next);
      if (next.view.runtime !== 'native') {
        recordRoutingViewObservation({
          sessionId: traceContext?.sessionId,
          toolPartId: traceContext?.toolPartId ?? tool.id,
          viewId: envelope.view,
          status: 'rendered',
        });
        return;
      }
      if (!next.native) throw new Error(`Native view ${next.view.id} is missing its bundle descriptor`);
      await loadNativeExtension(
        next.extension.id,
        next.extension.version,
        next.native.assetPath,
        next.native.exportName,
      );
      const component = getRegisteredNativeView(next.view.id);
      if (!component) throw new Error(`Native view ${next.view.id} was not registered during activation`);
      if (active) {
        setNativeComponent(() => component);
        recordRoutingViewObservation({
          sessionId: traceContext?.sessionId,
          toolPartId: traceContext?.toolPartId ?? tool.id,
          viewId: envelope.view,
          status: 'rendered',
        });
      }
    }).catch((nextError) => {
      if (active) {
        setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
        recordRoutingViewObservation({
          sessionId: traceContext?.sessionId,
          toolPartId: traceContext?.toolPartId ?? tool.id,
          viewId: envelope.view,
          status: 'failed',
        });
      }
    });
    return () => { active = false; };
  }, [descriptorAttempt, envelope.view, tool.id, tool.name, traceContext?.sessionId, traceContext?.toolPartId]);

  const host = React.useMemo<InteractiveViewHost | null>(() => {
    if (!descriptor) return null;
    const invoke = <TOutput,>(action: string, input: unknown, confirmed = false) => invokeInteractiveAction<TOutput>({
      extensionId: descriptor.extension.id,
      viewId: descriptor.view.id,
      instanceId,
      action,
      input,
      tool: { id: tool.id, name: tool.name },
      ...(confirmed ? { confirmed: true } : {}),
    });
    return {
      apiVersion: 1,
      business: {
        query: <TOutput,>(action: string, input: unknown) => invoke<TOutput>(action, input),
        execute: async <TOutput,>(action: string, input: unknown) => {
          try {
            return await invoke<TOutput>(action, input);
          } catch (actionError) {
            if (!(actionError instanceof InteractiveUIRequestError) || !actionError.payload.confirmationRequired) throw actionError;
            const confirmed = await confirmInBrowser(actionError.payload.confirmation ?? {});
            if (!confirmed) throw new Error(actionError.payload.error || 'Action cancelled');
            return invoke<TOutput>(action, input, true);
          }
        },
      },
      dialog: { confirm: confirmInBrowser },
      notifications: {
        show(input) {
          if (input.tone === 'error') toast.error(input.message);
          else if (input.tone === 'success') toast.success(input.message);
          else toast.info(input.message);
        },
      },
      context: {
        runtime: runtime?.runtime.platform ?? 'web',
        locale,
      },
    };
  }, [descriptor, instanceId, locale, runtime?.runtime.platform, tool.id, tool.name]);

  const hostMetadata = descriptor ? (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--ocix-border)] pt-2 typography-micro text-[var(--ocix-muted-foreground)]" data-ocix-view-metadata>
      <span className="max-w-48 truncate" title={descriptor.extension.name}>{descriptor.extension.name}</span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <span className={cn('size-1.5 rounded-full', envelope.mode === 'live' ? 'bg-[var(--ocix-success)]' : 'bg-[var(--ocix-muted-foreground)]')} aria-hidden="true" />
        {envelope.mode === 'live' ? t('interactiveUI.host.live') : t('interactiveUI.host.snapshot')}
      </span>
      {envelope.dataRef?.connector ? <><span aria-hidden="true">·</span><code className="max-w-48 truncate" title={envelope.dataRef.connector}>{envelope.dataRef.connector}</code></> : null}
      {envelope.updatedAt ? <><span aria-hidden="true">·</span><time dateTime={envelope.updatedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(envelope.updatedAt))}</time></> : null}
    </div>
  ) : null;
  const fallbackDisclosure = (
    <details className="overflow-hidden rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)]" data-ocix-view-fallback>
      <summary className="cursor-pointer px-3 py-2 typography-meta font-medium text-[var(--ocix-muted-foreground)] outline-none hover:bg-[var(--ocix-surface-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ocix-focus-ring)]">
        {t('interactiveUI.artifact.originalToolOutput')}
      </summary>
      <div className="max-h-80 overflow-auto border-t border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3">
        {fallback}
      </div>
    </details>
  );

  if (error) {
    return (
      <div className="ocix-scope space-y-2">
        {envelope.summary ? <div className="typography-meta text-[var(--ocix-muted-foreground)]" data-ocix-view-summary>{envelope.summary}</div> : null}
        <InteractiveUIStateNotice
          state={classifyInteractiveUIError(error)}
          onRetry={() => setDescriptorAttempt((value) => value + 1)}
        />
        {fallbackDisclosure}
      </div>
    );
  }

  if (!descriptor || !host || (descriptor.view.runtime === 'native' && !nativeComponent)) {
    return (
      <div className="ocix-scope space-y-3 rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3" aria-label={t('common.loading')} aria-busy="true">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }

  if (descriptor.view.runtime === 'declarative' && descriptor.declarative) {
    return (
      <div className="ocix-scope tool-output-surface min-w-0 space-y-3 rounded-xl p-3">
        {envelope.summary ? <div className="typography-meta text-[var(--ocix-muted-foreground)]" data-ocix-view-summary>{envelope.summary}</div> : null}
        <DeclarativeInteractiveView definition={descriptor.declarative} envelope={envelope} host={host} />
        {hostMetadata}
      </div>
    );
  }

  if (descriptor.view.runtime === 'native' && nativeComponent) {
    const NativeComponent = nativeComponent;
    return (
      <NativeViewErrorBoundary
        fallback={fallback}
        resetKey={`${descriptor.extension.id}:${descriptor.extension.version}:${descriptor.view.id}`}
        onError={() => recordRoutingViewObservation({
          sessionId: traceContext?.sessionId,
          toolPartId: traceContext?.toolPartId ?? tool.id,
          viewId: descriptor.view.id,
          status: 'failed',
        })}
      >
        <div className="ocix-scope tool-output-surface min-w-0 space-y-3 rounded-xl p-3">
          {envelope.summary ? <div className="typography-meta text-[var(--ocix-muted-foreground)]" data-ocix-view-summary>{envelope.summary}</div> : null}
          <NativeComponent
            instanceId={instanceId}
            extensionId={descriptor.extension.id}
            viewId={descriptor.view.id}
            status="completed"
            context={envelope.context}
            snapshot={envelope.data}
            dataRef={envelope.dataRef}
            tool={tool}
            display={{ mode: 'inline', mobile: isMobile }}
            host={host}
          />
          {hostMetadata}
        </div>
      </NativeViewErrorBoundary>
    );
  }

  return <>{fallback}</>;
};
