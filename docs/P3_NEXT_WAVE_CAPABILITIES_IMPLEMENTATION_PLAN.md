# P3 下一波能力：详细实施蓝图

> **文档性质**：可直接交给多个开发 Agent 的实施蓝图；不是开工授权、依赖安装授权、发布授权或完成声明。  
> **状态**：`planned / conditional implementation-ready`；P3.1–P3.3 有可执行方案，P3.4–P3.6 仍受本文的独立开始门约束。  
> **优先级来源**：工作区根目录 [`roadmap.md`](../../roadmap.md) 的 P3.1–P3.6；若本文或任何专题文档与 roadmap 冲突，以 roadmap 为准。  
> **当前主线**：P1 验收收口；P2 尚为 design。未经用户明确授权，不得依据本文修改 P3 产品代码。  
> **涉及仓库**：`openchamber/` 为 P3.1–P3.5 主仓；P3.6 同时涉及 `opencode/` 与其 SDK 发布链。  
> **基线日期**：2026-08-10。实施 Agent 开工时必须重新读取当前代码、`AGENTS.md`、匹配的 project skill 与最近的 `DOCUMENTATION.md`，不得把本文行号、依赖版本或旧报告当作不可变事实。  
> **详细来源**：[`OCIX_LOCAL_DATA_RUNTIME_PLAN.md`](./OCIX_LOCAL_DATA_RUNTIME_PLAN.md)、[`OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md`](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md)、[`OPENCHAMBER_CODEX_SHELL_DESIGN.md`](./OPENCHAMBER_CODEX_SHELL_DESIGN.md)、[`INTERACTIVE_UI_AGENT_ROUTING_PLAN.md`](./INTERACTIVE_UI_AGENT_ROUTING_PLAN.md)、[`OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md`](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md)、[`AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md`](./AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md)。

---

## 目录

- [0. 执行摘要](#0-执行摘要)
- [1. 优先级、授权门与停止条件](#1-优先级授权门与停止条件)
- [2. 当前代码基线与禁止重做项](#2-当前代码基线与禁止重做项)
- [3. 统一术语、产品不变量与模块边界](#3-统一术语产品不变量与模块边界)
- [4. 总体架构与实施顺序](#4-总体架构与实施顺序)
- [5. P3.1：Local Data Runtime](#5-p31local-data-runtime)
- [6. P3.2：Dev Hosted / Dual Path Phase 2+](#6-p32dev-hosted--dual-path-phase-2)
- [7. P3.3：Codex-style Shell](#7-p33codex-style-shell)
- [8. P3.4：Agent Routing Phase 4（条件项）](#8-p34agent-routing-phase-4条件项)
- [9. P3.5：Style S6 Native recharts（可选项）](#9-p35style-s6-native-recharts可选项)
- [10. P3.6：Declarative partial/streaming UI（条件项）](#10-p36declarative-partialstreaming-ui条件项)
- [11. 全量逐文件 A/M/V/R 清单](#11-全量逐文件-amvr-清单)
- [12. 平台、权限、数据与安全矩阵](#12-平台权限数据与安全矩阵)
- [13. 测试矩阵、命令与证据格式](#13-测试矩阵命令与证据格式)
- [14. 依赖、双仓、SDK 与发布门](#14-依赖双仓sdk-与发布门)
- [15. 多 Agent 工作包、文件所有权与波次](#15-多-agent-工作包文件所有权与波次)
- [16. 风险、失败模式与回退](#16-风险失败模式与回退)
- [17. Definition of Done](#17-definition-of-done)
- [18. 文档与 roadmap 回写](#18-文档与-roadmap-回写)
- [附录 A：P3.1 合同草案](#附录-ap31-合同草案)
- [附录 B：P3.2 CLI 与 HTTP 合同草案](#附录-bp32-cli-与-http-合同草案)
- [附录 C：P3.4 决策接口与报告草案](#附录-cp34-决策接口与报告草案)
- [附录 D：P3.5 Native Chart 合同草案](#附录-dp35-native-chart-合同草案)
- [附录 E：P3.6 Tool Progress 合同草案](#附录-ep36-tool-progress-合同草案)
- [附录 F：低级 Agent 开工与交接模板](#附录-f低级-agent-开工与交接模板)

---

## 0. 执行摘要

P3 不是一个可以整体开工的单体项目，而是六个授权条件、仓库边界和失败语义都不同的工作项。实施时必须按 ID 独立立项、独立验收，不能以“开始 P3”为由一次性修改全部宿主文件。

| Roadmap ID | 当前事实 | 本文建议 | 未满足门禁时的正确结果 |
|------------|----------|----------|------------------------|
| P3.1 Local Data Runtime | `better-sqlite3` 已是 Web/Electron 直接依赖；Hono 仅在 lockfile 中传递出现；OCIX 还没有本地 server handler 合同 | 在 OpenChamber server 同进程内新增 project × extension 隔离的 SQLite runtime；代码审计建议 MVP 直接接现有 Gateway，**不引入无第二消费者的 Hono** | 保持 `planned`，先由用户确认对旧“better-sqlite3 + Hono”选型的修正 |
| P3.2 Dev Hosted | Remote R1–R3 已完成；缺的是自研扩展的安全本机开发服务器 | 第一刀只做 CLI 驱动、loopback、签名、不可变 release snapshot 的 Dev Hosted server，复用 Remote 协议 | 不改产品信任模型，不重做 Remote |
| P3.3 Codex-style Shell | 终端、右侧栏、输出注册表等一部分底座已经存在；旧设计头错误写成“进入实现” | 先做 current-state audit，再在共享桌面/Web 壳层收敛导航、任务标题、输出与 workspace tabs；移动端保持原架构 | 保持现状并回写审计，不创建第二套 Terminal/Git/Files runtime |
| P3.4 Routing Phase 4 | 现有旧报告为 Qwen 17/17、duplicate 0，但缺 provenance 且早于 P2 | P2 后同一 HEAD 冷会话重跑；只有同一routing命中/重复失败类别可复现且低于阈值才考虑无状态 server scorer | **`result=not-triggered` 且零产品代码是合格结果** |
| P3.5 Native recharts | S1–S5 已实现；当前无 `recharts` 直接依赖 | 先做依赖、bundle、无障碍 PoC；若批准，只向 Native Host 暴露一个有界 `Chart` 深模块并懒加载 | **`result=not-adopted` 且零产品代码是合格结果** |
| P3.6 partial/streaming | OpenCode core 有进度设计先例，但生产 SessionProcessor 不发布，OpenChamber 不消费 | 先在 OpenCode 建立完整、单调、可重放的 ToolPart progress snapshot；OpenChamber 只消费完整 snapshot | 保持 spinner → final；禁止解析 raw/delta/半截 JSON |

### 0.1 推荐的总体顺序

```text
P1 证据收口
  → P2 实现与验收冻结
    → 用户逐项授权 P3
      ├─ P3.1 Local Data Runtime
      │    └─ 可被后续 Server 开发体验复用
      ├─ P3.2 Dev Hosted CLI MVP
      ├─ P3.3 Shell current-state audit → 纵向切片
      ├─ P3.4 先重跑基线 → 未触发则结束；触发才实现 scorer
      ├─ P3.5 先 PoC → 未通过/未批准则结束；批准才引入依赖
      └─ P3.6 先 OpenCode authority → SDK → OpenChamber consumer
```

P3.1 与 P3.2 在概念上相关但不是同一个 runtime：Dev Hosted 解决“开发期怎样安全提供签名资源”，LDR 解决“本地业务数据和固定 server handler 跑在哪里”。P3.3 不应把两者的 endpoint、key 或连接状态塞进 Shell 自建存储；Shell 只链接现有 Extension Manager / Connection 配置入口。

### 0.2 实施原则

1. **深模块优先**：调用方只看到稳定、小接口；路径校验、锁、revision、限额、清理和降级留在模块内部。
2. **替换，不叠兼容层**：新路径正式启用后，移除同一职责的临时实现；但明确的 capability fallback、final-only fallback 和 Phase 3 routing fallback 是产品合同，不是历史包袱。
3. **失败不等于空数据**：不可用、未配置、迁移失败、stream 无效必须有显式状态，不得渲染成“0 条记录”或“已完成”。
4. **服务端持有权威**：数据库、secret、业务 endpoint、签名私钥、路由 examples、progress revision 都不得由 UI 充当权威。
5. **不先加依赖**：P3.1 推荐零新增 runtime dependency；Hono、Recharts 或任何新包都必须先有真实消费者、通过依赖门并取得用户明确许可。
6. **不主动发布**：Agent 可完成本地代码、测试和 release handoff；commit、push、GitHub workflow、包发布和更新 managed pin 需用户单独授权。

---

## 1. 优先级、授权门与停止条件

### 1.1 Roadmap 优先级

- P3 当前整体是“需用户再授权开工”；本文件完成后不能把 P3.1–P3.4 改成进行中，也不能把 P3.5–P3.6 从 `later` 提前。
- 当前允许的工作仅是设计、代码事实核实、依赖评审、测试方案与文档回写。
- 用户授权一个 P3 ID，不自动授权其余 ID。例如授权 P3.1 不等于授权 P3.2 或 Hono 安装；授权 P3.5 PoC 不等于授权把 Recharts 加入产品。
- 任何实施 Agent 开工前都要先在 `roadmap.md` 看到该项被用户明确启动，并在交接中记录授权范围。

### 1.2 六类独立授权

| 授权 | 允许 | 不允许自动推导 |
|------|------|----------------|
| 产品实现授权 | 修改指定 P3 ID 的产品代码和测试 | 新依赖、跨仓发布、外部服务、其他 P3 ID |
| 依赖授权 | 在指定包中声明并锁定指定依赖 | 发布、换库、把传递依赖当直接依赖 |
| OpenCode/SDK 本地实现授权（P3.6 Gate O0） | 只修改获批的 `opencode/` authority-enablement文件并生成未发布 CLI/SDK artifact；OpenChamber保持零写入 | commit、push、release、任何OpenChamber pin/alias/lock或consumer/compat代码变更 |
| 发布授权 | 对已通过 final-revision review 的明确 OpenCode revision 执行列出的 commit/push/CLI+SDK release，并交付 version/revision/provenance handoff | OpenChamber managed pin、consumer 文件、合入 moving `upstream/dev`、改发布策略、顺带发其他包 |
| Managed pin 授权 | **发布成功后**由 OpenChamber pin owner 更新列出的 CLI/SDK aliases、lock 与 packaged provenance，并证明都指向同一已发布 revision | OpenCode 再发布、OpenChamber consumer/reducer/UI 实现、其他依赖升级 |
| Consumer 范围授权 | pin/provenance 验证通过后，修改用户明确列出的 OpenChamber capability/reducer/UI/acceptance 文件 | release、pin、其他 P3 ID 或未列文件 |

### 1.3 每项开始门

| ID | 硬开始门 |
|----|----------|
| P3.1 | P1/P2 排期允许；用户点名 P3.1；确认冻结的 direct Gateway adapter；manifest、Trusted Host Code 和数据删除语义冻结。Hono 不在本项可选范围 |
| P3.2 | 用户点名 P3.2；Remote R1–R3 基线通过；CLI 非交互/JSON 合同与开发私钥方案冻结；shared project-authority已存在或明确由本项首波实现 |
| P3.3 | 用户点名 P3.3；对当前 P0 后 UI 做 fresh audit；桌面/Web 与移动边界冻结；截图基线和唯一壳层 owner 确认；shared project-authority 已存在，或授权先执行本项0A/0B中立foundation + public-safe scope projection（不得顺带实现LDR/Dev Hosted） |
| P3.4 | **Gate 0评估开工**：P2完成且用户授权只改baseline runner/provenance并跑三次冷会话。**Phase 4产品开工**：同一HEAD同一routing命中/重复失败类别≥2/3重现并低于阈值，且用户再授权scorer；不得把Gate 0待生成报告当其自身前置 |
| P3.5 | **Gate A PoC开工**：用户授权可丢弃隔离实验、真实Native use case与依赖/尺寸/a11y数字门已预先冻结。**Gate B产品开工**：PoC通过且用户明确批准exact Recharts产品依赖与bounded Host API；不得把PoC结果当PoC自身前置 |
| P3.6 | **O0/OpenCode开工**：P2完成、用户只授权`opencode/` authority-enablement wave、自然多阶段的OpenCode **built-in internal** production Tool精确路径/ID已选、full-snapshot合同冻结。v1不承诺未发布fork plugin API。**C1 capability enablement**：O1/O2在handler仍为false时证明publisher/history/terminal、Tool≥2 snapshot与pre-enable SDK review；签字后才false→true并跑production tests。**Consumer开工**：final-revision CLI/SDK重生成与新鲜终审通过 → 用户获批且成功发布同revision CLI/SDK → managed pins获批更新并验证provenance → 另获OpenChamber consumer文件范围，四步全部满足后才开C1A/B/C2。不得把后续产物当O0前置 |

### 1.4 必须停下并升级给用户的条件

- 需要安装本文未批准的新依赖或改变包管理策略。
- 需要开放公网/局域网监听、降低签名校验、把 key 暴露给 UI、允许任意 SQL 或任意 Node module。
- 需要修改另一个 P3 项才能让当前项“顺便完整”。应拆成独立后续授权。
- 当前代码与本文 contract 冲突且会改变用户可观察行为；先提交差异报告，不自行改 contract。
- 测试只能靠跳过安全断言、放宽 corpus、修改 golden 掩盖回归或把失败写成空状态才能通过。
- 需要 commit、push、release、workflow mutation 或合入 moving upstream branch，但用户未授权。

### 1.5 条件项的合法结果注记

P3.4、P3.5、P3.6 不是“写了代码才算完成计划”。以下结论都可以是正式交付：

- `P3.4: not-triggered`：带 provenance 的 P2 后基线达到阈值，Phase 4 无产品改动。
- `P3.5: not-adopted`：PoC 显示 bundle/a11y/维护成本不合格，或用户不批准依赖。
- `P3.6: blocked-by-authority`：OpenCode 没有真实 publisher/replay/capability，UI 保持 final-only。

这些是 result/blocker 注记，不是 roadmap 状态列的新枚举。唯一合法 literal 是 `not-triggered`、`not-adopted`、`blocked-by-authority`；“no-code/零产品改动”只写成说明，绝不拼进 `result=` 值。未获授权前保持 `planned` / `later`；用户明确授权某个 ID 的 Gate evaluation/PoC/实现后，只把该 ID 改为 `in-progress`。用户确认 no-code 结案后，P3.4/P3.5 可将状态写为 `done` 并在备注附 `result=not-triggered` / `result=not-adopted` 与证据。`blocked-by-authority` 继续保持或回到 `planned` / `later`，不能写 `done`。所有结论都必须回写 roadmap，不能误写成“产品实现完成”。

---

## 2. 当前代码基线与禁止重做项

### 2.1 仓库边界

| 仓库 | P3 职责 | 禁止跨界 |
|------|----------|----------|
| `openchamber/` | Server/Gateway、OCIX 包和 Remote、共享 UI、Shell、验收、managed OpenCode distribution | 在该仓 Agent 内直接修改 `../opencode`；从 UI 绕过 server/SDK |
| `opencode/` | P3.6 Tool progress wire、生产 publisher、capability、SDK 生成与 fork invariant | 承担 LDR、Shell、OCIX Remote 或 UI renderer 职责 |

两个仓库必须分 Agent/分 wave 修改。跨仓只通过已冻结的 HTTP/SDK/schema 合同交接。

### 2.2 已有能力，禁止重做

| 已有能力 | 当前锚点 | P3 应怎样复用 |
|----------|----------|---------------|
| OCIX 签名包、安装、Host runtime | `packages/web/server/lib/interactive-ui/package-format.js`、`manager.js`、`runtime.js`、`routes.js` | P3.1 只扩 manifest/server handler；不造第二个扩展管理器 |
| Remote R1–R3 | `remote-ocix.js`、`remote-resource-cache.js`、connection/manager/routes 及测试 | P3.2 复用 Remote manifest、fingerprint、hash、re-consent；不放宽 dev 信任 |
| Business Gateway | Interactive UI server runtime/routes 与 UI client | LDR action 仍走同一 Gateway action route；UI 不直接碰 SQLite/Hono |
| Terminal v3 | `packages/web/server/lib/terminal/`、`packages/ui/src/components/terminal/TerminalViewport.tsx` | P3.3 只搬入口和状态宿主；不另开 WebSocket/PTY runtime |
| Files/Git/Browser/Workbench | 当前 layout、sidebar、view/store 组件 | Shell 做信息架构收敛，不复制业务实现 |
| Task Output Registry | `packages/ui/src/lib/taskOutputRegistry.ts`，已被 `Header.tsx` 使用 | 先审计和补合同，不创建第二份 registry |
| Routing Phase 0–3 | `interactive-ui/routing.js`、UI `routing.ts`、`opencode/client.ts`、Inspector | P3.4 scorer 只在证据触发后作为 server seam；保留 Phase 3 fallback |
| Style v2 S1–S5 | theme/token、Declarative primitives、Native UI Kit | P3.5 只评估 Native Chart；不重写 Style v2 |
| Declarative final renderer | `result.ts`、`generatedLayout.ts`、`InteractiveUIView.tsx`、`DeclarativeInteractiveView.tsx` | P3.6 复用 parser/sanitizer/renderer；不造第二套 layout schema |
| show-widget 流式预览 | generative-widget parser/renderer | 与 P3.6 无关；不得拿它证明 Tool progress 已有 |

### 2.3 依赖现状

- `better-sqlite3` 当前已是 `packages/web/package.json` 与 `packages/electron/package.json` 的直接依赖，Electron 打包链已有 native rebuild/stage 责任。P3.1 仍要验证 ABI、packaged app 和数据库关闭，但不应重复引入另一 SQLite 库。
- Hono 当前只在 `bun.lock` 中作为传递依赖出现。审计未发现第二个 transport consumer，P3.1 MVP 不使用它。未来只有真实第二 consumer 出现后，才可另立 ADR/roadmap slice/依赖评审并重新获用户授权；不能在 P3.1 prompt 中临时改选。
- 当前没有 `recharts` 直接依赖。P3.5 PoC 要在隔离分支/临时资产完成；只有 Gate B 获批才修改 `packages/ui/package.json` 和 `bun.lock`。
- P3.4 首版不得新增 embedding、向量库、tokenizer 或第二模型依赖。
- P3.6 应只扩既有 schema/SDK，不引入第二条流协议或 AI SDK UI runtime。

### 2.4 当前报告不能被误用

`.tmp/interactive-ui-model-routing/report.json` 是 2026-07-24 的旧本地结果：Qwen3.7 Plus 在 17 条用例上 17/17，三个 accuracy 为 1、duplicate 为 0、`complete=true`。它证明“当前没有证据启动 Phase 4”，但因为缺少 OpenChamber/OpenCode commit、SDK、corpus digest、catalog revision，且早于 P2，不能作为未来关闭或启动 P3.4 的最终证据。

### 2.5 开工前基线清单

每个 Agent 都要在 handoff 中回答：

1. 读取了哪个 `AGENTS.md`、skill、邻近 `DOCUMENTATION.md`；
2. 当前 roadmap 状态和用户授权文字是什么；
3. 当前目标符号/调用链是什么，哪些已有能力不会重做；
4. 工作树中已有的用户修改有哪些，如何避免覆盖；
5. 先跑了哪些 focused tests，结果如何；
6. 哪些文件归自己，哪些共享文件只提交 patch 建议给 final integrator。

---

## 3. 统一术语、产品不变量与模块边界

### 3.1 术语

| 术语 | 精确定义 |
|------|----------|
| Local Data Runtime / LDR | OpenChamber server **同进程**内的本地 SQLite + 固定 handler 执行底座；不是远程服务、不是 UI 内数据库 |
| Remote Hosted | 第三方通过 URL + key + 签名 manifest/resource 交付的现有能力 |
| Dev Hosted | 开发者在本机用 CLI 暴露 **签名、不可变、allowlisted** OCIX release snapshot；产品使用独立 project-bound `dev-hosted` source profile，并复用 Hosted 验签 kernel，**不经过 Remote URL+Key 流程** |
| Server handler | 已安装且受信 OCIX 包中、由 manifest 点名的固定 server module；不是任意脚本输入 |
| Shell | 对现有导航、任务 header、输出和右 workspace 的信息架构编排；不是新 runtime |
| Routing scorer | 条件触发的确定性候选预筛模块；只生成更小的系统上下文，不执行 Tool、不关闭 Tool |
| Native Chart | Host-owned、bounded、可懒加载的单一图表组件；不是向扩展暴露全部 Recharts API |
| Tool progress snapshot | OpenCode server 生成 revision、包含完整结构化对象、可重放的 ToolPart 状态；不是字符 delta 或半截 JSON |

### 3.2 全局不变量

1. UI 通过 `RuntimeAPIs` / `runtimeFetch` 或正式 OpenCode SDK 访问能力，不能硬编码 loopback URL。
2. Secret、access key、dev signing private key、业务 endpoint 的权威存储留在 server/Secret Store；Shell/localStorage/OCIX View 不保存明文。
3. LDR 数据属于当前 **OpenChamber server data realm**，按 `canonical projectKey × extension owner` 隔离；OpenCode runtime不是DB identity。任何 ID 先校验和规范化，不能直接拼文件路径。
4. Dev Hosted 仍须签名、hash、fingerprint、permission/re-consent；“dev”不等于 trust bypass。
5. Shell 复用 Terminal/Git/Files/Browser/Workbench 单一 runtime 和 store；关闭 tab 不等于销毁资源，除非现有业务语义如此定义。
6. Routing scorer 不执行 Tool、不修改权限、不屏蔽 OpenCode Tool registry；失败时回退 Phase 3 并继续发送用户消息。
7. Native Chart 不接受任意 JSX、render function、className/style、HTML、URL 或网络 callback。
8. Partial UI 不解析 `pending.raw`、`tool-input-delta`、字符串 patch 或截断 JSON；只接收权威 full snapshot。
9. completed/error terminal 状态永远胜过晚到 running；completed final output 永远是成功态唯一权威。
10. Web/Electron/VS Code/Mobile 的 unsupported/fallback 必须显式，不把 runtime 缺失伪装为空结果。

### 3.3 深模块边界

| 深模块 | 小接口 | 内部隐藏的复杂性 |
|--------|--------|------------------|
| `LocalDataRuntime` | `invoke({authority, project, action, input, requestId})` | DB path、open/close、WAL、migration、队列、handler import、transaction、审计 |
| `DevHostedServer` | `start(config) / rebuild() / close()` | watcher、release snapshot、签名、hash、allowlist、atomic manifest switch、端口清理 |
| `TaskWorkspaceShell` | 当前 route/session/project + panel state | 响应式布局、宽度、tabs、focus、持久化、既有 runtime adapter |
| `RoutingDecision` | `resolve(text)` | normalization、examples、稳定排序、ambiguity、catalog revision、redaction |
| `NativeChart` | bounded props | Recharts imports、theme tokens、a11y、responsive sizing、tooltip、reduced motion |
| `InteractiveToolFrame` | ToolPart + capability + previous → phase/envelope | revision、terminal guard、schema/sanitizer、安全范围、history replay |

不要把这些内部参数逐层暴露给所有调用方。例如调用 LDR action 的 UI 不应知道 DB 文件名、migration 版本或 Hono route；Native extension 不应知道 Recharts component 名称；ToolPart 不应知道 progress 限流算法。

---

## 4. 总体架构与实施顺序

### 4.1 三条互不替代的服务路径

```text
Installed OCIX + Local Data
UI action → OpenChamber Gateway → LocalDataRuntime → fixed handler → SQLite

Remote / Dev Hosted UI resources
Extension Manager → signed remote manifest → lazy signed resource → existing Host
                               └→ business action 仍走独立 Gateway/remote connector

OpenCode Tool progress
internal ToolProgress.publish → full ToolPart snapshot → SDK/SSE/history → OpenChamber frame resolver → existing Declarative renderer
```

Dev Hosted 不代理 LDR，LDR 不负责 UI 资源分发，Tool progress 也不取代 OCIX action transport。

### 4.2 建议波次

| 波次 | 目标 | 允许并行 | 退出条件 |
|------|------|----------|----------|
| 0 | 授权、fresh audit、合同冻结、基线 | 只读审计可并行 | 每项有 owner、文件清单、测试基线、依赖结论 |
| 1 | 纯深模块/纯函数 | LDR contract/db；Dev Hosted snapshot builder；Shell state；条件项 PoC | unit tests 全绿，无宿主接线 |
| 2 | Server/runtime 接线 | P3.1 与 P3.2 不抢同一文件时可并行；P3.3 UI 另线 | 路由/生命周期/错误语义通过 |
| 3 | UI/CLI surface | Shell 与 LDR client adapter 可按文件隔离 | shared UI、non-TTY、i18n、a11y 通过 |
| 4 | 真实/packaged/browser acceptance | 不与核心代码并发写 | 报告完整、cleanup 成功、无敏感数据 |
| 5 | 文档/roadmap/release handoff | 单一 final integrator | 状态真实；未授权发布动作未执行 |

### 4.3 文件状态标记

本文统一用：

- **A**：计划新增；
- **M**：计划修改；
- **V**：只验证/冻结，正常实现不应修改；
- **R**：确认被替代后移除。没有证据时不得擅自删除。

### 4.4 P3.1 / P3.2 / P3.3 共用的 project-authority 前置

P3.1 与 P3.2 需要 project-bound action/source authority；P3.3 需要能区分“同一路径旧worktree”和“删除后重建的新worktree”的server-owned scope incarnation。当前 `project-directory-runtime.js` 只有 decode/exists/realpath，不是 known-project resolver。三项不得各造一套，也不得让后启动项暗中依赖未授权产品功能。冻结一个共享中立基础层：

```text
packages/web/server/lib/interactive-ui/project-authority.js
packages/web/server/lib/interactive-ui/project-inventory.js
packages/web/server/lib/interactive-ui/project-incarnations.js
packages/web/server/lib/interactive-ui/host-runtime.js
```

authority接口由 server 注入 configured settings roots、`project-inventory.js` 的 strict typed inventory 与可选 session lookup，返回 §5.6 的 canonical scope/projectKey/incarnation；客户端 directory/projectId只能作hint。`project-inventory.js` 是 Git/plain-directory 的唯一分类边界；现有 `git/service.js::getWorktrees` 只是容错的 UI 列表接口，**不得**作为 authority。`host-runtime.js` 是唯一production composition root，把同一authority注入Manager/Gateway及当前已授权的LDR或Dev Hosted adapter，并返回disposable scope；`feature-routes-runtime.js` 不再各自手拼这些对象。

第一个被授权项目必须串行分两次唯一ownership handoff：`project_authority_owner` 先独占 `project-authority.js`、`project-inventory.js`、`project-incarnations.js`、strict Git adapter与tests并冻结factory interface；其完成后，该项目的server composition owner（P3.1=`ldr_lifecycle_worker`，P3.2=`dev_hosted_server_authority_owner`，P3.3=`shell_scope_server_owner`）才独占 `host-runtime.js`/`feature-routes-runtime.js`与tests接线。若P3.2或P3.3先做，不得顺带创建LDR/SQLite或Dev Hosted source。后续项目沿用相同两角色边界，只按需M/V，禁止复制normalizer/ledger/composition或并行改这两组文件。

这不是独立 P3.0 产品能力或新roadmap状态。除下面P3.3所需的一个authenticated、read-only、public-safe projection外，它没有公开route；LDR/Dev Hosted仍只通过自己的action/source/lease route消费private authority。shared owner完成前，P3.1/P3.2的server接线或P3.3 workspace持久化wave都不得开始。

#### 4.4.1 P3.3 public-safe scope projection

P3.3只得到不可反推projectKey/incarnation/path stat的opaque identity，不取得任何private authority：

```http
GET /api/interactive-ui/project-authority/scope
X-OpenCode-Directory: <runtime adapter supplied exact directory>
Cache-Control: no-store
```

```ts
type WorkspaceScopeAuthorityV1 = {
  apiVersion: 1
  scopeDirectory: string
  scopeKind: "project" | "worktree" | "plain-project"
  scopeInstanceId: `s1_${string}`
}
```

server必须fresh调用同一个`ProjectScopeAuthority`；`scopeInstanceId = 's1_' + base64url(sha256('oc-shell-scope-v1\0' + projectKey))`，因此同一真实scope跨server/UI重启稳定、同路径删除重建后必然旋转。response不得含`projectKey`、incarnationId、Git admin path/stat、authority revision或配置列表。route使用既有runtime auth、无body/exact header、只接受known configured root/worktree/plain root或server-owned session containment；missing/malformed header=400 `project_authority_request_invalid`，没有受支持owner=422 `project_authority_identity_unsupported`，strict inventory不可用=503 `project_authority_inventory_unavailable`，ledger损坏/权限失败=503 `project_authority_store_unavailable`，ledger到cap=503 `project_authority_capacity`。不得把UI的projectId/path hash当fallback identity。

如果server以明确422 `project_authority_identity_unsupported`证明当前directory没有可持久authority，且该UI activation没有先前bound identity，UI只能建立`scopeKind:'directory-fallback'`、`scopeInstanceId:'ephemeral_'+crypto.randomUUID()`的**内存态**workspace：同一`runtimeKey + normalizedDirectory + activationEpoch`重复focus/pageshow复用同一个ephemeral ID，切换directory/runtime或dispose才旋转；不写durable workspace、不得恢复Terminal/Browser backend identity。它不是route response，也不能被客户端提交回server升级为authority。若先前是server-bound而后来明确422，必须先tombstone/close旧identity，再开启全新的ephemeral workspace，不能保留旧resource ID。

UI每次owner/topology revision变化、focus/pageshow恢复和restore前重新取projection，并使用显式状态机：`resolving | bound | suspended | ephemeral`。已bound scope遇到network error、abort以外transport failure、503 inventory/store/capacity时进入`suspended`：立即禁止create/attach并detach live backends，保留只读presentation/old identity供诊断，但不恢复resource、不生成ephemeral、不改durable key；只有fresh success返回**同一个**ID才resume，fresh success返回不同ID则discard旧资源。相同`scopeDirectory`返回不同`scopeInstanceId`，或权威422终止旧binding时，先停止create/attach，tombstone旧workspace key并调用每个live adapter close/detach；close失败仍禁止旧Terminal/Browser重新attach，只交现有backend idle cleanup。随后以新bound identity或全新ephemeral identity创建空workspace，绝不把旧资源ID迁入。该转换必须是单一reducer transaction，并覆盖请求乱序/abort/runtime switch；abort/stale response保持当前状态，不能把旧response当fresh成功。

### 4.5 P3.1 / P3.2 共用的 Workbench project authority

Workbench board目前由client提交tile draft，不能作为project authority。第一个获授权的project-bound ID必须把board升级为v2，并由server持久以下**private、不可公开patch**的基础字段；P3.2只在其上增加可选Dev Hosted marker：

```ts
type WorkbenchTilePrivateProjectAuthorityV2 = {
  $schema: "openchamber://workbench-tile-private-project-authority/v2"
  projectIncarnationRef: string // 指向shared ledger record的server opaque reference
}
```

基础合同对P3.1/P3.2相同：

1. `workbench-store.js`是唯一private normalizer/writer；public create/patch/migrate/duplicate出现上述字段或嵌套同名字段一律400。对外board projection只返回`authorityStatus:'bound'|'rebind-required'|'not-required'`。
2. 新tile或显式rebind route先fresh resolve exact directory→取得incarnation ref→在manager-scoped transaction内与tile原子持久。v1 tile迁移保留layout/context/origin但private authority为空；project-bound action必须提示显式rebind，不能猜全局current project。
3. 对话surface继续用`X-OpenCode-Directory`；Workbench/独立Popout只传public `{projectId,tileId}`，server查private authority并fresh revalidate。若同时收到directory header，必须与tile incarnation一致，否则统一project mismatch。
4. LDR action由该private project ref解析projectKey；P3.2 acquire/action再解析可选Dev marker。client拿不到projectKey/incarnation/path，不能把public projectId升级成authority。
5. Popout URL、opener message、localStorage不得包含directory/private authority。`packages/web/src/workbench-popout.tsx`必须通过board route bootstrap；P3.1只需project-bound action，P3.2再按§6.8.2/B.4增加每window lease。

P3.1最小wire不另建通用authority endpoint：既有`POST /api/interactive-ui/workbench/boards/:projectId/tiles`要求exact directory header，server在创建tile的同一transaction写private project ref；新增`POST /api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/rebind`，body固定`{apiVersion:1}`且同样要求header/fresh authority，成功只返回public tile。`GET .../boards/:projectId`只返回public projection。所有action仍走现有`POST /api/interactive-ui/actions/:actionId`并带`workbench:{projectId,tileId}`；server从private tile恢复authority。unknown keys/private fields=400 `workbench_private_authority_forbidden`，legacy/unbound=409 `workbench_project_rebind_required`，header/tile mismatch=409 `local_data_project_mismatch`，unknown tile/project统一404。P3.2只给create/rebind增加顶层`bindingHint`并叠加附录B.4 lease，不得改写这组基础语义。

文件、测试和owner见§11.1/§11.2、§13.1/§13.2、§15.2/§15.3；两个P3 ID不得各建一套board private state。

---

## 5. P3.1：Local Data Runtime

### 5.1 目标结果

让已签名安装的 Trusted OCIX 扩展可以声明少量固定 server handlers，并在 OpenChamber server 同进程内使用 project-scoped SQLite 数据。用户可在对话 View 或 Workbench 中读写本地业务数据，而 UI 永远不获得数据库路径、SQL 能力或本地 loopback key。

### 5.2 非目标

- 不开放通用 SQL HTTP API，不接受 UI/模型传入 SQL、migration 或 module path。
- 不给 Remote Hosted 包执行本地 server code 的权限。
- 不引入 Hono：P3.1 MVP 由现有 Gateway 直接调用 in-process `LocalDataRuntime.invoke()`。未来 transport ADR 不属于本蓝图的 P3.1 实施范围。
- 不构建 ORM、schema designer、数据库浏览器、同步引擎、云备份、多进程写入或 arbitrary cron。
- 不把同步 `better-sqlite3` 包装成虚假“可中断 timeout”；超时只能用于排队/总请求分类，不能杀死已经进入 native 同步调用的 SQL。
- 不在 P3.1 顺带实现 Dev Hosted watcher、Shell UI 或 Marketplace server review。

### 5.3 当前调用链与目标调用链

当前 action 链大致为：

```text
Interactive View / Native host
  → packages/ui/src/lib/interactive-ui/client.ts
  → runtimeFetch(action route)
  → packages/web/server/lib/interactive-ui/routes.js
  → runtime.js / manager.js / connector dispatch
  → business connector
```

目标只在 server dispatch 中增加一个明确分支：

```text
validated action request
  → resolve installed extension + granted permissions
  → connector.type === "local-data"
  → LocalDataRuntime.invoke
      → resolve opaque project scope
      → open/get DatabaseContext
      → ensure ordered migrations
      → load manifest-named fixed handler
      → handler({ db, input, context })
  → standard action result / typed error
```

UI action route、confirmation、revision/idempotency/audit 语义继续由现有 Gateway 拥有。

### 5.4 建议目录与职责

新增目录：`packages/web/server/lib/interactive-ui/local-data/`

| 文件 | 职责 | 禁止放入 |
|------|------|----------|
| `contract.js` | 解析/规范化 `localData` manifest、migration/handler descriptor、limits | DB I/O、dynamic import、HTTP response |
| `database.js` | 解析安全 DB path、打开/配置/关闭 better-sqlite3、per-DB queue、transaction wrapper | manifest 权限、UI payload、Hono |
| `migrations.js` | hash/顺序/ledger、事务执行、失败标记 | 自动回滚到旧 schema、用户 SQL |
| `module-loader.js` | 从 verified installed root 加载 manifest 点名 module，校验 realpath/hash/cache | 任意路径 import、Remote URL import |
| `runtime.js` | `LocalDataRuntime` facade、lifecycle、limits、typed errors | UI rendering、extension installation |
| `*.test.js` | 每层确定性 unit/contract tests | 真实用户数据、网络依赖 |

当前审计结论已经是：MVP 只有一个内部 `invoke()`，Hono 会在 Gateway 后再叠一层路由而没有第二消费者。P3.1 冻结为 direct adapter；本项不得新增 `hono-app.js`、import Hono 或调用 `serve()`。

### 5.5 Manifest 合同

v1 `localData` 分支冻结为以下 versioned、discriminated contract；省略的只是现有 extension 通用字段，下面出现的 connector/localData/action字段与类型不是伪代码：

```json
{
  "$schema": "openchamber://extension/v1",
  "connectors": [
    {
      "id": "local-data",
      "type": "local-data",
      "scope": "project"
    }
  ],
  "localData": {
    "apiVersion": 1,
    "entry": "server/dist/index.mjs",
    "migrations": [
      {
        "id": "001_init",
        "path": "server/migrations/001_init.sql"
      }
    ]
  },
  "actions": [
    {
      "id": "com.acme.orders.orders.list",
      "connector": "local-data",
      "risk": "read",
      "permission": "allow",
      "localData": {
        "handler": "orders.list"
      }
    }
  ]
}
```

冻结规则：

1. `localData.apiVersion` 首版只接受整数 `1`；未知版本安装失败。
2. entry、migration path、handler/action id 使用现有 OCIX 路径/ID 规则；不得含路径穿越、URL 编码逃逸或控制字符。
3. 一个 action 的 handler 名只能来自 manifest；UI 请求不能覆盖 handler/entry/migration/DB。
4. migration 使用 manifest 明确顺序和稳定唯一 id，不依赖目录 glob；entry/migration 原始 bytes 必须属于已验签包 index，并以该 index digest 为 authority。
5. server module 只允许 Local full package；Hosted/Remote manifest 出现 `localData` 或 server resources 必须被 package/runtime 拒绝。
6. package review/权限摘要从 entry 自动派生 `hostCode: true`；该能力属于 admin-trusted，不得依赖扩展自报“可信”，也不得用窄 db API 伪装成安全沙箱。
7. `risk: write|destructive` 与 `permission: ask` 继续触发现有 confirmation、revision/audit；handler 不得绕过 action policy。
8. `idempotent` 不进入 v1：当前 Gateway 不自动 retry；若未来增加，必须同时实现 project/extension/action/input 绑定的 ledger。

### 5.6 Action request 与 project authority

当前 `InteractiveActionRequestBase` 已有 `extensionId`、`instanceId`、`action`、`input`、可选 `tool` 和可选 `workbench:{projectId,tileId}`。`ToolPart` 已经知道 `projectDirectory`，但尚未一路传给 `InteractiveUIView`/action client。现有 `project-directory-runtime.js` 只做 decode/exists/isDirectory/realpath，**不是 known-project authority**；P3.1 必须在其上新增显式 registry，不能只把函数改名为 `resolveKnownProjectDirectory`。

冻结的 server-owned authority sources：

1. **configured project root**：只来自 OpenChamber server 已持久化 settings 中经 `sanitizeProjects` 接受的 project entry；客户端 header/body 不能注册新 root。
2. **strict inventory**：新增 `project-inventory.js::inspectConfiguredProjectRoot()`。若 configured root 自身存在 `.git` file/directory，必须调用 `git/service.js` 新增的 strict `inspectRepositoryAuthority()`；成功结果要包含 primary root、common Git admin dir、repository identity 和每个 worktree 的 top-level/Git-dir identity。该函数不得 catch→`[]`、不得把 timeout/permission/corrupt/missing-git 伪装成“不是仓库”。只有明确 `kind:'not-repository'` 才进入 plain-directory 分支；其他失败统一 fail closed，且不得修改 incarnation ledger。
3. **worktree scope**：只来自上述 strict Git success inventory；逐项 realpath并验证common Git admin/repository identity。configured entry本身可以是primary root，也可以是用户已加入Projects的linked worktree：若是primary，授权该primary与inventory中属于它的linked worktrees；若是linked，**只授权该configured linked worktree本身**，不得顺带授权未配置的primary或siblings。primary+linked同时作为两个configured entries时按longest/exact configured owner解析，exact linked entry优先，但同一canonical scope/incarnation仍得到同一projectKey；移除一项不会越过仍存在的另一项。现有 `getWorktrees()` 继续服务 UI 容错列表，不返回足够的 owner identity，不能作为 authority，也不得从 UI `/api/git/worktrees` response 或 `availableWorktreesByProject` 回写 authority。
4. **plain configured root**：`sanitizeProjects` 允许普通目录，因此它是正式支持分支，而不是 Git 失败 fallback。只授权 configured root 本身及其普通子目录，不枚举父仓库/worktree；必须取得 canonical realpath、no-follow `dev`/`ino` 与可靠非零 birth identity。目标文件系统无法给出可靠 creation identity 时返回 `project_authority_identity_unsupported`，绝不降级 path-only。
5. **session directory**：若 action 携带现有 server-verifiable session identity，server 从同一 OpenCode runtime 读取该 session 的 directory/worktree；它只能落在上述 root/worktree/plain configured root 的 canonical containment 内，且不会把新目录写进 registry。
6. **普通子目录**：realpath 后可映射到“最长 canonical root/worktree/plain owner”，但最终 `scopeDirectory` 永远是 owner root/worktree，不用任意子目录生成新 DB。
7. **失效**：只有一次**成功** fresh inventory 明确证明 configured project已从settings移除、worktree缺项或owner/identity变化，才拒绝新action并tombstone旧incarnation；Git/FS/session inventory暂时失败只返回typed unavailable，保留ledger/pool/source原状。关闭connection不删除数据。

低级Agent必须实现并测试以下discriminated result，不能用`[]`或`null`同时表示plain root、无worktree和失败：

```ts
type ProjectInventoryResult =
  | {
      status: "ok"
      kind: "git"
      configuredRoot: string
      configuredRootRole: "primary" | "linked-worktree"
      primaryRoot: string
      commonGitDir: string
      repositoryIdentity: string
      scopes: Array<{ kind: "project" | "worktree"; path: string; gitDir: string; worktreeIdentity: string; observedIdentity: string }>
    }
  | {
      status: "ok"
      kind: "plain"
      configuredRoot: string
      scopes: [{ kind: "plain-project"; path: string; observedIdentity: string }]
    }
  | {
      status: "failed"
      code: "project_authority_inventory_unavailable" | "project_authority_identity_unsupported"
    }
```

`repositoryIdentity`/`worktreeIdentity`/`observedIdentity`是server canonical digest，不进入public API。`project-inventory.js`先no-follow检查configured root自己的`.git` entry：不存在才允许plain identity分支；存在时`inspectRepositoryAuthority()`任何non-success都映射`status:'failed'`，不得把损坏仓库降级成plain。Git success必须通过top-level/common-dir/git-dir关系判定`configuredRootRole`；linked configured root不是错误，也不能被重写成primary。strict Git subprocess必须固定locale/timeout/output cap并保留typed exit分类，但production error/message不回传stderr/path。

`ProjectScopeAuthority` 的最小输出必须是 `{ authorityRevision, configuredProjectId, projectRoot, scopeDirectory, scopeInstanceIdentity, kind:'project'|'worktree'|'plain-project' }`。`scopeInstanceIdentity` 不是直接拼 `dev/ino/ctime`，而是 server data-dir 内持久 `scope-incarnations.v1.json` ledger分配的随机128-bit `incarnationId`。Git record key使用 canonical scope path hash + common Git admin path hash，保存scope/Git admin no-follow stable stat tuple与strict inventory返回的repository/worktree identity；plain record key使用canonical configured-root path hash + literal `plain-v1`，保存可靠的root creation tuple。两种record都必须记录 `inventoryKind`，Git↔plain变化视为owner transition，不能沿用nonce。

首次见到合法scope时原子写入新nonce；正常文件内容/mtime/ctime变化、普通server restart或untrack/re-track同一个仍存在scope都复用nonce。一次成功 fresh inventory发现scope/Git admin消失、stable creation tuple改变、inventory kind变化或worktree owner改变时，先tombstone旧record/关闭pool，再为重新验证的新scope生成新nonce；绝不能以path-only fallback继续。inventory失败时不得tombstone、不得生成替代nonce。

ledger使用0600与同目录atomic rename，最多4096 records/4 MiB。只有tombstone超过90天、且没有LDR DB、Workbench private tile authority或Dev Hosted source/lease引用时才能按oldest-first清理；active或仍被任何产品状态引用的record永不静默淘汰。到cap仍无安全候选时，新scope解析fail closed `project_authority_capacity`，现有scope继续工作。损坏/权限失败必须 `project_authority_store_unavailable`；strict Git/FS inventory失败用 `project_authority_inventory_unavailable`；缺少可靠plain creation identity用 `project_authority_identity_unsupported`。四个code由调用方映射为本功能UI错误，ledger/inventory细节不进入API/log。

`projectKey = base64url(sha256('oc-project-scope-v1\0' + scopeDirectory + '\0' + incarnationId))`；这是P3.1/P3.2的private中立scope ABI，P3.3只消费§4.4.1由它单向派生的public-safe `scopeInstanceId`，三者都不以LDR或Dev Hosted命名。OpenChamber data root 本身隔离不同 server，不能加入会在重启时变化的 process/runtime ID。旧 scope 被删除后其 DB/source原位保留为旧 key，新 scope 即使同路径也取得新 key，不能自动接管；显式恢复/接管若未来需要必须另立用户确认流程。

目标链：

```text
ToolPart / Workbench / Artifact
  → runtimeFetch with X-OpenCode-Directory
  → route exact-key decoder rejects any client __projectAuthorization/private/unknown field with 400
  → resolveOptionalProjectDirectory (syntax/realpath only)
  → ProjectInventory.inspect(configured roots + strict Git/plain identity)
  → ProjectScopeAuthority.resolve(successful inventory + server session)
  → canonical containment + longest owner
  → scope-incarnation ledger verifies/assigns incarnationId
  → projectKey = sha256(version tag + canonical scopeDirectory + incarnationId)
  → inject server-only __projectAuthorization
  → confirmation + LocalDataRuntime.invoke
```

规则：

- `projectDirectory` 通过现有 runtime-aware header 传输，不新增 body 中的 raw filesystem authority；UI 仍可带 `workbench.projectId` 作一致性 hint。
- server 必须 realpath 并验证它属于当前 server registry 的 configured project/worktree；不能仅检查字符串前缀、exists，不能信 UI worktree cache。
- 若 `workbench.projectId` 映射的 canonical directory 与 header 不一致，返回 `local_data_project_mismatch`。
- LDR action 缺少/未知 project 时 fail closed；不能回退全局 DB、process cwd 或“最近项目”。
- DB path 使用 opaque `projectKey`，绝不使用显示名/raw path；API/report/log 不返回 canonical path。
- confirmation fingerprint/token 必须绑定 `projectKey`，防止在项目 A 获取 challenge 后换 header 写项目 B。
- 会话切 project、runtime 切换、relay 转发后都由同一 resolver 重新建立 authority；不信任客户端隐藏字段。切换OpenCode runtime时关闭当前connection lease并重取session/worktree authority；若仍由同一个OpenChamber server、同一scope incarnation处理，则重新打开同一个project DB，不创建runtime副本。切到另一OpenChamber server时由其独立data root自然隔离。
- inventory候选列表可以使用短 TTL，但每个action都捕获 `{authorityRevision, inventoryKind, incarnationId, observedIdentity}` token。缓存命中仍须在dispatch前no-follow stat；**每个read也必须在handler返回后做fresh strict inventory + identity post-check，变化时丢弃结果、关闭旧scope connection并返回 `local_data_project_stale`**，绝不能把旧DB行交给同路径新项目。write/destructive、owner transition 和 explicit purge 在dispatch前后都用fresh strict inventory；inventory故障返回 `project_authority_inventory_unavailable`且不tombstone，只有成功证明变化才tombstone。
- 负例/边界必须包含：存在但未配置目录、Git inventory timeout/corrupt与成功missing的区分、configured primary授权其linked worktrees、**configured linked root单独合法但不授权primary/sibling**、primary+linked双配置时exact/longest owner且projectKey一致、plain configured root/child、plain FS identity unsupported、删除后同路径重建的plain root/worktree、read执行中并发重建且旧结果被丢弃、symlink alias/escape、nested configured roots最长匹配、session/runtime不一致、relay header spoof；任一暂时inventory失败都不得旋转nonce或改变ledger。

### 5.7 Trusted Host Code 与 DatabaseContext 合同

v1 entry 是安装前构建好的单文件 ESM，不在运行时编译 TypeScript、扫描 `server/node_modules`、自动安装依赖或加载扩展自带 native addon：

```js
export default {
  apiVersion: 1,
  actions: {
    "orders.list": ({ input, db, now, requestId }) => ({
      items: db.all(
        "SELECT id, title, status FROM orders WHERE status = ? LIMIT ?",
        [input.status, input.limit],
      ),
    }),
  },
}
```

首版 handler 必须同步；返回 Promise 拒绝为 `local_data_async_handler_unsupported`。这是因为 `better-sqlite3` 与 transaction callback 是同步的，假异步 timeout 不能抢占同步 SQL/死循环。

入口必须从已验证 package bytes/no-follow bounded open 加载，并以 installation generation + digest 作为 module cache identity；不能先 hash path、再让攻击者换父目录后 dynamic import。

同进程任意 ESM **不是安全沙箱**：签名 handler 仍可能自行 import Node API。项目/扩展分库和窄 facade 只提供正确性隔离与误用防护。如果产品要求对恶意代码的硬隔离，必须另立 out-of-process 或 declarative-only roadmap；worker thread 也不是安全边界。

建议 facade：

```ts
type LocalDataInvocation = {
  authority: ExtensionAuthority
  project: { key: string; directory: string }
  action: { id: string; handler: string; risk: "read" | "write" | "destructive" }
  input: unknown
  requestId: string
}

type LocalDataRuntime = {
  invoke(request: LocalDataInvocation): Promise<unknown>
  runExtensionTransition<T>(transition: ExtensionTransition, commit: () => Promise<T>): Promise<T>
  inspectData(selector: LocalDataSelector): Promise<LocalDataImpact>
  purgeData(command: LocalDataPurgeCommand): Promise<LocalDataPurgeResult>
  dispose(): Promise<void>
}

type LocalDataSelector =
  | { scope: "extension"; extensionId: string }
  | { scope: "project" }

type LocalDataImpact = {
  operationId: string
  authorityRevision: string
  selector: LocalDataSelector
  databases: Array<{ extensionId: string; ownerDisplayId: string; bytes: number; schemaVersion: number; state: "open" | "closed" | "blocked" }>
  totals: { databases: number; bytes: number }
  confirmation: { token: string; phrase: string; expiresAt: string }
}

type LocalDataPurgeCommand = {
  operationId: string
  confirmationToken: string
  confirmationPhrase: string
}

type LocalDataPurgeResult = {
  outcome: "moved-to-trash"
  databases: number
  bytes: number
  recoveryId: string
  auditId: string
}
```

内部数据库/connection key：`projectKey + extensionId`；publisher/key fingerprint 写入 `_ldr_meta` 并在重装/接管时核对。handler module cache identity 另用 `extensionId + active generation + entry digest`，不能因普通版本升级或OpenCode runtime切换创建新 DB。不要使用全局“当前项目”；多窗口可以同时访问多个项目。

pool/queue 常量首版冻结在 `database.js` 单源，不进manifest/config：

```ts
MAX_OPEN_CONTEXTS = 64
MAX_OPEN_CONTEXTS_PER_EXTENSION = 16
MAX_OPEN_CONTEXTS_PER_PROJECT = 16
MAX_QUEUED_INVOCATIONS_PER_CONTEXT = 64
MAX_QUEUED_INVOCATIONS_GLOBAL = 512
IDLE_CONTEXT_TTL_MS = 10 * 60_000
IDLE_SWEEP_INTERVAL_MS = 60_000
BUSY_TIMEOUT_MS = 2_000
```

每个invocation入队前取得context lease并在`finally`释放；migration、transition、inflight或queue非空都算active。新open先检查三项open caps：只可evict `leaseCount===0 && queue.length===0 && !transitioning` 且idle≥TTL的context，按`lastUsedAt`、再按opaque key稳定排序oldest-first；没有候选就返回retryable 503 `local_data_capacity`，绝不关闭live DB。queue达到per-context/global cap同样在执行前拒绝。sweeper用可注入clock、server scope唯一timer；shutdown先停止timer/拒绝新lease，再drain queue并checkpoint/close，不能让每个runtime实例各起timer。

打开数据库后至少设置并验证：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 2000; -- BUSY_TIMEOUT_MS，host-owned constant
PRAGMA trusted_schema = OFF;
PRAGMA synchronous = NORMAL;
```

具体值由上述 runtime 常量拥有，不写进 manifest。每个 DB 使用串行队列保护 migration/transaction/close；首版冻结同一 DB 串行、跨 DB 只在各自队列中独立推进，不增加读并行开关。

Handler 获得的是由manifest中server-owned `risk`选择的host-owned capability facade，而不是所有handler共用一个可写对象：

```ts
type LocalReadDatabase = {
  get<T>(sql: string, params?: unknown): T | undefined
  all<T>(sql: string, params?: unknown): T[]
}

type LocalWriteDatabase = LocalReadDatabase & {
  run(sql: string, params?: unknown): { changes: number; lastInsertRowid?: number }
  transaction<T>(callback: () => T): T
}
```

`risk:'read'`只能拿`LocalReadDatabase`：对象上不存在`run`/`transaction`/`prepare`/raw handle。runtime在该context串行队列内、调用handler前设置并验证underlying connection `PRAGMA query_only=ON`；`get/all`内部prepare后还必须要求`statement.reader===true`，再执行。这样`INSERT ... RETURNING`仍被SQLite query-only拒绝，`PRAGMA query_only=OFF`等non-reader语句在facade层拒绝。handler结束后runtime在`finally`恢复host写态并重新验证固定PRAGMA；任何关闭guard/写入尝试返回非retryable 403 `local_data_readonly_violation`、零changes/零audit side effect，并丢弃handler结果。因为同一DB action已串行，不得在guard开启时并行运行write handler。

`risk:'write'|'destructive'`才拿`LocalWriteDatabase`，且仍要先通过现有permission/confirmation/revision policy；request/input不能覆盖risk或选择facade。SQL 必须由签名 handler 源码固定，不能来自 action input。两种facade都不暴露 raw Database、文件路径、`.loadExtension()`。仍要诚实标注：安全边界是“签名安装与 admin consent”，不是恶意Node代码沙箱；query-only + capability分层落实的是Gateway risk/confirmation正确性边界，不能阻止已获信任模块使用其他Node能力。

每个 `(projectKey, extensionId)` 一条执行队列和 connection。write/destructive handler 整体运行在 host transaction 内；handler 返回后、commit 前必须验证 JSON 可序列化且编码后 ≤2 MiB。循环/超限/非法结果必须回滚，不能出现“写已提交但客户端只收到 result-too-large”。read 也经同一队列，保证与写的明确次序。

### 5.8 Migration 语义

建议 managed layout：

```text
<OPENCHAMBER_DATA_DIR>/interactive-ui/local-data/v1/
  projects/<projectKey>/apps/<validated-extension-id>/data.sqlite
  trash/<timestamp>-<projectKey>-<extension-id>/...
```

`projectKey` 是 canonical server authority 的 hash，不是 raw path。平台表：

```sql
CREATE TABLE _ldr_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE _ldr_migrations (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  app_version TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
) STRICT;
```

`_ldr_meta` 至少记录 runtime schema、extension id、project key、publisher/key fingerprint、created time。

1. 首次打开时创建 host-owned migration ledger，记录 extension version、migration id、resource digest 和 applied time。
2. 每个 migration 在单独事务内执行；失败时回滚该 migration，DB 标记 `migration-failed`，action 返回显式错误。
3. 已应用 migration 的同 id/digest 必须幂等跳过；同 id 不同 digest 视为 immutable-history violation，返回 `local_data_migration_history_mismatch`。
4. ledger 中存在 candidate manifest 不包含的 migration 返回 `local_data_schema_ahead`。不支持 down migration/自动 schema rollback；Manager 在切旧版本前检查所有已发现项目库并拒绝不安全回滚。
5. migration scanner 至少拒绝 `ATTACH`、`DETACH`、危险 filesystem extension loading、修改 host-owned ledger；但不能把 scanner 宣称为 SQL sandbox。
6. migration、handler import、action 失败都不能删除用户 DB。
7. update 不预迁移所有项目库：跨 DB 无法原子提交。新 generation 激活后按库 lazy migrate；一个库失败只阻塞该 project/extension key，其他项目、扩展与 HTTP connector 继续。
8. 备份使用 better-sqlite3 online backup，或 checkpoint 后受控 snapshot；WAL 活跃时不能裸拷 `data.sqlite`。

### 5.9 生命周期与数据删除

| 事件 | 行为 |
|------|------|
| server 启动 | lazy open；不批量执行所有扩展 migration |
| 首次 action | 校验安装/授权 → 打开 DB → migration → handler |
| extension disable | 拒绝新 action，等待/中止队列边界，checkpoint/close DB；保留数据 |
| extension update | 验证新包/owner/transition后切 generation；各 project 首次 action lazy migrate；失败只阻塞该库，不能谎称跨库原子回滚 |
| extension rollback | 切换前 inspect 所有已发现 DB；任一 `schema-ahead` 就拒绝，不执行 destructive downgrade |
| extension uninstall | 阻止新 action、drain、checkpoint/close；默认原位保留 managed data 与 owner metadata，credential/tile cleanup仍走现有事务 |
| project close/untrack/settings移除 | 这只是 UI/server registry 生命周期，不是数据删除；close connection并原位保留所有 LDR data |
| explicit clear extension data | Extension Manager 独立、强确认、精确 `projectKey+extensionId+owner` target；close 后原子移动到 managed trash并记录审计 |
| explicit purge project LDR data | 新增的 Local Data 管理动作，不能复用当前 client-only `removeProject`；先列 impact，再做二次确认，逐 extension close 后把精确 project root 移到 managed trash |
| server shutdown | `beginShutdown()` 后拒绝新 action，drain、checkpoint、`dispose()`；等待 bounded grace period并报告未关闭资源 |

禁止在普通 uninstall/disable 中直接 `rm -rf` 数据目录。路径必须经过 managed-root containment、realpath/no-symlink 检查，并避免 read-then-delete 的父目录替换竞态。

#### 5.9.1 Local Data impact / clear / purge HTTP 合同

跨 owner 只实现以下 v1 管理接口；不得让 routes worker 与 Manager UI worker各造一套 body。两条route都要求正常OpenChamber认证与`X-OpenCode-Directory`；request使用exact-key decoder，任何unknown key以及client提交的`projectKey`、path、owner或private authority字段都在authority resolve前以400 `local_data_management_request_invalid`拒绝，绝不能静默忽略/剥离后继续：

```text
POST /api/interactive-ui/manager/local-data/impact
POST /api/interactive-ui/manager/local-data/purge
```

`impact` request固定为 `{apiVersion:1, selector:{scope:'extension'|'project', extensionId?:string}}`；`scope:'extension'`必须有合法installed extension ID，`scope:'project'`禁止带extensionId。server用fresh `ProjectScopeAuthority`解析header，再返回public-safe `LocalDataImpactV1`：`{apiVersion:1, operationId, selector, authorityRevision, databases:[{extensionId, ownerDisplayId, bytes, schemaVersion, state}], totals:{databases,bytes}, confirmation:{token, phrase, expiresAt}}`。不得返回projectKey/raw path/SQL/migration rows/fingerprint；`operationId`、token均为server opaque random，token有效5分钟、single-use。

`purge` request固定为 `{apiVersion:1, operationId, confirmationToken, confirmationPhrase}`。server从token恢复并核对projectKey、incarnation、selector、owner tuple、impact digest、authorityRevision与expiry；不得接受客户端重传selector来换目标。短语必须exact match，随后在manager-scoped exclusive transaction里fresh pre-check→拒绝新lease/queue→drain/checkpoint/close→managed-root no-follow rename到trash→fresh post-check→写audit。response为 `{apiVersion:1, outcome:'moved-to-trash', databases, bytes, recoveryId, auditId}`，其中ID均opaque且不含path。

稳定映射：malformed/unknown field=400 `local_data_management_request_invalid`；unknown project/extension=404 `local_data_management_target_not_found`；缺失/错误/过期/已用confirmation=409 `local_data_purge_confirmation_required`；impact或authority变化=409 `local_data_purge_stale`；owner冲突=409 `local_data_owner_mismatch`；shared authority unavailable/capacity按§5.11的503/409 code；trash/close失败=500 `local_data_purge_failed`且数据与Manager状态保持原位或可恢复。两route均`Cache-Control:no-store`，日志只记request/audit ID与数量。普通uninstall/project untrack绝不能调用它们。

### 5.10 Transport 决策：P3.1 只做 direct adapter

推荐生产路径：

```text
Gateway policy/confirmation
  → LocalDataRuntime.invoke
  → fixed handler
```

理由：现有 Gateway 已提供 HTTP/action policy seam，LDR 只有一个调用者；再把调用转成伪 HTTP `Request` 不会增加隔离、取消或可测试性，反而新增依赖和错误映射层。

未来只有真实第二 transport consumer、独立 ADR/roadmap slice、direct dependency评审和新用户授权全部存在时，才可在**P3.1之外**重新比较Hono与其他adapter。届时transport若采用Hono，方向也必须是`transport route → 已冻结 LocalDataRuntime.invoke()`，不能让runtime facade反向依赖某个HTTP框架；listener/CORS/auth/error/perf合同由新ADR决定。本文不提供可复制的Hono文件、伪代码或验收项，P3.1 Agent看到传递lock entry也不得import。

### 5.11 错误合同

建议稳定 reason codes：

| code | HTTP/调用语义 | UI 行为 |
|------|---------------|---------|
| `local_data_runtime_unavailable` | runtime/平台/native addon不支持 | 显示明确不可用，不显示空数据 |
| `local_data_project_required` | 缺 project authority | 阻止 action，提示重新进入项目 |
| `local_data_project_mismatch` | context 冲突 | 安全错误，不自动重试 |
| `local_data_project_stale` | authority已成功读取后，scope stable stat/owner/incarnation在action前后变化 | 关闭该scope连接并fail closed；不得回退path-only或旧DB |
| `project_authority_request_invalid` | public-safe scope projection缺少/伪造/malformed directory header或带非法body | 400；不解析identity、不返回path/stat |
| `project_authority_inventory_unavailable` | strict Git/FS/session inventory timeout、权限、损坏或暂时不可读 | 503；不tombstone、不旋转nonce、不自动改成plain |
| `project_authority_identity_unsupported` | 没有受支持owner，或plain configured root所在FS无法提供可靠creation identity | 422/unsupported；不创建projectKey或DB |
| `project_authority_capacity` | shared incarnation ledger达到4096/4MiB且无安全tombstone可清 | 503；拒绝注册新scope，现有scope继续，不silent evict |
| `project_authority_store_unavailable` | shared ledger损坏、权限或原子写失败 | 503；fail closed并提示修复server data，不自动重建 |
| `local_data_capacity` | pool没有可回收lease | 503/可诊断，不silent evict |
| `local_data_busy` | SQLite busy | read可让用户重试；write不自动重试 |
| `local_data_readonly_violation` | `risk:'read'` handler尝试non-reader SQL、关闭query-only或访问mutation capability | 403/non-retryable；零DB变化，不弹写确认后重试 |
| `local_data_migration_failed` | 当前库schema未就绪 | 保留旧数据，显示管理员可诊断错误 |
| `local_data_migration_history_mismatch` | 已发布migration被改写 | 阻止该库，不自动修复ledger |
| `local_data_schema_ahead` | rollback/downgrade不安全 | 拒绝切旧版本 |
| `local_data_owner_mismatch` | 新publisher/key试图接管旧数据 | 要求独立接管确认/流程 |
| `local_data_handler_missing` | manifest/bundle不一致 | 标记扩展损坏 |
| `local_data_async_handler_unsupported` | v1 handler返回Promise | 标记扩展实现错误 |
| `result_too_large` | 非JSON/循环/编码>2MiB | write transaction回滚，不泄漏payload |
| `local_data_internal` | 未分类server error | 只显示requestId/reason，不返回stack/SQL/path |

### 5.12 平台矩阵

| 平台 | P3.1 首版 |
|------|------------|
| Web + 本机 OpenChamber server | 支持；DB 在 server data dir |
| Electron managed server | 支持；必须做 native ABI rebuild、packaged read/write、quit/reopen 验收 |
| Web 访问远程 OpenChamber server | 支持；数据在 server 主机，不在浏览器 |
| VS Code client | 只有接到具备同一 Gateway 的 OpenChamber server 才支持；否则显式 unsupported |
| Capacitor/mobile client | 通过远端 server 可用；设备内不直接运行 better-sqlite3 |
| Relay | 透明复用现有 action HTTP；不能新增 relay 专用数据库协议 |
| 外部 legacy OpenCode | 与 LDR 无直接关系；Agent Tool availability 仍由当前 capability 决定 |

### 5.13 P3.1 测试先行清单

最低 unit/contract cases：

1. manifest 正常化：合法 v1；未知版本；重复migration/unknown handler；entry/path穿越；Remote + localData；未allowlist resource；digest不符。
2. project scope：Git primary configured root及其worktrees、linked-worktree作为唯一configured entry时只授权自身、primary+linked双配置exact owner、plain configured root/child、缺失、mismatch、Unicode/超长/路径字符、strict inventory failure不改ledger、成功missing才tombstone、unsupported plain identity、同路径删除重建、read进行中重建并丢弃旧结果、ledger损坏；Workbench board v2 private ref/public projection/client override/v1 rebind、独立Popout只用tile ref；同一个OpenChamber server的两个OpenCode runtime都须重验authority但对同incarnation得到同projectKey/同DB，两个server data roots互不可见。
3. migration：首次、重开幂等、第二 migration、事务失败、同 version 不同 hash、并发首次 open、upgrade 失败。
4. handler：合法 read/write、unknown handler、module digest变更、symlink/path escape、Promise、非JSON/循环/超限、throw/busy/capacity分类；`risk:'read'`对象无run/transaction，`INSERT RETURNING`/写PRAGMA/关闭query-only均`local_data_readonly_violation`且前后row/WAL/audit不变，write/destructive只有confirmation后才取得mutation facade。
5. pool/queue：64 global、16/extension、16/project、64/context queue、512 global queue逐个边界；fake clock 10m TTL/60s sweep；只evict idle zero-lease、稳定oldest-first；全active时503且live DB不关闭；evict后reopen数据不丢。
6. lifecycle：disable/enable、update、uninstall→原位保留、project close/untrack→原位保留、explicit clear extension→trash、explicit project LDR purge→trash、shutdown停止唯一sweeper/drain/checkpoint/close、失败后 reopen。
7. data isolation：两个project incarnations × 两个extension的四个库互不可见；跨server fixture用独立data roots互不可见；同extension换publisher/key时owner mismatch，不自动接管旧数据。
8. security：action input 不能覆盖 SQL/path/module；Remote/Hosted 不能执行 server code；错误不泄漏 DB path/SQL/stack。
9. packaged Electron：native module 加载、迁移、写入、退出、重启、数据持久、uninstall recoverability。

### 5.14 P3.1 完成定义

- manifest/package/runtime/UI contracts 均有 schema tests；Local full package 是唯一可声明 server code 的来源。
- OpenChamber server data realm × canonical projectKey × extension owner 隔离由自动化证明；同server切OpenCode runtime重验authority但复用同scope DB，跨server由不同data root隔离；没有全局 fallback DB。
- migration ledger、hash immutability、事务失败与 lifecycle close 有确定性测试。
- manifest risk决定read/write capability：read handler在SQLite query-only+reader-statement双guard下无法持久化，mutation负例零副作用；write/destructive仍由confirmation后host transaction包裹。
- UI/模型不能提供 SQL、DB path 或 module path；server error 不泄密。
- Web 本机、Electron packaged、远端 Web 客户端路径分别有证据；unsupported 平台明确。
- P3.1 实现没有 Hono/lockfile 变化；未来 transport slice 不能偷用传递依赖。
- 文档、开发者指南、扩展 skill/template 与 package review 均同步；roadmap 只在代码/验收真实完成后改状态。

---

## 6. P3.2：Dev Hosted / Dual Path Phase 2+

### 6.1 目标结果

开发者可以从一个本地 OCIX 源目录启动安全的 Dev Hosted resource server。它把源码构建为签名、内容寻址、不可变的 release snapshot，并通过现有 Hosted manifest/resource kernel 提供给 OpenChamber。产品侧使用项目级、默认关闭的 `dev-hosted` source profile：复用签名、hash、MIME、redirect、permission/fingerprint，但**不伪装成现有 Remote connect**，也不要求 business access key/api-key connector。

### 6.2 MVP 边界

首版只做 repo CLI：

```bash
node scripts/interactive-ui-extension.mjs dev-hosted <source> \
  --private-key <path> \
  --publisher-id com.acme.dev \
  --publisher-name "Acme Development" \
  --key-id dev-key-1 \
  --host 127.0.0.1 \
  --port 47841
```

MVP 包含：

- build/validate/sign；
- loopback HTTP；
- immutable release paths；
- manifest 原子切换；
- watcher/debounce；
- TTY、non-TTY、`--json`、quiet/CI 语义；
- graceful shutdown/cleanup；
- 与现有 Hosted verifier/resource loader、Manager generation/last-good 的真实验收。

这里的“project-bound”严格使用 §4.4/§5.6 shared server authority：configured settings root + strict `project-inventory`（Git/plain typed result）+ session containment + incarnation ledger派生`projectKey`。`getWorktrees()`只作UI listing；`workbench.projectId`、header directory和全局current directory都只是hint。未知/跨project/stale incarnation在任何source/trust/lease写之前fail closed。P3.2若先于P3.1获批，必须先实现该共享层，但不得顺带实现SQLite/LDR。

MVP 不包含：

- OpenChamber 产品内的进程管理器、GUI watcher、Electron sidecar；
- 公网 TLS、隧道、账号系统、共享 hosting、Marketplace publish；
- 绕过签名、固定 fingerprint、permission/re-consent；
- 任意目录静态服务器；
- 代理 Business API、LDR 或 secret；
- 自动生成/托管私钥到源码仓库。

### 6.3 当前与目标路径

```text
source directory
  → bind loopback socket (port 0 resolves here; routes gated as initializing)
  → existing pack/validate/sign helpers
  → release builder
      → releaseId = r1-<64 lowercase sha256 hex> of canonical logical preimage
      → build absolute URLs with resolved origin
      → sign + verify publisher/manifest/resources
      → memory/temporary managed snapshot
  → loopback DevHostedServer
      ├─ GET /manifest.json              (当前 release 的签名 manifest)
      ├─ GET /instances/:serverInstanceId/releases/:id/manifest.json (不可变)
      ├─ GET /instances/:serverInstanceId/releases/:id/resources/... (不可变、allowlisted)
      └─ GET /healthz                     (无敏感信息)
  → project Dev Hosted inspect/confirm
  → Manager source.type="dev-hosted", delivery remains Hosted
  → existing Hosted verifier/lazy resource loader
  → existing OCIX Host
```

`/manifest.json` 可以切到新 release，但旧 View 稍后仍可能首次请求 `/instances/<this-process>/releases/<old>/...`。CLI 必须保留本进程发布过的全部 release，直到关闭；不能只看 active HTTP request 或只留 current + previous。每次CLI启动生成新的128-bit `serverInstanceId`；重启后旧instance URL只能404，绝不能在同一URL下复用新`publishedAt`/signature字节。

### 6.4 建议代码结构

| 文件 | 职责 |
|------|------|
| `scripts/lib/interactive-ui-dev-hosted.mjs` | `createReleaseSnapshot`、`createDevHostedServer`、watch/rebuild state machine |
| `scripts/lib/interactive-ui-dev-hosted.test.mjs` | 路径、签名、atomic switch、watch、shutdown、安全 tests |
| `scripts/interactive-ui-extension.mjs` | 只负责 CLI 命令解析、Clack UI、TTY/non-TTY/json 输出与 exit code |
| `scripts/interactive-ui-extension.test.mjs` | 命令合同和真实 Remote interop fixture |

server 深模块建议：

```ts
type DevHostedConfig = {
  sourceDir: string
  privateKeyPath: string
  publisherId: string
  publisherName: string
  keyId: string
  host: "127.0.0.1" | "::1"
  port: number
  watch: boolean
}

type DevHostedServer = {
  url: string
  currentReleaseId(): string
  rebuild(reason: string): Promise<BuildResult>
  close(): Promise<void>
}
```

CLI 不得获得内部 resource map 或私钥内容。

### 6.5 Release snapshot 规则

1. 先生成本进程唯一的32位lowercase-hex `serverInstanceId`，再 bind 允许的 loopback socket、取得最终 `origin`（包括 port `0` 的实际端口）；首个 release 验证完成前所有 content route 只返回稳定 `503 dev_hosted_initializing`，不得暴露半成品。instance ID不是secret，但不得由用户提供或跨进程复用。
2. build resource bytes 后创建 `DevHostedReleasePreimageV1`：只含 schema version、extension/version、publisher/key ID、规范化的**开发者语义合同**，以及按 logical path 排序的 `{path,mime,size,sha256}`。语义合同必须保留 connectors 的 `baseUrl`、开发者声明的 network/external-link/resource origins 等会改变权限或运行行为的 URL；这些字段仅 URL 变化也必须产生新 `releaseId`。只排除当前 CLI server 派生的 serving origin、由该 origin 注入的那一个 `permissions.resourceOrigins` 值、`resources[].url`、`releaseId`、signature、`publishedAt` 与临时路径。若开发者自己声明了同值或其他 resource origin，normalizer 必须以来源标记/双阶段结构区分，不能顺手从语义合同删掉。
3. `releaseId = "r1-" + sha256(canonicalStringify(preimage)).digest("hex")`，严格匹配 `/^r1-[0-9a-f]{64}$/`，可直接作为一个 URL path segment。最终 signed manifest 增加 Dev-only、同样被现有 Hosted signature覆盖的 `devHosted:{$schema,serverInstanceId,releaseId,logicalPreimage}`；`serverInstanceId`不进入logical preimage/releaseId，但必须进入签名字节。这不是新的 publisher/manifest 协议，只是 Direct Remote verifier容许并签名的扩展字段。随后才用 `${origin}/instances/${serverInstanceId}/releases/${releaseId}/...` 构造 Hosted verifier 要求的绝对 `resources[].url`，把 exact serving origin 合并进最终 `permissions.resourceOrigins`，设置该进程首次创建该 release 时的 `publishedAt`，最后签 manifest；因此没有 ID 自引用，同时产品能从已验签 document中取得并重算权威 ID。跨重启可保持相同logical releaseId，但instance路径不同，绝不会让同一immutable URL出现新timestamp/signature。
4. 同一进程同一 preimage 再构建必须 no-op：复用原 signed manifest/`publishedAt`/snapshot，不新增 generation、不发 `release-published`。源内容 A→B→A 时也复用已有 A。
5. CLI 从 private key 派生 Ed25519 public key，把 `{id,name,keyId,publicKey}` 作为现有 Hosted signed manifest 的内嵌 `publisher` 字段，signature.keyId 必须一致；current pointer 切换前必须用现有 `verifyRemoteOcixManifest` 验签并本地派生 fingerprint，再用 §6.6.2 的 shared shell-metadata preflight 验完整 runtime/resource/tool contract。不得新增平行 publisher handshake。
6. 对外只提供 manifest 中存在且 hash 匹配的资源；绝不 `serve-static(sourceDir)`。`/instances/<serverInstanceId>/releases/<id>/...` immutable；其他instance ID一律404；`/manifest.json`、`/healthz` no-store。
7. rebuild 失败时保留上一成功 release 为 current；current pointer 单一原子切换，并发请求只看到完整旧或新 release。
8. 为保证 A→B→C 后仍存活的 A View 可 delayed-fetch，CLI 在本进程生命周期保留**所有已发布 release**，不按“无 active request”淘汰。冻结容量：最多 64 个不同 release、去重后资源总 bytes ≤512 MiB；新 release 超限则 rebuild 失败为 `release_capacity` 并保留 current，绝不删除旧 release腾空间。数值若要调整必须在实现前由用户批准。
9. server 关闭后临时 snapshot 可清理；私钥、完整源文件、业务数据不得进入 snapshot。进程重启后旧 origin 本就离线，产品仍按 last-good/offline 语义处理。

测试必须固定：serverInstanceId→port `0` bind→logical normalize/hash→写入 signed `devHosted` locator→derived serving URL/resourceOrigin→sign 顺序；同一进程same-input 不改变 manifest bytes/`publishedAt`；只改 connector `baseUrl`、network origin、external-link origin或开发者声明的 resource origin都必须改变 `releaseId`，只改实际 loopback port或重启instance不得改变 logical preimage/releaseId。固定端口重启必须生成新instance URL：旧immutable URL 404，新URL可有新的publishedAt/signature，任何单一immutable URL绝不返回两组字节。篡改 locator instance/ID/preimage、resource path/hash/MIME/size或 URL 中 instance/release ID 均在写 state 前拒绝；A→B→C 后 A View 首次请求资源仍 200；第 65 个/超 512 MiB release 被拒且 current不变。

### 6.6 网络与鉴权

- 默认且首版只允许 `127.0.0.1` 或 `::1`；传入 `0.0.0.0`、非 loopback 地址或隐式 host 解析为非 loopback 时 fail closed。
- Dev Hosted content inspect 不使用 access key；business connector credential 仍由扩展现有 Gateway 配置单独管理。不得为了复用 Remote route 而伪造 api-key connector。
- Dev signing key 必须是稳定 Ed25519 key，用户显式传入，或由单独 `keygen` 命令写入权限受控的用户配置目录。不得每次重启随机换钥，否则会持续触发 fingerprint/re-consent。
- private key path 不得位于 served snapshot；realpath 后验证普通文件、权限和长度。
- 请求方法只允许 GET/HEAD；拒绝目录 listing、range abuse、encoded traversal、symlink escape、dotfiles 和未知 path。
- health 只返回 protocol/version/current release/rebuild 状态，不返回 source path、key path、manifest body 或 stack。

#### 6.6.1 Embedded publisher / trust bootstrap

Dev Hosted 不经过 Remote access-key wizard，但直接复用现有 Direct Remote 的**内嵌 publisher signed-manifest 合同**，不新增 `/publisher.json`、self-signed envelope 或第二套 canonicalization。CLI 的 `--publisher-id`、`--publisher-name`、`--key-id` 与 `--private-key` 都是必填；non-TTY 缺一项即 usage error。字段必须通过 `remote-ocix.js` 的现有 ID/keyId/name/public-key规则；public key只从 private key派生，不能由另一个 CLI flag覆盖。

产品首次 inspect 顺序固定：

1. 从 project-bound `manifestUrl` 用现有 bounded loopback fetch 读取 signed Hosted manifest；
2. 调 `verifyRemoteOcixManifest({document})`：它验证内嵌 `publisher:{id,name,keyId,publicKey}`、signature.keyId一致性和Ed25519签名，并本地派生 fingerprint；不得信文档自报 fingerprint；
3. 从 `verified.signedDocument.devHosted` 读取 locator，严格校验signed `serverInstanceId`、重算 `logicalPreimage → releaseId`，并验证 preimage 与已验证 publisher/extension/resources/permissions 逐字段一致、每个 resource URL 都是 captured manifest origin 下 exact `/instances/<same-instance>/releases/<same-id>/resources/<encoded-path>`；不得从 CLI stdout、URL猜测或未验签字段取得 ID；
4. 在任何 trust/source/generation/cache write 前，对同一 captured verified document 调 §6.6.2 `preflightHostedShellMetadata`；Dev Hosted route **不调用** `selectRemoteConnector`，因此无需 api-key connector；
5. 用户确认 publisher identity/fingerprint + 已完整 preflight 的 manifest permissions 后，才把 verified public key tuple、validated release ID 与 projectKey/sourceId/accepted manifest 写入独立 Dev Hosted trust record；private key 永不进入产品；
6. refresh 时 key tuple 完全相同才可自动验证。key变化或同 keyId 不同 public key必须保留 last-good并走 re-consent；拒绝则不切 generation；
7. 同 extension ID 的第二 Dev source/publisher 冲突必须显式拒绝或用户先 disable 原 source，不能静默接管全局 Agent Tool。

历史 `/instances/:serverInstanceId/releases/:id/manifest.json` 自身已经携带并签署当时的 publisher tuple与instance locator，足以验证本进程历史资源。CLI重启后旧instance URL只404；产品依靠已校验cache/last-good或新current refresh，不把新进程字节挂回旧URL。复用 `verifyRemoteOcixManifest` 的验签 primitive 不等于复用 Remote URL+Key/connector 流程。

#### 6.6.2 Shared shell-metadata preflight（必须在所有写之前）

`verifyRemoteOcixManifest` 只完成 publisher/signature/Hosted kernel，不等于 extension runtime 可加载。把当前 `manager.js::preflightRemoteShellMetadata` 的无写逻辑抽成 `hosted-preflight.js::preflightHostedShellMetadata({verified, environment})`，由 Remote 与 Dev Hosted 共用：

1. 调同一 `normalizeExtensionManifest` 验 connectors/actions/permissions/views/artifacts/dashboard/routing/Native trust/duplicate identity；
2. 所有 view/artifact/icon entry 必须是 safe relative path、允许扩展名，并精确引用 verified `resources[]`；
3. 调 `hostedSurfaceBindings` 验 Tool name、reserved name、duplicate/cross-surface binding；
4. 拒绝 Hosted/Dev Hosted `localData`/server entry；
5. 返回 normalized extension + immutable preflight digest，输入是刚验签的 captured document，不重新 fetch mutable `/manifest.json`。

Remote wrapper 在 shared preflight 后继续 `selectRemoteConnector` + exact-one-api-key matching；Dev Hosted wrapper先验证 signed `devHosted` locator/preimage，再明确跳过**仅这一 connector product policy**，不能跳过其他 metadata/resource/tool 检查。inspect、first confirm、refresh、key rotation 都必须按 `fetch once → verify signature → validate Dev release locator → shared preflight → diff/confirm → atomic write`，任何失败保证 trust/source/generation/cache 零写入。测试必须包含“签名合法但 release locator与semantic contract/resource URL不一致、entry 未声明/扩展名错误、metadata network越权、reserved/duplicate Tool、localData 注入”，并断言没有 state/secret/cache residue。

### 6.7 CLI watch 与产品 refresh 状态机

```text
idle
  → fs event
  → debouncing
  → building
      ├─ success → publish new current → idle
      └─ failure → keep previous current → degraded → next change/build
  → shutdown → stop watcher → await current build boundary → close server
```

CLI watcher 规则：

- 同一 burst 合并为一次 build；building 期间新事件标记 `dirty`，结束后至多再跑一次。
- 不并行签两个同一 source 的 release。
- 首次 build 失败时不启动“空 server”；CLI 非零退出或保持明确 no-release 状态，由命令合同冻结。
- `SIGINT`/`SIGTERM` 顶层 `try/finally` 关闭 watcher/server；测试必须证明端口可立即复用。
- watcher 忽略 output/temp/node_modules/.git/secret key；忽略表与现有 pack input 规则保持一致。

产品 MVP 可以只提供显式 Refresh，不必做 OpenChamber 内部 filesystem watcher。Refresh 状态机：

```text
active last-good generation
  → inspect current loopback manifest
      ├─ valid same digest → no-op
      ├─ valid new digest → permission diff/confirm → atomic generation switch
      └─ invalid/offline/hash/MIME error → keep last-good/current pointer不变；只原子更新operational health为degraded
```

`status`不是release authority。每个source另有受界`operationalHealth`，显式refresh-inspect失败立即标degraded；enabled source由Manager每30秒做一次2秒timeout的signed-current-manifest health probe，global concurrency=4，连续2次失败才标degraded，任一合法签名成功清零并标healthy。probe只验证同publisher/locator并更新health，不创建inspection、不preflight/apply新release、不改trust/generation/current pointer/Tool；source disable或server shutdown必须停timer。CLI停止后最迟两个周期进入degraded，last-good资源与既有lease仍按冻结规则工作。显式refresh的health小事务失败返回500 `dev_hosted_source_apply_failed`且不创建inspection；后台probe写失败保留last-good/旧health、发safe diagnostic并暂停该source probe到下一次Manager reload/manual retry，绝不能改authority或伪称新状态。常量与fake-clock/dispose tests归`dev-hosted.js`/host runtime owner，不得由UI轮询自造第二状态机。

项目 developer switch 默认关闭。`source.type="dev-hosted"` 与 canonical project authority 绑定；同一 host 上同 extension ID 首版只允许一个 active Dev source，因为 Agent Runtime Tool 安装目前是全局的。跨项目source管理请求按B.3.1统一404 `dev_hosted_source_not_found`；跨项目surface/lease/action按B.4统一404 `dev_surface_binding_unavailable`，都不得泄漏另一项目是否安装或静默使用其版本，也不得另造project-mismatch code。

### 6.8 CLI 交互合同

遵守 Clack 模式：policy/validation 先于 presenter。

| 模式 | 行为 |
|------|------|
| TTY 默认 | Clack intro、build 状态、URL、fingerprint、release ID、rebuild 成败；Ctrl-C 正常收尾 |
| non-TTY 默认 | 不 prompt；缺必填参数立即非零退出；稳定逐行文本，不使用 spinner/control chars |
| `--json` | stdout 只输出 machine JSON/JSONL；人类日志走 stderr 或关闭；schema/version 固定 |
| `--quiet` | 关闭进度/装饰，但 ready 后 stdout 仍输出唯一最小行 `READY <manifestUrl> <releaseId> <fingerprint>`；错误写 stderr并非零退出 |
| `--no-watch` | 成功构建并服务一个 snapshot；不启动 watcher |
| port `0`（若允许） | OS 分配，最终 machine output 返回实际 URL；不得写死默认端口到测试 |

`--quiet` 与 `--json` 互斥；同时出现是 usage error/exit 2，不能猜优先级。quiet ready 行是调用方取得 port `0` URL 的正式合同，不得完全静默。

Exit code 冻结：`0` 正常关闭，`2` usage/validation，`3` initial build，`4` bind，`5` signing/key，`6` runtime。CLI tests逐项固定，Agent不得另选数字或把所有失败压成1。

### 6.8.1 Inactive-generation read lease

CLI 保留 A bytes 仍不足以让旧 A View 工作：当前 Manager/runtime 只授权 activeVersion + current generation。P3.2 必须为 **Dev Hosted resource read** 新增受界 generation lease，不能放宽全局 authority。

冻结接口：

```ts
type DevHostedGenerationLease = {
  id: string                 // server-generated opaque 128-bit value
  surfaceInstanceId: string  // server-generated, component-memory only
  extensionId: string
  projectKey: string
  generationId: string
  releaseId: string
  signedManifestHash: string
  state: "active" | "suspended"
  expiresAt: number
  resumeUntil: number
}
```

lease capability 之外还必须有一个**可重放但不授权读取**的代际选择标记，解决 renderer reload 后旧 A envelope 被重新交给 current C code 的混代问题：

```ts
type DevHostedSurfaceBindingMarkerV1 = {
  $schema: "openchamber://dev-hosted-surface-binding/v1"
  id: string                 // server-issued base64url, 128-bit random；不是 resource token
  extensionId: string
  surfaceKind: "view" | "artifact"
  surfaceId: string
}

type DevHostedSurfaceBindingRecord = {
  id: string
  projectKey: string
  extensionId: string
  surfaceKind: "view" | "artifact"
  surfaceId: string
  generationId: string
  releaseId: string
  signedManifestHash: string
}
```

- `surface binding` 与 lease 必须分层：marker 只选择 Manager 已验证过的 exact generation，单独持有 marker 不能请求任何 resource；真正的 GET/HEAD authority 仍来自短期 lease。Manager 在每次 resolve 时重验 authenticated project、source enabled/trust、extension、surface kind/id 和 record 一致性，cross-project/forged marker 统一404。marker 可以随 Tool history/Workbench tile持久化，但不含路径、publisher key、manifest body、generation ID、release ID、hash或secret。
- Dev Hosted 的 host-generated Agent Tool wrapper 在 extension handler/参数校验之后、`JSON.stringify` 最终 Result Envelope 之前注入 `hostBinding`。扩展源码、Agent参数和模型输出都不能提交或覆盖该字段。`InteractiveResultEnvelope` 与 `InstalledHTMLArtifactResultEnvelope` 只接受上述 exact-key marker；Dev Hosted Tool result缺 marker时 fail closed `dev_surface_binding_required`，保留原 Tool 文本 fallback，绝不按 current 猜代际。普通 Local/Hosted/Remote envelope不要求该字段。
- binding record 按 `{projectKey, extensionId, generationId, surfaceKind, surfaceId}` 去重，不按消息/渲染实例增长。冻结独立上限：每extension 256 records、全server 4096 records、canonical serialized records总计≤2 MiB。marker本身不pin generation；inactive generation在没有active/suspended lease时仍按15分钟规则清理并同时使marker unavailable。达到binding cap且没有可随generation安全清理的record时，新source/install/refresh失败`dev_surface_binding_capacity`并保留current，绝不淘汰current、leased或suspended generation。disable、uninstall、developer switch off、project source removal、publisher trust revoke立即使相关record失效。server restart 不从 marker 重建 authority：旧 marker返回 `dev_surface_binding_unavailable`，UI明确显示“历史开发版本已不可用”，不得回退 current。
- server restart 的**历史 marker**继续失效，但 active current generation 必须恢复可调用性：Manager 启动恢复先重验 source/project/trust/current signed generation，随后为其每个 signed surface生成一组全新marker，原子重建 host-generated Agent Tool source及其integrity，再经现有 `reconcileOpenCodeAgentRuntime` 刷新 OpenCode。完成前这些 Dev Hosted Tool不进入available catalog；失败时 unregister/保持Tool unavailable并显示source degraded，保留source/last-good供诊断，绝不能继续暴露磁盘上携带旧marker的wrapper。下一次成功reconcile后的新Tool call只会产出新marker。历史Tool/tile中的旧marker仍明确unavailable，不偷偷改写。
- 对话/历史依靠 Result Envelope 中的 `hostBinding` 重放；Workbench 使用 §6.8.2 的**server-private tile authority**持久marker和project incarnation，public tile/context不得承载这两个字段。首次创建或用户显式“使用当前版本重新打开”时，server在一次exclusive transaction中解析exact project authority、生成/验证current marker并与tile原子持久；已有 Dev Hosted tile没有private binding时只显示rebind-required，不能后台改绑。`ToolPart.tsx` 负责把对话marker与exact `projectDirectory` 传入 View/Artifact；Workbench/Popout只传 `{projectId,tileId}`，server从private tile authority恢复exact project/binding，surface不得从全局current directory或catalog descriptor自行合成。
- View mount 由 `InteractiveUIView`、Artifact mount 由独立的 `HTMLArtifactView` 分别通过 shared authenticated client 用 marker 请求 Manager 为**marker 绑定的 Dev Hosted generation** acquire lease；只有明确的新 Workbench current mount可以无 marker请求 current并取得 marker。response descriptor/native/artifact asset URL 带server-generated、至少128-bit随机lease token。它不是business credential，但属于受界read capability：必须redact，设置`Referrer-Policy:no-referrer`，不得写普通日志/report/history/persistence，且只在authenticated exact-project resource route有效。
- Native activation必须同时从全局`viewId` registry改为**每个mounted surface lease独立的closure scope**。`nativeRegistry.ts`导出`createNativeRegistryScope()`，scope只提供`loadNativeExtension(...)`、`getRegisteredNativeView(viewId)`与`dispose()`；`nativeViews`、load promises、register disposers和`extension.activate()`返回的disposer全部留在scope内。`InteractiveUIView`每次成功acquire/resume建立新scope，先在新scope加载并取得component，再原子替换旧component并dispose旧scope；renew保持原scope，unmount/release必dispose。普通Local/Remote Native也走每mount scope，删除全局`Map<viewId,...>`与全局load cache，不保留双实现。这样同一`viewId`的A与C可并存且互不覆盖；A release只清A scope，不能删除C component。scope ID仅是内存对象身份，不持久化、不进URL/report，也不等于generation/lease capability。
- lease 只授权对应 extension/project/generation/signed-manifest 下的 GET/HEAD descriptor、entry、icon 和 allowlisted resource。action、Tool install/execution、permission、refresh、Gateway、metadata mutation 永远只认 active generation。
- `InteractiveUIView` Native/Declarative host与 `HTMLArtifactView` Business Bridge发出的每个query/write/destructive action都必须携带同一`hostBinding`；server先验证project/extension/surface，并要求binding record的generation恰等于current active generation。旧A surface在C active时仍可凭lease读取A bytes，但任何business action在创建confirmation/调用handler前返回`dev_surface_generation_inactive`，零副作用；绝不能忽略marker后路由到C。confirmation token必须绑定project、extension、surface、action、input digest、generationId和signedManifestHash，A token不能在C使用或跨refresh重放。普通非Dev Hosted source不走此分支。
- `classifyExtensionAuthority` 保持 active 默认；新增独立 `classifyLeasedDevHostedResourceAuthority`，只由 resource resolver 调用。禁止把 lease 分支塞进普通 authorize 回调后意外授权 action/metadata。
- Manager 保留 leased inactive generation 的 normalized extension、verified manifest/integrity、immutable release URLs和cache root。resource fetch 每次绑定 captured signedManifestHash/releaseId并重验 resource hash/MIME；不能重新读取 current `/manifest.json`。
- UI mount取得 lease后才能让 refresh 把它变成 inactive；unmount发送 release。**所有仍 mounted 的 instance不论折叠、滚出视口或后台tab都每10分钟 renew**，并在 `visibilitychange/pageshow/focus` 恢复时立即 renew；不能用 IntersectionObserver/visible state停止心跳。active TTL为30分钟。
- 设备长时间休眠错过 TTL 后，lease record转为 `suspended`，不立即删除generation；server保留同一 generation和不可猜测的 `{id,surfaceInstanceId}` resume handle 24小时。authenticated resume必须同时匹配 project/extension/generation/signedManifestHash，且 source未 disable/uninstall/trust-revoke，成功后发新 lease ID；lease/resume handle只在仍存活的component memory，不持久化、不入URL/report/log。
- renderer crash/reload 会丢 lease/resume handle，但 Tool result或tile仍保留非授权 marker。fresh mount必须先 resolve marker：同一 server 仍持有 exact binding record时可为 A重新发新 lease；record/generation已清理或server重启时显示 `dev_surface_binding_unavailable`。**任何 marker mismatch/unknown 都不得改绑 current C**。只有没有历史语义的显式新 Workbench mount可以创建 current marker。这样 A envelope 永远不会交给 C descriptor/code，也不把 marker冒充可长期恢复 A 的 capability。
- update A→B→C 不撤销 A/B read lease；disable、uninstall、developer switch off、project source removal、publisher trust revoke立即撤销相关 leases和资源访问。
- caps：每 extension 最多16个 inactive generations、全 server 64、全 server 128 active+suspended lease records，另有binding 256/extension、4096/global、2 MiB。达到generation/lease cap且没有既无active也无suspended lease的generation可安全清理时，refresh失败 `dev_generation_capacity`并保持 current；binding cap用`dev_surface_binding_capacity`。绝不静默淘汰 mounted/suspended View。无任何lease record的inactive generation在15分钟后清理，其marker一起失效。
- generation GC 与其全部binding record删除必须在同一Manager state transaction完成；marker-only generation不能自引用阻止GC。fake-clock测试固定“仅marker、零lease”在15分钟后 generation+bindings同时消失、旧marker unavailable且binding cap重新可用；任何部分失败保留两者并进入degraded，不留下孤儿映射。
- route/client contract 必须覆盖 binding resolve、lease acquire/renew/resume/release、business action marker与 exact project/generation；query/header伪造、cross-project marker、marker surface mismatch、expired-outside-resume-window/revoked/unknown lease全部404/409且不泄漏存在性。测试至少包含 hidden 45分钟仍靠 mounted heartbeat有效、sleep 31分钟后24小时窗口内resume、renderer crash/reload用 A marker重新取得 A或明确 unavailable、A marker绝不返回 C descriptor；C active时A resource GET 200但query/write/destructive均在confirmation前拒绝、A confirmation token不能用于C；server restart marker显式失效、窗口后显式失败。

这条 lease 是 P3.2 专用、只读、受界兼容 seam，不把旧版本重新设为 active。若用户不批准该 seam，MVP 必须改为“存在 active View 时拒绝 Refresh”，并删除 A→B→C 保活承诺；低能力 Agent不得自行选择第三种方案。

### 6.8.2 Workbench private authority 与独立 Popout

现有board v1只持久`source/form/context/layout/display/origin`，而`context`由扩展/客户端控制；marker或project authority绝不能塞进它。P3.2（若P3.1先实现则复用）将server board schema升级为v2，并新增只存在server持久文件中的字段：

```ts
type DevHostedWorkbenchTilePrivateAuthorityV2 = {
  project: WorkbenchTilePrivateProjectAuthorityV2 // 来自§4.5，P3.1也可独立实现
  devHostedBinding: DevHostedSurfaceBindingMarkerV1
}
```

`workbench-store.js`是唯一normalizer/writer：普通create/patch/migrate请求出现`privateAuthority`、`projectIncarnationRef`或嵌套`hostBinding`一律400；route只能通过server-only symbol/private method在成功`ProjectScopeAuthority`与marker resolve后写入。对外snapshot经`toPublicWorkbenchDocument()`删除private authority，只给tile投影`authorityStatus:'bound'|'rebind-required'|'not-required'`。v1→v2迁移保留所有用户布局/context/origin，但private authority为空；需要project-bound LDR/Dev Hosted的旧tile必须显式rebind，不能以当前全局项目/版本补写。

Pin流程固定为：`WorkbenchPinButton`从Result Envelope提取可选marker作为唯一公开的**bindingHint**，连同tile draft和exact directory header发送；server先用exact-key decoder拒绝所有其他private/unknown field→fresh project resolve→验证bindingHint或为明确current Workbench surface生成marker→原子写tile+private authority→返回public tile。任一步失败不创建半个tile。后续patch只能改public layout/context/display；切project、duplicate/migrate tile都必须走server rebind command，不复制private authority。

`ExtensionWorkbench`与`packages/web/src/workbench-popout.tsx`不得从current catalog重造无binding envelope。两者只用public `{projectId,tileId}`调用附录B.4 acquire；server查private tile authority。Popout URL只含bounded projectId/tileId，不含directory、marker、lease、resume handle或asset key；每个window取得独立surfaceInstance/lease，自己做10分钟heartbeat、focus/pageshow renew、sleep resume、React unmount与`pagehide` keepalive release，TTL作为异常关闭fallback。opener/child `postMessage`只传tileId与状态，不传capability。A tile在current C时popout reload只能取得A或显示历史版本不可用，绝不能用catalog C重造；business action继续按private marker做active-generation check。

### 6.9 与 Hosted/Remote 基线的交互

P3.2 验收必须走产品真实 Manager/Hosted kernel：

1. CLI 启动 release A；
2. 在项目 Developer settings 启用 Dev Hosted，获取含 embedded publisher 的 signed manifest；用 `verifyRemoteOcixManifest` 验签、本地派生 fingerprint，确认 permissions并持久化 public trust tuple；
3. shared preflight通过后才安装；Declarative/Native/Artifact mount取得 generation lease，资源按需拉取且 hash 匹配；
4. 修改源码形成 release B；
5. 用户显式 Refresh；permission 不变时按现有更新规则切 generation；
6. permission 扩大或 key 更换时必须 re-consent；
7. 连续发布 A→B→C 后，旧 A View 延迟首次取资源仍成功；新打开 View 取 C；达到容量上限时拒绝 D 而不淘汰 A；
8. CLI 停止后状态明确 degraded/offline，保留 last-good 资源语义，不显示空数据或偷偷执行新内容；
9. business connector 仍单独配置，Dev content flow 不显示 access-key 表单。

不得为了让 dev fixture 通过而修改 `remote-ocix.js` 去接受无签名内容、跳过 fingerprint 或扩大 lazy cache 信任。`selectRemoteConnector` 的 exact-one-api-key 语义保持给 Remote；Dev Hosted 使用独立 source profile 和共享 Hosted verifier。

### 6.10 P3.2 测试清单

1. build：合法 extension、schema 错误、hash 变化、签名失败、source symlink/path escape、secret/output ignore。
2. HTTP：manifest/current/immutable resource、HEAD、cache headers、404、method 405、traversal、unknown resource、encoded slash。
3. atomicity：serverInstanceId→port0 bind→sign、同进程same-input no-op、固定端口重启生成新instance且旧immutable URL 404/绝不异字节、并发 A→B、build 失败保持 A、CLI A→B→C delayed A bytes、64/512MiB capacity、关闭后无响应。
4. watcher：debounce、dirty during build、ignored paths、rename/atomic save、连续失败后恢复。
5. CLI：TTY/non-TTY/json/quiet最小ready行、quiet+json冲突、missing args、bad key、bad bind、SIGINT、端口复用、输出不泄密。
6. source lifecycle/preflight：B.3.1 exact inspect/connect/refresh-inspect/apply/disable；inspect零写、5m/64/16MiB/single-use、apply无二次fetch、confirmation/project/source conflict、失败token失效且last-good原子保留、disable撤销、完整refresh才能enable。签名合法但runtime metadata、entry↔resource、MIME/extension、reserved/duplicate Tool、localData任一非法时，trust/source/generation/cache/secret均零写入；refresh TOCTOU使用同一captured document。
7. generation binding/lease：host-only marker注入与exact parser、B.4 resolve/acquire/renew/resume/release的精确response decoder；continuation pair从private record重验authority，重复release=404；asset GET/HEAD只有exact URL-token allowlist+active asset key可达，无header dynamic import成功，无token/expired/suspended/revoked/wrong-key拒绝且无日志泄漏。A→B→C delayed A fetch、同viewId A/C Native registry scope并存与独立dispose、renderer reload A marker绝不加载C；board v1→v2 private authority、任何client private/unknown field 400、bindingHint+tile原子pin、project ref缺失与Dev marker缺失分别报错、legacy显式rebind；独立Popout URL零capability、每window heartbeat/resume/pagehide release、A→C reload不读catalog C。server restart旧markerunavailable且current Tool新marker/wrapper原子reconcile；C active时A只读资源可达，但direct `hostBinding`/Workbench ref/普通source三支action authority exact互斥，inactive或混合分支在confirmation前拒绝；cross-project/forged/expired/revoked、disable/uninstall及generation/lease/binding caps逐边界无silent eviction。
8. interop：embedded publisher signed manifest→`verifyRemoteOcixManifest`→shared preflight→本地派生 fingerprint→public-key trust record、key rotation/keyId collision、permission update/re-consent、lazy resources、last-good、cleanup；Remote exact-one-api-key 全量回归。
9. platform：macOS/Linux/Windows 路径与 signal 差异；至少在有机器时补 evidence，不把未测写通过。

### 6.11 P3.2 完成定义

- server 只监听 loopback、只服务 signed allowlisted immutable resources；不存在 source directory fallback。
- build/rebuild/preimage无环/same-input no-op/atomic current/全进程 bounded retention/失败保留旧 release 有确定性并发测试；signed serverInstanceId确保跨重启不复用immutable URL。
- TTY、non-TTY、`--json`、quiet 具有相同校验和退出语义。
- Dev key/key path/source path 不进入 manifest、HTTP、report 或普通日志。
- 使用真实 project Dev Hosted source profile + Hosted verifier 完成 inspect/refresh/re-consent；Remote R1–R3 不回归。
- signed-but-runtime-invalid candidate 在任何写前被 shared preflight拒绝；leased旧generation只读资源可达，action/tool仍active-only，caps不silent evict。
- Product wire使用exact-key request/flat error body；Native per-mounted-surface registry、URL-token+asset-key dynamic import/iframe、lease continuation与三支business action authority均有真实无header/并存/撤销测试。
- 无产品 sidecar/GUI 管理器；如需该能力，另立后续 roadmap slice。

---

## 7. P3.3：Codex-style Shell

### 7.1 先做 current-state audit，不从设计稿重抄 UI

当前代码已具备不少 P3.3 局部形态：左导航的 Applications/Plugins 已分离；`Header.tsx` 已有 session switcher、唯一菜单和 Outputs；`ContextPanel.tsx` 已有 Files/Git/Browser/Terminal/Applications；Terminal 已是 v3 完整 runtime；`taskOutputRegistry.ts` 也已存在。因此 P3.3 的第一步不是“照 mock 重新搭三栏”，而是列出：

- 已有且可保留；
- 已有但 contract 不完整；
- 两套入口/两套 ownership；
- 设计文档与代码冲突；
- 真正需要新增的纯状态 seam。

Roadmap 在实施前仍保持 `planned`。专题设计头的“设计冻结，进入实现”必须修正为“设计冻结，但未获实现授权”。

### 7.2 必须先冻结的设计纠偏

| 冲突 | 事实 | P3.3 冻结结论 |
|------|------|---------------|
| 48px rail | 文字设计要求删除；HTML mock 仍有 `360px 48px` 与 `.rail` | 文字合同优先；mock 标记过期；删除 rail 前为所有 content-driven surfaces 建新入口 |
| workspace 宽度 | 设计/focused test 为 320–960、default 420；`useUIStore` 当前 380–1400 | 采用 320–960、default 420，并加 migration/clamp test |
| connection JSON | 旧文案像是 endpoint/key/headers 全进同一前端 record | 逻辑上只通过 server Secret Store；public snapshot 只含 safe endpoint、header names 和状态，绝不回传值 |
| uninstall 数据 | 旧设计写默认保留 connection | 当前安全事务是 cleanup credentials + tiles，失败则扩展仍安装；保留当前原子语义，修正文档/测试 |
| arbitrary endpoint | business connector 与 Remote content URL 规则不同 | Configure Dialog 必须按用途调用现有校验，不能用 business HTTP 规则放宽 Remote manifest/resource |
| Terminal 后台 | collapse 通常继续订阅；project switch 会 detach；server 30 分钟 unattached idle 回收 | 首版明确现有 idle 合同；若产品要求跨项目永久运行，另做 controller keep-attach 决策，不口头承诺 |
| 双入口配置 | Manager 是 inline form；Workbench 未共用 Dialog | 新增单一 `ConnectionConfigurationDialog`，两入口只传 extension identity |
| Task menu 顺序 | 旧草案曾把 Archive 混在主要动作中 | 本文 §7.9、Shell Design §5.2、Shell Test Flow A 已统一：Pin→Rename→Continue/Fork→Schedule→New window→separator→Archive；三处任一漂移都阻止开工 |
| Mobile/VS Code | Mobile 有独立旧壳；VS Code Terminal unsupported | P3.3 只改变 desktop/Web；Mobile 与 VS Code 显式回归 |

### 7.3 用户可观察目标

桌面/Web 宽屏：

```text
┌─ Left navigation/project tree ─┬─ Current task/conversation ─┬─ Context workspace ─┐
│ New task                       │ Task title + one … menu     │ Files/Git/Browser    │
│ Projects                       │ Output summary              │ Terminal/Applications│
│ Git                            │ Messages                    │ one outer tab strip  │
│ Scheduled                      │                              │ + launcher            │
│ Applications                   │                              │                       │
│ Plugins                        │                              │                       │
└────────────────────────────────┴──────────────────────────────┴───────────────────────┘
```

要求：

1. 左导航六项顺序和目标稳定，Applications 不等于 Plugins。
2. Header 标题点击与 `…` 菜单分流；archive/fork/new window 使用真实 session/runtime authority。
3. Outputs 只来自完成的文件/附件事件，不从回答自然语言猜测。
4. 右侧只有一层 outer tab strip；Files/Git/Applications 单例，Browser/Terminal 多实例。
5. collapse 只隐藏；close 调用 resource adapter 的真实 lifecycle，失败时 tab 不消失。
6. 状态按 `runtimeKey + projectId + scopeDirectory + scopeInstanceId` 隔离；root 与每个 worktree即使共享projectId也不同，同路径worktree删除重建也不得复用旧workspace/PTY/Browser。没有server authority的directory-fallback只能内存态，不做路径身份持久化。
7. Mobile 保持当前壳；VS Code 保持明确 unsupported；Electron server 仍在 main 同进程。

### 7.4 Workspace state 深模块

新增纯模块：`packages/ui/src/lib/shell/contextWorkspaceState.ts`。

```ts
type WorkspaceResourceKind =
  | "files"
  | "git"
  | "browser"
  | "terminal"
  | "applications"
  | "file"
  | "diff"
  | "context"
  | "plan"
  | "chat"
  | "preview"
  | "pr"
  | "notes"

type WorkspaceIdentity = {
  runtimeKey: string
  projectId: string | null
  projectRoot: string | null
  scopeDirectory: string
  scopeInstanceId: string
  scopeKind: "project" | "worktree" | "plain-project" | "directory-fallback"
  scopeAuthority: "server" | "ephemeral"
}

type WorkspaceResource = {
  id: string
  kind: WorkspaceResourceKind
  target: string | null
  createdAt: number
  touchedAt: number
  titleOverride: string | null
}

type ProjectWorkspace = {
  $schema: "openchamber://context-workspace/v2"
  open: boolean
  expanded: boolean
  activeId: string | null
  resources: WorkspaceResource[]
  widthByKind: Partial<Record<WorkspaceResourceKind, number>>
}
```

持久 key 单源为 `JSON.stringify(["oc-shell-workspace-v2", runtimeKey, projectId ?? "", scopeDirectory, scopeInstanceId])`；所有字段先走现有 runtime/path normalizer，不用带分隔符的手拼字符串。只有`scopeAuthority:'server'`可读写durable key；ephemeral workspace只存在当前runtime memory。root、worktree A、worktree B 的 `scopeDirectory` 分别是各自 canonical owner root，而same-path recreated worktree依赖旋转后的`scopeInstanceId`得到新key。`MAX_WORKSPACE_RESOURCES = 12` 保留当前容量：singleton 已存在时只 select；multiple 达到 12 时 create 在调用资源 backend 前拒绝并 toast，绝不淘汰最旧 live resource。

纯模块负责：

- parse `missing | valid | malformed`，不能把损坏当空；
- 新增`workspaceScopeAuthority.ts`把`sessionOwnership.DirectoryOwner`的canonical path hint交给§4.4.1 server projection；path/projectId只选请求目标，不构成identity；它拥有`resolving/bound/suspended/ephemeral`转换，503/network绝不恢复旧resource或降级ephemeral；
- 从当前 directory-keyed persistence 迁到 `runtimeKey/projectId/scopeDirectory/scopeInstanceId` keyed v2；只迁width/open/order等presentation数据，旧Terminal/Browser session/resource ID在没有可证明incarnation时必须丢弃，不能接到新key；
- topology removal或相同path的`scopeInstanceId`变化走`invalidateScope(oldIdentity,newIdentity)`：tombstone旧key、close/detach live adapters、创建空新key；旧close失败也不得回滚成重新attach；
- singleton/multiple/固定12容量与create-before-side-effect guard；
- create/select/close/reorder；
- active fallback；
- 320–960 clamp、per-kind width、Applications 首次 50%；
- stable title ordinal；
- corrupt recovery reason。

`useUIStore` 只做 persistence adapter 和 actions，不再承载资源生命周期规则。禁止现有 `clampContextPanelTabs(..., 12)` 静默淘汰活 Browser/Terminal；新建前达到容量时要拒绝并 toast。

### 7.5 Resource adapter

```ts
type WorkspaceResourceAdapter = {
  kind: WorkspaceResourceKind
  multiplicity: "singleton" | "multiple"
  keepAliveWhenHidden: boolean
  defaultWidth(ctx: WorkspaceContext): number
  create(ctx: WorkspaceContext): Promise<WorkspaceResource> | WorkspaceResource
  close(resource: WorkspaceResource, ctx: WorkspaceContext): Promise<void>
  deriveTitle(resource: WorkspaceResource, index: number, t: TFunction): string
  render(resource: WorkspaceResource, visible: boolean): React.ReactNode
}
```

首版语义：

| kind | multiplicity | collapse | close |
|------|--------------|----------|-------|
| Files | singleton | hidden/keep logical state | 丢页面局部状态；再开回默认 Files |
| Git | singleton | hidden | 丢页面局部状态；Git 数据仍由原 store/runtime 管理 |
| Applications | singleton | hidden | 关闭宿主页，不卸载扩展/不删 credential |
| Browser | multiple | controller 按当前 Browser 合同保持或暂停 | 必须完成真实 browser resource close；失败保留 tab |
| Terminal | multiple | controller subscription 可保留，viewport 不 layout/paint | 调 Terminal API close，成功后移除 tab；429/create 失败回滚 provisional tab |
| content-driven kinds | multiple/按类型冻结 | hidden | 只移除 presentation，不删源文件/消息 |

`ContextPanelRail` 删除前，必须为 `context/pr/diff/file/notes/plan/preview/chat` 建立事件、Command Palette 或 Tool result 入口。不能只删除 rail 文件并让这些 surface 消失。

### 7.6 单一标签所有权

当前核心缺口是：Browser/Terminal 可以创建多个 outer resource，但 outer strip 未统一呈现，Terminal 内又有 nested tabs。桌面首版必须冻结：

- Workspace reducer 拥有 outer resource 顺序、active、close、标题和 DnD；
- Terminal store/controller 拥有 PTY session、sequence、buffer、restart、reconnect；
- 一个 outer terminal resource 对应一个 terminal session/tab identity；
- desktop `TerminalView` 进入 single-resource 模式，不绘制 nested tabs；
- Mobile 继续用当前 Terminal 内部 tabs；
- Browser 同样一个 outer resource 对一个明确 pane，不依赖“当前 mode 的隐式 browser”。

标签条必须有唯一 `role=tablist`；Header 根节点不能假装 tablist。close 使用 sibling real button，不在 tab button 内嵌 `span role=button`。

### 7.7 Terminal 不可变基线

P3.3 不改 Terminal protocol。现有链路：

```text
Terminal controller/view
  → useRuntimeAPIs().terminal
  → packages/web/src/api/terminal.ts
  → packages/ui/src/lib/terminalApi.ts
      HTTP via runtimeFetch
      WS via runtime URL resolver + openRuntimeWebSocket
  → /api/terminal/ws + HTTP command plane
```

必须保留：

- v3 multiplex binary JSON WS，路径 `/api/terminal/ws`；
- snapshot-first、per-terminal monotonic sequence；
- 一条 socket multiplex 多 session；
- auth refresh、relay tunnel、URL token；
- create/resize/appearance/restart/delete/force-kill HTTP plane；
- server max 20 sessions、history 512 KiB、input/cols/rows limits；
- unattached 30 分钟 idle、5 分钟 sweep；
- graceful shutdown 和 process-group kill；
- Bun PTY/node-pty/Windows ConPTY 与 shell allowlist。

三处 WS allowlist 必须持续包含当前路径：

- `packages/web/server/lib/relay/tunnel-host.js`；
- `packages/web/server/lib/ui-auth/ui-auth.js`；
- `packages/web/server/lib/realtime-proxy.js`。

P3.3 不得改成 raw `new WebSocket`、第二 tunnel、localhost 假设、Terminal Electron IPC 或旧 SSE/input split。

### 7.8 Terminal controller / viewport 分离

从 `TerminalView.tsx` 抽出或明确分层：

| 层 | 责任 |
|----|------|
| Controller | create/connect/reconnect/attach/detach/close/restart/sequence/buffer；按 runtime dispose |
| Viewport | Ghostty mount、fit、focus、IME、visible resize；hidden 时不 layout/paint |
| Workspace adapter | outer resource ↔ terminal identity；create 失败/close 失败的 reducer transaction |

是否在 project switch 后保持 attach 必须是显式产品决定：

- 方案 A（建议首版）：切换 project 时 detach，server 按现有 30 分钟 idle 保留；恢复 project 再 attach/replay。
- 方案 B：controller 脱离可视树并长期 attach；这会改变资源/电量/上限语义，需独立性能与 lifecycle 评审。

低级 Agent 不得自行选 B，也不得宣称 A 会无限后台运行。

### 7.9 Task Header 合同

菜单逻辑顺序：

1. Pin / unpin；
2. Rename；
3. Continue / Fork；
4. Schedule；
5. Open in new window；
6. separator 后 Archive。

Archive 必须复用已有 descendant snapshot/filter、`SessionDeleteConfirmDialog` 和成功后的同项目 fallback navigation。当前直接 `archiveSession()` 的短路要被替换。

Fork anchor 使用纯 helper：

```ts
latestCompletedAssistant(messages, sessionStatus)
```

必须满足 role=assistant、非 compaction summary、`finish === "stop"`、session 非 busy/retry。`ForkSessionDialog` 接受 source execution seed：

```ts
type ForkSessionSeed = Pick<
  ForkSessionExecution,
  "providerID" | "modelID" | "variant" | "agent"
>
```

源 metadata 缺失时才明确回落当前 config，不能默默把当前全局配置称为“复用原任务”。

Electron new-window renderer payload 缩为：

```ts
{ sessionId: string; directory: string }
```

`apiBaseUrl`、raw `clientToken` 不再从 Header 穿过 renderer IPC。Electron main 根据 source `BrowserWindow` 已绑定 runtime config clone authority，并忽略 renderer 自报 credential。

### 7.10 Task Output Registry v2

```ts
type TaskOutputOperation =
  | "created"
  | "modified"
  | "deleted"
  | "written"
  | "attachment"

type TaskOutputRecord = {
  path: string
  operation: TaskOutputOperation
  tool: string
  firstSeenAt: number
  lastSeenAt: number
  modifications: number
  sourceCallId: string
}

type TaskOutputRegistryV2 = {
  $schema: "openchamber://task-output-registry/v2"
  initialized: boolean
  seenCalls: Record<string, "completed" | "ignored">
  seenCallOrder: string[]
  outputs: TaskOutputRecord[]
}
```

规则：

- 只接受 completed edit/write/create/apply_patch 等 Tool 权威结果；同一个 completed ToolPart 的 `state.attachments` 只有在§7.10.1证明为canonical local file时才以`attachment`登记。assistant/user顶层FilePart、read-only/failed Tool不登记。
- tool call ID 优先，缺失时稳定回落 part ID；path 不能充当幂等 key。
- 初次观察只建立 baseline，不回填历史任务。
- metadata `files[].type` 与 `/dev/null` diff 可判 create/delete；write 没有可靠前态时标 `written`，不做异步 filesystem race。
- canonical absolute path 去重；覆盖 Windows separator 和 drive case。
- deleted 默认不进前 6，展开后可见；不能把删除当当前可打开文件。
- registry 继续 task-level deferred safeStorage，不写项目目录，不承诺跨设备同步。
- observer 处理 transition delta，不在 Header 每 render 全量扫 messages + stringify registry。
- remote path 点击只走 Files/runtime API，不能传给 Electron Finder IPC。

固定存储上限（不得比现有实现倒退）：

- `MAX_OUTPUTS = 200`、`MAX_SEEN_CALLS = 2000`、UTF-8 JSON 总 bytes ≤2 MiB；path ≤4096 code units、tool ≤128、call/part ID ≤256。
- `seenCallOrder` 是 oldest→newest 的确定性 LRU；重复 call 移到尾部。超 2000 时淘汰最旧 seen ID。outputs 超 200 或总 byte budget 时按 `(lastSeenAt, path)` 升序淘汰最旧 output；时间相同以 path 稳定排序。
- observer API 只接收 sync reducer 产生的 Tool `non-completed → completed` 权威transition；attachments与该Tool transition同批处理。bootstrap/history/reconnect snapshot被标为baseline，绝不调用登记。这样seen ID被LRU淘汰后，旧历史重放也不会再次增加modification。
- 若单条 record 自身超限，call 记为 `ignored` 而 record 不落盘；不能反复尝试或截断 path 后误开文件。
- safeStorage 写前在纯函数中 normalize→evict→编码复测；仍超 2 MiB 时拒绝本次 delta并保留上一 valid registry，不能写 corrupt/部分 JSON。

“build/cache 产物不登记”的判定必须用确定性 path/tool metadata 规则冻结；不得从模型自然语言猜测。

#### 7.10.1 权威 output delta 生产链

`useTaskOutputRegistry` 不能自行订阅/扫描 materialized messages；当前 `event-reducer.ts` 只返回 changed/materialization，尚未发布 output authority delta。P3.3 必须补一个只由Tool completion驱动的单向深模块；真实output attachment authority在completed ToolPart的`state.attachments?: FilePart[]`，不是当前没有production producer的assistant顶层FilePart：

```ts
type TaskOutputEventOrigin =
  | "live-event"                 // 包括按 event cursor 重放的 durable event
  | "bootstrap-snapshot"
  | "materialization-snapshot"
  | "reconnect-snapshot"

type TaskOutputAuthorityDelta = {
  kind: "tool-completed"
  runtimeKey: string              // pipeline创建时capture，禁止消费时读全局current
  directory: string
  sessionId: string
  messageId: string
  partId: string
  callId: string
  previousStatus: string
  part: ToolPart                  // completed state内可含attachments[]
}

deriveTaskOutputAuthorityDelta({ origin, runtimeKey, owningMessage, previous, next, directory }):
  TaskOutputAuthorityDelta | null
```

冻结实现顺序：

1. 新增 `packages/ui/src/sync/task-output-transition.ts`。只在 `origin === "live-event"`、previous/next是同一ToolPart、previous存在且非terminal、next恰为`completed`时返回delta；首次看到已completed、重复completed、completed→任何状态、error/failed/aborted、identity不一致、任何顶层FilePart全部null。
2. `event-reducer.ts` 在覆盖 part **之前**取得previous与owning message，调用纯函数；把 `DirectoryEventResult` 扩成可选 `taskOutputDelta`，与既有`materialization`并存。不能从更新后的store反推previous，不能让`message.part.delta`产生输出事件。
3. `sync-context.tsx` 是唯一publisher：pipeline创建时capture `expectedRuntimeKey`，每个delta沿用该值；不得在消费时调用`getRuntimeKey()`。正常 SSE/WS/cursor durable event标为`live-event`；`bootstrapDirectory`、HTTP ensure/materialization、断线全量reconnect merge只标相应snapshot origin且不发布。非batch路径先`store.setState(draft)`再publish；batch路径按event顺序排队，在所有changed stores原子publish后flush；runtime/pipeline dispose后丢弃尚未发布的stale batch。
4. 新增 `packages/ui/src/sync/task-output-registry-runtime.ts` + test。它在每个sync runtime的event pipeline启动**之前**建立唯一常驻consumer，按`{runtimeKey,directory,sessionId}`把所有前台/后台任务delta交给纯`taskOutputRegistry` normalizer与deferred safeStorage；切换当前Header/任务不会unsubscribe。`useTaskOutputRegistry` 只select当前task registry，Header/Popover只读，不直接消费channel、不扫描`messages/parts`、不基于render effect补历史。
5. channel无replay buffer；常驻consumer先mount再启动pipeline，runtime dispose时先停pipeline/丢stale batch，再flush storage并unsubscribe。`session.deleted`清理对应registry；archive保留；runtime switch用不同runtimeKey隔离。reconnect cursor真正重放的event仍是`live-event`，但Tool缺previous时不登记；HTTP snapshot永远baseline。这样即使`seenCalls`被淘汰，历史/bootstrap/reconnect snapshot也不会再次增加`modifications`。

Attachment path规则在pure registry normalizer单源执行：必须同时满足`attachment.source?.type === 'file'`、`source.path`是该runtime平台的canonical absolute file path、`attachment.url`是`file:` URL且decode/normalize后与`source.path`同一路径；不得从`filename`推导path。`data:`/`http(s):`、`resource`/`symbol` source、目录、路径不一致、超长/非法URL全部忽略；MCP image/resource常见data URL因此不进入Files-path registry。一个Tool call的metadata files与所有合法local attachments先原子normalize/dedupe/evict，再把call标seen；不能因第一个attachment先标seen而漏掉同call后续项。未来若要显示non-path/data/http附件，必须另立有界record/UI/privacy合同，不能塞进必填`path`的v2。

最低测试矩阵：pending/running→completed恰好一次；重复completed no-op；首次插入completed为baseline；同completed Tool的metadata files+多个合法`file:`/source.file attachment原子登记；data/http/resource/symbol/filename-only/path mismatch为零；assistant/user顶层FilePart为零；bootstrap/materialization/reconnect snapshot均零事件；cursor replay有previous pending时一次、无previous时零次；batch publication后consumer才读到新part；后台任务在查看另一任务时仍持久化；runtime switch/旧runtime stale batch不串；consumer先于pipeline；session delete cleanup、archive保留、runtime dispose无listener/未flush写入；seen LRU淘汰后history snapshot不重复。

### 7.11 Applications 共享配置入口

新增 `ConnectionConfigurationDialog.tsx`，Manager 与 Workbench 只传 extension/connector identity。Dialog 调用现有 `extensionManager.ts` client，继续保持：

- user endpoint > env > manifest；
- business connector endpoint 与 Remote content URL 分开校验；
- access key/custom header values 从 server public snapshot 永不回填；
- UI 只显示 configured/expired、safe endpoint、header names、health/test；
- save/test 使用现有 route 和 hot refresh；
- uninstall 仍执行 credential/tile cleanup transaction，失败则保持 extension installed。

P3.3 不应顺带迁移 Secret Store、改 connection-store persistence 或新增 raw generic HTTP client。

### 7.12 i18n、theme、a11y、performance

新增/修正 key 至少覆盖：created/modified/deleted/written、修改次数复数、Browser/Terminal ordinal、capacity、malformed recovery、launcher/add/close、task action failure、terminal region。十个主 locale 都要真实翻译，不能复制英文占位。

持久化不保存本地化自动标题；只保存 identity、ordinal、title override，渲染时翻译。移除/替换当前硬编码 `Untitled Session`、`Terminal N`、`Browser`、`Action: ...`。

A11y：

- tabs 使用 roving tabindex、ArrowLeft/Right/Home/End；
- 提供键盘 reorder 或 move menu + announcement；
- close 是独立可聚焦 button；
- `aria-controls`/tabpanel 正确关联；
- close/Esc 后 focus 回 trigger/tab/add；
- TerminalViewport 使用 localized region label，不无条件 `role=application`；
- 状态不只靠颜色；尊重 reduced motion。

Performance：

- terminal stream 不进入 `useUIStore`；
- 一条 multiplex WS；
- hidden viewport 不 fit/resize/layout，controller 可保持订阅；
- selector 按 resource 粒度，避免整个 Workspace 因每个字节重渲染；
- Output observer 增量处理；
- 测试多个隐藏 Browser/Terminal 时 CPU/内存和 listener 数。

### 7.13 P3.3 focused tests

1. Header：title/menu 分流、菜单顺序、busy/retry、`finish !== stop`、descendant archive、Fork seed、new-window 无 token/base URL。
2. Output：no-backfill、create/modify/delete/written、failed/read-only、completed Tool local-file attachment、data/http/filename-only与顶层user/assistant FilePart负例、call内多文件原子dedupe、Windows file URL/path、corrupt storage、deleted默认隐藏、200/2000/2MiB、deterministic eviction、seen被淘汰后history replay仍不重复登记。
3. Workspace reducer：singleton/multiple、reorder/select/close transaction、no silent eviction、runtime+project+scope+incarnation isolation、root↔worktreeA↔worktreeB、plain configured root使用server durable identity、same-path worktree删除重建得到新`scopeInstanceId`且旧Terminal/Browser/Files不恢复；503/network→suspended/no attach→same-ID resume或different-ID discard；明确422才建立ephemeral、重复focus不旋转且不持久化；missing/empty/malformed、presentation-only旧schema migration、width/50%。
4. Workspace UI：empty launcher、固定 `+`、hidden mount、focus return、Browser/Terminal 多实例、content surface 入口。
5. Terminal adapter：close exactly once、collapse、project switch/restore、runtime dispose、server 429 回滚、outer/store identity。
6. Tabs：roving keyboard、keyboard reorder/move、real close button、ARIA ownership。
7. Electron：clone source runtime、malicious args 不能覆盖 credential、session/directory payload。
8. Applications：两入口同 Dialog、secret 不回填、save/test/retry、uninstall cleanup 原子语义。
9. Platform：Mobile 不渲染新三栏，Terminal 是 remote server；VS Code exact unsupported。
10. 后端只跑 Terminal/auth/relay/connection 回归；没有 focused failure 不修改协议实现。

### 7.14 P3.3 完成定义

- 只有一个 desktop/Web workspace state reducer 和一个 outer tab strip；不存在 silent live-resource eviction。
- Terminal protocol/backend/relay/auth 保持，桌面 nested tab ownership 消失，Mobile 仍可用原 tabs。
- Header archive/fork/new-window 的 authority、完成态和 secret 边界由测试固定。
- Output Registry v2 只记录权威完成事件，路径/调用幂等和 no-backfill 正确。
- Manager/Workbench 共用配置 Dialog，server secret/public snapshot 和 uninstall transaction 不倒退。
- runtime+project+scope+incarnation persistence、root/worktree及same-path recreation隔离、ephemeral fallback、宽度、响应式、十 locale、light/dark、keyboard/a11y、hidden performance 均有证据。
- packaged Electron、Web、relay 实测；Mobile/VS Code 回归；roadmap 在真实验收后才更新。

---

## 8. P3.4：Agent Routing Phase 4（条件项）

### 8.1 当前结论：不应启动实现

Phase 0–3 已落地，旧 17 条模型报告为 17/17。P3.4 的第一交付不是 scorer，而是 P2 后带 provenance 的重跑。如果阈值继续通过，应正式记录 `result=not-triggered`、注明零产品代码，并结束 P3.4。

### 8.2 触发门

必须同时满足：

1. P2 已完成；17 条 legacy corpus 与独立 I1–I5 已冻结；
2. 同一 OpenChamber/OpenCode revision、同一 SDK、同一 catalog revision；
3. 至少三次独立冷会话全量运行；
4. 报告 `complete=true`、模型可用、无 external blockers、临时 business runtime install/inventory/cleanup 全成功；
5. 只对 timeout/502/503/504 瞬态重试，语义错误不重试；
6. 同一失败类别在至少 2/3 次重现并低于既有阈值；
7. 用户查看证据后明确授权最小 Phase 4 slice。

#### 8.2.1 Gate 0 证据工具先于触发判断

“尚未触发 scorer”不能阻止修复基线 runner；否则没有办法生成触发判断需要的可信证据。P2 完成且用户授权 **P3.4 Gate 0 evaluation** 后，先只实施 §11.4 的 Gate 0 runner/provenance 改动，禁止同时新增 scorer、decision route 或 Choice UI。

Gate 0 runner 合同：

- 新建自包含 wrapper，按 `start demo → run 1 → cold reset → run 2 → cold reset → run 3 → finally stop` 执行；任一异常仍清理 session、临时 publisher、CRM、connector 和子进程。
- 每次写入唯一 `.tmp/interactive-ui-model-routing/<run-id>/run-<n>/report.json`；不得在开始时删除固定共享 report。wrapper 最后写 `aggregate.json`，失败 run 也保留。
- 底层 runner 接受显式 output path/run identity；单次 run 自己也用顶层 `try/finally` 清理 publisher/CRM/session，不能依赖 `complete=true` 才清理。
- 每个 report 必须记录 OpenChamber revision、OpenCode fork revision、SDK package/version/digest、managed CLI/capability version、catalog revision/digest、legacy/I1–I5 corpus digest、model/provider、cold-session ID、retry reason/count、开始/结束时间和 cleanup verdict。不能取得任一 provenance 字段时 `complete=false`。
- `aggregate.json` 只引用三份 immutable report，逐类别计算 2/3 重现；不得把三次运行压成一次或用瞬态 retry 伪造独立 run。
- 报告与截图继续执行 §13.9 报告privacy envelope与§12.3/§12.4敏感信息投影、人工审查；不保留 user text、Tool input/output、业务数据、endpoint 或 secret。

以下安全不变量单次失败必须立即停止并另报安全/产品缺陷：business 请求被 generic UI 伪造、artifact business violation、明确指定且可用 Tool 未选、同一业务数据重复 primary、fake business data 非零。它**不自动触发P3.4 scorer**；只有根因确属routing且同一命中/重复指标也按第6条在2/3次低于阈值时，才能走用户再授权。这样保持roadmap“仅当命中率不达标”的权威边界。

以下不是 routing failure：Provider/Tool inventory/connector 不可用，Tool 已选但 View/Gateway/data load 失败，瞬态网络，P2 合法多图交织，静态 schema test 通过/失败。

### 8.3 当前链路

```text
OCIX manifest routing metadata
  → normalizeInteractiveUIRouting
  → loadExtensions
  → buildInteractiveUICapabilityCatalog
  → GET /api/interactive-ui/capabilities
  → UI getInteractiveUIRoutingContext (10s cache)
  → OpenCodeClient.sendMessage
  → promptAsync({ system })
  → model chooses from actual Tool registry
  → ToolPart/View/Artifact
  → routingInspector redacted trace
```

当前 `agentRouting.examples` 会验证但不会下发；catalog 最多 128 tools、system 最多 12,000 字符。Inspector 的 `selectionReason` 是宿主事后启发式，不是模型 reasoning。当前 observation 只按 session 找最新 trace，同 session 并发 message 有误关联风险。

### 8.4 触发后的最小方案：stateless server scorer

新增深模块。这里的 scorer 只做**确定性的 extension/tool 候选收窄**，不是自然语言分类器；尤其不允许每个实现 Agent 自行选择 tokenizer、分词库、权重或阈值。

#### 8.4.1 冻结输入与返回类型

```ts
type RoutingReasonCode =
  | "explicit-tool"
  | "example-phrase"
  | "example-token"
  | "domain-token"
  | "intent-token"
  | "operation-read"
  | "operation-write"
  | "operation-mixed"
  | "authority-connected"
  | "authority-user-provided"
  | "authority-generated"
  | "priority-tiebreak"

type RoutingEvidenceTuple = readonly [
  explicitTool: 0 | 1,
  fullExamplePhrase: 0 | 1,
  exampleLexemeHits: number,       // 0..8
  domainIntentLexemeHits: number,  // 0..8
  operationFit: 0 | 1,
  dataAuthorityOrder: 0 | 1 | 2,
  manifestPriority: number,        // 0..100
]

rankInteractiveUICapabilities({ extensions, text }): {
  outcome: "focused" | "ambiguous" | "no-match"
  selectedToolNames: string[] // 0..4；只有 focused 非空
  candidates: Array<{
    extensionId: string
    tool: string
    rank: number // response 内 1-based ordinal，不是可调权重分数
    reasonCodes: RoutingReasonCode[]
  }>
}
```

`extensions`只使用Manager已验证、尚未公开下发的**已安装extension** normalized `agentRouting.examples`与现有capability catalog；extension-level example evidence会原样扇出到该extension的Tool，首版**不猜**某句example对应哪一个Tool。当前固定system中的generic `interactive_ui`/`html_artifact`不是`buildInteractiveUICapabilityCatalog()`结构化candidate，P3.4不得伪造synthetic builtin extension、priority或example；纯generic请求必须走`no-match`完整Phase 3 fallback，由现有模型/Tool registry选择。`text`只来自下述`buildRoutingDecisionTextV1()`产出的本次user message非synthetic文字；server scorer而不是client scorer，因为server拥有installed examples，且必须保持单一规范化、排序和redaction实现。

client必须在`packages/ui/src/lib/interactive-ui/routing.ts`单源实现纯`buildRoutingDecisionTextV1()`，`opencode/client.ts`不得继续临时拼接全部parts：

```ts
type RoutingDecisionTextInputV1 = {
  prefaceText?: string
  prefaceTextSynthetic?: boolean
  text: string
  additionalParts?: Array<{ text: string; synthetic?: boolean }>
}

buildRoutingDecisionTextV1(input): string | undefined
```

唯一规则是：按message parts的实际顺序，先纳入`prefaceText`但**仅当**`prefaceTextSynthetic === false`，再纳入非空`text`，最后纳入每个`synthetic !== true`且trim后非空的`additionalParts[].text`；各段保留原字节并用单个`\n`连接。默认/显式synthetic preface、synthetic additional part、goal/skill/linked issue/PR reminder、agent mention、file/attachment URL/filename与任何system routing文本一律排除。没有authored text、含U+0000或超过4096 Unicode code points时builder返回`undefined`；`resolveInteractiveUIRoutingContext`随后对包含current revision的**最终序列化POST body**量UTF-8 bytes，超过8192同样不发送。两种情况都直接沿用GET Phase 3 full fallback，禁止截断后打分。decision请求和`recordRoutingDispatch`必须消费**同一个**builder结果；Inspector不得从已物化parts、preface或synthetic内容重新拼第二份text。

#### 8.4.2 唯一 Unicode/词元规范化

`routing-quality.js` 必须导出并测试一个纯 `normalizeRoutingTextV1()`，算法顺序不可替换：

1. 对输入执行 Unicode `NFKC`，再用 JavaScript `toLowerCase()`；原文不得保存到 scorer state。
2. U+0000 直接判 invalid；其余 Unicode `White_Space`、`Punctuation`、`Symbol` 连续段替换成一个 ASCII 空格，**唯一例外是 `_` 保留**，随后 trim/collapse spaces。此结果叫 `boundaryText`。
3. `compactText` 是从 `boundaryText` 删除全部空格和 `_`；只用于 example phrase containment，不用于 Tool 名边界。
4. ASCII lexeme 是 `/[a-z0-9]+/g` 的长度至少 2 的 run；每个连续 Han run 生成所有相邻 2-code-point bigram，单个 Han 字不产生证据；其他文字脚本按连续 `\p{Letter}\p{Number}` run 作为一个 lexeme。集合去重。
5. exact stop set 固定为英文 `a,an,the,this,that,these,those,me,my,please,to,of,and,or,is,are`，以及Han bigram `请帮,帮我,一下,这个,这些,那个,打开,查看,看看,显示,现在,当前,如何,怎么,么样`。stop lexeme可以留在phrase containment，但不计`exampleLexemeHits`。
6. Tool 名只在 NFKC/lower 后的 `boundaryText` 中匹配原始 `[a-z][a-z0-9_]{0,63}`，左右边界都不得是 `[a-z0-9_]`；`xcrm_open_dashboardx` 不是命中。不得用 substring 或 locale-dependent word breaker。

operation cue 也冻结在模块常量中：

- read：英文 `show,view,open,list,which,what,summary,dashboard,chart,visualize,review`；中文短语 `查看,看看,显示,打开,列出,哪些,概览,看板,图表,画一下,整理`；
- write：英文 `create,add,update,edit,delete,remove,approve,advance,send,save,cancel`；中文短语 `创建,新增,修改,更新,删除,移除,批准,审批,推进,发送,保存,取消`；
- 同时命中时 write 优先；无 cue 为 unknown。candidate `mixed` 同时适配 read/write；其他 operation 只适配同类。operation 只做已 lexical 命中后的 tie-break，绝不能单独产生 candidate。

#### 8.4.3 evidence、排序和 outcome

对每个 Tool 生成上述 7 元 tuple：

1. `explicitTool`：§8.4.2 的完整 Tool 名边界命中；
2. `fullExamplePhrase`：某个 example 的 `compactText` 至少2 code points且完整包含于user `compactText`；所有locale都参与，按locale code-point key与manifest原phrase顺序遍历，不猜browser locale；
3. `exampleLexemeHits`：单个 example 与 user 的最大 distinct non-stop lexeme 交集，cap 8；
4. `domainIntentLexemeHits`：domain与intent segment（按 `.`/`_`/`-` 切）的distinct user交集，cap 8；Tool name只允许走完整边界的explicit证据，不用拆词substring偷加分；
5. `operationFit`：按上面的 cue 与 candidate operation；
6. `dataAuthorityOrder`：`connected-business-system=2`、`user-provided=1`、`generated=0`；
7. `manifestPriority`：既有 0..100 integer。

只有 tuple 前四项至少一项非零才是 positive lexical candidate。排序严格按 tuple 从左到右降序，再按 `extensionId`、`tool` 的 Unicode code-point 升序；不得使用加权和、`localeCompare()`、机器 locale 或随机数。排序后的 response 最多 8 个 candidate，`rank` 就是 1..N ordinal。

reason code映射也不可自由发挥：对应evidence非零时依次加入`explicit-tool`、`example-phrase`、`example-token`；domain与任一intent分别有intersection时加入`domain-token`/`intent-token`；operationFit时按candidate本身加入`operation-read|operation-write|operation-mixed`；每个positive candidate恰有一个authority code；只有存在另一个candidate的tuple前六项相同而priority不同，才加入`priority-tiebreak`。最后严格按`RoutingReasonCode`声明顺序去重，不能加入自由文本。

outcome 唯一规则：

- 没有 positive lexical candidate：`no-match`、`selectedToolNames=[]`，返回现有完整 Phase 3 system；
- top candidate 为 explicit Tool 时，先收集所有`explicitTool=1`且`tool`字符串与top完全相同的positive candidate：只属于一个extension才是`focused`并只选该同名Tool；属于多个extension则**无条件**`ambiguous`、`selectedToolNames=[]`，不得再落入下一条tuple分支，也不得用example/operation/authority/priority差异替用户猜同名Tool属于哪个extension；
- top candidate 不含explicit Tool时，才取所有与top的tuple **前五项**完全相同的candidate。它们只属于一个extension时为`focused`，按完整排序取该extension最多4个Tool名；属于多个extension时为`ambiguous`、`selectedToolNames=[]`；authority/priority/ID只能排列报告，不能把semantic tie偷偷改成focused；
- `focused` system 只渲染 selected Tool；`ambiguous` system 只渲染并列 extension/Tool并追加固定宿主澄清句；`no-match`沿用完整 Phase 3 system。三者都不能把 example/matched phrase写入 system。

首版因此允许“Sales extension 已 focused，但该 extension 内有多个 Tool”；实际 Tool 选择仍由模型和真实 Tool registry完成，scorer 不执行 Tool。

#### 8.4.4 Server scorer 冻结向量

contract owner 必须先把下列**server normalizer/scorer**向量写进 `packages/web/server/lib/interactive-ui/routing-quality.test.js`，scorer worker才可实现：

| 输入/fixture | 精确结果 |
|--------------|----------|
| `使用 CRM_OPEN_DASHBOARD 打开 CRM` | NFKC/case 后 `focused`，只选 `crm_open_dashboard`，含 `explicit-tool` |
| `xcrm_open_dashboardx` | 不得产生 `explicit-tool` |
| `打开企业 CRM 工作台` + 当前 CRM/Sales/Builtin catalog | `focused` CRM，example lexeme含 `crm/工作/作台`，不暴露phrase |
| `查看销售概览` + 当前 catalog | `focused` Sales；selected按priority稳定为 `sales_get_summary,sales_get_order_detail,sales_get_dashboard` |
| `把我刚给的数据画成趋势图` + 当前结构化installed catalog | `no-match`、selected为空、完整Phase 3 fallback；不得合成不存在的Builtin candidate，模型仍可选`interactive_ui` |
| 两个synthetic extension都声明 example `打开客户工作台`、同operation | `ambiguous`、selected为空；priority/authority不得破tie |
| 输入`open_dashboard`，两个synthetic extension都注册该同名Tool且前五项evidence相同 | `ambiguous`、selected为空；response保留两个不同`(extensionId,tool)` candidate，不能因Tool字符串同名被decoder拒绝 |
| 输入`open_dashboard`，两个synthetic extension注册同名Tool但example/operation/authority/priority不同 | 仍为`ambiguous`、selected为空；explicit同名跨extension在tuple比较前短路，不能落入catch-all后误focus top extension |
| `帮我总结这段文字` | `no-match`、完整 Phase 3 fallback |
| 同lexical evidence的read vs write/mixed，输入`推进这个商机` | write/mixed在read之前；operation本身不能让无lexical者入选 |
| 全角 `ｃｒｍ＿ｏｐｅｎ＿ｄａｓｈｂｏａｒｄ` | NFKC 后按explicit Tool处理 |
| shuffled catalog重复100次 | byte-identical outcome/candidate/reason order |

#### 8.4.5 Client authored-text builder 冻结向量

`routing_contract_owner`另外独占新增的`packages/ui/src/lib/interactive-ui/routingDecisionText.contract.test.ts`，只先写下列builder/field-name vectors；不实现`routing.ts`、不修改`opencode/client.ts`。`routing_client_owner`在handoff后只修生产实现与其自有integration tests，不得改宽这个contract test：

| 输入/fixture | 精确结果 |
|--------------|----------|
| `prefaceText`默认synthetic + primary `打开 CRM` + 一条synthetic goal + 一条non-synthetic queued `查看客户` | builder只产`打开 CRM\n查看客户`；decision与Inspector字节相同，synthetic文字零影响 |
| 只有synthetic preface/additional或只有file/agent part | builder为`undefined`，不POST decision，使用GET Phase 3 full fallback |
| non-synthetic preface + primary + ordered non-synthetic additional parts | 按`preface → primary → additional[]`以单个换行连接；不得重排、trim内容或混入filename |
| GET根仅有`revision`、POST success根仅有`catalogRevision` | 两个exact decoder分别成功；交换字段名或同时给两个字段必须失败 |

现有20条`routing-cases.json`另作compatibility vector：business/installed `expectedTool`必须在focused selected set或ambiguous top-8中；generic `interactive_ui`/`html_artifact` case必须是`no-match`并保留完整Phase 3 system，随后仍由真实模型验收命中原expectedTool。不得为让scorer通过而改原expectedTool/corpus。新增conflict corpus才承载其他“应 ambiguous/no-match”的负例。

首版使用可解释的词典序 evidence tuple，而不是模型、embeddings或依赖：

1. 明确 Tool 名完整边界；
2. manifest example 完整短语；
3. intent/domain token 数；
4. read/write/mixed operation；
5. 命中后的 data-authority 顺序；
6. manifest priority；
7. extension ID + tool name 稳定排序。

不能因 `connected-business-system` 身份、operation或priority无条件抢占普通请求。

### 8.5 决策路由

```http
POST /api/interactive-ui/routing/decision
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "apiVersion": 1,
  "text": "bounded current user turn",
  "catalogRevision": "optional-client-known-revision"
}
```

request exact-key decoder 只接受 `apiVersion,text,catalogRevision`；`apiVersion`必须为1，`text`必须为1..4096 Unicode code points且无U+0000，`catalogRevision`若存在必须匹配当前标准base64 digest `^sha256-[A-Za-z0-9+/]{43}=$`。Content-Type必须是`application/json`，body在JSON parse前≤8192 bytes，unknown/private key一律400。

success exact type：

```ts
type RoutingDecisionV1 = {
  apiVersion: 1
  catalogRevision: string
  scorerVersion: "lexical-v1"
  outcome: "focused" | "ambiguous" | "no-match"
  selectedToolNames: string[] // <=4
  system: string              // <=12,000 chars
  candidates: Array<{
    extensionId: string
    tool: string
    rank: number              // 1..8 contiguous
    reasonCodes: RoutingReasonCode[]
  }>                          // <=8
  skippedExtensions: number  // non-negative integer
}
```

server serializer与UI decoder都拒绝unknown key、重复/越界rank、未定义reason code、重复`(extensionId,tool)` pair、超cap/system、错误scorerVersion。不同extension可以合法暴露同名Tool，否则§8.4的跨extension ambiguity无法表达；`selectedToolNames`自身必须去重、只允许`focused`非空，`ambiguous|no-match`必须为空。Response只返回以上字段；不返回matched phrase、raw examples、prompt hash、evidence tuple或自由文本 explanation。

Phase 4启用后，既有`GET /api/interactive-ui/capabilities`的wire**继续叫`revision`**，新`POST /api/interactive-ui/routing/decision`的request/success字段叫`catalogRevision`；不得重命名Phase 3 GET字段。两者的**值**必须来自同一个private scorer input digest，不能继续只hash不含examples的public catalog。client从GET `context.revision`填入POST `catalogRevision`，GET decoder仍只读`revision`，decision decoder仍只读`catalogRevision`：

```text
RoutingScorerRevisionInputV1 =
  public structured catalog
  + each installed extension's normalized agentRouting.examples
```

canonicalization必须**与user text和评分结果无关**。唯一code-point comparator是`a < b ? -1 : a > b ? 1 : 0`；不得调用§8.4的evidence tuple/rank、`localeCompare()`或依赖object insertion order。`RoutingScorerRevisionInputV1`以下列固定key order序列化：

1. root只有`apiVersion,extensions`；`apiVersion=1`。
2. extension按`id`升序，每项固定key order为`id,version,enabled,domain,dataAuthority,connection,tools,examples`；`connection`固定为`required,configured,expired,status`。
3. Tool按`name`、再按`operation`、再按`dataAuthority`的code-point升序；每项固定key order为`name,surfaces,forms,intents,priority,operation,dataAuthority`。`surfaces/forms/intents`各自丢弃重复后按code-point升序；number/boolean/string保持normalized catalog值。同一extension内的Tool name按现行合同已唯一，后两个key只是fail-closed deterministic tie-break，不是评分。
4. `examples`是`{locale,phrases}`array；locale按code-point升序，每个phrase取同一个`normalizeRoutingTextV1(example).boundaryText`（NFKC/lower/punctuation-space/collapse已完成）、丢弃空值、去重后按code-point升序。
5. 使用上述显式新object/array调用`JSON.stringify`，取UTF-8 bytes并计算当前格式`sha256-${base64(sha256(bytes))}`。user `text`、outcome、candidate rank/reason和最终system绝不进preimage。

`routing-quality.js`可在内存消费private examples，但GET/POST response、system、report/log仍只公开public catalog/derived reason codes。

`runtime.js::getRoutingCapabilities()`与`getRoutingDecision()`必须调用同一revision helper；client传旧`catalogRevision`时server仍按current private input重算，并在POST success返回新的`catalogRevision`。contract tests固定：只改变一个example而tool/domain/intents/version均不变，GET `revision`与POST `catalogRevision`都变化且值相等；只重排locale/object/duplicate phrase不变化；同一private catalog分别用任意两个不同user text请求POST，两次`catalogRevision`与GET `revision`仍byte-equal；重命名GET字段或从GET根读取`catalogRevision`必须失败；两种response与logs均找不到example原文。Gate 0/paired report记录该private-input digest作catalog provenance，但不得记录preimage。

上述revision invariance必须在**server** `packages/web/server/lib/interactive-ui/runtime.test.js`中直接验证：对同一runtime/private catalog调用两次`getRoutingDecision()`但传不同text，两个`catalogRevision`与`getRoutingCapabilities().revision`必须byte-equal。`routes.routing-decision.test.js`再用两个真实POST贯通一次该不变量。UI `routingDecisionText.contract.test.ts`只证明builder与decoder，不得伪称验证server digest。

route错误严格沿用现有`routes.js::sendError`与附录A.3的flat envelope `{error:<fixed safe message>,code:<stable code>}`，不得新增`message`字段或把code塞进`error`。完整映射如下：

| HTTP | code | 条件 |
|------|------|------|
| 415 | `routing_decision_content_type_unsupported` | 非JSON Content-Type |
| 413 | `routing_decision_request_too_large` | raw body >8192 bytes |
| 400 | `invalid_routing_decision_request` | JSON/shape/version/text/revision/unknown-key失败 |
| 503 | `routing_decision_unavailable` | catalog/scorer内部不可用；不回显异常或user text |

UI对timeout/network/非2xx/invalid success decoder统一回退现有GET/full Phase 3 catalog；语义4xx不重试，503最多本次零重试，任何失败都不能阻止发送用户消息。route/unit test必须逐一固定status/code、no-store、无日志payload和fallback。

约束：

- body ≤8 KiB；text ≤4096 Unicode code points；超限/invalid由route按上表拒绝，client回退Phase 3，不截断后偷偷决定。
- decision 不缓存、不落盘、不打印 user text/matched phrase。
- catalog stale 时用当前 catalog 重算并返回新 revision。
- scorer 只缩短 system catalog；不得设置 `tools:false`、修改 Tool registry/permission 或直接执行 Tool。
- scorer failure 不能丢用户消息；立即回退现有 GET/full catalog。
- ambiguous 首版由模型按固定 system 澄清；Choice UI 只有后续证据证明必要时另立 slice，且 choice 仍变成普通用户 message。

### 8.6 Inspector 与指标

Trace identity 改为 `runtimeKey + sessionId + userMessageId`。这里的`userMessageId`是send/dispatch时的prompt ID；`ToolPart.messageID`是**assistant message ID**，绝不能当user ID。唯一关联链为：

```text
recordRoutingDispatch(userMessage.id)
  ← exact key runtimeKey/sessionId/userMessageId
Assistant.info.parentID == userMessageId
  → ChatMessage
  → MessageBody / ProgressiveGroup
  → ToolPart({ assistantMessageId, parentUserMessageId })
  → recordRoutingToolObservation(exact parentUserMessageId)
```

`routingInspector.ts`删除`updateLatestSessionTrace()`猜测路径，改成exact-key lookup。`ChatMessage`必须从**同一个assistant message authority**同时取得`assistantMessageId=assistant.info.id`与`parentUserMessageId=assistant.info.parentID`，再经`MessageBody`的direct Tool路径或`TurnActivity→ProgressiveGroup`聚合路径原样下传；`ToolPart`以`part.messageID === assistantMessageId`作一致性断言，但只用`parentUserMessageId`查trace。禁止从`part.messageID`反向构造expected assistant ID，否则校验会退化成恒真。缺失/空parent、part/message mismatch、runtime/session不匹配时no-op且不得落到session最新trace；其他脱离message-owned render的ToolPart caller也不得猜测关联。artifact/view observation沿用同一exact key与toolPartId。

并发测试必须在同一session交错发送U1/U2、创建A1(parent=U1)/A2(parent=U2)并逆序完成Tool；两条trace各自更新，另测把A1 ID当user ID、missing parent、wrong part.messageID均不修改任何trace。报告区分：

1. deterministic preselection reason；
2. model-observed Tool；
3. Tool completion；
4. View rendered；
5. business data loaded。

后四项不能互相代替；View/Gateway failure 不能回算 routing miss。Report 不包含用户原文、prompt、matched phrase、Tool input/output、业务响应、endpoint、secret。

### 8.7 Corpus 与 A/B

- `unified-acceptance-corpus.json` 17 条完全冻结，legacy denominator 不变。
- P2 I1–I5 独立统计，不混入 routing accuracy。
- `routing-cases.json` 现有 20 条保留为 static baseline；新冲突 case 放单独 corpus。
- Phase 3 与 scorer 对同一 17 条做 paired cold-session A/B；legacy 任一指标退化则不得启用 scorer。
- scorer 能通过静态 examples 单测不等于真实模型 improvement；最终 gate 仍是带 provenance 的模型报告。

### 8.8 P3.4 完成定义

若未触发：

- 三次 P2 后报告完整；指标通过；roadmap 状态按 §1.5 处理，备注记录 `result=not-triggered`；没有 scorer 产品文件。

若触发并获批：

- scorer 纯函数、route/client thin adapter、Phase 3 fallback、message correlation 全有测试；
- 17 条 paired A/B 无退化，触发的 failure category 达到阈值；
- business safety invariant 为零违反；
- no prompt/user text/examples/secret retention；
- 不改 OpenCode、不执行 Tool、不新增依赖、不强制 Choice UI。

---

## 9. P3.5：Style S6 Native recharts（可选项）

### 9.1 当前结论

Style v2 S1–S5 已实现；Declarative 也已有 Host-owned chart primitive。P3.5 只讨论 Trusted Native Host UI Kit 是否要增加一个更强的 Chart。当前 `packages/ui/package.json` 没有 `recharts`，因此第一步只能是独立 PoC/依赖决策，不能直接改产品 lockfile。

### 9.2 两阶段门禁

#### Gate A：隔离 PoC，不进入产品分支的 dependency graph

验证：

- Recharts 当前许可证、维护状态、React 19 兼容性；
- ESM/tree-shaking、Vite lazy chunk、SSR/desktop build 行为；
- line/bar/area/donut 的主题、tooltip、empty/loading/error、responsive sizing；
- keyboard/screen reader 替代表达、reduced motion；
- 数据量/series 上限和渲染耗时；
- 初始 Web/Electron bundle 零 eager import；
- lazy chunk gzip 尺寸。最终阈值要在写产品代码前冻结，建议以当前 build 基线 + 明确预算而不是主观“看起来不大”。

Gate A 输出一份可复现 report。为真实构建允许在**可丢弃的隔离 worktree/branch**临时修改 `packages/ui/package.json` 与 `bun.lock`，但不得把该 dependency/lock delta 合入产品工作分支，也不得修改默认 template/canonical Golden。只有 Gate B 获批后才能形成产品依赖变更；Reject 时必须清掉全部 PoC delta。

#### Gate B：产品采用

只有以下都满足才继续：

1. 存在一个真实 Trusted Native business extension，需要 Host Chart 且现有 Declarative/DOM/CSS 方案不足；
2. Gate A 通过；
3. API 只暴露一个 bounded Host component，不泄漏 Recharts primitives；
4. 用户明确批准 `recharts` 直接依赖和 bundle budget；
5. roadmap 只把 P3.5 从 `later` 更新为已定义的 `in-progress`；不得发明“adopted/implementing”等状态。

未满足时记录 `result=not-adopted`、注明零产品代码，是正确结果。

### 9.3 当前 Native UI Kit 调用链

```text
Trusted Native module activation
  → packages/ui/src/components/interactive-ui/nativeRegistry.ts
  → activationHost.ui = nativeUIKit
  → nativeUIKitRegistry.ts
  → NativeUIKit.tsx host-owned components
  → extension activation/render
```

关键锚点：

- `packages/ui/src/lib/interactive-ui/types.ts`：`NativeActivationHost.ui` 与 `uiVersion: 1`；
- `packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts`：唯一 UI Kit registry；
- `packages/ui/src/components/interactive-ui/NativeUIKit.tsx`：Host component 实现；
- `packages/ui/src/components/interactive-ui/nativeRegistry.ts`：注入 activation host；
- `packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx`：现有 contract/视觉语义测试；
- `packages/web/vite.config.ts`：现有 package-based manual chunks；没有 Recharts 特例。

P3.5 不改 Declarative schema、`generatedLayout.ts`、Business Gateway、Remote、LDR、show-widget 或 HTML Artifact。

P3.5 也**不以P3.2为前置**：现有`nativeRegistry.ts`已经把同一个`nativeUIKit`对象放进`activationHost.ui`，所以在`nativeUIKitRegistry.ts`增加optional `Chart`后，当前loader自然可见该能力。P3.5不得为“可测 seam”修改loader/global map；若P3.2未来已把loader改成per-mounted-surface scope，P3.5仍只把它当V并跑同一black-box activation/browser回归。Native generation/lease隔离只属于P3.2。

当前 Native delivery 也必须保持：server `runtime.js` 对 entry 以 2 MiB 上限读取并计算 digest，route 返回 authenticated `text/javascript`/`nosniff`/ETag；UI `nativeRegistry.ts` 只从 server-owned authenticated URL dynamic import，要求 extension `apiVersion===1`、extension/view namespace正确且不能重复注册。Native 是 trusted same-page code，不是 sandbox，业务仍只能通过 `props.host.business` Gateway。浏览器 dynamic import 当前没有 SRI 参数是已知边界，S6 不得误报为修复。

现有 Acme Sales Native 趋势图是手写 `div` 柱图；Gate A 应以它和真正的 multi-series/stack/reference/tooltip/a11y需求作对照。采用 Host Chart 后，Recharts closure属于 OpenChamber 产品 lazy asset，不进入 `.ocix` entry；扩展 bundle仍必须单文件、无第二份React、无bare import/相对chunk并保持 <2 MiB。建议把采用Chart后的扩展bundle delta预算冻结为 ≤15 KiB。

### 9.4 深模块：只暴露 `Chart`

公开 Host API 建议：

```ts
type NativeChartVariant = "bar" | "line" | "area" | "donut"
type NativeChartSize = "sm" | "md" | "lg"

type NativeChartFormat =
  | { style: "number" | "compact" | "percent"; maximumFractionDigits?: 0 | 1 | 2 }
  | { style: "currency"; currency: string; maximumFractionDigits?: 0 | 1 | 2 }

type NativeChartSeries = { id: string; label: string }
type NativeChartPoint = { label: string; values: readonly number[] }

type NativeChartProps = {
  variant: NativeChartVariant
  ariaLabel: string
  title?: string
  series: readonly NativeChartSeries[]
  data: readonly NativeChartPoint[]
  size?: NativeChartSize
  stacked?: boolean
  referenceLine?: { value: number; label?: string }
  valueFormat?: NativeChartFormat
  showLegend?: boolean
  emptyLabel?: string
}
```

冻结 bounds（最终值在 Gate B contract test 中单源）：

- data points ≤ 30；series 1–5；总 cell ≤150；id 唯一且符合 safe-key，labels/aria/title bounded；
- size 只接受 `sm|md|lg`，具体像素由 Host 与 responsive container 拥有；
- values 只接受有合理绝对值上限的 finite number；拒绝 `NaN`/Infinity/string/object/function；每点 values 长度必须等于 series 数；
- donut 只允许一个 value series，其他类型至少一个 series；
- donut 值非负；`stacked` 只允许 bar；`referenceLine` 不允许 donut；非法组合 fail closed；
- currency 必须匹配 `/^[A-Z]{3}$/`，format 由 Host locale 决定；
- unknown props 在 activation boundary 丢弃/拒绝，不能 spread 到 DOM/Recharts。

禁止公开：

- `Line`、`Bar`、`XAxis` 等 raw Recharts components；
- render props、formatter callback、ReactNode slot；
- `className`、raw `style`、SVG attributes、HTML、URL、fetch callback；
- Recharts types 作为公共 OCIX contract；
- arbitrary palette hex（扩展只选 semantic colorRole）。

这使未来替换 Recharts 时扩展合同不变。

### 9.5 懒加载结构

冻结的模块路径（Gate A 与 Gate B 使用同一结构，避免 PoC 采用后改名）：

```text
packages/ui/src/lib/interactive-ui/nativeChart.ts
  public types + pure normalizer + bounds
packages/ui/src/components/interactive-ui/NativeChart.tsx
  stable Host boundary + Suspense/local ErrorBoundary + semantic fallback
packages/ui/src/components/interactive-ui/NativeChartRecharts.tsx
  the only file importing recharts
```

```tsx
const NativeChartRecharts = React.lazy(() => import("./NativeChartRecharts"))
```

`nativeUIKit.Chart?` 指向稳定 wrapper，保持当前 `apiVersion:1 / uiVersion:1` 的只增合同；新扩展必须做 feature detection，并在旧 Host 用 Notice + 可读表格降级。没有 Chart 的页面不能请求 lazy chunk。`NativeChartRecharts` 不得被 barrel file eager re-export；Vite bundle verifier 要从 manifest/entry graph 证明 Recharts 不在 initial chunks。

不要在 `vite.config.ts` 先硬编码 package 名 manual chunk。先让动态 import 形成独立 chunk；只有 build evidence 显示 chunk 合并才做最小配置，并用 verifier 固定。

### 9.6 视觉与无障碍合同

- 颜色全部来自 Style v2 semantic/chart tokens；light/dark 和全部 preset 可读。
- title/description 为 chart region 的 accessible name/description。
- SVG 不是唯一信息源；始终生成最多 30×5 的 sr-only 数据表。
- Tooltip 不能只靠 hover；键盘 focus/触摸可访问。
- reduced motion 时关闭/缩短动画；stream/update 不反复播入场动画。
- empty/loading/error 使用现有 Host component 和状态色，不画空坐标系冒充“0”。
- 数字用 Host locale `Intl.NumberFormat`；currency/percent 的输入 contract 有测试。
- 小宽度不横向撑破 chat/Workbench；resize observer cleanup，无 zero-width 循环。

### 9.7 PoC/产品性能指标

Gate A report 至少记录：

- baseline 与 PoC 的 initial JS raw/gzip/brotli；推荐预先冻结 initial raw 增量 ≤10 KiB、gzip ≤4 KiB；
- chart lazy chunk raw/gzip；
- 首次打开 Chart 的 network/parse/render；
- 30 points × 5 series 的最大**受支持**用例；另以 31 points、6 series、总 cell >150 作为必须快速拒绝且不渲染的抗压负例；
- 10 次 resize、theme switch、mount/unmount 后 listener/observer 数；
- Web 与 packaged Electron build；
- `prefers-reduced-motion`；
- 无 Chart 页面是否请求任何 Recharts chunk。

建议在看结果前冻结的其他门：完整 Chart lazy closure raw ≤600 KiB、gzip ≤180 KiB；cold ready median ≤750ms、p95 ≤1200ms；相对同机无 Chart native baseline median 回归 ≤100ms；30×5 update/resize p95 ≤100ms；0 uncaught error/overflow。若项目 owner 选择不同数字，必须在 PoC 运行前记录理由，不能看完结果再放宽。

若预算未冻结、report 缺 build graph 或 initial bundle 出现 eager code，Gate A 失败。

### 9.8 示例策略

- 默认 starter/template 与不需要图表的 Acme CRM 保持不使用 Chart，避免每个扩展无意识触发 lazy closure。
- Gate A 只在 disposable demo 中增加 `native-chart-poc` 合成 fixture，覆盖 line/bar/area/donut、empty、invalid bounds、theme/a11y；不连接 Gateway，也不进入 canonical Golden。
- Gate B 有一个必须先完成的 clean-worktree fixture gate：当前根 `.gitignore` 忽略所有 `dist`，Sales/CRM/template 的 manifest却引用未受版本控制的 `dist/ui.mjs`。不得继续编辑本机残留 bundle或要求 Agent `git add -f`。把三个手写、无bare-import的单文件 Native entry分别迁到受版本控制的 `examples/interactive-ui/acme-sales/ui/native/sales-dashboard.mjs`、`examples/interactive-ui/acme-crm/ui/native/crm-dashboard.mjs`、`templates/interactive-ui-extension/ui/native/dashboard.mjs`，并同步各 manifest `entry`。CRM/template只做逐字节等价路径迁移，不获得Chart；对应 validation test必须从干净source copy验证所有entry存在，不能依赖另一个checkout的ignored output。
- Gate B 获批后删除 PoC product入口，并在新的 tracked Sales entry中把趋势图升级为真实 business adoption：使用 optional `host.ui.Chart`，旧 Host 以 Notice + 可读 Table/文字降级；Sales manifest升semver且不加权限。
- Acme Sales 是唯一首发 business example；删除旧手写 `div` 柱图，不保留 dual implementation。其他 variant 由 component tests/visual harness 覆盖，不再新增永久 gallery 扩展。

### 9.9 P3.5 测试清单

1. contract：unknown type/prop、rows/series/height bounds、bad values、missing keys、donut cardinality、currency/locale。
2. registry：`uiVersion:1` 下 Chart 存在；现有组件 identity/props 不变；Native module 不能覆盖 Host Chart。
3. lazy：无 Chart 不 import；首次 Chart 显示安全 fallback；load error 有显式状态；重试策略固定。
4. render：四类型、empty、theme、responsive、unmount cleanup、reduced motion。
5. a11y：name/description、keyboard tooltip/data access、table/list alternative、contrast、状态不只靠色。
6. security：HTML/URL/callback/style 被拒；超限不会挂 UI；错误不回显完整数据。
7. build：Web/Electron initial graph、lazy chunk budget、source map/asset；干净 source copy中Sales/CRM/template Native entry都存在且无 ignored `dist`依赖；VS Code/mobile 共享 UI 时的构建结果明确。
8. visual：en/zh-CN × light/dark × 代表 preset，更新 golden 需人工审查，不以 update 命令掩盖差异。

### 9.10 P3.5 完成定义

Gate A 结束：有带版本、license、bundle、a11y、perf 的 report，并给出 adopt/not-adopt 结论；未授权时零产品依赖变化。

Gate B 结束：

- `recharts` 是批准后的直接依赖；lockfile 只有预期变化；
- 公共 contract 只见 `nativeUIKit.Chart`，无 Recharts 类型泄漏；
- wrapper lazy，initial bundle 零 eager Recharts；
- bounds/security/theme/a11y/perf/build/browser/visual 全通过；
- 默认 template 不触发 Chart；Gate A disposable fixture 已清理，Gate B Acme Sales adoption 与 Developer Guide 完整；
- Sales/CRM/template 的 Native fixture entry均来自 tracked `ui/native/*.mjs`，clean-worktree validation通过，本机历史 `dist/ui.mjs` 不再是authority；
- S1–S5、Declarative、Native 旧 kit 无回归。

---

## 10. P3.6：Declarative partial/streaming UI（条件项）

### 10.1 当前结论：authority 尚不存在

OpenCode core 已有 `session.next.tool.progress`、running structured/content 和 projector tests 的设计先例，但当前生产 legacy `SessionProcessor` 的行为是：

```text
tool-input-start → ensureToolCall → pending { input:{}, raw:"" }
tool-input-delta → only ensureToolCall
tool-input-end   → only ensureToolCall
full tool-call  → running { input: complete parsed object }
tool-result     → completed { output: string }
tool-error      → error
```

因此 `pending.raw` 仍是空字符串，input delta 没有可用的结构化 authority。OpenChamber reducer 也忽略 `session.next.*`。P3.6 未满足开始门；UI 当前保持 spinner → completed final。

### 10.2 禁止的捷径

- 不解析 `pending.raw`、`tool-input-delta`、半截 JSON 或字符串 patch。
- 不把 object 塞入只用于 text/reasoning 的 `message.part.delta`。
- 不做 JSON Patch/Merge Patch/array-index patch；v1 只接受 full replacement snapshot。
- 不给现有同步 `interactive_ui` 人工 sleep 只为演示流式。
- 不引入 AI SDK `useChat`、RSC、`streamUI` 或第二条消息 runtime。
- 不先扩 HTML Artifact、MCP App、Trusted Native、Installed live business、show-widget。
- partial 阶段不 query/action/pin/dataRef/network。

### 10.3 两级开始门（避免用实施结果作为开始条件）

#### Gate O0：OpenCode authority-enablement 开始门

只有以下同时满足，才允许开始 O1/O2：

1. P2 完成，17 条 legacy 与 I1–I5 冻结；
2. 用户明确授权 P3.6 的 **OpenCode authority-enablement wave** 与该仓文件范围；
3. 高级 contract owner 已找到一个**自然存在多阶段结果**的OpenCode built-in internal production Tool，写出精确文件/Tool ID/两个以上真实阶段及每阶段完整snapshot schema，并由用户批准；第三方/plugin Tool不满足v1 O0；
4. internal Effect context、public plugin field-stripping boundary、revision/limits/terminal/history/capability合同冻结；
5. SDK generator/build 可以执行；git/release/pin 仍按 §14.3 单独授权。

当前审计没有找到合格 producer：built-in `interactive_ui.ts` 是输入完整后同步构造一次 final 的 Tool。它不得通过 sleep、重复同一 payload、伪造“准备中”数据或无业务意义拆步来满足门禁。因此**当前 P3.6 合法结果是保持 `later`，备注 `result=blocked-by-authority`，且零产品代码改动**。未来若找到自然 producer，必须先把其精确路径写回 §11.6 的占位行再派发低能力 Agent。

Gate O0 通过后，O1/O2 负责实现：full ToolPart snapshot、server monotonic revision、durable `message.part.updated`/history replay、terminal precedence、真实 producer 调用、generated SDK。实现期间 capability 必须保持 false。

#### Gate C1：capability enablement 证据门（不是 consumer 开始门）

只有 O1/O2 在`handlers/global.ts`仍返回`toolProgressSnapshotsV1=false`时，已经用 production-path tests 证明以下全部成立，才允许高级contract owner签署C1：

1. 获批的真实 Tool 在正常运行中发布 ≥2 个不同、语义完整 snapshot；
2. 乱序/重复/断线/恶意/超限/cancel/final override 自动化通过；
3. durable history、terminal precedence与pre-enable generated SDK artifact/contract review通过；external/legacy行为已固定为false；
4. schema/publisher/history/SDK来自同一pre-enable revision，且没有靠fixture-only publisher或UI fake event补证据。

C1签字后仍按固定顺序执行：同一schema owner把handler false→true并跑production capability tests → O2 SDK owner从该**最终revision**重新生成/构建CLI+SDK → 新鲜高级只读review确认producer/history/terminal/handler/generated artifacts/provenance同revision → **Release Authority Gate** → 获批后由OpenCode release owner发布同revision CLI/SDK → **Pin Authority Gate** → 获批后由OpenChamber pin owner更新managed pins并验证packaged provenance → **Consumer Authority Gate** → 获批后才下发C1A/C1B/C2。三道gate和三次实际动作均独立；任一步未授权或执行/验证失败就停在其前一handoff。consumer授权不能推出release/pin权限，release也不能推出pin或consumer权限。

这两级门不能合并：O1 不能因为 schema 存在就开启 capability；C1 不能用 fixture event 代替真实 Tool producer；consumer不得跳过post-enable final-artifact与终审波次。

### 10.4 OpenCode wire contract

```ts
type ToolProgressSnapshotV1 = {
  $schema: "opencode://tool-progress-snapshot/v1"
  revision: number
  structured: Record<string, unknown>
}
```

挂在：

```ts
type ToolStateRunning = {
  // existing fields
  progress?: ToolProgressSnapshotV1
}

type ToolStateError = {
  // existing fields
  progress?: ToolProgressSnapshotV1
}
```

稳定的v1 internal rejection合同唯一源码owner是`packages/opencode/src/tool/progress.ts`：

```ts
type ToolProgressRejectedCode =
  | "tool_progress_invalid_structured"   // null/array/non-plain object
  | "tool_progress_not_serializable"     // cycle/BigInt/function/symbol/undefined/non-finite anywhere
  | "tool_progress_too_large"            // canonical UTF-8 JSON > 256 KiB
  | "tool_progress_count_exceeded"       // >512 candidates or >128 persisted snapshots for one call
  | "tool_progress_call_not_running"     // unknown/pending/completed/error/aborted/terminal race
  | "tool_progress_unavailable"          // processor shutdown/capability unavailable
  | "tool_progress_persist_failed"       // authoritative Session.updatePart failed

class ToolProgressRejectedError extends Error {
  readonly name = "ToolProgressRejectedError"
  constructor(readonly code: ToolProgressRejectedCode) {
    super(TOOL_PROGRESS_SAFE_MESSAGES[code])
  }
}
```

错误对象只含稳定`name/code`与固定安全message，不含candidate、serialized bytes、Tool input/output或内部stack。internal Tool context、SessionTools、processor与tests都从该模块import同一union/error/input type，不得在各层重新拼literal。`packages/schema/src/v1/tool-progress.ts`只定义持久ToolPart progress snapshot wire，generated SDK也只承载snapshot/event；两者不import internal rejection error。

v1 producer范围**只允许Gate O0批准的OpenCode built-in internal Tool**。当前fork release workflow只发布CLI与`@zunbaran/opencode-sdk`，不发布fork plugin；managed resolver还刻意使用upstream `@opencode-ai/plugin`。因此P3.6不得修改或承诺公开`@opencode-ai/plugin`的`tool.progress`，不得把未发布fork plugin当release证据。第三方/plugin Tool producer API必须另立plugin命名/发布/resolver/pin/兼容计划，不在v1。

internal Tool producer API必须区分“base context可由non-session/manual caller构造”和“canonical publish helper”。不能把新字段直接做成所有`Tool.Context` object literal的required member，否则`session/prompt.ts`的两条manual执行链、debug agent以及大量typed test fixture会被迫伪造publisher。

```ts
// packages/opencode/src/tool/progress.ts
type ToolProgressInput = { structured: Record<string, unknown> }
type ToolProgressPublisher = (
  input: ToolProgressInput,
) => Effect.Effect<void, ToolProgressRejectedError>

// packages/opencode/src/tool/tool.ts — internal base context field刻意optional
type Context = {
  // existing fields...
  progress?: ToolProgressPublisher
}

// packages/opencode/src/session/processor.ts — Handle新增的exact internal interface
type PublishToolProgress = (
  toolCallID: string,
  input: ToolProgressInput,
) => Effect.Effect<void, ToolProgressRejectedError>

// built-in internal producer唯一调用入口；保持当前Def.execute error=never
ToolProgress.publish(context, { structured: fullStructuredSnapshot })
// => Effect.Effect<void>；helper内部把typed rejection转成defect
```

internal boundary合同：

- 当前`Tool.Def.execute(...)`的真实类型是`Effect.Effect<ExecuteResult>`，错误通道为`never`。因此`ToolProgress.publish(context,input): Effect.Effect<void>`必须在唯一helper内部执行`(context.progress ?? ToolProgress.unavailable)(input).pipe(Effect.orDie)`；producer才能直接`yield*`且保持可编译。禁止让每个producer自行`catchAll`/`orDie`/转Promise，也禁止扩大所有Tool execute error union。
- internal publisher与`SessionProcessor.Handle.publishToolProgress(toolCallID,input)`保留typed `Effect.Effect<void,ToolProgressRejectedError>`；`ToolProgress.unavailable`实现为返回`Effect.fail(new ToolProgressRejectedError("tool_progress_unavailable"))`的同型publisher。`TOOL_PROGRESS_SAFE_MESSAGES`与constructor由`progress.ts`单源持有，不允许caller传message。helper把该typed failure转为defect后，现有`run.promise → tool-error → failToolCall`链终止本次Tool、保留最近合法progress并写安全error state；producer不得捕获后继续产final。固定error message只含code对应的安全文本，不含candidate/payload/stack。
- `packages/opencode/src/session/tools.ts`的processor input Pick明确新增`publishToolProgress`；normal `context(args,options)`注入`progress: (value) => input.processor.publishToolProgress(options.toolCallId,value)`。`session/prompt.ts`两条manual path与debug context显式注入`ToolProgress.unavailable`。不得通过`run.promise`或第二个Effect runtime绕过当前SessionTools runtime。
- `SessionProcessor.Handle`必须精确新增`readonly publishToolProgress: PublishToolProgress`。processor内部为每个toolCallID维护一个Effect串行临界区，`updateToolCall`（metadata）、`publishToolProgress`、`completeToolCall`与`failToolCall`的full-state读改写都经同一队列；progress implementation在锁内直接read/update，不得嵌套调用另一个已取锁Handle method。terminal先取得锁时拒绝随后progress，progress先提交时terminal读取并覆盖其最新state，不能丢metadata/progress或死锁。
- `packages/opencode/src/tool/registry.ts`**不得**把internal progress泄漏给public plugin：在既有plugin context mapping中先剥离`progress`再构造`PluginToolContext`，不新增Promise bridge、不修改`packages/plugin/src/tool.ts`。focused test断言plugin context没有`progress`，plugin Tool只能final-only。
- internal Effect只在processor已接受/合并/明确拒绝candidate后settle；fire-and-forget禁止，因为会丢顺序和terminal error。
- non-object、不可序列化、超限、candidate/publication count、terminal/aborted与persist failure按上表拒绝。10Hz窗口的合法candidate进入单一latest slot；被后续合法candidate取代的调用在processor记录`coalesced`后**resolve成功**，不使用虚构`rate_limited` code、不增加revision/published count。pending合法candidate不能被后续非法candidate抹掉。
- registry/processor tests必须逐个固定7个code literal与触发条件，并覆盖Effect settle顺序、合法coalesced supersede成功、非法later candidate不抹pending、metadata/progress/terminal共享队列、abort/terminal race、连续两次`yield*`的revision顺序、512/128边界、persist failure，以及遗漏yield的example防线。另测：`Tool.Def.execute`仍为error=never且真实built-in producer可typecheck；typed Handle failure经helper defect进入既有Tool error state、最近progress保留且payload不泄漏；SessionTools real publisher成功；registry剥离field且public plugin不可调用progress；prompt/debug显式unavailable稳定失败；旧test fixture省略field仍typecheck且helper同样进入`tool_progress_unavailable` defect。

producer 不传 revision；`SessionProcessor` 按一个 ToolPart 从 1 开始生成。Gate O0 未来获批的 producer 每次输出都必须是可由 built-in Declarative renderer 接受的完整 object：

```json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.openchamber.builtin.interactive-ui.generated",
  "schemaVersion": 1,
  "mode": "snapshot",
  "summary": "partial but semantically complete",
  "context": {},
  "data": {
    "layout": {
      "type": "stack",
      "children": [
        { "type": "progress", "label": "Processing", "value": 0.5 }
      ]
    }
  }
}
```

这不是示意占位：同一 fixture 必须先通过生产 `parseInteractiveResultEnvelopeValue()` 与 `sanitizeGeneratedLayout()`，再用于 publisher/processor/history tests。禁止复制 `{layout:{}}`、半截 node 或任何只“长得像 JSON”但 renderer 会拒绝的 candidate。

final completed 继续是现有 string `state.output`，不改变 Result Envelope v1 字节合同。

### 10.5 OpenCode 发布语义和限制

建议 bounds：

- 每 snapshot JSON 编码 ≤256 KiB；
- 每 Tool call 最多512次candidate提交、128个实际发布snapshot；
- 最多 10 Hz；窗口内只保留最新完整 candidate；
- revision 只对真正发布的 snapshot 增加；
- 只在 running 发布；terminal 后 progress 丢弃且不加 revision；
- completed 清除 progress，以 final output 为唯一成功 authority；
- error/abort 可保留最近 progress 作为失败前预览；
- 非 object、不可序列化、超限被拒，日志只记 reason/bytes/revision，不记 payload。

这些值必须在 schema/processor tests 单源固定；Tool 不能从 manifest 改 limit。

### 10.6 目标调用链

```text
ToolProgress.publish (built-in internal Tool only)
  → internal Tool context
  → SessionTools context adapter
  → SessionProcessor.publishToolProgress
  → server-generated revision
  → Session.updatePart(full ToolPart)
  → SessionV1.Event.PartUpdated
  → PartTable latest state + SSE
  → generated SDK EventMessagePartUpdated
  → OpenChamber event pipeline
  → reducer revision/terminal guard
  → resolveInteractiveToolFrame
  → InteractiveUIToolSurface
  → InteractiveUIView
  → DeclarativeInteractiveView
  → sanitizeGeneratedLayout
```

重连：

```text
GET session messages/history
  → latest running ToolPart.progress
  → same reducer/resolver
  → same partial frame
```

现有 sync pipeline 已保留每个 `message.part.updated` 并把它当 delta barrier；`renderCompare.ts` 比较完整 state reference。不要创建第二条 UI stream store。

### 10.7 OpenChamber frame resolver

新增深模块：

```ts
resolveInteractiveToolFrame({
  part,
  featureEnabled,
  previous
}): {
  phase: "pending" | "partial" | "completed" | "error"
  revision?: number
  envelope?: InteractiveResultEnvelope
  fallbackReason?: string
}
```

规则：

1. capability false/缺失/error 时完全忽略 progress。
2. partial 只接受 running/error `state.progress`。
3. 首版只接受 built-in generated Declarative view、`mode:"snapshot"`、inline data；拒绝 dataRef/live/query/action/binding。
4. 每帧先 `parseInteractiveResultEnvelopeValue(unknown)`，再走现有 `sanitizeGeneratedLayout` bounds。
5. scope key 是 `runtime + sessionID + messageID + partID`；revision 相同幂等，较小忽略。
6. invalid 高 revision 在当前进程保留上一 valid frame并记 drop；冷 history 若只剩 invalid latest，显示 skeleton/error，不复活未保存旧 frame。
7. partial view ID 改变非法，避免 descriptor reload 抖动。
8. completed/error terminal 后任何晚到 running 不得回退；completed final 无效则走 existing generic Tool fallback，绝不把 partial 当成功 final。
9. error/abort 可显示最后 safe frame，但必须加 incomplete/failed 状态。
10. pending/partial `aria-busy=true`；只有 completed final 可 Pin。

### 10.8 UI surface

`InteractiveUIToolSurface.tsx` 统一拥有四态：

| phase | UI | 权限 |
|-------|----|------|
| pending | 现有 skeleton/spinner | 无 pin/action/query |
| partial | 安全 Declarative preview + busy/incomplete label | 无 pin/action/query/network |
| completed | 现有 final renderer | 按现有 envelope/extension 权限 |
| error | 最后 safe partial + failure label，或 generic error | 无成功态行为 |

`ToolPart.tsx` 只把 part/capability 交给 surface，不重复 parser/revision。`InteractiveUIView.tsx` descriptor effect 已以 `envelope.view` 为依赖，同 view 的 data 更新不应重新加载 descriptor。

### 10.9 Reducer 与 ordering

- `message.part.updated` full snapshot 是唯一实时 authority；`message.part.delta` 不承担 structured progress。
- reducer 在写入前比较 progress revision 和 terminal state；不能只靠事件到达顺序。
- terminal status 优先级：completed/error > running > pending；同 part 不能逆向。
- stream 暂停保留最后 safe frame并保持 busy，不制造 completion。
- reconnect history 与 live event 合并使用同一 rule；duplicate revision 不触发视觉闪烁。
- completed final 后可清理 in-memory progress ledger；session/runtime dispose 必须清 scope。
- P2 的 text/tool/text part 顺序不改变；progress 只是同一个 Tool part 的 state 更新，不插新 message part。

### 10.10 Capability

```json
{
  "features": {
    "toolProgressSnapshotsV1": true
  }
}
```

true 的含义必须是：schema、production publisher、SSE full PartUpdated、history replay、terminal semantics、SDK 都可用。不能因为类型文件存在就返回 true。

OpenChamber `distributionCapabilities.ts` 第一版不走`lib/opencode/client.ts`，也不存在`RuntimeAPIs.runtimeFetch`成员。它必须显式复用两个现有模块：

```ts
import { runtimeFetch } from '@/lib/runtime-fetch'
import {
  getRuntimeKey,
  subscribeRuntimeEndpointWillChange,
  subscribeRuntimeEndpointChanged,
} from '@/lib/runtime-switch'
```

adapter用`runtimeFetch('/api/opencode/capabilities')`读取OpenChamber server wrapper；真实wire不是root `features`，而是：

```ts
type OpenChamberCapabilitiesResponse = {
  supported: boolean
  capabilities: null | {
    distribution?: unknown
    version?: unknown
    apiVersion?: unknown
    managedUpdate?: unknown
    features?: Record<string, unknown>
  }
  diagnostic?: unknown // legacy wrapper可有；projection不消费
  error?: unknown      // 503 wrapper可有；projection不消费
}
```

只有HTTP 200、root是record、`supported===true`、`capabilities`是non-array record、`capabilities.features`是non-array record且`capabilities.features.toolProgressSnapshotsV1===true`时projection才为true。root `features.toolProgressSnapshotsV1`即使为true也必须忽略；missing/false、legacy `supported:false`、null/malformed/array、unknown type、non-200/503、JSON失败全部fail-closed false。既有distribution/version/MCP siblings允许存在但不参与判定；不能把legacy fallback误升级。

每个request在发起前capture `runtimeKey=getRuntimeKey()`；cache/in-flight都按该key分区，response settle时若current key已变化则丢弃、不得写入新runtime cache。will-change立即abort/清旧in-flight与cache，changed后保持cold；module/test dispose必须unsubscribe并abort。`distributionCapabilities.test.ts`必须把上述true case、root-features trap、supported=false-with-nested-true、missing/false、malformed/null/array、503/invalid JSON逐个固定为decoder vector。server route对official/legacy external fallback明确false，UI无条件final-only。若实施时改为SDK `getDistributionCapabilities()`，则必须把`lib/opencode/client.ts`/`client.test.ts`改列M并加入focused tests，不能双源读取。

### 10.11 Streaming corpus

新建独立 `partial-streaming-corpus.json`，不修改 17 条或 I1–I5。至少包含：

1. revision 1→2→final；
2. duplicate/乱序 2→1→2；
3. valid→invalid→valid；
4. running 断线，history 恢复最新 revision；
5. error 保留最后 safe frame；
6. completed 后 late running；
7. capability false/old OpenCode；
8. hostile node、live/dataRef、unknown view、oversize；
9. 10 Hz/128 frame producer limits；
10. P2 text/tool/text 顺序；
11. completed final invalid 不冒充 partial success；
12. session/runtime switch ledger isolation。

### 10.12 报告 schema 与指标

建议：`openchamber://interactive-ui-partial-streaming-report/v1`。

只保存：case ID、revisions、bytes、accepted/dropped reason、phase timing、capability、history match。不得保存 snapshot payload、完整 layout、prompt、业务数据、secret。

指标：

- `firstValidFrameMs < finalFrameMs`；
- `revisionRegressionCount=0`；
- `postTerminalRegressionCount=0`；
- `finalAuthorityViolationCount=0`；
- `rawParseCount=0`；
- `historyReplayMatch=true`；
- `unsafePartialRenderedCount=0`；
- actual publish rate ≤10 Hz；
- legacy final-only cases 完全一致。

### 10.13 P3.6 完成定义

- Gate O0有一个用户批准、自然多阶段的OpenCode built-in internal production Tool；外部/plugin Tool不计。若没有，roadmap状态保持`later`，备注`result=blocked-by-authority`、零产品代码并停止。
- OpenCode producer/revision/limits/terminal/history/capability 全部由 production-path tests 证明；不是只测 core projector。
- SDK 由 generator 产生；同revision CLI/SDK已通过独立Release Gate并实际发布，OpenChamber pins已通过独立Pin Gate更新且provenance验证成功，另有Consumer Gate文件范围授权；任何一步仅“获授权”但未成功执行都不能宣告P3.6完成。禁止手改生成文件。
- OpenChamber capability adapter、reducer ledger、frame resolver、surface 分层；raw/delta parse count 永远为零。
- 首版只支持 built-in generated snapshot Declarative；所有 live/business/Native/Artifact/MCP/Widget 负例通过。
- reconnect、乱序、duplicate、invalid、cancel、error、final override、runtime switch 通过。
- 17 条 legacy、P2 I1–I5、streaming corpus 独立统计且无回归。
- external/old CLI final-only；报告无 payload/secret；文档与 roadmap 状态真实。

---

## 11. 全量逐文件 A/M/V/R 清单

本节是派发低级 Agent 的文件账本。开工时若路径或符号已变化，worker 必须先提交差异，不得自行发明平行文件。`A/M/V/R` 含义见 §4.3。

路径基准（本节及可复制 Agent prompt 强制）：未写 package 前缀的 UI 短路径一律相对 `packages/ui/src/`；server 短路径一律相对 `packages/web/server/lib/interactive-ui/`；OpenCode 路径一律以 `opencode/` 仓库根开头；Electron 路径一律相对 `packages/electron/`。凡一行跨两个基准，必须写完整仓库相对路径；Agent不得在仓库根或相邻 package 猜建同名文件。handoff 中最终仍要展开成仓库相对路径。

### 11.1 P3.1 Local Data Runtime

#### A — 新增

以下 shared project authority 三行仅在 P3.1 是首个获授权消费者时为 A；若已由 P3.2 实现，则改为 V + focused regression，禁止复制到 `local-data/`。

| 文件 | 责任 |
|------|------|
| `packages/web/server/lib/interactive-ui/local-data/contract.js` + test | manifest/action/handler/migration 单源 normalization |
| `packages/web/server/lib/interactive-ui/project-authority.js` + test | configured root/server-fetched worktree/session containment、canonical scope 与 opaque projectKey |
| `packages/web/server/lib/interactive-ui/project-inventory.js` + test | strict Git/plain classification、typed failure、owner/creation identity；暂时失败绝不等于missing |
| `packages/web/server/lib/interactive-ui/project-incarnations.js` + test | 0600 atomic bounded ledger、stable stat/owner检测、随机incarnation/tombstone、损坏fail-closed |
| `packages/web/server/lib/interactive-ui/local-data/database.js` + test | managed path、PRAGMA、connection pool/lease、checkpoint/close |
| `packages/web/server/lib/interactive-ui/local-data/migrations.js` + test | ordered digest ledger、transaction、schema-ahead |
| `packages/web/server/lib/interactive-ui/local-data/module-loader.js` + test | verified bytes、generation cache、single-file ESM |
| `packages/web/server/lib/interactive-ui/local-data/runtime.js` + test | facade、handler transaction、limits、errors、transitions、purge |
| `packages/web/server/lib/interactive-ui/host-runtime.js` + test | shared Manager/Gateway/project-authority composition 与 dispose seam；P3.1只增optional LDR adapter（若P3.2已创建则M/V） |
| `packages/web/server/lib/interactive-ui/routes.local-data.test.js` | 正式 route、project/confirmation/purge tests |
| `templates/interactive-ui-local-data-extension/**` | opt-in Trusted Host Code template，不替换默认 template |
| `examples/interactive-ui/local-data-orders/**` | 签名、确定性、本地数据示例 |
| `scripts/lib/interactive-ui-local-data-fixture.mjs` | 临时 data/projects/package lifecycle |
| `scripts/verify-interactive-ui-local-data-functional.mjs` | server restart/migration/lifecycle functional report |
| `scripts/verify-interactive-ui-local-data-browser.mjs` | 无模型真实 Browser/Gateway case |
| `scripts/verify-interactive-ui-local-data-runtime-parity.mjs` | Web/Electron/external server/unsupported matrix |
| `packages/electron/scripts/verify-packaged-local-data.mjs` | 真 load native addon、restart persistence、graceful close |
| `packages/ui/src/lib/interactive-ui/client.test.ts` | project directory header 与 HTTP/LDR client regression |
| `packages/ui/src/components/interactive-ui/InteractiveUIView.test.tsx` | descriptor/action project context 传递与 failure state |
| `packages/ui/src/components/interactive-ui/HTMLArtifactView.test.tsx` | installed Artifact descriptor/action exact project context与cross-project/header spoof负例 |

P3.1 明确不存在 `local-data/hono-app.js`；未来 transport slice 不得把该文件塞回本工作包。

#### M — 修改

| 文件 | 精确责任 |
|------|----------|
| `packages/web/server/lib/interactive-ui/runtime.js` | `normalizeConnector` 接 `local-data`；`normalizeAction` 保留 localData handler；confirmation fingerprint 绑定 projectKey；policy 后 dispatch LDR；HTTP 原路径不动 |
| `packages/web/server/lib/interactive-ui/routes.js` | project directory authority、resolve前exact-key拒绝client private/unknown field、仅内部注入server-only authority、impact/purge route、lifecycle coordination；routes.local-data与既有route回归固定伪造`__projectAuthorization`负例 |
| `packages/web/server/lib/interactive-ui/package-format.js` | entry/migration index/digest；Hosted/Remote server code negative；inspection `hostCode` |
| `packages/web/server/lib/interactive-ui/manager.js` | transition seam、owner/generation、disable/update/rollback/uninstall coordination |
| `packages/web/server/lib/opencode/project-directory-runtime.js` + test | 继续只负责 decode/exists/realpath；暴露给 shared `interactive-ui/project-authority.js` 的 canonical primitive，不伪称 known authority |
| `packages/web/server/lib/git/service.js` + test | 新增不吞错的`inspectRepositoryAuthority()` strict adapter；既有`getWorktrees()`容错UI语义不变 |
| `packages/web/server/lib/opencode/feature-routes-runtime.js` + test | 使用 `createInteractiveUIHostRuntime`，registration 返回 disposable scope |
| `packages/web/server/lib/opencode/shutdown-runtime.js` + test | beginShutdown + await host dispose |
| `packages/web/server/index.js` | server instance 保存 host scope，`stop()` await dispose |
| 现有 `runtime.test.js`、`manager.test.js`、`package-format.test.js` | HTTP/Remote/安装/lifecycle 回归与 LDR 分支 |
| `scripts/interactive-ui-extension.mjs` + test | `--template local-data`/pack validation；不能把 local-data 当 delivery type |
| `packages/ui/src/lib/interactive-ui/types.ts` | action/client project context typing；不暴露 DB/SQL |
| `packages/ui/src/lib/interactive-ui/client.ts` | descriptor/artifact/action 的 `X-OpenCode-Directory` 传递 |
| `packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`、`packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx` | 接受 server project directory context并向 client adapter 传递 |
| `packages/ui/src/components/chat/message/parts/ToolPart.tsx` + test | 将已有 projectDirectory 传入 Interactive UI host |
| `packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.tsx` + test | projectId 与 server directory authority 一致性 |
| `packages/web/server/lib/interactive-ui/workbench-store.js` + test | board v2 server-private project-incarnation authority、v1迁移、public projection、client override拒绝 |
| `packages/ui/src/lib/interactive-ui/workbench.ts` + 新 test、`packages/ui/src/stores/useExtensionWorkbenchStore.ts` + test | public authorityStatus与server rebind命令；不持久/合成private authority |
| `packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx` + test | P3.1只传exact directory并触发server project-authority原子bind/rebind；失败不创建tile，不识别或发送Dev Hosted `bindingHint` |
| `packages/web/src/workbench-popout.tsx` + 新 focused test | 只以projectId/tileId bootstrap server-owned project context；不从current catalog猜authority |
| `packages/ui/src/lib/interactive-ui/extensionManager.ts` + test、`packages/ui/src/components/sections/interactive-ui/ExtensionManagerPage.tsx` | host-code review、data impact、purge UX；不显示 raw path |
| Settings search + 十个 `.settings.ts` locale | LDR 状态、数据保留/清除确认、unsupported 文案 |
| `packages/electron/main.mjs` | in-process server graceful stop 要 await；killer 只作 bounded fallback |
| `packages/electron/package.json`、`README.md` | packaged verifier script/documentation |
| 根 `package.json` | focused/functional/browser/packaged scripts与 aggregator接线（完成后） |

#### V — 只验证

- `packages/web/package.json`、`packages/electron/package.json` 现有 `better-sqlite3`；Electron `rebuild-native.mjs`、`bundle-main.mjs`、`after-pack.cjs`。
- `packages/web/server/lib/git/service.js::getWorktrees` 的既有容错UI listing行为；authority只调用同文件新增strict adapter，二者测试必须证明错误语义不同。
- `packages/ui/src/lib/runtime-fetch.ts`、`packages/web/src/api/index.ts`：继续使用 runtime adapter。
- `packages/vscode/webview/main.tsx` 与 `/api/interactive-ui/*` 501；`packages/mobile/**` 只作 client。
- `opencode/**`、MCP Apps、Generative Widget、Remote R1–R3。
- P3.1 中 `packages/web/package.json`/`bun.lock` 不得出现 Hono dependency delta。

#### R — 替代后移除/否决

- 不新增或从旧计划删除：`runtime.json`、39200–39299 端口池、in-process token、debug bypass、默认 Hono listener、shared DB root。
- 删除“Promise.race 可抢占同步 SQL”“同进程任意 Node code 是恶意隔离沙箱”“切项目关闭上一项目所有 DB”“无 ledger 的 idempotent=true”等错误承诺。
- 正常不删除现有 HTTP Gateway/Remote 产品代码。

### 11.2 P3.2 Dev Hosted

#### A — 新增

若 P3.2 是首个获授权的 project-bound consumer，最先 A `packages/web/server/lib/interactive-ui/project-authority.js` + test、`project-inventory.js` + test、`project-incarnations.js` + test和shared `host-runtime.js` + test，并M strict Git adapter（职责见 §4.4/§11.1）；若 P3.1 已实现则这些文件为 V/M + regression。两种情况下都不得信 client `projectId` 或复制 resolver/composition。

| 文件 | 责任 |
|------|------|
| `scripts/lib/interactive-ui-dev-hosted.mjs` + test | bind-first、logical/derived URL 双阶段 preimage、embedded publisher signed manifest/server/watcher/bounded retention，不含 presenter；语义 URL 变化必须换 release ID |
| `packages/web/server/lib/interactive-ui/hosted-preflight.js` + test | 从 Manager 抽 shared normalize/resource-entry/hostedSurfaceBindings preflight；Remote wrapper再叠connector policy |
| `packages/web/server/lib/interactive-ui/dev-hosted.js` + test | project source profile、`verifyRemoteOcixManifest` trust bootstrap/rotation、signed locator/preimage重算与URL一致性、shared preflight、inspect/refresh/last-good/generation；不启动 server process |
| `packages/web/server/lib/interactive-ui/routes.dev-hosted.test.js` | developer switch、project binding、preflight-before-write、refresh/re-consent、generation lease route/authority/revocation |
| `scripts/lib/interactive-ui-dev-hosted-fixture.mjs` | signed A/B/invalid releases |
| `scripts/verify-interactive-ui-dev-hosted-functional.mjs` | CLI resource server + product Manager/Host interop |

#### M — 修改

- `scripts/interactive-ui-extension.mjs` + test：`dev-hosted` 命令、TTY/non-TTY/json/quiet/exit codes。
- `hosted-ocix.test.js`：增加 Dev Hosted loopback/absolute URL/resource kernel cases；生产 `hosted-ocix.js` 预计 V。
- `remote-ocix.js`/Remote tests：生产 `verifyRemoteOcixManifest` 与 `selectRemoteConnector` 均 V；Dev Hosted 只调用前者。若为了导出命名测试 seam 必须改文件，需单独差异说明，R1–R3语义不变。
- `manager.js` + test：`source.type="dev-hosted"`、project binding、single active extension ID、B.3.1 bounded inspection records/connect-refresh-disable atomic lifecycle、last-good/generation；generation binding/lease store、caps、resolve/acquire/renew/resume/release/revoke；active authority 与 leased read authority严格分函数；server startup先重验current generation、重发marker并重建wrapper/integrity，OpenCode reconcile成功前Tool不可见。
- `runtime.js` + test：resource resolver可接受精确 Dev Hosted read lease；business action必须校验marker绑定generation===active，inactive在confirmation前拒绝；metadata/tool仍只认active generation。
- `routes.js`：严格实现B.3.1 source inspect/connect/refresh/disable与B.4 binding/lease route、developer switch；exact directory/body/error/Cache-Control，不复用 Remote access-key route。
- `packages/web/server/lib/ui-auth/ui-auth.js` + test：只为`/api/interactive-ui/dev-hosted/assets/<32hex>/(descriptor|resources/<64hex>)`的GET/HEAD加入exact URL-token allowlist；POST/WebSocket/宽prefix不放行，token/asset-key日志脱敏。
- `packages/web/server/lib/opencode/feature-routes-runtime.js` + test：若P3.2先获批，构造/注册shared `createInteractiveUIHostRuntime`，注入settings roots、strict `project-inventory`、session lookup与Dev Hosted adapter；registration dispose清lease timer/inflight refresh。若P3.1已接线则只扩展并回归，不能建立第二composition root。
- `packages/web/server/lib/opencode/shutdown-runtime.js` + test、`packages/web/server/index.js`：保存feature registration返回的host scope；graceful stop先beginShutdown拒绝新source/lease，再await inflight refresh与scope.dispose，最后清引用。若P3.1已接线则只复用/回归；不能让返回的disposable无人调用。
- host-generated Dev Hosted Tool source必须注入不可覆盖的 `hostBinding`，按generation+surface去重保存binding record；不能接受扩展/Agent自报 marker。既有 `agent-runtime.js::reconcileOpenCodeAgentRuntime` 正常为V；若需要暴露“先生成全部wrapper、再单次原子reconcile”的seam，才由同一server authority owner修改 `agent-runtime.js` + test，禁止另建第二registry。
- 新增 `packages/ui/src/lib/interactive-ui/devHostedBinding.ts` + test；修改 `packages/ui/src/lib/interactive-ui/types.ts`、`packages/ui/src/lib/interactive-ui/result.ts` + test、`packages/ui/src/lib/interactive-ui/installedArtifactResult.ts` + test、`packages/ui/src/lib/interactive-ui/client.ts` + test、`packages/ui/src/components/chat/message/parts/ToolPart.tsx` + test、`packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.tsx` + test、`packages/ui/src/components/interactive-ui/InteractiveUIView.tsx` + test、`packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx` + focused test：exact-key解析对话marker，把Tool exact server directory/marker或Workbench `{projectId,tileId}`传到surface；三surface分别resolve/acquire，所有mounted状态heartbeat/resume/release，Business action携对话marker或workbench ref。lease/resume handle绝不进持久化/report。
- `packages/ui/src/components/interactive-ui/nativeRegistry.ts` + 新`nativeRegistry.test.ts`：把全局view/load maps替换为per-mounted-surface closure scope，跟随lease acquire/resume原子swap与dispose；覆盖同viewId A+C并存、duplicate仅scope内拒绝、A dispose不删C、activation disposer/failed load cleanup。`InteractiveUIView.tsx`是scope的唯一生命周期owner。
- `packages/web/server/lib/interactive-ui/workbench-store.js` + test、`packages/ui/src/lib/interactive-ui/workbench.ts` + 新 test、`packages/ui/src/stores/useExtensionWorkbenchStore.ts` + test、`packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx` + test：board v2 private authority、v1迁移rebind-required、bindingHint原子pin、public projection、client private-field拒绝。
- `packages/web/src/workbench-popout.tsx` + 新 focused test：独立React root只用projectId/tileId安全bootstrap，每窗口独立acquire/heartbeat/resume/release/pagehide cleanup；A→C reload不从current catalog重造C。Electron `main.mjs`现有runtime arguments/window security normally V，只补packaged popout回归。
- `packages/ui/src/lib/interactive-ui/extensionManager.ts` + test / `packages/ui/src/components/sections/interactive-ui/ExtensionManagerPage.tsx`、Settings search/十 locale：只消费B.3.1 public inspection/source wire；确认manifest/fingerprint/re-consent、disabled/degraded/last-good UX，无key表单、无private project/source URL。
- 根 `package.json`：CLI/functional scripts；完成后接 unified functional。
- `OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md`、Developer Guide、server/UI `DOCUMENTATION.md`：当前合同/状态。

#### V — 只验证

- Remote R1–R3 connection/credential/cache/re-consent；Hosted thin package 仍只含 manifest。
- `hosted-ocix.js` 当前已允许 loopback HTTP；不做重复 URL parser feature。
- `remote-ocix.js::verifyRemoteOcixManifest` 是唯一 embedded publisher verifier；不新增 publisher endpoint/schema，且 Dev Hosted 不调用 `selectRemoteConnector`。
- Remote/Hosted authority默认仍只接受current generation；inactive-generation lease只存在于新Dev Hosted专用只读resolver。
- Agent Runtime Tool registry 当前全局的事实；首版不声称 per-project 同 ID 并存。
- `packages/web/server/lib/git/service.js::getWorktrees`：V为UI listing；P3.2若是首个consumer则同文件新增strict adapter为M，authority不得调用容错listing或经HTTP/UI缓存反调。
- LDR server code 只能来自 signed Local full package；P3.2 MVP 的 Dev Hosted/Hosted `resources[]` 和 raw source root 一律不执行。
- Electron 不新增 sidecar；OpenCode 不改。

#### R — 替代后移除/否决

- 无 unsigned mode、LAN HTTP、source-directory static fallback、自动 npm install、任意 command supervisor、Remote trust bypass。
- shared preflight tests 通过后，从 `manager.js` 删除原私有 `validateRemoteExtensionMetadata`/resource-entry/preflight重复实现；Remote 与Dev Hosted只import一个深模块，不留两套规则。
- Gate 完成后删除临时 PoC-only command/fixture；保留正式 CLI/functional verifier。

### 11.3 P3.3 Codex-style Shell

#### A — 新增

- `packages/ui/src/lib/shell/workspaceScopeAuthority.ts` + test（§4.4.1 exact decoder、abort/乱序；503/network→suspended、same-ID resume/different-ID discard；明确422 ephemeral且重复focus不旋转；不接受client自造identity）。
- `packages/ui/src/lib/shell/contextWorkspaceState.ts` + test。
- `packages/ui/src/components/layout/ContextWorkspace.tsx` + test。
- `packages/ui/src/lib/latestCompletedAssistant.ts` + test。
- `packages/ui/src/sync/task-output-transition.ts` + test（纯transition derivation + 无replay typed channel）。
- `packages/ui/src/sync/task-output-registry-runtime.ts` + test（runtime-scoped常驻consumer、background task persistence、dispose/flush）。
- `packages/ui/src/hooks/useTaskOutputRegistry.ts` + `useTaskOutputRegistry.test.tsx`。
- `packages/ui/src/components/layout/TaskHeaderActions.tsx` + test（菜单顺序、disabled/failure、archive/fork/new-window分流）。
- `packages/ui/src/components/layout/TaskOutputsPopover.tsx` + test（200/2000/2MiB caps呈现、dedupe、empty/a11y）。
- `packages/ui/src/components/interactive-ui/connections/ConnectionConfigurationDialog.tsx` + test。
- `packages/electron/session-window-runtime.mjs` + test（用于 source-window authority clone）。

#### M — 修改

| 领域 | 文件 |
|------|------|
| Scope authority（条件M/A） | 若P3.3为shared authority首个consumer：`packages/web/server/lib/interactive-ui/project-authority.js`、`project-inventory.js`、`project-incarnations.js`、`host-runtime.js`及tests按§4.4先A；无论是否首个consumer，`packages/web/server/lib/interactive-ui/routes.js` + focused route test、`packages/web/server/lib/opencode/feature-routes-runtime.js` + test接入唯一read-only projection。若foundation已存在则前四项V/M，不得复制模块 |
| Scope identity UI | `packages/ui/src/components/session/sidebar/sessionOwnership.ts` + 新 test仅产canonical owner hint/topology invalidation；`packages/ui/src/sync/session-ui-store.ts` + test发布worktree topology revision；真实identity只由`workspaceScopeAuthority.ts`取得，suspended期间所有resource adapter attach/create fail closed |
| Navigation/Header | `packages/ui/src/components/session/sidebar/sidebarNavigationConfig.ts` + test、`packages/ui/src/components/session/sidebar/SidebarNavigation.tsx`、`packages/ui/src/components/layout/Header.tsx` + 新 focused test、`packages/ui/src/components/session/ForkSessionDialog.tsx` + 新 test |
| Output authority | `packages/ui/src/sync/event-reducer.ts` + `packages/ui/src/sync/__tests__/event-reducer.test.ts`、`packages/ui/src/sync/sync-context.tsx` + `packages/ui/src/sync/__tests__/sync-context-session-events.test.ts`：Tool previous→completed（含completed state attachments）、顶层FilePart拒绝、snapshot origin、captured runtimeKey、batch publish-after-store |
| Output registry | `packages/ui/src/lib/taskOutputRegistry.ts` + test、`packages/ui/src/components/chat/changedFiles.ts` + 新 test；runtime常驻consumer写入，hook只select当前task |
| Workspace store | `packages/ui/src/stores/useUIStore.ts`、`packages/ui/src/stores/useUIStore.contextPanel.test.ts`、`packages/ui/src/components/layout/shellWidths.test.ts`（冻结 320–960/default 420）；key含server opaque `scopeInstanceId`，identity旋转原子tombstone旧resource |
| Workspace UI | `packages/ui/src/components/layout/ContextPanel.tsx`、`packages/ui/src/components/layout/MainLayout.tsx`、`packages/ui/src/components/layout/ProjectActionsButton.tsx`、`packages/ui/src/components/ui/CommandPalette.tsx` + 新 entrypoint test、`packages/ui/src/lib/surfaces/registry.ts`、`packages/ui/src/components/ui/sortable-tabs-strip.tsx` + 新 keyboard/focus/close-lifecycle test |
| Terminal UI | `packages/ui/src/components/views/TerminalView.tsx` + 新 adapter/close test、`packages/ui/src/components/terminal/TerminalViewport.tsx` + 新 hidden/mount test、`packages/ui/src/stores/useTerminalStore.ts` + test；desktop lookup必须包含`scopeInstanceId`且同路径新incarnation不复用旧terminalSessionId；只有 adapter 需要时才改 `packages/ui/src/lib/terminalApi.ts`，不改 wire |
| Applications | `packages/ui/src/components/sections/interactive-ui/ExtensionManagerPage.tsx`、`packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.tsx` + test、现有 `packages/ui/src/lib/interactive-ui/extensionManager.ts` |
| Electron | `packages/electron/main.mjs`；Header payload同步；`session-window-runtime.test.mjs`固定source-window authority clone与secret-free payload |
| i18n | `packages/ui/src/lib/i18n/messages/` 下十个主 locale `en/es/fr/ja/ko/pl/pt-BR/uk/zh-CN/zh-TW.ts`，以及 `packages/ui/src/lib/i18n/messages.test.ts` |

#### V — 只验证

- `packages/ui/src/lib/api/types.ts` Terminal API、`packages/ui/src/lib/terminalApi.ts` v3、`packages/ui/src/lib/relay/runtime-socket.ts`。
- `packages/web/src/api/terminal.ts`；`packages/web/server/lib/terminal/runtime.js`、`terminal-ws-protocol.js`、`shells.js`、`history.js`、`theme-response.js`。
- startup/shutdown、`packages/web/server/lib/relay/tunnel-host.js`、UI auth、realtime proxy 三处 allowlist。
- connection-store/Gateway/routes 的 secret、安全与 uninstall transaction。
- Electron in-process server、packaged asset protocol；VS Code stub；Mobile app。

#### R — 完成替代后删除

- `packages/ui/src/components/layout/ContextPanelRail.tsx`，但先为所有 content-driven surfaces 补入口。
- `useUIStore` 的 `contextRailOrder/setContextRailOrder` 和旧 rail persistence/tests。
- `packages/ui/src/components/layout/MainLayout.tsx` desktop full-view Terminal branch/import。
- desktop `packages/ui/src/components/views/TerminalView.tsx` nested tab strip 路径（Mobile 保留）。
- silent `clampContextPanelTabs` live-resource eviction。

不得删除 Terminal backend/allowlists、Mobile tabs、VS Code unsupported、content surface 本身或 Secret Store。

### 11.4 P3.4 Agent Routing Phase 4

#### Gate 0 — 触发判断前允许的证据改动

P2 完成并获得 Gate 0 evaluation 授权后先执行；这些文件不代表 Phase 4 已触发。

- A：`scripts/verify-interactive-ui-model-routing-baseline.mjs`，负责 demo lifecycle、三次冷会话、run-id 目录、aggregate 和总 `finally`。
- M：`scripts/verify-interactive-ui-model-routing.mjs`，接受显式 output/run identity，补两仓 revision、SDK/CLI、catalog/corpus digest、retry provenance，并把 publisher/CRM/session cleanup 放在顶层 `try/finally`。
- M：根 `package.json` 新增单一 `test:interactive-ui-model-routing:baseline` 入口；不得把 scorer quality gate提前挂入 unified。
- V：17 条 legacy、I1–I5 和 20 条 static corpus 内容/denominator；demo start/stop 脚本；现有 Tool registry、Gateway 和 routing prompt。
- R：旧固定 `.tmp/interactive-ui-model-routing/report.json` 仅作历史证据，不读取、不覆盖；不删用户已有报告。

三次 aggregate 达到 §8.2 后，由用户决定 `result=not-triggered` 或授权以下 scorer 表。

#### Trigger 后 — scorer 产品改动

只有 §8 触发门通过且用户授权后才使用此表。

在任何 scorer/server/client worker 开工前，`routing_contract_owner`（高级）必须先只写合同测试与fixture：server normalizer/scorer向量只进`routing-quality.test.js`，request/response decoder只进`routing-decision-contract.test.js`，client authored-text/field-name向量只进`routingDecisionText.contract.test.ts`。三者共同冻结§8.4的normalizer、stop/cue常量、tuple/outcome、reason-code union、bounds与C.1 exact wire，但不得跨package复制production builder。该wave不得实现scorer、改route/client或查看测试结果后调阈值；contract tests经只读review后才handoff。

#### A — 新增

- `packages/web/server/lib/interactive-ui/routing-quality.js` + test：`normalizeRoutingTextV1`、冻结向量、`rankInteractiveUICapabilities`、`buildRoutingDecision`；test先由contract owner落地，module再由scorer owner实现。
- `packages/web/server/lib/interactive-ui/routing-decision-contract.js` + test：C.1 exact request/success/error decoder、reason-code union与bounds；test/fixture由`routing_contract_owner`先冻结并hand off，production module只由`routing_server_owner`实现；server/UI都从此合同的fixture生成测试，不复制自由schema。
- `packages/ui/src/lib/interactive-ui/routingDecisionText.contract.test.ts`：只由`routing_contract_owner`新增并冻结§8.4.5的authored-text/GET–POST field-name vectors；它不是production module，client worker不得改宽。
- `packages/ui/src/lib/interactive-ui/routing.test.ts`：当前不存在；由`routing_client_owner`新增作`routing.ts` integration/fallback/cache test，不得取代或修改contract owner的builder vectors。
- `packages/web/server/lib/interactive-ui/routes.routing-decision.test.js`：由`routing_server_owner`在冻结wire handoff后新增，覆盖真实POST route、flat error/no-store/auth/body caps与runtime shared revision；不复制scorer算法。
- `scripts/verify-interactive-ui-routing-quality.mjs`：paired A/B report。
- 证据触发的新 conflict corpus（不能修改 legacy corpus）。

#### M — 修改

- `packages/web/server/lib/interactive-ui/runtime.js` + existing `runtime.test.js`：`getRoutingDecision`，复用extension/connector；Phase4后GET/POST共同使用含normalized hidden examples、与user text无关的private scorer-input revision helper，直测example-only change、同catalog/different-text revision不变与零泄漏。
- `packages/web/server/lib/interactive-ui/routes.js`：POST decision route/body/no-store。
- `packages/ui/src/lib/interactive-ui/routing.ts`：实现`buildRoutingDecisionTextV1()`、`resolveInteractiveUIRoutingContext(text)`、GET `revision`/POST `catalogRevision`两套exact decoder和timeout/non2xx/invalid-body GET fallback；必须通过新增的`routing.test.ts`且不修改contract owner的`routingDecisionText.contract.test.ts`。
- `packages/ui/src/lib/opencode/client.ts` + test：只调用一次builder，decision/Inspector共用同一authored text或共同无text；默认synthetic preface、synthetic additional parts、file/agent parts均不进入scorer，send failure semantics不变。
- `packages/ui/src/lib/interactive-ui/routingInspector.ts` + test：用`runtimeKey/sessionId/parentUserMessageId` exact correlation、scorer outcome/reason；删除latest-session fallback，redaction不变。
- `packages/ui/src/components/chat/ChatMessage.tsx`、`packages/ui/src/components/chat/message/MessageBody.tsx`、`packages/ui/src/components/chat/components/TurnActivity.tsx`、`packages/ui/src/components/chat/message/parts/ProgressiveGroup.tsx`、`packages/ui/src/components/chat/message/parts/ToolPart.tsx` + existing/new focused tests：从同一个assistant message的`info.id`传`assistantMessageId`、从`info.parentID`传`parentUserMessageId`；ToolPart只把`part.messageID`作为actual值与上层expected assistant ID比较。direct/aggregated Tool路径一致，其他caller缺parent时不观察。
- A `packages/ui/src/components/chat/message/routingObservationContext.test.tsx`：覆盖U1/U2同session逆序Tool、`assistant.info.id + assistant.info.parentID`的direct/ProgressiveGroup prop chain、missing/wrong parent与`part.messageID !== assistantMessageId`均无latest fallback；测试不得用part自身ID同时充当expected/actual。
- `scripts/verify-interactive-ui-model-routing.mjs`：只消费 Gate 0 已冻结的 provenance/output contract，不在 scorer wave 临时改报告口径。
- 根 `package.json`：只有正式采用后新增/聚合 quality gate。
- Routing plan、unified report、roadmap（最后）。

#### V/R

- V：17 条 `unified-acceptance-corpus.json`、P2 I1–I5、现有 20 条 `routing-cases.json` denominator；OpenCode SessionPrompt/Tool registry/permission。
- R：无。Phase 3 GET/full catalog 是正式 fallback，不删除。

### 11.5 P3.5 Native Chart

#### Gate A PoC-only A/M/V/R

- A：`packages/ui/src/lib/interactive-ui/nativeChart.ts` + test；`packages/ui/src/components/interactive-ui/NativeChart.tsx`、`packages/ui/src/components/interactive-ui/NativeChartRecharts.tsx` + test；`scripts/verify-interactive-ui-native-chart-poc.mjs`。
- M（隔离 PoC worktree only）：`packages/ui/package.json` + `bun.lock` exact experimental pin；`packages/web/src/interactive-ui-demo.tsx` / `packages/web/src/interactive-ui-visual-fixtures.ts` 增 disposable `native-chart-poc`。
- V：`packages/ui/src/lib/interactive-ui/types.ts`、`packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts`、`packages/ui/src/components/interactive-ui/nativeRegistry.ts`、examples、Declarative chart/schema/Tool、server runtime/routes。
- R：Gate A reject/用户不批准时删除全部 PoC code、dependency、lock/demo delta，只保留脱敏结论。

#### Gate B 采用后的 A/M/V/R

- A：同上正式 deep module；新增`packages/ui/src/components/interactive-ui/nativeUIKitRegistry.test.ts`，只验证exact Host registry key、optional capability与bounded component identity，不导出raw Recharts。
- A/tracked fixture：`examples/interactive-ui/acme-sales/ui/native/sales-dashboard.mjs`、`examples/interactive-ui/acme-crm/ui/native/crm-dashboard.mjs`、`templates/interactive-ui-extension/ui/native/dashboard.mjs`。后两者只承接现有单文件内容，不调用Chart。
- M：`packages/ui/package.json`、`bun.lock` exact approved pin；`packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts` 加 `Chart: NativeChart`；`packages/ui/src/lib/interactive-ui/types.ts` 加精确 `NativeChartProps` 与 optional Chart；`packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx`。
- M：Sales/CRM/template 三个 `openchamber.extension.json` 的 Native `entry` 改为上述 tracked path；Sales entry使用 optional Host Chart + Notice/表格 fallback，`1.0.0→1.1.0`；CRM只做路径迁移，`1.0.0→1.0.1`以避开installed Native module cache；template仍生成全新扩展，模板默认版本保持`1.0.0`。三者权限不变。
- M：`scripts/interactive-ui-extension.test.mjs` 在临时 clean copy验证 manifest全部entry存在、能validate/pack，且不读取 repo-local ignored `dist`；视觉/demo直接消费 tracked entry，无复制历史bundle步骤。
- M：visual verifier 等 ready marker/lazy request/a11y/390 checks；performance verifier量 closure/cold/warm；人工批准后才更新 `native-*.png` 与 manifest。
- M：Style Contract、Developer Guide、UI Documentation、Style plan/report、roadmap。
- 条件 M `packages/web/vite.config.ts`：只有 generic chunking 不能保持 lazy closure 才加规则。
- V：`packages/ui/src/components/interactive-ui/nativeRegistry.ts`（无论当前global loader还是未来P3.2 scoped loader都零改动）、`packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx::DeclarativeChart`、`packages/ui/src/lib/interactive-ui/generatedLayout.ts`、builtin `interactive_ui.ts`；`packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`/server；CRM/template的运行行为（仅entry路径迁移）；Electron/mobile staging code；OpenCode。
- R：删除 PoC-only route/fixture/script名字；三个manifest停止引用历史ignored `dist/ui.mjs`，但Agent不得自动删除用户worktree里的ignored文件或修改全局`.gitignore`，只清理自己创建的临时copy；删除tracked Sales entry中的旧手写柱图；不留 raw Recharts export/dual chart/feature flag。

### 11.6 P3.6 partial/streaming

#### OpenCode A/M/V/R

| 状态 | 文件 |
|------|------|
| A | `packages/schema/src/v1/tool-progress.ts`（仅snapshot wire，不放rejection union）；`packages/opencode/src/tool/progress.ts`（internal input/rejection union+error/publish/unavailable唯一源码）；`packages/opencode/test/session/tool-progress.test.ts`；`packages/opencode/test/tool/tool-progress-context.test.ts`；`packages/opencode/test/tool/registry-progress.test.ts`；`packages/opencode/test/cli/debug-agent-progress.test.ts`；`packages/opencode/test/fixture/tool-context.ts` |
| M | `packages/schema/src/v1/session.ts` running/error progress；`packages/opencode/src/tool/tool.ts`只加optional internal field/type import且`Def.execute`继续error=never；`packages/opencode/src/session/processor.ts`给`Handle`增加exact typed `publishToolProgress`并以同一per-call Effect队列串行metadata/progress/complete/fail；`packages/opencode/src/session/tools.ts`的processor Pick/context只给normal Session注入typed publisher |
| M | `packages/opencode/src/tool/registry.ts`剥离internal progress后再构造既有`PluginToolContext`，不新增Promise bridge/公开API；focused test断言plugin看不到field且仍final-only |
| M | `packages/opencode/src/session/prompt.ts` 两个manual context（subtask direct execute与file-read expansion）、`packages/opencode/src/cli/cmd/debug/agent.handler.ts::createToolContext`：显式注入同一个`ToolProgress.unavailable`，绝不能no-op/success；`packages/opencode/test/session/prompt.test.ts`与debug focused test固定unavailable、零PartUpdated |
| M | **仅Gate O0后**：必须先把用户批准的自然多阶段OpenCode built-in internal production Tool精确路径写在本行；当前built-in `interactive_ui.ts`为V，不得伪造progress。外部/plugin Tool不满足v1；占位未替换时任何Agent禁止开始O1 |
| M | **O1阶段**：`packages/opencode/src/server/routes/instance/httpapi/groups/global.ts` capability schema；`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` 在O1/O2期间必须显式返回 `toolProgressSnapshotsV1:false`，并有false-path test |
| M | **仅C1后**：只有C1证明获批producer/history/terminal/SDK整链后，同一capability owner才把`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`改为true并补production capability test；任何stub/fixture不能提前开启 |
| M | `packages/opencode/test/server/httpapi-global.test.ts`；SDK history/replay tests；`script/openchamber-compat.ts` |
| M | `packages/sdk/openapi.json`与`packages/sdk/js/src/v2/gen/**`只由标准generator产生，归同一个SDK owner、禁止手改；repo-level OpenAPI必须含running/error progress与capability schema，不能只运行会删除临时spec的JS package build |
| V | 现有typed fixture literals：`test/tool/{apply_patch,code-mode,code-mode-integration,edit,external-directory,glob,grep,lsp,question,read,registry,shell,skill,task,tool-define,webfetch,write}.test.ts`与`test/mcp/session-tools.test.ts`；不得批量塞fake success/no-op progress。`bun run typecheck`与新`tool-progress-context.test.ts`证明field可省略、helper fail-closed；P3.6新增/修改的fixture统一用`test/fixture/tool-context.ts` |
| V | `packages/plugin/src/tool.ts`、`packages/plugin/package.json`、root catalog/lock、`.github/workflows/openchamber-release.yml`的package集合、`packages/core/src/installation/version.ts` plugin resolver：v1不新增/发布fork plugin API，不改变upstream plugin解析；registry测试证明internal field不泄漏 |
| V | built-in `interactive_ui.ts`（当前同步一次 final，不用 sleep/重复 payload 改造）；现有 `packages/schema/src/session-event.ts` progress、core message-updater/projector/test 作为设计先例；`message.part.delta` string wire不变 |
| R | 无；legacy completed output/PartUpdated 保留 |

必须新增 regression：legacy `tool-input-delta` 仍不成为 UI contract，`pending.raw==""`。

#### OpenChamber A/M/V/R

| 状态 | 文件 |
|------|------|
| A | `packages/ui/src/lib/opencode/distributionCapabilities.ts` + test |
| A | `packages/ui/src/lib/interactive-ui/partialResult.ts` + test |
| A | `packages/ui/src/components/interactive-ui/InteractiveUIToolSurface.tsx` + test |
| A | `examples/interactive-ui/partial-streaming-corpus.json`、`scripts/verify-interactive-ui-partial-streaming.mjs` |
| M | `packages/ui/src/lib/interactive-ui/result.ts` 抽 `parseInteractiveResultEnvelopeValue(unknown)`，string final parser保留 |
| M | `packages/ui/src/components/chat/message/parts/ToolPart.tsx` 委托新 surface |
| M | `packages/ui/src/sync/event-reducer.ts` + tests 加 revision/terminal guard；`packages/ui/src/sync/event-pipeline.test.ts` 验 full PartUpdated barrier/replay |
| M/test | `packages/ui/src/components/chat/message/renderCompare.test.ts`；生产 `packages/ui/src/components/chat/message/renderCompare.ts` 预计 V，除非测试证明 state reference 未触发 |
| M | `packages/web/server/lib/opencode/routes.js` external fallback false + capability tests |
| M | `scripts/verify-interactive-ui-unified-acceptance.mjs`：纳入 partial report、检查 freshness/provenance/complete，不得只读取旧 report |
| M | `packages/electron/scripts/verify-packaged-interactive-ui.mjs`：验证 packaged managed CLI revision/capability、partial case 与 staged UI assets；不能只证明文件存在 |
| M | 全 locale 的 partial/incomplete/failed 状态；根/package workspace SDK aliases、`bun.lock`、`packages/electron/opencode-cli.lock.json`（仅在同revision release成功、另获Managed pin授权后） |
| V | `packages/ui/src/lib/interactive-ui/generatedLayout.ts` limits、`packages/ui/src/components/interactive-ui/InteractiveUIView.tsx` descriptor、`packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx` renderer、`packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx`、HTML/MCP/Native/Installed/show-widget |
| V | `packages/ui/src/lib/runtime-fetch.ts`与`packages/ui/src/lib/runtime-switch.ts`：只消费现有独立exports，不给`RuntimeAPIs`虚构成员、不改runtime lifecycle；`distributionCapabilities.test.ts`覆盖nested wrapper decoder vectors、captured key、will-change abort/clear、late old response drop、changed后cold refetch与dispose unsubscribe |
| R | 无；final-only 是 feature-disabled/old runtime 的正式 fallback |

---

## 12. 平台、权限、数据与安全矩阵

### 12.1 平台矩阵

| 能力 | Web/local server | Electron managed | Web→remote server | Relay | VS Code | Mobile/Capacitor |
|------|------------------|------------------|-------------------|-------|---------|------------------|
| P3.1 LDR | server 持有 DB | main 内同一 server，packaged native addon | DB 在远端 server | 普通 action HTTP 透明 | v1 explicit unsupported/501 | 只作远端 client，不在设备跑 SQLite |
| P3.2 Dev Hosted | project Manager + loopback source（源需在 server 可达主机） | 同上，不起 sidecar | 远端 server不能访问客户端 localhost；需在远端主机启动 source | 不新增协议 | unsupported | 不在设备起 source server |
| P3.3 Shell | desktop Web 完整 | 完整 + new-window authority | 完整，local file reveal受限 | Terminal v3 支持 | 旧壳/Terminal unsupported | 保持 Mobile 壳，Terminal 是 server PTY |
| P3.4 routing scorer | server scorer + UI adapter | 同上 | scorer 在所连 OpenChamber server | 普通 HTTP | 只有相同 server能力时 | shared UI send path，按runtime capability |
| P3.5 Native Chart | Host lazy chunk | staged Web dist 必须含 chunk | 从当前 UI build 加载 | 静态 UI asset | build不等于Trusted Native支持 | Web dist staged，但需明确支持/性能证据 |
| P3.6 partial | capability+SDK+shared UI | 同上 | 取决于远端 fork capability | SSE/history既有传输 | final-only直到正式支持 | shared UI可渲染，但只在server capability true |

### 12.2 权限与 authority

| 资源 | 唯一 authority | 客户端可提供 | 客户端绝不能决定 |
|------|----------------|--------------|--------------------|
| LDR project | server canonical known project directory | runtime-aware directory header/hint | DB path、project key、跨项目 override |
| LDR code | signed Local package index + admin consent | action input | entry/module/migration/SQL |
| Dev Hosted content | signed manifest/resource digest + project Dev source record | loopback manifest URL | unsigned bytes、fingerprint bypass、server code execution |
| Connector secret | server Secret Store | 新值通过专用 config form | public snapshot、Workspace state、Output registry |
| Shell resource | workspace reducer + resource adapter | user create/select/close intent | silent eviction、直接销毁失败资源 |
| Terminal process | server Terminal runtime | allowlisted shell/cwd/resize/input | arbitrary command/args、raw WS endpoint |
| Routing decision | server scorer + actual OpenCode Tool registry | current bounded user turn | direct Tool execution、permission、business truth |
| Native Chart | Host normalizer/render implementation | bounded data/semantic props | raw Recharts/DOM/network/styles |
| Tool progress | OpenCode SessionProcessor revisioned full snapshot | Tool structured candidate | revision、terminal override、client raw recovery |

### 12.3 数据保留和日志

| 能力 | 持久化 | 日志/报告允许 | 禁止 |
|------|--------|---------------|------|
| LDR | managed SQLite + meta/migration ledger + private scope-incarnation ledger；uninstall/project untrack 默认原位保留；只有独立 explicit clear/purge 才移 managed trash | requestId、extension、opaque projectKey prefix、reason、timing | path、filesystem tuple/incarnation、SQL、params、row data、stack |
| Dev Hosted | Manager source record、last-good metadata；CLI temp snapshots | release ID、digest、status、safe URL | private key/source path/full manifest/secret |
| Shell | task safeStorage outputs、workspace identity/order/width | aggregate perf/error reason | bearer token、endpoint secret、terminal bytes |
| Routing | Inspector bounded in-memory redacted trace | IDs、outcome、reason codes、stage statuses | user text、prompt/examples、Tool I/O、business data |
| Native Chart | 无独立业务持久化 | sizes/timing/errors/fixture IDs | real business dataset、tooltip content dump |
| Partial | latest ToolPart由OpenCode session持久；UI ledger内存 | revision/bytes/drop reason/timing | structured payload/layout/prompt/secret |

### 12.4 安全审查必问

1. 是否把“可信同进程代码”误写成 sandbox？
2. 是否存在 UI 直连 DB、dev loopback、business endpoint 或 raw WebSocket？
3. 是否有 client-provided path/project/revision/fingerprint 被当 authority？
4. 是否允许 Remote/Dev resource 变成本地可执行 server code？
5. 是否把 unavailable/migration/error/offline 渲染成空数据？
6. 是否把 secret/token 放进 localStorage、safeStorage generic record、IPC payload、report 或 screenshot？
7. 是否有删除路径使用未解析 env/glob、symlink/父目录竞态或 broad root？
8. 是否用测试 fixture 放宽生产签名、permission、hash、limits？
9. 是否因 Shell/Chart/streaming 改动了无关 Terminal、Declarative、MCP、Widget 协议？
10. 是否把未在真实平台运行的结果写成 supported/passed？

---

## 13. 测试矩阵、命令与证据格式

以下命令分为“现有回归”与“计划新增”。新增脚本在文件存在前不能伪报已运行。实施 Agent 必须记录命令、cwd、exit code、测试数、跳过项、环境、产物路径；只写“测试通过”不合格。

### 13.1 P3.1 LDR

Focused unit（计划）：

```bash
cd openchamber
node --test \
  packages/web/server/lib/interactive-ui/local-data/contract.test.js \
  packages/web/server/lib/interactive-ui/project-authority.test.js \
  packages/web/server/lib/interactive-ui/project-inventory.test.js \
  packages/web/server/lib/interactive-ui/project-incarnations.test.js \
  packages/web/server/lib/interactive-ui/local-data/database.test.js \
  packages/web/server/lib/interactive-ui/local-data/migrations.test.js \
  packages/web/server/lib/interactive-ui/local-data/module-loader.test.js \
  packages/web/server/lib/interactive-ui/local-data/runtime.test.js \
  packages/web/server/lib/interactive-ui/host-runtime.test.js \
  packages/web/server/lib/interactive-ui/routes.local-data.test.js
```

现有 server 回归：

```bash
node --test \
  packages/web/server/lib/interactive-ui/runtime.test.js \
  packages/web/server/lib/interactive-ui/package-format.test.js \
  packages/web/server/lib/interactive-ui/manager.test.js \
  packages/web/server/lib/interactive-ui/workbench-store.test.js \
  packages/web/server/lib/git/service.test.js \
  packages/web/server/lib/opencode/project-directory-runtime.test.js \
  packages/web/server/lib/opencode/feature-routes-runtime.test.js \
  packages/web/server/lib/opencode/shutdown-runtime.test.js
```

Shared UI：

```bash
bun test \
  packages/ui/src/lib/interactive-ui/client.test.ts \
  packages/ui/src/components/interactive-ui/InteractiveUIView.test.tsx \
  packages/ui/src/components/interactive-ui/HTMLArtifactView.test.tsx \
  packages/ui/src/lib/interactive-ui/extensionManager.test.ts \
  packages/ui/src/components/chat/message/parts/ToolPart.test.ts \
  packages/ui/src/lib/interactive-ui/workbench.test.ts \
  packages/ui/src/stores/useExtensionWorkbenchStore.test.ts \
  packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.test.ts \
  packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.test.ts

cd packages/web && bunx vitest run src/workbench-popout.test.tsx
cd ../..
```

计划验收：

```bash
bun run test:interactive-ui-local-data-functional
bun run test:interactive-ui-local-data-browser
bun run test:interactive-ui-local-data-runtime-parity
bun run electron:build
bun run test:interactive-ui-local-data-packaged
```

Packaged verifier 不能只检查 `.node` 文件存在；必须真正建库、migration、write/read、完全退出、重开、持久化、graceful stop。跨平台 native addon 只能由各 OS/arch runner 验证。

### 13.2 P3.2 Dev Hosted

```bash
cd openchamber
node --test \
  scripts/lib/interactive-ui-dev-hosted.test.mjs \
  scripts/interactive-ui-extension.test.mjs \
  packages/web/server/lib/interactive-ui/project-authority.test.js \
  packages/web/server/lib/interactive-ui/project-inventory.test.js \
  packages/web/server/lib/interactive-ui/project-incarnations.test.js \
  packages/web/server/lib/interactive-ui/host-runtime.test.js \
  packages/web/server/lib/interactive-ui/hosted-preflight.test.js \
  packages/web/server/lib/interactive-ui/dev-hosted.test.js \
  packages/web/server/lib/interactive-ui/routes.dev-hosted.test.js \
  packages/web/server/lib/interactive-ui/hosted-ocix.test.js \
  packages/web/server/lib/interactive-ui/routes.remote.test.js \
  packages/web/server/lib/interactive-ui/manager.test.js \
  packages/web/server/lib/interactive-ui/runtime.test.js \
  packages/web/server/lib/interactive-ui/workbench-store.test.js \
  packages/web/server/lib/git/service.test.js \
  packages/web/server/lib/opencode/feature-routes-runtime.test.js \
  packages/web/server/lib/opencode/shutdown-runtime.test.js \
  packages/web/server/lib/ui-auth/ui-auth.test.js

bun test \
  packages/ui/src/components/chat/message/parts/ToolPart.test.ts \
  packages/ui/src/lib/interactive-ui/devHostedBinding.test.ts \
  packages/ui/src/lib/interactive-ui/result.test.ts \
  packages/ui/src/lib/interactive-ui/installedArtifactResult.test.ts \
  packages/ui/src/lib/interactive-ui/client.test.ts \
  packages/ui/src/lib/interactive-ui/extensionManager.test.ts \
  packages/ui/src/components/interactive-ui/InteractiveUIView.test.tsx \
  packages/ui/src/components/interactive-ui/nativeRegistry.test.ts \
  packages/ui/src/components/interactive-ui/HTMLArtifactView.test.tsx \
  packages/ui/src/lib/interactive-ui/workbench.test.ts \
  packages/ui/src/stores/useExtensionWorkbenchStore.test.ts \
  packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.test.ts \
  packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.test.ts

cd packages/web && bunx vitest run src/workbench-popout.test.tsx
cd ../..

bun run test:interactive-ui-dev-hosted-functional
bun run test:hosted-ocix-functional
bun run test:interactive-ui-security
```

CLI matrix 必须真实 spawn：TTY presenter 可组件测；non-TTY/JSON/quiet/exit/SIGINT/port reuse 用 subprocess。Functional 顶层 `try/finally` 关闭 CLI、server、temporary install/source；异常路径也要 cleanup。

### 13.3 P3.3 Shell

Focused（现有与计划新增混合）：

```bash
cd openchamber
bun test \
  packages/ui/src/lib/shell/workspaceScopeAuthority.test.ts \
  packages/ui/src/lib/shell/contextWorkspaceState.test.ts \
  packages/ui/src/components/layout/ContextWorkspace.test.tsx \
  packages/ui/src/lib/latestCompletedAssistant.test.ts \
  packages/ui/src/sync/task-output-transition.test.ts \
  packages/ui/src/sync/task-output-registry-runtime.test.ts \
  packages/ui/src/sync/__tests__/event-reducer.test.ts \
  packages/ui/src/sync/__tests__/sync-context-session-events.test.ts \
  packages/ui/src/hooks/useTaskOutputRegistry.test.tsx \
  packages/ui/src/components/layout/TaskHeaderActions.test.tsx \
  packages/ui/src/components/layout/TaskOutputsPopover.test.tsx \
  packages/ui/src/components/layout/Header.test.tsx \
  packages/ui/src/components/session/ForkSessionDialog.test.tsx \
  packages/ui/src/lib/taskOutputRegistry.test.ts \
  packages/ui/src/components/chat/changedFiles.test.ts \
  packages/ui/src/stores/useUIStore.contextPanel.test.ts \
  packages/ui/src/components/layout/shellWidths.test.ts \
  packages/ui/src/components/session/sidebar/sidebarNavigationConfig.test.ts \
  packages/ui/src/components/session/sidebar/sessionOwnership.test.ts \
  packages/ui/src/sync/session-ui-store.test.js \
  packages/ui/src/components/ui/CommandPalette.test.tsx \
  packages/ui/src/components/ui/sortable-tabs-strip.test.tsx \
  packages/ui/src/components/views/TerminalView.test.tsx \
  packages/ui/src/components/terminal/TerminalViewport.test.tsx \
  packages/ui/src/lib/terminalApi.test.ts \
  packages/ui/src/stores/useTerminalStore.test.ts \
  packages/ui/src/components/interactive-ui/connections/ConnectionConfigurationDialog.test.tsx

node --test packages/electron/session-window-runtime.test.mjs

# 仅当P3.3是shared authority首个consumer，或本项修改了projection/composition时
node --test \
  packages/web/server/lib/interactive-ui/project-inventory.test.js \
  packages/web/server/lib/interactive-ui/project-incarnations.test.js \
  packages/web/server/lib/interactive-ui/project-authority.test.js \
  packages/web/server/lib/interactive-ui/host-runtime.test.js \
  packages/web/server/lib/interactive-ui/routes.project-authority.test.js \
  packages/web/server/lib/opencode/feature-routes-runtime.test.js
```

Terminal/auth/relay immutable regressions：

```bash
node --test \
  packages/web/server/lib/terminal/runtime.test.js \
  packages/web/server/lib/terminal/terminal-ws-protocol.test.js \
  packages/web/server/lib/terminal/shells.test.js \
  packages/web/server/lib/terminal/history.test.js \
  packages/web/server/lib/terminal/theme-response.test.js \
  packages/web/server/lib/ui-auth/ui-auth.test.js \
  packages/web/server/lib/relay/cross-compat.test.js \
  packages/web/server/lib/realtime-proxy.test.js
```

Build/真实验收：

```bash
bun run type-check:ui
bun run lint:ui
bun run build:web
bun run type-check:electron
bun run lint:electron
bun run electron:dev:bundled
bun run electron:build
bun run test:interactive-ui-visual
bun run test:interactive-ui-unified
```

真实 Shell 验收至少覆盖 packaged Electron、ordinary Web、Relay Terminal、远端 Files path、Applications real connection、Mobile old shell、VS Code unsupported。截图要人工检查内容敏感性后才进入 evidence。

### 13.4 P3.4 Routing

Gate 0/P2 后基线：

```bash
cd openchamber
bun run test:interactive-ui-model-routing:baseline
```

该命令必须 self-contained：先启动依赖 `127.0.0.1:47832` 的 demo，再顺序完成三次独立冷会话，最后在顶层 `finally` stop；输出三份 immutable report 与一份 aggregate。不得把底层单次 runner 直接连跑三次后覆盖同一个文件。

若 Phase 4 触发：

```bash
node --test \
  packages/web/server/lib/interactive-ui/routing-decision-contract.test.js \
  packages/web/server/lib/interactive-ui/routing-quality.test.js \
  packages/web/server/lib/interactive-ui/routing.test.js \
  packages/web/server/lib/interactive-ui/runtime.test.js \
  packages/web/server/lib/interactive-ui/routes.routing-decision.test.js
bun test \
  packages/ui/src/lib/interactive-ui/routingDecisionText.contract.test.ts \
  packages/ui/src/lib/interactive-ui/routing.test.ts \
  packages/ui/src/lib/interactive-ui/routingInspector.test.ts \
  packages/ui/src/components/chat/message/routingObservationContext.test.tsx \
  packages/ui/src/components/chat/message/parts/ToolPart.test.ts \
  packages/ui/src/lib/opencode/client.test.ts
bun run test:interactive-ui-routing-quality
bun run test:interactive-ui-model-routing
```

报告必须 paired 列出 Phase 3/scorer；语义错误不重试；三次 cold run 不共享 session/cache。

### 13.5 P3.5 Native Chart

Gate A PoC：

```bash
cd openchamber
bun test \
  packages/ui/src/lib/interactive-ui/nativeChart.test.ts \
  packages/ui/src/components/interactive-ui/NativeChart.test.tsx
node scripts/verify-interactive-ui-native-chart-poc.mjs
```

Gate B 产品 tests：

```bash
bun test \
  packages/ui/src/lib/interactive-ui/nativeChart.test.ts \
  packages/ui/src/components/interactive-ui/NativeChart.test.tsx \
  packages/ui/src/components/interactive-ui/nativeUIKitRegistry.test.ts \
  packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx \
  packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx \
  packages/ui/src/lib/interactive-ui/generatedLayout.test.ts

bun run type-check:ui
bun run lint:ui
bun run build:web
bun run electron:build
bun run build:mobile
bun run vscode:build
bun run test:interactive-ui-extension
bun run test:interactive-ui-functional
bun run test:interactive-ui-security
bun run test:interactive-ui-visual
bun run test:interactive-ui-runtime-performance
bun run test:interactive-ui-unified
bun run test:interactive-ui-desktop-packaged
```

根 `build:electron` 只是 Electron package 的 no-op 占位，禁止把它列作 S6 证据；必须使用真实 `electron:build`，并由 desktop-packaged gate 证明 chart lazy chunk、asset graph 和 managed protocol 均进入最终包。VS Code build只证明不误编译，不得写成 Trusted Native 支持。Golden 只有人工审图批准后才运行 `test:interactive-ui-visual:update`，随后必须再跑非 update gate。

### 13.6 P3.6 OpenCode

```bash
cd opencode/packages/opencode
bun test \
  test/session/tool-progress.test.ts \
  test/session/processor-effect.test.ts \
  test/session/prompt.test.ts \
  test/tool/tool-progress-context.test.ts \
  test/cli/debug-agent-progress.test.ts \
  test/tool/registry-progress.test.ts \
  test/server/httpapi-global.test.ts

cd ../../packages/core
bun test test/session-tool-progress.test.ts

cd ../..
bun run typecheck
bun run lint
bun run --cwd packages/plugin typecheck
bun run --cwd packages/plugin build
bun run script/generate.ts
bun run script/openchamber-compat.ts
bun run --cwd packages/sdk/js build
bun run --cwd packages/sdk/js typecheck
```

`script/generate.ts`必须从最终schema生成并落盘`packages/sdk/openapi.json`与JS generated tree；随后再次运行应产生零diff，compat/provenance检查确认repo-level OpenAPI、generated client和CLI来自同一revision。不得只跑`packages/sdk/js build`的临时OpenAPI路径后留下stale `packages/sdk/openapi.json`。

生产-path test 必须从Gate O0批准的built-in internal Tool，经normal SessionTools注入的typed internal publisher调用`yield* ToolProgress.publish(context,{structured})`，证明当前`Tool.Def.execute: Effect.Effect<ExecuteResult>`仍可编译，并贯通SessionProcessor、PartUpdated/SSE/history。测试还要覆盖：连续`yield*`顺序；metadata/progress/complete/fail共享per-call Effect队列；typed rejection由canonical helper转defect后进入既有Tool error state且不泄漏payload；invalid/terminal/persist failure；`session/prompt.ts`/debug的`ToolProgress.unavailable`零PartUpdated；registry剥离internal field后public plugin仍final-only。只过core projector test或fork plugin本地typecheck不足以把capability设true。若§11.6的producer占位仍未替换为精确文件/Tool ID，本节不得执行；P3.6状态保持`later`，备注`result=blocked-by-authority`且零产品代码。

### 13.7 P3.6 OpenChamber

```bash
cd openchamber
bun test \
  packages/ui/src/lib/opencode/distributionCapabilities.test.ts \
  packages/ui/src/lib/interactive-ui/partialResult.test.ts \
  packages/ui/src/components/interactive-ui/InteractiveUIToolSurface.test.tsx \
  packages/ui/src/sync/__tests__/event-reducer.test.ts \
  packages/ui/src/sync/event-pipeline.test.ts \
  packages/ui/src/components/chat/message/renderCompare.test.ts

node --test packages/web/server/lib/opencode/routes.capabilities.test.js
bun run test:interactive-ui-partial-streaming
bun run test:interactive-ui-security
bun run test:interactive-ui-runtime-performance
bun run test:interactive-ui-functional
bun run test:interactive-ui-conversation-browser
bun run test:interactive-ui-visual
bun run type-check
bun run lint
bun run build:web
bun run test:interactive-ui-unified
```

`test:interactive-ui-unified` 的 collector 必须把本次 fresh partial-streaming report 作为 required input，校验 schema/provenance/timestamp/`complete=true`，不能只读取旧 `.tmp` 报告。

只有 OpenCode CLI/SDK 已发布且用户授权 OpenChamber pin 后，再追加 managed Desktop 闭环：

```bash
cd openchamber/packages/electron
bun run prepare:opencode-cli
bun run verify:opencode-cli
bun run verify:opencode-cli:runtime

cd ../..
bun run electron:build
bun run test:interactive-ui-desktop-packaged
```

packaged verifier 必须启动包内 CLI，确认 lock/provenance revision、`toolProgressSnapshotsV1=true`、真实 producer 的 partial→final case和 final authority；仅检查 staged binary/version字符串不算通过。未获 release/pin 权限时报告明确停在 local code-ready，managed Desktop 不得声称支持。

### 13.8 全项共用回归

在相应 P3 ID 的 focused gates 通过后，至少运行：

```bash
cd openchamber
bun run type-check
bun run lint
bun run docs:validate
bun run build:web
bun run test:extension-workbench-unit
bun run test:interactive-ui-security
bun run test:interactive-ui-runtime-performance
bun run test:interactive-ui-functional
bun run test:interactive-ui-conversation-browser
bun run test:interactive-ui-visual
bun run test:interactive-ui-unified
bun run dead-code
```

`dead-code` 仍按仓库政策人工审查；不要机械删除 dynamic registry/extension entry。

### 13.9 报告最小 envelope

所有新 verifier 使用 versioned、privacy-safe envelope：

```json
{
  "$schema": "openchamber://p3-acceptance-report/v1",
  "workItem": "P3.x",
  "complete": true,
  "generatedAt": "ISO-8601",
  "provenance": {
    "openchamberRevision": "...",
    "opencodeRevision": "... or null",
    "sdkVersion": "... or null",
    "corpusDigests": {},
    "runtime": {},
    "os": "...",
    "arch": "..."
  },
  "gates": [],
  "metrics": {},
  "cleanup": {
    "complete": true,
    "residue": []
  },
  "privacy": {
    "containsSecrets": false,
    "containsUserContent": false,
    "containsBusinessRows": false
  }
}
```

本地 `.tmp/` report 不是发布证据。只有用户授权、人工检查 JSON 与截图无敏感内容后，才复制必要摘要到 `docs/release-evidence/`。

---

## 14. 依赖、双仓、SDK 与发布门

### 14.1 依赖决策表

| 依赖 | 当前 | 推荐 | 修改文件 | 授权 |
|------|------|------|----------|------|
| `better-sqlite3` | Web/Electron direct | 复用并验证 ABI/lifecycle | 正常不改版本；packaged scripts/docs | P3.1 产品授权 |
| Hono | lockfile transitive only | P3.1 不采用；真实第二 consumer 后另立 transport slice | 未来 slice 若批准：`packages/web/package.json` + `bun.lock`，不偷用传递依赖 | 独立 ADR/roadmap/依赖授权 |
| Recharts | 不存在 | Gate A 临时 exact pin；Gate B 批准后 UI direct exact pin | `packages/ui/package.json` + `bun.lock` | PoC 与产品依赖两次授权 |
| Routing | 无新依赖 | 纯 JS lexical scorer | 无 | P3.4 触发授权 |
| Streaming | 既有 schema/SDK | 扩正式 schema/SDK | OpenCode生成/发布文件；OpenChamber managed pin文件 | Gate O0已覆盖OpenCode本地实现；C1后依次另需release、Managed pin、consumer范围三道授权 |

不得从 `bun.lock` 的传递条目推导可 import；不得为了 PoC 修改 root-wide resolution 后把变化留在产品。

### 14.2 P3.6 双仓顺序

```text
Gate O0
  → Wave O1: opencode schema + processor +真实producer；handler capability=false
  → Wave O2: local SDK generation + history/terminal/compat/typecheck/lint/build
  → high-level OpenCode contract review
  → Gate C1: 真实producer≥2、replay/final/SDK evidence全部签字？
      ├─ 否：保持 capability=false；停在 local code-ready/blocked handoff
      └─ 是：同一schema owner把 handlers/global.ts false→true
              → production capability tests
              → 从同一最终revision重新生成/验证 CLI + SDK
              → high-level final contract/provenance review
              → Release Authority Gate: 用户是否授权 commit/push/package release？
                  ├─ 否：停在 local code-ready + release handoff
                  └─ 是：按明确版本发布同revision fork CLI/SDK
                         → Pin Authority Gate: 是否授权OpenChamber managed CLI/SDK pin文件？
                             ├─ 否：停在已发布artifact handoff；OpenChamber零改动
                             └─ 是：更新pins并验证CLI/SDK/provenance同revision
                                    → Consumer Authority Gate: 是否授权C1A/B/C2文件范围？
                                        ├─ 否：停在released+pinned handoff；不实现consumer
                                        └─ 是：capability adapter/reducer/UI
                                               → streaming acceptance + legacy corpora
                                               → packaged/runtime parity
```

OpenChamber pin/alias 至少复核并按实际 workspace 修改：

- 根 `package.json`；
- `packages/ui/package.json`；
- `packages/web/package.json`；
- `packages/vscode/package.json`；
- `bun.lock`；
- `packages/electron/opencode-cli.lock.json`；
- Electron packaged managed distribution verifier/provenance scripts。

不要手改 SDK `gen/**`；必须运行 generator。OpenCode fork CLI 和 SDK 必须来自同一已验证 revision，capability/version provenance 可追溯。

### 14.3 Git/GitHub authority gate

本文不授权：

- `git commit`、push、merge、tag；
- GitHub PR/release/package publish；
- 修改 release workflow；
- 更新 OpenChamber managed CLI/SDK pin、alias或lock；
- 合入任何 upstream branch。

Agent 可以本地改代码、生成 SDK/build artifact、跑测试并制作 release handoff。执行上述外部动作前必须得到用户明确授权。

### 14.4 上游与 release workflow 风险

两个 fork 的政策是只合入不可变稳定 Release tag，不跟踪 moving `main/dev/beta`。OpenCode 的 `openchamber-release.yml` 若仍要求 `upstream/dev` 是 HEAD ancestor，这是外部发布阻塞/独立修复项；不得为过 workflow 擅自 merge moving `upstream/dev`。P3.6 开工时重新审计，不把旧状态当现状。

### 14.5 Electron/native/asset 发布

- P3.1：better-sqlite3 必须在目标平台 native rebuild/asar unpack，且真实 load；graceful server stop 要 await。
- P3.5：Recharts lazy chunk 必须进入 Web dist、Electron `resources/web-dist` 和 Mobile prepared assets；无 Chart 初始 graph 不含 closure。
- P3.6：managed Desktop 必须实际分发支持 capability 的 fork CLI；仅 UI 使用新 SDK 类型、CLI 仍旧版本时 feature 必须 false。

---

## 15. 多 Agent 工作包、文件所有权与波次

### 15.1 通用派发规则

每个 worker prompt 必须写明：

- 你不是代码库中唯一 Agent；不要回退或重写他人改动；遇到重叠先通知 owner。
- 只拥有列出的文件；共享文件由唯一 final integrator 修改，其他 worker 只交 patch/text建议。
- 先读 `roadmap.md`、`AGENTS.md`、指定 skill/Documentation、本节 contract；不自行扩大 P3 ID。
- 测试先写失败 case，再实现；不得放宽 security/corpus/golden/budget。
- 不执行 git/GitHub/release；不装依赖，除非 prompt 引用用户的明确授权。
- handoff 列出改动、命令/结果、未验证平台、风险、共享文件建议。

不同 P3 ID 默认串行。P3.1/P3.2/P3.3 都会触碰 Extension Manager/Workbench/client，P3.1/P3.2 又共享 server `runtime.js/routes.js/manager.js`；除非 final integrator 把宿主文件拆成已冻结、互不重叠的 adapter，否则不得跨 ID 并行派发这些 wave。

### 15.2 P3.1 推荐波次

| 波次 | Owner | 独占文件/责任 | 依赖 |
|------|-------|---------------|------|
| 0 | `ldr_contract_owner`（高级） | 冻结 manifest、Trusted Host Code、project authority、errors、Hono no-use decision | 用户 P3.1 授权 |
| 1A | `ldr_storage_worker` | database/migrations + tests | frozen contract |
| 1B | `ldr_package_worker` | contract、package-format、template + tests | frozen manifest |
| 1C | `project_authority_owner` | 若P3.1先获批：shared `project-authority`/`project-inventory`/`project-incarnations`、strict Git adapter、project-directory runtime + tests；若模块已存在则只回归 | frozen authority |
| 2A | `ldr_runtime_worker` | module-loader/runtime/Gateway branch + tests | 1A–1C |
| 2B | `ldr_lifecycle_worker` | host-runtime/feature-routes/shutdown/server index/Electron graceful stop | 1A–1C |
| 2C | `ldr_routes_manager_worker` | routes/manager/impact/purge/transitions + workbench-store private project authority | runtime facade |
| 3A | `ldr_shared_ui_worker` | client/types/InteractiveUIView/Artifact/ToolPart、workbench public types/store/PinButton、web popout；不碰 ExtensionWorkbench/Manager state | route contract |
| 3B | `ldr_manager_ui_worker` | extensionManager/ExtensionManagerPage/ExtensionWorkbench/settings/search/十 locale | impact/purge与private-tile contract |
| 4 | `ldr_acceptance_worker` | fixture/functional/browser/parity/packaged scripts | all code |
| 5 | `ldr_final_integrator` | root package scripts/docs/roadmap，fresh review | gates green |

`runtime.js`、`routes.js`、`manager.js` 各只有一个 owner；不要让三个 storage/UI worker都改这些宿主文件。

### 15.3 P3.2 推荐波次

| 波次 | Owner | 独占责任 |
|------|-------|----------|
| 0 | `dev_hosted_contract_owner`（高级） | 冻结 logical/derived URL preimage、embedded publisher、shared preflight、B.3.1 source lifecycle wire/inspection caps、project binding、host-only generation marker、generation/binding/lease caps、active-only action、last-good、CLI JSON schema |
| 0A | `project_authority_owner` | 若P3.2先获批：只实现shared `project-authority`/`project-inventory`/`project-incarnations`、strict Git adapter与tests；若已由P3.1完成则V，不得实现LDR或复制resolver |
| 1A | `dev_hosted_cli_kernel` | scripts lib server/snapshot/watch + tests |
| 1B | `dev_hosted_preflight_owner` | 只新增 `hosted-preflight.js`/test，并交付 `manager.js` 删除/导入 handoff；本波不改 `manager.js`，Remote wrapper只叠 connector policy |
| 1C | `dev_hosted_product_kernel` | 独占 `dev-hosted.js`/test；B.3.1 captured-candidate verifier/source/trust/refresh kernel与30s/2s/连续2失败/concurrency-4 operational-health状态机，不碰 `manager.js/runtime.js/routes.js`；交routes/manager/dispose adapter contract |
| 2A | `dev_hosted_cli_presenter` | `interactive-ui-extension.mjs` command/TTY/non-TTY/json |
| 2B | `dev_hosted_server_authority_owner` | 独占 `host-runtime.js`、`feature-routes-runtime.js`、`shutdown-runtime.js`、server `index.js`、`manager.js`/`runtime.js`/`routes.js`/`workbench-store.js`、`ui-auth.js`及 tests（条件需要时同owner改`agent-runtime.js`）：production injection、source安装、startup reconcile、private tile authority、active/leased authority、binding+lease routes、exact asset URL-token allowlist、graceful dispose/revoke；与P3.1不并行 |
| 2C | `dev_hosted_lease_ui_owner` | 独占 `devHostedBinding.ts`、`types.ts`、`result.ts`、`installedArtifactResult.ts`、`client.ts`、`ToolPart.tsx`、Workbench public types/store/PinButton/ExtensionWorkbench、InteractiveUIView、HTMLArtifactView、`nativeRegistry.ts`、web `workbench-popout.tsx`及 tests：对话marker或private tile ref、三surface/独立popout acquire/heartbeat/resume/release、per-lease Native scope、reload mismatch fail-closed；不碰 Manager页面 |
| 3 | `dev_hosted_ui_owner` | Extension Manager page/state、settings/locale；无 key form |
| 4 | `dev_hosted_acceptance` | A/B/C/invalid fixture、functional/security/cleanup、clean delayed-fetch evidence |
| 5 | `dev_hosted_final_integrator` | root scripts、共享 docs/roadmap；只在所有 gate 真实通过后回写状态 |

### 15.4 P3.3 推荐波次

| 波次 | Owner | 独占文件 |
|------|-------|----------|
| 0 | `shell_contract_owner` | 纠正文档/mock/width/secret/uninstall/background/platform；无产品代码 |
| 0A | `project_authority_owner` | 若shared foundation尚不存在，独占project-authority/inventory/incarnations/strict Git adapter+tests；已存在则只读V。不得实现LDR/Dev Hosted |
| 0B | `shell_scope_server_owner` | 在0A handoff后独占host-runtime/feature-routes-runtime/routes的§4.4.1 read-only projection+tests；不得改LDR/Dev source/action contracts |
| 1A | `workspace_state_owner` | workspaceScopeAuthority、contextWorkspaceState、sessionOwnership/topology seam、useUIStore + tests；server opaque identity旋转和ephemeral fallback单源 |
| 1B | `output_pipeline_owner` | 独占task-output-transition、task-output-registry-runtime、event-reducer、sync-context、taskOutputRegistry/hook/changedFiles/TaskOutputsPopover及focused tests；常驻runtime consumer持久后台任务，Header只select，不扫描messages |
| 1C | `latest_answer_owner` | latestCompletedAssistant + tests |
| 2A | `header_owner` | Header/TaskHeaderActions/ForkDialog + menu/payload tests；不碰 store |
| 2B | `workspace_ui_owner` | ContextWorkspace/ContextPanel/MainLayout/rail/CommandPalette + entrypoint tests；消费 frozen reducer |
| 3A | `terminal_ui_owner` | TerminalView/Viewport/store/ProjectActions + adapter/hidden/close tests；desktop identity包含scopeInstanceId，同路径新incarnation不复用旧PTY；后端协议 V |
| 3B | `tabs_a11y_owner` | sortable tabs keyboard/focus/close-lifecycle + tests |
| 4A | `applications_dialog_owner` | shared Dialog/Manager/Workbench；server Secret Store V |
| 4B | `electron_window_owner` | main/session-window helper + secret/authority tests；Header 已由 owner 交 payload contract |
| 5 | `shell_locale_visual_owner` | 十 locale、theme/a11y/visual/perf |
| 6 | `shell_backend_verifier` | Terminal/auth/relay/connection 只读+回归，不改实现除非有独立缺陷授权 |
| 7 | `shell_final_integrator` | root scripts、Shell owning docs/roadmap、release handoff；不重写backend verifier结论 |

删除 rail、desktop Terminal second entry、nested tabs 只能由相关 owner在 replacement tests 通过后进行；不能先删再补。

### 15.5 P3.4 推荐波次

Gate 0 evaluation 获批后先执行第1项；只有第1项证明触发条件且用户再次授权 Phase 4 后，才执行第2–5项：

1. `routing_baseline_owner`：在 Gate 0 evaluation 授权后独占 baseline wrapper与现有 model runner；只向final integrator交根package script接线patch，不直接写 `package.json`。P2 冻结、三次带 provenance 基线，决定是否触发；无 scorer/route/client code。
2. `routing_contract_owner`（高级）：独占server `routing-quality.test.js`/`routing-decision-contract.test.js`与UI `routingDecisionText.contract.test.ts`，只落§8.4.4–§8.4.5/C.1 pure vectors、normalizer/reason-code/bounds/wire contract tests并找只读review；不得实现scorer/route/client，不得看结果调阈值。contract未PASS不派后续worker。
3. 并行：`routing_scorer_owner` 只负责已冻结的 pure module；`routing_report_owner` 只负责 provenance/A-B runner。
4. 并行：`routing_server_owner` 独占production `routing-decision-contract.js`、`runtime.js`/existing `runtime.test.js`、`routes.js`与新`routes.routing-decision.test.js`（server text-invariance必须在runtime test直测；不得改contract owner已冻结的pure tests/vectors）；`routing_client_owner`独占`routing.ts`、新增`routing.test.ts`、`lib/opencode/client.ts`/test，同时完成decision调用和dispatch userMessageId，不得改`routingDecisionText.contract.test.ts`。
5. `routing_inspector_owner` 独占 `routingInspector.ts`、ChatMessage/MessageBody/TurnActivity/ProgressiveGroup/ToolPart correlation链及tests，不再修改`lib/opencode/client.ts`；`routing_acceptance_owner`只跑corpora/security/perf。
6. Choice UI 不在本项目；若仍有 ambiguity 证据另立授权。
7. `routing_final_integrator`：独占root scripts、Routing owning docs/roadmap与最终evidence index；未触发时只记录no-code结论，不创建scorer文件。

### 15.6 P3.5 推荐波次

1. `s6_dependency_contract_owner`：只读核实 exact version/license/React19，冻结 props/数字门。
2. Gate A 并行：`s6_chart_module_owner` 只改 nativeChart/NativeChart files；`s6_poc_harness_owner` 只改 demo/verifier。依赖/lock 由 final integrator 单人修改。
3. 用户查看 PoC并决定 adopt/reject。Reject 时 integrator清理全部 PoC product delta。
4. Adopt 后：`s6_host_contract_owner` 只改types/nativeUIKitRegistry/NativeUIKit与对应tests，`nativeRegistry.ts`始终V；`s6_fixture_acceptance_owner`独占Sales/CRM/template tracked Native entry迁移、三个manifest、clean-copy extension test、Sales Chart adoption、visual/perf/goldens，并以browser smoke证明现有或P3.2后loader均能看到Host Chart。
5. `s6_final_integrator` 独占 `packages/ui/package.json`、`bun.lock`、docs、roadmap，并找 fresh reviewer查 raw Recharts leakage/lazy/a11y/version/cache。

### 15.7 P3.6 推荐波次

| 波次 | 仓库/Owner | 独占责任 |
|------|------------|----------|
| 0 | 高级 contract owner | wire/revision/limits/capability/real producer冻结 |
| O1A | opencode schema owner | Gate O0 后：schema + capability字段（仍返回false）+ tests |
| O1B | opencode producer owner | Gate O0 后：独占`packages/opencode/src/tool/progress.ts`的internal input/rejection union、error、publish/unavailable interface；实现processor、SessionTools real publisher、prompt/debug unavailable adapter、registry field-stripping与boundary tests，以及获批built-in internal producer和production tests。`packages/plugin/src/tool.ts`/plugin package/release集合均为V，不得新增fork-only公开plugin API；schema/SDK只拥有snapshot wire，旧typed fixtures为V |
| O2 | SDK owner | 标准`script/generate.ts`同时更新`packages/sdk/openapi.json`与JS generated tree，再做package artifact/compat/idempotent generation；不发布、不手改generated |
| Review | 高级只读 | OpenCode contract 和 history/terminal authority |
| C1 gate | 高级 contract owner | handler仍false时签署真实producer≥2 snapshot、history/terminal与pre-enable SDK证据；只允许进入enable，不直接允许consumer |
| C1 enable | O1A schema owner回场 | 仅在C1签字后独占`handlers/global.ts`与capability tests，把false改true；不改producer/SDK |
| C1 final artifact | O2 SDK owner回场 | C1 enable与production capability tests通过后，从**同一最终OpenCode revision**重新生成/构建/验证CLI+SDK与compat/provenance；不发布、不手改generated |
| C1 final review | 新鲜高级只读 reviewer | 核对producer/schema/handler=true/history/terminal/CLI/SDK/provenance全都来自同一最终revision；不改文件。未PASS不得进release或consumer |
| Release authority handoff | `streaming_dual_repo_final_integrator`（只协调、不跨仓写） | final review后核对明确的OpenCode release授权；只把同revision artifact/review交给OpenCode release owner。未授权即停在local code-ready handoff |
| OpenCode release | `streaming_opencode_release_owner` | **只在 `opencode/`** 执行获批的同revision CLI/SDK commit/push/release，输出immutable version/revision/package digest/provenance handoff；不得修改 `openchamber/` |
| Managed pin | `streaming_openchamber_package_owner`（pin phase） | release handoff核验成功且另获pin授权后，**只在 `openchamber/`** 独占更新根/UI/Web/VS Code SDK alias、`bun.lock`、`packages/electron/opencode-cli.lock.json`及对应package/runtime provenance；不得发布OpenCode、应用acceptance script patch或改consumer |
| Consumer gate | 高级contract owner | 只在released CLI/SDK、updated pins与provenance同revision后核对独立consumer文件范围授权并签字；未签字不得下发C1A/B/C2 |
| C1A | OpenChamber capability/frame owner | runtimeFetch capability adapter + partialResult |
| C1B | `streaming_reducer_owner` | OpenChamber reducer/pipeline/reconnect ledger |
| C2A | OpenChamber UI owner | surface/ToolPart/i18n |
| C2B | streaming acceptance owner | fixture/corpus/report/security/perf |
| Consumer package wiring | `streaming_openchamber_package_owner`（consumer phase回场） | 仅在Consumer Gate后接收并应用root `package.json` acceptance script patch、跑最终命令；不得借回场改变已验证pins/lock，若确需pin变更必须重新走Pin Gate/provenance |
| Final | `streaming_dual_repo_final_integrator` | 只汇总既有released/pinned provenance、全corpora、docs/roadmap与release/acceptance handoff；不写任何仓库的release/pin文件，不在此行首次发布或首次更新pins |

OpenCode 与 OpenChamber worker 不得在同一工作包跨仓写。没有自然 producer时P3.6状态保持`later`，备注`result=blocked-by-authority`且零产品代码；只有C1 enable后的final-revision CLI/SDK重生成、production tests与新鲜只读终审全部完成，且同revision CLI/SDK已获批发布、managed pins已获批更新并验证provenance，再取得OpenChamber consumer授权后，C1A/C1B/C2才开始。任一authority gate未过就停止，不留临时跨仓pin。

### 15.8 共享文件唯一 final writer

| 共享文件 | 唯一 writer |
|----------|-------------|
| `roadmap.md` | 当前已授权ID的唯一final integrator：P3.1=`ldr_final_integrator`、P3.2=`dev_hosted_final_integrator`、P3.3=`shell_final_integrator`、P3.4=`routing_final_integrator`、P3.5=`s6_final_integrator`、P3.6=`streaming_dual_repo_final_integrator`；只在真实状态变化时 |
| 根 `openchamber/package.json` | 当前ID的单一writer；P3.1–P3.5为上述final integrator，P3.6为`streaming_openchamber_package_owner`：Pin Gate后只改alias/pin，Consumer Gate后同一owner串行回场应用acceptance script patch；其他worker不直接写 |
| `packages/ui/package.json` / `packages/web/package.json` / `packages/vscode/package.json` / `bun.lock` / `packages/electron/opencode-cli.lock.json`（P3.6） | `streaming_openchamber_package_owner`的pin phase；必须在release handoff与独立pin授权后串行写，consumer回场/final integrator只读且不得改已验证pins |
| `runtime.js` / `routes.js` / `manager.js` | 当前 wave 指定的单一 server owner；P3.1/P3.2 不并行写 |
| `project-authority.js` / `project-inventory.js` / `project-incarnations.js` / strict `git/service.js` adapter | 当前获授权ID的`project_authority_owner`独占（P3.1/P3.2/P3.3均可成为首个consumer）；factory/tests完成后hand off，另一owner不得并行写 |
| `host-runtime.js` / `feature-routes-runtime.js` | authority handoff后由当前ID唯一server composition owner独占：P3.1=`ldr_lifecycle_worker`、P3.2=`dev_hosted_server_authority_owner`、P3.3=`shell_scope_server_owner`；禁止第二root |
| `sessionOwnership.ts` / `workspaceScopeAuthority.ts` | P3.3=`workspace_state_owner`；path/projectId只作hint，其他owner不得加入第二个incarnation cache |
| `Header.tsx` | shell header owner；Electron owner只交 payload contract |
| `useUIStore.ts` | workspace state owner |
| `types.ts` / `ToolPart.tsx` | 当前被授权 P3 ID 的 UI contract owner；不同 P3 ID 串行 |
| `extensionManager.ts` / `ExtensionManagerPage.tsx` | 当前被授权 ID 的唯一 Manager UI owner；P3.1/P3.2/P3.3 相关 wave 串行 |
| `ExtensionWorkbench.tsx` | 当前被授权 ID 的 project-context/surface owner；与 Manager UI owner串行，不得双写 |
| `workbench-store.js` / `workbench.ts` / `useExtensionWorkbenchStore.ts` / `WorkbenchPinButton.tsx` / `workbench-popout.tsx` | 当前被授权 project-bound ID 的server/UI owners按§15.2/§15.3串行handoff；P3.1/P3.2不得并行，private authority只由server owner写 |
| `InteractiveUIView.tsx` / `lib/interactive-ui/client.ts` | 当前被授权 ID 的 shared UI owner；其他 ID 只交 adapter contract，不并行写 |
| `nativeRegistry.ts` | 只有P3.2获授权时才由`dev_hosted_lease_ui_owner`改per-mounted-surface scope；P3.5始终V且不依赖P3.2，Chart只接`nativeUIKitRegistry`并做black-box activation/browser验证 |
| `packages/web/server/lib/ui-auth/ui-auth.js` | P3.2=`dev_hosted_server_authority_owner`独占exact asset URL-token allowlist；P3.3只跑immutable regression，不修改 |
| `sync/event-reducer.ts` / `sync/sync-context.tsx` | P3.3=`output_pipeline_owner`、P3.6=`streaming_reducer_owner`；两个ID必须串行。P3.6复用同一PartUpdated event pipeline与materialized store、不得建立第二stream store/event bus，也不得把partial progress误发布为P3.3的Task Output delta/channel |
| `lib/opencode/client.ts` | P3.4 `routing_client_owner` 独占；Inspector owner不得同时修改 |
| `ChatMessage.tsx` / `MessageBody.tsx` / `TurnActivity.tsx` / `ProgressiveGroup.tsx` / `ToolPart.tsx`（P3.4） | `routing_inspector_owner`按§8.6一次串行完成parentID correlation；其他P3 ID不得并行写ToolPart |
| locale files | locale owner在 key/API冻结后统一修改 |
| docs/release evidence | final integrator人工清洗后；未经发布授权不复制 |

---

## 16. 风险、失败模式与回退

### 16.1 风险表

| ID | 主要风险 | 早期检测 | 处理/回退 |
|----|----------|----------|-----------|
| P3.1 | 同步 handler 卡 event loop | worst-case SQL/CPU fixture、event-loop lag | v1只接受受审同步 Trusted Host Code与严格数据上限；需要恶意隔离则停止并另立进程方案 |
| P3.1 | project/confirmation replay或同路径重建串库 | A challenge→B header、delete/recreate same-path read test | confirmation绑定含filesystem identity的canonical projectKey；每次action re-stat，identity变化即fail closed且旧DB不自动接管 |
| P3.1 | migration 部分成功导致 rollback 不安全 | multi-project lazy migration/schema-ahead tests | 单库事务；不跨库宣称原子；schema-ahead阻止旧版本，数据不删 |
| P3.1 | native addon packaged 失效 | 真 load/create/read/write/restart | capability unavailable；不回退内存假 DB；修打包链后再发布 |
| P3.1 | 同进程代码被误宣称 sandbox | security review/checklist | UI/安装明确 Trusted Host Code/admin consent；不批准则不交付 arbitrary ESM |
| P3.2 | manifest/resource race或renderer reload混代 | A→B→C delayed View/Artifact fetch + A envelope/C code负例 | immutable release path + CLI全进程全部release bounded保留（64/512MiB）+ host-only可重放generation marker（256/extension、4096/global、2MiB）+ product Dev-only inactive-generation read lease（generation 16/64、lease 128）+ atomic pointer；unknown marker明确unavailable，容量/构建失败保留 last-good |
| P3.2 | dev mode降低信任 | unsigned/wrong hash/permission cases | developer switch不绕签名/fingerprint/re-consent；negative tests不可删 |
| P3.2 | 全局 Tool 与项目 Dev source冲突 | 同 extension ID 两项目 test | v1单 active source；project mismatch fail closed；per-project Tool registry另立项 |
| P3.2 | CLI残留端口/进程/私钥 | SIGINT/failure/port reuse/privacy scan | top-level finally；私钥不进snapshot/report；cleanup complete gate |
| P3.3 | 删除 rail 后隐藏功能失联 | entrypoint inventory test | 先建Command Palette/event入口，再删 rail |
| P3.3 | 双层 Terminal identity关闭错 PTY | outer/store identity、close exactly once | 单一 outer ownership；close transaction失败保留tab |
| P3.3 | silent capacity eviction泄漏 PTY/browser | create-at-limit test | create前guard + toast；禁用LRU删除 live resource |
| P3.3 | project root/worktree或同路径新旧incarnation串用 | two runtimes + root/worktreeA/worktreeB + delete/recreate same path test | key=`runtimeKey+projectId+scopeDirectory+scopeInstanceId`；server opaque id旋转，directory-fallback仅ephemeral且不持久 |
| P3.3 | new-window泄漏 bearer | IPC payload/adversarial args | renderer只传session/directory；main clone bound authority |
| P3.3 | hidden Ghostty资源回归 | listener/CPU/memory benchmark | controller/viewport分层；hidden不layout/paint；明确30m idle |
| P3.4 | 把 infra/data-load故障误判routing | 分阶段 report | Tool selected/View/data loaded独立；只有重复语义失败触发 |
| P3.4 | scorer降低召回/抢业务 | paired 17-case + safety invariants | no evidence→full catalog；任何legacy退化禁用/移除scorer |
| P3.4 | examples/user text泄漏 | report/log snapshot tests | scorer stateless/no-store；只输出reason codes |
| P3.4 | 同session并发Tool误记到最新prompt | U1/U2→A1/A2逆序完成、missing parent、`assistant.info.id != part.messageID`负例 | 只用assistant.parentID exact join dispatch user ID；expected assistant ID来自`assistant.info.id`，part.messageID仅作actual一致性校验，删除latest-session fallback |
| P3.5 | Recharts进入initial bundle | Vite asset graph/request assertion | facade lazy + private adapter；不达预算reject并移除依赖 |
| P3.5 | 第三方API变永久ABI | type/export scan | 只公开bounded optional Chart；无raw types/components |
| P3.5 | tooltip-only/a11y失败 | keyboard/sr table/reduced motion | always sr-only table；失败局部Notice+table；Gate A reject可接受 |
| P3.6 | UI猜半截JSON | raw parse counter/static scan | full snapshot only；`rawParseCount=0`硬门 |
| P3.6 | 乱序覆盖final | revision/terminal corpus | reducer terminal优先+monotonic；capability false时忽略progress |
| P3.6 | SDK与CLI半部署 | capability/distribution provenance | capability只在整链可用时true；managed pin同revision；否则final-only |
| P3.6 | partial冒充live/success | hostile envelope/final-invalid tests | 只built-in snapshot、无dataRef/action/query/pin；final authority唯一 |

### 16.2 回退语义

#### P3.1

- Disable LDR connector 要显式返回已冻结的 `local_data_runtime_unavailable`，不能把本地 action发到 HTTP或内存 DB。
- 代码回退不自动 downgrade DB。先 inspect schema-ahead；若旧版本不兼容则阻止 activate，保留 DB供恢复。
- uninstall/update失败时 Manager transaction 保持旧 installation active；普通 uninstall/project untrack 数据原位保留，只有独立 explicit clear/purge 才移 recoverable trash。
- P3.1 不新增、不拥有任何 P3.1-specific Hono import、adapter或direct dependency，且没有由P3.1产生的lockfile delta；无关传递lock条目不在本项清理范围。

#### P3.2

- rebuild/refresh失败永远保留 last-good generation；首次无成功 release则不安装空 source。
- CLI shutdown 不改变已安装扩展权限；产品显示 source offline/degraded。
- 关闭 developer switch阻止新 refresh/use，并按冻结语义处理 source；不自动信任 Local full包。

#### P3.3

- persistence parse malformed时恢复安全默认并显示/记录 recovery reason；不递归 crash。
- resource close失败，reducer不删除tab；Terminal/Browser lifecycle依旧可重试。
- 一次性v2 migration成功后只写新schema；不长期维护两套live reducer。
- 若真实验收失败，保留旧壳入口直到replacement wave通过，不能提交半删rail/Terminal路径。

#### P3.4

- decision route/client失败自动回退Phase3 full catalog；不丢消息、不重试prompt。
- scorer A/B退化则不启用或移除scorer product path，并记录真实failed-adoption handoff与证据；`result=not-triggered`只适用于Phase 4从未触发，不能用P3.5专属`not-adopted`伪装已触发后的退化。

#### P3.5

- Gate A reject：彻底移除dependency/PoC code/lock/demo delta，不留dead flag。
- Gate B运行时lazy import/render失败：只降级该Chart为Notice+sr table，Native View其他内容继续。
- 新Chart extension在旧Host以`if (!ui.Chart)`显式降级；不新增uiVersion2兼容层。

#### P3.6

- capability false/missing/error：完全final-only。
- partial invalid：保留上一safe frame或skeleton；final invalid走generic Tool fallback。
- OpenCode publisher/SDK/CLI版本不一致：capability不得true，不能由UI猜版本。

### 16.3 不得用来“修复”失败的方法

- 放宽签名、hash、path、permission、confirmation、corpus denominator、bundle budget。
- 把失败测试删掉、改成 snapshot update、将 unsupported 标 passed。
- 增加 generic feature flag/compat wrapper长期并存两套实现。
- 把真实 business/用户数据写入 fixture、report、截图。
- 自动 retry write/Tool prompt或重复执行外部副作用。
- 合并 moving upstream、发布未授权包或用旧 `.tmp` report代替fresh evidence。

---

## 17. Definition of Done

### 17.1 每个 P3 ID 的共用 DoD

- [ ] 用户明确授权该 ID；roadmap 状态与范围同步，其他 P3 未被顺带启动。
- [ ] 当前代码/依赖/报告 fresh audit 记录完成，旧专题冲突已修正。
- [ ] 对外 contract、错误码、limits、platform matrix 在实现前冻结。
- [ ] 逐文件 ownership 无冲突，共享文件由唯一 integrator 修改。
- [ ] focused unit/contract/security tests 先红后绿；现有高风险回归通过。
- [ ] Web/Electron/remote/relay/VS Code/mobile 按支持矩阵分别验证或明确 unverified/unsupported。
- [ ] i18n、theme、a11y、performance、privacy 不以“后续再补”跳过。
- [ ] functional/browser/packaged/模型（若适用）report 有 provenance、cleanup、privacy字段。
- [ ] 无 secret、用户内容、业务行、raw payload、path/SQL进入提交证据。
- [ ] docs、skills/templates/examples/Documentation 与产品事实一致。
- [ ] dead-code/report/golden人工审查完成；无临时server/process/install/source/worktree residue。
- [ ] 未经授权没有 commit/push/release/workflow mutation；需要发布的工作只交release handoff。

### 17.2 P3.1 附加 DoD

- [ ] direct Gateway adapter 是唯一实现；Hono文件/dependency/lock delta为零。
- [ ] Local full signed package + `hostCode` review 是server code唯一来源；Remote/Hosted负例全通过。
- [ ] canonical project authority、confirmation绑定、project×extension隔离和owner mismatch通过；projectKey包含稳定filesystem/worktree instance identity而非只含路径。
- [ ] strict inventory明确区分Git success/plain success/failure；既有`getWorktrees`不作authority。Git transient failure不改ledger，只有成功missing/owner change才tombstone；plain configured root/child与identity-unsupported语义通过。
- [ ] configured root/worktree/session containment 与 stale/symlink/runtime/relay 负例通过；每次read捕获token并在返回前fresh post-check，执行中同路径重建时丢弃旧结果；ledger重启稳定/原子/0600、4096/4MiB与90天安全清理、损坏/容量fail-closed；普通 remove/untrack 不删除数据。
- [ ] ToolPart、InteractiveUIView、HTMLArtifactView传server directory context；Workbench/Popout使用server-private project-incarnation ref且public patch不能覆盖。Artifact/View/Workbench跨project/header spoof与hint mismatch在执行前拒绝。
- [ ] migration digest/事务/schema-ahead/lazy multi-project/rollback语义通过。
- [ ] DB pool/queue的64 global、16/project、16/extension、64/context queue、512 global queue、10m idle/60s sweep/2s busy单源常量和边界通过；全active时503且不silent close。
- [ ] write result在commit前完成serializable/size验证；失败回滚。
- [ ] disable/update/rollback/uninstall-retain/project-untrack-retain/explicit-clear-to-trash/purge/shutdown drain/close/recovery通过。
- [ ] packaged native addon真实load/restart持久；不支持平台明确。

### 17.3 P3.2 附加 DoD

- [ ] source server只loopback、只signed allowlisted immutable资源；无source-dir fallback。
- [ ] shared server project-authority与host-runtime composition已进入`feature-routes-runtime`生产链并由当前获授权P3.1/P3.2/P3.3的唯一shared owner完成handoff；configured primary/linked-only/primary+linked、root↔worktree/cross-project/stale-incarnation负例在任何source/trust/lease写之前通过，dispose清理完成。
- [ ] project developer switch/source binding/single active ID/last-good通过；ToolPart传exact directory，Workbench/Popout由server-private tile authority解析exact incarnation；不用client projectId或全局current directory作authority。
- [ ] embedded publisher signature后，signed Dev locator/preimage可重算；semantic URL、resources、permission origins与immutable URL release ID逐项一致，CLI stdout不是authority。
- [ ] shared shell-metadata preflight覆盖完整extension/resource/surface contract并在所有写之前；任意失败trust/source/generation/cache零写；Remote exact-one-api-key不变且无access-key表单。
- [ ] B.3.1 source lifecycle exact wire通过：connect inspect零写；refresh inspect只允许operationalHealth小事务、authority零写；captured candidate single-use/caps/expiry、connect/refresh/disable project-bound且原子、re-consent/last-good/error flat body一致。30s/2s/连续2失败/concurrency-4 probe与fake-clock/dispose通过，CLI stop进入degraded但current generation不变；server/UI owners没有自造第二套route或private projection。
- [ ] CLI 全进程 retention 64 releases/512 MiB且容量失败保留current；product generation 16/64、lease 128、binding 256/4096/2MiB caps逐边界与marker-only generation原子GC通过；active-only action/tool authority通过。
- [ ] Declarative/Native/Artifact A→B→C delayed fetch通过；host-only marker严格解析且不能由扩展/public tile覆盖；board v1→v2迁移、bindingHint+private authority原子pin与显式rebind通过；renderer reload/独立popout的A tile只取A或明确unavailable、绝不加载catalog C；每window独立lease与pagehide cleanup通过。Native registry按mounted lease scope隔离，同viewId A+C可并存且dispose互不影响。dynamic import/iframe经exact URL-token allowlist+asset key成功，无token/wrong/expired/revoked均拒绝且token/key不入日志。C active时A read仍可达但business action exact authority union在confirmation前拒绝inactive/mixed branch且token不跨代；server restart current Tool reconcile、hidden heartbeat、sleep resume/window expiry、disable/uninstall/trust revoke通过。
- [ ] TTY/non-TTY/json/quiet/exit/signal一致且无secret/source path泄漏。
- [ ] A→B concurrent、invalid refresh、permission expansion/re-consent、cleanup通过。

### 17.4 P3.3 附加 DoD

- [ ] 单一workspace reducer/outer tab strip；runtime+project+scope+server incarnation identity；root/worktree及same-path删除重建互不串资源；旧Terminal/Browser/Files不恢复。503/network revalidation进入suspended且零attach/create，same-ID才resume、different-ID discard；只有明确422进入ephemeral，同activation重复focus不旋转且不持久；no silent eviction。
- [ ] rail所有surface先有replacement entry；desktop second Terminal/nested tab完成替代后删除。
- [ ] Terminal v3/backend/relay/auth未改且全回归；Mobile tabs/VS Code unsupported不变。
- [ ] Header completion/archive/fork/new-window authority和secret边界通过。
- [ ] Output v2由`event-reducer Tool completion（含state.attachments）→ sync-context store publication → runtime-scoped typed channel → 常驻registry consumer`单向驱动；只有source.file+matching file URL的canonical local attachment进入path registry，data/http/resource/filename-only及顶层user/assistant FilePart均不登记。producer-captured runtimeKey隔离、后台任务不丢、无Header/message扫描或snapshot backfill，call内多文件原子幂等与200/2000/2MiB deterministic eviction通过；淘汰seen后history/reconnect snapshot replay不重复。
- [ ] shared connection Dialog不回填secret，uninstall transaction不倒退。
- [ ] packaged Electron/Web/Relay和视觉/键盘/hidden performance通过。

### 17.5 P3.4 附加 DoD

- [ ] 首先交三次P2后带provenance基线。
- [ ] 若指标通过，按§1.5处理状态，并以备注`result=not-triggered`、零产品代码结束。
- [ ] 若触发，用户批准；scorer无新依赖/无Tool执行/有Phase3 fallback。
- [ ] 高级contract wave已先冻结NFKC/zh-CN词元/stop+operation cues/evidence tuple/reason-code union/caps、focused/ambiguous/no-match向量与C.1 exact wire；实现未自行改权重或分词。
- [ ] `buildRoutingDecisionTextV1`只产user-authored non-synthetic text，decision与Inspector字节相同；synthetic preface/additional、file/agent/filename不入scorer。contract-owner UI vectors与client integration tests均实际执行。
- [ ] GET仍只用`revision`、POST仍只用`catalogRevision`；两者来自与query无关的private catalog+normalized examples canonical digest。example-only change必须revision change，只改user text必须不变，response/system/log无example原文。§13.4显式运行`runtime.test.js`与`routes.routing-decision.test.js`，不依赖未定义的aggregate间接覆盖。
- [ ] Inspector以assistant `parentID`关联dispatch user ID；expected assistant ID独立来自`assistant.info.id`并贯穿direct/aggregated路径，`part.messageID`只作actual一致性校验；同session U1/U2逆序完成不串trace，wrong part ID或missing parent绝不fallback latest。
- [ ] paired 17条无退化，目标failure category改善，安全不变量零违反。

### 17.6 P3.5 附加 DoD

- [ ] Gate A report在改产品dependency前完成；数字门未看结果后修改。
- [ ] Reject时零产品delta；Adopt有用户明确依赖/API批准。
- [ ] `Chart?` bounded/optional，raw Recharts API/type/export为零。
- [ ] `nativeRegistry.ts`零P3.5 delta；P3.5可在未实施P3.2时独立通过，也能对P3.2 scoped loader只跑回归而不改loader。
- [ ] lazy closure/initial graph、30×5 bounds、sr table、theme/a11y/error fallback通过。
- [ ] Sales/CRM/template Native entry迁到tracked `ui/native/*.mjs`；clean-copy validate/pack不依赖ignored `dist`，CRM/template行为无变化。
- [ ] Declarative/Tool/routing/OpenCode不改；default template不触发Chart。

### 17.7 P3.6 附加 DoD

- [ ] Gate O0记录获批的自然多阶段OpenCode built-in internal production Tool精确路径/Tool ID；第三方/plugin Tool不计。若没有，result=blocked-by-authority且零产品delta。
- [ ] OpenCode production publisher→PartUpdated→history完整，capability语义真实。
- [ ] revision/size/rate/count/terminal rules和SDK generator通过。
- [ ] internal ToolContext的progress field可省略；`SessionProcessor.Handle.publishToolProgress(toolCallID,input)`保留typed rejection，normal SessionTools走real Effect publisher，canonical `ToolProgress.publish`在helper内`Effect.orDie`以匹配当前`Def.execute` error=never；metadata/progress/complete/fail共享per-call队列。prompt/debug共用`ToolProgress.unavailable`，旧fixture不造fake publisher；registry在public `PluginToolContext` seam剥离field，plugin保持final-only，缺失publisher稳定`tool_progress_unavailable`且零revision/PartUpdated。
- [ ] OpenChamber raw/delta parse为零，frame/reducer/history/final authority通过。
- [ ] 首版scope只built-in snapshot Declarative，无query/action/pin/dataRef。
- [ ] 17 legacy、I1–I5、streaming corpus独立且全通过。
- [ ] fork CLI/SDK同最终revision并已通过独立Release Gate实际发布；OpenChamber managed pins通过独立Pin Gate实际更新且runtime/package provenance同revision；独立Consumer Gate授权后才有consumer delta。任一gate缺失、发布失败、pin未更新或provenance失败都停在对应handoff、保持真实roadmap状态且不得下发后续wave，不能造`blocked`状态枚举。

---

## 18. 文档与 roadmap 回写

### 18.1 本蓝图建立时应回写

- 根 `roadmap.md` P3 区新增本文入口，P3.1–P3.4状态仍 `planned`，P3.5–P3.6仍 `later`。
- `OPENCHAMBER_CODEX_SHELL_DESIGN.md` 状态头改为 roadmap-authoritative planned/not authorized，并链接本文。
- 各专题文档头增加“详细实施蓝图”入口；不能把链接写成实现完成。
- P3.1 旧“固定Hono”口径已被本蓝图与roadmap的 direct in-process Gateway adapter、零新增dependency合同替代；实现开始仍需用户授权P3.1。
- P3.2 旧内容中已完成的Remote R1–R3/R4自动化事实与真正未完成的Dev Hosted/LDR分开。

### 18.2 实施期间回写

| 事件 | 文档动作 |
|------|----------|
| 用户启动一个 P3 ID | roadmap 只把该ID更新为`in-progress`；记录范围/依赖/跨仓授权 |
| contract冻结 | 对应专题plan + nearest `DOCUMENTATION.md` + Developer Guide |
| 新schema/API | skill/template/example/contract docs同步 |
| Gate未触发/不采用 | 获批评估期间为`in-progress`；用户确认no-code结案后可写`done`，备注记录`result=not-triggered`/`result=not-adopted`及证据 |
| 平台未验证 | unified report保持unverified，不用macOS结果代替其他平台 |
| 发布前 | release handoff列revision/version/pins/gates/blocker/authority |
| 真完成 | 专题状态、roadmap状态、统一报告、证据索引同一变更回写 |

### 18.3 各项 owning docs

| ID | 必须同步的文档 |
|----|----------------|
| P3.1 | `OCIX_LOCAL_DATA_RUNTIME_PLAN.md`、Dual Path、Developer Guide、server/UI Interactive UI Documentation、Electron README、extension skill/template |
| P3.2 | Dual Path、Remote detailed（只纠事实）、Developer Guide、server/UI Documentation、CLI help/README |
| P3.3 | Shell Design/Test、layout/terminal邻近Documentation、Electron README、视觉/验收报告 |
| P3.4 | Agent Routing Plan、Autonomous Testing、Unified Acceptance Report、corpus README |
| P3.5 | Style Plan/Contract/Agent Brief/Dev Report、Developer Guide、UI Documentation、visual manifest |
| P3.6 | AI SDK roadmap、Extension Architecture、P2 interleaving design（仅交叉边界）、OpenCode schema/API docs、Unified Acceptance |

---

## 附录 A：P3.1 合同草案

### A.1 Manifest（供 contract owner 冻结，不代表已支持）

```json
{
  "$schema": "openchamber://extension/v1",
  "id": "com.acme.orders",
  "version": "1.0.0",
  "localData": {
    "apiVersion": 1,
    "entry": "server/dist/index.mjs",
    "migrations": [
      { "id": "001_init", "path": "server/migrations/001_init.sql" },
      { "id": "002_status_index", "path": "server/migrations/002_status_index.sql" }
    ]
  },
  "connectors": [
    { "id": "local-data", "type": "local-data", "scope": "project" }
  ],
  "actions": [
    {
      "id": "com.acme.orders.orders.list",
      "connector": "local-data",
      "risk": "read",
      "permission": "allow",
      "localData": { "handler": "orders.list" }
    },
    {
      "id": "com.acme.orders.orders.create",
      "connector": "local-data",
      "risk": "write",
      "permission": "ask",
      "localData": { "handler": "orders.create" }
    }
  ]
}
```

Package verifier 以 package index 中 entry/migration bytes 的digest为authority；manifest不重复存一个可被改写的自报hash字段，除非现有package contract要求且由同一normalizer单源验证。

### A.2 Handler

```js
export default {
  apiVersion: 1,
  actions: {
    "orders.list": ({ input, db }) => ({
      items: db.all(
        "SELECT id, title, status FROM orders WHERE status = ? ORDER BY id LIMIT ?",
        [input.status, Math.min(input.limit, 100)],
      ),
    }),
    "orders.create": ({ input, db, now }) => {
      const row = { id: crypto.randomUUID(), title: input.title, status: "open", createdAt: now }
      db.run(
        "INSERT INTO orders (id, title, status, created_at) VALUES (?, ?, ?, ?)",
        [row.id, row.title, row.status, row.createdAt],
      )
      return row
    },
  },
}
```

示例中的 input validation 必须由manifest/action schema或handler显式完成；不要直接复制到产品而省略schema。

### A.3 Stable error body（沿用现有 flat wire）

```json
{
  "error": "Local data is not ready for this extension.",
  "code": "local_data_migration_failed",
  "requestId": "req_...",
  "retryable": false
}
```

P3.1/P3.2 不迁移全局错误envelope：继续复用当前`routes.js::sendError`和UI `InteractiveUIRequestError`/Manager/Workbench parser理解的顶层`error`字符串+`code`，允许既有route-specific顶层details。禁止在新route单独返回`{error:{...}}`或让client只解析nested shape；若未来要全局迁移，必须另立版本化contract并回归所有Remote/Artifact/Manager route。shared project-authority quartet以§5.11为单源：`project_authority_inventory_unavailable`、`project_authority_identity_unsupported`、`project_authority_capacity`、`project_authority_store_unavailable`；P3.1其余完整稳定code单源是§4.5、§5.11与§5.9.1，包括Workbench private-authority、全部`local_data_management_*`/`local_data_purge_*`以及runtime/migration/owner/result codes；P3.2 Dev Hosted source code以§B.3.1为单源、surface/binding/lease/action code以§B.4为单源，两处都必须透传可达的shared quartet，内部preflight错误则按B.3.1统一折叠且不得新增route-visible“shared metadata code”。新增code必须先改对应单源表、server tests、UI mapping，再更新示例；本附录不得维护第二份可能漂移的缩减union。

### A.4 Impact / purge wire examples

```http
POST /api/interactive-ui/manager/local-data/impact
Content-Type: application/json
X-OpenCode-Directory: <runtime adapter supplied>

{"apiVersion":1,"selector":{"scope":"extension","extensionId":"com.acme.orders"}}
```

```json
{
  "apiVersion": 1,
  "operationId": "op_opaque",
  "selector": { "scope": "extension", "extensionId": "com.acme.orders" },
  "authorityRevision": "opaque-revision",
  "databases": [
    { "extensionId": "com.acme.orders", "ownerDisplayId": "com.acme", "bytes": 16384, "schemaVersion": 2, "state": "closed" }
  ],
  "totals": { "databases": 1, "bytes": 16384 },
  "confirmation": { "token": "opaque-single-use", "phrase": "DELETE 1 LOCAL DATABASE", "expiresAt": "ISO-8601" }
}
```

```http
POST /api/interactive-ui/manager/local-data/purge
Content-Type: application/json
X-OpenCode-Directory: <same exact scope>

{"apiVersion":1,"operationId":"op_opaque","confirmationToken":"opaque-single-use","confirmationPhrase":"DELETE 1 LOCAL DATABASE"}
```

Unknown keys、raw path/projectKey/owner override、selector on purge均400。extension-clear与project-purge只由impact selector区分，不新增`DELETE /**`或client-computedtarget。confirmation token绑定字段、响应与错误映射以§5.9.1为唯一合同。

---

## 附录 B：P3.2 CLI 与 HTTP 合同草案

### B.1 CLI

```text
interactive-ui-extension dev-hosted <source>
  --private-key <path>
  --publisher-id <reverse-dns-id>
  --publisher-name <display-name>
  --key-id <stable-key-id>
  [--host 127.0.0.1]
  [--port 0]
  [--watch | --no-watch]
  [--json]
  [--quiet]
```

JSONL lifecycle 示例：

```json
{"schema":"openchamber://dev-hosted-cli-event/v1","event":"ready","manifestUrl":"http://127.0.0.1:49152/manifest.json","releaseId":"r1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","publisherId":"com.acme.dev","publisherName":"Acme Development","keyId":"dev-key-1","fingerprint":"sha256-..."}
{"schema":"openchamber://dev-hosted-cli-event/v1","event":"rebuild-started","reason":"source-change"}
{"schema":"openchamber://dev-hosted-cli-event/v1","event":"release-published","releaseId":"r1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}
{"schema":"openchamber://dev-hosted-cli-event/v1","event":"rebuild-failed","code":"manifest_invalid"}
{"schema":"openchamber://dev-hosted-cli-event/v1","event":"closed","clean":true}
```

不得输出private key/source absolute path/manifest body/resource bytes。

### B.1.1 Release ID preimage

下面是 release ID 的 canonical logical preimage；object keys 按 canonical JSON 规则排序，`resources` 按 `path` 排序。实现必须复用现有 manifest normalizer 产生 `contract`，不能从未规范化源码对象直接 hash。

```json
{
  "$schema": "openchamber://dev-hosted-release-preimage/v1",
  "extensionId": "com.acme.dashboard",
  "extensionVersion": "1.2.3",
  "publisherId": "com.acme.dev",
  "publisherName": "Acme Development",
  "publisherKeyId": "dev-key-1",
  "publisherPublicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAds7fGQEsSWmhadZVHE4ykMyz50m2RNU9WFVqcMwsqDc=\n-----END PUBLIC KEY-----\n",
  "contract": {
    "delivery": "hosted",
    "permissions": {},
    "views": [],
    "tools": [],
    "skills": []
  },
  "resources": [
    {
      "path": "dist/ui.mjs",
      "mime": "text/javascript",
      "size": 1234,
      "sha256": "sha256-..."
    }
  ]
}
```

这里的“禁止绝对 URL”只指 CLI serving origin 与由它派生的 `resources[].url`；不得把它扩大成删除扩展语义 URL。`contract` 必须包含规范化后的 connector `baseUrl`、network/external-link origins，以及所有开发者声明的 resource origins。只排除 Host 在 post-hash 阶段注入的 exact serving origin。`publisherPublicKey` 必须是现有 `normalizeEd25519PublicKey()` 返回的 canonical Ed25519 SPKI PEM string，不接受bare base64/DER；preimage、signed manifest publisher 与server-private source record保存并比较**同一个规范化PEM字节串**。`releaseId` 计算完成后才把 logical resource path换成已bind origin + 本进程`serverInstanceId`下的绝对immutable URL、合并derived serving origin并签名。测试必须证明connector/permission URL-only change会改变ID，而不同loopback port或不同CLI instance只改变derived URL/signature，不改变logical releaseId。

### B.1.2 Signed Dev release locator

最终 Hosted manifest 顶层增加以下字段；它与 publisher/extension/resources 一起进入现有 `canonicalStringify(unsignedManifest)` 签名，不新增 endpoint 或第二个 verifier：

```json
{
  "devHosted": {
    "$schema": "openchamber://dev-hosted-release/v1",
    "serverInstanceId": "0123456789abcdef0123456789abcdef",
    "releaseId": "r1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "logicalPreimage": { "$schema": "openchamber://dev-hosted-release-preimage/v1" }
  }
}
```

上例为排版省略；实际 `logicalPreimage` 必须完整内嵌 §B.1.1 的全部字段和 resources，不能只放 schema 或另给可变 URL。

`verifyRemoteOcixManifest` 仍负责既有 embedded publisher/Hosted signature；`dev-hosted.js` 随后只从 `verified.signedDocument.devHosted` 取 locator，并必须全部证明：

1. `serverInstanceId`严格匹配`/^[0-9a-f]{32}$/`，`releaseId`符合exact regex并等于重算`sha256(canonicalStringify(logicalPreimage))`；instance ID不进入preimage；
2. preimage 的 extension/version/publisher tuple 与 verified document相同；
3. preimage contract与 shared normalizer从 signed `extension` 得到的开发者语义合同相同；
4. preimage resources 与 signed resources 的 path/MIME/size/hash逐项相同；
5. signed resource URL全部与captured`/manifest.json`同origin，并精确落在`/instances/<serverInstanceId>/releases/<releaseId>/resources/<encoded-logical-path>`；historical manifest URL也使用同一signed instance/release pair；
6. 最终 permission resource origins 恰等于开发者声明集合并上 captured serving origin，不能多出未受 preimage约束的 origin。

任何不一致都返回稳定 `invalid_dev_hosted_release`，且必须发生在 trust/source/generation/cache 写之前。CLI JSONL 的 `releaseId` 只是自动化提示，不是产品 authority。

### B.2 Resource routes

| Route | Cache | 内容 |
|-------|-------|------|
| `GET/HEAD /manifest.json` | `no-store` | 当前成功release的signed manifest |
| `GET/HEAD /instances/:serverInstanceId/releases/:id/manifest.json` | immutable | 本进程指定release manifest；其他instance=404 |
| `GET/HEAD /instances/:serverInstanceId/releases/:id/resources/:path` | immutable | 本进程manifest allowlisted exact bytes/MIME |
| `GET /healthz` | `no-store` | protocol/current release/build status，无路径/secret |

其他method=405，unknown/path escape=404/400；不做directory listing。同端口重启必须生成新instance ID：旧instance immutable routes只404，新current manifest引用新instance；不得为了“恢复旧URL”从临时目录重建不同signed bytes。

### B.3 Product source record（server-private；public projection须删projectKey）

```json
{
  "type": "dev-hosted",
  "sourceId": "opaque-source-id",
  "extensionId": "com.acme.dashboard",
  "projectKey": "opaque-server-project-key",
  "sourceRootUrl": "http://127.0.0.1:49152/",
  "manifestUrl": "http://127.0.0.1:49152/manifest.json",
  "publisher": {
    "id": "com.acme.dev",
    "name": "Acme Development",
    "keyId": "dev-key-1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAds7fGQEsSWmhadZVHE4ykMyz50m2RNU9WFVqcMwsqDc=\n-----END PUBLIC KEY-----\n",
    "fingerprint": "sha256-derived-locally"
  },
  "enabled": true,
  "releaseId": "r1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "currentGenerationRef": "opaque-server-generation-ref",
  "acceptedManifestHash": "sha256-...",
  "acceptedPermissionsDigest": "sha256-...",
  "operationalHealth": {
    "status": "healthy",
    "checkedAt": "ISO-8601",
    "reason": null,
    "consecutiveFailures": 0
  },
  "lastGoodAt": "ISO-8601"
}
```

该完整source record只存在server private state。`currentGenerationRef`外键指向Manager的immutable generation record，后者持有verified signed manifest、shared-preflight digest、resource/cache metadata；source record不复制manifest bytes。accepted publisher信任继续写现有Manager trust store，source只保存上例publisher tuple/fingerprint与`acceptedManifestHash/acceptedPermissionsDigest`用于原子一致性检查，不能另造平行trust DB。`operationalHealth.reason`只接受`null|'unreachable'|'invalid-release'|'apply-failed'`，不含URL/path/error message；它不参与signature、releaseId、trust、generation或action authority。public `status`按单一规则派生：`enabled=false → disabled`；否则等于`operationalHealth.status`的`healthy|degraded`，并继续指向last-good generation，offline不等于disabled。

public Manager snapshot与mutation response以具名`DevHostedSourcePublicV1`为唯一projection：可返回其中的`sourceId/extensionId/status/enabled/releaseId/lastGoodAt`和已确认publisher display/id/keyId/fingerprint；必须删除`projectKey`、source/manifest URL、publicKey、currentGenerationRef、accepted digests、captured manifest与其他private authority。fingerprint必须由server从规范化PEM派生。private signing key不由OpenChamber source record持有；business access key属于独立connector Secret Store。key/public-key 冲突、轮换与权限扩大走 re-consent，不能只更新 fingerprint 字符串。

### B.3.1 Product source lifecycle HTTP contract

以下route全部位于authenticated OpenChamber product server、要求exact `X-OpenCode-Directory`、`Cache-Control:no-store`与`express.json({limit:'8kb'})`。body使用exact-key decoder；client提交`projectKey`、source URL override、private authority、accepted manifest或unknown field均400。`sourceId`是server 128-bit base64url且始终重新绑定fresh project authority；未知/cross-project统一404。

```ts
type DevHostedSourceInspectionV1 = {
  apiVersion: 1
  inspectionId: string
  operation: "connect" | "refresh"
  expiresAt: string
  candidate: {
    extensionId: string
    name: string
    version: string
    releaseId: string
    manifestHash: string
    publisher: { id: string; name: string; keyId: string; fingerprint: string }
    permissions: HostedPermissions
    change: "new" | "same" | "content" | "permissions-expanded" | "publisher-key-changed"
    requiresConsent: boolean
  }
}

type DevHostedSourcePublicV1 = {
  apiVersion: 1
  sourceId: string
  extensionId: string
  status: "healthy" | "degraded" | "disabled"
  enabled: boolean
  releaseId: string
  lastGoodAt: string
  publisher: { id: string; name: string; keyId: string; fingerprint: string }
}
```

`inspectionId`指向server内存中**已经完成**`fetch once → signature verify → signed locator重算 → shared shell-metadata preflight → diff`的captured candidate。connect inspect（尚无source）零持久写；refresh inspect和§6.7 health probe同样零trust/generation/current-pointer/cache/Tool写，唯一允许的持久变化是existing source的`operationalHealth`小事务：合法签名/locator/preflight成功→healthy/0，显式fetch或validation失败→degraded/safe reason。health写不得创建/切换generation或消费candidate；失败inspect不创建inspectionId。UI在refresh success/error后都重新读取现有Manager snapshot，以具名public projection显示派生status。record绑定projectKey、operation、sourceId（refresh时）、manifest hash与authority revision，5分钟single-use；最多64 records/16MiB，expired oldest-first清理，到cap无过期候选返回503 `dev_hosted_inspection_capacity`。record、ID与captured manifest不进localStorage/report/log，server重启全部失效。

| Method + route | Exact request | Success |
|---|---|---|
| `POST /api/interactive-ui/manager/dev-hosted/inspect` | `{apiVersion:1,manifestUrl:string}` | 200 `DevHostedSourceInspectionV1`，`operation:'connect'`；URL必须loopback Signed Manifest URL |
| `POST /api/interactive-ui/manager/dev-hosted/connect` | `{apiVersion:1,inspectionId,confirmedManifestHash,confirmedPublisherFingerprint}` | 201 `{apiVersion:1,source:DevHostedSourcePublicV1}` |
| `POST /api/interactive-ui/manager/dev-hosted/sources/:sourceId/refresh/inspect` | `{apiVersion:1}` | 200 `DevHostedSourceInspectionV1`，从server-private manifest URL fetch，`operation:'refresh'` |
| `POST /api/interactive-ui/manager/dev-hosted/sources/:sourceId/refresh/apply` | `{apiVersion:1,inspectionId,confirmedManifestHash,confirmedPublisherFingerprint?:string,enable?:true}` | 200 `{apiVersion:1,source:DevHostedSourcePublicV1}` |
| `POST /api/interactive-ui/manager/dev-hosted/sources/:sourceId/disable` | `{apiVersion:1}` | 200 `{apiVersion:1,source:DevHostedSourcePublicV1}`；立即撤销Tool/binding/lease，保留source/trust/last-good |

connect/apply必须消费同一captured candidate，不二次fetch后换内容；重新核对inspection未过期/未用、fresh project authority revision、developer switch、source/extension conflict、publisher/manifest confirmations。成功response故意只返回具名`DevHostedSourcePublicV1`；UI随后通过**现有Manager snapshot GET/client decoder**刷新installed-extension public summary，mutation route不得复制或发明第二套extension wire。`confirmedManifestHash`必须exact等于candidate；new/key-change/permission expansion时fingerprint必填且exact，普通content refresh可省略fingerprint。inspection在apply尝试开始时single-use消费；成功或失败都立即失效，重试必须重新inspect。apply只有在一个manager-scoped transaction完成generation materialize、last-good/current pointer、Tool reconcile与public source write后才成功；任何authority transaction失败保持旧generation/source/Tool完全可用，并在独立health小事务可写时标`degraded/apply-failed`。`enable:true`只允许把已disable source经完整refresh/re-consent重新启用；没有“盲enable”。disable原子设`enabled=false`（public status派生为disabled）并停止health timer；existing uninstall串行删除source引用与timer。

稳定flat errors（以下status/literal为完整route-visible单源）：body/unknown/private field或missing/malformed `X-OpenCode-Directory`=400 `dev_hosted_source_request_invalid`；developer switch off=403 `dev_hosted_developer_mode_disabled`；unknown/cross-project source=404 `dev_hosted_source_not_found`；initial/fresh project authority无受支持identity=422 `project_authority_identity_unsupported`，strict inventory不可用=503 `project_authority_inventory_unavailable`，shared ledger损坏/权限失败=503 `project_authority_store_unavailable`，shared ledger到cap=503 `project_authority_capacity`；inspection unknown/expired/used/project-stale=409 `dev_hosted_inspection_invalid`；已提交的manifest hash/fingerprint与inspection candidate不一致=409 `dev_hosted_confirmation_required`；candidate为new/key-change/permission-expanded且用户尚未完成fresh consent cycle（包括必填fingerprint缺失）=409 `dev_hosted_reconsent_required`，**先判re-consent requirement，再比较已提交confirmation**，因此同一请求只落一个code；same extension ID已被另一project Dev source占用=409 `dev_hosted_source_conflict`；fetch/connect失败=502 `dev_hosted_source_unreachable`；任何signature、publisher、locator、preimage、resource referential/type或shared shell-metadata preflight失败统一折叠为422 `invalid_dev_hosted_release`，不得把内部shared metadata literal透给route/UI；operational-health write、generation materialize、Manager state write、Tool reconcile、disable revoke或其原子transaction失败=500 `dev_hosted_source_apply_failed`（authority/last-good必须保持或disable保持原状态，`retryable:false`，UI只提供重新inspect/retry）；inspection/generation/binding capacity分别为503 `dev_hosted_inspection_capacity` / `dev_generation_capacity` / `dev_surface_binding_capacity`。tests必须逐branch固定precedence、status和literal，包括shared quartet；错误不得返回manifest URL、project path/key、inspection record或publisher public key。

### B.4 Product binding / lease HTTP contract

以下route属于OpenChamber product server，不属于CLI loopback server。全部使用`express.json({limit:'8kb'})`、exact-key decoder与`Cache-Control:no-store`。任何unknown/private field都在resolve/write前400 `dev_surface_request_invalid`；唯一公开提示字段是tile create/rebind顶层`bindingHint`，仍必须由server验证。

```ts
type DevHostedSurfaceSubjectV1 =
  | {
      kind: "result"
      hostBinding: DevHostedSurfaceBindingMarkerV1
      surface: { kind: "view" | "artifact"; id: string }
    }
  | {
      kind: "workbench-tile"
      projectId: string
      tileId: string
    }

type DevHostedLeaseContinuationRequestV1 = {
  apiVersion: 1
  leaseId: string
  surfaceInstanceId: string
}

type DevHostedLeaseResponseV1 = {
  apiVersion: 1
  leaseId: string
  surfaceInstanceId: string
  expiresAt: string
  resumeUntil: string
  descriptorUrl: string
}

type DevHostedSurfaceDescriptorV1 =
  | { apiVersion: 1; kind: "view"; descriptor: InteractiveViewDescriptor }
  | { apiVersion: 1; kind: "artifact"; descriptor: InstalledHTMLArtifactDescriptor }
```

`result` subject要求exact `X-OpenCode-Directory`；`workbench-tile`只从board private authority取project incarnation与marker，client marker/directory override一律拒绝而非忽略。`leaseId`与`surfaceInstanceId`均为server生成的128-bit base64url；它们作为一对、连同正常UI auth，足以让server定位private record，所以renew/resume/release**不再重复subject/header authority**，但每次都必须从record重新验证project仍受信、source enabled、publisher trust、extension/surface/generation/hash与调用runtime一致。不存在、伪造、跨project或已撤销统一404，不能泄漏是哪一项不匹配。

| Method + route | Request | Success response |
|---|---|---|
| `POST /api/interactive-ui/dev-hosted/bindings/resolve` | `{apiVersion:1,subject:DevHostedSurfaceSubjectV1}` | `{apiVersion:1,available:true,surface:{kind,id}}`；不返回generation/release/hash/path |
| `POST /api/interactive-ui/dev-hosted/leases/acquire` | `{apiVersion:1,subject}` | `DevHostedLeaseResponseV1` |
| `POST /api/interactive-ui/dev-hosted/leases/renew` | `DevHostedLeaseContinuationRequestV1` | 完整`DevHostedLeaseResponseV1`；pair/descriptor URL不变，仅时间更新 |
| `POST /api/interactive-ui/dev-hosted/leases/resume` | `DevHostedLeaseContinuationRequestV1` | 完整`DevHostedLeaseResponseV1`；`surfaceInstanceId`不变，发新lease ID和asset key/descriptor URL，旧key立即失效 |
| `POST /api/interactive-ui/dev-hosted/leases/release` | `{apiVersion:1,leaseId,surfaceInstanceId}` | 首次有效调用返回`{apiVersion:1,released:true}`并删除record；重复/unknown统一404，client cleanup忽略该404 |

`descriptorUrl`的GET response必须exact decode为`DevHostedSurfaceDescriptorV1`。`kind:'view'`复用现有`InteractiveViewDescriptor`字段；`kind:'artifact'`复用现有`InstalledHTMLArtifactDescriptor`字段。Native `assetPath`、Artifact `documentPath`与所有entry/icon/resource路径都只能是下述同一asset-key前缀；Declarative definition可内联但仍只能来自该lease capture的verified generation。descriptor不返回projectKey/generationId/releaseId/hash/cache path或lease/resume handle。

`descriptorUrl`只能是`/api/interactive-ui/dev-hosted/assets/<32-lowercase-hex>/descriptor`；resource只能是同前缀的`/resources/<64-lowercase-hex-resource-id>`，不得暴露logical path。control POST继续走现有UI bearer/cookie auth。因为Native dynamic import/Artifact iframe不能加Authorization header，asset GET/HEAD明确复用现有`oc_url_token` URL-auth机制：Host在每次使用前通过`getRuntimeUrlResolver().authenticatedAsset(path)`追加短期token，token不得写回descriptor/history/store。`ui-auth.js::isUrlAuthReadableHttpPath`只新增exact正则`^/api/interactive-ui/dev-hosted/assets/[a-f0-9]{32}/(?:descriptor|resources/[a-f0-9]{64})$`；不放行prefix、POST或WebSocket。asset route同时验证URL auth与asset key映射的**active lease**、project、surface、signed resource allowlist/hash/MIME；suspended lease的旧asset key已失效，必须先resume取得新key。缺任一项拒绝。response设置`Referrer-Policy:no-referrer`、`Cache-Control:private,no-store`、`X-Content-Type-Options:nosniff`。asset key/URL token/lease ID必须由access log与error details结构化redact，不进history/board/localStorage/report。无token且无正常Authorization的真实dynamic import必须401；expired/suspended/revoked/wrong-key必须404。不得增加绕过`requireAuth`的宽前缀，也不得假写header-only dynamic-import方案。

Workbench tile create/rebind继续走既有board route，但v2 request只额外接受顶层`bindingHint`；route先以400拒绝所有其他client private/unknown field，再按§6.8.2在一次transaction完成fresh project resolve、marker resolve/current issue和private tile persist。public board response只含`authorityStatus`。普通tile patch/migrate/duplicate不得接受或复制bindingHint/private authority。

business action仍走现有`POST /api/interactive-ui/actions/:actionId`，并在现有`InteractiveActionRequest`顶层冻结以下互斥authority union：

```ts
type InteractiveActionAuthority =
  | { hostBinding: DevHostedSurfaceBindingMarkerV1; workbench?: never }
  | { hostBinding?: never; workbench: { projectId: string; tileId: string } }
  | { hostBinding?: never; workbench?: never } // 仅非Dev Hosted现有source
```

对话/历史Dev Hosted View或Artifact必须走第一支；Workbench/Popout必须走第二支并由server读取private marker，若同时提交`hostBinding`则400；普通Local/Hosted/Remote source必须走第三支，提交`hostBinding`同样400。所有分支连同`viewId|artifactId`、extensionId、instanceId、action、input、tool/confirmation字段一起exact-key parse。server必须在创建/验证confirmation token、query或handler副作用前解析binding并要求generation===active；lease/asset key永不作为business authority。

所有错误沿用附录A.3的flat body。稳定映射：malformed/unknown/private key或authority-union冲突=400 `dev_surface_request_invalid`；unknown/forged/cross-project/binding-surface mismatch/unknown lease统一404 `dev_surface_binding_unavailable`，不泄漏是否存在；tile缺private project ref=409 `workbench_project_rebind_required`；project已绑定但缺Dev marker=409 `dev_surface_rebind_required`；直接Dev result缺marker=409 `dev_surface_binding_required`；inactive action=409 `dev_surface_generation_inactive`；expired lease仍可resume=409 `dev_surface_lease_suspended`；resume window过期=409 `dev_surface_resume_expired`；fresh shared authority失败透传422 `project_authority_identity_unsupported`或503 `project_authority_inventory_unavailable` / `project_authority_store_unavailable` / `project_authority_capacity`；generation/binding caps=503 `dev_generation_capacity`/`dev_surface_binding_capacity`。renew/resume/release不得把不存在与不属于当前project区分成不同message；tests逐branch固定shared quartet与surface code precedence。

---

## 附录 C：P3.4 决策接口与报告草案

### C.1 Response

```json
{
  "apiVersion": 1,
  "catalogRevision": "sha256-...",
  "scorerVersion": "lexical-v1",
  "outcome": "focused",
  "selectedToolNames": ["crm_open_dashboard"],
  "system": "<openchamber_interactive_ui_routing>...</openchamber_interactive_ui_routing>",
  "candidates": [
    {
      "extensionId": "com.acme.crm",
      "tool": "crm_open_dashboard",
      "rank": 1,
      "reasonCodes": [
        "explicit-tool",
        "example-phrase",
        "domain-token",
        "authority-connected"
      ]
    }
  ],
  "skippedExtensions": 0
}
```

此JSON只示意值，但除缩写的digest外必须能通过§8.5 strict success decoder；字段集合/decoder/bounds、`RoutingReasonCode`完整union、status/error literals和normalizer/outcome向量以§8.4–§8.5为唯一权威；不得从示例里的`sha256-...`放宽digest decoder。`system`仍必须使用安全固定template；examples只做纯字符串evidence，不能原样拼成executable instruction。

### C.2 Gate decision

```json
{
  "$schema": "openchamber://interactive-ui-routing-phase4-gate/v1",
  "decision": "not-triggered",
  "runs": 3,
  "reproducedFailureClasses": [],
  "safetyViolations": 0,
  "provenanceComplete": true,
  "phase4Authorized": false
}
```

---

## 附录 D：P3.5 Native Chart 合同草案

```ts
export interface NativeChartProps {
  variant: "bar" | "line" | "area" | "donut"
  ariaLabel: string
  title?: string
  series: readonly { id: string; label: string }[] // 1..5
  data: readonly { label: string; values: readonly number[] }[] // 0..30
  size?: "sm" | "md" | "lg"
  stacked?: boolean
  referenceLine?: { value: number; label?: string }
  valueFormat?:
    | { style: "number" | "compact" | "percent"; maximumFractionDigits?: 0 | 1 | 2 }
    | { style: "currency"; currency: string; maximumFractionDigits?: 0 | 1 | 2 }
  showLegend?: boolean
  emptyLabel?: string
}

export interface NativeActivationHostUI {
  // existing host components...
  Chart?: React.ComponentType<NativeChartProps>
}
```

Runtime normalizer必须拒绝unknown prop/invalid combination/非finite/总cell>150。Chart缺失或lazy失败时extension/Host显示Notice+可读表格。

---

## 附录 E：P3.6 Tool Progress 合同草案

### E.1 Wire

```ts
export type ToolProgressSnapshotV1 = {
  $schema: "opencode://tool-progress-snapshot/v1"
  revision: number // server-generated, integer >= 1
  structured: Record<string, unknown>
}

export type ToolProgressRejectedCode =
  | "tool_progress_invalid_structured"
  | "tool_progress_not_serializable"
  | "tool_progress_too_large"
  | "tool_progress_count_exceeded"
  | "tool_progress_call_not_running"
  | "tool_progress_unavailable"
  | "tool_progress_persist_failed"
```

`ToolProgressSnapshotV1`属于`packages/schema/src/v1/tool-progress.ts`并进入generated SDK；`ToolProgressRejectedCode`/error/input/publish helper只属于`packages/opencode/src/tool/progress.ts`的internal runtime interface，绝不导出到或复制进`@opencode-ai/plugin`/SDK。触发条件、safe error shape与10Hz coalesced-success语义以§10.4为单源；Appendix E不另造rate code。

### E.2 Reducer matrix

| existing | incoming | action |
|----------|----------|--------|
| none | running rev1 valid | accept partial |
| running rev2 | running rev1 | ignore regression |
| running rev2 | running rev2 | idempotent no-op |
| running rev2 | running rev3 invalid | keep rev2 safe frame，record drop |
| running rev2 | completed valid | final replaces partial，clear ledger when safe |
| running rev2 | completed invalid | generic final error/fallback；不得显示partial success |
| completed | late running any rev | ignore terminal regression |
| error with last progress | late running | ignore；可显示incomplete failed preview |
| capability false | any progress | ignore progress，normal final-only |

### E.3 SessionProcessor publisher/persistence pseudo-code

以下冻结的是Effect seam，不是Promise示意。built-in Tool绝不能import/callprocessor、`Session.updatePart`或private serializer，只能`yield* ToolProgress.publish(context,{structured})`。canonical helper负责把typed publisher failure转成defect，以匹配当前`Tool.Def.execute(...): Effect.Effect<ExecuteResult>`的`never`错误通道：

```ts
// packages/opencode/src/tool/progress.ts
export const unavailable: ToolProgressPublisher = () =>
  Effect.fail(rejected("tool_progress_unavailable"))

export const publish = (context: Tool.Context, input: ToolProgressInput): Effect.Effect<void> =>
  (context.progress ?? unavailable)(input).pipe(Effect.orDie)

// packages/opencode/src/session/processor.ts
export interface Handle {
  // existing message/updateToolCall/completeToolCall/process...
  readonly publishToolProgress: (
    toolCallID: string,
    input: ToolProgressInput,
  ) => Effect.Effect<void, ToolProgressRejectedError>
}

const publishToolProgress: Handle["publishToolProgress"] = Effect.fn(
  "SessionProcessor.publishToolProgress",
)(function* (toolCallID, input) {
  yield* withToolCallMutation(toolCallID, (ledger) =>
    Effect.gen(function* () {
      const match = yield* readToolCall(toolCallID)
      if (!match || match.part.state.status !== "running") {
        return yield* Effect.fail(rejected("tool_progress_call_not_running"))
      }

      const structured = yield* validateProgressInput(input)
      yield* enforceProgressLimits(ledger, structured)
      const persistedRevision = match.part.state.progress?.revision ?? 0
      const candidateRevision = Math.max(ledger.committedRevision, persistedRevision) + 1

      yield* session.updatePart({
        ...match.part,
        state: {
          ...match.part.state,
          progress: {
            $schema: "opencode://tool-progress-snapshot/v1",
            revision: candidateRevision,
            structured,
          },
        },
      }).pipe(
        Effect.catchAllCause(() =>
          Effect.fail(rejected("tool_progress_persist_failed")),
        ),
      )

      // Commit counters only after authoritative update succeeds.
      ledger.committedRevision = candidateRevision
      ledger.publishedCount += 1
    }),
  )
})

// packages/opencode/src/session/tools.ts normal context only
progress: (value) =>
  input.processor.publishToolProgress(options.toolCallId, value)
```

`withToolCallMutation`是`SessionProcessor.create()`内部、按toolCallID有界清理的Effect serializer，不是新public interface；`updateToolCall`、`publishToolProgress`、`completeToolCall`、`failToolCall`必须共享它，且持锁方法不得互相嵌套。`candidateRevision`只在该临界区计算；`Session.updatePart`失败时ledger revision/published count保持原值并返回`tool_progress_persist_failed`，下一次成功复用`current+1`，不得为未发布candidate制造gap。coalesced candidate同样不消费revision。terminal/final writer先取得锁时晚到progress稳定拒绝；progress先提交时terminal读取最新part后覆盖为终态。process恢复时以persisted part revision重建ledger。实际实现不能换回Promise mutex、提前自增counter、让producer直调Handle，或省略metadata/terminal race处理。

---

## 附录 F：低级 Agent 开工与交接模板

### F.1 开工 prompt

```text
你负责 roadmap <P3.x> 的工作包 <name>。

授权范围：<粘贴用户明确授权；没有则停止>
唯一所有文件：<绝对/仓库相对路径>
只读/不得修改文件：<相邻宿主/另一个Agent文件>
前置合同：<本文章节与冻结schema>
前置测试：<命令>
完成测试：<命令与报告>

强制要求：
1. 你不是代码库中唯一Agent；不得回退他人改动，重叠时先报告。
2. 先读roadmap、AGENTS、指定skill和最近DOCUMENTATION。
3. 先写/确认失败测试，再做最小实现；不得放宽安全、语料、预算、Golden。
4. 不修改其他P3 ID，不新增依赖，不执行git/GitHub/release。
5. 发现本文与当前代码冲突，先给出差异和建议，不自行改公共合同。
6. 交接必须列文件、接口、测试精确结果、未验证平台、风险和共享文件建议。
```

### F.2 交接

```markdown
## 工作包
- ID / 名称：
- 用户授权：
- 基线 revision/环境：

## 改动
- A：
- M：
- R：
- 明确未改：

## 合同
- 输入/输出：
- limits：
- errors：
- lifecycle/ordering：
- security/privacy：

## 验证
| 命令 | cwd | exit | tests | 结果/产物 |
|------|-----|------|-------|-----------|

## 未验证/阻塞
- 平台：
- 外部依赖：
- 发布权限：

## 给下一 Agent
- 可依赖事实：
- 共享文件patch建议（未直接修改）：
- 风险/回退：
```

### F.3 Reviewer checklist

```text
[ ] 只审用户授权的P3 ID；roadmap状态真实
[ ] 当前调用链/现有能力未重做
[ ] 对外接口小，复杂性在deep module内部
[ ] authority在server/Host，不在client hint
[ ] failure != empty/success
[ ] secrets/paths/payloads未进UI/log/report
[ ] lifecycle、并发、取消、rollback/last-good/terminal有测试
[ ] platform unsupported/unverified未误报
[ ] dependency/lock/generated/pin变化有授权且可追溯
[ ] 旧路径只在replacement测试后删除；无长期双实现
[ ] focused + security + regression + acceptance证据完整
[ ] 无git/GitHub/release越权
```
