# Interactive UI / OCIX 开发踩坑手册

> 适用范围：Agent Generated Declarative、Installed Declarative、Trusted Native、HTML Artifact、OCIX Agent Runtime 与 OpenCode 路由。  
> 本文记录已经在真实开发与统一验收中出现过的问题。它用于故障预防，不替代架构规范和开发手册。

## 1. 先建立正确的系统模型

Interactive UI 不是一个独立组件页，而是一条跨越 Agent、Tool、Host、扩展和业务 API 的链路：

```text
用户消息
  → OpenChamber 读取当前 Runtime capability 与已启用 OCIX routing metadata
  → 把路由上下文交给 OpenCode / 模型
  → 模型选择业务 Tool、interactive_ui 或 html_artifact
  → Tool 返回严格 Result Envelope
  → ToolPart 识别成功结果并物化 View
  → Declarative / Trusted Native / Artifact Host 在对话流渲染
  → 业务 View 经 Business Gateway 请求第三方 API
  → 结果、错误、确认写入和刷新继续留在同一对话流
```

任意一段“看起来成功”都不能替代全链路完成。尤其要分别证明：

- `Tool selected`：模型选择了正确 Tool；
- `View rendered`：Host 识别并显示了有效 View；
- `Business data loaded`：企业模块获得了真实且非空的 API 数据。

## 2. 开发过程中出现过的主要陷阱

### 2.1 独立演示页通过，不代表产品通过

**症状**：Native 和 Declarative fixture 页面能显示，但用户在 OpenChamber 对话里看不到任何 Interactive UI。

**根因**：fixture 绕过了 capability catalog、模型路由、Tool discovery、Result Envelope、ToolPart 和消息历史等真实边界。

**修正原则**：独立页只用于缩短组件开发反馈；完成证据必须来自真实 OpenChamber 对话流。业务扩展还必须连接真实测试 API，fallback 空页面不算通过。

### 2.2 空页面不能被包装成成功结果

**症状**：模型第一次调用 `interactive_ui` 时传入了空、畸形或字符串化的 `sections`，UI 出现空白成功卡片；模型随后又调用一次 Tool 修正，形成两个主 View。

**根因**：Tool 把“解析失败后得到空数组”当作合法结果，渲染层无法区分空成功与真正成功。

**修正原则**：

- 接受模型可能把 `sections` 作为 JSON 字符串传入，但解析后仍要做严格验证；
- 没有有效 section 或没有受支持 widget 时必须返回 Tool error；
- 只有 `completed` 且输出包含正确 OpenChamber Result schema 的 ToolPart 才算成功主 View；
- 失败修正调用保留在 `toolStates`，但不能计入重复成功 View。

对应回归入口是 `packages/web/server/lib/interactive-ui/builtin/agent-runtime/tools/interactive_ui.ts`、Generated sanitizer 测试和模型路由矩阵。

### 2.3 一个意图产生两个主 View

**症状**：CRM workspace 已成功打开后，模型又补一个 CRM overview、`interactive_ui` 或 `html_artifact`。

**根因**：系统提示、Tool description、OCIX Skill 和能力目录没有共同表达“最强意图”和“成功后停止”。

**修正原则**：

1. 企业领域明确匹配时，已安装业务 Tool 优先于通用生成 Tool；
2. 标准组件可表达时，`interactive_ui` 优先于 Artifact；
3. 只有 Declarative 无法合理表达时才选择 `html_artifact`；
4. 第一个主 View 成功后停止继续创建等价主 View；
5. 用固定语料验证路由，不为某个模型单独修改 prompt、acceptable tools 或阈值。

### 2.4 安装 UI 不等于 Agent 已发现 Tool

**症状**：Extension Manager 显示扩展已安装，但对话中模型从未调用扩展 Tool。

**根因**：OCIX 有 Host 和 Agent 两半。View、Native bundle 和 Gateway 属于 Host；Custom Tool 与 routing Skill 属于 OpenCode Agent Runtime。

**修正原则**：一个可独立安装的 `.ocix` 应同时携带：

```text
ui/declarative 或 ui/native
agent-runtime/tools/*.ts
agent-runtime/skills/*/SKILL.md
openchamber.extension.json
```

OpenChamber 安装器统一协调所有已启用扩展的 Tool/Skill，并在 OpenCode 启动前或扩展状态变化后完成发现。不再为每个扩展设置独立 `OPENCODE_CONFIG_DIR`。外部 OpenCode Server 是例外：Host 本地安装 UI，远端管理员仍需在远端部署 Agent Runtime。

### 2.5 Skill 不是业务传输层

**症状**：Skill 描述了 CRM 操作，但没有 Tool，或者 Agent 被要求从 Skill 直接请求 API。

