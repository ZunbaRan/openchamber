# MCP Apps（Excalidraw / tldraw）稳定化修改计划

> 状态：待开发  
> 日期：2026-08-03  
> 范围：OpenChamber、OpenCode Fork、`tldraw-mcp-app`、互操作验收实验室  
> 角色边界：本文只做问题分析、设计审核、修改计划与验收定义；具体开发由其他开发者执行。

## 1. 背景与目标

OpenChamber 当前已经能够：

- 连接官方 Excalidraw MCP App（Legacy MCP Apps）。
- 连接自研 `tldraw-mcp-app`（严格 MCP 2026-07-28）。
- 在聊天输出流中解析 MCP App resource，并将其放入 sandbox iframe。
- 将 MCP App 固定到 App Board，并在 inline / fullscreen 模式之间切换。
- 保存 tldraw 画布、维护单调递增 revision，并查看历史 revision。

但当前仍有四类影响正式验收的问题：

1. 官方 Excalidraw MCP App 工具调用成功，但 App 页面为空白。
2. tldraw inline 预览和 Edit 页面使用不同渲染引擎，视觉不一致，inline 预览也不能像 Excalidraw 一样只读缩放和平移。
3. tldraw 的历史 `r1` 显示协议验收占位卡，而不是用户期望的业务拓扑图。
4. 服务会返回 `canvas_limit_reached`，Agent 随后错误地复用共享验收画布。

本轮目标不是继续增加功能，而是把 MCP App 主链稳定到“可解释、可诊断、可恢复、可验收”的程度。

## 2. 结论摘要

| 问题 | 当前结论 | 置信度 | 优先级 |
|---|---|---:|---:|
| Excalidraw 空白 | Tool 与 resource 外壳已成功，官方 v0.3.2 HTML 在运行时依赖 `https://esm.sh`；当前网络不可达、CSP 元数据未生效或模块加载失败均会造成空白。宿主缺少 iframe 内阶段诊断，因而无法向用户解释。 | 高 | P0 |
| tldraw 预览与 Edit 不同 | inline 使用自研 semantic SVG；Edit 使用真实 tldraw v5 editor。不是偶发 CSS，而是两套渲染引擎。 | 确定 | P0 |
| tldraw `r1` 异常 | `r1` 的持久化内容确实只有 `tldraw v5.0.2 · strict MCP 2026-07-28` 协议验收占位卡。历史读取本身是正确的，问题是测试种子混入了用户画布和 revision UI。 | 确定 | P1 |
| 画布达到上限 | 服务对每个 workspace 硬限制 32 个画布；清理脚本可能只改持久化文件，而运行进程仍持有旧内存目录。错误返回信息过少，Agent 又会擅自复用 `interop-acceptance`。 | 高 | P0 |

## 3. 现有证据

### 3.1 Excalidraw

1. OpenCode 日志已经记录官方 Excalidraw Server 连接成功：
   - adapter：`2026-sdk`
   - era：`legacy`
   - protocolVersion：`2025-11-25`
2. `read_me`、`create_view` Tool 调用成功，没有对应的后端 resource 404/403。
3. 官方固定版本 `excalidraw-mcp v0.3.2` 的 `mcp-app.html` 不是完全离线资源，包含运行时 import：
   - `https://esm.sh/react@19.0.0`
   - `https://esm.sh/react-dom@19.0.0`
   - `https://esm.sh/@excalidraw/excalidraw@0.18.0`
   - `https://esm.sh/morphdom@2.7.8`
4. 官方 resource 同时声明：
   - `resourceDomains: ["https://esm.sh"]`
   - `connectDomains: ["https://esm.sh"]`
5. OpenCode Fork 已存在 resource `_meta.ui.csp` 的提取逻辑；OpenChamber 也会根据 `resourceDomains` 和 `connectDomains` 构建 sandbox CSP。
6. 当前 UI 只能显示最终的通用空白或通用错误，不能区分：
   - resource 下载失败；
   - CSP 未保留；
   - `esm.sh` DNS/TLS/HTTP 失败；
   - ES module 执行失败；
   - AppBridge 未初始化；
   - Tool Result 未投递；
   - App 已初始化但没有首屏内容。

