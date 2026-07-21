import { getRuntimeKey } from '@/lib/runtime-switch';
import type { InteractiveUIRoutingContext } from './routing';

const MAX_TRACES = 50;
const MAX_TRACE_AGE_MS = 30 * 60 * 1000;

export type RoutingTraceStatus =
  | 'awaiting-tool'
  | 'send-failed'
  | 'tool-running'
  | 'tool-completed'
  | 'tool-failed'
  | 'view-loading'
  | 'view-rendered'
  | 'view-failed'
  | 'artifact-materializing'
  | 'artifact-rendered'
  | 'artifact-failed';

export type RoutingSelectionReason =
  | 'explicit-tool'
  | 'installed-business-tool'
  | 'installed-specialized-tool'
  | 'generic-interactive-ui'
  | 'generic-html-artifact';

export interface RoutingTraceCandidate {
  extensionId: string;
  domain: string;
  tool: string;
  intents: string[];
  priority: number;
  operation: 'read' | 'write' | 'mixed';
  dataAuthority: string;
  connection: 'not-required' | 'configured' | 'unconfigured' | 'expired';
  explicitlyNamed: boolean;
}

export interface RoutingTraceSelection {
  tool: string;
  toolPartId: string;
  reason: RoutingSelectionReason;
  viewId?: string;
}

export interface RoutingInspectionTrace {
  id: string;
  runtimeKey: string;
  sessionId: string;
  messageId: string;
  createdAt: number;
  revision?: string;
  systemInjected: boolean;
  skippedExtensions: number;
  candidates: RoutingTraceCandidate[];
  status: RoutingTraceStatus;
  selection?: RoutingTraceSelection;
}

let snapshot: readonly RoutingInspectionTrace[] = [];
const subscribers = new Set<() => void>();

const publish = (next: readonly RoutingInspectionTrace[]) => {
  snapshot = next;
  for (const subscriber of subscribers) subscriber();
};

const containsToolName = (text: string, tool: string): boolean => {
  if (!text || !tool) return false;
  const lower = text.toLowerCase();
  const target = tool.toLowerCase();
  let offset = lower.indexOf(target);
  while (offset >= 0) {
    const before = offset === 0 ? '' : lower[offset - 1] ?? '';
    const after = lower[offset + target.length] ?? '';
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    offset = lower.indexOf(target, offset + target.length);
  }
  return false;
};

const flattenCandidates = (context: InteractiveUIRoutingContext | undefined, text: string): RoutingTraceCandidate[] => (
  (context?.extensions ?? []).flatMap((extension) => extension.tools.map((tool) => ({
    extensionId: extension.id,
    domain: extension.domain,
    tool: tool.name,
    intents: tool.intents,
    priority: tool.priority,
    operation: tool.operation,
    dataAuthority: tool.dataAuthority,
    connection: extension.connection.status,
    explicitlyNamed: containsToolName(text, tool.name),
  }))).sort((left, right) => right.priority - left.priority || left.tool.localeCompare(right.tool))
);

const prune = (items: readonly RoutingInspectionTrace[], now: number): RoutingInspectionTrace[] => (
  items.filter((trace) => now - trace.createdAt <= MAX_TRACE_AGE_MS).slice(0, MAX_TRACES)
);

export const recordRoutingDispatch = (input: {
  sessionId: string;
  messageId: string;
  context?: InteractiveUIRoutingContext;
  text?: string;
}): void => {
  const runtimeKey = input.context?.runtimeKey ?? getRuntimeKey();
  const now = Date.now();
  const trace: RoutingInspectionTrace = {
    id: `${runtimeKey}:${input.sessionId}:${input.messageId}`,
    runtimeKey,
    sessionId: input.sessionId,
    messageId: input.messageId,
    createdAt: now,
    ...(input.context?.revision ? { revision: input.context.revision } : {}),
    systemInjected: Boolean(input.context?.system),
    skippedExtensions: input.context?.skippedExtensions ?? 0,
    candidates: flattenCandidates(input.context, input.text ?? ''),
    status: 'awaiting-tool',
  };
  publish(prune([trace, ...snapshot.filter((current) => current.id !== trace.id)], now));
};

const updateLatestSessionTrace = (
  sessionId: string,
  update: (trace: RoutingInspectionTrace) => RoutingInspectionTrace | null,
): void => {
  const index = snapshot.findIndex((trace) => trace.sessionId === sessionId && trace.runtimeKey === getRuntimeKey());
  if (index < 0) return;
  const nextTrace = update(snapshot[index]);
  if (!nextTrace || nextTrace === snapshot[index]) return;
  const next = [...snapshot];
  next[index] = nextTrace;
  publish(next);
};

