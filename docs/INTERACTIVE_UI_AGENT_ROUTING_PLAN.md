# Interactive UI Agent Routing Plan

## 0. 实施状态（2026-07-20）

本计划的 Phase 1–3 平台实现已落地，Phase 0 的固定用例集和脱敏结果日志已落地。Qwen3.7 Plus 是默认平价模型门禁；其他 Provider 作为可选对照，不再因 OpenAI 未配置而把普通开发验收标记为未完成。Phase 4 暂不实施，等真实命中率决定。

已完成：

- 通用 `interactive_ui`、CRM/Sales 业务 Tool 和 Skill 的边界与优先级修正。
- `agentRouting` / `views[].routing` 的安装前、打包和运行时校验；旧 OCIX 无该字段时保持兼容。
- `GET /api/interactive-ui/capabilities` 动态目录：只包含结构化 ID、intent、operation、dataAuthority 和粗粒度连接状态，不包含示例、显示名、Connector URL 或 Secret。
- 固定模板的路由上下文，通过当前 OpenCode SDK 正式支持的 `session.promptAsync(..., system)` 字段随聊天请求注入；不修改 `AGENTS.md`，按 Runtime 缓存 10 秒，失败时不阻止消息发送。
- Catalog 12,000 字符上限；超过最大 Tool 数时截断。外部 OpenCode 只允许调用其当前 Tool set 中真实存在的 Catalog Tool，缺失时报告 Agent Runtime 半边未部署。
- 20 条中英文静态路由语料，以及 schema、脱敏、防注入、连接状态、客户端 system 注入测试。
- OCIX starter、CLI 验证路径、开发手册和 `build-openchamber-interactive-extension` Skill 已同步新合同。
- View descriptor 被实际打开时记录脱敏路由结果：Tool、extension/view ID、domain、dataAuthority 和 operation；不记录用户问题、业务响应或凭据。
- 会话级 Routing Inspector 已接入发送、实际 Tool、Tool 完成/失败和 View 加载/渲染阶段；最多保留 50 条、最长 30 分钟的内存追踪，设置页可检查并复制脱敏报告。追踪不保存用户原文、模型思维、Connector URL、凭据、Tool 输入输出或业务响应，也不会把“可用候选”伪装成模型内部语义评分。
- 已安装并验证签名的 Simple CRM 1.2.0：Alibaba/Qwen 对话选择 `simple_crm_open_overview`，Tencent/GLM 对话选择 `simple_crm_open_workspace`；OpenChamber 真实消息流中也已观察到业务 Tool 和 Installed View 正常渲染。

已记录的业务闭环验收缺口：

- 一次真实消息流验收中，Agent 路由和 View 渲染成功，但本地 Simple CRM API 尚未启动，因此页面进入 `Business system request failed` 状态并展示空数据壳。该结果只证明“路由与渲染链路可用”，**不能**计为“真实业务数据闭环通过”。
- 启动 Simple CRM API 后，Connector 健康检查返回 200，OpenChamber Business Gateway 使用服务端凭据成功查询到 4 个客户、4 个商机和非空管道数据，证明业务访问链路可以恢复。
- 后续自动验收必须分别记录 `Tool selected`、`View rendered` 和 `Business data loaded`；fallback、空壳或上游不可用状态不得被最后一个指标误判为成功。

尚待运行环境验收：

- 默认使用 Qwen3.7 Plus 跑完整语料，计算业务 Tool / 通用 Tool 命中率；需要跨 Provider 发布比较时再增加 OpenAI 或其他模型。
- 继续验证 Connector 未配置、业务 API 不可达、恢复、启停、升级、回滚、卸载和确认式写入，并把“View 已渲染”和“真实数据已加载”作为两个独立结果。
- 只有命中率未达到目标时才进入 Phase 4 的候选预筛选；基础诊断 UI 已由 Routing Inspector 提供。

## 1. 背景

OpenChamber 当前同时存在两类 Interactive UI Tool：

1. **通用生成 Tool**：例如 `interactive_ui`，由模型按任务临时组合指标、图表、表格、流程等组件，适合没有已安装业务模块的临时可视化。
2. **已安装业务 Tool**：例如 `simple_crm_open_overview`、`simple_crm_open_workspace`，负责打开已签名 OCIX 提供的 Declarative / Trusted Native View，并通过 Business Gateway 访问真实业务 API。

