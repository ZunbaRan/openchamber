# OpenChamber Interactive UI 扩展架构与企业模块开发规范

> **文档性质**：fork 内部架构设计与扩展开发规范<br>
> **规范代号**：OCIX（OpenChamber Interactive Extension，暂定名）<br>
> **规范版本**：Managed Distribution Preview v0.4<br>
> **适用范围**：OpenChamber Web、Desktop、VS Code、Hosted Mobile、Capacitor Mobile<br>
> **更新日期**：2026-07-20

> **关联文档**：[OpenChamber Interactive UI 实施方案与 MCP Apps Roadmap](./AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md) · [视觉、HTML Artifact 与统一验收计划](./INTERACTIVE_UI_VISUAL_HTML_ARTIFACT_AND_UNIFIED_TEST_PLAN.md)

> **实现进度（2026-07-20）**：仓库现已包含 OCIX v1 Managed Distribution Preview，包括严格 Result Envelope、Declarative Query/Action 与写后刷新、受信任 Native ESM 激活、Business Gateway、Agent 示例、双 runtime starter、扩展 CLI/validator、带内嵌公钥的 Ed25519 `.ocix` 签名、确认式发布者信任、Tool/Skill 全局受管安装、持久化 Extension Manager、启停/升级/回滚/可恢复卸载、自描述签名静态 marketplace catalog，以及 Connector Authentication & Credential Provisioning v1。业务 Key 的 scope、RBAC/ABAC、撤销和业务审计明确归第三方系统；OpenChamber 不建设另一套多用户权限系统。远程 Host/Server 双端安装、workspace/fullscreen 容器、在线签名吊销/透明日志和官方托管公共市场仍属于后续阶段。

---

## 1. 文档目的

本文定义 OpenChamber Interactive UI 的完整扩展模型，回答以下问题：

1. Interactive UI 如何作为 OpenChamber 的通用内置能力，让 Agent 在需要可视化时调用 tool 获得更友好的 UI。
2. 企业开发者如何把一个现有业务模块拆分并接入 Agent 客户端。
3. Declarative UI 与 Native UI 分别解决什么问题，开发和运行方式有何不同。
4. Skill、OpenCode Custom Tool、Plugin、MCP、CLI 与 Interactive UI 各自承担什么职责。
5. 在尽量不修改 OpenCode 源码的情况下，扩展如何被安装、发现、加载和调用。
6. Native 企业模块从用户提出请求，到 Agent 调用，再到 UI 渲染和执行真实业务操作的完整路径。
7. 平台、扩展开发者与业务系统之间如何划分认证、权限、安全、审计和版本兼容责任。

本文同时记录目标架构和已交付的 v1 契约。标记为 Developer Preview 的接口已经存在于仓库；Phase D 之后的治理、HTML Artifact 和 MCP Apps 仍是设计，不能按已实现能力使用。实际开发步骤见 [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)。

### 1.1 三层结构状态

| 路径 | 当前状态 | 说明 |
|---|---|---|
| Agent Generated Declarative | **v1 已实现** | Agent 组合 snapshot primitives，客户端按 allowlist 重建，无 query/action |
| Installed Declarative / Trusted Native | **Managed Distribution Preview 已实现** | 真实 HTTP query、确认式 write、开发模板、validator、skill、签名包、Agent Runtime 统一安装、管理 UI 和签名目录 |
| HTML Artifact | **Roadmap 下一阶段** | 任意模型表现代码进入透明 sandbox，不直接持有业务权限 |

---

## 2. 背景

OpenChamber 当前是 OpenCode 之上的多端 UI：

- OpenCode 负责 Agent、模型、Session、消息、tool call、Permission 和 MCP client。
- OpenChamber 负责 Web、Desktop、VS Code、Mobile、消息展示、Tool UI 和运行时桥接。
- OpenChamber 已经能够获得 OpenCode ToolPart 的 tool name、input、output、metadata 和执行状态。
- OpenChamber 已经有 bash、diff、task、permission 等专用 Tool UI。

传统 Tool UI 通常只展示一次 tool call 的文本或固定结构化结果。企业场景需要进一步支持：

- 实时仪表盘和业务指标。
- 数据筛选、下钻和分页。
- 表单、审批、工单和多步骤流程。
- 从 Agent 对话直接进入业务模块。
- 用户在业务 UI 中执行操作后，将结果反馈给 Agent。
- 同一个业务能力既能被 Agent 调用，也能被用户直接操作。

因此，Interactive UI 不应只被定义为“把 JSON 画成卡片”，而应被设计为：

> OpenChamber 中承载 Agent 原生可视化和企业业务模块的扩展平台。

---

## 3. 核心决策

| 编号 | 决策 |
|---|---|
| D1 | Interactive UI 同时包含通用可视化能力和企业业务扩展能力 |
| D2 | Declarative 与 Native 是并列的 UI runtime，不是高低等级 |
| D3 | Declarative 使用平台组件和 JSON 模板；Native 使用开发者编写的 React/TypeScript |
| D4 | 企业内部可信模块默认可使用 Native，以获得原生、无缝的交互体验 |
| D5 | Sandbox 不是必选项，只用于不受信任的第三方可执行 UI |
| D6 | MCP 是企业能力连接的首选协议；Skill 只负责指导 Agent 如何使用 |
| D7 | CLI 可以作为 MCP 或 Custom Tool 的底层实现，但不作为平台 UI 协议 |
| D8 | OpenCode 保持 Agent/tool runtime；OpenChamber 持有 UI extension runtime |
| D9 | 第一版不要求修改 OpenCode 源码，优先使用配置目录、Custom Tool、Plugin、MCP 和动态配置 |
| D10 | Native 扩展等同于向 OpenChamber 安装可信可执行代码，必须有明确的信任和发布策略 |
| D11 | UI 不直接持有业务 access token，默认通过宿主 Business Client 和服务端 Gateway 访问业务系统 |
| D12 | 未安装扩展、版本不兼容、schema 错误或组件崩溃时，必须回退到现有通用 Tool UI |
| D13 | Agent 可以按任务生成 Declarative snapshot 的布局数据，但不能在该通道声明 query、action、binding 或可执行代码 |
| D14 | 未来的 Agent HTML Artifact 使用透明、自适应高度的隔离容器；它与同页执行的企业 Native runtime 是两条不同信任路径 |

---

## 4. 目标与非目标

### 4.1 目标

- 为 Agent 提供内置的图表、表格、指标、时间线等通用 UI tool。
- 允许开发者发布独立企业扩展包，而不必修改 OpenChamber 核心源码。
- 允许扩展同时包含 Skill、Tool/MCP、UI 和业务连接声明。
- 允许 Declarative 与 Native 模块共享安装、发现、结果协议、权限和审计机制。
- 允许 Agent 调用和用户 UI 操作使用同一套业务能力。
- 支持项目级、用户级、企业托管级扩展。
- 保持与 OpenChamber upstream 的可持续同步。
- 为未来 MCP Apps 和跨 Agent 客户端移植保留边界。

### 4.2 非目标

- 不用 Interactive UI 替换 OpenCode 的 Session、SSE、Permission 或 Agent loop。
- 不让模型生成的 React、HTML 或 JavaScript 在 OpenChamber 主页面权限域中执行。
- 不把 Skill 当作 API transport。
- 不要求每个业务系统完整迁移到 Agent 客户端。
- 不保证任意 Native 扩展可以在所有 runtime 无条件运行。
- 不在第一版开放不受信任的公共 Native 插件市场。
- 不把 access token、refresh token 或业务系统密钥写入 UI manifest 或前端 bundle。
- 不在第一版实现完整 MCP Apps host。

---

## 5. 术语

### 5.1 Interactive UI Core

OpenChamber 内置的 UI registry、结果解析、状态适配、Declarative renderer、Native loader、宿主 SDK 和 fallback 机制。

### 5.2 OCIX Extension

遵循本文规范的扩展包。它可以包含：

- 一个或多个 Skills。
- OpenCode Custom Tools 或 Plugin。
- Local/Remote MCP connector。
- Declarative View。
- Native View。
- schema、权限和业务 action 声明。

### 5.3 View

一个可以在 ToolPart、独立工作区、侧栏或全屏容器中呈现的 UI 模块。

