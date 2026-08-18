# OCIX Style v2 开发报告与测试计划

> **状态**：**已实现并合入主线**；自动化验收通过，人工视觉审查、真实模型对话与预设 Golden 子矩阵待执行
> **日期**：2026-08-06（合入状态回写 2026-08-07）
> **历史实施分支**：`openchamber-style-v2/` · `feat/ocix-style-v2`（实现 `2fdb7ae3`；合并 `4132bcef`；收尾 `3929ebbb`；worktree/分支已清理）
> **上游文档**：[详细规划](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md)（§14.1 实施状态）· [风格预设](./OCIX_STYLE_PRESETS.md) · [风格合同](./OCIX_STYLE_CONTRACT.md) · [Agent 简报](./OCIX_STYLE_V2_AGENT_BRIEF.md)

---

# 第一部分：开发报告

## 1. 背景与目标

上一轮美化（2026-07）解决了「有没有」，本次 Style v2 解决「好看且有层级」：单一视觉公式（全部节点同款 `OCIX_PANEL` 白卡）、Token 层偏薄、只有原子没有构图、Native Kit 天花板低四个结构性根因。按五层递进一次落地（用户授权不分阶段），并按 2026-08-05 设计方向拍板引入 **8 套品牌风格预设**（当前实现为 Host 级；扩展推荐未实现、非现行 manifest v1 合同；防彩虹红线保留）。

## 2. 交付明细

### L1 Token v2 + 风格预设系统

| 交付 | 文件 |
|------|------|
| 槽位扩展（radius-sm/md/lg、shadow-1/2、display/value 字阶类、chart-6~8、chart-seq-1~5、delta-up/down/flat、primary-tint/shade） | `packages/ui/src/styles/ocix-theme.css` |
| 7 套预设 × 明暗数据（vercel/notion/claude/apple/figma/binance/slack；linear=默认槽位值，未知 id 天然回落） | `packages/ui/src/styles/ocix-presets.css`（新增） |
| 预设注册/归一化/预览解析 | `packages/ui/src/lib/interactive-ui/stylePresets.ts`（新增） |
| Host 级持久化设置 + setter 归一化 | `packages/ui/src/stores/useUIStore.ts`（`ocixStylePreset`） |
| `data-ocix-preset` 挂载三处 `.ocix-scope` 宿主 | `InteractiveUIView.tsx`、`HTMLArtifactView.tsx`、`workbench/ExtensionWorkbench.tsx` |
| Settings → Applications 预设选择器（预览卡用该预设真实 token 渲染） | `components/sections/interactive-ui/StylePresetSection.tsx`（新增）+ `ExtensionManagerPage.tsx` 挂载 + 10 locale 文案 |
| CSS 引入 | `packages/ui/src/index.css` |

### L2 渲染层变体（`DeclarativeInteractiveView.tsx`，存量 JSON 零改动受益）

- **Emphasis 三档**：`hero`（hero tint 底 + display 字阶 + 加大 padding + shadow-1；**无**左侧 accent 色条——2026-08-06 审图后移除，色条属 AI-slop 刻板模式）/ `standard` / `quiet`（无描边）。自动规则：metric-grid ≤4 项首卡 hero、≥5 全 standard、bordered section 内嵌套 quiet（防卡片套卡片，收口 R0-M01）。可选 schema：`metric.emphasis`。
- **`metric.icon`**：29 个策展白名单（`lib/interactive-ui/metricIcons.ts` 新增），非白名单 sanitizer 直接丢弃。
- **表格**：`density: compact`、数字列 `tabular-nums`、`toneColumn` 行态整行着色。
- **图表（手绘 SVG 加深）**：8 色系、网格线减重、`referenceLine`（值/目标线）、图例点击显隐系列（`aria-pressed`）、donut ≤4 环、heatmap 迁移至 seq 色阶。
- **本地交互控件（2026-08-06 用户拍板新增）**：`data-table` 的 `searchable`/`sortable`/`pagination.pageSize`、`list` 的 `filterable`、`flow` 的 `orientation=vertical`、bar 图的 `stacked`。契约定论：**这些是对已内联数据的本地呈现状态（与 tabs/图例显隐同级），永不发起业务查询**——Generated 快照信任边界不变；需要服务端重查的筛选仍归业务 Tool 参数或 Trusted Native。sanitizer 仅接受布尔/枚举/有界数字。

