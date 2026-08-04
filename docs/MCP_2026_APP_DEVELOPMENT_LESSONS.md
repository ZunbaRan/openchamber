# MCP 2026 App 开发与验收经验

本文记录 OpenChamber 严格 MCP `2026-07-28` tldraw App 在真实开发、打包、
本地运行和宿主验收中的关键经验。它不是协议规范替代品，而是避免重复踩坑的
工程约束。

这里的版本必须分开理解：`2026-07-28` 是 MCP Core；MCP Apps 使用独立的
stable `2026-01-26` 规范；当前 View 固定 `@modelcontextprotocol/ext-apps`
`1.7.5`。`ui/download-file` 与 model-context modality capability 字段属于当前
SDK 的可选扩展能力，不应被写成 Apps stable 或 Core 的必选能力。Host 必须只在
实现后声明，App 必须有明确的 unsupported 降级路径。

除非明确写出手工或打包客户端证据，下文的“已实现”只表示代码、协议探针和聚焦
自动化契约已经覆盖；它不等于真实浏览器可见性、文件落盘或打包客户端已经完成
人工验收。

实现从 OpenChamber 单体测试目录中拆分后，责任边界固定为：

- 独立 `tldraw-mcp-app` 仓库拥有 Server、App、持久化状态、构建、生命周期、
  Docker 镜像和服务端协议测试；
- OpenChamber 只保存 MCP 连接、能力协商、App Host/AppBridge、聊天渲染、Pin、
  App Board 与消费端验收；
- 客户端只依赖 URL 和协议，不依赖服务仓库路径、源码或构建目录；
- 为保证历史会话兼容，首版拆分不更改 MCP 配置键
  `interop-tldraw-2026`、`ui://openchamber/interop-tldraw-contract-v5.0.2`
  或六个 Tool 名。

这也是 MCP App 推荐的部署形态：Server 能独立运行、升级和被多个兼容客户端
连接，宿主客户端不打包第三方服务实现。OpenChamber Lab 中保留的构建/生命周期
脚本只是需要显式指定 `INTEROP_TLDRAW_MCP_REPO_DIR` 的开发兼容转发器，不属于
正常运行链路。

## 1. 先建立本地回环基线

远程服务器、Tunnel、DNS 或企业网络变化不应阻塞 MCP App 本身的开发。
先在 `127.0.0.1` 上跑同一个 Streamable HTTP Server，并完成协议与 UI 两层
验收，再把端点换成远程地址。