### 5.4 Connector

连接业务能力的方式，例如 Remote MCP、Local MCP、HTTP Gateway、OpenCode Custom Tool 或 CLI adapter。

### 5.5 Result Envelope

tool 执行完成后用于选择 View、传递 snapshot/context 或引用外部数据的标准结果对象。

### 5.6 Business Client

Native 或 Declarative action 调用业务能力时使用的宿主 API。它隐藏 token、runtime URL 和鉴权细节。

### 5.7 Host SDK

OpenChamber 暴露给 Native 扩展的稳定接口，包括 View 注册、Business Client、导航、Dialog、主题、Locale、日志和 capability 检查。

---

## 6. 总体架构

~~~text
                                ┌──────────────────────────┐
                                │     企业业务系统          │
                                │ ERP / CRM / BI / 工单     │
                                └────────────┬─────────────┘
                                             │
                                  HTTP / DB / CLI / SDK
                                             │
                                ┌────────────▼─────────────┐
                                │ Business Extension       │
                                │ MCP / Gateway / Adapter  │
                                └───────┬─────────┬────────┘
                                        │         │
                                 MCP tools     UI API/actions
                                        │         │
┌──────────────┐    Prompt     ┌────────▼───┐     │
│     用户      ├──────────────►│  OpenCode  │     │
└──────┬───────┘               │ Agent/Tools│     │
       │                       └──────┬─────┘     │
       │                              │ ToolPart   │
       │                              ▼            │
       │                ┌───────────────────────────▼──────┐
       │                │ OpenChamber Interactive UI Core │
       │                │ Result Resolver / Registry      │
       │                └────────────┬──────────────┬─────┘
       │                             │              │
       │                     Declarative View    Native View
       │                             │              │
       └─────────────────────────────┴──────────────┘
                          查看、筛选、下钻、执行业务 action
~~~

架构中有两条不同但关联的执行路径：

1. **Agent 路径**：用户语言 → Agent → Tool/MCP → Result Envelope → View。
2. **UI 路径**：用户点击 View → Business Client → Gateway/action → 业务系统。

两条路径应当共享业务身份、权限、schema、审计与幂等规则，但不要求在第一版共享同一条 OpenCode MCP client 连接。

---

## 7. 通用 Interactive UI 内置能力

### 7.1 内置扩展组成

OpenChamber 应随产品提供一个受信任的 built-in extension：

~~~text
openchamber-interactive-ui/
├── skills/
│   └── interactive-ui/
│       └── SKILL.md
├── tools/
│   └── openchamber-ui.ts
├── schemas/
│   └── generated-layout.schema.json
└── manifest.json
~~~

各部分职责：

- Skill：告诉 Agent 什么时候应当可视化、选择哪种 View、如何控制数据量。
- Custom Tool：验证参数并返回标准 Result Envelope。
- Schema：定义 Agent 可以组合的安全布局和数据上限。
- Manifest：将 tool 与内置 Declarative View 绑定。
- OpenChamber renderer：真正渲染 UI。

### 7.2 内置 Tool 示例

~~~ts
openchamber_ui({
  title: "模型运营看板",
  summary: "调用量继续增长，成功率稳定，周五延迟需要关注。",
  sections: [
    {
      columns: 3,
      widgets: [
        { type: "metric", label: "调用量", value: "82.4k", detail: "较上周 +12%" },
        { type: "metric", label: "成功率", value: "98.7%" },
        { type: "status", label: "服务状态", value: "正常", tone: "success" }
      ]
    },
    {
      widgets: [{
        type: "chart",
        title: "近 7 日调用趋势",
        chartVariant: "line",
        chartSeries: [{ label: "调用量" }],
        chartPoints: [
          { label: "周一", values: [9100] },
          { label: "周二", values: [10400] }
        ]
      }]
    }
  ]
})
~~~

Agent 在 tool 参数中决定信息层级和组件组合，但不生成 React/HTML/JavaScript。Tool 与 Host 负责：

- schema 校验。
- 把高层 widget 参数规范化为 Declarative layout。
- 限制节点深度、数量、字符串、表格行、图表点和系列。
- 固定为 built-in generated View ID。
- 产生确定性的 Result Envelope。
- 返回适合文本客户端理解的简短 summary。

客户端不会直接信任 tool 返回的 `data.layout`。`generated-layout` 边界会按节点逐项重建，只接受 snapshot 组件，删除未知属性，并拒绝 query、action、rowAction、binding、script 和宿主访问。即使 tool 或模型被提示注入，也不能因此获得企业扩展的 Business Gateway 权限。

### 7.3 适用范围

内置通用 View 第一批包括：

- metric-grid
- line/bar/area/donut chart
- data-table
- ordered flow
- list
- key-value/object inspector
- status panel
- file/diff list
- text/callout summary

复杂表单、地图、设计器和富业务流程不强行塞入通用 View，应当使用 Native。

### 7.4 与 Vercel AI SDK、ChatGPT/Codex 的关系

Vercel AI SDK 的典型 Generative UI 并不是让模型现场生成任意 React。应用开发者先注册带参数 schema 的 tools，并为每个 tool 编写 React 组件；模型负责在运行时选择 tool 和提供结构化参数。它的优点是类型清晰、组件质量可控，限制是视觉能力仍由开发者预先提供。

OpenChamber 当前实现沿用这个安全核心，但把单一“tool → 单一组件”的映射提升为“tool → 有界组件语法”：模型可以根据当前任务组合布局，平台仍只执行预注册 renderer。天气、流程、运营看板、对比分析只是同一语法的不同实例，不需要每种任务新增一个模板。

对本机 ChatGPT/Codex 应用包的只读检查显示，它还支持另一类 inline visualization：Agent 生成受限 HTML fragment，宿主注入统一设计系统，在透明、可自动报告高度的隔离容器中展示，并只开放 follow-up message 等窄桥接能力。该路线适合模拟器、自定义 SVG、探索器等 Declarative DSL 难以表达的临时可视化，但仍不应拿企业 token 或直接调用业务 API。

因此长期保留三条明确分离的路径：

| 路径 | 作者 | 执行边界 | 业务能力 |
|---|---|---|---|
| Generated Declarative | Agent 按任务组合数据语法 | OpenChamber 同页可信 renderer | snapshot，只读，无 action/query |
| Installed Declarative / Native | 企业开发者发布扩展 | Declarative 无代码；Native 同页可信代码 | 经 Gateway 查询和写入，带权限/确认/审计 |
| HTML Artifact（Roadmap） | Agent 生成 HTML/CSS/受限 JS | 透明、自适应 sandbox | 本地交互与 follow-up，不持 token、不直接调用企业 API |

这里的 sandbox 只针对 Agent 生成的任意代码，不改变“可信企业 Native 模块无缝同页运行”的既有决策。视觉上应当像普通消息内容，不呈现传统网页 iframe 的边框、滚动条或弹窗式体验。

详细调研见 [ChatGPT/Codex Desktop 可视化与 Artifact 本地静态调研](./CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md) 与 [Vercel AI SDK Generative UI 实现与 ChatGPT/OpenChamber 对比](./VERCEL_AI_SDK_GENERATIVE_UI_IMPLEMENTATION_AND_COMPARISON.md)。

---

## 8. OCIX 扩展包

### 8.1 目录结构

完整企业扩展可以采用：

~~~text
acme-sales-extension/
├── openchamber.extension.json
├── DISTRIBUTION.md
├── agent-runtime/
│   ├── tools/
│   │   ├── sales_open_overview.ts
│   │   └── sales_open_workspace.ts
│   └── skills/
│       └── sales-interactive-ui/
│           └── SKILL.md
├── ui/
│   ├── declarative/
│   │   └── sales-summary.view.json
│   └── ...
└── dist/
    └── ui.mjs
~~~

不是所有扩展都需要全部目录：

- 只供 Host renderer 调试的目录可以只有 manifest 和 Declarative Views，但不能完成真实 Agent 对话发现。
- 可独立安装的本地 OCIX 应把 Custom Tool 与 Skill 放入 `agent-runtime`；打包和安装会验证并统一部署它们。
- 需要跨服务器或组织治理的能力可以继续由 MCP 提供，但其生命周期不由本地 `.ocix` 假装管理。
- Native 企业模块通常包含 Agent Runtime、Declarative fallback 和单文件 Native bundle。

