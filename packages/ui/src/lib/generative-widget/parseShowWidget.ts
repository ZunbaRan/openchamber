/**
 * Parse CodePilot/Claude-style `show-widget` fences from assistant text.
 * Reimplemented for OpenChamber Generative Widget (not a CodePilot product dependency).
 */

export interface ShowWidgetData {
  title?: string;
  widget_code: string;
}

const toShowWidgetData = (value: unknown): ShowWidgetData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.widget_code !== 'string' || candidate.widget_code.length === 0) return null;
  if (candidate.title !== undefined && typeof candidate.title !== 'string') return null;
  return {
    title: candidate.title || undefined,
    widget_code: candidate.widget_code,
  };
};

// Fails closed on oversized raw input before any expensive regex/JSON work.
// Mirrors the established bounded early-exit P0 precedent (interactive-result
// envelope): counts UTF-8 bytes (not UTF-16 code units) and aborts as soon as
// the running count exceeds MAX_SHOW_WIDGET_BYTES, so an arbitrarily oversized
// streaming message cannot drive repeated global-regex scans / O(n) JSON
// scanning / full-string parsing on every chunk. Lone surrogates count as the
// 3-byte U+FFFD replacement char, mirroring TextEncoder, and never throw.
const MAX_SHOW_WIDGET_BYTES = 1024 * 1024;

const exceedsShowWidgetByteLimit = (value: string): boolean => {
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
    if (bytes > MAX_SHOW_WIDGET_BYTES) return true;
  }
  return false;
};

/** True when assistant text may contain a show-widget fence.
 *  Fails closed (false) on oversized raw input before applying the regex,
 *  so real render paths that gate on this first cannot scan arbitrary text. */
export const textContainsShowWidget = (text: string): boolean => {
  if (exceedsShowWidgetByteLimit(text)) return false;
  return /`{1,3}show-widget/.test(text);
};

export function parseShowWidget(text: string): { beforeText: string; widget: ShowWidgetData; afterText: string } | null {
  const segments = parseAllShowWidgets(text);
  if (segments.length === 0) return null;
  // Legacy compat: return first widget match
  let beforeText = '';
  let widget: ShowWidgetData | null = null;
  const afterParts: string[] = [];
  let foundWidget = false;
  for (const seg of segments) {
    if (!foundWidget) {
      if (seg.type === 'text') { beforeText = seg.content; }
      else if (seg.type === 'widget') { widget = seg.data; foundWidget = true; }
      // Legacy parseShowWidget returns only the first SUCCESSFUL
      // widget — malformed_widget segments are skipped here. The
      // multi-segment renderer (parseAllShowWidgets caller) still
      // shows the error block; this legacy wrapper exists for older
      // call sites that only care about the happy path.
    } else {
      if (seg.type === 'text') afterParts.push(seg.content);
      else afterParts.push(''); // subsequent widgets / malformed handled by parseAllShowWidgets
    }
  }
  if (!widget) return null;
  return { beforeText, widget, afterText: afterParts.join('\n') };
}

export type WidgetSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; data: ShowWidgetData }
  /**
   * Phase 5c slice 6 (2026-05-16, post-smoke) — emitted when a
   * `show-widget` marker is in the text but the body cannot be
   * parsed into the JSON-wrapper wire format (raw HTML / invalid
   * JSON / missing `widget_code`). Pre-fix all three failure modes
   * were dropped silently and the chat appeared to have "no widget"
   * even though the model produced something. The UI now renders
   * a visible error block so the user can ask the model to fix it.
   *
   * `reason` is a short human-readable summary of WHICH failure
   * mode triggered. `raw` is the original fence body (truncated to
   * 2 KB) so the user can read it inline without hunting through
   * the transcript.
   */
  | { type: 'malformed_widget'; reason: string; raw: string };

/**
 * Fence-format-agnostic widget parser.
 *
 * Models produce many fence variants (```show-widget, `show-widget`, `show-widget\n...\n`, etc.).
 * Instead of normalizing each variant, we directly scan for "show-widget" markers followed by
 * JSON containing "widget_code", regardless of surrounding backtick syntax.
 */

