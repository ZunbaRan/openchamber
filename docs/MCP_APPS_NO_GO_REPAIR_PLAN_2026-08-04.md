# MCP Apps No-Go 修复与重新验收计划

> 日期：2026-08-04  
> 输入证据：[2026-08-03 独立验收报告](./release-evidence/mcp-apps-stabilization/2026-08-03-acceptance-01/ACCEPTANCE_AUDIT_REPORT.md)  
> 适用仓库：`tldraw-mcp-app`、`openchamber`；`opencode` 仅在新增证据指向协议/绑定缺陷时修改  
> 当前结论：**NO-GO**  
> 本文用途：交给开发 Agent 实施；验收 Agent 不直接修改产品代码

## 1. 背景与本轮目标

上一轮独立验收已经证明：

- MCP `2026-07-28` 协议协商成功；
- MCP Apps capability 的 client/server/negotiated 均为 true；
- 模型能选择 `tldraw_create_view`；
- model-visible 与 app-only Tool visibility 正确；
- Tool result 没有 `isError` 或 fallback；
- `ui://` resource 能被 OpenChamber 成功读取并挂载；
- 失败发生在 OpenChamber 自包含真实浏览器产品链的 **authoritative inline first paint**。

当前代码在 streaming 阶段显示 `InlineCanvasPreview`，权威状态到达后改为真实
`<Tldraw hideUi={inline}>`。这符合最新 P0-B“单一真实渲染引擎”的设计，但验收器仍只
识别 streaming-only 的 `.preview-stage`，因此等待 `previewLabel` 超时。

本轮目标不是单纯让测试变绿，而是把产品实现、可访问状态、自动化判定和发布证据统一到
同一个明确契约，并完整执行被阻塞的 Excalidraw、tldraw、revision、quota、App Board 与
打包客户端验收。

## 2. 当前事实与文档冲突

### 2.1 当前代码事实

`tldraw-mcp-app/src/app.tsx` 当前有以下行为：

1. `.preview-stage` 由 `InlineCanvasPreview` 提供，并带 `aria-label`。
2. 它只在 `inline && streamingPreview?.active === true` 时挂载。
3. 权威状态就绪后挂载唯一真实 `<Tldraw>`，inline 时使用 `hideUi={inline}`。
4. `.acceptance-shell` 已提供 `data-editor-ready` 与 `data-editor-status`，但 inline 状态被
   固定投影成 `loading`，不能准确表达“渲染已就绪但没有 mutation authority”。

`openchamber/scripts/verify-tldraw-mcp-app-browser.mjs` 当前有以下行为：

1. `previewLabel` 只读取 `.preview-stage`。
2. inline 成功条件为 `revision === expected && previewLabel`。
3. `semanticElementCount` 缺失时用常量 `7` 兜底，形成假阳性。

### 2.2 必须统一的文档口径

以下口径存在冲突：

- [P0-B 单渲染引擎方案](./P0B_TLDRAW_SINGLE_RENDER_ENGINE_PLAN.md)要求 inline 与 Edit
  使用同一个真实 tldraw 引擎；semantic SVG 只作为 streaming overlay。
- [MCP 2026 App 开发经验](./MCP_2026_APP_DEVELOPMENT_LESSONS.md)第 7 节仍写着
  “conversation inline 使用紧凑静态 SVG”。

本轮冻结 P0-B 的最新决策：

> conversation inline、历史 Review 和 App Board tile 使用真实 tldraw 引擎的只读模式；
> 允许 camera zoom/pan，禁止任何文档 mutation。Edit/fullscreen 使用同一引擎开启写权限。
> semantic SVG 只允许出现在权威状态到达前的 streaming overlay。

开发完成后必须同步更新冲突文档，不允许测试继续验证旧的静态 SVG 架构。

## 3. Definition of Done

只有以下条件全部满足，本轮才能从 No-Go 改为可进入发布候选：