export const recordRoutingDispatchFailure = (sessionId: string, messageId: string): void => {
  updateLatestSessionTrace(sessionId, (trace) => (
    trace.messageId === messageId ? { ...trace, status: 'send-failed' } : trace
  ));
};

const selectionReason = (
  candidate: RoutingTraceCandidate | undefined,
  normalizedTool: string,
): RoutingSelectionReason => {
  if (candidate?.explicitlyNamed) return 'explicit-tool';
  if (candidate?.dataAuthority === 'connected-business-system') return 'installed-business-tool';
  if (candidate) return 'installed-specialized-tool';
  if (normalizedTool === 'interactive_ui') return 'generic-interactive-ui';
  if (normalizedTool === 'html_artifact') return 'generic-html-artifact';
  return 'installed-specialized-tool';
};

export const recordRoutingToolObservation = (input: {
  sessionId?: string;
  toolPartId: string;
  tool: string;
  status?: string;
  viewId?: string;
}): void => {
  if (!input.sessionId) return;
  const normalizedTool = input.tool.trim().toLowerCase();
  updateLatestSessionTrace(input.sessionId, (trace) => {
    const candidate = trace.candidates.find((entry) => entry.tool.toLowerCase() === normalizedTool);
    if (!candidate && normalizedTool !== 'interactive_ui' && normalizedTool !== 'html_artifact') return null;
    const status = input.status === 'error' || input.status === 'failed'
      ? 'tool-failed'
      : input.status === 'completed'
        ? 'tool-completed'
        : 'tool-running';
    const selection: RoutingTraceSelection = {
      tool: input.tool,
      toolPartId: input.toolPartId,
      reason: selectionReason(candidate, normalizedTool),
      ...(input.viewId ? { viewId: input.viewId } : {}),
    };
    if (trace.status === status
      && trace.selection?.toolPartId === selection.toolPartId
      && trace.selection?.viewId === selection.viewId) return trace;
    return { ...trace, status, selection };
  });
};

export const recordRoutingArtifactObservation = (input: {
  sessionId?: string;
  toolPartId: string;
  status: 'materializing' | 'rendered' | 'failed';
}): void => {
  if (!input.sessionId) return;
  updateLatestSessionTrace(input.sessionId, (trace) => {
    if (trace.selection?.toolPartId !== input.toolPartId || trace.selection.tool.toLowerCase() !== 'html_artifact') return null;
    const status = input.status === 'materializing'
      ? 'artifact-materializing'
      : input.status === 'rendered'
        ? 'artifact-rendered'
        : 'artifact-failed';
    return trace.status === status ? trace : { ...trace, status };
  });
};

export const recordRoutingViewObservation = (input: {
  sessionId?: string;
  toolPartId: string;
  viewId: string;
  status: 'loading' | 'rendered' | 'failed';
}): void => {
  if (!input.sessionId) return;
  updateLatestSessionTrace(input.sessionId, (trace) => {
    if (trace.selection?.toolPartId !== input.toolPartId) return null;
    const status = input.status === 'loading'
      ? 'view-loading'
      : input.status === 'rendered'
        ? 'view-rendered'
        : 'view-failed';
    if (trace.status === status && trace.selection.viewId === input.viewId) return trace;
    return {
      ...trace,
      status,
      selection: { ...trace.selection, viewId: input.viewId },
    };
  });
};

export const subscribeRoutingInspection = (subscriber: () => void): (() => void) => {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};

export const getRoutingInspectionSnapshot = (): readonly RoutingInspectionTrace[] => snapshot;

export const clearRoutingInspectionTraces = (): void => publish([]);

const shortRef = (value: string): string => value.length <= 12 ? value : value.slice(-12);

export const buildRoutingDiagnosticsReport = (): string => JSON.stringify({
  schema: 'openchamber://routing-diagnostics/v1',
  generatedAt: new Date().toISOString(),
  privacy: 'No prompt text, model reasoning, connector URL, credential, token, or business response is retained.',
  traces: snapshot.map((trace) => ({
    sessionRef: shortRef(trace.sessionId),
    messageRef: shortRef(trace.messageId),
    createdAt: new Date(trace.createdAt).toISOString(),
    revision: trace.revision,
    systemInjected: trace.systemInjected,
    skippedExtensions: trace.skippedExtensions,
    status: trace.status,
    candidates: trace.candidates,
    selection: trace.selection,
  })),
}, null, 2);

export const resetRoutingInspectorForTests = (): void => {
  snapshot = [];
  subscribers.clear();
};
