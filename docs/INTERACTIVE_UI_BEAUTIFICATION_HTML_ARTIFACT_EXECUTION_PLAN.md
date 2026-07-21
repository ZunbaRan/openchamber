# Interactive UI 美化、HTML Artifact 与统一测试执行计划

> 文档性质：下一阶段执行计划。架构原则和历史设计见
> [视觉、HTML Artifact 与统一验收计划](./INTERACTIVE_UI_VISUAL_HTML_ARTIFACT_AND_UNIFIED_TEST_PLAN.md)。
> 更新日期：2026-07-21

本文是本轮工作的唯一执行状态源。相关文档职责如下，避免设计稿、ADR 和验收报告各自维护一套相互冲突的进度：

| 文档 | 职责 |
|---|---|
| [Interactive UI 美化开发指南](./INTERACTIVE_UI_BEAUTIFICATION.md) | P1 的 Token、组件、状态、响应式和视觉实现规范 |
| [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md) | P2 的协议、安全边界、Runtime capability 和发布决策 |
| 本文 | 批次顺序、依赖、状态、退出条件和 Definition of Done |
| [Interactive UI 统一验收报告](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md) | P3/P4 的实际运行证据与最终发布结论，不用于提前声明完成 |

## 1. 目标与顺序

本轮严格按以下顺序推进：

```text
P0 现状冻结
  ↓
P1 Interactive UI 美化与组件体验收尾
  ↓
P2 HTML Artifact 产品化与安全收尾
  ↓
P3 统一功能、安全、视觉、模型和 Runtime 验收
  ↓
P4 文档、示例、发布开关和验收报告收口
```

统一测试安排在 P1、P2 完成以后，避免 UI 和 Artifact 外壳仍在变化时反复更新截图和语料结果。但每个开发批次仍必须运行定向单元测试、类型检查、Lint 和构建；“最后统一测试”不等于开发过程中不测试。

本计划的最终目标不是再做两个独立演示页，而是让以下能力在 OpenChamber 真实对话流中具有一致、可验证的体验：

1. Agent Generated Declarative：Agent 使用标准组件临时组合页面。
2. Installed Declarative：OCIX 企业扩展使用标准组件连接真实业务数据。
3. Trusted Native：签名扩展使用 Host UI Kit 实现更复杂的企业模块。
4. HTML Artifact：标准组件无法表达时，生成隔离的自定义 HTML/CSS/SVG/受限 JavaScript。

### 1.1 本轮范围决策

为避免“已经能演示”和“已经适合默认发布”混为一谈，本轮采用以下发布边界：

- **美化先冻结**：先完成 Generated、Installed、Native 与 Artifact Host 的视觉、状态、响应式和可访问性合同；冻结后不再临时增加组件或改变 Token。
- **Static Artifact 是正式发布目标**：HTML/CSS/SVG、历史重放、内容寻址重建、三种显示模式和 Web/Managed Desktop 能力必须完整通过。
- **Scripts Artifact 是安全决策目标**：保留窄 Bridge、CSP、sandbox、feature flag 和 kill switch；“零未授权请求 + Bridge allowlist”是保留 experimental 入口的最低门槛，“可终止性”是升级 production/stable 的额外门槛。当前前两项已通过、第三项未通过，因此 experimental/default-off 是本轮冻结结论。
- **统一验收最后执行**：P1/P2 冻结后，使用同一语料、固定数据、固定时间和固定 Runtime 重新生成正式结果；开发过程中的定向测试与视觉 smoke 只作为阶段门禁，不代替最终验收。

### 1.2 当前执行快照

截至 2026-07-21，工作不是从零开始。下表用于区分“已经落地的基础”和“接下来真正需要完成的内容”：

| 阶段 | 当前状态 | 剩余阻断项 |
|---|---|---|
| P0 可重复基线 | 已完成 | 六条真实 Host fixture、54 组阶段截图、bundle/ready 基线与缺陷台账已经固定 |
| P1 美化 | 已完成 | 统一状态外壳、折叠式原始 Tool fallback、54 组 Host smoke 与三类失败态人工审图均已通过；视觉合同已冻结 |
| P2 HTML Artifact | 已完成本轮发布边界：Static B1 稳定；Scripts B2 按 experimental/default-off 收口；B3 打包 Desktop 与生产内置 Runtime 通过 | 独立可终止 Scripts renderer 属于后续安全项目，不阻塞本轮 Static 发布 |
| Gate AB | 已通过 | 视觉、Artifact 协议、Tool 路由和 Bridge 权限在统一验收期间冻结，只允许缺陷修复 |
| P3 统一测试 | **本机可执行门禁已完成**：功能、安全、62 张 Golden、Qwen/Big Pickle 16×2 路由、Runtime/性能与打包 macOS 均通过 | OpenAI Provider 未连接；Windows/Linux/Capacitor 未实测，均按外部 `unverified` 记录 |
| P4 发布收口 | **已完成** | Static 为 stable；Scripts 为 experimental/default-off；unsupported/unverified 与外部阻断已写入统一报告 |

已经生成的 54 组视觉 smoke 是 P1 阶段证据，结果与缺陷台账见
[Interactive UI 阶段基线](./INTERACTIVE_UI_STAGE_BASELINE.md)。P1/P2 冻结后又重新生成并人工首审了 62 张正式 Golden；正式基线位于
`tests/visual/interactive-ui/golden/`，不直接复用 `.tmp` 阶段截图。

### 1.3 本次重新排期：先做第二轮美化与 Artifact 收口

用户已明确决定在最终统一验收前再开放一次受控的产品精修窗口。因此，前述 P1/P2“已完成”表示第一轮基础合同已具备，不表示本轮直接跳过视觉和 Artifact 工作；本轮按下列顺序执行：

```text
R0 视觉审计与范围冻结
  ↓
R1 Interactive UI 第二轮美化
  ↓
R2 HTML Artifact 产品体验与作者体验收口
  ↓
Gate R：冻结 UI、组件 schema、Artifact 协议与路由
  ↓
R3 统一功能 / 安全 / 视觉 / 模型 / Runtime / 性能验收
  ↓
R4 文档、Skill 与发布结论
```

现有功能、安全、视觉和性能报告均作为“改造前回归基线”保留。Gate R 之后必须重新运行正式矩阵；旧报告不能直接作为精修后版本的发布证据。

第二轮 R0 已完成，真实会话证据、缺陷分级与冻结范围见
[Interactive UI R0 真实对话流视觉审计](./INTERACTIVE_UI_R0_VISUAL_AUDIT.md)。R1 当前以其中的 `R0-B01`、`R0-B02` 和 `R0-H01` 至 `R0-H06` 为强制退出项。

#### R0：视觉审计与范围冻结（0.5 天）

目标不是先写 CSS，而是先固定评价标准和本轮允许变化的范围。

工作项：

1. 以真实对话流而不是独立 demo 页，审阅 Generated、Installed Declarative、Trusted Native、Static Artifact 与 Scripts Artifact 六条路径。
2. 固定 6 个代表页面：强化学习流程、模型评测看板、天气/状态页、CRM overview、CRM workspace、自定义 SVG/模拟器。
3. 将问题归类为 `层级 / 排版 / 色彩 / 密度 / 图表 / 状态 / 响应式 / 可访问性 / Artifact 融入感`，每项附截图和期望结果。
4. 冻结本轮组件清单。只有满足“至少两个固定语料复用、可由有限 schema 安全表达、Artifact 明显过重”三个条件，才新增标准组件。
5. 记录主 bundle、Artifact lazy chunk、ready 时间与内存基线，避免为了美观造成不可见的性能回退。

退出条件：所有改动都有对应 fixture、验收尺寸和失败样例；不接受“更好看”这种无法验收的任务描述。

#### R1：Interactive UI 第二轮美化（2–3 天）

R1.1 宿主外壳与设计系统：

- 统一标题、摘要、来源、Live/Snapshot、Connector、更新时间、刷新与展开操作的层级。
- 收紧 `--ocix-*` Token：surface、border、text、semantic tone、chart palette、radius、shadow、spacing、density、focus 和 reduced-motion。
- 避免“卡片套卡片”；Section 默认依靠留白和标题分层，只有需要独立语义的区域使用边框。
- Generated、Installed、Native 与 Artifact Host 使用同一状态词汇和视觉骨架。

R1.2 核心数据组件精修：

- metric：主值、单位、趋势、环比、正负语义、超长数值和 Skeleton。
- chart：坐标、网格、图例、tooltip、hover/focus、空数据、密集 series、窄屏和色盲可辨识。
- table：粘性表头、数值对齐、密度、局部横向滚动、行操作、空态与长字段截断/展开。
- flow/timeline/activity：完成、进行、等待、失败状态和清晰连接关系。
- comparison/git-graph/tree/diff：密集信息、折叠、长标签、键盘路径与移动端降级。
- tabs/accordion/code-block：ARIA 关联、焦点环、复制反馈、溢出与 reduced motion。