1. 权威 inline surface 有稳定、可访问、可自动验证的身份，不依赖 streaming-only DOM。
2. inline、Review、App Board tile 均使用真实 tldraw renderer，且 zoom/pan 可用。
3. inline/Review/App Board 的 mutation 在编辑器层和 AppBridge 层同时 fail-closed。
4. inline → Edit → Save → Done 始终保持同一 authority、canvas ID 与正确 revision。
5. 浏览器验收同时验证权威状态、真实可见内容、正确身份、只读权限和无 fallback；不能只
   检查 iframe 或 `.tl-canvas` 是否存在。
6. `semanticElementCount` 不再由默认常数伪造证据。
7. self-contained browser E2E 完整执行到 Save、Export、history、Pin、App Board，报告
   `ok:true`，后续 checkpoint 不得 `not-run`。
8. tldraw MCP App 有固定 Git commit；源码、`dist/app.html`、`dist/server.mjs`、lock 与
   DMG 中资源可追溯到同一候选。
9. Electron computer-use 完成 25 个产品用例与 3 个审计用例。
10. 主报告、开发经验、验收报告使用一致状态口径；fallback、空白 iframe 和旧截图不计通过。

## 4. 冻结的 Surface Contract V1

### 4.1 为什么需要独立 surface contract

`editorReady`、`authoritativeReady`、`mutationAuthority` 与 `displayMode` 是四个不同概念：

- renderer ready 不等于用户有写权限；
- AppBridge initialized 不等于权威 canvas 已经绘制；
- inline 使用真实 editor，不应永远报告 `editorStatus=loading`；
- `.tl-canvas` 存在不等于内部有可见内容。

因此不能继续复用一个模糊布尔值作为全部成功条件。

### 4.2 推荐 DOM 诊断契约

在 `.acceptance-shell` 或其稳定宿主上提供以下只读诊断属性。命名可按现有风格调整，
但语义必须完整且写入测试：

```text
data-surface-contract="tldraw-authoritative-v1"
data-surface-role="preview|editor|review|workbench"
data-display-mode="inline|fullscreen|workbench"
data-authority-state="loading|streaming|authoritative|error"
data-renderer="tldraw"
data-render-ready="true|false"
data-mutation-authority="none|current-revision"
data-canvas-id="<stable canvas id>"
data-revision="<positive integer>"
data-render-instance="<ephemeral instance id>"
aria-label="tldraw canvas <canvas id>, revision <n>, read-only preview"
```

约束：

- `data-authority-state=authoritative` 只能在相同 authority/canvas 的服务端状态已被接受后设置。
- `data-render-ready=true` 只能在真实 `<Tldraw>` 已挂载、`.tl-canvas` 有正尺寸且权威
  snapshot 已应用后设置。
- `data-mutation-authority=none` 不代表 renderer 未就绪；inline 正常状态应是
  `render-ready=true + mutation-authority=none`。
- `data-render-instance` 只用于诊断模式切换是否发生非预期 remount，不写入 revision、
  ToolPart 或持久化业务状态。
- `canvasId` 可以显示，但不得把 snapshot、凭据或敏感业务内容写入 DOM 属性或日志。

### 4.3 权威 first-paint 判定

TL-01 通过必须同时具备：

1. `authority-state=authoritative`；
2. canvas ID、revision 与模型 ToolPart 完全一致；
3. renderer 为 `tldraw` 且 render-ready 为 true；
4. shell 与 `.tl-canvas` 均有正尺寸并处于可见区域；
5. 预期的语义节点文字或 shape 内容在真实 renderer 中可见；
6. 页面无 fallback、Original Tool Output 替代、console/page/runtime error；
7. 截图中存在非背景画布内容。

不能采用以下宽松条件：

- 只看到 iframe；
- 只看到 `.tl-canvas`；
- 只看到 canvas ID 文本；
- 只收到 Tool 200；
- 只看到 streaming overlay；
- Retry 后偶然出现但没有解释前一状态。

## 5. 分仓库修改任务

### WP-0：冻结修复基线与仓库身份

**负责仓库**：三个仓库，仅做只读冻结；tldraw 在代码修复完成后建立首个 commit。

实施：

