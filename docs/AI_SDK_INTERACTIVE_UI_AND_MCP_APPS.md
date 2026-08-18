# AI SDK、Interactive UI 与 MCP Apps：当前边界记录

> **状态**：当前架构事实与历史决策入口；不是待执行 implementation plan
> **更新日期**：2026-08-10
> **唯一优先级**：[`../../roadmap.md`](../../roadmap.md)
> **P3.6 逐文件实施蓝图**：[`P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md`](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md) §10、§11.6、§13.6–§13.7

本文替代 2026-07-20 的初始方案。旧文档中“MCP Apps 尚未实现”“尚未创建 OpenCode fork”“定期 merge moving upstream/main”以及用 AI SDK 重做消息 runtime 的描述均已删除，不能再作为实现指令。

---

## 1. 当前已交付基线

OpenChamber 当前同时拥有四条彼此独立的呈现路径：

| 路径 | 当前职责 | Authority / 隔离 |
|------|----------|------------------|
| Agent Generated Declarative | tool 返回有界 layout，Host 校验并同页渲染 snapshot | Host schema；不执行模型代码 |
| Installed Declarative / Trusted Native | 签名 OCIX 长期业务模块，经 Gateway 访问真实 API | Declarative 同页重建；Native 是管理员信任的同页代码 |
| HTML Artifact | Agent 生成 HTML/CSS/SVG/受限 JS 的临时交互物 | sandbox iframe；不持业务 token |
| Generative Widget (`show-widget`) | 模型输出 fence，OpenChamber 独立 parser/renderer 展示 | sandbox iframe；与 OCIX/HTML Artifact 分轨 |

MCP Apps 2026 也已实现为独立标准链：

```text
MCP server
  → OpenCode fork：capability、ui:// resource、metadata、catalog/API
  → OpenChamber host：AppBridge、sandbox iframe、readiness/fullscreen
```

当前工作区确有两份独立 fork：`openchamber/` 与 `opencode/`。Desktop 通过 managed lifecycle 启动固定的 OpenCode CLI，OpenChamber 经 `@zunbaran/opencode-sdk` 消费 fork SDK，并通过 `/api/opencode/capabilities` 判断完整或缩减能力。MCP Apps/tldraw 的自动门禁已存在，roadmap P1.4 仍欠真人真机 Go·No-Go；这不等于协议或 Host 尚未实现。

---

## 2. 保持不变的架构决策

### 2.1 不引入第二套 Agent runtime

OpenCode 继续拥有 Session、message/part、tool execution、permission、SSE 和历史回放。OpenChamber 只消费 SDK/HTTP 公开合同，并在共享 UI 中做能力适配和渲染。

不使用以下方案替换主链：

- AI SDK `useChat`、RSC 或另一套 stream protocol；
- 在 Electron/OpenChamber server 进程内 import OpenCode 内部源码；
- UI 自行执行 tool、重建 permission 或补造 session history；
- 让 MCP Apps、OCIX、HTML Artifact 和 show-widget 共用同一权限/runtime 模型。

AI SDK 可以继续作为研究参考或局部无状态工具库，但任何采用都必须有独立 roadmap 项和明确 consumer，不能借 P3.6 顺带引入。

### 2.2 Renderer 保持“增强 + 通用回退”

OpenChamber 的 interactive renderer 读取 tool identity、state、input/output/metadata，运行时校验后渲染专属 UI；未知 tool、旧消息、invalid result 或组件异常回到通用 Tool UI。历史 Session 必须可回放，不能靠只存在于内存的 delta 状态才能显示。

### 2.3 Fork 保持进程与仓库边界

- OpenCode 改 wire/publisher/capability/SDK；OpenChamber 改 capability adapter/reducer/UI。
- 两仓分别分 Agent、分 wave、分测试；不能从 `openchamber/` 任务直接修改 `../opencode`。
- CLI、SDK、capability 和 managed pin 必须来自同一可追溯 OpenCode revision。
- 上游同步只合入官方**不可变稳定 Release tag**；不跟踪或定期 merge `main`、`dev`、`beta` 等 moving branch，除非用户明确指定 ref。
- commit、push、release、workflow mutation 和 pin 发布均需用户单独授权。

---

## 3. P3.6 的真实问题

P3.6 不是“让 UI 解析 streaming text”。目标是：在 tool 最终结果到达前，显示 OpenCode 生产并持久化的**完整、单调、可重放 ToolPart progress snapshot**；最终 ToolPart output 永远是终态 authority。

当前 legacy `tool-input-start/delta/end` 路径只维护 pending tool call；OpenChamber 看不到可安全渲染的完整 interactive result。UI 不得把 `raw`、JSON fragment、SSE delta 或模型文本猜成 Declarative envelope。

因此 roadmap P3.6 保持 `later`，但开始门必须分两级，不能把待实现产物反过来当成整个项目的开工前置：

**Gate O0（只允许 OpenCode authority-enablement wave）**：P2 已完成且 17 条 legacy 与 I1–I5 语料已冻结；用户只明确授权 P3.6 的 **OpenCode authority-enablement wave** 与 `opencode/` 文件范围（这不是 OpenChamber consumer、双仓发布或 pin 授权）；先选定一个自然多阶段、业务上确有价值的OpenCode **built-in internal** production Tool并把精确路径/Tool ID写入P3蓝图；冻结full-snapshot/revision/terminal/limits合同。当前fork不发布自己的plugin package，managed resolver仍消费upstream plugin，因此v1不承诺第三方/plugin `progress`接口，plugin Tool继续final-only。满足后才可实现 OpenCode schema、internal publisher、history、capability与SDK本地产物。当前审计没有找到该producer，所以现状仍是 `later` + `result=blocked-by-authority`，并注明零产品代码；`no-code`不是 result 枚举的一部分。