### L3 构图模式（方案 α：`layoutMode` + section id 槽位）

- 根 stack 可选 `layoutMode: dashboard-hero | master-detail | report`；section 以 `id` 声明槽位（kpis/main/aside、master/detail、summary）。
- **Tool fail-closed**（`interactive_ui.ts`）：未知 mode、未知/重复槽位 id、缺必需槽位、KPI>4 均抛错，让模型从错误中学习格式。
- **Sanitizer 降级**（`generatedLayout.ts`）：非法 mode 剥离 mode 与 id、内容按自由堆叠保留——存量快照不失内容。
- 渲染器按槽位分区渲染（kpis 横带 / main 主区 / aside 侧栏；master-detail 左 1 右 2；report 顺序分节）。
- Skill 从节点字典升级为构图指南（单焦点、KPI≤4、模式选择表、do/don't）；gallery 加 `mode` 参数提供三模式演示。

### L4 Native Kit 扩充（`NativeUIKit.tsx` + registry + 类型）

| 批 | 组件 |
|----|------|
| N1 表单 | Select、Checkbox、RadioGroup、Switch（包装宿主原语，涂 `--ocix-*`） |
| N2 浮层 | Dialog 族、Tooltip 族（宿主已审计原语的别名导出） |
| N3 展示 | Stat（display 字阶 + delta 色）、DescriptionList、Avatar、Pagination |
| N4 布局 | Stack、Grid（1-4 列响应式）、Split（1:1/1:2/2:1）——破除扩展未扫描 Tailwind class 的硬约束 |

`nativeUIKitRegistry.ts` 与 `NativeActivationHost.ui` 类型同步；`uiVersion` 保持 1（纯增量，宿主即最新）。

### L5 规范与验收

- 新建 `docs/OCIX_STYLE_CONTRACT.md`（token 槽位 / emphasis / layout mode / 预设 / 禁止清单 / a11y / Golden 策略 / Kit 义务）。
- 回写 `packages/ui/src/components/interactive-ui/DOCUMENTATION.md` 与 `packages/web/server/lib/interactive-ui/DOCUMENTATION.md` 各加 Style v2 一节。
- 纠正 `INTERACTIVE_UI_BEAUTIFICATION.md` 实施状态对 token 的夸大表述。
- Golden 经 `test:interactive-ui-visual:update` 门禁刷新 24 张（含基线期已漂移的 5 张）。

### L6 HTML Artifact 设计指引（2026-08-07 增补）

- **Token 注入扩至全槽位**：`HTMLArtifactView.tsx` 的 `OCIX_ARTIFACT_TOKENS` 从旧子集（chart 仅 1–5）扩为完整 v2 槽位（chart-1…8、chart-seq-1…5、delta-3、radius-3、shadow-2、primary-tint/shade、panel-hero-bg）。宿主从预设感知的 `.ocix-scope` 读 computed value 注入沙箱文档根部 → Agent 生成与第三方 Artifact 都精确跟随当前预设。
- **第一方指引**：新增内置 skill `html-artifact-design`（按需加载）：token 契约表、字阶、与 Declarative 对齐的构图纪律、图表色序（chart-1→8 / seq / delta / primary-tint 参考线）、沙箱安全动效、自检清单。内置扩展版本 1.2.1 → **1.3.0**。
- **第三方指引**：开发者手册新增 §5.8（Artifact 视觉设计）；模板 `templates/interactive-ui-extension/ui/artifacts/explorer.html` 升级为 token 消费参考实现（radius/shadow/tabular-nums/focus-ring/reduced-motion）。
- **明确不迁移**：Generative Widget（show-widget）保持独立设计系统，两套路径刻意并存（用户拍板，已记入风格合同 §5）。

## 3. 关键决策落实

| 决策 | 落实 |
|------|------|
| Q5 预设制 | 8 套 Host 级预设已实现；view/扩展/Agent 无权选择；`recommendedPreset` 尚未实现，须另立 roadmap/schema/UX 项 |
| D-P4 字阶统一 | 预设只改色板/圆角/海拔；无 serif、无 17px 正文特例 |
| 阴影边界 | 仅 token 化静态 box-shadow；dark 下所有预设 `shadow-*: none`（阶梯分层） |
| Q2 图表 | Declarative 保持手绘 SVG 加深；Native recharts（S6）未做，留独立评审 |
| 向后兼容 | 全部新字段 optional；旧 view JSON / 存量 Generated 快照渲染路径不变 |

