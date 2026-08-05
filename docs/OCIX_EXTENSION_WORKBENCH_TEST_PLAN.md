# OCIX 扩展工作台测试计划

> 状态：**测试设计冻结；macOS arm64 首发统一报告已通过**  
> 版本：Draft 4
> 更新：2026-08-02
> 设计依据：[OCIX 扩展工作台设计](./OCIX_EXTENSION_WORKBENCH_DESIGN.md)  
> 通用执行纪律：[Interactive UI / OCIX Agent 自主测试手册](./INTERACTIVE_UI_AGENT_AUTONOMOUS_TESTING.md)

### 当前证据摘要（2026-07-25）

以下证据均在 2026-07-25 由当前工作区/当前 macOS arm64 packaged build 实际执行：

| 证据 | 结果 |
|---|---|
| `bun run type-check:ui` | 通过 |
| `bun run type-check:web` | 通过 |
| `bun run type-check:electron` | 通过 |
| `bun run build:web` | 通过；`workbench-popout.html` 已进入生产产物 |
| `bun run test:extension-workbench-unit` | 通过；30 个测试文件，179 pass / 0 fail / 793 assertions；报告位于 `.tmp/extension-workbench/unit/report.json` |
| Electron Artifact Runner 单测 | 通过；同一 Runner view 迁移/恢复与最多三个 Popout |
| 生命周期聚焦回归 | 通过；受限声明式迁移、原子 Tile 替换、Gateway 阻断、卸载影响计数与定向清理 |
| Sales 验收 OCIX validator | 通过；1 Declarative + 1 Native + 1 Scripts Artifact + 3 Tools |
| Browser Real Host 子集 | 通过；Catalog、手动启动、真实 Gateway 数据、列表 → HTML 详情、Context、Focus/Escape、Declarative Popout 占位/恢复、重载恢复 |
| `bun run test:interactive-ui-functional` | 通过；安装、升级、禁用/启用、回滚、恢复、卸载、重装，Gateway 查询/确认写入/错误映射与凭据清理 |
| `bun run test:interactive-ui-security` | 通过；27 pass / 0 fail，static/scripts 目标网络请求与浏览器 runtime error 均为 0 |
| `bun run test:interactive-ui-visual` | 通过；54 个 runtime/theme/width/locale 组合，62/62 Golden，像素差异 0，a11y/runtime error 0 |
| `bun run test:interactive-ui-runtime-performance` | 通过；主入口 922,133 B / 270,875 gzip；Artifact lazy chunk 24,467 B / 8,420 gzip；标准 Surface 中位数 180–291 ms，Artifact 955–970 ms |
| `bun run test:interactive-ui-desktop-packaged` | 通过；macOS arm64、bundled OpenCode、Generated/Static/Scripts/Installed Artifact、重启和真实 Gateway 数据，runtime error 0 |
| `bun run test:artifact-runner-clipping-packaged` | 通过；滚动裁剪、Dialog 遮挡/恢复、workspace/fullscreen/inline 循环与同 Runner 实例保持 |
| `bun run test:interactive-ui-model-routing` | 通过；Qwen3.7 Plus 17/17，业务/Generated/Artifact 准确率 100%，误选与重复主视图率 0 |
| `bun run test:extension-workbench-unified` | 通过；8/8 本地门禁，`ok=true`、`complete=true`、`releaseCandidate=macos-arm64` |

2026-08-02 新增的 MCP App Workbench 持久化与 iframe 生命周期回归已经进入聚焦
自动化：服务器覆盖内容寻址 snapshot、Board CAS、binding 锁定和失败保留；UI 覆盖
等价 metadata 不改变 App document policy、串行 model-context 持久化、focused 退出
恢复 inline，以及 Web download 确认/取消/中止。它们是下一份统一报告必须纳入的
增量门禁，不能用 2026-07-25 的旧统一报告代替本轮 Real Host 与 packaged 复验。

统一报告：`.tmp/interactive-ui-unified-acceptance/report.json`。`capacitor-mobile`、`managed-desktop-windows`、`managed-desktop-linux` 仍写入 `unverifiedPlatforms`；它们不属于本计划的 macOS 首发阻断项，也不得宣称已经通过。

## 1. 测试目标

本计划验证 Extension Workbench 不是一个只在 Demo 中可拖动的静态面板，而是在真实 OpenChamber Host 中完整成立的产品闭环：

```text
签名 OCIX
  → 安装与发现
  → Catalog
  → 手动启动 / Agent Tool / Pin
  → Board 持久化
  → Surface 渲染
  → 同 OCIX typed event 联动
  → Gateway 真实查询 / 确认式写入
  → Focus / Popout / Runner 生命周期
  → 升级、禁用、卸载
```

任何单独 fixture 页面、静态截图、React 组件测试或 mock Tool 输出都不能替代 Real Host 验收。

## 2. 验收原则

