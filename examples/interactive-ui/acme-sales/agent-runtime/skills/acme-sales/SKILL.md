---
name: acme-sales
description: Query the OCIX demo sales dashboard and inspect anomalous orders.
---

# Demo sales dashboard

Use `sales_get_summary` for a standard sales summary. Use `sales_get_dashboard` when the user asks for the richer interactive dashboard or order workflow.

- Ask for a region and `YYYY-MM` period only when they are missing.
- Keep the tool's Interactive Result Envelope intact; do not rewrite it as prose.
- Let OpenChamber render the returned Native view.
- After either sales Tool returns, stop selecting visualization tools: its OCIX View is already the primary UI. Do not call `interactive_ui` or `html_artifact` to restate the same sales data, and keep any final prose to one short conclusion.
- UI approval actions are deterministic Gateway calls and do not need a second Agent turn.
