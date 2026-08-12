import { describe, expect, test } from 'bun:test';
import {
  computePartialWidgetKey,
  parseAllShowWidgets,
  parseShowWidget,
  textContainsShowWidget,
} from './parseShowWidget';

// re-export helper for tests if needed
function hasWidget(text: string): boolean {
  return /`{1,3}show-widget/.test(text);
}

describe('parseAllShowWidgets', () => {
  test('returns empty for plain text', () => {
    expect(parseAllShowWidgets('hello world')).toEqual([]);
  });

  test('parses a valid show-widget fence', () => {
    const text = `Intro

\`\`\`show-widget
{"title":"Hello","widget_code":"<div style='padding:8px'>Hi</div>"}
\`\`\`

Outro`;
    const segments = parseAllShowWidgets(text);
    expect(segments.length).toBe(3);
    expect(segments[0]).toEqual({ type: 'text', content: 'Intro' });
    expect(segments[1]?.type).toBe('widget');
    if (segments[1]?.type === 'widget') {
      expect(segments[1].data.title).toBe('Hello');
      expect(segments[1].data.widget_code).toContain('Hi');
    }
    expect(segments[2]).toEqual({ type: 'text', content: 'Outro' });
  });

  test('surfaces malformed raw HTML fence body', () => {
    const text = `\`\`\`show-widget
<div>not json</div>
\`\`\``;
    const segments = parseAllShowWidgets(text);
    expect(segments.some((s) => s.type === 'malformed_widget')).toBe(true);
  });

  test('surfaces missing widget_code', () => {
    const text = `\`\`\`show-widget
{"title":"x"}
\`\`\``;
    const segments = parseAllShowWidgets(text);
    expect(segments.some((s) => s.type === 'malformed_widget')).toBe(true);
  });

  test('fails closed when title or widget_code violates the string wire contract', () => {
    for (const body of [
      '{"title":{},"widget_code":"<div>x</div>"}',
      '{"title":"x","widget_code":{"html":"<div>x</div>"}}',
    ]) {
      const text = `\`\`\`show-widget\n${body}\n\`\`\``;
      const segments = parseAllShowWidgets(text);
      expect(segments.some((segment) => segment.type === 'widget')).toBe(false);
      expect(segments.some((segment) => segment.type === 'malformed_widget')).toBe(true);
      expect(parseShowWidget(text)).toBeNull();
    }
  });

  test('detects marker presence', () => {
    expect(hasWidget('```show-widget\n{}')).toBe(true);
    expect(hasWidget('no widgets')).toBe(false);
  });

  test('computePartialWidgetKey is stable for first partial widget', () => {
    const partial = '```show-widget\n{"title":"T","widget_code":"<div>x';
    expect(/^w-\d+$/.test(computePartialWidgetKey(partial))).toBe(true);
  });

  // Exact Sol reviewer reproductions for issue-030 truncated JSON state machine.
  test('truncated widget_code stops at the open string end and ignores trailing JSON', () => {
    // Exact Sol reproduction: trailing `,"title":"x"` after a closed widget_code
    // string must not be swallowed into widget_code (object still unclosed).
    const partial =
      '```show-widget\n{"widget_code":"<div>abcdefghij</div>","title":"x"';
    const segments = parseAllShowWidgets(partial);
    expect(segments.some((segment) => segment.type === 'widget')).toBe(true);
    const widget = segments.find((segment) => segment.type === 'widget');
    if (widget?.type !== 'widget') throw new Error('expected widget');
    expect(widget.data.widget_code).toBe('<div>abcdefghij</div>');
    expect(widget.data.widget_code).not.toContain('title');
    // Title string is already closed (`"x"`) even though the object is not.
    expect(widget.data.title).toBe('x');

    const finalized =
      '```show-widget\n{"widget_code":"<div>abcdefghij</div>","title":"x"}\n```';
    const finalSegments = parseAllShowWidgets(finalized);
    const finalWidget = finalSegments.find((segment) => segment.type === 'widget');
    if (finalWidget?.type !== 'widget') throw new Error('expected final widget');
    expect(finalWidget.data.widget_code).toBe(widget.data.widget_code);
    expect(finalWidget.data.title).toBe(widget.data.title);
  });

  test('truncated path fails closed when a completed non-string title is already present', () => {
    const partial =
      '```show-widget\n{"title":123,"widget_code":"<div>abcdefghij';
    const segments = parseAllShowWidgets(partial);
    expect(segments.some((segment) => segment.type === 'widget')).toBe(false);
  });

  test('partial→final identity for title-first streaming widget_code', () => {
    const partial =
      '```show-widget\n{"title":"Hello","widget_code":"<div>abcdefghij';
    const segments = parseAllShowWidgets(partial);
    const widget = segments.find((segment) => segment.type === 'widget');
    if (widget?.type !== 'widget') throw new Error('expected partial widget');
    expect(widget.data.title).toBe('Hello');
    expect(widget.data.widget_code).toBe('<div>abcdefghij');

    const finalized =
      '```show-widget\n{"title":"Hello","widget_code":"<div>abcdefghij</div>"}\n```';
    const finalWidget = parseAllShowWidgets(finalized).find((segment) => segment.type === 'widget');
    if (finalWidget?.type !== 'widget') throw new Error('expected final widget');
    expect(finalWidget.data.widget_code.startsWith(widget.data.widget_code)).toBe(true);
    expect(finalWidget.data.title).toBe(widget.data.title);
  });

  // Regression: raw UTF-8 size bound before expensive regex/parse, mirroring
  // the bounded early-exit P0 precedent. An oversized/oversized-streaming
  // message must fail closed (no segments, parseShowWidget -> null, no marker
  // fast-path) rather than drive repeated global-regex scans / JSON parsing.
  test('fails closed on oversized input (bounded early exit)', () => {
    const big =
      '```show-widget\n{"widget_code":"' +
      '<div>x</div>'.repeat(1024 * 100) +
      '"}';
    expect(textContainsShowWidget(big)).toBe(false);
    expect(parseAllShowWidgets(big)).toEqual([]);
    expect(parseShowWidget(big)).toBeNull();
  });

  test('rejects multibyte input whose UTF-16 length is <1MiB but UTF-8 bytes exceed it', () => {
    // '€' is 1 UTF-16 code unit but 3 UTF-8 bytes. 400k units < 1MiB length,
    // yet 1.2M bytes > 1MiB -> the guard must reject even though JS length
    // looks small.
    const payload = '€'.repeat(400_000);
    expect(payload.length).toBe(400_000);
    expect(textContainsShowWidget(payload)).toBe(false);
    expect(parseAllShowWidgets(payload)).toEqual([]);
    expect(parseShowWidget(payload)).toBeNull();
  });

  test('exactly 1MiB is not rejected by the guard; 1MiB+1 is', () => {
    const LIMIT = 1024 * 1024;
    const base = '```show-widget\n{"widget_code":"<div>';
    const tail = '</div>"}';
    const pad = LIMIT - (base.length + tail.length);
    const exact = base + 'a'.repeat(pad) + tail;
    expect(new TextEncoder().encode(exact).length).toBe(LIMIT);
    // At exactly 1MiB (ASCII) the guard must NOT reject: a valid fence still parses.
    expect(parseAllShowWidgets(exact).some((s) => s.type === 'widget')).toBe(true);

    const over = exact + 'a'; // 1MiB + 1 ASCII bytes
    expect(textContainsShowWidget(over)).toBe(false);
    expect(parseAllShowWidgets(over)).toEqual([]);
    expect(parseShowWidget(over)).toBeNull();
  });

  test('guard counts exactly limit+1 ASCII charCodeAt reads then fails closed without regex/string parsing', () => {
    const LIMIT = 1024 * 1024;
    let reads = 0;
    // Synthetic string-like: proves the guard early-exits before any regex or
    // string method touches the input (which would throw here).
    const synthetic = {
      get length(): number {
        return LIMIT + 1;
      },
      charCodeAt(): number {
        reads++;
        if (reads > LIMIT + 1) throw new Error('guard read too far');
        return 0x61; // 'a' (ASCII, 1 byte)
      },
      toString(): string {
        throw new Error('guard must not stringify / run regex on the input');
      },
    };
    expect(parseAllShowWidgets(synthetic as unknown as string)).toEqual([]);
    expect(reads).toBe(LIMIT + 1);
  });

  test('partial-key entry point enforces the byte cap before matchAll materialization', () => {
    const LIMIT = 1024 * 1024;
    let reads = 0;
    const synthetic = {
      get length(): number {
        return LIMIT + 1;
      },
      charCodeAt(): number {
        reads += 1;
        if (reads > LIMIT + 1) throw new Error('partial-key guard read too far');
        return 0x61;
      },
      matchAll(): never {
        throw new Error('partial-key guard must not call matchAll');
      },
    };

    expect(computePartialWidgetKey(synthetic as unknown as string)).toBe('w-0');
    expect(reads).toBe(LIMIT + 1);
  });
});

