import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReceiverSrcdoc,
  getWidgetIframeStyleBlock,
  invokeGenerativeWidgetSendMessage,
  resolveThemeVars,
  sanitizeForIframe,
  sanitizeForStreaming,
  getCachedWidgetHeight,
  setCachedWidgetHeight,
} from '@/lib/generative-widget';
import { openExternalUrl } from '@/lib/url';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';

export interface WidgetRendererProps {
  widgetCode: string;
  isStreaming: boolean;
  title?: string;
  showOverlay?: boolean;
}

const MAX_IFRAME_HEIGHT = 2000;
const STREAM_DEBOUNCE = 120;
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/;

const WidgetRendererInner: React.FC<WidgetRendererProps> = ({
  widgetCode,
  isStreaming,
  title,
  showOverlay,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef('');
  const heightLockedRef = useRef(false);
  const finalizedCodeRef = useRef('');
  const hasReceivedFirstHeight = useRef(getCachedWidgetHeight(widgetCode) > 0);

  const [iframeReady, setIframeReady] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(() => getCachedWidgetHeight(widgetCode) || 0);
  const [showCode, setShowCode] = useState(false);
  const [finalized, setFinalized] = useState(false);

  const hasCDN = useMemo(() => CDN_PATTERN.test(widgetCode), [widgetCode]);

  const srcdoc = useMemo(() => {
    const isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const resolvedVars = typeof document !== 'undefined' ? resolveThemeVars() : {};
    const styleBlock = getWidgetIframeStyleBlock(resolvedVars);
    return buildReceiverSrcdoc(styleBlock, isDark);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data.type !== 'string') return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      switch (event.data.type) {
        case 'widget:ready':
          setIframeReady(true);
          break;
        case 'widget:resize': {
          if (typeof event.data.height !== 'number' || event.data.height <= 0) break;
          const newH = Math.min(event.data.height, MAX_IFRAME_HEIGHT);
          if (heightLockedRef.current) {
            setIframeHeight((prev) => {
              const h = Math.max(prev, newH);
              setCachedWidgetHeight(widgetCode, h);
              return h;
            });
            break;
          }
          setCachedWidgetHeight(widgetCode, newH);
          if (!hasReceivedFirstHeight.current) {
            hasReceivedFirstHeight.current = true;
            const el = iframeRef.current;
            if (el) {
              el.style.transition = 'none';
              void el.offsetHeight;
            }
            setIframeHeight(newH);
            requestAnimationFrame(() => {
              if (el) el.style.transition = 'height 0.3s ease-out';
            });
          } else {
            setIframeHeight(newH);
          }
          break;
        }
        case 'widget:link': {
          const href = String(event.data.href || '');
          if (href && !/^\s*(javascript|data)\s*:/i.test(href)) {
            void openExternalUrl(href);
          }
          break;
        }
        case 'widget:sendMessage': {
          invokeGenerativeWidgetSendMessage(event.data.text);
          break;
        }
        case 'widget:publish': {
          window.dispatchEvent(
            new CustomEvent('widget-cross-publish', {
              detail: {
                topic: event.data.topic,
                data: event.data.data,
                sourceIframe: iframeRef.current,
              },
            }),
          );
          break;
        }
        case 'widget:scriptsReady':
          setFinalized(true);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [widgetCode]);

  const sendUpdate = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    if (html === lastSentRef.current) return;
    lastSentRef.current = html;
    iframe.contentWindow.postMessage({ type: 'widget:update', html }, '*');
  }, []);

  useEffect(() => {
    if (!isStreaming || !iframeReady) return;
    const sanitized = sanitizeForStreaming(widgetCode);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => sendUpdate(sanitized), STREAM_DEBOUNCE);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [widgetCode, isStreaming, iframeReady, sendUpdate]);

  useEffect(() => {
    if (isStreaming || !iframeReady) return;
    if (finalizedCodeRef.current === widgetCode) return;
    const sanitized = sanitizeForIframe(widgetCode);
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    finalizedCodeRef.current = widgetCode;
    lastSentRef.current = sanitized;
    heightLockedRef.current = true;
    iframe.contentWindow.postMessage({ type: 'widget:finalize', html: sanitized }, '*');
    const timer = setTimeout(() => {
      heightLockedRef.current = false;
      setFinalized(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [isStreaming, iframeReady, widgetCode]);

  useEffect(() => {
    if (!iframeReady) return;
    const observer = new MutationObserver(() => {
      const nowDark = document.documentElement.classList.contains('dark');
      const vars = resolveThemeVars();
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'widget:theme', vars, isDark: nowDark },
        '*',
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [iframeReady]);

  const showLoadingOverlay = hasCDN && !isStreaming && iframeReady && !finalized;
  const visibleTitle = title?.trim();

  return (
    <div
      className="group/widget relative my-1 rounded-xl bg-muted/20 p-4"
      style={{
        backgroundImage:
          'radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 8%, transparent) 0.8px, transparent 0.8px)',
        backgroundSize: '14px 14px',
      }}
    >
      <style>{`@keyframes widget-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <div className="mb-2 flex min-h-7 items-center gap-2">
        {visibleTitle ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {visibleTitle}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          onClick={() => setShowCode((value) => !value)}
          className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showCode ? 'Hide code' : 'Show code'}
        </button>
      </div>
      <div className="relative">
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          title={visibleTitle || 'Widget'}
          onLoad={() => setIframeReady(true)}
          style={{
            width: '100%',
            height: iframeHeight || (isStreaming ? 120 : 0),
            border: 'none',
            display: showCode ? 'none' : 'block',
            overflow: 'hidden',
            colorScheme: 'auto',
            borderRadius: 8,
          }}
        />

        {(showLoadingOverlay || showOverlay) && (
          <div
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--muted-foreground) 12%, transparent) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'widget-shimmer 1.5s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {showCode ? (
        <pre className="max-h-80 overflow-auto rounded-lg border border-border/30 bg-background/60 p-3 text-xs">
          <code>{widgetCode}</code>
        </pre>
      ) : null}
    </div>
  );
};

export const WidgetRenderer: React.FC<WidgetRendererProps> = (props) => (
  <WidgetErrorBoundary>
    <WidgetRendererInner {...props} />
  </WidgetErrorBoundary>
);
