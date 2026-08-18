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

// Counts UTF-8 bytes (not UTF-16 code units) of the raw output and returns true
// as soon as the running count strictly exceeds `limit`, so an arbitrarily
// oversized untrusted input is rejected without scanning or allocating the rest
// of it. It runs on the raw output before any trim/parse, so leading/trailing
// whitespace cannot hide an oversized payload. Lone surrogates are counted as a
// 3-byte U+FFFD replacement, mirroring TextEncoder, and never throw.
const exceedsEnvelopeByteLimit = (value: string, limit: number): boolean => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 3;
    } else {
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
};

export const parseInstalledHTMLArtifactResultEnvelope = (
  output: string,
): InstalledHTMLArtifactResultEnvelope | null => {
  if (exceedsEnvelopeByteLimit(output, INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES)) return null;
  const candidate = output.trim();
  if (!candidate) return null;

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
