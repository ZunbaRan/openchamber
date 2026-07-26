# OpenChamber Codex-style Shell 测试计划

> 状态：设计冻结，等待新实现验收  
> 更新：2026-07-26  
> 设计依据：[OPENCHAMBER_CODEX_SHELL_DESIGN.md](./OPENCHAMBER_CODEX_SHELL_DESIGN.md)

## 1. 完成定义

本批次只有在自动门禁、真实 Host、真实 City Ops API、packaged macOS 和截图证据
全部通过后才能称为完成。静态 Mock、开发服务器 fallback 或“组件能编译”不能
替代真实验收。

## 2. 自动门禁

```bash
bun run type-check:ui
bun run lint:ui
bun run build:web
```

必须新增 focused tests：

1. 左侧六项顺序、28px 合同、Applications / Plugins 目标隔离；
2. 标题点击与 `…` 分流，任务菜单顺序和禁用状态；
3. Fork 锚定最近完成回答并复用完整配置；
4. Output Registry 仅接受成功写 Tool，路径去重、计数、删除与排序；
5. 右侧启动器单例 / 多实例、关闭、聚焦、拖动、项目隔离与迁移；
6. 320–960px clamp、资源类型宽度记忆和 Applications 首次 50%；
7. 缺少 endpoint 时 Catalog 保留，API 调用被阻止；
8. user endpoint > env > manifest，清除用户配置后恢复回退；
9. 保存连接热刷新、headers、测试状态脱敏；
10. 卸载保留连接数据，显式删除才移除；
11. 所有 locale key 完整且不是英文占位；
12. mobile 渲染路径不使用新桌面壳层。

## 3. 桌面 Real Host 流程

### Flow A：左侧与任务标题

1. English / 简体中文各执行一次。
2. 验证 New task、Projects、Git、Scheduled、Applications、Plugins 顺序。
3. 验证六项行高 28px，项目与任务树间距未被压缩。
4. Applications 打开 OCIX 管理；Plugins 打开 OpenCode 插件。
5. 点击标题主体打开任务切换器，点击 `…` 打开任务菜单。
6. 验证置顶、重命名、归档、继续、计划任务、新窗口。
7. 流式输出时继续按钮禁用；完成后使用最新完整回答 Fork。
8. 验证归档后的跳转和新窗口失败 Toast。

### Flow B：任务输出摘要

1. 在任务中成功创建、修改、再次修改、删除文本文件，并生成图片。
2. 同时执行一次失败写入和一次只读文件。
3. 验证默认最近 6 项、展开更多、滚动、收起和重新打开复位。
4. 验证同路径去重、修改计数、modified / deleted 标记和时间排序。
5. 验证失败写入、只读文件、缓存和构建产物不出现。
6. 点击文本文件在 Files 打开；点击二进制文件显示信息和 Finder 入口。
7. 打开旧任务，确认不回填并显示空状态。

### Flow C：右侧资源工作区

1. 清空全部标签，验证 Files、Git、Browser、Terminal、Applications 启动器。
2. Files、Git、Applications 各点击两次，验证单例聚焦。
3. Browser、Terminal 各点击两次，验证创建两个实例及稳定标题后缀。
4. 拖动标签换序、切换活动项、横向滚动，验证 `+` 固定。
5. 收起右侧栏，确认 Terminal / Browser 仍运行；展开后恢复。
6. 关闭所有标签回到启动器。
7. 关闭再打开 Files / Git / Applications，验证回到默认页面。
8. 在项目 A 打开 Terminal，切到项目 B，再返回 A，验证实例和顺序恢复。
9. 分别调整 Files、Git、Browser、Terminal 宽度并验证各自记忆。
10. Applications 首次约 50%，调整后记忆；所有类型限制在 320–960px。

### Flow D：应用看板与真实连接

1. 安装并启用当前签名 City Ops `.ocix`。
2. 不设置 `OCIX_CITY_OPS_API_URL`，从 Finder 启动应用。
3. 验证 Catalog 和十个页面仍存在，磁贴显示“连接未配置”而非
   “disabled, missing, or incompatible”。
