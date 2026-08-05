# tldraw MCP App 开发、打包与审核踩坑复盘

> 日期：2026-08-04  
> 范围：`tldraw-mcp-app`、OpenCode Fork、OpenChamber Electron 以及真实 MCP App UI 验收  
> 性质：事故复盘与后续发布约束，不替代 MCP 规范或各仓库 README

## 0. 结论先行

这次最难的问题不是某一段代码写错，而是证据跨层失真：standalone App、OpenCode
源码、浏览器 Gate C、Electron 内置 CLI、DMG 和真实运行进程都可能来自不同版本。
某一层“全绿”不代表下一层也使用了同一份实现。

本轮已经证明：

- `tldraw_create_view` 可以在真实 OpenChamber 中加载真实 tldraw v5 MCP App；
- 旧候选包的 `MCP App unavailable / 404` 根因是实际打包进去的旧 OpenCode CLI 仍使用
  4 MiB App resource 上限，而当前 `dist/app.html` 为 `4,547,679` bytes；
- 使用带 8 MiB 上限的本地 OpenCode build 后，resource、Edit、服务器写入和 Pin/App
  Board fullscreen 都能工作；
- 但真实 UI 继续发现了相机适配问题：inline → fullscreen/App Board → inline 后沿用旧
  camera，导致内容过小、偏移或被裁切。因此当前候选仍是 **fix-first**；
- 当前 DMG 内置的是 `local-uncommitted` OpenCode override，且三个仓库都有未提交改动。
  它只能用于私有 QA，不能作为可追溯发布候选。

最重要的工程规则只有一句：

> 每个通过结论都必须绑定“实际运行的二进制、完整依赖身份、测试入口、运行 profile、
> 会话绑定和可见 UI 证据”；禁止用源码状态替代打包状态，用 Tool 成功替代 App 成功，
> 或用浏览器自动化替代 Electron 真机验收。

---

## 1. 本轮证据快照

以下数据用于解释本次问题，不是最终发布锁。

| 对象 | 本轮实际身份或状态 |
|---|---|
| OpenChamber HEAD | `95b1954f3c77509e78129a3214142da0464ac46e`，工作区大量未提交/未跟踪改动 |
| OpenCode Fork HEAD | `bf12c7a79358ae763733d6e67de93af5d6715226`，MCP Apps 修复仍未提交 |
| `tldraw-mcp-app` HEAD | `cee989b07e4d71016537db997b2c539f96e6d4c3`，当前仍有 8 个修改文件 |
| tldraw App | `1.3.0`，`dist/app.html` = `4,547,679` bytes，SHA-256 `61192b801ccaf582a09280478056ac60efccd308520c062ef34f443104b1ad3e` |
| tldraw Server | `dist/server.mjs` SHA-256 `6941f2606ca97e321eb941f54eb39918d004f08cae828cab4b244e184fa96d3a` |
| OpenChamber release lock | 仍指向 `v1.18.10-oc.1` / commit `bf12c7a...` |
| QA 本地 CLI | `1.18.10-oc.2-local.5`，metadata 为 `releaseTag: local-override`、`forkCommit: local-uncommitted` |
| QA `.app` 内 CLI SHA-256 | `6c452638c9b6c80f0875213080b61bcbacf3f38d2e3d296c3838e0acfa7ea4d8` |
| QA DMG SHA-256 | `a89e20bcb4c9342ca05b1c24caa3e315a8edc56a1a0847e601506e1f1f2815d6` |
| 最新 Gate C | orchestration `2026-08-04T10-44-52-821Z`，11 个 checkpoint 通过 |
| 真实 Electron UI | resource 404 已消失；revision 1 可见；`+ Note` 后 revision 2；Pin fullscreen 可见；返回 inline 后 camera 裁切 |

