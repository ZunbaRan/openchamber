# 对话内交互 UI 四轨选型与讲解优先设计

> **状态**：设计冻结草案（2026-08-07）；P2 详细实施蓝图已补充，产品代码仍以 roadmap 的 `design` 状态为准  
> **范围**：对话内交互形态、Agent 讲解偏好、流式交织输出；**不含**实现排期承诺  
> **不在本文**：MCP Apps 协议轨、hosted/remote 分发机制（它们叠在本四轨之上）  
> **实施蓝图**：[`CONVERSATIONAL_INTERACTIVE_UI_P2_IMPLEMENTATION_PLAN.md`](./CONVERSATIONAL_INTERACTIVE_UI_P2_IMPLEMENTATION_PLAN.md)（逐文件改动、测试、发布、Agent 所有权与 DoD）  
> **相关**：`INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md` · `OCIX_STYLE_CONTRACT.md` · `GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md` · `HTML_ARTIFACT_RUNTIME_ADR.md` · skill `interactive-ui-visualization` / `html-artifact-design`

---

## 0. 一句话

对话里的交互 UI **只有四轨**：

| # | 轨 | 载体 |
|---|----|------|
| 1 | **show-widget** | assistant text 中的 ` ```show-widget ` JSON 围栏 |
| 2 | **Declarative** | 平台 primitives + 有界 JSON（Generated snapshot 或 Installed view） |
| 3 | **Trusted Native** | 受信任 React 模块 + Host UI Kit（Installed） |
| 4 | **HTML Artifact** | 沙箱 HTML/CSS/SVG（+可选受限脚本） |

**产品目标（本设计）：** Agent 回答问题时 **默认更愿意用图示讲解**（文字与图交织），而不是先长文、最后再塞一个看板。  
**Trusted Native 也要能支撑「讲解」**，不仅是 live 企业 app。

Hosted / Remote / `.ocix` 签名 / Connector：**分发与连接层**，不新增第五种「画法」。

---

## 1. 能力分层（用户意图对齐）

### 1.1 show-widget — 对标 CodePilot / Claude Desktop

| 项 | 设计 |
|----|------|
| 目标 | 与 CodePilot / Claude Desktop generative widget **应用能力对标**：图示、小计算器、局部可交互示意、自由 HTML/SVG |
| 触发 | 模型在 **文本流** 中写 `show-widget` 围栏；**不是** Tool result |
| 信任 | 无企业 token、无 Gateway、无 OCIX 签名；sandbox 内执行 |
| 主题 | **独立** CSS bridge；**不**强制消费 `--ocix-*`（与 OCIX 皮刻意分家，2026-08-07 已拍板） |
| 流式 | **天然适合**边生成边预览；单条 text 内可多个围栏 → 多图示 |
| 历史 | 重放 text 再 parse，无独立 blob 表 |

**适用：** 临场示意、草图、小工具、对「自由表现力 + 流式感」敏感的讲解。  
**不适用：** 权威企业数据、确认写、需要与 Workbench/扩展生命周期绑定的长期模块。

### 1.2 Declarative 与 Trusted Native — **同一讲解层级，不同载体**

两者在 **产品意图** 上同级：都是 **OpenChamber 可控、主题一致、可治理** 的「图示讲解 + 业务模块」通道。  
show-widget 能表达的 **讲解类意图**，二者在合同内 **原则上都能覆盖**；差异是载体、信任与开发成本，不是「能不能讲」。

| | **Declarative** | **Trusted Native** |
|--|-----------------|-------------------|
| 载体 | 有界 JSON → 平台 renderer | 签名/受管 ESM React → Host Kit |
| 讲解数据 | Generated：`mode=snapshot` 内联；Installed：snapshot 或 query | 首屏 snapshot + 本地 state；可选 Gateway |
| 表现力 | 平台 primitives + 本地交互（tabs、筛选排序、图例…） | 任意 React 交互（仍在 Host/Kit/权限内） |
| 主题 | `--ocix-*` + Style 预设 | 同左（Kit 涂 token） |
| 开发者 | Agent 现场组 JSON；或扩展作者写 view JSON | 扩展作者写 React |
| 讲解场景 | **默认首选**（零安装、可治理） | **安装式讲解模块** / 复杂交互讲解 / 与业务同包的培训 UI |

#### 1.2.1 Trusted 支持 Agent 讲解（本设计明确补齐）

历史文档把 Trusted 几乎只写成「企业 live 模块」。本设计 **正式扩展**：

1. **Snapshot Explainer 模式（Installed）**  
   - 扩展可提供 **无 Gateway / 可选 connector 未配置也可渲染** 的 view。  
   - Tool 返回 envelope：`mode=snapshot`（或等价「仅内联 data」），数据来自 **扩展内嵌 fixture，并由 explainer 自有的有界 schema 选择**；首例只接收 `focus/depth` 枚举，禁止 Agent 传任意 JSON/HTML/code payload，且**不冒充** live 业务权威源。  
   - UI 文案/skill：示例与模拟数据必须标注。

2. **Agent 驱动讲解（非安装）**  
   - 用户明确指定或意图精确命中已安装 explainer 时优先该 specialized Tool；普通零安装讲解才走 **Generated Declarative**，随后按表现需求选择 **show-widget** / **Artifact**。  
   - **不**在对话中现场「生成」不可信 Native bundle。  
   - 若业务已安装 Trusted 模块，Agent 可调用其 **explainer 向 Tool**（例如 `acme_explain_pipeline`），用固定/用户给定参数打开讲解 View，而不是只有 `crm_open_dashboard` 一类 live 入口。

3. **能力对标 show-widget 的边界**  
   - Trusted **可以**做到 show-widget 级交互（拖拽、分步、本地模拟），因为是完整 React。  
   - 成本是安装与信任；**禁止**把「随口讲解」默认路由到必须安装的 Native。  
   - 完整路由顺序以 [P2 实施计划 §6.2](./CONVERSATIONAL_INTERACTIVE_UI_P2_IMPLEMENTATION_PLAN.md#62-规范选择顺序) 为准：显式安全请求 → connected business → 匹配的 installed specialized/MCP → Generated Declarative → show-widget → HTML Artifact → text。

#### 1.2.2 「更多用图示讲解」— Agent 偏好（产品政策）

在 **不牺牲正确性** 的前提下，系统提示 / Skill 目标态：

| 优先 | 行为 |
|------|------|
| **默认** | 数据关系、流程、对比、结构、步骤 → **至少一帧图示**（Declarative 或 show-widget），而不是纯长文 |
| **交织** | 关键段落后接图，再续文（见 §3）；避免「全文写完再 dump 一个大看板」 |
| **多图** | 一次回答允许多个独立图示（多 tool 或 text 内多 widget）；**禁止**用一个巨型 dashboard 塞所有无关主题 |
| **权威** | 企业事实仍优先已安装业务 Tool；讲解图不得伪装成 live CRM 指标 |
| **克制** | 一句能说清的不建看板；图服务于理解，不是装饰 |

当前实现 **相反倾向** 的证据（待本设计落地时改）：

- skill：`at most one primary OpenChamber View per assistant turn`  
- tool 描述：View 完成后 **只补一句结论**  
→ 强化了「末尾单图 + 短句」，**抑制**「讲解式多图交织」。本设计要求 **修订该政策**（见 §5）。

### 1.3 HTML Artifact — 更大、更复杂、同屏多组件效果

| 项 | 设计 |
|----|------|
| 定位 | **重表现 / 重同屏编排** 的沙箱文档：多面板、仿真器、探索器、自定义拓扑、参数联动，且 **单帧内多个区域协同** |
| 与 Declarative 分界 | 平台 primitives + 本地控件 **装得下** → Declarative；需要自定义布局引擎、时间轴仿真、跨组件共享复杂本地状态 → Artifact |
| 与 show-widget 分界 | 小而临时、流式 fence 感 → widget；需要 **OCIX token 皮、严格 CSP、envelope 存储/重放、workspace/fullscreen** → Artifact |
| 与 Trusted 分界 | 无业务 Gateway / 不可信生成代码 → Artifact；需长期安装、业务写、Host 深度 API → Trusted |
| Agent 生成 | 永不持 token；仅本地交互；数据内联并标注示例/推断 |
| 安装式 Artifact | 第三方扩展可带 artifact 资源；业务动作走声明的 business bridge（既有 ADR） |

**一句话：** Artifact 是「**大画布 / 多组件同屏**」轨，不是默认讲解轨。

---

## 2. 统一选型表（Agent + 产品文案共用）

```text
用户意图 / 内容性质
        │
        ├─ 临场 free-form 小件、草图、计算器、强流式预览
        │     → show-widget
        │
        ├─ 结构化讲解 / 流程 / 表图 / KPI 示意（零安装）
        │     → Declarative Generated（interactive_ui, snapshot）  ★ 讲解默认
        │
        ├─ 已安装业务的真实数据 / 确认写 / 长期入口
        │     → Declarative Installed 或 Trusted Native（live）
        │
        ├─ 已安装的「培训/SOP/产品讲解」模块（可复杂交互）
        │     → Trusted Native 或 Installed Declarative（snapshot explainer）
        │
        └─ 自定义大交互、多区同屏、仿真探索（仍无/弱业务权限）
              → HTML Artifact
