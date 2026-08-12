# Generative Widget

Claude/CodePilot-style conversation widgets via `show-widget` fences.

- **Not** OCIX, HTML Artifact, or MCP Apps.
- No business API: sandbox `connect-src 'none'`.
- Entry: `AssistantTextPart` → `renderAssistantTextWithWidgets`.
- Host bridge: `setGenerativeWidgetSendHandler` from `ChatInput`.

## Tests

```bash
bun test packages/ui/src/lib/generative-widget/
```

## Prompt guidance: production sources vs. OpenChamber parity helpers

OpenCode's production always-on prompt and on-demand Skill are **authoritative**.
They live in the OpenCode repository (sibling of OpenChamber — `opencode/`, not this
repo and not editable here):

| Layer | Production source (authoritative) | Registered/injected in | Size |
|---|---|---|---|
| **Always-on** | `opencode/packages/opencode/src/session/prompt/generative-widget.txt` | Imported as `PROMPT_GENERATIVE_WIDGET` and injected in `opencode/packages/opencode/src/session/system.ts` | ~2.9KB / ~350–700 tokens |
| **On-demand** | Skill body `GENERATIVE_WIDGET_GUIDELINES_SKILL_BODY` in `opencode/packages/opencode/src/skill/generative-widget-guidelines.ts` | Registered as built-in skill `generative-widget-guidelines` in `opencode/packages/opencode/src/skill/index.ts` | ~8KB / ~2k+ tokens |

OpenChamber's assets are **parity/documentation helpers only** — never the production
injected prompt and never a third routing policy:

- `lib/generative-widget/guidelines.ts` — TypeScript helper:
  - `getAlwaysOnGenerativeWidgetPrompt()`
  - `getGuidelines(modules)` / `getAllGuidelines()`
  - `GENERATIVE_WIDGET_KEYWORDS` / `shouldOfferWidgetGuidelines()` (offer heuristic only)
- `lib/generative-widget/GENERATIVE_WIDGET_GUIDELINES_SKILL.md` — Markdown mirror of the
  on-demand Skill for documentation and tests.

Both helpers explicitly state they are NOT the production injected prompt and do not
become a third routing policy. They mirror the production semantic invariants — wire
fence, selection hierarchy (installed Tool/View → Declarative `interactive_ui` →
`show-widget` → `html_artifact`, MCP Apps outside), conversational interleaving
(1-N different-focus visuals, bridge prose, one primary visual per focus, soft
≤4 primary visuals), same-data dedupe, generated-data labels, and short-answer
restraint — without claiming byte identity with the OpenCode sources.

Skill activation is narrowed: the Skill loads **after** `show-widget` has already been
selected for a visual and then supplies detailed design/wire guidance — it does not
route every visualization. Activation decisions keep living in the model, not in a
keyword gate: `shouldOfferWidgetGuidelines` is a plain offer heuristic with no
authority over the production routing boundary.
