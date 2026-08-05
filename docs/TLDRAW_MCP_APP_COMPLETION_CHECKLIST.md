# OpenChamber × OpenCode Fork × tldraw MCP App 剩余工作与完成清单

> 状态日期：2026-08-03  
> 适用仓库：`openchamber`、`tldraw-mcp-app`、OpenCode fork  
> 结论：**尚未完成，不能发布。协议主链已经存在，当前阻塞集中在真实编辑器就绪、CSP/图标、当前代码回归验收和正式客户端证据。**

关联上下文：

- [MCP_APPS_OPENCODE_CLI_IMPLEMENTATION_PLAN.md](./MCP_APPS_OPENCODE_CLI_IMPLEMENTATION_PLAN.md)：OpenCode fork、MCP 双栈和 OpenChamber Host 的总体设计。
- [OPENCHAMBER_OPENCODE_MCP_OCIX_TEST_PLAN.md](./OPENCHAMBER_OPENCODE_MCP_OCIX_TEST_PLAN.md)：MCP Apps 与 Local/Hosted OCIX 的统一产品验收基线。
- [TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md](./TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md)：tldraw 真实浏览器自动化验收契约。
- [tldraw-mcp-app/docs/ACCEPTANCE.md](../../tldraw-mcp-app/docs/ACCEPTANCE.md)：独立 Server/App 自身的协议和功能验收。

## 0. 项目背景、定位与总体目标

### 0.1 OpenChamber 二开的整体背景

OpenChamber 是建立在 OpenCode CLI/server 之上的 Agent GUI。二开版本不仅要显示普通文本和 Tool output，还要把 Agent、第三方业务系统和富交互页面连接成完整产品链。

当前整体扩展体系包含两条并行路线：

1. **MCP Apps 标准路线**
   - 第三方 MCP Server 通过 Tool metadata 声明 `ui://` App resource。
   - OpenCode fork 负责协议协商、Tool/Resource、App-only Tool 和 Session 数据链。
   - OpenChamber 负责 sandbox Host、AppBridge、对话内渲染、全屏、下载和 App Board。
   - MCP App 保留标准来源标识，不转换成 OCIX。
2. **OCIX 自研扩展路线**
   - 支持 Local/Hosted OCIX、Interactive UI、HTML Artifact、Business Gateway、签名、Pin、联动和应用看板。
   - OCIX 可以承载企业业务模块，但不是 MCP Apps 的包装层。

两条路线允许能力重叠，但产品边界保持独立。tldraw MCP App 属于第一条路线；它不是 OCIX，也不是只为 OpenChamber 写死的内置页面。

### 0.2 为什么选择 tldraw 作为 MCP 2026 验收样板

Excalidraw MCP App 已经证明“Tool 生成图 + 对话内预览 + Edit”是可用的产品形态。tldraw 被选择为更严格的 MCP 2026 样板，是因为它同时覆盖：

- Agent 创建有语义的图形、文字、层级、绑定和连线。
- 对话内轻量只读预览与全屏完整编辑器两种模式。
- AppBridge 调用 App-only Tool，而不是让模型直接操作私有编辑器状态。
- revision fence、幂等、历史、冲突、进程重启和多 canvas 身份。
- SVG/PNG 真导出、图片资产、字体、图标、中文 locale 和离线运行。
- sandbox、CSP、下载确认、跨 Session/Resource 授权和 Host 生命周期。
- 从聊天 Pin 到 OpenChamber App Board，再次放大和恢复。

因此 tldraw 不是孤立 Demo。它是验证 OpenCode fork 与 OpenChamber 能否可靠承载复杂 MCP App 的参考实现；其经验应可以复用到未来其他 MCP App。

### 0.3 总体目标

本任务必须同时完成两个产品目标：

#### 目标 A：完成独立 tldraw MCP App

- `tldraw-mcp-app` 是独立仓库、独立进程、独立数据目录和独立发布物。
- 协议和资源不依赖 OpenChamber 私有实现；标准兼容客户端应能仅凭 URL 连接，并由独立协议客户端验收证明这一点。
- Server 不导入 OpenChamber/OpenCode 源码，也不依赖 OpenChamber 仓库启动。
- 体验至少达到 Excalidraw MCP App 的核心可用水平：可靠预览、明确 Edit 入口、完整编辑、保存、导出和恢复。

#### 目标 B：在 OpenChamber 二开版完成真实集成验收

- OpenCode fork 必须真正协商 MCP 2026/Apps、过滤 App-only Tool、读取 `ui://` resource 并代理严格绑定的调用。
- OpenChamber Web 必须通过生产 Broker/Loader/sandbox Host 渲染，而不是使用 fixture、伪造 ToolPart 或测试专用 iframe。
- OpenChamber Electron/DMG 必须在正式安装形态完成最小人工冒烟。
- 对话、全屏、下载、Session 恢复、Pin、App Board 和模态层级均要通过。
- tldraw 改动不能破坏 Excalidraw MCP App、Legacy MCP、OCIX、Interactive UI 或 HTML Artifact。