这里还有一个容易被忽略的证据细节：Gate C 目录/orchestration run ID 是
`2026-08-04T10-44-52-821Z`，browser report 内部 run ID 是
`2026-08-04T10-45-15-310Z`。报告引用必须同时记录 orchestration 与 browser ID，不能
仅凭目录名推断内部 run。

---

## 2. 事件时间线：为什么会经历“源码绿、打包红、修完后又发现 UI 问题”

1. `tldraw-mcp-app` 完成独立 Server/App、离线资源、真实 tldraw renderer、revision、
   quota、导出和 App Board 等实现。
2. standalone 测试和 OpenChamber 自包含浏览器 Gate C 逐步变绿。
3. 真实 OpenChamber Tool 调用成功并返回 canvas，但 ToolPart 显示
   `MCP App unavailable`，resource route 返回 404。
4. OpenCode 日志揭示真实原因：`MCP App resource exceeds the HTML size limit`，旧运行
   CLI 的 `maxBytes=4194304`，而 App HTML 约 4.34 MiB。
5. OpenCode 当前源码已经把限制提高到 8 MiB；用当前源码构建本地 CLI 后 Gate C 全绿。
6. 执行完整 Electron package 时，`prepare-opencode-cli` 又按
   `opencode-cli.lock.json` 下载并替换成旧 `v1.18.10-oc.1`。因此“Gate C 使用新 CLI，
   DMG 使用旧 CLI”。
7. 给 package 全程传入 `OPENCHAMBER_OPENCODE_CLI_PATH`，并用显式本地版本
   `1.18.10-oc.2-local.5` 后，DMG 才真正带入修复版 CLI。
8. Electron 原生模块 rebuild 又因机器只有 Command Line Tools、没有完整 Xcode 而失败，
   并移除了现有 `better_sqlite3.node`。为继续私有 QA，只能从旧可运行包恢复同版本原生
   产物并跳过 rebuild；这不是正式发布方法。
9. 真实 Computer Use 验收确认 404 消失、Edit/Pin 可用，同时发现相机跨 inline、
   fullscreen、App Board 尺寸切换后没有重新适配，最终候选仍需修复。

这条时间线说明：早期每个结论在自己的局部都可能是真的，但它们没有绑定同一条产物链。

---

## 3. 开发阶段的坑

### PIT-DEV-01：Tool 调用成功不等于 MCP App 成功

**症状**：模型正确调用 `tldraw_create_view`，Tool 返回 11 个元素和 canvas ID，自然语言
也声称创建成功，但 ToolPart 仍显示 `MCP App unavailable`。

**根因**：Tool 数据链与 App resource/AppBridge 链是独立的。严格 Server 即使面对不支持
Apps 的客户端，也可以返回有效 `structuredContent` 和 text fallback。

**为什么容易漏掉**：协议探针、Tool result 和模型总结都为绿色；如果审核者只看聊天文本，
会把 fallback 当成交付完成。

**以后必须做**：每个创建用例同时检查 ToolPart binding、resource identity、iframe 内真实
内容、AppBridge ready、canvas/revision 和禁止 fallback。Tool Output 只能证明 Tool 层。

### PIT-DEV-02：`404` 是表象，不一定是 Server 没资源

**症状**：OpenChamber `/mcp/app/resource` 返回 404，容易继续修改 tldraw Server 的
resource handler。

**根因**：OpenChamber 先通过 session/message/part/server/resource/tool binding 定位
resource；OpenCode 在读取 resource 后又因为超出大小上限返回 `undefined`，Host 最终只能
映射成 404。

**以后必须做**：先查 OpenCode 日志中的 server、resource URI、actual/max bytes，再分别
验证 MCP resource read、session binding 和 Host route。404 必须带稳定错误码；不能把所有
loader 拒绝都压成“resource not found”。

### PIT-DEV-03：离线自包含让 App 变大，大小预算必须检查最终 UTF-8 bytes

**事实**：当前 `dist/app.html` 是 `4,547,679` bytes，超过旧 OpenCode 的 4 MiB 上限。