两类 Tool 的适用范围会发生重叠。当前通用 `interactive_ui` 的 description 使用了“优先使用”“看板、仪表盘时直接调用”等强指令；Simple CRM Tool 同时声明自己适用于 CRM 概览、客户和商机管道。因此模型面对“看看 CRM 仪表盘”时可能选择通用 Tool，生成一份视觉正确但数据为模型现场构造的快照，而没有调用已安装的 CRM 模块和真实 API。

现状可以概括为：

- **直接原因**：通用 Tool 与业务 Tool 的 description 冲突，且通用 Tool 的措辞更强。
- **平台根因**：OpenChamber 没有根据“当前已安装且启用的 OCIX 能力”生成动态 Agent 路由策略。
- **风险**：用户容易把模型生成的示例数据误认为真实企业数据。

## 2. 目标

建立稳定、可扩展、与 OCIX 生命周期同步的 Interactive UI 路由机制：

- 用户提出已安装业务域的问题时，优先调用匹配的业务 Tool。
- 没有匹配业务扩展时，才使用通用 `interactive_ui` 生成临时页面。
- 用户显式指定 Tool 时遵循用户选择，但清楚区分真实数据和示例数据。
- 安装、升级、启用、禁用、回滚、卸载 OCIX 后，Agent 能力目录自动更新。
- 不要求用户手工编辑全局系统提示词、`AGENTS.md` 或 `OPENCODE_CONFIG_DIR`。
- 不允许扩展通过自由文本向系统提示词注入任意指令。
- 不把 Connector 地址、Access Key、Token 或其他 Secret 暴露给模型。

## 3. 非目标

本计划第一阶段不处理：

- 通用语义搜索或跨全部 MCP Tool 的完整 Intent Router。
- 基于用户身份的业务权限判定；权限仍由第三方系统的 Access Key 和 API 决定。
- 让通用 `interactive_ui` 直接访问企业 API。
- 让 Skill 代替 Connector、Gateway 或 Tool 成为业务数据传输层。
- 用硬编码系统提示词登记每个具体企业扩展。

## 4. 目标路由优先级

默认优先级如下：

1. 用户显式指定的可用 Tool。
2. 与意图匹配、已启用的 OCIX 业务 Tool。
3. 与意图匹配的其他专用 Tool / MCP Tool。
4. 通用 `interactive_ui` 临时生成 Tool。
5. 普通文本回答。

示例：

| 用户请求 | 目标 Tool | 数据语义 |
|---|---|---|
| “查看 CRM 客户和商机管道” | `simple_crm_open_overview` | 通过 Gateway 查询真实 CRM API |
| “打开完整 CRM 工作台并推进商机” | `simple_crm_open_workspace` | 真实数据；写入需要确认 |
| “画一下 LLM 强化学习流程” | `interactive_ui` | 模型按任务生成的可视化快照 |
| “用 interactive_ui 做一个 CRM 示例” | `interactive_ui` | 必须标明为示例/模拟数据 |

如果一个业务 Tool 已匹配但 Connector 尚未配置，仍应优先进入该业务模块并显示可操作的连接错误或配置引导，而不是静默退回通用 Tool 并伪造数据。

## 5. 工作流总览

```text
OCIX 安装 / 更新 / 启停 / 卸载
        ↓
Extension Manager 读取结构化 routing 元数据
        ↓
生成当前可用的 Capability Catalog
        ↓
以固定模板注入会话级 Agent Routing Context
        ↓
模型结合用户意图、Tool description 和 Catalog 选择 Tool
        ↓
业务 Tool → Installed View → Gateway → 真实 API
通用 Tool → Generated Declarative View → 明确的快照/示例语义
```

## 6. 第一项：消除 Tool description 冲突

### 6.1 通用 `interactive_ui` 的新边界

通用 Tool 的 description 应表达：

- 用于临时、任务级、没有匹配业务模块的可视化。
- 如果存在匹配的已安装业务 Tool，应优先使用业务 Tool。
- 不得为已连接业务域凭空生成看似真实的指标。
- 缺少真实数据时，只能使用用户提供的数据、明确标记的示例数据，或先向用户说明数据缺失。

建议 description：

