# OpenChamber × AI SDK：Interactive UI 与 MCP Apps 集成分析

> **文档性质**：内部定制 / 研究笔记（不提交 upstream PR）  
> **分支**：`docs/interactive-ui-mcp-apps`  
> **目标**：在不破坏 OpenChamber + OpenCode 现有架构的前提下，评估并规划 **Generative / Interactive UI** 与 **MCP Apps** 的落地方式，并清理 AI SDK 中其他可借鉴能力。

---

## 1. 背景与目标

### 1.1 项目定位

OpenChamber 是搭在 **OpenCode**（TUI-first AI coding agent）之上的富 UI 层：

- Desktop / Web(PWA) / Mobile / VS Code Extension
- 消息、Session、Worktree、Permission、多 Agent 等由 OpenCode SDK + 自有 SSE / sync 层驱动
- 已有较完整的 Tool UI（diff、bash、permission、plan 等）与 MCP 支持

### 1.2 定制目标

- 企业内部定制（**不向 upstream 提 PR**）
- 保持可与 upstream 同步（fork + upstream remote + 独立定制分支）
- 引入更富的 **Interactive UI**（类 Generative UI）体验
- 支持 **MCP Apps**（标准交互式 Tool UI / iframe App）
- 采用「**适度用库**」策略：借鉴模式 + 对高价值能力实际引入 AI SDK

---

## 2. 架构约束（为什么不能整套换 AI SDK 聊天）

| 层级 | OpenChamber 现状 | AI SDK 典型路径 |
|------|-------------------|-------------------|
| 消息来源 | OpenCode SDK + 自有 SSE / EventPipeline | `useChat` + AI SDK stream 协议 |
| 消息结构 | OpenCode session / message / tool call | `UIMessage` + `parts`（`text` / `tool-xxx`） |
| 状态管理 | 自有 stores、sync、permission、worktree、多 Agent | `useChat` 内部状态 |
| 工具执行 | OpenCode / MCP / Skills | AI SDK tools + `execute` |
| 最终渲染 | 已有 Tool UI 映射 | 按 `part.type` + `part.state` 映射组件 |

**结论**：

- 不是「组件画法不一样」这么简单
- 而是 **整条数据链路**（协议 / 状态 / 工具运行时）不同
- 因此：**不推荐用 `useChat` 替换主聊天**；推荐在现有 Tool 渲染层上扩展 Interactive UI，并对 MCP Apps 做目标化接入

---

## 3. Interactive UI（Generative UI）

### 3.1 AI SDK 中的定义（AI SDK UI 路径）

Generative UI 的核心模式：

1. 模型调用 tool  
2. tool 返回**结构化数据**  
3. 前端根据 tool 名称 + 状态（`input-available` / `output-available` / `output-error`）渲染对应 **React 组件**

说明：

- 当前推荐的是 **AI SDK UI**（客户端渲染），不是实验性的 AI SDK RSC / `streamUI`
- 该模式**不依赖 Next.js RSC**，可用于 Vite / SPA / Electron 等 React 客户端

### 3.2 为什么推荐「自己做组件映射」

1. OpenChamber **已有** tool 结果 → 富 UI 的渲染路径（本质就是 Generative UI 模式）  
2. 强行接 AI SDK 的 `parts` 格式，需要额外适配层，收益不高  
3. 自己映射更易与企业组件、主题、权限 UI 结合，且不锁定 AI SDK 消息模型  

### 3.3 推荐落地方式

```text
保留 OpenCode 消息流 / Session / Permission
        ↓
扩展现有 Tool Renderer
        ↓
toolName + state + structured output
        ↓
映射到自定义 React 组件（天气卡、表单、审批卡、仪表盘等）
```

伪代码示意：

```tsx
function renderToolPart(part) {
  // 企业 / 自定义 Generative UI
  if (part.tool === 'displayWeather') {
    if (part.state === 'pending') return <LoadingWeather />;
    if (part.state === 'done') return <WeatherCard {...part.output} />;
    if (part.state === 'error') return <ErrorCard error={part.error} />;
  }

  // 现有 OpenCode 工具
  if (part.tool === 'edit' || part.tool === 'apply_patch') return <DiffViewer ... />;
  if (part.tool === 'bash') return <BashOutput ... />;

  return <DefaultToolCard part={part} />;
}
```

