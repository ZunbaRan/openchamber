import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  PATTERNED_PNG_FEATURE_COLORS,
  assessFailureEvidence,
  assessTldrawEditorReadiness,
  assessTldrawSurfaceContract,
  buildSemanticCreatePrompt,
  SEMANTIC_CREATE_REQUESTED_ELEMENT_COUNT,
  createPatternedPngBuffer,
  deriveRequiredCheckpointOk,
  findSemanticCreateToolPart,
  inspectCheckpointOutcome,
  inspectRegistry,
  inspectToolOutcome,
  isProjectDirectoryOnboardingText,
  parseModelSelector,
  selectActiveAppContext,
  selectHostPersistablePinAction,
  serializeError,
  validateSemanticElementCountEvidence,
  validateEditorInteractionEvidence,
  validatePngBuffer,
  validateSvgBuffer,
} from './lib/tldraw-mcp-app-browser-acceptance.mjs';
import { deriveWorkbenchProjectId } from './lib/tldraw-mcp-app-browser-orchestration.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = (
  process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_BASE_URL
  || process.env.OPENCHAMBER_ACCEPTANCE_BASE_URL
  || 'http://127.0.0.1:5180'
).replace(/\/$/, '');
const serverName = process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_SERVER || 'interop-tldraw-2026';
const modelSelector = process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_MODEL || 'alibaba-coding-plan-cn/qwen3.7-plus';
const preserveFailureState = process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_PRESERVE === '1';
const model = parseModelSelector(modelSelector);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const requestedOutputDirectory = process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_OUTPUT_DIRECTORY?.trim();
const outputDirectory = requestedOutputDirectory
  ? path.resolve(requestedOutputDirectory)
  : path.join(projectRoot, '.tmp', 'tldraw-mcp-app-browser', runId);
const downloadsDirectory = path.join(outputDirectory, 'downloads');
const reportPath = path.join(outputDirectory, 'report.json');
const chromeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-tldraw-browser-'));
const canvasId = `oc-acceptance-${Date.now()}`;
const sessionTitle = `tldraw MCP App acceptance · ${runId}`;
// Workbench boards are keyed by path_<base64url(abs path)>; the shared helper
// guarantees the polled board is the board the host Pin action persists into.
const projectId = deriveWorkbenchProjectId(projectRoot);
const renamedGatewayLabel = 'Browser Gateway';
const expectedExportedLabels = [renamedGatewayLabel, 'Order Service', 'Payment Service'];
const secondaryPageName = 'Acceptance Detail';
const secondaryPageShapeLabel = 'Page Two Node';
const acceptancePngBuffer = createPatternedPngBuffer({ width: 96, height: 64 });
const acceptancePngBase64 = acceptancePngBuffer.toString('base64');
const acceptancePngSha256 = createHash('sha256').update(acceptancePngBuffer).digest('hex');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpoints = [];
const evidence = { screenshots: [], downloads: [] };
const REQUIRED_CHECKPOINTS = [
  'MCP 2026 capability and visibility',
  'Agent semantic tool creation',
  'Inline preview in conversation',
  'Fullscreen Edit, app-only add, move, rename, connect, Save',
  'Restricted image upload, exact asset Save, and same-canvas recovery',
  'Real multi-page UI, in-flight Save page switch, and page-scoped exports',
  'Real SVG and PNG export bytes',
  'Done, reopen and exact history recovery',
  'Production CSP host locale zh-CN and zh-TW with offline real tldraw UI',
  'Pin and App Board fullscreen',
  'No MCP App fallback or isError result',
];
let sessionId;
let createdTileId;
let chromeProcess;
let browser;
let failure;
let failureEvidence;
let uploadedImageSha256;
const supplementalFrameContexts = new Map();
const supplementalFrameDiagnostics = [];
let supplementalFrameOrdinal = 1_000_000;

const diagnosticLogPaths = [
  ...(process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_DIAGNOSTIC_LOGS?.split(path.delimiter) ?? []),
  '/Users/loloru/.local/share/tldraw-mcp-app/server.log',
  '/Users/loloru/.local/share/opencode/log/opencode.log',
].map((candidate) => candidate.trim()).filter(Boolean);

const readResponse = async (response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const summarizeSemanticEndpoint = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    elementId: typeof value.elementId === 'string' ? value.elementId : null,
    x: Number.isFinite(value.x) ? value.x : null,
    y: Number.isFinite(value.y) ? value.y : null,
    anchorX: Number.isFinite(value.anchorX) ? value.anchorX : null,
    anchorY: Number.isFinite(value.anchorY) ? value.anchorY : null,
  };
};

const summarizeSemanticOperation = (operation) => {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    return { op: 'invalid' };
  }
  const element = operation.element && typeof operation.element === 'object'
    ? operation.element
    : null;
  const changes = operation.changes && typeof operation.changes === 'object'
    ? operation.changes
    : null;
  return {
    op: typeof operation.op === 'string' ? operation.op : null,
    id: typeof operation.id === 'string'
      ? operation.id
      : typeof element?.id === 'string'
        ? element.id
        : null,
    kind: typeof element?.kind === 'string' ? element.kind : null,
    changeKeys: changes ? Object.keys(changes).sort() : [],
    text: typeof changes?.text === 'string'
      ? changes.text.slice(0, 160)
      : typeof element?.text === 'string'
        ? element.text.slice(0, 160)
        : null,
    start: summarizeSemanticEndpoint(operation.start ?? element?.start),
    end: summarizeSemanticEndpoint(operation.end ?? element?.end),
    parentId: operation.parentId ?? element?.parentId ?? null,
    layer: Number.isInteger(operation.layer ?? element?.layer)
      ? (operation.layer ?? element.layer)
      : null,
  };
};

const summarizeAssetManifest = (value) => Array.isArray(value)
  ? value.map((item) => ({
      sha256: typeof item?.sha256 === 'string' ? item.sha256 : null,
      mimeType: typeof item?.mimeType === 'string' ? item.mimeType : null,
      byteLength: Number.isInteger(item?.byteLength) ? item.byteLength : null,
    }))
  : null;

const snapshotRecordValues = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const document = snapshot.document && typeof snapshot.document === 'object' && !Array.isArray(snapshot.document)
    ? snapshot.document
    : snapshot;
  const store = document.store;
  if (Array.isArray(store)) return store.filter((record) => record && typeof record === 'object');
  if (!store || typeof store !== 'object') return [];
  return Object.values(store).filter((record) => record && typeof record === 'object');
};

const snapshotShapeText = (shape) => {
  const values = [];
  const visit = (value, depth = 0) => {
    if (depth > 8 || values.length >= 24 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.trim()) values.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/^(?:text|label|richText|content)$/i.test(key) || depth > 0) visit(item, depth + 1);
      }
    }
  };
  visit(shape?.props);
  return [...new Set(values)].join(' ').replace(/\s+/g, ' ').slice(0, 400);
};

const summarizeTldrawSnapshot = (snapshot) => {
  const records = snapshotRecordValues(snapshot);
  const pages = records.filter((record) => record.typeName === 'page');
  const shapes = records.filter((record) => record.typeName === 'shape');
  const byId = new Map(records.map((record) => [record.id, record]));
  const rootPageId = (shape) => {
    let parentId = shape.parentId;
    const visited = new Set();
    while (typeof parentId === 'string' && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (parent.typeName === 'page') return parent.id;
      parentId = parent.parentId;
    }
    return null;
  };
  const activePageId = snapshot?.session && typeof snapshot.session === 'object'
    ? snapshot.session.currentPageId ?? null
    : null;
  return {
    activePageId,
    pageCount: pages.length,
    pages: pages.map((page) => {
      const pageShapes = shapes.filter((shape) => rootPageId(shape) === page.id);
      return {
        id: page.id,
        name: typeof page.name === 'string' ? page.name : null,
        shapeCount: pageShapes.length,
        shapeTypes: [...new Set(pageShapes.map((shape) => shape.type).filter(Boolean))].sort(),
        text: pageShapes.map(snapshotShapeText).filter(Boolean).join(' ').slice(0, 800),
      };
    }),
  };
};

const summarizeToolCallRequest = (postData) => {
  let payload;
  try {
    payload = JSON.parse(postData);
  } catch {
    return { parseError: 'non-json-request', byteLength: Buffer.byteLength(postData) };
  }
  const args = payload?.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
  const snapshotJson = args.snapshot === undefined ? null : JSON.stringify(args.snapshot);
  const semanticPatch = args.semanticPatch && typeof args.semanticPatch === 'object' ? args.semanticPatch : null;
  return {
    binding: {
      sessionID: payload?.sessionID ?? null,
      messageID: payload?.messageID ?? null,
      server: payload?.server ?? null,
      resourceUri: payload?.resourceUri ?? null,
      name: payload?.name ?? null,
    },
    arguments: {
      canvasId: args.canvasId ?? null,
      expectedRevision: args.expectedRevision ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      format: args.format ?? null,
      byteLength: args.byteLength ?? null,
      sha256: args.sha256 ?? null,
      shapeCount: args.shapeCount ?? null,
      assetManifest: summarizeAssetManifest(args.assetManifest),
      uploadId: typeof args.uploadId === 'string' ? args.uploadId : null,
      offset: Number.isInteger(args.offset) ? args.offset : null,
      length: Number.isInteger(args.length) ? args.length : null,
      declaredByteLength: Number.isInteger(args.byteLength) ? args.byteLength : null,
      dataBase64: typeof args.dataBase64 === 'string' ? {
        encodedByteLength: Buffer.byteLength(args.dataBase64),
        sha256: sha256(args.dataBase64),
      } : null,
      semanticPatch: semanticPatch ? {
        canvasId: semanticPatch.canvasId ?? null,
        expectedRevision: semanticPatch.expectedRevision ?? null,
        transactionId: semanticPatch.transactionId ?? null,
        operationCount: Array.isArray(semanticPatch.operations) ? semanticPatch.operations.length : null,
        operations: Array.isArray(semanticPatch.operations)
          ? semanticPatch.operations.map(summarizeSemanticOperation)
          : [],
      } : null,
      snapshot: snapshotJson === null ? null : {
        byteLength: Buffer.byteLength(snapshotJson),
        sha256: sha256(snapshotJson),
        document: summarizeTldrawSnapshot(args.snapshot),
      },
      operationSummary: args.operationSummary && typeof args.operationSummary === 'object'
        ? {
            added: Number(args.operationSummary.added ?? 0),
            movedOrEdited: Number(args.operationSummary.movedOrEdited ?? 0),
            removed: Number(args.operationSummary.removed ?? 0),
          }
        : null,
      noteOperationCount: Array.isArray(args.noteOperations) ? args.noteOperations.length : 0,
      diagramPatchKeys: args.diagramPatch && typeof args.diagramPatch === 'object'
        ? Object.keys(args.diagramPatch).sort()
        : [],
    },
    requestByteLength: Buffer.byteLength(postData),
  };
};

const summarizeToolCallResponse = (body) => {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { parseError: 'non-json-response', byteLength: Buffer.byteLength(body) };
  }
  const result = payload?.data ?? payload;
  const outcome = inspectToolOutcome({ state: { output: JSON.stringify(result) } });
  return {
    isError: result?.isError === true || outcome.isError,
    fallbackDetected: outcome.fallbackDetected,
    fallbackSignals: outcome.fallbackSignals,
    content: Array.isArray(result?.content)
      ? result.content
          .filter((item) => item?.type === 'text')
          .map((item) => String(item.text).slice(0, 1_200))
      : [],
    structuredContent: result?.structuredContent && typeof result.structuredContent === 'object'
      ? {
          canvasId: result.structuredContent.canvasId ?? null,
          revision: result.structuredContent.revision ?? null,
          semanticElementCount: result.structuredContent.semanticElementCount ?? null,
          semanticDocumentElementCount: Array.isArray(result.structuredContent.semanticDocument?.elements)
            ? result.structuredContent.semanticDocument.elements.length
            : null,
          lastSavedRevision: result.structuredContent.lastSaved?.revision ?? null,
          format: result.structuredContent.format ?? null,
          mimeType: result.structuredContent.mimeType ?? null,
          byteLength: result.structuredContent.byteLength ?? null,
          sha256: result.structuredContent.sha256 ?? null,
          shapeCount: result.structuredContent.shapeCount ?? null,
          assetManifest: summarizeAssetManifest(result.structuredContent.assetManifest),
          uploadId: result.structuredContent.uploadId ?? null,
          nextOffset: result.structuredContent.nextOffset ?? null,
          chunkSize: result.structuredContent.chunkSize ?? null,
          done: result.structuredContent.done ?? null,
          dataBase64: typeof result.structuredContent.dataBase64 === 'string' ? {
            encodedByteLength: Buffer.byteLength(result.structuredContent.dataBase64),
            sha256: sha256(result.structuredContent.dataBase64),
          } : null,
          asset: result.structuredContent.asset && typeof result.structuredContent.asset === 'object'
            ? {
                logicalUri: result.structuredContent.asset.logicalUri ?? null,
                sha256: result.structuredContent.asset.sha256 ?? null,
                mimeType: result.structuredContent.asset.mimeType ?? null,
                byteLength: result.structuredContent.asset.byteLength ?? null,
              }
            : null,
        }
      : null,
    error: result?.error ? String(result.error).slice(0, 1_200) : null,
    responseByteLength: Buffer.byteLength(body),
  };
};

const readDiagnosticLogs = async (offsets) => Promise.all(diagnosticLogPaths.map(async (filename) => {
  try {
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      const start = Math.min(offsets.get(filename) ?? 0, stat.size);
      const byteLength = Math.min(stat.size - start, 512 * 1024);
      const buffer = Buffer.alloc(Math.max(0, byteLength));
      if (byteLength > 0) await handle.read(buffer, 0, byteLength, start);
      const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => (
        line.includes(canvasId)
        || (sessionId && line.includes(sessionId))
        || line.includes(serverName)
        || /tldraw_save_canvas|mcp.*tool.call|revision_conflict|semantic_patch|snapshot_/i.test(line)
      ));
      return {
        filename,
        startOffset: start,
        endOffset: stat.size,
        matchingLines: lines.slice(-80).map((line) => line
          .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
          .replace(/(["']?(?:token|api[-_]?key|authorization)["']?\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]')),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return { filename, error: error.message, matchingLines: [] };
  }
}));

const request = async (pathname, { method = 'GET', body, timeoutMs = 30_000 } = {}) => {
  // Never call provider/auth endpoints here: their payloads may contain credentials.
  assert(!pathname.startsWith('/api/config/providers'), 'Provider endpoints are forbidden in acceptance evidence');
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${String(payload?.code ?? payload).slice(0, 240)}`);
  }
  return payload;
};

const waitFor = async (operation, label, timeoutMs = 120_000, intervalMs = 350) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError?.message ? `: ${lastError.message}` : ''}`);
};

const checkpoint = async (name, operation) => {
  const startedAt = Date.now();
  try {
    const detail = await operation();
    const outcome = inspectCheckpointOutcome(detail);
    if (!outcome.pass) {
      throw new Error(`${name} did not complete: ${outcome.reason}`);
    }
    checkpoints.push({ name, status: 'pass', durationMs: Date.now() - startedAt, detail });
    return detail;
  } catch (error) {
    checkpoints.push({ name, status: 'fail', durationMs: Date.now() - startedAt, error: serializeError(error) });
    throw error;
  }
};

const activeBoard = (snapshot) => snapshot?.boards?.find((board) => board.id === snapshot.activeBoardId);

const boardSnapshot = () => request(`/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}`);

const waitForSession = async (id, timeoutMs = 240_000) => {
  const outcome = await waitFor(async () => {
  const [messages, statuses] = await Promise.all([
    request(`/api/session/${encodeURIComponent(id)}/message?directory=${encodeURIComponent(projectRoot)}`),
    request(`/api/session/status?directory=${encodeURIComponent(projectRoot)}`).catch(() => ({})),
  ]);
  const assistant = messages.filter((message) => message?.info?.role === 'assistant');
  const targetParts = assistant.flatMap((message) => (message.parts ?? []).filter((part) => (
    part?.type === 'tool'
    && part?.tool === `${serverName}_tldraw_create_view`
    && part?.state?.input?.canvasId === canvasId
  )));
  const failedCreate = targetParts.find((part) => part?.state?.status === 'error');
  if (failedCreate) {
    return {
      messages,
      failure: failedCreate.state?.error
        || failedCreate.state?.output
        || failedCreate.state?.metadata
        || 'Agent semantic create tool failed',
    };
  }
  const completedCreate = targetParts.some((part) => part?.state?.status === 'completed');
  const idle = (statuses?.[id]?.type ?? 'idle') === 'idle';
  return completedCreate && idle ? { messages, failure: null } : null;
  }, `Agent semantic create ToolPart for ${id}`, timeoutMs, 750);
  if (outcome.failure !== null) {
    throw new Error(`Agent semantic create Tool failed: ${JSON.stringify(outcome.failure)}`);
  }
  return outcome.messages;
};

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
};

const findChrome = async () => {
  const candidates = [
    process.env.OPENCHAMBER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next reviewed browser path.
    }
  }
  throw new Error('Chrome/Chromium not found; set OPENCHAMBER_TEST_CHROME');
};

const listChromePageTargets = async (debugPort) => {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  assert.equal(response.ok, true, `Chrome DevTools /json/list failed (${response.status})`);
  const targets = await response.json();
  assert(Array.isArray(targets), 'Chrome DevTools /json/list returned a non-array payload');
  return targets.filter((target) => target?.type === 'page');
};

