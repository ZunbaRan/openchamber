// ---- MessageItem.tsx lines 183-422 ----
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
      if (json.widget_code) {
        foundAny = true;
        flushBeforeText(match.index);
        segments.push({ type: 'widget', data: { title: json.title || undefined, widget_code: String(json.widget_code) } });
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
          reason: 'The `show-widget` JSON parsed but did not include a `widget_code` field. The minimal shape is `{"title":"…","widget_code":"<escaped HTML>"}`.',
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
  const markers = [...content.matchAll(/`{1,3}show-widget/g)];
  if (markers.length === 0) return 'w-0';
  const lastMarker = markers[markers.length - 1];
  const beforePart = content.slice(0, lastMarker.index).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
  return `w-${hasCompletedFences ? completedSegments.length : (beforePart ? 1 : 0)}`;
}

/** Extract widget_code from truncated/incomplete JSON (no closing fence). */
function extractTruncatedWidget(fenceBody: string): ShowWidgetData | null {
  // Try full JSON parse first
  try {
    const json = JSON.parse(fenceBody);
    if (json.widget_code) return { title: json.title || undefined, widget_code: String(json.widget_code) };
  } catch { /* expected — JSON is truncated */ }

  // String-search extraction
  const keyIdx = fenceBody.indexOf('"widget_code"');
  if (keyIdx === -1) return null;
  const colonIdx = fenceBody.indexOf(':', keyIdx + 13);
  if (colonIdx === -1) return null;
  const quoteIdx = fenceBody.indexOf('"', colonIdx + 1);
  if (quoteIdx === -1) return null;

  let raw = fenceBody.slice(quoteIdx + 1);
  raw = raw.replace(/"\s*\}\s*$/, '');
  if (raw.endsWith('\\')) raw = raw.slice(0, -1);
  try {
    const widgetCode = raw
      .replace(/\\\\/g, '\x00BACKSLASH\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\x00BACKSLASH\x00/g, '\\');
    if (widgetCode.length < 10) return null;

    let title: string | undefined;
    const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
    if (titleMatch) title = titleMatch[1];
    return { title, widget_code: widgetCode };
  } catch {
    return null;
  }
}

// ---- MessageItem.tsx lines 367-383 ----
/**
 * Compute the React key for a partial (still-streaming) widget so that it
 * matches the key it will receive once its fence closes and the full content
 * is parsed by parseAllShowWidgets → `.map((seg, i) => key={`w-${i}`})`.
 *
 * If these keys ever diverge, React will unmount + remount the WidgetRenderer
 * → iframe destroyed → height collapse → scroll jump (P2 regression).
 */
export function computePartialWidgetKey(content: string): string {
  const markers = [...content.matchAll(/`{1,3}show-widget/g)];
  if (markers.length === 0) return 'w-0';
  const lastMarker = markers[markers.length - 1];
  const beforePart = content.slice(0, lastMarker.index).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
  return `w-${hasCompletedFences ? completedSegments.length : (beforePart ? 1 : 0)}`;
}