**坑点**：源码字符数、gzip/zip 大小、esbuild 输出统计和最终 UTF-8 bytes 不是同一件事；
base64/data URL 还会继续放大。

**以后必须做**：

- 构建后用真实 `dist/app.html` 做 byte-limit 测试；
- Server/CLI 日志记录 actual bytes 与 limit；
- 保留 8 MiB fail-closed 上限，不允许无限制读取；
- 资源超过预警阈值时先做 bundle budget 审计；
- 更新文档中的固定 byte/hash，避免引用旧产物。

### PIT-DEV-04：离线并不只是“把 JS 打进 HTML”

tldraw 还依赖图标、embed 图标、字体、翻译、导出辅助逻辑和 data URL。真实 opaque-origin
iframe 下，SVG/PNG 导出、翻译和 CSP 会暴露普通浏览器 demo 看不到的问题。

**以后必须做**：固定 tldraw tag/commit、patch 与最终 HTML hash；断网检查完整 toolbar、
菜单、minimap、英文/简中/繁中、SVG 与 PNG，而不是只在源码里搜索资源字符串。

### PIT-DEV-05：同一 renderer 不等于同一 camera 可以无条件复用

当前实现正确地让 inline/fullscreen 使用同一个 editor/store，避免 document remount；但
源码同时约定“模式切换时 camera 留在内存，只在 fresh load/revision switch 时
`zoomToFit`”。真实 UI 证明这在容器尺寸变化时会失败：

- inline 初始约 7% zoom，拓扑很小；
- fullscreen 继承 inline camera，需点击 `Back to content` 才到约 60% 并完整可见；
- 返回 inline 或关闭 App Board 后，内容偏到右侧并被裁切。

**正确边界**：保留 editor/store/document identity，但 display mode、HostContext container
尺寸或 tile resize 稳定后，应重新适配 camera。camera 变化不能修改 document hash、dirty
或 revision。

**必须新增的测试**：inline → fullscreen → inline、Pin tile → focus → exit、右栏开关和 tile
resize 后，语义元素均在可见 viewport 内；不能只检查 `.tl-canvas` 非零尺寸或
`data-render-ready=true`。

### PIT-DEV-06：Editor 外壳 ready 不等于编辑器可交互

按钮、header 和 `.tl-canvas` 可以先出现，`Tldraw.onMount`、authoritative snapshot 和
hit area 仍未 ready。固定 sleep 或只找按钮会造成假绿。

**以后必须做**：继续保留 `data-editor-ready`、`data-editor-status`、
`data-content-ready`、semantic count 与正尺寸 hit area 的复合契约；依赖 editor 的按钮在
ready 前必须 disabled，程序化调用不能静默 return。

### PIT-DEV-07：真实用户编辑/Save 不能被 App-only `+ Note` 替代

本轮 Computer Use 点击 `+ Note`，服务器成功从 revision 1 增至 2。这证明 App-only
mutation 和 revision fence 可用，但没有证明“用户拖动/改字 → dirty → Save → 同 canvas
revision 精确 +1”。

**以后必须做**：把两类写入分开记录：

1. App-only server mutation；
2. tldraw 本地 document edit + Save。

最终 Electron 冒烟两者都必须执行；不能拿其中一个替代另一个。

### PIT-DEV-08：生产许可证边界不能被功能测试掩盖

真实 UI 仍显示 tldraw SDK 的 `Get a license for production` 提示。仓库 README、
OPERATIONS 与 DEVELOPMENT 已明确当前仅供私有开发/互操作。

**以后必须做**：功能通过与生产授权是两个门禁。未获得并审查所需 tldraw 生产许可证前，
不得把当前 App、Docker 服务或 DMG 描述为公开生产发布。

---

## 4. OpenCode Fork 与 OpenChamber 集成的坑

### PIT-INT-01：修复存在于 fork 源码，不代表 OpenChamber 正在运行它

