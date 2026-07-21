import {
  INTERACTIVE_RESULT_SCHEMA,
  type InteractiveDataRef,
  type InteractiveResultEnvelope,
} from './types';

const MAX_ENVELOPE_BYTES = 1024 * 1024;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseDataRef = (value: unknown): InteractiveDataRef | undefined => {
  if (!isRecord(value)) return undefined;
  if (typeof value.connector !== 'string' || !value.connector.trim()) return undefined;
  if (typeof value.resource !== 'string' || !value.resource.trim()) return undefined;
  if (value.revision !== undefined && typeof value.revision !== 'string') return undefined;
  return {
    connector: value.connector.trim(),
    resource: value.resource.trim(),
    ...(typeof value.revision === 'string' ? { revision: value.revision } : {}),
  };
};

export const parseInteractiveResultEnvelope = (output: string): InteractiveResultEnvelope | null => {
  const candidate = output.trim();
  if (!candidate || candidate.length > MAX_ENVELOPE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.$schema !== INTERACTIVE_RESULT_SCHEMA) return null;
  if (parsed.schemaVersion !== 1) return null;
  if (parsed.mode !== 'snapshot' && parsed.mode !== 'live') return null;
  if (typeof parsed.view !== 'string' || !ID_PATTERN.test(parsed.view)) return null;
  if (parsed.summary !== undefined && typeof parsed.summary !== 'string') return null;
  if (parsed.updatedAt !== undefined && typeof parsed.updatedAt !== 'string') return null;

  const dataRef = parseDataRef(parsed.dataRef);
  if (parsed.dataRef !== undefined && !dataRef) return null;

  return {
    $schema: INTERACTIVE_RESULT_SCHEMA,
    view: parsed.view,
    schemaVersion: 1,
    mode: parsed.mode,
    ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
    ...(parsed.context !== undefined ? { context: parsed.context } : {}),
    ...(parsed.data !== undefined ? { data: parsed.data } : {}),
    ...(dataRef ? { dataRef } : {}),
    ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
  };
};
