# MCP Apps 稳定化修复 — 实施记录与验收清单

> ⚠️ **已被 [MCP_APPS_STABILIZATION_MASTER_REPORT.md](./MCP_APPS_STABILIZATION_MASTER_REPORT.md) 取代**——本文保留早期 P0-A/C/D 的细节，但不代表当前状态（P0-B 已实施、审计 AUD-001~004 已修复、Gate C E2E 已通过，见主报告 §4.6）。

> 日期：2026-08-03（本会话）
> 关联计划：[MCP_APPS_EXCALIDRAW_TLDRAW_STABILIZATION_PLAN.md](./MCP_APPS_EXCALIDRAW_TLDRAW_STABILIZATION_PLAN.md)
> 涉及仓库：`tldraw-mcp-app`、`openchamber`（OpenCode Fork / acceptance-lab 未改动）
> 执行方式：主代理直接实施（subagent workflow 因提供商配额耗尽不可用）

---

## 1. 任务总览

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | 摸清现状：对照计划检查关键文件与已实现程度 | ✅ 完成 | 手工排查三仓库关键路径 |
| 2 | P0-A: Excalidraw 空白修复（诊断状态机、错误码、CSP 断言、网络策略、watchdog） | ✅ 完成（代码层） | 诊断模型 + 渲染器接线 + sandbox 探针；CSP 全链路断言、离线 derivative、诊断摘要 UI 未做 |
| 3 | P0-C: 画布配额（maxActive/maxArchived/maxTotalStoredBytes、CanvasQuotaExceeded、idempotency） | ✅ 完成 | 含单一配额权威、fixture 归档、审计 receipt |
| 4 | P0-B: tldraw 单渲染引擎（inline 弃用 semantic SVG、共用 CanvasSurface、AppBridge 只读） | ⏳ 未完成 | 三个子项均未动，见 §3.1 |
| 5 | P1-D: revision provenance（6 种 origin、unknown-legacy、fixture 隐藏） | ✅ 完成（服务端） | App 端 UI 标签未做，见 §3.2 |
| 6 | 验收与人工验证点：跑自动化验证 + 整理人工验证清单 | 🔄 部分完成 | 自动化全部通过；人工验证待用户执行，清单见 §4 |

---

## 2. 已完成任务详细记录

### 2.1 P0-C：画布配额、生命周期与 Agent 行为（`tldraw-mcp-app`）

**需求来源**：计划 §4.4、§6.6、P0-C C1~C4、验收 QT-01~06

**实现内容**：

1. **配额拆分**（C1）
   - `canvas-store.mjs` 新增 `maxActiveCanvases`（默认 32）、`maxArchivedCanvases`（默认 32），保留 `maxCanvasesPerWorkspace`（64）作总量上限
   - 新增 `retentionClass: 'ephemeral' | 'persistent'`（记录字段 + catalog 条目 + 列表输出）
   - 服务端 `server.mjs` 新增 env 覆盖：`TLDRAW_MCP_MAX_CANVASES` / `TLDRAW_MCP_MAX_ACTIVE_CANVASES` / `TLDRAW_MCP_MAX_ARCHIVED_CANVASES`
2. **结构化配额错误**（§6.6）
   - 新增 `CanvasQuotaExceededError`（`canvas_limit_reached`），details 含：`code / workspaceId / activeCount / archivedCount / maxActive / maxTotal / ephemeralArchiveCandidates / requestId`
   - 错误路径：createCanvas、importLegacyStateDocument（active 上限）、archiveCanvas（archived 上限）、unarchiveCanvas（active 上限）
   - MCP Tool Result：`isError: true` + `structuredContent.error`（SDK 确认 isError 跳过 outputSchema 校验）+ 简短人类文本（提示不得复用无关 canvasId）
3. **单一配额权威**（§6.6.1）
   - 删除 `server.mjs` 中 `tldraw_create_view` 与 `tldraw_open_canvas` 两处基于内存 draft 的 `Object.keys(...).length >= MAX_CANVASES` 重复计数
   - 配额判定统一走 canvasStore（每次从磁盘 catalog 重读）