/** Find the end of a JSON object starting at `{`, accounting for nested braces and strings. */
function findJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1; // unclosed
}

/** Cap raw fence body before surfacing in a malformed-widget UI segment.
 *  2 KB is enough to recognise what the model produced without
 *  bloating the persisted message JSON if the broken fence was huge. */
function clipMalformedRaw(raw: string): string {
  const MAX = 2048;
  if (raw.length <= MAX) return raw;
  return raw.slice(0, MAX) + '\n[…truncated…]';
}

/** Parse ALL show-widget blocks in text, returning alternating text/widget segments.
 *
 *  Three failure modes used to drop silently — Phase 5c slice 6
 *  surfaces each as a `malformed_widget` segment so the user knows
 *  the model tried to make a widget and can ask it to retry:
 *
 *    a) marker present but no JSON within 20 chars (the smoke S4
 *       failure mode: model wrote a raw HTML fence body)
 *    b) JSON parses successfully but is missing `widget_code`
 *    c) malformed/unparseable JSON inside the fence
 */
export function parseAllShowWidgets(text: string): WidgetSegment[] {
  // Fails closed on oversized input before any expensive trim/regex/parse.
  if (exceedsShowWidgetByteLimit(text)) return [];
  const segments: WidgetSegment[] = [];
  // Match any backtick(s) + show-widget, capturing the full marker to strip it
  const markerRegex = /`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let foundAny = false;

  /** Push the text slice between the last consumed position and this
   *  marker, if non-empty. Both the success and the malformed branches
   *  use this so the preceding prose still renders. */
  const flushBeforeText = (markerStart: number) => {
    const before = text.slice(lastIndex, markerStart).trim();
    if (before) segments.push({ type: 'text', content: before });
  };

  while ((match = markerRegex.exec(text)) !== null) {
    const afterMarker = match.index + match[0].length;
    // Find the JSON object start
    const jsonStart = text.indexOf('{', afterMarker);
    if (jsonStart === -1 || jsonStart > afterMarker + 20) {
      // (a) No JSON nearby — surface as malformed_widget so the
      // user sees the broken fence instead of the chat looking
      // empty. The smoke S4 failure ended here.
      const fenceClose = text.indexOf('```', afterMarker);
      const bodyEnd = fenceClose !== -1 && fenceClose < afterMarker + 4096
        ? fenceClose
        : Math.min(text.length, afterMarker + 4096);
      const raw = text.slice(afterMarker, bodyEnd).trim();
      foundAny = true;
      flushBeforeText(match.index);
      segments.push({
        type: 'malformed_widget',
        reason: 'No JSON wrapper found inside `show-widget` fence — the body looked like raw HTML / SVG. Widgets must be wrapped as `{"title":"…","widget_code":"…"}` so the runtime can sandbox them.',
        raw: clipMalformedRaw(raw),
      });
      if (fenceClose !== -1) {
        lastIndex = fenceClose + 3;
        markerRegex.lastIndex = fenceClose + 3;
      } else {
        lastIndex = bodyEnd;
        markerRegex.lastIndex = bodyEnd;
      }
      continue;
    }

    const jsonEnd = findJsonEnd(text, jsonStart);
    if (jsonEnd === -1) {
      // Truncated JSON — try extracting partial widget
      const partialBody = text.slice(jsonStart);
      const widget = extractTruncatedWidget(partialBody);
      if (widget) {
        foundAny = true;
        flushBeforeText(match.index);
        segments.push({ type: 'widget', data: widget });
        lastIndex = text.length;
      }
      break;
    }

    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      const json = JSON.parse(jsonStr);
      const widget = toShowWidgetData(json);
      if (widget) {
        foundAny = true;
        flushBeforeText(match.index);
        segments.push({ type: 'widget', data: widget });
        // Skip past the JSON and any trailing fence/backticks
        let endPos = jsonEnd + 1;
        const trailing = text.slice(endPos, endPos + 10);
        const trailingFence = trailing.match(/^\s*\n?`{1,3}\s*/);
        if (trailingFence) endPos += trailingFence[0].length;
        lastIndex = endPos;
        markerRegex.lastIndex = endPos;
      } else {
        // (b) JSON parsed but missing `widget_code` — surface as
        // malformed_widget. Pre-fix this fell through to the
        // implicit "no segment pushed" path; the user saw nothing.
        const fenceClose = text.indexOf('```', jsonEnd + 1);
        const bodyEnd = fenceClose !== -1 ? fenceClose : text.length;
        foundAny = true;
        flushBeforeText(match.index);
        segments.push({
          type: 'malformed_widget',
          reason: 'The `show-widget` JSON did not match the required string contract. The minimal shape is `{"title":"…","widget_code":"<escaped HTML>"}`; `title` is optional but must be a string.',
          raw: clipMalformedRaw(text.slice(afterMarker, bodyEnd).trim()),
        });
        lastIndex = fenceClose !== -1 ? fenceClose + 3 : text.length;
        markerRegex.lastIndex = lastIndex;
      }
    } catch (parseErr) {
      // (c) Malformed JSON — surface as malformed_widget instead of
      // skipping. `parseErr` carries the position so the message
      // can hint at the issue (escape sequence, trailing comma, etc.).
      const fenceClose = text.indexOf('```', jsonStart);
      const bodyEnd = fenceClose !== -1 ? fenceClose : text.length;
      foundAny = true;
      flushBeforeText(match.index);
      const errText = parseErr instanceof Error ? parseErr.message : String(parseErr);
      segments.push({
        type: 'malformed_widget',
        reason: `The \`show-widget\` JSON failed to parse: ${errText}. Common causes: unescaped quotes inside \`widget_code\`, unescaped newlines, trailing commas.`,
        raw: clipMalformedRaw(text.slice(afterMarker, bodyEnd).trim()),
      });
      lastIndex = fenceClose !== -1 ? fenceClose + 3 : text.length;
      markerRegex.lastIndex = lastIndex;
    }
  }

  if (!foundAny) return [];

  // Remaining text after last widget
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    segments.push({ type: 'text', content: remaining });
  }

  return segments;
}