**根因**：混淆了“告诉模型何时选择能力”和“真正执行能力”。

**修正原则**：Skill 负责路由说明；Tool 负责输入校验、返回 Envelope 和触发受治理的业务能力；Business Gateway 或独立 MCP 负责外部调用。不要把 Key、Token 或任意 HTTP 调用放进 Skill 文本。

### 2.6 OpenCode 重启中的 503 不是“Tool 已消失”

**症状**：安装、禁用或卸载 OCIX 后，测试很快观察到一次 `503`，误判 Tool 已移除，然后继续下一次状态变更，导致多个 managed restart 重叠。

**根因**：把传输失败当成权威空清单。

**修正原则**：只有一次成功返回的 Tool inventory 才能证明 Tool 存在或不存在。`502/503/504` 只表示 Runtime 暂时不可用，等待健康恢复后重新读取权威状态。

### 2.7 传输错误和语义错误不能共用重试策略

**症状**：模型选错 Tool 后测试自动重试直到碰巧通过，掩盖真实路由不稳定；反过来，OpenCode 短暂重启又被当作语义失败。

**修正原则**：

- session create 的 `502/503/504`、请求超时或 completion timeout 可以有限重试；
- Tool 选错、重复主 View、Artifact 越权等语义错误不自动重试；
- 每次 attempt 都写入报告，不能把第二次成功描述为首轮成功。

### 2.8 旧版内置 Tool 不能被当成用户文件永久冻结

**症状**：应用已经包含新版 `interactive_ui` / `html_artifact`，但每次启动都报 `agent_tool_conflict`，OpenCode 继续使用旧全局文件。旧 Tool 可能抛出当前源码已经修复的异常，让模型生成或 Host 渲染被误判为失败。

**根因**：早期版本把内置 Tool/Skill 写入全局 OpenCode 目录，但尚未记录管理器所有权。新版本为了保护用户文件，会拒绝覆盖任何未受管理的同名文件。

**修正原则**：只为历史上真实发布过的内置文件维护“目标路径 + 精确 SHA-256”允许列表。哈希命中时可一次性接管、升级并写入新所有权状态；任何其他哈希仍视为用户文件并报冲突。不能以文件名、目录位置或模糊内容判断所有权。

这类问题必须同时做桌面升级链验收，不能只验证干净配置。发布矩阵和门禁见 [OCIX 与 OpenChamber 桌面打包踩坑手册](./INTERACTIVE_UI_PACKAGING_PITFALLS.md) 的“安装包已更新，但真实用户仍加载旧 Runtime”一节。

### 2.9 测试辅助模型会制造无关噪音

**症状**：路由测试之外还出现 session recap、suggestion 等模型请求，造成额外并发、超时和难以解释的日志。

**修正原则**：隔离演示与验收配置可以关闭 recap/suggestion 等非被测能力；不要因此修改普通产品默认值。

### 2.10 Tool 状态、View 和长文本重复展示

**症状**：同一调用同时展示 Tool 卡片、完整 JSON、主 View 和长篇模型复述，用户看到多层重复内容。

**修正原则**：一个调用只保留一个 Tool 状态和一个主 View。View 后的长 recap 折叠为 Agent notes；原始 Tool output 只作为渲染失败或不支持 Runtime 时的 fallback。

### 2.11 Generated Declarative 是不可信数据

**症状**：为了增加表现力，直接允许模型输出 action、query、binding、脚本、任意样式或宿主访问。

**风险**：这会把安全的声明式层升级成未签名代码/权限层，绕过 OCIX 和 Artifact 的边界。

**修正原则**：Generated 路径只允许有界标准组件组合，并限制深度、节点数、行列数和文本长度。禁止 action、query、binding、script、`className`、任意颜色和 Host 访问。真实业务查询与写入必须进入 Installed Declarative / Trusted Native；自由表现代码进入 Artifact。

### 2.12 iframe 有 sandbox 不等于 Scripts Artifact 已安全

**症状**：浏览器 API 看起来被禁用，就把任意模型 JavaScript 标记为 stable。

**根因**：普通 Web iframe 缺少宿主可独立终止的 CPU 死循环和内存攻击边界；部分导航和下载能力也不能只靠 CSP 字符串推断。Managed Desktop 只有在真正选择独立 Runner 时才不同，不能因为运行在 Electron 壳里就把普通 iframe 当成独立进程证据。

**修正原则**：

