# Generative Widget

Claude/CodePilot-style conversation widgets via `show-widget` fences.

- **Not** OCIX, HTML Artifact, or MCP Apps.
- No business API: sandbox `connect-src 'none'`.
- Entry: `AssistantTextPart` → `renderAssistantTextWithWidgets`.
- Host bridge: `setGenerativeWidgetSendHandler` from `ChatInput`.

## Tests

```bash
bun test packages/ui/src/lib/generative-widget/parseShowWidget.test.ts
bun test packages/ui/src/lib/generative-widget/sanitizer.test.ts
```

## Prompt injection

Use `GENERATIVE_WIDGET_WIRE_FORMAT` + `GENERATIVE_WIDGET_SYSTEM_PROMPT` from
`@/lib/generative-widget/guidelines` in OpenCode instructions when enabling the feature for models.
