# Interactive UI 视觉、HTML Artifact 与统一验收计划

> 文档性质：实施主计划（规划，不代表全部能力已经交付）  
> 适用分支：`docs/interactive-ui-mcp-apps`  
> 更新日期：2026-07-21  
> 关联文档：[美化开发指南](./INTERACTIVE_UI_BEAUTIFICATION.md) · [扩展架构](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md) · [Agent Routing Plan](./INTERACTIVE_UI_AGENT_ROUTING_PLAN.md) · [ChatGPT/Codex Artifact 调研](./CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md)

> 下一阶段的具体工作分解、批次依赖和验收门槛见 [美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)。本文保留完整架构设计与历史实施背景，执行时以新计划为准。

> 实施快照：A0-A3 的视觉合同和 B0-B6 的主要代码路径已经落地；Static Artifact 已在真实 OpenChamber 对话中生成、渲染和历史回放。2026-07-21 的浏览器攻击探针发现直接 sandbox iframe 存在下载/导航网络旁路，随后落地的受信 Broker + opaque `data:` 子 frame 已通过零目标请求、Bridge 白名单与导航阻断矩阵。Scripts 仍缺少宿主可独立终止的 CPU/内存边界，因此当前保持 experimental、默认关闭且不属于生产发布范围。统一验收中的真实 CRM/OCIX 闭环与 62 张正式视觉 Golden 已完成；剩余门禁是安全总矩阵、三模型同语料和 Runtime/性能总表。

## 0. 结论与执行顺序

本轮按以下顺序推进：

```text
A. 视觉系统与组件库扩展
        ↓
B. HTML Artifact Runtime
        ↓
C. 三条 UI 路径的统一测试与发布验收
```

三条最终需要统一验收的运行路径：

| 路径 | 内容作者 | 执行边界 | 主要用途 |
|---|---|---|---|
| Agent Generated Declarative | Agent | OpenChamber 同页受控 renderer；data-only | 流程、图表、表格、分析看板和通用可视化 |
| Installed Declarative / Trusted Native | 企业开发者 | Declarative 无代码；签名 Native 同页可信代码 | 真实企业 API、查询、下钻和确认式写入 |
| HTML Artifact | Agent | 不可信 HTML/CSS/SVG/受限 JS，隔离执行 | 自定义图形、模拟器、探索器和标准组件无法表达的临时界面 |

统一测试安排在 A、B 功能完成以后，以一份测试矩阵验证三条路径的一致体验、路由、安全、回放和跨模型行为。这里的“最后统一测试”不代表开发阶段完全不测试：每个阶段仍必须通过单元测试、类型检查、Lint、构建和最低安全门禁，避免把基础问题积累到最后。

## 1. 初始基线与当前进度

已经具备：

- `openchamber://interactive-result/v1` 严格 Result Envelope。
- Agent Generated Declarative allowlist、深度/节点/文本/表格/图表数据上限。
- Installed Declarative query/action、写后刷新与 Business Gateway。
- Trusted Native ESM 激活、签名 OCIX、发布者信任和 Extension Manager。
- 动态 Capability Catalog、会话路由注入和 Routing Inspector。
- Simple CRM 业务 Tool、真实 View、服务端凭据和确认式写入示例。

本轮原计划缺口及当前状态：

- `--ocix-*` 视觉 Token、`.ocix-scope` 和既有节点升级：**已实现**。
- 第一批 Declarative 通用组件库和 Native Host UI Kit：**已实现**。
- HTML Artifact 的独立结果协议、Agent Tool、内容寻址存储、隔离 renderer、CSP、Bridge、展开模式和历史回放：**Static Runtime v1 已实现；Scripts 网络与 Bridge 门禁已通过，但因无独立终止边界保持 experimental/default-off**。
- 路由优先级、Capability、Routing Inspector、静态/scripts feature gate 与 unsupported runtime 降级：**已实现**。
- 覆盖三条路径的统一功能、安全、视觉、模型和多 Runtime 验收：**自动化/Web/Hosted Mobile 基线已通过；Managed Desktop 可见性基线通过，跨模型和完整 Desktop 最终门禁待完成**。

### 1.1 2026-07-20 验收快照