因此，不能把“增加 iframe 高度”或“重新调用模型”当作修复。必须先补齐资源与浏览器阶段证据。

### 3.2 tldraw inline / Edit

`tldraw-mcp-app/src/app.tsx` 中：

- inline 预览由自研 SVG 节点、边、文字和颜色映射器绘制。
- fullscreen/Edit 才加载真实 tldraw v5 editor 与 lossless snapshot。

因此两者会自然出现：

- 字体不同；
- 线条、箭头、圆角和文本换行不同；
- 图形边界不同；
- 复杂 shape、asset、binding 和页面信息无法完全等价；
- inline 无法复用 tldraw 的相机、缩放与平移逻辑。

### 3.3 历史 `r1`

当前 `interop-acceptance` 的持久化历史中：

- `r1` 是最初的严格 MCP 2026 协议验收种子，只含一张文本卡。
- `r2` 才是服务拓扑图。

所以切换 `r1` 后出现协议卡是“正确读取了不应暴露给用户的测试历史”，不是 revision 读取错位。

### 3.4 画布配额

当前服务常量：

- 每 workspace 最多 32 个画布。
- 每画布最多 32 个 revision。

`tldraw_create_view` 和 `tldraw_open_canvas(createIfMissing=true)` 在目录数量达到 32 时只返回文本 `canvas_limit_reached`。

这会带来四个问题：

1. active 与 archived 是否都计数不够直观。
2. 错误没有返回 workspace、active、archived、limit 和建议操作。
3. 离线脚本直接改文件后，运行进程可能继续使用旧内存目录。
4. Agent 得到错误后会擅自复用共享 `interop-acceptance`，造成跨任务数据污染甚至潜在数据泄漏。

## 4. 目标交互契约

### 4.1 MCP App 通用状态

每个 App 实例必须处于以下可观察状态之一：

1. Resolving tool binding
2. Fetching verified resource
3. Mounting sandbox document
4. Loading declared dependencies
5. Waiting for AppBridge
6. Delivering Tool Input / Tool Result
7. Ready and painted
8. Failed（带稳定错误码、阶段和可重试建议）

不允许长期停在“黑色空白区域”。

### 4.2 tldraw inline 预览

inline 与 Edit 必须使用同一份 tldraw document/store 和同一套 shape renderer。

inline 允许：

- 触控板/滚轮缩放；
- 拖动画布进行平移；
- pinch zoom；
- Zoom to fit；
- Reset view；
- 可选的小地图；
- 点击 Edit 打开相同 canvas、相同 revision。

inline 禁止：

- 创建、移动、缩放、删除 shape；
- 编辑文字；
- 粘贴或拖入资源；
- 触发保存；
- 调用任何写入型 app-only Tool。

缩放和平移只改变本地 camera，不产生 revision，也不写入服务端。

### 4.3 历史 revision

- 历史 revision 不可被原地修改。
- 查看历史时可以缩放和平移。
- Edit 按钮改为 Review；只能只读查看。
- Restore 会复制历史内容并创建新的当前 revision，不回退 revision 序号。
- revision 列表必须展示来源：`initial`、`agent`、`user-save`、`restore`、`migration`、`test-fixture`。
- `test-fixture` 默认不出现在生产用户的 revision 列表中。

### 4.4 画布配额

- 不允许 Agent 在额度不足时自动复用无关画布。
- 创建请求必须支持 idempotency key，丢失响应后的重试不重复创建。
- quota 错误必须是结构化错误，并包含：
  - workspaceId
  - activeCount
  - archivedCount
  - maxActive / maxTotal
  - requestId
  - 可安全归档的 ephemeral 候选数量
- 测试画布、临时画布和用户持久画布必须分开命名空间或具有明确 retention class。

## 5. 修改任务

## P0-A：Excalidraw 空白页诊断与兼容

### A1. 增加隐私安全的 App 生命周期诊断

负责仓库：OpenChamber。

需要记录但不得包含 Tool Result、业务数据和凭据：