```text
在当前对话中生成任务级 Interactive UI，用于流程、解释、对比、图表和临时看板。
仅在没有匹配的已安装业务 Tool 时使用；如果存在 CRM、ERP、工单等专用 Tool，优先调用专用 Tool。
不得编造看似来自企业系统的真实指标；示例数据必须明确标注为示例。
```

### 6.2 业务 Tool 的新边界

业务 Tool 的 description 应包含：

- 业务域和主要用户意图。
- 数据来源是已配置的业务 Connector。
- 它优先于通用 `interactive_ui`。
- 读操作、写操作和确认语义。
- 中英文自然语言示例，但避免无限堆叠关键词。

Simple CRM 概览建议 description：

```text
打开已安装的 Simple CRM 实时概览，通过已配置的 crm-api 查询客户、重点客户、商机和销售管道。
用户询问 CRM 客户、商机、管道指标或 CRM 概览时优先调用本工具，而不是通用 interactive_ui。
```

Simple CRM 工作台建议 description：

```text
打开已安装的 Simple CRM Trusted Native 工作台，通过已配置的 crm-api 查看并操作客户和商机。
需要完整 CRM 工作台、商机跟进或推进阶段时调用；写操作由 UI 发起并要求用户确认。
```

### 6.3 Skill 的职责

Skill 保留为开发者和 Agent 的详细路由手册，但不能作为唯一的选择机制：

- Tool description 必须独立完整，模型即使没有加载 Skill 也能做出正确选择。
- Skill 解释 overview / workspace 的分工、确认式写入、安全约束和典型自然语言触发。
- Skill 不读取 Secret、不直接访问业务 API，也不返回与 Tool 不一致的路由规则。

### 6.4 第一项验收

- “查看 CRM 客户和商机管道”选择 `simple_crm_open_overview`。
- “推进 CRM 商机阶段”选择 `simple_crm_open_workspace`。
- “画一个强化学习流程”选择 `interactive_ui`。
- 显式说“使用 interactive_ui 做 CRM 示例”仍可调用通用 Tool，但页面必须标注“示例数据”。
- 通用 Tool 不再使用“所有看板/仪表盘一律优先调用”的无边界描述。

## 7. 第二项：动态系统路由策略

### 7.1 为什么不能只修改静态系统提示词

OCIX 是动态安装的。静态提示词无法可靠知道：

- 当前安装了哪些扩展及版本。
- 哪些扩展已启用或已禁用。
- Tool 是否已经部署到当前 OpenCode Runtime。
- Connector 是否已配置、失效或需要重新连接。
- 升级、回滚或卸载后哪些能力已经变化。

因此系统提示词只应保存通用路由原则；具体能力清单必须从当前 Extension Manager 状态动态生成。

### 7.2 OCIX 结构化 Routing 元数据

建议在 OCIX v1 中增加可选、向后兼容的结构化字段。示意：

```json
{
  "agentRouting": {
    "domain": "crm",
    "intents": [
      "crm.overview",
      "crm.customer.list",
      "crm.opportunity.pipeline",
      "crm.opportunity.advance"
    ],
    "examples": {
      "zh-CN": ["打开 CRM", "看看重点客户", "查看商机管道", "推进商机"],
      "en": ["open CRM", "show key customers", "view opportunity pipeline"]
    },
    "dataAuthority": "connected-business-system"
  }
}
```

每个 View 可进一步声明其 Tool 级意图：

```json
{
  "id": "com.demo.simple.crm.overview",
  "tools": ["simple_crm_open_overview"],
  "routing": {
    "intents": ["crm.overview", "crm.customer.list", "crm.opportunity.pipeline"],
    "priority": 80,
    "operation": "read"
  }
}
```

约束：

- `domain`、`intents` 使用受长度和数量限制的标识符。
- `priority` 只在受控范围内生效，扩展不能把自己提升到系统 Tool 之上。
- `examples` 仅作为短语示例，不直接拼接成任意系统指令。
- `dataAuthority` 使用枚举，例如 `generated`、`user-provided`、`connected-business-system`。
- 安装器校验 View、Tool 和 routing 引用一致性。
- 没有新字段的旧 OCIX 继续依赖 Tool description 和 Skill，不阻止安装。

### 7.3 Capability Catalog

Extension Manager 根据已启用版本生成只包含公开元数据的目录：

