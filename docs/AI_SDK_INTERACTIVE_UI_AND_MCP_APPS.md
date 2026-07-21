# OpenChamber Interactive UI 实施方案与 MCP Apps Roadmap

> 视觉升级、HTML Artifact Runtime 和最终统一测试的详细执行顺序见 [Interactive UI 视觉、HTML Artifact 与统一验收计划](./INTERACTIVE_UI_VISUAL_HTML_ARTIFACT_AND_UNIFIED_TEST_PLAN.md)。

> **文档性质**：fork 内部决策记录与实施方案（不提交 upstream PR）
> **分支**：`docs/interactive-ui-mcp-apps`  
> **当前决策**：优先实现 **Interactive UI**；**MCP Apps 延后到 Roadmap**
> **更新日期**：2026-07-20

> Declarative / Native 双 runtime、企业扩展包规范和 Native 模块端到端调用路径详见 [OpenChamber Interactive UI 扩展架构与企业模块开发规范](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)。实际开发步骤见 [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)。

---

## 1. 结论摘要

OpenChamber 当前不需要替换 OpenCode 消息流，也不需要引入第二套 Agent runtime，就可以实现高质量的 Interactive UI。

当前阶段采用以下方案：

1. 保留 OpenCode 的 Session、消息、tool call、Permission 和 SSE 数据链路。
2. 在 OpenChamber 现有 `ToolPart` 渲染路径前增加一个小型、类型安全的 **Interactive UI Registry**。
3. 将可信的结构化 tool output 映射为 OpenChamber 自有 React 组件。
4. 未注册、数据不合法或渲染失败的 tool 一律回退到现有通用 Tool UI。
5. 第一阶段不接入 AI SDK `useChat`、AI SDK Agents、RSC，也不新增 MCP Apps runtime。
6. MCP Apps 保留为后续标准化方向，待 OpenCode 能完整传递 MCP Apps capability、tool metadata 与 resource 后再实施。
7. 如果未来需要修改 OpenCode，采用“OpenChamber 安装包内置定制 OpenCode 二进制、独立受管进程”的产品级融合，不做同进程源码融合。
8. 通用 `interactive_ui` 不按天气、流程、看板逐个内置模板；Agent 使用有界 Declarative 语法按任务组合 UI，Host 重新校验后同页渲染。
9. Declarative 无法表达的临时模拟器/探索器保留 Agent HTML Artifact 路线，但任意生成代码只能在透明、自适应高度的 sandbox 中运行，不能持有业务 token。

这条路线可以先获得 Interactive UI 的产品价值，同时把对 OpenCode 与 upstream 的侵入降到最低。

### 1.1 长期三层结构与当前状态

Roadmap 现在明确以三层结构组织能力，不再把“生成 UI”视为一种单一 runtime：

| 层 | 定位 | 当前状态（2026-07-20） |
|---|---|---|
| **Agent Generated Declarative** | 模型按任务组合平台 primitive；同页 renderer 安全重建；只处理 snapshot | **v1 已实现**：指标、图表、表格、流程、列表、状态和说明 |
| **Installed Declarative / Trusted Native** | 企业开发者安装长期模块；经 Gateway 查询真实 API，并执行确认式写入 | **Managed Distribution Preview 已实现**：runtime、Gateway、脚手架、validator、自描述 Ed25519 `.ocix`、确认式信任、Tool/Skill 全局受管安装、Extension Manager、升级回滚、签名市场目录与 Connector Authentication v1 |
| **HTML Artifact** | Agent 生成 HTML/CSS/SVG/受限 JS，用于模拟器、自定义图形和探索器 | **Runtime v1 已实现**：独立严格 schema、Agent Tool、内容寻址存储、历史重放、静态/脚本 feature gate、sandbox/CSP、主题与高度 Bridge、inline/workspace/fullscreen 和 fallback；不持 token、不直连 Tool/Gateway |

这里“Managed Distribution Preview 已实现”表示客户端分发链完整，不表示 OpenChamber 已经运营官方公共市场。审核、签名密钥吊销、透明日志和托管服务仍是公共生态的运营治理。业务 Key 的 scope、RBAC/ABAC、撤销和业务审计由第三方系统负责，OpenChamber 不建设第二套多用户权限系统。