**Gate C1（capability enablement证据门，不是consumer开始门）**：在handler仍为`toolProgressSnapshotsV1=false`时，OpenCode production path已真实发布完整JSON snapshot并分配server monotonic revision；snapshot进入durable `message.part.updated`/history replay；completed/error覆盖且拒绝晚到progress；获批Tool至少产生两次有效snapshot；pre-enable SDK generated artifact与contract review通过。C1签字后才由schema owner false→true并跑production capability tests，随后SDK owner从同一最终revision重生成/验证CLI+SDK，再由新鲜高级只读review核对provenance。之后依次通过**Release Authority Gate**并实际发布同revision CLI/SDK、通过独立**Pin Authority Gate**并更新/验证managed pins、通过独立**Consumer Authority Gate**取得OpenChamber文件范围，才开始consumer wave；任一授权或动作失败都停在前一步handoff。缺任一项，OpenChamber继续final-only，不新增UI-only fake streaming。

SDK/CLI发布、OpenChamber pin、commit/push/release/workflow mutation仍各自需要用户明确授权；本地code-ready不等于发布获批。

---

## 4. P3.6 冻结合同摘要

> 这里仅作导航。字段、limits、A/M/V/R、波次和测试只以 P3 蓝图为准。

### 4.1 Authority 链

```text
approved built-in internal Tool implementation
  → `yield* ToolProgress.publish(context,{structured:fullSnapshot})`
  → OpenCode validates + assigns revision
  → durable full ToolPart snapshot event/history
  → SDK generated type
  → OpenChamber capability adapter
  → reducer revision/terminal guard
  → bounded InteractiveUIToolSurface
  → completed/error final output wins
```

### 4.2 Progress 规则

- full replacement snapshot，不是 patch/delta；
- internal base context 的 `progress` field 可省略；producer只调用`ToolProgress.publish`，normal SessionTools提供real Effect publisher，prompt/debug等manual context共用`ToolProgress.unavailable`；registry在public plugin seam剥离该field，`@opencode-ai/plugin`不改且plugin Tool继续final-only；
- revision 只由 server 分配，严格单调；
- 每个 snapshot 先过 schema、大小、频率和数量限制；
- history/reconnect 得到相同 ToolPart 状态；
- duplicate/out-of-order/late-after-terminal frame 被幂等忽略；
- final output 可与最后 snapshot 不同，且必须覆盖；
- 无 capability、外部 legacy CLI 或旧历史维持 final-only。

### 4.3 首版范围

只允许 built-in Agent Generated Declarative **snapshot-only** envelope：无 query/action/dataRef/pin/Installed/Native/HTML/MCP/show-widget。P2 text↔visual 交织不依赖 P3.6；不要用 partial UI 阻塞 P2。

### 4.4 UI 禁止事项

- 不解析 `pending.raw`、tool input delta、半截 JSON 或 fenced model text；
- 不在 client 合成 revision、持久化 history 或推断 terminal；
- 不在 progress 阶段执行 business action/tool；
- 不因 partial invalid 覆盖上一份 valid snapshot；
- 不用动画、骨架或 “streaming” 标签掩盖后端没有 authoritative publisher。

---

## 5. 实施与验收入口

获授权后，低能力 Agent 必须逐节执行 P3 蓝图：

- §10：OpenCode publisher/wire、OpenChamber reducer/UI、terminal/fallback 语义；
- §11.6：两个仓库精确 A/M/V/R 文件表；
- §12：平台、权限、数据和安全矩阵；
- §13.6–§13.7：focused、跨仓、legacy corpus、packaged parity；
- §14：SDK 生成、CLI/SDK 同 revision、managed pin 与 release authority；
- §15：跨仓波次、唯一 owner、handoff payload；
- §17：DoD。

发布顺序固定为：Gate O0 → OpenCode schema/publisher/真实producer/tests且capability保持false → 本地SDK生成与history/terminal review → Gate C1证据签字 → 同一schema owner把handler false改true并跑production capability tests → 从同一最终revision重新生成/验证CLI+SDK并final review → 用户release authority gate → 获批后发布同revision CLI/SDK → 独立pin authority gate → 获批后更新OpenChamber managed CLI/SDK pins并验证provenance → 独立consumer scope authority gate → 获批后才实现capability adapter/reducer/UI → unified/packaged acceptance。任一gate未满足就在其前一步交付明确handoff/blocker：release权限不能推出pin或consumer权限，pin权限也不能推出consumer权限；不能提前发布false-capability构件，也不能伪称managed Desktop已支持。

---

## 6. 相关权威文档

- 优先级与状态：[`../../roadmap.md`](../../roadmap.md)
- P3 总蓝图：[`P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md`](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md)
- OCIX runtime 边界：[`INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md`](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)
- P2 交织边界：[`CONVERSATIONAL_INTERACTIVE_UI_FOUR_TRACKS_DESIGN.md`](./CONVERSATIONAL_INTERACTIVE_UI_FOUR_TRACKS_DESIGN.md)
- MCP Apps 当前验收：[`INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md`](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md)
- Generative Widget 独立轨：[`GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md`](./GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md)