1. 使用真实 OpenChamber Host 和当前构建产物；
2. Third-party 场景使用签名 OCIX；
3. Agent 场景使用 bundled OpenCode 和真实 Tool inventory；
4. API 场景使用确定性、可观测的本地业务服务，不用空 fallback 冒充成功；
5. 测试环境使用独立 data/config/cache/user-data，不读取用户现有扩展和 Key；
6. Tool 选择、Tile 创建、Surface ready、业务数据、联动目标和写入结果分别断言；
7. 失败重试保留 attempt，不把第二次成功报告为首次成功；
8. macOS packaged desktop 是首发证据；Windows/Linux 只能标注目标支持或 unverified；
9. Golden 只在明确视觉变更且人工审查后更新；
10. 每个报告记录 build identity、commit/source identity、平台、Runtime 和时间。

## 3. 测试资产

### 3.1 签名混合 CRM OCIX

新增或扩展一个专用验收包，至少包含：

| Surface | 形式 | 默认启动 | 用途 |
|---|---|---:|---|
| 销售概览 | Interactive UI Declarative | 是 | Catalog 手动启动、默认两列布局 |
| 客户列表 | Interactive UI Declarative | 是 | 发出 `customer.selected` |
| 客户详情 | HTML Artifact（scripts） | 否，需 `customerId` | 接收客户 Context，发出 `orders.requested` |
| 订单列表 | Interactive UI Declarative | 否，需 `customerId` | 接收客户 Context，发出 `order.selected` |
| 订单详情 | HTML Artifact（static 或 scripts） | 否，需 `orderId` | 多级联动终点 |
| Native 工作台 | Trusted Native | 是 | Host API、状态、Popout 支持声明 |

包内还应包含：

- 本地签名 SVG/PNG icon；
- `shortName: "CRM"`；
- default、required-only、host-context 和 invalid schema 变体；
- `manual`、`onFocus`、bounded `interval` 三种刷新策略；
- read action 与确认式 write action；
- compatible upgrade、incompatible upgrade 和 declarative migration fixtures。

### 3.2 第二个 BI OCIX

最小签名 BI 包用于验证：

- Catalog 按扩展分组；
- 多扩展共存；
- 禁止跨 OCIX Link；
- 卸载 CRM 不影响 BI Tile；
- 相同事件名不会跨 namespace 路由。

### 3.3 Agent Generated 样本

- 一份 Generated Interactive UI；
- 一份 static Generated HTML Artifact；
- 一份 scripts Generated HTML Artifact（只在支持的 Desktop Runner 下）；
- 每份都有稳定标题、snapshot/ref 和可识别内容。

它们只验证 Pin、恢复、Focus 和隔离，不调用 Business Gateway，也不参加首版自动 Link。

### 3.4 确定性业务 API

本地 CRM 服务至少提供：

- 客户列表、客户详情、订单列表、订单详情；
- revision 驱动的确认式写操作；
- 401、403、404、409、429、500、timeout；
- 请求计数和脱敏审计；
- 可动态绑定 loopback port；
- 固定非空数据，保证 fallback 与成功可区分。

### 3.5 当前可执行 Sales 子集

仓库中的 `examples/interactive-ui/acme-sales` 是当前 Real Host 快速回归资产：

| Surface | 形式 | 作用 |
|---|---|---|
| 销售概览 | Declarative Interactive UI | 默认 `east / 2026-07`，通过 Gateway 加载非空销售数据并发出 `order.selected` |
| 销售原生工作台 | Trusted Native | 缺少 `region` 时验证 Catalog disabled；明确不支持 Popout |
| 订单详情 | Scripts HTML Artifact | 缺少 `orderId` 时不可手动启动；由 Link 接收 `SO-1001` 等真实 Context |

它用于快速证明 Catalog、默认启动、参数门禁、真实查询、同 OCIX 联动、HTML 隔离和重启恢复。它不替代 3.1 的签名混合 CRM、3.2 的第二 OCIX、确认式写入、升级和 packaged desktop 资产。

### 3.6 标准 MCP 2026 App

使用一个可独立运行、严格协商 MCP `2026-07-28` 的 App（当前基准为本地 tldraw
MCP App）验证 Workbench 复用能力。资产必须提供：

- 一个模型可见的 open/create Tool，以及绑定 `ui://` resource；
- App-only save/export Tool；
- 稳定 entity/canvas ID、单调 revision 和可观察的 Server 状态；
- `updateModelContext`，使每次成功 mutation 都能产生新的可持久化 Tool result；
- inline preview、fullscreen editor、SVG/PNG download；
- 同一 endpoint 在 OpenChamber 重启、MCP reconnect 和历史会话恢复后仍可读取。

MCP App 不安装为 OCIX。它在 Catalog 中保持“MCP App”来源，Pin 后只复用 Board
snapshot、布局和 Focus 基础设施。

## 4. 测试层级与责任

| 层级 | 证明什么 | 不能证明什么 |
|---|---|---|
| Unit | normalize、schema、reducer、mapping、存储算法 | 浏览器布局、真实 Runner、真实 Tool |
| Component | Catalog/Board/Tile 状态与交互 | Electron 原生层级、Gateway |
| Server integration | Registry、Board API、Gateway、生命周期 | 最终用户界面 |
| Browser Real Host | 对话、Pin、Board、联动、视觉/a11y | Desktop Runner 原生行为 |
| Packaged desktop | WebContentsView、Popout、系统层级、重启 | 其他操作系统 |
| Model routing | 普通模型能选择正确 Tool 并携带 Context | 纯 UI 回归 |

