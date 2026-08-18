---
name: html-artifact-design
description: Design guidelines for OpenChamber HTML Artifacts (the html_artifact tool and installed third-party artifacts). Load BEFORE composing non-trivial artifact HTML — dashboards, simulators, explorers, multi-panel tools, charts. Keywords: html_artifact, artifact, simulator, explorer, custom SVG, interactive HTML, 自包含页面.
---

# HTML Artifact Design Guide

The Host injects theme-resolved `--ocix-*` tokens into the sandbox document before your HTML runs. They already reflect the user's light/dark mode and the active OCIX style preset. Your job: consume tokens, keep one focal point, stay inside the sandbox contract.

## 1. Token contract (never hardcode colors)

Use `var(--ocix-*)` for every color, radius, and shadow. Hardcoded hex/`white`/named colors are rejected in review and break presets.

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `surface`, `surface-muted`, `surface-subtle` | Page stays transparent/`surface`; cards use `surface` or `surface-muted`; nested wells use `surface-subtle` |
| Text | `foreground`, `muted-foreground` | Two levels only |
| Lines | `border` | 1px hairlines; do not invent darker borders |
| Accent | `primary`, `primary-foreground`, `primary-tint`, `primary-shade` | The only chromatic UI accent; tint=hover, shade=pressed |
| Hero | `panel-hero-bg` | Tinted background for the single most important number/panel |
| Selection/focus | `selection`, `selection-foreground`, `focus-ring` | Selected states and `:focus-visible` rings |
| Status | `success|warning|error|info` (+`-background`/`-border`) | Real status feedback only — never decoration or category colors |
| Charts | `chart-1…8` | Categorical order, in this order |
| Intensity | `chart-seq-1…5` | Single-hue scale for heatmaps/funnels (1=lightest) |
| Delta | `delta-up`, `delta-down`, `delta-flat` | Up/down/flat movement; decoupled from success/error (rising costs are not "good") |
| Radius | `radius-sm` / `radius-md` / `radius-lg` | Small controls / cards / large containers |
| Elevation | `shadow-1`, `shadow-2` | May be `none` (then layer via surfaces + hairlines). Never write your own shadow values |

Light/dark is already resolved by the Host — you do not need `prefers-color-scheme` blocks for tokenized colors. Still set `color-scheme: light dark` on `:root` so native form controls match, and keep `html`/`body` background transparent.

## 2. Typography

- System sans only (the Host font); no remote or embedded fonts.
- KPI/hero numbers: `font-variant-numeric: tabular-nums`, 20–28px, weight 600.
- Scale: title 13px/500, body 14px, meta 12px, micro 11px — match the conversation around you.
- No gradient text, no all-caps body text, no letter-spacing tricks beyond slight negative tracking on large numbers.

## 3. Composition (same discipline as Declarative)

1. **One focal point per artifact** — one hero metric/panel or one main visual, never a grid of equals.
2. KPI band ≤4 items; secondary content quieter (no border or `surface-muted`).
3. Conclusion prose belongs in the chat reply, outside the artifact.
4. Density: 8px spacing grid; card padding 12–16px. Avoid both crowding and airport-poster whitespace.
5. Responsive: fluid widths only; never a fixed viewport width; 390px must not scroll horizontally (internal charts may scroll with a visible hint).

## 4. Charts and diagrams (hand-rolled SVG/Canvas)

- Series colors strictly `chart-1` → `chart-8`; intensity scales use `chart-seq-*`; targets/averages use a dashed `primary-tint` line.
- Grid lines: `border` at ~35% opacity, dashed; never solid heavy grids.
- Line width ≤3px, bar corner radius 3px; label text `muted-foreground` 10–11px.
- Every chart needs text alternatives: `role="group"` + `aria-label` on the svg, and meaningful values reachable as text.

## 5. Interaction and motion

- Local state only: sliders, playback, drag, toggles — all client-side over inline data.
- Short transitions (≤150ms, color/opacity/border/transform) are fine; honor `prefers-reduced-motion`; no infinite decorative animation, no blur/glass effects.
- Installed artifacts with declared business actions call `window.openchamber.business.*`; write actions must render their own pending/confirmed states — the Host confirmation challenge resolves or rejects the promise.
- Agent-generated artifacts NEVER get business access — do not attempt network, storage, Tool/MCP, or parent-DOM calls; the sandbox blocks them and your artifact will be discarded.

## 6. Do / Don't

| Do | Don't |
|---|---|
| `var(--ocix-chart-2)` for the second series | Any hex/rgb/hsl literal |
| `panel-hero-bg` for the one hero card | Colored side bars / left accent rails |
| `shadow-1` on floating elements | Custom shadows, blur, backdrop-filter |
| `radius-md` cards, `radius-sm` inputs | Mixed ad-hoc radii |
| `delta-up` for rising revenue | `success` green for "number went up" |
| Transparent `body`, internal panels only | A second full-page frame or white canvas |

## 7. Self-check before returning

1. Zero hex/rgb literals in the file; every color/radius/shadow is a token.
2. Looks correct in both light and dark (tokens guarantee this — if you hardcoded, it breaks).
3. One focal point; KPIs ≤4; no horizontal page scroll at 390px.
4. `<script>` present ⇒ `scripts: true` declared; no executable markup otherwise.
5. All content self-contained; no remote references anywhere.