- server、resourceUri、resource sha256、HTML byte size、MIME；
- resource CSP 是否存在；
- CSP 中经过规范化后的 resource/connect domain 数量；
- loader booted / transfer begin / chunks / commit；
- final document load；
- AppBridge initialized；
- Tool Input delivered；
- Tool Result delivered；
- CSP violation 的 directive 与被阻止的 origin（URL 去除 path/query）；
- script error / unhandled rejection 的错误类别（不记录页面数据）；
- first paint 或根节点是否产生可见内容。

建议增加稳定错误码：

- `mcp_app_resource_fetch_failed`
- `mcp_app_csp_metadata_missing`
- `mcp_app_dependency_blocked`
- `mcp_app_dependency_unreachable`
- `mcp_app_script_failed`
- `mcp_app_bridge_timeout`
- `mcp_app_tool_result_not_delivered`
- `mcp_app_ready_but_blank`

### A2. 验证 CSP 元数据全链路

负责仓库：OpenCode Fork + OpenChamber。

逐跳断言：

1. `resources/read` content `_meta.ui.csp` 包含 `esm.sh`。
2. OpenCode `McpApp.Resource.meta.csp` 保留该值。
3. SDK API 响应保留该值。
4. OpenChamber envelope 保留该值。
5. 最终 sandbox CSP 的 `script-src`、`style-src`、`font-src`、`img-src` 和 `connect-src` 符合声明。
6. CSP 不允许未声明的任意域名。

### A3. 明确网络依赖策略

官方 Excalidraw v0.3.2 依赖 `esm.sh`，产品必须做明确选择：

- 在线兼容模式：允许 resource 声明的 `esm.sh`，并在不可达时显示“依赖域名不可用”，不能显示空白。
- 离线验收模式：另行构建带 provenance 的 self-hosted/offline derivative，将 React、Excalidraw、morphdom 全部打进 resource；不得篡改或冒充官方 artifact。

正式验收必须同时覆盖：

- 官方远程 App（网络正常）；
- 官方远程 App（`esm.sh` 不可达，明确失败）；
- 自托管离线 App（断网仍可渲染）。

### A4. Ready-but-blank watchdog

AppBridge initialized 不能直接等于 UI 可用。初始化后在限定时间内需要由 App 或宿主观察到首屏可见内容；否则进入 `mcp_app_ready_but_blank`，并提供：

- Retry resource；
- 查看诊断摘要；
- 展开 Original Tool Output。

不建议宿主读取业务 DOM 内容，只需记录尺寸、可见节点数量或由 AppBridge 增加显式 `ui/ready`/首屏信号。

## P0-B：tldraw 单渲染引擎的只读预览

负责仓库：`tldraw-mcp-app`。

### B1. 移除“自研 SVG 作为最终 inline renderer”

- semantic SVG 仅保留用于流式生成期间的低成本骨架或服务器导出回退。
- Tool Result 完整并取得 authoritative snapshot 后，inline 切换为真实 tldraw renderer。
- inline 和 fullscreen 复用相同 store、schema、shape utils、fonts 和 assets。

### B2. 引入 read-only presentation mode

- 使用 tldraw 原生只读模式或等价的 mutation gate。
- 隐藏工具栏、菜单、选择框、编辑 handles 和快捷键提示。
- 保留 camera interaction。
- 在 AppBridge 层拒绝 inline 模式发出的写入调用，不能只靠隐藏按钮。

### B3. Camera 契约

- 初次加载执行 zoom-to-fit。
- inline 的 camera 可以在该 App 实例内保持。
- 进入 Edit 时默认沿用 inline camera。
- 返回 inline 时沿用 Edit 退出时 camera，但不得保存为业务 revision。
- 切换 revision 后重新 zoom-to-fit，避免沿用不适配的历史 camera。

### B4. 复杂内容回归

至少验证：

- rectangle、ellipse、text、arrow；
- binding 与箭头标签；
- 多页面；
- image asset；
- 自定义字体和深浅色主题；
- 大画布（100+ shape）；
- inline、App Board tile、fullscreen 三种容器尺寸。

## P0-C：画布配额、生命周期与 Agent 行为

负责仓库：`tldraw-mcp-app` + OpenCode Fork 的 Tool 描述/错误传递。

### C1. 修正配额模型

建议拆分：

- `maxActiveCanvases`
- `maxArchivedCanvases`
- `maxTotalStoredBytes`

归档画布不应与 active 画布使用同一无差别计数，除非错误信息明确说明。