### 8.2 Manifest 示例

~~~json
{
  "$schema": "https://openchamber.dev/schemas/extension/v1.json",
  "id": "com.acme.sales",
  "name": "Acme Sales",
  "version": "1.0.0",
  "publisher": "Acme Internal Platform Team",
  "description": "Sales dashboard and order approval workflows",

  "compatibility": {
    "ocix": "^1.0.0",
    "openchamber": ">=1.17.0",
    "opencode": ">=1.18.3"
  },

  "activation": {
    "events": [
      "onTool:sales_get_dashboard",
      "onView:com.acme.sales.dashboard"
    ]
  },

  "skills": [
    {
      "path": "skills/acme-sales",
      "scope": "user"
    }
  ],

  "connectors": [
    {
      "id": "sales-mcp",
      "type": "mcp-remote",
      "url": "https://sales.example.com/mcp",
      "auth": {
        "type": "oauth"
      }
    },
    {
      "id": "sales-ui-api",
      "type": "http",
      "baseUrl": "https://sales.example.com/ui-api",
      "auth": {
        "type": "host-managed"
      }
    }
  ],

  "views": [
    {
      "id": "com.acme.sales.summary",
      "runtime": "declarative",
      "entry": "ui/declarative/sales-summary.view.json",
      "tools": ["sales_get_summary"],
      "resultSchema": "schemas/dashboard-result.schema.json"
    },
    {
      "id": "com.acme.sales.dashboard",
      "runtime": "native",
      "entry": "dist/ui.mjs",
      "export": "SalesDashboardView",
      "tools": ["sales_get_dashboard"],
      "resultSchema": "schemas/dashboard-result.schema.json",
      "displayModes": ["inline", "workspace", "fullscreen"]
    }
  ],

  "actions": [
    {
      "id": "sales.orders.query",
      "connector": "sales-ui-api",
      "risk": "read",
      "permission": "allow"
    },
    {
      "id": "sales.order.approve",
      "connector": "sales-ui-api",
      "risk": "write",
      "permission": "ask",
      "idempotent": true
    }
  ],

  "permissions": {
    "network": [
      "https://sales.example.com"
    ],
    "runtime": [
      "navigation.openFile",
      "dialog.confirm",
      "clipboard.write"
    ]
  },

  "trust": {
    "mode": "native-code",
    "signature": "required"
  }
}
~~~

### 8.3 命名规则

- Extension ID 使用反向域名，例如 <code>com.acme.sales</code>。
- View ID 必须以 Extension ID 为前缀。
- Action ID 必须按业务域命名，不使用宽泛名称。
- MCP server 名称应使用可预测 namespace。
- Tool alias 必须显式声明，不能根据相似 output 自动匹配。
- 保留 <code>openchamber.*</code> 给平台内置能力。

---

## 9. Result Envelope

### 9.1 为什么需要 Envelope

当前 OpenCode ToolPart 的 completed output 是字符串。即使底层 MCP 支持 structuredContent，也不能假定所有版本和所有 tool 类型都会把它无损传到 UI。

因此 OCIX v1 要求：

- tool 的 text result 中包含一个标准 JSON Envelope。
- MCP tool 可以额外在 structuredContent 中返回同一对象。
- View 选择不依赖未经验证的任意 metadata。
- output schema 在进入 View 前必须由 OpenChamber 验证。

### 9.2 Inline Data

~~~json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.acme.sales.dashboard",
  "schemaVersion": 1,
  "mode": "snapshot",
  "summary": "华东区 7 月销售额 182 万元",
  "data": {
    "region": "east",
    "period": "2026-07",
    "revenue": 1820000,
    "trend": [120000, 160000, 180000]
  },
  "updatedAt": "2026-07-18T10:30:00Z"
}
~~~

### 9.3 Data Reference

大数据或实时模块只在消息中保存小型 context：

~~~json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.acme.sales.dashboard",
  "schemaVersion": 1,
  "mode": "live",
  "summary": "已打开华东区实时销售仪表盘",
  "context": {
    "region": "east",
    "period": "2026-07"
  },
  "dataRef": {
    "connector": "sales-ui-api",
    "resource": "sales.dashboard",
    "revision": "dashboard-2026-07-18T10:30:00Z"
  },
  "updatedAt": "2026-07-18T10:30:00Z"
}
~~~

### 9.4 Result 解析顺序

1. 检查 tool name 是否绑定已安装 View。
2. 检查 output 是否为合法 Envelope。
3. 校验 <code>$schema</code> 和 schemaVersion。
4. 校验 manifest 声明的 result schema。
5. 检查 View runtime 与当前 runtime capability。
6. 检查扩展是否启用、可信和版本兼容。
7. 加载 Declarative 或 Native View。
8. 任一步失败则回退到通用 Tool UI。

### 9.5 Snapshot 与 Live

- snapshot：历史消息必须能重现调用时的关键数据。
- live：允许 View 重新查询当前数据，但必须标明最后更新时间。
- live View 不得让历史消息看起来像原始结果从未变化。
- 写操作需要携带 revision、ETag 或业务版本，避免覆盖更新后的数据。

---

## 10. Declarative Runtime 详细设计

### 10.1 定位

Declarative Runtime 让开发者通过 JSON 描述 View，平台负责渲染。它适用于：

- 通用图表和指标。
- 标准表格、筛选、时间线。
- 简单详情页和只读仪表盘。
- 结构稳定、交互模式可复用的企业模块。
- 需要跨所有 runtime 保持一致的 UI。

开发者不能在模板中执行任意 JavaScript。

### 10.2 View Schema

~~~json
{
  "$schema": "openchamber://declarative-view/v1",
  "id": "com.acme.sales.summary",
  "title": "销售概览",
  "layout": {
    "type": "stack",
    "gap": "md",
    "children": [
      {
        "type": "metric-grid",
        "columns": {
          "default": 1,
          "md": 3
        },
        "items": [
          {
            "label": "销售额",
            "value": {
              "$path": "data.revenue",
              "format": "currency:CNY"
            }
          },
          {
            "label": "订单数",
            "value": {
              "$path": "data.orderCount",
              "format": "number"
            }
          },
          {
            "label": "完成率",
            "value": {
              "$path": "data.completionRate",
              "format": "percent"
            }
          }
        ]
      },
      {
        "type": "line-chart",
        "title": "销售趋势",
        "data": {
          "$path": "data.trend"
        },
        "xKey": "date",
        "series": [
          {
            "key": "revenue",
            "label": "销售额"
          }
        ]
      },
      {
        "type": "data-table",
        "title": "异常订单",
        "data": {
          "$path": "data.anomalies"
        },
        "rowKey": "id",
        "columns": [
          {
            "key": "id",
            "label": "订单"
          },
          {
            "key": "amount",
            "label": "金额",
            "format": "currency:CNY"
          },
          {
            "key": "status",
            "label": "状态",
            "render": "status"
          }
        ],
        "rowActions": [
          {
            "id": "open-order",
            "label": "查看",
            "kind": "navigation",
            "target": {
              "view": "com.acme.sales.order-details",
              "context": {
                "orderId": {
                  "$row": "id"
                }
              }
            }
          }
        ]
      }
    ]
  }
}
~~~

### 10.3 第一批 Layout Primitives

- stack
- row
- grid
- split
- tabs
- section
- collapsible
- scroll-area
- toolbar
- empty-state
- error-state

模板只能声明有限的响应式属性，平台决定实际 CSS 和断点。

### 10.4 第一批 Data Primitives

- text
- markdown
- badge/status
- metric/metric-grid
- key-value
- data-table
- line/bar/pie chart
- timeline
- checklist
- progress
- file-link
- diff-link
- code-block
- image

### 10.5 数据绑定

v1 使用受限路径表达式，不执行 JavaScript：

~~~json
{
  "$path": "data.revenue",
  "fallback": 0,
  "format": "currency:CNY"
}
~~~

允许的绑定来源：

- data：Envelope 内联数据。
- context：tool input 或 View context。
- query：Business Client 查询结果。
- row：table 当前行。
- host：locale、timezone、theme、display mode 等只读上下文。

禁止：

