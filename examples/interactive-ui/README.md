# Interactive UI runnable example

This example exercises the implemented OCIX v1 vertical slice in the normal OpenChamber conversation flow with a real managed OpenCode process and a real local HTTP boundary:

- `agent-runtime/tools/interactive_ui.ts`: task-specific Declarative UI composition tool.
- `builtin-visualization`: safe generated-layout host plus the backward-compatible process-flow view.
- `agent-runtime/tools/crm_open_dashboard.ts`: enterprise CRM Agent tool.
- `acme-crm`: trusted Native CRM extension with live query and confirmed write action.
- `acme-sales/openchamber.extension.json`: enterprise extension manifest.
- `acme-sales/ui/declarative/sales-summary.view.json`: Declarative view.
- `acme-sales/dist/ui.mjs`: trusted Native ESM extension registering a React component through the Host SDK.
- `mock-business-server.mjs`: stateful sales and CRM API with bearer auth and revision-aware writes.

For a new enterprise module, start with the repository template instead of copying demo IDs:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path --id com.acme.operations --name "Acme Operations" --tool-prefix operations
node scripts/interactive-ui-extension.mjs validate /absolute/new/path
```

The complete workflow and current production limitations are documented in `docs/INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md`. The repository Agent workflow is `.agents/skills/build-openchamber-interactive-extension/SKILL.md`.

## Run the Agent conversation demo

From the repository root:

```bash
bun run demo:interactive-ui
```

Open the URL printed as `OpenChamber Agent demo` (normally `http://127.0.0.1:47832`), create a session in this repository, then test these prompts in order:

1. `给我看看 LLM 强化学习的流程`
2. Only if the first prompt does not select the tool: `使用 interactive_ui 画一下 LLM 强化学习的流程`
3. `把最近一周的模型调用量、成功率和延迟做成一个运营看板，数据可以用示例值`
4. `打开企业 CRM，看看客户和商机管道`

The command builds the real Web client, starts the mock business system, starts OpenChamber with a managed OpenCode process, loads the two Custom Tools from `agent-runtime`, installs all example extensions, and waits until `interactive_ui` and `crm_open_dashboard` are discoverable. It reuses the user's configured OpenCode provider/model credentials; at least one working model must already be configured.

The expected path is the real product path:

```text
user prompt
  -> OpenCode Agent selects Custom Tool
  -> tool returns strict OCIX JSON
  -> OpenChamber receives the completed ToolPart
  -> ToolPart auto-expands the first valid OCIX result
  -> Declarative or Native view renders inline in chat
  -> optional Business Gateway query/write
  -> inline view refresh
```

The standalone Native and Declarative pages printed by the command are developer-only renderer harnesses. They are not the product acceptance criterion.

Clicking **推进** in the CRM view follows the production-shaped path:

```text
Native CRM View
  -> OpenChamber Business Host
  -> POST /api/interactive-ui/actions/crm.opportunity.advance
  -> confirmation-required response
  -> browser confirmation
  -> confirmed Gateway request
  -> server-side bearer injection
  -> mock business API revision check
  -> updated opportunity response
  -> View refresh
```

## Run the automated system test

```bash
bun run test:interactive-ui
```

The test starts two actual HTTP servers and verifies three-extension discovery, tool/view binding, generated-layout and process-flow loading, Native sales/CRM bundle serving, secret non-disclosure, business queries, confirmation enforcement, revision-aware writes, and refreshed state.

## Manual split-process setup

Start the mock API on its stable development port:

```bash
bun run demo:interactive-ui-api
```

Then start OpenChamber/OpenCode with the example roots:

```bash
export OCIX_DEMO_API_URL=http://127.0.0.1:47831
export OCIX_DEMO_TOKEN=demo-secret
export OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR="$PWD/examples/interactive-ui"
export OPENCODE_CONFIG_DIR="$PWD/examples/interactive-ui/agent-runtime"
bun run start:web
```

The Agent can discover `interactive_ui` and `crm_open_dashboard`; their completed string outputs are strict OCIX envelopes consumed by the ordinary conversation `ToolPart`.
