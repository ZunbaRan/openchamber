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

## Prompt injection (OpenCode fork)

| Layer | Where | Size |
|---|---|---|
| **Always-on** | `opencode/.../session/prompt/generative-widget.txt` injected in `session/system.ts` | ~1.5KB / ~350–600 tokens |
| **On-demand** | Built-in skill `generative-widget-guidelines` in `opencode/.../skill/index.ts` | ~8KB / ~2k+ tokens |

OpenChamber keeps parity helpers in `lib/generative-widget/guidelines.ts`:

- `getAlwaysOnGenerativeWidgetPrompt()`
- `getGuidelines(modules)` / `getAllGuidelines()`
