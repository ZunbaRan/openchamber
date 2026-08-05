import type {
  McpUiResourcePermissions,
  McpUiUpdateModelContextRequest,
} from '@modelcontextprotocol/ext-apps';
import type { ToolPart } from '@opencode-ai/sdk/v2';

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

export type McpAppModelContextUpdate = McpUiUpdateModelContextRequest['params'];

export const MCP_APP_MODEL_CONTEXT_CONTENT_METADATA_KEY = 'mcpAppModelContextContent' as const;
export const MCP_APP_MODEL_CONTEXT_OUTPUT_LIMIT_BYTES = 128 * 1024;

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

const textContentBlocks = (value: unknown): Array<{ type: 'text'; text: string }> | null => {
  if (!Array.isArray(value)) return null;
  const blocks: Array<{ type: 'text'; text: string }> = [];
  for (const item of value) {
    const block = record(item);
    if (block?.type !== 'text' || typeof block.text !== 'string') return null;
    blocks.push({ type: 'text', text: block.text });
  }
  return blocks;
};

const projectMcpAppModelContextOutput = (
  content: Array<{ type: 'text'; text: string }>,
  structuredContent: unknown,
) => {
  const sections = content.map((block) => block.text);
  if (structuredContent !== undefined) {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(structuredContent);
    } catch {
      throw new Error('MCP App structured model context must be JSON serializable');
    }
    if (serialized === undefined) {
      throw new Error('MCP App structured model context must be JSON serializable');
    }
    sections.push(`Structured content:\n${serialized}`);
  }
  const output = sections.join('\n\n');
  if (new TextEncoder().encode(output).byteLength > MCP_APP_MODEL_CONTEXT_OUTPUT_LIMIT_BYTES) {
    throw new Error('MCP App model context exceeds the host limit');
  }
  return output;
};

export const canRenderMcpAppToolState = (status: string) => (
  status === 'running' || status === 'completed'
);

export type McpAppToolLifecycleStatus = 'running' | 'completed' | 'cancelled';

/**
 * OpenCode represents interrupted tool calls as an error ToolState. Preserve
 * only explicit cancellation signals so ordinary tool failures keep their
 * existing text fallback while a previously displayed MCP App can receive the
 * required, exactly-once tool-cancelled notification before teardown.
 */
