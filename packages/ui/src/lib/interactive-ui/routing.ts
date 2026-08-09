import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';

const CACHE_TTL_MS = 10_000;
const FAILURE_CACHE_TTL_MS = 2_000;
const MAX_SYSTEM_LENGTH = 12_000;
const MAX_EXTENSIONS = 64;
const MAX_TOOLS = 128;

type InteractiveUIRoutingConnectionStatus = 'not-required' | 'configured' | 'unconfigured' | 'expired';
type InteractiveUIRoutingOperation = 'read' | 'write' | 'mixed';

interface InteractiveUIRoutingToolCapability {
  name: string;
  surfaces: string[];
  forms: Array<'interactive-ui' | 'html-artifact'>;
  intents: string[];
  priority: number;
  operation: InteractiveUIRoutingOperation;
  dataAuthority: string;
}

export interface InteractiveUIRoutingExtensionCapability {
  id: string;
  version: string;
  domain: string;
  dataAuthority: string;
  connection: {
    required: boolean;
    configured: boolean;
    expired: boolean;
    status: InteractiveUIRoutingConnectionStatus;
  };
  tools: InteractiveUIRoutingToolCapability[];
}

export interface InteractiveUIRoutingContext {
  runtimeKey: string;
  revision?: string;
  system?: string;
  extensions: InteractiveUIRoutingExtensionCapability[];
  skippedExtensions: number;
}

type RoutingContext = {
  runtimeKey: string;
  expiresAt: number;
  context?: InteractiveUIRoutingContext;
};

let cached: RoutingContext | null = null;
let inFlight: { runtimeKey: string; promise: Promise<InteractiveUIRoutingContext | undefined> } | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringValue = (value: unknown, max = 128): string => (
  typeof value === 'string' && value.length <= max ? value : ''
);

const normalizeConnectionStatus = (value: unknown): InteractiveUIRoutingExtensionCapability['connection'] => {
  const connection = isRecord(value) ? value : {};
  const status = connection.status === 'configured'
    || connection.status === 'unconfigured'
    || connection.status === 'expired'
    || connection.status === 'not-required'
    ? connection.status
    : 'unconfigured';
  return {
    required: connection.required === true,
    configured: connection.configured === true,
    expired: connection.expired === true,
    status,
  };
};

const normalizeExtensions = (value: unknown): InteractiveUIRoutingExtensionCapability[] => {
  if (!Array.isArray(value)) return [];
  let toolCount = 0;
  return value.slice(0, MAX_EXTENSIONS).flatMap((rawExtension) => {
    if (!isRecord(rawExtension)) return [];
    const id = stringValue(rawExtension.id);
    const domain = stringValue(rawExtension.domain, 64);
    if (!id || !domain) return [];
    const tools = Array.isArray(rawExtension.tools)
      ? rawExtension.tools.flatMap((rawTool) => {
          if (!isRecord(rawTool) || toolCount >= MAX_TOOLS) return [];
          const name = stringValue(rawTool.name, 64);
          const operation: InteractiveUIRoutingOperation = rawTool.operation === 'write' || rawTool.operation === 'mixed' || rawTool.operation === 'read'
            ? rawTool.operation
            : 'read';
          if (!name || !Number.isInteger(rawTool.priority)) return [];
          toolCount += 1;
          const rawSurfaces: unknown[] = Array.isArray(rawTool.surfaces)
            ? rawTool.surfaces
            : Array.isArray(rawTool.views) ? rawTool.views : [];
          const forms: InteractiveUIRoutingToolCapability['forms'] = Array.isArray(rawTool.forms)
            ? rawTool.forms.filter((entry): entry is 'interactive-ui' | 'html-artifact' => entry === 'interactive-ui' || entry === 'html-artifact').slice(0, 2)
            : ['interactive-ui'];
          const tool: InteractiveUIRoutingToolCapability = {
            name,
            surfaces: rawSurfaces.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 128).slice(0, 16),
            forms,
            intents: Array.isArray(rawTool.intents)
              ? rawTool.intents.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 96).slice(0, 16)
              : [],
            priority: Math.max(0, Math.min(100, rawTool.priority as number)),
            operation,
            dataAuthority: stringValue(rawTool.dataAuthority, 64),
          };
          return [tool];
        })
      : [];
    if (tools.length === 0) return [];
    return [{
      id,
      version: stringValue(rawExtension.version, 64),
      domain,
      dataAuthority: stringValue(rawExtension.dataAuthority, 64),
      connection: normalizeConnectionStatus(rawExtension.connection),
      tools,
    }];
  });
};

const readRoutingContext = async (runtimeKey: string): Promise<InteractiveUIRoutingContext | undefined> => {
  try {
    const response = await runtimeFetch('/api/interactive-ui/capabilities', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) throw new Error(`routing capability request failed (${response.status})`);
    const payload = await response.json() as unknown;
    const record = isRecord(payload) ? payload : {};
    const system = typeof record.system === 'string' && record.system.length <= MAX_SYSTEM_LENGTH
      ? record.system.trim()
      : '';
    const revision = stringValue(record.revision, 160);
    const context: InteractiveUIRoutingContext = {
      runtimeKey,
      ...(revision ? { revision } : {}),
      ...(system ? { system } : {}),
      extensions: normalizeExtensions(record.extensions),
      skippedExtensions: Number.isInteger(record.skippedExtensions)
        ? Math.max(0, record.skippedExtensions as number)
        : 0,
    };
    cached = {
      runtimeKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
      context,
    };
    return context;
  } catch {
    // Routing assistance is progressive enhancement. A missing/older runtime
    // must never prevent a user message from being sent to OpenCode.
    cached = { runtimeKey, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS };
    return undefined;
  }
};

export const getInteractiveUIRoutingContext = async (): Promise<InteractiveUIRoutingContext | undefined> => {
  const runtimeKey = getRuntimeKey();
  if (cached?.runtimeKey === runtimeKey && cached.expiresAt > Date.now()) return cached.context;
  if (inFlight?.runtimeKey !== runtimeKey) {
    const promise = readRoutingContext(runtimeKey).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { runtimeKey, promise };
  }
  return inFlight.promise;
};

export const getInteractiveUIRoutingSystem = async (): Promise<string | undefined> => (
  (await getInteractiveUIRoutingContext())?.system
);

export const clearInteractiveUIRoutingCache = (): void => {
  cached = null;
};