### C2. 服务端管理 API

- 归档、删除、清理必须通过服务端事务/API 完成。
- 禁止运行中由脚本直接改 durable JSON，再期待内存自动同步。
- 若保留离线维护工具，必须要求服务停止，或写入 generation 并触发安全 reload。
- health/capabilities 暴露 active、archived、limits、store generation。

### C3. 自动保留策略

- `ephemeral/test` 且未 pin 的画布可 TTL/LRU 自动归档。
- `persistent/user` 画布不得自动删除。
- App Board pin、显式保存、用户命名可提升 retention class。
- acceptance 测试使用独立 workspace，并在 teardown 清理。

### C4. Agent Tool 契约

- Tool description 明确：`canvas_limit_reached` 时不得复用无关 canvas。
- Agent 应先调用 canvas catalog/capacity Tool，再向用户报告或建议归档。
- 只有用户明确指定 canvasId，或 idempotency key 命中同一请求时，才复用已有画布。
- 移除生产默认 canvasId `interop-acceptance`，该名称只允许出现在测试配置。

## P1-D：revision 来源与测试数据隔离

负责仓库：`tldraw-mcp-app`。

### D1. revision metadata

每个 revision 增加：

- `origin`: `initial | agent | user-save | restore | migration | test-fixture`
- `actor`: 受限枚举，不保存用户敏感身份
- `reason`: 短字符串/稳定 code
- `createdAt`
- `parentRevision`

### D2. UI 标签

- `r2 · latest`
- `r1 · initial seed`
- `r5 · restored from r2`
- `r7 · user save`

测试 fixture 默认隐藏；显式开启“显示内部修订”后才显示。

### D3. 现有数据迁移

- 不修改已存在的 r1 内容，不伪造历史。
- 识别已知 `interop-acceptance` fixture 并归档到测试 workspace。
- 用户业务画布保持 canvasId 与 revision 单调性。
- 迁移前后生成数量、hash 和 revision 对照报告。

## 6. 代码结构与实现方向

本节用于约束开发者的落地方式。它不是要求逐字复制的代码，而是规定修改边界、状态所有权、接口形状和不允许采用的捷径。

### 6.1 OpenChamber：把字符串错误改成可审计状态机

主要文件：

- `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`
- `packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts`
- `packages/ui/src/lib/interactive-ui/mcpApp.ts`
- `packages/ui/src/lib/interactive-ui/mcpApp.test.ts`

现有 `McpAppRenderer` 同时负责 resource fetch、sandbox loader、AppBridge、Tool Result 投递和错误 UI，但最终主要收敛成一个 `error: string | null`。开发者应引入显式 runtime model：

```ts
type McpAppRuntimePhase =
  | 'resolving-binding'
  | 'fetching-resource'
  | 'mounting-sandbox'
  | 'loading-dependencies'
  | 'waiting-app-bridge'
  | 'delivering-tool-data'
  | 'waiting-first-paint'
  | 'ready'
  | 'failed'

type McpAppRuntimeFailureCode =
  | 'resource-fetch-failed'
  | 'csp-metadata-missing'
  | 'dependency-blocked'
  | 'dependency-unreachable'
  | 'script-failed'
  | 'bridge-timeout'
  | 'tool-data-delivery-failed'
  | 'ready-but-blank'

interface McpAppRuntimeState {
  phase: McpAppRuntimePhase
  failure?: {
    code: McpAppRuntimeFailureCode
    retryable: boolean
    safeDetail?: string
  }
  milestones: Partial<Record<McpAppRuntimePhase, number>>
}
```

实现方向：

1. `createMcpAppResourceLoadController` 只负责 resource fetch、校验和 retry，不直接拼接用户文案。
2. `buildMcpAppDocumentPolicy` 返回 CSP 字符串的同时，返回经过规范化的安全摘要，便于诊断实际采用了哪些 origin。
3. `createMcpAppLoaderHostController` 与 `createMcpAppSandboxProxyHostController` 只发送稳定诊断事件，不直接操作 React error state。
4. `McpAppRenderer` 使用 reducer 消费诊断事件，统一控制 loading、ready、failed 和 Retry。
5. binding epoch 变化、session/message 切换和 unmount 必须使旧 controller 失效；旧 iframe 事件不得改变新实例状态。

