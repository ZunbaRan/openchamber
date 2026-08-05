# MCP Apps 稳定化独立验收报告

> 验收日期：2026-08-03  
> 验收角色：独立验收/审核，不修改产品源码  
> 结论：**NO-GO — 不可进入候选 DMG 的 Electron computer-use 验收，更不可发布**

## 1. 结论摘要

开发者报告中“自动化全部通过”的结论与当前候选源码不一致。

基础单元测试、类型检查、协议测试、tldraw 独立验收和跨进程持久化均通过；但是发布前必须通过的 OpenChamber 自包含真实浏览器产品链失败：Agent 已成功选择 `tldraw_create_view`，MCP 2026-07-28 与 Apps capability 已正确协商，App resource 也成功加载，但验收器在等待“权威 revision 1 的 inline 预览”时超时。

按照验收计划，第一个产品浏览器门禁失败后必须停止 Electron computer-use。因此本轮没有把未执行的 Edit、Save、Export、历史 revision、App Board 或 Excalidraw 用例误报为通过。

当前状态不是协议不可用，也不是资源 403/404；它是 **inline 稳态渲染实现与产品验收契约不一致**。修复并重新通过自包含浏览器链之前，当前候选为 No-Go。

## 2. 候选版本冻结

| 对象 | 候选身份 |
|---|---|
| OpenChamber | `docs/interactive-ui-mcp-apps` @ `95b1954f3c77509e78129a3214142da0464ac46e` |
| OpenChamber tracked diff SHA256 | `b99ffc8014323880c63f65dd02a5ebe89b5827a8e933a3d8abdfdc5a282b8850` |
| OpenCode Fork | `openchamber-apps` @ `bf12c7a79358ae763733d6e67de93af5d6715226` |
| OpenCode tracked diff SHA256 | `e4b9ec8a88ec09f8c3e8df87b02a70c14a12df1bec721bfc741e41ee4d575959` |
| CLI lock SHA256 | `62234becd6a393a751f6eb7745990ee0f10171a2b7f50dc5c8aacbedff8e69db` |
| tldraw MCP App | Git 仓库尚无首个 commit；全部文件均为 untracked |
| 候选 DMG | `OpenChamber-1.17.1-tldraw-qa-oc.2-local.3-mac-arm64.dmg` |
| DMG SHA256 | `e0fd68bfd997b72fcad78abb38e694ccdba48ab087409f1f9ea36b2c60dd44f8` |

说明：开发态脏工作区可以用于问题验证，但不能作为可发布候选。tldraw MCP App 没有 Git HEAD，当前无法证明源码、`dist/app.html`、`dist/server.mjs` 和 DMG 中资源来自同一固定版本。

## 3. 自动化门禁结果

| 门禁 | 结果 | 证据摘要 |
|---|---:|---|
| OpenChamber Interactive UI/MCP App tests | PASS | 172 pass / 0 fail / 21 files |
| OpenChamber UI type-check | PASS | exit 0 |
| OpenCode MCP App/API tests | PASS | 18 pass / 0 fail |
| OpenCode MCP lifecycle | PASS | 35 pass / 0 fail |
| tldraw MCP App tests | PASS | 205 pass / 0 fail |
| tldraw `build:server` | PASS | `dist/server.mjs` 构建成功 |
| tldraw `verify` | PASS | App/server 哈希、162 icons、字体与翻译均通过 |
| tldraw `accept` | PASS | 独立 acceptance report 通过 |
| tldraw restart persistence | PASS | 跨真实进程 revision 持久化通过 |
| OpenChamber self-contained browser E2E | **FAIL** | `Timed out waiting for authoritative inline tldraw App revision 1` |
| Electron computer-use | BLOCKED | 前置浏览器门禁未通过，按计划停止 |
| DMG/source 一致性 | NOT RUN | 当前候选尚不具备固定 tldraw commit，且浏览器门禁已失败 |

失败运行：`2026-08-03T15-14-14-228Z`。

关键证据：

- [orchestration.json](../../../../.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-03T15-14-14-228Z/orchestration.json)
- [browser/report.json](../../../../.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-03T15-14-14-228Z/browser/report.json)
- [browser verifier log](../../../../.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-03T15-14-14-228Z/logs/browser-verifier.log)

`.tmp` 证据仅用于本轮诊断，修复后的正式通过证据必须复制到不可被常规清理删除的 release-evidence 目录。

## 4. 关键失败链路

本次真实产品路径已实际执行到以下位置：