4. **创建幂等**（§4.4 / QT-03）
   - canvas-store `createCanvas` 支持 `idempotencyKey`（记录 `createReceipts`，命中即回放原记录，不重复创建）
   - 工具层 `tldraw_create_view` / `tldraw_open_canvas` 新增可选 `idempotencyKey` 入参，经 `runStateMutation → persistStateChanges → createCanvas` 透传
5. **移除生产默认 `interop-acceptance`**（C4）
   - `DEFAULT_CANVAS_ID` 回退值改为 `default-canvas`
   - `interop-acceptance` 仅允许出现在测试配置（`test/server.protocol.test.mjs` helper 显式注入）
6. **fixture 启动归档**（D3 / QT-05）
   - `restoreStateDocument`：当默认画布非 `interop-acceptance` 时，若 catalog 中存在**纯净种子**（revision ≤ 1 且内容为协议占位卡 `tldraw v5.0.2 · strict MCP 2026-07-28`），经服务端事务 `archiveCanvas` 自动归档；有真实内容的画布绝不自动动
7. **审计 receipt**（§6.6.5）
   - 记录级 `auditReceipts`（上限 64 条）：`create / archive / unarchive / legacy-import / delete`（delete 还返回独立 `auditReceipt` 并纳入输出 schema）
8. **health / capabilities 暴露容量**（C2）
   - `/health` 的 `persistence` 增加 `activeCanvases / archivedCanvases / limits{maxActiveCanvases, maxArchivedCanvases, maxCanvasesPerWorkspace}`
9. **Tool 契约更新**（C4）
   - `tldraw_create_view` / `tldraw_open_canvas` / `tldraw_read_me` 描述明确：quota 错误时不得复用无关 canvasId，应先查 catalog / 归档 ephemeral 或使用新 workspace

**关键文件**：`tldraw-mcp-app/src/canvas-store.mjs`、`tldraw-mcp-app/src/server.mjs`

**测试证据**：
- `test/canvas-store.test.mjs` 新增 6 项：配额拆分与结构化错误细节、创建幂等、provenance 默认/显式/restore、test-fixture 过滤、legacy 迁移 unknown-legacy、审计 receipt + retentionClass
- `test/server.protocol.test.mjs` 新增 5 项：QT-01+02 结构化错误与归档即释放、QT-03 幂等、RV-04 fixture 归档、P1-D save/restore provenance
- 全量 **203/203 通过**

### 2.2 P1-D：revision 来源与测试数据隔离（`tldraw-mcp-app`）

**需求来源**：计划 §4.3、§6.7、D1~D3、验收 RV-01~05

**实现内容**：

1. **revision provenance**（D1）
   - revision 条目新增 `provenance: { origin, reasonCode, parentRevision?, restoredFromRevision? }`
   - origin 六值：`initial / agent / user-save / restore / migration / test-fixture`（`REVISION_ORIGINS` 导出供服务端 schema 复用）
   - 默认来源：r1 首次提交 → `initial/initial-seed`；后续工具提交 → `agent/tool-commit`；用户保存 → `user-save`（server 经 `commitMetaByCanvas` 注入）；restore → `restore` + `restoredFromRevision` + `parentRevision`
2. **向后兼容迁移**（§6.7）
   - `normalizeRecord`：旧记录缺失 provenance → `migration/unknown-legacy`，绝不猜成 user-save
3. **test-fixture 过滤**（D2 / RV-04）
   - `listRevisions` / `tldraw_list_canvas_revisions` 默认过滤 `test-fixture`，`includeTestFixtures: true` 显式开启
   - `revisionSummarySchema` 增加 `provenance` 字段
4. **数据流贯通**
   - `runStateMutation` 增加 `commitMetaByCanvas` 透传（restore 工具注入 restore provenance；save 工具注入 user-save provenance）
   - `restoreStateDocument` / `applyStoreRecordToDocument` 保留 provenance 到内存 revisionHistory
   - `revisionListView` 输出 provenance + 过滤

**关键文件**：`tldraw-mcp-app/src/canvas-store.mjs`、`tldraw-mcp-app/src/server.mjs`

**测试证据**：见 §2.1（同套件覆盖）；全量 **203/203 通过**