R1.3 Agent 组合质量：

- 在 Tool schema、Skill 和示例中加入布局选择规则，而不是加入更多固定业务模板。
- 约束 section 数、节点数、表格行列、文本长度和嵌套深度，保证模型临时组合的页面仍有稳定节奏。
- 提供“流程、指标看板、状态分析、对比分析、Git 分析”五种组合示例，但它们只是 few-shot，不是只能选择的模板。
- Generated Declarative 继续禁止 action、query、binding、script、任意 style/className/color 和 Host 访问。

R1.4 Trusted Native 对齐：

- Host UI Kit 的 Button、Card、Badge、Notice、Progress、Table、Tabs、Input、Textarea、Skeleton 和 EmptyState 与 Declarative 使用相同 Token。
- Native 扩展不得携带第二份 React、注入全局 CSS 或依赖宿主不会扫描的动态 Tailwind class。
- CRM workspace 覆盖加载、空态、失败、陈旧数据、确认、取消、成功、403 和 revision 冲突。

阶段门禁：每个小批次运行相关组件测试、sanitizer、`type-check:ui`、`lint:ui` 和 Web build；阶段截图只用于评审，不在 R1 中更新正式 Golden。

R1 退出条件：

- 六个固定页面在 light/dark、1440/1024/768/390 和 zh-CN/en 下通过人工审图。
- 页面级无横向滚动，复杂表格/图形仅在组件内部受控滚动。
- 所有状态不只依靠颜色表达，键盘与屏幕阅读器结构可用。
- 旧 View JSON 无需迁移即可获得新视觉；任何 schema 扩展均完成类型、sanitizer、validator、Tool、示例和测试的纵向闭环。

#### R2：HTML Artifact 产品体验与作者体验收口（2–3 天）

R2.1 Static Artifact 作为正式能力：

- 保持独立 Result Envelope、服务端内容 hash、历史按 hash 重建和 cache/session 引用生命周期。
- 统一透明背景、Host Token、主题、locale、timezone、viewport、自动高度、内部滚动和失败 fallback。
- inline/workspace/fullscreen 必须复用同一 iframe 和 revision，切换显示模式不丢交互状态。
- 为 SVG、关系图、拓扑图和高定制度探索器提供作者示例；不得把 Artifact 变成第二套企业 API 接入机制。
- 完善 authoring guide、可复制模板和本地校验命令，使 Agent 或开发者可以稳定生成符合 OpenChamber 风格的文档。

R2.2 Scripts Artifact 保持受控实验能力：

- 继续使用 feature flag 与 Runtime capability 双门禁，默认关闭。
- 保持 Broker + opaque-origin 子 frame、严格 CSP、窄 Bridge、payload/sequence/rate limit 和用户手势检查。
- Bridge 只允许 resize、受控复制、受控外链、填入 follow-up 与请求展开；不增加 Tool、Gateway、Token、文件系统或任意网络能力。
- CPU/内存无法独立终止的问题不以浏览器 watchdog 冒充解决；独立 renderer 另立安全项目，不阻塞 Static Artifact 发布。

R2.3 路由与降级：

- 已安装业务 Tool 优先于 `interactive_ui` 与 `html_artifact`。
- 标准组件能表达时优先 `interactive_ui`；只有自定义几何、模拟器或探索器等表达力缺口使用 `html_artifact`。
- Artifact 试图直连企业 API、获取 Token、调用 Tool 或伪装实时数据时必须拒绝并给出安全替代路径。
- Runtime 不支持 scripts 时显示明确的 static/unsupported fallback，不出现空白 iframe。

R2 阶段门禁：运行 parser/store/routes/Bridge/Browser 定向测试、Web build 和实际打包 macOS Desktop smoke；不在 R2 中更新最终 Golden。

R2 退出条件：

- Static Artifact 在 Web、Hosted Mobile 390 和打包 macOS Desktop 的真实对话流中可显示、重放、cache 重建和恢复。
- Static/Experimental Scripts 的 sandbox、CSP 与 Bridge 权限精确；负面探针实际执行且未授权目标请求为 0。
- Artifact 与普通 Interactive UI 在视觉上属于同一对话系统，不出现 iframe 双边框、双重滚动或模式切换重建。
- scripts 明确标记 `experimental/default-off`，未验收 Runtime 明确标记 `unverified/unsupported`。

#### Gate R：最终合同冻结

Gate R 同时冻结以下内容：

- OCIX Token、通用组件清单、Declarative schema、Generated sanitizer 与 Native UI Kit v1。
- `interactive_ui` / `html_artifact` 的 Tool schema、路由优先级与 Capability 描述。
- Artifact Envelope、CSP、sandbox、Bridge v1、显示模式和 feature flag 默认值。
- 六个固定页面、16 条统一语料、fixture 数据、时间、locale、字体和 viewport。

Gate R 后只允许修复验收发现的缺陷。新增组件、扩大 Bridge、改变路由优先级或新增业务权限必须进入下一版本计划，不能一边验收一边改合同。

#### R3：统一验收（2–3 天，不含外部环境等待）

统一验收按固定顺序执行，失败即回到对应责任层修复并从该层开始重跑：

1. **确定性功能**：Generated、Installed、Native、OCIX 生命周期、Static Artifact、scripts-disabled、历史重放与 cache 重建。
2. **安全**：Declarative、OCIX、Artifact 攻击矩阵；日志、UI、截图和报告不得含 Key、Token、完整鉴权 URL 或上游错误正文。
3. **正式视觉**：人工审阅首版变更后，显式更新 62 张或扩展后的 Golden；CI 只比对，不自动更新。
4. **跨模型路由**：OpenAI、Qwen3.7 Plus、Big Pickle 使用相同 16 条语料，不为某个模型临时修改 prompt 或期望结果。
5. **Runtime/性能**：Web、Hosted Mobile 390、打包 macOS Desktop；Windows/Linux/Capacitor 未实测则记为 `unverified`，不能推断通过。
6. **组合报告**：将功能、安全、视觉、模型、Desktop 和性能报告合并为一个机器可读发布结论。

统一验收硬门槛：

| 维度 | 门槛 |
|---|---|
| 业务路由 | 已安装业务 Tool 命中率 ≥95% |
| Generated 路由 | 标准可视化选择 `interactive_ui` ≥95% |
| Artifact 路由 | 明确表达力缺口选择 `html_artifact` ≥90% |
| Artifact 误选 | 非 Artifact 语料误选率 ≤5% |
| 企业越权 | Artifact 访问企业 API/Token/Tool 次数为 0 |
| 视觉 | Golden 差异在冻结阈值内，Runtime error 为 0 |
| 可访问性 | 控件名、ARIA 引用、键盘、focus、overflow 断言全部通过 |
| Static 安全 | 未授权网络、导航、下载、frame/form 请求为 0 |
| 性能 | Artifact 保持 lazy，不进入聊天主 bundle；所有预算通过 |
| 数据闭环 | CRM 的 Tool、View、真实非空数据、确认写入和刷新分别通过 |

建议统一命令顺序：

```bash
bun run test:interactive-ui-functional
bun run test:interactive-ui-security
bun run test:interactive-ui-visual
bun run test:interactive-ui-model-routing
bun run test:interactive-ui-desktop-packaged
bun run test:interactive-ui-runtime-performance
bun run test:interactive-ui-extension
bun run type-check
bun run lint
bun run docs:validate
bun run dead-code
bun run build:web
```

若 OpenAI Provider 或 Windows/Linux 环境不可用，报告必须标记为外部阻断或未验证；不得降低阈值、换语料或用单项 smoke 冒充完成。

#### R4：文档与发布收口（0.5–1 天）

- 更新统一验收报告、Runtime capability、Artifact authoring guide、OCIX 开发手册和 Agent Skill。
- 记录构建 hash、命令、报告路径、截图索引、external blocker、experimental 和 unsupported。
- 固定 Static 默认开、Scripts 默认关以及 kill switch 回滚流程。
- 发布结论分别给出 `stable / experimental / unsupported / unverified / blocked`，不使用笼统的“整体通过”。

#### 本次预计工作量

基于当前分支已经具备第一轮实现，预计 **7–10 个有效开发日**：R0 0.5 天、R1 2–3 天、R2 2–3 天、R3 2–3 天、R4 0.5–1 天。若本轮只做现有组件精修、不新增 schema，通常可压缩到 5–7 天；若同时实现可独立终止的 Scripts renderer，需要额外 3–5 天和独立安全评审。

### 1.4 当前可执行工作包

本节是从现在开始的执行看板。状态只反映当前工作树和已经取得的证据；“代码已写”不等于“真实路径已通过”。工作包必须按表中顺序关闭，除定向单元测试外不提前运行或更新正式 Golden。