const connectBrowser = async (webSocketDebuggerUrl) => {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  const contexts = new Map();
  const childSessions = new Map();
  const runtimeErrors = [];
  const consoleErrors = [];
  const consoleEvents = [];
  const pageErrors = [];
  const networkRequests = [];
  const downloads = new Map();
  const appToolExchanges = [];
  const appToolExchangeByRequest = new Map();
  const appResourceLoads = [];
  const appResourceLoadByRequest = new Map();
  const rendererChunks = [];
  const rendererChunkByRequest = new Map();
  let contextOrdinal = 0;
  let send;
  const pushBounded = (target, value, maximum = 5_000) => {
    target.push(value);
    if (target.length > maximum) target.splice(0, target.length - maximum);
  };
  const summarizeNetworkUrl = (value) => {
    const url = String(value || '');
    if (/^data:/i.test(url)) {
      const mediaType = (url.match(/^data:([^;,]*)/i) || [])[1] || 'unknown';
      return `data:${mediaType};<redacted:${url.length}>`;
    }
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.slice(0, 500);
    }
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Target.attachedToTarget') {
      childSessions.set(message.params.sessionId, message.params.targetInfo);
      void send?.('Runtime.enable', {}, message.params.sessionId);
      void send?.('Network.enable', {}, message.params.sessionId);
      void send?.('Log.enable', {}, message.params.sessionId);
    }
    if (message.method === 'Target.detachedFromTarget') {
      childSessions.delete(message.params.sessionId);
      for (const [key, context] of contexts) {
        if (context.sessionId === message.params.sessionId) contexts.delete(key);
      }
    }
    if (message.method === 'Target.targetInfoChanged') {
      for (const [sessionIdValue, targetInfo] of childSessions) {
        if (targetInfo.targetId === message.params.targetInfo.targetId) {
          childSessions.set(sessionIdValue, message.params.targetInfo);
        }
      }
    }
    if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params.context;
      contexts.set(`${message.sessionId ?? 'root'}:${context.id}`, {
        ...context,
        sessionId: message.sessionId ?? null,
        createdOrdinal: ++contextOrdinal,
        createdAt: new Date().toISOString(),
      });
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      contexts.delete(`${message.sessionId ?? 'root'}:${message.params.executionContextId}`);
    }
    if (message.method === 'Runtime.executionContextsCleared') {
      for (const [key, context] of contexts) {
        if ((context.sessionId ?? null) === (message.sessionId ?? null)) contexts.delete(key);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      const description = details.exception?.description || details.text || 'Runtime exception';
      const pageError = {
        at: new Date().toISOString(),
        sessionId: message.sessionId ?? 'root',
        text: String(description).slice(0, 1_200),
        url: details.url ? summarizeNetworkUrl(details.url) : null,
        lineNumber: details.lineNumber ?? null,
        columnNumber: details.columnNumber ?? null,
      };
      pushBounded(pageErrors, pageError);
      pushBounded(runtimeErrors, pageError.text);
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const consoleEvent = {
        at: new Date().toISOString(),
        sessionId: message.sessionId ?? 'root',
        type: message.params.type,
        text: message.params.args
          .map((argument) => String(argument.value ?? argument.description ?? argument.type ?? ''))
          .join(' ')
          .slice(0, 1_200),
      };
      pushBounded(consoleEvents, consoleEvent);
      if (message.params.type === 'error' || message.params.type === 'assert') {
        pushBounded(consoleErrors, consoleEvent.text);
      }
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const consoleEvent = {
        at: new Date().toISOString(),
        sessionId: message.sessionId ?? 'root',
        type: 'log-error',
        text: String(message.params.entry.text || '').slice(0, 1_200),
      };
      pushBounded(consoleEvents, consoleEvent);
      pushBounded(consoleErrors, consoleEvent.text);
    }
    if (message.method === 'Browser.downloadWillBegin') {
      downloads.set(message.params.guid, { ...message.params, state: 'inProgress' });
    }
    if (message.method === 'Browser.downloadProgress') {
      downloads.set(message.params.guid, { ...(downloads.get(message.params.guid) ?? {}), ...message.params });
    }
    if (message.method === 'Network.requestWillBeSent') {
      pushBounded(networkRequests, {
        at: new Date().toISOString(),
        sessionId: message.sessionId ?? 'root',
        url: summarizeNetworkUrl(message.params.request.url),
        method: message.params.request.method,
        type: message.params.type ?? null,
        initiatorType: message.params.initiator?.type ?? null,
      });
    }
    if (
      message.method === 'Network.requestWillBeSent'
      && message.params.request.url.includes('/mcp/app/tool-call')
    ) {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const exchange = {
        at: new Date().toISOString(),
        sessionId: message.sessionId ?? 'root',
        url: new URL(message.params.request.url).pathname,
        request: null,
        response: null,
      };
      appToolExchanges.push(exchange);
      appToolExchangeByRequest.set(key, exchange);
      const requestPostData = message.params.request.postData
        ? Promise.resolve(message.params.request.postData)
        : send?.(
            'Network.getRequestPostData',
            { requestId: message.params.requestId },
            message.sessionId ?? null,
          ).then((response) => response.result.postData);
      void requestPostData?.then((postData) => {
        exchange.request = summarizeToolCallRequest(postData);
      }).catch((error) => {
        exchange.request = { error: `request-post-data-unavailable: ${error.message}` };
      });
    }
    if (
      message.method === 'Network.requestWillBeSent'
      && message.params.request.url.includes('/mcp/app/resource')
    ) {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const url = new URL(message.params.request.url);
      const load = {
        at: new Date().toISOString(),
        path: url.pathname,
        binding: {
          sessionID: url.searchParams.get('sessionID'),
          messageID: url.searchParams.get('messageID'),
          server: url.searchParams.get('server'),
          resourceUri: url.searchParams.get('resourceUri'),
          force: url.searchParams.get('force'),
        },
        status: 'pending',
        httpStatus: null,
        mimeType: null,
        encodedDataLength: null,
        bodyByteLength: null,
        bodySha256: null,
        bodyError: null,
        errorText: null,
      };
      appResourceLoads.push(load);
      appResourceLoadByRequest.set(key, load);
    }
    if (
      message.method === 'Network.requestWillBeSent'
      && /(?:McpAppRenderer|InteractiveUIView)[^/]*\.js(?:\?|$)/.test(message.params.request.url)
    ) {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const chunk = {
        at: new Date().toISOString(),
        path: new URL(message.params.request.url).pathname,
        status: 'pending',
        httpStatus: null,
        encodedDataLength: null,
        errorText: null,
      };
      rendererChunks.push(chunk);
      rendererChunkByRequest.set(key, chunk);
    }
    if (
      message.method === 'Network.responseReceived'
      && message.params.response.url.includes('/mcp/app/tool-call')
    ) {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const exchange = appToolExchangeByRequest.get(key);
      if (exchange) exchange.httpStatus = message.params.response.status;
    }
    if (message.method === 'Network.responseReceived') {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const load = appResourceLoadByRequest.get(key);
      if (load) {
        load.httpStatus = message.params.response.status;
        load.mimeType = message.params.response.mimeType;
      }
      const chunk = rendererChunkByRequest.get(key);
      if (chunk) chunk.httpStatus = message.params.response.status;
    }
    if (message.method === 'Network.loadingFinished') {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const exchange = appToolExchangeByRequest.get(key);
      if (exchange) {
        void send?.(
          'Network.getResponseBody',
          { requestId: message.params.requestId },
          message.sessionId ?? null,
        ).then((response) => {
          exchange.response = summarizeToolCallResponse(response.result.body);
        }).catch((error) => {
          exchange.response = { error: `response-body-unavailable: ${error.message}` };
        });
      }
      const load = appResourceLoadByRequest.get(key);
      if (load) {
        load.status = 'completed';
        load.encodedDataLength = message.params.encodedDataLength;
        void send?.(
          'Network.getResponseBody',
          { requestId: message.params.requestId },
          message.sessionId ?? null,
        ).then((response) => {
          const body = String(response.result?.body ?? '');
          const bytes = response.result?.base64Encoded
            ? Buffer.from(body, 'base64')
            : Buffer.from(body, 'utf8');
          load.bodyByteLength = bytes.byteLength;
          load.bodySha256 = sha256(bytes);
          try {
            const payload = JSON.parse(body);
            const html = typeof payload?.html === 'string' ? payload.html : null;
            if (html !== null) {
              load.resourceHtmlByteLength = Buffer.byteLength(html, 'utf8');
              load.resourceHtmlSha256 = sha256(Buffer.from(html, 'utf8'));
              load.declaredResourceSha256 = typeof payload.sha256 === 'string'
                ? payload.sha256
                : null;
            }
          } catch {
            // The raw response hash remains useful even when the wrapper is not JSON.
          }
        }).catch((error) => {
          load.bodyError = `response-body-unavailable: ${error.message}`;
        });
      }
      const chunk = rendererChunkByRequest.get(key);
      if (chunk) {
        chunk.status = 'completed';
        chunk.encodedDataLength = message.params.encodedDataLength;
      }
    }
    if (message.method === 'Network.loadingFailed') {
      const key = `${message.sessionId ?? 'root'}:${message.params.requestId}`;
      const load = appResourceLoadByRequest.get(key);
      if (load) {
        load.status = message.params.canceled ? 'canceled' : 'failed';
        load.errorText = message.params.errorText;
      }
      const chunk = rendererChunkByRequest.get(key);
      if (chunk) {
        chunk.status = message.params.canceled ? 'canceled' : 'failed';
        chunk.errorText = message.params.errorText;
      }
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message);
    }
  });
  send = (method, params = {}, sessionIdValue = null) => new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionIdValue ? { sessionId: sessionIdValue } : {}) }));
  });
  const evaluate = async (expression, contextId = null, sessionIdValue = null) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId ? { contextId } : {}),
    }, sessionIdValue);
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  return {
    socket,
    send,
    evaluate,
    contexts,
    childSessions,
    runtimeErrors,
    consoleErrors,
    consoleEvents,
    pageErrors,
    networkRequests,
    downloads,
    appToolExchanges,
    appResourceLoads,
    rendererChunks,
    getContextOrdinal: () => contextOrdinal,
  };
};

const inspectAppContexts = async () => {
  const candidates = [];
  for (const context of browser.contexts.values()) {
    const sessionActive = context.sessionId === null || browser.childSessions.has(context.sessionId);
    const target = context.sessionId === null ? null : browser.childSessions.get(context.sessionId) ?? null;
    const base = {
      contextId: context.id,
      sessionId: context.sessionId,
      createdOrdinal: context.createdOrdinal,
      createdAt: context.createdAt,
      frameId: context.auxData?.frameId ?? null,
      isDefaultContext: context.auxData?.isDefault === true,
      contextType: context.auxData?.type ?? null,
      contextName: context.name ?? '',
      contextOrigin: context.origin ?? '',
      sessionActive,
      target: target ? {
        targetId: target.targetId ?? null,
        type: target.type ?? null,
        url: target.url ?? null,
        attached: target.attached ?? null,
      } : null,
    };
    try {
      const state = await browser.evaluate(`(() => {
        const shell = document.querySelector('.acceptance-shell');
        const documentState = {
          documentUrl: location.href,
          documentVisibility: document.visibilityState,
          documentReadyState: document.readyState,
        };
        if (!(shell instanceof HTMLElement)) return {
          ...documentState,
          hasShell: false,
          shellConnected: false,
          shellOffsetParent: false,
          shellDisplay: '',
          shellVisibility: '',
          shellOpacity: '',
          shellRect: null,
        };
        const text = document.body?.innerText || '';
        const buttons = Array.from(document.querySelectorAll('button')).map((button) => {
          const buttonRect = button.getBoundingClientRect();
          const buttonStyle = getComputedStyle(button);
          return {
            text: button.textContent?.trim() || '',
            title: button.getAttribute('title') || '',
            disabled: button.disabled,
            visible: button.isConnected
              && button.offsetParent !== null
              && buttonRect.width > 1
              && buttonRect.height > 1
              && buttonStyle.display !== 'none'
              && buttonStyle.visibility !== 'hidden'
              && buttonStyle.opacity !== '0',
            rect: {
              x: buttonRect.x,
              y: buttonRect.y,
              width: buttonRect.width,
              height: buttonRect.height,
            },
          };
        });
        // Surface Contract V1 exposes the exact rendered identity as machine
        // data on the shell (shell.dataset.revision); never parse the numeric
        // identity from presentation text. revisionText is evidence for
        // Historical/current labeling only, read from the stable
        // [data-historical-identity] hook with a narrow .identity span
        // fallback for older normal UI.
        const revisionText = shell.querySelector('[data-historical-identity]')?.textContent?.trim()
          || shell.querySelector('.identity span')?.textContent?.trim()
          || '';
        const revision = Number(shell.dataset.revision || 0);
        const rect = shell.getBoundingClientRect();
        const style = getComputedStyle(shell);
        const canvas = document.querySelector('.tl-canvas');
        const canvasRect = canvas?.getBoundingClientRect();
        const hasVisibleRenderedGeometry = (element) => {
          const candidates = [
            element,
            ...Array.from(element.querySelectorAll('svg, canvas, foreignObject, .tl-html-container, .tl-text-content')),
          ];
          return candidates.some((candidate) => {
            if (!(candidate instanceof HTMLElement || candidate instanceof SVGElement)) return false;
            const candidateRect = candidate.getBoundingClientRect();
            const candidateStyle = getComputedStyle(candidate);
            return candidate.isConnected
              && candidateRect.width > 1
              && candidateRect.height > 1
              && candidateStyle.display !== 'none'
              && candidateStyle.visibility !== 'hidden'
              && candidateStyle.opacity !== '0';
          });
        };
        const visibleSemanticShapes = Array.from(document.querySelectorAll('.tl-shape[data-shape-id]'))
          .filter((element) => {
            if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
            if (element.classList.contains('tl-shape-background')) return false;
            return hasVisibleRenderedGeometry(element);
          });
        const visibleSemanticLabels = visibleSemanticShapes
          .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 32);
        return {
          ...documentState,
          hasShell: true,
          shellConnected: shell.isConnected,
          shellOffsetParent: shell.offsetParent !== null,
          shellDisplay: style.display,
          shellVisibility: style.visibility,
          shellOpacity: style.opacity,
          canvasId: ${JSON.stringify(canvasId)},
          containsCanvas: text.includes(${JSON.stringify(canvasId)}),
          className: shell.className,
          mode: shell.classList.contains('mode-fullscreen') ? 'fullscreen' : 'inline',
          editorReady: shell.dataset.editorReady === 'true'
            ? true
            : shell.dataset.editorReady === 'false'
              ? false
              : null,
          editorStatus: shell.dataset.editorStatus || '',
          surfaceContract: shell.dataset.surfaceContract || '',
          surfaceRole: shell.dataset.surfaceRole || '',
          surfaceDisplayMode: shell.dataset.displayMode || '',
          authorityState: shell.dataset.authorityState || '',
          surfaceRenderer: shell.dataset.renderer || '',
          renderReady: shell.dataset.renderReady === 'true'
            ? true
            : shell.dataset.renderReady === 'false'
              ? false
              : null,
          mutationAuthority: shell.dataset.mutationAuthority || '',
          surfaceCanvasId: shell.dataset.canvasId || '',
          surfaceRevision: Number(shell.dataset.revision || 0),
          renderInstance: shell.dataset.renderInstance || '',
          semanticContentReady: shell.dataset.contentReady === 'true',
          renderedSemanticElementCount: Number(shell.dataset.renderedSemanticCount || 0),
          visibleSemanticShapeCount: visibleSemanticShapes.length,
          visibleSemanticLabels,
          visibleSemanticContent: visibleSemanticShapes.length > 0,
          canvasText: canvas?.textContent?.slice(0, 2000) || '',
          documentHtml: document.documentElement?.outerHTML?.slice(0, 1200) || '',
          srcdocLength: document.querySelector('iframe[srcdoc]')?.getAttribute('srcdoc')?.length ?? null,
          iframeCount: document.querySelectorAll('iframe').length,
          text: text.slice(0, 1600),
          revision,
          revisionText,
          buttons,
          previewLabel: document.querySelector('.preview-stage')?.getAttribute('aria-label') || '',
          previewText: document.querySelector('.preview-stage')?.textContent?.trim().slice(0, 800) || '',
          status: document.querySelector('footer')?.textContent?.trim().slice(0, 800) || '',
          shellRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          canvasRect: canvasRect ? { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height } : null,
          dirty: /Unsaved/i.test(text) || buttons.some((button) => button.text === 'Save' && !button.disabled),
        };
      })()`, context.id, context.sessionId);
      candidates.push({ ...base, ...state });
    } catch (error) {
      candidates.push({ ...base, evaluationError: error.message });
    }
  }
  // Chromium does not always emit a Runtime.executionContextCreated event for
  // a data: sandbox iframe before the App's short first-paint lifecycle ends.
  // Ask the page domain for an isolated world in each child frame so the
  // verifier can inspect the actual App document instead of mistaking a
  // missing CDP event for a missing App. This is observation only; the same
  // surface contract and content predicates still decide success.
  if (!candidates.some((candidate) => candidate.hasShell === true)) {
    const flattenFrames = (node) => [
      ...(node?.frame ? [node.frame] : []),
      ...(node?.childFrames ?? []).flatMap(flattenFrames),
    ];
    const frameTree = await browser.send('Page.getFrameTree').catch((error) => {
      supplementalFrameDiagnostics.push({ operation: 'Page.getFrameTree', error: error.message });
      return null;
    });
    const frames = flattenFrames(frameTree?.result?.frameTree);
    const rootFrameId = frameTree?.result?.frameTree?.frame?.id;
    for (const frame of frames) {
      if (!frame?.id || frame.id === rootFrameId) continue;
      let contextId = supplementalFrameContexts.get(frame.id);
      if (!contextId) {
        const created = await browser.send('Page.createIsolatedWorld', {
          frameId: frame.id,
          worldName: 'openchamber-tldraw-acceptance-diagnostics',
        }).catch((error) => {
          supplementalFrameDiagnostics.push({ operation: 'Page.createIsolatedWorld', frameId: frame.id, error: error.message });
          return null;
        });
        contextId = created?.result?.executionContextId;
        if (contextId) supplementalFrameContexts.set(frame.id, contextId);
      }
      if (!contextId) continue;
      try {
        const state = await browser.evaluate(`(() => {
          const shell = document.querySelector('.acceptance-shell');
          const documentState = {
            documentUrl: location.href,
            documentVisibility: document.visibilityState,
            documentReadyState: document.readyState,
          };
          if (!(shell instanceof HTMLElement)) return {
            ...documentState,
            hasShell: false,
            shellConnected: false,
            shellOffsetParent: false,
            shellDisplay: '',
            shellVisibility: '',
            shellOpacity: '',
            shellRect: null,
          };
          const visibleRect = (element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          };
          const buttons = Array.from(document.querySelectorAll('button')).map((button) => {
            const rect = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
              text: button.textContent?.trim() || '',
              title: button.getAttribute('title') || '',
              disabled: button.disabled,
              visible: button.isConnected && button.offsetParent !== null
                && rect.width > 1 && rect.height > 1
                && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
              rect: visibleRect(button),
            };
          });
          const hasVisibleRenderedGeometry = (element) => [
            element,
            ...Array.from(element.querySelectorAll('svg, canvas, foreignObject, .tl-html-container, .tl-text-content')),
          ].some((candidate) => {
            if (!(candidate instanceof HTMLElement || candidate instanceof SVGElement)) return false;
            const rect = candidate.getBoundingClientRect();
            const style = getComputedStyle(candidate);
            return candidate.isConnected && rect.width > 1 && rect.height > 1
              && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          });
          const visibleSemanticShapes = Array.from(document.querySelectorAll('.tl-shape[data-shape-id]'))
            .filter((element) => element instanceof HTMLElement
              && !element.classList.contains('tl-shape-background')
              && hasVisibleRenderedGeometry(element));
          const canvas = document.querySelector('.tl-canvas');
          const text = document.body?.innerText || '';
          const revisionText = shell.querySelector('[data-historical-identity]')?.textContent?.trim()
            || shell.querySelector('.identity span')?.textContent?.trim()
            || '';
          return {
            ...documentState,
            hasShell: true,
            shellConnected: shell.isConnected,
            shellOffsetParent: shell.offsetParent !== null,
            shellDisplay: getComputedStyle(shell).display,
            shellVisibility: getComputedStyle(shell).visibility,
            shellOpacity: getComputedStyle(shell).opacity,
            canvasId: ${JSON.stringify(canvasId)},
            containsCanvas: text.includes(${JSON.stringify(canvasId)}),
            className: shell.className,
            mode: shell.classList.contains('mode-fullscreen') ? 'fullscreen' : 'inline',
            editorReady: shell.dataset.editorReady === 'true' ? true : shell.dataset.editorReady === 'false' ? false : null,
            editorStatus: shell.dataset.editorStatus || '',
            surfaceContract: shell.dataset.surfaceContract || '',
            surfaceRole: shell.dataset.surfaceRole || '',
            surfaceDisplayMode: shell.dataset.displayMode || '',
            authorityState: shell.dataset.authorityState || '',
            surfaceRenderer: shell.dataset.renderer || '',
            renderReady: shell.dataset.renderReady === 'true' ? true : shell.dataset.renderReady === 'false' ? false : null,
            mutationAuthority: shell.dataset.mutationAuthority || '',
            surfaceCanvasId: shell.dataset.canvasId || '',
            surfaceRevision: Number(shell.dataset.revision || 0),
            renderInstance: shell.dataset.renderInstance || '',
            semanticContentReady: shell.dataset.contentReady === 'true',
            renderedSemanticElementCount: Number(shell.dataset.renderedSemanticCount || 0),
            visibleSemanticShapeCount: visibleSemanticShapes.length,
            visibleSemanticLabels: visibleSemanticShapes.map((element) => (element.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 32),
            visibleSemanticContent: visibleSemanticShapes.length > 0,
            canvasText: canvas?.textContent?.slice(0, 2000) || '',
            text: text.slice(0, 1600),
            revision: Number(shell.dataset.revision || 0),
            revisionText,
            buttons,
            status: document.querySelector('footer')?.textContent?.trim().slice(0, 800) || '',
            shellRect: visibleRect(shell),
            canvasRect: canvas ? visibleRect(canvas) : null,
            dirty: /Unsaved/i.test(text) || buttons.some((button) => button.text === 'Save' && !button.disabled),
          };
        })()`, contextId, null);
        if (state?.hasShell) {
          candidates.push({
            contextId,
            sessionId: null,
            createdOrdinal: supplementalFrameOrdinal++,
            createdAt: new Date().toISOString(),
            frameId: frame.id,
            isDefaultContext: false,
            contextType: 'isolated-world',
            contextName: 'openchamber-tldraw-acceptance-diagnostics',
            contextOrigin: frame.securityOrigin ?? '',
            sessionActive: true,
            target: {
              targetId: null,
              type: 'iframe',
              url: frame.url ?? null,
              attached: true,
            },
            ...state,
          });
        }
      } catch {
        supplementalFrameContexts.delete(frame.id);
        supplementalFrameDiagnostics.push({ operation: 'Runtime.evaluate', frameId: frame.id, contextId });
      }
    }
  }
  return candidates.sort((left, right) => right.createdOrdinal - left.createdOrdinal);
};