1. Qwen3.7 Plus 创建 OpenCode Session。
2. MCP Server 状态为 `connected`。
3. 协议版本为 `2026-07-28`，adapter 为 `2026-sdk`。
4. MCP Apps client/server capability 均为 true，且协商成功。
5. 模型可见工具只有 `tldraw_create_view`、`tldraw_patch_shapes`。
6. 六个 app-only tools 未暴露给模型，visibility 正确。
7. Agent 成功调用 `interop-tldraw-2026_tldraw_create_view`。
8. Tool outcome 为 `isError:false`、无 fallback，canvas revision 为 1。
9. App resource API 返回 200，iframe 已出现 `.tl-canvas`，shell 可见，状态文字为 `Revision 1 · full editor ready`。
10. 验收器等待 `.preview-stage` 的无障碍标签，45 秒后超时。

这说明传输、协商、模型路由和资源加载均不是本次阻塞点。阻塞发生在真实 App 的 inline 首屏判定。

## 5. 缺陷清单

### P0 — 稳态 inline 渲染与验收契约互相矛盾

`InlineCanvasPreview` 创建 `.preview-stage` 与稳定的 `aria-label`，但只在 `streamingPreview.active === true` 时挂载。权威数据加载完成后，页面改为 `<Tldraw hideUi={inline}>`；此时 `.tl-canvas` 存在，但 `.preview-stage` 已不存在。

与此同时，产品浏览器验收器只从 `.preview-stage` 读取 `previewLabel`，并把 `revision === 1 && previewLabel` 作为 inline 成功条件。因此当前代码在权威 revision 到达后会稳定地违反验收器条件，门禁无法通过。

相关位置：

- `tldraw-mcp-app/src/app.tsx:5652`：轻量预览提供 `.preview-stage`/`aria-label`。
- `tldraw-mcp-app/src/app.tsx:8917`：轻量预览只在 streaming 阶段挂载。
- `tldraw-mcp-app/src/app.tsx:8926`：权威稳态改为真实 `<Tldraw hideUi={inline}>`。
- `openchamber/scripts/verify-tldraw-mcp-app-browser.mjs:829`：验收器读取预览标记。
- `openchamber/scripts/verify-tldraw-mcp-app-browser.mjs:2210`：把 `previewLabel` 作为硬门禁。

#### 必须先明确并固定产品契约

推荐采用“同一真实 tldraw 引擎，不同权限模式”的路线：

- inline、Review、App Board 使用真实 tldraw 引擎的只读模式；允许 zoom/pan，禁止 mutation。
- Edit 使用同一引擎和同一 canvas/revision，开启写权限。
- 稳态只读画布必须提供稳定、可访问、可自动验证的 surface identity，例如在包含 `.tl-canvas` 的宿主上增加 `data-mcp-app-surface="tldraw-preview"`、canvas ID、revision 和明确的 `aria-label`。
- 验收器必须同时验证：surface 可见、revision 正确、至少一个真实 shape 可见、相机可 zoom/pan、mutation 被拒绝；不能仅把 `containsCanvas` 当成功，也不能继续依赖 streaming-only 节点。

如果产品决定重新使用轻量 SVG 作为稳态预览，则代码必须始终渲染 `InlineCanvasPreview`，并接受它与 Edit 使用不同渲染引擎这一架构取舍。该路线与现有“single render engine”目标冲突，因此不推荐。

### P1 — semantic element 数量断言存在假阳性

模型创建结果中的 `semanticElementCount` 实际为 `null`，但验收器使用：

```js
assert((result.structuredContent.semanticElementCount ?? 7) >= 7)
```

缺失字段会被默认成 7，从而通过。应改为严格要求它是整数且满足下限；如果 Tool 协议不再承诺该字段，则应从实际 structuredContent/服务端 state 计算元素数量，不能用常数代替证据。

相关位置：`openchamber/scripts/verify-tldraw-mcp-app-browser.mjs:2164`。

### P1 — tldraw MCP App 不具备可发布的源码身份

该仓库尚无首个 commit，所有文件均为 untracked。当前无法重现本次运行，也不能完成 AU-03 的源码/资源/DMG 一致性证明。

开发者完成修复后，应先清理明确不应提交的构建残余，再创建固定 commit/tag；`verify`、浏览器报告和 DMG lock 都必须记录该 commit 及 `dist/app.html`、`dist/server.mjs` SHA256。

### P1 — 开发者主报告的状态声明已过期

`MCP_APPS_STABILIZATION_MASTER_REPORT.md` §4.1 和证据摘要声称自动化全部通过，但当前 self-contained 产品链是红色。主报告应区分：