| 顺序 | 工作包 | 主要缺陷/目标 | 核心改动面 | 完成证据 | 当前状态 |
|---:|---|---|---|---|---|
| 1 | R1-A 单一主 View 路由 | `R0-B01` | System prompt、内置/OCIX Skill、Tool 描述、模型路由验收器 | CRM/Sales 自然语言各跑一轮；每个 assistant turn 恰好一个专业业务 Tool、一个主 View、零次后续 `interactive_ui` / `html_artifact` | **完成**：CRM/Sales 真实 Host 各一个专业 Tool、一个主 View、零次通用 Tool 续调用 |
| 2 | R1-B Rich Result 外壳去重 | `R0-H01`、`R0-H02`、`R0-M05` | `TurnActivity`、`ProgressiveGroup`、`ToolPart`、`InteractiveUIView`、Tool display metadata | ready 状态只出现一个紧凑 Tool 状态入口和一个 View；summary 不重复；原始输出仍可按需展开；失败态保留安全 fallback | **完成**：单一 Tool 状态入口；长篇 post-View 复述折叠为 Agent notes，原文可展开；Sales 单句结论保持直显 |
| 3 | R1-C Shell 与长页面响应式 | `R0-B02`、`R0-H06`、`R0-M04` | `MainLayout`、聊天滚动容器、Composer inset、chart/table 窄屏布局 | Desktop 390 自动收起左栏且无单字列；Hosted Mobile 390 无页面横向滚动；长 View 尾部不被 Composer 遮挡 | **完成**：Desktop/Hosted Mobile 390、页面 overflow、组件局部滚动与长 View 尾部均进入正式视觉矩阵并通过 |
| 4 | R1-D 视觉层级与 Token | `R0-M01`、`R0-M02` | `ocix-theme.css`、Declarative primitives、Native UI Kit | light/dark 下层级清楚；无等权卡片套卡片；secondary/muted/axis/disabled 对比度与 focus 可读 | **完成**：Declarative、Native、Artifact 共用 OCIX Token；light/dark Golden 与 focus/a11y 结构断言通过 |
| 5 | R1-E 图表与表格可读性 | `R0-H05`、`R0-H06` | chart/table renderer、Tool schema、Skill、few-shot、validator | 异量纲不再共用单轴；绘制值、图例单位、无障碍值一致；390px 首尾标签不裁切；宽表只在组件内滚动且有可发现提示 | **完成**：异量纲拆图、单位归一、390px 标签与本地滚动提示已通过模型和视觉矩阵 |
| 6 | R1-F Native 与业务示例对齐 | `R0-M03`、业务失败态 | Native UI Kit、CRM/Sales View 与 Skill | 中文界面不裸露英文枚举；loading/empty/401/403/unreachable/stale/revision conflict 使用统一状态语言 | **完成**：本地化标签、统一状态外壳及 401/403/409/unreachable 确定性矩阵通过 |
| 7 | R1-G 长 Tool 生命周期 | `R0-M06` | Tool activity、Artifact lifecycle、取消与恢复 | 长调用显示生成/物化/加载阶段；可取消；取消后历史仍可安全重放或显示明确终止态 | **完成**：真实长调用显示 building 阶段与全局 Stop；取消后显示明确终止态，刷新历史不再恢复 iframe 或运行态 |
| 8 | R1-H 阶段审图 | 关闭全部 R1 阻断项 | 七条真实会话、视觉 smoke | `R0-B*`、`R0-H*` 全关；`R0-M*` 关闭或有非阻断结论；light/dark × 1440/1024/768/390 × zh-CN/en 通过 | **完成**：62 张正式 Golden 人工首审后连续比对零差异、0 Runtime error |
| 9 | R2-A Artifact Host 融入 | `R0-H03`、`R0-H04` | `HTMLArtifactView`、materializer 基础样式、Token 注入、fixtures | dark/light 无白色 gutter、双边框和双滚动；Static 与 Scripts 样例都使用 Host 风格 | **完成**：Static/Scripts 在 inline/workspace/fullscreen 和 light/dark 中通过正式视觉验收 |
| 10 | R2-B Static 生命周期与显示模式 | 稳定发布目标 | store/routes/cache/session、inline/workspace/fullscreen、恢复态 | Web、Hosted Mobile、打包 Desktop 均可显示、重放、cache 重建；三种模式复用同一 iframe/revision | **完成**：三类已验收 Runtime 通过；打包应用重启后保持同 content ID |
| 11 | R2-C 作者体验 | Agent 能稳定生成而非依赖固定模板 | authoring guide、Skill、模板、本地 validator、固定 SVG/拓扑/探索器样例 | 新 Artifact 可从文档/Skill 独立生成；透明背景、响应式、主题 fallback、禁用能力可被自动检查 | **完成**：Guide、内置/示例 Skill、Envelope、validator 与三类 fixture 通过文档和构建门禁 |
| 12 | R2-D Scripts 实验边界 | experimental/default-off | capability、双开关、Broker、Bridge、状态 UI、kill switch | scripts 关闭有明确 fallback；Bridge allowlist 与真实零请求探针通过；不宣称可终止性 | **完成（实验边界）**：27 项安全通过、目标请求 0；因缺少独立终止边界保持 default-off |
| 13 | R2-E 路由与打包复验 | Artifact 不抢业务路径 | Tool/Skill 路由、Runtime capability、packaged smoke | 业务 Tool 优先；标准图优先 Declarative；只有表达力缺口进入 Artifact；实际 `.app` 内容可见 | **完成**：Qwen/Big Pickle 16×2 与新构建 macOS `.app` 均通过 |
| 14 | Gate R 合同冻结 | 停止边开发边改验收标准 | schema、Token、Tool、Bridge、语料、fixtures、viewport | 冻结清单签入文档；之后仅允许修缺陷，不再增加组件/权限/Bridge | **完成**：冻结后仅修复无效 sections 空 View 与验收/进程稳定性缺陷 |
| 15 | R3 统一验收 | 同一冻结版本的组合证据 | 功能、安全、视觉、模型、Runtime、性能 | §1.6 的统一矩阵全部达到硬门槛 | **完成（已连接环境）**：全部本机门禁通过；OpenAI 与非 macOS 平台按外部 `unverified` 保留 |
| 16 | R4 发布收口 | 文档与真实能力一致 | 报告、手册、Skill、capability、flags、最终全仓门禁 | 每项明确 `stable / experimental / unsupported / unverified / blocked`；最终命令全部通过 | **完成**：统一报告与发布分级已更新，全仓门禁通过 |

### 1.5 R1 与 R2 的批内测试策略

开发阶段采用“改一层、测一层、最后看真实 Host”的节奏，避免把所有问题留给统一测试：

1. **组件或协议定向测试**：修改 renderer、Host shell、schema、sanitizer、Artifact parser/store/Bridge 时，先运行相应的最小测试文件。
2. **静态门禁**：每个工作包完成后运行 `bun run type-check:ui`；触及 Server/Electron 时补相应 type-check、Node syntax check 和定向测试。
3. **阶段构建**：R1 的宿主与组件合同稳定后运行 Web build；R2 的 Runtime 合同稳定后再运行 Web build 和打包 Desktop smoke。
4. **真实 Host 复验**：单元测试通过后，必须回到真实 OpenChamber 对话流复跑关联语料。独立 demo 页、fixture 页或 fallback 空页面不能作为完成证据。
5. **临时截图**：阶段截图写入 `.tmp`，用于人工对比，不更新 `tests/visual/interactive-ui/golden/`。
6. **失败回退**：若真实 Host 失败，回到产生问题的工作包修复，并重跑该工作包及所有受影响的后续定向测试；不通过提高截图容差或修改语料绕过。

R1 的最小真实复验集：RLHF 流程、天气、模型运营、Installed Sales、Native CRM。R2 的最小真实复验集：Static SVG、Scripts 模拟器、Static 历史重放、cache 缺失重建、scripts-disabled fallback。

### 1.6 Gate R 后的统一测试矩阵

统一测试必须使用隔离的 OpenChamber data、OpenCode config、Artifact cache 与业务 API；不得读取开发者全局 Tool、Skill、OCIX 或历史缓存。固定数据、时间、locale、字体、viewport 和 16 条语料在 Gate R 后保持不变。

