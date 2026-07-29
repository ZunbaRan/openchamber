import React from 'react';
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { cn } from '@/lib/utils';
import {
  normalizeMcpAppCspSource,
  type McpAppResultEnvelope,
} from '@/lib/interactive-ui/mcpApp';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import {
  opencodeClient,
  type OpenCodeMcpAppResource,
} from '@/lib/opencode/client';

interface McpAppRendererProps {
  envelope: McpAppResultEnvelope;
  directory: string;
  sessionId: string;
  messageId: string;
  className?: string;
  fallback?: React.ReactNode;
}

interface McpAppResource extends Omit<OpenCodeMcpAppResource, 'meta'> {
  meta?: {
    csp?: {
      connectDomains?: string[];
      resourceDomains?: string[];
      frameDomains?: string[];
      baseUriDomains?: string[];
    };
    permissions?: McpAppResultEnvelope['binding']['meta']['permissions'];
    domain?: string;
    prefersBorder?: boolean;
  };
}

type McpAppToolCallResult = Awaited<
  ReturnType<NonNullable<AppBridge['oncalltool']>>
>;

const nonce = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

const csp = (
  envelope: McpAppResultEnvelope,
  resource: McpAppResource,
) => {
  const policy = resource.meta?.csp ?? envelope.binding.meta.csp;
  const sources = (values: string[] | undefined) => [
    ...new Set((values ?? []).map(normalizeMcpAppCspSource).filter((value): value is string => Boolean(value))),
  ];
  return [
    `default-src 'none'`,
    `script-src 'unsafe-inline' ${sources(policy?.resourceDomains).join(' ')}`.trim(),
    `style-src 'unsafe-inline' ${sources(policy?.resourceDomains).join(' ')}`.trim(),
    `img-src data: blob: ${sources(policy?.resourceDomains).join(' ')}`.trim(),
    `font-src data: ${sources(policy?.resourceDomains).join(' ')}`.trim(),
    `connect-src ${sources(policy?.connectDomains).join(' ') || "'none'"}`,
    `frame-src ${sources(policy?.frameDomains).join(' ') || "'none'"}`,
    `base-uri ${sources(policy?.baseUriDomains).join(' ') || "'none'"}`,
    `form-action 'none'`,
    `object-src 'none'`,
  ].join('; ');
};

const withResourceCsp = (html: string, policy: string) => {
  const escaped = policy
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escaped}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
};

const brokerDocument = (html: string, channelNonce: string) => {
  const encoded = JSON.stringify(html);
  const expected = JSON.stringify(channelNonce);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; frame-src 'self' data: blob:; style-src 'unsafe-inline';"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:transparent}body{overflow:hidden}</style></head><body><script>(()=>{"use strict";const expected=${expected},pendingApp=[];let authorized=false,listening=false,app=null;addEventListener("message",event=>{const data=event.data;if(event.source===parent){if(data&&data.source==="openchamber-mcp-host"){if(data.nonce!==expected)return;if(data.type==="host.init"){authorized=true;mount();return}if(data.type==="host.listening"){listening=true;for(const message of pendingApp.splice(0))parent.postMessage(message,"*");return}}if(!authorized||!app||!data||data.jsonrpc!=="2.0")return;app.contentWindow?.postMessage(data,"*");return}if(app&&event.source===app.contentWindow&&authorized&&data&&data.jsonrpc==="2.0"){if(listening)parent.postMessage(data,"*");else pendingApp.push(data)}});const mount=()=>{if(app)return;app=document.createElement("iframe");app.title="MCP App";app.setAttribute("sandbox","allow-scripts");app.srcdoc=${encoded};app.addEventListener("load",()=>parent.postMessage({source:"openchamber-mcp-broker",type:"broker.ready",nonce:expected},"*"),{once:true});document.body.append(app)}})();</script></body></html>`;
};