## 4. 验证结果（2026-08-06，worktree）

| 门禁 | 结果 |
|------|------|
| `bun run type-check`（web/ui/electron/mobile 全 workspace） | ✅ 通过 |
| `bun run lint` | ✅ 0 error（`workbench-popout.tsx` 1 error 为基线预存在；4 个 warning 存量） |
| `bun test`（ui interactive-ui 21 文件） | ✅ **200 pass**（新增 sanitizer 7 例、渲染器 8 例、Native Kit 4 例） |
| `vitest run server/lib/interactive-ui`（web） | ✅ **127 pass**（含 builtin v1.3.0 版本与新 skill 文件断言） |
| `bun run test:interactive-ui-extension` | ✅ **7 pass** |
| `bun run test:interactive-ui-visual` | ✅ 端到端可运行；`:update` 后仅 `artifact-interactive` 2 张亚像素抖动（动画帧时序，基线同型 flake） |
| `bun run docs:validate` | ✅ 396 页通过 |
| `bun run dead-code` | ✅ 新增导出均在用（报告其余为基线存量） |

### 4.1 合并后验证（2026-08-07，主仓）

| 门禁 | 结果 |
|------|------|
| Style v2 UI / sanitizer / Native Kit | ✅ 32 pass / 0 fail |
| Remote runtime / manager / built-in 联合回归 | ✅ 179 pass / 0 fail |
| 生产 `registerRoutes` 接线 | ✅ 7 pass / 0 fail |
| 全 workspace type-check | ✅ 通过 |
| UI lint | ✅ 0 error；3 个非 Style 既有 warning |
| workspace lint | ⚠️ 仅既有 `packages/web/src/workbench-popout.tsx:50` error |
| dead-code（Style v2 新增路径过滤） | ✅ 无命中 |

## 5. 偏差与遗留

1. **S6（Native recharts）未做**：按计划属独立依赖评审。
2. **Golden 剩余抖动**：`artifact-interactive` 2 张动画帧时序敏感（基线同型 flake，非本次引入）。
3. **演绎深色 4 套 + Slack 全套**为策展/推导值（PRESETS §5），数值正确性待人工审图确认。
4. **已收口的合入事项**：`bun.lock` registry URL 噪音已还原；分支最终文档已取代主仓同名副本；Style worktree/分支已删除。历史 worktree 的 GitHub Packages 403 仅是当时环境记录，不是当前产品状态。

---

# 第二部分：测试计划

## 6. 测试分层总览

| 层 | 覆盖 | 状态 |
|----|------|------|
| 单元（sanitizer / 渲染器 / Kit） | 新增 15 例 + 存量 181 例 | ✅ 已自动化 |
| 服务端（runtime/manager/gateway） | 127 例 | ✅ 已自动化（未受影响，回归通过） |
| 契约（CLI/打包/签名） | 7 例 | ✅ 已自动化 |
| 视觉 Golden | 62 场景基线刷新 | ✅ 已刷新；预设矩阵场景**待补**（见 §9） |
| 人工视觉审查 | 8 预设 × 明暗 | ⬜ **待执行（本计划核心）** |
| 真实对话流（模型路由） | Qwen 17 条冻结语料 | ⬜ 待执行（L3 skill 变更后必跑） |
| 平台矩阵 | macOS Web | ✅；Desktop/移动 ⬜ |

## 7. 人工视觉审查矩阵（P0，合入后发布验收）

按预设逐套在 Settings → Applications 切换，审查四类场景。命令：`bun run demo:interactive-ui:start` 起真实对话流，或用 gallery 工具（`mode=dashboard-hero` 等）。

**场景**：A. dashboard-hero gallery（KPI 带+主图+侧栏）· B. data-table（density/toneColumn）· C. chart 族（bar/line/donut/heatmap + 图例交互 + 参考线）· D. Workbench（tile 混排同皮检查）。