| 范围 | 结果 | 证据/说明 |
|---|---|---|
| Generated / Installed / Native / Artifact 系统闭环 | 通过 | `bun run test:interactive-ui`；包含路由、真实 Gateway 查询、确认式写入、Artifact materialize |
| OCIX 打包、签名、Marketplace、脚手架 | 通过 | `bun run test:interactive-ui-extension`，6/6 |
| 全仓静态门禁 | 通过 | `bun run type-check`、`bun run lint`、`bun run docs:validate`、`bun run build:web` |
| Artifact parser / Bridge / Tool payload | 通过 | 严格 schema、channel/sequence/大小限制和渲染型 Tool 原始载荷隐藏测试 |
| 真实 Web 对话 | 部分通过 | Qwen3.7 Plus 生成静态 SVG 与 scripts opt-in 学习率模拟器；对话内渲染、滑块和数值更新成立，但旧样例代码错误导致 SVG 曲线未更新，完整交互改由确定性 fixture 验收 |
| 显示模式 | 通过 | inline → workspace → fullscreen → inline 复用同一 iframe URL 和状态 |
| 历史回放 | 通过 | 清空 Artifact cache 后由 Tool 历史重建，相同内容 hash 恢复 |
| 响应式与主题 | 基线通过 | dark/light host；1440/1024/768 Desktop 无横向溢出；390 Hosted Mobile 两个 iframe 为 320 px |
| Artifact 安全响应头 | 部分通过 | static 契约通过；scripts Broker 的 CSP/sandbox、真实零请求攻击矩阵与 Bridge 白名单通过；独立 CPU/内存终止边界未通过，因此只能 experimental/default-off |
| 跨模型最终矩阵 | 未完成 | Qwen3.7 Plus 已通过 static + interactive Artifact，Big Pickle 已通过 static Artifact；仍需让一个已连接 OpenAI 模型和这两个非 OpenAI 模型运行完全相同的 12–20 条语料，不能把“可见模型目录”当成可调用成功 |
| Managed Desktop 独立运行 | 部分通过 | 打包 arm64 `.app` 已通过 static/scripts Artifact 可见性、sandbox 和历史刷新；仍需 scripts-disabled fallback、cache 重建、显示模式、主题和终止/kill-switch 验收 |

详细证据和剩余发布门禁记录在 [统一验收报告](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md)。

## 2. 总体原则

### 2.1 体验原则

- 默认在对话流中内联展示，不把侧边栏或弹窗作为唯一入口。
- inline、workspace、fullscreen 是同一内容的显示模式，不是三套实现。
- 隔离机制不应表现为传统网页嵌入：默认透明背景、无 iframe 边框、无双重滚动条、自动高度。
- Generated Declarative 和 HTML Artifact 都必须保留原始 Tool 文本 fallback，渲染失败不能让消息消失或让聊天崩溃。
- 标准组件能够表达时优先 Generated Declarative；只有 DSL 无法合理表达时才调用 HTML Artifact。
- 企业真实数据始终通过 Installed Declarative / Trusted Native 与 Business Gateway；HTML Artifact 不成为绕过企业扩展治理的捷径。

### 2.2 安全原则

- Agent 生成的 JSON、HTML、CSS、SVG、JavaScript 一律是不可信输入。
- Generated Declarative 继续由 allowlist 重建，不开放任意 `style`、`className`、HTML、query 或 action。
- HTML Artifact 不在 OpenChamber 主页面权限域执行，不获得 Connector、Token、Tool、文件系统、Cookie、Local Storage 或父页面 DOM。
- HTML Artifact 不允许直接访问公网、局域网、localhost 或 Business Gateway；业务动作只能通过后续 Agent 对话或已安装企业扩展完成。
- Trusted Native 的信任基础仍是签名、发布者信任、版本固定、安装审查和受控 Host API；不能把它与 Artifact sandbox 混成一种 runtime。
- 静态扫描只能提供开发提示，真正的安全边界必须由 sandbox、CSP、独立权限域、资源限制和 Bridge allowlist 强制执行。

### 2.3 兼容原则

- 现有 Declarative JSON 不修改即可获得渲染层视觉升级。
- 新节点和新字段全部可选；旧 OCIX、旧消息和旧 Tool output 继续运行。
- HTML Artifact 使用独立 schema，不扩张 `openchamber://interactive-result/v1` 的信任语义。
- VS Code、Mobile 或外部 OpenCode Runtime 暂不支持某项能力时必须返回明确 capability/fallback，不能静默执行弱化安全版本。

## 3. 目标架构

```text
用户问题
  ↓
Agent 路由
  ├─ 标准组件足够 ─────────────→ interactive_ui
  │                                  ↓
  │                         Generated Declarative
  │                                  ↓
  │                         Declarative Renderer
  │
  ├─ 已安装企业能力匹配 ───────→ OCIX Business Tool
  │                                  ↓
  │                    Installed Declarative / Native
  │                                  ↓
  │                         Business Gateway
  │
  └─ 需要任意临时表现代码 ─────→ html_artifact
                                     ↓
                         Artifact Result Envelope
                                     ↓
                      Materialize + Sandbox Renderer
                                     ↓
                          Narrow Host Bridge
```

路由优先级保持：显式 Tool → 已安装业务 Tool → 其他专用 Tool → Generated Declarative → HTML Artifact（确有表现力缺口时）→ 普通文本。HTML Artifact 不是所有可视化的新默认项。

---

# A. 视觉系统与组件库扩展

## 4. A0：冻结视觉合同

### 4.1 Token 策略

建立 `.ocix-scope` 和 `--ocix-*` 语义 Token。采用“宿主中性基础 + OCIX 稳定语义色”的混合策略：