---

## 2. 决策记录

| 编号 | 决策 | 原因 |
|---|---|---|
| D1 | Interactive UI 是当前优先级 | 现有 tool output 已能到达共享 UI，改造范围可控 |
| D2 | MCP Apps 延后 | 当前 OpenCode MCP 边界没有提供完整的 MCP Apps host 所需信息 |
| D3 | 不用 AI SDK `useChat` 替换主聊天 | 会与 OpenCode Session、SSE、Permission、多 Agent 和 Worktree 状态重复 |
| D4 | 第一阶段采用可信组件注册表 | 易测试、可控、安全，且能与现有主题和 Runtime APIs 结合 |
| D5 | Interactive UI 必须有通用回退 | 保证未知 tool、旧消息和 schema 漂移不会破坏聊天记录 |
| D6 | 扩展点独立于大型 `ToolPart.tsx` | 降低与 OpenChamber upstream 高频更新的合并冲突 |
| D7 | 未来定制 OpenCode 时保持进程边界 | 用户仍可无感安装，同时保留隔离、升级和 API 契约 |
| D8 | 通用可视化使用 Agent Generated Declarative | 任务不需要预先对应某个固定模板，同时保持同页 renderer 的安全和主题一致性 |
| D9 | Agent HTML Artifact 与企业 Native 分离 | 前者是不可信临时代码，后者是管理员安装的可信业务代码，不能共享权限模型 |

### 2.1 本阶段成功标准

- 注册的 tool 可以根据运行状态和结构化结果渲染专属 React UI。
- Interactive UI 在 Web、Desktop、VS Code、Hosted Mobile 和 Capacitor Mobile 上有明确行为。
- 未注册 tool 的现有渲染行为不变。
- 输出缺失、schema 不匹配、执行失败和组件异常都有可见回退。
- 不允许 tool output 注入任意 React、HTML 或 JavaScript。
- 核心改动集中在新增模块和一个稳定的 renderer 接入点。
- upstream `main` 更新可以持续合并，不需要长期重写消息层。

### 2.2 已实现的对话流验收（2026-07-18）

当前实现已经从独立 renderer harness 推进到正常 OpenChamber 对话流。推荐用 `bun run demo:interactive-ui:start` 在后台启动，再用 `bun run demo:interactive-ui:stop` 可靠停止；启动脚本会构建 Web、启动模拟企业 HTTP API、受管 OpenCode 和完整 OpenChamber，并等待 `interactive_ui` 与 `crm_open_dashboard` 两个 Custom Tool 被 OpenCode 发现。运行日志保存在 `.tmp/interactive-ui-demo/demo.log`。原有 `bun run demo:interactive-ui` 仍保留为需要前台输出时的调试入口。

已在真实会话中验证：

1. 输入“给我看看 LLM 强化学习的流程”时，模型可以主动调用 `interactive_ui`，ToolPart 自动展开 Declarative 流程组件。
2. 如果模型没有主动选择，明确输入“使用 interactive_ui 画一下 LLM 强化学习的流程”可以作为确定性兜底。
3. 输入“打开企业 CRM，看看客户和商机管道”时，模型可以调用 `crm_open_dashboard`，加载 Native CRM 模板，通过 Business Gateway 查询模拟企业 API，并完成带确认的商机阶段写操作和刷新。

当前新增的 generated-layout 自动验证已经覆盖 Agent 组合的指标、折线图和文本布局，以及对 action、query、binding 和未知节点的拒绝。真实会话新增验收提示为：“把最近一周的模型调用量、成功率和延迟做成一个运营看板，数据可以用示例值”。

独立的 `/interactive-ui-demo.html` 页面继续保留为开发者调试工具，但不再作为产品功能验收标准。

---

## 3. 已验证的现有架构

### 3.1 当前消息与渲染链路