建议事件形状：

```ts
interface McpAppRuntimeDiagnosticEvent {
  bindingEpoch: string
  phase: McpAppRuntimePhase
  code: string
  at: number
  resourceSha256?: string
  origin?: string       // 只保留 scheme + host + port
  directive?: string    // 例如 script-src-elem
}
```

不得把 HTML、Tool Input、Tool Result、URL query、token 或业务 DOM 文本放入诊断事件。

### 6.2 OpenChamber：在 opaque sandbox 中检测脚本/CSP/空白

宿主不能直接依赖 React 父页面读取 opaque iframe DOM。建议在已经由宿主前置注入的可信 bootstrap 中加入受限诊断探针：

- `securitypolicyviolation`：上报 `effectiveDirective` 和规范化 origin。
- `error`：只上报错误类别、脚本 origin 和是否为 module load failure。
- `unhandledrejection`：只上报通用类别，不序列化 rejection 对象。
- `MutationObserver` / `ResizeObserver`：只上报是否出现可见尺寸和非 bootstrap 子节点，不上报内容。
- AppBridge initialized 后开始 first-paint deadline；达到 deadline 且仍无可见内容时进入 `ready-but-blank`。

探针消息必须包含 nonce 和 binding epoch，并继续经过现有 source/origin/epoch authority guard。

不允许采用：

- 给 iframe 增加 `allow-top-navigation`；
- 将 CSP 改成 `default-src *`；
- 为了捕获错误而取消 opaque origin；
- 把整个 console/error 对象透传到宿主日志。

### 6.3 OpenCode Fork：规范化而不是原样信任 resource metadata

主要文件：

- `packages/opencode/src/mcp/app.ts`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/test/mcp/app.test.ts`
- 对应 MCP App HTTP API 测试

当前 `McpApp.resourceMeta()` 会保留 resource content `_meta.ui.csp`。修改方向：

1. 为 CSP 定义明确 schema，而不是长期使用 `Record<string, unknown>`：

```ts
interface McpAppCsp {
  resourceDomains?: string[]
  connectDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}
```

2. 只接受合法 `https` origin；开发模式可显式允许 loopback `http`，不能接受 path、query、credential、通配任意域或脚本 scheme。
3. 去重并限制每类 domain 数量和字符串长度。
4. `appResource()` 在缓存前完成 normalization，resource SHA256 仍只覆盖 resource bytes；effective policy 另外计算稳定摘要。
5. OpenChamber API 返回 normalized metadata 和 policy digest，不返回原始未验证对象。
6. resource refresh 后如果 SHA 或 policy digest 变化，必须增加 binding epoch，使旧 AppBridge 权限失效。

针对 Excalidraw 增加固定回归 fixture：resource 声明 `esm.sh` 后，SDK 响应与最终 CSP 中必须仍然存在 `https://esm.sh`；删除声明后必须被阻断而不是自动放宽。

### 6.4 Excalidraw：区分“官方兼容”与“离线派生包”

主要文件/资产：

- `extension/interop-acceptance-lab/scripts/prepare-excalidraw.mjs`
- `extension/interop-acceptance-lab/.runtime/vendor/excalidraw/dist/mcp-app.html`
- `extension/interop-acceptance-lab/services/excalidraw/proxy.mjs`

实施时维护两个明确测试目标：

1. `excalidraw-official-online`
   - 使用原始 SHA 固定的 v0.3.2 `.mcpb`。
   - 保留 `esm.sh` 依赖。
   - 用于证明 OpenChamber 正确执行第三方声明的 CSP。
2. `excalidraw-selfhosted-offline`
   - 在单独构建目录将依赖打包进 resource。
   - 使用自己的名称、版本、SHA 和 provenance。
   - 不覆盖原始 `.mcpb`，也不声称它是官方发布文件。

`prepare-excalidraw.mjs` 应只负责下载、SHA 校验和 provenance；离线派生构建应使用独立脚本，防止一次运行悄悄改写官方验收基线。

### 6.5 tldraw App：保持一个长期存活的真实 CanvasSurface

主要文件：