1. 单元/协议测试通过。
2. 独立 tldraw acceptance 通过。
3. OpenChamber 自包含产品浏览器链失败。
4. Electron computer-use 未执行。

在修复前，报告状态应改为 No-Go，而不是“仅等待人工验收”。

### P2 — 自动化诊断噪声

- OpenChamber tests 有 React `act(...)` 警告。
- Broker 自定义消息被 JSON-RPC parser 反复记录为 `Ignoring non-JSON-RPC message`。
- OpenCode lifecycle 有 Zod JSON Schema 兼容提示。

这些不是本轮阻塞项，但会淹没真实错误，建议后续降低噪声或把已知诊断分类记录。

## 6. 25 个产品用例与 3 个审计用例状态

| 分组 | 状态 | 原因 |
|---|---|---|
| EX-01~EX-07 | BLOCKED / NOT RUN | Electron computer-use 未获准开始；不能据旧截图或开发报告判定 |
| TL-01 | **FAIL** | 权威 inline 首屏未满足可验证预览契约 |
| TL-02~TL-07 | BLOCKED / NOT RUN | TL-01 前置失败，Edit/App Board/大画布链路未执行 |
| RV-01~RV-05 | BLOCKED / NOT RUN | revision UI 与 restore 链路未执行 |
| QT-01~QT-06 | BLOCKED / NOT RUN | 产品 UI 配额/并发/teardown 链路未执行；仅底层自动化通过 |
| AU-01 | **FAIL** | 首屏不能同时满足权威 revision 与稳定可访问预览标记 |
| AU-02 | NOT RUN | 多实例 mutation authority 未进入执行阶段 |
| AU-03 | BLOCKED | tldraw 无固定 commit，且 DMG 对应关系未证明 |

注意：被阻塞不等于功能一定有缺陷，但也绝不能计为通过。

## 7. 开发修改顺序

### 阶段 1：修复 P0 首屏契约

1. 固定 inline/Review/App Board/Edit 的渲染与权限矩阵。
2. 为稳态只读真实 tldraw surface 增加稳定 identity、aria label、canvas ID 与 revision 属性。
3. 确保 inline 只读但 zoom/pan 可用，键盘、粘贴、拖动 shape、删除和文本输入不可修改文档。
4. 更新浏览器验收器读取稳态 surface，而非 streaming-only `.preview-stage`。
5. 添加一个“流式预览结束后进入权威 revision”的组件回归测试，防止只验证 loading/streaming 阶段。

### 阶段 2：消除验收假阳性

1. 删除 `semanticElementCount ?? 7`。
2. 从 Tool structuredContent 或服务端精确 state 验证语义元素数量。
3. 首屏成功必须同时具备：正确 canvas/revision、可见 shape、非 fallback、无 console/page/runtime error。
4. 失败报告保存最后一次 App DOM/surface 状态和截图；本次失败没有正式截图，不利于定位。

### 阶段 3：固定发布身份

1. 为 tldraw MCP App 建立首个可审查 commit。
2. 记录 App/Server dist 哈希与来源 commit。
3. 从同一固定 commit 重建 OpenChamber DMG。
4. 验证 DMG 内 OpenCode、App resource 与源码哈希一致。

### 阶段 4：重新跑门禁

严格串行执行：

1. OpenChamber 172 tests + type-check。
2. OpenCode MCP 18 tests + lifecycle 35 tests。
3. tldraw 205 tests、build、verify、accept、restart persistence。
4. `bun run test:tldraw-mcp-app-browser:self-contained`，必须 `ok:true` 且执行到 Save、Done、history、Pin、App Board，不允许中途 not-run。
5. 通过后才安装同源 DMG，进入 Electron computer-use。

### 阶段 5：Electron computer-use

按 [MCP Apps Computer-Use 产品验收计划](../../../MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md) 执行全部 25+3 用例。必须生成截图/视频、case JSON、服务端 revision 证据和 secret scan。只出现 Tool 文本、iframe 外壳、fallback 或 Retry 后偶发成功均不算通过。

## 8. 复测准入标准

开发 Agent 交回候选前必须同时满足：

- self-contained browser report `ok:true`。
- TL-01 的稳态 surface 同时证明权威 revision、真实 shape、可访问标签和只读 zoom/pan。
- `semanticElementCount` 不再由默认常数兜底。
- tldraw MCP App 有固定 commit，源码与 dist 哈希可追溯。
- 新 DMG 从该固定提交构建并记录 SHA256。
- 主报告不再把未运行的 computer-use 用例写为通过。

满足以上条件后，才能启动下一轮独立验收。下一轮必须创建新 run ID，保留本次失败证据，不覆盖本报告。