1. 记录 OpenChamber/OpenCode 当前 commit、tracked diff hash 和 CLI lock hash。
2. 为 tldraw 源码生成排除 `.git`、`node_modules`、临时 runtime 的 source manifest，记录文件哈希。
3. 不清理、不 reset、不覆盖现有用户改动。
4. 开发提交按仓库分开：tldraw 产品修复、OpenChamber 验收修复、文档状态更新不能混成
   一个不可审查提交。

交付物：`candidate-before.json`、三个仓库状态摘要、源文件 manifest。

通过条件：任何开发者都能重建同一修复前基线，且没有把临时输出当源码。

### WP-1：修复 tldraw 权威 inline surface

**负责仓库**：`tldraw-mcp-app`  
**主要文件**：`src/app.tsx`、`test/app.behavior.test.mjs`、`test/app.parity.test.mjs`

#### 5.1.1 分离 render readiness 与 mutation authority

1. 不再在 inline 下无条件输出 `data-editor-status=loading`。
2. 将当前 `editorReady` 探针推广为 render readiness：onMount、权威 snapshot 应用、
   `.tl-canvas` 正尺寸三项都满足后，inline 与 fullscreen 均可进入 ready。
3. mutation 权限继续由 `MutationAuthority` 独立管理：
   - inline：`none`；
   - historical Review：`none`；
   - App Board tile：`none`；
   - fullscreen current revision：`current-revision`。
4. editor 未就绪时，依赖 editor 的动作必须 disabled；程序调用不得静默 return。

#### 5.1.2 为稳态真实 renderer 增加 Surface Contract V1

1. streaming overlay 继续保留，但明确标记为 `authority-state=streaming`。
2. overlay 撤下后，稳态 `<Tldraw hideUi={inline}>` 所在 shell 必须提供 §4 的 contract。
3. aria-label 必须描述当前 canvas、revision 和 read-only/editor 模式；不再依赖
   `.preview-stage` 才获得可访问名称。
4. 权威 state 切换、历史 revision 切换、canvas identity 切换时先回到 loading，完成后再
   原子进入 authoritative/ready，避免短暂把旧画布标成新 revision。
5. 错误状态不得保留上一个 canvas 的 authoritative marker。

#### 5.1.3 保持单渲染引擎和 camera 契约

1. 不新增第二个稳态 renderer，不把 `InlineCanvasPreview` 恢复为最终页面。
2. inline → Edit 比较 `data-render-instance`；正常模式切换不得重建 editor/store。
3. zoom/pan 只改变 camera session，不改变 document hash、dirty 或 revision。
4. Save payload 继续清除 camera/selection，但保留 current page identity。
5. Done 返回 inline 后沿用已保存的 canvas/revision；未保存变更仍走现有确认/阻止流程。

#### 5.1.4 只读必须双重封锁

自动覆盖以下输入：

- 拖动 shape；
- Delete/Backspace；
- 双击编辑文字；
- paste/drop；
- cut；
- AppBridge apply/save/restore；
- 多实例情况下从另一个可编辑实例借用 action wrapper。

通过标准：输入后 document hash、revision、dirty 和服务端写调用计数均不变化；camera
zoom/pan 仍然变化。不能只检查按钮隐藏。

#### 5.1.5 tldraw 聚焦测试

必须新增或修改：

- 稳态 authoritative inline contract 测试；
- streaming → authoritative 状态转换测试；
- inline ready 与 mutation authority 独立测试；
- inline → fullscreen → inline 的 render instance/canvas/revision 连续性测试；
- historical/workbench contract 测试；
- 两个同时挂载实例的 mutation authority 隔离测试；
- 错误/切换 identity 时 marker 清除测试。

源码 regex/parity 测试只能作为结构护栏，不能代替真实浏览器行为测试。

### WP-2：修复 OpenChamber 自包含浏览器验收器

**负责仓库**：`openchamber`  
**主要文件**：`scripts/verify-tldraw-mcp-app-browser.mjs`，必要时新增聚焦测试文件

#### 5.2.1 停止依赖 streaming-only `.preview-stage`