## 5. Manifest 与 Catalog 单元测试

### 5.1 向后兼容

- 现有 `openchamber://extension/v1` 包不含任何新字段时继续通过；
- 旧 `views[]` / `artifacts[]` 在对话中行为不变；
- 缺失 `dashboard` 时 Catalog 能显示但不虚构 defaults；
- 新字段不改变签名文件完整性计算的确定性；
- pack 与 install staging 对同一输入得出相同结论。

### 5.2 Dashboard 正例

- Interactive UI 与 HTML Artifact 使用相同 normalized dashboard contract；
- `defaultContext` 完整时 `manualLaunch.enabled=true`；
- allowlisted Host Context 合并后满足 required 时可启动；
- layout 缺省得到 `6 × 4`；
- min/max 正确夹取；
- refresh 三种模式正确 normalize；
- emits/accepts/links 使用 extension namespace；
- 本地签名 icon 正确解析。

### 5.3 Dashboard 反例

逐项拒绝并断言稳定错误码：

- 不支持的 JSON Schema keyword、`$ref`、递归或过深 schema；
- default 不符合 schema；
- required 缺失却声明为可手动启动；
- Host Context 来源不在 allowlist；
- layout 超出 12 列、负数、min 大于 max；
- 远程 icon、脚本 SVG、伪造 MIME、超限图片；
- duplicate event/link ID；
- from/to Surface 不存在；
- cross-extension target；
- Source 未声明 emit 或 Target 未声明 accept；
- mapping 使用函数、模板、任意 JSONPath、动态 Target；
- interval 低于 Host 下限；
- payload schema 或默认 Context 超出大小、深度、节点数限制。

## 6. Context、身份与 Tile reducer

### 6.1 Context 合并

断言固定顺序：

```text
defaultContext → allowlisted Host Context → user input → validation
```

覆盖：

- 后层覆盖前层；
- 未声明 Host 字段不进入 Context；
- 业务 ID 永不从 project/session 名称猜测；
- schema 外字段移除；
- Secret-like 字段按策略拒绝或清除；
- undefined、null、数字和对象排序 canonicalize 稳定；
- canonical JSON 相同则 digest 相同。

### 6.2 去重与多实例

- 同 extension + surface + compatible version + Context 聚焦已有 Tile；
- key 顺序不同但语义相同仍去重；
- 不同 `customerId` 创建不同 Tile；
- 不同 Surface 不去重；
- compatible upgrade 后仍能命中；
- incompatible upgrade 不错误复用旧 Tile；
- 同一 Pin 连续点击不会创建多个实例。

### 6.3 Tile reducer

- add/remove/focus/popout/restore；
- drag end 和 resize end 一次性提交；
- invalid overlap 自动落到最近合法位置；
- Source 删除后 Target 保留且关系清理；
- group root 删除后的稳定降级；
- disabled extension 进入 placeholder；
- uninstall 只删除目标扩展 Tile；
- stale revision mutation 被拒绝并可重新加载。

## 7. Board Store 测试

### 7.1 持久化

- round-trip 不丢字段；
- 使用稳定 project ID，路径变化策略符合项目身份合同；
- 项目 A 与 B 完全隔离；
- 应用重启恢复布局、Context digest、关系和 display mode；
- 多 Board 数据可读取，但 UI 只使用 `default`；
- 写入使用临时文件 + 原子替换；
- 进程在替换前后中断不会产生半份 JSON；
- malformed file 进入可诊断恢复态，不导致整个应用崩溃；
- unknown schema version 不静默覆盖。

### 7.2 不落盘检查

扫描 Board 文件和相关日志，必须不存在：

- 测试 Access Key / Token；
- Authorization、Cookie；
- 完整客户或订单 API body；
- Artifact local/session storage；
- write confirmation challenge；
- Installed HTML 的业务截图；
- Runner/WebContents 原生标识。

Generated snapshot 只允许包含 sanitizer 后的安全内容。Installed Tile 只能保存 Context 和 Host 元数据。

### 7.3 内容寻址 snapshot 与 CAS

对 Generated Interactive UI、Generated HTML Artifact 和 MCP App 分别验证：

- 相同 form + Envelope 得到同一个 snapshot ref，不重复发布不同内容文件；
- snapshot ref 与实际规范化内容 digest 一致；文件缺失、JSON malformed、form/schema
  不匹配、超限、内容与 ref 不匹配时读取 fail-closed；
- 新 snapshot 是不可变文件，先完成写入再切换 Board pointer；模拟 snapshot 写失败时，
  Board revision、Tile ref、Context digest 和旧 snapshot 都保持不变；
- `replace-generated-snapshot` 必须携带当前 Board `expectedRevision`；两个并发写只有一个
  成功，陈旧写返回 revision conflict，重新加载后不得覆盖较新的 ref；