- eval。
- Function constructor。
- 任意模板表达式。
- 访问 window、document、storage。
- 动态 import。

### 10.6 Query 声明

Declarative View 可以声明受控查询：

~~~json
{
  "queries": {
    "dashboard": {
      "action": "sales.dashboard.query",
      "input": {
        "region": {
          "$path": "context.region"
        },
        "period": {
          "$path": "context.period"
        }
      },
      "cache": {
        "strategy": "stale-while-revalidate",
        "ttlMs": 30000
      }
    }
  }
}
~~~

Query 只能调用 manifest 中声明且获得权限的 action。

### 10.7 Action 声明

~~~json
{
  "id": "approve-order",
  "label": "批准",
  "kind": "business-action",
  "action": "sales.order.approve",
  "input": {
    "orderId": {
      "$row": "id"
    },
    "revision": {
      "$row": "revision"
    }
  },
  "confirm": {
    "title": "批准订单？",
    "description": "批准后订单将进入履约流程。"
  },
  "onSuccess": [
    {
      "type": "invalidate-query",
      "query": "dashboard"
    },
    {
      "type": "notify",
      "message": "订单已批准"
    }
  ]
}
~~~

平台负责：

- 解析 input。
- 检查 action permission。
- 展示确认。
- 调用 Business Client。
- 处理 loading/error。
- 刷新声明的 query。
- 写审计关联信息。

### 10.8 Declarative 的优势

- 无第三方可执行 UI 代码。
- 模板可热加载和热升级。
- 主题、Locale、可访问性和移动端由平台统一。
- schema 可以静态验证。
- 扩展与 React 内部实现解耦。
- 容易迁移到其他 Agent host。

### 10.9 Declarative 的限制

- 只能使用平台已有组件和事件。
- 复杂交互必须等待平台新增 primitive。
- 高度自定义图表、地图、画布、拖拽和编辑器不适合。
- 业务体验可能受到 DSL 表达能力限制。
- 平台必须长期维护 schema 和组件兼容性。

### 10.10 Declarative 开发流程

1. 定义 tool result schema。
2. 在 manifest 注册 View 和 tool binding。
3. 使用平台 primitives 编写 JSON View。
4. 用 fixture 提供 Envelope、loading、empty、error 数据。
5. 运行 schema validator 和 preview host。
6. 安装扩展并通过真实 MCP tool 验证。
7. 验证 Desktop、Web、VS Code、Mobile 响应式表现。

### 10.11 Agent Generated Declarative 子集

安装式 Declarative View 和 Agent Generated Declarative 使用同一个 renderer，但权限来源不同，不能混为一谈。

安装式 View 的 JSON 来自经过安装和校验的扩展包，因此可以在 manifest 授权范围内声明 `queries`、`rowActions` 和 Business Gateway action。Agent 生成的布局来自一次 tool result，只能作为不可信 snapshot 数据进入固定的 built-in View：

~~~json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.openchamber.builtin.interactive-ui.generated",
  "schemaVersion": 1,
  "mode": "snapshot",
  "summary": "成功率稳定，延迟略有上升",
  "data": {
    "layout": {
      "type": "stack",
      "children": [
        { "type": "metric", "label": "成功率", "value": "98.7%" },
        {
          "type": "chart",
          "variant": "line",
          "xKey": "day",
          "series": [{ "key": "latency", "label": "P95 延迟" }],
          "data": [{ "day": "周一", "latency": 620 }]
        }
      ]
    }
  }
}
~~~

Host 必须在渲染前重新构造对象，而不是只做顶层 schema 判断。v1 安全规则如下：

- 允许 `stack/section/row/grid` 和 snapshot 数据组件。
- 最大深度 6、节点 80、单容器子节点 20。
- 表格最多 50 行/8 列，图表最多 30 点/5 系列。
- 只允许有限长度的 scalar、文本和安全 ASCII data key。
- 不允许 `$path/$row` binding、query、action、rowAction、动态 import 或 HTML。
- 未知节点不渲染；不能降级为 `dangerouslySetInnerHTML`。
- generated View 的 manifest 不声明 business actions，服务端仍执行 tool/view binding 检查。

这个子集解决的是“模型根据任务现场设计呈现方式”，不是“模型现场创建一个拥有应用权限的新插件”。需要真实 HTTP API、token、写操作或长生命周期状态时，应安装企业 Declarative/Native 扩展。

---

## 11. Native Runtime 详细设计

### 11.1 定位

Native Runtime 允许受信任开发者编写 React/TypeScript 组件，并像 OpenChamber 自有组件一样运行。

适用场景：

- 企业内部业务系统。
- 复杂仪表盘。
- 地图、图编辑器、画布和专用图表。
- 多步骤工作流。
- 高度定制的表格、表单和业务交互。
- 需要原生 Dialog、Popover、Router、快捷键和全屏体验。

Native 的目标是无缝融入，而不是把外部网页嵌入 iframe。

### 11.2 信任模型

Native bundle 在 OpenChamber UI 权限域内执行。它不是安全隔离边界。

安装 Native 扩展等同于：

> 允许该发布者的前端代码在 OpenChamber 客户端中运行。

因此第一阶段只允许：

- OpenChamber built-in。
- 企业内部签名扩展。
- 管理员批准的受信任发布者。
- 明确显示源码来源、版本、hash 和权限的扩展。

Native permission manifest 可以约束平台通过 Host SDK 提供的能力，但不能把同页面 JavaScript 变成真正不可信代码。平台必须诚实呈现这一点。

### 11.3 Native Bundle

推荐 bundle 要求：

- ESM 单入口。
- React、React DOM 和 Host SDK 作为 peer/external dependency。
- 不打包第二份 React。
- 生产 bundle 不包含 token、client secret 或环境密钥。
- 所有动态 chunk 必须列入签名清单。
- CSS 使用平台 token；全局样式必须禁止或严格 namespace。
- 不依赖 OpenChamber 私有源码路径。
- 只依赖稳定的 <code>@openchamber/interactive-ui-sdk</code>。

示例 package：

~~~json
{
  "name": "@acme/openchamber-sales-ui",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./dist/ui.mjs"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "@openchamber/interactive-ui-sdk": "^1.0.0"
  }
}
~~~

### 11.4 Activation Contract

~~~ts
import type {
  InteractiveUIExtension,
  InteractiveUIHost,
} from "@openchamber/interactive-ui-sdk";

export const extension: InteractiveUIExtension = {
  id: "com.acme.sales",
  apiVersion: 1,

  activate(host: InteractiveUIHost) {
    const disposeDashboard = host.views.register({
      id: "com.acme.sales.dashboard",
      component: SalesDashboardView,
      displayModes: ["inline", "workspace", "fullscreen"],
    });

    const disposeDetails = host.views.register({
      id: "com.acme.sales.order-details",
      component: OrderDetailsView,
      displayModes: ["workspace", "fullscreen"],
    });

    return () => {
      disposeDashboard();
      disposeDetails();
    };
  },
};
~~~

### 11.5 View Component Contract

~~~ts
export interface NativeViewProps<TContext = unknown, TData = unknown> {
  instanceId: string;
  extensionId: string;
  viewId: string;

  status:
    | "pending"
    | "running"
    | "completed"
    | "error"
    | "cancelled";

  context: TContext;
  snapshot?: TData;
  dataRef?: InteractiveDataRef;

  tool: {
    id: string;
    name: string;
    input: unknown;
    output: unknown;
    error?: string;
  };

  display: {
    mode: "inline" | "workspace" | "fullscreen";
    width: number;
    height?: number;
    mobile: boolean;
  };

  host: InteractiveUIHost;
}
~~~

组件不得假定：

- 一定运行在 Electron。
- 一定有本地文件系统。
- 一定有 VS Code API。
- 一定能打开 popup。
- 一定处于 Desktop 宽屏。
- 一定连接本地 OpenCode。

### 11.6 Host SDK

建议稳定 API：

~~~ts
export interface InteractiveUIHost {
  apiVersion: 1;

  views: {
    register(definition: NativeViewDefinition): () => void;
    open(viewId: string, context?: unknown): Promise<void>;
    setDisplayMode(
      instanceId: string,
      mode: "inline" | "workspace" | "fullscreen"
    ): Promise<boolean>;
  };

