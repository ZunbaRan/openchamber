import type { Session } from '@opencode-ai/sdk/v2';
import type { WorktreeMetadata } from '@/types/worktree';

export type SessionDeleteRequest = {
  sessions: Session[];
  dateLabel?: string;
  mode?: 'session' | 'worktree';
  worktree?: WorktreeMetadata | null;
};

export type SessionCreateRequest = {
  worktreeMode?: 'main' | 'create' | 'reuse';
  parentID?: string | null;
  projectId?: string | null;
};

type DeleteListener = (request: SessionDeleteRequest) => void;
type CreateListener = (request: SessionCreateRequest) => void;
type DirectoryListener = () => void;
type GitRefreshHint = { directory: string; paths?: string[] };
type GitRefreshListener = (hint: GitRefreshHint) => void;
type ComposerPrefillRequest = { sessionId?: string; text: string };
type ComposerPrefillListener = (request: ComposerPrefillRequest) => void;

// Payload bounds for the composer-prefill contract. The text ceiling mirrors
// the artifactBridge bound on `artifact.proposeFollowUp` payload.text (4_000),
// the only producer of this event, so no legitimate request is ever truncated.
// The sessionId ceiling mirrors artifactBridge's 128-char requestId/leaseId
// identifier bound; session IDs are UUIDs well below it.
export const MAX_COMPOSER_PREFILL_TEXT_LENGTH = 4_000;
const MAX_COMPOSER_PREFILL_SESSION_ID_LENGTH = 128;
const COMPOSER_PREFILL_KEYS = new Set(['sessionId', 'text']);

// Fail-closed, single-read capture of the top-level request: rejects null,
// non-objects, arrays, non-plain prototypes, symbol keys, extra keys,
// accessors, non-enumerable fields, and inconsistent/throwing proxy traps.
// All keys and descriptors are captured in ONE atomic
// `Object.getOwnPropertyDescriptors` snapshot (a single [[OwnPropertyKeys]]
// call and exactly one [[GetOwnProperty]] call per key), so a stateful proxy
// can present each key and descriptor only once. Everything after the
// snapshot reads the spec-created plain snapshot, never the request again.
const captureComposerPrefillRequest = (value: unknown): ComposerPrefillRequest | null => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    let prototype: unknown;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return null;
    }
    if (prototype !== Object.prototype && prototype !== null) return null;
    let snapshot: PropertyDescriptorMap;
    try {
      snapshot = Object.getOwnPropertyDescriptors(value);
    } catch {
      return null;
    }
    const captured: Record<string, unknown> = {};
    for (const key of Array.from(Reflect.ownKeys(snapshot))) {
      if (typeof key !== 'string') return null;
      if (!COMPOSER_PREFILL_KEYS.has(key)) return null;
      const descriptor = snapshot[key];
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        return null;
      }
      if (descriptor.enumerable !== true) return null;
      captured[key] = descriptor.value;
    }
    const text = captured.text;
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_COMPOSER_PREFILL_TEXT_LENGTH) {
      return null;
    }
    if (text.trim().length === 0) return null;
    const sessionId = captured.sessionId;
    if (sessionId !== undefined) {
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_COMPOSER_PREFILL_SESSION_ID_LENGTH) {
        return null;
      }
    }
    return { sessionId, text };
  } catch {
    return null;
  }
};

const deleteListeners = new Set<DeleteListener>();
const createListeners = new Set<CreateListener>();
const directoryListeners = new Set<DirectoryListener>();
const gitRefreshListeners = new Set<GitRefreshListener>();
const composerPrefillListeners = new Set<ComposerPrefillListener>();

export const sessionEvents = {
  onDeleteRequest(listener: DeleteListener) {
    deleteListeners.add(listener);
    return () => {
      deleteListeners.delete(listener);
    };
  },
  requestDelete(payload: SessionDeleteRequest) {
    if (!payload.sessions.length && payload.mode !== 'worktree') {
      return;
    }
    deleteListeners.forEach((listener) => listener(payload));
  },
  onCreateRequest(listener: CreateListener) {
    createListeners.add(listener);
    return () => {
      createListeners.delete(listener);
    };
  },
  requestCreate(payload?: SessionCreateRequest) {
    const request = payload ?? {};
    createListeners.forEach((listener) => listener(request));
  },
  onDirectoryRequest(listener: DirectoryListener) {
    directoryListeners.add(listener);
    return () => {
      directoryListeners.delete(listener);
    };
  },
  requestDirectoryDialog() {
    directoryListeners.forEach((listener) => listener());
  },
  onGitRefreshHint(listener: GitRefreshListener) {
    gitRefreshListeners.add(listener);
    return () => {
      gitRefreshListeners.delete(listener);
    };
  },
  requestGitRefresh(hint: GitRefreshHint) {
    if (!hint.directory.trim()) {
      return;
    }
    gitRefreshListeners.forEach((listener) => listener(hint));
  },
  onComposerPrefillRequest(listener: ComposerPrefillListener) {
    composerPrefillListeners.add(listener);
    return () => {
      composerPrefillListeners.delete(listener);
    };
  },
  requestComposerPrefill(request: ComposerPrefillRequest) {
    const captured = captureComposerPrefillRequest(request);
    if (!captured) {
      return;
    }
    composerPrefillListeners.forEach((listener) => listener(captured));
  },
};