- installed Tile、form 不匹配、Tile 不存在和错误 source kind 都被拒绝；
- MCP App 更新前后 `server`、`resourceUri`、`toolKey` 必须完全相同；逐字段篡改均返回
  `workbench_snapshot_binding_mismatch`，且不产生可见的新 Board 状态；
- Server 重启后重新读 Board 和 snapshot，digest、binding、revision 与退出前一致。

UI mutation 还要验证同一项目内串行提交，以及 Runtime/project 切换后旧 completion
不能写回新 Store。一次持久化失败必须让当前 `updateModelContext` 返回可观察错误，
但后续合法更新仍可继续提交。

## 8. Catalog 与 Board 组件测试

### 8.1 Catalog

- 显示“扩展”入口；
- 以 `shortName` 分组，缺失时回退 `name`；
- CRM 与 BI 分组互不混淆；
- Surface 显示 Interactive UI / HTML Artifact 标识；
- required Context 缺失时 disabled；
- disabled 原因可见且有 accessible description；
- extension disabled、integrity failure、uninstall 后不再可启动；
- 折叠 Catalog 后 Board 扩展；
- loading、empty、error、unconfigured 状态完整。

### 8.2 默认布局

在目标宽度下：

- 默认 `6 columns`，一行两个；
- 第三个进入下一行；
- developer layout 正确应用；
- 过长 Artifact 保持 Tile 尺寸；
- 内容区上下和左右滚动；
- Artifact、iframe 或 Native 内容不突破边框；
- resize 始终遵守 min/max 和 12 列边界；
- viewport 变窄时布局可用且无 1 字符窄列回归。

### 8.3 拖动与缩放

Mouse：

- 小于 8px 不启动 drag；
- 标题栏可拖，内容区不可误拖；
- drop indicator 稳定；
- drop 后一次持久化。

Touch：

- 小于 200ms 的滑动仍滚动内容；
- 长按达到阈值后拖动；
- tolerance 内不抖动；
- `touch-action:none` 只在 handle。

Keyboard：

- 可拾取、移动、放置和取消；
- resize handle 可按步长调整；
- live region 播报目标位置和尺寸；
- focus 不丢失。

交互内容：

- 表格行点击、文本选择、图表 hover、按钮和内部滚动均不触发 Board drag；
- resize handle 不把 pointer 传给 iframe；
- 拖动结束后 Surface 继续响应。

## 9. Pin 验收

### 9.1 Agent Generated

- 对话内 Generated Interactive UI 点击 Pin 后创建 snapshot Tile；
- Generated HTML Artifact 点击 Pin 后仍在 sandbox 中运行；
- 对话原内容保留；
- Board Tile 可独立 Focus；
- 重启后从安全 snapshot/ref 恢复；
- 不出现 Gateway action；
- 不自动参加 Third-party Link。

### 9.2 Third-party Extension

- Agent Tool 已推断 `customerId` 后，Pin 直接使用该 completed Tool result 的 Context；
- Pin 不重新请求模型；
- Pin 不要求用户再次输入已经存在的参数；
- 对话 Surface 保留，Board 创建独立 live instance；
- Board 实例使用 Gateway 重新加载真实数据；
- 第二次 Pin 相同 Context 聚焦已有 Tile；
- Pin 不同客户创建第二个 Tile；
- Board 文件不保存业务响应。

### 9.3 MCP App

- 完成 MCP Tool 调用并渲染真实 `ui://` App 后点击 Pin；
- Board snapshot 保留原 `sessionId`、`messageId`、Server、Resource 和 Tool binding；
- App 内执行一次真实 mutation，使 revision 与 `structuredContent` 变化；
- App 的 `updateModelContext` 只有在新 snapshot 和 Board pointer 持久化成功后才返回成功；
- 连续发出两次更新时，第二次基于第一次已提交的 Envelope，不丢字段、不 revision 回退；
- result/title/structuredContent 更新和等价 metadata JSON 重水合期间，iframe DOM 节点、
  AppBridge nonce 和编辑器实例保持不变；
- 改变有效 CSP 或 verified resource digest 时，旧 bridge 完整 teardown 后只重建一次；
- 第二次 Pin 相同 binding/context 聚焦已有 Tile；不能通过 update 改绑另一个 MCP App；
- 重启 OpenChamber、重新连接 MCP、刷新 Board 后，恢复同一 entity/canvas ID 与至少相同
  revision；历史 snapshot 可先画 preview，但随后必须加载 Server 权威状态。

## 10. 联动 Event Broker 测试

### 10.1 正常链路

真实点击完成：

```text
客户列表 customer.selected(customerId)
  → 客户详情
  → orders.requested(customerId)
  → 订单列表
  → order.selected(orderId)
  → 订单详情
```

每一步断言：

- Source Surface 与 event 已声明；
- payload schema 通过；
- mapping 只读取允许路径；
- Target Context 通过 input schema；
- Target 相同 Context 时聚焦，不重复；
- 新 Tile 与 Source 相邻或落在下方最近空位；
- 全链使用同一 interaction group 颜色；
- 层级标签正确；
- Target 加载真实非空数据。

### 10.2 Surface API

分别覆盖：