目标 A 通过但目标 B 失败，仍然不能宣布 OpenChamber 的 MCP App 能力完成；目标 B 用特殊 fixture 通过但独立 Server 不可运行，同样不能宣布 tldraw MCP App 完成。

### 0.4 三个仓库的职责

| 仓库 | 责任 | 本任务的交付物 |
|---|---|---|
| `tldraw-mcp-app` | 独立 MCP 2026 Server、App resource、编辑器、持久化和导出 | 可独立运行的服务、构建锁、测试、文档、可回滚版本 |
| OpenCode fork | MCP Legacy/2026 adapter、Apps capability、registry、resource、App-only proxy、ToolPart metadata | 与历史 Session 兼容的后端数据链和 API |
| `openchamber` | Web/Electron MCP App Host、Broker/Loader、AppBridge、下载、全屏、App Board | 自动化产品验收、桌面冒烟、回归证据 |

### 0.5 明确边界

本任务当前不包含：

- 公共 Marketplace。
- MCP 2026 OAuth 和组织级 RBAC/ABAC。
- 把 tldraw MCP App 转换成 OCIX。
- tldraw 的公网生产托管和商业授权决策。
- 为通过测试而加入测试专用后门、直接调用 App-only API 或忽略 CSP/console error。

### 0.6 双主线完成门禁

最终必须同时产生以下证据：

| 主线 | 必须通过的门禁 |
|---|---|
| 独立 tldraw | unit、build、hash/provenance verify、restart persistence、不经过 OpenChamber 的独立 protocol/App acceptance |
| OpenChamber Web | 真实模型选 Tool、真实 App resource、真实编辑/保存/导出/恢复、App Board、零 fallback/error |
| OpenChamber Electron | 安装版连接独立 Server，完成 Edit/Save/Export/Pin/Restart 人工冒烟 |
| 回归 | Excalidraw MCP App、Legacy MCP、Local/Hosted OCIX 和 HTML Artifact 核心路径未被破坏 |

本文后续所有“完成”均指以上双主线与回归门禁共同完成。

## 1. 为什么现在不能宣布完成

当前代码的最新完整浏览器运行失败：

- 证据：`.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-02T23-27-44-421Z/browser/report.json`
- 已通过：MCP 2026 协商、Tool 可见性、Agent 创建语义画布、对话内预览。
- 首个失败点：`Fullscreen Edit, app-only add, move, rename, connect, Save`。
- 直接错误：`Timed out waiting for app-only note revision`。
- 真实 App 状态停在：`Opening the full tldraw editor…`。
- AppBridge 交换中只有轮询状态调用，没有 `tldraw_apply_operations`，说明 `+ Note` 没有真正触发业务写入。
- 同一运行还捕获到 CSP 错误：tldraw 的 `data:image/svg+xml` 图标被 `default-src 'none'` 拦截。

曾经存在一轮全绿证据：

- 证据：`.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-02T21-19-45-205Z/browser/report.json`
- 当时 Edit、Add、Save、SVG/PNG、历史恢复和 App Board 全屏均通过。
- 之后 OpenChamber MCP App Host 改为更严格、真实的 Broker/Loader 生命周期，最新运行暴露了新的编辑器时序与 CSP 问题。
- 因此旧报告只能证明功能方向可行，**不能替代当前代码验收**。

## 2. 当前状态总览

| 能力 | 当前状态 | 证据/说明 |
|---|---|---|
| 独立 tldraw MCP Server | 基本完成 | 可独立启动；不依赖 OpenChamber 源码运行 |
| MCP Core `2026-07-28` | 已实现并通过当前协议检查 | 最新 E2E 的协议 checkpoint 通过 |
| MCP Apps 协商 | 已实现并通过当前协议检查 | client/server/negotiated 均为 `true` |
| 模型可见 Tool 与 App-only Tool 隔离 | 已实现并通过当前检查 | app-only Tool 未进入模型候选列表 |
| OpenCode fork MCP App 数据链 | 基本实现，待最终回归 | registry/resource/tool-call 在当前 E2E 前三关工作 |
| Agent 语义创建画布 | 已通过当前 E2E | Qwen3.7 Plus 选择 `tldraw_create_view`，无 fallback |
| 对话流只读预览 | 已通过当前 E2E | 能显示真实语义画布，不是空 iframe |
| 全屏真实编辑器 | **不稳定/未完成** | 最新运行过早进入交互，编辑器尚未完成 `onMount` |
| `+ Note` App-only 写入 | **当前失败** | 点击被静默吞掉，没有发出 `tldraw_apply_operations` |
| 用户移动、重命名、新建、连线 | 待当前代码复验 | 旧报告通过，最新运行未执行到 |
| Save 同画布、revision +1 | 待当前代码复验 | 旧报告通过，最新运行未执行到 |
| SVG/PNG 真下载 | 待当前代码复验 | 旧报告通过，最新运行未执行到 |
| 图标、字体、离线资源 | **存在当前缺陷** | 最新运行有 `data:image/svg+xml` CSP 错误 |
| 中英文 locale | 单元层面已有，产品层面待复验 | 当前完整 E2E 未走到 locale checkpoint |
| 历史恢复和重启恢复 | 服务端测试已有，当前产品链待复验 | 旧报告通过，最新运行未执行到 |
| App Board Pin 和真正全屏 | 待当前代码复验 | 旧报告通过，最新运行未执行到 |
| OpenChamber Host Broker/Loader 生命周期 | 代码与聚焦测试已完成 | 74 个相关测试通过，UI type-check 通过 |
| OpenChamber Web 完整产品验收 | **当前失败** | 最新 self-contained E2E 在全屏 App-only Add 阶段失败 |
| OpenChamber 既有扩展回归 | **未完成** | 需复验 Excalidraw、Legacy MCP、OCIX、HTML Artifact |
| Electron/DMG 人工验收 | **未完成** | 必须在 Web 全绿之后进行 |
| 独立仓库版本基线 | **未完成** | `tldraw-mcp-app` 的 `main` 还没有首个 commit |

