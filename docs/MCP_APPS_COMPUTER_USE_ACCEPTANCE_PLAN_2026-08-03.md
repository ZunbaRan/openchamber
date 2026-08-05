# MCP Apps Computer-Use 产品验收计划

> 日期：2026-08-03  
> 输入基线：`MCP_APPS_STABILIZATION_MASTER_REPORT.md` §4.5  
> 验收对象：OpenChamber、内置 OpenCode Fork、官方 Excalidraw MCP App、本地独立 tldraw MCP 2026 App  
> 当前状态：自动化门禁已由开发者报告通过，真实客户端尚未验收  
> 目标结论：Go / Conditional Go / No-Go

## 1. 目标和边界

本轮不继续开发新功能，只验证以下问题是否在真实产品路径中解决：

1. Excalidraw 能正常绘制；失败时不再无诊断空白。
2. tldraw inline、Edit、Review 和 App Board 使用一致的真实渲染结果。
3. inline/历史预览只读，但 zoom/pan 可用。
4. 多个 tldraw 实例同时存在时，写权限不会相互污染。
5. revision、restore、quota、历史 Session 和 App resource 绑定符合约定。
6. 安装后的 DMG 与本次验收源码、OpenCode Fork、App resource 一致。

Computer-use 必须操作真实安装后的 OpenChamber Electron 客户端。现有 Web E2E 是前置门禁，不可替代 Electron 验收。

## 2. 用例数量口径

主报告和稳定化计划称“23 项”，但当前编号实际为：

- EX-01~07：7 项。
- TL-01~07：7 项。
- RV-01~05：5 项。
- QT-01~06：6 项。

总计 **25 项**。本轮按 25 项执行，不遗漏任何已有编号。主报告应在验收后把“23 项”修正为“25 项”，或者明确指出哪些用例不属于发布门禁。

另外增加 3 个审计回归用例：

- AU-01：双因子 first-paint 负向验证。
- AU-02：多实例 mutation authority 隔离。
- AU-03：DMG/CLI/App resource 一致性。

最终矩阵为 **25 个产品用例 + 3 个审计回归用例**。

## 3. 验收原则

1. 只看到 iframe、Tool 成功文本或 Original Tool Output 不算通过。
2. 模型的自然语言说明不算证据，必须检查真实 ToolPart、MCP App UI 和服务端状态。
3. Retry 后偶然成功但没有明确瞬态原因，不算通过。
4. HTML Artifact、Interactive UI 或 Excalidraw/tldraw 相互 fallback，不算目标用例通过。
5. 每次开发修复都必须创建新 run ID，从头执行受影响阶段；禁止覆盖旧失败证据。
6. 所有测试串行执行，只启动一个浏览器/客户端实例，避免再次占满内存。
7. Computer-use 期间不直接修改源码；发现问题只记录，交给开发 Agent 修复。
8. 不在报告、截图、Tool Output、HAR 或日志中保存 Provider token、长期业务 token。

## 4. 环境和证据准备

### 4.1 固定候选版本

开始前记录：

- OpenChamber commit、工作区 diff hash。
- OpenCode Fork commit、版本、SDK 版本。
- `opencode-cli.lock.json` 内容与 SHA256。
- tldraw MCP App commit、版本、`dist/app.html` 和 `dist/server.mjs` SHA256。
- DMG 文件名、版本和 SHA256。
- macOS 架构、版本、模型和 Provider 名称。

未提交工作区可以用于开发验收，但不得发布；最终 DMG 验收必须能回溯到固定 commit。

### 4.2 测试配置

准备两套隔离 profile：

1. **Clean profile**：无历史 Session、无旧 tldraw canvas、无旧 App Board tile。
2. **Historical profile**：包含本轮创建的有效 MCP App Session，用于重启恢复和升级验证。

测试 MCP：

- `interop-tldraw-2026`：独立本地 MCP 2026 Server，使用隔离 runtime 目录和固定 loopback 端口。
- `interop-excalidraw-official`：官方 Excalidraw MCP App。
- 负向 fixture 服务：分别提供 missing CSP、AppBridge 不初始化、AppBridge 初始化但不绘制、依赖被阻断页面。

模型默认使用 Qwen3.7 Plus。测试目标是证明中等成本模型能正确选择工具，不依赖特定 OpenAI Provider。

### 4.3 正式证据目录

禁止只把正式证据放在易清理的 `.tmp`。每轮创建：

```text
openchamber/docs/release-evidence/mcp-apps-stabilization/<run-id>/
  run.json
  summary.md
  cases/
    EX-01.json
    TL-01.json
    RV-01.json
    QT-01.json
    AU-01.json
  screenshots/
  videos/
  downloads/
  logs/
  hashes/
  secret-scan.json
```

