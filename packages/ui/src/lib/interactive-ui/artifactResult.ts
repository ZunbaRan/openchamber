export const HTML_ARTIFACT_RESULT_SCHEMA = 'openchamber://html-artifact-result/v1' as const;
export const HTML_ARTIFACT_MAX_ENVELOPE_BYTES = 256 * 1024;
export const HTML_ARTIFACT_MAX_HTML_BYTES = 192 * 1024;

export type HTMLArtifactDisplayMode = 'inline' | 'workspace' | 'fullscreen';

export interface HTMLArtifactResultEnvelope {
  $schema: typeof HTML_ARTIFACT_RESULT_SCHEMA;
  schemaVersion: 1;
  title: string;
  summary?: string;
  html: string;
  capabilities: {
    scripts: boolean;
  };
  display: {
    preferred: HTMLArtifactDisplayMode;
    allowExpand: boolean;
    inlineHeight: number;
  };
  updatedAt?: string;
}

const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'title',
  'summary',
  'html',
  'capabilities',
  'display',
  'updatedAt',
]);
const CAPABILITY_KEYS = new Set(['scripts']);
const DISPLAY_KEYS = new Set(['preferred', 'allowExpand', 'inlineHeight']);
const DISPLAY_MODES = new Set<HTMLArtifactDisplayMode>(['inline', 'workspace', 'fullscreen']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: Set<string>): boolean => (
  Object.keys(value).every((key) => allowed.has(key))
);

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

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

const isValidDateTime = (value: string): boolean => (
  value.length <= 64 && Number.isFinite(Date.parse(value))
);

export const parseHTMLArtifactResultEnvelope = (output: string): HTMLArtifactResultEnvelope | null => {
  if (exceedsEnvelopeByteLimit(output, HTML_ARTIFACT_MAX_ENVELOPE_BYTES)) return null;
  const candidate = output.trim();
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !hasOnlyKeys(parsed, TOP_LEVEL_KEYS)) return null;
  if (parsed.$schema !== HTML_ARTIFACT_RESULT_SCHEMA || parsed.schemaVersion !== 1) return null;
  if (typeof parsed.title !== 'string' || !parsed.title.trim() || parsed.title.length > 120) return null;
  if (parsed.summary !== undefined && (typeof parsed.summary !== 'string' || parsed.summary.length > 500)) return null;
  if (typeof parsed.html !== 'string' || !parsed.html.trim() || byteLength(parsed.html) > HTML_ARTIFACT_MAX_HTML_BYTES) return null;
  if (parsed.updatedAt !== undefined && (typeof parsed.updatedAt !== 'string' || !isValidDateTime(parsed.updatedAt))) return null;

  if (!isRecord(parsed.capabilities) || !hasOnlyKeys(parsed.capabilities, CAPABILITY_KEYS)) return null;
  if (typeof parsed.capabilities.scripts !== 'boolean') return null;

  if (!isRecord(parsed.display) || !hasOnlyKeys(parsed.display, DISPLAY_KEYS)) return null;
  if (typeof parsed.display.preferred !== 'string' || !DISPLAY_MODES.has(parsed.display.preferred as HTMLArtifactDisplayMode)) return null;
  if (typeof parsed.display.allowExpand !== 'boolean') return null;
  if (!Number.isInteger(parsed.display.inlineHeight) || Number(parsed.display.inlineHeight) < 120 || Number(parsed.display.inlineHeight) > 900) return null;

  return {
    $schema: HTML_ARTIFACT_RESULT_SCHEMA,
    schemaVersion: 1,
    title: parsed.title.trim(),
    ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
    html: parsed.html,
    capabilities: { scripts: parsed.capabilities.scripts },
    display: {
      preferred: parsed.display.preferred as HTMLArtifactDisplayMode,
      allowExpand: parsed.display.allowExpand,
      inlineHeight: Number(parsed.display.inlineHeight),
    },
    ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
  };
};
