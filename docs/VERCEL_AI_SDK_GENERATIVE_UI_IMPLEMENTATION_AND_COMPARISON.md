# Vercel AI SDK Generative UI 实现与 ChatGPT/OpenChamber 对比

> 调研日期：2026-07-18<br>
> 依据：Vercel AI SDK 官方文档与本地 ChatGPT/Codex Desktop 静态调研<br>
> ChatGPT 证据说明见：[ChatGPT/Codex Desktop 可视化与 Artifact 本地静态调研](./CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md)

> **状态：历史调研快照，不是当前实现合同。** 文中的未来时表述已部分过期：HTML Artifact、MCP Apps 2026 Host 与 Artifact Style v2 token 注入均已实现。当前边界与P3.6门禁以 [AI SDK、Interactive UI 与 MCP Apps](./AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md) 和 [P3 后续能力实施蓝图](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md) 为准。

## 1. 结论

Vercel AI SDK 的生产推荐路线并不是“模型任意生成 React 页面”。它的稳定模式是：开发者定义 tool schema 和 React 组件，模型选择 tool 并生成参数/结果，应用按类型化 tool part 状态渲染对应组件。

AI SDK RSC 的 `streamUI` 可以让 tool 的 `generate` 返回或逐步 yield ReactNode，看起来更接近“流式生成组件”，但该路径属于实验性 AI SDK RSC。官方为生产新项目推荐 AI SDK UI。

ChatGPT/Codex Desktop 的 inline visualization 解决的是另一类问题：模型生成 HTML fragment，Host 在隔离环境中内联显示，获得比预注册 React 组件更自由的表现力。

OpenChamber 不需要二选一，而是把它们放入不同层：

- 借鉴 AI SDK UI：ToolPart 状态、tool → UI 映射、开发者组件、可重放结构化消息。
- 超越固定 tool 组件：Agent Generated Declarative 允许模型从有界 primitive 语法现场组合页面。
- 对齐企业场景：Installed Declarative / Trusted Native 连接真实 API 和确认式写入。
- 对齐自由生成：HTML Artifact 允许任意表现代码，但必须隔离。

## 2. AI SDK UI 的稳定实现

### 2.1 基本链路

官方 Generative User Interfaces 示例的核心路径是：

```text
开发者定义 tool
  ├─ inputSchema
  ├─ execute（可选，服务端业务逻辑）
  └─ 对应的前端 React component
        ↓
模型根据用户意图选择 tool 并生成参数
        ↓
UIMessage 流式传到客户端
        ↓
客户端遍历 message.parts
        ↓
根据 type = tool-<toolName> 和 state 渲染 loading/input/result/error UI
```

`useChat` 负责聊天消息、提交、状态和流式更新；`UIMessage` 保存适合前端渲染的 parts。工具 part 的类型由工具名和 schema 推导，客户端可以在 TypeScript 中穷举不同状态。

官方说明：[Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)、[`useChat`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)、[Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)。

### 2.2 为什么天气示例看起来很丰富

天气卡不是 AI SDK 内置的万能组件。示例开发者预先实现 weather tool、参数/结果 schema 和 Weather 组件；模型负责在合适时调用并填入城市等参数。

因此，增加股票、航班、订单、CRM 或天气通常需要：

1. 定义一个可被模型理解的 tool。
2. 定义输入和输出数据结构。
3. 写该数据结构对应的 React UI。
4. 在 tool part 的 loading/result/error 状态中挂载 UI。

