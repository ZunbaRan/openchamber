import type { McpUiResourcePermissions } from '@modelcontextprotocol/ext-apps';

export const MCP_APP_RESULT_SCHEMA = 'openchamber://mcp-app-result/v1' as const;

export interface McpAppBinding {
  server: string;
  tool: string;
  toolKey: string;
  resourceUri: string;
  meta: {
    resourceUri: string;
    visibility: Array<'model' | 'app'>;
    preferred?: {
      maxHeight?: number;
      border?: boolean;
      domain?: string;
    };
    csp?: {
      connectDomains?: string[];
      resourceDomains?: string[];
      frameDomains?: string[];
      baseUriDomains?: string[];
    };
    permissions?: McpUiResourcePermissions;
  };
}

export interface McpAppResultEnvelope {
  $schema: typeof MCP_APP_RESULT_SCHEMA;
  schemaVersion: 1;
  source: 'mcp-app';
  title: string;
  summary?: string;
  binding: McpAppBinding;
  arguments: Record<string, unknown>;
  result: {
    content: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    _meta?: Record<string, unknown>;
    isError?: boolean;
  };
}

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const strings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const next = value.filter((item): item is string => typeof item === 'string');
  return next.length === value.length ? next : undefined;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const normalizeMcpAppCspSource = (value: string): string | null => {
  const trimmed = value.trim();
  const wildcard = trimmed.match(/^https:\/\/\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i);
  if (wildcard) {
    const port = wildcard[2] ? Number(wildcard[2]) : null;
    if (port !== null && (port < 1 || port > 65_535)) return null;
    return `https://*.${wildcard[1].toLowerCase()}${wildcard[2] ? `:${wildcard[2]}` : ''}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
};

export const parseMcpAppBinding = (metadata: unknown): McpAppBinding | null => {
  const root = record(metadata);
  const app = record(root?.mcpApp);
  const meta = record(app?.meta);
  if (!app || !meta) return null;

  const server = typeof app.server === 'string' ? app.server : '';
  const tool = typeof app.tool === 'string' ? app.tool : '';
  const toolKey = typeof app.toolKey === 'string' ? app.toolKey : '';
  const resourceUri = typeof app.resourceUri === 'string' ? app.resourceUri : '';
  if (!server || !tool || !toolKey || !resourceUri.startsWith('ui://')) return null;

  const preferred = record(meta.preferred);
  const csp = record(meta.csp);
  const permissions = record(meta.permissions);
  const visibility = strings(meta.visibility);
  if (!visibility || visibility.some((value) => value !== 'model' && value !== 'app')) return null;

  return {
    server,
    tool,
    toolKey,
    resourceUri,
    meta: {
      resourceUri,
      visibility: visibility as Array<'model' | 'app'>,
      preferred: preferred
        ? {
            maxHeight: typeof preferred.maxHeight === 'number' ? preferred.maxHeight : undefined,
            border: typeof preferred.border === 'boolean' ? preferred.border : undefined,
            domain: typeof preferred.domain === 'string' ? preferred.domain : undefined,
          }
        : undefined,
      csp: csp
        ? {
            connectDomains: strings(csp.connectDomains),
            resourceDomains: strings(csp.resourceDomains),
            frameDomains: strings(csp.frameDomains),
            baseUriDomains: strings(csp.baseUriDomains),
          }
        : undefined,
      permissions: permissions
        ? {
            camera: record(permissions.camera) ?? undefined,
            microphone: record(permissions.microphone) ?? undefined,
            geolocation: record(permissions.geolocation) ?? undefined,
            clipboardWrite: record(permissions.clipboardWrite) ?? undefined,
          }
        : undefined,
    },
  };
};

export const createMcpAppResultEnvelope = (input: {
  binding: McpAppBinding;
  toolInput: unknown;
  toolOutput: string;
  metadata: unknown;
}): McpAppResultEnvelope => {
  const metadata = record(input.metadata);
  const structuredContent = metadata?.structuredContent;
  const resultMeta = record(metadata?.mcpResultMeta) ?? undefined;
  const argumentsValue = record(input.toolInput) ?? {};
  return {
    $schema: MCP_APP_RESULT_SCHEMA,
    schemaVersion: 1,
    source: 'mcp-app',
    title: input.binding.tool,
    summary: `MCP App from ${input.binding.server}`,
    binding: input.binding,
    arguments: argumentsValue,
    result: {
      content: input.toolOutput
        ? [{ type: 'text', text: input.toolOutput }]
        : [],
      structuredContent,
      _meta: resultMeta,
    },
  };
};