```json
{
  "extensionId": "com.demo.simple.crm",
  "name": "Simple CRM",
  "enabled": true,
  "tools": [
    {
      "name": "simple_crm_open_overview",
      "view": "com.demo.simple.crm.overview",
      "intents": ["crm.overview", "crm.customer.list", "crm.opportunity.pipeline"],
      "operation": "read",
      "dataAuthority": "connected-business-system"
    }
  ],
  "connection": {
    "required": true,
    "configured": true
  }
}
```

Catalog 不包含：

- Access Key、Token、Secret Store 标识符。
- 完整 Authorization header。
- 私有 Connector 配置或不需要暴露给模型的内部 URL。
- 扩展提供的任意自由文本系统指令。

Catalog 必须随 install、enable、disable、update、rollback、uninstall 和 connection 状态变化失效并重建。

### 7.4 会话级路由上下文

OpenChamber 使用固定模板把 Catalog 转换成精简的会话级上下文：

```text
Interactive UI routing policy:
1. Prefer a matching enabled business tool over the generic interactive_ui tool.
2. Use interactive_ui for ad-hoc visualization only when no installed business tool matches.
3. Never fabricate business metrics when a connected business tool exists.
4. Explicit user tool selection wins when the tool is available.

Installed business UI:
- Simple CRM overview
  tool: simple_crm_open_overview
  intents: CRM overview, customers, opportunity pipeline
  data: connected business system
- Simple CRM workspace
  tool: simple_crm_open_workspace
  intents: full CRM workspace, follow-up, advance opportunity
  data: connected business system; writes require confirmation
```

当前使用**请求级、只对当前 OpenChamber 发送生效**的正式注入点，不修改用户维护的全局 `AGENTS.md`。仓库锁定的 OpenCode SDK 1.18.3 在 `session.prompt` / `session.promptAsync` 中原生提供 `system?: string`；OpenChamber Web 在每次正常聊天发送前读取动态 Catalog，并把固定模板传入该字段。Catalog 按 Runtime 缓存 10 秒，运行时或接口不支持时安静降级为原有 Tool description / Skill 选择，不能因此阻止消息发送。

外部 OpenCode Server 同样能通过 prompt API 收到上下文，但 `.ocix` 不能把本机 Tool 文件远程部署过去。因此固定模板要求模型同时核对当前 OpenCode Tool set；Catalog 中有声明但远端 Tool 不存在时，报告 Agent Runtime 半边未安装，不调用虚构 Tool，也不回退生成假业务数据。

### 7.5 路由决策规则

第一版不需要构建独立语义模型，可先采用“结构化目录 + 模型 Tool 选择”：

- 显式 Tool 名称匹配优先。
- 业务 domain / intent 与用户请求匹配时，优先专用 Tool。
- 同一扩展内 overview 和 workspace 冲突时，根据 read / write 和用户动词选择。
- 多个业务扩展同时匹配且无法判断时，向用户显示简短选择，不静默选择通用 Tool。
- Connector 未配置时仍选择专用 Tool，由业务 View 给出连接提示。
- 只有没有专用匹配时才允许选择通用 `interactive_ui`。

若模型路由准确率仍不够，再引入第二阶段的候选 Tool 预筛选或轻量规则评分器；不要在第一版直接实现不可解释的复杂 Router。

## 8. 防止伪造业务数据

通用 `interactive_ui` 必须区分三种数据来源：

| 数据来源 | 可否显示为真实业务数据 | 展示要求 |
|---|---|---|
| 用户提供的数据 | 可以 | 保留用户给出的范围和时间语义 |
| 已连接业务 Tool 返回的数据 | 可以 | 由专用 OCIX View 展示 |
| 模型生成的数据 | 不可以 | 明确标记“示例 / 模拟 / 说明性数据” |

当用户询问已安装业务域而模型没有真实结果时，通用 Tool 不得生成“客户 128、成交额 128 万”这类未标注指标。它应改为：

- 调用对应业务 Tool；或
- 告知连接未配置；或
- 询问用户是否接受一个明确标注的示例页面。

## 9. 实施阶段

### Phase 0：基线和可观测性

- 建立固定的中英文 Prompt 路由用例集。
- 记录当前模型、可用 Tool、最终选择、是否回退、扩展和连接状态。
- 记录路由结果但不记录用户 Secret、Authorization header 或业务响应正文。
- 建立当前基线：业务 Tool 命中率、通用 Tool 误选率、无 Tool 回答率。