  business: {
    query<TOutput>(
      action: string,
      input: unknown,
      options?: BusinessQueryOptions
    ): Promise<TOutput>;

    execute<TOutput>(
      action: string,
      input: unknown,
      options?: BusinessActionOptions
    ): Promise<TOutput>;

    subscribe<TEvent>(
      channel: string,
      input: unknown,
      listener: (event: TEvent) => void
    ): () => void;

    invalidate(key: string): Promise<void>;
  };

  navigation: {
    openFile(path: string, line?: number): Promise<boolean>;
    revealFile(path: string): Promise<boolean>;
    openSession(sessionId: string): Promise<boolean>;
    openExternal(url: string): Promise<boolean>;
  };

  dialog: {
    confirm(options: ConfirmOptions): Promise<boolean>;
    alert(options: AlertOptions): Promise<void>;
  };

  notifications: {
    show(input: NotificationInput): Promise<void>;
  };

  clipboard: {
    writeText(value: string): Promise<boolean>;
  };

  permissions: {
    check(action: string): Promise<PermissionDecision>;
    request(action: string, context?: unknown): Promise<PermissionDecision>;
  };

  context: {
    runtime: "web" | "desktop" | "vscode" | "mobile";
    locale: string;
    timezone: string;
    theme: "light" | "dark";
    directory?: string;
    sessionId?: string;
  };

  logging: {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
  };
}
~~~

Host SDK 是 Native 扩展与 OpenChamber 的唯一稳定契约。扩展不应直接读取 Zustand stores、React Context 私有结构或 Electron IPC。

### 11.7 Native Component 示例

~~~tsx
import {
  useBusinessQuery,
  useBusinessAction,
  useInteractiveHost,
} from "@openchamber/interactive-ui-sdk/react";

export function SalesDashboardView(props: NativeViewProps<SalesContext>) {
  const host = useInteractiveHost();

  const dashboard = useBusinessQuery({
    action: "sales.dashboard.query",
    input: {
      region: props.context.region,
      period: props.context.period,
    },
    initialData: props.snapshot,
    refreshInterval: 30_000,
  });

  const approveOrder = useBusinessAction({
    action: "sales.order.approve",
    onSuccess: () => dashboard.refresh(),
  });

  async function handleApprove(order: SalesOrder) {
    const confirmed = await host.dialog.confirm({
      title: "批准订单？",
      description: "批准后订单将进入履约流程。",
      confirmLabel: "批准",
      tone: "danger",
    });

    if (!confirmed) return;

    await approveOrder.execute({
      orderId: order.id,
      revision: order.revision,
    });
  }

  return (
    <SalesDashboardLayout
      loading={dashboard.loading}
      error={dashboard.error}
      data={dashboard.data}
      onApproveOrder={handleApprove}
      onOpenOrder={(orderId) =>
        host.views.open("com.acme.sales.order-details", { orderId })
      }
    />
  );
}
~~~

### 11.8 数据访问

Native View 默认不拿原始 token，而是调用：

~~~ts
host.business.query("sales.dashboard.query", input);
host.business.execute("sales.order.approve", input);
~~~

Business Client 负责：

- 找到 manifest 声明的 connector。
- 关联当前用户、Session、ToolPart 和 View instance。
- 在服务端注入 token。
- 检查 action 权限。
- 执行用户确认和企业策略。
- 添加 idempotency key。
- 处理 retry、timeout、revision conflict。
- 写审计日志。
- 返回经过 schema 校验的结果。

### 11.9 主题和原生体验

Native View 应使用 Host SDK 提供的 Design System：

- color tokens
- typography
- spacing
- buttons
- dialog
- popover
- table
- tooltip
- focus management
- mobile sheet
- empty/error/loading states

扩展不得复制一套独立的主题系统。复杂第三方组件需要使用 CSS variable 适配 OpenChamber theme。

### 11.10 生命周期

1. Extension manifest 被发现，但 bundle 尚未加载。
2. 收到绑定 tool 或主动打开 View 时触发 activation。
3. Host 校验签名、版本和 runtime capability。
4. Host lazy import Native bundle。
5. 调用 extension.activate。
6. View 注册到 registry。
7. 创建 View instance 并渲染。
8. Session 切换、View 关闭或 extension 禁用时取消 query/subscription。
9. Extension 升级或卸载时调用 activate 返回的 disposer。
10. 组件异常只影响当前 View，由 Error Boundary 回退。

### 11.11 Native 的优势

- 与 OpenChamber DOM、布局和 Design System 无缝整合。
- Dialog、Popover、全屏和快捷键体验自然。
- 可实现复杂业务交互。
- 可以复用成熟 React 生态。
- 不受 Declarative DSL 表达能力限制。
- 适合把现有企业前端模块逐步拆分。

### 11.12 Native 的代价

- 扩展代码获得与宿主相近的信任。
- React/SDK ABI 需要版本治理。
- 错误组件可能影响性能或 UI。
- 跨 runtime 需要开发者明确适配。
- 公共第三方生态不能默认无审核运行。
- 热升级和 chunk 签名比 Declarative 更复杂。

---

## 12. 企业 Native 模块开发指南

本节以“销售仪表盘 + 订单审批”为例，说明一个现有企业模块如何接入。

### 12.1 第一步：划分业务能力

不要先复制整个业务网站。先把模块拆成明确 capability：

查询：

- sales.dashboard.query
- sales.orders.list
- sales.order.get
- sales.anomalies.list

命令：

- sales.order.approve
- sales.order.reject
- sales.followup.create
- sales.report.export

事件：

- sales.order.updated
- sales.dashboard.metric.changed

每个 capability 需要定义：

- input schema。
- output schema。
- 所需权限。
- read/write/destructive 风险等级。
- 幂等规则。
- revision/并发规则。
- 审计字段。

### 12.2 第二步：实现业务 Connector

推荐业务服务同时提供：

~~~text
https://sales.example.com/mcp
https://sales.example.com/ui-api
~~~

MCP 面向 Agent：

- Tool discovery。
- Agent 调用 query/command。
- OAuth。
- 返回 summary 和 Result Envelope。

UI API 面向 Native View：

- 确定性 query/action。
- 分页、订阅和大数据。
- 与 MCP 共用相同的 service/domain layer。
- 不要求 UI 通过模型间接执行每次按钮操作。

推荐服务内部：

~~~text
MCP Controller ─┐
                ├─► Sales Application Service ─► ERP/CRM
UI API Controller┘
~~~

不能让 MCP 与 UI API 分别实现两套业务逻辑。

### 12.3 第三步：实现 Skill

Skill 负责告诉 Agent：

- 什么请求应使用销售模块。
- 什么情况下先查询再审批。
- 哪些操作必须说明理由。
- 大结果不要直接输出到上下文。
- 请求仪表盘时返回哪个 View。
- 哪些操作必须等待用户批准。

示意：

~~~markdown
---
name: acme-sales
description: Query sales dashboards, inspect orders, and perform governed order workflows.
---

## Use this skill when

- The user asks about sales performance, orders, revenue or anomalies.
- The user wants to open the sales dashboard.
- The user wants to approve or reject an order.

## Rules

- Use sales_get_dashboard for dashboard requests.
- Do not print large order lists into chat.
- For approve/reject, inspect the current revision first.
- Never bypass an approval request.
~~~

Skill 不承担 token、HTTP 调用和 UI 渲染。

### 12.4 第四步：实现 MCP Tools

示意 tool：

~~~ts
server.registerTool("sales_get_dashboard", {
  description: "Open the sales dashboard for a region and period",
  inputSchema: {
    region: z.string(),
    period: z.string(),
  },
  outputSchema: dashboardResultSchema,
}, async (input, context) => {
  const snapshot = await salesService.getDashboard(input, context.user);

  const envelope = {
    $schema: "openchamber://interactive-result/v1",
    view: "com.acme.sales.dashboard",
    schemaVersion: 1,
    mode: "live",
    summary: buildDashboardSummary(snapshot),
    context: input,
    data: buildSmallSnapshot(snapshot),
    dataRef: {
      connector: "sales-ui-api",
      resource: "sales.dashboard",
      revision: snapshot.revision,
    },
    updatedAt: snapshot.updatedAt,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(envelope),
      },
    ],
    structuredContent: envelope,
  };
});
~~~