| 批次 | 验收内容 | 关键断言 | 机器可读产物 |
|---|---|---|---|
| R3-1 功能 | Generated、Installed、Native、CRM 真实 API、确认写入、OCIX 生命周期、Static、scripts-disabled、重放/重建 | Tool selected、View rendered、Business data loaded 分开计数；fallback 不算业务成功 | `.tmp/interactive-ui-unified-functional/report.json` |
| R3-2 安全 | Generated sanitizer、OCIX 包/签名/连接、Artifact CSP/sandbox/Bridge、日志脱敏 | 企业 API/Token/Tool 越权为 0；未授权网络/导航/下载/form/frame 请求为 0；输出无敏感信息 | `.tmp/interactive-ui-security/report.json` |
| R3-3 视觉与 a11y | 六条稳定路径、Artifact 状态与显示模式，light/dark × 1440/1024/768/390 × zh-CN/en | 人工首审后才更新 Golden；Runtime error、ARIA、键盘、focus、overflow 全通过 | `tests/visual/interactive-ui/golden/` 与 `.tmp/interactive-ui-visual-smoke/` |
| R3-4 跨模型路由 | OpenAI、Qwen3.7 Plus、Big Pickle 使用相同 16 条语料 | 业务/Generated ≥95%，Artifact 表达力缺口 ≥90%，Artifact 误选 ≤5%，重复主 View 为 0 | `.tmp/interactive-ui-model-routing/report.json` |
| R3-5 Runtime 与打包 | Web、Hosted Mobile 390、实际 macOS `.app`、bundled OpenCode、进程退出/重启 | 核心 Tool/Skill 自动发现；Static 内容真实可见；状态恢复与 kill switch 正常 | `.tmp/interactive-ui-desktop-packaged/` 及 Runtime 报告 |
| R3-6 性能 | 主聊天 bundle、Artifact lazy chunk、materialize、iframe ready、内存、cache | Artifact 重代码不进入聊天首屏；各项不超过冻结预算 | `.tmp/interactive-ui-runtime-performance/report.json` |
| R3-7 全仓收口 | extension/system tests、type-check、lint、docs、dead-code、Web build | 所有门禁通过；未验证平台有明确 capability 标签 | `.tmp/interactive-ui-unified-acceptance/report.json`、命令日志与统一验收报告 |

正式执行顺序固定为 `R3-1 → R3-2 → R3-3 → R3-4 → R3-5 → R3-6 → R3-7`。如果在某一批次修复了代码，至少重跑该批次和它之后所有受影响批次；视觉 Golden 只能由显式 update 命令生成并逐张人工确认，CI/常规验收只做比对。

### 1.7 里程碑与时间安排

| 里程碑 | 预计时间 | 进入条件 | 退出结果 |
|---|---:|---|---|
| M1 美化冻结 | 2–3 天 | R0 审计已完成 | R1-A 至 R1-H 完成，视觉/路由/响应式合同冻结候选 |
| M2 Artifact 冻结 | 2–3 天 | M1 完成 | R2-A 至 R2-E 完成，Static 稳定候选，Scripts experimental/default-off |
| M3 Gate R | 0.5 天 | M1、M2 全部有证据 | schema、Token、Tool、Bridge、语料与 fixtures 正式冻结 |
| M4 统一验收 | 2–3 天 | Gate R 通过 | R3-1 至 R3-7 的同一版本组合报告 |
| M5 发布收口 | 0.5–1 天 | M4 无 blocker | 手册、Skill、capability、flags 与发布结论一致 |

总计仍按 **7–10 个有效开发日** 估算。Provider 不可用、Windows/Linux 实机缺失或外部签名环境缺失可以记录为 `blocked/unverified`，但不允许因此降低其余门槛。Scripts 独立可终止 renderer 不属于本轮；若追加，单独增加 3–5 天和安全评审。

## 2. 当前基线

当前不是从零开始，以下基础合同已经存在：

- `.ocix-scope`、`--ocix-*` Token、明暗主题和语义色。
- metric、chart、table、flow、timeline、activity、comparison、tabs、accordion、code、sparkline、git graph、tree 和 diff 等 Declarative 节点。
- Native Host UI Kit、Installed Declarative、Trusted Native、Business Gateway 和 OCIX 管理。
- `html_artifact` Tool、Result Envelope、内容寻址存储、iframe sandbox、CSP、Bridge、inline/workspace/fullscreen 和历史重建。
- 路由 Capability、Routing Inspector、static/scripts feature gate 和基础系统测试。

仍未关闭的关键缺口：

- 视觉实现、阶段 smoke 和正式 visual Golden 已完成：54 个基础组合加 8 个 Artifact 显示模式/失败状态，共 62 张版本化截图；像素差异、ARIA、键盘、overflow 与 sandbox 结构使用同一命令验收。
- 打包后的 Managed Desktop Artifact 空白问题已定位并修复：CSP revision 2 在保留 `'self'` 的同时只允许精确的 `openchamber-ui://app` Desktop 宿主；revision 3 再加入 Scripts Broker。全新隔离目录下的实际 `.app` 已证明使用打包内置 OpenCode CLI，并通过 Static Artifact 可见性、cache 重建、inline/workspace/fullscreen 同实例、scripts-disabled fallback 和整应用重启。
- `interactive_ui`、`html_artifact` Tool、Interactive UI Skill 和 Generated View 已迁入生产内置 Runtime。OpenChamber 在 OpenCode 启动前幂等协调这些资产；用户拥有的同名不同内容文件不会被静默覆盖，冲突会被明确报告。
- scripts Artifact 当前默认关闭。普通 sandbox iframe 的下载/导航旁路已经由受信 Broker + opaque `data:` 子 frame 修复；真实 Chromium 攻击矩阵确认全部攻击代码执行且目标请求数为零，Bridge 伪造与子页面导航也被阻断。由于当前 Web/Desktop iframe 仍不能从宿主独立终止 CPU 死循环或内存攻击，Scripts 只保留 experimental 开关，不进入生产发布范围。
- Simple CRM 已通过隔离的全服务 C1 验收：真实 bundled OpenCode 发现已安装 Tool/Skill，Declarative/Native View 可解析，真实业务 API 返回 4 个客户与 4 个商机，确认式写入、权限拒绝、revision 冲突、服务不可达以及 OCIX 完整生命周期均有脱敏机器证据。
- 同一 16 条语料已在 Qwen3.7 Plus 与 Big Pickle 上各 16/16 通过；安全、Runtime/性能和最终发布报告已关闭。OpenAI Provider 未连接以及 Windows/Linux/Capacitor 未实测属于外部 `unverified`，不回到 P1/P2 扩大功能范围，也不伪报为通过。

## 3. 范围与非目标

### 3.1 本轮范围

- Declarative、Installed Declarative、Trusted Native 和 Artifact Host 的视觉一致性。
- 已有通用组件的质量收尾，并只补充能显著提高常见任务覆盖率的组件。
- static Artifact 的生产化。
- interactive Artifact 的受控启用、可终止性方案和 Runtime 能力声明。
- 真实对话流、真实 OCIX、真实业务 API、历史回放和打包 Desktop 验收。
- Web、Managed Desktop 和 Hosted Mobile 的明确支持或降级行为。
- 一个 OpenAI 模型和两个非 OpenAI 模型运行同一份固定语料。

### 3.2 本轮非目标

- HTML Artifact 直接访问 Business Gateway、Token、Tool、MCP 或 Connector。
- npm/CDN、多文件 Artifact 工程、在线 IDE 或长期网站托管。
- 使用 Artifact 代替 Installed Declarative / Trusted Native 企业模块。
- 公共 Artifact 市场。
- 为了追求视觉效果引入 blur、持续背景动画或高 GPU 成本特效。

## 4. P0：冻结基线与任务清单

### 4.1 工作项

- [x] 固定 Generated、Installed、Native、CRM、static Artifact、interactive Artifact 六条真实 Host fixture；P3 再运行真实 Agent 对话。
- [x] 记录 light/dark、1440/1024/768/390 px 的当前 Host fixture 截图，作为“阶段参考”，不作为最终 golden。
- [x] 补齐 Artifact inline/workspace/fullscreen 的阶段截图，并验证模式切换复用同一个 iframe。
- [x] 记录当前主 bundle、Artifact lazy chunk 和六条路径 ready 时间。
- [x] 将已知缺陷按 `blocking / visual / compatibility / external / later` 分类。
- [x] 冻结 P1 期间允许新增的组件清单；没有明确场景的组件不临时加入。

### 4.2 建议冻结的示例

| 路径 | 示例 | 用途 |
|---|---|---|
| Generated | LLM 强化学习流程 | 流程、状态、说明和布局 |
| Generated | 模型评测看板 | metric、chart、comparison、table |
| Installed Declarative | Simple CRM overview | 真实 query、loading、empty、error、stale |
| Trusted Native | Simple CRM workspace | Host UI Kit、操作确认、写后刷新 |
| Static Artifact | 自定义神经网络 SVG | 自定义图形、主题和响应式 |
| Interactive Artifact | 学习率模拟器 | slider、SVG 更新、Bridge 和脚本隔离 |

### 4.3 完成门槛

- 基线截图、性能数字、已知问题和样例输入都可重复取得。
- 后续视觉调整不再依赖临时 prompt 或人工记忆。

参考工作量：0.5 天。

## 5. P1：Interactive UI 美化与组件体验收尾

P1 不重写现有渲染器，而是在现有 `--ocix-*` Token、Declarative primitives 和 Native UI Kit 上做系统收尾。