### 2.3 P0-A：Excalidraw 空白页诊断与兼容（`openchamber`）

**需求来源**：计划 §4.1、§6.1、§6.2、A1/A4、验收 EX-01~07

**实现内容**：

1. **纯逻辑 runtime model**（`packages/ui/src/lib/interactive-ui/mcpApp.ts`）
   - `McpAppRuntimePhase` 9 态：`resolving-binding / fetching-resource / mounting-sandbox / loading-dependencies / waiting-app-bridge / delivering-tool-data / waiting-first-paint / ready / failed`
   - `McpAppRuntimeFailureCode` 9 码：`resource-fetch-failed / csp-metadata-missing / dependency-blocked / dependency-unreachable / script-failed / bridge-timeout / tool-data-delivery-failed / ready-but-blank / binding-invalidated`
   - `McpAppRuntimeState { epoch, phase, failure, milestones }` + 纯 reducer `reduceMcpAppRuntime`
   - **epoch 守卫**：携带旧 epoch 的事件被忽略（旧 iframe 不得改变新实例状态，计划 §6.1.5）；`epoch` 事件原子切换并清空历史诊断
   - 每个错误码的 retryable 默认值表；稳定用户文案 `mcpAppRuntimeFailureText`；脱敏工具 `sanitizeMcpAppDiagnosticDetail`（URL 只留 origin、去 query/HTML、限长）
   - `MCP_APP_READY_BLANK_DEADLINE_MS = 4000`
2. **McpAppRenderer 接线**（`packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`）
   - `useReducer` 接入 runtime model；bindingEpoch 变化 → epoch 事件原子重置
   - 事件注入点：resource fetch 成功→`mounting-sandbox` / 失败→`resource-fetch-failed`；broker ready→`waiting-app-bridge`；AppBridge initialized→`waiting-first-paint`；桥接失败→`bridge-timeout`；权限违规→`binding-invalidated`
   - 失败时经 `mcpAppRuntimeFailureText` 进入既有错误 UI（稳定错误码，不再只有裸字符串）
   - **ready-but-blank watchdog**（A4）：`waiting-first-paint` 起 4 秒计时，无首屏证据 → `ready-but-blank`（retryable）
   - 首屏证据：AppBridge `sizechange` 上报、broker `visible-content` 探针
3. **sandbox broker 诊断探针**（§6.2）
   - `createMcpAppBrokerDocument` 注入（字符串替换，保持 URL 长度约束 <16000）：
     - `securitypolicyviolation` → 仅上报 `effectiveDirective` + 规范化 origin（URL 去 path/query）
     - `error` → 仅上报类别（script/cross-origin）+ script origin
     - `unhandledrejection` → 仅上报通用类别
     - App iframe ResizeObserver → 仅上报可见尺寸布尔信号 `broker.visible-content`（一次性）
   - **关键工程修复**：broker 脚本存在同步重入（测试 harness 的 postMessage 同步分发），探针若用 `const` 声明会在 `ready()` 首次调用时触发 TDZ（`Cannot access 'sp' before initialization`）；改为 `var` + 函数声明提升解决
   - 探针消息沿用 source/origin/nonce/epoch authority guard；不读取业务 DOM、不透传错误对象
4. **proxy controller**：`onProbe` 回调 + 新 broker 消息类型处理（`broker.probe-csp / broker.probe-script / broker.probe-rejection / broker.visible-content`）

**关键文件**：`packages/ui/src/lib/interactive-ui/mcpApp.ts`、`packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`

**测试证据**：
- `mcpApp.test.ts` 新增 6 项：相位与 milestone 顺序、failed 终态、retryable 表、**stale epoch 忽略**、epoch 原子切换、文案稳定
- `McpAppRenderer.test.ts`：新增/更新 broker 生命周期断言（探针注册顺序、ready 流程）；harness 修正为浏览器语义（仅 message 类型存入 messageListener）
- interactive-ui 全量 **168/168 通过**；McpAppRenderer 专项 **63/63 通过**；tsc 类型检查干净（仅 2 个基线已有的 toMatch 错误）

---

## 3. 未完成任务详细记录

### 3.1 P0-B：tldraw 单渲染引擎（todo #4，pending）