- Static Artifact 可作为稳定能力；
- Managed Desktop Scripts 必须进入独立 `WebContentsView` Runner，并由主进程强制 Stop、租约、CPU/内存和并发门禁；普通 Web Scripts 保持 `experimental / default-off`；
- 使用受信 Broker 与 opaque-origin 子 frame；
- 安全测试必须观察真实目标请求数、导航阻断信号和 Runtime error，而非只检查属性字符串；
- Artifact 永远不能获得 Connector、Token、Tool、Gateway、Cookie、文件系统或任意网络。

详细边界见 [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md)。

### 2.13 显示模式切换不应重建 Artifact

**症状**：inline 切到 workspace/fullscreen 后，模拟器状态、滚动位置或局部输入丢失；Managed Desktop 还可能立即显示 `Artifact blocked for safety`，退出后原模式按钮和停止/重启入口不再恢复。

**根因**：切换容器时重新创建 iframe、重新 materialize 内容，或让带有 `mode` 闭包的 `onLoad` / `onMessage` 回调进入 Desktop Runner 启动 effect 的依赖。最后一种情况不会重建 React 外壳，却会停止并重建底层 `WebContentsView`；第二次 `load` 随即命中防导航保护，形成一次由 Host 自己制造的安全误报。

**修正原则**：三个显示模式复用同一个 execution surface 和 content ID；Web 是同一 iframe，Managed Desktop 是同一 `WebContentsView`。模式是 Host 布局状态，不是 Artifact 内容版本。Runner 启停 effect 只依赖 URL 与后端选择；事件回调通过 ref 读取当前实现，mode/theme 变化只重发 `host.init` 和更新原生 bounds，不得触发 stop/start。

**验收要求**：Scripts Artifact 至少跑 `inline → workspace → inline → fullscreen → inline → workspace → inline`。每一步都断言状态为 `ready`、Runner Host 节点身份不变、failure fallback 不存在；展开态保留停止和退出入口，回到 inline 后恢复停止、fullscreen、workspace 三个入口。Managed Desktop 必须用系统级窗口截图复核展开态和最终恢复态，不能只测试 Static Artifact 的 iframe 身份。

### 2.14 Desktop 390 不是 Hosted Mobile 390

**症状**：把桌面浏览器缩到 390px 后通过，就宣称移动端通过；实际 Hosted Mobile 入口仍有侧栏、页面横向滚动或表格撑宽。

**修正原则**：分别测试 Desktop responsive 和真实 Hosted Mobile 入口。页面本身不得横向溢出；只有表格、复杂图等局部组件可以受控滚动。

### 2.15 进程生命周期不能只依赖 Ctrl+C

**症状**：终端反复 `Ctrl+C` 后仍有 PushWatcher、OpenCode 子进程或 47832 监听；stop 脚本又可能误杀只是“命令文本包含 demo 文件名”的 shell。

**根因**：父进程先退出后子进程被 reparent，或用子字符串匹配进程命令。

**修正原则**：

- 日常启动/停止使用 `bun run demo:interactive-ui:start` 和 `bun run demo:interactive-ui:stop`；
- 启动器记录受管状态和端口所有权；
- 停止前先快照进程树，再处理父进程退出后残留的 descendants；
- 识别进程时解析真实入口，不做宽泛子字符串匹配；
- 测试结束必须确认根进程、子进程和监听端口都消失。

### 2.16 Secret 和上游错误不能进入 UI 或报告

**症状**：失败时把完整授权 URL、Bearer Token、Access Key 或第三方响应正文写进日志、截图或 JSON 报告。

**修正原则**：Secret 只留在服务端 Secret Store / Gateway 注入边界。UI、Agent output、Tool envelope、日志和验收报告只使用稳定错误分类与脱敏摘要。第三方 API 仍负责最终权限校验。

### 2.17 Demo 能渲染，不代表真实会话能通过 Desktop CORS

**症状**：同一份 HTML Artifact Envelope 直接调用 materialize 成功，普通浏览器同源页面也能渲染，打包 demo fixture 仍为 `ready`；但 `openchamber-ui://app` 中的新会话和历史会话都显示 “Artifact could not be loaded”。

**根因**：真实会话为了引用计数会额外发送 `X-OpenChamber-Session-ID`。Packaged Desktop 从自定义协议请求 loopback HTTP 时会触发 CORS 预检；如果 `Access-Control-Allow-Headers` 没有列出该头，请求会在进入 Express 路由前被 Chromium 拦截。没有传 `sessionId` 的 demo 会掩盖这个缺口。

**修正原则**：任何共享 UI 新增的非简单请求头，都必须同步检查 packaged origin 的 CORS allowlist。桌面打包验收必须使用真实会话上下文调用 Artifact，而不能只渲染无 session ID 的孤立 fixture；诊断时同时比较同源浏览器与 `openchamber-ui://app`，并读取预检结果。

### 2.18 分区列数不能把唯一的指标组压进一格

