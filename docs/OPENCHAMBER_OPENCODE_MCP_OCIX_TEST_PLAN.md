# OpenChamber × OpenCode Fork × MCP Apps × OCIX 统一测试计划

> 状态：执行中  
> 首发证据平台：macOS arm64  
> 关联设计：[MCP Apps 与 OpenCode CLI 实施计划](./MCP_APPS_OPENCODE_CLI_IMPLEMENTATION_PLAN.md)  
> OCIX 工作台基线：[OCIX Extension Workbench test plan](./OCIX_EXTENSION_WORKBENCH_TEST_PLAN.md)

## 1. 目的

本计划验证四条能力在同一个真实 OpenChamber 产品链路中可以共存：

1. OpenChamber 只打包并管理 `ZunbaRan/opencode` fork。
2. fork 兼容原 OpenCode 配置、认证、项目、Session 和数据库。
3. Legacy MCP、MCP 2026 和 MCP Apps 通过统一后端能力工作。
4. Local OCIX 与 Hosted OCIX 同时支持 Interactive UI、HTML Artifact、Business Gateway、App Board 和扩展生命周期。

单独 fixture 页面、孤立组件截图、伪造 ToolPart 或只有类型检查通过，均不能替代真实 Host 验收。最终结论必须分别记录：

- `Tool selected`
- `Surface resolved`
- `Surface rendered`
- `Business data loaded`
- `Interaction completed`
- `Secret absent`

任一项失败时，不得用 fallback、缓存快照或文字回答标记完整闭环通过。

## 2. 资源与内存约束

所有重型任务串行执行：

- Web production build
- Electron bundle/package
- Chromium/Electron 浏览器矩阵
- 历史 Profile 复制与数据库测试
- 全量测试

每个重型阶段开始和结束时记录：

```bash
memory_pressure -Q
sysctl vm.swapusage
ps -axo pid,rss,etime,command | sort -nr -k2 | head -20
```

资源门禁：

- 系统空闲内存低于 20%：不启动新重型任务。
- `memory_pressure` 进入 critical：立即停止当前可重试任务。
- 单阶段交换区增长超过 512 MiB：停止并定位进程、缓存或并发问题。
- 同一下载、构建、浏览器或打包命令只允许一个活跃实例。
- 长日志写入文件，只在对话中读取摘要、失败上下文和尾部。
- 结束阶段必须关闭测试服务器、浏览器、Electron 和临时 OpenCode 进程。

禁止通过关闭安全检查、缩小真实 fixture、跳过历史恢复或并行堆叠任务来换取“通过”。

## 3. 固定测试资产

### 3.1 OpenCode

- fork release lock，包括版本、fork commit、`upstream/dev` commit、六平台 URL 与 SHA256。
- 当前 fork SDK tarball 和生成的 OpenAPI 类型。
- 只读复制的真实历史 OpenCode Profile。
- 与 fork 同基线或更新的官方外部 OpenCode CLI。

历史 Profile 测试必须使用临时副本，不能直接写用户的：

- `~/.config/opencode`
- `~/.local/share/opencode`
- `~/.local/share/opencode/opencode.db`

### 3.2 MCP

- Legacy MCP Server fixture。
- MCP 2026 Server fixture。
- 合法 MCP App fixture，包含 resource、structured content 和 app-only tool。
- 恶意 MCP App fixture，覆盖跨 Session、跨 Server、资源替换、错误 MIME、超限资源、导航、网络、弹窗和伪造 Bridge 消息。

### 3.3 OCIX

- Local mixed OCIX：Declarative、Trusted Native、Scripts HTML Artifact、Tools、Skills、Connector、query、确认式 write。
- Hosted CRM：Interactive UI、真实 API、必填参数详情和联动。
- Hosted Ops：Scripts HTML Artifact、真实 API、刷新和确认式 write。
- Hosted 恶意变体：错误签名、错误哈希、跨 Origin redirect、权限扩大、Action 扩大、credential scope 扩大和不兼容 runtime。

所有包和远程 manifest 必须使用本轮临时签名材料或仓库固定测试密钥。私钥、业务 Token 和用户真实 Profile 不进入仓库、日志、截图或测试报告。

## 4. Gate A：静态契约与发行锁

验证：

- OpenChamber SDK 版本与 `opencode-cli.lock.json` 一致。
- lock 只引用 `ZunbaRan/opencode` release。
- staged CLI 的 `--version`、平台和 SHA256 正确。
- fork release provenance 含准确 fork/upstream commit。
- fork SDK 从当前 OpenAPI 生成，不存在手工漂移。
- OpenChamber 与 fork 均不引用官方 OpenCode update feed。
- OpenChamber 应用更新源只指向 `ZunbaRan/openchamber`。

最低命令：

```bash
bun run --cwd packages/electron verify:opencode-cli
bun run --cwd packages/electron verify:opencode-cli:runtime
node packages/electron/scripts/opencode-cli-lock.test.mjs
bun run type-check
```

## 5. Gate B：Fork 兼容性

### 5.1 能力握手