为了兼容当前 OpenCode ToolPart，text content 中必须包含可解析 Envelope；structuredContent 作为标准 MCP 补充。

### 12.5 第五步：实现 Native View

开发者：

1. 安装 Host SDK。
2. 定义 context/result TypeScript 类型。
3. 实现 SalesDashboardView。
4. 只通过 Host SDK 调用业务 action 和宿主能力。
5. 为 inline、workspace、fullscreen 和 mobile 设置布局。
6. 为 loading、empty、error、stale、conflict、permission-denied 提供 UI。
7. 在 activate 中注册 View。

### 12.6 第六步：编写 Manifest

Manifest 将以下内容连接起来：

~~~text
sales_get_dashboard tool
        ↓
com.acme.sales.dashboard View
        ↓
dist/ui.mjs#SalesDashboardView
        ↓
sales-ui-api connector
        ↓
sales.dashboard.query / sales.order.approve
~~~

### 12.7 第七步：构建和签名

构建产物至少包括：

- manifest。
- Skill。
- schema。
- Native ESM bundle。
- CSS。
- 文件 hash 清单。
- 发布者签名。

CI 应验证：

- manifest schema。
- View/result/action schema。
- bundle 中没有 React 副本。
- 没有 secret。
- 所有动态 chunk 已列入 hash。
- Host SDK 兼容范围。
- extension fixture tests。
- Desktop/Web/VS Code/Mobile 支持声明。

### 12.8 第八步：安装

Extension Manager：

1. 读取 manifest。
2. 显示发布者、版本、Native code 警告和权限。
3. 验证签名和 hash。
4. 解包到 OpenChamber extension storage。
5. 生成 OpenCode extension runtime 目录。
6. 注册 MCP connector。
7. 注册 Skill。
8. 索引 View manifest。
9. 必要时重启受管 OpenCode。
10. Native bundle 仍保持 lazy，直到第一次触发。

---

## 13. 不修改 OpenCode 源码的加载方案

### 13.1 OpenCode 现有扩展入口

OpenCode 当前支持：

- 项目级和全局 Skills。
- 项目级和全局 Custom Tools。
- 项目级和全局 Plugins。
- npm plugins。
- Local MCP。
- Remote MCP 和 OAuth。
- 自定义配置路径。
- <code>OPENCODE_CONFIG_DIR</code>。
- <code>OPENCODE_CONFIG_CONTENT</code>。
- Server API 动态增加 MCP。

这些能力足够完成 OCIX v1 的 Agent 侧加载。

### 13.2 合成配置目录

OpenChamber 为已启用扩展生成：

~~~text
<OpenChamber App Data>/
└── extension-runtime/
    ├── skills/
    │   └── acme-sales/
    ├── tools/
    │   └── openchamber-ui.ts
    ├── plugins/
    ├── package.json
    └── generated-opencode.json
~~~

启动受管 OpenCode 时注入：

~~~text
OPENCODE_CONFIG_DIR=<extension-runtime>
OPENCODE_CONFIG_CONTENT=<generated-inline-config>
~~~

原则：

- 不改写用户项目的 opencode.json。
- 不覆盖用户全局配置。
- 用户显式禁用的扩展保持禁用。
- 扩展 namespace 冲突时停止加载并报错。
- managed enterprise policy 可以覆盖用户设置。

### 13.3 MCP 动态注册

只新增 MCP connector 时，可以在 OpenCode ready 后调用动态 MCP add API，不一定重启。

涉及以下内容时通常需要重启或 reload：

- Skill discovery。
- Custom Tool。
- Plugin。
- Native bundle 升级且无法安全热卸载。
- Host SDK 主版本变化。

### 13.4 Native UI 加载

Native bundle 由 OpenChamber Server/Extension Manager 提供受控 URL：

~~~text
/openchamber/extensions/com.acme.sales/1.0.0/ui.mjs
~~~

加载流程：

1. 根据 manifest 定位 bundle。
2. 校验扩展仍处于 enabled。
3. 校验 hash 与签名记录。
4. 检查 CSP 和来源。
5. dynamic import。
6. 验证导出的 extension ID/apiVersion。
7. activate。
8. 注册 Views。

不得直接从 manifest 指定的任意互联网 URL dynamic import Native code。远程包必须先下载、校验、安装，再由 OpenChamber 自己的 extension origin 提供。

### 13.5 外部 OpenCode Server

如果 OpenChamber 连接外部 OpenCode：

- Native/Declarative UI 安装在 OpenChamber Host。
- Skill、Plugin、Custom Tool 和 Local MCP 必须安装在 OpenCode 所在机器。
- Remote MCP 可以通过 OpenCode Server 的动态 MCP API注册。
- Host 与 Server 必须交换 extension capability/version。
- 两侧缺少任意一半时，回退到普通 Tool UI，并给出安装位置提示。

---

## 14. Native 模块完整调用路径

### 14.1 场景

用户输入：

> 打开华东区 2026 年 7 月的销售仪表盘，帮我看看异常订单。

### 14.2 Agent 到 View 的完整路径

~~~text
1. 用户发送消息
      ↓
2. OpenCode 将消息加入 Session
      ↓
3. Agent 发现 acme-sales Skill 和 sales MCP tools
      ↓
4. Agent 按 Skill 指引调用 sales_get_dashboard
      ↓
5. OpenCode 通过 Remote MCP 调用销售业务服务
      ↓
6. 业务服务鉴权并查询 ERP/CRM
      ↓
7. MCP tool 返回 summary + Interactive Result Envelope
      ↓
8. OpenCode 将 tool 结果写入 completed ToolPart.output
      ↓
9. OpenChamber 通过 SDK/SSE 收到 ToolPart
      ↓
10. Interactive Result Resolver 解析 Envelope
      ↓
11. Registry 查找 com.acme.sales.dashboard
      ↓
12. Extension Manager 检查扩展、签名、版本、runtime capability
      ↓
13. 首次使用时 lazy import dist/ui.mjs
      ↓
14. 调用 extension.activate，注册 SalesDashboardView
      ↓
15. 创建 View instance，传入 context、snapshot、dataRef、tool state
      ↓
16. Native View 使用 snapshot 立即首屏渲染
      ↓
17. View 通过 Business Client 查询实时 dashboard 数据
      ↓
18. Business Gateway 从服务端 Secret Store 注入第三方颁发的 Key
      ↓
19. 销售系统返回实时指标、订单和 revision
      ↓
20. Native View 更新图表、表格和异常订单列表
~~~

### 14.3 用户点击“批准订单”的路径

~~~text
1. 用户在 Native View 点击“批准”
      ↓
2. 组件调用 host.dialog.confirm
      ↓
3. 用户确认
      ↓
4. 组件调用 host.business.execute(
     "sales.order.approve",
     { orderId, revision }
   )
      ↓
5. Host 检查 manifest action 声明与 runtime capability
      ↓
6. Host 按 manifest 执行 `permission: ask` 确认策略
      ↓
7. Business Gateway 创建 idempotency key 和审计上下文
      ↓
8. Gateway 使用服务端保存的 scoped Key 调用 sales UI API
      ↓
9. Sales Application Service 按该 Key 的 scope 检查权限、业务规则和 revision
      ↓
10. ERP 执行批准
      ↓
11. 业务服务返回新状态和新 revision
      ↓
12. Gateway 记录 request/session/tool/view/action 上下文；Sales Service 记录最终业务审计
      ↓
13. Native View 刷新 dashboard query
      ↓
14. View 显示成功通知
      ↓
15. 可选：向当前对话附加结构化 action result，
    让 Agent 在后续轮次知道该订单已被批准
~~~

### 14.4 Agent 发起写操作

如果用户直接在对话中说“批准订单 123”：

~~~text
用户消息
  → Agent 调用 sales_order_approve MCP tool
  → OpenCode Permission（按 tool name）
  → 用户批准
  → MCP service 执行业务命令
  → 返回 Result Envelope
  → Native View 渲染最新订单状态
~~~

Agent 路径与 UI 路径最终必须进入同一个 Sales Application Service，不能绕过服务端权限。

### 14.5 历史消息重载

