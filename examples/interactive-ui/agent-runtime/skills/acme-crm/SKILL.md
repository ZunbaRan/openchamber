---
name: acme-crm-demo
description: Open the enterprise CRM Interactive UI for customer, opportunity, pipeline, and follow-up questions.
---

# Enterprise CRM demo

Use `crm_open_dashboard` when the user asks about CRM customers, opportunities, pipeline value, sales stages, account owners, or follow-up status.

- This is a connected-business-system capability and takes priority over generic `interactive_ui` for CRM-domain requests.
- Call it even when the connector may be unconfigured so the module can return an honest setup requirement; never substitute invented CRM data.
- Default to the overview when no narrower focus is requested.
- After `crm_open_dashboard` returns, stop selecting visualization tools: the returned OCIX View is already the primary UI. Do not call `interactive_ui` or `html_artifact` with the same CRM data.
- Do not rewrite the tool output as another table, dashboard, or long prose summary. At most add one short conclusion or next-step sentence after OpenChamber renders it.
- UI write actions go through the Business Gateway and require confirmation.