`GET /global/capabilities` 必须返回：

- distribution
- fork version
- upstream version/commit
- API version
- feature flags

外部官方 CLI 缺少该接口时，OpenChamber 必须降级到传统聊天和原始 Tool output，并展示稳定诊断；不得崩溃或尝试升级外部 CLI。

### 5.2 历史数据

对 Profile 副本执行：

1. 只读列出原 provider、project 和 Session。
2. 打开并恢复历史消息和普通 ToolPart。
3. 续聊一个历史 Session。
4. 创建一个新 Session。
5. 用同基线或更新官方 CLI 读取 fork 新建 Session。
6. 确认未知 MCP App metadata 退化为普通 Tool output。

必须断言：

- 未创建 `opencode-<channel>.db`。
- 未新增 fork 专属数据库表和 migration。
- 原配置路径、认证路径和数据库身份不变。
- 测试只修改临时副本。

## 6. Gate C：MCP 双栈

Legacy 和 2026 fixture 分别验证：

- 初始化和协议协商。
- server/tool/resource 统一视图。
- 普通 Tool 列表和调用。
- 断线、重连和错误映射。
- server 更新或版本变化后的缓存失效。
- 同时连接 Legacy 与 2026 Server 时互不污染。

MCP Apps 额外验证：

- `_meta.ui.resourceUri` 和 structured content 正确落入 ToolPart metadata。
- app-only tool 不出现在模型工具列表。
- app-only tool 只可由绑定的 AppBridge 调用。
- resource MIME、大小、server 和 resource identity 校验。
- 跨 directory/session/message/server/resource 调用全部拒绝。
- 历史恢复重新解析资源；失败时保留原始 Tool output。

## 7. Gate D：OpenChamber MCP App Host

在真实 OpenChamber 对话中：

1. 模型选择 MCP Tool。
2. ToolPart 被识别为 MCP App，而不是 OCIX。
3. App 在 sandbox iframe 或独立 Runner 内加载。
4. AppBridge 调用绑定的 app-only tool。
5. 结果回到同一 App 实例。
6. App 可 pin 到 App Board，并保留 `MCP App` 来源标识。

安全矩阵：

- 验证 `origin`、`source`、session 和 resource nonce。
- 拒绝导航、下载、任意网络、弹窗、剪贴板和伪造 postMessage。
- 拒绝跨 Session/Server tool call。
- CSP、sandbox 和 Host policy 同时生效。
- App 失败后保留原始 Tool output。

## 8. Gate E：Local OCIX

验证完整生命周期：

1. inspect 显示发布者、指纹、Tools、Skills、surface、网络和 Native 权限。
2. 显式信任后安装。
3. Tools/Skills 写入标准全局 OpenCode 目录。
4. 记录 publisher/extension 所有权与安装哈希。
5. Agent 可选择 Tool 并在真实对话流渲染 Declarative、Native 和 HTML Artifact。
6. query 加载真实业务数据。
7. write 显示确认，取消不请求上游，确认后只请求一次。
8. disable/enable、升级、回滚和卸载正确同步 Agent Runtime。

冲突矩阵：

- 未管理同名文件：拒绝安装且不覆盖。
- 其他扩展拥有同名文件：拒绝安装。
- 用户修改受管文件：保留文件、标记冲突。
- 缺失或不匹配签名文件完整性记录：隔离 UI 和 Agent Runtime，但保留可恢复卸载入口。
- manager 状态写入失败：文件和状态原子回滚。

## 9. Gate F：Hosted OCIX

### 9.1 安装与更新

- 薄包签名和 publisher identity 有效。
- HTTPS manifest/resource；loopback HTTP 只用于明确的开发 fixture。
- manifest 签名、resource SHA256、MIME 和最小 runtime 均通过。
- 权限等价更新在 TTL/刷新后自动采用。
- origin、Action、权限或 credential scope 扩大时进入 pending，等待重新确认。
- 错误签名、哈希、redirect 或兼容性失败时继续使用 last-good。
- 离线重启仍可加载有上限的 last-good 缓存。

真实 loopback HTTP 功能门禁：

```bash
bun run test:hosted-ocix-functional
```

该门禁必须通过完整 OpenChamber 路由安装临时薄包，连接真实动态业务 API，
验证 Interactive UI、HTML Artifact、生成 Tool shim、确认式 write、权限等价更新、
权限扩大确认、资源篡改回退、离线回退、卸载凭据清理，并写出
`.tmp/hosted-ocix-functional/report.json`。manager 的 mock `fetchImpl` 单元测试不能替代此证据。

### 9.2 Host Bridge 与真实 API

- Interactive UI 和 HTML Artifact 都通过 manifest Action 调用 Business Gateway。
- 页面不能读取 Connector URL 或 credential。
- Agent Tool shim 只调用本地 Gateway，不包含第三方 API 实现。
- query、确认式 write、401、403、timeout、超限响应和 stale revision 映射正确。
- 第三方 API 继续拥有最终 RBAC/ABAC。

### 9.3 Secret 扫描

对以下位置搜索测试 Token 和 setup code：

