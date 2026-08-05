import React from 'react';
import {
  AppBridge,
  PostMessageTransport,
  type McpUiAppCapabilities,
  type McpUiDownloadFileRequest,
  type McpUiDownloadFileResult,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { cn } from '@/lib/utils';
import {
  applyMcpAppModelContextUpdate,
  createMcpAppRuntimeState,
  mcpAppRuntimeFailureText,
  normalizeMcpAppConnectCspSource,
  normalizeMcpAppCspSource,
  reduceMcpAppRuntime,
  sanitizeMcpAppDiagnosticDetail,
  validateMcpAppCspMetadata,
  type McpAppModelContextUpdate,
  type McpAppResultEnvelope,
  type McpAppRuntimeFailureCode,
  type McpAppRuntimePhase,
} from '@/lib/interactive-ui/mcpApp';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { openExternalUrl } from '@/lib/url';
import {
  canUseTrustedDesktopFileIPC,
  saveDesktopBinaryFile,
} from '@/lib/desktop';
import { getClientPlatform } from '@/lib/platform';
import {
  opencodeClient,
  type OpenCodeMcpAppResource,
} from '@/lib/opencode/client';

interface McpAppRendererProps {
  envelope: McpAppResultEnvelope;
  directory: string;
  sessionId: string;
  messageId: string;
  partId: string;
  className?: string;
  fallback?: React.ReactNode;
  onPersistableEnvelopeChange?: (
    envelope: McpAppResultEnvelope,
  ) => void | Promise<void>;
  presentation?: 'inline' | 'workbench';
  layoutEpoch?: string;
  toolStateStatus?: 'running' | 'completed' | 'cancelled';
  toolCancellationReason?: string;
  /**
   * Host-owned display request. This is intentionally not a fully controlled
   * value: Apps may still request their own mode changes, while a host layout
   * transition (for example focusing an App Board tile) is applied whenever
   * this value changes. Supplying it also seeds the first render so a renderer
   * mounted after an async snapshot load does not flash or remain inline.
   */
  requestedDisplayMode?: Extract<McpUiDisplayMode, 'inline' | 'fullscreen'>;
}

export interface McpAppRendererHandle {
  requestDisplayMode: (mode: McpUiDisplayMode) => McpAppHostDisplayMode;
}

export interface McpAppResource extends Omit<OpenCodeMcpAppResource, 'meta'> {
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

type McpAppHostDisplayMode = Extract<McpUiDisplayMode, 'inline' | 'fullscreen'>;

interface McpAppDisplayContextOptions {
  currentMode: McpAppHostDisplayMode;
  requestedMode: McpUiDisplayMode;
  theme: 'light' | 'dark';
  locale: string;
  width: number;
  height: number;
  inlineMaxHeight: number;
}

// eslint-disable-next-line react-refresh/only-export-components -- Pure capability intersection covered by focused host-contract tests.
export const resolveMcpAppDisplayMode = (
  currentMode: McpAppHostDisplayMode,
  requestedMode: McpUiDisplayMode,
  appCapabilities: McpUiAppCapabilities | undefined,
): McpAppHostDisplayMode => {
  if (requestedMode === currentMode) return currentMode;
  if (requestedMode !== 'inline' && requestedMode !== 'fullscreen') return currentMode;
  const declaredModes = appCapabilities?.availableDisplayModes;
  // The stable Apps contract only makes this list restrictive when it is set.
  // Some conforming third-party Apps (including official Excalidraw v0.3.2)
  // omit the optional list and discover a Host-offered mode by requesting it.
  return !declaredModes || declaredModes.includes(requestedMode)
    ? requestedMode
    : currentMode;
};

interface McpAppPresentationLayoutOptions {
  displayMode: McpAppHostDisplayMode;
  presentation: NonNullable<McpAppRendererProps['presentation']>;
  inlineHeight: number;
}

const MCP_APP_BASE_HOST_CAPABILITIES = {
  openLinks: {},
  serverTools: {},
} as const satisfies McpUiHostCapabilities;

const MCP_APP_MODEL_CONTEXT_CAPABILITIES = {
  text: {},
  structuredContent: {},
} as const satisfies NonNullable<McpUiHostCapabilities['updateModelContext']>;

// eslint-disable-next-line react-refresh/only-export-components -- Runtime-derived capabilities are covered by focused AppBridge contract tests.
export const buildMcpAppHostCapabilities = (
  downloadsEnabled: boolean,
  modelContextUpdatesEnabled = true,
): McpUiHostCapabilities => ({
  ...MCP_APP_BASE_HOST_CAPABILITIES,
  ...(downloadsEnabled ? { downloadFile: {} } : {}),
  ...(modelContextUpdatesEnabled
    ? { updateModelContext: MCP_APP_MODEL_CONTEXT_CAPABILITIES }
    : {}),
});

// eslint-disable-next-line react-refresh/only-export-components -- Capability derivation is kept separate from bridge construction for tests.
export const canDownloadMcpAppFiles = () => {
  const platform = getClientPlatform();
  if (platform === 'desktop') {
    return canUseTrustedDesktopFileIPC();
  }
  return platform === 'web';
};

// The Host assigns the verified App through the iframe's `srcdoc` DOM property.
// `allow-same-origin` must remain absent: this sandbox token forces srcdoc into
// a unique opaque origin without disabling scripts.
export const MCP_APP_OPAQUE_DOCUMENT_SANDBOX = 'allow-scripts';

// The outer document is a small, Host-authored sandbox proxy on a unique
// opaque data: origin. `allow-same-origin` is required by the MCP Apps proxy
// contract; because data: remains opaque it does not make the proxy
// same-origin with OpenChamber. The untrusted App stays in a second iframe
// with the stricter sandbox above.
export const MCP_APP_SANDBOX_PROXY_SANDBOX = 'allow-scripts allow-same-origin';

const MCP_APP_SANDBOX_PROXY_READY_METHOD = 'ui/notifications/sandbox-proxy-ready';
const MCP_APP_SANDBOX_RESOURCE_READY_METHOD = 'ui/notifications/sandbox-resource-ready';

// Resource permissions cannot be granted honestly through the current
// opaque Loader/App topology. The rendered App has an opaque sandbox origin, so
// forwarding a Permission Policy `allow` attribute would advertise capabilities
// that camera/microphone/geolocation cannot reliably use. Keep this fail-closed
// until Apps are served from an independently trusted secure origin.
// eslint-disable-next-line react-refresh/only-export-components -- Explicit security policy covered by focused tests.
export const resolveMcpAppIframeAllowAttribute = (
  permissions: McpAppResultEnvelope['binding']['meta']['permissions'] | undefined,
): undefined => {
  void permissions;
  return undefined;
};

const MCP_APP_DOWNLOAD_MAX_FILES = 8;
const MCP_APP_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MCP_APP_DOWNLOAD_MAX_URI_LENGTH = 8 * 1024;
const MCP_APP_DOWNLOAD_MAX_MIME_LENGTH = 256;
const MCP_APP_DOWNLOAD_MAX_FILE_NAME_UNITS = 160;
const MCP_APP_DOWNLOAD_MAX_FILE_NAME_BYTES = 240;
const MCP_APP_DOCUMENT_URL_PREFIX = 'data:text/html;charset=utf-8;base64,';
const MCP_APP_MAX_HTML_LENGTH = 8 * 1024 * 1024;
const MCP_APP_MAX_IDENTITY_LENGTH = 16 * 1024;
const MCP_APP_LOADER_CHUNK_LENGTH = 256 * 1024;

// MCP Apps get a bounded grace period to persist editor state before their
// document and transport are revoked. Keep this below one second so a broken
// App cannot stall a replacement surface indefinitely.
export const MCP_APP_TEARDOWN_TIMEOUT_MS = 750;

// A transport that neither resolves nor rejects must not leave the conversation
// on an indefinite loading skeleton. Twenty seconds is deliberately longer than
// normal loopback/remote resource resolution while remaining short enough for a
// user to recover through the existing retry action.
export const MCP_APP_RESOURCE_LOAD_TIMEOUT_MS = 20_000;
const MCP_APP_RESOURCE_LOAD_ERROR_MESSAGE = 'MCP App resource could not be loaded';

// eslint-disable-next-line react-refresh/only-export-components -- Error identity is part of the focused resource-timeout lifecycle contract.
export class McpAppResourceLoadTimeoutError extends Error {
  constructor() {
    super(MCP_APP_RESOURCE_LOAD_ERROR_MESSAGE);
    this.name = 'McpAppResourceLoadTimeoutError';
  }
}

interface McpAppResourceLoadControllerOptions<Resource> {
  load: (signal: AbortSignal) => Promise<Resource>;
  onSuccess: (resource: Resource) => void;
  onError: (error: Error) => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
  timeout?: number;
}

// Keep request timeout, AbortSignal ownership, and React cleanup in one
// transaction. A timeout is an observable retryable failure; an unmount is a
// silent cancellation and must never update an abandoned component.
// eslint-disable-next-line react-refresh/only-export-components -- Pure resource lifecycle controller is covered by focused fake-scheduler tests.
export const createMcpAppResourceLoadController = <Resource,>({
  load,
  onSuccess,
  onError,
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancel = (handle) => globalThis.clearTimeout(handle as number),
  timeout = MCP_APP_RESOURCE_LOAD_TIMEOUT_MS,
}: McpAppResourceLoadControllerOptions<Resource>) => {
  const abortController = new AbortController();
  let disposed = false;
  let settled = false;
  let timeoutHandle: unknown = null;
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });

  const clearTimer = () => {
    if (timeoutHandle === null) return;
    cancel(timeoutHandle);
    timeoutHandle = null;
  };

  const settleSuccess = (resource: Resource) => {
    if (disposed || settled) return;
    settled = true;
    clearTimer();
    onSuccess(resource);
    complete();
  };

  const settleError = (value: unknown) => {
    if (disposed || settled) return;
    settled = true;
    clearTimer();
    onError(value instanceof Error ? value : new Error(MCP_APP_RESOURCE_LOAD_ERROR_MESSAGE));
    complete();
  };

  timeoutHandle = schedule(() => {
    timeoutHandle = null;
    if (disposed || settled) return;
    settled = true;
    abortController.abort();
    onError(new McpAppResourceLoadTimeoutError());
    complete();
  }, Math.max(1, timeout));

  try {
    void load(abortController.signal).then(settleSuccess, settleError);
  } catch (error) {
    settleError(error);
  }

  return {
    signal: abortController.signal,
    completion,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimer();
      abortController.abort();
      complete();
    },
  };
};

interface McpAppBridgeTeardownControllerOptions {
  shouldRequestTeardown: () => boolean;
  requestTeardown: () => Promise<unknown>;
  disposeLoader: () => void;
  removeLifecycleListeners: () => void;
  releaseAppDocument: () => void;
  clearBridgeReference: () => void;
  closeTransport: () => Promise<void>;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
  timeout?: number;
}

