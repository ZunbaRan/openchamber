# Interactive UI 产品化开发计划

> 状态：代码实现完成；Marketplace 后续治理与跨平台实机证据另行追踪
>
> 更新：2026-07-22
> 本轮不包含：Windows、Linux、Capacitor 的实机证据

## 1. 范围

本计划只追踪三个产品方向：

1. **Interactive UI 组件库 2.0**：让 Agent 在标准、安全的 Declarative 组件内获得更强的临时页面组合能力。
2. **Agent Generated Scripts HTML Artifact**：为一次性自定义 HTML/SVG/Canvas/受限 JS 增加可停止、可恢复、可观测的运行控制。
3. **OCIX 扩展生态**：本批只改善连接诊断与开发者闭环；Marketplace 搜索、更新治理和热加载明确延期。

它不改变已经确定的 2×2 术语：形式仍是 Interactive UI / HTML Artifact，来源仍是 Agent Generated / Third-party Extension。

## 2. P1：已完成的第一批

### 2.1 组件库

- 新增 `gauge`：带最小值、最大值、单位、语义 tone 和无障碍 meter 属性。
- 新增 `heatmap`：二维分类矩阵、数值色阶、可读单元格标签和横向窄屏容器。
- 新增 `kanban`：只读列和卡片、状态 tone、计数与横向窄屏容器。
- 三个组件同时进入 Agent Generated sanitizer、Installed Declarative validator、Host Renderer 和 `interactive_ui` Tool schema。
- 新增显式开发 Tool `interactive_ui_gallery`。它只在用户明确要求组件 Gallery 时调用，并在正常 OpenChamber 对话 ToolPart 中渲染。

### 2.2 Scripts Artifact 运行控制

- `host.init` 下发实例级执行租约；默认最长运行 15 分钟。
- Host 注入的确定性 bootstrap 每秒发送一次 lease-bound heartbeat。
- 心跳超过 6 秒未到、租约到期、运行时错误或用户主动 Stop 时，Host 卸载活动 iframe。
- 停止或超时后保留原始 Tool 输出，并允许创建全新 Frame 重新启动。
- Bridge 继续校验 channel、sequence、消息字段和字节上限；heartbeat 不获得任何新权限。

此批最初只实现 **Frame 生命周期控制**；P2 已在 Managed Desktop 补上独立 `WebContentsView` Renderer。普通 Web iframe 仍不具备等价的 OS 级终止保证，因此 Web Scripts 继续 experimental、default-off。

### 2.3 扩展生态

- Marketplace Catalog 中与 active version 相同的条目标记为“已安装”。
- 更高 semantic version（包含 prerelease 比较）显示“更新”；旧版本仍保持显式版本安装能力。
- 已安装扩展新增“扩展诊断”，显示安装来源、受管 Tools、Skills、签名包 SHA-256 和未解析 Tool 绑定。
- Settings 新文案已同步全部 10 个 Locale。

## 3. P2：已完成（Marketplace 除外）

### 3.1 组件库和视觉

- 已增加 `agenda`、`funnel`、`network`，分别限制为 40 条/14 个日期分组、8 个阶段、30 节点/60 边；均提供窄屏布局和读屏语义。
- 给 Gallery 增加 light/dark、390/768/1024 px 的独立视觉 Golden；不让它改变既有 Generated Golden。
- 新组件已进入 Gallery、Agent Tool schema、Generated sanitizer、Installed validator 与 Renderer；平价模型统一语料的新增组件选型回归随下一轮统一验收执行。

### 3.2 Scripts Artifact 独立 Runner

- 已实现 `ArtifactExecutionSurface`：Host UI 只依赖 post/load/message/terminate，不依赖 iframe 或 Desktop Runner 细节。
- Managed Desktop 使用独立 `WebContentsView`/Renderer；专用 preload 不向 main world 暴露任何 Electron API，主进程拒绝权限、弹窗、webview、非 Artifact 导航和非白名单请求。
- Web 后端只在能证明独立进程或等价可终止边界后，才允许把 Scripts 从 experimental 调整为 production-supported。
- 主进程强制执行 15 分钟租约、每窗 4 个/全局 8 个并发、256 MiB working set 和连续 5 秒超过 90% CPU 的终止门槛；Stop 会销毁独立 renderer。原有心跳/Bridge 负面测试继续成立。

### 3.3 Marketplace 与开发体验（延期）

- Catalog 搜索、按发布者/能力筛选、变更日志和兼容性元数据。
- “检查全部更新”和逐包更新确认；失败后保持 active version 与 Agent Runtime 原子回滚。
- 可复制的扩展诊断报告，但继续排除 Tool 文件内容、凭据、Connector URL 和业务响应。
- 开发模式目录 watcher / CLI hot reload；必须与签名生产安装路径严格区分，不能覆盖用户自有全局 Tool/Skill。

### 3.4 Business connection 状态语义

- 凭据 `configured/expired` 与运行时 `unknown/reachable/unreachable/unauthorized/forbidden` 分层；配置 Key 后只显示“已配置、尚未测试”。
- 安全连接测试与真实 Gateway 请求更新内存中的最近健康证据和时间戳；进程重启后回到 `unknown`，不把健康缓存当成权限来源。
- 401、403、网络失败可诊断但仍由第三方系统决定 Key 的实际权限；浏览器响应中没有 Key、业务响应或 Connector 配置细节。

Marketplace 搜索、筛选、批量更新与开发目录 hot reload 不属于本轮完成范围，现有 Marketplace 代码不在本批继续扩展。

## 4. 验收门槛

- 新 Declarative 组件经过 Generated sanitizer、OCIX validator、Renderer unit test、type-check 和 lint。
- Gallery 在真实对话 ToolPart 内渲染；standalone demo 仅作渲染器 harness。
- Artifact heartbeat 和停止不能扩大 Gateway、网络、存储、文件系统或 Desktop 权限。
- Managed Desktop 只有在独立 Runner 可用时将 Scripts 标记为 `supported` 并默认开启；`OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS=false` 保留为紧急关闭。Web 仍为 experimental/default-off。
- Marketplace 更新不得绕过 catalog hash、publisher trust、package signature、文件索引和 Agent Runtime 原子部署。
- 跨平台实机证据单独追踪，不阻断本计划的代码开发，也不能被本计划的静态检查替代。