- surface、foreground、muted、border 与 OpenChamber 明暗模式和中性层级保持协调。
- success、warning、error、info 和 chart series 使用稳定的 OCIX 语义色。
- 扩展只能使用语义枚举或 Host UI Kit，不能提供 hex/rgb/hsl/oklch、任意 CSS 变量或任意 class。
- Artifact 获得相同语义 Token 的只读值，但不能覆盖宿主 Token。

这项决策保留美化文档的可验证性，同时避免固定蓝紫面板与 OpenChamber 宿主视觉割裂。实施时同步修订 `INTERACTIVE_UI_BEAUTIFICATION.md` 中“完全独立固定色板”的表述。

### 4.2 视觉状态合同

所有 Installed View 使用同一组状态：

| 状态 | 含义 | UI 要求 |
|---|---|---|
| `loading` | 首次读取或刷新 | Skeleton；保留布局，避免跳动 |
| `ready` | 数据契约校验成功 | 显示真实数据和更新时间 |
| `empty` | 请求成功但集合为空 | 明确空状态，不用零值冒充业务指标 |
| `unconfigured` | 没有凭据 | 显示配置入口，不回退生成假数据 |
| `unreachable` | 上游不可达/超时 | 显示可重试状态和最后检查时间 |
| `unauthorized` | Key 无效/过期 | 显示重新连接入口，不暴露响应正文 |
| `forbidden` | 第三方系统拒绝权限 | 说明权限由第三方系统决定 |
| `stale` | 保留旧 snapshot，刷新失败 | 标注旧数据，不伪装最新结果 |

`View rendered` 与 `Business data loaded` 是两个独立成功信号。视觉层实现先落地状态组件，统一测试阶段再与 Business Runtime Readiness 的完整追踪打通。

### 4.3 A0 交付物

- `packages/ui/src/styles/ocix-theme.css`
- `.ocix-scope` 挂载到 Declarative、Native、Artifact host、loading 和 error 容器。
- Token 文档、状态文档和一页 fixture gallery。
- 明暗模式、主题切换和旧 View 零修改兼容 smoke。

## 5. A1：现有 Declarative 节点美化

按视觉收益优先实施：

1. section：用留白建立层级，减少卡片套卡片；保留显式 `bordered` 变体。
2. metric / metric-grid：增加 `tone`、`trend`、`trendValue`、同比/环比辅助信息。
3. flow：增加 completed / active / error / pending 状态和连接线语义。
4. data-table：斑马行、数值对齐、粘性表头、空状态、横向滚动和有操作时的 hover。
5. chart：弱化网格、优化图例、轴、柱圆角、donut 中心、颜色对比度。
6. list / callout / progress / status：统一图标、语义色、密度和完成态。
7. 新增 `divider` 与 Skeleton/empty/error state primitives。

每个新字段必须同步修改：

- TypeScript 类型。
- Declarative renderer。
- `generatedLayout.ts` allowlist 和边界。
- Web server package-format 静态校验。
- Agent Tool schema/description。
- 示例 View、开发者文档和单元测试。

禁止只修改 renderer 而让 Agent schema、sanitizer 和扩展 validator 产生漂移。

## 6. A2：通用组件库扩展

组件按“Generated 可用”“Installed 可用”“Native UI Kit”三个层次分配权限。

### 6.1 第一批通用只读组件

允许 Generated Declarative 与 Installed Declarative 使用：

- `timeline`：里程碑、版本历史、事件流。
- `activity-feed`：操作者、事件、时间和状态。
- `comparison`：多方案、多模型、多版本对比。
- `sparkline`：指标卡内小趋势。
- `tree`：文件、组织、分类等有限深度层级。
- `tabs`：同一 snapshot 的本地内容切换。
- `accordion`：解释内容的本地展开收起。
- `code-block` / `diff-summary`：只读代码和差异概览。
- `git-graph`：标准提交/分支/合并图；数据来自用户或 Tool snapshot。

Generated 路径仍不允许 query、action、文件读取或网络访问。tabs、排序、过滤、折叠等只改变本地展示状态，不产生宿主副作用。

### 6.2 Installed Declarative 专用交互组件

只允许已安装、签名且 manifest 声明 query/action 的 View 使用：

- filter bar、分页、刷新和查询参数。
- row actions、detail drawer、确认对话框。
- input、select、textarea、date range 等受控表单。
- write action 状态、幂等键、成功后 query refresh。

Generated Declarative 不开放可提交表单，避免模型生成的 UI 冒充真实业务操作。

### 6.3 第二批暂缓组件

地图、自由拓扑编辑器、大型流程设计器、任意 Canvas、复杂富文本编辑器不强塞进第一批 DSL。若任务是一次性临时表现，优先 HTML Artifact；若是长期企业模块，优先 Trusted Native。

## 7. A3：Native Host UI Kit

将当前只暴露 `Button` 的 Native Host 扩展为版本化 UI Kit：

- Layout：Card、Section、Stack、Grid、Tabs、Separator、ScrollArea。
- Data display：Badge、Metric、Status、Table、Skeleton、Progress、EmptyState。
- Inputs：Input、Textarea、Select、Checkbox、Date/Range primitives。
- Feedback：Callout、Dialog、Confirmation、Toast adapter。
- Host services：theme、locale、display mode、business query/action、open settings。