每个 case 文件至少记录：

- 状态：pass/fail/blocked/not-run。
- 开始和结束时间。
- 前置状态。
- 操作步骤。
- 期望和实际结果。
- Tool 名称、session/message/part/server/resource identity。
- canvas ID、revision 前后值。
- 截图/视频文件名。
- 是否出现 `isError`、fallback、403、404、blank、Retry。

## 5. 第一道门禁：自动化与自包含浏览器 E2E

Computer-use 开始前顺序运行：

```bash
# OpenChamber
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui
bun run --cwd packages/ui type-check

# OpenCode Fork
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/app.test.ts test/mcp/session-tools.test.ts test/server/httpapi-mcp.test.ts
bun test test/mcp/lifecycle.test.ts

# tldraw MCP App
cd /Users/loloru/Documents/data/project/openChamber/tldraw-mcp-app
npm test
npm run build:server
npm run verify
npm run accept
npm run test:restart-persistence

# OpenChamber 自包含浏览器产品链
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun run test:tldraw-mcp-app-browser:self-contained
```

进入 computer-use 的条件：

- 所有命令退出码为 0。
- self-contained 报告 `ok: true`。
- multi-page rich-text、Save、Done、历史恢复、Pin、App Board 均已执行，不是 `not-run`。
- 浏览器 E2E 无 console error、无 `isError`、无 fallback。

历史开发报告中的 self-contained E2E 曾因 `Timed out waiting for tldraw rich-text editor` 失败。本轮必须用当前源码重新生成报告；旧报告不能作为通过证据。

若这一门禁失败，停止 Electron computer-use，直接把自动化失败报告交给开发 Agent。

## 6. 第二道门禁：Electron computer-use 冒烟

### 6.1 安装与连接

1. 关闭开发版 OpenChamber、Vite、旧 Electron 和旧 tldraw Server。
2. 安装当前候选 DMG。
3. 使用 Clean profile 启动。
4. 启动独立本地 tldraw MCP Server。
5. 在 Settings > MCP 验证：
   - server 为 Connected；
   - protocolVersion 为 `2026-07-28`；
   - era/adapter 为 2026；
   - Apps capability 已协商；
   - app-only tools 不在模型可见工具中。
6. 验证官方 Excalidraw Server 为 Connected。

任一连接未就绪，不继续创建业务 Session。

### 6.2 最小主链冒烟

先执行四条最小主链：

1. Excalidraw `create_view` 首屏非空。
2. tldraw `tldraw_create_view` 首屏非空。
3. tldraw Edit → 修改 → Save，仍是同一 canvas，revision 精确 `+1`。
4. Pin → App Board → fullscreen，页面完整且可恢复。

建议触发语句：

```text
请明确使用 interop-excalidraw-official 的 create_view，绘制一个 API Gateway → Order Service → Payment Service 的服务拓扑图，不要改用 HTML Artifact 或 Interactive UI。
```

```text
请明确使用 interop-tldraw-2026 的 tldraw_create_view 创建服务拓扑画布。包含 API Gateway、Order Service、Payment Service、Inventory Service 和 PostgreSQL，使用带文字的节点与绑定箭头，不要改用 Excalidraw、HTML Artifact 或旧 tldraw_open_canvas。
```

最小冒烟失败时，标记整轮 No-Go，但仍可继续执行互不依赖的诊断 fixture；不得继续发布流程。

## 7. Excalidraw P0：EX-01~07

### EX-01 官方 create_view

Computer-use 检查：

1. 模型选择官方 `create_view`。
2. ToolPart 完成且绑定 resource。
3. MCP App 外壳进入 ready。
4. 首屏出现真实图形，而不是空白、加载占位或 Tool Output。
5. 记录首屏截图和 resource identity。

### EX-02 正常远端依赖

1. 网络正常时加载官方 App。
2. 检查没有未声明 origin、CSP violation 或 console error。
3. 页面可缩放/滚动；若提供 Edit/Open 按钮，点击后行为可见。

### EX-03 依赖阻断

通过负向 fixture 或受控代理只阻断声明的远端依赖，不破坏 loopback MCP：

1. 在 10 秒内出现 `dependency-unreachable` 或 `dependency-blocked`。
2. 不能无限 loading 或保持黑屏。
3. Retry 可用，但网络仍阻断时不得伪装成功。

### EX-04 CSP 丢失

1. 加载不带 CSP metadata 的 fixture resource。
2. 必须 fail-closed 并显示 `csp-metadata-missing`。
3. 检查没有自动扩大为 `*`、`https://*` 或任意 origin。

### EX-05 AppBridge 不初始化

1. fixture 加载可见外壳但不初始化 AppBridge。
2. 在规定 deadline 后进入 `bridge-timeout`。
3. Retry 不得遗留旧 iframe authority。