## 3. 已经完成、不要重复实现的部分

### 3.1 协议和服务端

- MCP Core 版本固定为 `2026-07-28`。
- MCP Apps 稳定语义与 Core 版本分开管理。
- 每请求 capability、协议头和 server identity 校验已经实现。
- Legacy 初始化不会被伪装成 2026 成功。
- 已有推荐模型 Tool：
  - `tldraw_create_view`
  - `tldraw_patch_shapes`
- 已有兼容模型 Tool：
  - `tldraw_open_canvas`
  - `tldraw_patch_diagram`
- 已有 App-only Tool：
  - `tldraw_get_canvas_state`
  - `tldraw_list_canvas_revisions`
  - `tldraw_restore_canvas_revision`
  - `tldraw_apply_operations`
  - `tldraw_save_canvas`
  - `tldraw_export_snapshot`
- 已有 revision fence、幂等键、历史版本、恢复、归档、进程重启持久化等服务端逻辑和测试。

### 3.2 独立 App 构建

- tldraw 固定为 `v5.0.2`，上游 commit 和 archive SHA 已锁定。
- React、tldraw、图标、字体和 `en/zh-cn/zh-tw` 翻译资源均打进单一 App HTML。
- 已有 SVG/PNG opaque sandbox 兼容补丁和翻译离线补丁。
- `config/upstream-lock.json`、provenance 和最终 HTML 哈希互相校验。
- 之前的 standalone 全套测试为 189/189，通过过独立进程重启测试。

### 3.3 OpenChamber MCP App Host

- Host 不再用假 `ready` 绕过真实加载。
- 外层 Broker、内层 Loader、verified App `srcdoc` 转换已经按生产路径运行。
- teardown 会在移除 iframe 前等待 App 回复或超时。
- App Tool、下载和 model-context 更新绑定到具体生命周期 epoch。
- session、message、part、server、resource、toolKey 继续作为调用授权边界。

以上内容若测试再次失败，应先定位回归，不能另起一套平行实现。

## 4. P0：发布前必须完成

### P0-1 收敛当前未完成的浏览器验收补丁

- [x] 修复 `assessTldrawEditorReadiness` 对 `editorReady: false` 的判断。
  - 当前错误地同时返回 `app-declared-editor-not-ready` 和 `invalid-editor-ready-marker`。
  - 合法 marker 只能是 `true`、`false` 或未提供；`false` 不能被判为非法类型。
- [x] 运行：

  ```bash
  node --test scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs
  ```

- [x] 当前 14 个测试必须全部通过；目前真实状态是 13/14。
- [x] 检查中断的子任务没有留下重复 helper、未引用分支或放宽断言的代码。

涉及文件：

- `openchamber/scripts/lib/tldraw-mcp-app-browser-acceptance.mjs`
- `openchamber/scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs`
- `openchamber/scripts/verify-tldraw-mcp-app-browser.mjs`

### P0-2 给 App 增加“编辑器真实就绪”契约

根因是 React 已经渲染全屏外壳和按钮，但 `Tldraw.onMount` 尚未设置 `editorRef.current`。当前 `addNote` 遇到空 editor 会直接 `return`，用户和自动化都看不到失败原因。

- [x] 增加显式 `editorReady` 状态，初始为 `false`。
- [x] 进入 inline、切换 canvas identity、卸载编辑器或开始重新同步时重置为 `false`。
- [x] 只有在 `Tldraw.onMount` 完成、权威 canvas 已渲染、真实 `.tl-canvas` 有正尺寸后才设为 `true`。
- [x] 在 `.acceptance-shell` 暴露稳定契约：

  ```text
  data-editor-ready="true|false"
  data-editor-status="loading|rendering|ready|error"
  ```

