import type { HTMLArtifactDisplayMode } from './artifactResult';

export const HTML_ARTIFACT_BRIDGE_VERSION = 1 as const;

// Transport budgets. These mirror the donor's message caps so that the exact
// `cap`/`cap + 1` boundary and multibyte semantics are preserved. Every byte
// figure below is the UTF-8 byte length of the JSON serialization of the value
// (matching `new TextEncoder().encode(JSON.stringify(value)).byteLength`),
// computed incrementally so an oversized untrusted value is rejected without
// ever materialising the full JSON string.
const MAX_BRIDGE_MESSAGE_BYTES = 8 * 1024;
const MAX_BUSINESS_BRIDGE_MESSAGE_BYTES = 64 * 1024;
const MAX_BUSINESS_PAYLOAD_BYTES = 48 * 1024;
const MAX_BUSINESS_RESULT_DATA_BYTES = 64 * 1024;
// The COMPLETE success/failure result message (wrapper + nested fields) must
// itself be bounded, not merely its nested `data`. This budget is large enough
// to hold an exact-cap data payload plus the fixed wrapper fields.
const MAX_BUSINESS_RESULT_MESSAGE_BYTES = 64 * 1024 + 2 * 1024;
const MAX_HOST_INIT_CONTEXT_BYTES = 256 * 1024;
const MAX_HOST_INIT_TOKENS_BYTES = 64 * 1024;
const MAX_HOST_INIT_TOKEN_VALUE_CHARS = 4_096;
const MAX_HOST_INIT_LEASE_BYTES = 4 * 1024;
const MAX_HOST_INIT_VIEWPORT_BYTES = 1 * 1024;
// The COMPLETE host.init message must be bounded. Large enough for the largest
// valid combination of per-field budgets (context + tokens + small fields).
const MAX_HOST_INIT_MESSAGE_BYTES = MAX_HOST_INIT_CONTEXT_BYTES + MAX_HOST_INIT_TOKENS_BYTES + 16 * 1024;

const DEFAULT_MESSAGE_LIMIT_PER_SECOND = 30;
const DEFAULT_RESIZE_LIMIT_PER_SECOND = 10;
const RATE_LIMIT_WINDOW_MS = 1_000;
// A rate limit larger than this fails closed rather than enabling unbounded
// storage. A resolved limit of `0` means "deny everything".
const MAX_RATE_LIMIT = 1_000;

const MESSAGE_KEYS = new Set(['source', 'direction', 'bridgeVersion', 'channelId', 'sequence', 'type', 'payload']);
const BROKER_MESSAGE_KEYS = new Set(['source', 'direction', 'bridgeVersion', 'channelId', 'type', 'payload']);
const HOST_INIT_KEYS = new Set([
  'channelId', 'mode', 'locale', 'timezone', 'reducedMotion', 'theme',
  'tokens', 'viewport', 'executionLease', 'context',
]);
const BUSINESS_RESULT_KEYS = new Set(['channelId', 'requestId', 'ok', 'data', 'error', 'code']);

// ---------------------------------------------------------------------------
// Message shapes
// ---------------------------------------------------------------------------

export type HTMLArtifactBridgeMessage =
  | { type: 'artifact.ready'; payload: Record<string, never> }
  | { type: 'artifact.heartbeat'; payload: { leaseId: string } }
  | { type: 'artifact.resize'; payload: { height: number } }
  | { type: 'artifact.copyText'; payload: { text: string } }
  | { type: 'artifact.openExternal'; payload: { url: string } }
  | { type: 'artifact.proposeFollowUp'; payload: { text: string } }
  | { type: 'artifact.requestExpand'; payload: { mode: HTMLArtifactDisplayMode } }
  | { type: 'artifact.businessRequest'; payload: {
    requestId: string;
    intent: 'query' | 'execute';
    action: string;
    input: unknown;
  } }
  | { type: 'artifact.dashboardEvent'; payload: {
    eventId: string;
    payload: Record<string, unknown>;
  } }
  | { type: 'artifact.reportError'; payload: { code: string; message?: string; line?: number; column?: number } };