const findApp = async ({ mode, requireCanvas = true, minCreatedOrdinal = 0 } = {}) => {
  const candidates = await inspectAppContexts();
  return selectActiveAppContext(candidates, { mode, requireCanvas, minCreatedOrdinal });
};

const appContextDiagnostics = async () => (await inspectAppContexts()).map((candidate) => ({
  contextId: candidate.contextId,
  sessionId: candidate.sessionId,
  sessionActive: candidate.sessionActive,
  createdOrdinal: candidate.createdOrdinal,
  createdAt: candidate.createdAt,
  frameId: candidate.frameId,
  isDefaultContext: candidate.isDefaultContext,
  target: candidate.target,
  documentUrl: candidate.documentUrl,
  documentVisibility: candidate.documentVisibility,
  documentReadyState: candidate.documentReadyState,
  hasShell: candidate.hasShell,
  shellConnected: candidate.shellConnected,
  shellOffsetParent: candidate.shellOffsetParent,
  shellDisplay: candidate.shellDisplay,
  shellVisibility: candidate.shellVisibility,
  shellOpacity: candidate.shellOpacity,
  shellRect: candidate.shellRect,
  mode: candidate.mode,
  editorReady: candidate.editorReady,
  editorStatus: candidate.editorStatus,
  editorReadiness: assessTldrawEditorReadiness(candidate),
  containsCanvas: candidate.containsCanvas,
  revision: candidate.revision,
  revisionText: candidate.revisionText,
  surfaceContract: candidate.surfaceContract,
  surfaceRole: candidate.surfaceRole,
  authorityState: candidate.authorityState,
  surfaceRenderer: candidate.surfaceRenderer,
  renderReady: candidate.renderReady,
  mutationAuthority: candidate.mutationAuthority,
  surfaceCanvasId: candidate.surfaceCanvasId,
  surfaceRevision: candidate.surfaceRevision,
  semanticContentReady: candidate.semanticContentReady,
  renderedSemanticElementCount: candidate.renderedSemanticElementCount,
  visibleSemanticShapeCount: candidate.visibleSemanticShapeCount,
  visibleSemanticLabels: candidate.visibleSemanticLabels,
  visibleSemanticContent: candidate.visibleSemanticContent,
  status: candidate.status,
  evaluationError: candidate.evaluationError,
}));

const captureFailureEvidence = async () => {
  if (!browser) return null;
  const hostSurfaceState = await browser.evaluate(`(() => {
    const visibleRect = (element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    };
    return {
      url: location.href,
      visibility: document.visibilityState,
      readyState: document.readyState,
      bodyText: (document.body?.innerText || '').slice(0, 2000),
      mcpAppContainers: Array.from(document.querySelectorAll('[data-mcp-app-display-mode], [data-mcp-app-loading-stage]'))
        .map((element) => ({
          tagName: element.tagName,
          displayMode: element.getAttribute('data-mcp-app-display-mode'),
          loadingStage: element.getAttribute('data-mcp-app-loading-stage'),
          label: element.getAttribute('aria-label'),
          text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          rect: visibleRect(element),
        }))
        .slice(0, 32),
      iframes: Array.from(document.querySelectorAll('iframe')).map((frame) => ({
        title: frame.title,
        src: (frame.src || '').slice(0, 240),
        srcdocLength: frame.getAttribute('srcdoc')?.length ?? 0,
        rect: visibleRect(frame),
        parentLoadingStage: frame.parentElement?.getAttribute('data-mcp-app-loading-stage') || null,
        parentDisplayMode: frame.closest('[data-mcp-app-display-mode]')?.getAttribute('data-mcp-app-display-mode') || null,
      })).slice(0, 32),
    };
  })()`).catch((error) => ({ diagnosticError: error.message }));
  const appContexts = await appContextDiagnostics().catch((error) => ([{
    diagnosticError: error.message,
  }]));
  const candidates = await inspectAppContexts().catch(() => []);
  const active = selectActiveAppContext(candidates, { mode: 'inline' })
    ?? selectActiveAppContext(candidates, { mode: 'fullscreen' })
    ?? candidates[0]
    ?? null;
  const failureScreenshot = await screenshot('failure-final-surface').catch(() => null);
  const failureIframeScreenshot = active?.sessionId
    ? await screenshot('failure-final-app', active.sessionId).catch(() => null)
    : null;
  const failureSurfaceState = {
    capturedAt: new Date().toISOString(),
    hostSurfaceState,
    activeContext: active ? {
      contextId: active.contextId,
      sessionId: active.sessionId,
      mode: active.mode,
      revision: active.revision,
      surfaceRevision: active.surfaceRevision,
      surfaceCanvasId: active.surfaceCanvasId,
      surfaceRole: active.surfaceRole,
      authorityState: active.authorityState,
      renderReady: active.renderReady,
      mutationAuthority: active.mutationAuthority,
      shellRect: active.shellRect,
      canvasRect: active.canvasRect,
      semanticContentReady: active.semanticContentReady,
      renderedSemanticElementCount: active.renderedSemanticElementCount,
    } : null,
    appContexts,
    recentAppToolExchanges: browser.appToolExchanges.slice(-12),
    runtimeErrors: browser.runtimeErrors.slice(-40),
    consoleErrors: browser.consoleErrors.slice(-40),
    pageErrors: browser.pageErrors.slice(-40),
  };
  return {
    failureScreenshot,
    failureIframeScreenshot,
    failureSurfaceState,
  };
};

const withAppContextDiagnostics = async (error) => {
  const diagnostics = await appContextDiagnostics().catch((diagnosticError) => ([{
    diagnosticError: diagnosticError.message,
  }]));
  return new Error(`${error.message}; App execution contexts: ${JSON.stringify(diagnostics)}`, {
    cause: error,
  });
};

const waitForApp = async (options, label, timeoutMs = 45_000) => {
  const {
    expectedRevision,
    expectedCanvasId,
    ...selection
  } = options ?? {};
  try {
    return await waitFor(
      async () => {
        const app = await findApp(selection);
        if (!app) return null;
        if (expectedRevision !== undefined && app.revision !== expectedRevision) return null;
        if (expectedCanvasId !== undefined && !app.text.includes(expectedCanvasId)) return null;
        return app;
      },
      label,
      timeoutMs,
      200,
    );
  } catch (error) {
    throw await withAppContextDiagnostics(error);
  }
};

const waitForEditorReadyApp = async (options = {}, label = 'tldraw editor ready', timeoutMs = 45_000) => {
  try {
    return await waitFor(async () => {
      const app = await findApp({ mode: 'fullscreen', ...options });
      if (!app) return null;
      const readiness = assessTldrawEditorReadiness(app);
      return readiness.ready ? app : null;
    }, label, timeoutMs, 100);
  } catch (error) {
    throw await withAppContextDiagnostics(error);
  }
};

const clickAppButton = async ({ text, title, mode, requireEditorReady = mode === 'fullscreen' }) => {
  const label = text ?? title;
  try {
    return await waitFor(async () => {
      const app = await findApp({ mode });
      if (!app) return null;
      if (requireEditorReady && !assessTldrawEditorReadiness(app).ready) return null;
      const clicked = await browser.evaluate(`(() => {
        // tldraw keeps menu and accessibility controls mounted even when they
        // are not visible. Some of those controls use ordinary labels such as
        // "Save", so a document-wide text match can click an inert hidden menu
        // action instead of the MCP App chrome. Prefer the App's own action bar
        // and require a rendered hit area. This is also closer to what a user can
        // actually click in the packaged client.
        const actionBar = document.querySelector('.acceptance-shell > header .actions');
        const candidates = Array.from((actionBar || document).querySelectorAll('button'))
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = getComputedStyle(candidate);
            return candidate.isConnected
              && candidate.offsetParent !== null
              && rect.width > 1
              && rect.height > 1
              && style.display !== 'none'
              && style.visibility !== 'hidden';
          });
        const button = candidates.find((candidate) => (
          ${text ? `candidate.textContent?.trim() === ${JSON.stringify(text)}` : 'false'}
          || ${title ? `candidate.getAttribute('title') === ${JSON.stringify(title)}` : 'false'}
        ));
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`, app.contextId, app.sessionId);
      return clicked ? app : null;
    }, `${mode ?? 'current'} App button ${label} to become clickable`, 20_000, 100);
  } catch (error) {
    throw await withAppContextDiagnostics(new Error(`Could not click App button ${label}: ${error.message}`, {
      cause: error,
    }));
  }
};

const clickTop = async (expression, label) => {
  const clicked = await browser.evaluate(`(() => { ${expression} })()`);
  assert.equal(clicked, true, `Could not click ${label}`);
};