- [x] `+ Note`、Save、SVG/PNG、需要 Editor 的页面操作在 `editorReady=false` 时禁用。
- [x] `addNote` 等函数即使被程序调用，也必须设置明确状态或抛出可诊断错误，不能静默 `return`。
- [x] ready 状态不能只依赖固定延时；应依赖 `onMount`、权威状态渲染完成和 DOM hit area。
- [x] 补单元测试：inline→fullscreen、canvas A→B、历史→latest、unmount/remount 均不能复用旧 ready。

涉及文件：

- `tldraw-mcp-app/src/app.tsx`
- 对应 `tldraw-mcp-app/test/*.test.mjs`

### P0-3 让浏览器 E2E 等待真实 ready，而不是等待外壳

- [x] 点击 Edit 后，同时等待：
  - Host effective mode 为 fullscreen；
  - `.acceptance-shell[data-editor-ready="true"]`；
  - `.tl-canvas` 有正宽高；
  - `+ Note` 可见、未禁用并有真实 hit area。
- [x] 若超时，在报告中记录 `data-editor-status`、按钮状态、canvas rect、App context ordinal。
- [x] 不能通过增加任意 sleep 或直接调用 App-only API 绕过真实用户点击。
- [x] 在隔离 profile 首次启动时关闭 “Add project directory / 添加项目目录 / 新增專案目錄” onboarding 浮窗，避免遮挡截图和点击。
- [x] onboarding 的处理必须只识别已知文案和对话框，不得误关普通项目页面。

### P0-4 修复图标 CSP 错误

最新运行捕获的真实错误：

```text
Loading the image 'data:image/svg+xml;...' violates
Content Security Policy directive: default-src 'none'.
```

- [x] 记录触发错误的具体 frame、document URL、effective CSP 和元素用途。
- [x] 确认最终 verified App 文档实际收到 `buildMcpAppDocumentPolicy` 生成的 `img-src ... data:`，不能只看 TypeScript 中“应该有”。
- [x] 排查 Broker、Loader、App 三层中究竟是哪一层创建了 data SVG；禁止在只允许 `default-src 'none'` 的 Broker/Loader 内加载 App 图标。
- [x] 若图标属于 tldraw App，优先确保 verified App 的 CSP 正确；不要把整个 Host CSP 放宽到任意网络。
- [x] 重新测试 toolbar、minimap、cursor、菜单图标、字体和中文翻译。
  - 最新 self-contained 运行中 `browser.consoleErrors` 为空；data SVG 图标与 blob 媒体 CSP 已修复。
- [x] 完整 E2E 的 `browser.consoleErrors` 必须为空；不能把 CSP 错误加入忽略名单。
  - 证据：`.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-03T02-06-32-792Z/browser/report.json` 中
    Fullscreen Edit/Add/Save 与 image upload checkpoint 通过，`consoleErrors: []`。

涉及文件：

- `openchamber/packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`
- `tldraw-mcp-app/src/app.tsx`
- `tldraw-mcp-app/config/upstream-lock.json`

### P0-5 重新证明 Save 不切换画布

- [ ] Edit 前记录 `canvasId` 和 `revision`。
- [ ] `+ Note` 后确认 App-only 返回同一 `canvasId`，revision 精确 `+1`。
- [ ] 完成移动、重命名、新建、绑定连线后点击 Save。
- [ ] 检查 Save 请求和响应：
  - `requestCanvasId === responseCanvasId`；
  - `responseRevision === expectedRevision + 1`；
  - semantic patch 含 add、move/edit、rename 和 connector；
  - Host 没有把 `updateModelContext` 再次回显成 Tool result。
- [ ] 切换到另一个会话再返回，仍恢复同一 canvas 和最新 revision。
- [ ] 同一 Host 生命周期打开另一个无 snapshot 的 canvas，不能泄露旧 page、shape、camera、asset 或 undo history。

### P0-6 重新证明 SVG/PNG 导出

- [ ] 在真实 production sandbox 中点击 SVG 和 PNG。
- [ ] OpenChamber 必须显示下载确认；取消时不保存，确认时产生真实文件。
- [ ] SVG 检查：非空、包含预期文字、样式/字体有效、SHA 与 server receipt 一致。
- [ ] PNG 检查：有效签名、宽高合理、有非背景像素、SHA 与 receipt 一致。
- [ ] 连续导出两次，排除 helper iframe、object URL 或 render target 泄漏。
- [ ] 多页面分别导出，文件名包含安全 page slug，内容只属于当前页。
- [ ] 任一 `frame must have a document`、空文件、占位 JSON 或按钮无响应均失败。

### P0-7 重新证明 App Board 和全屏布局