// React effect cleanup cannot itself be async, so the teardown transaction is
// represented by an idempotent Promise. The next effect awaits that Promise
// before connecting a replacement bridge. This preserves the protocol order:
// request + response (or bounded timeout), then revoke the document/listeners,
// and only then close the transport.
// eslint-disable-next-line react-refresh/only-export-components -- Pure lifecycle controller is covered by focused ordering tests.
export const createMcpAppBridgeTeardownController = ({
  shouldRequestTeardown,
  requestTeardown,
  disposeLoader,
  removeLifecycleListeners,
  releaseAppDocument,
  clearBridgeReference,
  closeTransport,
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel = (handle) => window.clearTimeout(handle as number),
  timeout = MCP_APP_TEARDOWN_TIMEOUT_MS,
}: McpAppBridgeTeardownControllerOptions) => {
  const boundedTimeout = Math.min(1_000, Math.max(500, timeout));
  let disposal: Promise<void> | null = null;

  const waitForTeardown = () => new Promise<void>((resolve) => {
    let settled = false;
    let timeoutHandle: unknown = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== null) cancel(timeoutHandle);
      timeoutHandle = null;
      resolve();
    };

    timeoutHandle = schedule(settle, boundedTimeout);
    try {
      // Invoke synchronously so the JSON-RPC request is posted before React can
      // detach an unmounted iframe. Only waiting for its response is async.
      void requestTeardown().then(settle, settle);
    } catch {
      settle();
    }
  });

  const safely = (callback: () => void) => {
    try {
      callback();
    } catch {
      // Cleanup is best-effort, but later revocation steps must still run.
    }
  };

  return {
    dispose: () => {
      if (disposal) return disposal;
      disposal = (async () => {
        if (shouldRequestTeardown()) await waitForTeardown();
        safely(disposeLoader);
        safely(removeLifecycleListeners);
        safely(releaseAppDocument);
        safely(clearBridgeReference);
        try {
          await closeTransport();
        } catch {
          // Closing an already-closed transport is an idempotent success.
        }
      })();
      return disposal;
    },
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- Pure remount barrier is covered by focused lifecycle tests.
export const activateMcpAppBridgeAfterTeardown = async (
  previousTeardown: Promise<void>,
  isDisposed: () => boolean,
  activate: () => void | Promise<void>,
) => {
  await previousTeardown.catch(() => {});
  if (isDisposed()) return;
  await activate();
};

interface McpAppPersistableEnvelopeDispatcherOptions {
  getCallback: () => McpAppRendererProps['onPersistableEnvelopeChange'];
  setLatestEnvelope: (envelope: McpAppResultEnvelope) => void;
}

// Keep the bridge-facing persistence function stable while React replaces the
// parent callback after an App Board snapshot write. The callback is data, not
// part of the App document/transport identity: restarting a multi-megabyte App
// after every updateModelContext request loses in-memory editor state and can
// race the opaque Loader teardown.
// eslint-disable-next-line react-refresh/only-export-components -- Pure latest-callback dispatcher is covered by focused remount tests.
export const createMcpAppPersistableEnvelopeDispatcher = ({
  getCallback,
  setLatestEnvelope,
}: McpAppPersistableEnvelopeDispatcherOptions) => async (
  nextEnvelope: McpAppResultEnvelope,
) => {
  await getCallback()?.(nextEnvelope);
  setLatestEnvelope(nextEnvelope);
};

/**
 * Combine the AppBridge request signal with the lifetime of the concrete
 * ToolPart/App binding. AppBridge only owns a single RPC; OpenChamber also has
 * to cancel that RPC when React replaces or tears down the binding that granted
 * its authority.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure abort-link lifecycle covered by focused tests.
export const linkMcpAppOperationAbortSignals = (
  ...signals: Array<AbortSignal | undefined>
) => {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const abortFrom = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    controller.abort(signal.reason);
  };

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
      listeners.length = 0;
    },
  };
};

interface McpAppLoaderFrame {
  removeAttribute: (name: string) => void;
  src: string;
}

// A verified App is mounted by imperatively replacing the Loader `src` with
// `srcdoc`. Teardown revokes that document. React still considers its unchanged
// `src` prop committed, so it will not restore the Loader for a replacement
// bridge on its own. Explicitly re-arm the navigation after the prior teardown
// barrier settles, before sending any Loader chunks.
// eslint-disable-next-line react-refresh/only-export-components -- Pure iframe re-arm helper is covered by focused remount tests.
export const restoreMcpAppLoaderFrame = (
  frame: McpAppLoaderFrame,
  loaderDocumentUrl: string,
) => {
  frame.removeAttribute('srcdoc');
  frame.src = loaderDocumentUrl;
};

const utf8ByteLength = (value: string) => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (
      unit >= 0xd800
      && unit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
};

const MCP_APP_SAFE_DOWNLOAD_EXTENSIONS = new Set([
  'csv', 'excalidraw', 'gif', 'jpeg', 'jpg', 'json', 'log', 'md', 'markdown',
  'pdf', 'png', 'svg', 'tldr', 'tldraw', 'tsv', 'txt', 'webp', 'xml', 'yaml', 'yml',
]);

const isSafeMcpAppDownloadFileName = (fileName: string) => {
  const extension = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return MCP_APP_SAFE_DOWNLOAD_EXTENSIONS.has(extension);
};

export interface PreparedMcpAppDownload {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

type ConfirmMcpAppWebDownload = (
  download: PreparedMcpAppDownload,
) => Promise<boolean>;

interface PendingMcpAppDownload {
  download: PreparedMcpAppDownload;
  resolve: (accepted: boolean) => void;
}

// Inline sizing classes from App Board callers must never constrain a
// fullscreen MCP App. Inline styles are intentional invariants here because
// the native dialog is rendered in the top layer across web and Electron.
// eslint-disable-next-line react-refresh/only-export-components -- Shared invariant used by focused fullscreen tests.
export const MCP_APP_FULLSCREEN_STYLE: React.CSSProperties = {
  height: '100dvh',
  width: '100vw',
  maxHeight: '100dvh',
  maxWidth: '100vw',
};

const sanitizeMcpAppDownloadFileName = (uri: string) => {
  if (uri.length === 0 || uri.length > MCP_APP_DOWNLOAD_MAX_URI_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:' || parsed.hostname) return null;
  const encodedName = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!encodedName) return null;
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    return null;
  }
  const normalized = [...decodedName
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\\/:*?"<>|]/g, '_')]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? '_' : character;
    })
    .join('')
    .trim();
  let fileName = '';
  for (const character of normalized) {
    const candidate = `${fileName}${character}`;
    if (
      candidate.length > MCP_APP_DOWNLOAD_MAX_FILE_NAME_UNITS
      || new TextEncoder().encode(candidate).byteLength > MCP_APP_DOWNLOAD_MAX_FILE_NAME_BYTES
    ) break;
    fileName = candidate;
  }
  fileName = fileName.replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) {
    fileName = `_${fileName}`;
  }
  return fileName
    && fileName !== '.'
    && fileName !== '..'
    && isSafeMcpAppDownloadFileName(fileName)
    ? fileName
    : null;
};

const decodeMcpAppBase64 = (value: string) => {
  if (value.length > Math.ceil(MCP_APP_DOWNLOAD_MAX_BYTES * 4 / 3) + 4) return null;
  const normalized = value.replace(/\s+/g, '');
  if (
    normalized.length > Math.ceil(MCP_APP_DOWNLOAD_MAX_BYTES * 4 / 3) + 4
    || normalized.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) return null;
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
};

// eslint-disable-next-line react-refresh/only-export-components -- Pure validation helper used by AppBridge security tests.
export const prepareMcpAppDownloads = (
  params: McpUiDownloadFileRequest['params'],
): PreparedMcpAppDownload[] | null => {
  if (
    !Array.isArray(params.contents)
    || params.contents.length === 0
    || params.contents.length > MCP_APP_DOWNLOAD_MAX_FILES
  ) return null;

  const prepared: PreparedMcpAppDownload[] = [];
  let totalBytes = 0;
  for (const item of params.contents) {
    // Linked resources would make the trusted host perform an arbitrary network
    // request. OpenChamber only accepts self-contained exports from the App.
    if (item.type !== 'resource') return null;
    const resource = item.resource;
    const fileName = sanitizeMcpAppDownloadFileName(resource.uri);
    if (!fileName) return null;
    if (
      resource.mimeType !== undefined
      && (typeof resource.mimeType !== 'string' || resource.mimeType.length > MCP_APP_DOWNLOAD_MAX_MIME_LENGTH)
    ) return null;
    const mimeType = resource.mimeType?.trim() || 'application/octet-stream';
    if (!/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/.test(mimeType)) {
      return null;
    }
    let bytes: Uint8Array | null = null;
    if ('blob' in resource && typeof resource.blob === 'string') {
      bytes = decodeMcpAppBase64(resource.blob);
    } else if ('text' in resource && typeof resource.text === 'string') {
      if (resource.text.length > MCP_APP_DOWNLOAD_MAX_BYTES) return null;
      bytes = new TextEncoder().encode(resource.text);
    }
    if (!bytes) return null;
    totalBytes += bytes.byteLength;
    if (totalBytes > MCP_APP_DOWNLOAD_MAX_BYTES) return null;
    prepared.push({ bytes, fileName, mimeType });
  }
  return prepared;
};

// eslint-disable-next-line react-refresh/only-export-components -- Exported for the focused AppBridge download contract.
export const downloadMcpAppFiles = async (
  params: McpUiDownloadFileRequest['params'],
  confirmWebDownload?: ConfirmMcpAppWebDownload,
  signal?: AbortSignal,
): Promise<McpUiDownloadFileResult> => {
  if (signal?.aborted) return { isError: true };
  const downloads = prepareMcpAppDownloads(params);
  if (!downloads) return { isError: true };
  for (const download of downloads) {
    if (signal?.aborted) return { isError: true };
    const desktopOutcome = await saveDesktopBinaryFile(
      download.fileName,
      download.mimeType,
      download.bytes,
      signal,
    );
    if (desktopOutcome === 'saved') {
      if (signal?.aborted) return { isError: true };
      continue;
    }
    if (desktopOutcome === 'cancelled') return { isError: true };

    // Browsers require one host-owned, real click per download. Reject batches
    // instead of relying on Chromium's automatic-download permission, and let
    // the renderer present a trusted confirmation button outside the sandbox.
    if (downloads.length !== 1 || !confirmWebDownload) {
      return { isError: true };
    }
    if (!await confirmWebDownload(download) || signal?.aborted) return { isError: true };

    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const buffer = new ArrayBuffer(download.bytes.byteLength);
      new Uint8Array(buffer).set(download.bytes);
      const blob = new Blob([buffer], { type: download.mimeType });
      url = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
    } catch {
      if (url) URL.revokeObjectURL(url);
      return { isError: true };
    } finally {
      anchor?.remove();
    }
    if (url) {
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
  return {};
};

// eslint-disable-next-line react-refresh/only-export-components -- Pure display helper covered by focused download tests.
export const formatMcpAppDownloadSize = (byteLength: number) => {
  if (byteLength <= 0) return '0 B';
  if (byteLength < 1024) return `${byteLength} B`;
  return `${Math.ceil(byteLength / 1024)} KiB`;
};

const MCP_APP_LOOPBACK_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

// eslint-disable-next-line react-refresh/only-export-components -- The policy is exported for focused AppBridge security tests.
export const openMcpAppExternalLink = async (
  url: string,
  open: (target: string) => Promise<boolean> = openExternalUrl,
) => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { isError: true };
  }
  const secure = parsed.protocol === 'https:';
  const loopbackHttp = parsed.protocol === 'http:'
    && MCP_APP_LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  if (
    (!secure && !loopbackHttp)
    || parsed.username
    || parsed.password
  ) {
    return { isError: true };
  }
  return await open(parsed.toString())
    ? {}
    : { isError: true };
};

// eslint-disable-next-line react-refresh/only-export-components -- The handler is exported for focused persistence contract tests.
export const createMcpAppModelContextUpdateHandler = (
  envelope: McpAppResultEnvelope | (() => McpAppResultEnvelope),
  onPersistableEnvelopeChange?: (
    envelope: McpAppResultEnvelope,
  ) => void | Promise<void>,
  authority?: {
    getEpoch: () => string;
    isCurrent: (epoch: string) => boolean;
    getCallback?: () => McpAppRendererProps['onPersistableEnvelopeChange'];
    onCommitted?: (envelope: McpAppResultEnvelope) => void;
  },
) => {
  // An App may issue multiple updateModelContext requests before the Host has
  // durably persisted the first one. Compute each update only after the prior
  // write settles so every request observes the latest committed envelope.
  // A failed write rejects that request but must not poison later requests.
  let persistenceQueue = Promise.resolve();
  let committedSequence = 0;
  let committedEnvelope: McpAppResultEnvelope | null = null;

  return (update: McpAppModelContextUpdate) => {
    // Capture every authority-bearing value when the Host accepts the request,
    // not when an earlier queued persistence operation happens to settle. A
    // callback replacement or ToolPart binding switch must never redirect an
    // already accepted write into the replacement App/Board tile.
    const acceptedEpoch = authority?.getEpoch() ?? '';
    const acceptedSequence = committedSequence;
    const acceptedEnvelope = typeof envelope === 'function' ? envelope() : envelope;
    const acceptedCallback = authority?.getCallback?.() ?? onPersistableEnvelopeChange;
    const operation = persistenceQueue.then(async () => {
      if (authority && !authority.isCurrent(acceptedEpoch)) {
        throw new Error('MCP App model context binding changed');
      }
      if (
        (update.content === undefined && update.structuredContent === undefined)
        || !acceptedCallback
      ) throw new Error('MCP App model context update is not persistable');
      try {
        const serialized = JSON.stringify(update);
        if (typeof serialized !== 'string' || serialized.length > 512 * 1024) {
          throw new Error('MCP App model context update exceeds the host limit');
        }
        if (authority && !authority.isCurrent(acceptedEpoch)) {
          throw new Error('MCP App model context binding changed');
        }
        // A concurrent request accepted before an earlier write settled must
        // include that earlier committed value. A later request accepted after
        // the commit starts from its own captured (possibly rehydrated) value.
        const currentEnvelope = committedEnvelope && committedSequence > acceptedSequence
          ? committedEnvelope
          : acceptedEnvelope;
        const nextEnvelope = applyMcpAppModelContextUpdate(currentEnvelope, update);
        await acceptedCallback(nextEnvelope);
        if (authority && !authority.isCurrent(acceptedEpoch)) {
          throw new Error('MCP App model context binding changed');
        }
        committedSequence += 1;
        committedEnvelope = nextEnvelope;
        authority?.onCommitted?.(nextEnvelope);
        return {};
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error('MCP App model context update could not be persisted');
      }
    });
    persistenceQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
};

interface McpAppToolNotificationQueueOptions {
  getBridge: () => Pick<AppBridge, 'sendToolInput' | 'sendToolResult' | 'sendToolCancelled'> | null;
  isReady: () => boolean;
  getEnvelope: () => McpAppResultEnvelope;
  getStatus: () => 'running' | 'completed' | 'cancelled';
  getCancellationReason?: () => string | undefined;
  onProtocolViolation?: (reason: string) => void;
}

export type McpAppToolNotificationOutcome =
  | 'idle'
  | 'input'
  | 'result'
  | 'cancelled';

/**
 * Serialize host-to-App tool notifications across initialization and React
 * prop updates. Every queued flush reads the newest envelope at execution time,
 * sends its input first, then re-reads state before sending a completed result.
 * A rejected transport operation never poisons later updates.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure bridge ordering helper covered by focused tests.
export const createMcpAppToolNotificationQueue = ({
  getBridge,
  isReady,
  getEnvelope,
  getStatus,
  getCancellationReason,
  onProtocolViolation,
}: McpAppToolNotificationQueueOptions) => {
  let queue = Promise.resolve();
  let sentInputSignature: string | null = null;
  let sentResult = false;
  let sentCancelled = false;
  let failed = false;
  let epoch = 0;

  const flush = () => {
    const operation = queue.then(async (): Promise<McpAppToolNotificationOutcome> => {
      const bridge = getBridge();
      if (!bridge || !isReady() || failed) return 'idle';
      const operationEpoch = epoch;

      const current = getEnvelope();
      const inputSignature = JSON.stringify(current.arguments);
      if (sentInputSignature === null) {
        await bridge.sendToolInput({ arguments: current.arguments });
        if (operationEpoch !== epoch) return 'idle';
        sentInputSignature = inputSignature;
      } else if (sentInputSignature !== inputSignature) {
        failed = true;
        const reason = 'MCP App complete tool input changed after it was published';
        onProtocolViolation?.(reason);
        throw new Error(reason);
      }

      if (operationEpoch !== epoch) return 'idle';
      const latestSignature = JSON.stringify(getEnvelope().arguments);
      if (latestSignature !== sentInputSignature) {
        failed = true;
        const reason = 'MCP App complete tool input changed while it was being published';
        onProtocolViolation?.(reason);
        throw new Error(reason);
      }

      const status = getStatus();
      if (status === 'cancelled') {
        if (sentResult || sentCancelled) return 'idle';
        await bridge.sendToolCancelled({ reason: getCancellationReason?.() });
        if (operationEpoch !== epoch) return 'idle';
        sentCancelled = true;
        return 'cancelled';
      }

      if (status !== 'completed') return 'input';
      // A ToolPart lifecycle has one authoritative tool result. Persisting an
      // App-originated updateModelContext value may rehydrate envelope.result,
      // but that is not a second tool lifecycle result and must not be echoed
      // back into the App. A new bridge epoch/reset may publish once again.
      if (sentResult || sentCancelled) return 'idle';
      await bridge.sendToolResult(
        getEnvelope().result as Parameters<AppBridge['sendToolResult']>[0],
      );
      if (operationEpoch !== epoch) return 'idle';
      sentResult = true;
      return 'result';
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return {
    flush,
    reset: () => {
      epoch += 1;
      sentInputSignature = null;
      sentResult = false;
      sentCancelled = false;
      failed = false;
    },
  };
};

interface McpAppHostGeometryOptions {
  mode: McpAppHostDisplayMode;
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  provisionalFullscreen?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components -- Pure geometry authority is covered by focused fullscreen tests.
export const resolveMcpAppHostGeometry = ({
  mode,
  frameWidth,
  frameHeight,
  viewportWidth,
  viewportHeight,
  provisionalFullscreen = false,
}: McpAppHostGeometryOptions) => {
  const useProvisionalViewport = mode === 'fullscreen' && provisionalFullscreen;
  const measuredWidth = Number.isFinite(frameWidth) && frameWidth > 0
    ? frameWidth
    : viewportWidth;
  const measuredHeight = Number.isFinite(frameHeight) && frameHeight > 0
    ? frameHeight
    : viewportHeight;
  return {
    width: useProvisionalViewport ? viewportWidth : measuredWidth,
    height: useProvisionalViewport ? viewportHeight : measuredHeight,
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- Display-mode negotiation is exported for focused host-contract tests.
export const buildMcpAppDisplayContext = ({
  currentMode,
  requestedMode,
  theme,
  locale,
  width,
  height,
  inlineMaxHeight,
}: McpAppDisplayContextOptions): {
  mode: McpAppHostDisplayMode;
  hostContext: McpUiHostContext;
} => {
  const mode = requestedMode === 'inline' || requestedMode === 'fullscreen'
    ? requestedMode
    : currentMode;
  return {
    mode,
    hostContext: {
      theme,
      locale,
      displayMode: mode,
      availableDisplayModes: ['inline', 'fullscreen'],
      containerDimensions: mode === 'fullscreen'
        ? { width, height }
        : { width, maxHeight: inlineMaxHeight },
    },
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- Exported for the App Board sizing regression contract.
export const buildMcpAppPresentationLayout = ({
  displayMode,
  presentation,
  inlineHeight,
}: McpAppPresentationLayoutOptions) => {
  const fillContainer = displayMode === 'fullscreen' || presentation === 'workbench';
  return {
    fillContainer,
    iframeHeight: fillContainer ? undefined : inlineHeight,
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- Exported for the App Board fullscreen regression contract.
export const buildMcpAppDialogClassName = ({
  className,
  fillContainer,
  fullscreen,
}: {
  className?: string;
  fillContainer: boolean;
  fullscreen: boolean;
}) => cn(
  'relative m-0 min-w-0 w-full max-w-none overflow-hidden rounded-xl border border-border/60 bg-background p-0 text-foreground',
  className,
  fillContainer && 'flex h-full min-h-0 flex-col',
  fullscreen && 'fixed inset-0 z-[100] h-[100dvh] min-h-[100dvh] w-screen max-h-none max-w-none rounded-none shadow-2xl',
);

const nonce = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

interface McpAppBindingEpochOptions {
  directory: string;
  sessionId: string;
  messageId: string;
  partId: string;
  server: string;
  resourceUri: string;
  toolKey: string;
  resourceSha256?: string;
  attempt: number;
}

// Keep every authority-bearing field in one deterministic identity. The value
// is used only as an in-memory React/bridge epoch; untrusted Apps receive a
// fresh random nonce scoped to this identity rather than the tuple itself.
// eslint-disable-next-line react-refresh/only-export-components -- Pure identity helper covered by binding-isolation tests.
export const buildMcpAppBindingEpoch = (input: McpAppBindingEpochOptions) => JSON.stringify([
  input.directory,
  input.sessionId,
  input.messageId,
  input.partId,
  input.server,
  input.resourceUri,
  input.toolKey,
  input.resourceSha256 ?? null,
  input.attempt,
]);

// eslint-disable-next-line react-refresh/only-export-components -- Pure synchronous authority gate covered by binding-switch tests.
export const createMcpAppBindingAuthorityGuard = (input: {
  bindingEpoch: string;
  getCurrentBindingEpoch: () => string;
  isInitialized: () => boolean;
  isDisposed: () => boolean;
}) => ({
  ownsCurrentBinding: () => input.getCurrentBindingEpoch() === input.bindingEpoch,
  isActive: () => (
    !input.isDisposed()
    && input.isInitialized()
    && input.getCurrentBindingEpoch() === input.bindingEpoch
  ),
});

// eslint-disable-next-line react-refresh/only-export-components -- Exported for the sandbox CSP regression contract.
export const buildMcpAppSandboxFrameSources = (declaredSources: string[]) => (
  declaredSources.length > 0 ? [...new Set(declaredSources)] : ["'none'"]
);

// The returned string is also the React lifecycle key for the verified App
// document. Keep it derived from effective policy values rather than metadata
// object identity: model-context persistence rehydrates the envelope and must
// not remount a multi-megabyte iframe when only Tool result data changed.
// eslint-disable-next-line react-refresh/only-export-components -- Pure policy helper covered by focused remount tests.
export const buildMcpAppDocumentPolicy = (
  bindingMeta: McpAppResultEnvelope['binding']['meta'],
  resource: McpAppResource,
) => {
  const policy = resource.meta?.csp ?? bindingMeta.csp;
  const sources = (values: string[] | undefined) => [
    ...new Set((values ?? []).map(normalizeMcpAppCspSource).filter((value): value is string => Boolean(value))),
  ];
  const connectSources = (values: string[] | undefined) => [
    ...new Set((values ?? []).map(normalizeMcpAppConnectCspSource).filter((value): value is string => Boolean(value))),
  ];
  const resourceSources = sources(policy?.resourceDomains);
  const staticSources = ["'self'", ...resourceSources];
  const networkSources = connectSources(policy?.connectDomains);
  const frameSources = buildMcpAppSandboxFrameSources(sources(policy?.frameDomains));
  const baseSources = sources(policy?.baseUriDomains);
  return [
    `default-src 'none'`,
    `script-src ${staticSources.join(' ')} 'unsafe-inline'`,
    `style-src ${staticSources.join(' ')} 'unsafe-inline'`,
    `img-src ${staticSources.join(' ')} data: blob:`,
    `media-src ${staticSources.join(' ')} data: blob:`,
    `font-src ${staticSources.join(' ')} data: blob:`,
    `connect-src ${networkSources.join(' ') || "'none'"}`,
    `frame-src ${frameSources.join(' ')}`,
    `base-uri ${baseSources.join(' ') || "'self'"}`,
    `form-action 'none'`,
    `object-src 'none'`,
  ].join('; ');
};

const escapeHtmlAttribute = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const cspMeta = (policy: string) => (
  `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}">`
);

// Prefix the trusted CSP before every byte of untrusted App markup. Relying on
// a regex search for the first `<head>` is unsafe: comments, template content,
// or malformed early markup can capture the insertion and allow a script or
// base element to run first. The HTML parser creates the document/head for this
// leading metadata, then merges any later App-authored html/head tags into the
// same document. A second App doctype is harmlessly ignored.
// eslint-disable-next-line react-refresh/only-export-components -- Security-critical pure transform covered by hostile-markup tests.
export const injectMcpAppResourceCsp = (html: string, policy: string) => (
  `<!doctype html>${cspMeta(policy)}${html}`
);

const inlineScriptJson = (value: string) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');

// A data: navigation has a naturally opaque origin. Unlike srcdoc, enabling
// allow-same-origin on this document cannot make it same-origin with its
// embedder. Keep this helper deterministic so the Loader document can be
// audited and round-tripped in focused tests.
// eslint-disable-next-line react-refresh/only-export-components -- Exported for the sandbox topology regression contract.
export const createMcpAppOpaqueDocumentUrl = (html: string) => {
  const bytes = new TextEncoder().encode(html);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return `${MCP_APP_DOCUMENT_URL_PREFIX}${btoa(chunks.join(''))}`;
};

// The Loader is deliberately tiny. It receives App HTML only from its direct
// parent with the per-render nonce, reconstructs and byte-validates the bounded
// transfer, then acknowledges that the Host may mount the verified document.
// Chromium blocks data:/opaque documents from navigating themselves to another
// local-scheme document, so the Host performs the final srcdoc assignment.
// eslint-disable-next-line react-refresh/only-export-components -- Exported for the direct Loader sandbox regression contract.
export const createMcpAppLoaderDocument = (channelNonce: string) => {
  const expected = inlineScriptJson(channelNonce);
  // Do not attach a bootstrap CSP here. Local-scheme navigations inherit the
  // source document's policy, so a restrictive Loader policy would continue
  // to block the App's bundled styles, fonts, workers, and declared resource
  // origins after handoff. The Loader contains only this audited static script
  // and remains sandboxed in a unique data: origin; the destination App HTML
  // carries its own resource-specific CSP.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>(()=>{"use strict";const expected=${expected},maxHtml=${MCP_APP_MAX_HTML_LENGTH},maxIdentity=${MCP_APP_MAX_IDENTITY_LENGTH},chunkLength=${MCP_APP_LOADER_CHUNK_LENGTH},maxBytes=maxHtml*4;let phase="idle",identity="",totalBytes=0,totalUnits=0,totalChunks=0,nextIndex=0,receivedUnits=0,chunks=[],transitionIdentity="",documentLoaded=document.readyState==="complete",transitionAnnounced=false;const post=(type,extra={})=>parent.postMessage({source:"openchamber-mcp-loader",type,nonce:expected,...extra},"*");const release=()=>{chunks.length=0;identity="";totalBytes=0;totalUnits=0;totalChunks=0;nextIndex=0;receivedUnits=0};const invalidate=reason=>{const failedIdentity=identity||transitionIdentity;transitionIdentity="";phase="invalid";release();post("loader.invalidated",{reason,...failedIdentity?{identity:failedIdentity}:{}})};const announceTransition=()=>{if(phase!=="transitioning"||transitionAnnounced||!documentLoaded)return;transitionAnnounced=true;post("loader.transitioning",transitionIdentity?{identity:transitionIdentity}:{})};const transition=html=>{transitionIdentity=identity;try{const blob=new Blob([html],{type:"text/html;charset=utf-8"});if(blob.size!==totalBytes&&totalBytes!==0){html="";invalidate("app-byte-length-mismatch");return}html="";phase="transitioning";release();announceTransition()}catch{html="";invalidate("blob-bootstrap-failed")}};addEventListener("load",()=>{documentLoaded=true;announceTransition()},{once:true});addEventListener("message",event=>{if(event.source!==parent||phase==="invalid")return;const data=event.data;if(!data||data.nonce!==expected)return;if(phase==="transitioning")return;if(data.source==="openchamber-mcp-broker"&&data.type==="loader.init"){if(phase!=="idle")return;if(typeof data.appHtml!=="string"||data.appHtml.length===0||data.appHtml.length>maxHtml){invalidate("invalid-app-html");return}phase="legacy";let html=data.appHtml;try{data.appHtml=""}catch{}transition(html);return}if(data.source!=="openchamber-mcp-host")return;if(data.type==="loader.begin"){const valid=typeof data.identity==="string"&&data.identity.length>0&&data.identity.length<=maxIdentity&&Number.isSafeInteger(data.totalBytes)&&data.totalBytes>0&&data.totalBytes<=maxBytes&&Number.isSafeInteger(data.totalUnits)&&data.totalUnits>0&&data.totalUnits<=maxHtml&&Number.isSafeInteger(data.totalChunks)&&data.totalChunks===Math.ceil(data.totalUnits/chunkLength);if(!valid){invalidate("invalid-transfer-begin");return}if(phase==="idle"){phase="receiving";identity=data.identity;totalBytes=data.totalBytes;totalUnits=data.totalUnits;totalChunks=data.totalChunks}else if(phase!=="receiving"||identity!==data.identity||totalBytes!==data.totalBytes||totalUnits!==data.totalUnits||totalChunks!==data.totalChunks){invalidate("transfer-identity-change");return}post("loader.begin-ack",{identity,nextIndex});return}if(phase!=="receiving"||data.identity!==identity)return;if(data.type==="loader.chunk"){if(!Number.isSafeInteger(data.index)||typeof data.data!=="string"){invalidate("invalid-transfer-chunk");return}if(data.index<nextIndex){if(chunks[data.index]!==data.data){invalidate("duplicate-chunk-mismatch");return}post("loader.chunk-ack",{identity,index:data.index});return}if(data.index!==nextIndex){invalidate("out-of-order-chunk");return}const expectedLength=Math.min(chunkLength,totalUnits-nextIndex*chunkLength);if(data.data.length!==expectedLength||receivedUnits+data.data.length>totalUnits){invalidate("invalid-chunk-length");return}chunks.push(data.data);receivedUnits+=data.data.length;nextIndex+=1;post("loader.chunk-ack",{identity,index:data.index});return}if(data.type==="loader.commit"){if(nextIndex!==totalChunks||receivedUnits!==totalUnits){invalidate("incomplete-transfer");return}let html=chunks.join("");chunks.length=0;if(html.length!==totalUnits){html="";invalidate("app-unit-length-mismatch");return}transition(html)}});post("loader.booted")})()</script></body></html>`;
};

interface McpAppLoaderMessageTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

interface McpAppLoaderHostControllerOptions {
  target: McpAppLoaderMessageTarget;
  channelNonce: string;
  appIdentity: string;
  appHtml: string;
  hostOrigin: string;
  mountAppDocument: (html: string) => void;
  onAppReady: () => void;
  onInvalidated: (reason: string) => void;
  onDiagnostic?: (diagnostic: McpAppLoaderDiagnostic) => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
  retryDelay?: number;
  retryMax?: number;
  appReadyTimeout?: number;
}

interface McpAppLoaderHostMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

interface McpAppLoaderDiagnostic {
  phase: string;
  detail: string;
  nextIndex: number;
  totalChunks: number;
}

// Chromium may process a data: iframe in a separate renderer process. Keeping
// Loader ownership in the trusted React Host avoids relying on postMessage
// across two nested opaque OOPIFs. Raw App HTML is retained only until the
// source-authenticated Loader validates it. The Host then mounts it through the
// frame's srcdoc DOM property; readiness requires both its load event and the MCP
// AppBridge initialized handshake, so a blocked/empty navigation cannot be
// mistaken for a healthy App.
// eslint-disable-next-line react-refresh/only-export-components -- Pure lifecycle controller covered by focused race and navigation tests.
export const createMcpAppLoaderHostController = ({
  target,
  channelNonce,
  appIdentity,
  appHtml,
  hostOrigin,
  mountAppDocument,
  onAppReady,
  onInvalidated,
  onDiagnostic = () => {},
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel = (handle) => window.clearTimeout(handle as number),
  retryDelay = 200,
  retryMax = 16,
  appReadyTimeout = 45_000,
}: McpAppLoaderHostControllerOptions) => {
  let pendingHtml = appHtml;
  let retryHandle: unknown = null;
  let phase: 'begin' | 'chunk' | 'commit' | 'navigate' | 'ready' | 'closed' = 'begin';
  let phaseAttempts = 0;
  let nextIndex = 0;
  let started = false;
  let appNavigationAuthorized = false;
  let appDocumentLoaded = false;
  let appBridgeInitialized = false;
  let closed = false;
  const totalUnits = appHtml.length;
  // Count UTF-8 bytes without materializing a second full-size Uint8Array or
  // Blob in the Host. Only the current 256 KiB chunk is copied in flight.
  const totalBytes = utf8ByteLength(appHtml);
  const totalChunks = Math.ceil(totalUnits / MCP_APP_LOADER_CHUNK_LENGTH);
  const boundedAppReadyTimeout = Math.min(60_000, Math.max(30_000, appReadyTimeout));

  const diagnose = (detail: string) => onDiagnostic({
    phase,
    detail,
    nextIndex,
    totalChunks,
  });

  const stopRetry = () => {
    if (retryHandle === null) return;
    cancel(retryHandle);
    retryHandle = null;
  };
  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    phase = 'closed';
    stopRetry();
    pendingHtml = '';
    diagnose(reason);
    onInvalidated(reason);
  };
  const scheduleRetry = () => {
    if (closed || phase === 'ready' || retryHandle !== null) return;
    if (phase === 'navigate') {
      retryHandle = schedule(() => {
        retryHandle = null;
        close('app-ready-timeout');
      }, boundedAppReadyTimeout);
      return;
    }
    retryHandle = schedule(() => {
      retryHandle = null;
      if (closed || phase === 'ready') return;
      if (phaseAttempts >= retryMax) {
        close(`loader-${phase}-timeout`);
        return;
      }
      sendCurrent();
    }, retryDelay);
  };
  const completeAppReady = () => {
    if (
      closed
      || phase !== 'navigate'
      || !appNavigationAuthorized
      || !appDocumentLoaded
      || !appBridgeInitialized
    ) return;
    stopRetry();
    phase = 'ready';
    diagnose('app-ready');
    onAppReady();
  };
  const sendCurrent = () => {
    if (closed || phase === 'ready') return;
    phaseAttempts += 1;
    if (phase === 'begin') {
      target.postMessage({
        source: 'openchamber-mcp-host',
        type: 'loader.begin',
        nonce: channelNonce,
        identity: appIdentity,
        totalBytes,
        totalUnits,
        totalChunks,
      }, '*');
    } else if (phase === 'chunk') {
      const start = nextIndex * MCP_APP_LOADER_CHUNK_LENGTH;
      target.postMessage({
        source: 'openchamber-mcp-host',
        type: 'loader.chunk',
        nonce: channelNonce,
        identity: appIdentity,
        index: nextIndex,
        data: pendingHtml.slice(start, start + MCP_APP_LOADER_CHUNK_LENGTH),
      }, '*');
    } else if (phase === 'commit') {
      target.postMessage({
        source: 'openchamber-mcp-host',
        type: 'loader.commit',
        nonce: channelNonce,
        identity: appIdentity,
      }, '*');
    } else {
      scheduleRetry();
      return;
    }
    diagnose(`sent-${phase}-${phaseAttempts}`);
    scheduleRetry();
  };
  const handleMessage = (event: McpAppLoaderHostMessageEvent) => {
    if (closed) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      nonce?: unknown;
      reason?: unknown;
      identity?: unknown;
    } | null;
    if (!data || data.source !== 'openchamber-mcp-loader') return;
    if (data.nonce !== channelNonce) {
      return;
    }
    if (event.origin !== 'null' && event.origin !== hostOrigin) {
      diagnose(`rejected-origin:${event.origin || 'empty'}`);
      return;
    }
    // Keep the data: Loader as the source-authenticated handoff point. The
    // Loader waits for an explicit navigate command, so no security decision
    // depends on MessageEvent.source after Chromium swaps the opaque Loader
    // document for the final srcdoc App document.
    if (event.source !== target) {
      diagnose('rejected-source');
      return;
    }
    const identity = data.identity;
    const index = (data as { index?: unknown; nextIndex?: unknown }).index;
    const acknowledgedNextIndex = (data as { nextIndex?: unknown }).nextIndex;
    diagnose(`received-${String(data.type)}`);
    if (data.type === 'loader.booted') {
      stopRetry();
      phase = 'begin';
      phaseAttempts = 0;
      nextIndex = 0;
      sendCurrent();
      return;
    }
    if (
      data.type === 'loader.begin-ack'
      && phase === 'begin'
      && identity === appIdentity
      && Number.isSafeInteger(acknowledgedNextIndex)
      && (acknowledgedNextIndex as number) >= 0
      && (acknowledgedNextIndex as number) <= totalChunks
    ) {
      stopRetry();
      nextIndex = acknowledgedNextIndex as number;
      phase = nextIndex < totalChunks ? 'chunk' : 'commit';
      phaseAttempts = 0;
      sendCurrent();
      return;
    }
    if (
      data.type === 'loader.chunk-ack'
      && phase === 'chunk'
      && identity === appIdentity
      && index === nextIndex
    ) {
      stopRetry();
      nextIndex += 1;
      phase = nextIndex < totalChunks ? 'chunk' : 'commit';
      phaseAttempts = 0;
      sendCurrent();
      return;
    }
    if (data.type === 'loader.transitioning' && phase === 'commit') {
      if (identity !== appIdentity) return;
      phase = 'navigate';
      stopRetry();
      const html = pendingHtml;
      pendingHtml = '';
      phaseAttempts = 0;
      appNavigationAuthorized = true;
      try {
        mountAppDocument(html);
      } catch {
        close('app-document-mount-failed');
        return;
      }
      diagnose('mounted-app-document');
      scheduleRetry();
      return;
    }
    if (data.type === 'loader.navigating' && phase === 'navigate') {
      return;
    }
    if (data.type === 'loader.invalidated') {
      close(typeof data.reason === 'string' ? data.reason : 'loader-invalidated');
    }
  };
  const handleLoad = () => {
    if (closed) return;
    if (phase === 'ready') {
      close('navigation');
      return;
    }
    if (phase === 'navigate' && appNavigationAuthorized) {
      if (appDocumentLoaded) {
        // Chromium can deliver the superseded Loader load after srcdoc has
        // already been assigned. Until AppBridge identifies the final App,
        // those pre-initialization load events are indistinguishable and must
        // be idempotent. Once ready, any further load still revokes authority.
        diagnose('duplicate-load-before-app-initialized');
        return;
      }
      appDocumentLoaded = true;
      diagnose('app-document-loaded');
      completeAppReady();
      return;
    }
    // This is the initial data: Loader load (or a harmless about:blank load).
    // Re-sending the current bounded phase is idempotent and covers a message
    // that raced the Loader listener without cloning the complete App HTML.
    if (phase !== 'navigate') {
      stopRetry();
      phaseAttempts = 0;
      sendCurrent();
    } else {
      diagnose('load-before-navigate-command');
    }
  };
  const handleAppInitialized = () => {
    if (closed || phase === 'ready') return;
    if (phase !== 'navigate' || !appNavigationAuthorized) {
      diagnose('app-initialized-before-mount');
      return;
    }
    appBridgeInitialized = true;
    diagnose('app-bridge-initialized');
    completeAppReady();
  };

  return {
    start: () => {
      if (started || closed) return;
      started = true;
      if (
        !pendingHtml
        || pendingHtml.length > MCP_APP_MAX_HTML_LENGTH
        || !appIdentity
        || appIdentity.length > MCP_APP_MAX_IDENTITY_LENGTH
      ) {
        close('invalid-app-html');
        return;
      }
      diagnose('started');
      sendCurrent();
    },
    handleLoad,
    handleAppInitialized,
    handleMessage,
    dispose: () => {
      if (closed) return;
      closed = true;
      phase = 'closed';
      stopRetry();
      pendingHtml = '';
      diagnose('disposed');
    },
  };
};

interface McpAppSandboxProxyHostMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

interface McpAppSandboxProxyHostControllerOptions {
  target: {
    postMessage: (message: unknown, targetOrigin: string) => void;
  };
  channelNonce: string;
  appIdentity: string;
  appHtml: string;
  csp?: NonNullable<McpAppResource['meta']>['csp'];
  permissions?: McpAppResultEnvelope['binding']['meta']['permissions'];
  onProxyResourceMounted: () => void;
  onAppReady: () => void;
  onInvalidated: (reason: string) => void;
  /**
   * P0-A: sanitized diagnostics from the trusted broker bootstrap. The broker
   * only reports classes/origins (never page data) for CSP violations, script
   * failures, rejections, and optional layout telemetry. Layout observation
   * is never readiness proof.
   */
  onProbe?: (probe: McpAppSandboxProbe) => void;
}