- `tldraw-mcp-app/src/app.tsx`
- `tldraw-mcp-app/test/app.behavior.test.mjs`
- `tldraw-mcp-app/test/app.parity.test.mjs`

当前 `LightweightPreview` 路径大约由 `lightweightPreviewScene()` 和 `.preview-stage` CSS 驱动；fullscreen 则由真实 editor 驱动。建议改成以下组件边界：

```text
AppBridge / authoritative CanvasState
                  |
            StableCanvasStore
                  |
        CanvasSurface（只挂载一次）
          /                     \
 inline presentation       fullscreen editor
 readOnly=true             readOnly=false
 chrome=hidden             chrome=visible
 camera enabled            camera + editing enabled
```

推荐组件职责：

```ts
interface CanvasSurfaceProps {
  mode: 'inline' | 'fullscreen'
  state: CanvasState
  historicalRevision?: number
  mutationAuthority: 'none' | 'current-revision'
}
```

落地方向：

1. `CanvasSurface` 只创建一次 tldraw editor/store，模式切换只改变 instance state、UI overrides 和容器布局，不卸载 store。
2. inline 使用 tldraw v5 支持的 read-only instance state；额外在 command/AppBridge 层检查 `mutationAuthority === 'none'`。
3. `.mode-inline` 不再渲染最终 `LightweightPreview`。只有 `streamingPreview.active === true` 且 authoritative snapshot 尚未完成时，才显示 semantic SVG overlay。
4. authoritative Tool Result 到达后，在同一帧或短 crossfade 中撤下 overlay，显示真实 tldraw renderer。
5. `renderState()`、`renderHistoricalState()` 只更新 stable store，不再切换到另一套表示结构。
6. camera 另存于内存 `CameraSessionState`，不进入 save payload 和 revision hash。
7. historical revision 强制 `mutationAuthority='none'`；Restore 成功后才加载新 current revision 并恢复写权限。

必须在测试中比较同一 snapshot 在 inline 与 fullscreen 下的 shape ID 集合、页面集合、asset 集合和截图，不接受仅比较 semantic node 数量。

### 6.6 tldraw Server：让 canvas store 成为唯一配额权威

主要文件：

- `tldraw-mcp-app/src/canvas-store.mjs`
- `tldraw-mcp-app/src/server.mjs`
- `tldraw-mcp-app/test/canvas-store.test.mjs`
- `tldraw-mcp-app/test/process-restart-persistence.test.mjs`
- `tldraw-mcp-app/test/server.protocol.test.mjs`

当前 `canvas-store.mjs` 已能抛出 `canvas_limit_reached`，但 `server.mjs` 的 `tldraw_open_canvas` / `tldraw_create_view` 仍有基于 `stateDocument` 的重复计数。修改方向：

1. 删除或收敛 server 中重复的 `Object.keys(draft.canvases).length >= MAX_CANVASES` 判断。
2. 所有 create/archive/delete/restore 通过 `canvasStore` 事务执行，由一个地方检查 quota 和 generation。
3. `stateDocument` 如果继续作为读缓存，必须带 `storeGeneration`；写事务前发现 generation 不一致时 reload 或返回稳定冲突，不能覆盖外部变化。
4. 维护命令不得直接修改运行中服务读取的 durable JSON。
5. archive 与 delete 都要产生审计 receipt；delete 默认仅允许 ephemeral/test 数据。

建议统一错误：

```ts
interface CanvasQuotaExceeded {
  code: 'canvas_limit_reached'
  workspaceId: string
  activeCount: number
  archivedCount: number
  maxActive: number
  maxTotal: number
  ephemeralArchiveCandidates: number
  requestId: string
}
```

MCP Tool Result 应设置 `isError: true`，同时将该结构放入 `structuredContent.error`；文本 content 只提供简短的人类说明。OpenCode 必须保留 structured error，Agent 提示词明确禁止自动选择其他 canvasId。

### 6.7 tldraw revision：在数据模型中保存来源

revision metadata 应存储在 revision record，而不是根据画面文字或 canvasId 推断：

```ts
interface RevisionRecord {
  revision: number
  recordedAt: string
  state: PersistedCanvas
  provenance: {
    origin: 'initial' | 'agent' | 'user-save' | 'restore' | 'migration' | 'test-fixture'
    reasonCode: string
    parentRevision?: number
    restoredFromRevision?: number
  }
}
```