```text
OpenCode
  └─ Session / Message / ToolPart / Permission
        ↓ @opencode-ai/sdk/v2 + OpenChamber sync
OpenChamber MessageBody
        ↓ part.type === "tool"
ToolPart
        ↓ 根据 tool name、state、input、output、metadata 渲染
现有专用 UI 或通用可展开 Tool UI
```

关键入口：

- `packages/ui/src/components/chat/message/MessageBody.tsx`：消息 part 编排并把 tool part 交给 `ToolPart`。
- `packages/ui/src/components/chat/message/parts/ToolPart.tsx`：现有 tool 状态、描述和专用内容渲染中心。
- `packages/ui/src/components/chat/message/parts/toolRenderUtils.ts`：tool 名称规范化及静态/可展开行为。
- `packages/ui/src/sync/`：OpenCode 消息与状态同步，不应被 Interactive UI 重新实现。

现有代码已经允许 custom、plugin 和 MCP tool 使用通用 Tool UI 展示 input/output，因此 Interactive UI 应当是这个通用路径的增强，而不是新的消息协议。

### 3.2 OpenCode 与 MCP 的边界

OpenChamber 目前主要通过 OpenCode SDK 管理 MCP 配置、连接状态和 tool 结果；实际 MCP client、tool discovery 与 tool execution 由 OpenCode 持有。

这意味着：

- 普通 Interactive UI 只依赖最终到达 `ToolPart` 的可信结构化数据，可以立即建设。
- 完整 MCP Apps host 还需要 OpenCode 配合 capability negotiation、保留 `_meta.ui.resourceUri`、读取 `ui://` resource，并代理 App 发起的 tool call。
- 仅在 OpenChamber UI 侧增加 iframe renderer，不能自动补齐上述协议链路。

### 3.3 OpenCode 的产品级内置现状

Packaged Desktop 已经会下载与固定 `@opencode-ai/sdk` 版本匹配的 OpenCode CLI，将其放入 Electron resources，并优先作为受管本地服务启动。用户在 Desktop 场景下不需要单独安装 OpenCode。

相关实现：

- `packages/electron/README.md` 的 **Bundled OpenCode CLI** 章节。
- `packages/electron/scripts/prepare-opencode-cli.mjs` 的平台 artifact 下载与版本校验。
- `packages/web/server/lib/opencode/lifecycle.js` 的受管 OpenCode 启动与健康检查。

这个边界也是未来定制 OpenCode 的推荐基础，但不属于当前 Interactive UI 的前置工作。

---

## 4. Interactive UI 的定义与范围

### 4.1 本文所指的 Interactive UI

Interactive UI 是：

> 模型或 Agent 调用一个已知 tool，tool 返回可序列化结构化数据，OpenChamber 根据 tool identity、状态和经过校验的数据渲染可信 React 组件；通用 tool 允许模型从平台组件语法中按任务组合布局。

它不是让模型在主页面生成并执行任意前端代码。模型可以决定组件、分区和数据，但最终可执行的 renderer 仍由 OpenChamber 仓库预先实现和注册。

典型场景：

- 项目健康度、测试结果、依赖状态仪表盘。
- Code review 摘要、风险项过滤和文件跳转。
- 发布检查清单、审批卡和分步骤表单。
- 可筛选日志、图表、时间线和状态卡。
- 文件、diff、命令和 session 的上下文操作。

### 4.2 第一阶段包含

- tool name 到 React renderer 的注册机制。
- pending/running、completed、error 等状态的统一表示。
- input、output、metadata 的运行时校验。
- loading、empty、invalid、error 和 fallback UI。
- 组件内的本地交互：筛选、排序、展开、复制、选择和导航。
- 通过现有 `RuntimeAPIs` 执行明确允许的跨平台操作。
- Web、Desktop、VS Code 和 Mobile 的响应式表现。

### 4.3 第一阶段不包含

- AI SDK `useChat` 或 AI SDK stream protocol。
- 模型直接生成 React、HTML 或 JavaScript。
- 任意远程 HTML、iframe 或 `dangerouslySetInnerHTML`。
- MCP App Bridge、`ui://` resource 和 app-visible tool proxy。
- 第二套 model/provider/tool execution runtime。
- 为 Interactive UI 修改 OpenCode 核心协议。

