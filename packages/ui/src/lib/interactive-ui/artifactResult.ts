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

const isValidDateTime = (value: string): boolean => (
  value.length <= 64 && Number.isFinite(Date.parse(value))
);

export const parseHTMLArtifactResultEnvelope = (output: string): HTMLArtifactResultEnvelope | null => {
  const candidate = output.trim();
  if (!candidate || byteLength(candidate) > HTML_ARTIFACT_MAX_ENVELOPE_BYTES) return null;

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
