# tldraw MCP App 浏览器验收

这套验收用于证明 tldraw MCP App 的完整产品链路，而不只是证明 MCP 工具返回成功或 iframe 已经出现。测试会真实创建语义图、进入编辑器、修改并保存同一画布、导出文件、恢复历史会话，并把 App 固定到 Applications 看板后再次放大。

## 前置条件

1. OpenChamber Web 与配套 OpenCode fork 已启动，默认地址为 `http://127.0.0.1:5180`。
2. 独立 tldraw MCP Server 已配置为 `interop-tldraw-2026`，状态必须为 connected。
3. Server 必须协商 MCP `2026-07-28` 与 Apps capability，并提供现代工具：
   - 模型可见：`tldraw_create_view`、`tldraw_patch_shapes`。
   - 仅 App 可见：状态、历史、恢复、操作、保存、SVG/PNG 导出工具。
4. 配置的模型可用。默认使用 `alibaba-coding-plan-cn/qwen3.7-plus`，可通过环境变量覆盖。
5. 本机安装 Chrome 或 Chromium。

不要为了运行本测试读取 `/api/config/providers`。该接口可能含凭据，验收器明确禁止访问它，报告也不会记录 provider token。

## 运行

从 OpenChamber 仓库根目录执行：

```bash
bun run test:tldraw-mcp-app-browser
```

可选配置：

```bash
OPENCHAMBER_TLDRAW_ACCEPTANCE_BASE_URL=http://127.0.0.1:5180 \
OPENCHAMBER_TLDRAW_ACCEPTANCE_SERVER=interop-tldraw-2026 \
OPENCHAMBER_TLDRAW_ACCEPTANCE_MODEL=alibaba-coding-plan-cn/qwen3.7-plus \
bun run test:tldraw-mcp-app-browser
```

如浏览器不在标准位置，可设置 `OPENCHAMBER_TEST_CHROME=/absolute/path/to/chrome`。

定位失败现场时可临时设置 `OPENCHAMBER_TLDRAW_ACCEPTANCE_PRESERVE=1`。只有失败运行会保留测试 Session 和已创建的看板 tile；正常回归不要设置它。

## 验收内容

验收器按顺序执行，避免并行浏览器和构建任务导致内存峰值：

1. 查询 MCP 连接状态，严格检查 `protocolVersion`、`era`、adapter 和 Apps 协商结果。
2. 检查工具 registry，证明 app-only 工具没有进入模型可选工具集合。
3. 创建隔离 Session，让 Agent 明确调用 `tldraw_create_view`，使用语义协议 v2 的真实字段生成三个带文字的节点、两条绑定箭头和一个说明便签。绑定端点必须使用 `elementId`、`anchorX`、`anchorY`，connector `points` 必须是绝对画布坐标。
4. 读取真实 ToolPart，校验 canvas ID、revision 和 structured content。
5. 在对话流验证非空的轻量预览。
6. 点击 Edit 打开全屏编辑器；**必须等到 `.acceptance-shell[data-editor-ready="true"]`**，
   且 `.tl-canvas` 有正宽高、`+ Note` 可见未禁用并有真实 hit area。`data-editor-ready` /
   `data-editor-status`（`loading|rendering|ready|error`）是产品与自动化共用的稳定生命周期契约：
   React 外壳先出现、Tldraw `onMount` 尚未完成时 `editorReady` 必须为 `false`，相关按钮禁用。
   就绪后通过 AppBridge 添加便签，再用真实指针输入完成四类编辑：
   新建图形、移动既有图形、重命名既有图形、创建一条两端绑定到真实图形的 connector。
   验收器读取 Save 请求里的 semantic patch，不能只根据截图猜测编辑已发生。
7. Save 后必须仍是同一 canvas，且 revision 精确增加 1；Host 不得把 App 自己的
   `updateModelContext` 持久化结果再次作为 `ontoolresult` 回显。
8. 分别导出 SVG 和 PNG，经过宿主确认后检查真实文件字节、格式签名和尺寸；空文件或占位响应失败。
9. 点击 Done 回到非空预览，切换到旧 revision，再恢复最新 revision。
10. 刷新 OpenChamber 并重新打开 Session，验证历史恢复仍指向相同 canvas/revision。
11. Pin 到 Applications 看板，核对 tile origin 的 Session 身份，然后从 App Board 放大；宽高必须达到真正全屏阈值。

以下情况都不能算成功：

- 只看到 iframe、空白画布或 Original Tool Output。
- 任一模型 ToolPart 或 AppBridge Tool result 返回 `isError: true`。
- 响应提示 MCP App capability 未协商，或退化为 text / semanticDocument / structured canvas state fallback。
- Agent 改用 HTML Artifact、Excalidraw 或旧 `tldraw_open_canvas` 工具。
- Save 切换到新画布，或 revision 没有精确增加。
- Save 服务端成功后，UI 又被重复 Tool-result notification 改回 dirty/error。
- 导出按钮有响应但没有真实下载字节。
- app-only 工具出现在模型工具候选中。
- Pin 只创建卡片但无法在 App Board 恢复和放大。

## 证据与清理

每次运行写入独立目录：

```text
.tmp/tldraw-mcp-app-browser/<run-id>/
  report.json
  01-inline-preview.png
  02-fullscreen-saved.png
  03-history-recovered.png
  04-app-board-fullscreen.png
  downloads/
```

`report.json` 记录每个 checkpoint 的 pass/fail、耗时、canvas/revision、工具可见性、下载验证结果，以及所有已捕获 AppBridge 交换中的 `isError`/fallback 汇总。任一 `isError` 或 fallback 都会令最终报告 `ok: false`。失败也会落盘报告，便于区分产品缺陷和测试缺陷。

Save 失败时还会记录脱敏的 AppBridge 交换：session/message/server/resource 绑定、canvas ID、expected revision、idempotency key、semantic transaction，以及 snapshot 的字节数和 SHA256。snapshot 正文不会进入报告。

测试结束后会：

- 删除本次创建的 App Board tile；
- 归档本次创建的测试 Session；
- 关闭唯一的 headless Chrome；
- 删除临时 Chrome profile。

如果清理失败，报告会保留 `sessionId` 和 `createdTileId` 供人工处理。不会执行全局数据清理。

## 内存与运行纪律

- 浏览器只启动一个实例、一个业务页面。
- 所有阶段串行执行，不同时运行 Web 构建、Electron 打包或第二套 E2E。
- Chrome profile 使用临时目录，完成后删除。
- 单元契约测试先运行；只有通过后才启动真实浏览器。
- 若正在打包 DMG 或进行大型构建，先等待其完成再运行本验收。

## 桌面客户端边界

此脚本验证真实 OpenChamber Web host、OpenCode fork、MCP 2026 AppBridge 与 App Board 链路。Electron 打包版仍需补一轮最小人工冒烟：打开同一 Session、Edit、Save、导出、Pin、App Board 放大。桌面冒烟不能用来替代这套可重复自动验收，两者都通过才可宣布正式客户端完成。
