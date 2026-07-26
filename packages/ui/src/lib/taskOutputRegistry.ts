import type { Message, Part, ToolPart } from '@opencode-ai/sdk/v2';

import { extractChangedFiles, FILE_EDIT_TOOLS } from '@/components/chat/changedFiles';
import { toAbsoluteFilePath } from '@/lib/path-utils';

export const TASK_OUTPUT_REGISTRY_SCHEMA = 'openchamber://task-output-registry/v1' as const;

export type TaskOutputRecord = {
  path: string;
  kind: 'generated' | 'attachment';
  tool: string;
  firstSeenAt: number;
  lastSeenAt: number;
  modifications: number;
};

export type TaskOutputRegistry = {
  $schema: typeof TASK_OUTPUT_REGISTRY_SCHEMA;
  initialized: boolean;
  seen: Record<string, string>;
  outputs: TaskOutputRecord[];
};

export const createEmptyTaskOutputRegistry = (): TaskOutputRegistry => ({
  $schema: TASK_OUTPUT_REGISTRY_SCHEMA,
  initialized: false,
  seen: {},
  outputs: [],
});

const partStatus = (part: Part): string => {
  if (part.type !== 'tool') return 'present';
  const status = (part.state as { status?: unknown } | undefined)?.status;
  return typeof status === 'string' ? status : 'unknown';
};

const isAbsolutePath = (value: string): boolean => (
  value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
);

const resolveAttachmentPath = (part: Part, directory: string): string | null => {
  if (part.type !== 'file') return null;
  const record = part as Part & {
    path?: unknown;
    filename?: unknown;
    source?: { path?: unknown };
  };
  const candidate = typeof record.source?.path === 'string'
    ? record.source.path
    : typeof record.path === 'string'
      ? record.path
      : typeof record.filename === 'string'
        ? record.filename
        : '';
  if (!candidate.trim()) return null;
  return isAbsolutePath(candidate) ? candidate : toAbsoluteFilePath(directory, candidate);
};

const mergeOutput = (
  outputs: TaskOutputRecord[],
  next: Omit<TaskOutputRecord, 'firstSeenAt' | 'lastSeenAt' | 'modifications'>,
  now: number,
): TaskOutputRecord[] => {
  const existingIndex = outputs.findIndex((entry) => entry.path === next.path);
  const record = existingIndex >= 0
    ? {
        ...outputs[existingIndex],
        kind: next.kind,
        tool: next.tool,
        lastSeenAt: now,
        modifications: outputs[existingIndex].modifications + 1,
      }
    : {
        ...next,
        firstSeenAt: now,
        lastSeenAt: now,
        modifications: 1,
      };
  const remaining = existingIndex >= 0
    ? outputs.filter((_, index) => index !== existingIndex)
    : outputs;
  return [record, ...remaining].slice(0, 200);
};

export const observeTaskOutputs = (
  registry: TaskOutputRegistry,
  messages: readonly Message[],
  partsByMessage: Record<string, Part[]>,
  directory: string,
  now = Date.now(),
): TaskOutputRegistry => {
  const seen = { ...registry.seen };
  let outputs = registry.outputs;
  const baselineOnly = !registry.initialized;

  for (const message of messages) {
    const parts = partsByMessage[message.id] ?? [];
    for (const part of parts) {
      const previousStatus = seen[part.id];
      const status = partStatus(part);
      seen[part.id] = status;
      if (baselineOnly) continue;

      if (part.type === 'tool') {
        const toolPart = part as ToolPart;
        if (!FILE_EDIT_TOOLS.has(toolPart.tool)
          || status !== 'completed'
          || previousStatus === 'completed') {
          continue;
        }
        for (const file of extractChangedFiles([toolPart])) {
          if (!file.path || file.path === 'Diff') continue;
          const absolutePath = isAbsolutePath(file.path)
            ? file.path
            : toAbsoluteFilePath(directory, file.path);
          outputs = mergeOutput(outputs, {
            path: absolutePath,
            kind: 'generated',
            tool: toolPart.tool,
          }, now);
        }
        continue;
      }

      if (message.role === 'user' && previousStatus === undefined) {
        const attachmentPath = resolveAttachmentPath(part, directory);
        if (attachmentPath) {
          outputs = mergeOutput(outputs, {
            path: attachmentPath,
            kind: 'attachment',
            tool: 'attachment',
          }, now);
        }
      }
    }
  }

  const boundedSeenEntries = Object.entries(seen).slice(-2_000);
  return {
    $schema: TASK_OUTPUT_REGISTRY_SCHEMA,
    initialized: true,
    seen: Object.fromEntries(boundedSeenEntries),
    outputs,
  };
};

export const parseTaskOutputRegistry = (value: unknown): TaskOutputRegistry => {
  if (!value || typeof value !== 'object') return createEmptyTaskOutputRegistry();
  const record = value as Partial<TaskOutputRegistry>;
  if (record.$schema !== TASK_OUTPUT_REGISTRY_SCHEMA
    || typeof record.initialized !== 'boolean'
    || !record.seen
    || typeof record.seen !== 'object'
    || !Array.isArray(record.outputs)) {
    return createEmptyTaskOutputRegistry();
  }
  const outputs = record.outputs.filter((entry): entry is TaskOutputRecord => (
    !!entry
    && typeof entry.path === 'string'
    && (entry.kind === 'generated' || entry.kind === 'attachment')
    && typeof entry.tool === 'string'
    && typeof entry.firstSeenAt === 'number'
    && typeof entry.lastSeenAt === 'number'
    && typeof entry.modifications === 'number'
  )).slice(0, 200);
  return {
    $schema: TASK_OUTPUT_REGISTRY_SCHEMA,
    initialized: true,
    seen: Object.fromEntries(
      Object.entries(record.seen)
        .filter(([key, status]) => key && typeof status === 'string')
        .slice(-2_000),
    ),
    outputs,
  };
};