实现约束：

- 新字段采用向后兼容 migration；旧记录缺失 provenance 时标为 `migration/unknown-legacy`，不能猜成 user-save。
- `revisionListView()` 直接返回 provenance 摘要。
- `restore` 新记录填写 `origin=restore` 和 `restoredFromRevision`。
- fixture 创建必须显式传 `origin=test-fixture`。
- 普通 UI 默认过滤 `test-fixture`，但审计接口仍可读取。

### 6.8 测试代码方向

单元测试之外，至少增加以下契约测试：

1. OpenChamber sandbox fixture：一个成功 App、一个 CSP block App、一个 bridge-ready-but-blank App。
2. Excalidraw fixture：保留官方 resource metadata，模拟 `esm.sh` 成功和失败。
3. tldraw parity：同一 snapshot 分别进入 inline/fullscreen，验证同一 store 内容和截图关键区域。
4. mutation gate：在 inline 发送键盘、指针、clipboard 和 app-only write，revision 与 snapshot hash 均不变。
5. quota race：并发创建到 limit，只允许规定数量成功。
6. stale generation：服务运行时发生外部 generation 变化，下一次写入不得静默覆盖。
7. fixture isolation：测试 workspace 达到上限不影响用户 workspace。

浏览器验收测试不得只查询 DOM 中是否存在 iframe；必须等待 runtime phase 为 `ready`，再检查可见像素/截图和用户交互结果。

## 7. 分仓库交接清单

### OpenChamber

- [ ] MCP App 生命周期诊断事件与错误码。
- [ ] CSP/securitypolicyviolation/script failure 诊断。
- [ ] ready-but-blank 检测。
- [ ] 诊断摘要 UI，默认不暴露敏感信息。
- [ ] Official Excalidraw 在线/离线失败态验收。
- [ ] inline read-only App 在聊天、App Board、fullscreen 的容器测试。

### OpenCode Fork

- [ ] resource `_meta.ui.csp` 全链路单测。
- [ ] App resource API 返回 CSP 与权限元数据。
- [ ] quota 结构化错误不被压扁为普通文本。
- [ ] app-only Tool、session/message/server/resource 五重绑定回归。
- [ ] Legacy Excalidraw 与 MCP 2026 tldraw 同时连接回归。

### tldraw-mcp-app

- [ ] inline 使用真实 tldraw read-only renderer。
- [ ] camera interaction 与 mutation gate。
- [ ] revision provenance。
- [ ] fixture workspace 隔离。
- [ ] 配额拆分与 capacity 诊断。
- [ ] 服务端事务化 archive/cleanup。
- [ ] create idempotency 与 quota 错误 schema。
- [ ] 移除生产默认 `interop-acceptance`。

### Acceptance Lab

- [ ] 官方 Excalidraw 远程服务。
- [ ] SHA 固定的自托管 Excalidraw。
- [ ] 可断网的离线 Excalidraw derivative（独立 provenance）。
- [ ] 独立 tldraw 测试 workspace。
- [ ] 每轮自动 setup/teardown。
- [ ] 网络、CSP、quota、历史 revision 故障注入。

## 8. 验收用例

### 7.1 Excalidraw P0

| 编号 | 场景 | 通过标准 |
|---|---|---|
| EX-01 | 官方 `create_view` | Tool selected、resource resolved、AppBridge ready、图形首屏可见 |
| EX-02 | 正常 `esm.sh` | 所有声明模块成功加载，无未声明 origin |
| EX-03 | 阻断 `esm.sh` | 10 秒内显示 `dependency_unreachable/blocked`，不能黑屏 |
| EX-04 | CSP 丢失注入 | 明确显示 `csp_metadata_missing`，不得扩大到 `*` |
| EX-05 | AppBridge 不初始化 | 超时后明确失败并可 Retry |
| EX-06 | App 初始化但不画 UI | 显示 `ready_but_blank` |
| EX-07 | 历史任务恢复 | 重启后 resource 与 Tool Result 重新绑定并渲染 |

### 7.2 tldraw 预览 P0