### EX-06 AppBridge ready 但页面空白

这是 AUD-001 的核心 computer-use 用例：

1. fixture 主动发送合法 `size-changed(height≥24)`。
2. iframe 同时具有非零布局面积。
3. fixture 不插入任何有效可见内容。
4. 页面必须进入 `ready-but-blank`，不能仅因双因子尺寸信号变为 ready。

注意：§4.5 的“双因子”仍然都是布局类证据。如果当前实现只要求 `size-changed + layout-visible`，本用例很可能揭示仍然存在的假阳性。通过标准必须是实际内容证据，而不是两个尺寸信号同时成立。

### EX-07 历史任务恢复

1. 创建一个成功的 Excalidraw Session。
2. 记录 session/message/part/resource。
3. 完全退出 OpenChamber。
4. 重启 MCP Server 或重新连接官方 Server。
5. 重启 OpenChamber，打开原 Session。
6. resource 重新加载、页面非空、无 403/404/binding error。

## 8. tldraw P0：TL-01~07

### TL-01 inline 与 Edit 一致

1. 创建包含不同 shape、arrow、字体、颜色和分组的画布。
2. 保存 inline 截图。
3. 点击 Edit，等待 `data-editor-ready=true`。
4. 在相同 camera 下截图。
5. 对比文字、节点、箭头、圆角、asset 和层级；不能出现 semantic SVG 近似图。

### TL-02 inline zoom/pan 不产生 revision

1. 调用 `tldraw_list_canvas_revisions` 记录 revision。
2. 在 inline 中滚轮缩放、拖动平移。
3. 再次读取 revision。
4. revision、document hash 不变；camera 可以变化。

### TL-03 inline mutation 全拒绝

Computer-use 逐项尝试：

- 拖动已有 shape。
- Delete/Backspace。
- Cut/Paste/Duplicate。
- Undo/Redo。
- 输入文字。
- 菜单或快捷键 mutation action。

画布内容、revision 和 Save 请求数必须全部不变。

### TL-04 inline → Edit

1. 在 inline 调整 camera。
2. 点击 Edit。
3. canvas ID、revision、document、camera 连续。
4. Edit 中能正常修改并保存。

### TL-05 Edit → inline

1. 在 Edit 中产生未保存修改。
2. 点击 Done/返回 inline。
3. 必须出现明确确认，不得静默丢失或自动覆盖。
4. 保存路径：同 canvas、revision `+1`、inline 显示新内容。
5. 放弃路径：revision 和服务端内容不变。

### TL-06 App Board

1. 将当前 App Pin 到 Applications。
2. tile 内 zoom/pan 可用，document 只读。
3. 点击 fullscreen，容器达到全宽/全高阈值，不得只占半屏。
4. 退出 fullscreen 后 tile 和 camera 可恢复。

### TL-07 大画布

1. 使用 `tldraw_create_view` 或 `tldraw_patch_shapes` 生成 100+ shapes。
2. inline、Edit、App Board 三处均可 zoom-to-fit 和浏览。
3. shape 数、文字、箭头和 asset 不丢失。
4. 记录初次 ready 时间和交互卡顿情况。

## 9. 审计多实例回归：AU-02

保持同一画布同时存在于：

- 聊天 inline。
- App Board tile。
- fullscreen/Edit 或 historical Review。

按两种挂载顺序分别验证：

1. 先 inline，后 Edit。
2. 先 App Board，后打开历史 Review，再打开 Edit。

通过标准：

- Edit 可以写，inline/tile/Review 不能写。
- inline/tile/Review 都可以 zoom/pan。
- 关闭最后打开的实例，不改变其他实例权限。
- 一个实例 Save 不会让另一个实例切换 canvas 或显示错误 dirty 状态。

## 10. Revision：RV-01~05

1. **RV-01**：选择 r1，内容和来源标签准确，不能标记为 latest。
2. **RV-02**：Review 只读，可缩放，不显示 Save。
3. **RV-03**：Restore r1 生成新 rN；旧 r1、旧 latest 和 hash 不变。
4. **RV-04**：协议 fixture/test-fixture 默认不出现在普通用户列表。
5. **RV-05**：保存迁移前后 canvas ID、revision、origin、hash 对照报告。

如果 App 端仍没有 `restored from rN`、`test-fixture`、`unknown-legacy` 等来源标签，应按用例失败记录，而不是以“服务端已有字段”判定通过。

## 11. Quota：QT-01~06

Quota 使用独立 runtime 和低限制服务，不污染主验收画布：

```bash
TLDRAW_MCP_MAX_ACTIVE_CANVASES=2 \
TLDRAW_MCP_RUNTIME_DIR=<isolated-path> \
npm run serve
```

### Computer-use 可见路径

