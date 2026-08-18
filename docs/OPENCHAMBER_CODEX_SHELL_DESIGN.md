# OpenChamber Codex-style Shell 设计

> 状态：**设计冻结；roadmap P3.3 `planned`，尚未获得实现授权**
> 更新：2026-08-10
> 配套测试：[OPENCHAMBER_CODEX_SHELL_TEST_PLAN.md](./OPENCHAMBER_CODEX_SHELL_TEST_PLAN.md)
> 逐文件实施蓝图：[P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md) §7、§11.3、§15.4；若旧设计/mock 与蓝图的 current-state audit 冲突，以 roadmap + 当前代码 + 该蓝图为准。

## 1. 背景与目标

OpenChamber 已具备任务、项目、Git、计划任务、OpenCode 插件、OCIX 应用、
Files、Browser、Terminal 和应用看板。当前问题不是缺少能力，而是入口分散、
相似功能重复出现，用户必须记忆无标签图标。

本批次对标 Codex Desktop 的外层信息架构，统一左侧主导航、任务标题区、任务
输出摘要和右侧资源工作区。既有业务页面、生命周期和协议尽量复用；移动端保持
原架构。

## 2. 术语与边界

| 用户名称 | 内部对象 | 说明 |
|---|---|---|
| 应用 / Applications | OCIX extension | CRM、BI 等业务应用；可包含 Interactive UI、HTML Artifact、Tools、Skills 与业务 API |
| 插件 / Plugins | OpenCode plugin | 复用现有插件页面和能力；不是 OCIX 应用 |
| 应用看板 / App board | Extension Workbench | 右侧磁贴式工作台 |
| 任务 / Task | Session | 壳层使用“任务”，内部 SDK 类型继续为 `Session` |
| 输出 / Outputs | Task Output Registry | 成功写入的文件和显式附件，不从回答文本猜测 |

本批次不实现 Codex 插件协议、OCIX Marketplace、侧边任务或“复制任务”。

## 3. 总体信息架构

```text
┌──────── Left navigation ────────┬────────────── Current task ──────────────┬──── Right workspace ────┐
│ OpenChamber ▾           Search │ title · project · branch   Chat          │ [tab] [tab] ...   [+] │
│ New task                       │                  Outputs · Sidebar       ├─────────────────────────┤
│ Projects                       ├───────────────────────────────────────────┤ Files / Git / Browser   │
│ Git                            │                                           │ Terminal / Applications │
│ Scheduled                      │ conversation                              │                         │
│ Applications                   │                                           │                         │
│ Plugins                        │                                           │                         │
│                                │                                           │                         │
│ Tasks                          │                                           │                         │
└────────────────────────────────┴───────────────────────────────────────────┴─────────────────────────┘
```

桌面和宽屏 Web 使用该结构；移动端不迁移到三栏壳层。

## 4. 左侧导航

固定顺序：

1. New task / 新建任务
2. Projects / 项目
3. Git
4. Scheduled / 已安排
5. Applications / 应用
6. Plugins / 插件

视觉合同：

- 只收窄上述六个主导航项，不压缩项目和任务树；
- 行高 28px，左右内边距 10px，图标 18px，文字 14px；
- 使用“图标 + 文字”，选中态使用中性表面色；
- Applications 打开已有 OCIX 安装、卸载、连接与治理页面；
- Plugins 打开已有 OpenCode 插件页面；
- Git、Scheduled、Projects 只迁移入口，继续复用现有实现；
- 左下角 Settings、Help、About、Update 暂时保留；
- 头像按钮本批次不修复。

## 5. 当前任务标题区

### 5.1 布局

- 第一行左侧：文件夹图标、任务标题、唯一的 `…`；
- 第二行：项目名、Git 分支与工作树信息；
- Chat 保持主标签；
- 第一行右侧：任务输出摘要、展开/隐藏右侧栏；
- 第二行后直接进入对话内容；
- 删除主标题栏原有资源 `+`，资源入口迁移到右侧栏；
- 标题只允许一个省略号按钮，并提供 Tooltip。

点击任务标题主体打开现有任务切换器；点击 `…` 打开任务操作菜单。

### 5.2 任务操作菜单

菜单按以下顺序复用现有业务能力：

1. 置顶 / 取消置顶（立即生效，无确认）；
2. 重命名（小型 Dialog，Enter 提交、Esc 取消、禁止空标题）；
3. 从当前任务继续（复用完整 `ForkSessionDialog`）；
4. 添加计划任务（预填最近用户请求、当前项目、模型与 Agent）；
5. 在新窗口打开同一任务；
6. 分隔线后的归档（复用包含子任务提示的确认流程）。