**症状**：模型给“核心指标”分区设置了四列，但分区里只有一个 `metric-grid`。旧版 Tool 先生成四列父 Grid，再把整个指标组放进第一格，结果四张指标卡在一条很窄的列中纵向堆叠，右侧大面积留白。

**根因**：把“多个 widgets 的分区列数”和“一个 metric-grid 内部的指标列数”当成了两层同时生效的布局。即使模型表达的是横向四指标，规范化后的树也变成了 `grid(columns=4) → metric-grid(columns=3)`。

**修正原则**：只有多个兄弟 widgets 才创建父 Grid；分区只有一个 `metric-grid` 且组件没声明列数时，让它继承分区列数。Generated sanitizer 需要兼容已经存入历史会话的单子节点父 Grid，并把外层列数迁移到指标组。视觉验收必须读取实际卡片坐标或计算后的列模板，不能只断言 Tool 参数里出现了 `columns: 4`。

### 2.19 Desktop Runner 不会自动继承对话滚动裁剪

**症状**：Scripts HTML Artifact 本身能够运行，但滚动对话后仍悬浮在窗口最上层，覆盖标题栏、输入框、侧栏或已经离开视口的消息。负数 `top/left` 被主进程钳制为 0 时，Runner 还会像固定定位一样粘在窗口边缘。

**根因**：独立 `WebContentsView` 是 Electron 原生子 View，不属于 React DOM，因而不会继承消息列表的 `overflow`、CSS stacking context 或 fixed composer 的遮挡关系。只把 `getBoundingClientRect()` 直接写入 `setBounds()`，无法表达部分可见区域。

**修正原则**：Renderer 同时发送完整执行面 bounds 与它和 viewport/所有裁剪祖先的 clip bounds。不要假设原生父 `View` 会裁剪子 `WebContentsView`，圆角也不是可靠裁剪开关；应直接把 `WebContentsView` 限制为可见交集，再让可信 Broker 的内部 Artifact iframe 保持完整尺寸，并按裁掉的距离负偏移。布局需要 preload 回执后再显示原生 View；当 `artifact.resize` 恰好回报裁剪后的物理 viewport 高度时，必须将其识别为裁剪回声，不能改写宿主内容高度。无交集时隐藏；滚动/resize/layout 同步每个 animation frame 最多一次，几何未变化时不得发送 IPC。

**验收教训**：DevTools `Page.captureScreenshot` 只捕获主 renderer，不会包含叠加的原生 `WebContentsView`，因此空白截图也可能“通过”。回归必须启动打包后的 `.app`，把 Artifact 滚到固定输入区/保护区边界，用 macOS 系统级窗口截图检查最终合成画面，并至少断言保护区像素未被 Runner 覆盖。`test:artifact-runner-clipping-packaged` 是该边界的独立验收，不依赖 Agent Runtime 或 OCIX 安装。

## 3. 推荐的开发闭环

1. 读取最近的 `DOCUMENTATION.md`、本仓库 `AGENTS.md` 和匹配的项目 Skill。
2. 明确修改属于 Agent、Host、扩展、Gateway、Artifact 还是桌面 Runtime。
3. 先写或更新最窄的合同测试，修复后运行所属 package 的 type-check/lint。
4. 若跨越 Tool/Host 边界，回到真实 OpenChamber 对话流验证，不以 fixture 结束。
5. 若涉及业务扩展，分别断言 Tool、View、真实数据和确认写入。
6. 若涉及安全边界，运行真实浏览器攻击探针并检查脱敏输出。
7. 若涉及进程、Electron 或打包资源，运行对应 Runtime/打包验收，静态检查不够。
8. 更新能力标签：`stable`、`experimental`、`unsupported`、`unverified` 或 `blocked`。

## 4. 完成前检查表

- [ ] 真实对话流可触发，不只 fixture 可显示；
- [ ] 一个意图只有一个成功主 View；
- [ ] 无效 Envelope 明确失败，不出现空成功；
- [ ] 企业路径的 Tool、View、真实数据分别通过；
- [ ] 安装、启停、升级、回滚、卸载后的 Tool inventory 来自成功响应；
- [ ] fallback 没有被算作业务成功；
- [ ] Runtime、报告、日志和截图无 Secret；
- [ ] Artifact 权限没有因视觉需求被扩大；
- [ ] demo/test 清理了 OCIX、会话、进程、端口和临时目录；
- [ ] 验证范围与最终声明完全一致。

## 5. 关联资料

- [Interactive UI 美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)
- [Interactive UI 统一验收报告](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md)
- [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)
- [Interactive UI Agent 路由计划](./INTERACTIVE_UI_AGENT_ROUTING_PLAN.md)
- [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md)