- Declarative `emit` action；
- Trusted Native `props.host.dashboard.emit`；
- Installed HTML `window.openchamber.dashboard.emit`。

HTML 必须通过真实 broker/Runner 消息链路，不能在测试里直接调用 Host reducer。

### 10.3 拒绝场景

- 未声明事件；
- payload 类型或 required 错误；
- Artifact 伪造 extensionId、surfaceId 或 Target；
- Source 不属于当前 Tile；
- cross-OCIX Link；
- mapping 读取未允许的 Host/Context 路径；
- payload 超 64 KiB、过深或节点过多；
- 重复 event storm；
- Link 环；
- 超出 hop；
- stale/expired trace；
- disabled/uninstalled Target；
- Target required Context 映射后仍缺失。

所有拒绝都应：

- 不创建 Tile；
- 不调用 Gateway；
- 不泄露 payload 或凭据；
- 给开发诊断留下稳定、脱敏的 reason code；
- 不让整个 Board 崩溃。

## 11. Refresh、Gateway 与写操作

### 11.1 Refresh

- `manual` 只在点击后请求；
- `onFocus` 从不可见变为可见时请求；
- `interval` 不低于 Host 下限；
- hidden Workbench 不持续 interval；
- offscreen Tile 不高频请求；
- rapid focus 受 minimum interval 去重；
- 401/403/409/429/timeout 显示正确错误态；
- refresh 不改变 Tile identity 和关系。

### 11.2 Query

- 客户/订单数据来自真实本地 API；
- Key 仅由 Gateway 注入；
- Surface、Bridge、Board、event payload 和日志中无 Key；
- API 断开显示 unavailable，不显示空成功；
- query action 超出 Surface allowlist 被拒绝。

### 11.3 Write

- 用户确认前上游写请求数为 0；
- 取消后仍为 0；
- 确认后恰好一次；
- revision 正确；
- 成功后按策略刷新 read Surface；
- 409 不覆盖新数据；
- Focus、Popout、重启和 Link 不重放 write；
- event payload 不能携带 confirmation challenge。

## 12. Focus、Popout 与层级测试

### 12.1 In-app Focus

- 每种 Surface 进入和退出 Focus；
- 进入前后的 logical tile ID 相同；
- HTML Runner identity 不变；
- 播放中 Artifact 的状态连续；
- 退出后 Pin/Refresh/Focus/Popout 控件恢复；
- 多次切换不会出现 safety false positive；
- 更新弹窗、确认弹窗、设置弹窗必须显示在 Artifact 之上；
- Focus 内容不溢出主窗口；
- Escape 和按钮均可退出，焦点回到原触发器。

### 12.2 System Popout

- Declarative、HTML Artifact 和明确支持的 Native 分别打开；
- Board 原位显示占位符；
- 关闭系统窗口恢复原 Tile；
- Context、query state 和 Host-owned UI state 保留；
- 不支持 Popout 的 Native 显示 disabled 原因；
- 第四个 Popout 被明确拒绝，不静默替换前三个；
- 主窗口关闭时 Popout 按产品生命周期安全退出；
- extension disable/uninstall 时 Popout 关闭并清理。

### 12.3 Runner 原生裁剪

使用系统级截图和坐标断言验证：

- `WebContentsView` 不盖住输入框、侧栏、更新弹窗或系统弹窗；
- Board 滚动时 Runner 跟随 Tile clipping；
- Workbench resize、Catalog collapse、Tile drag/resize 后 bounds 正确；
- Focus 和 Popout 迁移期间没有旧 View 残留；
- 回到 inline/tile 后控件和裁剪恢复。

### 12.4 MCP App document、display mode 与下载生命周期

使用一个能持续编辑、保存模型上下文并导出真实文件的 MCP 2026 App，逐项验证：

- result、title、`structuredContent`、model context 和等价 binding metadata 更新时，
  iframe DOM 节点、resource nonce、AppBridge 和编辑器实例均不变；连续 100 次更新不
  产生额外 `load`、空白帧或未保存状态丢失；
- 只有 verified resource identity/digest 或 effective CSP policy 变化，以及用户显式
  Retry，才允许 teardown 并重新 materialize；重载前旧 bridge 必须关闭，旧 window
  的后续消息被拒绝；
- fullscreen 关闭按钮、Escape、backdrop、Workbench Focus 退出和外层 Dialog 关闭都
  最终向 App 发布 `displayMode=inline`；退出后 inline preview 与 Edit 控件恢复，不能
  留在半屏、隐藏 fullscreen 或陈旧 viewport 尺寸；
- App 调用 `downloadFile` 后可以等待用户超过普通短 RPC timeout；Host 在等待期间
  保持单个 pending confirmation，App 显示 exporting/等待状态而不是错误或无响应；
- Web Host 的确认层由 Host 拥有，明确显示文件名、MIME、大小和不可信来源；Save
  产生可打开且 digest 正确的真实文件，Cancel/Abort 返回可观察错误且不创建下载；
- Desktop 选择路径、取消、写入失败和成功均回传明确结果；同一窗口第二个并发下载
  被拒绝或排队，不能出现两个重叠保存流程；