归档项位于底部独立分组，使用普通文字颜色。归档成功后打开同项目最近任务，
没有则回到 Projects。新窗口失败通过 Toast 告知，当前窗口不切换。

“从当前任务继续”以最近一个已完整结束的 assistant answer 为锚点；流式输出中或
没有可用回答时禁用。继续后当前窗口切到新任务，原任务仍保留。模型、Thinking、
Agent、补充指令、工作树和 Goal 全部沿用现有 Fork Dialog。

## 6. 任务输出摘要

右上角“切换置顶摘要”改为任务输出摘要入口：

- 按钮始终可点击；有输出时显示强调态，没有输出时显示空状态；
- 默认展示最近 6 项，可展开更多、滚动和再次收起；
- 每次重新打开 Popover 时回到收起状态；
- 点击文件在右侧 Files 中打开；
- 不实现“来源”分区；
- 摘要按最近一次成功写入时间倒序；
- 同一绝对路径去重，并显示“已修改 N 次”；
- 已修改的已有文件显示 modified 标记；
- 删除项不进入默认 6 项，展开后显示 deleted；
- 二进制文件在 Files 中显示信息并可在 Finder 打开。

Registry 保留硬上限：outputs 200、seen calls 2000、UTF-8 JSON 2 MiB；按详细 P3 蓝图的确定性 LRU/oldest-output 规则淘汰。Observer 只消费 live Tool `non-completed → completed` authority delta（包含该completed state的attachments）；event-cursor durable replay仍按live event处理，但缺previous state时不登记，bootstrap/materialization/HTTP全量reconnect snapshot只建baseline。因此seen call被淘汰后重放旧历史也不得重复登记。

### 6.1 权威 Output Registry

Output Registry 是任务级元数据，不写入项目目录。只登记：

- 成功完成的 create / edit / write / apply-patch 类 Tool 调用；
- 同一成功 Tool completed state中，可证明为canonical local file的附件：必须同时有`source.type=file`、absolute `source.path`与指向同一路径的`file:` URL。

它不解析assistant自然语言，不消费assistant/user顶层FilePart，也不把只读文件、缓存、构建目录、失败Tool、`data:`/`http(s):`/resource附件或`filename`当路径。路径以绝对路径为稳定标识，Tool call ID用于一批metadata files+attachments的原子幂等。旧任务不回填；没有Registry时显示空状态。

## 7. 统一右侧资源工作区

### 7.1 取代旧结构

移除：

- 顶部主内容资源 `+`；
- 48px 右侧图标轨道；
- 旧的 Files / Git / Context / App board 文字标签条。

右上角保留一个“展开/隐藏侧边栏”按钮。收起只隐藏工作区，所有已打开资源继续
挂载运行；重新展开恢复标签顺序、活动标签、滚动位置和应用看板状态。

### 7.2 空状态与启动器

没有标签时显示启动器：

1. Files
2. Git
3. Browser
4. Terminal
5. Applications

已有标签时，标签栏右侧显示固定的 `+`，打开同一个启动器 Popover。

- Files、Git、Applications 是单例；再次选择聚焦已有标签；
- Browser、Terminal 是多实例；每次选择新建；
- `+` 固定，不随横向滚动移动；
- 单例已打开时在菜单中显示勾选；
- 不再提供 Side task。

### 7.3 标签与生命周期

- 标签支持横向滚动和拖动排序，顺序按 runtime + project + scope + server-owned incarnation 持久化；
- Browser 标题使用页面标题或域名；
- Terminal 标题使用工作目录；
- 重名多实例追加稳定序号；
- 标签全部关闭后回到启动器；
- 关闭 Files、Git、Applications 后再次打开，回到各自默认页面；
- Browser、Terminal 复用现有生命周期和关闭逻辑，不另造运行器；
- 收起同一项目的工作区只隐藏 viewport；切换项目时按现有 controller 语义 detach，服务端对未 attach 且无活动的 session 保留 30 分钟并每 5 分钟清扫；返回项目时在保留期内 attach/replay。若要长期保持 attach，须另做 controller/performance 决策，本文不承诺无限后台运行；
- 状态按 `runtimeKey + projectId + scopeDirectory + scopeInstanceId` 保存；`scopeDirectory`只来自session ownership的canonical project/worktree hint，真正的`scopeInstanceId`由server shared project-authority按incarnation签发opaque projection，client不得用path/projectId hash伪造。因此同project的root/worktree互不串，同路径worktree删除重建也不能接回旧Files/Terminal/Browser。fresh revalidation的network/503进入suspended并停止attach/create，只有同ID成功才恢复；不同ID丢弃旧resource。只有server明确422不支持authority时才建同activation稳定的随机ephemeral内存workspace，不持久、不恢复backend identity；完整wire与生命周期以P3蓝图§4.4.1/§7.4为准。

