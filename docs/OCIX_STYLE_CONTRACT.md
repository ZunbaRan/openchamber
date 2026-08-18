# OCIX Style Contract（风格合同）

> **状态**：v1 冻结（随 Style v2 实现落地）
> **日期**：2026-08-06
> **适用范围**：Declarative（Installed / Generated）、Trusted Native、HTML Artifact 宿主、Extension Workbench
> **上游文档**：[Style v2 详细规划](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md) · [风格预设系统](./OCIX_STYLE_PRESETS.md) · [Agent 简报](./OCIX_STYLE_V2_AGENT_BRIEF.md)

本文是可验收的视觉合同。数值以 `packages/ui/src/styles/ocix-theme.css`（槽位）与 `packages/ui/src/styles/ocix-presets.css`（预设数据）为准；本文约束语义与禁止项。

---

## 1. Token 槽位（契约层）

| 组 | 槽位 | 规则 |
|----|------|------|
| 表面 | `--ocix-surface` / `-muted` / `-subtle` | 三级明度阶梯；面板只用这三档 |
| 边框 | `--ocix-border` | 1px 发丝线；hover/强调不加深一档以上 |
| 文字 | `--ocix-foreground` / `--ocix-muted-foreground` | 正文与次级两级；不新增第三级灰 |
| 交互 | `--ocix-selection`(+`-foreground`) / `--ocix-focus-ring` | 选中态与焦点环专用，禁作装饰 |
| 主色 | `--ocix-primary` / `-foreground` / `-tint` / `-shade` | 唯一 chromatic accent；tint=hover、shade=pressed |
| 语义 | `success|warning|error|info` × (fg/background/border) | 仅状态反馈；不作分类色 |
| 图表 | `--ocix-chart-1…8`（categorical）、`--ocix-chart-seq-1…5`（sequential，heatmap/funnel） | 数据可视化专用 |
| Delta | `--ocix-delta-up/down/flat` | 涨跌平；与 success/error 解耦（成本类涨≠好） |
| 圆角 | `--ocix-radius-sm/md/lg` | 小件 / 面板 / 大容器 |
| 海拔 | `--ocix-shadow-1/2` | 可为 `none`；此时层级由阶梯+发丝线承担 |

## 2. 字阶角色（全局统一，不随预设变化）

- `ocix-type-display`：KPI 大数字；600 weight、负字距、**强制 `tabular-nums`**。
- `ocix-type-value`：表格数字、分页计数等；`tabular-nums`。
- 其余角色沿用宿主 `typography-ui-label / typography-body / typography-meta / typography-micro`。
- **不**为单一预设引入专属字体（无 serif 标题、无 17px 正文特例）。

## 3. Emphasis 三档

| Tier | 语义 | 默认规则 |
|------|------|----------|
| `hero` | 单视图唯一视觉焦点：hero tint 底 + display 字阶 + 加大 padding + `--ocix-shadow-1`（**无**左侧 accent 色条） | metric-grid ≤4 项时首项自动；其余须显式 `emphasis` |
| `standard` | 默认面板 | 表、图、列表、独立卡 |
| `quiet` | 无描边无底 | bordered section 内的嵌套内容（防卡片套卡片） |

硬规则：单视图 hero ≤1；metric-grid ≥5 项全员 standard。

## 4. Layout mode（构图模式）

`layoutMode` 仅允许出现在根 stack，section 以 `id` 声明槽位：

| Mode | 槽位 | 必需 |
|------|------|------|
| `dashboard-hero` | `kpis` / `main` / `aside` | `kpis` + `main`；KPI ≤4 |
| `master-detail` | `master` / `detail` | 两者 |
| `report` | `summary` | `summary`（结论先行） |

- Tool 侧 fail-closed：未知 mode、未知/重复槽位 id、缺必需槽位、KPI 超限均报错。
- Sanitizer 侧降级：非法 mode 剥离、内容按自由堆叠保留（存量快照不丢内容）。
- 表格 `density: comfortable|compact`；`toneColumn` 指向状态词列时整行着色（success/warning/error 词表）。
- 图表 `referenceLine: { value, label? }`；图例可点击显隐系列；donut ≤4 环；`stacked`（仅 `bar`）展示构成，坐标轴按全系列行和稳定。