### 5.1 P1.1 统一宿主外壳

目标：Generated、Installed、Native 和 Artifact 看起来属于同一套 OpenChamber 对话体验。

- [x] 统一 title、summary、来源、更新时间、运行状态和操作区的排版。
- [x] 统一卡片圆角、边框、内边距、分组间距和最大宽度。
- [x] 统一 loading、empty、unconfigured、unreachable、unauthorized、forbidden、stale 和 error 状态；失败态只显示安全分类，原始 Tool fallback 默认折叠、按需展开。
- [x] Artifact iframe 默认透明、无 iframe 边框、无双重滚动；错误态仍保留标题与 summary。
- [x] inline、workspace、fullscreen 复用同一个内容实例，不因切换模式丢失局部交互状态。

主要影响文件：

- `packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`
- `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`
- `packages/ui/src/styles/ocix-theme.css`

### 5.2 P1.2 Declarative 视觉细化

- [x] metric：数值层级、趋势、同比/环比、正负语义和极长数字。
- [x] chart：网格、坐标、图例、tooltip、hover/focus、空数据和 series 对比度。
- [x] table：粘性表头、数值对齐、行密度、横向滚动、空态和操作 hover。
- [x] flow/timeline/activity：完成、进行、失败、等待状态；连接线和时间层级。
- [x] comparison/git-graph/tree/diff：长标签、密集数据、折叠、窄屏和键盘行为。
- [x] tabs/accordion/code-block：focus ring、键盘切换、ARIA 关联、复制反馈、溢出和 reduced motion。
- [x] 所有状态不能只依赖颜色表达。

若新增字段或节点，必须同时修改 TypeScript 类型、renderer、Generated sanitizer、服务端 package validator、Tool schema/description、示例和测试，禁止只改 renderer。

### 5.3 P1.3 Native Host UI Kit 收口

- [x] 对齐 Button、Card、Badge、Progress、Table、Tabs、Input、Textarea 和 EmptyState；确认与通知继续通过 `host.dialog` / `host.notifications`，不向扩展暴露私有 Dialog/Toast 实现。
- [x] 为 Native UI Kit 固定 `uiVersion: 1` 和只增 props 稳定范围。
- [x] 检查扩展复用 Host React，不打包第二份 React，不注入全局 CSS。
- [x] 用真实 Native CRM 页面覆盖非空查询、确认式写入、revision 更新和写后刷新。

### 5.4 P1.4 响应式、主题与可访问性

- [x] light/dark 和宿主自定义主题下，OCIX 语义色保持可读。
- [x] 1440/1024/768/390 px 无页面级横向溢出。
- [x] 表格、图表和 Git graph 在窄屏使用局部滚动或降级布局。
- [x] 键盘可进入 tabs、accordion、table actions、workspace/fullscreen 控件。
- [x] ARIA label、focus-visible、触控目标和 `prefers-reduced-motion` 达到组件级发布要求。
- [x] zh-CN、en、长文本、大数字和空数据不破坏布局。

### 5.5 P1.5 Fixture Gallery 与阶段门禁

Gallery 是开发夹具，不是面向用户的独立产品入口。它用于一次查看所有节点、状态和尺寸，并支持后续截图自动化。

每个批次运行：

```bash
bun run type-check:ui
bun run lint:ui
bun run type-check:web
bun run build:web
```

同时运行 Declarative sanitizer、renderer 和 Native UI Kit 定向测试。

`bun run test:interactive-ui-visual` 提供可重复的正式视觉门禁：它启动隔离 OpenChamber Server、真实 mock Business Gateway 和 Chromium，以 Generated、Installed Declarative、Native Sales、Native CRM、Static Artifact、Scripts Artifact 六条实际 Host 路径覆盖 light/dark、1440/1024/768/390 px 及 zh-CN/en，共 54 个基础组合，并补充 8 个 Artifact workspace/fullscreen/失败状态，总计 62 张 Golden。测试同时断言页面级无横向溢出、表格只局部滚动、业务路径返回非空行、Host summary/metadata 存在、主题 Token 确实切换、Artifact sandbox 精确、三种显示模式复用同一个 iframe、无 Runtime 异常、无缺失控件名/ARIA 引用/iframe title/image alt，并验证 Generated tabs 与 accordion 的键盘行为。基线位于 `tests/visual/interactive-ui/golden/`；差异和运行报告输出到 `.tmp/interactive-ui-visual-smoke/`。

Golden 更新必须先人工审图，再显式运行：

```bash
bun run test:interactive-ui-visual:update
```

日常和 CI 只运行检查命令，不得在失败后自动更新 Golden。当前每通道阈值为 12、允许变化像素比例为 0.0005、平均通道差为 0.05；差异 PNG 必须作为审查证据，不能通过提高全局阈值掩盖回归。

### 5.6 P1 完成门槛

- 四条路径使用一致的 Token、宿主外壳和状态语言。
- 旧 View JSON 不修改即可获得新视觉；非法 style/className/color/script 仍被拒绝。
- 标准组件足以完成流程、指标、图表、表格、时间线、对比和 Git graph。
- 明暗、窄屏、长文本、空态、错误态和键盘路径完成阶段 smoke。
- P1 的 UI 合同冻结后，才开始制作最终 visual golden。

参考工作量：3–5 天。

## 6. P2：HTML Artifact 产品化与安全收尾

### 6.1 P2.0 关闭 Managed Desktop 阻断问题

这是 P2 的首个阻断项：打包应用中 Artifact 外壳已经渲染，但 iframe 内容为空。

- [x] 用实际 `.app` 重现并收集 CSP/console 证据。
- [x] 校验 `frame-ancestors` 是否允许受信的 `openchamber-ui://app`，只放行精确宿主，不放宽到任意页面。
- [x] 增加 static 和 interactive document response 的 CSP 契约测试。
- [x] 重新打包应用，验证 static 内容可见、interactive 内容可见且 sandbox 精确。
- [x] 验证首次启动使用内置 OpenCode CLI，不要求用户额外安装 OpenCode。
- [x] 将核心 Generated View、`interactive_ui` / `html_artifact` Tool 与 Interactive UI Skill 纳入生产包，并在全新配置目录自动发现，不依赖 demo 环境变量。

P2.0 未通过前，不把 Managed Desktop Artifact 标记为可用。

2026-07-21 运行证据：`bun run test:interactive-ui-desktop-packaged` 使用实际 arm64 `.app`、全新 Electron user-data/OpenChamber data、隔离 OpenCode 配置和受限 PATH，证明 bundled OpenCode 1.18.3 启动成功；其真实发现接口返回 `interactive_ui`、`html_artifact` 和 `interactive-ui-visualization`。Generated View 与 Static Artifact 内容可见，cache 清理后按同一 content ID 重建，inline/workspace/fullscreen 复用同一 iframe，scripts 关闭时显示明确 fallback，整应用重启后 Runtime 仍为 ready，Runtime error 为 0。

### 6.2 P2.1 Static Artifact 生产化

- [x] Result Envelope、HTML 大小、数量、字段和日期继续严格校验。
- [x] 服务端计算内容 hash；历史消息按 hash 重建，不重新调用模型。
- [x] 验证 `script`、事件属性、远程 URL、form、iframe、object/embed 和导航被扫描或 CSP 阻断。
- [x] iframe 不含 `allow-scripts`、`allow-same-origin`、forms、popup、download 或 top navigation。
- [x] static Artifact 在 Web、Managed Desktop 和 Hosted Mobile 使用明确 capability；VS Code 明确 unsupported。
- [x] cache 清理、缺失/损坏重建和会话删除清理可验证；共享内容只在最后一个会话引用释放后删除，引用索引损坏时保守保留内容。

Static Artifact 达到上述门槛后，可以作为第一批稳定能力发布。

### 6.3 P2.2 Interactive Artifact 受控能力

- [x] `allow-scripts` 只在 scripts flag 与 Runtime capability 同时满足时出现。
- [x] Document CSP 不开放 connect、worker、frame、form、eval 或 WebAssembly，iframe sandbox 不授予 popup、download、top-navigation 等权限。
- [x] 浏览器端端到端攻击矩阵证明 network、navigation、download、nested-frame、form 和 meta-refresh 攻击代码实际执行但目标服务器请求数为零；Broker 检测子 frame 导航、移除子页面并发出严格 `broker.navigationBlocked` 信号。
- [x] Bridge 继续校验 `event.source`、随机 channel、协议版本、方向、sequence、payload 上限和频率。
- [x] Bridge 只允许 resize、受控复制、受控外链、填入 follow-up 和请求展开；不允许 callTool、Token、Gateway、文件系统或剪贴板读取。
- [x] 当前 Runtime 不能提供独立终止边界，因此 scripts 默认关闭；明确启用时 capability 与 UI 均标记 experimental。

Runtime 策略：

