import type { HTMLArtifactDisplayMode } from './artifactResult';

export const HTML_ARTIFACT_BRIDGE_VERSION = 1 as const;
const MAX_BRIDGE_MESSAGE_BYTES = 8 * 1024;
const DEFAULT_MESSAGE_LIMIT_PER_SECOND = 30;
const DEFAULT_RESIZE_LIMIT_PER_SECOND = 10;
const RATE_LIMIT_WINDOW_MS = 1_000;
const MESSAGE_KEYS = new Set(['source', 'direction', 'bridgeVersion', 'channelId', 'sequence', 'type', 'payload']);
const BROKER_MESSAGE_KEYS = new Set(['source', 'direction', 'bridgeVersion', 'channelId', 'type', 'payload']);

export type HTMLArtifactBridgeMessage =
  | { type: 'artifact.ready'; payload: Record<string, never> }
  | { type: 'artifact.resize'; payload: { height: number } }
  | { type: 'artifact.copyText'; payload: { text: string } }
  | { type: 'artifact.openExternal'; payload: { url: string } }
  | { type: 'artifact.proposeFollowUp'; payload: { text: string } }
  | { type: 'artifact.requestExpand'; payload: { mode: HTMLArtifactDisplayMode } }
  | { type: 'artifact.reportError'; payload: { code: string; message?: string; line?: number; column?: number } };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean => (
  Object.keys(value).every((key) => keys.includes(key))
);
const byteLength = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
const boundedString = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum
);

export const createHTMLArtifactBridgeRateLimiter = ({
  messageLimit = DEFAULT_MESSAGE_LIMIT_PER_SECOND,
  resizeLimit = DEFAULT_RESIZE_LIMIT_PER_SECOND,
}: {
  messageLimit?: number;
  resizeLimit?: number;
} = {}) => {
  let messageTimes: number[] = [];
  let resizeTimes: number[] = [];
  const accept = (times: number[], limit: number, now: number): { allowed: boolean; next: number[] } => {
    const next = times.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (next.length >= limit) return { allowed: false, next };
    next.push(now);
    return { allowed: true, next };
  };
  return {
    allowMessage(now = Date.now()): boolean {
      const result = accept(messageTimes, messageLimit, now);
      messageTimes = result.next;
      return result.allowed;
    },
    allowResize(now = Date.now()): boolean {
      const result = accept(resizeTimes, resizeLimit, now);
      resizeTimes = result.next;
      return result.allowed;
    },
    reset(): void {
      messageTimes = [];
      resizeTimes = [];
    },
  };
};

const parsePayload = (type: unknown, payload: unknown): HTMLArtifactBridgeMessage | null => {
  if (!isRecord(payload)) return null;
  switch (type) {
    case 'artifact.ready':
      return Object.keys(payload).length === 0 ? { type, payload: {} } : null;
    case 'artifact.resize':
      return hasOnlyKeys(payload, ['height'])
        && Number.isInteger(payload.height)
        && Number(payload.height) >= 120
        && Number(payload.height) <= 5_000
        ? { type, payload: { height: Number(payload.height) } }
        : null;
    case 'artifact.copyText':
      return hasOnlyKeys(payload, ['text']) && boundedString(payload.text, 8_000)
        ? { type, payload: { text: payload.text } }
        : null;
    case 'artifact.openExternal': {
      if (!hasOnlyKeys(payload, ['url']) || !boundedString(payload.url, 2_048)) return null;
      try {
        const url = new URL(payload.url);
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? { type, payload: { url: url.toString() } }
          : null;
      } catch {
        return null;
      }
    }
    case 'artifact.proposeFollowUp':
      return hasOnlyKeys(payload, ['text']) && boundedString(payload.text, 4_000)
        ? { type, payload: { text: payload.text } }
        : null;
    case 'artifact.requestExpand':
      return hasOnlyKeys(payload, ['mode'])
        && (payload.mode === 'inline' || payload.mode === 'workspace' || payload.mode === 'fullscreen')
        ? { type, payload: { mode: payload.mode } }
        : null;
    case 'artifact.reportError': {
      if (!hasOnlyKeys(payload, ['code', 'message', 'line', 'column']) || !boundedString(payload.code, 64)) return null;
      if (payload.message !== undefined && (typeof payload.message !== 'string' || payload.message.length > 500)) return null;
      if (payload.line !== undefined && (!Number.isInteger(payload.line) || Number(payload.line) < 0)) return null;
      if (payload.column !== undefined && (!Number.isInteger(payload.column) || Number(payload.column) < 0)) return null;
      return {
        type,
        payload: {
          code: payload.code,
          ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
          ...(typeof payload.line === 'number' ? { line: payload.line } : {}),
          ...(typeof payload.column === 'number' ? { column: payload.column } : {}),
        },
      };
    }
    default:
      return null;
  }
};

export const parseHTMLArtifactBridgeMessage = (
  candidate: unknown,
  channelId: string,
  lastSequence: number,
): (HTMLArtifactBridgeMessage & { sequence: number }) | null => {
  if (!isRecord(candidate) || byteLength(candidate) > MAX_BRIDGE_MESSAGE_BYTES) return null;
  if (!Object.keys(candidate).every((key) => MESSAGE_KEYS.has(key))) return null;
  if (candidate.source !== 'openchamber-artifact' || candidate.direction !== 'artifact-to-host') return null;
  if (candidate.bridgeVersion !== HTML_ARTIFACT_BRIDGE_VERSION || candidate.channelId !== channelId) return null;
  if (!Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) <= lastSequence) return null;
  const message = parsePayload(candidate.type, candidate.payload);
  return message ? { ...message, sequence: Number(candidate.sequence) } : null;
};

export const isHTMLArtifactBrokerNavigationMessage = (
  candidate: unknown,
  channelId: string,
): boolean => (
  isRecord(candidate)
  && byteLength(candidate) <= MAX_BRIDGE_MESSAGE_BYTES
  && Object.keys(candidate).every((key) => BROKER_MESSAGE_KEYS.has(key))
  && candidate.source === 'openchamber-artifact-broker'
  && candidate.direction === 'broker-to-host'
  && candidate.bridgeVersion === HTML_ARTIFACT_BRIDGE_VERSION
  && candidate.channelId === channelId
  && candidate.type === 'broker.navigationBlocked'
  && isRecord(candidate.payload)
  && Object.keys(candidate.payload).length === 0
);

export const createHTMLArtifactHostInitMessage = (input: {
  channelId: string;
  mode: HTMLArtifactDisplayMode;
  locale: string;
  timezone: string;
  reducedMotion: boolean;
  theme: 'light' | 'dark';
  tokens: Record<string, string>;
  viewport: { width: number; height: number };
}) => ({
  source: 'openchamber-host' as const,
  direction: 'host-to-artifact' as const,
  bridgeVersion: HTML_ARTIFACT_BRIDGE_VERSION,
  channelId: input.channelId,
  sequence: 1,
  type: 'host.init' as const,
  payload: {
    mode: input.mode,
    locale: input.locale,
    timezone: input.timezone,
    reducedMotion: input.reducedMotion,
    theme: input.theme,
    tokens: input.tokens,
    viewport: input.viewport,
  },
});