1. Session 历史恢复 ToolPart。
2. Resolver 重新解析保存的 Envelope。
3. 已安装兼容扩展时恢复 Native View。
4. snapshot 先展示调用时数据。
5. live View 明确询问或自动刷新当前数据。
6. 未安装/不兼容时展示 summary 和通用 Tool UI。
7. 历史消息不得因为实时刷新而伪装成原始 snapshot。

---

## 15. Declarative 与 Native 的选择

| 判断问题 | Declarative | Native |
|---|---|---|
| 主要是指标、表格、标准图表吗 | 优先 | 可用但可能过重 |
| 需要复杂业务状态和自定义交互吗 | 受限 | 优先 |
| 需要地图、画布、拖拽、复杂编辑器吗 | 不适合 | 优先 |
| 需要所有 runtime 自动一致吗 | 优先 | 需要适配 |
| 希望模板可热加载、容易审查吗 | 优先 | 较复杂 |
| 开发者是否受信任 | 不要求执行代码信任 | 必须受信任 |
| 是否需要完整 OpenChamber Dialog/Router/Theme | 平台间接提供 | 直接通过 Host SDK |
| 是否希望未来跨 Agent host 移植 | 更容易 | 需要重写宿主适配 |
| 是否允许开发者使用任意 React 库 | 否 | 是，受 bundle 规则限制 |

建议：

- 通用 Interactive UI 使用 Declarative。
- 标准化、简单的企业卡片优先 Declarative。
- 复杂企业模块和现有前端拆分使用 Native。
- 同一 extension 可以同时提供两种 View。
- 可以先用 Declarative 验证业务能力，再升级 Native。
- Native 也可以内部复用平台 Declarative primitives。

---

## 16. Connector 设计

### 16.1 推荐优先级

1. Remote MCP：企业 SaaS、集中部署、OAuth。
2. Local MCP：本地工具、内网适配器、数据库客户端。
3. OpenCode Custom Tool/Plugin：需要 OpenCode session/directory context 的轻量逻辑。
4. Skill + CLI：遗留兼容和快速原型。
5. 直接 bash：不作为标准生产连接。

### 16.2 MCP 的职责

- 向 Agent暴露 tools。
- 提供 input/output schema。
- 执行 Agent 发起的业务操作。
- 支持 OAuth 和远程连接。
- 提供 tool 级 OpenCode Permission。
- 返回 Result Envelope。

### 16.3 Skill 的职责

- 教 Agent 何时选择哪个 tool。
- 描述多步骤业务流程。
- 约束高风险操作。
- 控制上下文和大数据处理。
- 不直接持有连接或 token。

### 16.4 CLI 的职责

CLI 可以在 Local MCP 或 Custom Tool 后面：

~~~text
OpenCode
  → Local MCP
  → acme-sales-adapter
  → legacy-sales-cli
  → 业务系统
~~~

不要让 Agent自由拼装带凭证的 bash 命令。

### 16.5 UI Action 与 MCP

当前阶段，Agent 调用 MCP；Native UI 使用 Business Client/Gateway。

原因：

- OpenCode 持有 MCP client。
- 当前公开 API 适合发现和动态添加 MCP，但没有承诺稳定的任意 tool 直接调用接口。
- UI 按钮需要确定性调用，不应依赖 Agent 再理解一次自然语言。
- 同一业务服务可以同时暴露 MCP 与 UI API，共享 application service。

未来具备稳定 tool invocation API 或 MCP Apps host 后，可以让 Business Client 直接代理 MCP tool。

---

## 17. Connector 认证、业务权限与审计

### 17.1 服务端 Key

- Native bundle、Declarative JSON、manifest、Tool/Skill 和 Result Envelope 均不包含 Key。
- `api-key` 由用户在 Extension Manager 中配置；`issued-key` 用一次性 setup code 在服务端交换；`env-bearer` 仅兼容旧部署。
- OpenChamber Secret Store 保存 Key，Business Gateway 只在请求第三方 API 的最后一跳注入。
- Host SDK 只返回业务数据和受控错误，不暴露 Key、setup code 或签发 URL。
- Connector 和签发端点只能访问 manifest `permissions.network` 声明的 Origin。
- 完整协议见 [OCIX Connector Authentication & Credential Provisioning v1](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)。

### 17.2 权限层次

OpenChamber 客户端边界：

1. Extension install trust：是否允许安装签名包及同页 Native code。
2. Network/Connector allowlist：扩展可以连接哪些固定 Origin。
3. Tool/View/Action binding：调用是否属于已安装扩展的声明能力。
4. User confirmation：写入或破坏性动作是否获得本次明确确认。

第三方业务系统边界：

1. Key 属于哪个租户、环境、主体和 scope。
2. Key 是否有效、过期或已撤销。
3. 当前对象、字段、状态和业务规则是否允许操作。
4. revision/ETag、幂等和最终业务审计。

OpenChamber 不解释第三方角色模型，也不需要承担多用户企业部署。前端隐藏按钮、OCIX `permission` 和确认弹窗都不能替代第三方 API 的最终权限校验。

### 17.3 风险等级

| 等级 | 示例 | 默认策略 |
|---|---|---|
| read | 查询仪表盘、订单详情 | allow 或企业策略 |
| write | 创建工单、批准普通订单 | ask |
| destructive | 删除、退款、生产发布 | ask + 强说明 |
| privileged | 修改权限、导出敏感数据 | ask + 第三方系统拒绝无 scope 的 Key |

### 17.4 审计上下文

~~~json
{
  "actor": {
    "type": "user",
    "id": "user-123"
  },
  "initiator": "native-ui",
  "extensionId": "com.acme.sales",
  "viewId": "com.acme.sales.dashboard",
  "instanceId": "view-instance-456",
  "sessionId": "session-789",
  "toolCallId": "tool-call-101",
  "action": "sales.order.approve",
  "resource": "order-123",
  "idempotencyKey": "approval-...",
  "timestamp": "2026-07-18T10:35:00Z"
}
~~~

---

## 18. 跨 Runtime 行为

### 18.1 Web

- Native bundle由 OpenChamber Server 提供。
- Business Client 通过 authenticated runtime transport。
- 浏览器 CSP 需要允许 extension asset origin。
- 本地文件能力必须通过 RuntimeAPIs。

### 18.2 Desktop

- 使用与 Web相同的共享 React View。
- 可以通过 Host SDK 使用 Desktop 特有能力。
- 不允许 Native extension 直接 import Electron。
- 业务 token 仍留在服务端/安全存储。

### 18.3 VS Code

- Native bundle 加载到 OpenChamber webview。
- 文件导航通过 VS Code runtime bridge。
- 业务连接可能运行在 extension host 或 remote OpenChamber/OpenCode 所在端。
- manifest 必须声明是否支持 vscode。

### 18.4 Hosted/Capacitor Mobile

- Mobile 不运行本地 OpenCode。
- Native bundle 和业务数据由连接的 OpenChamber Server 提供。
- View 必须支持触摸、窄屏和 sheet/dialog 降级。
- 不支持的 native capability 必须返回明确结果。

### 18.5 Capability 声明

~~~json
{
  "runtimeSupport": {
    "web": "full",
    "desktop": "full",
    "vscode": "full",
    "mobile": "limited"
  },
  "limitations": {
    "mobile": [
      "report-export-download-only",
      "no-bulk-drag-drop"
    ]
  }
}
~~~

---

## 19. 版本兼容

### 19.1 独立版本

需要分别版本化：

- OCIX package manifest。
- Interactive Result Envelope。
- Declarative View schema。
- Host SDK。
- Extension package。
- Connector API。
- View result schema。

### 19.2 兼容规则

- Envelope 新增可选字段属于向后兼容。
- 删除字段、改变语义或必填属于主版本变化。
- Host SDK 主版本不匹配时不加载 Native bundle。
- Declarative 未知 primitive 默认拒绝该 View，不猜测渲染。
- Result schema 失败时回退。
- Extension 可以声明多个 tool alias 处理上游命名变化。
- 历史 View 必须支持至少一个明确的迁移窗口。

### 19.3 Native ABI

Native 扩展只能依赖公开 SDK：

~~~text
@openchamber/interactive-ui-sdk
@openchamber/interactive-ui-sdk/react
@openchamber/interactive-ui-components
~~~

禁止依赖：

