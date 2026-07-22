# Interactive UI runnable example

This example exercises the implemented OCIX v1 vertical slice in the normal OpenChamber conversation flow with a real managed OpenCode process and a real local HTTP boundary:

- `agent-runtime/tools/interactive_ui.ts`: task-specific Declarative UI composition tool.
- `agent-runtime/tools/html_artifact.ts`: strict static or scripts-opt-in HTML Artifact tool for custom SVG, simulators, and explorers that the Declarative DSL cannot reasonably express.
- `artifact-fixtures.mjs`: deterministic static SVG, learning-rate simulator, and topology explorer fixtures used by acceptance tests.
- `unified-acceptance-corpus.json`: frozen 17-case bilingual corpus for the cross-model routing matrix, including installed third-party HTML Artifact selection.
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
Artifact authors should also follow `docs/HTML_ARTIFACT_AUTHORING_GUIDE.md`.

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
5. `使用 html_artifact 画一个自定义 SVG 神经网络拓扑图，使用静态 HTML/CSS/SVG，不要脚本，并标明这是示意图`
6. `使用 html_artifact 做一个紧凑的本地学习率模拟器（模拟数据），包含 range slider 和实时变化的 SVG loss curve；scripts=true，不使用网络或存储`

The command builds the real Web client, starts the mock business system, starts OpenChamber with a managed OpenCode process, loads the three Custom Tools from `agent-runtime`, installs all example extensions, enables interactive Artifact scripts for this local demo only, and waits until `interactive_ui`, `html_artifact`, and `crm_open_dashboard` are discoverable. It reuses the user's configured OpenCode provider/model credentials; at least one working model must already be configured.

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

An Artifact takes a separate path and never receives business credentials:

```text
user prompt requiring custom temporary UI
  -> Agent selects html_artifact after Declarative is judged insufficient
  -> strict openchamber://html-artifact-result/v1 Tool output
  -> content-address materialization from message history
  -> sandboxed iframe with CSP (empty sandbox for static; allow-scripts only for opt-in interactive)
  -> narrow theme/resize/follow-up Bridge
  -> inline, workspace, or fullscreen display with ordinary Tool fallback
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

The test starts two actual HTTP servers and verifies three-extension discovery, Tool/View binding, generated-layout and process-flow loading, Native sales/CRM bundle serving, secret non-disclosure, business queries, confirmation enforcement, revision-aware writes, refreshed state, Artifact routing/capabilities, static and interactive materialization, CSP, Bridge bootstrap, and content-address cache hits.

Run the repeatable visual smoke after UI changes:

```bash
bun run test:interactive-ui-visual
```

This uses the real `InteractiveUIView`, extension descriptors, Native bundles and mock Business Gateway across Generated, Installed Declarative, Native Sales and Native CRM. It checks light/dark, 1440/1024/768/390 px, zh-CN/en, local table overflow and browser runtime errors, then writes stage screenshots to `.tmp/interactive-ui-visual-smoke/`. It remains a developer fixture; final product acceptance still requires the normal conversation flow.

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

The Agent can discover `interactive_ui`, `html_artifact`, and `crm_open_dashboard`. Installed/generic UI Tools return strict OCIX envelopes; `html_artifact` returns its separate strict Artifact envelope. Both are consumed by the ordinary conversation `ToolPart` with fallback preserved.
