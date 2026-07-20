import React from 'react';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
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
import { DeclarativeInteractiveView } from './DeclarativeInteractiveView';
import { getRegisteredNativeView, loadNativeExtension } from './nativeRegistry';

interface InteractiveUIViewProps {
  envelope: InteractiveResultEnvelope;
  tool: InteractiveToolContext;
  fallback: React.ReactNode;
  isMobile: boolean;
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
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: Error) {
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

export const InteractiveUIView: React.FC<InteractiveUIViewProps> = ({ envelope, tool, fallback, isMobile }) => {
  const { t, locale } = useI18n();
  const runtime = React.useContext(RuntimeAPIContext);
  const [descriptor, setDescriptor] = React.useState<InteractiveViewDescriptor | null>(null);
  const [nativeComponent, setNativeComponent] = React.useState<NativeViewComponent | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [instanceId] = React.useState(createInstanceId);

  React.useEffect(() => {
    let active = true;
    setDescriptor(null);
    setNativeComponent(null);
    setError(null);
    void getInteractiveViewDescriptor(envelope.view, tool.name).then(async (next) => {
      if (!active) return;
      setDescriptor(next);
      if (next.view.runtime !== 'native') return;
      if (!next.native) throw new Error(`Native view ${next.view.id} is missing its bundle descriptor`);
      await loadNativeExtension(
        next.extension.id,
        next.extension.version,
        next.native.assetPath,
        next.native.exportName,
      );
      const component = getRegisteredNativeView(next.view.id);
      if (!component) throw new Error(`Native view ${next.view.id} was not registered during activation`);
      if (active) setNativeComponent(() => component);
    }).catch((nextError) => {
      if (active) setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
    });
    return () => { active = false; };
  }, [envelope.view, tool.name]);

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

  if (error) {
    return (
      <div className="space-y-2">
        {envelope.summary ? <div className="typography-meta text-foreground">{envelope.summary}</div> : null}
        <div className="rounded-xl border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-2 typography-meta text-[var(--status-error)]">
          {t('chat.toolPart.error')} {error.message}
        </div>
        {fallback}
      </div>
    );
  }

  if (!descriptor || !host || (descriptor.view.runtime === 'native' && !nativeComponent)) {
    return (
      <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3 typography-meta text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (descriptor.view.runtime === 'declarative' && descriptor.declarative) {
    return (
      <div className="tool-output-surface min-w-0 rounded-xl p-3">
        <DeclarativeInteractiveView definition={descriptor.declarative} envelope={envelope} host={host} />
      </div>
    );
  }

  if (descriptor.view.runtime === 'native' && nativeComponent) {
    const NativeComponent = nativeComponent;
    return (
      <NativeViewErrorBoundary fallback={fallback} resetKey={`${descriptor.extension.id}:${descriptor.extension.version}:${descriptor.view.id}`}>
        <div className="tool-output-surface min-w-0 rounded-xl p-3">
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
        </div>
      </NativeViewErrorBoundary>
    );
  }

  return <>{fallback}</>;
};
