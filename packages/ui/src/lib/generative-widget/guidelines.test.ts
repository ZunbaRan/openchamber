import { describe, expect, test } from 'bun:test';
import {
  AVAILABLE_GUIDELINE_MODULES,
  CANONICAL_SHOW_WIDGET_JSON,
  GENERATIVE_WIDGET_KEYWORDS,
  GENERATIVE_WIDGET_WIRE_FORMAT,
  getAllGuidelines,
  getAlwaysOnGenerativeWidgetPrompt,
  getGuidelines,
  shouldOfferWidgetGuidelines,
} from './guidelines';

// The Skill markdown is a sibling parity asset; it must share the semantic
// invariants with the TypeScript helper without claiming byte identity.
const skillMarkdownUrl = new URL('./GENERATIVE_WIDGET_GUIDELINES_SKILL.md', import.meta.url);
const skillMarkdown = await (await fetch(skillMarkdownUrl)).text();

describe('generative-widget guidelines', () => {
  test('exposes expected modules', () => {
    expect(AVAILABLE_GUIDELINE_MODULES.sort()).toEqual(
      ['art', 'chart', 'diagram', 'interactive', 'mockup'].sort(),
    );
  });

  test('keeps the keyword offer helper contract unchanged', () => {
    expect(GENERATIVE_WIDGET_KEYWORDS).toBeDefined();
    expect(GENERATIVE_WIDGET_KEYWORDS.test('draw a flowchart for our pipeline')).toBe(true);
    expect(GENERATIVE_WIDGET_KEYWORDS.test('please show a timeline')).toBe(true);
    expect(GENERATIVE_WIDGET_KEYWORDS.test('可视化数据')).toBe(true);
    expect(shouldOfferWidgetGuidelines('explain the config file')).toBe(false);
    expect(shouldOfferWidgetGuidelines('hello world')).toBe(false);
  });

  test('always-on prompt preserves wire format, after-selection skill hint, and size bound', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('show-widget')).toBe(true);
    expect(text.includes('widget_code')).toBe(true);
    expect(text.includes('generative-widget-guidelines')).toBe(true);
    // Skill activation is narrowed to AFTER show-widget has already been selected.
    expect(text.includes('After show-widget is already selected')).toBe(true);
    expect(text.includes('load skill `generative-widget-guidelines`')).toBe(true);
    expect(text.length).toBeLessThan(4000);
  });

  test('canonical JSON is an exact show-widget fence with string widget_code/title', () => {
    const parsed = JSON.parse(CANONICAL_SHOW_WIDGET_JSON) as Record<string, unknown>;
    expect(typeof parsed.widget_code).toBe('string');
    expect(typeof parsed.title).toBe('string');
    expect((parsed.widget_code as string).length).toBeGreaterThan(0);
    // The wire format documents the labelled fence and both string fields.
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('```show-widget')).toBe(true);
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('"widget_code"')).toBe(true);
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('"title"')).toBe(true);
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('JSON-encoded string')).toBe(true);
    // Non-JSON fences are never widgets; prose lives outside/between fences.
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('NEVER a widget')).toBe(true);
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('OUTSIDE the fence')).toBe(true);
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes('SEPARATE fences with prose between')).toBe(true);
    // The canonical example is embedded as the minimal correct example.
    expect(GENERATIVE_WIDGET_WIRE_FORMAT.includes(CANONICAL_SHOW_WIDGET_JSON)).toBe(true);
  });

  test('preserves safety, CDN, size, and accessibility invariants', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    // Sandbox: no network APIs.
    expect(text.includes('No fetch/XHR/WebSocket')).toBe(true);
    expect(text.includes('sandboxed iframe')).toBe(true);
    // CDN allowlist.
    expect(text.includes('cdnjs.cloudflare.com')).toBe(true);
    expect(text.includes('cdn.jsdelivr.net')).toBe(true);
    expect(text.includes('unpkg.com')).toBe(true);
    expect(text.includes('esm.sh')).toBe(true);
    // Size constraint.
    expect(text.includes('3000')).toBe(true);
    // Visual guidance: transparent background, min-height, human-readable title.
    expect(text.includes('Transparent background')).toBe(true);
    expect(text.includes('min-height')).toBe(true);
    expect(text.includes('human-readable')).toBe(true);
    // Accessibility guidance.
    expect(text.includes('Accessibility')).toBe(true);
    expect(text.includes('aria-labels')).toBe(true);
    // Multi-fence streaming order.
    expect(text.includes('`<defs>` first')).toBe(true);
    expect(text.includes('`<script>` last')).toBe(true);
  });

  test('parity provenance is explicit in both assets', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('parity/documentation helper')).toBe(true);
    expect(text.includes('NOT the production injected prompt')).toBe(true);
    expect(text.includes('third routing policy')).toBe(true);
    expect(text.includes('remain authoritative')).toBe(true);
    // Skill markdown carries the same provenance.
    expect(skillMarkdown.includes('parity/documentation helper')).toBe(true);
    expect(skillMarkdown.includes('NOT the')).toBe(true);
    expect(skillMarkdown.includes('production injected prompt')).toBe(true);
    expect(skillMarkdown.includes('third routing policy')).toBe(true);
    expect(skillMarkdown.includes('remain authoritative')).toBe(true);
  });

  test('skill activation is narrowed to after show-widget selection', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('After show-widget is already selected for a visual')).toBe(true);
    // The Skill markdown frontmatter narrows activation the same way.
    expect(skillMarkdown.includes('Load AFTER show-widget has already been selected')).toBe(true);
    expect(skillMarkdown.includes('before emitting the widget')).toBe(true);
    // The old pre-selection trigger wording is gone.
    expect(skillMarkdown).not.toContain('Use BEFORE creating non-trivial visualizations');
  });

  test('selection hierarchy is frozen with production ordering and Tool authority', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    const tool = text.indexOf('1. Prefer an installed specialized Tool/View');
    const declarative = text.indexOf('2. Otherwise prefer Declarative interactive_ui');
    const showWidget = text.indexOf('3. Use show-widget for small free-form');
    const htmlArtifact = text.indexOf('4. Use html_artifact for complex custom');
    expect(tool).toBeGreaterThanOrEqual(0);
    expect(declarative).toBeGreaterThan(tool);
    expect(showWidget).toBeGreaterThan(declarative);
    expect(htmlArtifact).toBeGreaterThan(showWidget);
    expect(text.includes('MCP Apps remain outside this four-track numbering')).toBe(true);
    expect(text.includes('show-widget is not a Tool')).toBe(true);
    // The Skill markdown mirrors the same hierarchy.
    expect(skillMarkdown.includes('Visual selection hierarchy')).toBe(true);
    expect(skillMarkdown.includes('MCP Apps remain outside this four-track numbering')).toBe(true);
    expect(skillMarkdown.includes('show-widget is not a Tool')).toBe(true);
  });

  test('allows 1-N different-focus visuals with bridges, one focus per widget, soft four', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('1-N visuals')).toBe(true);
    expect(text.includes('bridges')).toBe(true);
    expect(text.includes('one primary visual per focus')).toBe(true);
    expect(text.includes('four primary visuals')).toBe(true);
    expect(text.includes('not a hard gate')).toBe(true);
    expect(skillMarkdown.includes('one primary visual per focus')).toBe(true);
    expect(skillMarkdown.includes('not a hard gate')).toBe(true);
    expect(skillMarkdown.includes('Emit 1-N visuals')).toBe(true);
    expect(skillMarkdown.includes('bridge with short prose')).toBe(true);
  });

  test('never repeats same business data across tracks and labels generated data', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('Never repeat the same business data or conclusion across')).toBe(true);
    expect(text.includes('Label example/simulated/generated data clearly')).toBe(true);
    expect(text.includes('stays governed by its Tool authority')).toBe(true);
    expect(skillMarkdown.includes('Never repeat the same business data or conclusion across')).toBe(true);
    expect(skillMarkdown.includes('Label example/simulated/generated data clearly')).toBe(true);
  });

  test('keeps short factual answers as prose', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('remain prose')).toBe(true);
    expect(text.includes('do not require a widget')).toBe(true);
    expect(text.includes('force a visual merely because the capability exists')).toBe(true);
    expect(skillMarkdown.includes('remain prose')).toBe(true);
    expect(skillMarkdown.includes('do not require a widget')).toBe(true);
  });

  test('asserts absence of mandatory-widget, global-one-primary, and stop-after-first claims', () => {
    const assets = [getAlwaysOnGenerativeWidgetPrompt(), skillMarkdown];
    const forbidden = [
      'must render a widget',
      'must include a widget',
      'mandatory widget',
      'exactly one widget',
      'only one widget',
      'global one primary',
      'stop after the first',
      'do not emit another widget',
    ];
    for (const asset of assets) {
      for (const claim of forbidden) {
        expect(asset).not.toContain(claim);
      }
    }
  });

  test('full guidelines include design modules, wire reminder, and parity context', () => {
    const all = getAllGuidelines();
    expect(all.includes('FINAL OUTPUT FORMAT')).toBe(true);
    expect(all.includes('Core Design System')).toBe(true);
    expect(all.includes('Chart.js')).toBe(true);
    expect(all.includes('Diagram type catalog')).toBe(true);
    expect(all.includes('OpenChamber parity note')).toBe(true);
    expect(all.includes('Visual selection hierarchy')).toBe(true);
    expect(all.length).toBeGreaterThan(5000);
  });

  test('module selection is additive without duplicating core', () => {
    const chart = getGuidelines(['chart']);
    const diagram = getGuidelines(['diagram']);
    const both = getGuidelines(['chart', 'diagram']);
    expect(both.includes('Chart.js')).toBe(true);
    expect(both.includes('Diagram type catalog')).toBe(true);
    // Core appears once
    expect(both.split('## Core Design System').length - 1).toBe(1);
    expect(chart.length).toBeLessThan(both.length);
    expect(diagram.length).toBeLessThan(both.length);
  });
});