本轮 OpenCode 源码中 `MAX_RESOURCE_BYTES = 8 * 1024 * 1024`，但真实旧包日志仍显示
`maxBytes=4194304`。真实运行二进制是发布锁中的 `v1.18.10-oc.1`，不是工作区源码。

**以后必须做**：同时记录：源码 commit/diff、构建 binary path、`--version`、
`/global/capabilities`、staged binary hash、packaged binary hash、运行进程实际 resolved path。

### PIT-INT-02：完整 Electron build 会再次执行 `prepare-opencode-cli`

`packages/electron` 的 package 流水线顺序为 Web assets → prepare CLI → bundle main → native
rebuild → package。`prepare-opencode-cli` 在没有
`OPENCHAMBER_OPENCODE_CLI_PATH` 时，会删除 staging 目录里除 `.gitkeep` 外的内容，并按
`opencode-cli.lock.json` 重新放入发布 CLI。

**后果**：先手工复制新 CLI、再执行普通 `bun run electron:build`，新 CLI 会被静默换回
旧 lock 版本。

**以后必须做**：

- 正式发布：先发布 fork CLI/SDK，再更新 lock，最后打 OpenChamber；
- 本地 QA：把 override 环境变量传给整个 package 命令，而不是只运行一次 prepare；
- package 完成后再次运行包内 CLI 的 `--version` 和 hash 验证。

### PIT-INT-03：Gate C 与 DMG 可能使用不同 CLI

本轮 Gate C 使用当前源码构建的本地 CLI，11 个 checkpoint 全绿；随后 Electron package
按 lock 换回旧 CLI，真实 DMG 仍 404。这是最典型的“源码绿/浏览器绿/打包红”。

**以后必须做**：Gate C report 写入 CLI path/version/hash；Gate D 必须比较 Gate C CLI
identity 与 `.app/Contents/Resources/opencode-cli/opencode`。若不相同，Gate C 证据对该 DMG
无效。

### PIT-INT-04：本地未提交 CLI 不能冒充已发布版本

如果把当前工作区 build 仍标成 `1.18.10-oc.1`，日志、缓存和报告都会把它误认为旧 release。
本轮使用 `1.18.10-oc.2-local.5`、`releaseTag: local-override`、
`forkCommit: local-uncommitted` 是正确做法，但这只建立 QA 身份，不产生发布 provenance。

**以后必须做**：未提交 build 必须有独立 local version 和 metadata；发布前必须落到真实
commit/tag/artifact hash，并更新 CLI 与 SDK lock。

### PIT-INT-05：staged hash、签名后 packaged hash 和 archive hash 不是一个值

本轮 staging metadata 记录 CLI SHA-256
`ecb5c80549ca1a318424ad5416d83dcc1d50fef89cc68a4100feb9d887022686`，而 ad-hoc signing 后
`.app` 内 CLI SHA-256 是
`6c452638c9b6c80f0875213080b61bcbacf3f38d2e3d296c3838e0acfa7ea4d8`。

这不自动表示内容被恶意替换；macOS signing 会改变 Mach-O bytes。但报告必须明确 hash
属于哪个阶段，并用 version/capability/签名验证把它们串起来。禁止把 release archive、
解压 binary、staged binary、signed packaged binary 和 DMG hash 放在同一列却不标语义。

### PIT-INT-06：MCP 配置按实际 project directory 解析，启动 cwd 不等于当前目录

OpenChamber 的 managed OpenCode cwd 默认可能是用户 home；UI 当前 project、启动 shell cwd、
隔离 workspace 和 `opencode.json` 所在目录可能不同。测试时曾同时出现不同 loopback port
配置，单看临时 workspace 文件不能证明当前会话使用它。

**以后必须做**：在报告中记录 current directory、配置来源、server key、实际 URL、PID/
port、connection generation 和 reload 时间。配置变更后执行真实 Disconnect → Connect，
避免旧 Tool registry/resource binding 缓存。