- 保存 model context、Pin 并重启 OpenChamber/OpenCode 后，Board 从相同 snapshot ref
  恢复同一 entity/canvas ID 与 revision，重新连接 Server 后再安全收敛到权威状态。

## 13. Scripts Runner 资源测试

固定验证现有边界：

| 限制 | 验收 |
|---|---|
| 全局 active runners = 8 | 第 9 个进入可恢复 placeholder / LRU，不突破上限 |
| 单窗口 active runners = 4 | 第 5 个按策略 suspended/evicted |
| lease = 15 min | 到期后停止并可恢复 |
| memory = 256 MiB | 超限强制停止、Host 存活 |
| CPU 90% × 5 | 强制停止、错误稳定 |
| message = 64 KiB | 超限消息拒绝 |

还要验证：

- 隐藏 Workbench 触发 soft suspend/throttle；
- 恢复时按最近使用顺序恢复；
- LRU hard eviction 后用 Context 重启；
- 页面瞬时状态丢失时明确提示；
- Focus 不增加 Runner 数；
- Popout 迁移不产生幽灵 Runner；
- static Artifact 不占 scripts Runner 配额；
- crash 后只影响对应 Tile。

## 14. 生命周期测试

### 14.1 Disable / Enable

- disable 后 Catalog 不可启动，Tile 变 placeholder；
- 不再 refresh/query；
- 不占 Runner；
- enable 后在签名和完整性仍有效时恢复；
- Context 与布局保留。

### 14.2 Compatible Upgrade

- Tile 自动使用新版本；
- Context、layout、relationship 保留；
- Tool inventory 与 Catalog 只出现当前版本；
- 旧文件、Runner 和描述符无残留。

### 14.3 Incompatible Upgrade

- Tile 显示 migration/reopen；
- 支持的声明式 rename/path move/default migration 成功；
- `rename` 不能跨对象，`move` 可以跨已校验路径；
- `setDefault` 不覆盖已有值；
- 缺少 Source、Target 冲突、未知 operation、重复 fromVersion 和新 Schema 不通过时原子失败；
- 不支持的迁移不执行 JavaScript；
- 失败保留诊断 placeholder；
- 失败后 Gateway 继续返回 `workbench_migration_required`；
- 成功后保留 tileId、createdAt、relationship 和位置，并只夹取超出新 bounds 的尺寸；
- 不静默丢 Board。

### 14.4 Uninstall

- 确认框显示将删除的 Tile 数；
- 取消不改变任何状态；
- 确认后删除目标扩展 Tile、Link 和关系；
- BI 与 Generated Tile 保留；
- Popout 和 Runner 关闭；
- Agent Tool/Skill、连接和 Secret 按现有合同清理；
- 已卸载扩展不会因陈旧 Board 再出现 integrity toast。

## 15. Real Host 用户流程

### Flow A：Catalog 手动启动

1. 安装签名 CRM + BI；
2. 打开 Right Sidebar → 扩展；
3. 展开 CRM；
4. 点击“销售概览”；
5. 验证 Tile、真实数据和默认布局；
6. 验证“客户详情”因缺少 ID disabled；
7. 刷新并重启应用，验证恢复。

### Flow B：Agent 推断参数后 Pin

推荐使用 Qwen3.7 Plus：

```text
打开客户 cust-1001 的 CRM 详情
```

断言：

1. Agent 选择正确 Third-party Tool；
2. completed Tool result 的 `context.customerId=cust-1001`；
3. 对话 Surface 显示真实数据；
4. 点击 Pin；
5. Board 出现相同客户的独立 Tile；
6. 第二次 Pin 聚焦已有 Tile。

### Flow C：多级联动

1. 手动打开客户列表；
2. 点击 `Acme Manufacturing`；
3. 客户详情 Tile 出现；
4. 点击“查看订单”；
5. 订单列表 Tile 出现；
6. 点击订单；
7. 订单详情 Tile 出现；
8. 检查颜色、层级标签、位置和真实 API；
9. 删除根 Tile，确认详情保留但关系视觉清理。

### Flow D：确认式写入

1. 在客户详情修改状态；
2. 验证 Host 确认；
3. 取消，API 写计数仍为 0；
4. 再次执行并确认；
5. API 写计数为 1；
6. 相关 read Tile 刷新；
7. 重启后不重放写入。

### Flow E：Generated Pin

1. Agent 生成 Interactive UI；
2. Agent 生成本地 HTML Artifact；
3. 分别 Pin；
4. 断网、重启并恢复；
5. 验证 snapshot 行为、无 Gateway、无自动 Link。

### Flow F：Focus 与 Popout

1. 在滚动中的聊天和打开的 Workbench 中聚焦 Tile；
2. 打开更新/确认/设置弹窗；
3. 验证 Artifact 不遮挡；
4. 退出 Focus，控件恢复；
5. Popout，再关闭；
6. 验证原 Tile 恢复且状态一致。

### Flow G：MCP App 持久化、全屏与下载