## 4.1 本地交互控件（2026-08-06 增补）

**契约：控件是 Host 持有的本地呈现状态，只变换已内联数据的展示，永不发起业务查询。** 与 tabs/accordion、图表 hover、图例显隐同级，Generated 快照与 Installed 视图同等可用；不改变信任模型。

| 节点 | 字段 | 行为 |
|------|------|------|
| `data-table` | `searchable` | 搜索框，跨列大小写不敏感过滤当前行 |
| `data-table` | `sortable` | 列头点击循环 升序→降序→取消；数字列按数值排序；`aria-sort` |
| `data-table` | `pagination: { pageSize }` | 底部分页栏；pageSize 收敛 1–50 |
| `list` | `filterable` | 过滤框匹配 title/description/badge |
| `flow` | `orientation: 'vertical'` | 纵向步骤（连接线 实线=completed / 虚线=后续） |
| `chart` | `stacked: true` | 见上 |

- sanitizer 只接受固定词汇的布尔/枚举/有界数字；搜索/排序状态不持久化、不进 envelope。
- 需要服务端重查的筛选仍是业务 Tool 参数或 Trusted Native 的职责，不进 Declarative。

## 5. 风格预设（Host 级）

- 预设 id：`linear`（默认）/ `vercel` / `notion` / `claude` / `apple` / `figma` / `binance` / `slack`，各明暗双板；未知 id 回落 `linear`。
- 生效面：Host 用户设置 `ocix.stylePreset`（持久化于 ui-store），`.ocix-scope[data-ocix-preset]` 挂载于 InteractiveUIView / HTMLArtifactView / ExtensionWorkbench。
- 预设只改**色板 / 圆角刻度 / 海拔刻度**三组值；字阶、构图规则、a11y 门禁全局统一。
- 当前 manifest v1 **不支持** `style.recommendedPreset`；parser/validator/Manager UI均未实现。扩展推荐仅是未排期候选，须另立 roadmap/schema/UX 授权；现行唯一入口是 Host 用户设置。
- **HTML Artifact 同步跟随**：宿主把预设解析后的全量 `--ocix-*` 槽位（含 chart-1…8、seq、delta、radius、shadow）注入沙箱文档根部；Artifact 设计指引见内置 skill `html-artifact-design` 与开发者手册 §5.8。Generative Widget（show-widget）是独立路径，**不**消费本 token 体系（2026-08-07 拍板，刻意两套）。

## 6. 禁止清单

1. Declarative / Generated JSON 中的任意 hex/rgb、`className`、`style`、远程图片/字体。
2. `filter: blur`、`backdrop-filter`、渐变文字、无限装饰动画。
3. view / extension / Agent 级选择 preset 或 accent（防彩虹）。
4. 阴影用于 dark 下的主要分层（dark 统一降级为阶梯/发丝线）。
5. 语义色作分类色、delta 色作状态色。
6. 为单一品牌破坏全局字阶。

## 7. a11y 门禁

- 每预设 × light/dark：正文/muted 文本、focus-ring 可见性通过既有对比度断言。
- `prefers-reduced-motion` 兜底不得被预设破坏。
- 图例显隐按钮带 `aria-pressed`；表格行态不止依赖颜色（状态胶囊文字并存）。

## 8. Golden 与 Gallery

- `linear` 为全量基线；其余预设按 §6 矩阵抽 `dashboard-hero 声明式 / data-table / chart` 三场景 × 明暗。
- Golden 只能经 `test:interactive-ui-visual:update` 门禁再生成，禁止静默漂移。
- `interactive_ui_gallery` 的 `mode` 参数提供 `components`（默认）与三种 layout mode 演示。

## 9. Native Kit 使用义务

Trusted Native 扩展的样式通道 = `host.ui`（Native Kit）+ `--ocix-*` 变量。禁止依赖未被宿主 Tailwind 扫描的自定义响应式 class（布局用 `Stack/Grid/Split`）。Kit 清单以 `nativeUIKitRegistry.ts` 为准：Button、Card 族、Badge、Notice、Skeleton、Separator、Progress、Table 族、Tabs 族、Input、Textarea、EmptyState、Select、Checkbox、RadioGroup、Switch、Dialog 族、Tooltip 族、Stat、DescriptionList、Avatar、Pagination、Stack、Grid、Split。