约束：

- 只增不破坏 `apiVersion: 1` 的字段可以向后兼容；若组件 props 或行为需要稳定保证，建立 `uiVersion`，不要无限扩张松散的 `Record<string, unknown>`。
- Native 扩展复用 Host React 和 Host UI Kit，不打包 React 副本，不注入全局 CSS。
- UI Kit 对外类型应能被 OCIX starter 直接引用，并配套 Story/fixture 页面。

## 8. A4：交互、美学和可访问性收尾

- 图表 tooltip、legend focus、键盘导航和移动端触控目标。
- `prefers-reduced-motion`，不依赖大面积 blur/backdrop-filter。
- WCAG 对比度检查；状态不能只依赖颜色。
- 中文、英文、长数字、长名称、RTL 和窄屏溢出。
- inline/workspace/fullscreen 的密度与最大宽度策略。
- 视觉回归基准：light/dark × desktop/mobile × generated/installed/native。

## 9. A 阶段完成门槛

- 旧 Declarative fixture 不改 JSON 即获得一致的新视觉。
- Agent 新字段通过 sanitizer；非法枚举、任意颜色、style/className 仍被剥离。
- 至少一个 Generated 页面、一个 Installed Declarative 页面和一个 Trusted Native 页面使用同一 Token/UI Kit。
- loading、ready、empty、unreachable、unauthorized 和 stale 有明确视觉差异。
- Git graph 等标准效果能由组件库表达，不需要为了常见图形调用 Artifact。
- 通过类型、Lint、构建、单元和基础视觉 smoke 后才进入 B 阶段。

---

# B. HTML Artifact Runtime

## 10. B0：ADR 与能力边界冻结

开始写 renderer 前先提交 Artifact ADR，必须冻结：

1. 独立 Result Envelope 与 Agent Tool contract。
2. artifact source 的大小、文件数和内容类型上限。
3. materialize、content hash、缓存、历史回放和删除策略。
4. sandbox flags、CSP、权限域和不同 Runtime 的 process-isolation 能力。
5. Host Bridge 方法、方向、schema、频率限制和用户激活要求。
6. inline/workspace/fullscreen 显示规则与高度协议。
7. 外部 OpenCode、VS Code、Desktop、Web、Mobile capability matrix。
8. 失败 fallback、禁用开关和紧急 kill switch。

### 10.1 v1 明确支持

- 单文档 HTML、CSS、SVG 和受限原生 JavaScript。
- 本地交互：筛选、切换、拖动参数、动画、模拟计算和自定义绘图。
- Host 注入主题、locale、timezone、宽度、reduced-motion 和安全图标版本。
- Artifact 请求调整高度、复制文本、打开受控外链、把 follow-up 填入聊天输入框。
- 默认 inline，可展开 workspace/fullscreen。

### 10.2 v1 明确不支持

- npm install、动态 import、CDN 脚本、远程字体或远程图片。
- `fetch`、WebSocket、EventSource、Beacon、表单提交和 localhost/局域网访问。
- Business Gateway、Connector、MCP、OpenCode Tool 或 Secret。
- 父页面 DOM、Cookie、Local Storage、IndexedDB、文件系统、剪贴板读取。
- popup、下载、顶层导航、嵌套 iframe、object/embed。
- 自动发送 follow-up；v1 只填入 composer，由用户确认发送。

## 11. B1：独立 Artifact Result Contract

建议新增独立协议：

```json
{
  "$schema": "openchamber://html-artifact-result/v1",
  "schemaVersion": 1,
  "title": "Git 分支探索器",
  "summary": "交互查看提交与合并关系",
  "html": "<!doctype html>...",
  "display": {
    "preferred": "inline",
    "allowExpand": true
  },
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

第一版采用单一、自包含 HTML 文档，CSS、SVG 和脚本内联；不支持任意多文件依赖。这样可以先固定安全模型、回放和 CSP，后续再通过协议版本升级支持受控资源表。

建议初始边界：

- Result Envelope 最大 256 KiB。
- `html` 最大 192 KiB。
- title 120 字符，summary 500 字符。
- 单个 ToolPart 一个 Artifact；每条消息最多 3 个。
- 禁止无法识别的顶层字段进入 runtime。
- 服务端重新计算 SHA-256，不信任 Agent 提供的 hash。

新增独立 `html_artifact` Agent Tool：

- 只有 Generated Declarative 无法合理表达时调用。
- Tool 只生成 Artifact source，不执行代码。
- 不允许宣称包含实时企业数据；用户提供或模拟数据必须标明来源。
- Tool description 明确它排在已安装业务 Tool 和 Generated Declarative 之后。

## 12. B2：Materialize 与历史回放

### 12.1 数据流

```text
html_artifact Tool completed
  ↓
严格解析 Artifact Envelope（仍是普通字符串数据）
  ↓
POST /api/interactive-ui/artifacts/materialize
  ↓