export const McpAppRenderer: React.FC<McpAppRendererProps> = ({
  envelope,
  directory,
  sessionId,
  messageId,
  className,
  fallback,
}) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [resource, setResource] = React.useState<McpAppResource | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(
    Math.min(1_200, Math.max(240, envelope.binding.meta.preferred?.maxHeight ?? 520)),
  );
  const initialHeightRef = React.useRef(height);
  const channelNonce = React.useMemo(nonce, [envelope.binding.resourceUri, messageId, attempt]);

  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setResource(null);
    void opencodeClient.getMcpAppResource({
      directory,
      sessionId,
      messageId,
      server: envelope.binding.server,
      resourceUri: envelope.binding.resourceUri,
      signal: controller.signal,
      force: attempt > 0,
    })
      .then((next) => setResource(next as McpAppResource))
      .catch((next) => {
        if (controller.signal.aborted) return;
        setError(next instanceof Error ? next.message : 'MCP App resource could not be loaded');
      });
    return () => controller.abort();
  }, [attempt, directory, envelope.binding.resourceUri, envelope.binding.server, messageId, sessionId]);

  React.useEffect(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !resource) return;

    let disposed = false;
    let bridge: AppBridge | null = null;
    let transport: PostMessageTransport | null = null;
    const onMessage = (event: MessageEvent) => {
      if (disposed || event.source !== target) return;
      if (event.origin !== 'null' && event.origin !== window.location.origin) return;
      const data = event.data;
      if (
        !data
        || data.source !== 'openchamber-mcp-broker'
        || data.type !== 'broker.ready'
        || data.nonce !== channelNonce
      ) return;

      bridge = new AppBridge(
        null,
        { name: 'OpenChamber', version: '1' },
        { serverTools: {} },
        {
          hostContext: {
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
            locale: document.documentElement.lang || navigator.language,
            displayMode: 'inline',
            availableDisplayModes: ['inline'],
            containerDimensions: {
              width: iframeRef.current?.clientWidth ?? 0,
              maxHeight: initialHeightRef.current,
            },
          },
        },
      );
      bridge.oncalltool = async (params) => {
        return await opencodeClient.callMcpAppTool({
          directory,
          sessionId,
          messageId,
          server: envelope.binding.server,
          resourceUri: envelope.binding.resourceUri,
          name: params.name,
          arguments: params.arguments ?? {},
        }) as McpAppToolCallResult;
      };
      bridge.onopenlink = async () => {
        throw new Error('MCP App external links are disabled by this host policy');
      };
      bridge.ondownloadfile = async () => {
        throw new Error('MCP App downloads are disabled by this host policy');
      };
      bridge.onrequestdisplaymode = async ({ mode }) => ({ mode: mode === 'fullscreen' ? 'inline' : mode });
      bridge.onsizechange = ({ height: nextHeight }) => {
        if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
          setHeight(Math.min(1_200, Math.max(160, Math.ceil(nextHeight))));
        }
      };
      bridge.oninitialized = () => {
        void bridge?.sendToolInput({ arguments: envelope.arguments })
          .then(() => bridge?.sendToolResult(
            envelope.result as Parameters<AppBridge['sendToolResult']>[0],
          ));
      };
      transport = new PostMessageTransport(target, target);
      const connected = bridge.connect(transport);
      target.postMessage({ source: 'openchamber-mcp-host', type: 'host.listening', nonce: channelNonce }, '*');
      void connected.catch((next) => {
        if (!disposed) setError(next instanceof Error ? next.message : 'MCP App bridge initialization failed');
      });
    };

    window.addEventListener('message', onMessage);
    target.postMessage({ source: 'openchamber-mcp-host', type: 'host.init', nonce: channelNonce }, '*');
    return () => {
      disposed = true;
      window.removeEventListener('message', onMessage);
      void bridge?.teardownResource({}, { timeout: 1_000 }).catch(() => {});
      void transport?.close().catch(() => {});
    };
  }, [channelNonce, directory, envelope, messageId, resource, sessionId]);

  if (error) {
    return (
      <div className={cn('tool-output-surface rounded-xl border border-destructive/50 p-4', className)}>
        <div className="font-medium text-destructive">MCP App unavailable</div>
        <div className="mt-1 text-sm text-muted-foreground">{error}</div>
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            <Icon name="refresh" className="mr-1.5 h-4 w-4" />
            retry
          </Button>
        </div>
        {fallback ? <div className="mt-3">{fallback}</div> : null}
      </div>
    );
  }

  if (!resource) {
    return <div className={cn('h-52 animate-pulse rounded-xl bg-muted/40', className)} />;
  }

  const html = withResourceCsp(resource.html, csp(envelope, resource));
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border/60 bg-background', className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
        <span className="font-medium">{envelope.title}</span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">MCP App</span>
      </div>
      <iframe
        ref={iframeRef}
        title={envelope.title}
        sandbox="allow-scripts"
        allow={buildAllowAttribute(
          resource.meta?.permissions ?? envelope.binding.meta.permissions ?? undefined,
        )}
        srcDoc={brokerDocument(html, channelNonce)}
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  );
};