describe('parseAllShowWidgets finalized-strict mode', () => {
  const strict = (text: string) => parseAllShowWidgets(text, { mode: 'finalized-strict' });
  const malformedCodes = (text: string): string[] =>
    strict(text)
      .filter((segment) => segment.type === 'malformed_widget')
      .map((segment) => segment.type === 'malformed_widget' ? segment.code : '');

  test('defaults to streaming-permissive', () => {
    const truncated = '```show-widget\n{"widget_code":"<div>abcdefghij</div>"';
    expect(parseAllShowWidgets(truncated)).toEqual(parseAllShowWidgets(truncated, { mode: 'streaming-permissive' }));
    expect(parseAllShowWidgets(truncated).some((segment) => segment.type === 'widget')).toBe(true);
  });

  test('rejects truncated JSON instead of recovering a partial widget', () => {
    const truncated = '```show-widget\n{"widget_code":"<div>abcdefghij</div>"';
    expect(parseAllShowWidgets(truncated).some((segment) => segment.type === 'widget')).toBe(true);
    const segments = strict(truncated);
    expect(segments.some((segment) => segment.type === 'widget')).toBe(false);
    expect(malformedCodes(truncated)).toContain('truncated-json');
  });

  test('rejects an unclosed fence even when the JSON is complete', () => {
    const text = '```show-widget\n{"widget_code":"<div>abcdefghij</div>"}';
    expect(parseAllShowWidgets(text).some((segment) => segment.type === 'widget')).toBe(true);
    expect(malformedCodes(text)).toContain('unclosed-fence');
  });

  test('rejects invalid JSON', () => {
    const text = '```show-widget\n{"widget_code": <div>broken</div>}\n```';
    expect(malformedCodes(text)).toContain('invalid-json');
  });

  test('rejects non-object JSON values', () => {
    for (const body of ['[1,2,3]', '"just a string"', '12345']) {
      expect(malformedCodes(`\`\`\`show-widget\n${body}\n\`\`\``)).toContain('non-object-json');
    }
  });

  test('rejects empty or non-string widget_code', () => {
    for (const body of ['{"widget_code":""}', '{"widget_code":{"html":"<div>x</div>"}}']) {
      expect(malformedCodes(`\`\`\`show-widget\n${body}\n\`\`\``)).toContain('missing-widget-code');
    }
  });

  test('rejects present non-string title and never coerces it', () => {
    const text = '```show-widget\n{"title":123,"widget_code":"<div>x</div>"}\n```';
    expect(malformedCodes(text)).toContain('non-string-title');
    expect(strict(text).some((segment) => segment.type === 'widget')).toBe(false);
  });

  test('rejects raw HTML fence bodies with no-json-wrapper', () => {
    const text = '```show-widget\n<div>not json</div>\n```';
    expect(malformedCodes(text)).toContain('no-json-wrapper');
  });

  test('accepts valid multiple closed fences preserving text/widget order', () => {
    const text = [
      'intro',
      '```show-widget\n{"title":"A","widget_code":"<div>a</div>"}\n```',
      'middle',
      '```show-widget\n{"title":"B","widget_code":"<div>b</div>"}\n```',
      'outro',
    ].join('\n\n');
    const segments = strict(text);
    expect(segments.map((segment) => segment.type)).toEqual(['text', 'widget', 'text', 'widget', 'text']);
    expect(segments.map((segment) => segment.type === 'widget'
      ? segment.data.title
      : segment.type === 'text' ? segment.content : segment.code))
      .toEqual(['intro', 'A', 'middle', 'B', 'outro']);
  });

  test('requires the closing fence to match the opener backtick count', () => {
    const mismatched = '``show-widget\n{"widget_code":"<div>x</div>"}\n```';
    expect(malformedCodes(mismatched)).toContain('unclosed-fence');
    const single = '`show-widget {"widget_code":"<div>x</div>"}`';
    expect(strict(single).some((segment) => segment.type === 'widget')).toBe(true);
  });

  test('never coerces partial title strings from truncated bodies', () => {
    const truncated = '```show-widget\n{"title":"Hello","widget_code":"<div>abcdefghij';
    expect(strict(truncated).some((segment) => segment.type === 'widget')).toBe(false);
    expect(malformedCodes(truncated)).toContain('truncated-json');
  });

  test('permissive malformed segments carry stable codes too', () => {
    const text = '```show-widget\n{"title":"x"}\n```';
    const malformed = parseAllShowWidgets(text).find((segment) => segment.type === 'malformed_widget');
    expect(malformed?.type).toBe('malformed_widget');
    if (malformed?.type === 'malformed_widget') {
      expect(malformed.code).toBe('missing-widget-code');
      expect(malformed.reason.length).toBeGreaterThan(0);
      expect(typeof malformed.raw).toBe('string');
    }
  });

  test('strict mode still fails closed on oversized input', () => {
    const big = '```show-widget\n{"widget_code":"' + '<div>x</div>'.repeat(1024 * 100) + '"}';
    expect(strict(big)).toEqual([]);
  });
});
