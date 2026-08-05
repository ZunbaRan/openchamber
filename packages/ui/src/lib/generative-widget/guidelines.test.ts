import { describe, expect, test } from 'bun:test';
import {
  AVAILABLE_GUIDELINE_MODULES,
  getAllGuidelines,
  getAlwaysOnGenerativeWidgetPrompt,
  getGuidelines,
} from './guidelines';

describe('generative-widget guidelines', () => {
  test('exposes expected modules', () => {
    expect(AVAILABLE_GUIDELINE_MODULES.sort()).toEqual(
      ['art', 'chart', 'diagram', 'interactive', 'mockup'].sort(),
    );
  });

  test('always-on prompt includes wire format and skill hint', () => {
    const text = getAlwaysOnGenerativeWidgetPrompt();
    expect(text.includes('show-widget')).toBe(true);
    expect(text.includes('widget_code')).toBe(true);
    expect(text.includes('generative-widget-guidelines')).toBe(true);
    expect(text.length).toBeLessThan(4000);
  });

  test('full guidelines include design modules and wire reminder', () => {
    const all = getAllGuidelines();
    expect(all.includes('FINAL OUTPUT FORMAT')).toBe(true);
    expect(all.includes('Core Design System')).toBe(true);
    expect(all.includes('Chart.js')).toBe(true);
    expect(all.includes('Diagram type catalog')).toBe(true);
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