### 3.4 与 AI SDK 的关系（适度用库）

| 部分 | 建议 |
|------|------|
| 设计思路 / 渲染模式 | **强烈借鉴** |
| 完整 `useChat` 状态管理 | **不用** |
| `zod` 工具 schema、类型辅助 | **可选使用** |
| `ai` / `@ai-sdk/react` 全量接入主聊天 | **不推荐** |

---

## 4. MCP Apps（重点能力）

### 4.1 是什么

MCP Apps 是 Model Context Protocol 的扩展：

- MCP Server 的 tool 可以声明一个交互式 UI 资源（`ui://...`，HTML）
- Host（客户端）在**沙箱 iframe** 中渲染该 UI
- 通过 `postMessage` + JSON-RPC 与 App 通信
- 模型仍调用普通 tool；用户侧看到仪表盘、表单、配置面板等富交互界面

关键 MIME：`text/html;profile=mcp-app`

### 4.2 AI SDK 提供的支持

| 包 / API | 作用 |
|---------|------|
| `@ai-sdk/mcp` | `mcpAppClientCapabilities`、`splitMCPAppTools`、`readMCPAppResource` 等 |
| `@ai-sdk/react` | `experimental_MCPAppRenderer`（iframe + bridge） |

Host 典型流程：

1. 创建 MCP client 时带上 `mcpAppClientCapabilities`  
2. `listTools` 后用 `splitMCPAppTools` 区分 model-visible / app-visible  
3. 只把 model-visible tools 交给模型  
4. tool 结果带 MCP App 元数据时，`readMCPAppResource` 拉取 `ui://`  
5. 用 `experimental_MCPAppRenderer`（或自建 bridge）在沙箱中渲染  
6. 代理允许的 app-visible tool 调用回 MCP server  

### 4.3 为什么适合引入 OpenChamber

- OpenChamber **已有 MCP**，扩展为 MCP Apps host 是自然演进
- 与 Interactive UI 目标一致：让 tool 结果可以是富交互界面
- 官方已封装 host 侧复杂点（能力声明、工具拆分、资源读取、iframe bridge），自实现成本高
- 可与自定义 Generative UI **并存**：普通 tool 走自有组件映射；带 App 元数据的 tool 走 MCP App 渲染器

### 4.4 推荐接入方式（适度用库）

```text
现有 MCP 连接层
  + mcpAppClientCapabilities
  + splitMCPAppTools / readMCPAppResource
        ↓
现有 Tool Renderer
  + 若检测到 MCP App 元数据
  + 则使用 experimental_MCPAppRenderer（或等价 bridge）
  + 否则走自定义 / 现有 Tool UI
```

**注意：**

- `experimental_MCPAppRenderer` 仍为 experimental，API 可能变动
- 需要一层适配：把 OpenCode / MCP tool 结果映射为 renderer 期望的 part / metadata
- 安全：严格 iframe 沙箱；明确允许代理的 app-visible tools

### 4.5 替代方案（更少锁定 AI SDK时）

可直接基于官方 MCP 扩展：

- `@modelcontextprotocol/ext-apps`
- App Bridge / host 实现

适合希望长期与 AI SDK 解耦、自建 host 的场景；工作量更大。

---

## 5. AI SDK 其他能力评估（相对 OpenChamber）

### 5.1 优先推荐

| 能力 | 建议 | 说明 |
|------|------|------|
| **MCP Apps** | **实际引入库** | 标准交互式 Tool UI；host 复杂度高 |
| **Generative UI 模式** | **借鉴 + 自建映射** | 与现有 Tool UI 最契合 |
| **Structured Object Streaming（`useObject`）** | **可局部用库** | 流式计划、表单、状态卡；不必接管主聊天 |
| **Streaming Custom Data（data parts）** | **主要借鉴模式** | 进度、来源、临时状态；可对齐现有 SSE 设计 |
| **Reasoning / Thinking 展示** | **借鉴模式** | 若模型/OpenCode 会流出 reasoning，客户端做折叠展示即可 |