- iframe/Runner DOM 与 descriptor
- Tool result 和 Agent 消息
- OpenChamber/OpenCode 日志
- routing report
- manager/capability API 响应
- App Board 持久化状态
- 截图和验收报告

任何命中均为 P0 失败。

## 10. Gate G：App Board 与联动

覆盖 Local OCIX、Hosted OCIX、MCP App 和 Agent Generated snapshot：

- 默认两列布局、拖动、resize、内部双向滚动。
- 手动打开仅允许默认参数和 Host mapping 满足 required schema 的 surface。
- 必填实体 ID surface 只能由 Agent 已推断 Context、已有 pin 或 Link 事件打开。
- 对话中的已安装 surface pin 后保留 Agent 推断参数。
- Agent Generated surface 固定为无业务权限的不可变安全快照。
- 同扩展 Link 校验 event schema、mapping 和目标 input schema。
- 重复事件合并；恶意或无效 payload 不创建/修改 tile。
- 关系 tile 使用一致颜色和邻近布局。
- inline/focus/fullscreen/popout 往返保持实例与状态。
- Settings、Dialog、标题栏和输入保护区始终覆盖 Runner；Runner 不溢出看板或对话滚动容器。

Managed Desktop Scripts Artifact 至少执行十轮：

```text
tile → focus → tile
```

每轮使用系统鼠标验证按钮中心的 hover 和点击，不能只用 DOM `.click()`。同时滚动 Artifact 穿过 App Board 标题区，并用系统级窗口截图验证没有 Runner 像素或磁贴控件越界。

## 11. Gate H：性能与长期运行

发布预算：

- 主入口文件：不超过 1,000,000 bytes。
- Artifact lazy chunk：不超过 25,000 bytes；gzip 不超过 10,000 bytes。
- 标准 surface ready 中位数：不超过 750 ms。
- Artifact ready 中位数：不超过 1,500 ms。
- materialize p95：不超过 50 ms。
- cache hit p95：不超过 20 ms。
- 代表性场景 RSS 增量：不超过 64 MiB。

场景：

- 20 个混合 tile。
- 10 个 Scripts Artifact 连续 focus/tile 往返。
- 500 次 Link 事件，含重复和无效 payload。
- Hosted manifest 100 次刷新，含 304、等价更新、权限扩大和失败回退。
- MCP App resource 冷/热缓存和 server 重连。
- 30 分钟空闲运行，隐藏 surface 不得持续轮询或占用 CPU。

记录 median、p95/max、操作次数、缓存数量和 RSS；不得用单次最快值声明通过。

## 12. Gate I：构建与平台

顺序：

1. focused tests
2. workspace type-check/lint
3. Web production build
4. bundled Electron runtime
5. Electron package
6. packaged macOS real Host acceptance

macOS 必须验证：

- DMG 安装和首次启动。
- bundle 内只有 lock 指定的 fork CLI。
- 内置 CLI 不显示官方升级通知。
- OpenChamber updater 只使用 fork release。
- MCP App、Local OCIX、Hosted OCIX、App Board 和 Scripts Runner。
- 系统级窗口截图覆盖原生 `WebContentsView` 合成结果。

Windows/Linux 在未获得 CI 或实机证据前标记 `unverified`，不得因协议和 TypeScript 跨平台就写成“已验收”。

## 13. 失败分级与修复循环

| 等级 | 示例 | 处理 |
|---|---|---|
| P0 | Token 泄漏、跨 Session 调用、签名/哈希绕过、用户数据损坏 | 停止发布，先修复并重跑安全矩阵 |
| P1 | 双栈失败、真实 API 失败、历史 Session 不可恢复、Runner 越界 | 停止发布， focused 修复后重跑所属 Gate 和下游 Gate |
| P2 | 降级提示错误、布局/hover/恢复问题、性能超预算 | 修复后重跑场景和相关打包验收 |
| P3 | 文案、诊断和非阻断视觉差异 | 记录并在发布前决定是否接受 |

每个失败记录：

- 固定 fixture 和输入。
- 当前 commit、fork/upstream commit、OpenChamber/CLI/SDK 版本。
- 首次失败证据。
- 根因。
- 修复 diff。
- focused 重试结果。
- 下游回归结果。

不得删除失败 attempt 或把第二次成功描述成首次成功。

## 14. 最终证据包

发布结论至少包含：

- 版本与 commit 矩阵。
- 每个 Gate 的命令、退出码、测试数和耗时。
- 真实 MCP/OCIX 服务版本和脱敏配置。
- 历史 Profile 兼容结果。
- Tool/Surface/Data/Interaction 六阶段结果。
- 安全攻击矩阵与 Secret 扫描结果。
- 性能与内存记录。
- macOS 系统级截图。
- DMG 路径、大小和 SHA256。
- Windows/Linux 的已验证或未验证声明。
- 未完成项、风险和回滚方式。

只有全部 P0/P1 关闭、macOS 首发 Gate 通过、未验证平台标注清楚后，才能发布正式版；否则只能发布 prerelease。