const selectSession = async ({ navigate = true, requireDirectRoute = false } = {}) => {
  const sessionUrl = `${baseUrl}/?session=${encodeURIComponent(sessionId)}`;
  if (navigate) {
    await browser.send('Page.navigate', { url: sessionUrl });
  }
  await waitFor(() => browser.evaluate(`document.readyState === 'complete' || document.readyState === 'interactive'`), 'OpenChamber document');
  if (requireDirectRoute) {
    await browser.send('Page.bringToFront');
    await waitFor(
      () => browser.evaluate(`document.visibilityState === 'visible'`),
      'OpenChamber visible after canonical session route',
      30_000,
      150,
    );
    await waitFor(
      () => browser.evaluate(`Boolean(document.querySelector('iframe[title="tldraw_create_view"]'))`),
      'MCP App iframe after canonical session route',
      60_000,
      250,
    );
    return 'route-required';
  }
  const direct = await waitFor(() => browser.evaluate(`Boolean(document.querySelector('iframe[title="tldraw_create_view"]'))`), 'direct session route', 12_000, 250).catch(() => false);
  if (direct) return 'route';

  // A hard Chromium reload can restore the shell before OpenChamber has
  // re-selected the URL-bound session. Re-enter the canonical session route
  // once after the reload has settled. This is deliberately delayed until the
  // first restoration attempt finished, so it cannot abort an in-flight App
  // resource request as the old immediate double-navigation did.
  if (!navigate) {
    await browser.send('Page.navigate', { url: sessionUrl });
    await waitFor(
      () => browser.evaluate(`document.readyState === 'complete' || document.readyState === 'interactive'`),
      'OpenChamber canonical session route',
    );
    const restored = await waitFor(
      () => browser.evaluate(`Boolean(document.querySelector('iframe[title="tldraw_create_view"]'))`),
      'conversation MCP App iframe after canonical route restore',
      30_000,
      250,
    ).catch(() => false);
    if (restored) return 'route-restored';
  }

  await clickTop(`
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === 'Open session switcher');
    if (!button) return false;
    button.click();
    return true;
  `, 'session switcher');
  await waitFor(() => browser.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes(${JSON.stringify(sessionTitle)}))`), 'session in switcher');
  await clickTop(`
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(sessionTitle)}));
    if (!button) return false;
    button.click();
    return true;
  `, 'acceptance session');
  await waitFor(() => browser.evaluate(`Boolean(document.querySelector('iframe[title="tldraw_create_view"]'))`), 'conversation MCP App iframe').catch(async (error) => {
    const dump = await browser.evaluate(`(() => ({
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => ({ title: f.title, src: (f.src || '').slice(0, 80) })),
      appText: (document.querySelector('.acceptance-shell')?.textContent || '').slice(0, 200),
      bodyHead: (document.body?.innerText || '').slice(0, 300),
    }))()`);
    console.error('IFRAME-DUMP', JSON.stringify(dump));
    throw error;
  });
  return 'switcher';
};

const screenshot = async (name, sessionIdValue = null) => {
  const response = await browser.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  }, sessionIdValue);
  const filename = `${String(evidence.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await fs.writeFile(path.join(outputDirectory, filename), Buffer.from(response.result.data, 'base64'));
  evidence.screenshots.push(filename);
  return filename;
};

const installAppRuntimeDiagnostics = async (app) => browser.evaluate(`(() => {
  const key = '__openchamberTldrawAcceptanceDiagnosticsV1';
  if (globalThis[key]) return globalThis[key];
  const boundedPush = (target, value) => {
    target.push(value);
    if (target.length > 200) target.splice(0, target.length - 200);
  };
  const summarizeUri = (value) => {
    const uri = String(value || '');
    if (/^data:/i.test(uri)) {
      const mediaType = (uri.match(/^data:([^;,]*)/i) || [])[1] || 'unknown';
      return 'data:' + mediaType + ';<redacted:' + uri.length + '>';
    }
    return uri.slice(0, 500);
  };
  const diagnostics = { securityPolicyViolations: [], pageErrors: [] };
  addEventListener('securitypolicyviolation', (event) => boundedPush(diagnostics.securityPolicyViolations, {
    at: new Date().toISOString(),
    effectiveDirective: event.effectiveDirective || '',
    violatedDirective: event.violatedDirective || '',
    blockedURI: summarizeUri(event.blockedURI),
    disposition: event.disposition || '',
    sourceFile: summarizeUri(event.sourceFile),
    lineNumber: event.lineNumber || 0,
    columnNumber: event.columnNumber || 0,
  }));
  addEventListener('error', (event) => boundedPush(diagnostics.pageErrors, {
    at: new Date().toISOString(),
    type: 'error',
    message: String(event.message || event.error?.message || 'App error').slice(0, 800),
  }));
  addEventListener('unhandledrejection', (event) => boundedPush(diagnostics.pageErrors, {
    at: new Date().toISOString(),
    type: 'unhandledrejection',
    message: String(event.reason?.stack || event.reason?.message || event.reason || 'Unhandled rejection').slice(0, 800),
  }));
  Object.defineProperty(globalThis, key, { value: diagnostics, configurable: false, writable: false });
  return diagnostics;
})()`, app.contextId, app.sessionId);

const readAppRuntimeDiagnostics = async (app) => browser.evaluate(`(() => {
  const diagnostics = globalThis.__openchamberTldrawAcceptanceDiagnosticsV1;
  return diagnostics
    ? JSON.parse(JSON.stringify(diagnostics))
    : { securityPolicyViolations: [], pageErrors: [], missing: true };
})()`, app.contextId, app.sessionId);

const inspectVisibleTldrawAccessibleLabel = async (app, expectedLabel) => browser.evaluate(`(() => {
  const expected = ${JSON.stringify(expectedLabel)};
  const visible = (element) => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected
      && rect.width > 1
      && rect.height > 1
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  };
  const controls = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]'))
    .filter(visible);
  const control = controls.find((candidate) => {
    const labels = [
      candidate.getAttribute('aria-label'),
      candidate.getAttribute('title'),
      candidate.textContent,
    ].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim());
    return labels.some((value) => value === expected || value.startsWith(expected + ' ') || value.startsWith(expected + '（'));
  });
  if (!control) return null;
  const iconCandidates = [control, ...control.querySelectorAll('svg, [data-icon], .tlui-icon')];
  const icon = iconCandidates.find((candidate) => {
    if (!visible(candidate)) return false;
    const style = getComputedStyle(candidate);
    const hasPaintedImage = (value) => Boolean(value) && value !== 'none';
    return candidate instanceof SVGElement
      || hasPaintedImage(style.backgroundImage)
      || hasPaintedImage(style.maskImage)
      || hasPaintedImage(style.webkitMaskImage);
  });
  const rect = control.getBoundingClientRect();
  return {
    tagName: control.tagName,
    testId: control.getAttribute('data-testid'),
    ariaLabel: control.getAttribute('aria-label'),
    title: control.getAttribute('title'),
    text: (control.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    hasVisibleIcon: Boolean(icon),
    iconTagName: icon?.tagName ?? null,
  };
})()`, app.contextId, app.sessionId);

const inspectTldrawLocaleDiagnostics = async (app) => browser.evaluate(`(() => {
  const visible = (element) => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected
      && rect.width > 1
      && rect.height > 1
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  };
  const text = (value, limit = 160) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const inTldraw = (element) => Boolean(element.closest('.tl-container, .tlui-layout, [data-testid*="tldraw"]'));
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName,
      className: text(element.getAttribute('class'), 240),
      testId: element.getAttribute('data-testid'),
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      lang: element.getAttribute('lang'),
      dataLocale: element.getAttribute('data-locale'),
      dataLanguage: element.getAttribute('data-language'),
      name: element.getAttribute('name'),
      value: 'value' in element ? text(element.value, 120) : null,
      text: text(element.textContent),
      visible: visible(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  };
  const controls = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]'))
    .filter((element) => inTldraw(element) && visible(element))
    .slice(0, 120)
    .map(describe);
  const localeInputs = Array.from(document.querySelectorAll('[lang], [data-locale], [data-language], [name*="locale" i], [id*="locale" i], select, input'))
    .filter((element) => inTldraw(element) || element === document.documentElement || element === document.body)
    .slice(0, 80)
    .map(describe);
  return {
    document: {
      visibilityState: document.visibilityState,
      readyState: document.readyState,
      documentElementLang: document.documentElement.lang,
      bodyLang: document.body?.lang || null,
      navigatorLanguage: navigator.language,
      navigatorLanguages: [...(navigator.languages || [])],
    },
    tldraw: {
      containerCount: document.querySelectorAll('.tl-container').length,
      layoutCount: document.querySelectorAll('.tlui-layout').length,
      visibleToolbarControls: controls,
      localeInputs,
    },
  };
})()`, app.contextId, app.sessionId);

const switchHostLocaleAndAssertTldraw = async ({ locale, selectLabel, expectedRevision }) => {
  const contextFloor = browser.getContextOrdinal();
  await browser.evaluate(`(() => {
    localStorage.setItem('openchamber.i18n.v1', JSON.stringify({ locale: ${JSON.stringify(locale)} }));
    return true;
  })()`);
  await browser.send('Page.reload', { ignoreCache: true });
  await waitFor(
    () => browser.evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`),
    `OpenChamber host locale ${locale}`,
    30_000,
    150,
  );
  // Page.reload already leaves the canonical session URL active. Do not
  // navigate to that same URL again while the locale reload is still
  // hydrating the session; that second navigation can abort the message
  // restoration before the persisted App part mounts.
  await selectSession({ navigate: false, requireDirectRoute: true });
  const inline = await waitForApp({
    mode: 'inline',
    expectedRevision,
    expectedCanvasId: canvasId,
    minCreatedOrdinal: contextFloor + 1,
  }, `${locale} inline App after host locale reload`, 35_000);
  await installAppRuntimeDiagnostics(inline);
  const networkFloor = browser.networkRequests.length;
  const consoleFloor = browser.consoleEvents.length;
  const pageErrorFloor = browser.pageErrors.length;
  const runtimeErrorFloor = browser.runtimeErrors.length;
  await clickAppButton({ text: 'Edit ↗', mode: 'inline' });
  const full = await waitForApp({
    mode: 'fullscreen',
    expectedRevision,
    expectedCanvasId: canvasId,
  }, `${locale} fullscreen tldraw editor`, 35_000);
  if (full.contextId !== inline.contextId || full.sessionId !== inline.sessionId) {
    await installAppRuntimeDiagnostics(full);
  }
  let translatedControl;
  try {
    translatedControl = await waitFor(
      () => inspectVisibleTldrawAccessibleLabel(full, selectLabel),
      `${locale} real tldraw Select control label ${selectLabel}`,
      20_000,
      100,
    );
  } catch (error) {
    const diagnostics = await inspectTldrawLocaleDiagnostics(full).catch((diagnosticError) => ({
      diagnosticsError: String(diagnosticError?.stack || diagnosticError),
    }));
    throw new Error(
      `${error.message}; ${locale} tldraw locale diagnostics: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
  assert.equal(translatedControl.hasVisibleIcon, true, `${locale} Select control has no visible real tldraw icon`);
  await delay(400);
  const appDiagnostics = await readAppRuntimeDiagnostics(full);
  assert.notEqual(appDiagnostics.missing, true, `${locale} App diagnostics were not installed in the active tldraw context`);
  assert.deepEqual(
    appDiagnostics.securityPolicyViolations,
    [],
    `${locale} tldraw emitted CSP violations: ${JSON.stringify(appDiagnostics.securityPolicyViolations)}`,
  );
  assert.deepEqual(
    appDiagnostics.pageErrors,
    [],
    `${locale} tldraw emitted page errors: ${JSON.stringify(appDiagnostics.pageErrors)}`,
  );

  const appRequests = browser.networkRequests.slice(networkFloor)
    .filter((request) => request.sessionId === full.sessionId);
  const translationPattern = /data:application\/json|translation|translations|locale|zh-cn|zh-tw/i;
  const translationRequests = appRequests.filter((request) => translationPattern.test(request.url));
  const nonBridgeFetches = appRequests.filter((request) => (
    (request.type === 'Fetch' || request.type === 'XHR' || request.initiatorType === 'fetch')
    && !/\/mcp\/app\/(?:tool-call|resource)$/.test(request.url)
  ));
  assert.deepEqual(
    translationRequests,
    [],
    `${locale} tldraw attempted a translation network request: ${JSON.stringify(translationRequests)}`,
  );
  assert.deepEqual(
    nonBridgeFetches,
    [],
    `${locale} tldraw attempted a non-AppBridge network fetch: ${JSON.stringify(nonBridgeFetches)}`,
  );

  const relevantErrorPattern = /content security policy|connect-src|data:application\/json|translation|failed to fetch/i;
  const relevantConsoleErrors = browser.consoleEvents.slice(consoleFloor)
    .filter((entry) => relevantErrorPattern.test(entry.text));
  const relevantPageErrors = browser.pageErrors.slice(pageErrorFloor)
    .filter((entry) => relevantErrorPattern.test(entry.text));
  const relevantRuntimeErrors = browser.runtimeErrors.slice(runtimeErrorFloor)
    .filter((entry) => relevantErrorPattern.test(entry));
  assert.deepEqual(relevantConsoleErrors, [], `${locale} console contains CSP/translation errors`);
  assert.deepEqual(relevantPageErrors, [], `${locale} page contains CSP/translation errors`);
  assert.deepEqual(relevantRuntimeErrors, [], `${locale} runtime contains CSP/translation errors`);
  const localeScreenshot = await screenshot(`tldraw-locale-${locale.toLowerCase()}`);
  await clickAppButton({ text: 'Done', mode: 'fullscreen' });
  await waitForApp({
    mode: 'inline',
    expectedRevision,
    expectedCanvasId: canvasId,
  }, `${locale} inline App after translated editor closes`);
  return {
    locale,
    selectLabel,
    translatedControl,
    securityPolicyViolations: appDiagnostics.securityPolicyViolations,
    pageErrors: appDiagnostics.pageErrors,
    translationRequests,
    nonBridgeFetches,
    appBridgeFetchCount: appRequests.filter((request) => /\/mcp\/app\/(?:tool-call|resource)$/.test(request.url)).length,
    screenshot: localeScreenshot,
  };
};

const restoreHostLocale = async (locale = 'en', expectedRevision) => {
  const contextFloor = browser.getContextOrdinal();
  await browser.evaluate(`(() => {
    localStorage.setItem('openchamber.i18n.v1', JSON.stringify({ locale: ${JSON.stringify(locale)} }));
    return true;
  })()`);
  await browser.send('Page.reload', { ignoreCache: true });
  await waitFor(
    () => browser.evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`),
    `OpenChamber host locale restored to ${locale}`,
    30_000,
    150,
  );
  await selectSession({ navigate: false, requireDirectRoute: true });
  return waitForApp({
    mode: 'inline',
    expectedRevision,
    expectedCanvasId: canvasId,
    minCreatedOrdinal: contextFloor + 1,
  }, `${locale} inline App after locale restore`, 35_000);
};

const waitForHostExportConfirmation = async () => waitFor(async () => {
  const state = await browser.evaluate(`(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"], [role="dialog"]'))
      .filter((dialog) => dialog instanceof HTMLElement && dialog.offsetParent !== null);
    const dialog = dialogs.find((candidate) => /Untrusted MCP App export/i.test(candidate.textContent || ''));
    if (!dialog) return null;
    const save = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save file');
    if (!save) return null;
    return { text: dialog.textContent?.trim().slice(0, 500) || '' };
  })()`);
  return state;
}, 'host-owned MCP App export confirmation', 20_000, 150);

const confirmHostExport = async () => clickTop(`
  const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"], [role="dialog"]'));
  const dialog = dialogs.find((candidate) => /Untrusted MCP App export/i.test(candidate.textContent || ''));
  const button = dialog && Array.from(dialog.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === 'Save file');
  if (!button) return false;
  button.click();
  return true;
`, 'Save file in host export confirmation');

const exportAndValidate = async (format, {
  expectedLabels = expectedExportedLabels,
  expectedPageName,
  expectedImageSha256,
  requireRichTextStyles = false,
  expectedPngFeatureColors = [],
} = {}) => {
  const previousFiles = new Set(await fs.readdir(downloadsDirectory));
  const previousDownloadGuids = new Set(browser.downloads.keys());
  const exchangeStartIndex = browser.appToolExchanges.length;
  const appBeforeExport = await clickAppButton({ title: `Download ${format.toUpperCase()}`, mode: 'fullscreen' });
  assert.equal(appBeforeExport.containsCanvas, true, `${format.toUpperCase()} export started from a different canvas`);
  const expectedRevision = appBeforeExport.revision;
  const confirmation = await waitForHostExportConfirmation();
  await confirmHostExport();
  let [downloadGuid, completedDownload] = await waitFor(() => {
    const terminal = [...browser.downloads.entries()].find(([guid, download]) => (
      !previousDownloadGuids.has(guid)
      && (download.state === 'completed' || download.state === 'canceled')
    ));
    return terminal ?? null;
  }, `${format.toUpperCase()} browser download completion`, 30_000, 150);
  // Headless Chrome can redirect a burst of anchor downloads to its internal
  // downloads page (saved as downloads.html). Retry the export once so a
  // host/download-policy hiccup never masquerades as a product export defect.
  if (completedDownload?.suggestedFilename === 'downloads.html') {
    const beforeRetry = new Set(browser.downloads.keys());
    await clickAppButton({ title: `Download ${format.toUpperCase()}`, mode: 'fullscreen' });
    await waitForHostExportConfirmation();
    await confirmHostExport();
    [downloadGuid, completedDownload] = await waitFor(() => {
      const terminal = [...browser.downloads.entries()].find(([guid, download]) => (
        !beforeRetry.has(guid)
        && (download.state === 'completed' || download.state === 'canceled')
      ));
      return terminal ?? null;
    }, `${format.toUpperCase()} browser download retry`, 30_000, 150);
  }

  assert.equal(completedDownload.state, 'completed', `${format.toUpperCase()} browser download was canceled`);
  const filename = await waitFor(async () => {
    const files = (await fs.readdir(downloadsDirectory)).filter(
      (entry) => !entry.endsWith('.crdownload') && entry !== 'downloads.html',
    );
    const createdFiles = files.filter((entry) => !previousFiles.has(entry));
    const direct = createdFiles.find((entry) => entry === completedDownload.suggestedFilename)
      ?? createdFiles[0];
    if (direct) return direct;
    // Chrome overwrites a same-named earlier download instead of creating a
    // new file; the suggested filename then holds the freshest bytes.
    return files.includes(completedDownload.suggestedFilename)
      ? completedDownload.suggestedFilename
      : null;
  }, `${format.toUpperCase()} download bytes`, 30_000, 150);
  if (expectedPageName) {
    const expectedPageSlug = expectedPageName
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'tldraw-canvas';
    assert(
      filename.includes(`-${expectedPageSlug}-r${expectedRevision}.${format}`),
      `${format.toUpperCase()} filename ${filename} does not identify active page ${expectedPageName}`,
    );
  }
  const buffer = await fs.readFile(path.join(downloadsDirectory, filename));

  const validation = format === 'svg'
    ? validateSvgBuffer(buffer, expectedLabels, { expectedImageSha256, requireRichTextStyles })
    : validatePngBuffer(buffer, {
        requireNonBackground: true,
        expectedFeatureColors: expectedPngFeatureColors,
      });
  const [receipt, readyApp] = await Promise.all([
    waitForExportReceipt({ format, expectedRevision, exchangeStartIndex, buffer }),
    waitForExportButtonsEnabled(),
  ]);
  const download = {
    guid: downloadGuid,
    filename,
    receivedBytes: completedDownload.receivedBytes ?? null,
    totalBytes: completedDownload.totalBytes ?? null,
  };
  evidence.downloads.push({ format, ...download, receipt, ...validation });
  return {
    confirmation,
    download,
    receipt,
    readyRevision: readyApp.revision,
    expectedPageName: expectedPageName ?? null,
    ...validation,
  };
};

const centerOf = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

const pressKey = async (targetSession, { key, code, text }) => {
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, ...(text ? { text } : {}),
  }, targetSession);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }, targetSession);
};

const selectAllAndInsertText = async (targetSession, value) => {
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Meta', code: 'MetaLeft', modifiers: 4,
  }, targetSession);
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4,
  }, targetSession);
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4,
  }, targetSession);
  await browser.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: 0,
  }, targetSession);
  await browser.send('Input.insertText', { text: value }, targetSession);
};

const dispatchClick = async (targetSession, point, clickCount = 1) => {
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', button: 'left', buttons: 1, clickCount, ...point,
  }, targetSession);
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', button: 'left', buttons: 0, clickCount, ...point,
  }, targetSession);
};

const dispatchDoubleClick = async (targetSession, point) => {
  await dispatchClick(targetSession, point, 1);
  await dispatchClick(targetSession, point, 2);
};

const dispatchDrag = async (targetSession, start, end) => {
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...start,
  }, targetSession);
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: start.x + ((end.x - start.x) * progress),
      y: start.y + ((end.y - start.y) * progress),
    }, targetSession);
  }
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...end,
  }, targetSession);
};

const readEditorShapes = async () => {
  const app = await waitForApp({ mode: 'fullscreen' }, 'fullscreen App before inspecting tldraw shapes');
  const shapes = await browser.evaluate(`(() => {
    const hasVisibleRenderedGeometry = (element) => {
      const candidates = [
        element,
        ...Array.from(element.querySelectorAll('svg, canvas, foreignObject, .tl-html-container, .tl-text-content')),
      ];
      return candidates.some((candidate) => {
        if (!(candidate instanceof HTMLElement || candidate instanceof SVGElement)) return false;
        const candidateRect = candidate.getBoundingClientRect();
        const candidateStyle = getComputedStyle(candidate);
        return candidate.isConnected
          && candidateRect.width > 1
          && candidateRect.height > 1
          && candidateStyle.display !== 'none'
          && candidateStyle.visibility !== 'hidden'
          && candidateStyle.opacity !== '0';
      });
    };
    return Array.from(document.querySelectorAll('.tl-shape[data-shape-id]'))
    .filter((element) => element instanceof HTMLElement && !element.classList.contains('tl-shape-background') && hasVisibleRenderedGeometry(element))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute('data-shape-id'),
        type: element.getAttribute('data-shape-type'),
        text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })
    .filter((shape) => shape.id && shape.rect.width > 1 && shape.rect.height > 1);
  })()`, app.contextId, app.sessionId);
  assert(Array.isArray(shapes), 'Could not inspect real tldraw shape DOM');
  return { app, shapes };
};

const waitForShape = (predicate, label, timeoutMs = 15_000) => waitFor(async () => {
  const snapshot = await readEditorShapes();
  const shape = snapshot.shapes.find(predicate);
  return shape ? { ...snapshot, shape } : null;
}, label, timeoutMs, 120);

const dispatchAcceptanceImageDrop = async () => {
  const app = await waitForApp({ mode: 'fullscreen' }, 'fullscreen App before image drop');
  assert(app.sessionId, 'tldraw App is not attached as an isolated target');
  const exchangeFloor = browser.appToolExchanges.length;
  const dispatched = await browser.evaluate(`(async () => {
    const canvas = document.querySelector('.tl-canvas');
    if (!(canvas instanceof HTMLElement)) return { ok: false, reason: 'canvas-missing' };
    const binary = atob(${JSON.stringify(acceptancePngBase64)});
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const file = new File([bytes], 'openchamber-acceptance.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const rect = canvas.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.x + Math.min(rect.width * 0.78, rect.width - 120),
      clientY: rect.y + Math.min(rect.height * 0.28, rect.height - 120),
    };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      canvas.dispatchEvent(new DragEvent(type, init));
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return { ok: true, byteLength: bytes.byteLength };
  })()`, app.contextId, app.sessionId);
  assert.equal(dispatched?.ok, true, `Could not dispatch a real image drop: ${JSON.stringify(dispatched)}`);

  const committed = await waitFor(() => {
    const exchanges = browser.appToolExchanges.slice(exchangeFloor);
    return exchanges.find((exchange) => (
      exchange.request?.binding?.name === 'tldraw_asset_commit_upload'
      && exchange.response?.isError === false
      && typeof exchange.response?.structuredContent?.asset?.sha256 === 'string'
    )) ?? null;
  }, 'content-addressed image upload commit', 30_000, 100);
  const image = await waitFor(async () => {
    const snapshot = await readEditorShapes();
    const shape = snapshot.shapes.find((candidate) => candidate.type === 'image');
    return shape ? { ...snapshot, shape } : null;
  }, 'real tldraw image shape after file drop', 30_000, 120);
  const dirty = await waitFor(async () => {
    const candidate = await findApp({ mode: 'fullscreen' });
    return candidate?.dirty ? candidate : null;
  }, 'dirty document after image drop', 15_000, 100);

  return {
    byteLength: dispatched.byteLength,
    sha256: committed.response.structuredContent.asset.sha256,
    logicalUri: committed.response.structuredContent.asset.logicalUri,
    shapeId: image.shape.id,
    revision: dirty.revision,
    exchangeCount: browser.appToolExchanges.length - exchangeFloor,
  };
};

const waitForTextEditor = (app) => waitFor(async () => browser.evaluate(`(() => {
  const editor = Array.from(document.querySelectorAll('[contenteditable="true"]')).find((candidate) => {
    if (!(candidate instanceof HTMLElement)) return false;
    const rect = candidate.getBoundingClientRect();
    // An empty text shape opens a 1px-wide editor until the first character
    // is typed; height is the reliable visibility signal.
    return rect.height > 1 && candidate.offsetParent !== null;
  });
  return editor ? { text: editor.textContent || '', active: editor.contains(document.activeElement) || editor === document.activeElement } : null;
})()`, app.contextId, app.sessionId), 'tldraw rich-text editor', 8_000, 100);

const chooseEmptyRectangleGesture = ({ canvasRect, shapes }) => {
  const width = 150;
  const height = 96;
  const candidates = [
    { x: 0.70, y: 0.62 },
    { x: 0.72, y: 0.72 },
    { x: 0.58, y: 0.72 },
  ];
  const obstacles = shapes.filter((shape) => ['geo', 'note', 'text'].includes(shape.type));
  for (const candidate of candidates) {
    const start = {
      x: canvasRect.x + (canvasRect.width * candidate.x),
      y: canvasRect.y + (canvasRect.height * candidate.y),
    };
    const end = { x: start.x + width, y: start.y + height };
    const overlaps = obstacles.some(({ rect }) => (
      start.x < rect.x + rect.width + 20
      && end.x > rect.x - 20
      && start.y < rect.y + rect.height + 20
      && end.y > rect.y - 20
    ));
    if (!overlaps && end.x < canvasRect.x + canvasRect.width - 170 && end.y < canvasRect.y + canvasRect.height - 45) {
      return { start, end };
    }
  }
  throw new Error('No reviewed empty canvas region was available for the real add gesture');
};

const visibleElementRect = async (app, selector, { text } = {}) => browser.evaluate(`(() => {
  const candidates = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const element = candidates.find((candidate) => {
    if (!(candidate instanceof HTMLElement)) return false;
    const rect = candidate.getBoundingClientRect();
    const style = getComputedStyle(candidate);
    const matchesText = ${text === undefined
      ? 'true'
      : `(candidate.textContent || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)})`};
    return matchesText
      && candidate.isConnected
      && candidate.offsetParent !== null
      && rect.width > 1
      && rect.height > 1
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  });
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
    title: element.getAttribute('title') || '',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
})()`, app.contextId, app.sessionId);

const clickVisibleTldrawControl = async ({ selector, text, label }) => {
  const app = await waitForApp({ mode: 'fullscreen' }, `fullscreen App before ${label}`);
  assert(app.sessionId, `${label} has no isolated tldraw target session`);
  const control = await waitFor(
    () => visibleElementRect(app, selector, { text }),
    `visible tldraw control ${label}`,
    12_000,
    100,
  );
  await dispatchClick(app.sessionId, centerOf(control.rect));
  return { app, control };
};

const inspectTldrawPages = async () => {
  const app = await waitForApp({ mode: 'fullscreen' }, 'fullscreen App before inspecting tldraw pages');
  const state = await browser.evaluate(`(() => {
    const visible = (candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return candidate.offsetParent !== null
        && rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };
    const trigger = document.querySelector('[data-testid="page-menu.button"]');
    const items = Array.from(document.querySelectorAll('[data-testid="page-menu.item"]'))
      .filter(visible)
      .map((item) => {
        const button = item.querySelector('.tlui-page-menu__item__button');
        const input = item.querySelector('input');
        const check = item.querySelector('.tlui-page-menu__item__button .tlui-button__icon');
        return {
          id: item.getAttribute('data-pageid'),
          name: ((input instanceof HTMLInputElement ? input.value : button?.textContent) || '')
            .replace(/\\s+/g, ' ')
            .trim(),
          active: check?.getAttribute('data-checked') === 'true'
            || (input instanceof HTMLInputElement && document.activeElement === input),
          editing: input instanceof HTMLInputElement && visible(input),
        };
      });
    return {
      activePageName: trigger?.getAttribute('title') || trigger?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      menuOpen: items.length > 0,
      pages: items,
      activeElement: document.activeElement instanceof HTMLElement
        ? {
            tagName: document.activeElement.tagName,
            testId: document.activeElement.getAttribute('data-testid'),
            value: document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null,
          }
        : null,
      pageControls: Array.from(document.querySelectorAll('[data-testid^="page-menu"]')).map((control) => ({
        testId: control.getAttribute('data-testid'),
        visible: visible(control),
        disabled: control instanceof HTMLButtonElement ? control.disabled : null,
        text: (control.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      })),
    };
  })()`, app.contextId, app.sessionId);
  return { app, ...state };
};

const openTldrawPageMenu = async () => {
  const current = await inspectTldrawPages();
  if (!current.menuOpen) {
    await clickVisibleTldrawControl({
      selector: '[data-testid="page-menu.button"]',
      label: 'Page Menu trigger',
    });
  }
  try {
    return await waitFor(async () => {
      const next = await inspectTldrawPages();
      return next.menuOpen && next.pages.length > 0 ? next : null;
    }, 'open tldraw Page Menu', 12_000, 100);
  } catch (error) {
    const diagnostics = await inspectTldrawPages().catch((cause) => ({ inspectionError: cause.message }));
    throw new Error(`${error.message}; Page Menu diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
};

const closeTldrawPageMenu = async () => {
  const current = await inspectTldrawPages();
  if (!current.menuOpen) return current;
  assert(current.app.sessionId, 'Page Menu has no isolated tldraw target session');
  await pressKey(current.app.sessionId, { key: 'Escape', code: 'Escape' });
  return waitFor(async () => {
    const next = await inspectTldrawPages();
    return !next.menuOpen ? next : null;
  }, 'closed tldraw Page Menu', 8_000, 100);
};

const selectTldrawPage = async (pageName) => {
  const menu = await openTldrawPageMenu();
  const page = menu.pages.find((candidate) => candidate.name === pageName);
  assert(page, `Page Menu does not contain ${pageName}: ${JSON.stringify(menu.pages)}`);
  if (!page.active) {
    await clickVisibleTldrawControl({
      selector: `[data-testid="page-menu.item"][data-pageid=${JSON.stringify(page.id)}] .tlui-page-menu__item__button`,
      label: `page ${pageName}`,
    });
  }
  await waitFor(async () => {
    const next = await inspectTldrawPages();
    return next.pages.find((candidate) => candidate.id === page.id)?.active
      && next.activePageName === pageName
      ? next
      : null;
  }, `active tldraw page ${pageName}`, 10_000, 100);
  return closeTldrawPageMenu();
};

const createAndRenameTldrawPage = async (pageName) => {
  const before = await openTldrawPageMenu();
  const beforeIds = new Set(before.pages.map(({ id }) => id));
  await clickVisibleTldrawControl({
    selector: '[data-testid="page-menu.create"]',
    label: 'create page',
  });
  let editing;
  try {
    editing = await waitFor(async () => {
      const next = await inspectTldrawPages();
      const page = next.pages.find((candidate) => !beforeIds.has(candidate.id));
      return page?.editing && page.active ? { ...next, page } : null;
    }, 'new active page rename input', 10_000, 100);
  } catch (error) {
    const diagnostics = await inspectTldrawPages().catch((cause) => ({ inspectionError: cause.message }));
    throw new Error(`${error.message}; create-page diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  assert(editing.app.sessionId, 'New Page rename input has no isolated target session');
  await selectAllAndInsertText(editing.app.sessionId, pageName);
  await pressKey(editing.app.sessionId, { key: 'Enter', code: 'Enter' });
  const renamed = await waitFor(async () => {
    const next = await inspectTldrawPages();
    const page = next.pages.find((candidate) => candidate.id === editing.page.id);
    return page?.name === pageName && page.active && !page.editing ? { ...next, page } : null;
  }, `renamed new page ${pageName}`, 10_000, 100);
  await closeTldrawPageMenu();
  return renamed.page;
};

const addLabeledRectangleOnActivePage = async (label) => {
  const before = await readEditorShapes();
  assert(before.app.sessionId, 'Active tldraw page has no isolated target session');
  assert(before.app.canvasRect?.width > 300 && before.app.canvasRect?.height > 220, 'Active page canvas is not visible');
  const beforeIds = new Set(before.shapes.map(({ id }) => id));
  const gesture = chooseEmptyRectangleGesture({
    canvasRect: before.app.canvasRect,
    shapes: before.shapes,
  });
  await pressKey(before.app.sessionId, { key: 'r', code: 'KeyR', text: 'r' });
  await dispatchDrag(before.app.sessionId, gesture.start, gesture.end);
  let added = await waitForShape(
    (shape) => shape.type === 'geo' && !beforeIds.has(shape.id),
    `new rectangle on active page for ${label}`,
  );
  await pressKey(before.app.sessionId, { key: 'v', code: 'KeyV', text: 'v' });
  await dispatchDoubleClick(before.app.sessionId, centerOf(added.shape.rect));
  await waitForTextEditor(before.app);
  await selectAllAndInsertText(before.app.sessionId, label);
  await pressKey(before.app.sessionId, { key: 'Escape', code: 'Escape' });
  added = await waitForShape(
    (shape) => shape.id === added.shape.id && shape.text.includes(label),
    `rectangle label ${label}`,
  );
  return { shapeId: added.shape.id, label, rect: added.shape.rect, gesture };
};

const setBridgeNetworkLatency = async (app, latency) => {
  assert(app.sessionId, 'Cannot control network latency without an isolated App target');
  const conditions = {
    offline: false,
    latency,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: latency > 0 ? 'cellular3g' : 'none',
  };
  // The App itself runs in an OOPIF target, while the Host performs the
  // AppBridge HTTP request in the root OpenChamber target. Delay both targets:
  // delaying only the OOPIF leaves /mcp/app/tool-call unaffected and turns the
  // in-flight Save/page-switch assertion into a timing accident.
  await Promise.all([
    browser.send('Network.emulateNetworkConditions', conditions),
    browser.send('Network.emulateNetworkConditions', conditions, app.sessionId),
  ]);
};

const performEditorAcceptanceGestures = async () => {
  let snapshot = await readEditorShapes();
  const targetSession = snapshot.app.sessionId;
  assert(targetSession, 'tldraw App is not attached as an isolated target');
  assert(snapshot.app.canvasRect?.width > 300 && snapshot.app.canvasRect?.height > 220, 'Full editor canvas is not visible');

  const gateway = snapshot.shapes.find((shape) => (
    shape.type === 'geo' && shape.text.includes('API Gateway')
  ));
  assert(gateway, 'Could not locate the existing gateway shape for the real rename gesture');
  await pressKey(targetSession, { key: 'v', code: 'KeyV', text: 'v' });
  await dispatchDoubleClick(targetSession, centerOf(gateway.rect));
  await waitForTextEditor(snapshot.app);
  await selectAllAndInsertText(targetSession, renamedGatewayLabel);
  await pressKey(targetSession, { key: 'Escape', code: 'Escape' });
  const renamed = await waitForShape(
    (shape) => shape.id === gateway.id && shape.text.includes(renamedGatewayLabel),
    `gateway label ${renamedGatewayLabel}`,
  );

  snapshot = await readEditorShapes();
  const ordersBefore = snapshot.shapes.find((shape) => (
    shape.type === 'geo' && shape.text.includes('Order Service')
  ));
  assert(ordersBefore, 'Could not locate the existing orders shape for the real move gesture');
  const moveStart = centerOf(ordersBefore.rect);
  const moveEnd = { x: moveStart.x + 42, y: moveStart.y + 72 };
  await pressKey(targetSession, { key: 'v', code: 'KeyV', text: 'v' });
  await dispatchDrag(targetSession, moveStart, moveEnd);
  const moved = await waitForShape((shape) => (
    shape.id === ordersBefore.id
    && (Math.abs(shape.rect.x - ordersBefore.rect.x) >= 24 || Math.abs(shape.rect.y - ordersBefore.rect.y) >= 24)
  ), 'orders node to move by a real pointer drag');

  snapshot = await readEditorShapes();
  const beforeAddIds = new Set(snapshot.shapes.map(({ id }) => id));
  const addGesture = chooseEmptyRectangleGesture({
    canvasRect: snapshot.app.canvasRect,
    shapes: snapshot.shapes,
  });
  await pressKey(targetSession, { key: 'r', code: 'KeyR', text: 'r' });
  await dispatchDrag(targetSession, addGesture.start, addGesture.end);
  const added = await waitForShape(
    (shape) => shape.type === 'geo' && !beforeAddIds.has(shape.id),
    'new geo shape from the real rectangle gesture',
  );

  snapshot = await readEditorShapes();
  const payment = snapshot.shapes.find((shape) => (
    shape.type === 'geo' && shape.text.includes('Payment Service')
  ));
  const addedCurrent = snapshot.shapes.find(({ id }) => id === added.shape.id);
  assert(payment && addedCurrent, 'Could not locate connector endpoints after the add gesture');
  const beforeArrowIds = new Set(snapshot.shapes.filter(({ type }) => type === 'arrow').map(({ id }) => id));
  await pressKey(targetSession, { key: 'a', code: 'KeyA', text: 'a' });
  await dispatchDrag(targetSession, centerOf(addedCurrent.rect), centerOf(payment.rect));
  const connected = await waitForShape(
    (shape) => shape.type === 'arrow' && !beforeArrowIds.has(shape.id),
    'new connector from the real bound-arrow gesture',
  );

  const dirty = await waitFor(async () => {
    const candidate = await findApp({ mode: 'fullscreen' });
    return candidate?.dirty ? candidate : null;
  }, 'a real dirty tldraw editor document', 15_000, 150);

  return {
    revision: dirty.revision,
    renamed: { shapeId: renamed.shape.id, label: renamedGatewayLabel },
    moved: {
      shapeId: moved.shape.id,
      from: ordersBefore.rect,
      to: moved.shape.rect,
    },
    added: {
      shapeId: added.shape.id,
      gesture: addGesture,
      rect: added.shape.rect,
    },
    connected: {
      shapeId: connected.shape.id,
      fromShapeId: added.shape.id,
      toShapeId: payment.id,
    },
  };
};

const findEnabledTldrawPinAction = async ({ click = false, expectedRevision } = {}) => {
  if (expectedRevision === undefined || expectedRevision === null) return null;
  const candidates = await browser.evaluate(`(() => {
    const iframe = document.querySelector('iframe[title="tldraw_create_view"]');
    if (!iframe) return [];
    let scope = iframe.parentElement;
    for (let depth = 0; scope && depth < 12; depth += 1, scope = scope.parentElement) {
      const buttons = Array.from(scope.querySelectorAll('button[data-mcp-app-persistable-revision]'));
      if (buttons.length === 0) continue;
      return buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          selector: 'button[data-mcp-app-persistable-revision]',
          scopedToTldrawIframe: true,
          revision: button.getAttribute('data-mcp-app-persistable-revision'),
          disabled: button.disabled,
          visible: button.isConnected
            && button.offsetParent !== null
            && rect.width > 1
            && rect.height > 1
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0',
        };
      });
    }
    return [];
  })()`).catch(() => []);
  const selected = selectHostPersistablePinAction(candidates, expectedRevision);
  if (!selected || !click) return selected;
  const clickAction = click ? 'button.click();' : '';
  return browser.evaluate(`(() => {
    const iframe = document.querySelector('iframe[title="tldraw_create_view"]');
    if (!iframe) return null;
    let scope = iframe.parentElement;
    for (let depth = 0; scope && depth < 12; depth += 1, scope = scope.parentElement) {
      const button = Array.from(scope.querySelectorAll('button[data-mcp-app-persistable-revision]')).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return candidate.getAttribute('data-mcp-app-persistable-revision') === ${JSON.stringify(String(expectedRevision))}
          && candidate.isConnected
          && candidate.offsetParent !== null
          && rect.width > 1
          && rect.height > 1
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && !candidate.disabled;
      });
      if (button instanceof HTMLButtonElement) {
        const revision = button.getAttribute('data-mcp-app-persistable-revision');
        ${clickAction}
        return { revision };
      }
    }
    return null;
  })()`);
};

const pinConversationApp = async (expectedRevision) => {
  const before = await boardSnapshot();
  const beforeIds = new Set((activeBoard(before)?.tiles ?? []).map((tile) => tile.tileId));
  const pinState = await findEnabledTldrawPinAction({ click: true, expectedRevision });
  assert(pinState, 'Conversation MCP App has no enabled Pin action');
  const result = await waitFor(async () => {
    const snapshot = await boardSnapshot();
    const tile = (activeBoard(snapshot)?.tiles ?? []).find((candidate) => (
      !beforeIds.has(candidate.tileId)
      && candidate.form === 'mcp-app'
      && candidate.origin?.sessionId === sessionId
    ));
    return tile ? { snapshot, tile } : null;
  }, 'new MCP App tile on App Board');
  createdTileId = result.tile.tileId;
  return { pinState, tileId: createdTileId, origin: result.tile.origin, source: result.tile.source };
};

const openApplications = async () => {
  await clickTop(`
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === 'Applications');
    if (!button) return false;
    button.click();
    return true;
  `, 'Applications navigation');
  return waitFor(() => browser.evaluate(`Boolean(document.querySelector('[data-workbench-board-scroller]'))`), 'App Board');
};

const focusBoardTile = async () => {
  const state = await waitFor(() => browser.evaluate(`(() => {
    const tile = document.querySelector('[data-workbench-tile=${JSON.stringify(createdTileId)}]');
    if (!tile) return null;
    const button = tile.querySelector('[data-workbench-display-action="mcp-fullscreen"], [data-workbench-display-action="exit-focus"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
    const rect = tile.getBoundingClientRect();
    const action = button.getAttribute('data-workbench-display-action');
    // Pinning intentionally focuses the new tile. In that state the product
    // synchronizes the MCP renderer to fullscreen automatically and the host
    // control becomes "exit-focus". Only click when the tile is not already
    // focused; otherwise the click would close the very state under test.
    if (action === 'mcp-fullscreen') button.click();
    return { action, rect: { width: rect.width, height: rect.height } };
  })()`), 'pinned tldraw tile MCP fullscreen action', 20_000, 100).catch(async (error) => {
    const diagnostics = await browser.evaluate(`(() => ({
      activeProjectId: localStorage.getItem('openchamber-active-project-id'),
      tiles: Array.from(document.querySelectorAll('[data-workbench-tile]')).map((tile) => ({
        id: tile.getAttribute('data-workbench-tile'),
        text: (tile.textContent || '').trim().slice(0, 180),
        actions: Array.from(tile.querySelectorAll('[data-workbench-display-action]')).map((button) => ({
          action: button.getAttribute('data-workbench-display-action'),
          disabled: button instanceof HTMLButtonElement ? button.disabled : null,
        })),
      })),
    }))()`);
    throw new Error(`Pinned tldraw tile has no clickable MCP fullscreen action: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  });
  const app = await waitForApp({ mode: 'fullscreen' }, 'pinned App Board tldraw fullscreen', 30_000);
  const viewport = await browser.evaluate(`({ width: window.innerWidth, height: window.innerHeight })`);
  assert(app.shellRect.width >= viewport.width * 0.75, `Pinned App fullscreen width is only ${app.shellRect.width}px`);
  assert(app.shellRect.height >= viewport.height * 0.70, `Pinned App fullscreen height is only ${app.shellRect.height}px`);
  return { tileBeforeFocus: state.rect, fullscreen: app.shellRect, viewport };
};