export const resolveMcpAppToolLifecycleStatus = (input: {
  status: string;
  metadata?: unknown;
  error?: unknown;
}): McpAppToolLifecycleStatus | null => {
  if (input.status === 'running' || input.status === 'completed') return input.status;
  if (input.status !== 'error') return null;
  const metadata = record(input.metadata);
  const explicitlyCancelled = metadata?.interrupted === true
    || metadata?.cancelled === true
    || metadata?.canceled === true;
  const error = typeof input.error === 'string' ? input.error : '';
  return explicitlyCancelled || /\b(?:abort(?:ed)?|cancel(?:led|ed)?|interrupt(?:ed)?)\b/i.test(error)
    ? 'cancelled'
    : null;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Offline MCP Apps declare bare scheme sources for embedded icons/fonts and
// about:blank helper frames. These are never network origins.
const LOCAL_SCHEME_SOURCES = new Set(['data:', 'blob:', 'about:']);

export const normalizeMcpAppCspSource = (value: string): string | null => {
  const trimmed = value.trim();
  if (LOCAL_SCHEME_SOURCES.has(trimmed)) return trimmed;
  const wildcard = trimmed.match(/^https:\/\/\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i);
  if (wildcard) {
    const port = wildcard[2] ? Number(wildcard[2]) : null;
    if (port !== null && (port < 1 || port > 65_535)) return null;
    return `https://*.${wildcard[1].toLowerCase()}${wildcard[2] ? `:${wildcard[2]}` : ''}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    // A bare `*` host is a wildcard for every domain and must never be
    // accepted (plan §6.3, AUD-004). Only the bounded `https://*.host`
    // subdomain form above is allowed.
    if (url.hostname === '*') return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
};

// MCP Apps commonly keep a live editor in sync over WebSocket. Resource
// directives intentionally remain HTTPS-only, while connect-src may opt into
// secure WebSockets (or loopback ws:// during local development).
export const normalizeMcpAppConnectCspSource = (value: string): string | null => {
  const trimmed = value.trim();
  // Scheme-only sources are never valid for connect-src network traffic.
  if (LOCAL_SCHEME_SOURCES.has(trimmed)) return null;

  const normalizedHttp = normalizeMcpAppCspSource(value);
  if (normalizedHttp) return normalizedHttp;

  const wildcard = trimmed.match(/^wss:\/\/\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i);
  if (wildcard) {
    const port = wildcard[2] ? Number(wildcard[2]) : null;
    if (port !== null && (port < 1 || port > 65_535)) return null;
    return `wss://*.${wildcard[1].toLowerCase()}${wildcard[2] ? `:${wildcard[2]}` : ''}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.hostname === '*') return null;
    if (url.protocol === 'wss:') return url.origin;
    if (url.protocol === 'ws:' && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
};

export const parseMcpAppBinding = (metadata: unknown): McpAppBinding | null => {
  const root = record(metadata);
  const persistedResult = record(root?.mcpResult);
  // OpenCode preserves the App binding on failed MCP results so history and
  // diagnostics retain their origin. A failed Tool result is not a renderable
  // App instance, however: mounting it produces an empty canvas and can issue a
  // resource request for a session/message that never acquired an App binding.
  if (root?.mcpIsError === true || persistedResult?.isError === true) return null;
  const app = record(root?.mcpApp);
  const meta = record(app?.meta);
  if (!app || !meta) return null;

  const server = typeof app.server === 'string' ? app.server : '';
  const tool = typeof app.tool === 'string' ? app.tool : '';
  const toolKey = typeof app.toolKey === 'string' ? app.toolKey : '';
  const resourceUri = typeof app.resourceUri === 'string' ? app.resourceUri : '';
  if (!server || !tool || !toolKey || !resourceUri.startsWith('ui://')) return null;
  if (meta.resourceUri !== undefined && meta.resourceUri !== resourceUri) return null;

  const preferred = record(meta.preferred);
  const csp = record(meta.csp);
  const permissions = record(meta.permissions);
  const parsedVisibility = strings(meta.visibility);
  if (meta.visibility !== undefined && !parsedVisibility) return null;
  if (parsedVisibility?.some((value) => value !== 'model' && value !== 'app')) return null;
  // Missing visibility keeps the documented default. An explicitly empty
  // declaration is different: fail closed so a server cannot accidentally
  // expand a restricted App's audience while the result is being persisted.
  const visibility = meta.visibility === undefined
    ? ['model', 'app'] as Array<'model' | 'app'>
    : parsedVisibility as Array<'model' | 'app'>;
  const maxHeight = typeof preferred?.maxHeight === 'number' && Number.isFinite(preferred.maxHeight)
    ? preferred.maxHeight
    : typeof meta.maxHeight === 'number' && Number.isFinite(meta.maxHeight)
      ? meta.maxHeight
      : undefined;
  const border = typeof preferred?.border === 'boolean'
    ? preferred.border
    : typeof meta.prefersBorder === 'boolean'
      ? meta.prefersBorder
      : undefined;
  const domain = typeof preferred?.domain === 'string'
    ? preferred.domain
    : typeof meta.domain === 'string'
      ? meta.domain
      : undefined;
  const normalizedPreferred = maxHeight !== undefined || border !== undefined || domain !== undefined
    ? { maxHeight, border, domain }
    : undefined;

  return {
    server,
    tool,
    toolKey,
    resourceUri,
    meta: {
      resourceUri,
      visibility,
      preferred: normalizedPreferred,
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
  const persistedContent = textContentBlocks(
    metadata?.[MCP_APP_MODEL_CONTEXT_CONTENT_METADATA_KEY],
  );
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
      content: persistedContent ?? (input.toolOutput
        ? [{ type: 'text', text: input.toolOutput }]
        : []),
      structuredContent,
      _meta: resultMeta,
    },
  };
};

export const applyMcpAppModelContextUpdate = (
  envelope: McpAppResultEnvelope,
  update: McpAppModelContextUpdate,
): McpAppResultEnvelope => {
  let content: Array<{ type: 'text'; text: string }> | undefined;
  if (update.content !== undefined) {
    const parsed = textContentBlocks(update.content);
    if (!parsed) throw new Error('MCP App model context only supports text content');
    content = parsed;
  }
  return {
    ...envelope,
    result: {
      ...envelope.result,
      ...(content !== undefined ? { content } : {}),
      ...(update.structuredContent !== undefined
        ? { structuredContent: update.structuredContent }
        : {}),
    },
  };
};

/**
 * Turn an App-promoted model-context snapshot into the original completed
 * ToolPart. Persisting the canonical part makes the update visible to the next
 * model turn, history reloads, and every OpenChamber window through the normal
 * message.part.updated stream.
 */
export const persistMcpAppEnvelopeToToolPart = (
  part: ToolPart,
  envelope: McpAppResultEnvelope,
): ToolPart => {
  if (part.state.status !== 'completed') {
    throw new Error('MCP App model context can only update a completed tool result');
  }
  const content = textContentBlocks(envelope.result.content);
  if (!content) throw new Error('MCP App model context only supports text content');

  const metadata: Record<string, unknown> = {
    ...part.state.metadata,
    [MCP_APP_MODEL_CONTEXT_CONTENT_METADATA_KEY]: content,
  };
  if (envelope.result.structuredContent === undefined) {
    delete metadata.structuredContent;
  } else {
    metadata.structuredContent = envelope.result.structuredContent;
  }
  const output = projectMcpAppModelContextOutput(
    content,
    envelope.result.structuredContent,
  );

  return {
    ...part,
    state: {
      ...part.state,
      // OpenCode feeds ToolPart.state.output to the next model turn. Preserve
      // the structured snapshot in metadata for App/history rehydration and
      // also project the exact bounded JSON into output so it is not silently
      // invisible to the model.
      output,
      metadata,
    },
  };
};

// ────────────────────────────────────────────────────────────────────────────
// MCP App runtime model (P0-A lifecycle diagnostics)
//
// Pure, testable description of every observable MCP App lifecycle state.
// The renderer feeds sanitized diagnostic events into `reduceMcpAppRuntime`;
// stale events from a previous binding epoch are ignored so an old iframe can
// never mutate the current instance state (plan §6.1).
// ────────────────────────────────────────────────────────────────────────────

export type McpAppRuntimePhase =
  | 'resolving-binding'
  | 'fetching-resource'
  | 'mounting-sandbox'
  | 'loading-dependencies'
  | 'waiting-app-bridge'
  | 'delivering-tool-data'
  | 'ready'
  | 'failed';

export type McpAppRuntimeFailureCode =
  | 'resource-fetch-failed'
  | 'csp-metadata-missing'
  | 'dependency-blocked'
  | 'dependency-unreachable'
  | 'script-failed'
  | 'bridge-timeout'
  | 'tool-data-delivery-failed'
  | 'binding-invalidated';

export interface McpAppRuntimeFailure {
  code: McpAppRuntimeFailureCode;
  retryable: boolean;
  at: number;
  /** Sanitized detail: origin (scheme+host+port), directive, or error class only. */
  safeDetail?: string;
}

export interface McpAppRuntimeState {
  epoch: string;
  phase: McpAppRuntimePhase;
  failure: McpAppRuntimeFailure | null;
  milestones: Partial<Record<McpAppRuntimePhase, number>>;
}

export type McpAppRuntimeDiagnosticEvent =
  | { type: 'epoch'; epoch: string }
  | { type: 'phase'; phase: McpAppRuntimePhase; epoch?: string; at?: number }
  | {
      type: 'failed';
      code: McpAppRuntimeFailureCode;
      epoch?: string;
      at?: number;
      retryable?: boolean;
      safeDetail?: string;
    };

export const MCP_APP_RUNTIME_PHASES: readonly McpAppRuntimePhase[] = [
  'resolving-binding',
  'fetching-resource',
  'mounting-sandbox',
  'loading-dependencies',
  'waiting-app-bridge',
  'delivering-tool-data',
  'ready',
  'failed',
];

export const MCP_APP_RUNTIME_RETRYABLE: Readonly<
  Record<McpAppRuntimeFailureCode, boolean>
> = {
  'resource-fetch-failed': true,
  'csp-metadata-missing': false,
  'dependency-blocked': false,
  'dependency-unreachable': true,
  'script-failed': true,
  'bridge-timeout': true,
  'tool-data-delivery-failed': true,
  'binding-invalidated': false,
};

export const createMcpAppRuntimeState = (
  epoch = 'initial',
): McpAppRuntimeState => ({
  epoch,
  phase: 'resolving-binding',
  failure: null,
  milestones: {},
});

const now = () => Date.now();

export const reduceMcpAppRuntime = (
  state: McpAppRuntimeState,
  event: McpAppRuntimeDiagnosticEvent,
): McpAppRuntimeState => {
  if (event.type === 'epoch') {
    // Accept a new epoch; everything else resets to the initial state so a
    // previous instance's diagnostics cannot leak into the new binding.
    return createMcpAppRuntimeState(event.epoch);
  }
  if (event.epoch !== undefined && event.epoch !== state.epoch) {
    // Stale event from a superseded iframe/binding: never mutate this state.
    return state;
  }
  if (event.type === 'failed') {
    if (state.phase === 'ready') return state;
    return {
      ...state,
      phase: 'failed',
      failure: {
        code: event.code,
        retryable: event.retryable ?? MCP_APP_RUNTIME_RETRYABLE[event.code],
        at: event.at ?? now(),
        ...(event.safeDetail ? { safeDetail: event.safeDetail } : {}),
      },
    };
  }
  // phase event
  if (state.phase === 'failed') return state;
  if (state.phase === 'ready' && event.phase !== 'ready') return state;
  if (event.phase === 'ready') {
    return {
      ...state,
      phase: 'ready',
      failure: null,
      milestones: { ...state.milestones, ready: event.at ?? now() },
    };
  }
  return {
    ...state,
    phase: event.phase,
    failure: null,
    milestones: {
      ...state.milestones,
      [event.phase]: event.at ?? now(),
    },
  };
};

export const mcpAppRuntimeFailureText = (
  failure: McpAppRuntimeFailure,
): string => {
  const detail = failure.safeDetail ? ` (${failure.safeDetail})` : '';
  switch (failure.code) {
    case 'resource-fetch-failed':
      return `MCP App resource could not be fetched${detail}`;
    case 'csp-metadata-missing':
      return 'MCP App resource declares no CSP metadata; refusing to mount without a policy';
    case 'dependency-blocked':
      return `MCP App dependency was blocked by the sandbox policy${detail}`;
    case 'dependency-unreachable':
      return `MCP App dependency domain is unreachable${detail}`;
    case 'script-failed':
      return `MCP App script failed to load or execute${detail}`;
    case 'bridge-timeout':
      return 'MCP App did not initialize its AppBridge in time';
    case 'tool-data-delivery-failed':
      return 'MCP App initialized but Tool data delivery failed';
    case 'binding-invalidated':
      return 'MCP App binding was invalidated';
    default:
      return `MCP App failed (${failure.code})`;
  }
};

export const mcpAppRuntimeIsTerminal = (state: McpAppRuntimeState) => (
  state.phase === 'ready' || state.phase === 'failed'
);

/**
 * P0-A: sanitize a raw diagnostic string for safeDetail. URLs are reduced to
 * their origin (scheme + host + port); query strings, tokens, HTML, and long
 * payloads are stripped so diagnostics never carry business data.
 */
export const sanitizeMcpAppDiagnosticDetail = (
  value: string,
  maxLength = 120,
): string => {
  const stripped = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[?#][^\s]*/g, '')
    .trim();
  const originOnly = stripped.replace(
    /https?:\/\/[^\s/]+/g,
    (match) => {
      try {
        return new URL(match).origin;
      } catch {
        return match.split('/')[0] ?? match;
      }
    },
  );
  return originOnly.length > maxLength
    ? `${originOnly.slice(0, maxLength)}…`
    : originOnly;
};

// ────────────────────────────────────────────────────────────────────────────
// P0-A/AUD-004: CSP metadata runtime validation
//
// The MCP App contract requires CSP metadata before a resource enters the
// sandbox. Missing, empty, or structurally invalid metadata is a stable
// `csp-metadata-missing` failure — the renderer fails closed and never mounts
// the resource under a guessed policy (EX-04).
// ────────────────────────────────────────────────────────────────────────────
export interface McpAppCspMetadata {
  resourceDomains?: string[];
  connectDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export type McpAppCspMetadataVerdict =
  | { ok: true }
  | { ok: false; detail: 'missing' | 'empty' | 'malformed' | 'invalid-domain' };

export const validateMcpAppCspMetadata = (
  value: McpAppCspMetadata | undefined | null,
): McpAppCspMetadataVerdict => {
  if (value === undefined || value === null) return { ok: false, detail: 'missing' };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, detail: 'malformed' };
  }
  const fields: Array<[keyof McpAppCspMetadata, (item: string) => string | null]> = [
    ['resourceDomains', normalizeMcpAppCspSource],
    ['frameDomains', normalizeMcpAppCspSource],
    ['baseUriDomains', normalizeMcpAppCspSource],
    ['connectDomains', normalizeMcpAppConnectCspSource],
  ];
  let declared = 0;
  for (const [field, normalize] of fields) {
    const raw = value[field];
    if (raw === undefined) continue;
    declared += 1;
    if (!Array.isArray(raw)) return { ok: false, detail: 'malformed' };
    for (const item of raw) {
      if (typeof item !== 'string' || normalize(item) === null) {
        return { ok: false, detail: 'invalid-domain' };
      }
    }
  }
  if (declared === 0) return { ok: false, detail: 'empty' };
  return { ok: true };
};