1. 使用真实 MCP 2026 App 创建可编辑实体，并 Pin 到 App Board；
2. 在 fullscreen 修改内容并调用 `updateModelContext`，等待其持久化完成；
3. 在等待过程中更新 Tool result，断言 iframe 未重载且草稿仍存在；
4. 通过按钮、Escape 和外层关闭分别退出 fullscreen，断言每次均恢复 inline；
5. 导出 SVG/PNG，故意延迟确认超过短 RPC timeout，再接受并检查真实文件；
6. 再次导出并取消，断言无文件且 App 收到可见错误；
7. 重启客户端、重连 MCP 并打开 Board，断言 entity/canvas、revision、binding 与退出前
   一致；
8. 篡改 snapshot binding 的 Server、Resource 和 Tool，断言三种请求都被拒绝且旧 Tile
   仍可恢复。

## 16. 模型路由验收

Workbench 不要求所有动作都经过模型，但 Agent Pin 流程必须证明普通模型可用。默认基线为 Qwen3.7 Plus，至少覆盖：

| Prompt 类型 | 预期 |
|---|---|
| “打开 CRM 销售概览” | 选择带 defaults 的 Installed Surface |
| “打开客户 cust-1001 详情” | Tool result 携带 customerId |
| “固定到扩展工作台” | 触发 Host Pin，不重新生成页面 |
| “做一个临时销售漏斗图” | Agent Generated Interactive UI |
| “做一个可播放的本地模拟器” | Agent Generated HTML Artifact |
| “把客户列表和 BI 自动连起来” | 明确首版不支持跨 OCIX，不伪造 Link |

模型通过不能代替 UI、Gateway 或 packaged desktop 验收。选错 Tool、缺参数却声称已打开、把 Third-party 业务请求改成 Generated 页面都属于语义失败，不自动重试掩盖。

## 17. 视觉与可访问性矩阵

### 17.1 视口与主题

至少覆盖：

- light / dark；
- Workbench 45%、55%、65%；
- Catalog 展开 / 折叠；
- 主窗口窄、中、宽；
- 100%、125%、150% UI scale；
- reduced motion；
- 中英文；
- 长扩展名、长 Surface 名和长错误文案。

### 17.2 Golden 场景

建议固定：

1. 空 Board；
2. CRM + BI Catalog；
3. 默认一行两个；
4. mixed Interactive UI + HTML；
5. disabled required-input Surface；
6. 三层 relationship；
7. selected relationship connector；
8. long Artifact 双向滚动；
9. Focus；
10. Popout placeholder；
11. Runner suspended / evicted / crashed；
12. incompatible upgrade；
13. uninstall count dialog；
14. API error 与 confirmation；
15. keyboard drag 状态。

Golden 更新必须人工逐张确认，不允许测试脚本在普通运行中自动覆盖。

### 17.3 a11y

- 无严重 axe violation；
- 所有按钮有 accessible name；
- disabled reason 可被读取；
- drag/resize 有键盘等价操作；
- focus trap 只在 Focus/dialog 内生效；
- 关闭后焦点返回来源；
- group 关系不只靠颜色；
- live region 不连续刷屏；
- iframe/Runner title 明确；
- zoom 200% 仍可操作。

## 18. 性能与稳定性

首版固定场景：

- Board 文件含 50 个已保存 Tile；
- 同时可见 12 个；
- 单窗口最多 4 个 active Scripts；
- 全局最多 8 个 active Scripts；
- 连续完成 100 次 drag/drop；
- 连续完成 100 次 resize；
- 完成 200 次 event，其中包含去重和拒绝；
- Workbench 开关 50 次；
- Focus/restore 30 次；
- Popout/restore 20 次。
- 同一 MCP App 连续 100 次 result/model-context 更新且 iframe remount 为 0；
- MCP resource/CSP 各变化 10 次，每次只允许一次受控 teardown/remount；
- 下载确认延迟、接受、取消与中止各 20 次，无悬挂 promise、重复文件或确认层泄漏。

发布阻断条件：

- 主线程持续冻结或明显输入失去响应；
- Tile 丢失、重复或布局漂移；
- revision 回退覆盖新状态；
- Runner 数超过硬上限；
- 进程、窗口、端口或 WebContents 泄漏；
- hidden Board 继续产生无界请求；
- event 形成循环或无界 Tile 增长。

具体毫秒阈值在 W3 首个稳定实现取得基线后冻结；在此之前不得用随意阈值制造虚假精度。报告必须保留采样机器、场景、p50/p95/max 和 trace。

## 19. 安全测试

至少验证：

- 未签名、签名错误、文件 hash 缺失的扩展不能进入 Catalog；
- Board Context 注入不能越过 input schema；
- HTML Artifact 不能 fetch/XHR/WebSocket；
- Artifact 不能直接访问 Host DOM、其他 Tile 或任意 Target；
- event origin、channel、sequence 和 surface binding 不可伪造；
- Link mapping 不执行脚本；
- icon 不执行 SVG script；
- Popout 不扩大权限；
- hidden/suspended Runner 不接受陈旧 business response；
- logs/report/Board/screenshot 不含 Key；
- Installed 业务截图不落盘；
- write confirmation 不可重放；
- malformed Board 和恶意扩展不能让应用启动失败。
- MCP snapshot 不能改绑 `server`、`resourceUri` 或 `toolKey`；跨 binding 更新返回明确
  拒绝且 Board revision/ref 不变；