export type HTMLArtifactHostInitMessage = {
  source: 'openchamber-host';
  direction: 'host-to-artifact';
  bridgeVersion: 1;
  channelId: string;
  sequence: 1;
  type: 'host.init';
  payload: {
    mode: HTMLArtifactDisplayMode;
    locale: string;
    timezone: string;
    reducedMotion: boolean;
    theme: 'light' | 'dark';
    tokens?: Record<string, string>;
    viewport: { width: number; height: number };
    executionLease?: { id: string; expiresAt: number; heartbeatIntervalMs: number };
    context?: unknown;
  };
};

export type HTMLArtifactBusinessResultMessage = {
  source: 'openchamber-host';
  direction: 'host-to-artifact';
  bridgeVersion: 1;
  channelId: string;
  sequence: 1;
  type: 'host.businessResult';
  payload:
    | { requestId: string; ok: true; data?: unknown }
    | { requestId: string; ok: false; error: string; code?: string };
};

// ---------------------------------------------------------------------------
// Bounded, atomic, fail-closed JSON snapshot
//
// This replaces `JSON.stringify` + `TextEncoder` over untrusted objects. In a
// SINGLE guarded traversal it:
//   * reads each own data descriptor exactly once,
//   * builds a safe deep plain-JSON snapshot (never forwarding the original
//     object), and
//   * counts the UTF-8 bytes of the exact JSON serialization of that snapshot,
//     bailing out the instant the running count exceeds `cap`.
// Only the returned snapshot is ever used afterwards, so a stateful proxy can
// no longer report a small value during a measurement pass and a huge value
// during a later construction pass (TOCTOU). It is:
//   * bounded      – depth and node budgets short-circuit adversarial nesting,
//                    and a single node is never materialised past the cap;
//   * cycle-safe   – an ancestor set rejects self-referential structures;
//   * getter-safe  – any own accessor property fails closed before it is read;
//   * fail-closed  – accessors, cycles, bigint, functions, symbols, undefined,
//                    non-plain prototypes, non-finite numbers, own `toJSON`,
//                    array expandos and inherited indexed sparse values are
//                    rejected rather than serialised to an ambiguous value.
// Every reflective call is guarded so a revoked proxy or a throwing trap
// yields INVALID instead of throwing out of a public entry point.
// ---------------------------------------------------------------------------

const MEASURE_OK = 0;
const MEASURE_OVERFLOW = 1;
const MEASURE_INVALID = 2;
type MeasureStatus = 0 | 1 | 2;

const MAX_JSON_DEPTH = 1_000;
const MAX_JSON_NODES = 1_000_000;

type Counter = {
  cap: number;
  bytes: number;
  depth: number;
  nodes: number;
  ancestors: Set<object>;
};

type JsonSnapshot =
  | { status: 0; value: unknown }
  | { status: 1 | 2; value: undefined };

const INVALID_SNAP: JsonSnapshot = { status: MEASURE_INVALID, value: undefined };
const OVERFLOW_SNAP: JsonSnapshot = { status: MEASURE_OVERFLOW, value: undefined };

const addBytes = (counter: Counter, n: number): MeasureStatus => {
  counter.bytes += n;
  return counter.bytes > counter.cap ? MEASURE_OVERFLOW : MEASURE_OK;
};

// Counts the JSON-escaped UTF-8 bytes of a string, optionally including the two
// surrounding quotes. A valid surrogate pair counts as 4 bytes (astral UTF-8);
// a lone surrogate counts as the 6-byte `\uXXXX` escape JSON.stringify emits.
const addStringBytes = (counter: Counter, str: string, includeQuotes: boolean): MeasureStatus => {
  if (includeQuotes) {
    const opened = addBytes(counter, 2);
    if (opened !== MEASURE_OK) return opened;
  }
  const length = str.length;
  let i = 0;
  while (i < length) {
    const code = str.charCodeAt(i);
    let addition: number;
    if (code === 0x22 || code === 0x5C) {
      addition = 2; // \" and \\
      i += 1;
    } else if (code < 0x20) {
      if (code === 0x08 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D) addition = 2;
      else addition = 6; // \u00XX
      i += 1;
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = i + 1 < length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        addition = 4; // valid surrogate pair -> 4-byte astral UTF-8
        i += 2;
      } else {
        addition = 6; // lone high surrogate -> \uXXXX
        i += 1;
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      addition = 6; // lone low surrogate -> \uXXXX
      i += 1;
    } else if (code < 0x80) {
      addition = 1;
      i += 1;
    } else if (code < 0x800) {
      addition = 2;
      i += 1;
    } else {
      addition = 3;
      i += 1;
    }
    const status = addBytes(counter, addition);
    if (status !== MEASURE_OK) return status;
  }
  return MEASURE_OK;
};