---

## 5. 推荐技术设计

### 5.1 模块划分

建议新增独立目录：

```text
packages/ui/src/components/chat/interactive-ui/
├── types.ts                       # 公共类型与规范化状态
├── registry.ts                    # 注册、查找和冲突检查
├── normalizeToolPart.ts           # OpenCode ToolPart → 安全上下文
├── InteractiveToolRenderer.tsx    # 统一错误边界与 fallback 协调
├── schemas/                       # 可复用 zod schema
└── components/
    ├── ProjectHealthCard.tsx
    └── ReviewSummaryCard.tsx
```

对现有 `ToolPart.tsx` 的修改应尽可能小：在准备好规范化的 tool context 后调用 `InteractiveToolRenderer`；当 registry 未命中时，继续执行现有渲染路径。

不要把更多业务组件直接堆进 `ToolPart.tsx`。

### 5.2 注册表契约

概念接口：

```ts
type InteractiveToolStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

interface InteractiveToolContext {
  id: string;
  toolName: string;
  status: InteractiveToolStatus;
  input: unknown;
  output: unknown;
  metadata: unknown;
  error: unknown;
  directory: string;
}

interface InteractiveToolDefinition<TInput, TOutput> {
  id: string;
  toolNames: readonly string[];
  parseInput: (value: unknown) => TInput;
  parseOutput: (value: unknown) => TOutput;
  render: (context: InteractiveToolContext & {
    input: TInput;
    output: TOutput;
  }) => React.ReactNode;
}
```

实现时可以根据实际状态拆分 loading 与 final renderer，但必须保留这些约束：

- registry key 使用统一规范化后的 tool name。
- 同一个 key 重复注册时在开发/测试阶段直接失败，避免静默覆盖。
- `input`、`output` 和 `metadata` 在进入专用组件前必须验证。
- schema 失败返回通用 Tool UI，不把异常传播到整个消息列表。
- renderer 外层必须有独立错误边界。
- 注册表不持有 Session 或全局业务状态；组件通过已有 hooks/Runtime APIs 获取需要的能力。

项目已经依赖 `zod`，第一阶段可以直接使用它校验结构化 output，不需要增加新依赖。

### 5.3 状态规范化

当前 `ToolPart` 会处理 `completed`、`error`、`aborted`、`failed`、`timeout`、`cancelled` 等状态。Interactive UI 不应让每个组件重复解释这些原始值。

建议映射：

| OpenCode 原始状态 | Interactive UI 状态 | 默认表现 |
|---|---|---|
| 尚未开始/输入生成中 | `pending` | skeleton 或参数预览 |
| 运行中 | `running` | 保留上一次权威数据并显示进行中 |
| `completed` | `completed` | 校验 output 后渲染完整组件 |
| `error` / `failed` / `timeout` | `error` | 错误卡 + 通用 tool 详情入口 |
| `aborted` / `cancelled` | `cancelled` | 已取消状态，不伪装成功 |
| 未知值 | 通用 fallback | 保留原始 tool 内容 |

不得用“缺少 output”推断执行成功；最终状态必须以 OpenCode 的权威状态为准。

### 5.4 Renderer 选择流程

```text
收到 ToolPart
  ↓
规范化 tool name 与状态
  ↓
查询 Interactive UI Registry
  ├─ 未命中 ─────────────→ 现有 ToolPart renderer
  └─ 命中
       ↓
    校验 input/output
       ├─ 失败 ──────────→ 现有 ToolPart renderer + 可诊断日志
       └─ 成功
            ↓
       专用 React 组件
            ├─ 渲染异常 ─→ 局部错误回退
            └─ 正常
```

### 5.5 交互与安全边界

第一阶段的 Interactive UI 是受信任宿主组件，但其数据仍不可信：