服务端验证边界、计算 content hash、生成不可变资源
  ↓
返回 artifactId + sandbox URL + CSP revision
  ↓
HTMLArtifactView 在隔离容器加载
```

### 12.2 存储策略

- 工具消息中的 Artifact Envelope 是历史重放的内容来源。
- 服务端使用内容寻址存储：相同 HTML 只保存一份，目录名来自服务端 SHA-256。
- 写入使用临时文件 + 原子 rename，避免半写入资源。
- session/message/toolCall 只作为引用元数据，不进入可执行页面。
- 缓存缺失时可从历史 Tool output 重新 materialize。
- 会话删除时移除引用；内容按 LRU/引用计数清理。
- 初始全局磁盘预算建议 250 MiB，可在设置中查看并清理 Artifact cache。
- 不把 Artifact 当 OCIX 安装包，也不进入 Extension Manager、Publisher 或 Marketplace。

### 12.3 服务端接口

- `POST /api/interactive-ui/artifacts/materialize`
- `GET /api/interactive-ui/artifacts/:artifactId/document`
- `GET /api/interactive-ui/artifacts/:artifactId/metadata`
- `DELETE /api/interactive-ui/artifacts/cache`（用户主动清理）

所有接口继续经过 OpenChamber UI auth；document route 使用专用响应头，不返回 session、prompt 或 Tool metadata。

## 13. B3：Sandbox 与 CSP

### 13.1 iframe 权限

v1 容器使用 sandboxed iframe，只考虑必要的 `allow-scripts`：

```html
<iframe sandbox="allow-scripts" ... />
```

明确不加入：

- `allow-same-origin`
- `allow-forms`
- `allow-popups`
- `allow-top-navigation`
- `allow-downloads`
- `allow-modals`
- `allow-pointer-lock`

不带 `allow-same-origin` 时 Artifact Document 处于 opaque origin，不能读取父页面或宿主同源数据。

### 13.2 CSP 基线

Artifact document response 使用独立 CSP，建议基线：

```text
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data: blob:;
font-src data:;
connect-src 'none';
worker-src 'none';
frame-src 'none';
object-src 'none';
media-src 'none';
base-uri 'none';
form-action 'none';
```

同时设置 `X-Content-Type-Options: nosniff`、严格 Referrer Policy、受限 Permissions Policy 和禁止缓存敏感上下文。CSP 不包含 `unsafe-eval`、`wasm-unsafe-eval` 或任何远程源。

### 13.3 CPU/内存风险

iframe sandbox 可以隔离权限，但不能在所有浏览器和 Runtime 上保证恶意死循环一定运行在可终止的独立进程。因此采用两级交付：

1. **B3a 静态 Artifact**：HTML/CSS/SVG，无脚本，所有 Web/Desktop runtime 可先启用。
2. **B3b Interactive Artifact**：只有在目标 Runtime 能提供可终止的独立 renderer/process 或经过明确安全评审后启用 `allow-scripts`。

若 Web Runtime 无法证明进程级可终止性，交互 JS 保持 experimental capability；不能用一个无法真正中断的前端 watchdog 冒充资源隔离。无 JS 时仍可展示自定义 SVG、Git 图和复杂静态可视化。

## 14. B4：Narrow Host Bridge

Bridge 使用 `postMessage`，但不能只检查 `origin`，因为 opaque sandbox 的 origin 为 `null`。Host 必须同时校验：

- `event.source === iframe.contentWindow`
- 每次 mount 随机生成的 channel ID
- 协议版本、消息方向、严格 schema 和单调 sequence
- payload 字符数/对象深度上限
- 每秒消息频率和连续 resize 限制

### 14.1 Host → Artifact

- `host.init`：theme tokens、light/dark、locale、timezone、viewport、reducedMotion、bridgeVersion。
- `host.visibility`：inline/workspace/fullscreen 与是否可见。
- `host.themeChanged`：宿主明暗或 Token 变化。

### 14.2 Artifact → Host

- `artifact.ready`
- `artifact.resize`：由 ResizeObserver 触发；inline 高度限制建议 120–900 px。
- `artifact.copyText`：只允许写剪贴板，要求最近的用户激活。
- `artifact.openExternal`：只允许 http/https，Host 再做 URL 和用户激活检查。
- `artifact.proposeFollowUp`：最大 4,000 字符，只填入聊天输入框，不自动提交。
- `artifact.requestExpand`：切换 workspace/fullscreen。
- `artifact.reportError`：脱敏错误类型、行列和 Artifact hash，不包含整个 source。

明确不存在 `callTool`、`businessQuery`、`businessAction`、`getToken`、`readFile`、`writeFile`、`clipboardRead` 等 Bridge 方法。

## 15. B5：对话流与显示体验

- Tool running：显示与 Declarative 同风格的 Skeleton。
- Tool completed：先显示 title/summary，Artifact ready 后无闪烁替换主体。
- 自动高度：对短内容贴合；超过 900 px 使用内部受控滚动并提供“展开”。
- Artifact 外层由 OpenChamber 提供标题、来源标记、运行状态、重新生成、展开和查看错误；Artifact 不能覆盖这些宿主控件。
- 默认透明背景和 Host Token 注入；页面不能设置宿主外层背景、z-index 或全屏覆盖。
- Artifact 崩溃、CSP 拒绝或超时：显示可见错误、保留 summary 和原始 Tool fallback，可重试 materialize。
- 历史消息打开时不重新调用模型；直接从 content hash 资源回放。
- 重新生成产生新 revision，旧消息继续指向旧 hash，保证历史可复现。

## 16. B6：路由和能力发现

更新动态 Routing Context：

- `interactive_ui`：标准组件可以表达的临时可视化。
- `html_artifact`：需要自定义 HTML/SVG/模拟器/探索器且没有业务扩展匹配。
- 已安装业务 Tool 始终优先于两者。
- Runtime 不支持 Artifact 时不把 `html_artifact` 放入当前可调用 Capability Catalog；外部 OpenCode Tool set 存在但 Host 不支持时返回明确 unsupported。

固定路由用例：

| 请求 | 期望路径 |
|---|---|
| “画一下 LLM 强化学习流程” | Generated Declarative |
| “做一个销售趋势图”且数据已给出 | Generated Declarative |
| “展示这个仓库的标准 Git 分支图” | `git-graph` Declarative primitive |
| “做一个可以拖动参数观察曲线变化的优化器模拟器” | HTML Artifact |
| “画一个完全自定义的交互式 SVG 拓扑探索器” | HTML Artifact |
| “查看 CRM 客户和商机” | Installed CRM Tool |
| “用 HTML Artifact 直接连接 CRM API” | 拒绝直连；使用 Installed CRM Tool |

## 17. B 阶段完成门槛

- Artifact schema/parser 对任意普通 Tool output 不误激活。
- Artifact 不能读取父 DOM、Cookie、Local Storage、Connector 或 Gateway。
- 网络、表单、popup、下载、顶层导航、iframe 和 Worker 被强制阻断。
- Bridge 只包含 allowlist，伪造 channel、超限 payload 和 resize flood 被拒绝。
- inline 透明、自适应高度，无双重边框；workspace/fullscreen 可复用同一 Artifact。
- 历史消息离线回放、缓存丢失重建和会话删除清理成立。
- 不支持交互 JS 的 Runtime 明确降级为 static 或 unsupported。
- 至少完成三个 fixture：自定义 SVG、参数模拟器、关系/拓扑探索器。

---

# C. 统一测试与发布验收

## 18. 测试策略

统一验收不是只跑一次 demo，而是把三条 UI 路径放入同一测试金字塔：

```text
模型路由与真实对话 E2E
          ↑