// A canonical array index: a canonical decimal string form of a non-negative
// integer below 2^32 - 1. Leading zeros, `+`, scientific notation, etc. are
// not canonical indices.
const isCanonicalArrayIndex = (key: string): boolean => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === key;
};

const snapshotWalk = (counter: Counter, value: unknown): JsonSnapshot => {
  counter.nodes += 1;
  if (counter.nodes > MAX_JSON_NODES) return INVALID_SNAP;
  if (value === null) {
    return addBytes(counter, 4) === MEASURE_OK ? { status: MEASURE_OK, value: null } : OVERFLOW_SNAP;
  }
  if (typeof value === 'boolean') {
    const n = value ? 4 : 5;
    return addBytes(counter, n) === MEASURE_OK ? { status: MEASURE_OK, value } : OVERFLOW_SNAP;
  }
  if (typeof value === 'number') {
    // Fail closed on NaN / ±Infinity: JSON.stringify maps them to `null`, which
    // would silently change the value's meaning.
    if (!Number.isFinite(value)) return INVALID_SNAP;
    return addBytes(counter, String(value).length) === MEASURE_OK
      ? { status: MEASURE_OK, value }
      : OVERFLOW_SNAP;
  }
  if (typeof value === 'string') {
    if (addStringBytes(counter, value, true) !== MEASURE_OK) return OVERFLOW_SNAP;
    return { status: MEASURE_OK, value };
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return INVALID_SNAP;
  }

  // From here `value` is a non-null object (a container).
  if (counter.depth >= MAX_JSON_DEPTH) return INVALID_SNAP;
  if (counter.ancestors.has(value)) return INVALID_SNAP; // cycle
  counter.ancestors.add(value);
  counter.depth += 1;

  let result: JsonSnapshot;
  if (Array.isArray(value)) result = snapshotArray(counter, value as unknown[]);
  else result = snapshotRecord(counter, value as Record<string, unknown>);

  counter.depth -= 1;
  counter.ancestors.delete(value);
  return result;
};

// Standard arrays are allowed ONLY with canonical indexed own data properties,
// no enumerable/non-index expando, own `toJSON`, accessor, or custom prototype.
// An ordinary sparse hole with NO inherited indexed value serialises as JSON
// null (matching the donor/JSON.stringify behaviour) and stays bounded; only
// holes that resolve to an inherited indexed value are rejected, so a value
// hidden on the prototype chain cannot be undercounted as a 4-byte `null`.
const snapshotArray = (counter: Counter, array: unknown[]): JsonSnapshot => {
  let prototype: unknown;
  try { prototype = Object.getPrototypeOf(array); } catch { return INVALID_SNAP; }
  if (prototype !== Array.prototype) return INVALID_SNAP;

  let hasToJSON: boolean;
  try { hasToJSON = Object.prototype.hasOwnProperty.call(array, 'toJSON'); } catch { return INVALID_SNAP; }
  if (hasToJSON) return INVALID_SNAP;

  let keys: string[];
  try { keys = Object.keys(array); } catch { return INVALID_SNAP; }

  let length: number;
  try { length = array.length; } catch { return INVALID_SNAP; }
  if (!Number.isSafeInteger(length) || length < 0) return INVALID_SNAP;

  for (const key of keys) {
    // Any enumerable own key that is not a canonical index within `length` is
    // an expando (or an enumerable `length`) and must fail closed.
    if (!isCanonicalArrayIndex(key)) return INVALID_SNAP;
    if (Number(key) >= length) return INVALID_SNAP;
  }

  let status = addBytes(counter, 1); // '['
  if (status !== MEASURE_OK) return OVERFLOW_SNAP;
  const snapshot: unknown[] = [];
  for (let i = 0; i < length; i++) {
    if (i > 0) {
      status = addBytes(counter, 1); // ','
      if (status !== MEASURE_OK) return OVERFLOW_SNAP;
    }
    let present: boolean;
    try { present = Object.prototype.hasOwnProperty.call(array, i); } catch { return INVALID_SNAP; }
    if (!present) {
      // Sparse hole: accept as JSON `null` ONLY when no inherited indexed value
      // exists anywhere in the prototype chain.
      let inChain: boolean;
      try { inChain = i in array; } catch { return INVALID_SNAP; }
      if (inChain) return INVALID_SNAP;
      const hole = snapshotWalk(counter, null);
      if (hole.status !== MEASURE_OK) return hole;
      snapshot.push(null);
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(array, String(i)); } catch { return INVALID_SNAP; }
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return INVALID_SNAP; // accessor element
    }
    const child = snapshotWalk(counter, descriptor.value);
    if (child.status !== MEASURE_OK) return child;
    snapshot.push(child.value);
  }
  status = addBytes(counter, 1); // ']'
  if (status !== MEASURE_OK) return OVERFLOW_SNAP;
  return { status: MEASURE_OK, value: snapshot };
};