- 将所有 tool input/output 视为外部数据并验证。
- 文本通过 React 普通节点渲染，不拼接 HTML。
- URL、文件路径和命令参数必须按现有 Runtime API 规则校验。
- 需要修改文件、运行命令或调用受保护操作时，继续使用现有 Permission 机制。
- 组件不得直接导入 Electron、VS Code API 或假设本地文件系统存在。
- 跨运行时操作通过 `RuntimeAPIs`；不支持的 runtime 应明确禁用或降级。
- 大数组、日志和图表需要限制渲染量，避免一个 tool result 卡住整个消息列表。

---

## 6. 分阶段实施计划

### Phase 0：基础设施

- 建立 `interactive-ui` 目录、类型、状态规范化和 registry。
- 在 `ToolPart` 增加单一接入点。
- 实现 schema failure、unknown tool 和 renderer exception 回退。
- 为注册查找、状态映射和 schema 校验编写单元测试。

**完成条件**：没有注册任何业务组件时，现有所有 tool 的渲染结果保持不变。

### Phase 1：两个端到端示例

建议先选择两个结构不同的 tool：

1. `project_health`：卡片、指标、状态列表和文件跳转。
2. `review_summary`：分组、筛选、风险级别和 diff/file 导航。

示例名称最终以实际 tool identity 为准，不应仅凭 output 形状猜测 renderer。

**完成条件**：

- loading、completed、empty、invalid、error、cancelled 都有覆盖。
- 同一历史消息重载后能确定性地恢复同一 UI。
- Desktop/Web/VS Code 可正常操作，Mobile 有可用的窄屏布局。
- 未注册 tool 和旧消息无回归。

仓库中的实际纵向切片已采用“通用 Agent Generated Declarative + 企业 Native CRM”，不再以两个固定业务 renderer 作为最终结构。

### Phase 2：组件平台化

- 提取并实现 Text、Callout、Metric、Progress、Status、Flow、List、DataTable、Bar/Line/Area/Donut Chart 等可信基础组件。
- 由 `interactive_ui` 暴露高层组合参数，Tool 规范化为 `data.layout`，客户端 generated-layout 边界再次按 allowlist 重建。
- generated snapshot 不允许 query、action、binding 或宿主访问；企业能力继续由安装式 Declarative/Native 扩展承载。
- 建立组件注册规范、schema 版本和弃用策略。
- 增加 lazy loading，避免大型可视化进入聊天首屏 bundle。
- 为可访问性、键盘操作、主题和移动端建立验收清单。

### Phase 3：结构化增量更新（可选）

只有当 OpenCode 提供权威且可重放的增量结构化数据时，再支持 streaming/partial UI。

在此之前，不根据不完整文本做启发式 JSON 解析，也不引入 AI SDK stream protocol 形成第二套消息流。

---

## 7. 与 AI SDK 的关系

AI SDK 对当前阶段最有价值的是设计模式，而不是接管 runtime。

| 能力 | 当前决定 |
|---|---|
| tool result → React component | 借鉴并在现有 `ToolPart` 上实现 |
| model 作为动态 UI router | 借鉴，但从“选择预注册 tool 组件”扩展为“组合有界 Declarative primitives” |
| tool state 驱动 loading/result/error | 借鉴，映射到 OpenCode 权威状态 |
| `useChat` / `UIMessage` / AI SDK stream protocol | 不引入 |
| AI SDK Agents / provider abstraction | 不引入，避免双 runtime |
| AI SDK RSC / `streamUI` | 不引入，与 Vite/Electron 主栈不匹配 |
| zod schema | 使用仓库已有依赖 |
| MCP Apps helpers/renderer | Roadmap 阶段重新评估 |

Interactive UI 的核心不是“安装 AI SDK”，而是建立稳定的结构化数据契约和可信组件映射。

Vercel 文档中的 Generative UI 仍然要求开发者先给 tool 定义参数 schema 和 React `generate`/结果组件；模型在这些预注册能力之间路由。天气只是文档示例中的开发者组件，不是 AI SDK 自动提供的万能 UI。`streamUI` 可以让 tool 的 `generate` 返回或 yield ReactNode，但属于 AI SDK RSC 的实验路径，官方对生产新项目推荐 AI SDK UI。

OpenChamber 不引入第二套 AI SDK 消息 runtime，而是在现有 OpenCode ToolPart 上保留相同原则：模型只产生数据与组件选择，React 实现由平台控制。