- **QT-01**：创建 2 个画布，第 3 个返回结构化计数与建议；Agent 不得复用已有无关 canvas。
- **QT-02**：归档一个 ephemeral canvas 后立即创建成功，无需重启。
- **QT-03**：模拟 lost response 后用同一 idempotency key 重试，只产生一个 canvas。
- **QT-05**：测试结束后 fixture/临时 canvas 被归档或清理，用户画布不变。

### 协议辅助验收

QT-04 和 QT-06 不适合仅靠鼠标操作，必须结合协议脚本：

- **QT-04**：并发创建请求不超过 active limit，不发生目录覆盖。
- **QT-06**：注入 stale generation，服务拒绝写入或安全 reload，不能覆盖新状态。

Computer-use 负责观察用户可见错误与 Agent 行为，协议脚本负责证明原子性和 generation。

## 12. 历史恢复与 DMG 一致性

### 12.1 OpenChamber/OpenCode 重启

对 Excalidraw 和 tldraw 各保留一个成功 Session：

1. 退出 OpenChamber。
2. 停止再启动本地 tldraw MCP Server。
3. 启动 OpenChamber。
4. 打开原 Session 和原 App Board tile。
5. 检查 resource、Tool Result、revision、camera 和 AppBridge authority。
6. 任意 403、404、`resource not bound`、`canvas identity missing` 均为失败。

### 12.2 AU-03：候选产物一致性

检查：

- DMG 内置 `opencode` 版本等于 lock。
- 内置二进制 SHA256 等于 lock/release 记录。
- SDK 版本与 CLI 版本一致。
- tldraw resource URI、MIME、SHA256 与本轮 verify 输出一致。
- 当前客户端不使用开发目录中的外部 CLI 或旧 tldraw dist。
- OpenChamber 更新源仍指向 fork release，不访问官方 OpenCode updater。

任一不一致直接 No-Go，不继续发布。

## 13. 最小非目标回归

Host、CSP 和 Broker 修改可能影响其他扩展，因此最终补三条冒烟：

1. 一个 Legacy MCP Tool 正常调用。
2. 一个 Interactive UI/HTML Artifact 正常渲染。
3. 一个 Local 或 Hosted OCIX Surface 正常打开。

这三条不扩展成本轮新功能，只防止 MCP App 修复破坏现有主链。

## 14. 失败处理和停止条件

以下任一情况立即把发布判为 No-Go：

- Excalidraw/tldraw 出现无诊断空白。
- inline 或 historical Review 可以修改 document。
- 多实例权限受挂载顺序影响。
- Save 切换 canvas 或 revision 不精确 `+1`。
- 历史恢复出现 403/404/binding error。
- quota 错误诱导 Agent 复用无关 canvas。
- fixture revision 默认暴露。
- DMG/CLI/SDK/resource hash 不一致。
- fallback 被当作成功。

失败后：

1. 立即截图并保留视频最近 30 秒。
2. 记录 session/message/part/server/resource/canvas/revision，但不记录 token。
3. 导出脱敏 routing/runtime report。
4. 标记最小复现步骤。
5. 不在同一 run 中热修后继续；修复后新建 run ID。

## 15. 最终判定

### Go

- 25 个原始用例全部 pass。
- AU-01~03 全部 pass。
- 7 项发布门禁全部满足。
- self-contained Web E2E 与 Electron computer-use 均通过。
- 没有 P0/P1 未解决问题。

### Conditional Go

仅允许非发布阻塞的 P2 视觉问题，并且必须在报告中列出；不能用于规避 P1-D、历史恢复或产物一致性。

### No-Go

任一 P0/P1、发布门禁或产物一致性失败。

最终 `summary.md` 必须给出：

```text
Automated gate: PASS/FAIL
Self-contained browser E2E: PASS/FAIL
Electron computer-use: PASS/FAIL
Product cases: N/25
Audit regressions: N/3
Release gates: N/7
Decision: GO / CONDITIONAL GO / NO-GO
```

## 16. 执行顺序摘要

1. 固定 commit、lock、DMG 和 resource hash。
2. 顺序执行自动化门禁。
3. 重跑 self-contained browser E2E；失败则停止。
4. 安装 DMG，以 Clean profile 完成最小主链冒烟。
5. 执行 Excalidraw EX-01~06。
6. 执行 tldraw TL-01~07 和 AU-02。
7. 执行 RV-01~05。
8. 以独立低配额服务执行 QT-01~06。
9. 重启客户端和 MCP Server，执行 EX-07/历史恢复。
10. 验证 DMG/CLI/SDK/resource 一致性 AU-03。
11. 执行 Legacy MCP、Interactive UI/Artifact、OCIX 最小回归。
12. 完成 secret scan、证据索引和 Go/No-Go 判定。