| 编号 | 场景 | 通过标准 |
|---|---|---|
| TL-01 | inline 初次加载 | 与 Edit 使用相同字体、shape、arrow、asset |
| TL-02 | inline zoom/pan | 可缩放和平移，revision 不变化 |
| TL-03 | inline mutation | 移动/删除/输入/粘贴均被拒绝 |
| TL-04 | inline → Edit | 同 canvas、同 revision、相同内容和 camera |
| TL-05 | Edit → inline | 未保存修改有明确确认；已保存内容一致 |
| TL-06 | App Board | tile 内可只读缩放，fullscreen 打开全宽容器 |
| TL-07 | 大画布 | 100+ shape 仍能缩放浏览，无自研 SVG 丢形 |

### 7.3 revision P1

| 编号 | 场景 | 通过标准 |
|---|---|---|
| RV-01 | 查看 r1 | 展示准确内容和来源标签，不误称 latest |
| RV-02 | 历史 Review | 只读，可缩放，不可保存 |
| RV-03 | Restore r1 | 新增 rN，旧 r1 与旧 latest 不变 |
| RV-04 | fixture | 默认用户列表不可见 |
| RV-05 | 迁移 | canvas/revision/hash 对照完整，无历史篡改 |

### 7.4 quota P0

| 编号 | 场景 | 通过标准 |
|---|---|---|
| QT-01 | 达到 active limit | 返回结构化计数与建议，不复用其他 canvas |
| QT-02 | archive 后创建 | 通过服务端事务后立即可创建，无需猜测重启 |
| QT-03 | lost response retry | 相同 idempotency key 只产生一个 canvas |
| QT-04 | 并发创建 | 不超过 limit，不出现目录覆盖 |
| QT-05 | 测试 teardown | 临时画布被归档/清理，用户画布不变 |
| QT-06 | stale memory 注入 | generation 不一致时拒绝写入或安全 reload |

## 9. 必须采集的验收证据

每个主链至少需要：

1. Tool selected 截图或结构化 trace。
2. resource URI、MIME、SHA256 和 CSP 摘要。
3. AppBridge ready 事件。
4. 首屏可见截图。
5. 用户交互录屏（zoom、pan、Edit、历史 Review）。
6. revision 前后状态与服务端持久化证据。
7. quota/故障注入的结构化错误。
8. 重启 OpenChamber、重启 MCP Server、恢复历史任务后的截图。
9. secret scan 结果。

禁止把以下情况计为通过：

- 只有 Original Tool Output；
- iframe 是空白；
- Retry 后偶然成功但没有根因；
- 仅源码模式通过、DMG 失败；
- tldraw SVG 近似图与真实 Editor 内容不一致；
- Agent 自动复用无关 canvas。

## 10. 推荐实施顺序

1. **先做 P0-A 诊断**：没有浏览器阶段证据时，不继续猜 Excalidraw 空白修复。
2. 修通官方 Excalidraw 在线路径，并完成明确的离线失败态。
3. **做 P0-C quota**：阻止测试继续污染共享画布和 revision。
4. **做 P0-B 单渲染引擎**：统一 tldraw inline / Edit。
5. 做 P1-D revision provenance 与 fixture 迁移。
6. 源码模式完整回归。
7. 打包 DMG，使用干净 profile 与历史 profile 各跑一轮。
8. 仅在所有 P0 用例有证据后发布 prerelease。

## 11. 发布门禁

以下任一项未满足，不得宣称 MCP Apps 已完整完成：

- Excalidraw 官方页面仍可能无诊断地空白。
- tldraw inline 与 Edit 仍由不同最终渲染引擎负责。
- inline 只读模式仍能修改业务 document。
- quota 错误仍会诱导 Agent 复用共享画布。
- fixture revision 仍默认暴露给普通用户。
- 历史恢复出现 403/404 或 session/resource 绑定错误。
- DMG 中的内置 OpenCode Fork 与源码验收版本不一致。

## 12. 不在本轮范围

- Marketplace。
- MCP 2026 OAuth。
- 多用户组织级 RBAC/ABAC。
- 修改官方 Excalidraw 上游产品功能。
- 将 tldraw/Excalidraw 转换成 OCIX。
- 通过放宽 sandbox 到任意网络来规避 CSP 问题。