| Runtime | static | scripts |
|---|---|---|
| Managed Desktop | 必须支持 | Broker 网络/Bridge 门禁已通过；独立终止边界完成前仍为 experimental、默认关闭 |
| Web | 必须支持 | Broker 网络/Bridge 门禁已通过；独立终止边界完成前仍为 experimental、默认关闭 |
| Hosted Mobile | 响应式 static | unsupported |
| VS Code | 验证后声明支持或 unsupported | 默认 unsupported |

### 6.4 P2.3 Artifact 的视觉融入

- [x] Artifact 接收只读 theme、locale、timezone、viewport 和 reduced-motion。
- [x] 提供一份 Artifact authoring style contract，要求优先使用 Host Token、透明背景、static light/dark fallback 和响应式布局。
- [x] 外壳 loading、ready、blocked、crashed、scripts-disabled 和 unsupported 使用统一状态语言；失败时原始 Tool output 默认折叠、按需展开，避免安全提示后直接铺满源码。
- [x] 自动高度限制在安全范围内；超过上限使用受控内部滚动和“展开”。
- [x] workspace/fullscreen 保持 iframe URL、hash 和局部状态。

### 6.5 P2.4 路由、Tool 与示例

- [x] `interactive_ui` 是标准组件足够时的默认选择。
- [x] `html_artifact` 只用于自定义 SVG、模拟器、探索器等表达力缺口。
- [x] 已安装业务 Tool 永远优先；Artifact 请求直连企业 API 时拒绝并引导到 OCIX。
- [x] 提供三个固定 Artifact fixture：静态 SVG、参数模拟器、关系/拓扑探索器。
- [x] Tool 输出必须标注用户数据、模型推导数据或模拟数据，不冒充实时业务数据。

### 6.6 P2 阶段门禁

每个批次至少运行 Artifact parser、store、routes、Bridge、Tool rendering 和 system 定向测试；随后运行：

```bash
bun run test:interactive-ui
bun run type-check
bun run lint
bun run docs:validate
bun run build:web
```

### 6.7 P2 完成门槛

- static Artifact 在真实 Web 和打包 Managed Desktop 对话流中显示、重放和重建成功。
- scripts 关闭时有明确 fallback；若任何 Runtime 仍提供实验入口，则该入口必须通过端到端 sandbox/CSP/Bridge 负面门禁，且 Runtime 能力说明真实。
- inline/workspace/fullscreen 无视觉割裂、双重滚动或状态丢失。
- Artifact 无法访问 Host DOM、Secret、Tool、Gateway、网络和文件系统。
- 不支持可靠终止脚本的 Runtime 不宣称 scripts 生产可用。

参考工作量：4–7 天；若本轮同时实现 Managed Desktop 独立可终止 renderer，再增加 3–5 天和一次专门安全评审。

## 7. P3：统一测试与发布验收

P3 开始前冻结 P1 的视觉合同和 P2 的 Artifact 协议。此后只修缺陷，不再随意增加组件或 Bridge 能力。

### 7.1 P3.1 固定测试语料

建立 16 条中英文固定语料，所有模型使用完全相同的输入：

语料已经冻结在 `examples/interactive-ui/unified-acceptance-corpus.json`，结构测试固定为 Generated 6 条、业务 4 条、Artifact 3 条、负例 3 条。P3 只记录不同模型的实际结果，不再临时改 prompt 或期望路径。

| 类别 | 数量 | 期望路径 |
|---|---:|---|
| 流程、指标、天气、对比、表格、Git graph | 6 | Generated Declarative |
| CRM overview、workspace、查询、确认式写入 | 4 | Installed/Native OCIX |
| 自定义 SVG、模拟器、探索器 | 3 | HTML Artifact |
| Artifact 直连 CRM、标准图误用 Artifact、未知能力 | 3 | 拒绝/降级/正确回退 |

每条记录：模型、prompt、期望 Tool、实际 Tool、路由理由、渲染结果、业务数据结果、sandbox、Runtime 和截图引用。

### 7.2 P3.2 统一功能矩阵

- [x] Generated：强化学习流程、天气、对比、图表、表格、Git graph。
- [x] Installed：Simple CRM 真实 API 返回非空数据；unconfigured、ready、unauthorized、forbidden、unreachable 已通过，正式 empty/stale 视觉态归 C2。
- [x] Native：确认、取消、成功、权限拒绝、冲突 revision 和写后刷新已通过。
- [x] OCIX：安装、升级、禁用、启用、回滚、卸载、重装、Capability、Tool/Skill 发现和连接清理已通过。
- [x] Artifact：static、scripts-disabled、interactive、重放、cache 重建、损坏 fallback 和显示模式。

CRM 验收拆成三个独立结果：

1. Agent 选中正确 Tool。
2. OpenChamber 渲染正确 View。
3. View 从真实业务 API 加载非空数据。

三项都通过才算完整业务闭环。

### 7.3 P3.3 安全攻击矩阵

- Declarative：未知节点、原型路径、任意颜色、style/className、脚本、query/action 越权。
- OCIX：签名、发布者、manifest capability、跨扩展调用、未确认写入和 Secret 泄漏。
- Artifact：parent/top、storage、network、localhost、Gateway、form、popup、navigation、download、remote asset、iframe、worker、eval、Wasm、Bridge 伪造、超大 payload、resize flood、CPU/内存攻击。
- 日志、错误 UI、Routing Inspector 和截图中不得出现 Key、Token、完整鉴权 URL 或业务响应正文。

### 7.4 P3.4 正式视觉 Golden

当前状态：**已完成**。版本化 manifest 固定了 `darwin-arm64`、Chrome 版本、尺寸、文件 hash 和像素阈值；62 张 Golden 已逐组人工审阅，随后连续检查得到 0 个差异和 0 个 Runtime error。Scripts Artifact 只作为 experimental 视觉样例保留，不因此升级发布等级。

最终截图矩阵：

```text
light / dark
× 1440 / 1024 / 768 / 390
× inline / workspace / fullscreen（适用时）
× Generated / Installed / Native / static Artifact / interactive Artifact
× ready / loading / empty / error / stale（适用时）
```

实施要求：

- 使用固定 fixture 数据、固定时间、固定字体和关闭非必要动画。
- 对动态区域设置稳定 mask，而不是提高整个页面的差异阈值。
- 第一版 golden 必须人工审核；之后 CI 比对只接受明确批准的变化。
- 截图之外增加键盘、ARIA、溢出和 iframe sandbox 的结构断言。

### 7.5 P3.5 跨模型路由

至少使用：

- 一个已连接的 OpenAI 模型。
- Qwen3.7 Plus。
- Big Pickle。

目标：

- 已安装业务域 Tool 命中率 ≥95%。
- 标准通用可视化选择 Generated Declarative ≥95%。
- 明确表达力缺口选择 Artifact ≥90%。
- 其余语料 Artifact 误选率 ≤5%。
- Artifact 直连企业 API、获取 Token/Tool、伪装实时业务数据的比例为 0。

如果某 provider 未连接，报告必须标记为外部阻断，不得以模型目录可见或不同 prompt 的单项 smoke 代替统一矩阵。

### 7.6 P3.6 Runtime 与性能矩阵

- Web：四条路径、主题、重放、static 和 scripts capability。
- Managed Desktop：实际打包 `.app`，内置 OpenCode、首次启动、窗口重开、自定义协议、CSP、workspace/fullscreen 和 kill switch。
- Hosted Mobile：390 px 正式入口、static Artifact、滚动和降级。
- Windows/Linux Desktop：若声明本版本支持，则在 CI 或实机验证自定义协议、Secret Store、Artifact CSP 和脚本开关；否则在 capability 文档中明确未验收。
- 性能：主聊天首屏不包含 Artifact 重 chunk；记录 lazy chunk、materialize、iframe ready、内存和 cache 预算。

### 7.7 P3 完成门槛

- 固定语料、功能、安全、视觉、跨模型和 Runtime 矩阵都有可重复证据。
- 自动化与真实对话结果一致，没有只在 demo 页成功的能力。
- Simple CRM 真实 API 闭环通过。
- 打包 Managed Desktop 的 Artifact 内容实际可见，不只是卡片外壳存在。
- 任何未通过项都明确标记为 blocker、experimental 或 unsupported。

参考工作量：4–6 天，跨模型与非 macOS Runtime 的外部环境准备不计入纯开发时间。

## 8. P4：文档与发布收口

- [x] 更新统一验收报告，附命令、报告路径、截图和失败说明；敏感 token 全部脱敏。
- [x] 更新开发者手册与 Skill：何时使用 Declarative、Native、Artifact，如何使用 Token/UI Kit，如何调试和验收。
- [x] 更新 Runtime capability 表和 feature flags 默认值。
- [x] 更新 Simple CRM 示例的业务 API 启动、凭据配置和完整 Agent 控制流。
- [x] 保留 scripts kill switch，回滚时不删除历史 Artifact，只禁止执行。
- [x] 执行最终 `type-check`、`lint`、`docs:validate`、系统测试、扩展测试和生产构建。