/**
 * Compute the React key for a partial (still-streaming) widget so that it
 * matches the key it will receive once its fence closes and the full content
 * is parsed by parseAllShowWidgets → `.map((seg, i) => key={`w-${i}`})`.
 *
 * If these keys ever diverge, React will unmount + remount the WidgetRenderer
 * → iframe destroyed → height collapse → scroll jump (P2 regression).
 */
export function computePartialWidgetKey(content: string): string {
  // This entry point is called independently by streaming renderers; it must
  // enforce the same raw byte bound before matchAll materializes every marker.
  if (exceedsShowWidgetByteLimit(content)) return 'w-0';
  const markers = [...content.matchAll(/`{1,3}show-widget/g)];
  if (markers.length === 0) return 'w-0';
  const lastMarker = markers[markers.length - 1];
  const beforePart = content.slice(0, lastMarker.index).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
  return `w-${hasCompletedFences ? completedSegments.length : (beforePart ? 1 : 0)}`;
}

/** Decode a JSON string body (content between quotes, escapes intact). */
function decodeJsonStringContent(raw: string): string | null {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    // Incomplete trailing escape (truncated stream) — drop the dangling
    // backslash so the already-decoded prefix remains usable.
    if (raw.endsWith('\\') && !raw.endsWith('\\\\')) {
      try {
        return JSON.parse(`"${raw.slice(0, -1)}"`) as string;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Read a JSON string value starting at the opening quote. Stops at the first
 * unescaped closing quote, or at EOF when the stream is still open. Never
 * includes trailing JSON (`, "title":…`) that follows a closed string.
 */
function readJsonStringAt(body: string, openQuoteIdx: number): { value: string; closed: boolean; end: number } | null {
  if (body[openQuoteIdx] !== '"') return null;
  let escaped = false;
  for (let i = openQuoteIdx + 1; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      const decoded = decodeJsonStringContent(body.slice(openQuoteIdx + 1, i));
      if (decoded === null) return null;
      return { value: decoded, closed: true, end: i + 1 };
    }
  }
  // Still-open string (streaming): decode the prefix that is present.
  const openRaw = body.slice(openQuoteIdx + 1);
  const decoded = decodeJsonStringContent(openRaw);
  if (decoded === null) return null;
  return { value: decoded, closed: false, end: body.length };
}

const skipWs = (body: string, start: number): number => {
  let i = start;
  while (i < body.length && /\s/.test(body[i])) i += 1;
  return i;
};

/** Locate `"key"\s*:` and return the index of the first non-ws char of the value. */
function findJsonFieldValueStart(body: string, key: string): number {
  const pattern = `"${key}"`;
  let from = 0;
  while (from < body.length) {
    const keyIdx = body.indexOf(pattern, from);
    if (keyIdx === -1) return -1;
    // Require the key to look like a JSON property name (quote is already in pattern).
    let i = skipWs(body, keyIdx + pattern.length);
    if (body[i] !== ':') {
      from = keyIdx + 1;
      continue;
    }
    return skipWs(body, i + 1);
  }
  return -1;
}

/**
 * Observe a fully-closed non-string JSON value starting at `start`. Returns
 * true when a complete number/bool/null (or a complete object/array that is
 * already balanced) is present — used to fail closed on bad `title` types
 * even when the overall document is still truncated.
 */
function isCompleteNonStringJsonValue(body: string, start: number): boolean {
  if (start >= body.length) return false;
  const ch = body[start];
  if (ch === '"') return false;
  if (ch === '{' || ch === '[') {
    const end = findJsonEnd(body, start);
    return end !== -1;
  }
  if (ch === 't') return body.startsWith('true', start);
  if (ch === 'f') return body.startsWith('false', start);
  if (ch === 'n') return body.startsWith('null', start);
  if (ch === '-' || (ch >= '0' && ch <= '9')) {
    let i = start + 1;
    while (i < body.length && /[0-9.eE+-]/.test(body[i])) i += 1;
    // A number is complete only when it is followed by a structural char or EOF
    // that is not another numeric continuation (already consumed).
    if (i === start + 1 && ch === '-') return false;
    const rest = body[i];
    return rest === undefined || /[\s,}\]]/.test(rest);
  }
  return false;
}

/** Extract widget_code from truncated/incomplete JSON (no closing fence). */
function extractTruncatedWidget(fenceBody: string): ShowWidgetData | null {
  // Try full JSON parse first
  try {
    const json = JSON.parse(fenceBody);
    const widget = toShowWidgetData(json);
    if (widget) return widget;
  } catch { /* expected — JSON is truncated */ }

  // Fail closed when a completed non-string `title` is already observable
  // (e.g. `"title":123,...`) — same contract as finalized parse.
  let closedTitle: string | undefined;
  const titleValueStart = findJsonFieldValueStart(fenceBody, 'title');
  if (titleValueStart !== -1) {
    if (fenceBody[titleValueStart] === '"') {
      const titleString = readJsonStringAt(fenceBody, titleValueStart);
      if (titleString === null) return null;
      // Incomplete title string: omit title, still allow widget_code emission.
      // Closed title string: include it once widget_code is valid.
      if (titleString.closed) closedTitle = titleString.value || undefined;
    } else if (isCompleteNonStringJsonValue(fenceBody, titleValueStart)) {
      return null;
    }
  }

  const codeValueStart = findJsonFieldValueStart(fenceBody, 'widget_code');
  if (codeValueStart === -1 || fenceBody[codeValueStart] !== '"') return null;
  const codeString = readJsonStringAt(fenceBody, codeValueStart);
  if (!codeString || codeString.value.length < 10) return null;

  return {
    ...(closedTitle !== undefined ? { title: closedTitle } : {}),
    widget_code: codeString.value,
  };
}