const snapshotRecord = (counter: Counter, record: Record<string, unknown>): JsonSnapshot => {
  let prototype: unknown;
  try { prototype = Object.getPrototypeOf(record); } catch { return INVALID_SNAP; }
  if (prototype !== Object.prototype && prototype !== null) return INVALID_SNAP; // non-plain

  let hasToJSON: boolean;
  try { hasToJSON = Object.prototype.hasOwnProperty.call(record, 'toJSON'); } catch { return INVALID_SNAP; }
  if (hasToJSON) return INVALID_SNAP;

  let keys: string[];
  try { keys = Object.keys(record); } catch { return INVALID_SNAP; }

  let status = addBytes(counter, 1); // '{'
  if (status !== MEASURE_OK) return OVERFLOW_SNAP;
  const snapshot: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) {
      status = addBytes(counter, 1); // ','
      if (status !== MEASURE_OK) return OVERFLOW_SNAP;
    }
    const key = keys[i];
    status = addStringBytes(counter, key, true);
    if (status !== MEASURE_OK) return OVERFLOW_SNAP;
    status = addBytes(counter, 1); // ':'
    if (status !== MEASURE_OK) return OVERFLOW_SNAP;
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(record, key); } catch { return INVALID_SNAP; }
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return INVALID_SNAP; // accessor or property vanished mid-walk
    }
    const child = snapshotWalk(counter, descriptor.value);
    if (child.status !== MEASURE_OK) return child;
    // defineProperty (not assignment) so untrusted keys like `__proto__` become
    // plain own data properties instead of mutating the snapshot's prototype.
    Object.defineProperty(snapshot, key, {
      value: child.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  status = addBytes(counter, 1); // '}'
  if (status !== MEASURE_OK) return OVERFLOW_SNAP;
  return { status: MEASURE_OK, value: snapshot };
};

const snapshotJsonBytes = (value: unknown, cap: number): JsonSnapshot => {
  const counter: Counter = { cap, bytes: 0, depth: 0, nodes: 0, ancestors: new Set<object>() };
  return snapshotWalk(counter, value);
};

const isWithinJsonBytes = (value: unknown, cap: number): boolean => snapshotJsonBytes(value, cap).status === MEASURE_OK;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean => (
  Object.keys(value).every((key) => keys.includes(key))
);
const boundedString = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum
);
const safeIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(value)
);

// ---------------------------------------------------------------------------
// Root-input capture for public builders
//
// A stateful root Proxy could return a short `channelId` on the first read and
// a 100k-character string on a later read, so a builder that validates
// `input.channelId` and then rereads `input.channelId` to construct the message
// would produce an oversized message. Every public builder therefore captures
// its TOP-LEVEL input exactly ONCE with this guarded shallow exact-own-data-field
// capture (rejecting accessors, extra keys, non-plain prototypes, own toJSON,
// and revoked/throwing/stateful traps), then validates and builds ONLY from the
// captured values. Nested untrusted fields are separately deep-snapshotted.
// ---------------------------------------------------------------------------

const captureOwnFields = (value: unknown, allowedKeys: ReadonlySet<string>): Record<string, unknown> | null => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    let prototype: unknown;
    try { prototype = Object.getPrototypeOf(value); } catch { return null; }
    if (prototype !== Object.prototype && prototype !== null) return null;
    let hasToJSON: boolean;
    try { hasToJSON = Object.prototype.hasOwnProperty.call(value, 'toJSON'); } catch { return null; }
    if (hasToJSON) return null;
    let keys: string[];
    try { keys = Object.keys(value); } catch { return null; }
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      if (!allowedKeys.has(key)) return null; // extra key fails closed
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { return null; }
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        return null; // accessor or property vanished mid-capture
      }
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Rate limiter – two genuinely independent, deterministic rolling windows
// ---------------------------------------------------------------------------