| 预设 | Light 审图重点 | Dark 审图重点（演绎值） |
|------|----------------|--------------------------|
| linear | 与旧版观感差（hero/层级是否可辨） | 阶梯分层是否清晰（无阴影） |
| vercel | 黑 CTA 在企业场景是否过重 | 极性翻转按钮可读性 |
| notion | 暖灰发丝线对比 | 暖灰是否偏冷、primary 提亮对比度 |
| claude | 奶油底在对话流内的融合度 | coral `#d97757` 在 `#181715` 上对比度 |
| apple | 大留白密度是否过稀 | 纯黑画布是否过闷 |
| figma | pill 按钮与宿主 Button 的一致性 | primary 切 `#0d99ff` 的品牌感损失 |
| binance | 黄 accent 小面积是否成立 | 黑字黄底签名组合不反转 |
| slack | aubergine 主色气质 | aubergine 提亮幅度 |

**通过标准**：每套明暗两板——文本对比度无肉眼不可读、hero/standard/quiet 层级可辨、chart 色可区分、无元素溢出（含 390px）。不通过的只许改 `ocix-presets.css` 数值，不改结构（O6 通道）。

## 8. 功能回归清单（P0）

1. **存量兼容**：旧 view JSON（无新字段）渲染不变形；历史 Generated 快照（旧 envelope）仍可打开。
2. **sanitizer 防线**：`layoutMode` 非法 → 内容保留 mode 剥离；`icon` 非白名单 → 丢弃；任意 hex/className → 拒绝（已有测试覆盖，人工抽查一次 gallery）。
2.1 **本地交互**：表格搜索/排序/分页、列表过滤在 Generated 快照（无业务连接）下可用且不触网；`pageSize` 超界被钳制；`stacked` 仅 bar 生效；`orientation=vertical` 连接线与节点对齐。
2.2 **Artifact token 注入**：静态/脚本 Artifact 在明暗与新预设下渲染无硬编码色差（抽 figma/binance 两套即可暴露问题）；既有 artifact golden 零像素漂移（token 注入为纯增量）。
3. **Agent 路由**：跑 Qwen3.7 Plus 17 条冻结语料（`test:interactive-ui-conversation-browser`），确认 skill 构图指南变更后**业务 Tool 优先、已有 View 不二次生成**纪律不回归，且 layoutMode 调用格式错误率可接受（fail-closed 报错后模型能自纠）。
4. **预设切换**：Settings 切换即时生效（对话内既有视图、Workbench、Artifact 宿主同步换肤）；重启后持久化；非法 id（手改存储）回落 `linear`。
5. **Native 扩展**：acme-sales/crm 示例在对话流与 Workbench 渲染正常；新 Kit 组件在一个示例扩展中实测（Select/Dialog/Stack）。
6. **跨宿主**：Desktop（Electron）与 hosted mobile 各抽一套预设一个场景；Windows/Linux/Capacitor 保持 `unverifiedPlatforms` 口径，不伪报。

## 9. Golden 增补计划（P1）

- 现有：`linear` 全量 62 张基线（已刷新）。
- 增补：其余 7 预设 × 明暗 × 3 场景（declarative dashboard / data-table / chart）≈ 42 张，需先扩展 `verify-interactive-ui-visual.mjs` 支持 `data-ocix-preset` 矩阵（当前脚本未覆盖预设维度——**这是已知的测试基建缺口**）。
- 纪律：只走 `:update` 门禁；`artifact-interactive` 抖动场景建议先加就绪延时或冻结动画帧，再入基线。

## 10. 性能检查（P1）

- Bundle：`ocix-presets.css` 约 14KB（未压缩）；UI bundle 增量来自 Native Kit 新组件（包装宿主原语，增量应 <10KB gzip）——用 `test:interactive-ui-runtime-performance` 确认缓存命中 p95 与 lazy chunk 口径不变。
- 渲染：预设切换为纯 CSS 变量切换，无重挂载；图例显隐为本地 state。

## 11. 验收退出条件（Definition of Done）

1. §7 矩阵 8×2 全过，演绎数值定稿。
2. §8 全部回归通过，Qwen 17/17 不劣化。
3. §9 预设 Golden 子集入库（或明确记录为后续批次）。
4. [x] `bun.lock` 噪音还原；worktree 分支合入并清理；主仓库三份重复文档删除。
5. [x] PLAN §14.1、简报与本文档已回写为“已实现并合入、自动化通过、人工验收待执行”；仅在 §7–§9 与真实对话/平台抽样完成后再改为“全部验收通过”。