### PIT-INT-07：Apps capability、Tool registry 和 resource binding 是三道不同门

“Connected”只证明 transport；Tool 能列出不证明当前请求携带 Apps capability；旧 registry
还可能按旧 output schema 校验新响应。

**以后必须做**：检查 `protocolVersion=2026-07-28`、adapter/era、Apps capability、当前 Tool
schema、resource URI 和 session binding。历史恢复出现 schema 错配时，优先重连 connection，
不要立刻篡改 Server payload 做兼容 fallback。

---

## 5. 测试设计与环境的坑

### PIT-TEST-01：自动化全绿不能替代真实 Electron 内容证据

Headless/browser 自动化可以验证 DOM contract、协议和大部分交互，但以下问题只能在真实
Electron/可见窗口中可靠发现：

- macOS Accessibility/窗口聚焦与实际合成；
- App Board tile/focus/fullscreen 的真实容器尺寸；
- iframe 内是否真正画出图形，而不是 ready-but-blank；
- 返回 inline 后 camera 是否裁切；
- packaged CLI 与真实运行进程是否一致。

### PIT-TEST-02：readiness 的布局信号可能是假阳性

`height >= 24`、iframe load、AppBridge initialized、`.tl-canvas` 非零都可能成立，同时内容
仍空白、极小或在 viewport 外。首屏通过必须包含真实图形/语义内容证据；Surface Contract
是必要条件，不是充分条件。

建议自动化补充：读取 semantic element bounds 与 viewport 的交集，或使用稳定视觉断言；
失败必须保存 surface dump 和截图。

### PIT-TEST-03：模型会受额度、Provider 和提示词影响

本轮默认 Big Pickle 因额度耗尽失败；切换 Qwen3.7 Plus 后才完成调用。模型还可能在 quota
或不确定时改用 Excalidraw、HTML Artifact、legacy `tldraw_open_canvas`，甚至复用无关 canvas。

**以后必须做**：固定 provider/model，记录错误与耗时，使用明确工具名和禁止 fallback 的
触发语句；最终断言实际 `toolKey`，不能只看回答文本。Provider 故障要标 external blocker，
不能算产品失败或成功。

### PIT-TEST-04：画布 quota 会改变 Agent 行为

历史测试数据把 active canvas 占满后，Agent 曾改用已有 `interop-acceptance` 和旧
`tldraw_open_canvas`。这会把“创建主链”悄悄变成“修改旧 fixture”。

**以后必须做**：

- Clean profile 不含旧 canvas/tile；
- quota 用例使用独立低配额 Server；
- create 用例断言新 canvas identity；
- quota error 必须结构化并禁止 Agent 擅自复用无关 canvas；
- 每轮后清理/归档 fixture，不能让历史状态污染下一轮。

### PIT-TEST-05：Clean profile 与 Historical profile 不能混用

Clean profile 用于首装和 create 主链；Historical profile 用于重启、旧 Session、Pin 和精确
revision 恢复。如果用同一 profile 反复跑所有用例，会同时引入旧 Tool registry、旧 canvas、
旧 App Board ref、旧 local storage 和端口残留。

### PIT-TEST-06：旧进程、端口和日志会制造错误归因

OpenChamber、managed OpenCode、tldraw Server、Chrome/Electron helper 都可能残留。旧日志里
仍保留 4 MiB warning；仅 grep 到 warning 不证明新 run 失败。

**以后必须做**：每个 run 记录 PID、port、run ID 和开始时间；日志按 run 分目录；启动前
确认端口空闲，结束后确认进程组退出和端口释放。共享全局日志只能作为辅助证据。

### PIT-TEST-07：Headless 虚拟化 Session 的 blocked 不能被写成 pass

早期 E2E 对 locale 和 Pin/App Board 因 headless session restore 不可靠而记录 blocked。
blocked 不是失败，但也不是通过。真实可见环境复核前，报告只能是 Conditional No-Go/Go，
不能把“主流程其他 checkpoint 通过”外推到被 blocked 的项。

