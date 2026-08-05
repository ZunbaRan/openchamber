# CodePilot Generative Widget — reference snapshot

This directory is a **read-only study snapshot** of [CodePilot](https://github.com/op7418/CodePilot)’s conversation generative-UI (Claude-style `show-widget`) stack.

It exists so implementation agents can work offline without re-cloning upstream.  
**Do not compile or ship these files as OpenChamber product code.**

## License

Upstream is **Business Source License 1.1**. See [SOURCE_PROVENANCE.md](./SOURCE_PROVENANCE.md) and upstream `LICENSE`.  
OpenChamber must **reimplement** under its own license; use this tree as behavioral/API reference only.

## Layout

```text
docs/                          Upstream handover + design article (copied)
  generative-ui.md             Authoritative internal architecture notes
  generative-ui-article.md     Product/engineering narrative (streaming UX)

src/                           Full source files needed for port
  WidgetRenderer.tsx           Receiver iframe host (update/finalize/theme/height)
  WidgetErrorBoundary.tsx      Isolate widget crashes from chat
  widget-sanitizer.ts          Streaming/final sanitize + buildReceiverSrcdoc
  widget-css-bridge.ts         Anthropic CSS vars + scoped utilities
  widget-guidelines.ts         System prompt + on-demand design modules
  MessageItem.full.tsx         Full file (parse + persist path; large)
  StreamingMessage.full.tsx    Full file (streaming path; large)

excerpts/                      Trimmed slices agents should start with
  parse-and-partial.ts         WidgetSegment + parseAllShowWidgets + partial key
  StreamingMessage-widget-branch.tsx
  ChatView-widgetSendMessage.tsx
```

## Read order for implementers

1. Parent plan: [../../GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md](../../GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md)
2. `docs/generative-ui.md`
3. `excerpts/parse-and-partial.ts`
4. `src/widget-sanitizer.ts` + `src/WidgetRenderer.tsx`
5. `src/widget-css-bridge.ts` + `src/widget-guidelines.ts`
6. Streaming/persist excerpts only if still unclear

## Wire format (canonical)

````markdown
```show-widget
{"title":"Hello","widget_code":"<div style='padding:8px'>Hello</div>"}
```
````

- Body is **JSON**, not raw HTML.
- Prefer single-quoted HTML attributes inside `widget_code` to avoid escape hell.
- Multiple fences may interleave with normal markdown text.

## Not included (out of v1 port scope unless plan expands)

- Dashboard pin MCP (`dashboard-mcp.ts`, `DashboardPanel.tsx`)
- Sandpack JSX preview
- Buddy hatch special-case widget messages
- Full `ChatView.tsx` / app shell
