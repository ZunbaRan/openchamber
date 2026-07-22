import type { InteractiveResultMode } from './types';

export const INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA = 'openchamber://installed-html-artifact-result/v1' as const;
export const INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES = 64 * 1024;

export interface InstalledHTMLArtifactResultEnvelope {
  $schema: typeof INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA;
  schemaVersion: 1;
  artifact: string;
  mode: InteractiveResultMode;
  summary?: string;
  context?: unknown;
  updatedAt?: string;
}

const TOP_LEVEL_KEYS = new Set(['$schema', 'schemaVersion', 'artifact', 'mode', 'summary', 'context', 'updatedAt']);
const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const parseInstalledHTMLArtifactResultEnvelope = (
  output: string,
): InstalledHTMLArtifactResultEnvelope | null => {
  const candidate = output.trim();
  if (!candidate || byteLength(candidate) > INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !Object.keys(parsed).every((key) => TOP_LEVEL_KEYS.has(key))) return null;
  if (parsed.$schema !== INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA || parsed.schemaVersion !== 1) return null;
  if (typeof parsed.artifact !== 'string' || parsed.artifact.length > 200 || !ARTIFACT_ID_PATTERN.test(parsed.artifact)) return null;
  if (parsed.mode !== 'snapshot' && parsed.mode !== 'live') return null;
  if (parsed.summary !== undefined && (typeof parsed.summary !== 'string' || parsed.summary.length > 500)) return null;
  if (parsed.updatedAt !== undefined && (
    typeof parsed.updatedAt !== 'string'
    || parsed.updatedAt.length > 64
    || !Number.isFinite(Date.parse(parsed.updatedAt))
  )) return null;

  return {
    $schema: INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
    schemaVersion: 1,
    artifact: parsed.artifact,
    mode: parsed.mode,
    ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
    ...(parsed.context !== undefined ? { context: parsed.context } : {}),
    ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
  };
};