### PIT-TEST-08：HMR 会伪装成 Save/Pin/iframe 生命周期 bug

开发模式下源文件变更会重建 renderer。Save 后 tile 变空、AppBridge 断开或 iframe second
load 可能来自 HMR，而非生产链。

**以后必须做**：稳定 dev 进程或 packaged app 重做同一用例；区分重复 `host.init` 与真实
second load；不能通过放宽安全检查让 HMR 测试变绿。

### PIT-TEST-09：Computer Use 需要系统权限，但权限通过不等于产品通过

macOS Accessibility 未授权时，无法获得真实 UI 证据。授权后必须重新触发并读取最新 AX
tree/screenshot；不能把“工具可以点击”当成 tldraw 成功。本轮正是在权限恢复后才确认
resource 404 与后续 camera 裁切。

---

## 6. Electron 与 DMG 打包的坑

### PIT-PKG-01：打包脚本的工作目录会改变依赖解析

从仓库根直接执行 `node packages/electron/scripts/package.mjs` 时，`bun x
electron-builder` 解析到了不同版本并报告无法从 installed modules 推断 Electron；从
`packages/electron` 目录执行 `node scripts/package.mjs` 才使用 workspace 已安装依赖。

**风险**：`bun x` 可能联网解析新版本并写 lockfile，使“同一脚本”在不同 cwd 下不是同一
工具链。

**以后必须做**：只使用 package.json 中的 canonical root command；package script 自身应
固定 cwd/二进制，不依赖调用者目录或临时 `bun x` 解析。

### PIT-PKG-02：完整 Xcode 是 Electron native rebuild 的真实前置条件

本机只有 `/Library/Developer/CommandLineTools`，`node-gyp/@electron/rebuild` 无法确定 Xcode
版本。失败过程中原有 `better_sqlite3.node` 被移除，导致后续 package 也缺原生模块。

**以后必须做**：打包前 preflight `xcode-select -p`、`xcodebuild -version`、Electron ABI 与
目标 arch；rebuild 应在临时输出中完成并原子替换，失败不能破坏上一份可用产物。

### PIT-PKG-03：从旧 `.app` 恢复 native module 只能用于诊断

本轮为继续 QA，从上一份同 Electron/架构包恢复 `better_sqlite3.node`，然后直接 package。
它证明其他链路可继续测试，但不能证明当前依赖源码、ABI、build flags 与发布产物一致。

**发布规则**：正式候选必须在干净环境完成完整 native rebuild，并运行 packaged native
module smoke；诊断 workaround 必须在报告中显式标为 tainted/local QA。

### PIT-PKG-04：`.app` 可运行、DMG checksum 有效，仍不等于“安装版已验收”

本轮 `codesign --verify --deep --strict` 与 `hdiutil verify` 均通过，但 UI 验收启动的是
`packages/electron/dist/mac-arm64/OpenChamber.app`，不是从 DMG 挂载后安装到 Applications 的
clean-profile 实例。

**以后必须做**：区分：

1. unpacked `.app` QA；
2. DMG integrity；
3. DMG mount/copy/install；
4. clean-profile installed-app runtime；
5. upgrade-profile runtime。

只有第 4/5 层能支撑安装/升级结论。

### PIT-PKG-05：ad-hoc signing 与未 notarize 是 QA 状态，不是生产发布

当前包使用 ad-hoc signature，electron-builder 明确跳过 notarization。它可以做本机私有
验收，但不能替代 Developer ID、notarization、Gatekeeper 和更新渠道验证。

### PIT-PKG-06：构建失败后的 `dist` 可能是混合产物

Web assets、main bundle、staged CLI、native module 与 Electron package 可能分别来自不同次
执行。文件存在并不证明它们同源。

**以后必须做**：每轮使用新输出目录/build ID；package manifest 记录每层 input hash；失败
后禁止复用旧 `dist` 宣称成功。若必须做诊断恢复，产物名称和 metadata 必须标 local/tainted。