**内容**（计划 §4.2、§6.5、B1~B4、验收 TL-01~07）：
- B1 inline 弃用自研 semantic SVG（`lightweightPreviewScene()` + `.preview-stage`），Tool Result 完整后切换真实 tldraw v5 renderer，semantic SVG 仅保留流式骨架/导出回退
- B2 引入 read-only presentation mode（tldraw 原生只读或等价 mutation gate），AppBridge 层拒绝 inline 写入（不能只靠隐藏按钮）
- B3 camera 契约：初次 zoom-to-fit；inline↔Edit 互传 camera；camera 仅存内存不入 revision；切换 revision 后重新 zoom-to-fit
- B4 复杂内容回归：rectangle/ellipse/text/arrow、binding 与箭头标签、多页面、image asset、自定义字体与主题、100+ shape、三种容器尺寸

**未完成原因**：`app.tsx` 9029 行、双渲染路径交织，重构需动 store 生命周期与跨模式同步；验收标准是 inline/fullscreen 截图一致性（TL-01/07），必须人工视觉对比；优先级上先落地了数据层（P0-C）与诊断层（P0-A）。

**前置依赖**：无硬依赖（P1-D 服务端已就绪）；建议验收路径：`test/app.behavior.test.mjs`、`test/app.parity.test.mjs` 扩展。

### 3.2 P1-D App 端 UI（部分未完成）

- revision 列表 UI 标签（"r2 · latest"、"r1 · initial seed"、"r5 · restored from r2"）——服务端数据已就绪，App 端未改
- "显示内部修订"开关（默认隐藏 test-fixture）——服务端默认过滤已生效，App 开关未做

### 3.3 A2：OpenCode Fork CSP 全链路断言（未做）

计划 §6.3：resource `_meta.ui.csp` 从 `resources/read` → OpenCode → SDK → OpenChamber envelope → sandbox CSP 六跳逐跳断言 + Excalidraw `esm.sh` 固定回归 fixture。涉及 `opencode` 仓库，本会话未动。

### 3.4 A3：离线 Excalidraw derivative（未做）

计划 §6.4：self-hosted/offline 构建（React/Excalidraw/morphdom 全打入 resource，独立 provenance，不篡改官方 .mcpb）。需 acceptance-lab 构建设施。

### 3.5 C3：自动保留策略（未做）

TTL/LRU 自动归档 ephemeral/test 未 pin 画布；`retentionClass` 字段与候选计数已就绪，调度器未实现。

### 3.6 QT-06：stale generation 完整探测（部分完成）

- 已具备：每次写事务都从磁盘重读 catalog/record + revision fence 拒绝 stale 写入（clean rejection，非静默覆盖）
- 未做：外部改动主动监听 / storeGeneration 显式暴露

### 3.7 其他

- **诊断摘要 UI**（A1：Retry / 查看诊断摘要 / 展开 Original Tool Output）未做——错误文本已稳定化，UI 组件未实现
- **csp-metadata-missing 显式检测**未接线：当前无 CSP 声明时走严格默认策略（fail-closed、不扩大到 `*`，安全行为已具备），但未显示该错误码
- **EX-07 / 发布门禁 6/7**：历史任务恢复与 DMG 打包一致性，需人工/发布流程验证

---

## 4. 验收清单

### 4.1 自动化验收（已执行，全部通过）

| 套件 | 命令 | 结果 |
|---|---|---|
| tldraw-mcp-app 全量 | `cd tldraw-mcp-app && npm test` | **203/203 ✅**（含新增 11 项） |
| openchamber interactive-ui 全量 | `cd openchamber && bun test packages/ui/src/lib/interactive-ui/ packages/ui/src/components/interactive-ui/` | **168/168 ✅**（含新增 6 项） |
| McpAppRenderer 专项 | `bun test packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts` | **63/63 ✅** |
| 类型检查 | `cd packages/ui && npx tsc --noEmit` | ✅（仅 2 个基线已有 toMatch 错误，非本次引入） |

### 4.2 计划 23 个验收用例逐条状态

#### Excalidraw P0（EX-01~07）