1. 新建单一 `readTldrawSurfaceState()` 或等价 helper，从 Surface Contract V1 读取状态。
2. `.preview-stage` 只用于记录 streaming milestone，不再作为 authoritative inline 成功条件。
3. inline checkpoint 等待 §4.3 的复合条件，而不是 `revision && previewLabel`。
4. historical Review、Done 后 inline、session recovery 和 App Board 中现有的
   `previewLabel` 条件全部迁移到同一 helper，防止修完第一个 checkpoint 后在后面再次超时。

需要检查的现有位置至少包括：

- `Inline preview in conversation`；
- historical revision Review；
- Done 返回 inline；
- history/session recovery；
- Pin 与 App Board fullscreen。

#### 5.2.2 保留严格性，禁止“为了变绿而放宽”

验收器必须拒绝：

- contract 缺字段或值未知；
- canvas/revision 不匹配；
- `render-ready=false`；
- shell 或 `.tl-canvas` 为零尺寸、不可见、被裁剪；
- inline mutation authority 不是 `none`；
- fullscreen current revision 没有 `current-revision` authority；
- expected semantic labels 不可见；
- fallback、blank、console/page/runtime error。

`containsCanvas` 可以保留为辅助诊断，不能单独决定 pass。

#### 5.2.3 失败证据必须可诊断

任何 wait 超时前保存：

- 最后一次完整 surface state；
- 顶层与 iframe 截图；
- canvas/revision/authority/render-ready/rect；
- 最近 AppBridge tool-call；
- console、page、runtime、HTTP 错误摘要；
- 当前 display mode 和 HostContext 尺寸。

即使失败也把截图和结构化状态写入本次 run 目录，不能像上一轮一样只有空 screenshots 数组。

#### 5.2.4 为验收 helper 添加负向测试

至少覆盖：

1. 只有 streaming overlay；
2. 有 `.tl-canvas` 但无 contract；
3. identity 正确但零尺寸；
4. revision 错误；
5. inline 错误获得 mutation authority；
6. surface ready 但无预期可见内容；
7. 正确 authoritative inline；
8. 正确 fullscreen editor；
9. 正确 historical/workbench read-only surface。

建议把 predicate 抽成可导入的纯函数/小模块，避免只能通过运行完整 2 分钟 E2E 测试判断。

### WP-3：消除 semantic create 假阳性

**负责仓库**：优先 `openchamber` 验收脚本；若协议明确要求字段，则同步修复
`tldraw-mcp-app` Tool output。

当前错误写法：

```js
assert((result.structuredContent.semanticElementCount ?? 7) >= 7)
```

修改原则：

1. 先确认 `tldraw_create_view` 的 output schema 是否承诺 `semanticElementCount`。
2. 若承诺：Server 必须返回非负整数；验收器严格断言 `Number.isInteger(value)` 且满足数量。
3. 若不承诺：从 structured semantic document 或紧接着读取的权威 canvas state 计算实际元素数。
4. 不能使用常数、prompt 期望值或默认值替代服务端事实。
5. 记录“模型请求元素数、Tool 返回元素数、权威 state 元素数”三者，出现差异直接失败。

回归：缺字段、字符串、NaN、负数、数量不足均必须 fail。

### WP-4：Excalidraw 只做证据驱动的回归

**负责仓库**：首先只运行 OpenChamber/官方 Excalidraw；未获得失败证据前不修改产品。

上一轮 Electron EX-01~07 因 tldraw 前置门禁失败而未执行。不能从“未执行”推断
Excalidraw 已通过或仍有缺陷。

自包含 tldraw 产品链通过后，按顺序执行：

1. 官方 `create_view` 首屏有真实图形；
2. 正常依赖加载；
3. 依赖阻断 10 秒内明确报错；
4. CSP metadata 缺失 fail-closed；
5. AppBridge 不初始化超时；
6. initialized 但空白显示 `ready_but_blank`；
7. 客户端重启后历史 ToolPart/resource 重新绑定并渲染。

只有某一用例产生新的日志、状态机或截图证据时，才创建对应 OpenChamber 修复任务；禁止
为了“顺手稳定”同时重构 `McpAppRenderer.tsx`。

### WP-5：revision、quota 与多实例回归

**负责仓库**：`tldraw-mcp-app` 测试与真实产品验收；没有证据不改 store/server。

#### 5.5.1 Revision