---

## 7. 审核与交接过程的坑

### PIT-REV-01：审核只看 diff 或单仓测试，无法覆盖三仓运行链

tldraw App 的问题可能实际在 OpenCode resource loader；OpenCode 修复可能又没进入
OpenChamber package；OpenChamber Host ready 可能仍看不到 iframe 内内容。

**以后必须做**：审核至少分四种角色证据：

- standalone App/Server；
- OpenCode protocol/resource；
- OpenChamber Host/browser；
- packaged Electron/DMG + Computer Use。

最终 reviewer 必须读取实际 diff 和完整产物 manifest，而不是复述实现 Agent 的 handoff。

### PIT-REV-02：多仓未提交工作区让“commit + hash”失去可追溯性

当前三个仓库都存在未提交修改；hand-off 中早先记录的“tldraw 工作区干净”已过期。仅记录
HEAD 会遗漏真正参与构建的 diff。

**以后必须做**：每次 Gate 记录 HEAD、`git status --short`、完整 diff digest、generated
artifact digest。最终 release 必须从固定 commit 构建；未提交工作区最多作为开发验收。

### PIT-REV-03：旧报告与当前源码不能混用

测试逻辑、source hash、dist hash、CLI 或 package 发生变化后，旧 report 即失效。尤其不能
把早期 blocked、旧 `.app` 或不同 browser run ID 的结果拼成一个“全绿”结论。

### PIT-REV-04：文档也会漂移并制造错误决策

本轮发现：

- 经验文档仍记录旧 App byte size；
- 同一文档仍把 inline 描述为 static semantic SVG，而当前已是同一真实 tldraw renderer；
- handoff 的仓库 clean/dirty 状态已过期；
- 自动化报告与真实 Electron 结果存在新差异。

**以后必须做**：固定数字旁标 artifact SHA；状态文档注明生成时间和失效条件；每轮验收完成
后同步“事实、证据、未关闭风险”，禁止只更新结论段。

### PIT-REV-05：发现问题后不能在 Computer Use 过程中顺手改源码

UI 验收应保持候选不变，先记录截图、会话、revision、状态和复现路径，再交给实现通道。
任何修复都会使之前的 diff digest、自动化结果和 reviewer verdict 失效，必须新 run 重验。

### PIT-REV-06：严格 workflow 自身也要避免“配置比目标更窄”

编排插件曾要求 primary 必须精确为 `gpt-5.6-sol/high`；当实际是同模型的 `xhigh` 或 `max`
时，按契约反而不能启动实现 lane。此问题不属于 tldraw 产品代码，但会打断问题发现后的
修复闭环。工作流前置条件应表达真实安全要求（例如 high-or-above）还是精确档位，必须在
插件中明确定义并用运行元数据验证。

---

## 8. 正确的证据链与强制门禁

### 8.1 每一层必须记录什么

| 层 | 必须绑定的身份 | 最低验证 |
|---|---|---|
| tldraw source | commit + dirty diff digest | unit/behavior/parity |
| tldraw dist | HTML/server bytes + SHA + upstream lock | `npm run verify`、restart persistence、真实 resource read |
| OpenCode source | commit + dirty diff digest + SDK | MCP App/resource/lifecycle tests |
| OpenCode binary | path + version + SHA + capabilities | 真实 4.5 MB resource、8 MiB 边界、Tool registry |
| Electron staging | distribution metadata + staged SHA | `prepare` 后立即 verify |
| packaged `.app` | build ID + signed binary version/SHA + native modules | codesign、packaged runtime smoke |
| DMG | filename + SHA + signature/notarization状态 | `hdiutil verify`、mount/install |
| runtime | executable resolved path + PID + ports + profile + run ID | `/global/capabilities`、connection metadata |
| UI | session/message/part/tool/resource/canvas/revision | visible preview、Edit/Save、Pin/App Board、restart |