## 9. 详细执行批次与依赖

每一批都必须满足自己的退出条件后才能进入下一批。代码修改与测试证据分开记录，避免用“测试文件存在”代替“真实路径通过”。

### Batch A1：冻结可重复基线

工作内容：

1. 固定六个样例、fixture 数据、时间、locale、theme 和 viewport。
2. 固定 Generated、Installed、Native、static Artifact、interactive Artifact 的真实 Host 入口。
3. 记录当前 build chunk、首次渲染、materialize 和 iframe ready 数据。
4. 建立 `blocking / visual / compatibility / later` 缺陷台账。

产物：可重复命令、阶段截图目录、性能基线和缺陷表。

退出条件：同一命令连续两次得到相同结构结果；动态内容有固定值或稳定 mask；不得依赖手工修改 URL、临时 Prompt 或开发者控制台。

### Batch A2：完成视觉与状态系统

工作内容：

1. 复核 Host title、summary、来源、Live/Snapshot、Connector、更新时间和操作区。
2. 将 Artifact 的 loading、ready、blocked、crashed、scripts-disabled、unsupported 状态对齐到统一 Notice 语言；错误信息只显示安全分类，原始 Tool fallback 默认折叠、按需展开。
3. 复核 Declarative 高密度数据、长文本、空数据、局部滚动和键盘路径。
4. 复核 Native CRM/Sales 的 loading、empty、unconfigured、401、403、unreachable、stale 和 generic error。
5. 对 light/dark、1440/1024/768/390、zh-CN/en 做人工截图审阅。

产物：冻结的 Token、状态词汇、Host shell、组件 Gallery 和阶段截图。

退出条件：四条渲染路径无页面级横向溢出；失败状态不暴露原始服务端错误或凭据；不依赖颜色表达状态；键盘与 ARIA 定向测试通过。完成后禁止为本轮新增无明确语料场景的标准组件。

### Batch B1：Static Artifact 产品化

当前状态：已完成。Runtime/ADR、导航源校验、capability、cache/session 生命周期、损坏恢复、系统测试、真实 Chromium 零请求验证、生产构建和 54 组阶段 smoke 均通过；打包 Desktop 的首次启动属于独立的 Batch B3 发布门禁。

工作内容：

1. 明确 Web、Managed Desktop、Hosted Mobile、VS Code 的 static capability 与降级结果。
2. 完成 cache 命中、cache 清理、缺失重建、metadata/document 损坏 fallback。
3. 将 Artifact cache 与会话删除生命周期关联，并验证不会误删其他会话仍引用的内容。
4. 验证静态 HTML 中 script、事件属性、远程资源、导航、form、iframe、object/embed 均被拒绝或被 CSP 阻断。
5. 验证 inline/workspace/fullscreen 复用同一实例并保持状态。

产物：稳定 static capability、生命周期测试、恢复测试、状态 UI 和 Runtime 表。

退出条件：Web 与打包 Managed Desktop 的真实对话能显示、重放、重建；损坏时出现可恢复状态而非空白 iframe；Artifact 无网络、Host DOM、Secret、Tool、Gateway、storage 或文件系统能力。

### Batch B2：Scripts Artifact 实验能力收口

当前状态：Bridge 校验、双开关、kill switch、CSP revision 3 与受信 Broker 已实现；端到端网络/导航/下载/Bridge 门禁通过。由于没有独立 CPU/内存终止边界，本批次以 experimental/default-off 的产品决策完成，不升级为生产能力。

工作内容：

1. 复核 `scripts flag ∩ Runtime capability` 双门禁和默认关闭行为。
2. 对 Bridge source/channel/version/sequence/payload/rate limit 进行正常与伪造消息测试。
3. [x] 受信 Broker + 不可信 opaque `data:` 子 frame 已实现，并稳定执行负面探针；直接 sandbox iframe 不再作为 Scripts 生产路径。
4. [x] 真实请求计数器验证 network、worker、frame、form、popup、download、eval、Wasm、self/top navigation 与 meta refresh；不是只检查 API 抛错、CSP 字符串或 sandbox flags。
5. 验证 resize、复制、外链、follow-up、展开仅在允许条件和近期用户手势下执行。
6. 记录 CPU 死循环与内存攻击的真实限制；没有独立可终止进程的 Runtime 直接保持 unsupported/默认关闭，不用前端 watchdog 冒充终止边界。

产物：安全矩阵、kill switch、实验标签、确定性学习率模拟器和拓扑探索器 fixture。

退出条件：已满足。关闭 scripts 时有清楚 fallback；没有任何 Runtime 同时通过“零未授权请求 + Bridge allowlist + 可终止性”三项，因此 Scripts 以 experimental/默认关闭收口，不阻塞 Static Artifact 发布。独立 renderer/process 作为后续安全项目，不纳入本轮统一发布门禁。

### Batch B3：打包 Desktop 与内置 OpenCode

当前状态：已完成。实际 arm64 `.app` 已通过 bundled OpenCode、生产内置 Tool/Skill/View 自动发现、Generated 渲染、Static Artifact、cache 重建、三种显示模式、scripts-disabled fallback、整应用重启和进程退出验收。

工作内容：

1. 创建全新的隔离 user-data/data 目录，不复用开发环境缓存。
2. 清除 `OPENCODE_BINARY`、`OPENCODE_CONFIG_DIR`、skip-start 和外部 endpoint 覆盖。
3. 启动实际打包 `.app`，证明使用 `resources/opencode-cli/opencode`，无需用户额外安装 OpenCode。
4. 将 Built-in Interactive UI 的 manifest/View、两个 Agent Tool 和 Skill 放到生产所有权目录；启动时幂等协调到 OpenCode 全局配置，并保护用户或 OCIX 拥有的同名资产不被静默覆盖。
5. 从实际 bundled OpenCode 的 Tool/Skill 发现接口证明 `interactive_ui` 和 `html_artifact` 可用，并从 Extension Runtime 证明 Generated View 可解析；不得通过 `examples/interactive-ui` 或 `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` 注入。
6. 在首次启动会话中分别触发 Generated、Static Artifact 和 scripts-disabled fallback。
7. 验证窗口关闭/重开、历史恢复、自定义协议、CSP、kill switch、应用退出以及二次启动的幂等性。

产物：生产内置 Runtime 资产、启动协调测试、Tool/Skill/View 发现断言、打包版本、脱敏启动证据、首次启动截图和失败日志分类。

退出条件：全新环境一次启动成功；bundled OpenCode 明确发现两个核心 Tool 和 Skill；Generated 与 Static Artifact 内容真实可见而不只是 Host 卡片存在；scripts-disabled fallback、cache 重建、显示模式和整应用重启通过；验证过程不输出完整进程参数、Token 或鉴权 URL。

验收证据：`bun run test:interactive-ui-desktop-packaged` 在隔离数据目录中返回 `ok: true`，bundled OpenCode 1.18.3 发现 `interactive_ui`、`html_artifact` 与 `interactive-ui-visualization`，Generated/Static 状态均为 `ready`，三种显示模式、同 content ID cache 重建和整应用重启通过，Runtime error 为 0。

### Gate AB：冻结美化和 Artifact 合同

只有 A1、A2、B1、B2、B3 全部满足退出条件后，才允许进入统一验收。Gate 后只修缺陷，不新增组件、不改变 Tool 路由优先级、不扩大 Artifact Bridge 和 capability。

当前状态：已通过。P3 期间若发现问题，只允许修复与冻结合同不一致的缺陷；新增 Declarative 节点、新增 Native UI Kit 能力或扩大 Artifact Bridge 必须另立后续计划，不能混入统一验收。

### Batch C1：统一功能与真实业务闭环

当前状态：已完成。`bun run test:interactive-ui-functional` 在独立临时数据、配置和缓存目录中使用实际 bundled OpenCode，动态启动独立 Simple CRM API，并返回 `ok: true`；脱敏报告写入 `.tmp/interactive-ui-unified-functional/report.json`。

工作内容：

1. 建立一个可重复的全服务验收入口，使用隔离的 OpenChamber data、OpenCode config 和实际 bundled OpenCode；测试不得依赖开发者已有的全局 Tool、Skill、OCIX 或缓存。
2. 启动 Simple CRM 真实 API，安装签名版 Simple CRM OCIX，等待真实 OpenCode 发现 `simple_crm_open_overview` 与 `simple_crm_open_workspace`。
3. 分别验证 Agent Tool、Installed Declarative overview、Trusted Native workspace 和真实 API 数据；客户、商机和管道必须非空，连接失败不能伪装成空数据成功。
4. 验证连接未配置、连接测试、密钥不回显、查询成功、连接不可达、401、403 和服务端错误的安全分类。
5. 验证 Native 写操作的未确认拒绝、取消后数据不变、确认成功、写后刷新、只读 Key 权限拒绝和 stale revision 冲突。
6. 验证 OCIX 从旧版升级到新版，再依次禁用、启用、回滚、卸载和重装；每一步都检查 Manager 状态、Capability、OpenCode Tool 发现、View 解析、历史 fallback 与连接清理。
7. 对固定 16 条语料记录 expected tool、actual tool、View、数据结果和 Runtime；本批只固定确定性功能证据，真实三模型结果归 C3。

