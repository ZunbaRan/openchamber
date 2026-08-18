# P0 Fork Feature and Host-Seam Allowlist

> Target UI baseline: OpenChamber `v1.18.1` (`ce519219`)

This document is the migration ownership boundary. It is not permission to copy every donor
diff in a listed file. Each change must still be tied to an `issues.md` invariant.

## F — feature-owned modules

The implementation may be forward-ported and adapted to target-release primitives:

- `packages/ui/src/components/interactive-ui/**`
- `packages/ui/src/lib/interactive-ui/**`
- `packages/ui/src/components/sections/interactive-ui/**`
- `packages/ui/src/components/chat/generative-widget/**`
- `packages/ui/src/lib/generative-widget/**`
- `packages/ui/src/stores/useExtensionWorkbenchStore.ts`
- `packages/ui/src/styles/ocix-theme.css`
- `packages/ui/src/styles/ocix-presets.css`
- `packages/web/server/lib/interactive-ui/**`
- `packages/electron/artifact-runner.mjs`
- `packages/electron/artifact-runner-preload.cjs`

## A — narrow host adapters

These files must start from the target-release version. Only the named functional seam may
be added; donor visual/layout code must not replace the file wholesale.

| Host file | Allowed fork responsibility |
| --- | --- |
| `packages/ui/src/components/chat/message/parts/AssistantTextPart.tsx` | one Generative Widget dispatch branch |
| `packages/ui/src/components/chat/message/parts/ToolPart.tsx` | OCIX, Artifact, Installed Artifact, and MCP App parsing/renderer dispatch; mounted-rich-result state contract |
| `packages/ui/src/components/chat/ChatInput.tsx` | Generative Widget send-message bridge |
| `packages/ui/src/components/views/SettingsView.tsx` | Applications page registration |
| `packages/ui/src/lib/settings/metadata.ts` | Applications settings metadata |
| `packages/ui/src/lib/settings/search.ts` | Applications settings search entries |
| `packages/ui/src/components/layout/RightSidebarTabs.tsx` | one Workbench tab |
| `packages/ui/src/components/layout/ContextPanel.tsx` | one Workbench mode when the target host still requires it |
| `packages/ui/src/stores/useUIStore.ts` | Workbench/style persisted fields and sanitizer only |
| `packages/ui/src/lib/opencode/client.ts` | capability handshake plus MCP App resource/tool-call wrappers |
| `packages/ui/src/apps/MobileApp.tsx` | Applications settings availability |
| `packages/ui/src/index.css` | scoped OCIX stylesheet imports only |
| `packages/web/server/lib/opencode/feature-routes-runtime.js` | OCIX runtime factory and explicit route registration |
| `packages/web/server/lib/opencode/core-routes.js` | fork capability publication |
| `packages/electron/main.mjs` | Artifact Runner and MCP binary-save IPC branches |
| `packages/electron/preload.mjs` | narrow IPC exposure for the retained native contracts |
| `packages/electron/package.json` | packaged assets required by retained native contracts |

## U — upstream-owned UI

Unless a later issue proves a feature contract, these paths remain byte-for-byte owned by
the target release:

- generic Chat, Session, Git, Files, Provider, and Agent presentation;
- generic Tool row typography, borders, expansion animation, and spacing;
- generic Settings navigation, layout, and section chrome;
- generic Sidebar, Context Rail, top bar, logo, themes, typography, and design-system CSS;
- fork-only decorative backgrounds, branding, animation, icons, and themes.

## D — duplicate or obsolete

- compatibility layers used only by retired UI structures;
- fork UI already provided by an equivalent target-release primitive;
- unreferenced global CSS, themes, icons, and helpers after feature migration;
- any donor change that cannot be proved to be F or A.

## Enforced acceptance

- Changed paths outside F/A require a new ledger issue with first-principles evidence.
- Global selectors introduced by OCIX are rejected; OCIX visual contracts stay under
  `.ocix-scope`.
- Ordinary UI screenshots are compared with the target release, not old fork goldens.
- Host-seam diffs are reviewed for functional adapter code and must not carry donor chrome.
- Final acceptance audits `git diff --name-only v1.18.1...HEAD` against this allowlist and
  records every intentional exception.