### 8.2 推荐执行顺序

1. 冻结三个仓库的 HEAD、dirty diff 和允许修改范围。
2. 构建/校验 tldraw dist，记录真实 bytes/SHA。
3. 测试并发布 OpenCode fork CLI + SDK；更新 OpenChamber lock。
4. 用 lock 对应 CLI 跑 OpenCode Gate B。
5. 用同一 CLI identity 跑自包含 Gate C。
6. 在完整 Xcode/干净依赖环境执行 canonical `bun run electron:build`。
7. 验证 package 内 CLI/capabilities/native modules/signature，再验证 DMG。
8. 从 DMG 安装 clean profile，执行最小主链。
9. 用 historical profile 做 restart、revision、Pin 和 binding 恢复。
10. 执行负向 CSP/blank/binding/quota/multi-instance 用例。
11. 固化截图、日志、下载样本、hash 和 report；再做 fresh final review。

### 8.3 最小真实 UI 主链不可再缩减

1. 模型明确调用 `tldraw_create_view`，禁止 fallback；
2. inline 首屏完整显示真实图形；
3. inline 只读但 zoom/pan 可用；
4. Edit 后真实修改 shape/text，Save 同 canvas、revision 精确 +1；
5. App-only mutation 单独再验证一次；
6. SVG/PNG 通过宿主保存并检查实际文件；
7. Done 返回 inline 后内容仍完整居中；
8. Pin → App Board tile → focus/fullscreen → exit，内容/identity/revision 一致；
9. 调整右栏、窗口和 tile 尺寸，camera 保持内容可见；
10. 重启客户端和 Server，恢复同一 session/canvas/revision/binding；
11. 全程无 fallback、无无诊断空白、无 console/page/runtime error。

---

## 9. 当前未关闭项

| 项目 | 当前状态 | 发布影响 |
|---|---|---|
| inline/fullscreen/App Board camera 重新适配 | 已在真实 UI 复现，未修 | fix-first |
| OpenCode 8 MiB 修复 | 源码/本地 binary 有，未形成正式 release lock | blocker |
| 三仓工作区 | 都有未提交修改 | blocker |
| tldraw dist provenance | 当前 dist 与 dirty source/lock 同步，但未提交 | blocker |
| Electron native rebuild | 本机缺完整 Xcode，本轮使用旧包产物恢复做 QA | blocker |
| DMG 安装版 clean-profile | 未执行；当前只测 dist `.app` | blocker |
| 真实 local edit → Save | 本轮 Computer Use 只做了 App-only `+ Note` | blocker |
| Developer ID/notarization | 未执行 | 生产发布 blocker |
| tldraw 生产许可证 | 当前仅私有开发/互操作 | 公开生产 blocker |
| Windows/Linux | 未验收 | 不得宣称跨平台通过 |

因此当前最准确的结论是：

> 资源大小与错误 CLI 导致的 404 已被定位并在私有 QA 包中验证修复；tldraw 主链已可运行，
> 但 camera、正式 fork release/lock、干净 native build、安装版 Save/restart 与发布治理仍未
> 闭环。当前不是可发布候选。

---

## 10. 关联文档

- [MCP Apps 修复交接文档](./MCP_APPS_REPAIR_HANDOFF_2026-08-04.md)
- [MCP Apps Computer-Use 产品验收计划](./MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md)
- [MCP 2026 App 开发与验收经验](./MCP_2026_APP_DEVELOPMENT_LESSONS.md)
- [MCP Apps No-Go 修复与重新验收计划](./MCP_APPS_NO_GO_REPAIR_PLAN_2026-08-04.md)
- [tldraw MCP App 浏览器验收](./TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md)
- [tldraw MCP App 完成清单](./TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md)
- [OCIX 与 OpenChamber 桌面打包踩坑手册](./INTERACTIVE_UI_PACKAGING_PITFALLS.md)