const resolveLimit = (value: number): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_RATE_LIMIT
    ? value
    : 0
);

const CAPTURE_FAILED = Symbol('capture-failed');

// Reads an option exactly once via its own data descriptor so a revoked,
// accessor, or stateful options proxy cannot cause a throw or a double read.
const captureOptionNumber = (
  options: unknown,
  key: string,
  fallback: number,
): number | typeof CAPTURE_FAILED => {
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return CAPTURE_FAILED;
    let prototype: unknown;
    try { prototype = Object.getPrototypeOf(options); } catch { return CAPTURE_FAILED; }
    if (prototype !== Object.prototype && prototype !== null) return CAPTURE_FAILED;
    let has: boolean;
    try { has = Object.prototype.hasOwnProperty.call(options, key); } catch { return CAPTURE_FAILED; }
    if (!has) return fallback;
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(options, key); } catch { return CAPTURE_FAILED; }
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return CAPTURE_FAILED;
    }
    return typeof descriptor.value === 'number' ? descriptor.value : CAPTURE_FAILED;
  } catch {
    return CAPTURE_FAILED;
  }
};

export const createHTMLArtifactBridgeRateLimiter = (
  options: { messageLimit?: number; resizeLimit?: number } = {},
) => {
  // Invalid/NaN/Infinity/nonpositive/too-large configuration, and any capture
  // failure (revoked/accessor/stateful options proxy), fail closed to a limit
  // of `0` (deny everything) rather than enabling unbounded storage.
  const messageCapture = captureOptionNumber(options, 'messageLimit', DEFAULT_MESSAGE_LIMIT_PER_SECOND);
  const resizeCapture = captureOptionNumber(options, 'resizeLimit', DEFAULT_RESIZE_LIMIT_PER_SECOND);
  const resolvedMessageLimit = messageCapture === CAPTURE_FAILED ? 0 : resolveLimit(messageCapture);
  const resolvedResizeLimit = resizeCapture === CAPTURE_FAILED ? 0 : resolveLimit(resizeCapture);
  let messageTimes: number[] = [];
  let resizeTimes: number[] = [];
  // Each window tracks its own latest timestamp so the two windows are truly
  // independent: a later resize timestamp never rejects a monotonic message
  // timestamp and vice versa.
  let messageLatest = -Infinity;
  let resizeLatest = -Infinity;

  const accept = (
    times: number[],
    limit: number,
    latest: number,
    now: number,
  ): { allowed: boolean; next: number[]; latest: number } => {
    if (limit <= 0) return { allowed: false, next: times, latest }; // fail-closed limit
    if (typeof now !== 'number' || !Number.isFinite(now)) return { allowed: false, next: times, latest };
    if (now < latest) return { allowed: false, next: times, latest }; // backward clock
    latest = now;
    const next = times.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (next.length >= limit) return { allowed: false, next, latest };
    next.push(now);
    return { allowed: true, next, latest };
  };

  return {
    allowMessage(now: number = Date.now()): boolean {
      const result = accept(messageTimes, resolvedMessageLimit, messageLatest, now);
      messageTimes = result.next;
      messageLatest = result.latest;
      return result.allowed;
    },
    allowResize(now: number = Date.now()): boolean {
      const result = accept(resizeTimes, resolvedResizeLimit, resizeLatest, now);
      resizeTimes = result.next;
      resizeLatest = result.latest;
      return result.allowed;
    },
    reset(): void {
      messageTimes = [];
      resizeTimes = [];
      messageLatest = -Infinity;
      resizeLatest = -Infinity;
    },
  };
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const parsePayload = (
  type: unknown,
  payload: unknown,
  allowBusiness: boolean,
): HTMLArtifactBridgeMessage | null => {
  if (!isRecord(payload)) return null;
  switch (type) {
    case 'artifact.ready':
      return Object.keys(payload).length === 0 ? { type, payload: {} } : null;
    case 'artifact.heartbeat':
      return hasOnlyKeys(payload, ['leaseId']) && boundedString(payload.leaseId, 128)
        ? { type, payload: { leaseId: payload.leaseId } }
        : null;
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
    case 'artifact.businessRequest':
      if (!allowBusiness
        || !hasOnlyKeys(payload, ['requestId', 'intent', 'action', 'input'])
        || !boundedString(payload.requestId, 128)
        || (payload.intent !== 'query' && payload.intent !== 'execute')
        || !boundedString(payload.action, 200)
        || !safeIdentifier(payload.action)
        || !isWithinJsonBytes(payload.input, MAX_BUSINESS_PAYLOAD_BYTES)) return null;
      return {
        type,
        payload: {
          requestId: payload.requestId,
          intent: payload.intent,
          action: payload.action,
          input: payload.input,
        },
      };
    case 'artifact.dashboardEvent':
      if (!allowBusiness
        || !hasOnlyKeys(payload, ['eventId', 'payload'])
        || !boundedString(payload.eventId, 160)
        || !safeIdentifier(payload.eventId)
        || !isRecord(payload.payload)
        || !isWithinJsonBytes(payload.payload, MAX_BUSINESS_PAYLOAD_BYTES)) return null;
      return {
        type,
        payload: {
          eventId: payload.eventId,
          payload: payload.payload,
        },
      };
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
  options: { allowBusiness?: boolean } = {},
): (HTMLArtifactBridgeMessage & { sequence: number }) | null => {
  try {
    const allowBusiness = options.allowBusiness === true;
    const maximumBytes = allowBusiness ? MAX_BUSINESS_BRIDGE_MESSAGE_BYTES : MAX_BRIDGE_MESSAGE_BYTES;
    if (!isRecord(candidate)) return null;
    const snapshot = snapshotJsonBytes(candidate, maximumBytes);
    if (snapshot.status !== MEASURE_OK) return null;
    const msg = snapshot.value as Record<string, unknown>;
    if (!Object.keys(msg).every((key) => MESSAGE_KEYS.has(key))) return null;
    if (msg.source !== 'openchamber-artifact' || msg.direction !== 'artifact-to-host') return null;
    if (msg.bridgeVersion !== HTML_ARTIFACT_BRIDGE_VERSION || msg.channelId !== channelId) return null;
    if (!Number.isSafeInteger(msg.sequence) || Number(msg.sequence) <= lastSequence) return null;
    const message = parsePayload(msg.type, msg.payload, allowBusiness);
    return message ? { ...message, sequence: Number(msg.sequence) } : null;
  } catch {
    return null;
  }
};

export const isHTMLArtifactBrokerNavigationMessage = (
  candidate: unknown,
  channelId: string,
): boolean => {
  try {
    if (!isRecord(candidate)) return false;
    const snapshot = snapshotJsonBytes(candidate, MAX_BRIDGE_MESSAGE_BYTES);
    if (snapshot.status !== MEASURE_OK) return false;
    const msg = snapshot.value as Record<string, unknown>;
    if (!Object.keys(msg).every((key) => BROKER_MESSAGE_KEYS.has(key))) return false;
    if (msg.source !== 'openchamber-artifact-broker' || msg.direction !== 'broker-to-host') return false;
    if (msg.bridgeVersion !== HTML_ARTIFACT_BRIDGE_VERSION || msg.channelId !== channelId) return false;
    if (msg.type !== 'broker.navigationBlocked') return false;
    return isRecord(msg.payload) && Object.keys(msg.payload).length === 0;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Host message builders
//
// Return contract (documented for the HTMLArtifactView donor caller, which
// passes the result directly to `target.postMessage(...)`):
//
//   * The builders NEVER forward an untrusted original object. The top-level
//     `input` record is captured exactly once, and every untrusted `context` /
//     `tokens` (host.init), `executionLease` (host.init) and `data`
//     (businessResult) is reduced to a bounded plain-JSON snapshot that the
//     complete built message is built from.
//   * `createHTMLArtifactHostInitMessage` returns `null` (not a partial init)
//     when an unsafe/oversized `context`/`tokens`/`executionLease` or any
//     required structural input is invalid. issue-024 callers must handle the
//     `null` explicitly. The complete host.init message is bounded.
//   * `createHTMLArtifactBusinessResultMessage` REJECTS (returns `null`) only
//     when a required input (channelId/requestId/ok) is invalid. An invalid or
//     oversized success `data` instead produces a bounded `ok: false`
//     `business_result_invalid` result carrying the exact validated requestId,
//     so a posting caller never forwards a `null` frame that would leave the
//     request hanging. Both the success and the failure result messages are
//     bounded against the complete-message cap.
// ---------------------------------------------------------------------------

// Validates `executionLease` as an exact-key snapshot and reconstructs ONLY
// `{ id, expiresAt, heartbeatIntervalMs }`. Extra fields (including a huge
// string) fail closed and never reach the built message.
const snapshotLease = (
  value: unknown,
): { id: string; expiresAt: number; heartbeatIntervalMs: number } | null => {
  try {
    if (!isRecord(value)) return null;
    const snapshot = snapshotJsonBytes(value, MAX_HOST_INIT_LEASE_BYTES);
    if (snapshot.status !== MEASURE_OK) return null;
    const lease = snapshot.value as Record<string, unknown>;
    const keys = Object.keys(lease);
    if (keys.length !== 3
      || !keys.includes('id')
      || !keys.includes('expiresAt')
      || !keys.includes('heartbeatIntervalMs')) return null;
    const id = lease.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null;
    const expiresAt = lease.expiresAt;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
    const heartbeatIntervalMs = lease.heartbeatIntervalMs;
    if (typeof heartbeatIntervalMs !== 'number'
      || !Number.isSafeInteger(heartbeatIntervalMs)
      || heartbeatIntervalMs <= 0) return null;
    return { id, expiresAt, heartbeatIntervalMs };
  } catch {
    return null;
  }
};

// Reduces `tokens` to a bounded plain snapshot of string values, or returns
// null when it is not a plain string record within budget. Keys (including
// `__proto__`) are copied with defineProperty so every entry becomes an own
// data property and never mutates the snapshot's prototype.
const snapshotSafeStringRecord = (value: unknown, maxBytes: number): Record<string, string> | null => {
  try {
    if (!isRecord(value)) return null;
    const snapshot = snapshotJsonBytes(value, maxBytes);
    if (snapshot.status !== MEASURE_OK) return null;
    const rec = snapshot.value as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const key of Object.keys(rec)) {
      const entry = rec[key];
      if (typeof entry !== 'string' || entry.length > MAX_HOST_INIT_TOKEN_VALUE_CHARS) return null;
      Object.defineProperty(result, key, {
        value: entry,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } catch {
    return null;
  }
};

export const createHTMLArtifactHostInitMessage = (input: {
  channelId: string;
  mode: HTMLArtifactDisplayMode;
  locale: string;
  timezone: string;
  reducedMotion: boolean;
  theme: 'light' | 'dark';
  tokens: Record<string, string>;
  viewport: { width: number; height: number };
  executionLease?: { id: string; expiresAt: number; heartbeatIntervalMs: number };
  context?: unknown;
}): HTMLArtifactHostInitMessage | null => {
  try {
    // Capture the top-level input exactly once; never reread `input.*` later.
    const cap = captureOwnFields(input, HOST_INIT_KEYS);
    if (!cap) return null;

    const channelId = cap.channelId;
    if (!boundedString(channelId, 128)) return null;
    const mode = cap.mode;
    if (mode !== 'inline' && mode !== 'workspace' && mode !== 'fullscreen') return null;
    const locale = cap.locale;
    if (typeof locale !== 'string' || locale.length > 64) return null;
    const timezone = cap.timezone;
    if (typeof timezone !== 'string' || timezone.length > 64) return null;
    const reducedMotion = cap.reducedMotion;
    if (typeof reducedMotion !== 'boolean') return null;
    const theme = cap.theme;
    if (theme !== 'light' && theme !== 'dark') return null;

    // viewport is a nested field -> deep bounded snapshot.
    const viewportSnap = snapshotJsonBytes(cap.viewport, MAX_HOST_INIT_VIEWPORT_BYTES);
    if (viewportSnap.status !== MEASURE_OK) return null;
    const viewportRec = viewportSnap.value as Record<string, unknown>;
    const width = viewportRec.width;
    if (typeof width !== 'number' || !Number.isFinite(width) || !Number.isSafeInteger(width)) return null;
    const height = viewportRec.height;
    if (typeof height !== 'number' || !Number.isFinite(height) || !Number.isSafeInteger(height)) return null;

    // Exact-key lease snapshot; extra fields fail closed (host-init rejection).
    let lease: { id: string; expiresAt: number; heartbeatIntervalMs: number } | undefined;
    if (cap.executionLease !== undefined) {
      const leaseSnapshot = snapshotLease(cap.executionLease);
      if (!leaseSnapshot) return null;
      lease = leaseSnapshot;
    }

    // Unsafe/oversized provided tokens or context must NOT silently produce a
    // partial init; fail the whole init and let issue-024 callers handle null.
    const tokens = snapshotSafeStringRecord(cap.tokens, MAX_HOST_INIT_TOKENS_BYTES);
    if (!tokens) return null;
    let context: unknown;
    if (cap.context !== undefined) {
      const ctxSnap = snapshotJsonBytes(cap.context, MAX_HOST_INIT_CONTEXT_BYTES);
      if (ctxSnap.status !== MEASURE_OK) return null;
      context = ctxSnap.value;
    }

    const message: HTMLArtifactHostInitMessage = {
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: HTML_ARTIFACT_BRIDGE_VERSION,
      channelId,
      sequence: 1,
      type: 'host.init',
      payload: {
        mode,
        locale,
        timezone,
        reducedMotion,
        theme,
        tokens,
        viewport: { width, height },
        ...(lease ? { executionLease: lease } : {}),
        ...(context !== undefined ? { context } : {}),
      },
    };
    // Bound the COMPLETE host init message, not just its nested fields.
    if (snapshotJsonBytes(message, MAX_HOST_INIT_MESSAGE_BYTES).status !== MEASURE_OK) return null;
    return message;
  } catch {
    return null;
  }
};

const buildBusinessResultFailure = (
  channelId: string,
  requestId: string,
  error: string,
  code: string,
): HTMLArtifactBusinessResultMessage => ({
  source: 'openchamber-host',
  direction: 'host-to-artifact',
  bridgeVersion: HTML_ARTIFACT_BRIDGE_VERSION,
  channelId,
  sequence: 1,
  type: 'host.businessResult',
  payload: {
    requestId,
    ok: false,
    error,
    code,
  },
});

export const createHTMLArtifactBusinessResultMessage = (input: {
  channelId: string;
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}): HTMLArtifactBusinessResultMessage | null => {
  try {
    // Capture the top-level input exactly once; never reread `input.*` later.
    const cap = captureOwnFields(input, BUSINESS_RESULT_KEYS);
    if (!cap) return null;

    const channelId = cap.channelId;
    if (!boundedString(channelId, 128)) return null;
    const requestId = cap.requestId;
    if (!boundedString(requestId, 128)) return null;
    const ok = cap.ok;
    if (typeof ok !== 'boolean') return null;

    // Bound the COMPLETE message (success and failure alike); on overflow fall
    // back to a bounded ok:false result built from the same captured values.
    const finalize = (message: HTMLArtifactBusinessResultMessage): HTMLArtifactBusinessResultMessage => {
      if (snapshotJsonBytes(message, MAX_BUSINESS_RESULT_MESSAGE_BYTES).status !== MEASURE_OK) {
        return buildBusinessResultFailure(
          channelId,
          requestId,
          'Business result message exceeds the size limit',
          'business_result_invalid',
        );
      }
      return message;
    };

    if (ok) {
      let dataSnapshot: unknown;
      if (cap.data !== undefined) {
        const snap = snapshotJsonBytes(cap.data, MAX_BUSINESS_RESULT_DATA_BYTES);
        if (snap.status !== MEASURE_OK) {
          return buildBusinessResultFailure(
            channelId,
            requestId,
            'Business result data is invalid',
            'business_result_invalid',
          );
        }
        dataSnapshot = snap.value;
      }
      return finalize({
        source: 'openchamber-host',
        direction: 'host-to-artifact',
        bridgeVersion: HTML_ARTIFACT_BRIDGE_VERSION,
        channelId,
        sequence: 1,
        type: 'host.businessResult',
        payload: {
          requestId,
          ok: true,
          ...(dataSnapshot !== undefined ? { data: dataSnapshot } : {}),
        },
      });
    }

    const error = typeof cap.error === 'string' && cap.error.length > 0 && cap.error.length <= 500
      ? cap.error
      : 'Business request failed';
    const code = typeof cap.code === 'string' && cap.code.length > 0 && cap.code.length <= 64
      ? cap.code
      : undefined;
    return finalize({
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: HTML_ARTIFACT_BRIDGE_VERSION,
      channelId,
      sequence: 1,
      type: 'host.businessResult',
      payload: {
        requestId,
        ok: false,
        error,
        ...(code ? { code } : {}),
      },
    });
  } catch {
    return null;
  }
};
