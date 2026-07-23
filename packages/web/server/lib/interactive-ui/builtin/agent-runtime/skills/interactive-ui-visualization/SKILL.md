---
name: interactive-ui-visualization
description: Compose task-specific Interactive UI in the conversation when a dashboard, chart, table, comparison, status summary, plan, process, or other visual explanation is more useful than prose.
---

# Interactive UI visualization

Use the `interactive_ui` tool when structured visual presentation is more useful than prose. The tool is a composition grammar, not a catalog of fixed templates: design the sections and widgets for the current task. Use `html_artifact` only when this standard grammar cannot reasonably express the requested custom SVG, simulator, or explorer.

This is the inline fallback for ad-hoc visualization in OpenChamber after routing has ruled out an installed business Tool or MCP Tool. Only choose a file/site/report workflow when the user explicitly asks for HTML, a website, or a downloadable artifact.

- Trigger for Chinese requests such as “给我看看”, “画一下”, “可视化”, “做个看板”, “对比一下”, “流程图”, or “步骤图”.
- Trigger for English requests such as “show me”, “visualize”, “make a dashboard”, “compare”, or “draw the workflow”.
- Proactively use it for data-rich answers when metrics, a chart, a table, or a status layout would materially improve comprehension.
- Before using it for CRM, ERP, sales, finance, support, operations, or another business domain, check the installed capability catalog. A matching business Tool wins even when its connector is not configured yet.
- Use at most one primary OpenChamber View per assistant turn. If a specialized Tool already returned an `openchamber://interactive-result/v1` envelope in the current turn, stop: its View is already rendered. Do not call `interactive_ui` or `html_artifact` to restate the same data, and do not reproduce the full View as Markdown.
- Choose only the components that fit the task: `metric-grid`, `chart`, `table`, `comparison`, `flow`, `timeline`, `activity-feed`, `agenda`, `funnel`, `network`, `gauge`, `heatmap`, `kanban`, `git-graph`, `tree`, `diff-summary`, `sparkline`, `progress`, `status`, `list`, `callout`, `code-block`, `divider`, and `text`.
- Use `presentation=tabs` when sections are alternative views the user should switch between, or `presentation=accordion` for optional details the user should expand and collapse. Every section needs a title in these modes. These are real, keyboard-accessible Host interactions, not decorative screenshots.
- `sections[].columns` only lays out multiple sibling widgets. When a section contains one `metric-grid`, leave the section at one column and set that widget's own `columns`; do not nest a metric grid inside another multi-column grid.
- `gauge` is for one bounded value against a meaningful range; `heatmap` is for a two-dimensional intensity matrix; `kanban` is a read-only grouped workflow snapshot. Do not use them as decorative substitutes for simpler text or tables.
- `agenda` is for time-grouped entries, `funnel` for at most eight same-unit stages, and `network` for a small bounded relationship graph. Prefer HTML Artifact for large/free-form topology or simulation.
- `interactive_ui_gallery` is a developer/review Tool. Call it only when the user explicitly asks to see the component Gallery; never route ordinary visualization requests to it.
- Prefer a compact information hierarchy: conclusion first, grouped evidence second, details last. Do not create a dashboard for a one-sentence answer.
- For charts, keep `chartSeries` and each point's `values` in the same order. Use `donut` for part-to-whole, `line`/`area` for trends, and `bar` for comparison.
- Keep series with incompatible units or materially different scales in separate charts. Never put request counts and millisecond latency on one single axis, and never write a `/100` label unless the plotted and accessible values are actually transformed by that factor.
- This tool produces a data-only snapshot with safe local interactions such as tabs, accordion, chart hover/focus, and code copy. It cannot mutate enterprise data; use an installed enterprise Declarative/Native extension for real business actions.
- Never invent enterprise metrics or present model-created data as authoritative. Explicitly label all example, estimated, or simulated values.
- For an LLM reinforcement-learning flow, cover data/prompt collection, response generation, preference or reward signal, policy optimization, and evaluation/iteration as appropriate.
- Keep the OCIX result returned by the tool intact so OpenChamber can render it inside the conversation.
- Keep the final prose after a rendered View to one short conclusion or next-step sentence; do not repeat its metrics, tables, or sections.

## HTML Artifact escalation

Follow the bundled HTML Artifact authoring contract: use a self-contained responsive document, prefer Host `--ocix-*` tokens, and keep Static Artifact as the default. Keep `html`, `body`, and the outermost page shell transparent; do not draw a second full-page border or hard-code a white canvas. Use muted/token surfaces only for inner semantic regions.

Use `html_artifact` when the user explicitly requests an HTML Artifact, or after the installed business/MCP and Generated Declarative checks when the task needs a visual effect or local interaction unavailable in the standard component library. Playback/pause, sliders, drag, animated simulation, a parameter-driven optimizer, and a completely custom SVG topology explorer are HTML Artifact cases. A standard Git commit graph should use `interactive_ui` with `git-graph`, not HTML.

- `scripts` is always explicit: use `scripts=false` for a document with no executable markup; if HTML contains any `<script>` or `on*` handler, set `scripts=true`. The Tool rejects contradictory declarations instead of returning a non-renderable result.
- Use ordinary HTML5 script text without CDATA or comment wrappers. The Tool preflights forbidden markup, remote resources, and execution capabilities; if preflight rejects the page, remove the named capability and retry once instead of returning a success claim.
- Prefer static HTML/CSS/SVG. Set `scripts=true` only for necessary local interaction and only when the current Host advertises script support.
- Prefer the exact Host tokens `--ocix-surface`, `--ocix-surface-muted`, `--ocix-surface-subtle`, `--ocix-foreground`, `--ocix-muted-foreground`, `--ocix-border`, `--ocix-primary`, `--ocix-success`, `--ocix-warning`, and `--ocix-error`; include readable light/dark fallbacks where a token may be unavailable.
- Do not use fetch, XHR, WebSocket, EventSource, Beacon, forms, popups, downloads, iframe, object/embed, Worker, WebAssembly, eval, local storage, cookies, remote fonts, images, scripts, or styles.
- HTML Artifact cannot access Tools, MCP, Business Gateway, Connector, credentials, files, clipboard read, or parent DOM.
- Never use HTML Artifact to bypass an installed enterprise Tool or to contact a CRM/ERP/API directly.
- Clearly label user-provided, inferred, example, and simulated data in `summary` and inside the page.
- Preserve the exact result returned by `html_artifact`; do not wrap it in Markdown.