- [ ] 对话内 Pin 后 tile 保存正确 session/message/tool origin。
- [ ] 从 App Board 点击放大，MCP App dialog 必须接近整个 viewport，而不是只占 tile 或半屏。
- [ ] 建议阈值：宽度至少 viewport 的 90%，高度至少 viewport 的 85%。
- [ ] fullscreen 退出后回到原 tile，tile 仍可交互；再次放大不丢 AppBridge。
- [ ] 检查 tldraw、Excalidraw 和 HTML Artifact 的 overlay 层级一致，不得覆盖 Settings 等 Host 模态框。

### P0-8 当前代码完整 E2E 必须全绿

最终运行命令：

```bash
bun run test:tldraw-mcp-app-browser:self-contained
```

必须一次性通过以下 checkpoint：

- [ ] MCP 2026 capability and visibility。
- [ ] Agent semantic tool creation。
- [ ] Inline preview in conversation。
- [ ] Fullscreen Edit + App-only Add + 用户真实编辑 + Save。
- [ ] Real SVG and PNG export bytes。
- [ ] Done、历史版本、刷新和会话恢复。
- [ ] Pin 和 App Board fullscreen。
- [ ] 零 fallback、零 `isError`、零 page/runtime/CSP error。
- [ ] 自动清理临时 Session、tile、Chrome profile 和动态端口。

只有新报告 `ok: true` 且生成于最终源码/最终 dist 之后，才可勾选本项。

## 5. P1：正式版前应完成

### P1-1 多页面与完整 tldraw 编辑体验

- [ ] 创建、重命名、切换多个页面，保存时保持当前页。
- [ ] inline 预览只展示标记的 primary page。
- [ ] frame、group、rich text、arrow binding、弯折 connector、层级顺序保存无损。
- [ ] 图片上传使用确定性本地测试图片，保存后重开仍显示相同字节。
- [ ] tldraw toolbar、minimap、快捷键和触控板缩放可用，体验至少达到 Excalidraw MCP App 的基本可用性。

### P1-2 冲突、断线和恢复

- [ ] 两个实例并发编辑同一 canvas，revision fence 生效。
- [ ] dirty draft 遇到远端新版本时不被轮询覆盖，用户可 Review/Discard。
- [ ] MCP Server 停止后显示 stale/明确错误，不创建默认替代画布。
- [ ] 重启 Server 后恢复原 canvas、revision 和历史。
- [ ] historical revision 保持只读；Restore 创建新的单调递增 revision。

### P1-3 安全验收

- [ ] 伪造不同 session、message、part、server、resource、toolKey 的 App-only 调用，均返回拒绝。
- [ ] 任意 fetch、顶层导航、popup、未确认下载、跨 iframe spoofing 按 Host policy 阻断。
- [ ] canvas lossless snapshot、credential 和私有状态不进入模型消息、Tool picker、日志、报告、截图或导出元数据。
- [ ] fault injection 与普通验收分开标记，不能把预期错误混入“零错误”报告。

### P1-4 locale 和无网运行

- [ ] 英文、简体中文、繁体中文分别运行一次全屏编辑器。
- [ ] locale 切换后 toolbar/menu 文案和图标均正确。
- [ ] 记录并断言没有翻译、图标、字体或 tldraw chunk 的外部网络请求。
- [ ] 断网后已保存 canvas 仍能打开、编辑和导出。

### P1-5 Electron/DMG 人工冒烟

Web 自动化全绿后再做；完整环境、证据和回归要求见第 6.6 节：

- [ ] 从同一最终 commit 构建 DMG。
- [ ] 在正式安装版连接本地独立 tldraw MCP Server。
- [ ] Agent 创建画布。
- [ ] Edit、Add、移动、重命名、连线、Save。
- [ ] SVG/PNG 保存到用户选择的位置。
- [ ] Pin 到 App Board 并全屏。
- [ ] 关闭客户端、重开同一会话，恢复同一 canvas。
- [ ] 保留截图或短视频；人工“看起来可以”不能替代自动报告。

## 6. OpenChamber 二开版集成验收主线

这一主线验证的不是 tldraw Server 自身，而是“独立 MCP Server → OpenCode fork → OpenChamber Web/Electron → 用户”的完整产品链。所有测试必须使用独立 `tldraw-mcp-app` 进程提供的真实 HTTP endpoint。

### 6.1 测试基线和环境隔离

- [ ] 记录三个仓库的 branch、commit、dirty diff 摘要和构建哈希。
- [ ] 记录 `tldraw-mcp-app/config/upstream-lock.json`、`dist/app.html` 和 provenance SHA。
- [ ] OpenChamber 必须启动锁文件指定的 ZunbaRan OpenCode fork，不能让 `$PATH` 选择官方或旧版本 CLI。
- [ ] `GET /global/capabilities` 必须证明 distribution、fork version、upstream baseline 和 MCP Apps feature flags。
- [ ] 使用隔离的测试 profile、Session、App Board 和动态 Web/Chrome 端口；不得修改用户正式 Session。
- [ ] tldraw 服务使用独立 runtime 目录；不得删除或停止不属于本次 runner 的持久服务。
- [ ] OpenCode MCP 配置使用稳定连接键 `interop-tldraw-2026`：

  ```json
  {
    "mcp": {
      "interop-tldraw-2026": {
        "type": "remote",
        "url": "http://127.0.0.1:<port>/mcp",
        "oauth": false,
        "timeout": 30000,
        "enabled": true
      }
    }
  }
  ```