交付物：路由测试集、脱敏日志结构、基线报告。

### Phase 1：修正 Tool / Skill 描述

- 收敛通用 `interactive_ui` 的适用边界。
- 加强 Simple CRM 专用 Tool 的真实数据和优先级语义。
- 更新 `build-openchamber-interactive-extension` Skill 和开发手册。
- 增加 lint / review 规则，禁止业务 Tool 与通用 Tool 使用互相冲突的“无条件优先”描述。

交付物：新 descriptions、Skill 规范、文档、路由回归用例。

### Phase 2：OCIX Routing Schema 和 Capability Catalog

- 为 manifest 增加可选 `agentRouting` / `views[].routing` 校验。
- 更新 `validate`、`pack`、`verify` 和安装前审查信息。
- Extension Manager 生成当前启用扩展的 Catalog。
- 为旧 OCIX 提供兼容回退。
- 设置字段数量、长度、枚举和 namespace 限制，防止 Prompt Injection。

交付物：Schema、校验器、Catalog API / 内部接口、单元和安装生命周期测试。

### Phase 3：动态会话路由注入

- 完成 OpenCode system prompt transform / session instruction 可行性验证。
- 用固定模板注入精简 Catalog。
- 在新会话启动、扩展生命周期变化和 OpenCode reload 后刷新。
- 设置字符和 Token 上限；扩展很多时只注入摘要，并保留按需展开机制。
- 确保外部 OpenCode Server 有明确的 capability 同步或降级行为。

交付物：动态注入层、缓存/失效机制、外部 Runtime 行为说明、集成测试。

### Phase 4：路由质量增强

仅当 Phase 3 仍不能达到验收指标时实施：

- 轻量 Intent 评分与候选 Tool 预筛选。
- 多扩展冲突解释和用户选择 UI。
- 设置页增加只读的“Agent Routing Preview”，展示某扩展声明的意图和 Tool。
- 增加路由诊断：为什么选择业务 Tool、为什么回退通用 Tool。

## 10. 主要代码影响面

预计涉及：

- `examples/interactive-ui/agent-runtime/tools/interactive_ui.ts`
- OCIX 示例扩展的 `agent-runtime/tools/*` 和 routing Skills
- `.agents/skills/build-openchamber-interactive-extension/`
- `docs/INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md`
- `packages/web/server/lib/interactive-ui/package-format.js`
- `scripts/interactive-ui-extension.mjs`
- `packages/web/server/lib/interactive-ui/manager.js`
- `packages/web/server/lib/interactive-ui/agent-runtime.js`
- OpenChamber 与 OpenCode 的会话创建 / prompt 注入边界（Phase 3 可行性验证后确定具体文件）
- Extension Manager UI（安装审查和可选 Routing Preview）

## 11. 测试矩阵

### 单元测试

- routing manifest 合法/非法字段。
- intent、priority、operation、dataAuthority 的边界。
- Capability Catalog 只包含启用版本。
- Catalog 不泄露 Secret 或私有 Connector 配置。
- 固定模板拒绝扩展自由文本注入。

### 生命周期测试

- 安装后能力出现。
- 禁用后能力消失，重新启用后恢复。
- 升级、回滚后 Tool 和 intent 与活动版本一致。
- 卸载后能力和凭据状态正确清理。
- 多个 OCIX 共存时不覆盖 Tool / Skill，不污染路由目录。

### 对话端到端测试

至少覆盖：

1. “给我看看 LLM 强化学习流程” → `interactive_ui`。
2. “使用 interactive UI 画一下 LLM 强化学习流程” → `interactive_ui`。
3. “打开 CRM 概览” → `simple_crm_open_overview`。
4. “看看客户和商机管道” → `simple_crm_open_overview`。
5. “推进 OP-2001” → `simple_crm_open_workspace`，写入前确认。
6. CRM Connector 未配置时 → 业务模块的连接提示，不生成假数据。
7. 显式要求 CRM 示例且指定通用 Tool → `interactive_ui`，页面标注模拟数据。
8. 禁用 Simple CRM 后询问 CRM → 不声称存在真实 CRM 数据。
9. CRM API 不可达时 → 仍选择业务 Tool，View 明确显示上游不可用；该用例的路由验收通过，但业务数据闭环验收失败。
10. CRM API 恢复后 → 重新查询经 Business Gateway 返回非空真实数据，并把业务数据加载状态与 View 挂载状态分别记录。