- Review r1 显示准确历史标签，renderer 只读且可 zoom/pan；
- Restore r1 创建新 revision，不修改旧 r1，不倒退 revision；
- latest、historical、restored provenance 清晰；
- 切换 revision 不改变 canvas identity；
- App Board/historical Session 重新加载后读取相同 authority/canvas。

#### 5.5.2 Quota

- 达到 active limit 返回结构化计数和明确可执行建议；
- 不擅自复用、覆盖或归档另一 canvas；
- archive 后事务完成即可创建；
- lost response + 相同 idempotency key 只创建一次；
- 并发创建不突破 limit；
- teardown 只处理测试 canvas；
- generation stale 时拒绝写入或安全 reload。

#### 5.5.3 多实例 authority

同时挂载：

1. conversation inline；
2. fullscreen editor；
3. App Board tile；
4. historical Review。

只允许 fullscreen current revision 具有写权限。关闭/切换/重挂载任一实例后，权限不能泄漏
到其他 Editor。该用例是 AU-02 的正式证据。

### WP-6：建立可发布 provenance

**负责仓库**：`tldraw-mcp-app`、`openchamber` release/packaging 流程。

#### 5.6.1 tldraw 仓库

当前仓库没有 Git HEAD，全部文件为 untracked。开发完成后必须：

1. 审查 `.gitignore`，排除 runtime、日志、下载、临时 store、`node_modules` 等；
2. 明确哪些 `dist`/provenance 产物按项目约定提交或只作为 release artifact；
3. 创建可审查首个 commit；
4. 固定 tldraw upstream tag/commit、patch hashes 和依赖 lock；
5. `verify` 报告记录 source commit、App/Server SHA256。

#### 5.6.2 OpenChamber 候选

1. 从固定 tldraw commit 重建 `dist/app.html`、`dist/server.mjs`；
2. 写入 OpenChamber 使用的 resource/provenance lock；
3. 从固定 OpenChamber/OpenCode/tldraw commits 构建 DMG；
4. 解包 DMG，重新计算内置 CLI、App resource 与 lock 的 SHA256；
5. 任何哈希或版本不一致即 AU-03 失败。

不能用文件修改时间、开发目录当前内容或“刚刚构建过”代替 provenance。

### WP-7：同步文档与状态报告

**负责仓库**：`openchamber/docs`。

完成代码与测试后更新：

1. `MCP_APPS_STABILIZATION_MASTER_REPORT.md`：在新一轮通过前保持 No-Go；纠正
   “自动化全部通过”和“23 项”口径，编号实际为 25 项。
2. `MCP_2026_APP_DEVELOPMENT_LESSONS.md` 第 7 节：将静态 SVG 稳态预览更新为真实
   tldraw read-only renderer；semantic SVG 仅是 streaming overlay。
3. `P0B_TLDRAW_SINGLE_RENDER_ENGINE_PLAN.md`：补充 Surface Contract V1 与真实浏览器结果。
4. 新一轮 acceptance report：保留旧失败，不覆盖 `2026-08-03-acceptance-01`。

状态只能使用：代码完成、聚焦测试通过、自包含浏览器通过、Electron computer-use 通过、
用户确认。不得把这些阶段合并成一个“已完成”。

## 6. 推荐实施顺序与提交边界

| 顺序 | 工作包 | 前置 | 建议提交边界 |
|---|---|---|---|
| 1 | WP-0 基线冻结 | 无 | 只生成候选记录，不改产品 |
| 2 | WP-1 Surface Contract/inline 修复 | WP-0 | tldraw 产品提交 |
| 3 | WP-3 semantic count | WP-1 schema 决策 | tldraw schema 或 OpenChamber verifier 独立提交 |
| 4 | WP-2 浏览器验收器 | WP-1 contract 固定 | OpenChamber 测试设施提交 |
| 5 | 聚焦测试与自包含 E2E | WP-1~3 | 不夹带新功能 |
| 6 | WP-4/5 产品回归 | E2E 通过 | 只修有证据的缺陷 |
| 7 | WP-6 provenance/DMG | 所有自动化通过 | release/lock 提交 |
| 8 | Electron computer-use | 同源 DMG | 新 run ID 的正式证据 |
| 9 | WP-7 文档 | 结果稳定 | 状态与证据提交 |