- [ ] 测试报告不得读取或保存 provider token、真实 OpenCode auth 或 canvas lossless snapshot。

### 6.2 OpenCode fork 后端验收

- [ ] MCP connection status 返回：
  - `protocolVersion: 2026-07-28`；
  - `era: 2026-07-28`；
  - `adapter: 2026-sdk`；
  - Apps client/server/negotiated 全为 `true`。
- [ ] `tldraw_create_view`、`tldraw_patch_shapes` 出现在模型可选 Tool。
- [ ] 兼容入口 `tldraw_open_canvas`、`tldraw_patch_diagram` 仍可被模型调用，但 Tool 描述优先引导新任务使用推荐入口。
- [ ] 状态、历史、恢复、App 操作、Save 和 Export Tool 只存在于 App registry，不进入模型候选。
- [ ] ToolPart metadata 保存 server、resource URI、structured content、canvas identity 和 revision。
- [ ] `/mcp/app/resource` 读取经过 MIME、大小、server/resource identity 和哈希校验的 `ui://` resource。
- [ ] `/mcp/app/tool-call` 对 directory/session/message/part/server/resource/toolKey 做完整上下文绑定。
- [ ] 历史 Session 恢复时重新解析 App resource；失败时只显示明确诊断和 Original Tool Output，不得崩溃。
- [ ] Server 断线、重连或资源版本变化后缓存正确失效。

### 6.3 OpenChamber Web 产品路径

使用 Qwen3.7 Plus 或同等级普通模型执行真实对话：

1. [ ] 用户要求创建服务拓扑图，Agent 自行选择 `interop-tldraw-2026_tldraw_create_view`。
2. [ ] ToolPart 完成且 `isError=false`，没有改用 HTML Artifact、Interactive UI、Excalidraw 或旧 Tool。
3. [ ] 对话内出现非空 tldraw 只读预览，显示模型创建的真实节点和连线。
4. [ ] 点击 Edit 后，Host 进入 effective fullscreen，verified editor 真正 ready。
5. [ ] 用户通过真实指针/键盘完成新建、移动、重命名和绑定连线。
6. [ ] App 的 `+ Note` 通过 AppBridge 调用 App-only Tool，模型没有参与该调用。
7. [ ] 用户自然语言追问修改同一画布，Agent 选择 `tldraw_patch_shapes`；验证 `expectedRevision`、`transactionId` 幂等和同一 canvas 的 revision 增长。
8. [ ] Save 更新同一 canvas，revision 精确增加，切换 Session 后仍恢复。
9. [ ] SVG/PNG 经 Host 确认后保存真实字节。
10. [ ] Done 回到预览；历史 revision 可查看并恢复为新 revision。
11. [ ] Pin 到 App Board，来源保持 `MCP App`，tile 可调整、关闭、恢复和全屏。

每一步报告必须分别记录：

- `Tool selected`
- `Surface/resource resolved`
- `Surface rendered`
- `Structured/canvas data loaded`
- `User interaction completed`
- `App-only operation completed`
- `Secret absent`

任何 fallback、文字替代或只出现 iframe 外壳，都不能算该步骤通过。

### 6.4 OpenChamber Host 专项验收

- [ ] 使用生产 `McpAppRenderer` 的 Broker → Loader → verified App 三层链，不使用测试专用 renderer。
- [ ] App 只有在 resource 完整校验并挂载后才发送 ready；第二次异常导航必须 fail closed。
- [ ] Tool input/result 每个 bridge epoch 只发送一次；`updateModelContext` 不得伪装成新的 Tool result。
- [ ] 关闭、切换 ToolPart、切换 Session 和退出 fullscreen 时，先完成 bounded teardown，再撤销文档和 transport。
- [ ] 旧 App 的 Tool、下载和 model-context 请求在 lifecycle epoch 失效后被取消。
- [ ] App 请求的 fullscreen 与 Host effective mode 一致；App Board tile resize 不能误判成 display-mode 切换。
- [ ] Settings、确认框、下载对话框、标题栏和输入区域必须覆盖 MCP App；iframe 不得浮到 Host 模态框上方。
- [ ] 对话滚动、App Board 滚动和 tile clipping 正确，MCP App 内容/按钮不得溢出容器。
- [ ] Web 下载确认和 Electron native save 都使用 Host API，不允许 App 自行导航下载。
- [ ] `origin`、`source`、nonce、session、resource 和 part 校验均生效。

### 6.5 OpenChamber 回归矩阵

tldraw 通过不代表二开版没有破坏其他功能。至少补以下最小回归：

