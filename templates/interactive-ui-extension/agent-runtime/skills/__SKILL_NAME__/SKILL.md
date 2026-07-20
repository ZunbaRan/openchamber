---
name: __SKILL_NAME__
description: Use when the user asks to view or operate __EXTENSION_NAME__ data, metrics, pending work, or enterprise workflow.
---

# __EXTENSION_NAME__ Interactive UI

- Use `__TOOL_PREFIX___open_overview` for standard metrics, status, and tables.
- Use `__TOOL_PREFIX___open_workspace` for the richer installed workspace or confirmed business writes.
- Ask for the business scope only when it materially changes the result; otherwise use `default`.
- Never claim a write succeeded until the installed UI or business tool returns success.
- Do not request, expose, or place API tokens in tool arguments or UI output.