不要让两个 Agent 同时编辑 `tldraw-mcp-app/src/app.tsx` 或
`verify-tldraw-mcp-app-browser.mjs`。如果并行工作，按仓库/文件所有权拆分，并在交接前同步
contract 版本。

## 7. 分阶段测试门禁

### Gate A：tldraw 聚焦验证

在 `tldraw-mcp-app` 串行运行：

```bash
npm test
npm run build:server
npm run verify
npm run accept
npm run test:restart-persistence
```

另外启动独立 loopback Server，运行 `npm run probe`。源代码变化时遵循仓库规则；除非
upstream source/patch 确实变化，不要无故执行重量级 `bootstrap:app`。

通过条件：所有命令 exit 0；新增 Surface Contract、read-only、多实例、semantic count
负向测试实际被执行。

### Gate B：OpenChamber/OpenCode 回归

```bash
# OpenChamber
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui
bun run --cwd packages/ui type-check

# OpenCode Fork
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/app.test.ts test/mcp/session-tools.test.ts test/server/httpapi-mcp.test.ts
bun test test/mcp/lifecycle.test.ts
```

通过条件：无失败；OpenCode 如果未修改，仍保留该回归以证明协议/绑定没有退化。

### Gate C：自包含真实浏览器产品链

```bash
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun run test:tldraw-mcp-app-browser:self-contained
```

必须满足：

- report `ok:true`；
- Agent semantic create 数量有真实证据；
- authoritative inline 首屏通过；
- inline zoom/pan、mutation 拒绝通过；
- Edit/add/move/rename/connect/Save 通过；
- SVG/PNG export 和下载证据通过；
- Done、history/session recovery 通过；
- Pin、App Board fullscreen 通过；
- 无 console/page/runtime error、HTTP 4xx/5xx、fallback；
- 失败截图机制本身有负向测试。

任一 checkpoint fail 或 not-run，停止 DMG/Electron 阶段。

### Gate D：同源 DMG

1. 固定三仓 commit 与 dist hashes；
2. 构建 DMG；
3. 解包核对 lock、CLI、SDK、App HTML/server hash；
4. 生成 AU-03 JSON。

候选 DMG 不得来自脏工作区无法解释的文件组合。

### Gate E：Electron computer-use 25+3

使用 [Computer-Use 产品验收计划](./MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md)
完整执行：

- EX-01~07：7 项；
- TL-01~07：7 项；
- RV-01~05：5 项；
- QT-01~06：6 项；
- AU-01~03：3 项。

总计 **25 个产品用例 + 3 个审计用例**。

必须使用真实安装后的 Electron 客户端，不能用 Web E2E、旧截图或开发者自然语言说明替代。

## 8. Electron computer-use 的关键操作证据

### 8.1 TL-01~07

- inline 与 Edit 各截图一次，相同 shape/font/arrow/asset；
- inline zoom/pan 前后 camera 变化、revision 不变；
- Delete/drag/text/paste 后 document hash 与 revision 不变；
- inline → Edit 比较 authority/canvas/revision/render instance/camera；
- 保存只递增一次 revision，Done 返回相同 canvas；
- App Board tile 只读缩放，fullscreen 宽高填满宿主内容区；
- 100+ shape 无丢失、无 renderer fallback。

### 8.2 Revision/Quota

- r1 Review、latest、Restore 新 revision 截图与服务端列表；
- 配额错误必须含 limit/active/archived/retry guidance；
- archive 后立即创建；
- 并发/idempotency/generation 使用服务端审计 receipt 证明。

### 8.3 Excalidraw

- 首屏真实图形；
- Open/Edit 操作有可见结果；
- 依赖/CSP/blank/初始化超时显示稳定错误码；
- 重启后历史恢复。

### 8.4 App Board 与多实例

- 同一 canvas 重复 Pin 聚焦既有 tile；
- 不同 authority 下同名 canvas 不合并；
- 多实例只有一个写 authority；
- fullscreen 退出恢复 inline controls；
- Settings/顶层 dialog 不被 iframe 覆盖。