export type McpAppSandboxProbe =
  | { type: 'csp-violation'; directive: string; origin: string }
  | { type: 'script-error'; kind: 'script' | 'cross-origin'; origin: string }
  | { type: 'rejection' }
  | { type: 'layout-visible' };

/**
 * Host side of the normative sandbox-proxy handshake. Control messages are
 * accepted only from the exact outer iframe window, its opaque origin, and the
 * nonce scoped to the complete ToolPart binding epoch. App JSON-RPC remains on
 * PostMessageTransport after the proxy has mounted the inner resource.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Security boundary covered by focused and mounted production tests.
export const createMcpAppSandboxProxyHostController = ({
  target,
  channelNonce,
  appIdentity,
  appHtml,
  csp,
  permissions,
  onProxyResourceMounted,
  onAppReady,
  onInvalidated,
  onProbe = () => {},
}: McpAppSandboxProxyHostControllerOptions) => {
  let closed = false;
  let started = false;
  let loadCount = 0;
  let proxyReady = false;
  let resourceSent = false;
  let resourceMounted = false;
  let appInitialized = false;
  let ready = false;
  let pendingHtml = appHtml;

  const invalidate = (reason: string) => {
    if (closed) return;
    closed = true;
    pendingHtml = '';
    onInvalidated(reason);
  };
  const completeReady = () => {
    if (closed || ready || !resourceMounted || !appInitialized) return;
    ready = true;
    onAppReady();
  };
  const authorizedEvent = (event: McpAppSandboxProxyHostMessageEvent) => (
    !closed && event.source === target && event.origin === 'null'
  );
  const sendResource = () => {
    if (closed || !started || !pendingHtml) return;
    resourceSent = true;
    target.postMessage({
      jsonrpc: '2.0',
      method: MCP_APP_SANDBOX_RESOURCE_READY_METHOD,
      params: {
        html: pendingHtml,
        sandbox: MCP_APP_OPAQUE_DOCUMENT_SANDBOX,
        ...(csp ? { csp } : {}),
        ...(permissions ? { permissions } : {}),
        openchamber: {
          nonce: channelNonce,
          identity: appIdentity,
        },
      },
    }, '*');
  };
  const handleMessage = (event: McpAppSandboxProxyHostMessageEvent) => {
    if (!authorizedEvent(event)) return;
    const data = event.data as {
      jsonrpc?: unknown;
      method?: unknown;
      params?: { nonce?: unknown };
      source?: unknown;
      type?: unknown;
      nonce?: unknown;
      reason?: unknown;
      directive?: unknown;
      origin?: unknown;
      kind?: unknown;
      module?: unknown;
    } | null;
    if (!data) return;
    if (
      data.jsonrpc === '2.0'
      && data.method === MCP_APP_SANDBOX_PROXY_READY_METHOD
      && data.params?.nonce === channelNonce
    ) {
      proxyReady = true;
      sendResource();
      return;
    }
    if (data.source !== 'openchamber-mcp-broker' || data.nonce !== channelNonce) return;
    if (data.type === 'broker.invalidated') {
      invalidate(typeof data.reason === 'string' ? data.reason : 'sandbox-proxy-invalidated');
      return;
    }
    // P0-A: sanitized probe diagnostics from the trusted broker bootstrap.
    if (data.type === 'broker.probe-csp') {
      onProbe({
        type: 'csp-violation',
        directive: typeof data.directive === 'string' ? data.directive : '',
        origin: typeof data.origin === 'string' ? data.origin : '',
      });
      return;
    }
    if (data.type === 'broker.probe-script') {
      onProbe({
        type: 'script-error',
        kind: data.kind === 'cross-origin' ? 'cross-origin' : 'script',
        origin: typeof data.origin === 'string' ? data.origin : '',
      });
      return;
    }
    if (data.type === 'broker.probe-rejection') {
      onProbe({ type: 'rejection' });
      return;
    }
    if (data.type === 'broker.layout-visible') {
      onProbe({ type: 'layout-visible' });
      return;
    }
    if (data.type !== 'broker.ready' || !resourceSent) return;
    resourceMounted = true;
    pendingHtml = '';
    onProxyResourceMounted();
    target.postMessage({
      source: 'openchamber-mcp-host',
      type: 'host.listening',
      nonce: channelNonce,
    }, '*');
    completeReady();
  };

  return {
    start: () => {
      if (started || closed) return;
      started = true;
      if (
        !pendingHtml
        || pendingHtml.length > MCP_APP_MAX_HTML_LENGTH
        || !appIdentity
        || appIdentity.length > MCP_APP_MAX_IDENTITY_LENGTH
      ) invalidate('invalid-app-resource');
      else if (proxyReady) sendResource();
    },
    handleLoad: () => {
      if (closed) return;
      loadCount += 1;
      if (loadCount > 1) invalidate('sandbox-proxy-navigation');
    },
    handleAppInitialized: () => {
      if (closed || appInitialized) return;
      appInitialized = true;
      completeReady();
    },
    handleMessage,
    dispose: () => {
      if (closed) return;
      closed = true;
      pendingHtml = '';
    },
  };
};

// The branded type ensures only buildMcpAppBrokerCsp can produce a Broker
// policy. Arbitrary strings cannot satisfy this type at the call site; tests
// that need a raw policy for focused Broker-only testing may cast through
// `as McpAppBrokerPolicy` in test code only.
declare const MCP_APP_BROKER_POLICY_BRAND: unique symbol;
export type McpAppBrokerPolicy = string & { [MCP_APP_BROKER_POLICY_BRAND]: true };

// Build the outermost Broker sandbox CSP. The Broker's own markup only uses
// inline scripts and the opaque Loader data: frame, so 'unsafe-inline' and
// data:/blob: schemes are sufficient for it. However Chromium intersects the
// Broker policy container into every nested about:srcdoc App, and that
// intersection becomes the effective App CSP. Without declared resource
// domains the Broker strips them even though the verified App markup carries
// its own resource-specific CSP. This function therefore reconstructs a
// validated policy that mirrors the App's normalized resource declarations.
//
// Missing or invalid metadata stays strict/offline. No esm.sh hardcode, no
// unbounded wildcard / bare *, no HTML-authored CSP, no weakened
// sandbox/nonce/source/message/navigation rules. Bounded wildcards such as
// https://*.example.com are valid and survive normalization.
// eslint-disable-next-line react-refresh/only-export-components -- Exported for the Broker-CSP regression contract.
export const buildMcpAppBrokerCsp = (
  policy: NonNullable<McpAppResource['meta']>['csp'] | undefined,
): McpAppBrokerPolicy => {
  const STRICT_DEFAULTS = [
    `default-src 'none'`,
    `script-src 'unsafe-inline'`,
    `style-src 'unsafe-inline'`,
    `img-src data: blob:`,
    `font-src data: blob:`,
    `media-src data: blob:`,
    `connect-src 'none'`,
    `frame-src data: blob:`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `object-src 'none'`,
  ].join('; ') as McpAppBrokerPolicy;

  if (!policy) return STRICT_DEFAULTS;

  const sources = (values: string[] | undefined) => [
    ...new Set((values ?? []).map(normalizeMcpAppCspSource).filter((value): value is string => Boolean(value))),
  ];
  const connectSources = (values: string[] | undefined) => [
    ...new Set((values ?? []).map(normalizeMcpAppConnectCspSource).filter((value): value is string => Boolean(value))),
  ];

  const resourceSources = sources(policy.resourceDomains);
  const networkSources = connectSources(policy.connectDomains);
  const rawFrameSources = sources(policy.frameDomains);
  const rawBaseSources = sources(policy.baseUriDomains);

  // If no domains survived normalization, emit strict defaults. This covers
  // empty objects, all-malformed domains, and metadata with zero declarations.
  if (
    resourceSources.length === 0
    && networkSources.length === 0
    && rawFrameSources.length === 0
    && rawBaseSources.length === 0
  ) {
    return STRICT_DEFAULTS;
  }

  const resourceKey = resourceSources.join(' ');
  const networkKey = networkSources.join(' ') || "'none'";
  // The Broker always needs data: blob: for its own Loader; add declared
  // frame domains only when present. Never combine 'none' with other sources.
  const frameKey = rawFrameSources.join(' ');
  // Align with buildMcpAppDocumentPolicy: declared baseUriDomains appear in
  // base-uri; when none are declared fall back to 'self' (not 'none') so the
  // Broker does not strip valid App base-uri declarations via intersection.
  const baseKey = rawBaseSources.length > 0
    ? rawBaseSources.join(' ')
    : "'self'";

  return [
    `default-src 'none'`,
    `script-src 'unsafe-inline'${resourceKey ? ` ${resourceKey}` : ''}`,
    `style-src 'unsafe-inline'${resourceKey ? ` ${resourceKey}` : ''}`,
    `img-src data: blob:${resourceKey ? ` ${resourceKey}` : ''}`,
    `font-src data: blob:${resourceKey ? ` ${resourceKey}` : ''}`,
    `media-src data: blob:${resourceKey ? ` ${resourceKey}` : ''}`,
    `connect-src ${networkKey}`,
    `frame-src data: blob:${rawFrameSources.length > 0 ? ` ${frameKey}` : ''}`,
    `base-uri ${baseKey}`,
    `form-action 'none'`,
    `object-src 'none'`,
  ].join('; ') as McpAppBrokerPolicy;
};

// eslint-disable-next-line react-refresh/only-export-components -- The broker security boundary is exported for focused round-trip tests.
export const createMcpAppBrokerDocument = (
  channelNonce: string,
  brokerCspPolicy?: McpAppBrokerPolicy,
) => {
  const expected = inlineScriptJson(channelNonce);
  const loaderUrl = createMcpAppOpaqueDocumentUrl(createMcpAppLoaderDocument(channelNonce));
  // Use the validated Broker CSP when available; fall back to strict offline
  // defaults when resource CSP metadata is missing or invalid.
  const policyMeta = cspMeta(brokerCspPolicy || buildMcpAppBrokerCsp(undefined));
  const document = `<!doctype html><html><head><meta charset="utf-8">${policyMeta}<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:transparent}body{overflow:hidden}</style></head><body><script>(()=>{"use strict";const expected=${expected},loaderUrl=${inlineScriptJson(loaderUrl)},maxHtml=${MCP_APP_MAX_HTML_LENGTH},maxIdentity=${MCP_APP_MAX_IDENTITY_LENGTH},loaderReadyDelay=50,loaderRetryDelay=200,loaderRetryMax=16,pendingApp=[];let pendingBytes=0;const clearPending=()=>{pendingApp.length=0;pendingBytes=0};const queue=message=>{let size=0;try{const serialized=JSON.stringify(message);size=typeof serialized==="string"?serialized.length:0}catch{return}if(size>1048576||pendingApp.length>=64||pendingBytes+size>1048576){clearPending();authorized=false;return}pendingBytes+=size;pendingApp.push(message)};let authorized=false,listening=false,invalidated=false,app=null,appLoaded=false,loaderInitialLoaded=false,loaderTransitioning=false,loaderReadyTimer=null,loaderRetryTimer=null,loaderRetryCount=0,loadCount=0,mountedIdentity=null,pendingHtml=null;const validIdentity=value=>typeof value==="string"&&value.length>0&&value.length<=maxIdentity;const validHtml=value=>typeof value==="string"&&value.length>0&&value.length<=maxHtml;const releaseHtml=data=>{try{data.appHtml=""}catch{}};const stopLoaderReady=()=>{if(loaderReadyTimer!==null){clearTimeout(loaderReadyTimer);loaderReadyTimer=null}};const stopLoaderRetry=()=>{if(loaderRetryTimer!==null){clearTimeout(loaderRetryTimer);loaderRetryTimer=null}};const invalidate=reason=>{if(invalidated)return;invalidated=true;authorized=false;listening=false;stopLoaderReady();stopLoaderRetry();pendingHtml=null;clearPending();parent.postMessage({source:"openchamber-mcp-broker",type:"broker.invalidated",reason,nonce:expected},"*");app?.remove();app=null};const ready=()=>parent.postMessage({source:"openchamber-mcp-broker",type:"broker.ready",nonce:expected},"*");const scheduleLoaderRetry=()=>{if(invalidated||loaderTransitioning||pendingHtml===null||!app||!loaderInitialLoaded||loaderRetryTimer!==null)return;loaderRetryTimer=setTimeout(()=>{loaderRetryTimer=null;if(invalidated||loaderTransitioning||pendingHtml===null||!app)return;if(loaderRetryCount>=loaderRetryMax){invalidate("loader-init-timeout");return}initializeLoader()},loaderRetryDelay)};const initializeLoader=()=>{if(invalidated||loaderTransitioning||!app||!loaderInitialLoaded||pendingHtml===null)return;loaderRetryCount+=1;let html=pendingHtml;app.contentWindow?.postMessage({source:"openchamber-mcp-broker",type:"loader.init",nonce:expected,appHtml:html},"*");html="";scheduleLoaderRetry()};const markLoaderReady=()=>{if(invalidated||loaderInitialLoaded)return;loaderInitialLoaded=true;initializeLoader()};const mount=(identity,html)=>{mountedIdentity=identity;pendingHtml=html;app=document.createElement("iframe");app.title="MCP App";app.setAttribute("sandbox",${inlineScriptJson(MCP_APP_OPAQUE_DOCUMENT_SANDBOX)});app.addEventListener("load",()=>{loadCount+=1;stopLoaderReady();if(appLoaded){invalidate("navigation");return}if(loaderTransitioning){appLoaded=true;stopLoaderRetry();ready();return}if(!loaderInitialLoaded){markLoaderReady();return}initializeLoader()});app.src=loaderUrl;document.body.append(app);loaderReadyTimer=setTimeout(()=>{loaderReadyTimer=null;if(loadCount===0)markLoaderReady()},loaderReadyDelay)};addEventListener("message",event=>{if(invalidated)return;const data=event.data;if(event.source===parent){if(data&&data.source==="openchamber-mcp-host"){if(data.nonce!==expected)return;if(data.type==="host.init"){if(!validIdentity(data.appIdentity)){releaseHtml(data);invalidate("invalid-app-identity");return}if(!validHtml(data.appHtml)){releaseHtml(data);invalidate("invalid-app-html");return}if(app){releaseHtml(data);if(data.appIdentity!==mountedIdentity){invalidate("resource-change");return}authorized=true;if(appLoaded)ready();return}authorized=true;const html=data.appHtml;releaseHtml(data);mount(data.appIdentity,html);return}if(data.type==="host.listening"&&authorized&&appLoaded&&app){listening=true;const queued=pendingApp.splice(0);pendingBytes=0;for(const message of queued)parent.postMessage(message,"*");return}}if(!authorized||!appLoaded||!app||!data||data.jsonrpc!=="2.0")return;app.contentWindow?.postMessage(data,"*");return}if(app&&event.source===app.contentWindow&&authorized){if(!appLoaded&&data&&data.source==="openchamber-mcp-loader"&&data.nonce===expected){if(data.type==="loader.booted"){initializeLoader();return}if(data.type==="loader.transitioning"&&loaderInitialLoaded&&!loaderTransitioning){loaderTransitioning=true;stopLoaderReady();stopLoaderRetry();const html=pendingHtml;pendingHtml=null;if(!validHtml(html)){invalidate("missing-verified-app-html");return}try{app.srcdoc=html}catch{invalidate("app-document-mount-failed")}return}if(data.type==="loader.invalidated"){invalidate(typeof data.reason==="string"?data.reason:"loader-invalidated");return}}if(data&&data.jsonrpc==="2.0"){if(listening)parent.postMessage(data,"*");else queue(data)}}});parent.postMessage({source:"openchamber-mcp-broker",type:"broker.booted",nonce:expected},"*")})()</script></body></html>`;
  const resourceReadyBridge = `let data=event.data;if(event.source===parent&&data&&data.jsonrpc==="2.0"&&data.method===${inlineScriptJson(MCP_APP_SANDBOX_RESOURCE_READY_METHOD)}){const resource=data.params,authority=resource?.openchamber;data={source:"openchamber-mcp-host",type:"host.init",nonce:authority?.nonce,appIdentity:authority?.identity,appHtml:resource?.html};try{resource.html=""}catch{}}if(event.source===parent){`;
  const proxyReady = `parent.postMessage({source:"openchamber-mcp-broker",type:"broker.booted",nonce:expected},"*");parent.postMessage({jsonrpc:"2.0",method:${inlineScriptJson(MCP_APP_SANDBOX_PROXY_READY_METHOD)},params:{nonce:expected}},"*")`;
  // P0-A: trusted-bootstrap diagnostics. The broker reports only classes and
  // normalized origins — never page data, Tool data, or credentials — and
  // posts one visible-content signal once the App iframe has layout size.
  // P0-A: trusted-bootstrap diagnostics. The broker reports only classes and
  // normalized origins — never page data, Tool data, or credentials — and
  // posts one visible-content signal once the App iframe has layout size.
  // `var` + function declarations hoist: the host can re-enter the broker's
  // message listener synchronously while the bootstrap script is still
  // evaluating, so ready() must be able to call the probes before their
  // `const` initializers would be reached (TDZ).
  // The broker reports layout size only as optional diagnostic telemetry.
  // Protocol readiness never depends on it: a standards-compliant App is not
  // required to emit size/layout/content markers (opaque sandboxes cannot be
  // inspected for painted pixels anyway).
  const brokerProbes = `;var post=function(t,x){x=x||{};parent.postMessage({source:"openchamber-mcp-broker",type:t,nonce:expected,...x},"*")};var o=null;function sp(){if(o||!app)return;var r=function(){try{if(app.getBoundingClientRect().width>0&&app.getBoundingClientRect().height>0){post("broker.layout-visible");o&&(o.disconnect(),o=null)}}catch{}};try{o=new ResizeObserver(r);o.observe(app)}catch{r()}}addEventListener("securitypolicyviolation",function(e){var or="";try{or=new URL(e.blockedURI||"").origin}catch{or=""}post("broker.probe-csp",{directive:e.effectiveDirective||"",origin:or})});addEventListener("error",function(e){var or="";try{or=new URL(e&&e.filename||"").origin}catch{}post("broker.probe-script",{kind:e&&e.message==="Script error."?"cross-origin":"script",origin:or})});addEventListener("unhandledrejection",function(){post("broker.probe-rejection")});`;
  const readyWithProbe = `const ready=()=>{parent.postMessage({source:"openchamber-mcp-broker",type:"broker.ready",nonce:expected},"*");sp()};`;
  return document
    .replace('const data=event.data;if(event.source===parent){', resourceReadyBridge)
    .replace('parent.postMessage({source:"openchamber-mcp-broker",type:"broker.booted",nonce:expected},"*")', proxyReady)
    .replace(
      'const ready=()=>parent.postMessage({source:"openchamber-mcp-broker",type:"broker.ready",nonce:expected},"*")',
      readyWithProbe,
    )
    .replace(
      '})()</script></body></html>',
      `${brokerProbes}})()</script></body></html>`,
    );
};

export const McpAppRenderer = React.forwardRef<McpAppRendererHandle, McpAppRendererProps>(
  function McpAppRenderer({
    envelope,
    directory,
    sessionId,
    messageId,
    partId,
    className,
    fallback,
    onPersistableEnvelopeChange,
    presentation = 'inline',
    layoutEpoch,
    toolStateStatus = 'completed',
    toolCancellationReason,
    requestedDisplayMode,
  }, forwardedRef) {
  const hostRef = React.useRef<HTMLDialogElement>(null);
  const frameSlotRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const retainedFrameHostRef = React.useRef<HTMLDivElement | null>(null);
  const bridgeRef = React.useRef<AppBridge | null>(null);
  const bridgeReadyRef = React.useRef(false);
  const bridgeTeardownBarrierRef = React.useRef<Promise<void>>(Promise.resolve());
  const appCapabilitiesRef = React.useRef<McpUiAppCapabilities | null>(null);
  const pendingDisplayModeRef = React.useRef<McpUiDisplayMode | null>(null);
  const pendingHostContextRef = React.useRef<McpUiHostContext | null>(null);
  const notificationViolationRef = React.useRef<(reason: string) => void>(() => {});
  const beginBridgeTeardownRef = React.useRef<(() => Promise<void>) | null>(null);
  const [loadedResource, setLoadedResource] = React.useState<{
    requestEpoch: string;
    value: McpAppResource;
  } | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [terminalNotice, setTerminalNotice] = React.useState<string | null>(null);
  const [frameMounted, setFrameMounted] = React.useState(false);
  const frameMountedRef = React.useRef(false);
  const [pendingDownload, setPendingDownload] = React.useState<PreparedMcpAppDownload | null>(null);
  const [displayMode, setDisplayMode] = React.useState<McpAppHostDisplayMode>('inline');
  const displayModeRef = React.useRef<McpAppHostDisplayMode>('inline');
  const resourceRequestEpoch = React.useMemo(() => buildMcpAppBindingEpoch({
    directory,
    sessionId,
    messageId,
    partId,
    server: envelope.binding.server,
    resourceUri: envelope.binding.resourceUri,
    toolKey: envelope.binding.toolKey,
    attempt,
  }), [
    attempt,
    directory,
    envelope.binding.resourceUri,
    envelope.binding.server,
    envelope.binding.toolKey,
    messageId,
    partId,
    sessionId,
  ]);
  const resource = loadedResource?.requestEpoch === resourceRequestEpoch
    ? loadedResource.value
    : null;
  const bindingEpoch = React.useMemo(() => buildMcpAppBindingEpoch({
    directory,
    sessionId,
    messageId,
    partId,
    server: envelope.binding.server,
    resourceUri: envelope.binding.resourceUri,
    toolKey: envelope.binding.toolKey,
    resourceSha256: resource?.sha256,
    attempt,
  }), [
    attempt,
    directory,
    envelope.binding.resourceUri,
    envelope.binding.server,
    envelope.binding.toolKey,
    messageId,
    partId,
    resource?.sha256,
    sessionId,
  ]);
  // P0-A: auditable runtime state machine. Every observable lifecycle step is
  // recorded as a phase/milestone/failure event; stale epochs are ignored by
  // the reducer so a superseded iframe can never mutate the current instance.
  const [runtimeState, dispatchRuntimeEvent] = React.useReducer(
    reduceMcpAppRuntime,
    undefined,
    () => createMcpAppRuntimeState(bindingEpoch),
  );
  React.useEffect(() => {
    dispatchRuntimeEvent({ type: 'epoch', epoch: bindingEpoch });
  }, [bindingEpoch]);
  // A terminal failure surfaces through the existing error UI with stable text.
  React.useEffect(() => {
    if (runtimeState.failure) {
      setError(mcpAppRuntimeFailureText(runtimeState.failure));
    }
  }, [runtimeState.failure]);
  const recordPhase = React.useCallback((phase: McpAppRuntimePhase) => {
    dispatchRuntimeEvent({ type: 'phase', epoch: bindingEpoch, phase });
  }, [bindingEpoch]);
  const recordFailure = React.useCallback((code: McpAppRuntimeFailureCode, safeDetail?: string) => {
    dispatchRuntimeEvent({
      type: 'failed',
      epoch: bindingEpoch,
      code,
      ...(safeDetail ? { safeDetail } : {}),
    });
  }, [bindingEpoch]);
  const channelNonce = React.useMemo(nonce, [bindingEpoch]);
  // The Broker CSP mirrors the validated App resource declarations so
  // Chromium does not intersect them away from the nested about:srcdoc App.
  // Compute it from the same metadata that buildMcpAppDocumentPolicy uses;
  // missing/invalid metadata stays strict/offline (AUD-004). Return null
  // before the resource is loaded so the bridge layout effect can guard on
  // the URL's availability alongside resource and appDocument.
  const sandboxProxyDocumentUrl = React.useMemo(
    () => {
      if (!resource) return null;
      const effectiveCsp = resource.meta?.csp ?? envelope.binding.meta.csp;
      return createMcpAppOpaqueDocumentUrl(
        createMcpAppBrokerDocument(channelNonce, buildMcpAppBrokerCsp(effectiveCsp)),
      );
    },
    [channelNonce, resource, envelope.binding.meta.csp],
  );
  const latestEnvelopeRef = React.useRef(envelope);
  const persistableEnvelopeChangeRef = React.useRef(onPersistableEnvelopeChange);
  persistableEnvelopeChangeRef.current = onPersistableEnvelopeChange;
  const bindingAuthorityRef = React.useRef(bindingEpoch);
  const bindingOperationAbortRef = React.useRef<AbortController | null>(null);
  const inputEnvelopeRef = React.useRef(envelope);
  const toolNotificationQueueRef = React.useRef<ReturnType<typeof createMcpAppToolNotificationQueue> | null>(null);
  if (bindingAuthorityRef.current !== bindingEpoch) {
    // React updates refs during render before passive cleanup. Revoke the old
    // bridge synchronously so a queued flush cannot read the new envelope and
    // publish it into the previous ToolPart's iframe while teardown awaits.
    bindingOperationAbortRef.current?.abort(
      new DOMException('MCP App binding changed', 'AbortError'),
    );
    bindingOperationAbortRef.current = null;
    bindingAuthorityRef.current = bindingEpoch;
    bridgeReadyRef.current = false;
    appCapabilitiesRef.current = null;
    pendingDisplayModeRef.current = requestedDisplayMode ?? null;
    pendingHostContextRef.current = null;
    // Every AppBridge epoch starts inline until the new App declares its
    // supported display modes. A fullscreen predecessor must not grant the
    // replacement an undeclared initial mode through ui/initialize.
    displayModeRef.current = 'inline';
    toolNotificationQueueRef.current?.reset();
  }
  if (inputEnvelopeRef.current !== envelope) {
    inputEnvelopeRef.current = envelope;
    latestEnvelopeRef.current = envelope;
  }
  const toolStateStatusRef = React.useRef(toolStateStatus);
  toolStateStatusRef.current = toolStateStatus;
  const toolCancellationReasonRef = React.useRef(toolCancellationReason);
  toolCancellationReasonRef.current = toolCancellationReason;
  if (!toolNotificationQueueRef.current) {
    toolNotificationQueueRef.current = createMcpAppToolNotificationQueue({
      getBridge: () => bridgeRef.current,
      isReady: () => bridgeReadyRef.current,
      getEnvelope: () => latestEnvelopeRef.current,
      getStatus: () => toolStateStatusRef.current,
      getCancellationReason: () => toolCancellationReasonRef.current,
      onProtocolViolation: (reason) => notificationViolationRef.current(reason),
    });
  }
  const downloadInFlightRef = React.useRef(false);
  const pendingDownloadRef = React.useRef<PendingMcpAppDownload | null>(null);
  const [height, setHeight] = React.useState(
    Math.min(1_200, Math.max(240, envelope.binding.meta.preferred?.maxHeight ?? 520)),
  );
  const initialHeightRef = React.useRef(height);
  const downloadTitleId = React.useId();
  const downloadDescriptionId = React.useId();
  const downloadsEnabled = canDownloadMcpAppFiles();
  const modelContextUpdatesEnabled = onPersistableEnvelopeChange !== undefined;
  const hostCapabilities = React.useMemo(
    () => buildMcpAppHostCapabilities(downloadsEnabled, modelContextUpdatesEnabled),
    [downloadsEnabled, modelContextUpdatesEnabled],
  );
  const appDocumentPolicy = resource
    ? buildMcpAppDocumentPolicy(envelope.binding.meta, resource)
    : null;
  const appDocument = React.useMemo(() => {
    if (!resource || !appDocumentPolicy) return null;
    const html = injectMcpAppResourceCsp(resource.html, appDocumentPolicy);
    return {
      html,
    };
  }, [appDocumentPolicy, resource]);

  const requestWebDownload = React.useCallback<ConfirmMcpAppWebDownload>(
    (download) => new Promise<boolean>((resolve) => {
      if (pendingDownloadRef.current) {
        resolve(false);
        return;
      }
      pendingDownloadRef.current = { download, resolve };
      setPendingDownload(download);
    }),
    [],
  );

  const settleWebDownload = React.useCallback((accepted: boolean) => {
    const pending = pendingDownloadRef.current;
    if (!pending) return;
    pendingDownloadRef.current = null;
    setPendingDownload(null);
    pending.resolve(accepted);
  }, []);

  React.useEffect(() => () => {
    const pending = pendingDownloadRef.current;
    pendingDownloadRef.current = null;
    pending?.resolve(false);
  }, []);

  const displayContext = React.useCallback((
    requestedMode: McpUiDisplayMode,
    provisionalFullscreen = false,
  ) => {
    const mode = requestedMode === 'inline' || requestedMode === 'fullscreen'
      ? requestedMode
      : displayModeRef.current;
    const geometry = resolveMcpAppHostGeometry({
      mode,
      frameWidth: iframeRef.current?.clientWidth ?? 0,
      frameHeight: iframeRef.current?.clientHeight ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      provisionalFullscreen,
    });
    return buildMcpAppDisplayContext({
      currentMode: displayModeRef.current,
      requestedMode,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      locale: document.documentElement.lang || navigator.language,
      width: geometry.width,
      height: geometry.height,
      inlineMaxHeight: presentation === 'workbench'
        ? Math.max(160, iframeRef.current?.clientHeight || initialHeightRef.current)
        : initialHeightRef.current,
    });
  }, [presentation]);

  const publishHostContext = React.useCallback((context: McpUiHostContext) => {
    pendingHostContextRef.current = context;
    const bridge = bridgeRef.current;
    if (!bridge || !bridgeReadyRef.current) return;
    void bridge.setHostContext(context);
  }, []);

  const applyDisplayMode = React.useCallback((requestedMode: McpUiDisplayMode) => {
    const previousMode = displayModeRef.current;
    if (!bridgeReadyRef.current || !appCapabilitiesRef.current) {
      pendingDisplayModeRef.current = requestedMode;
      return previousMode;
    }
    const resolvedMode = resolveMcpAppDisplayMode(
      previousMode,
      requestedMode,
      appCapabilitiesRef.current,
    );
    const enteringFullscreen = resolvedMode === 'fullscreen' && previousMode !== 'fullscreen';
    const next = displayContext(resolvedMode, enteringFullscreen);
    displayModeRef.current = next.mode;
    setDisplayMode(next.mode);
    // Entering fullscreen gets a provisional viewport immediately. The next
    // animation frame and ResizeObserver publish the iframe's real content box
    // after the dialog header and top-layer layout have been applied. Exiting
    // must likewise wait until the dialog has left the top layer.
    if (next.mode === 'fullscreen' || previousMode === next.mode) {
      publishHostContext(next.hostContext);
    }
    window.requestAnimationFrame(() => {
      if (displayModeRef.current !== next.mode) return;
      publishHostContext(displayContext(next.mode).hostContext);
    });
    return next.mode;
  }, [displayContext, publishHostContext]);

  React.useImperativeHandle(forwardedRef, () => ({
    requestDisplayMode: applyDisplayMode,
  }), [applyDisplayMode]);

  React.useLayoutEffect(() => {
    setDisplayMode('inline');
  }, [bindingEpoch]);

  React.useLayoutEffect(() => {
    if (!requestedDisplayMode) return;
    applyDisplayMode(requestedDisplayMode);
  }, [applyDisplayMode, requestedDisplayMode]);

  const handleToolNotificationOutcome = React.useCallback((
    outcome: McpAppToolNotificationOutcome,
  ) => {
    // Cancellation handling only. Ordinary envelope/status flushes never
    // grant ready: protocol readiness is granted exclusively from the
    // AppBridge oninitialized initial-delivery path below.
    if (outcome !== 'cancelled') return;
    const notice = toolCancellationReasonRef.current || 'MCP App tool call was cancelled';
    const teardown = beginBridgeTeardownRef.current;
    if (!teardown) {
      setTerminalNotice(notice);
      return;
    }
    void teardown().finally(() => {
      frameMountedRef.current = false;
      setFrameMounted(false);
      setTerminalNotice(notice);
    });
  }, []);
  notificationViolationRef.current = (reason) => {
    bridgeReadyRef.current = false;
    recordFailure('binding-invalidated', sanitizeMcpAppDiagnosticDetail(reason));
    const teardown = beginBridgeTeardownRef.current;
    if (!teardown) {
      setError(reason);
      return;
    }
    void teardown().finally(() => {
      frameMountedRef.current = false;
      setFrameMounted(false);
      setError(reason);
    });
  };

  React.useEffect(() => {
    setError(null);
    setTerminalNotice(null);
    setLoadedResource(null);
    const controller = createMcpAppResourceLoadController({
      load: (signal) => opencodeClient.getMcpAppResource({
        directory,
        sessionId,
        messageId,
        partId,
        server: envelope.binding.server,
        resourceUri: envelope.binding.resourceUri,
        toolKey: envelope.binding.toolKey,
        signal,
        force: attempt > 0,
      }),
      onSuccess: (next) => {
        const loaded = next as McpAppResource;
        // AUD-004/EX-04: the App contract requires CSP metadata before a
        // resource enters the sandbox. Missing, empty, or malformed metadata
        // fails closed with a stable `csp-metadata-missing` diagnostic and
        // never mounts under a guessed policy.
        const cspVerdict = validateMcpAppCspMetadata(
          loaded.meta?.csp ?? envelope.binding.meta.csp,
        );
        if (!cspVerdict.ok) {
          recordFailure(
            'csp-metadata-missing',
            `resource CSP metadata ${cspVerdict.detail}`,
          );
          return;
        }
        setLoadedResource({
          requestEpoch: resourceRequestEpoch,
          value: loaded,
        });
        recordPhase('mounting-sandbox');
      },
      onError: (next) => {
        recordFailure('resource-fetch-failed', sanitizeMcpAppDiagnosticDetail(next.message));
        const publish = () => {
          frameMountedRef.current = false;
          setFrameMounted(false);
          setError(next.message);
        };
        if (!frameMountedRef.current) {
          publish();
          return;
        }
        // A replacement fetch can fail while the previous App is still using
        // the retained iframe for teardown. Keep that DOM alive until its
        // bounded lifecycle barrier has released the document.
        void bridgeTeardownBarrierRef.current.catch(() => {}).then(publish);
      },
    });
    return () => controller.dispose();
  }, [
    attempt,
    directory,
    envelope.binding.resourceUri,
    envelope.binding.server,
    envelope.binding.toolKey,
    messageId,
    partId,
    resourceRequestEpoch,
    sessionId,
  ]);

  React.useLayoutEffect(() => {
    const frame = iframeRef.current;
    const target = frame?.contentWindow;
    if (!frame || !target || !resource || !appDocument || !sandboxProxyDocumentUrl) return;

    let disposed = false;
    let connected = false;
    let initialized = false;
    let teardownPromise: Promise<void> | null = null;
    let sandboxProxyController: ReturnType<typeof createMcpAppSandboxProxyHostController> | null = null;
    const bindingOperationAbort = new AbortController();
    bindingOperationAbortRef.current?.abort(
      new DOMException('MCP App binding replaced', 'AbortError'),
    );
    bindingOperationAbortRef.current = bindingOperationAbort;
    frameMountedRef.current = true;
    setFrameMounted(true);
    const previousTeardown = bridgeTeardownBarrierRef.current;
    const server = envelope.binding.server;
    const resourceUri = envelope.binding.resourceUri;
    const toolKey = envelope.binding.toolKey;
    const initialContext = displayContext(displayModeRef.current);
    const bridge = new AppBridge(
      null,
      { name: 'OpenChamber', version: '1' },
      hostCapabilities,
      {
        hostContext: initialContext.hostContext,
      },
    );
    const authority = createMcpAppBindingAuthorityGuard({
      bindingEpoch,
      getCurrentBindingEpoch: () => bindingAuthorityRef.current,
      isInitialized: () => initialized,
      isDisposed: () => disposed,
    });
    const ownsCurrentBinding = authority.ownsCurrentBinding;
    const hasActiveAuthority = authority.isActive;
    bridge.oncalltool = async (params, extra) => {
      if (!hasActiveAuthority()) throw new Error('MCP App bridge is not active');
      const operation = linkMcpAppOperationAbortSignals(
        extra?.signal,
        bindingOperationAbort.signal,
      );
      try {
        const result = await opencodeClient.callMcpAppTool({
          directory,
          sessionId,
          messageId,
          partId,
          server,
          resourceUri,
          toolKey,
          name: params.name,
          arguments: params.arguments ?? {},
          signal: operation.signal,
        }) as McpAppToolCallResult;
        if (operation.signal.aborted || !hasActiveAuthority()) {
          throw new DOMException('MCP App tool call was cancelled', 'AbortError');
        }
        return result;
      } finally {
        operation.dispose();
      }
    };
    bridge.onopenlink = async ({ url }) => {
      if (!hasActiveAuthority()) return { isError: true };
      return await openMcpAppExternalLink(url);
    };
    if (modelContextUpdatesEnabled) {
      const updateModelContext = createMcpAppModelContextUpdateHandler(
        () => latestEnvelopeRef.current,
        undefined,
        {
          getEpoch: () => bindingAuthorityRef.current,
          isCurrent: (acceptedEpoch) => (
            acceptedEpoch === bindingEpoch
            && bindingAuthorityRef.current === acceptedEpoch
            && !disposed
          ),
          getCallback: () => persistableEnvelopeChangeRef.current,
          onCommitted: (nextEnvelope) => {
            latestEnvelopeRef.current = nextEnvelope;
          },
        },
      );
      bridge.onupdatemodelcontext = async (params) => {
        if (!hasActiveAuthority()) return { isError: true };
        // Model-context updates (including tldraw's openchamberContentReady
        // marker) are persisted through the shared update handler. They are
        // optional model context, never generic readiness proof.
        return await updateModelContext(params);
      };
    }
    if (downloadsEnabled) {
      bridge.ondownloadfile = async (params, extra) => {
        if (!hasActiveAuthority()) return { isError: true };
        if (downloadInFlightRef.current) return { isError: true };
        downloadInFlightRef.current = true;
        const operation = linkMcpAppOperationAbortSignals(
          extra?.signal,
          bindingOperationAbort.signal,
        );
        const abort = () => settleWebDownload(false);
        operation.signal.addEventListener('abort', abort, { once: true });
        try {
          return await downloadMcpAppFiles(params, requestWebDownload, operation.signal);
        } finally {
          operation.signal.removeEventListener('abort', abort);
          operation.dispose();
          downloadInFlightRef.current = false;
        }
      };
    }
    bridge.onrequestdisplaymode = async ({ mode }) => ({
      mode: hasActiveAuthority() ? applyDisplayMode(mode) : displayModeRef.current,
    });
    bridge.onsizechange = ({ height: nextHeight }) => {
      if (!hasActiveAuthority()) return;
      // ui/notifications/size-changed is optional layout information (autoResize
      // false disables automatic size notification setup; sendSizeChanged stays
      // available manually, and a compliant App may send none) and is not
      // readiness proof.
      // Preserve the size-based inline-height behavior for Apps that do
      // report their preferred height.
      if (
        displayModeRef.current === 'inline'
        && typeof nextHeight === 'number'
        && Number.isFinite(nextHeight)
      ) {
        setHeight(Math.min(1_200, Math.max(160, Math.ceil(nextHeight))));
      }
    };
    bridge.oninitialized = () => {
      if (disposed || !ownsCurrentBinding()) return;
      initialized = true;
      appCapabilitiesRef.current = bridge.getAppCapabilities() ?? {};
      bridgeReadyRef.current = true;
      // P0-A: AppBridge is up. Protocol readiness requires the queued initial
      // Tool input/result delivery to complete successfully; a standards-
      // compliant App never has to prove visible content.
      recordPhase('delivering-tool-data');
      sandboxProxyController?.handleAppInitialized();
      const requestedMode = pendingDisplayModeRef.current;
      pendingDisplayModeRef.current = null;
      if (requestedMode) applyDisplayMode(requestedMode);
      publishHostContext(
        pendingHostContextRef.current
          ?? displayContext(displayModeRef.current).hostContext,
      );
      void toolNotificationQueueRef.current?.flush()
        .then((outcome) => {
          if (outcome === 'cancelled') {
            // A cancelled initial delivery keeps the existing teardown
            // behavior and never advances to ready.
            handleToolNotificationOutcome(outcome);
            return;
          }
          // idle/input/result are successful completion of the ordered
          // initial Tool input/result delivery. Protocol readiness depends
          // only on AppBridge initialization plus this delivery, and is
          // granted only from this AppBridge's own oninitialized path while
          // this exact bridge effect still owns the current binding
          // (hasActiveAuthority proves !disposed, initialized, and the
          // current binding epoch).
          if (hasActiveAuthority()) recordPhase('ready');
        })
        .catch((next) => {
          // A rejected initial delivery never grants ready. Only this exact
          // bridge effect's authority may surface the violation; a stale
          // flush from a superseded bridge must not invalidate a replacement.
          if (!hasActiveAuthority()) return;
          notificationViolationRef.current(
            next instanceof Error ? next.message : 'MCP App tool notification failed',
          );
        });
    };

    const transport = new PostMessageTransport(target, target);
    const removeLifecycleListeners = () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    };
    const retainAppDocument = () => {
      let retainedHost = retainedFrameHostRef.current;
      if (!retainedHost) {
        retainedHost = document.createElement('div');
        retainedHost.hidden = true;
        retainedHost.inert = true;
        retainedHost.setAttribute('aria-hidden', 'true');
        retainedHost.style.display = 'none';
        document.body.appendChild(retainedHost);
        retainedFrameHostRef.current = retainedHost;
      }
      if (frame.parentNode !== retainedHost) retainedHost.appendChild(frame);
    };
    const releaseAppDocument = () => {
      frame.removeAttribute('src');
      frame.removeAttribute('srcdoc');
      if (frame.parentNode) frame.parentNode.removeChild(frame);
      const retainedHost = retainedFrameHostRef.current;
      if (retainedHost) {
        if (retainedHost.parentNode) retainedHost.parentNode.removeChild(retainedHost);
        if (retainedFrameHostRef.current === retainedHost) retainedFrameHostRef.current = null;
      }
    };
    const teardownController = createMcpAppBridgeTeardownController({
      shouldRequestTeardown: () => initialized,
      requestTeardown: () => bridge.teardownResource(
        {},
        { timeout: MCP_APP_TEARDOWN_TIMEOUT_MS },
      ),
      disposeLoader: () => sandboxProxyController?.dispose(),
      removeLifecycleListeners,
      releaseAppDocument,
      clearBridgeReference: () => {
        if (bridgeRef.current === bridge) {
          bridgeRef.current = null;
          bridgeReadyRef.current = false;
          toolNotificationQueueRef.current?.reset();
        }
      },
      closeTransport: () => transport.close(),
    });
    const beginTeardown = () => {
      if (teardownPromise) return teardownPromise;
      disposed = true;
      bindingOperationAbort.abort(
        new DOMException('MCP App binding disposed', 'AbortError'),
      );
      if (bindingOperationAbortRef.current === bindingOperationAbort) {
        bindingOperationAbortRef.current = null;
      }
      // React removes the dialog immediately after layout-effect cleanup. Move
      // the live iframe under a hidden host first so the App can receive and
      // answer ui/resource-teardown during the bounded grace period.
      retainAppDocument();
      // Revoke the notification authority synchronously. The teardown request
      // uses the bridge captured by this effect and does not need the shared
      // ref, so a replacement ToolPart can never leak through the old bridge
      // while the App persists state during the bounded grace period.
      if (bridgeRef.current === bridge) {
        bridgeRef.current = null;
        bridgeReadyRef.current = false;
        appCapabilitiesRef.current = null;
        toolNotificationQueueRef.current?.reset();
      }
      // Once connected, the previous barrier has already resolved. Invoke the
      // controller immediately so ui/resource-teardown is posted during the
      // synchronous React cleanup turn, before the iframe can be detached.
      // An effect disposed while still queued simply remains behind the older
      // teardown and never opens its own transport.
      teardownPromise = connected
        ? teardownController.dispose()
        : previousTeardown.catch(() => {}).then(() => teardownController.dispose());
      bridgeTeardownBarrierRef.current = teardownPromise;
      return teardownPromise;
    };
    beginBridgeTeardownRef.current = beginTeardown;
    const invalidate = (reason: string) => {
      if (disposed) return;
      recordFailure('bridge-timeout', sanitizeMcpAppDiagnosticDetail(reason));
      void beginTeardown().finally(() => {
        frameMountedRef.current = false;
        setFrameMounted(false);
        setError(`MCP App bridge initialization failed (${reason})`);
      });
    };
    const onMessage = (event: MessageEvent) => {
      if (!ownsCurrentBinding()) return;
      sandboxProxyController?.handleMessage({
        source: event.source,
        origin: event.origin,
        data: event.data,
      });
    };
    const onLoad = () => {
      if (!ownsCurrentBinding()) return;
      sandboxProxyController?.handleLoad();
    };
    sandboxProxyController = createMcpAppSandboxProxyHostController({
      target,
      channelNonce,
      appIdentity: `${resource.sha256}:${channelNonce}`,
      appHtml: appDocument.html,
      csp: resource.meta?.csp ?? envelope.binding.meta.csp,
      permissions: resource.meta?.permissions ?? envelope.binding.meta.permissions,
      onProxyResourceMounted: () => {
        // The App document is mounted inside the sandbox; dependencies either
        // loaded or failed. Now we wait for AppBridge initialization.
        recordPhase('waiting-app-bridge');
      },
      onAppReady: () => {
        publishHostContext(displayContext(displayModeRef.current).hostContext);
      },
      onInvalidated: invalidate,
      onProbe: (probe) => {
        if (probe.type === 'csp-violation') {
          recordFailure(
            'dependency-blocked',
            sanitizeMcpAppDiagnosticDetail(
              `${probe.directive} blocked ${probe.origin}`.trim(),
            ),
          );
        } else if (probe.type === 'script-error') {
          recordFailure(
            'script-failed',
            sanitizeMcpAppDiagnosticDetail(probe.origin) || undefined,
          );
        } else if (probe.type === 'rejection') {
          recordFailure('script-failed');
        } else if (probe.type === 'layout-visible') {
          // Broker layout observation is optional diagnostic telemetry. It is
          // never readiness proof: protocol readiness depends only on
          // AppBridge initialization plus successful tool data delivery.
        }
      },
    });

    // A dependency change can reuse the same iframe. Never let a replacement
    // AppBridge connect while the previous bridge still owns that target.
    void activateMcpAppBridgeAfterTeardown(
      previousTeardown,
      () => disposed,
      async () => {
        if (disposed) return;
        const frameSlot = frameSlotRef.current;
        if (!frameSlot) throw new Error('MCP App frame slot is unavailable');
        if (frame.parentNode !== frameSlot) frameSlot.appendChild(frame);
        bridgeRef.current = bridge;
        window.addEventListener('message', onMessage);
        frame.addEventListener('load', onLoad);
        // Cleanup of a previous bridge revokes the old outer document after its
        // bounded teardown response. Re-arm the isolated proxy only after that
        // barrier resolves so one contentWindow never has two authorities.
        restoreMcpAppLoaderFrame(frame, sandboxProxyDocumentUrl);
        const connection = bridge.connect(transport);
        sandboxProxyController?.start();
        await connection;
        if (!disposed) connected = true;
      },
    ).catch((next) => {
      if (!disposed) invalidate(next instanceof Error ? next.message : 'app-bridge-connect');
    });
    return () => {
      if (beginBridgeTeardownRef.current === beginTeardown) {
        beginBridgeTeardownRef.current = null;
      }
      const pending = pendingDownloadRef.current;
      pendingDownloadRef.current = null;
      setPendingDownload(null);
      pending?.resolve(false);
      downloadInFlightRef.current = false;
      void beginTeardown();
    };
  }, [
    applyDisplayMode,
    appDocument,
    bindingEpoch,
    channelNonce,
    directory,
    displayContext,
    envelope.binding.resourceUri,
    envelope.binding.server,
    envelope.binding.toolKey,
    downloadsEnabled,
    hostCapabilities,
    handleToolNotificationOutcome,
    messageId,
    modelContextUpdatesEnabled,
    partId,
    publishHostContext,
    resource,
    requestWebDownload,
    sandboxProxyDocumentUrl,
    sessionId,
    settleWebDownload,
  ]);

  React.useEffect(() => {
    // Capture the initiating authority when the flush is scheduled: the queue
    // may serialize behind an earlier delivery while React swaps the bridge or
    // the binding. A later envelope/status flush only surfaces a protocol
    // violation when the initiating bridge still owns the initiating epoch;
    // a stale rejection must never invalidate a replacement bridge.
    const initiatingEpoch = bindingEpoch;
    const initiatingBridge = bridgeRef.current;
    void toolNotificationQueueRef.current?.flush()
      .then(handleToolNotificationOutcome)
      .catch((next) => {
        if (bindingAuthorityRef.current !== initiatingEpoch) return;
        if (bridgeRef.current !== initiatingBridge) return;
        notificationViolationRef.current(
          next instanceof Error ? next.message : 'MCP App tool notification failed',
        );
      });
  }, [bindingEpoch, envelope, handleToolNotificationOutcome, toolCancellationReason, toolStateStatus]);

  React.useLayoutEffect(() => {
    const dialog = hostRef.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (displayMode === 'fullscreen') dialog.showModal();
    else dialog.show();
    publishHostContext(displayContext(displayMode).hostContext);
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [displayContext, displayMode, publishHostContext, resource]);

  React.useLayoutEffect(() => {
    const target = iframeRef.current;
    if (!target || !resource || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const publishDimensions = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        publishHostContext(displayContext(displayModeRef.current).hostContext);
      });
    };
    const observer = new ResizeObserver(publishDimensions);
    observer.observe(target);
    publishDimensions();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [displayContext, layoutEpoch, publishHostContext, resource]);

  if (terminalNotice) {
    return (
      <div className={cn('tool-output-surface rounded-xl border border-border/60 p-4', className)}>
        <div className="font-medium text-muted-foreground">MCP App closed</div>
        <div className="mt-1 text-sm text-muted-foreground">{terminalNotice}</div>
        {fallback ? <div className="mt-3">{fallback}</div> : null}
      </div>
    );
  }

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

  if (!resource && !frameMounted) {
    return (
      <div
        className={cn('h-52 animate-pulse rounded-xl bg-muted/40', className)}
        data-mcp-app-loading-stage="resource"
        aria-label="Loading MCP App resource"
      />
    );
  }

  const fullscreen = displayMode === 'fullscreen';
  const presentationLayout = buildMcpAppPresentationLayout({
    displayMode,
    presentation,
    inlineHeight: height,
  });
  return (
    <dialog
      ref={hostRef}
      role={fullscreen ? 'dialog' : 'group'}
      aria-modal={fullscreen || undefined}
      data-mcp-app-display-mode={displayMode}
      onCancel={(event) => {
        event.preventDefault();
        if (pendingDownload) settleWebDownload(false);
        else applyDisplayMode('inline');
      }}
      className={buildMcpAppDialogClassName({
        className,
        fillContainer: presentationLayout.fillContainer,
        fullscreen,
      })}
      style={fullscreen ? MCP_APP_FULLSCREEN_STYLE : undefined}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">{envelope.title}</span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">MCP App</span>
        {fullscreen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => applyDisplayMode('inline')}
            aria-label="Exit fullscreen"
          >
            <Icon name="fullscreen-exit" className="size-4" />
          </Button>
        ) : null}
      </div>
      <div
        ref={frameSlotRef}
        className={cn(
          'min-h-0 w-full',
          presentationLayout.fillContainer && 'flex-1',
        )}
        style={{
          height: presentationLayout.iframeHeight,
        }}
      >
        <iframe
          ref={iframeRef}
          title={envelope.title}
          sandbox={MCP_APP_SANDBOX_PROXY_SANDBOX}
          allow={resolveMcpAppIframeAllowAttribute(
            resource?.meta?.permissions ?? envelope.binding.meta.permissions ?? undefined,
          )}
          referrerPolicy="no-referrer"
          className="block h-full min-h-0 w-full border-0 bg-transparent"
          style={{ visibility: resource ? undefined : 'hidden' }}
          inert={pendingDownload || !resource ? true : undefined}
          aria-hidden={pendingDownload || !resource ? true : undefined}
          tabIndex={pendingDownload || !resource ? -1 : undefined}
        />
      </div>
      {!resource ? (
        <div
          className="absolute inset-x-0 bottom-0 top-10 animate-pulse bg-muted/40"
          data-mcp-app-loading-stage="resource"
          aria-label="Loading MCP App resource"
        />
      ) : null}
      {pendingDownload ? (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            settleWebDownload(false);
          }}
        >
          <div
            role="alertdialog"
            aria-labelledby={downloadTitleId}
            aria-describedby={downloadDescriptionId}
            className="w-full max-w-md rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
          >
            <div id={downloadTitleId} className="font-semibold">
              Untrusted MCP App export
            </div>
            <div id={downloadDescriptionId} className="mt-2 text-sm text-muted-foreground">
              This MCP App wants to save <span className="font-medium text-foreground">{pendingDownload.fileName}</span>
              {' '}({formatMcpAppDownloadSize(pendingDownload.bytes.byteLength)}).
              Your browser will ask where to download it; OpenChamber will not open or execute it.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" autoFocus onClick={() => settleWebDownload(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => settleWebDownload(true)}>
                Save file
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
  },
);
