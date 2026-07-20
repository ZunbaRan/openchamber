---
name: interactive-ui-visualization
description: Compose task-specific Interactive UI in the conversation when a dashboard, chart, table, comparison, status summary, plan, process, or other visual explanation is more useful than prose.
---

# Interactive UI visualization

Use the `interactive_ui` tool when structured visual presentation is more useful than prose. The tool is a composition grammar, not a catalog of fixed templates: design the sections and widgets for the current task.

This is the first choice for an inline answer in OpenChamber. Call `interactive_ui` directly instead of loading a generic HTML-report, dashboard, data-analysis, or visualization skill. Only choose a file/site/report workflow when the user explicitly asks for HTML, a website, or a downloadable artifact.

- Trigger for Chinese requests such as “给我看看”, “画一下”, “可视化”, “做个看板”, “对比一下”, “流程图”, or “步骤图”.
- Trigger for English requests such as “show me”, “visualize”, “make a dashboard”, “compare”, or “draw the workflow”.
- Proactively use it for data-rich answers when metrics, a chart, a table, or a status layout would materially improve comprehension.
- Choose only the components that fit the task: `metric-grid`, `chart`, `table`, `flow`, `progress`, `status`, `list`, `callout`, and `text`.
- Prefer a compact information hierarchy: conclusion first, grouped evidence second, details last. Do not create a dashboard for a one-sentence answer.
- For charts, keep `chartSeries` and each point's `values` in the same order. Use `donut` for part-to-whole, `line`/`area` for trends, and `bar` for comparison.
- This tool produces a read-only snapshot. Do not imply that its buttons can change enterprise data; use an installed enterprise Declarative/Native extension for real business actions.
- For an LLM reinforcement-learning flow, cover data/prompt collection, response generation, preference or reward signal, policy optimization, and evaluation/iteration as appropriate.
- Keep the OCIX result returned by the tool intact so OpenChamber can render it inside the conversation.