```

### 2.1 能力重叠时的决胜规则

| 冲突 | 选择 |
|------|------|
| 流程图既可 widget 也可 Declarative `flow` | **Declarative**（主题一致、可 a11y/Golden）；用户明确要「自由手绘/炫技 HTML」再用 widget |
| 可交互小图既可 widget 也可 Artifact | 单焦点小件 → **widget**；多区同屏或要 workspace → **Artifact** |
| 讲解既可 Generated Declarative 也可装 Trusted | 用户明确请求或意图精确命中 installed explainer → **Trusted**；否则普通零安装讲解 → **Generated Declarative** |
| 业务 Tool 已返回 View | **禁止**再用 interactive_ui / artifact / widget **复述同一数据**（保留） |

### 2.2 信任与权威（不变）

| 轨 | 可声称 live 企业数据 | 可写业务 | 任意代码 |
|----|----------------------|----------|----------|
| show-widget | 否 | 否 | sandbox 内 HTML/JS |
| Declarative Generated | 否（须标注示例） | 否 | 否（仅 primitives） |
| Declarative Installed | 是（经 Gateway/query） | 确认式 action | 否 |
| Trusted Native | 是 | 确认式 write | 受信任 bundle |
| HTML Artifact（Agent） | 否 | 否 | 受限 sandbox |
| HTML Artifact（Installed+bridge） | 按声明 | 按声明+确认 | 受限 + bridge |

---

## 3. 流式交织输出：文字 → 图 → 文字（多图）

### 3.1 目标体验

一次 assistant 回答（一个 turn）应支持：

```text
[text] 先交代背景与问题
[visual] 图 1（流程 / 架构）
[text] 解释图 1 的关键点
[visual] 图 2（对比 / 指标）
[text] 结论与下一步
```

- **多个** visual 合法；visual 可来自 **show-widget 围栏** 或 **Declarative/Artifact/Trusted 的 ToolPart**。  
- 不要求「所有 visual 必须同一种轨」。  
- 不要求 partial 渲染未完成的 Declarative JSON（可选增强，见 §3.4）。

### 3.2 现状（实现事实）

| 层 | 现状 | 对目标的影响 |
|----|------|----------------|
| OpenCode parts | message 内 text/tool **按产生顺序**排列 | 协议层 **已支持** text→tool→text |
| MessageBody | flat 按 natural order 渲染 text 与 tool | UI 层 **已支持** 交织 |
| show-widget | 单 text 内多 fence + streaming partial | **已最接近**目标体验 |
| Post-rich collapse | 富结果 **之后** 的冗长/列表型 text 会收进「Agent notes」 | 可能 **压掉** 讲解续文（需调阈值） |
| Skill / tool 文案 | **每 turn 最多一个 primary View**；完成后只一句结论 | **主因**：模型被训练成末尾单图 |

结论：**协议与渲染骨架大体够用；政策与 Agent 引导是瓶颈；collapse 规则需服务「讲解续文」而不是一律藏起来。**

### 3.3 目标策略（设计）

#### A. 修订 Agent 政策（roadmap P2.1）

替换 skill / `interactive_ui` 描述中的：

- ~~at most one primary View per turn~~  
- ~~完成后只一句结论然后结束~~  

为：

1. **鼓励**在讲解型回答中使用 **1–N 个** 图示；每个图示服务 **一个焦点**（单流程、单对比、单表）。  
2. **推荐节奏**：短文 → 图 → 短文 → 图…；图前后各有一句人话锚定「读者该看什么」。  
3. **仍禁止**：同一业务事实用多个轨重复渲染；禁止无标注的伪造企业指标。  
4. **仍禁止**：为单句答案建多图。  
5. 业务 Tool 已返回 View 的回合：不追加复述 View；**可以**追加 **无关主题** 的讲解图（少见）。

#### B. 多 Tool 调用模式（roadmap P2.1）

- 允许多次 `interactive_ui` / `html_artifact` / 业务 explainer Tool，只要 **各自 summary 与 layout 焦点不同**。  
- `diagramId` / `sectionAnchor` 未列入 roadmap，若未来确有大纲导航需求再立 later 项；**不属于 P2.1**。  

#### C. show-widget 交织（能力已有；政策对齐属 roadmap P2.1）

- 讲解偏好也可 **全部用多 fence widget** 完成（对标 Claude）。  
- 与 Declarative **并存**时：结构化表图优先 Declarative；自由示意优先 widget。

#### D. Post-rich 文本折叠（roadmap P2.2）

调整 `shouldCollapsePostRichResultText` 语义：

- **折叠**：明显复述 View 内容的冗长 recap、结构化 bullet 刷屏。  
- **不折叠**：图后 **≤N 字** 的解释段、设问、过渡到下一图的短段（即使 turn 内已有 rich result）。  
- 多 rich 场景：每图后的短文默认 **展开**；仅最终超长总结可折叠。

#### E. Partial / streaming Declarative（roadmap P3.6，later）

- 现状 roadmap 已写：需 OpenCode 通过 production ToolContext 发布 **server-revisioned、durable、可重放的完整 replacement ToolPart progress snapshot** 才做 partial UI；`tool-input-delta`/`pending.raw` 永远不是 authority。  
- 交织目标 **不依赖** partial Declarative：tool **完成**后插入即可；流式感优先靠 **text 与已完成 tool 的交替** + widget partial。  
- 若未来做 partial：每一帧可以比final少内容，但自身必须是完整、可独立校验的Declarative envelope；禁止JSON fragment、patch、args prefix和半截危险HTML。权威链与两级门禁见 [P3蓝图 §10](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md#10-p36declarative-partialstreaming-ui条件项) 与 [AI SDK边界](./AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md)。

### 3.4 验收场景（设计级）

| ID | 场景 | 通过标准 |
|----|------|----------|
| I1 | 「用图讲解 LLM RLHF」 | ≥1 个 visual 出现在 **首段文字之后**，且 **其后仍有解释文字** |
| I2 | 双主题讲解 | 同 turn **≥2** 个独立 visual，中间有 text |
| I3 | 纯 widget 多 fence | 单 text 内 2+ show-widget，顺序正确 |
| I4 | 业务 CRM 打开 | 仍单主 View；无复述 interactive_ui |
| I5 | 短答 | 无强制插图 |

---

## 4. 与 hosted / remote / Workbench 的关系

| 层 | 职责 |
|----|------|
| 本四轨 | **怎么画、怎么讲** |
| `.ocix` / Remote connect / Lazy resource | **模块从哪来、如何验签与缓存** |
| Extension Workbench | **pin / 多 surface 工作台**（Installed 的 Declarative/Native/Artifact） |
| MCP Apps | **第三方 App 协议**（另文；不进四轨选型） |

讲解内容：

- **临时** → 对话内四轨（主路径 Generated Declarative + widget）  
- **机构课包 / 产品内置教程** → Installed（Declarative 或 Trusted explainer）的对话 inline；当前 installed snapshot pin 会被重建为 live，正确的 Workbench snapshot pin 需另立 roadmap 项，**不属于 P2.3**  

---

## 5. 相对现状的变更清单（设计 → 实现映射）

| ID | 变更 | 类型 | 优先级 |
|----|------|------|--------|
| D1 | 本文作为四轨 + 讲解优先的权威选型 | 文档 | 已写 |
| D2 | Trusted **Snapshot Explainer** 合同（manifest/tool 约定、标注示例数据） | 规范 + 示例扩展 | roadmap P2.3 |
| D3 | 修订 `interactive-ui-visualization` skill：多图、交织、取消「每 turn 仅一 View」 | skill | roadmap P2.1 |
| D4 | 修订 `interactive_ui` / `html_artifact` tool description 同上 | tool schema 文案 | roadmap P2.1 |
| D5 | OpenCode generative-widget 指引与 D3 对齐（避免 widget 与 Declarative 抢流程默认） | opencode fork prompt | roadmap P2.1 |
| D6 | Post-rich collapse 服务讲解续文 | UI | roadmap P2.2 |
| D7 | 路由/验收语料增加 I1–I5 | 测试 | roadmap P2.4 |
| D8 | Developer Guide 增加「讲解 vs 业务 live」章节 | 文档 | roadmap P2.3 |
| D9 | Architecture §1.1 HTML Artifact 状态回写为 Runtime v1 | 文档漂移 | 文档维护；不作为 P2 代码门 |
| D10 | Partial Declarative streaming | 条件增强 | roadmap P3.6（later） |

**非目标（本设计明确不做）：**

- 让模型现场生成 Trusted Native bundle  
- 合并 show-widget 与 Artifact 为单一 runtime  
- 用 MCP Apps 替代讲解轨  
- 为交织而引入第二套消息协议  

---

## 6. 决策记录（本设计拍板）

| 编号 | 决策 |
|------|------|
| C1 | 对话内交互 UI **四轨**：widget / Declarative / Trusted / Artifact |
| C2 | Declarative 与 Trusted **讲解层级统一**；Trusted **必须**支持讲解（snapshot explainer + explainer tools） |
| C3 | show-widget **应用能力**对标 CodePilot/Claude Desktop；主题体系保持独立 |
| C4 | HTML Artifact = **更大更复杂、多组件同屏**；非默认讲解 |
| C5 | 产品偏好：**更多用图示讲解** + **text↔visual 交织** + **多图合法** |
| C6 | 取消「每 assistant turn 仅一个 primary View」政策；保留「禁止同数据多轨复述」 |
| C7 | 交织优先靠 **parts 顺序 + 多 tool + 多 widget fence**；不阻塞于 partial Declarative |

---

## 7. 开放问题（实现前可再收）

| ID | 问题 | 默认倾向 |
|----|------|----------|
| O1 | 多 `interactive_ui` 如何防刷屏？ | **已决（P2.1）**：软引导通常 ≤4；P2 不加 Tool 层 hard/config cap |
| O2 | 讲解图默认 Declarative 还是 widget？ | **Declarative**；用户要「小工具/自由 HTML」再 widget |
| O3 | Trusted explainer 是否单独 `mode` 字段还是复用 snapshot？ | **已决（P2.3）**：复用 snapshot + Tool/Skill 语义，不新增 runtime mode |
| O4 | 交织时是否在大纲（outline）暴露每图锚点？ | 未列入 roadmap 的 later 候选；非 P2 blocker，不占用 roadmap P1 |

---

## 8. 交叉链接

- P2 详细实施蓝图：`CONVERSATIONAL_INTERACTIVE_UI_P2_IMPLEMENTATION_PLAN.md`
- 架构与 envelope：`INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md`  
- 风格合同：`OCIX_STYLE_CONTRACT.md`  
- Widget 轨：`GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md` · `GENERATIVE_WIDGET_TEST_HANDOFF.md`  
- Artifact：`HTML_ARTIFACT_RUNTIME_ADR.md` · `HTML_ARTIFACT_AUTHORING_GUIDE.md`  
- 路由：`INTERACTIVE_UI_AGENT_ROUTING_PLAN.md`（业务域；讲解偏好以本文为准并回写）  
- Skill：`packages/web/server/lib/interactive-ui/builtin/agent-runtime/skills/interactive-ui-visualization/SKILL.md`