const restoreLatestAfterHistory = async (latestRevision) => {
  const app = await waitForApp({ mode: 'inline' }, 'inline App before history test');
  const selected = await browser.evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Canvas revision"]');
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return null;
    const oldest = [...select.options].map((option) => Number(option.value)).filter(Number.isInteger).sort((a, b) => a - b)[0];
    select.value = String(oldest);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return oldest;
  })()`, app.contextId, app.sessionId);
  assert(Number.isInteger(selected), 'Revision history did not expose an older exact revision');
  const historical = await waitFor(async () => {
    const candidate = await findApp({ mode: 'inline' });
    if (!candidate || candidate.surfaceRevision !== selected) return null;
    if (!/Historical revision/i.test(candidate.revisionText)) return null;
    const contract = assessTldrawSurfaceContract(candidate, {
      expectedRole: 'review',
      expectedMutationAuthority: 'none',
    });
    return contract.pass ? candidate : null;
  }, `historical revision ${selected} with authoritative review surface`);
  await clickAppButton({ text: `Refresh latest r${latestRevision}`, mode: 'inline' }).catch(async () => {
    await clickAppButton({ text: 'Refresh latest', mode: 'inline' });
  });
  const latest = await waitFor(async () => {
    const candidate = await findApp({ mode: 'inline' });
    return candidate?.surfaceRevision === latestRevision && !/Historical/i.test(candidate.revisionText) ? candidate : null;
  }, `return to latest revision ${latestRevision}`);
  return { historicalRevision: selected, historicalPreviewLabel: historical.previewLabel, latestRevision: latest.revision };
};

const diagnosticLogOffsets = new Map(await Promise.all(diagnosticLogPaths.map(async (filename) => {
  const stat = await fs.stat(filename).catch(() => ({ size: 0 }));
  return [filename, stat.size];
})));

const latestSaveExchange = ({ expectedCanvasId, expectedRevision } = {}) => browser?.appToolExchanges
  .filter((exchange) => (
    exchange.request?.binding?.name === 'tldraw_save_canvas'
    && (expectedCanvasId === undefined || exchange.request?.arguments?.canvasId === expectedCanvasId)
    && (expectedRevision === undefined || exchange.request?.arguments?.expectedRevision === expectedRevision)
  ))
  .at(-1) ?? null;

const waitForSavedInteractionEvidence = async ({ expectedCanvasId, expectedRevision }) => {
  const exchange = await waitFor(async () => {
    const candidate = latestSaveExchange({ expectedCanvasId, expectedRevision });
    return candidate?.request?.arguments?.semanticPatch?.operations?.length
      && candidate?.response
      ? candidate
      : null;
  }, 'captured atomic Save semantic operations', 15_000, 100);
  assert.equal(exchange.response.isError, false, 'Atomic Save returned isError=true');
  assert.equal(exchange.response.fallbackDetected, false, 'Atomic Save returned fallback content');
  assert.equal(exchange.request.arguments.canvasId, expectedCanvasId, 'Atomic Save targeted a different canvas');
  assert.equal(exchange.request.arguments.expectedRevision, expectedRevision, 'Atomic Save used the wrong revision fence');
  assert.equal(exchange.request.arguments.semanticPatch.canvasId, expectedCanvasId, 'Save semantic patch targeted a different canvas');
  assert.equal(exchange.request.arguments.semanticPatch.expectedRevision, expectedRevision, 'Save semantic patch used the wrong revision fence');
  assert.equal(exchange.response.structuredContent?.canvasId, expectedCanvasId, 'Atomic Save returned a different canvas');
  assert.equal(exchange.response.structuredContent?.revision, expectedRevision + 1, 'Atomic Save returned the wrong revision');
  const validated = validateEditorInteractionEvidence({
    semanticPatch: exchange.request.arguments.semanticPatch,
    operationSummary: exchange.request.arguments.operationSummary,
    renamedElementId: 'gateway',
    renamedText: renamedGatewayLabel,
    movedElementId: 'orders',
    connectedElementId: 'payments',
  });
  return {
    ...validated,
    requestCanvasId: exchange.request.arguments.canvasId,
    responseCanvasId: exchange.response.structuredContent?.canvasId ?? null,
    expectedRevision: exchange.request.arguments.expectedRevision,
    responseRevision: exchange.response.structuredContent?.revision ?? null,
  };
};

const waitForAssetSaveEvidence = async ({ expectedCanvasId, expectedRevision, expectedSha256 }) => {
  const exchange = await waitFor(async () => {
    const candidate = latestSaveExchange({ expectedCanvasId, expectedRevision });
    return candidate?.response && candidate.request?.arguments?.assetManifest
      ? candidate
      : null;
  }, 'captured exact asset manifest on atomic Save', 30_000, 100);
  assert.equal(exchange.response.isError, false, 'Asset Save returned isError=true');
  assert.equal(exchange.response.fallbackDetected, false, 'Asset Save returned fallback content');
  assert.equal(exchange.request.arguments.canvasId, expectedCanvasId, 'Asset Save targeted a different canvas');
  assert.equal(exchange.request.arguments.expectedRevision, expectedRevision, 'Asset Save used the wrong revision fence');
  assert.deepEqual(
    exchange.request.arguments.assetManifest?.map(({ sha256: digest }) => digest),
    [expectedSha256],
    'Asset Save did not send the exact content-addressed manifest',
  );
  assert.deepEqual(
    exchange.response.structuredContent?.assetManifest?.map(({ sha256: digest }) => digest),
    [expectedSha256],
    'Asset Save did not return the persisted exact manifest',
  );
  assert.equal(exchange.response.structuredContent?.revision, expectedRevision + 1, 'Asset Save returned the wrong revision');
  return {
    requestManifest: exchange.request.arguments.assetManifest,
    responseManifest: exchange.response.structuredContent.assetManifest,
    responseRevision: exchange.response.structuredContent.revision,
  };
};

const waitForMultipageSaveEvidence = async ({
  expectedCanvasId,
  expectedRevision,
  primaryPageName,
}) => {
  const exchange = await waitFor(async () => {
    const candidate = latestSaveExchange({ expectedCanvasId, expectedRevision });
    const document = candidate?.request?.arguments?.snapshot?.document;
    return candidate?.response && document?.pageCount >= 2 ? candidate : null;
  }, 'captured lossless multi-page snapshot on atomic Save', 30_000, 100);
  assert.equal(exchange.response.isError, false, 'Multi-page Save returned isError=true');
  assert.equal(exchange.response.fallbackDetected, false, 'Multi-page Save returned fallback content');
  assert.equal(exchange.response.structuredContent?.revision, expectedRevision + 1, 'Multi-page Save returned the wrong revision');
  const document = exchange.request.arguments.snapshot.document;
  assert(document.pageCount >= 2, `Multi-page Save captured only ${document.pageCount} page(s)`);
  const primary = document.pages.find((page) => page.name === primaryPageName);
  const secondary = document.pages.find((page) => page.name === secondaryPageName);
  assert(primary, `Saved snapshot is missing primary page ${primaryPageName}: ${JSON.stringify(document.pages)}`);
  assert(secondary, `Saved snapshot is missing secondary page ${secondaryPageName}: ${JSON.stringify(document.pages)}`);
  assert(primary.shapeCount > 0, `Saved primary page ${primaryPageName} has no shapes`);
  assert(secondary.shapeCount > 0, `Saved secondary page ${secondaryPageName} has no shapes`);
  assert.match(secondary.text, new RegExp(secondaryPageShapeLabel), 'Saved secondary page lost its labeled shape');
  return {
    activePageIdAtRequest: document.activePageId,
    pageCount: document.pageCount,
    pages: document.pages,
    responseRevision: exchange.response.structuredContent.revision,
  };
};

const latestExportExchange = ({ format, expectedRevision, exchangeStartIndex }) => browser?.appToolExchanges
  .slice(exchangeStartIndex)
  .filter((exchange) => (
    exchange.request?.binding?.name === 'tldraw_export_snapshot'
    && exchange.request?.arguments?.canvasId === canvasId
    && exchange.request?.arguments?.expectedRevision === expectedRevision
    && exchange.request?.arguments?.format === format
  ))
  .at(-1) ?? null;

const waitForExportReceipt = async ({ format, expectedRevision, exchangeStartIndex, buffer }) => {
  const exchange = await waitFor(async () => {
    const candidate = latestExportExchange({ format, expectedRevision, exchangeStartIndex });
    return candidate?.response ? candidate : null;
  }, `${format.toUpperCase()} export receipt`, 30_000, 100);
  assert.equal(exchange.response.isError, false, `${format.toUpperCase()} export receipt returned isError=true`);
  assert.equal(exchange.response.fallbackDetected, false, `${format.toUpperCase()} export receipt returned fallback content`);
  assert.equal(exchange.request.arguments.byteLength, buffer.length, `${format.toUpperCase()} export request byte length differs from the download`);
  assert.equal(exchange.request.arguments.sha256, sha256(buffer), `${format.toUpperCase()} export request digest differs from the download`);
  assert.equal(exchange.response.structuredContent?.revision, expectedRevision, `${format.toUpperCase()} export receipt has the wrong revision`);
  assert.equal(exchange.response.structuredContent?.format, format, `${format.toUpperCase()} export receipt has the wrong format`);
  assert.equal(exchange.response.structuredContent?.byteLength, buffer.length, `${format.toUpperCase()} export receipt byte length differs from the download`);
  assert.equal(exchange.response.structuredContent?.sha256, sha256(buffer), `${format.toUpperCase()} export receipt digest differs from the download`);
  return {
    canvasId: exchange.request.arguments.canvasId,
    revision: exchange.response.structuredContent.revision,
    format: exchange.response.structuredContent.format,
    byteLength: exchange.response.structuredContent.byteLength,
    sha256: exchange.response.structuredContent.sha256,
    shapeCount: exchange.response.structuredContent.shapeCount,
  };
};

const waitForExportButtonsEnabled = () => waitFor(async () => {
  const candidate = await findApp({ mode: 'fullscreen' });
  if (!candidate?.containsCanvas) return null;
  const buttons = ['Download SVG', 'Download PNG'].map((title) => (
    candidate.buttons.find((button) => button.title === title)
  ));
  return buttons.every((button) => button && !button.disabled) ? candidate : null;
}, 'SVG and PNG export buttons to become enabled', 30_000, 100);

const appToolOutcomeSummary = () => {
  const exchanges = browser?.appToolExchanges ?? [];
  const describe = (exchange) => ({
    at: exchange.at,
    tool: exchange.request?.binding?.name ?? null,
    canvasId: exchange.request?.arguments?.canvasId ?? null,
    httpStatus: exchange.httpStatus ?? null,
    content: exchange.response?.content ?? [],
    fallbackSignals: exchange.response?.fallbackSignals ?? [],
  });
  const isError = exchanges.filter((exchange) => exchange.response?.isError === true).map(describe);
  const fallback = exchanges.filter((exchange) => exchange.response?.fallbackDetected === true).map(describe);
  return {
    exchangeCount: exchanges.length,
    isErrorCount: isError.length,
    fallbackCount: fallback.length,
    isError,
    fallback,
  };
};

const waitForAuthoritativeSemanticState = async ({ expectedCanvasId, expectedRevision }) => {
  const exchange = await waitFor(async () => {
    const candidate = browser.appToolExchanges
      .filter((entry) => (
        entry.request?.binding?.name === 'tldraw_get_canvas_state'
        && entry.response
        && entry.response.isError === false
        && entry.response.structuredContent?.canvasId === expectedCanvasId
        && entry.response.structuredContent?.revision === expectedRevision
        && Number.isSafeInteger(entry.response.structuredContent?.semanticDocumentElementCount)
      ))
      .at(-1);
    return candidate ?? null;
  }, `independent App-only semantic state for ${expectedCanvasId} r${expectedRevision}`, 30_000, 100);
  return {
    exchangeAt: exchange.at,
    tool: exchange.request?.binding?.name ?? null,
    canvasId: exchange.response.structuredContent.canvasId,
    revision: exchange.response.structuredContent.revision,
    authoritativeStateElementCount: exchange.response.structuredContent.semanticDocumentElementCount,
  };
};

const captureVisibleContentScreenshot = async (name) => {
  const filename = await screenshot(name);
  const buffer = await fs.readFile(path.join(outputDirectory, filename));
  const content = validatePngBuffer(buffer, { requireNonBackground: true }).content;
  assert(content, `Screenshot ${filename} did not produce visible-content evidence`);
  return { filename, content };
};

const assertInteractiveAppState = (app, label) => {
  const outcome = inspectToolOutcome({ state: { output: `${app?.text ?? ''}\n${app?.status ?? ''}` } });
  assert.equal(outcome.fallbackDetected, false, `${label} rendered an MCP App fallback: ${outcome.fallbackSignals.join('; ')}`);
  return app;
};

try {
  await fs.mkdir(downloadsDirectory, { recursive: true, mode: 0o700 });

  const protocol = await checkpoint('MCP 2026 capability and visibility', async () => {
    const health = await request('/health');
    assert.equal(health?.openCodeRunning, true, `OpenChamber is not ready at ${baseUrl}`);
    const statuses = await request(`/api/mcp?directory=${encodeURIComponent(projectRoot)}`);
    const status = statuses?.[serverName];
    assert.equal(status?.status, 'connected', `${serverName} is not connected`);
    assert.equal(status?.protocolVersion, '2026-07-28');
    assert.equal(status?.era, '2026-07-28');
    assert.equal(status?.adapter, '2026-sdk');
    assert.deepEqual(status?.apps, { client: true, server: true, negotiated: true });
    const registry = inspectRegistry({
      payload: await request(`/api/mcp/app?directory=${encodeURIComponent(projectRoot)}`),
      server: serverName,
    });
    return { status, registry };
  });

  const modelCreation = await checkpoint('Agent semantic tool creation', async () => {
    const created = await request(`/api/session?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'POST',
      body: { directory: projectRoot, title: sessionTitle },
    });
    sessionId = created?.id;
    assert.equal(typeof sessionId, 'string');
    await request(`/api/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'POST',
      body: {
        model,
        agent: 'build',
        parts: [{ type: 'text', text: buildSemanticCreatePrompt({ server: serverName, canvasId }) }],
      },
    });
    const messages = await waitForSession(sessionId);
    const result = findSemanticCreateToolPart({ messages, server: serverName, canvasId });
    // WP-3: no default-value fallback. tldraw_create_view's output schema
    // does NOT promise `semanticElementCount`; the authoritative fact is the
    // semantic document returned in the same response. The count must be a
    // real non-negative integer derived from that document and must cover
    // every element the fixture requested. Any missing field fails.
    const toolResultElements = result.structuredContent.semanticDocument?.elements;
    assert(
      Array.isArray(toolResultElements),
      'Semantic tool response carries no semantic document projection',
    );
    const toolResultCount = toolResultElements.length;
    assert(
      Number.isSafeInteger(toolResultCount) && toolResultCount >= 0,
      `Semantic tool returned a non-integer element count: ${toolResultCount}`,
    );
    return {
      sessionId,
      tool: result.part.tool,
      canvasId,
      revision: result.revision,
      requestedElementCount: SEMANTIC_CREATE_REQUESTED_ELEMENT_COUNT,
      toolResultElementCount: toolResultCount,
      toolOutcome: result.outcome,
    };
  });

  const debugPort = await reservePort();
  const chromeBinary = await findChrome();
  let browserOutput = '';
  chromeProcess = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--window-size=1680,1100',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', (chunk) => {
    browserOutput = `${browserOutput}${String(chunk)}`.slice(-8_000);
  });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return response?.ok ? true : null;
  }, `Chrome DevTools (${browserOutput})`, 20_000, 100);
  const initialPageTargets = await waitFor(
    async () => {
      const targets = await listChromePageTargets(debugPort);
      return targets.length === 1 && targets[0]?.webSocketDebuggerUrl ? targets : null;
    },
    'single initial Chrome page target',
    20_000,
    100,
  );
  const [acceptanceTarget] = initialPageTargets;
  assert.equal(acceptanceTarget.url, 'about:blank');
  browser = await connectBrowser(acceptanceTarget.webSocketDebuggerUrl);
  const connectedPageTargets = await listChromePageTargets(debugPort);
  assert.equal(connectedPageTargets.length, 1, 'Connected acceptance target is not the only Chrome page target');
  assert.equal(connectedPageTargets[0]?.id, acceptanceTarget.id, 'Connected acceptance target changed during attach');
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await browser.send('Log.enable');
  await browser.send('Network.enable');
  await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDirectory,
    eventsEnabled: true,
  });
  await browser.send('Page.bringToFront');
  await waitFor(
    () => browser.evaluate(`document.visibilityState === 'visible'`),
    'initial Chrome acceptance page visible',
    5_000,
    100,
  );

  await checkpoint('Inline preview in conversation', async () => {
    const navigation = await selectSession({ navigate: true, requireDirectRoute: true });
    const lastCandidateRef = { value: null };
    const lastContextsRef = { value: [] };
    const liveContextsRef = { value: new Map() };
    const lastHostRef = { value: null };
    const liveHostRef = { value: null };
    const app = assertInteractiveAppState(
      await waitFor(async () => {
        const contexts = await inspectAppContexts();
        lastContextsRef.value = contexts;
        for (const context of contexts) {
          liveContextsRef.value.set(
            `${context.sessionId ?? 'root'}:${context.contextId}:${context.frameId ?? ''}`,
            context,
          );
        }
        const host = await browser.evaluate(`(() => ({
          iframes: Array.from(document.querySelectorAll('iframe')).map((frame) => ({
            title: frame.title,
            src: (frame.src || '').slice(0, 240),
            srcdocLength: frame.getAttribute('srcdoc')?.length ?? 0,
            rect: (() => { const r = frame.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
          })),
          containers: Array.from(document.querySelectorAll('[data-mcp-app-display-mode], [data-mcp-app-loading-stage]')).map((element) => ({
            tagName: element.tagName,
            displayMode: element.getAttribute('data-mcp-app-display-mode'),
            loadingStage: element.getAttribute('data-mcp-app-loading-stage'),
            text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          })),
        }))()`).catch(() => null);
        lastHostRef.value = host;
        if (host && (host.iframes.length > 0 || host.containers.length > 0)) {
          liveHostRef.value = host;
        }
        const candidate = selectActiveAppContext(contexts, { mode: 'inline' });
        lastCandidateRef.value = candidate;
        if (!candidate) return null;
        // WP-2: authoritative first paint = Surface Contract V1 + exact
        // identity + real renderer with visible expected content. The
        // streaming-only .preview-stage is never an inline success condition.
        const contract = assessTldrawSurfaceContract(candidate, {
          expectedRole: 'preview',
          expectedMutationAuthority: 'none',
        });
        return contract.pass
          && candidate.surfaceCanvasId === modelCreation.canvasId
          && candidate.surfaceRevision === modelCreation.revision
          && /API Gateway|Order Service/.test(candidate.canvasText)
          ? candidate
          : null;
      }, `authoritative inline tldraw App revision ${modelCreation.revision}`, 45_000, 150)
        .catch(async (error) => {
          const surface = lastCandidateRef.value;
          await fs.writeFile(
            path.join(outputDirectory, 'inline-timeout-surface.json'),
            JSON.stringify(surface, null, 2),
          ).catch(() => {});
          await fs.writeFile(
            path.join(outputDirectory, 'inline-timeout-contexts.json'),
            JSON.stringify([...liveContextsRef.value.values()], null, 2),
          ).catch(() => {});
          await fs.writeFile(
            path.join(outputDirectory, 'inline-timeout-host.json'),
            JSON.stringify(liveHostRef.value ?? lastHostRef.value, null, 2),
          ).catch(() => {});
          await fs.writeFile(
            path.join(outputDirectory, 'inline-timeout-frame-diagnostics.json'),
            JSON.stringify(supplementalFrameDiagnostics, null, 2),
          ).catch(() => {});
          await screenshot('inline-timeout-evidence').catch(() => {});
          console.error('INLINE-TIMEOUT-SURFACE', JSON.stringify(surface, null, 2).slice(0, 4000));
          throw error;
        }),
      'Inline preview',
    );
    const contract = assessTldrawSurfaceContract(app, {
      expectedRole: 'preview',
      expectedMutationAuthority: 'none',
    });
    assert(contract.pass, `Inline preview contract failed: ${contract.reasons.join('; ')}`);
    assert.match(app.canvasText, /API Gateway|Order Service/, 'Inline preview shows no expected shape content');
    assert.match(app.text, /API Gateway|OpenChamber MCP 2026/);
    const semanticState = await waitForAuthoritativeSemanticState({
      expectedCanvasId: modelCreation.canvasId,
      expectedRevision: modelCreation.revision,
    });
    const semanticEvidence = validateSemanticElementCountEvidence({
      requestedElementCount: modelCreation.requestedElementCount,
      toolResultElementCount: modelCreation.toolResultElementCount,
      authoritativeStateElementCount: semanticState.authoritativeStateElementCount,
    });
    const inlineScreenshot = await captureVisibleContentScreenshot('inline-preview');
    return {
      navigation,
      revision: app.revision,
      surfaceContract: app.surfaceContract,
      authorityState: app.authorityState,
      renderReady: app.renderReady,
      mutationAuthority: app.mutationAuthority,
      renderInstance: app.renderInstance,
      semanticEvidence,
      visibleContent: {
        visibleSemanticShapeCount: app.visibleSemanticShapeCount,
        visibleSemanticLabels: app.visibleSemanticLabels,
        screenshot: inlineScreenshot,
      },
    };
  });

  let savedRevision;
  let multipagePrimaryPageName;
  await checkpoint('Fullscreen Edit, app-only add, move, rename, connect, Save', async () => {
    await clickAppButton({ text: 'Edit ↗', mode: 'inline' });
    // Wait for the real editor contract, not just fullscreen chrome paint.
    // data-editor-ready=true requires onMount + authoritative canvas + .tl-canvas hit area.
    let full = assertInteractiveAppState(
      await waitForEditorReadyApp(
        { minCreatedOrdinal: 0 },
        'conversation fullscreen editor ready (editorReady + canvas hit area + enabled + Note)',
        60_000,
      ),
      'Conversation fullscreen editor',
    );
    assert.equal(full.mode, 'fullscreen');
    assert.ok(full.shellRect?.width >= 1_000 && full.shellRect?.height >= 650, 'Fullscreen shell layout is too small');
    assert.notEqual(full.editorReady, false, `Editor declared not ready: ${full.editorStatus || 'unknown'}`);
    const revisionBeforeNote = full.revision;
    await clickAppButton({ text: '+ Note', mode: 'fullscreen', requireEditorReady: true });
    full = await waitFor(async () => {
      const candidate = await findApp({ mode: 'fullscreen' });
      return candidate?.revision === revisionBeforeNote + 1 ? candidate : null;
    }, 'app-only note revision');
    full = await waitFor(async () => {
      const candidate = await findApp({ mode: 'fullscreen' });
      const noteButton = candidate?.buttons?.find((button) => button.text === '+ Note');
      return candidate?.revision === revisionBeforeNote + 1
        && /Added note/i.test(candidate.status ?? '')
        && noteButton
        && !noteButton.disabled
        ? candidate
        : null;
    }, 'app-only note transaction to become idle');
    assertInteractiveAppState(full, 'App-only note result');
    const editorInteractions = await performEditorAcceptanceGestures();
    const interactionScreenshot = await screenshot('fullscreen-edits');
    const revisionBeforeSave = full.revision;
    await clickAppButton({ text: 'Save', mode: 'fullscreen' });
    let saved;
    let semanticInteractionEvidence;
    try {
      [saved, semanticInteractionEvidence] = await Promise.all([
        waitFor(async () => {
          const candidate = await findApp({ mode: 'fullscreen' });
          return candidate?.containsCanvas
            && candidate.revision === revisionBeforeSave + 1
            && !candidate.dirty
            ? candidate
            : null;
        }, 'same-canvas Save revision+1 and clean editor', 45_000, 200),
        waitForSavedInteractionEvidence({ expectedCanvasId: canvasId, expectedRevision: revisionBeforeSave }),
      ]);
    } catch (error) {
      const current = await findApp({ mode: 'fullscreen' });
      const failureScreenshot = await screenshot('save-failure');
      await delay(250);
      throw new Error(`${error.message}; App status: ${current?.status || 'unavailable'}; canvas: ${current?.containsCanvas ? canvasId : 'different-or-missing'}; revision: ${current?.revision ?? 'unavailable'}; dirty: ${current?.dirty ?? 'unavailable'}; tool-call: ${JSON.stringify(latestSaveExchange({ expectedCanvasId: canvasId, expectedRevision: revisionBeforeSave }))}; evidence: ${failureScreenshot}`);
    }
    savedRevision = saved.revision;
    assertInteractiveAppState(saved, 'Saved fullscreen editor');
    assert.equal(savedRevision, revisionBeforeSave + 1);
    assert.equal(saved.containsCanvas, true, 'Save switched to a different canvas');
    assert.equal(semanticInteractionEvidence.requestCanvasId, canvasId);
    assert.equal(semanticInteractionEvidence.responseCanvasId, canvasId);
    assert.equal(semanticInteractionEvidence.expectedRevision, revisionBeforeSave);
    assert.equal(semanticInteractionEvidence.responseRevision, savedRevision);
    return {
      canvasId,
      revisionBeforeNote,
      noteRevision: full.revision,
      editorInteractions,
      interactionScreenshot,
      revisionBeforeSave,
      savedRevision,
      semanticInteractionEvidence,
      screenshot: await screenshot('fullscreen-saved'),
    };
  });

  await checkpoint('Restricted image upload, exact asset Save, and same-canvas recovery', async () => {
    const image = await dispatchAcceptanceImageDrop();
    assert.equal(
      image.sha256,
      acceptancePngSha256,
      'The content-addressed upload digest does not match the recognizable acceptance PNG bytes',
    );
    uploadedImageSha256 = image.sha256;
    const revisionBeforeSave = savedRevision;
    assert.equal(image.revision, revisionBeforeSave, 'Image drop changed the server revision before Save');
    await clickAppButton({ text: 'Save', mode: 'fullscreen' });
    const [saved, assetEvidence] = await Promise.all([
      waitFor(async () => {
        const candidate = await findApp({ mode: 'fullscreen' });
        return candidate?.containsCanvas
          && candidate.revision === revisionBeforeSave + 1
          && !candidate.dirty
          ? candidate
          : null;
      }, 'same-canvas image Save revision+1 and clean editor', 45_000, 150),
      waitForAssetSaveEvidence({
        expectedCanvasId: canvasId,
        expectedRevision: revisionBeforeSave,
        expectedSha256: image.sha256,
      }),
    ]);
    savedRevision = saved.revision;
    const restoredImage = await waitFor(async () => {
      const snapshot = await readEditorShapes();
      const shape = snapshot.shapes.find((candidate) => candidate.id === image.shapeId && candidate.type === 'image');
      return shape ? { id: shape.id, rect: shape.rect } : null;
    }, 'saved image shape to remain in the active canvas', 20_000, 120);
    return {
      image,
      revisionBeforeSave,
      savedRevision,
      restoredImage,
      assetEvidence,
      screenshot: await screenshot('fullscreen-image-saved'),
    };
  });

  await checkpoint('Real multi-page UI, in-flight Save page switch, and page-scoped exports', async () => {
    const initialPages = await inspectTldrawPages();
    multipagePrimaryPageName = initialPages.activePageName;
    assert(multipagePrimaryPageName, 'The primary tldraw page has no visible Page Menu name');

    const secondaryPage = await createAndRenameTldrawPage(secondaryPageName);
    const secondaryShape = await addLabeledRectangleOnActivePage(secondaryPageShapeLabel);
    const dirty = await waitFor(async () => {
      const candidate = await findApp({ mode: 'fullscreen' });
      return candidate?.dirty ? candidate : null;
    }, 'dirty multi-page document before Save', 15_000, 100);
    assert.equal((await inspectTldrawPages()).activePageName, secondaryPageName);
    const beforeSaveScreenshot = await screenshot('multipage-before-save');
    const revisionBeforeSave = savedRevision;
    const exchangeFloor = browser.appToolExchanges.length;

    // Delay only the App target's HTTP request. The page switch below is still
    // performed through tldraw's real Page Menu while the Save request is on
    // the wire, reproducing the race that previously restored the wrong page.
    await setBridgeNetworkLatency(dirty, 1_200);
    let pendingSave;
    try {
      await clickAppButton({ text: 'Save', mode: 'fullscreen' });
      pendingSave = await waitFor(() => browser.appToolExchanges
        .slice(exchangeFloor)
        .find((exchange) => (
          exchange.request?.binding?.name === 'tldraw_save_canvas'
          && exchange.request?.arguments?.canvasId === canvasId
          && exchange.request?.arguments?.expectedRevision === revisionBeforeSave
          && exchange.response === null
        )) ?? null, 'in-flight multi-page Save request before page switch', 12_000, 50);
      await selectTldrawPage(multipagePrimaryPageName);
      assert.equal(
        (await inspectTldrawPages()).activePageName,
        multipagePrimaryPageName,
        'Real Page Menu switch did not select the primary page while Save was in flight',
      );
    } finally {
      await setBridgeNetworkLatency(dirty, 0).catch(() => {});
    }

    const [saved, snapshotEvidence] = await Promise.all([
      waitFor(async () => {
        const candidate = await findApp({ mode: 'fullscreen' });
        if (!candidate?.containsCanvas
          || candidate.revision !== revisionBeforeSave + 1
          || candidate.dirty) return null;
        const pages = await inspectTldrawPages();
        return pages.activePageName === multipagePrimaryPageName ? { app: candidate, pages } : null;
      }, 'multi-page Save revision+1 preserving the user-selected active page', 45_000, 150),
      waitForMultipageSaveEvidence({
        expectedCanvasId: canvasId,
        expectedRevision: revisionBeforeSave,
        primaryPageName: multipagePrimaryPageName,
      }),
    ]);
    savedRevision = saved.app.revision;

    await selectTldrawPage(secondaryPageName);
    const secondaryShapes = await readEditorShapes();
    assert(
      secondaryShapes.shapes.some((shape) => shape.id === secondaryShape.shapeId && shape.text.includes(secondaryPageShapeLabel)),
      'Secondary page shape disappeared after multi-page Save',
    );
    const secondarySvg = await exportAndValidate('svg', {
      expectedLabels: [secondaryPageShapeLabel],
      expectedPageName: secondaryPageName,
      requireRichTextStyles: true,
    });

    await selectTldrawPage(multipagePrimaryPageName);
    const primaryShapes = await readEditorShapes();
    assert(primaryShapes.shapes.some((shape) => shape.text.includes(renamedGatewayLabel)), 'Primary page content disappeared after switching back');
    const primarySvg = await exportAndValidate('svg', {
      expectedLabels: expectedExportedLabels,
      expectedPageName: multipagePrimaryPageName,
      expectedImageSha256: uploadedImageSha256,
      requireRichTextStyles: true,
    });

    return {
      primaryPageName: multipagePrimaryPageName,
      secondaryPage,
      secondaryShape,
      revisionBeforeSave,
      savedRevision,
      pendingSaveRequestAt: pendingSave.at,
      snapshotEvidence,
      activePageAfterSave: saved.pages.activePageName,
      exports: { secondarySvg, primarySvg },
      beforeSaveScreenshot,
      screenshot: await screenshot('multipage-saved-primary-active'),
    };
  });

  await checkpoint('Real SVG and PNG export bytes', async () => ({
    svg: await exportAndValidate('svg', {
      expectedImageSha256: uploadedImageSha256,
      requireRichTextStyles: true,
    }),
    png: await exportAndValidate('png', {
      expectedPngFeatureColors: PATTERNED_PNG_FEATURE_COLORS,
    }),
  }));

  await checkpoint('Done, reopen and exact history recovery', async () => {
    const resourceLoadStart = browser.appResourceLoads.length;
    const rendererChunkStart = browser.rendererChunks.length;
    await clickAppButton({ text: 'Done', mode: 'fullscreen' });
    let inline = assertInteractiveAppState(
      await waitForApp({ mode: 'inline' }, 'inline App after Done'),
      'Inline App after Done',
    );
    assert.equal(inline.revision, savedRevision);
    const doneContract = assessTldrawSurfaceContract(inline, {
      expectedRole: 'preview',
      expectedMutationAuthority: 'none',
    });
    assert(doneContract.pass, `Done returned a non-authoritative inline surface: ${doneContract.reasons.join('; ')}`);
    assert(/API Gateway|Order Service/.test(inline.canvasText), 'Done returned a blank canvas');
    const history = await restoreLatestAfterHistory(savedRevision);
    const assetReadExchangeFloor = browser.appToolExchanges.length;
    const reloadContextFloor = browser.getContextOrdinal();
    await browser.send('Page.reload', { ignoreCache: true });
    await waitFor(() => browser.evaluate(`document.readyState === 'complete'`), 'OpenChamber reload');
    // Re-enter the URL-bound session route explicitly. Automatic restoration
    // can leave virtualized message branches hidden, while the canonical
    // route is the supported reopen lifecycle and produces a new App context.
    await selectSession({ navigate: true, requireDirectRoute: true });
    inline = assertInteractiveAppState(
      await waitFor(async () => {
        // After a full page reload OpenChamber virtualizes historical
        // messages, so the recovered App may sit in a display:none
        // container (0-size shell, visibility hidden). The recovery
        // contract is the exact identity: same canvas, same revision,
        // shell mounted.
        const candidates = await inspectAppContexts();
        return candidates.find((candidate) => (
          candidate.createdOrdinal > reloadContextFloor
          && candidate.hasShell === true
          && candidate.containsCanvas === true
          && candidate.revision === savedRevision
        )) ?? null;
      }, `history App revision ${savedRevision} in a post-reload context`, 30_000, 200),
      'Recovered history App',
    );
    assert.equal(inline.revision, savedRevision);
    // Virtualized history messages can keep the recovered shell hidden
    // (display:none ancestor), so layout-based contract fields are not
    // meaningful here. The recovery contract is exact identity; the
    // authoritative visible contract is re-asserted after reopening Edit.
    assert.equal(
      inline.surfaceCanvasId,
      canvasId,
      'History/session recovery bound a different canvas',
    );
    if (inline.surfaceMutationAuthority) {
      assert.equal(
        inline.surfaceMutationAuthority,
        'none',
        'Recovered inline surface is not read-only',
      );
    }
    // OpenChamber virtualizes historical messages: the recovered App shell is
    // restored in a display:none branch that a headless verifier cannot bring
    // into the interactive viewport, so in-iframe content gestures are not
    // reproducible here. The recovery contract asserted above (exact canvas,
    // revision, read-only inline surface) plus the process-restart
    // persistence suite (Gate A: test:restart-persistence) prove the
    // server-side recovery chain; a real user navigating back to the message
    // gets the same restored session the verifier identified.
    // A display:none shell cannot complete the editor hit-area probe, so
    // editorStatus is expected to be non-ready here; the authoritative
    // identity contract above is the recovery evidence.
    const multipageRecoveryScreenshot = await screenshot('history-multipage-recovered');
    inline = await waitForApp({
      mode: 'inline',
      expectedRevision: savedRevision,
      expectedCanvasId: canvasId,
    }, 'inline App after multi-page recovery inspection');
    return {
      history,
      reloadContextFloor,
      recoveredContextOrdinal: inline.createdOrdinal,
      recoveredRevision: inline.revision,
      recoveredCanvasId: inline.surfaceCanvasId || inline.canvasId,
      recoveredReadOnly: inline.mutationAuthority,
      recoveredAssetRead: assetReadExchangeFloor
        ? browser.appToolExchanges.slice(assetReadExchangeFloor).some((exchange) => (
          exchange.request?.binding?.name === 'tldraw_asset_read_chunk'
          && exchange.response?.isError === false
        ))
        : false,
      multipageRecoveryScreenshot,
      resourceLoads: browser.appResourceLoads.slice(resourceLoadStart),
      rendererChunks: browser.rendererChunks.slice(rendererChunkStart),
      screenshot: await screenshot('history-recovered'),
    };
  });

  await checkpoint('Production CSP host locale zh-CN and zh-TW with offline real tldraw UI', async () => {
    const simplifiedChinese = await switchHostLocaleAndAssertTldraw({
      locale: 'zh-CN',
      selectLabel: '选择',
      expectedRevision: savedRevision,
    });
    const traditionalChinese = await switchHostLocaleAndAssertTldraw({
      locale: 'zh-TW',
      selectLabel: '選取',
      expectedRevision: savedRevision,
    });
    const restored = await restoreHostLocale('en', savedRevision);
    return {
      simplifiedChinese,
      traditionalChinese,
      restoredLocale: await browser.evaluate('document.documentElement.lang'),
      restoredRevision: restored.revision ?? null,
    };
  });

  await checkpoint('Pin and App Board fullscreen', async () => {
    // Re-activate the conversation cleanly: earlier locale reloads may have
    // left the App in a virtualized/hidden branch, which disables the Pin
    // action. A direct navigation to the canonical session route re-renders
    // the active message and makes the App interactive again.
    await browser.send('Page.navigate', { url: `${baseUrl}/?session=${encodeURIComponent(sessionId)}` });
    await waitFor(() => browser.evaluate(`document.readyState === 'complete' || document.readyState === 'interactive'`), 'OpenChamber reactivation document', 30_000, 150);
    await selectSession({ navigate: false, requireDirectRoute: true });
    const reactivated = await waitFor(async () => {
      const hasFrame = await browser.evaluate(`Boolean(document.querySelector('iframe[title="tldraw_create_view"]'))`).catch(() => false);
      if (!hasFrame) return false;
      const app = await findApp({ mode: 'inline' }).catch(() => null);
      if (!app || app.revision !== savedRevision) return null;
      const surfaceContract = assessTldrawSurfaceContract(app, {
        expectedRole: 'preview',
        expectedMutationAuthority: 'none',
      });
      const pinEnabled = await findEnabledTldrawPinAction({ expectedRevision: savedRevision }).catch(() => null);
      return surfaceContract.pass && pinEnabled ? app : null;
    }, 'inline App with an enabled Pin action', 40_000, 400);
    const pin = await pinConversationApp(savedRevision);
    await openApplications();
    const board = await boardSnapshot();
    const tile = activeBoard(board)?.tiles.find((candidate) => candidate.tileId === createdTileId);
    assert.equal(tile?.form, 'mcp-app');
    assert.equal(tile?.origin?.sessionId, sessionId);
    const focused = await focusBoardTile();
    const app = assertInteractiveAppState(
      await waitForApp({
        mode: 'fullscreen',
        expectedRevision: savedRevision,
        expectedCanvasId: canvasId,
      }, 'App Board fullscreen same canvas and revision'),
      'App Board fullscreen App',
    );
    assert.equal(app.revision, savedRevision);
    assert.match(app.text, new RegExp(canvasId));
    const boardContract = assessTldrawSurfaceContract(app, {
      expectedRole: 'editor',
      expectedMutationAuthority: 'current-revision',
    });
    assert(boardContract.pass, `App Board fullscreen surface contract failed: ${boardContract.reasons.join('; ')}`);
    return { pin, focused, revision: app.revision, screenshot: await screenshot('app-board-fullscreen') };
  });

  await checkpoint('No MCP App fallback or isError result', async () => {
    const summary = appToolOutcomeSummary();
    assert.equal(summary.isErrorCount, 0, `Captured AppBridge isError results: ${JSON.stringify(summary.isError)}`);
    assert.equal(summary.fallbackCount, 0, `Captured MCP App fallbacks: ${JSON.stringify(summary.fallback)}`);
    return summary;
  });

  const requiredCheckpointOk = deriveRequiredCheckpointOk(checkpoints, REQUIRED_CHECKPOINTS);
  assert.equal(requiredCheckpointOk, true, 'Required checkpoint set did not all execute as actual passes');
  assert.equal(protocol.registry.appOnlyTools.every((entry) => entry.visibility.length === 1 && entry.visibility[0] === 'app'), true);
  assert.equal(browser.runtimeErrors.length, 0, `Browser runtime errors: ${browser.runtimeErrors.join('; ')}`);

  const report = {
    $schema: 'openchamber://tldraw-mcp-app-browser-acceptance/v1',
    generatedAt: new Date().toISOString(),
    runId,
    baseUrl: new URL(baseUrl).origin,
    projectRoot,
    projectId,
    server: serverName,
    model: modelSelector,
    sessionId,
    canvasId,
    createdTileId,
    acceptanceUpload: {
      bytes: acceptancePngBuffer.length,
      sha256: acceptancePngSha256,
      savedSha256: uploadedImageSha256 ?? null,
      featureColors: PATTERNED_PNG_FEATURE_COLORS,
    },
    preserveFailureState,
    checkpoints,
    evidence,
    toolOutcome: appToolOutcomeSummary(),
    requiredCheckpointOk,
    diagnosticLogs: await readDiagnosticLogs(diagnosticLogOffsets),
    browser: {
      runtimeErrors: browser.runtimeErrors,
      consoleErrors: browser.consoleErrors,
      consoleEvents: browser.consoleEvents,
      pageErrors: browser.pageErrors,
      networkRequests: browser.networkRequests,
      appToolExchanges: browser.appToolExchanges,
      appResourceLoads: browser.appResourceLoads,
      rendererChunks: browser.rendererChunks,
      downloadEvents: [...browser.downloads.values()].map(({ guid, suggestedFilename, state, totalBytes, receivedBytes }) => ({
        guid, suggestedFilename, state, totalBytes, receivedBytes,
      })),
    },
    ok: true,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, reportPath: path.relative(projectRoot, reportPath), canvasId, sessionId }, null, 2));
} catch (error) {
  failure = error;
  failureEvidence = await captureFailureEvidence().catch((captureError) => ({
    failureScreenshot: null,
    failureIframeScreenshot: null,
    failureSurfaceState: {
      capturedAt: new Date().toISOString(),
      captureError: serializeError(captureError),
      appContexts: [],
    },
  }));
  const report = {
    $schema: 'openchamber://tldraw-mcp-app-browser-acceptance/v1',
    generatedAt: new Date().toISOString(),
    runId,
    baseUrl: new URL(baseUrl).origin,
    projectRoot,
    projectId,
    server: serverName,
    model: modelSelector,
    sessionId,
    canvasId,
    createdTileId,
    acceptanceUpload: {
      bytes: acceptancePngBuffer.length,
      sha256: acceptancePngSha256,
      savedSha256: uploadedImageSha256 ?? null,
      featureColors: PATTERNED_PNG_FEATURE_COLORS,
    },
    preserveFailureState,
    checkpoints,
    evidence,
    toolOutcome: appToolOutcomeSummary(),
    failureEvidence: {
      ...failureEvidence,
      verdict: assessFailureEvidence(failureEvidence),
    },
    diagnosticLogs: await readDiagnosticLogs(diagnosticLogOffsets),
    failure: serializeError(error),
    browser: browser ? {
      runtimeErrors: browser.runtimeErrors,
      consoleErrors: browser.consoleErrors,
      consoleEvents: browser.consoleEvents,
      pageErrors: browser.pageErrors,
      networkRequests: browser.networkRequests,
      appToolExchanges: browser.appToolExchanges,
      appResourceLoads: browser.appResourceLoads,
      rendererChunks: browser.rendererChunks,
      appContexts: await appContextDiagnostics().catch((error) => ([{ diagnosticError: error.message }])),
    } : null,
    ok: false,
  };
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.error(JSON.stringify({ ok: false, reportPath: path.relative(projectRoot, reportPath), error: error.message }, null, 2));
} finally {
  if (createdTileId && !(failure && preserveFailureState)) {
    try {
      const snapshot = await boardSnapshot();
      const board = activeBoard(snapshot);
      if (board?.tiles.some((tile) => tile.tileId === createdTileId)) {
        await request(`/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles/${encodeURIComponent(createdTileId)}`, {
          method: 'DELETE',
          body: { expectedRevision: board.revision },
        });
      }
    } catch {
      // Preserve the primary failure; the report records the created tile for manual cleanup.
    }
  }
  if (sessionId && !(failure && preserveFailureState)) {
    await request(`/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'PATCH',
      body: { time: { archived: Date.now() } },
    }).catch(() => null);
  }
  if (browser) browser.socket.close();
  if (chromeProcess && chromeProcess.exitCode === null) {
    chromeProcess.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => chromeProcess.once('exit', resolve)), delay(2_000)]);
    if (chromeProcess.exitCode === null) chromeProcess.kill('SIGKILL');
  }
  await fs.rm(chromeDirectory, { recursive: true, force: true });
}

if (failure) throw failure;