## 9. 正式证据目录

新一轮使用新 run ID：

```text
docs/release-evidence/mcp-apps-stabilization/<new-run-id>/
  run.json
  summary.md
  candidate-before.json
  candidate-after.json
  cases/
    EX-01.json ... EX-07.json
    TL-01.json ... TL-07.json
    RV-01.json ... RV-05.json
    QT-01.json ... QT-06.json
    AU-01.json ... AU-03.json
  screenshots/
  videos/
  downloads/
  logs/
  hashes/
  secret-scan.json
```

每个 case 明确记录 pass/fail/blocked/not-run、操作、期望、实际、ToolPart binding、canvas、
revision、截图/视频、是否出现 fallback/Retry/blank。失败证据不能留在易清理 `.tmp` 后只在
报告中写一句路径。

## 10. 安全与资源约束

1. 所有测试串行运行，只启动一个浏览器/客户端实例；禁止并行重量构建，避免再次占满内存。
2. Provider auth 只通过隔离进程环境注入，不复制进 evidence。
3. 日志、DOM、ToolPart、截图、下载和 routing report 扫描 canary token。
4. inline read-only 必须由核心 mutation gate 保证，不是只隐藏 UI。
5. 不放宽 iframe sandbox、CSP、navigation、download 或 AppBridge 五重绑定来解决首屏问题。
6. 不修改 OpenCode 数据库 schema；不使用清空历史数据作为修复手段。
7. 记录 1、4、10 个同时可见 tldraw surface 的内存与交互情况；若出现持续增长、冻结或
   关闭后仍明显不释放，作为 P1 性能缺陷记录，不在本轮偷偷切回静态 renderer。

## 11. 风险与回退

| 风险 | 等级 | 处理 |
|---|---:|---|
| 只改验收器导致空画布也通过 | P0 | 使用复合条件、真实文字/shape 与截图证据 |
| 只加 DOM 属性但实际 renderer 未就绪 | P0 | contract 只能由 editor probe + 权威 state 共同驱动 |
| inline editor 获得写权限 | P0 | readonly + mutation authority 双 gate + 多实例测试 |
| 模式切换重建 editor，camera/draft 丢失 | P0 | render instance 连续性与 TL-04/05 |
| 继续依赖 `semanticElementCount ?? 7` | P1 | 负向测试禁止缺失/非法值 |
| tldraw 无 commit 导致 DMG 不可重现 | P1/release blocker | Gate D 前必须固定 commit 与 hashes |
| 同时重构 Excalidraw/Host 扩大回归面 | P1 | WP-4 证据驱动，未失败不改 |
| 多个真实 editor 增加内存 | P1 | 串行采样、生命周期检查；不以旧 SVG 架构掩盖 |

回退原则：

- 可以回退某个候选提交；
- 不允许以恢复静态 SVG 稳态预览作为默认回退，因为它违反冻结的单引擎契约；
- 不允许放宽 AppBridge、CSP、sandbox 或 resource identity；
- 回退后重新跑受影响 Gate，不能沿用回退前通过报告。

## 12. 工期与交接标准

参考估算：

| 阶段 | 估算 |
|---|---:|
| WP-0/1：contract 与 tldraw inline 修复 | 1~1.5 人日 |
| WP-2/3：验收器与 semantic count | 0.5~1 人日 |
| 聚焦测试 + self-contained 全链路 | 0.5~1 人日 |
| Excalidraw/revision/quota 回归及必要修补 | 1~2 人日，取决于真实失败 |
| provenance、DMG、Electron 25+3 | 1~1.5 人日 |

开发 Agent 交回验收时必须提供：

1. 分仓 commit/hash 清单；
2. 文件级变更摘要及 contract 版本；
3. 所有 Gate A~D 的命令、退出码和报告路径；
4. self-contained `ok:true` 报告与失败证据机制截图；
5. 新 DMG 路径和 SHA256；
6. 尚未运行或受阻项的明确列表。

仅提供“205 tests passed”“页面能打开”或开发者截图，不足以进入独立 Electron 验收。