### 7.1 ChatGPT/Codex 本地实现调研与 Artifact 路线

对本机已安装应用和用户提供 DMG 的只读资源检查发现，当前 ChatGPT/Codex Desktop 同时存在两类能力：

1. Documents、Presentations、Spreadsheets、Sites 等由 plugin/skill 创建的持久 Artifact。
2. `codex-inline-vis` 临时内联可视化：Agent 写入 HTML fragment，Host 注入统一 CSS/主题和图标，在专用 `codex-inline-visualization` 隔离环境中渲染。

后者的关键不在 iframe 外观，而在宿主体验：透明背景、内容高度通知、最大高度限制、主题/locale/timezone 注入、窄屏响应式，以及仅开放 follow-up message、外链等受控桥接。应用资源也明确拒绝 inline visualization 直接调用 tools。

这验证了 OpenChamber 的路线；当前实现状态是：

- **默认**：Agent Generated Declarative，同页、安全，覆盖大部分数据型任务。
- **表现力兜底**：HTML Artifact，用于自定义 SVG、模拟器和探索器；隔离层视觉无感，但安全边界真实存在。
- **企业模块**：继续使用安装式 Declarative/Trusted Native，通过 Gateway 获得真实业务 API 能力。

详细证据、版本、调用路径和逆向边界见 [ChatGPT/Codex Desktop 可视化与 Artifact 本地静态调研](./CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md)。Vercel AI SDK UI、实验性 RSC `streamUI` 与本地实现的逐项对比见 [Vercel AI SDK Generative UI 实现与 ChatGPT/OpenChamber 对比](./VERCEL_AI_SDK_GENERATIVE_UI_IMPLEMENTATION_AND_COMPARISON.md)。

---

## 8. MCP Apps Roadmap

### 8.1 状态

**已确认方向可行，但不属于当前实施阶段。**

MCP Apps 已形成正式扩展规范：MCP tool 可以通过 `_meta.ui.resourceUri` 指向 `ui://` HTML resource，Host 在 sandboxed iframe 中渲染，并通过 `postMessage` JSON-RPC bridge 与 App 通信。

OpenChamber 适合作为 MCP Apps host，但当前架构中 MCP client 由 OpenCode 持有，因此不能只靠 UI 组件完成完整支持。

### 8.2 当前阻塞条件

进入实现前必须确认以下链路端到端可用：

1. OpenCode MCP client 初始化时声明 MCP Apps extension capability。
2. tool definition 的 `_meta.ui.resourceUri` 和 visibility 信息能到达 OpenChamber。
3. tool result 的 `structuredContent` 和相关 `_meta` 不被 OpenCode/SDK 丢弃。
4. Host 可以通过拥有该连接的 MCP client 读取 `ui://` resource。
5. App 发起的 tool call 可以经过 allowlist、Permission 和 server-side policy 后代理。
6. iframe sandbox、CSP、permissions、open-link 与跨 origin 策略完成安全评审。
7. Web、Desktop、VS Code 与 Mobile 的宿主能力差异有明确方案。

### 8.3 进入条件

满足下列任一技术路线后启动 MCP Apps spike：

- OpenCode upstream 原生提供所需 capability、metadata 和 resource API；或
- 维护一个最小化 OpenCode fork，补齐通用协议能力并生成匹配 SDK；或
- 经过验证的 OpenChamber companion MCP host 可以在不产生连接状态分裂的前提下完成上述职责。

### 8.4 未来实现选择

Roadmap 阶段比较两种 Host 实现：

- AI SDK：`@ai-sdk/mcp` helpers + `experimental_MCPAppRenderer`。
- MCP 官方：`@modelcontextprotocol/ext-apps` App Bridge 或等价自建 host。

选择依据应包括：API 稳定性、安全控制、是否要求 AI SDK `UIMessage`、与 OpenCode ToolPart 的适配成本，以及各 runtime 的支持情况。当前不提前锁定具体 renderer。

---

## 9. 定制 OpenCode 的长期方案记录

