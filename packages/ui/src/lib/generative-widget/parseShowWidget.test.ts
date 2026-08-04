import { describe, expect, test } from 'bun:test';
import {
  computePartialWidgetKey,
  parseAllShowWidgets,
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

  test('detects marker presence', () => {
    expect(hasWidget('```show-widget\n{}')).toBe(true);
    expect(hasWidget('no widgets')).toBe(false);
  });

  test('computePartialWidgetKey is stable for first partial widget', () => {
    const partial = '```show-widget\n{"title":"T","widget_code":"<div>x';
    expect(/^w-\d+$/.test(computePartialWidgetKey(partial))).toBe(true);
  });
});