普通开发测试以 Qwen3.7 Plus 为硬门禁；跨 Provider 发布研究可增加至少一个不同模型，且必须使用相同语料。

## 12. 验收指标

- 已安装且启用 Simple CRM 时，CRM 测试集专用 Tool 命中率不低于 95%。
- 非业务可视化测试集通用 `interactive_ui` 命中率不低于 95%。
- “已连接业务域被通用 Tool 误生成未标注数据”的比例为 0。
- 显式 Tool 请求在 Tool 可用时命中率为 100%。
- 安装、启停、升级、回滚、卸载后的 Catalog 与活动状态一致。
- 动态上下文不包含 Access Key、Token、Authorization header。
- Catalog 注入有明确 Token 上限，不随扩展数量无限增长。
- 旧 OCIX 在没有 routing 元数据时仍可安装和运行。
- 真实业务闭环用例必须经 Business Gateway 成功取得符合契约的非空业务响应；只渲染 View、展示 fallback 或空数据壳不算通过。

## 13. Definition of Done

以下条件全部满足后，本计划完成：

- 通用和业务 Tool description 不再冲突。
- OCIX 开发规范明确业务 Tool 优先于通用生成 Tool。
- OCIX 可以声明受约束的结构化路由元数据。
- OpenChamber 能从活动扩展生成并更新 Capability Catalog。
- 新会话自动获得与当前安装状态一致的路由上下文。
- Simple CRM 自然语言触发真实扩展，无需用户说出 Tool 名称。
- Simple CRM 的验收能区分 Tool 选中、View 渲染和真实业务数据加载；业务 API 不可达时不会报告完整闭环成功。
- 通用 `interactive_ui` 不再把模型构造的业务指标伪装成真实数据。
- 自动化测试覆盖路由、生命周期、安全和至少两类模型。

## 14. 推荐执行顺序

按风险和收益排序：

1. 先完成 Phase 0 + Phase 1，快速消除当前误选。
2. 再完成 Phase 2，把路由能力正式纳入 OCIX 合同。
3. 完成 Phase 3 的 OpenCode 注入边界验证与实现，这是平台根因的真正修复。
4. 依据真实路由指标决定是否需要 Phase 4，不预先引入复杂 Router。

## 15. 下一阶段：Business Runtime Readiness

当前最值得优先解决的不是增加更多路由规则，而是让平台准确区分“凭据已配置”“服务当前可达”“View 已挂载”和“真实数据已加载”。建议按以下顺序实施：

### P0：连接与业务加载状态语义

- 将当前容易被理解为实时健康状态的 `Connected` 拆分为受约束状态，例如 `configured`、`reachable`、`unreachable`、`unauthorized`、`unknown`，并显示脱敏的最后检查时间。
- `configured` 只表示 Secret Store 中存在凭据，不能表示第三方 API 当前可用。
- View 继续保留明确的 loading / empty / unavailable / unauthorized / ready 状态；上游失败时禁止用零值伪装真实指标。
- Routing Inspector 增加脱敏的业务加载阶段：`Business request started`、`Business data loaded`、`Business request failed`。不记录 URL、凭据、请求输入或业务响应正文。

### P0：可重复的真实业务闭环验收

- 为 Interactive UI Demo 增加可选的业务验收启动方式，同时管理 OpenChamber 和 Simple CRM API 的启动、健康检查与停止，避免只启动 Host 导致空壳页面。
- 增加自动化 E2E：自然语言 → 专用 Tool → Installed View → Business Gateway → 非空数据，并单独覆盖 API 不可达和恢复场景。
- 读操作校验数据契约；写操作仍必须经过用户确认，并验证第三方系统返回的新 revision。

### P1：跨模型路由基线

- 如需跨 Provider 报告，以同一份固定语料补跑 OpenAI 或其他对照组。
- 汇总各已选模型的业务 Tool 命中率、通用 Tool 命中率和误回退率；不要求特定厂商。
- 只有指标低于第 12 节目标时，才进入 Phase 4 候选预筛选或轻量规则评分。