AI SDK 提供的是消息与工具编排框架，不是自动生成所有领域组件的 UI 库。工具概念见官方 [Tools](https://ai-sdk.dev/docs/foundations/tools)。

### 2.3 可重放与持久化

AI SDK UI 把可序列化状态保存在 `UIMessage` parts 中。历史消息恢复时，应用根据同一 tool part 和状态重新渲染开发者组件。这比把 ReactNode 本身持久化更稳定，也适合客户端/服务端边界。

### 2.4 Tool 状态

典型工具 part 可以区分：

- 输入正在生成。
- 输入已可用，等待执行或用户确认。
- 结果已可用。
- 结果错误。

组件可以针对每个状态提供 skeleton、确认 UI、结果卡和错误反馈。这一思想与 OpenChamber 复用 OpenCode 权威 ToolPart 状态完全兼容。

## 3. AI SDK RSC 与 `streamUI`

### 3.1 机制

`streamUI` 在服务端把模型文本和 tool 调用转换成 React Server Component stream。tool 的 `generate` 可以：

- 直接返回 ReactNode。
- 使用 async generator 先 yield loading UI，再返回完成 UI。

这使服务端工具实现和生成 UI 非常紧密，官方示例中可以在工具执行时流出加载卡再替换为结果卡。参考 [`streamUI` API](https://ai-sdk.dev/docs/reference/ai-sdk-rsc/stream-ui) 与 [Streaming React Components](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components)。

### 3.2 为什么 OpenChamber 不直接采用

AI SDK RSC 官方仍标记为实验性，并推荐生产使用 AI SDK UI。迁移文档还列出了 RSC 路线在传输、已关闭 stream 更新、并行和多步 tool call 等方面的限制。参考 [AI SDK RSC Overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview) 与 [Migrating from RSC to UI](https://ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui)。

OpenChamber 已有 OpenCode Session、SSE、ToolPart、Permission、多 Agent 和多 runtime。如果再引入 `streamUI`，会形成第二套：

- 模型调用 runtime。
- message/part 协议。
- stream 生命周期。
- tool permission 与错误状态。
- 历史消息重放模型。

而且 OpenChamber 是 Vite/Electron/VS Code/Mobile 共享 React UI，不以 Next.js RSC 为主运行边界。收益不足以覆盖架构重复。

## 4. “Generative UI”三种不同含义

讨论时必须区分：

### 4.1 模型路由到预注册组件

模型选择 weather、stock、CRM 等工具，应用渲染开发者写好的组件。AI SDK UI 的典型示例属于这一类。

优点是稳定、安全、可测试；限制是每种新表现通常需要开发者增加工具或组件。

### 4.2 模型组合有界组件语法

模型可以现场选择 metric、chart、table、flow、list、callout 等节点并组合布局，但每个节点 renderer 由平台实现。OpenChamber Agent Generated Declarative 属于这一类。

它能在不预设“天气页面”“运营页面”的情况下组合新页面，又不会执行模型代码。若请求 Git graph 等平台没有的 primitive，它仍无法凭空创造任意绘制能力。

### 4.3 模型生成表现代码

模型写 HTML/CSS/SVG/JavaScript，理论上可以做 Git graph、模拟器、地图或全新图形。ChatGPT/Codex inline visualization 与 OpenChamber 规划的 HTML Artifact 属于这一类。

它最自由，也必须用 sandbox、CSP、资源和 Bridge allowlist 限制权限。

## 5. ChatGPT/Codex Desktop 实现

本地静态分析发现其 inline visualization 使用线程文件指令、专用 sandbox、主题/locale/尺寸注入和窄 Host Bridge。内容可以本地交互并发送 follow-up，但被明确禁止直接调用 tools。

这与 AI SDK UI 有两个本质差异：

1. AI SDK UI 的 UI 代码通常由应用开发者预先编译并在应用 React 权限域运行。
2. inline visualization 的 UI 代码可以由 Agent 现场生成，因此放入隔离执行域，只把少数能力桥接出来。

ChatGPT/Codex 还把 Documents、Presentations、Spreadsheets、Sites 等持久 Artifact 与 inline visualization 分开，说明“生成 UI”不应被压成一种资源模型。

## 6. 三方对比

| 维度 | Vercel AI SDK UI | ChatGPT/Codex inline visualization | OpenChamber OCIX |
|---|---|---|---|
| 主消息 runtime | AI SDK `useChat` / UIMessage | 产品内部任务/消息 runtime | OpenCode Session / ToolPart |
| UI 选择 | 模型选择开发者 tool | Agent 生成 fragment 并引用 | tool 选 View；Generated Declarative 还可组合节点 |
| UI 实现来源 | 开发者 React | Agent HTML/CSS/SVG/JS | 平台 Declarative、安装式 Native、已实现 HTML Artifact |
| 任意新视觉 | 通常需新增组件 | 可以 | Declarative 受限；Artifact 可以 |
| 真实 API | tool execute / 应用服务端 | inline vis 本身禁止 tools | Installed UI 经 Business Gateway |
| 同页执行 | 是，应用可信代码 | 否，隔离后视觉内联 | Declarative/Trusted Native 是；Artifact 否 |
| 历史重放 | UIMessage parts | 线程资源 + 指令 | 严格 Result Envelope + 安装 View |
| Streaming | AI SDK UI part 流；RSC 可流 React | Host 内部实现 | v1 等待 completed ToolPart |
| 写操作确认 | 应用自行设计 | 交回 Agent/宿主 | Gateway `permission: ask` 挑战 |
| 主题一致性 | 应用组件自行实现 | Host 注入 | Declarative/Native 复用主题；Artifact 已注入完整 Style v2 token |
| 扩展信任 | 应用代码信任 | 模型代码不信任 | 三层显式信任模型 |

## 7. OpenChamber 应借鉴的部分

### 7.1 从 AI SDK UI 借鉴

- Model/tool 是动态 UI router。
- 用结构化、可序列化 part/result 重放 UI，而不是持久化 ReactNode。
- loading、input、confirmation、result、error 都是 UI 契约的一部分。
- 工具 schema 同时服务模型选择、运行时验证和前端类型。
- 业务 React 组件应按 tool/feature lazy load。

### 7.2 从 ChatGPT/Codex 借鉴

- 临时自由可视化是线程资源，不是新安装的主页面插件。
- sandbox 可以通过透明背景、主题注入和自适应高度做到视觉无感。
- Host Bridge 必须窄；follow-up 比直接授予 tool 权限更安全。
- 持久文件、站点、Notebook 和临时可视化应按资源类型分宿主。

### 7.3 OpenChamber 自己必须保留

- OpenCode 是唯一 Agent/tool runtime，不引入 AI SDK 第二消息流。
- ToolPart 的普通文本输出始终是 fallback。
- Agent Generated Declarative 是不可信数据，不获得 Installed View 的 query/action 权限。
- Trusted Native 是管理员安装的同页代码，不是公共第三方默认 runtime。
- 企业 token 只存在于服务端 Connector/Gateway。

## 8. 对当前路线的影响

### Agent Generated Declarative

已经实现，填补 AI SDK 固定 tool 组件与 HTML 自由代码之间的空档。短期继续增加通用 primitive 和 schema 质量，而不是按天气、股票逐页内置模板。

### Installed Declarative / Trusted Native

作为企业模块路径：开发者提供 UI 与 API contract，Agent 通过 Custom Tool/MCP 选择 View，页面通过 Gateway 查询和确认写入。它与 AI SDK 的 developer-authored tool component 最接近，但拥有独立安装包、双 runtime 和服务端权限清单。

### HTML Artifact

用于 Declarative 无法表达且不值得安装 Native 扩展的一次性任务，如 Git graph、自定义 SVG、模拟器和探索器。它应默认在对话流中展示，并可扩展 workspace/fullscreen；不是仅侧边栏 iframe。

## 9. 不采用的方案

- 不用 `useChat` 替换 OpenCode sync。
- 不把 `streamUI` 引入共享 Vite UI。
- 不把模型生成的 React/HTML 作为 Trusted Native 动态 import。
- 不为每个领域名词新增一个平台内置页面。
- 不让 HTML Artifact 持有业务 token 或直接调用 Gateway action。
- MCP Apps 2026 Host 已有独立 metadata/resource/AppBridge 链；不得另做一套不完整 iframe renderer或拿本历史限制否定现状。

## 10. 参考资料

- [AI SDK UI – Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [AI SDK UI – Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [AI SDK UI – `useChat`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [AI SDK – Tools](https://ai-sdk.dev/docs/foundations/tools)
- [AI SDK RSC – Overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview)
- [AI SDK RSC – `streamUI`](https://ai-sdk.dev/docs/reference/ai-sdk-rsc/stream-ui)
- [AI SDK RSC – Streaming React Components](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components)
- [AI SDK RSC – Migrating to AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui)