4. 从管理页和看板分别打开同一个 Configure Dialog。
5. 填写本地 HTTP endpoint、access key、可选 header，保存。
6. 验证自动测试连接、记录时间、热刷新，无需重启。
7. 打开 Interactive UI 和 HTML Artifact 页面，验证真实 API 数据。
8. 停止 API，验证页面壳保留并出现 Retry / Configure。
9. 重启 API，点击 Retry 恢复。
10. 配置 user endpoint、env 和 manifest 三种值，验证优先级。
11. 清除 user endpoint，验证回落到 env；再清除 env，验证 manifest。
12. 禁用、破坏完整性和卸载扩展，逐项验证精确恢复动作。
13. 卸载后确认连接记录保留；点击“删除连接数据”后才消失。
14. 验证任何 UI、日志和 Agent 输出都不包含 access key。

### Flow E：应用看板回归

使用真实 City Ops 扩展验证：

- Catalog 手动打开带默认参数页面；
- 无默认参数的详情页不能直接打开；
- 聊天中推断参数后的 installed 页面可以 Pin；
- Interactive UI 与 HTML Artifact 都可 Pin；
- 拖动、缩放、内部滚动、Focus、Popout 和关闭；
- 列表选择联动详情磁贴；
- 关联颜色和非颜色标识；
- 刷新、重启、项目切换后的布局恢复。

## 4. 主题、语言和尺寸矩阵

| 维度 | 值 |
|---|---|
| 主题 | light / dark |
| locale | English / 简体中文 |
| 主窗口 | 1024 / 1280 / 1440 / 1728 |
| 左栏 | open / resized / closed |
| 右栏 | 320 / 420 / Applications 50% / 960 / closed |
| 状态 | empty launcher / multi tabs / output popover / menu / dialog |

每个主组合确认：

- 无窄列、重叠、页面级横向滚动；
- HTML Artifact 不遮挡菜单、Dialog、输出摘要或右侧标签；
- Tooltip、焦点环、选中态和键盘导航可见；
- 中英文无不可理解截断；
- light / dark 使用语义 Token；
- 移动端继续使用旧抽屉架构。

## 5. Packaged macOS 验收

必须安装当前 DMG 到独立位置，不能只运行开发 Host：

1. traffic lights、标题、菜单和拖窗区域不冲突；
2. Finder 启动，不继承 Terminal 环境变量；
3. 标题任务菜单六项全部可操作；
4. 输出摘要默认 6 项、展开和 Files 跳转通过；
5. 右侧五类资源、标签 `+`、拖动、多实例和宽度记忆通过；
6. 收起 / 展开保持 Browser、Terminal 和 App board；
7. City Ops 未配置、已配置、离线、恢复、卸载保留连接全部通过；
8. Interactive UI 与 HTML Artifact 在对话和应用看板都通过；
9. English / 简体中文、light / dark 各至少完整走一遍；
10. 重启应用后任务输出、右栏项目状态和连接记录恢复。

## 6. 截图证据

至少保留：

1. 深色英文完整壳层；
2. 浅色简体中文完整壳层；
3. 任务操作菜单；
4. 输出摘要默认 6 项和展开态；
5. 空右栏启动器；
6. 多 Browser / Terminal 标签及固定 `+`；
7. Applications 未配置连接；
8. Configure Dialog 和成功测试状态；
9. City Ops 真实数据 App board；
10. Interactive UI 与 HTML Artifact Pin / 联动；
11. packaged macOS 重启后的恢复状态。

截图必须来自当前 packaged build 或同一提交的真实 Host，并记录构建标识。

## 7. 发布判定

以下任意一项未通过都不得宣称完成：

- 自动门禁；
- 任务菜单真实动作；
- Output Registry 权威性；
- 右侧资源生命周期与项目隔离；
- City Ops 无环境变量降级与真实 API 恢复；
- 连接数据卸载保留与显式删除；
- English / 简体中文、light / dark；
- packaged macOS 手动验收与截图。

## 8. Fixture 卫生

- 自动验收不得永久依赖工作区外可变的 `extension/simple-crm-*`、历史 `.ocix` 或个人密钥目录；
- 缺失旧 fixture 时应报告“测试基础设施阻塞”，不得计为产品失败或伪装成通过；
- 当前扩展验收应使用仓库内不可变 fixture，或从本轮真实测试扩展生成临时包；
- 清理旧扩展后必须同步更新 `test:interactive-ui-functional`，防止后续 Agent 重复恢复已经废弃的测试目录。