| 用例 | 场景 | 状态 | 说明 |
|---|---|---|---|
| EX-01 | 官方 create_view 首屏可见 | 🔄 待人工 | 诊断链路就绪；需真实浏览器验证 |
| EX-02 | 正常 esm.sh 全模块加载 | 🔄 待人工 | 需真实网络 |
| EX-03 | 阻断 esm.sh 10 秒内明确失败 | 🔄 待人工 | `dependency-unreachable/blocked` 错误码与 CSP 探针就绪 |
| EX-04 | CSP 丢失注入显示 csp_metadata_missing | ❌ 未实现 | 现行为：严格默认策略 fail-closed（不扩大 `*`）；错误码未接线 |
| EX-05 | AppBridge 不初始化超时失败可 Retry | 🔄 待人工 | `bridge-timeout` 错误码就绪 |
| EX-06 | App 初始化但不画 UI → ready_but_blank | ✅ 代码就绪 | 4s watchdog 实现；待人工浏览器验证 |
| EX-07 | 历史任务恢复重绑 resource/Tool Result | 🔄 待人工 | 需重启场景验证 |

#### tldraw 预览 P0（TL-01~07）

| 用例 | 场景 | 状态 | 说明 |
|---|---|---|---|
| TL-01 | inline 与 Edit 相同字体/shape/arrow/asset | ❌ 未实现 | P0-B 未做 |
| TL-02 | inline zoom/pan 不产生 revision | ❌ 未实现 | P0-B 未做（服务端 revision fence 已有） |
| TL-03 | inline mutation 全拒绝 | ❌ 未实现 | AppBridge mutation gate 未做 |
| TL-04 | inline→Edit 同 canvas/revision/camera | ❌ 未实现 | P0-B 未做 |
| TL-05 | Edit→inline 未保存确认/内容一致 | ❌ 未实现 | P0-B 未做 |
| TL-06 | App Board tile 只读缩放 | ❌ 未实现 | P0-B 未做 |
| TL-07 | 100+ shape 大画布无 SVG 丢形 | ❌ 未实现 | P0-B 未做 |

#### revision P1（RV-01~05）

| 用例 | 场景 | 状态 | 说明 |
|---|---|---|---|
| RV-01 | 查看 r1 显示准确来源标签 | 🔄 部分 | 服务端 provenance 就绪；App UI 标签未做 |
| RV-02 | 历史 Review 只读可缩放不可保存 | 🔄 部分 | 服务端精确读/restore 就绪；App Review 模式未做 |
| RV-03 | Restore 新增 rN、旧记录不变 | ✅ 已实现 | 服务端 + 测试覆盖；App UI 未做 |
| RV-04 | fixture 默认用户不可见 | ✅ 已实现 | 过滤 + 启动归档，协议测试覆盖 |
| RV-05 | 迁移对照报告 | 🔄 部分 | unknown-legacy 迁移已实现；前后对照报告未产出 |

#### quota P0（QT-01~06）

| 用例 | 场景 | 状态 | 说明 |
|---|---|---|---|
| QT-01 | 达 active limit 返回结构化计数与建议 | ✅ 已实现 | 测试覆盖（含全部字段） |
| QT-02 | archive 后立即可创建 | ✅ 已实现 | 测试覆盖 |
| QT-03 | 相同 idempotency key 只产生一个 canvas | ✅ 已实现 | 测试覆盖 |
| QT-04 | 并发创建不超过 limit | 🔄 部分 | mutationQueue 序列化 + 磁盘权威已有；专门并发测试未加 |
| QT-05 | 测试 teardown 归档临时画布 | ✅ 部分 | fixture 启动归档已实现；teardown 脚本未做 |
| QT-06 | stale memory 注入拒绝写入 | 🔄 部分 | 重读磁盘 + revision fence 拒绝；显式 generation 未做 |

### 4.3 人工验证步骤（需用户执行，浏览器/视觉）

**A. 本地主链验证**
```bash
cd ~/Documents/data/project/openChamber/tldraw-mcp-app && npm run serve
# 启动 openchamber dev，让模型调用 tldraw_create_view，检查：
# 1. App 正常渲染拓扑图（而非协议占位卡）
# 2. revision 列表：r1 显示 "initial seed" 标签；interop-acceptance 不在默认列表
# 3. 历史 revision Review 只读、Restore 新增 rN 且旧记录不变
```

