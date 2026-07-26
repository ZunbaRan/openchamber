import { describe, expect, test } from 'bun:test';

import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
} from '@/stores/useUIStore';

describe('Codex-style shell widths', () => {
  test('keeps the left sidebar at 280px by default within 240–420px', () => {
    expect({
      min: LEFT_SIDEBAR_MIN_WIDTH,
      default: LEFT_SIDEBAR_DEFAULT_WIDTH,
      max: LEFT_SIDEBAR_MAX_WIDTH,
    }).toEqual({ min: 240, default: 280, max: 420 });
  });

  test('keeps the unified right workspace at 420px by default within 320–960px', () => {
    expect({
      min: CONTEXT_PANEL_MIN_WIDTH,
      default: CONTEXT_PANEL_DEFAULT_WIDTH,
      max: CONTEXT_PANEL_MAX_WIDTH,
    }).toEqual({ min: 320, default: 420, max: 960 });
  });
});
