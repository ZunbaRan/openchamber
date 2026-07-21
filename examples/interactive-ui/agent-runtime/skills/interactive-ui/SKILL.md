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
- Choose only the components that fit the task: `metric-grid`, `chart`, `table`, `comparison`, `flow`, `timeline`, `activity-feed`, `git-graph`, `tree`, `diff-summary`, `sparkline`, `progress`, `status`, `list`, `callout`, `code-block`, `divider`, and `text`.
- Prefer a compact information hierarchy: conclusion first, grouped evidence second, details last. Do not create a dashboard for a one-sentence answer.
- For charts, keep `chartSeries` and each point's `values` in the same order. Use `donut` for part-to-whole, `line`/`area` for trends, and `bar` for comparison.
- This tool produces a read-only snapshot. Do not imply that its buttons can change enterprise data; use an installed enterprise Declarative/Native extension for real business actions.
- Never invent enterprise metrics or present model-created data as authoritative. Explicitly label all example, estimated, or simulated values.
- For an LLM reinforcement-learning flow, cover data/prompt collection, response generation, preference or reward signal, policy optimization, and evaluation/iteration as appropriate.
- Keep the OCIX result returned by the tool intact so OpenChamber can render it inside the conversation.
- Keep the final prose after a rendered View to one short conclusion or next-step sentence; do not repeat its metrics, tables, or sections.

## HTML Artifact escalation

Follow `docs/HTML_ARTIFACT_AUTHORING_GUIDE.md` for the full envelope, theme, accessibility, Bridge, and verification contract. The deterministic reference fixtures live in `examples/interactive-ui/artifact-fixtures.mjs`.

Use `html_artifact` after the installed business/MCP and Generated Declarative checks only when the task needs a visual effect or local interaction unavailable in the standard component library. Examples include a parameter-driven optimizer simulator or a completely custom SVG topology explorer. A standard Git commit graph should use `interactive_ui` with `git-graph`, not HTML.

Keep `html`, `body`, and the outermost page shell transparent. The Host already supplies the shared surface and border, so do not add a second full-page card or hard-code a white canvas. Use `--ocix-*` muted/subtle surfaces only for inner semantic controls, charts, or nodes.

- `scripts` is always explicit: use `scripts=false` for a document with no executable markup; if HTML contains any `<script>` or `on*` handler, set `scripts=true`. The Tool rejects contradictory declarations instead of returning a non-renderable result.
- Prefer static HTML/CSS/SVG. Set `scripts=true` only for necessary local interaction and only when the current Host advertises script support.
- Prefer the exact Host tokens `--ocix-surface`, `--ocix-surface-muted`, `--ocix-surface-subtle`, `--ocix-foreground`, `--ocix-muted-foreground`, `--ocix-border`, `--ocix-primary`, `--ocix-success`, `--ocix-warning`, and `--ocix-error`; include readable light/dark fallbacks where a token may be unavailable.
- Make the document self-contained. Do not use fetch, XHR, WebSocket, EventSource, Beacon, forms, popups, downloads, iframe, object/embed, Worker, WebAssembly, eval, local storage, cookies, remote fonts, images, scripts, or styles.
- Make the document responsive inside the conversation column: use fluid width/viewBox layouts, avoid fixed viewport widths, and test narrow content widths. Prefer the injected `--ocix-*` tokens for script-enabled pages; static pages should use `color-scheme`/`prefers-color-scheme` and retain readable contrast in both host modes.
- HTML Artifact cannot access Tools, MCP, Business Gateway, Connector, credentials, files, clipboard read, or parent DOM.
- Never use HTML Artifact to bypass an installed enterprise Tool or to contact a CRM/ERP/API directly.
- Clearly label user-provided, inferred, example, and simulated data in `summary` and inside the page.
- Preserve the exact result returned by `html_artifact`; do not wrap it in Markdown.