本项目的入口见
[Interop Acceptance Lab Runbook](../extension/interop-acceptance-lab/RUNBOOK.md#local-loopback-tldraw-mcp)。
OpenCode 配置中的 `type: "remote"` 只是“HTTP transport”的 schema 名称；
当 URL 是 `http://127.0.0.1:39512/mcp` 时，服务仍完全运行在本机。

本地基线必须验证：

- 严格协商到 `2026-07-28`，而不是因为工具能列出就假定协议正确；
- 客户端确实声明 MCP Apps extension capability；
- `ui://` resource 的 MIME、内容和 SHA-256 正确；
- 模型可见 Tool 与 App-only Tool 的 visibility 正确；
- 真实 OpenChamber 中能渲染、编辑、保存、导出、Pin 和恢复历史。

健康检查或纯协议探针不能代替宿主 UI 验收；fallback 和 Original Tool
Output 也不能记为成功。

本地完整链路应优先运行自包含入口：

```bash
bun run test:tldraw-mcp-app-browser:self-contained
```

它验证 standalone distribution 后，使用动态 loopback 端口和临时 HOME/XDG、
OpenChamber data、OpenCode config/database、tldraw store 启动真实 Server、managed
OpenCode 与 OpenChamber，再执行模型选 Tool、inline、fullscreen 编辑、App-only Save、
SVG/PNG 下载、历史恢复和 App Board 全屏。Provider auth 只通过进程环境注入隔离的
OpenCode，不复制到测试目录或报告；无论正常、失败还是 SIGINT/SIGTERM，编排器都必须
终止其进程组、确认端口释放并删除临时 Runtime。旧的
`test:tldraw-mcp-app-browser` 只适用于显式连接已启动 Host 的诊断，不属于自包含发布证据。

尤其要区分四个经常被混为一谈的信号：

| 信号 | 只能证明什么 | 仍然不能证明什么 |
|---|---|---|
| `/health` 返回 200 | Server 进程、App artifact 与基本依赖可用 | OpenCode 已连接、协议已协商、模型能看见 Tool |
| `server/discover` / 初始化成功 | 客户端与 Server 能以 `2026-07-28` 通信 | Apps capability 被逐请求携带、UI 能解析 |
| MCP connection 显示 connected | transport 和一次发现流程成功 | 当前会话实际使用的是支持 Apps 的 fork CLI |
| 模型真实选中 Tool | Tool 已进入当前模型的候选集合 | `ui://` resource、AppBridge 和用户交互链路成功 |

因此“服务健康但模型看不到工具”时，不要继续改 App HTML。应依次核对实际 CLI
路径与版本、`/global/capabilities`、connection 的 `protocolVersion` / `era` /
`adapter` / Apps capability、模型侧过滤后的 Tool 列表，以及会话是否在配置变更后
完成 reload。此次验收中，官方旧 CLI 可以连接 Tool，却不会提供完整 Apps 能力；
只有切换到对应 OpenCode fork 后，Qwen 才真正发现并调用 tldraw Tool。

## 2. App 必须真正离线

“HTML 已内联”不等于“App 可离线”。tldraw 仍可能通过字体、图标、翻译、
embed 图标或运行时 chunk 请求 CDN。可靠构建需要：

1. 固定官方 tag、commit 和依赖版本；
2. 将 JS/CSS、字体、图标、翻译和运行时资源全部打入 App artifact；
3. 记录最终 HTML digest 和资源数量；
4. 启动前再次校验 provenance 与 digest；
5. 在断网条件下打开真实 iframe，而不只搜索源码字符串。

独立服务仓库的本地 manager 对 tldraw v5.0.2 校验官方 commit、最终 HTML SHA、
162 个图标、19 个 embed 图标、16 个字体和 3 个翻译资源。任一项不符都拒绝启动。

当前 App 把图标、字体和翻译保持为已校验、符合 CSP 的 `data:` URL，并直接
通过 tldraw `assetUrls` 提供；不再转换为 `Blob`，也不创建需要
`URL.revokeObjectURL` 的 `blob:` object URL。验收必须在断网的 fullscreen
真编辑器中逐个查看工具栏、菜单、缩放器和 minimap，并切换英文、简体
中文和繁体中文；构建产物里“存在资源字符串”仍然不是运行时证据。

## 3. 自包含资源大小必须按真实产物验收

完整离线 App 往往比普通 HTML 大。当前 tldraw App 的最终 `ui://` HTML 是
`4,547,679` bytes（SHA-256
`61192b801ccaf582a09280478056ac60efccd308520c062ef34f443104b1ad3e`），超过 OpenCode
原有的 4 MiB 限制；Tool 调用和 MCP resource
读取都成功，但宿主最终只显示一个容易误判成 Server 404 的空白/失败页面。

这里实际遇到了两个独立问题。第一个是 MCP resource 上限：

- 限制必须作用于 UTF-8 实际 bytes，而不是字符数或压缩包大小；
- 错误日志必须同时记录实际 bytes、上限、server 与 resource URI；
- 当前 OpenCode fork 使用有界的 8 MiB 上限，与 Hosted OCIX 的页面预算对齐；
- Server 回归必须读取真实的 `4,547,679`-byte tldraw bundle，并继续拒绝超过
  8 MiB 的资源；
- 调大上限不能替代离线资源审计、SHA 校验和 iframe capability policy。

第二个问题出现在 Host materialization：把这份 4 MB+ HTML 再编码进 `data:` URL
的方案在真实宿主中仍然失败。base64 还会继续放大 URL；即使字符串 round-trip
测试通过，也不能证明浏览器会稳定导航并执行这个超大 document。不要把这次失败
推导成所有浏览器统一的精确 URL 上限，也不要再把大型 App HTML 放入 Loader 或
App 的导航 URL。

当前实现由 Host 校验 resource identity、注入最终 CSP 并保留原始 HTML。外层
iframe 先运行一个小型、source-authenticated 的 opaque Loader，Host 以 nonce、
identity、UTF-8 byte 数和有界 chunk 完成传输握手；Loader 确认完整性后只发出允许
切换的信号，不负责把 App 导航到 Blob URL。Host 随后通过 iframe 的 DOM
`srcdoc` property 挂载最终 HTML，并保持 `sandbox="allow-scripts"`，不授予
`allow-same-origin`。大型 HTML 因而既不进入 React virtual DOM，也不被编码进
导航 URL。

页面不能仅凭某一次 `load` 判定成功。当前 readiness 同时要求最终 App document
的 `load` 与 AppBridge `initialized` 握手，两者顺序可以互换；大型页面的 ready
timeout 为 45 秒。初始化完成前由 Loader 被替换引发的竞态 load 可幂等处理，ready
之后再次导航则立即撤销授权。聚焦测试用真实 4.4 MB 输入覆盖 chunk transfer、
最终 `srcdoc` mount、双条件 readiness 和超时，但仍不能代替真实浏览器可见性验收。

遇到“Tool 成功、resource 探针成功、宿主仍然空白”时，应先检查 CLI 的 resource
size limit、Host bootstrap URL 是否意外包含完整 App，以及相关日志，再去修改 MCP
Server 或 App 前端。

## 4. Canvas identity 与 revision 是不同概念

`canvasId` 是业务身份，`revision` 是并发版本。保存时绝不能用 revision、
message ID、渲染次数或临时 iframe nonce 重新生成 canvas identity。否则会出现
“点击 Save 后跳到另一张画布，切换会话后又恢复”的典型故障。

约束如下：

- `tldraw_open_canvas` 返回的 `canvasId` 是本次 App 实例的稳定主键；
- AppBridge 后续 apply/save/export 必须显式携带同一个 `canvasId`；
- 每次写入携带 `expectedRevision`，服务端用 revision fence 拒绝陈旧写入；
- 成功保存只递增 revision，返回的 `canvasId` 必须不变；
- React effect、iframe reload 和 session replay 不得覆盖已绑定 identity；
- 历史恢复按 ToolPart 中的结构化数据重新绑定，而不是创建默认画布。

协议探针应使用隔离 canvas ID，记录 save 前后 revision，并断言 identity 不变。

### 4.1 冲突必须 fail-closed，并保留本地草稿

revision conflict 不是普通网络错误。服务端应在失败结果中返回当前 canvas 和
revision，客户端据此标记本地基线已过期；不能把旧请求原样无限重放，也不能声称
已经自动合并。当前约束是：

1. 首次 mutation 携带精确 `expectedRevision`；
2. 冲突时接受 Server 返回的权威状态，或重新调用 read/open；
3. 保留本地 editor draft，不用 Server state 静默重绘；
4. UI 明确提示冲突，并要求用户选择重新审阅后再次 **Save**，或 **Discard** 加载
   Server 版本；
5. 未经用户选择不生成新的写请求，更不能覆盖其他写入。

只有不确定请求是否到达 Server 的 transport failure 才能使用同一 idempotency key
和完全相同 payload 重试；一旦 Server 明确返回 revision conflict，就必须结束该次
attempt 并保持草稿。这避免双击 Save、App 与 Agent 同时编辑、历史页面恢复后继续
写入时发生 last-write-wins 数据丢失。

### 4.2 历史会话与 Pin 只能把 ToolPart 当作启动快照

聊天记录和 App Board Pin 中的 `structuredContent` 是可复现 UI 的启动快照，不是
长期权威数据。App 初始化后应：

- 先绑定 Tool input/result 中的 `canvasId`，绝不回退到默认 canvas；
- 用快照快速绘制 inline preview；
- 随后按同一个 ID 读取 Server 权威状态；
- 只接受相同 canvas 且 revision 不低于已知值的响应；
- mutation 返回后再次更新模型上下文与可持久化 envelope。

这样，历史会话、Pin、App Board、刷新和重连都能恢复到最新 revision，同时仍能在
Server 暂时不可用时明确展示“保存的快照”，而不是悄悄创建另一张画布。

### 4.3 Dirty 状态必须延迟合并，不能静默覆盖

fullscreen editor 有本地未保存编辑时，新的 Tool result、权威 refresh 或 revision
conflict 不能直接重绘 editor。当前 App 保存最新 Server state 为 pending，保留本地
编辑，并要求用户重新审阅后再次 **Save**，或显式 **Discard** 加载 Server 版本。
退出 fullscreen 和页面卸载也会在 dirty 时被阻止或触发浏览器确认。这里的“确认”
是 Save/Discard 选择与关闭保护，不应写成不存在的自动合并。

Save 必须是一次原子调用，而不是 `patch → note operations → save snapshot` 三段写入。
当前 `tldraw_save_canvas` 在同一个 revision fence 中携带完整 snapshot、可选 canonical
`diagramPatch`、可选 `noteOperations`、operation summary 和稳定 `idempotencyKey`；
Server 要么验证并一次提交全部内容、只递增一次 revision，要么完全不写入。对于响应
丢失等不确定失败，客户端保存并按 byte-equivalent 语义重用整份 atomic payload，
服务端返回原提交 receipt 而不再次递增 revision。请求飞行期间产生的新编辑继续保持
dirty，不能被本次成功响应清除。

### 4.4 App Board 更新是内容寻址 pointer swap，不是原地改快照

MCP App Pin 到 App Board 后，App 的 `updateModelContext` 不应直接改 Board JSON 或覆盖
旧 snapshot。可靠顺序是：

1. 规范化并完整写入不可变、内容寻址的新 snapshot；
2. 校验 snapshot digest 可以重新读取；
3. 在项目锁内以 Board `expectedRevision` 做 compare-and-swap；
4. 同时校验 Tile 当前 `snapshotRef` 仍是调用方读到的
   `expectedSnapshotRef`；只校验 Board revision 后盲目重放旧 Envelope 会覆盖另一
   窗口刚提交的新 pointer；
5. 只在 CAS 成功后切换 Tile snapshot ref、Context digest 并递增 Board revision；
6. 任一步失败都保留旧 ref、旧 revision 和仍可恢复的旧页面。

MCP snapshot 还必须锁定创建时的 `server`、`resourceUri` 和 `toolKey`。更新可以改变
result、title、`structuredContent` 与模型上下文，但不能借由普通 AppBridge 调用把一个
已授权 Tile 改绑到另一个 Server、Resource 或 Tool。`updateModelContext` 的成功回执
必须等到 snapshot 与 Board pointer 都已持久化；并发更新要串行化，并让后一项基于前一
项已经提交的 Envelope。revision conflict 后可以 reload，但只有 Tile 的
`snapshotRef` 仍等于本次调用的 precondition 才能重试；否则必须把冲突返回给 App，
不能把旧 Envelope 重新覆盖到新 pointer。这样进程中止、重复请求和多窗口竞争都不会
制造半份 Board。

Pin 去重也不能使用内容寻址的 `snapshotRef`：同一 canvas 每个 revision 都会得到新
ref。MCP App Tile 的稳定身份至少包含 server、resource、tool key、完整 canvas
authority 与 canvas ID，并辅以原始 session/message/ToolPart identity；同一 canvas
的重复 Pin 应聚焦既有 Tile，不同 authority 下同名 canvas 必须保持分离。

重启恢复时先从已验证 snapshot 快速绘制，再用相同 binding 和 entity/canvas ID 连接
Server 权威状态。snapshot 是启动与离线回退证据，不是绕过 MCP Server 授权的缓存入口。

### 4.5 `canvasId` 相同不代表属于同一个服务实例

真实本地回归还暴露了一个比 revision 更外层的身份问题：两个 installation、scope 或
workspace 可以合法地拥有相同 `canvasId`。如果 App 的 sessionStorage 只按 canvas 名称
缓存，切换配置、服务器或工作区后会把旧预览和 dirty draft 错认成当前权威状态。

因此每份 Server state 都携带由 distribution、installation、scope、workspace 与
resource URI 组成的 `authority`；App 的 preview/draft cache key 使用完整 authority 加
`canvasId`。旧版无 authority 的 cache 必须清除，缺字段、未知字段或 identity 不匹配都
fail-closed。installation identity 由稳定部署种子派生，而不是随机进程 ID，否则每次
重启都会让合法缓存失效。

### 4.6 tldraw 内部 Vec 不能直接进入语义协议

一次真实 Save 在浏览器中返回了精确错误：`points[*].z: unknown field z`。画布看起来
正常，原因却是 tldraw transform 返回的 Vec 对象除了 `x/y` 还带内部 `z`，应用把它直接
放进严格 semantic patch。TypeScript 的结构类型和 JSON 序列化不会自动删除额外字段。

协议边界必须显式投影：每个 point、endpoint fallback 和 line handle 都重新创建为纯
`{x, y}`，不能 object spread、不能返回编辑器对象引用。严格 Server 继续拒绝未知字段；
修复应发生在 App serializer，而不是放宽 schema。四点以上 TLLine 还要按 index 排序并
保留全部折点，不能退化成首尾两点。

### 4.7 Legacy 投影只能更新它真正表达的字段

App-only `add note` 属于旧 note schema，但画布可能已经是 rich semantic v2。曾经的实现
在增加一张便签后重新用 Legacy diagram/notes 构造整份 semantic document，导致既有
frame/group、字体、fill、dash、旋转、尺寸、arrowhead 与 polyline bends 静默丢失。

正确做法是比较 mutation 前后的 Legacy projection：未变化的 element 原样保留；变化
对象只更新 Legacy schema 实际拥有的字段；新增/删除对象才新增/删除。节点移动导致连接
端点变化时，仅更新首尾，保留中间折点。该约束必须用行为测试比较完整结构，源码 regex
无法发现这种“请求成功但数据降级”的缺陷。

## 5. App-only 不是“只在模型列表里隐藏”

App-only Tool 至少需要两层防线：

1. Tool discovery 中对模型隐藏，对绑定 App 可见；
2. AppBridge tool-call 服务端校验完整绑定。

OpenChamber/OpenCode 的调用应同时绑定：

- session；
- message；
- 精确 ToolPart ID；
- MCP server；
- `ui://` resource；
- Tool key（不能只信 iframe 传入的显示 name）；
- 当前 resource nonce / source window。

同一 message 可以包含多个使用同一 resource 的 ToolPart，所以 message 级绑定仍然
会串画布。OpenCode 必须读取 completed ToolPart，再验证 session/message/part/server/
resource/origin tool key，以及目标 Tool 的 App-only visibility；任一不匹配返回 403。
仅凭 tool name 或 iframe 发来的 JSON 转发请求，会允许跨会话、跨 Server 或伪造窗口
调用。UI 隐藏按钮也不是权限控制。

公开 SDK 尚未包含新绑定字段时，宿主可以临时使用复用同一 runtime base URL、认证、
directory 与 AbortSignal 的窄 HTTP wrapper；但 release 门禁仍必须从当前 HttpApi
重新生成并发布匹配版本 SDK，不能长期维护手写分叉类型。

本项目把 visibility 明确分成三类。按照当前 MCP Apps 兼容规则，省略
`visibility` 时按 `model + app` 处理；显式空数组、非字符串数组或未知值则
fail-closed，不能借“解析失败”扩大权限：

| 类别 | tldraw Tool | 用途 |
|---|---|---|
| `model` | `tldraw_read_me` | 让模型读取契约和当前 revision，不允许 App 借此扩大能力 |
| `model + app` | `tldraw_create_view`、`tldraw_patch_shapes`；兼容入口 `tldraw_open_canvas`、`tldraw_patch_diagram` | Agent 创建/修改图，也允许已绑定 App 做权威 refresh |
| `app` | `tldraw_get_canvas_state`、`tldraw_list_canvas_revisions`、`tldraw_restore_canvas_revision`、`tldraw_apply_operations`、`tldraw_save_canvas`、`tldraw_export_snapshot` | 只接受 AppBridge 绑定调用，不进入模型候选列表 |

Server 的 `tools/list` 可以保留完整 metadata，但交给模型的工具集合必须在 CLI 侧
按 visibility 过滤。相反，AppBridge 也不能调用任意已连接 MCP Tool，只能调用与
当前 resource 绑定并允许 App visibility 的 Tool。

## 6. Save 与 Export 需要可观察的闭环

保存成功必须同时具备服务端 revision 变化和 UI 可见状态更新。不能只在 App 内
更新本地 store，也不能只收到 200 就替换当前 snapshot。

Host 还必须区分三个通道：原始模型 Tool 的 lifecycle result、App-only Tool call 的
直接响应、App 自己的 `updateModelContext`。后者只是持久化模型上下文，不是又执行了
一次原始 Tool；同一 AppBridge epoch 不能因为持久化 Envelope 改变而再次
`sendToolResult`。真实浏览器测试曾出现 Save 已成功从 revision 2 写到 3，随后 compact
model context 被 Host 回显给 `ontoolresult`，覆盖成“缺少 canvas identity”的错误。
可靠实现每个 Tool lifecycle/bridge epoch 只发送一次 completed result；remount/reset
进入新 epoch 后，才允许把已持久化的启动结果发送一次用于恢复。

导出包含三个彼此独立的步骤：

1. App 使用真实 tldraw `getSvgString` / `toImage` renderer 在本地生成 SVG/PNG
   bytes；
2. App-only export Tool 向服务端提交格式、长度、digest、shape count 和 revision
   receipt；
3. App 通过当前 SDK 的可选 `app.downloadFile` 请求 Host 保存真实 bytes。Web Host 显示
   “不可信 MCP App 导出”的确认层，接受后才触发浏览器下载；
   Desktop 通过受信 IPC 选择路径并原子写入。

自动化测试可以证明 renderer、调用顺序、校验和确认策略，但只有实际选择保存路径
并检查文件，才能声称完成真实下载验收。

宿主的 download capability policy 决定这些 bytes 能否落盘。Host 禁止下载时，
导出 receipt 仍可成功，但 UI 必须明确显示“已生成、下载被宿主策略阻止”或对应
错误，不能让按钮看起来毫无反应。测试需分别证明渲染、receipt、下载策略三项，
不要把其中一项的成功当作全部成功。

文件下载应走当前 MCP Apps SDK 的可选 `ui/download-file` 语义（App SDK 中为
`app.downloadFile`），而不是页面自行构造 `<a download>`、打开外链或直连 API。
它不属于 Apps stable `2026-01-26` 的必选能力；
App 发送文本 SVG 或 base64 PNG resource；Host 只有在确实实现下载时才声明
`downloadFile` capability，并在落盘前显示“来自不可信 MCP App”的用户确认。

桌面端落盘属于宿主安全边界，当前实现采用：每窗口 single-flight、文件名/MIME/
扩展名/base64/20 MiB 上限校验，在目标同目录以 `wx` 和 `0600` 创建随机临时文件，
写入、`fsync`、关闭后再 `rename` 原子替换，失败或取消时清理临时文件。这样既
避免并发弹窗放大内存，也避免读者观察到半文件，并降低用户选择路径被竞态替换为
符号链接的风险。Web Host 也必须先显示确认层，取消时向 App 返回可观察的拒绝，
不能静默吞掉点击。

下载确认是人机交互，不能继承普通短 RPC timeout。App 应为 `downloadFile` 使用足够长
且明确的等待窗口（当前基线为 5 分钟），并在 Host 等待用户决定时保持 exporting/
waiting 状态。Web Host 的确认层必须是 Host-owned、每窗口 single-flight，展示文件名、
MIME、大小和不可信来源；Save 后检查真实文件 bytes/digest，Cancel、Abort、窗口关闭或
超时都向 App 返回可观察错误。只看到 export receipt、点击按钮或浏览器事件，不等于
文件下载已经通过。

下载和保存的恢复测试必须跨客户端重启：先保存 model context/Server revision 并 Pin，
重启后恢复同一 canvas/entity、revision 和 snapshot ref，再执行一次导出。若重启后创建
了默认画布、换了 binding 或只有旧预览，说明持久化链仍未闭环。

## 7. Inline、Fullscreen 与 Workbench 是三种布局

不能用一个固定 `maxHeight` 覆盖所有宿主位置：

- conversation inline：同一棵真实 tldraw v5 renderer 的紧凑只读呈现，隐藏编辑 UI，
  提供 **Edit**；不得恢复第二套 semantic-SVG 稳态 renderer；
- fullscreen：才挂载完整离线 tldraw editor，允许保存和真实 SVG/PNG 导出；
- App Board / workbench：填满 tile 内部可用区域，并保留外层 tile controls。

嵌套 iframe 的宽高需要由宿主真实容器测量并在 layout 变化后重新发布。
Workbench 应以 tile content box 为准，而不是 conversation 的元数据尺寸或首帧
测量值。可用 `ResizeObserver` 处理拖拽 resize、侧栏展开和 popout，但必须防止
每次测量制造新的 envelope identity，导致 App 被反复 materialize 或重载。

MCP Apps 的 `HostContext` 才是 App 的布局权威来源。App 在初始化时读取
`app.getHostContext()`，监听 context change，并根据 `displayMode`、width、height、
theme、locale 和 safe-area 更新布局；进入 fullscreen 前使用
`app.requestDisplayMode({ mode: "fullscreen" })`，不能自行把 iframe 定位到 viewport。
Host 在进入 fullscreen 时立即发布 viewport 尺寸，退出时等待顶层 dialog 完成布局
再发布 inline/workbench 尺寸；否则编辑器会短暂拿到旧的全屏 box，造成半屏、裁剪
或控制条错位。

同一 editor/store 可以跨模式保留 document identity，但不能因此无条件保留旧 camera。
本轮真实 Electron 验收发现：inline 的小容器 camera 被 fullscreen 继承后，内容只有约
7% zoom；从 fullscreen/App Board 返回 inline 后，拓扑又可能偏到右侧并被裁切。进入新
display mode、HostContext container 尺寸稳定或 tile resize 后，应重新执行有界的
`zoomToFit`（或等价 camera 适配），同时断言 document hash、dirty、canvasId 和 revision
均不变化。只检查 renderer 未 remount 或 `.tl-canvas` 非零尺寸仍可能假绿。

验收不能只看“iframe 存在”：要测量其实际可见宽高、检查 clip/overflow，并确认
App Board 全屏时不只占半屏。

### 7.1 数据更新不是 document 更新

Host 必须把 MCP App document identity 与 Tool result/model context 分开。result、title、
`structuredContent` 和等价 metadata 对象重水合，只能通过 AppBridge 更新数据，不能因为
React object identity 改变而重建 `srcdoc`、iframe、nonce 或编辑器实例。document policy
应由稳定的原始值组成；effective CSP 最好归一化为可比较的 primitive。

只有 verified resource identity/digest、effective CSP policy 变化，或用户显式 Retry，
才允许重新 materialize。重新加载要执行 teardown barrier：先撤销旧 window/nonce 的
授权并关闭 bridge，再创建新 document；旧 window 的迟到消息必须拒绝。否则等价 Tool
更新会清空编辑器，真正的资源更新又可能同时保留两个有权限的 bridge。

同样，退出 focused/fullscreen 不只是隐藏外层 Dialog。关闭按钮、Escape、backdrop、
Workbench Focus 退出和宿主布局切换都必须显式请求/发布 `displayMode=inline`，等顶层布局
稳定后再发送 inline 尺寸。验收要检查 inline preview 和 Edit 控件确实恢复，而不是只看
Dialog 已消失。

### 7.2 Running ToolPart 也必须保持同一棵 App 文档树

模型调用尚在 `running` 时，只要 CLI 已发布经过验证的 Server、Tool 与 Resource binding，
Host 就应挂载同一个 MCP App，并在完成后原地更新结果；不能先把它塞进 Activity，完成后
再重建 iframe。AppBridge 通知必须严格串行：先发送最新 Tool input，再读取当前 Envelope
并至多发送一次最新 completed result。input 通知延迟、重复 SSE 或 running→completed
竞态都不能让旧 result 越过新 input。

`updateModelContext` 只在 canonical ToolPart 已 completed 后提交。Host 同时把有界 text 与
`structuredContent` 写入 ToolPart metadata，并把等价的紧凑文本投影到 `state.output`；
OpenCode 的下一轮模型上下文读取的是 output，而不是宿主私有 metadata。只更新 iframe 或
App Board snapshot 会造成“页面看起来已保存，模型仍看到旧 revision”的隐性分叉。

## 8. 先确认运行的是哪一个 OpenCode CLI

MCP App 失败经常被错误归因到 UI 或 Server，实际原因可能是 OpenChamber 启动了：

- 较旧的官方 OpenCode；
- 高级设置覆盖的 external CLI；
- 版本落后的 OpenCode fork；
- 支持 Tool 但未协商 Apps capability 的 CLI。

诊断顺序：

1. 记录实际二进制路径与版本；
2. 查询 `/global/capabilities`；
3. 查看 MCP connection 的 `protocolVersion`、`era`、`adapter` 和 Apps capability；
4. 确认 resource 能解析，再检查 AppBridge；
5. 最后才进入 App 前端调试。

“工具调用成功但页面空白”并不能证明 Server 没问题；严格 Server 在未收到 Apps
capability 时仍返回相同的结构化 canvas state 和文字说明，但宿主不会得到可渲染的
交互 App。

历史恢复还暴露过另一类非常相似的问题：Server 已经返回符合当前完整
`outputSchema` 的 `snapshot`，但 OpenCode 仍使用重启前缓存的 MCP Tool registry，
把响应按旧的 compact schema（`snapshotAvailable`）校验，最终报出
`required snapshot` / `additional snapshotAvailable`。直接对当前 Server 做协议调用时
输出完全正确，说明继续修改 Server payload 反而会掩盖根因。此时普通页面刷新或
仅 reload 会话不一定重建 registry；必须对该 MCP connection 执行真实
**Disconnect → Connect**，再确认新的 Tool schema 和 resource binding 已重新发现。

### 8.1 证据必须按事实分列，不能互相替代

一次验收里至少存在七类事实，每一类只能证明它自己，永远不要把其中一项说成另一项：

| 事实 | 怎么取 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| 源码 commit | fork/App 仓库 `git rev-parse HEAD` | 代码基线 | 构建产物内容、打包内容、运行时行为 |
| tldraw dist App SHA-256 | `verify-dist.mjs` 与 `tldraw-provenance.json` | 分发的 App artifact 就是该字节序列 | 宿主能渲染、模型能发现 Tool |
| Server PID / 启动时间 | orchestrator 记录 spawn PID 与时间 | 进程确实由本次 orchestration 启动 | 该进程使用哪个 CLI、UI 是否真实可见 |
| app.asar 哈希 / 构建时间 | 对打包产物重新计算并记录时间 | 桌面 UI 资源版本 | UI 真实可见性、CLI 行为 |
| staged CLI 哈希（签名前） | `packages/electron/resources/opencode-cli/distribution.json` 的 `sha256` | 签名前来源完整性；`localOverride`/`version` 可直接核对 | 包内最终字节（本轮 macOS 流程中签名改写字节；其它流程需独立核对） |
| packaged CLI 哈希（签名后） | 对 `.app/Contents/Resources/opencode-cli/opencode` 重新计算 | 包内真实字节 | 与 staged 哈希相同（在已观测的 macOS electron-builder/codesign 流程中签名会改写字节，因而不同） |
| 运行时 resolved 路径 | `GET /health` 的 `opencodeBinaryResolved` + `--version` | 实际启动的 CLI | 由 orchestration 选择（除非显式 pin） |

本轮实测证据：tldraw dist 先验证为 protocol `2026-07-28`、App SHA-256
`4426d8b9f5ca9aa96bc4852a59faea3785bba97b14f71c772792d62555632741`；干净打包的
CLI 版本 `1.18.10-oc.1`。在本轮 macOS electron-builder/codesign 流程中，包内签名后
二进制哈希 `ba7fa584…` 与 staged `fa86f227…` 不同，因为 codesign 改写了 Mach-O
字节；新构建的 app.asar 哈希 `02a3ea5142cf…`（2026-08-05 01:08 构建）。
**“打包签名后哈希 ≠ staged 哈希”在本观测流程中不是失败**。其它平台/打包流程
不一定改写字节，但两个哈希语义始终不同（签名前来源 vs 包内真实字节），因此必须
在任何平台上分别记录、分别核对，永远不要把签名前哈希称为包内最终文件哈希。

### 8.2 旧进程/旧产物会让 UI 诊断无效

- 旧安装的 `app.asar` 可能早于源码 commit，用它得到的 UI 结论基于过期资源，
  必须先按构建时间核对资源版本；
- `~/.opencode/bin`、PATH 或系统安装里的旧 CLI 可能能连接 Tool 却不会协商 Apps
  capability，`/health` 与连接状态都正常，但 UI 永远拿不到 App；
- 残留的 Server/demo 进程仍持有旧端口或旧版本；诊断必须先记录本次进程的
  PID 与启动时间，再确认端口确实由本次启动占用，不能把端口探测当成新进程证据；
- HMR/开发进程也可能伪装成保存或重载缺陷（见第 11 节）。

### 8.3 自包含验收必须 pin OPENCODE_BINARY 并 fail-closed

自包含 orchestration 过去把所有 `OPENCODE_*` / `OPENCHAMBER_*` 从继承环境剥离，
却不显式传 CLI，导致 demo 在 PATH 上启动 `~/.opencode/bin/opencode`（官方
`1.18.4`）而不是 staged/当前 fork。这同时造成假绿（用错 CLI 也能过工具探针）与
假红（fork 源码已改，但 OpenChamber/测试根本没跑那个 fork）。协商门禁最终超时于
“OpenChamber MCP 2026 Apps negotiation did not become ready”，隔离日志只能事后
证明启动的是旧 CLI。

现在 orchestration 在任何 spawn 之前选择精确 CLI：

1. 显式变量 `OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH` 优先；
2. 缺省用 staged CLI `packages/electron/resources/opencode-cli/opencode`；
3. `realpath` 规范化后必须是可执行文件，否则立即失败并给出可操作提示；
4. **绝不回退** PATH、`~/.opencode` 或另一个已安装 CLI（fail-closed）；
5. 选择结果以 `OPENCODE_BINARY=<canonical path>` 显式传入 demo 子进程；
6. `/health` 就绪时校验 `opencodeBinaryResolved` 等于所选 canonical 路径，不匹配
   立即 fatal，而不是轮询到超时；
7. orchestration 报告与日志记录 source / requested / resolved / `--version` 身份证据。

demo 子进程同时注入隔离的 `OPENCODE_CONFIG_CONTENT`：内容固定为**恰好一个**
remote MCP server `interop-tldraw-2026`（`type: remote`、`oauth: false`、
`timeout: 30000`、`enabled: true`），URL 指向本次启动的 tldraw MCP。它通过
OpenCode fork 的 `OPENCODE_CONFIG_CONTENT` 加载器注入，不读取用户/项目配置；
门禁也不再依赖 demo 消费 `OPENCHAMBER_TLDRAW_MCP_URL`（该变量在当前 base 的
demo 中无人消费，已从环境交接中移除）。orchestration 报告记录非敏感 MCP 配置
provenance（server 名与 canonical URL，不含 auth）；协商出现明确的永久错误
（`failed` / `needs_client_registration` / `needs_auth`）时立即 fatal 并给出有界
错误消息，而不是空等 120 秒超时。

```bash
OPENCHAMBER_TLDRAW_ACCEPTANCE_REPO_DIR=/path/to/tldraw-mcp-app \
OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH=/path/to/staged/opencode \
bun run test:tldraw-mcp-app-browser:self-contained
```

聚焦单元测试覆盖显式选择、staged 缺省、缺失/不可执行文件与 mismatch 判定
（`scripts/lib/tldraw-mcp-app-browser-orchestration.test.mjs`），并在完整浏览器门禁
之前运行。

### 8.4 `OPENCHAMBER_OPENCODE_CLI_PATH` 必须覆盖整条打包命令

打包把 `build:web-assets → prepare:opencode-cli → bundle:main → rebuild:native →
package.mjs` 串成一条命令；override 变量只对 `prepare:opencode-cli` 步骤生效，而且
每个步骤都是独立 bun 进程。只对单条子命令设置变量、或中途换终端，都会让其它步骤
按 lock 下载旧制品（当前 lock 的 `forkCommit` 仍是 `bf12c7a7…`，落后于本轮
`67c45489…`），混出 provenance 不一致的包。

正确做法是整条命令统一导出，并在打包前核对 staged `distribution.json` 显示
`localOverride: true`，且 `version`、`sha256` 与本地二进制一致。注意：本地覆盖的
`forkCommit` 在 prepare 脚本中默认写为 `"local-uncommitted"`（除非显式设置
`OPENCODE_FORK_COMMIT`），所以**不要**期望它等于源码 commit；精确源码 commit 必须
独立记录——从 OpenCode 源码 worktree（如 `git rev-parse HEAD`）或该次构建的
provenance 取，并作为与 CLI 版本并列的独立证据保存。

```bash
OPENCHAMBER_OPENCODE_CLI_PATH=/path/to/local/opencode bun run --cwd packages/electron package
cat packages/electron/resources/opencode-cli/distribution.json
bun run --cwd packages/electron verify:opencode-cli:packaged
```

### 8.5 worktree 隔离的构建与测试

在 git worktree 中构建/测试不会污染主 checkout；但 worktree 有自己的
`packages/electron/resources/opencode-cli`（通常只有 `.gitkeep`）、自己的 dist 与
`.tmp`。因此 worktree 必须先 `prepare:opencode-cli` 自己的 staged CLI（或用 env var
显式指向），不能假设 staged CLI 已存在；自包含门禁缺省路径不存在时会立即失败并
给出可操作提示。同一台机器上残留的旧进程仍可能持有端口或旧版本：orchestration 报告
的 `processes` 块会按 role 记录本次运行实际 spawn 的每个子进程的 PID 与 spawnedAt
（tldraw MCP、OpenChamber demo、browser verifier；未 spawn 时为 null），orchestrator
同时终止自己的进程组并确认端口释放；诊断结论只对本次启动的 PID 有效，不能把端口
探测或旧进程当成新进程证据。

干净 worktree 的另一面是“缺被忽略产物”：`.gitignore` 忽略 `dist`，dirty 主 checkout
恰好残留历史构建产物，但干净 worktree 没有
`examples/interactive-ui/acme-sales/dist/ui.mjs`、
`examples/interactive-ui/acme-crm/dist/ui.mjs` 或
`templates/interactive-ui-extension/dist/ui.mjs`——三个 manifest 的 Native view 却都
引用 `dist/ui.mjs`（`openchamber.extension.json` 的 `entry`）。结果
`interactive-ui-system-test` 的 native descriptor 返回 500（其 status 断言处），
`interactive-ui-extension.test` 的 scaffold 验证报 `operations/dist/ui.mjs` ENOENT；
这不是当前 MCP App 产品代码回归。在独立测试 worktree 中补齐同一版本生成资源后，
`node --test scripts/interactive-ui-extension.test.mjs` 6/6、
`bun run test:interactive-ui-security` 27 passed / 0 failed。

长期准则：测试入口必须显式生成/拷贝自己需要的 ignored outputs，fixture 要么
tracked、要么 self-contained，绝不能依赖另一个 dirty checkout 的历史 `dist`。
模板 Native 入口缺产物时要复制/生成真实文件（不要把 symlink 当修复——模板拷贝会
跳过 symlink）。本次只是测试环境补齐，不声称仓库已修复该自包含性问题，也不要引导
去改主 checkout。

### 8.6 四个独立门禁，不能互相冒充

| 门禁 | 入口 | 证明 | 不能证明 |
|---|---|---|---|
| 协议/单元 | `node --test scripts/lib/*.test.mjs`、tldraw `verify-dist.mjs`、协议探针 | 契约、visibility、聚焦行为 | 真实浏览器可见性 |
| 独立浏览器 | `bun run test:tldraw-mcp-app-browser:self-contained`（固定 `OPENCODE_BINARY`，注入隔离的 `OPENCODE_CONFIG_CONTENT`） | 真实 Server + managed OpenCode + 浏览器 + 精确 CLI + 单 remote MCP 配置 | 打包桌面环境 |
| 打包 Electron | `packages/electron/scripts/verify-packaged-interactive-ui.mjs`（断言 `opencodeBinarySource === 'bundled'`、`opencodeBinaryResolved` 等于包内路径） | 打包边界与 bundled CLI | 真实 Computer Use 交互 |
| 真实 Computer Use | 打包应用上的人工/自动化 UI 验收 | 端到端 UI 行为 | 由前三者取代 |

> 当前状态（2026-08-05）：最终 Electron UI 验收仍未完成（pending）；本文不得声称
> 它已通过。

### 8.7 自包含验收必须注册隔离项目身份（Pin/App Board 环境身份）

真实浏览器 E2E 曾通过 tldraw inline / 历史 / 中英文 locale 检查点，却在点击 Pin 后等待
新 App Board tile 超时。浏览器 instrumentation 观测到点击后对
`/api/interactive-ui/workbench/*` 的请求为零。这不是 Pin API、tldraw App 或宿主渲染
bug，而是验收 harness 的环境身份 bug（仓库事实）：

- 隔离 acceptance launcher 启动 demo 时把 `settings.json` 覆盖为只含
  `sessionRecapEnabled` / `sessionSuggestionEnabled` 两个 flag（
  `scripts/interactive-ui-demo.mjs`），没有注册任何 project；
- 权威 message directory 是干净集成 worktree（`projectRoot`），不属于 demo 里唯一
  的合成 'home' 项目；
- `WorkbenchPinButton.handlePin`（`packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx`）
  的 guard 是 `!projectId || pending || disabled`；pending 只在 guard 之后才 set，
  verifier 也只对 enabled 的 Pin action 执行 `button.click()`，两个分支都被排除，
  因此唯一与“点击后零网络请求”一致的路径是 `projectId === null`；
- `resolveWorkbenchPinProject` 对与所有已注册 project 都无关的权威 message directory
  有意返回 null（绝不静默 pin 进无关的 active project），于是 `handlePin` 在发起任何
  网络请求之前 return，只弹 `workbench.pin.noProject` toast。

修复（commit `5b87cb69`）没有放宽 `resolveWorkbenchPinProject`，而是让验收注册真实
项目（仓库事实）：

1. `scripts/lib/tldraw-mcp-app-browser-orchestration.mjs` 新增共享身份 helper
   `deriveWorkbenchProjectId`：与服务端 `createProjectIdFromPath`
   （`packages/web/server/lib/projects/project-id.js`）和 UI `createProjectIdFromPath`
   （`packages/ui/src/lib/projectId.ts`）相同的 `path_<base64url(abs path)>` 归一化。
   Workbench board 以该 id 为键：宿主 Pin 动作持久化进 `projectId`，verifier 轮询
   `GET /api/interactive-ui/workbench/boards/:projectId`，两边必须共用同一个 helper，
   不能各自内联编码；
2. `configureAcceptanceProject` 在 `/health` 就绪后、MCP 协商和浏览器 verifier 之前
   PUT `/api/config/settings`，注册**恰好一个** project：`id` / `path` /
   `activeProjectId` / `lastDirectory` 全部指向验收 worktree；
3. 响应 fail-closed：非 2xx、非 JSON、malformed payload、project 数量不是 1、entry
   `id`/`path` 不匹配、`activeProjectId`/`lastDirectory` 不匹配，任一情况抛错终止，
   绝不把不完整回显当成功；
4. browser verifier（`scripts/verify-tldraw-mcp-app-browser.mjs`）改用同一个
   `deriveWorkbenchProjectId` 计算轮询的 board id；orchestration report 记录
   `acceptanceProject` 证据。

**验收启动顺序（可复用检查清单，推荐）**：

```text
1. spawn 隔离 runtime（临时 HOME/XDG）与精确 CLI（OPENCODE_BINARY，见 8.3）；
2. /health 就绪，并核对 opencodeBinaryResolved 等于所选 canonical 路径；
3. PUT /api/config/settings 注册验收项目，round-trip 校验回显身份；
4. MCP 协商：/api/mcp → connected + protocolVersion 2026-07-28 + apps.negotiated；
5. 浏览器 verifier 检查点（inline → fullscreen → history → locale → Pin/App Board）。
```

为什么顺序不能换（仓库事实 + 推荐）：项目注册必须在 `/health` **之后**，因为 settings
端点由 OpenChamber server 提供，health 是“server 与托管 CLI 已起来”的最早可靠信号，
在此之前 PUT 只会失败或写入半初始化状态。项目注册必须在 MCP 协商**之前**，因为 Pin 是
纯宿主侧行为、不依赖 MCP 连接；若放在协商之后，Pin 失败会被误归因于 MCP 状态，回归
定位退回到“服务健康但 UI 无反应”的歧义。settings 变更必须 **round-trip 校验**：2xx 只
证明请求被接受，不证明 server 持久化的正是所注册身份——server 侧 settings runtime 会
sanitize / migrate / 合并字段（`packages/web/server/lib/opencode/settings-runtime.js`），
必须回读响应并断言恰好一个 project、四字段全部一致，任一不匹配立即 fatal，而不是轮询
到超时。

聚焦测试（`scripts/lib/tldraw-mcp-app-browser-orchestration.test.mjs`）先写红：首个红
测试因为 helper 尚未导出而失败（missing export）；随后把校验从“旧实现会接受错误的
lastDirectory / 额外 project”收紧到 fail-closed 后测试转绿。当前
`node --test scripts/lib/*.test.mjs` 60/60 通过。修复后的最终真实浏览器 E2E 通过全部
11 个检查点（含 Pin/App Board fullscreen），47 次 AppBridge 交换，零
runtime/console/page 错误、零 isError/fallback。证据目录示例（本地示例，不在仓库）：
`.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-04T18-19-09-153Z/`。

这只是验收 harness 的环境身份修复，不是 Pin API、tldraw App 或宿主渲染的改动，也不
能当作打包 Electron / Computer Use 验收：浏览器 E2E 证明的是真实 Server + managed
OpenCode + 浏览器 + 精确 CLI + 单 remote MCP 配置下的宿主行为（见 8.6 四个门禁），
打包桌面环境与真实 Computer Use 验收仍然 pending。

### 8.8 宿主顶层遮挡会造成 iframe 验收假阳性

真实浏览器 E2E 曾出现“交互检查通过但用户可见 UI 被遮挡”的假通过：宿主在会话上方
打开了顶层 `DirectoryExplorerDialog`（"Add project directory" onboarding dialog），
在宿主合成画面里它确实覆盖住了 inline MCP App；但旧 verifier 通过 CDP/evaluate
直接进入 child iframe context 操作 DOM，绕过了宿主根 document 的指针命中与视觉
可见性，程序化交互照样通过，于是 inline 检查全部变绿，首张截图却是在顶层 dialog
之下拍的。

根因是验收只看了 iframe 内容（child target）的可交互性，从不检查宿主根 document 的
顶层可见性。顶层 dialog 对真实用户指针是命中屏障，但 verifier 在 child context 里
程序化派发的事件绕过了宿主根 document 的 hit-testing，所以“能点、能断言、能交互”
既不能证明“用户能看到”，也不能证明截图时刻没有遮挡。修复（commit `451700f9`）只改
验收 harness，不碰产品代码，门槛如下：

1. 只检查根 document 的可见顶层 `role=dialog`（排除嵌套 dialog；App iframe 内部的
   dialog 属于 child target，永远不参与）；
2. 只按受支持 onboarding 文案身份匹配（`isProjectDirectoryOnboardingText` 覆盖
   `Add project directory` / `添加项目目录` / `新增專案目錄`），不匹配任何其它 dialog；
3. 要求真实 `button[data-slot="dialog-close"]` connected、visible、enabled 且 bounding
   rect 为正（`assessProjectDirectoryOnboarding`），任一不满足立即 fail-closed；
4. 点击匹配 dialog 的真实渲染按钮并断言点击成功，绝不点无关 dialog；
5. 关闭后按弹窗身份等待消失（记录 remainingDialogs / remainingBackdropCount），不能
   按 close-usability 判定“已消失”——缺 close 按钮的遮挡弹窗仍必须判为存在；
6. 首张 inline 截图前再次 fail-closed：`preScreenshotAbsent` 必须为 true，否则把
   序列化 dialogs 作为证据抛出；
7. 全程不用 Escape 键、不触碰 React 内部状态。

代码参考（三个 acceptance 文件）：

- `scripts/lib/tldraw-mcp-app-browser-acceptance.mjs`：
  `isProjectDirectoryOnboardingText`、`assessProjectDirectoryOnboarding`（依赖
  `hasPositiveRect`）；
- `scripts/verify-tldraw-mcp-app-browser.mjs`：`inspectHostOnboardingDialogs`、
  `dismissHostProjectDirectoryOnboarding`，以及 Inline 检查点在
  `captureVisibleContentScreenshot('inline-preview')` 之前的 `preScreenshotAbsent` 断言；
- `scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs`：聚焦测试断言 verifier 从
  未使用 `dispatchKeyEvent` / Escape / `__react` 内部状态，并断言 wait 与截图前
  absence 只按弹窗身份匹配、不按 close 可用性掩盖遮挡。

最新真实 E2E（单一环境证据，2026-08-05）：11/11 检查点全绿，
`projectDirectoryOnboarding` status=`dismissed`、dialogCount=`1`、backdropCount=`1`、
remainingDialogs=`0`、remainingBackdropCount=`0`、preScreenshotAbsent=`true`；47 次
AppBridge 交换，0 isError、0 fallback。**不要**把这次单一环境证据泛化成“所有宿主都
一定有该弹窗”：正确写法是测试原则加 OpenChamber 具体实现参考——任何宿主顶层
overlay 都不允许覆盖验收截图，是否真的出现该弹窗取决于宿主环境。这也仍然不是打包
Electron / Computer Use 验收（仍 pending，见 8.6 四个门禁）。

## 9. Host → source-authenticated Loader → final `srcdoc` App

tldraw v5.0.2 的 SVG/PNG 导出不是单纯序列化当前 DOM。`getSvgString`
在处理 `foreignObject` 时会构造 `StyleEmbedder`；它动态创建隐藏的
`about:blank` iframe，目的是在不受 App CSS 干扰的文档中读取浏览器默认样式，
不是让 helper 继承编辑器样式。`toImage` 也先走同一 SVG 链路，因此 SVG
和 PNG 会在同一个点失败。

当最终 App 位于 `sandbox="allow-scripts"` 且没有 `allow-same-origin` 的 iframe
中时，它的 active sandbox origin flag 会参与嵌套 browsing context 的创建；
新的 `about:blank` helper 因此获得另一个 opaque origin。两个 opaque origin
不会因为都序列化为 `null` 就变成同源，App 读取 `frame.contentDocument`
只会得到 `null`，并触发 `frame must have a document`。这在没有 CSP 时仍会
发生；增加 `about:` frame source、减少 iframe 层数或仅改 Loader 都不能修复。

OpenChamber 的兼容方案不是取消隔离，也不是把 4 MB+ App 直接编码成 `data:` 或
Blob 导航 URL。最终加载链路是：

```text
Host 验证 resource，并向 raw App HTML 注入 CSP
  → 同一个 sandbox iframe 先启动小型 opaque data: Loader
  → Host 用 nonce + identity + byte/count 约束分块握手
  → Loader 验证传输完成并授权 transition
  → Host 通过 iframe.srcdoc 挂载最终 App document
```

- Host 先根据 resource metadata 合成 CSP，并把 `<meta>` 注入 raw App HTML；
- 最终 iframe 始终只有 `sandbox="allow-scripts"`，明确不包含 `allow-same-origin`；
- 小型 Loader 是 source-authenticated handoff point。Host 以 resource SHA identity、
  每次 render nonce、UTF-8 byte 数、总 units、chunk index 和大小上限完成有界传输；
- Loader 不创建可导航的 App Blob URL。它确认完整传输后发出 transition，Host 清除
  iframe 的旧 `src`，再用 DOM property `frame.srcdoc = html` 挂载最终 document；
- 最终 App 仍处于 opaque sandbox origin，与 Host 跨源；
- readiness 只有在最终 document load 与 AppBridge initialized 都完成后成立，等待
  大页面最多 45 秒；ready 后发生的任何再次 load 都按 navigation fail-closed；
- App 自己创建的 `about:blank` 导出 iframe 对 App 也是跨源；`about:` 的 CSP
  声明不会改变这一 origin 判定，Host 也可能规范化掉不支持的 scheme source；
- 离线图标、字体和翻译继续使用已校验的 `data:` URL，不为 App 创建可导航的
  Blob URL。

独立 App 构建对锁定的 tldraw 源码应用三份 reviewed patch。第一份在 helper
`contentDocument` 不可用时移除 helper、缓存“隔离默认样式不可用”状态，并仅对
default-style elision 返回 `NO_STYLES`。这会内联更多经过过滤的 computed CSS，
但仍保留 tldraw 原有的字体、CSS URL、媒体、pseudo-element、shadow DOM、SVG 和
PNG 链路；非 opaque 环境仍走原官方路径。第二份让离线翻译 JSON 的已校验
`data:` URL 在本地解码，避免在 `connect-src 'none'` 下调用 fetch；第三份让导出
链路直接保留已经解析好的媒体 `data:` URL，而不是再次 fetch。`data:` 已经内联
并不代表 `fetch(data:...)` 会绕过 CSP。三份 patch 的文件、修改前源码和修改后
源码都必须记录 SHA-256 并在构建与分发校验中 fail-closed。

不要把这条经验简化成“tldraw 需要 allow-same-origin”。当前实现恰恰依赖该 token
缺席来保持 `srcdoc` App 的 unique opaque origin；如果资源改成与宿主同源 URL，
`allow-scripts allow-same-origin` 会产生完全不同的逃逸风险。postMessage 仍必须做
source、nonce、session、message、server 与 resource 校验，Loader transition 也不能
替代 AppBridge initialized 这一步 readiness 证明。

这条回归不能只用源码 regex 或 artifact hash 代替。真实浏览器 E2E 必须使用精确的
`sandbox="allow-scripts"` 和生产 CSP，画布至少包含一个会触发 `foreignObject`
style embedding 的 rich-text label，然后分别导出 SVG 和 PNG。测试应断言没有
`frame must have a document`、AppBridge 仍可用且每次只发出一个 download request；
解码后的 SVG 必须有有效 XML、`foreignObject`、内联样式/字体和可见文字，PNG 必须
有正确 magic bytes、尺寸和非背景像素。还应连续执行 SVG → PNG → SVG 以检查 helper/
render target 泄漏，并验证较多内联 CSS 仍低于 Host 的 20 MiB 下载上限。

## 10. CSP、导航和权限必须 fail-closed

MCP App 的 resource metadata 是权限申请，不是直接授权。Host 需要对
connect/resource/frame domains 做规范化和 allowlist 校验，再合成 CSP；导航、
下载、剪贴板、弹窗和外链分别走 Host capability。无法在当前 opaque iframe 拓扑中
可靠授予的 camera、microphone、geolocation 等 Permission Policy 不应“先声明再看
能否工作”，而应不暴露 capability。

AppBridge postMessage 只接受：预期 source window、允许的 opaque origin 表现、正确
nonce、当前 session/message/server/resource 绑定和合法 JSON-RPC。Loader 在非法
transfer、identity/nonce 不匹配时应立即 invalidate；Host 在 App ready 后观察到第二次
iframe load 或异常导航时也必须撤销授权。权限或身份不明确时显示 fallback/错误，
不允许为了“页面先出来”而放宽到任意 fetch、顶层导航或任意 Tool 调用。

## 11. HMR 可能伪装成保存或重载缺陷

开发模式中修改 `McpAppRenderer.tsx` 会触发 React HMR。它可能恰好发生在点击
Save 后，表现为 App Board tile 变空、iframe 重建或 AppBridge 断开，极易误判为
“Save 切换了 canvas”或“重复 host.init 导致重载”。诊断时必须把这两类事件分开：

- React rerender 后重复发送同 nonce 的 `host.init` 是幂等握手，不应追加第二个 App
  iframe，也不应 invalidate；
- 已经 ready 的 App iframe 发生第二次真实 `load`，才应视为导航并撤销授权；
- DevTools/HMR 日志与文件修改时间应纳入故障时间线；
- 修复后在停止编辑源码、无 HMR 的稳定 dev 进程或打包客户端中重做 Save、Pin、
  fullscreen、会话切换和 reload，才能判定生产缺陷是否存在。

测试不能通过放宽 second-load 防线来“修复”HMR；应为 benign repeated init 与
malicious second load 分别保留回归用例。

## 12. 编辑器外壳就绪 ≠ Editor 可交互

Broker → Loader → verified App 三层生命周期变严后，最容易出现的假绿路径是：

1. Host 已进入 fullscreen；
2. React 已渲染 App chrome（`+ Note` / Save / SVG 等按钮可见）；
3. 但 `Tldraw.onMount` 尚未设置 `editorRef`，或权威 snapshot 尚未 settle，
   或 `.tl-canvas` 尚无正尺寸 hit area。

此时若 `addNote` 对空 editor 静默 `return`，自动化会点到按钮却看不到
`tldraw_apply_operations`，最终超时为 “Timed out waiting for app-only note revision”。

约束：

- App 必须在 `.acceptance-shell` 暴露稳定契约：
  `data-editor-ready="true|false"` 与
  `data-editor-status="loading|rendering|ready|error"`。
- 进入 inline、切换 canvas identity、卸载编辑器、开始重新同步时必须重置 ready。
- 只有 onMount + 权威 canvas 渲染 + `.tl-canvas` 正尺寸后才可设为 ready。
- 依赖 Editor 的按钮在 `editorReady=false` 时必须 disabled；程序化调用也不能静默吞掉。
- E2E 必须等待该契约，不能只等 fullscreen shell 尺寸或固定 sleep。
- Host 验收 helper 中 `editorReady: false` 是合法“未就绪”标记，不得再判为
  `invalid-editor-ready-marker`；合法值仅为 `true` / `false` / 未提供。

## 13. Broker CSP 会继承到 about:srcdoc App

Chromium 可能把 Broker 文档的 policy container 继承到最终 `srcdoc` App 文档。
多条 CSP 取交集：App 自己的 `img-src 'self' data:` 无法覆盖 Broker 上缺失的
`img-src` 时，浏览器会回退到 Broker 的 `default-src 'none'`，于是 tldraw 的
`data:image/svg+xml` 光标/图标被拦截。

定位方法：

1. 对比 console error 中的 violated directive：若只写 `default-src 'none'` 且
   “img-src was not explicitly set”，说明生效策略不是 App 文档策略。
2. 分别打印 Broker / Loader / App 三层 document URL 与 effective CSP。
3. Loader 刻意不挂 bootstrap CSP，就是为了避免本地 scheme 导航继承后封锁 App。
4. Broker 可保留 `default-src 'none'`，但必须显式声明离线 scheme：
   `img-src data:`、`font-src data:`、`media-src data:`；禁止放宽到远程网络。
5. `normalizeMcpAppCspSource` 必须识别 bare scheme（`data:` / `blob:` / `about:`）
   供 resource/frame 域使用；`connect-src` 仍拒绝这些 scheme。

不要通过把 CSP 错误加入忽略名单来“通过”验收。

## 14. 最小发布门禁

每个 MCP 2026 App 至少保留以下证据：

1. capability negotiation 和 Tool visibility；
2. resource MIME、bytes、digest 与离线加载；
3. Agent 创建初始内容；
4. 用户真实编辑并通过 App-only Tool 保存；
5. stable identity、revision fence 和历史恢复；
6. SVG/PNG 渲染、export receipt 和 host download policy；
7. inline、fullscreen、App Board 三种实际布局；
8. 跨 session/message/server/resource/tool 伪造调用被拒绝；
9. 日志、ToolPart、DOM 和截图中没有长期 token；
10. 本地回环与打包客户端各至少一次真实验收。
11. App Board 使用内容寻址 snapshot、Board CAS 和精确 binding 锁定，失败保留旧 ref；
12. result/model-context 更新不 remount iframe，resource/CSP 变化只受控重载一次；
13. focused/fullscreen 所有退出路径都恢复 inline；
14. Host download 能等待人工确认、接受后产生真实文件、取消/中止可观察；
15. 客户端重启后恢复同一 entity/canvas、revision、snapshot ref 和 MCP binding；
16. 自包含验收在 `/health` 后、MCP 协商前把验收目录注册为唯一 project（PUT
    `/api/config/settings` 并 round-trip 校验回显，见 8.7），Pin/App Board 才能持久化
    到以 `path_<base64url(abs path)>` 为键的 board。
17. 首个 inline 截图前验证宿主根 document 顶层 overlay 已消失，且 child iframe App
    已就绪（host-visible screenshot gate：宿主根文档可见性 + iframe 双层证据，见
    8.8）；screenshot 是门槛而非装饰，不允许在顶层遮挡下“先截后解释”。

若只通过协议 fixture、源码断言、静态截图或 fallback，上述链路仍是未完成。当前
自动化覆盖协议、visibility、source-authenticated Loader 到最终 `srcdoc` 的大型页面
加载、CSP、atomic save、dirty-state 与下载契约；没有随本轮文档修改新增手工 UI 或
实际文件落盘证据，发布时仍需按上述门禁补齐。
