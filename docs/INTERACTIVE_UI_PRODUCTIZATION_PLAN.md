# Interactive UI 产品化开发计划

> 状态：开发中
>
> 更新：2026-07-22
> 本轮不包含：Windows、Linux、Capacitor 的实机证据

## 1. 范围

本计划只追踪三个产品方向：

1. **Interactive UI 组件库 2.0**：让 Agent 在标准、安全的 Declarative 组件内获得更强的临时页面组合能力。
2. **Agent Generated Scripts HTML Artifact**：为一次性自定义 HTML/SVG/Canvas/受限 JS 增加可停止、可恢复、可观测的运行控制。
3. **OCIX 扩展生态**：改善 Marketplace、版本更新、扩展诊断和开发者闭环。

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

此批实现的是 **Frame 生命周期控制**。它尚不等于浏览器/Electron 中独立、可按 PID 强制终止的 Renderer 进程，因此 Agent Generated Scripts 仍是 experimental、default-off。

### 2.3 扩展生态

- Marketplace Catalog 中与 active version 相同的条目标记为“已安装”。
- 更高 semantic version（包含 prerelease 比较）显示“更新”；旧版本仍保持显式版本安装能力。
- 已安装扩展新增“扩展诊断”，显示安装来源、受管 Tools、Skills、签名包 SHA-256 和未解析 Tool 绑定。
- Settings 新文案已同步全部 10 个 Locale。

## 3. P2：下一批

### 3.1 组件库和视觉

- 增加 Calendar/Agenda、Funnel、Sankey/Network 等候选前，先冻结各自的数据合同、最大规模和窄屏退化方式。
- 给 Gallery 增加 light/dark、390/768/1024 px 的独立视觉 Golden；不让它改变既有 Generated Golden。
- 优化图表、Heatmap、Kanban 的键盘焦点、屏幕阅读器摘要和大数据降采样。
- 补充 `interactive_ui` 的模型语料，证明平价模型能正确选择新组件，而不是把所有任务都变成看板或仪表盘。

### 3.2 Scripts Artifact 独立 Runner

- 定义 `ArtifactExecutionBackend`：Host UI 只依赖 start/stop/restart/status，不依赖 iframe 细节。
- Desktop 后端评估独立 `WebContentsView`/Renderer，强制关闭不响应实例，并验证远程页面不能获得 Desktop preload 权限。
- Web 后端只在能证明独立进程或等价可终止边界后，才允许把 Scripts 从 experimental 调整为 production-supported。
- 增加 CPU 饥饿、内存增长、无心跳、伪造 heartbeat、长时间后台页面和多 Artifact 并发预算测试。

### 3.3 Marketplace 与开发体验

- Catalog 搜索、按发布者/能力筛选、变更日志和兼容性元数据。
- “检查全部更新”和逐包更新确认；失败后保持 active version 与 Agent Runtime 原子回滚。
- 可复制的扩展诊断报告，但继续排除 Tool 文件内容、凭据、Connector URL 和业务响应。
- 开发模式目录 watcher / CLI hot reload；必须与签名生产安装路径严格区分，不能覆盖用户自有全局 Tool/Skill。

## 4. 验收门槛

- 新 Declarative 组件经过 Generated sanitizer、OCIX validator、Renderer unit test、type-check 和 lint。
- Gallery 在真实对话 ToolPart 内渲染；standalone demo 仅作渲染器 harness。
- Artifact heartbeat 和停止不能扩大 Gateway、网络、存储、文件系统或 Desktop 权限。
- CPU/内存强制终止未完成前，不把 Scripts 标记为 production-supported 或默认开启。
- Marketplace 更新不得绕过 catalog hash、publisher trust、package signature、文件索引和 Agent Runtime 原子部署。
- 跨平台实机证据单独追踪，不阻断本计划的代码开发，也不能被本计划的静态检查替代。