| 回归目标 | 必须验证的路径 |
|---|---|
| Excalidraw MCP App | Agent 生成图、对话预览、Edit、返回预览、Pin、App Board 放大 |
| Legacy MCP | 普通 Tool 调用、资源读取、断线重连，不被误判为 2026 App |
| 其他 MCP 2026 Tool | 没有 UI 的 Tool 继续显示普通结果，未知 metadata 不崩溃 |
| Local OCIX | 已安装应用的 Interactive UI/HTML Artifact 能打开、查询 API、Pin |
| Hosted OCIX | 远程 manifest/resource/Business Gateway 仍能加载和明确报错 |
| Agent Generated Interactive UI | 模型生成的声明式页面仍可渲染和交互 |
| Agent Generated HTML Artifact | sandbox、浮窗、关闭、滚动和 Host modal 层级正常 |
| App Board | OCIX、HTML Artifact 和 MCP App 可共存，来源、尺寸和 fullscreen 状态不串 |

- [ ] 这些回归可以采用最小 fixture，但必须通过真实 OpenChamber 页面触发。
- [ ] 不要求在 tldraw E2E 内重测全部 OCIX 治理；只需证明本次 Host 改动没有破坏关键路径。
- [ ] 任一既有能力回归，应作为 OpenChamber 阻塞缺陷处理，不能归因于 tldraw Server。

### 6.6 OpenChamber Electron/DMG 验收

- [ ] 从已经通过 Web E2E 的同一 OpenChamber commit 构建 macOS DMG。
- [ ] 检查 App resources 内置的是 lock 指定的 OpenCode fork，不包含意外官方 CLI。
- [ ] 正式安装版连接独立 loopback tldraw MCP Server，不使用开发 Web server。
- [ ] 完成一次真实 Agent Create → Preview → Edit → App-only Add → Save → Export → Pin → Fullscreen。
- [ ] 使用系统保存对话框保存 SVG/PNG，检查文件字节和可打开性。
- [ ] 关闭并重启 OpenChamber，再打开原 Session 和 App Board，确认同一 canvas/revision。
- [ ] 检查 App fullscreen、Settings、更新弹窗和其他 Host modal 的 z-index/焦点。
- [ ] 检查退出应用后没有遗留测试 Chrome、Web server 或非托管 OpenCode 进程。
- [ ] 保留至少一组截图或短视频和版本/commit/hash 记录。

### 6.7 OpenChamber 证据目录与最终报告

每轮 self-contained 验收写入独立目录：

```text
openchamber/.tmp/tldraw-mcp-app-browser-orchestrated/<run-id>/
  orchestration.json
  browser/report.json
  browser/*.png
  browser/downloads/*
  logs/openchamber.log
  logs/tldraw.log
  logs/browser-verifier.log
```

`.tmp` 只是单轮运行目录。正式候选版本还必须：

- 将摘要、三仓 commit/build hash、关键 checkpoint、下载 SHA 和脱敏错误清单写入 `docs/release-evidence/tldraw-mcp-app/<version>/`。
- 将完整截图、视频、日志和下载样本上传为 CI 或 prerelease artifact，保留不少于 90 天。
- 在持久化摘要中记录 artifact URL、内容 SHA256 和过期时间；不能只引用会被清理的本机 `.tmp` 路径。

最终报告至少记录：

- OpenChamber/OpenCode/tldraw 三个版本和 commit。
- OpenCode fork distribution capability 与 MCP adapter。
- App HTML、runtime manifest 和 upstream lock SHA。
- 模型、Tool、Session、Message、Part 和 canvas identity（不记录 secret）。
- 每个 checkpoint 的 pass/fail、截图、下载 SHA 和清理结果。
- console/page/runtime/CSP error 列表。
- Excalidraw、Legacy MCP 和 OCIX 最小回归结果。
- Electron 安装版人工冒烟结果。

只有 standalone 报告、OpenChamber Web 报告和 Electron 冒烟三者都对应最终构建，才允许进入发布收尾。

## 7. P2：仓库和发布收尾

### P2-1 构建与哈希一致性

修改 `src/app.tsx` 后必须依次执行，禁止只替换 `dist/app.html`：

```bash
npm run build:app
npm run verify
npm test
npm run test:restart-persistence
npm run accept
```

- [ ] 更新 `config/upstream-lock.json` 的 source/output hash。
- [ ] provenance、runtime manifest、最终 HTML SHA 和 lock 完全一致。
- [ ] 更新 OpenChamber 文档中记录的 bundle bytes/SHA（如仍保留这些固定值）。
- [ ] 重型 build/test 串行运行，避免再次耗尽内存。

### P2-2 独立仓库基线

- [ ] `tldraw-mcp-app` 建立首个可回滚 commit；当前 `main` 没有任何 commit。
- [ ] 确认 `.gitignore` 不提交 runtime、临时 profile、canvas 数据、日志或 secret。
- [ ] 增加 CI：unit、build/verify、accept；浏览器 E2E 可单独串行 job。
- [ ] 发布前记录 tldraw 上游 tag/commit、MCP SDK 版本和 App HTML SHA。
- [ ] README 给出 OpenChamber、其他兼容客户端的连接配置和能力降级说明。