如果未来 MCP Apps 或其他扩展必须修改 OpenCode，采用以下原则：

```text
一个 OpenChamber 产品与安装包
├── OpenChamber UI / Server
└── 定制 OpenCode 可执行文件
      └── 独立受管子进程，通过 HTTP/OpenAPI/SSE 通信
```

### 9.1 推荐仓库与发布模型

- 保持 `OpenChamber fork` 和 `OpenCode fork` 两份独立历史。
- OpenChamber fork 持续同步 `openchamber/openchamber`。
- OpenCode fork 持续同步 `anomalyco/opencode`。
- OpenCode 定制 patch 尽量限制在 MCP capability、metadata preservation、resource/API 扩展点。
- CI 为 macOS、Windows、Linux 构建和签名定制 OpenCode binary。
- OpenChamber 发布固定 OpenCode binary、SDK 和 protocol compatibility 组合，并原子升级。
- 保留外部 OpenCode server/binary override，方便开发、诊断和高级部署。

### 9.2 不推荐的方式

- 不把 OpenCode 内部模块直接 import 到 Electron 或 OpenChamber Server 进程。
- 不把两个项目的源文件交叉混排成难以同步的单一 patch 集。
- 不允许 OpenCode binary 与 OpenChamber SDK 独立漂移升级。

该方案已经记录，但当前 Interactive UI 不依赖它，也不需要现在创建 OpenCode fork。

---

## 10. upstream 同步策略

当前 fork 应继续采用“干净主线 + 长期定制分支”：

```text
upstream/main
      ↓ 定期 merge
fork/main
      ↓
长期产品/功能分支
```

Interactive UI 实现需要特别控制冲突面：

- 新逻辑集中在 `interactive-ui/`，不要散落在消息和 sync 模块。
- `MessageBody.tsx` 不承载 registry 逻辑。
- `ToolPart.tsx` 只增加稳定接入点，不继续扩大业务分支。
- 不改 OpenCode SDK 类型；在适配层把 SDK 数据规范化为本地类型。
- schema 和组件按版本向后兼容，历史 Session 必须可回放。
- 小步、频繁合并 upstream，避免长期积累一次性巨型冲突。

---

## 11. 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| tool output schema 漂移 | zod 校验、schema version、通用 fallback |
| tool name 冲突或命名变化 | 规范化 key、重复注册失败、显式 alias |
| `ToolPart.tsx` upstream 冲突 | 新模块 + 单一 renderer 插槽 |
| 某 runtime 不支持组件操作 | Runtime capability 检查和明确降级 |
| 恶意或异常内容 | 不执行 HTML/JS、验证 URL/路径、限制渲染量 |
| 单个组件导致消息列表崩溃 | renderer 级 Error Boundary |
| 大型图表增加 bundle 与首屏成本 | lazy import、按需加载 |
| 增量数据覆盖最终权威数据 | 只采用权威状态，谨慎引入 partial UI |
| 未来 MCP Apps API 变化 | 延后选型，先满足进入条件再 spike |

---

## 12. 验证计划

### 自动验证

- registry 注册、alias、重复 key 与未命中测试。
- OpenCode 状态到 Interactive UI 状态的映射测试。
- input/output schema 成功与失败测试。
- renderer exception 不影响其他消息的测试。
- 历史 ToolPart 的确定性重放测试。
- 组件层 loading/empty/error/completed/cancelled 测试。

### 手动验收

- Web：刷新、切换 Session、历史消息恢复。
- Desktop：内置 OpenCode、文件打开和原生能力降级。
- VS Code：webview 尺寸、文件导航和 extension host 重连。
- Mobile：窄屏、触摸、横竖屏和远程 server 场景。
- 主题与可访问性：深浅色、键盘、focus、screen reader labels。

---

## 13. Roadmap