### 7.4 宽度

- 默认 420px，可拖动到 320–960px；
- Applications 第一次打开约占窗口 50%，之后记忆自己的宽度；
- Files、Git、Browser、Terminal 各记忆最近一次宽度；
- 收起后再展开恢复活动资源对应宽度；
- 不允许右侧资源挤出主页面或制造页面级横向滚动。

## 8. Applications 与连接配置

左侧 Applications 是管理面，右侧 Applications 是使用面；两者打开同一个连接
配置 Dialog。

连接配置由现有 server-side Connection Secret Store / Gateway 持有。公开给 UI 的 snapshot 只包含：

- connection ID；
- 名称；
- 安全规范化的 endpoint；
- configured / expired 状态；
- 可选 header **名称**（不含值）；
- 最近测试状态；
- 最近测试时间。

access key 和 custom header values 只通过专用写接口进入 server-private store，永不回填 UI，不进入 Workspace/Output/localStorage 或 renderer IPC。

规则：

- business connector endpoint 按现有 HTTP/HTTPS 规则校验且禁止 URL 内凭据；provisioning 和 Remote manifest/resource 使用更严格 HTTPS/loopback 规则，Configure Dialog 不得混用两类校验；
- 用户配置优先于环境变量，环境变量优先于 manifest literal；
- 用户配置保持覆盖，直到用户明确清除；
- 保存后立即测试并热刷新 Catalog，无需重启；
- UI 与 Agent 输出不得显示 access key；
- 缺少 endpoint 时扩展和页面仍保留在 Catalog / App board，只阻止 API 调用；
- 未配置显示 Configure；离线显示错误、Retry、Configure，但页面壳仍可见；
- disabled、missing、incompatible、integrity failure 各显示具体原因及 Enable /
  Reinstall / Remove from board；
- 卸载扩展按现有安全事务清理 credential 与 tiles；任一 cleanup/uninstall 失败时保持扩展已安装，避免 orphan secret。数据保留策略若要改变必须另立项；
- Finder 启动的打包应用不得依赖 Terminal 注入环境变量。

环境变量只作为开发和自动化回退。City Ops 的
`${OCIX_CITY_OPS_API_URL}` 未设置时不得再导致整个应用目录被排除。

## 9. 复用、主题、可访问性与多语言

必须复用：

- SessionSwitcher、ForkSessionDialog、归档、计划任务和置顶逻辑；
- GitView、Files、Browser、Terminal 生命周期；
- Extension Workbench、Catalog、磁贴、Pin、Focus、Popout 和联动；
- Shared Button、Dropdown、Dialog、Tooltip、Icon sprite 和语义主题 Token。

新增文案必须在所有已发布 locale 中提供真实翻译，不允许以英文占位。发布验收
至少实际检查 English 与简体中文、light 与 dark。

纯图标按钮必须有 accessible name 和 Tooltip；标签使用 `aria-selected`，菜单
关闭后焦点返回触发器，关联磁贴不能只靠颜色表达。

## 10. 持久化与迁移

- 右侧资源标签、顺序、活动项、宽度和折叠状态按 runtime + project + canonical root/worktree scope + server-owned incarnation 持久化；同路径scope identity旋转时旧live adapters先close/detach并tombstone，绝不迁入新workspace；
- Output Registry 按任务持久化；
- 旧壳层状态迁移到新的单例 Files / Git / Applications 标签；
- 无状态、空状态、损坏状态必须可区分并安全恢复；
- 任何持久化数据不得包含 Browser 页面凭据、Terminal 输出或业务 API 响应；
- access key 只存在 server-private Secret Store 中；public snapshot、日志与前端状态只显示脱敏状态。

## 11. 实施顺序

1. 更新设计与测试基线；
2. 收窄左侧主导航；
3. 重构标题区和任务操作菜单；
4. 实现统一右侧工作区、启动器、标签和持久化；
5. 实现 Output Registry 与摘要；
6. 复用现有连接 endpoint / headers、Catalog 降级与卸载 cleanup transaction，并让管理面/Workbench 共用安全 Dialog；
7. 补齐所有 locale 与自动化测试；
8. 打包 DMG，在独立安装环境完成真实扩展和 API 验收。