### P2-3 文档收尾

- [ ] 把本次“按钮先出现但 Editor 未 ready”的问题写入 `MCP_2026_APP_DEVELOPMENT_LESSONS.md`。
- [ ] 把 Broker/Loader/App 三层 CSP 定位方法写入经验文档。
- [ ] 把旧全绿报告与最终全绿报告的源码/构建哈希一起记录，避免以后引用错版本。
- [ ] 更新 `TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md`，明确 `data-editor-ready` 是测试与产品共用的稳定生命周期契约。

## 8. 推荐执行顺序

不要并行跑构建或浏览器，按以下顺序收敛：

1. 修复浏览器 helper 的 13/14 单测失败。
2. 在 standalone App 增加 editor-ready 生命周期和按钮禁用。
3. 只跑相关 Node 测试，不构建 OpenChamber。
4. 重建 standalone App，更新 lock/provenance，跑 standalone 全套测试。
5. 修复 CSP 图标问题并跑 Host 聚焦测试、UI type-check。
6. 串行构建一次 OpenChamber Web。
7. 运行一次 self-contained 浏览器 E2E；失败时只修复第一个真实失败点。
8. E2E 全绿后补 locale、冲突、安全和断线用例。
9. 执行第 6.5 节的 OpenChamber 回归矩阵，确认 Host 改动没有破坏其他 MCP/OCIX/Artifact。
10. 最后才做 DMG 和人工客户端冒烟。
11. 所有证据齐全后再 commit、tag 或 release。

## 9. 每轮验收命令

### standalone tldraw MCP App

```bash
cd /Users/loloru/Documents/data/project/openChamber/tldraw-mcp-app
npm run build:app
npm run verify
npm test
npm run test:restart-persistence
npm run accept
```

`npm run accept` 必须在不启动 OpenChamber/OpenCode fork 的情况下覆盖协议协商、四个模型 Tool 的 visibility、`ui://` resource、App-only 调用与“未协商 Apps 时文本降级”。

### OpenCode fork MCP Apps 后端

```bash
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/lifecycle.test.ts test/mcp/app.test.ts

cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun run --cwd packages/electron verify:opencode-cli:runtime
```

以上测试应分别证明 adapter/registry/resource/cache、App-only visibility、正向调用和错误 session/message/server/resource/toolKey 绑定被拒绝；完整产品 E2E 不能替代这组后端负向测试。

### OpenChamber Host 聚焦测试

```bash
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts packages/ui/src/lib/interactive-ui/mcpApp.test.ts
bun run --cwd packages/ui type-check
```

### 完整产品链

```bash
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun run build:web
bun run test:tldraw-mcp-app-browser:self-contained
```

## 10. 完成定义

同时满足以下条件，才能回答“tldraw MCP App 已完成”：

- [ ] standalone unit/build/verify/accept 全绿。
- [ ] 所有 P0、P1 检查项均关闭；若只关闭 P0，只能称为“主链恢复”，不能称为正式完成。
- [ ] OpenCode fork capability、2026 adapter、App registry/resource 和 App-only Tool 完整上下文绑定验收全绿。
- [ ] OpenChamber Host 聚焦测试和 type-check 全绿。
- [ ] 最终 self-contained 浏览器报告 `ok: true`。
- [ ] 报告中没有 fallback、`isError`、runtime/page/console/CSP error。
- [ ] 同一 canvas 完成 Agent 创建、用户编辑、Save、导出、历史恢复和 App Board 全屏。
- [ ] 中英文图标、字体、离线资源经过真实浏览器检查。
- [ ] Excalidraw MCP App、Legacy MCP、Local/Hosted OCIX、Interactive UI 和 HTML Artifact 最小回归全绿。
- [ ] Electron 安装版完成最小人工冒烟。
- [ ] 最终源码、dist、lock、provenance、报告对应同一版本。
- [ ] 独立仓库存在可回滚 commit，文档和连接方式齐全。

在此之前，准确表述应是：

> MCP 2026 协议、独立服务和主要 App 能力已经实现；旧版本曾跑通过完整路径，但当前 Host 生命周期改造后的最新代码仍有编辑器就绪与 CSP 回归，尚未达到可发布完成状态。

## 11. 给下一位 Agent 的第一步

下一位 Agent 不应重新研究协议或重新开发服务端。第一步只做三件事：

1. 修复 `assessTldrawEditorReadiness(false)` 的单测失败。
2. 在 `tldraw-mcp-app/src/app.tsx` 实现 `data-editor-ready` 和真实按钮 gating。
3. 重跑 self-contained E2E，保留新的第一个失败证据。

只有这三步完成后，才继续处理 CSP、导出和 App Board 回归。