~~~text
packages/ui/src/stores/*
packages/ui/src/contexts/*
packages/electron/*
packages/vscode/src/*
~~~

---

## 20. 故障与回退

| 故障 | 行为 |
|---|---|
| Extension 未安装 | 通用 Tool UI + 安装提示 |
| Extension 被禁用 | 通用 Tool UI |
| Manifest 无效 | 不注册扩展，显示诊断 |
| 签名失败 | 拒绝 Native 加载 |
| Host SDK 不兼容 | 不 import bundle，显示升级建议 |
| Result Envelope 无效 | 通用 Tool UI |
| Result schema 不匹配 | 通用 Tool UI + 开发诊断 |
| Generated layout 含未知/越权节点 | 丢弃该节点；不能执行 action/query/HTML，原始 Tool output 仍可查看 |
| Native import 失败 | 局部错误卡 |
| Native render 崩溃 | Error Boundary，不影响消息列表 |
| Query 失败 | 保留 snapshot，标记实时数据不可用 |
| Action 被拒绝 | 显示 permission denied，不伪装成功 |
| Revision 冲突 | 提示刷新，不自动覆盖 |
| Connector 断开 | 保留历史数据和重连入口 |
| 外部 OpenCode 缺少 Agent 扩展 | UI 仍可加载，但 Agent tool 不可用提示 |

---

## 21. 平台实现模块建议

~~~text
packages/ui/src/interactive-ui/
├── core/
│   ├── resultResolver.ts
│   ├── registry.ts
│   ├── stateAdapter.ts
│   └── errors.ts
├── declarative/
│   ├── schema.ts
│   ├── renderer.tsx
│   ├── bindings.ts
│   ├── actions.ts
│   └── primitives/
├── native/
│   ├── loader.ts
│   ├── activation.ts
│   ├── hostSdk.ts
│   └── NativeViewBoundary.tsx
├── extensions/
│   ├── manifest.ts
│   ├── catalog.ts
│   ├── trust.ts
│   └── compatibility.ts
└── business/
    ├── client.ts
    ├── permissions.ts
    └── auditContext.ts
~~~

服务端建议：

~~~text
packages/web/server/lib/extensions/
├── routes.js
├── installer.js
├── registry.js
├── asset-server.js
├── opencode-runtime.js
├── business-gateway.js
└── signature-verifier.js
~~~

模块位置只是设计建议；正式实现前需按 OpenChamber owning module 和项目 skill 再确认。

---

## 22. 实施路线

阶段状态不是发布日期承诺：A 已完成 v1；B/C 已达到 Managed Distribution Preview；D 的客户端分发治理与 Connector Authentication v1 已完成，签名生态运营治理仍未完成；业务权限治理明确由第三方系统负责；E/F 尚未实施。

### Phase A：Interactive UI Core

- Result Envelope v1。
- Registry 与 fallback。
- 内置 openchamber_ui Tool。
- 内置 Declarative primitives。
- Skill。
- fixture preview。

### Phase B：Declarative Extension

- Agent Generated Declarative grammar 与客户端安全重建。
- 指标、图表、表格、流程、列表、状态和说明组件。
- Extension manifest v1。
- Declarative schema、bindings、query、action。
- Remote/Local MCP tool 可以返回 OCIX Envelope；专用 connector registration **未完成**。
- 开发目录加载与 Extension Manager enable/disable **已实现**。
- 一个真实只读企业仪表盘。

### Phase C：Native Extension MVP

- Host SDK v1。
- Native lazy loader。
- bundle hash/ETag、内嵌公钥 Ed25519 `.ocix` 签名验证、capability review 和 publisher trust UI **已实现**。
- Business Client/Gateway。
- 一个销售仪表盘 Native module。
- 一个受控写操作。
- Web/受管 Desktop 路径已实现；VS Code Gateway 与完整 Mobile 验证 **未完成**。

### Phase D：分发治理与 Connector 认证

- 签名静态目录/私有 marketplace、客户端目录浏览与安装 **已实现**。
- 原子安装、enable/disable、升级、回滚和可恢复卸载 **已实现**。
- 多扩展共享 `~/.config/opencode/tools`/`skills` 的受管 Agent Runtime 部署、冲突保护与 OpenCode refresh **已实现**。
- `api-key`、`issued-key`、服务端 Secret Store、连接测试/替换/断开和卸载清理 **已实现**。
- 业务 Key 的 scope、RBAC/ABAC、撤销与业务审计由第三方 API **负责**。
- 在线签名 key revocation、透明日志和恶意包响应。
- capability compatibility matrix。

### Phase E：Agent HTML Artifact

- 线程作用域 HTML fragment artifact。
- 透明、自适应高度 sandbox 与严格 CSP。
- 统一主题、locale、图标和响应式 design system 注入。
- 只开放 follow-up、复制、外链等窄 Host Bridge；禁止 tool/API/token 访问。
- 历史消息重放、大小上限、离线资源和视觉回归。

### Phase F：开放生态与 MCP Apps

- Sandboxed third-party UI。
- MCP Apps capability 和 metadata。
- 跨 Agent host 可移植。
- 公共扩展签名和审核。

---

## 23. 验收标准

### Declarative

- schema validator 能定位到具体字段。
- 未知 primitive 不会让聊天崩溃。
- template 不执行 JavaScript。
- action 只能调用 manifest allowlist。
- Agent 能针对流程、趋势看板和对比表等不同任务组合布局，而不是依赖逐场景固定模板。
- Generated layout 不能声明 binding/query/action，且通过深度、节点和数据量上限测试。
- Desktop/Web/VS Code/Mobile 有确定行为。
- fixture、snapshot、live 和 error 状态均可预览。

### Native

- 扩展不修改 OpenChamber 源码即可安装。
- 未触发 View 时不加载 bundle。
- 不打包重复 React。
- 只依赖公开 Host SDK。
- Dialog、Theme、Navigation 和 Business Client 工作正常。
- bundle 崩溃只影响当前 View。
- Native 权限和发布者信任对用户可见。
- 用户业务操作通过第三方服务端 Key 权限、幂等和审计；OpenChamber 负责确认和 Gateway allowlist。
- 历史 ToolPart 可以恢复 snapshot。
- 外部 OpenCode 缺少扩展时有清晰降级。

### 端到端企业模块

- 用户自然语言可以触发 Skill 和 MCP tool。
- Tool result 能选择正确 Native View。
- View 首屏可以使用 snapshot。
- View 能查询真实 API。
- 用户可以执行一个受控写操作。
- 操作结果能刷新 UI并可选反馈给 Agent。
- 所有步骤可审计。
- 无 token 出现在 ToolPart、日志或前端 bundle。

---

## 24. 待定问题

正式实现前需要通过 ADR 明确：

1. 已采用 Ed25519 `.ocix` 签名包与 pinned publisher/marketplace public key；企业 CA、吊销和透明日志仍需 ADR。
2. Web/Desktop/Hosted Mobile 使用 Host Extension Manager；VS Code 的扩展 asset 分发方式仍待定。
3. Host SDK 的 semver 和兼容窗口。
4. Native CSS 隔离是 namespace、CSS Modules 还是 Shadow Root。
5. 当前 Connection Secret Store 依赖操作系统账号权限；系统 Keychain/KMS 存储后端仍需 ADR。
6. 非 Key 型认证（例如必须交互登录的 OAuth）是否作为独立可选 Connector 类型。
7. UI action result 如何以结构化 part 反馈给当前 Agent Session。
8. 外部 OpenCode Server 的双端扩展协商。
9. Declarative binding 采用 JSON Pointer、受限 JSONPath 还是自有路径语法。
10. active version 回滚已实现；已加载 Native ESM 的无刷新热卸载策略仍待定。
11. 大数据 dataRef 的缓存、过期和历史保留策略。
12. MCP Apps 最终与 OCIX manifest、Envelope 的映射方式。

---

## 25. 参考资料

- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode Configuration and precedence](https://opencode.ai/docs/config/)
- [OpenCode Server/OpenAPI](https://opencode.ai/docs/server/)
- [AI SDK UI – Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [MCP Tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code Webview security](https://code.visualstudio.com/api/extension-guides/webview#security)
- [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/26/)

---

*范围：fork 内部架构与扩展开发规范，非 OpenChamber upstream 官方文档。*
