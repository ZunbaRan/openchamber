/**
 * OCIX style presets (Style v2). Presets are pure data: the CSS in
 * `styles/ocix-presets.css` fills token slots per `[data-ocix-preset]`, and
 * components only reference `var(--ocix-*)`. The default slot values in
 * `ocix-theme.css` are the `linear` preset, so unknown ids naturally fall
 * back to it.
 *
 * Host-level only: views, extensions, and Agent-generated layouts can never
 * select a preset. See docs/OCIX_STYLE_PRESETS.md.
 */

const OCIX_STYLE_PRESET_IDS = [
  'linear',
  'vercel',
  'notion',
  'claude',
  'apple',
  'figma',
  'binance',
  'slack',
] as const;

export type OcixStylePreset = (typeof OCIX_STYLE_PRESET_IDS)[number];

const DEFAULT_OCIX_STYLE_PRESET: OcixStylePreset = 'linear';

interface OcixStylePresetMeta {
  id: OcixStylePreset;
  /** Brand-flavor hint shown under the display name. */
  character: 'professional' | 'playful' | 'financial';
}

export const OCIX_STYLE_PRESETS: readonly OcixStylePresetMeta[] = [
  { id: 'linear', character: 'professional' },
  { id: 'vercel', character: 'professional' },
  { id: 'notion', character: 'professional' },
  { id: 'claude', character: 'professional' },
  { id: 'apple', character: 'professional' },
  { id: 'figma', character: 'playful' },
  { id: 'binance', character: 'financial' },
  { id: 'slack', character: 'professional' },
];

const isOcixStylePreset = (value: unknown): value is OcixStylePreset => (
  typeof value === 'string' && (OCIX_STYLE_PRESET_IDS as readonly string[]).includes(value)
);

export const normalizeOcixStylePreset = (value: unknown): OcixStylePreset => (
  isOcixStylePreset(value) ? value : DEFAULT_OCIX_STYLE_PRESET
);