| 阶段 | 内容 | 状态 |
|---|---|---|
| Now | Interactive UI Registry、状态适配、fallback、测试 | **已实现 v1** |
| Now | 通用流程图与企业 CRM 对话流示例 | **已实现 v1** |
| Now | Agent Generated Declarative：任务级布局组合、安全清洗、图表/表格/流程/指标 | **已实现第一版** |
| Now | Installed Declarative / Trusted Native：Gateway 查询、确认式写入、脚手架、validator、开发手册与 skill | **Developer Preview v1 已实现** |
| Now | Installed UI 分发治理：自描述 Ed25519 `.ocix`、确认式信任、Agent Tool/Skill 全局受管安装、Extension Manager、启停/升级/回滚、签名 marketplace catalog | **Managed Distribution Preview 已实现** |
| Now | OCIX Connector Authentication v1：手工 Key、一次性连接码签发、Secret Store、连接测试/替换/断开和 Gateway 注入 | **已实现** |
| Next | 公共生态治理：审核、签名密钥吊销/透明日志、Host SDK 兼容窗口与官方托管市场 | **Roadmap** |
| Now | OCIX 固定色板、现有节点美化、进阶 Declarative primitives 与 Native Host UI Kit | **已实现；统一视觉验收进行中** |
| Now | Agent HTML Artifact：独立 schema、Tool、存储/重放、sandbox/CSP、透明自适应容器、主题/follow-up Bridge、展开模式 | **Runtime v1 已实现；统一安全与跨 runtime 验收进行中** |
| Next | 继续扩充可信基础组件、schema/version 规范和视觉回归基线 | **继续扩充组件集** |
| Next | 在 OpenCode 有权威增量数据后支持 partial/streaming UI | 条件性规划 |
| Later | MCP Apps capability 与 metadata 端到端 spike | **Roadmap** |
| Later | MCP App sandbox、App Bridge、tool proxy 与安全策略 | **Roadmap** |
| Later | 必要时维护定制 OpenCode sidecar binary | **Roadmap** |

Roadmap 表示技术方向，不代表已承诺发布日期。

---

## 14. 下一步

1. 完成 Declarative、Installed/Native 与 HTML Artifact 的统一功能、安全、明暗/窄屏视觉和历史回放验收，并固化可重复命令与证据。
2. 用更新后的 `$build-openchamber-interactive-extension` 将一个真实企业模块接入，验证 starter 之外的数据模型、错误和并发写入。
3. 继续扩充 Declarative 安全组件集，并为 schema 增加浏览器视觉回归基线；标准组件足够表达时仍不升级到 Artifact。
4. 按 [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md) 继续治理缓存配额、引用清理和跨 runtime 能力；不放宽 Connector/Token/网络边界。
5. 在现有签名/Extension Manager/版本治理之上增加签名密钥吊销、透明日志与恶意包响应；业务细粒度权限继续由第三方 API 通过 scoped Key 执行。
6. 为 VS Code 增加明确的 Gateway/Artifact 文档资源实现；在此之前保持稳定 unsupported。
7. MCP Apps 只跟踪上游能力变化，达到进入条件后另写 ADR 和 spike 方案。

---

## 15. 参考资料

- [OpenChamber Interactive UI 扩展架构与企业模块开发规范](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)
- [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)
- [OCIX Connector Authentication & Credential Provisioning v1](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)
- [ChatGPT/Codex Desktop 可视化与 Artifact 本地静态调研](./CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md)
- [Vercel AI SDK Generative UI 实现与 ChatGPT/OpenChamber 对比](./VERCEL_AI_SDK_GENERATIVE_UI_IMPLEMENTATION_AND_COMPARISON.md)
- [AI SDK UI – Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [AI SDK RSC – `streamUI`](https://ai-sdk.dev/docs/reference/ai-sdk-rsc/stream-ui)
- [AI SDK RSC – Streaming React Components](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components)
- [OpenCode – Server / OpenAPI architecture](https://opencode.ai/docs/server/)
- [OpenCode – Development and standalone executable build](https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md)
- [MCP Apps – Official overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps – Specification and examples](https://apps.extensions.modelcontextprotocol.io/)
- [Vercel – Add MCP Apps to an AI SDK application](https://vercel.com/kb/guide/ai-sdk-mcp-apps)

---

*范围：fork 内部定制记录，非 OpenChamber upstream 官方文档。*
