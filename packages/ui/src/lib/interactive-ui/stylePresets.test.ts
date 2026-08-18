import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  OCIX_STYLE_PRESETS,
  normalizeOcixStylePreset,
  type OcixStylePreset,
} from './stylePresets';

describe('OCIX style presets', () => {
  test('exposes the reviewed preset ids and metadata in stable order', () => {
    expect(OCIX_STYLE_PRESETS).toEqual([
      { id: 'linear', character: 'professional' },
      { id: 'vercel', character: 'professional' },
      { id: 'notion', character: 'professional' },
      { id: 'claude', character: 'professional' },
      { id: 'apple', character: 'professional' },
      { id: 'figma', character: 'playful' },
      { id: 'binance', character: 'financial' },
      { id: 'slack', character: 'professional' },
    ]);
  });

  test('accepts every reviewed preset and falls back to linear for unsupported values', () => {
    const ids: OcixStylePreset[] = OCIX_STYLE_PRESETS.map(({ id }) => id);
    expect(ids.map(normalizeOcixStylePreset)).toEqual(ids);

    for (const value of [undefined, null, '', 'Linear', 'custom', 0, {}, ['linear']]) {
      expect(normalizeOcixStylePreset(value)).toBe('linear');
    }
  });

  test('defines the hero panel token for the default palette and every preset mode', () => {
    const theme = readFileSync(new URL('../../styles/ocix-theme.css', import.meta.url), 'utf8');
    const presets = readFileSync(new URL('../../styles/ocix-presets.css', import.meta.url), 'utf8');
    const token = '--ocix-panel-hero-bg:';

    expect(theme.split(token).length - 1).toBe(2);
    expect(presets.split(token).length - 1).toBe(14);
  });
});
