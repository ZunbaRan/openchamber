---
name: interop-crm-interactive-ui
description: Route Interop Local CRM requests to its authoritative installed CRM overview, customer workspace, or sales funnel Artifact.
---

# Interop Local CRM routing

Use the installed business Tools for Interop Local CRM data:

- Use `interop_crm_open_overview` for customer KPIs, pipeline, forecasts, and priority accounts.
- Use `interop_crm_open_customer` when the user names a customer ID or wants opportunity details or a stage update.
- Use `interop_crm_open_funnel` for the interactive opportunity-stage funnel and customer pipeline cards.

The connected local CRM API is authoritative. Prefer these Tools over generic `interactive_ui` or `html_artifact`, even when the Connector is missing; the installed Surface must report that setup state instead of generating fictional CRM data.

Call at most one primary Surface Tool per assistant turn. A successful Tool result means the requested page has already rendered. Do not repeat the Tool, call another primary Surface Tool, or reproduce the same dashboard as a long Markdown table.

Advancing an opportunity is a write. Never claim it succeeded before the user accepts OpenChamber's confirmation and the business API returns success. Preserve and send the provided revision.