产物：一个可重复命令、脱敏 JSON 结果、CRM 非空数据断言、OCIX 生命周期记录和失败分类。输出不得包含 Access Key、Token、完整鉴权 URL 或原始业务错误正文。

退出条件：CRM 的 Tool selected、View rendered、Business data loaded 三项分别通过；fallback 或空壳不能记为真实业务成功。

验收证据：客户 4、商机 4、管道金额 3,050,000；`simple_crm_open_overview` / `simple_crm_open_workspace` 与 Skill 被实际 OpenCode 发现；1.1.1 → 1.2.0 → 隔离动态连接验收版的安装升级、禁用启用、回滚恢复、卸载清凭据和重装未配置状态全部通过。401/403/409 仅返回稳定安全分类，不回显第三方原始错误。

### Batch C2：正式视觉 Golden 与可访问性

当前状态：**已完成**。`bun run test:interactive-ui-visual:update` 创建 62 张版本化 Golden；人工首审覆盖六条路径以及 Artifact workspace/fullscreen/blocked/crashed/scripts-disabled，随后 `bun run test:interactive-ui-visual` 在相同环境下得到 62/62、最大变化像素比例 0、最大平均通道差 0、Runtime error 0。ARIA、键盘、overflow 与 sandbox 结构断言同步通过。

工作内容：

1. 冻结 light/dark × 1440/1024/768/390 × 适用显示模式 × 渲染路径 × 状态矩阵。
2. 对时间、字体、数据和动画做确定性处理，只 mask 真正动态的区域。
3. 首版 Golden 逐张人工审核，再接入自动差异比较。
4. 同时保留 DOM、ARIA、键盘、overflow 与 iframe sandbox 结构断言。
5. 将 Generated、Installed、Native、Static Artifact 纳入稳定 Golden；Scripts Artifact 作为 experimental 单独归档，不把它的波动扩大到稳定基线。

产物：受版本控制的 Golden、截图索引、允许差异规则、人工首审记录，以及可重复的视觉/可访问性命令。

退出条件：正式截图和结构断言同时通过；不能用提高全局像素容差掩盖布局回归。

### Batch C3：安全、跨模型、Runtime 与性能验收

当前状态：**已完成本机可执行范围**。Qwen3.7 Plus 与 Big Pickle 各 16/16，所有路由指标为 100% 或零违规；安全 27 通过、0 失败；Web、Hosted Mobile 390、打包 macOS arm64 和性能预算通过。OpenAI `gpt-5.4` 未连接，Windows/Linux/Capacitor 未实测，均保留为外部 `unverified`。

工作内容：

1. 执行 Declarative、OCIX、Artifact 的完整攻击矩阵。
2. 用一个 OpenAI 模型、Qwen3.7 Plus、Big Pickle 跑完全相同的 16 条语料。
3. 验证 Web、打包 Managed Desktop、Hosted Mobile；未实测的 Windows/Linux/VS Code 明确标记 unsupported 或 unverified。
4. 记录主聊天首屏、Artifact lazy chunk、materialize、iframe ready、内存和 cache 预算。
5. 将功能、安全、模型、Runtime 和性能结果合并到同一份机器可读报告，避免分别通过但组合路径失败。

产物：攻击矩阵、三模型路由统计、Runtime capability 表、性能预算和外部阻断清单。

退出条件：达到 §7.5 的路由命中率；企业 API/Token 越权为 0；日志、UI、截图和报告无敏感信息；性能没有把 Artifact 重代码并入聊天首屏主路径。

### Batch D：文档、Skill 与发布收口

当前状态：**已完成**。统一报告、执行计划、开发手册、Skill、Runtime capability 与发布标签一致；最终全仓门禁通过。

工作内容：

1. 更新开发者手册、Artifact authoring guide、OCIX Skill、Runtime capability 和示例。
2. 生成统一验收报告，附命令、构建 hash、截图索引、外部阻断和 experimental/unsupported 列表。
3. 固定 static/scripts feature flag 默认值和 scripts kill switch 回滚流程。
4. 运行最终全仓 type-check、lint、docs、dead-code、系统测试、扩展测试和生产构建。

退出条件：文档与实现一致；任何未通过项都有明确发布标签；最终门禁全部通过。

### 9.1 预计节奏

| 批次 | 预计工作量 | 备注 |
|---|---:|---|
| A1–A2 | 已完成 | 视觉、状态、响应式、可访问性和阶段 smoke 已冻结 |
| B1 | 已完成 | Static 合同、文档和阶段门禁已经冻结；打包复验归 B3 |
| B2 | 已完成 | Scripts 以 experimental/default-off 收口；独立 renderer 另立后续安全项目 |
| B3 | 已完成 | 生产内置 Tool/Skill/View、bundled OpenCode 和打包 Desktop 复验通过 |
| C1 | 已完成 | 真实 CRM、OCIX 生命周期和固定语料结构闭环；跨模型执行仍归 C3 |
| C2 | 已完成 | 62 张正式 Golden、人工首审、像素比较和可访问性结构断言 |
| C3 | 已完成本机范围 | OpenAI 与非 macOS 环境保留外部 `unverified` |
| D | 已完成 | 只做收口，未引入新能力 |

Static-first 的本机开发与验收已完成。剩余时间只取决于外部环境：连接 OpenAI 后补跑同一 16 条语料，以及按需取得 Windows/Linux/Capacitor 实机或 CI 证据。如果另行决定实现“可独立终止的 Scripts renderer”，仍需增加 3–5 天和专门安全评审，但不阻塞 Static Artifact 正式发布。

## 10. 风险与决策点

| 风险 | 处理 |
|---|---|
| 持续增加组件导致美化阶段没有终点 | P0 冻结清单；新需求优先由现有组件组合或 Artifact 表达 |
| Artifact 看起来像嵌入网页 | 统一 Host shell、透明背景、Token 注入、自动高度和同实例展开 |
| 自定义协议修复时过度放宽 CSP | 只允许精确受信 Desktop host，并增加响应头契约与真实打包测试 |
| scripts 死循环阻塞宿主 | 分离 static/scripts；不能可靠终止的 Runtime 不默认开启 scripts |
| sandbox 未授权下载仍产生网络请求 | 已由 Broker + opaque 子 frame 关闭，并由真实请求计数器验证；继续保留回归探针，禁止退回直接 iframe |
| 模型滥用 Artifact | Tool 优先级、固定负例、误选率门槛和 Routing Inspector |
| CRM 空 fallback 被误算成功 | 将 Tool、View、Business Data 三项分开验收 |
| 视觉 golden 过早固化 | P1/P2 冻结后再创建正式基线 |
| 测试输出泄露凭据 | URL、settings、日志、截图和报告统一脱敏 |

## 11. 最终 Definition of Done

只有以下条件全部满足，才能结束本轮：

- Generated、Installed、Native 和 Artifact 在真实对话流中使用统一视觉语言。
- 常用业务与分析界面能由标准组件优雅表达，特殊图形由 Artifact 补足。
- static Artifact 在 Web 和打包 Managed Desktop 稳定显示、重放和重建。
- interactive Artifact 仅在真实满足 capability 的 Runtime 启用，安全边界与终止策略有测试证据。
- Simple CRM Tool、View、真实 API 数据和确认式写入完成闭环。
- 一个 OpenAI 模型和两个非 OpenAI 模型通过同一固定语料矩阵。
- light/dark、desktop/mobile、inline/workspace/fullscreen 具有正式视觉 golden。
- 安全攻击矩阵、性能预算、feature flags、kill switch、文档、示例和开发 Skill 与实现一致。
- 所有未支持的 Runtime 或能力都明确显示 unsupported/experimental，不静默降级。

## 12. 后续步骤

1. **关闭唯一模型外部阻断**：连接 OpenAI Provider，原样运行 `bun run test:interactive-ui-model-routing`；不得修改 16 条语料、acceptable tools 或阈值。
2. **按发布平台补证据**：只有准备声明 Windows/Linux Desktop 或 Capacitor 支持时，才执行对应的自定义协议、Secret Store、CSP、进程生命周期与显示模式验收。
3. **Scripts 独立安全项目**：实现可独立终止的 renderer/process 后再评估从 experimental 升级；本轮不扩大 Bridge 或默认权限。
4. **保持回归门禁**：日常改动运行确定性功能、安全、视觉、模型路由、打包与性能命令；Golden 只有人工审查后才能显式更新。