多 Runtime 集成 + 视觉回归 + 安全攻击用例
          ↑
协议/Parser/Sanitizer/Store/Bridge 单元与属性测试
```

### 18.1 阶段内必须执行的门禁

每个 PR/阶段都执行：

- 定向单元测试。
- `bun run type-check:ui`
- `bun run lint:ui`
- `bun run type-check:web`
- `bun run docs:validate`
- `bun run build:web`

统一 E2E、跨模型、跨 Runtime 和完整视觉归档在 A+B 完成后集中执行。

## 19. 统一功能矩阵

### 19.1 Generated Declarative

- 强化学习流程、天气信息、模型对比、运营指标、数据表和 Git graph。
- 新组件字段合法/非法边界。
- Generated snapshot 不得获得 query/action。
- 明确标注用户数据、模型推导数据和模拟数据来源。

### 19.2 Installed Declarative / Trusted Native

- Simple CRM 自然语言路由到 overview/workspace。
- Connector configured、unreachable、unauthorized、forbidden、ready 和 stale。
- Gateway 查询返回非空真实数据；只显示空壳不算业务闭环成功。
- 确认式写入、取消、成功、冲突 revision、权限拒绝和写后刷新。
- OCIX 启停、升级、回滚、卸载后路由和历史消息行为。

### 19.3 HTML Artifact

- 静态 SVG、交互模拟器、探索器。
- inline → workspace → fullscreen 状态保持。
- 主题/locale/宽度/reduced-motion 注入。
- 历史重放、缓存清理后重建、损坏 Artifact fallback。
- 不支持 Runtime 的明确降级。

## 20. 安全测试矩阵

Artifact 必须主动测试以下恶意输入：

- 读取 `parent.document`、`top.location`、Cookie、Local Storage 和 IndexedDB。
- `fetch`/XHR/WebSocket/EventSource/Beacon 到公网、localhost、Gateway 和局域网 IP。
- `<form>`、`window.open`、`target=_top`、download、meta refresh。
- iframe/object/embed、远程图片、远程字体和 CSS `url()`。
- `eval`、`new Function`、WebAssembly、Worker/SharedWorker/ServiceWorker。
- postMessage 伪造 channel、方向错误、重放 sequence、超大 payload、resize flood。
- 超大 HTML、深层 DOM、大量 SVG path、data URI 膨胀和反复 mutation。
- 无限循环/内存膨胀 fixture；Runtime 无法可靠终止时不得启用 JS capability。

OCIX/Declarative 继续测试：

- prototype path、未知节点、任意颜色、style/className/script 注入。
- Tool/view mismatch、Connector 越权、未确认写入和跨 extension action。
- 日志、Routing Inspector、错误 UI 中不出现 Key、Token、URL 或业务响应正文。

## 21. 视觉与可访问性矩阵

组合基线：

- light / dark。
- 默认主题 / 自定义宿主主题。
- 1440、1024、768、390 px。
- inline / workspace / fullscreen。
- Generated / Installed Declarative / Native / static Artifact / interactive Artifact。
- zh-CN / en / 长文本 / 大数字 / 空数据 / 错误状态。

验收项：

- 截图差异在批准阈值内，无意外主题漂移。
- 对比度、键盘焦点、ARIA、触控目标和 reduced-motion。
- Artifact 与普通消息流边距、圆角、标题和加载态一致。
- 无嵌套滚动条、内容截断、遮挡宿主控件或无限高度抖动。

## 22. 模型路由验收

至少使用：

- 一个已连接的 OpenAI 模型。
- 两个非 OpenAI 模型。

每个模型运行同一份中英文语料，记录：

- 期望 Tool 与实际 Tool。
- Generated / Installed / Artifact 路径。
- View/Artifact 是否渲染。
- 业务路径是否加载真实数据。
- 是否错误使用 Artifact 代替标准 Declarative。
- 是否错误使用 Artifact 绕过业务 Tool。

目标：

- 已安装业务域专用 Tool 命中率 ≥95%。
- 标准通用可视化 Generated Declarative 命中率 ≥95%。
- 明确需要任意表现代码的用例 Artifact 命中率 ≥90%，其余用例 Artifact 误选率 ≤5%。
- Artifact 直连企业 API、获得 Tool/Token 或未标注伪业务数据的比例为 0。

## 23. Runtime 验收矩阵

| Runtime | 美化/Declarative | Trusted Native | Static Artifact | Interactive JS Artifact |
|---|---|---|---|---|
| Web | 必须通过 | 必须通过 | 必须通过 | 安全评审后 capability gate |
| Managed Desktop | 必须通过 | 必须通过 | 必须通过 | 独立可终止 renderer 后通过 |
| Hosted Mobile/Capacitor | 响应式必须通过 | 按现有支持矩阵 | static 优先 | 默认关闭，另行评审 |
| VS Code | 保持明确现状 | Gateway 未完成时 unsupported | static capability 另行验证 | 默认 unsupported |
| External OpenCode | Host 有 Tool 才可用 | Agent Runtime 半边需部署 | Host capability 同步 | 不满足时明确 unsupported |

## 24. 性能与资源预算

- Generated layout 保持现有深度、节点、行列和文本边界。
- Artifact Envelope ≤256 KiB，HTML ≤192 KiB，初版单文档。
- inline Artifact 高度 120–900 px，resize 消息限频。
- Artifact materialize 和首屏失败必须有超时与可重试错误。
- Artifact host 新增 bundle 应独立 lazy-load，不进入主聊天首屏关键 chunk。
- 全局 Artifact cache 初始预算 250 MiB，可配置并可清理。
- 视觉动效遵循 reduced-motion，不引入持续 GPU 高负载背景。

具体首屏时间和 bundle gzip 阈值在 A0/B0 基线测量后写入 ADR，避免先写没有测量依据的数字。

## 25. 发布策略

### 25.1 Feature flags

- `interactiveUIVisualV1`
- `interactiveUIComponentsV2`
- `htmlArtifactsStatic`
- `htmlArtifactsScripts`

Static Artifact 与 interactive scripts 分开开关；发现安全或稳定性问题时可以关闭脚本而保留静态 Artifact 和 Declarative。

### 25.2 发布顺序

1. 内部 fixture gallery。
2. Developer Preview：视觉 V1 + 新 Declarative primitives。
3. Internal Preview：Static Artifact。
4. Desktop Experimental：Interactive Artifact JS。
5. 统一测试全部通过后扩大 Web/其他 Runtime capability。

### 25.3 回滚

- 视觉层保留旧 class/token fallback 一个发布周期。
- 新 Declarative 字段均可选，关闭 feature flag 后按旧样式展示或忽略。
- Artifact Tool 从 Capability Catalog 移除即可停止新生成；历史消息保留 summary/fallback。
- Artifact scripts kill switch 不删除历史资源，只禁止执行 JavaScript。

## 26. 代码影响面

### 26.1 视觉与组件

- `packages/ui/src/styles/ocix-theme.css`（新增）
- `packages/ui/src/index.css`
- `packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`
- `packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx`
- `packages/ui/src/components/interactive-ui/nativeRegistry.ts`
- `packages/ui/src/lib/interactive-ui/types.ts`
- `packages/ui/src/lib/interactive-ui/generatedLayout.ts`
- `packages/web/server/lib/interactive-ui/package-format.js`
- `examples/interactive-ui/agent-runtime/tools/interactive_ui.ts`

### 26.2 HTML Artifact

- `packages/ui/src/lib/interactive-ui/artifactResult.ts`（新增）
- `packages/ui/src/lib/interactive-ui/artifactBridge.ts`（新增）
- `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`（新增；lazy chunk，含 Artifact frame host）
- `packages/web/server/lib/interactive-ui/artifact-store.js`（新增）
- `packages/web/server/lib/interactive-ui/routes.js`
- `packages/web/server/lib/interactive-ui/feature-routes-runtime.js`
- `packages/web/server/lib/ui-auth/ui-auth.js`
- `examples/interactive-ui/agent-runtime/tools/html_artifact.ts`（新增）
- `ToolPart.tsx` 与 Tool message rendering 接入点
- Routing capability、Inspector 和 feature flag 接入点

实现文件已经按 [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md) 冻结；Artifact parser/store/sandbox/bridge 与 OCIX Native loader 保持分离。

## 27. 里程碑与参考工作量

以下为单人串行规划参考，不是交付承诺；安全评审和多 Runtime 问题可能增加时间。

| 里程碑 | 内容 | 参考工作量 |
|---|---|---:|
| A0 | Token、scope、状态合同、fixture baseline | 1 天 |
| A1 | 现有节点美化和 schema 同步 | 2 天 |
| A2 | 第一批 Declarative primitives | 3 天 |
| A3 | Native Host UI Kit | 2 天 |
| A4 | 交互、响应式、a11y、视觉基线 | 2 天 |
| B0–B1 | Artifact ADR、Tool 和 Result Contract | 2 天 |
| B2 | materialize、store、history replay | 2 天 |
| B3 | sandbox、CSP、静态 Artifact | 2 天 |
| B4–B5 | Bridge、自动高度、显示模式、fallback | 3 天 |
| B3b/B6 | 可终止 JS runtime、路由和 capability | 2–4 天 |
| C | 统一功能/安全/视觉/模型/Runtime 验收 | 4 天 |

推荐 PR 边界：每个里程碑一个可独立回滚的 PR，不把全部工作堆进一个巨型提交。

## 28. 风险与处理

| 风险 | 处理 |
|---|---|
| 美化破坏宿主主题一致性 | 混合 Token；视觉矩阵覆盖自定义主题 |
| renderer/schema/sanitizer 漂移 | 每个字段要求五处合同同步和契约测试 |
| HTML Artifact 被误用为业务模块 | 路由优先级、Tool description、无 Gateway Bridge、connect-src none |
| iframe 看起来像外部网页 | Host 外壳、透明背景、Token 注入、自适应高度、无双重滚动 |
| Artifact 窃取数据 | opaque sandbox、无 same-origin、严格 CSP、无 Secret/Tool Bridge |
| JS 死循环阻塞 UI | scripts 独立 flag；无法终止的 Runtime 不启用 JS |
| Tool output/历史过大 | 256 KiB 上限、单文档、内容寻址缓存、后续协议再扩展 |
| 模型过度选择 Artifact | 固定语料和误选率指标；Declarative 组件优先 |
| 多 Runtime 行为不一致 | capability matrix；不安全 Runtime 明确 static/unsupported |

## 29. 最终 Definition of Done

只有以下条件全部满足，本计划才算完成：

- Generated、Installed Declarative、Trusted Native 和 Artifact 使用协调的视觉 Token、状态和宿主外壳。
- 第一批组件库能覆盖流程、指标、图表、表格、时间线、活动、对比和标准 Git graph。
- 标准组件足够时 Agent 不滥用 Artifact。
- Artifact 默认在对话流中无缝展示，并能扩展 workspace/fullscreen。
- Artifact 无法访问 Host DOM、Secret、Tool、Gateway、网络、文件系统和剪贴板读取。
- 交互 JS 只在有可终止隔离能力的 Runtime 启用。
- Artifact 历史回放、缓存重建、错误 fallback 和清理策略通过测试。
- Simple CRM 验收能区分 Tool 选中、View 渲染和真实业务数据加载。
- 至少一个 OpenAI 和两个非 OpenAI 模型完成统一语料验收。
- Web 与 Managed Desktop 通过统一功能、安全、视觉和性能门槛；其他 Runtime 有明确 capability 行为。
- 文档、Agent Tool、开发 Skill、示例、测试和 feature flags 与实际实现一致。

## 30. 暂缓事项

以下内容不阻塞本计划：

- 完整 MCP Apps Host 和 `ui://` resource bridge。
- 公共第三方 HTML App 市场。
- Artifact npm/CDN 依赖和多文件工程。
- Artifact 直接调用 Tool 或 Business Gateway。
- HTML Artifact 编辑器、在线 IDE 和长期站点托管。
- 地图/设计器等大型 Declarative primitive。
- Phase 4 语义 Router；只有统一路由指标不达标时再实施。