### 5.2 中等优先级

| 能力 | 建议 | 说明 |
|------|------|------|
| Tool Approvals / Policy（OPA） | 借鉴策略 | 已有 permission；可学「策略与代码分离」，实现可独立于 AI SDK agent loop |
| Telemetry（OpenTelemetry） | 可选 | 企业可观测性；主路径在 OpenCode 时更宜在 OpenChamber/OpenCode 层做 |
| Embeddings / Reranking | 可选增强 | 会话搜索、本地知识召回等，与主聊天解耦 |
| Message persistence / Stream resume 思路 | 借鉴 | 对照补强 session 断线续传等，不必换协议 |

### 5.3 不推荐作为主能力引入

| 能力 | 原因 |
|------|------|
| 完整 `useChat` 体系 | 与 OpenCode session / SSE / 多 Agent / permission 冲突大 |
| Language Model Middleware | 主要作用于 AI SDK model 调用；模型调用在 OpenCode 内 |
| AI SDK Agents（ToolLoopAgent 等）整套 | 易形成双运行时 |
| AI SDK RSC / `streamUI` | 偏 Next.js RSC，与 Vite/Electron 栈不匹配 |
| Image / Speech / Video Generation | 非编码 Agent 客户端核心 |
| Provider 统一抽象 | OpenCode 已管理 provider/model |

---

## 6. 总体策略：适度用库

```text
协议 / Agent 运行时 / 主聊天状态
  → 留在 OpenCode + OpenChamber

UI 与标准扩展（MCP Apps、富 Tool UI、结构化流式对象）
  → 适度引入 AI SDK 或深度借鉴

企业治理（审批策略、Telemetry）
  → 学设计，实现可与 AI SDK 解耦
```

### 6.1 建议落地顺序

1. **MCP Apps**（真正用 `@ai-sdk/mcp` + renderer 相关能力）  
2. **Generative UI 组件映射**（扩展现有 Tool Renderer）  
3. **局部 Structured Object 流**（计划卡 / 表单 / 状态块）  
4. **自定义流式数据 / 进度 / 来源**（对齐 data parts 思路）  
5. **企业向：权限策略化、可观测性**（借鉴、独立实现）  

---

## 7. 与 upstream 同步的关系

- 本文档仅存于 **fork 专用分支**，不提 PR  
- 实现代码建议：  
  - `main` 尽量干净同步 upstream  
  - 定制改动放在独立长期分支（如 `enterprise`）  
  - Interactive UI / MCP Apps 改动尽量**模块化**（独立 renderer 插槽、独立 MCP Apps host 模块），降低后续 merge 冲突  

---

## 8. 参考链接

- [AI SDK – Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)  
- [AI SDK – MCP Apps](https://ai-sdk.dev/docs/ai-sdk-core/mcp-apps)  
- [AI SDK – experimental_MCPAppRenderer](https://ai-sdk.dev/docs/reference/ai-sdk-ui/mcp-app-renderer)  
- [Add MCP Apps to your AI SDK application (Vercel KB)](https://vercel.com/kb/guide/ai-sdk-mcp-apps)  
- [MCP Apps 规范与扩展（modelcontextprotocol/ext-apps）](https://github.com/modelcontextprotocol/ext-apps)  
- [AI SDK – Object Generation / useObject](https://ai-sdk.dev/docs/ai-sdk-ui/object-generation)  
- [AI SDK – Streaming Custom Data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)  

---

## 9. 下一步（建议）

1. 在代码中定位：现有 **Tool Renderer** 与 **MCP client** 入口文件  
2. 出 **MCP Apps host 最小接入设计**（模块划分 + 与现有 tool part 的适配层）  
3. 出 **Generative UI 组件注册表** 设计（toolName → React 组件）  
4. 用 1–2 个示例 tool（一个自定义组件 + 一个 MCP App）做端到端 spike  

---

*文档版本：2026-07-17*  
*范围：fork 内部定制记录，非 upstream 官方文档*