- 旧 resource nonce、旧 iframe window 和 teardown 后的 AppBridge 调用均被拒绝；
- Host download 必须经过 capability、文件约束与用户确认，App 不能用任意导航、外链
  或自行构造下载绕过 Host。

## 20. 计划中的自动化入口

以下入口均已存在。Workbench 名称是稳定别名，底层复用现有真实 Host、视觉、Runner 和 packaged harness：

```bash
bun run test:extension-workbench-unit
bun run test:extension-workbench-browser
bun run test:extension-workbench-security
bun run test:extension-workbench-visual
bun run test:extension-workbench-packaged
bun run test:extension-workbench-model-routing
bun run test:extension-workbench-unified
```

`test:extension-workbench-packaged` 会顺序运行 packaged Interactive UI 和 Artifact Runner clipping/occlusion；`test:extension-workbench-unified` 只聚合并校验当前报告，因此在干净环境中应先按第 21 节执行产生证据的门禁。

建议证据目录：

```text
.tmp/extension-workbench/
  unit/report.json
  browser/report.json
  security/report.json
  visual/baseline.json
  packaged/report.json
  model-routing/report.json
  unified/report.json
  screenshots/
```

每个报告最少包含：

- `ok`
- `complete`
- `build`
- `platform`
- `runtime`
- `startedAt` / `finishedAt`
- case 明细与 attempt；
- sanitized error；
- artifacts/screenshots；
- `externalBlockers`
- `unverifiedPlatforms`

## 21. 执行顺序

```text
T1 manifest / store / reducer unit
  → T2 Catalog / Board component
  → T3 server integration
  → T4 Real Host browser
  → T5 event / Gateway security
  → T6 visual / a11y
  → T7 model routing
  → T8 macOS packaged Runner / Popout
  → T9 performance / lifecycle soak
  → T10 unified report
```

任何后段修复都必须重跑受影响的后续门禁：

- 改 manifest：重跑 T1–T10；
- 改 Board CSS：至少重跑 T2、T4、T6、T8、T9、T10；
- 改 event broker：至少重跑 T1、T4、T5、T9、T10；
- 改 Runner/Popout：至少重跑 T4、T6、T8、T9、T10；
- 只改文档：运行 `bun run docs:validate`。

## 22. 清理与可重复性

每个 Real Host / packaged 测试都必须在 `finally`：

1. 关闭 Focus 与所有 Popout；
2. 停止 Scripts Runner；
3. 归档或删除本次测试会话；
4. 卸载本次临时安装的 CRM/BI OCIX；
5. 等待成功 Tool inventory，证明临时 Tool 消失；
6. 清理本次 connection 与测试 Secret；
7. 停止业务 API；
8. 停止 Host、bundled OpenCode 和 descendants；
9. 确认动态端口关闭；
10. 保留脱敏报告和明确要求的截图，其余临时 data/user-data/config 删除。

若测试前扩展已经存在，测试不得覆盖、禁用或卸载用户版本；应使用独立 data root。

## 23. 首版完成判定

只有以下全部成立，统一报告才能写 `ok=true`：

- manifest 新字段正反例与旧包兼容通过；
- Catalog、默认两列、拖动、缩放、内部滚动通过；
- 四类 Pin 通过；
- Context 去重和多实例通过；
- 同 OCIX 多级联动与循环防护通过；
- Gateway query 和 confirmation write 通过；
- Board 重启、项目隔离和敏感信息检查通过；
- MCP App 内容寻址 snapshot、Board CAS、精确 binding 锁定、无意外 iframe remount、
  inline 恢复、Host download 等待/确认和重启恢复通过；
- Focus、Popout、系统层级和 Runner 裁剪通过；
- disable/enable/upgrade/uninstall 通过；
- Qwen3.7 Plus 固定流程通过；
- 当前 macOS packaged build 通过；
- visual/a11y/security/performance 无阻断项。

`complete` 的含义必须单独解释：

- macOS 首发可在 `ok=true` 时标记该平台完成；
- Windows/Linux 无实机或 CI 证据时写入 `unverifiedPlatforms`；
- Marketplace、跨 OCIX、Generated 自动联动和团队 Board 不属于本计划，不能作为失败，也不能被宣称已实现。

### 23.1 2026-07-25 实际判定

- `ok=true`
- `complete=true`
- `releaseCandidate=macos-arm64`
- 8/8 本地门禁通过；
- Qwen3.7 Plus 17/17，`duplicatePrimaryViewRate=0`；
- Windows/Linux/Capacitor 保持 `unverifiedPlatforms`，没有被错误计入 macOS 首发完成度。

本轮曾发现 Qwen 在一个负例中连续四次调用同一 CRM 主 Surface Tool。修复不是放宽断言，而是把“成功 Envelope 已经渲染、每回合最多一次、无内联业务行也必须停止”加入扩展 Tool description、Skill 和 OCIX 开发规范；单例复跑后又完整重跑 17 项才关闭门禁。