**B. 配额故障注入**
```bash
TLDRAW_MCP_MAX_ACTIVE_CANVASES=2 npm run serve
# 创建第 3 个画布 → 应返回 canvas_limit_reached + 完整计数（activeCount/archivedCount/maxActive/maxTotal/requestId）
# archive 一个后立即可再创建；确认 Agent 不再擅自复用其他 canvasId
```

**C. Excalidraw 在线/断网路径**
```bash
# 在线：esm.sh 可达 → 官方 App 正常渲染（EX-01/02）
# 断网（或 hosts 屏蔽 esm.sh）→ 4 秒内显示明确失败（dependency-unreachable/blocked 或 ready-but-blank），不得白屏
```

**D. 重启恢复（EX-07）**：重启 OpenChamber + MCP Server 后，历史任务 resource 与 Tool Result 重新绑定并渲染。

### 4.4 发布门禁 7 项对照（计划 §11）

| # | 门禁 | 状态 |
|---|---|---|
| 1 | Excalidraw 官方页面不再无诊断地空白 | 🔄 已缓解，待人工确认 |
| 2 | inline 与 Edit 不再由不同最终渲染引擎负责 | ❌ 未满足（P0-B） |
| 3 | inline 只读模式不能修改业务 document | ❌ 未满足（mutation gate） |
| 4 | quota 错误不诱导 Agent 复用共享画布 | ✅ 已满足 |
| 5 | fixture revision 不默认暴露给普通用户 | ✅ 已满足 |
| 6 | 历史恢复无 403/404 或绑定错误 | 🔄 待人工验证 |
| 7 | DMG 内置 OpenCode Fork 与源码验收版本一致 | 🔄 待发布流程验证 |

---

## 5. 变更文件清单

### tldraw-mcp-app（本会话修改）

| 文件 | 变更 |
|---|---|
| `src/canvas-store.mjs` | 配额拆分、CanvasQuotaExceededError、retentionClass、createReceipts、auditReceipts、revision provenance、listRevisions 过滤、归档/恢复配额检查 |
| `src/server.mjs` | 删除重复计数、结构化错误响应、env 配额覆盖、默认画布改名、fixture 启动归档、commitMetaByCanvas 透传、revisionListView provenance、工具 schema/描述更新、health limits |
| `test/canvas-store.test.mjs` | +6 测试 |
| `test/server.protocol.test.mjs` | +5 测试；helper 显式注入 interop-acceptance |

### openchamber（本会话修改）

| 文件 | 变更 |
|---|---|
| `packages/ui/src/lib/interactive-ui/mcpApp.ts` | +runtime model（相位/错误码/state/reducer/epoch 守卫/文案/脱敏） |
| `packages/ui/src/lib/interactive-ui/mcpApp.test.ts` | +6 测试 |
| `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx` | runtime reducer 接线、watchdog、broker 探针注入、proxy onProbe、事件注入点 |
| `packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts` | broker 生命周期断言更新、harness 浏览器语义修正 |

---

## 6. 已知风险与限制

1. **探针盲区**：App 文档为 opaque origin，其内部脚本错误/CSP violation 无法从宿主观察（计划 §6.2 已知限制）；当前探针覆盖 broker 文档 + AppBridge 信号，`script-failed` 主要依赖 `ready-but-blank` 兜底
2. **ready-but-blank 证据强度**：可见尺寸是弱信号（空白大页也算可见）；watchdog 4s 阈值可能在慢网络上误报，可在 `MCP_APP_READY_BLANK_DEADLINE_MS` 调优
3. **fixture 归档启发式**：仅归档"revision ≤1 且为协议占位卡"的 interop-acceptance；r2+ 有真实内容的旧 fixture 画布不会被自动归档（保守策略，防误删）
4. **quota 迁移**：存量数据无 retentionClass → 默认 persistent（不会被自动清理），符合保守原则
5. **TDZ 修复的通用教训**：sandbox bootstrap 内新增探针必须用 `var`/函数声明（同步重入场景）
6. **未提交**：以上改动均在工作区，未创建 commit
