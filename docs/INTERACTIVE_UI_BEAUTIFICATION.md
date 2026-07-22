# Interactive UI 美化开发指南

> 目标：在不增加 GPU 负担、不破坏既有安全边界的前提下，系统性提升 OCIX 视图的视觉质量。<br>
> 风格基准：[shadcn/ui](https://ui.shadcn.com)（new-york / neutral 色板）<br>
> 配套文档：[架构](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md) · [开发者手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)<br>
> 实施主计划：[视觉、HTML Artifact 与统一验收计划](./INTERACTIVE_UI_VISUAL_HTML_ARTIFACT_AND_UNIFIED_TEST_PLAN.md)；本文作为其中 A 阶段的视觉实现参考，最终顺序、状态模型和跨路径验收以主计划为准。<br>
> 下一阶段执行清单：[美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)。<br>
> 更新日期：2026-07-21

## 实施状态（2026-07-21）

本文最初是视觉设计稿；当前 A 阶段已经按主计划落地，最终代码契约以实现和测试为准：

- `packages/ui/src/styles/ocix-theme.css` 已提供独立 light/dark token、语义 tone、chart palette、密度、圆角、阴影和 motion token；Interactive UI 与 Artifact host 均挂载 `.ocix-scope`。
- 既有节点已完成层级、metric trend/tone、flow state、table density/hover/sticky header、chart tooltip/hover/focus/empty state、callout、progress、Skeleton 和空态升级。
- Declarative 已新增 `divider`、`timeline`、`activity-feed`、`comparison`、`tabs`、`accordion`、`code-block`、`sparkline`、`gauge`、`heatmap`、`kanban`、`git-graph`、`tree`、`diff-summary`。Generated Declarative 使用同一渲染器，但仍经过节点/深度/行列/文本上限和无 action/query/binding/script 的 sanitizer。显式开发验收可调用 `interactive_ui_gallery`，Gallery 会直接出现在正常对话 ToolPart，而不是 standalone demo。
- Native `activationHost.ui` 已扩展为 Button、Card、Badge、Notice、Skeleton、Separator、Progress、Table、Tabs、Input、Textarea 和 EmptyState；扩展继续复用 Host React，不打包第二份 React。销售与 CRM 示例已改为 Host UI Kit，统一使用 Notice 表达失败/陈旧状态，并避免依赖不会进入宿主 Tailwind 扫描的扩展自定义响应式 class。
- Host 现在统一显示 Envelope summary、扩展来源、Live/Snapshot、Connector 与更新时间；业务失败按 unconfigured/unreachable/unauthorized/forbidden/error 分类，刷新失败保留上次成功数据并显示 stale Notice，不向页面直接透传上游错误正文。
- `bun run test:interactive-ui-visual` 已用实际 Host 和 Business Gateway 覆盖 Generated、Installed Declarative、Native Sales、Native CRM 的 light/dark、1440/1024/768/390 px 与 zh-CN/en，共 36 个组合；阶段截图写入 `.tmp/interactive-ui-visual-smoke/`。
- HTML Artifact 作为表现力兜底已使用独立协议和 sandbox/CSP/Bridge 实现，不改变 Installed Declarative / Trusted Native 的业务权限模型；三份确定性 fixture、浏览器曲线断言和 authoring guide 已落地，scripts 能力保持 opt-in experimental。
- 自动化类型、lint、sanitizer、组件、Artifact、系统路由和阶段视觉 smoke 已接入；真实对话的正式 Golden 仍归入 P3 统一验收，不在本设计文档中提前宣称完成。

未纳入当前实现的独立候选仍是 recharts/shadcn chart 依赖升级与 Native CSS 更强隔离；二者需要分别评审 bundle、性能和兼容性，不是 HTML Artifact 的前置条件。

本文后续章节保留最初的视觉设计推导。最终实现没有建立一套与宿主完全脱离的品牌色：`.ocix-scope` 使用独立命名空间与受控语义映射，但基础 surface/primary 仍来自当前 OpenChamber 主题，以保持对话内无缝融合；扩展和模型不能覆盖这些映射。

## 1. 背景与目标

### 1.1 现状问题

当前 `DeclarativeInteractiveView` 的所有节点共用同一套视觉公式：

```
rounded-xl border border-border bg-[var(--surface-elevated)] p-3
```

问题清单：

- **无层级**：metric、表格、列表、图表视觉上完全同质，一眼望去全是"灰底卡片"。
- **无语义色**：除 status/badge/callout 外，所有数值一律 `text-foreground`，涨跌、正负无法表达。
- **跟随应用主题**：用户切换橙色/紫色自定义主题时，数据面板跟着变色，失去专业工具感。
- **图表粗糙**：手写 SVG 无 tooltip、无交互、网格线过重。
- **Native SDK 组件贫瘠**：`NativeActivationHost.ui` 只暴露 `Button`，Native 开发者要从零手搓一切。
- **无加载态**：query 执行期间视图区域空白。

### 1.2 美化目标

| 目标 | 说明 |
|---|---|
| 视觉对标 | shadcn/ui 官方 dashboard 示例 + Linear 的边框/留白哲学 |
| 配色策略 | 固定明暗两套色板，**不跟随**应用自定义主题 |
| 性能约束 | 零 blur、零渐变动画、零 backdrop-filter；纯 CSS 变量 + 静态 SVG |
| 架构约束 | 不引入任意 CSS 通道；样式词汇保持语义化、可静态验证 |
| 兼容约束 | 已有扩展的 view JSON 零改动即可受益（样式改进在渲染层） |

### 1.3 非目标

- 液态玻璃 / 毛玻璃 / 动态背景（GPU 成本高，已明确排除）。
- 用户可自选 OCIX 色板（v1 只有明暗两套，不做主题市场）。
- 声明式开放任意颜色值（hex/rgb 一律拒绝，见 §7 安全边界）。

## 2. 总体方案：OCIX 独立色板（`--ocix-*`）

### 2.1 核心决策

将 Interactive UI 的颜色体系从应用主题中解耦：

```text
应用主题（用户可选：橙/紫/自定义……）
    ↓ 只影响
聊天、侧边栏、设置、工具卡片等应用 UI

OCIX 专属色板（light 一套 + dark 一套，固定）
    ↓ 只影响
声明式渲染器 + Native SDK 组件 + 视图加载/错误态
```

判定依据：项目明暗切换已有现成机制——`cssGenerator.ts` 根据 `theme.metadata.variant` 在 `<html>` 上切换 `dark`/`light` class。OCIX 色板只需响应这两个 class，无需新增任何运行时逻辑。

### 2.2 变量命名空间

新建文件 `packages/ui/src/styles/ocix-theme.css`（在 `index.css` 中 `@import`）：

```css
/* OCIX 固定色板：light */
:root .ocix-scope,
.light .ocix-scope {
  --ocix-surface: oklch(1 0 0);            /* 面板底 */
  --ocix-surface-muted: oklch(0.97 0 0);   /* 次级底 / 斑马行 */
  --ocix-border: oklch(0.922 0 0);         /* 极淡边框 */
  --ocix-foreground: oklch(0.21 0.006 285);/* 主文字 */
  --ocix-muted-fg: oklch(0.552 0.016 285); /* 次级文字 */
  --ocix-primary: oklch(0.585 0.233 277);  /* 主强调（中性蓝紫，可再调） */
  --ocix-primary-fg: oklch(0.98 0 0);

  --ocix-success: oklch(0.62 0.19 150);
  --ocix-success-bg: oklch(0.96 0.03 150);
  --ocix-success-border: oklch(0.88 0.06 150);
  --ocix-warning: oklch(0.68 0.16 70);
  --ocix-warning-bg: oklch(0.97 0.03 90);
  --ocix-warning-border: oklch(0.90 0.06 90);
  --ocix-error: oklch(0.577 0.215 27);
  --ocix-error-bg: oklch(0.96 0.02 25);
  --ocix-error-border: oklch(0.90 0.05 25);
  --ocix-info: oklch(0.60 0.15 240);
  --ocix-info-bg: oklch(0.96 0.02 240);
  --ocix-info-border: oklch(0.89 0.05 240);

  --ocix-chart-1: oklch(0.623 0.188 260);  /* 蓝 */
  --ocix-chart-2: oklch(0.696 0.17 162);   /* 绿 */
  --ocix-chart-3: oklch(0.769 0.188 70);   /* 琥珀 */
  --ocix-chart-4: oklch(0.645 0.246 16);   /* 红 */
  --ocix-chart-5: oklch(0.627 0.265 303);  /* 紫 */
}

/* OCIX 固定色板：dark */
.dark .ocix-scope {
  --ocix-surface: oklch(0.21 0.006 285);
  --ocix-surface-muted: oklch(0.274 0.006 286);
  --ocix-border: oklch(0.30 0.008 285);
  --ocix-foreground: oklch(0.95 0.005 285);
  --ocix-muted-fg: oklch(0.705 0.015 286);
  --ocix-primary: oklch(0.68 0.20 277);
  --ocix-primary-fg: oklch(0.98 0 0);

  --ocix-success: oklch(0.70 0.17 150);
  --ocix-success-bg: oklch(0.27 0.05 150);
  --ocix-success-border: oklch(0.40 0.08 150);
  --ocix-warning: oklch(0.76 0.15 75);
  --ocix-warning-bg: oklch(0.28 0.05 85);
  --ocix-warning-border: oklch(0.42 0.07 85);
  --ocix-error: oklch(0.68 0.19 25);
  --ocix-error-bg: oklch(0.27 0.05 25);
  --ocix-error-border: oklch(0.42 0.08 25);
  --ocix-info: oklch(0.70 0.14 240);
  --ocix-info-bg: oklch(0.27 0.05 240);
  --ocix-info-border: oklch(0.42 0.08 240);

  --ocix-chart-1: oklch(0.70 0.16 260);
  --ocix-chart-2: oklch(0.75 0.15 162);
  --ocix-chart-3: oklch(0.80 0.16 75);
  --ocix-chart-4: oklch(0.70 0.20 16);
  --ocix-chart-5: oklch(0.72 0.20 303);
}
```

色值取自 shadcn neutral 色系（oklch 亮度轴），chart 色参考 shadcn charts 色板。初版可以原样落地，后续视觉调优只改这一个文件。

### 2.3 挂载点

在 `InteractiveUIView.tsx` 两个视图容器上挂载 scope class：

```tsx
// 声明式分支（当前 159 行）
<div className="ocix-scope tool-output-surface min-w-0 rounded-xl p-3">

// Native 分支（当前 169 行）
<div className="ocix-scope tool-output-surface min-w-0 rounded-xl p-3">
```

同时给加载态与错误态容器也加上 `ocix-scope`（当前 141、151 行），保证整个 OCIX 生命周期颜色一致。

### 2.4 为什么不让 OCIX 跟随应用主题

- **专业感**：Linear、Stripe、Vercel Dashboard 都是固定色板，数据面板不随品牌主题漂移。
- **可验证性**：固定两套色板意味着对比度、可读性只需人工调优两次，不存在"用户主题破坏面板"的兜底问题。
- **语义稳定**：`--ocix-chart-3` 永远是琥珀色，扩展文档/截图/验收可以引用确定的颜色。

应用主题与 OCIX 面板之间的区隔由面板自身的边框和背景天然完成，视觉上不冲突。

## 3. 渲染器样式迁移

### 3.1 token 映射表

`DeclarativeInteractiveView.tsx` 全文做机械替换：

| 现有引用 | 替换为 |
|---|---|
| `bg-[var(--surface-elevated)]` | `bg-[var(--ocix-surface)]` |
| `bg-[var(--surface-muted)]` | `bg-[var(--ocix-surface-muted)]` |
| `border-border` | `border-[var(--ocix-border)]` |
| `text-foreground` | `text-[var(--ocix-foreground)]` |
| `text-muted-foreground` | `text-[var(--ocix-muted-fg)]` |
| `bg-[var(--primary-base)]` | `bg-[var(--ocix-primary)]` |
| `bg-[var(--interactive-selection)]` | `bg-[var(--ocix-primary)]` |
| `text-[var(--interactive-selection-foreground)]` | `text-[var(--ocix-primary-fg)]` |
| `--status-success/error/warning/info` 系列 | 对应 `--ocix-*` 系列 |
| `CHART_COLORS` 中 `var(--chart-N)` | `var(--ocix-chart-N)` |

`typography-*` 类保持不变（排版系统与颜色解耦，继续跟随应用排版设置）。

### 3.2 共享样式常量

在文件顶部抽公共类，消除重复并统一后续调整点：

```ts
const OCIX_PANEL = 'rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3';
const OCIX_TITLE = 'typography-ui-label font-medium text-[var(--ocix-foreground)]';
const OCIX_META = 'typography-meta text-[var(--ocix-muted-fg)]';
```

## 4. 渲染器视觉升级（逐节点）

以下改动全部在 `DeclarativeInteractiveView.tsx` 内完成，零新增依赖。每项标注是否需要 schema 扩展。

### 4.1 section：去边框、留白分层（Linear 风格）

```tsx
// 现状：border + bg + p-3 三件套
// 改为：默认无边框、无背景，靠标题和留白分区；保留 bordered 变体
<section className={cn('min-w-0', node.variant === 'bordered' && OCIX_PANEL)}>
```

- 新增可选字段 `variant?: "bordered"`，缺省无边框。**schema 扩展**，向后兼容（旧 JSON 无此字段即为默认）。
- 嵌套 section 时内层自动获得边框（通过 CSS `& .ocix-panel` 或保持渲染器逻辑判断），避免层层嵌套全是框。

### 4.2 metric / metric-grid：趋势与语义色

新增字段（**schema 扩展**，同步放开 `generatedLayout.ts` 的 sanitize 白名单）：

```json
{
  "label": "销售额",
  "value": 128000,
  "tone": "positive",        // neutral | positive | negative | warning
  "trend": "up",             // up | down | flat
  "trendValue": "+12.4%"     // 可选，趋势旁的小字
}
```

渲染：

```tsx
const METRIC_TONE_CLASS: Record<string, string> = {
  positive: 'text-[var(--ocix-success)]',
  negative: 'text-[var(--ocix-error)]',
  warning: 'text-[var(--ocix-warning)]',
  neutral: 'text-[var(--ocix-foreground)]',
};

<div className={cn(OCIX_PANEL)}>
  <div className={OCIX_META}>{metric.label}</div>
  <div className={cn('mt-1 typography-body font-semibold', METRIC_TONE_CLASS[tone])}>
    {trend === 'up' && <TrendUpIcon className="mr-1 inline size-3.5" />}
    {trend === 'down' && <TrendDownIcon className="mr-1 inline size-3.5" />}
    {displayValue}
  </div>
  {trendValue && <div className={cn('mt-0.5 typography-micro', METRIC_TONE_CLASS[tone])}>{trendValue}</div>}
</div>
```

趋势箭头使用内联 SVG（≤4 行 path），不引入图标依赖；lucide 已在依赖中，也可用 `TrendingUp` / `TrendingDown` / `Minus`。

### 4.3 flow：分态着色与连线语义

新增步骤字段 `status?: "completed" | "active" | "error" | "pending"`（**schema 扩展**）：

```tsx
const STEP_CLASS: Record<string, string> = {
  completed: 'bg-[var(--ocix-success)] text-[var(--ocix-primary-fg)]',
  active: 'bg-[var(--ocix-primary)] text-[var(--ocix-primary-fg)]',
  error: 'bg-[var(--ocix-error)] text-[var(--ocix-primary-fg)]',
  pending: 'bg-[var(--ocix-surface-muted)] text-[var(--ocix-muted-fg)]',
};
```

连线（步骤间分隔元素）规则：

- 前一步 `completed` → 实线 `--ocix-success`
- 其余 → 虚线 `--ocix-border`（`border-dashed` 或 SVG `stroke-dasharray`）

completed 步骤的序号圆圈可替换为 `Check` 图标（lucide）。

### 4.4 data-table：斑马行 + hover + 密度

```tsx
<tr className={cn(
  'border-t border-[var(--ocix-border)] transition-colors',
  rowIndex % 2 === 1 && 'bg-[var(--ocix-surface-muted)]/50',
  actions.length > 0 && 'hover:bg-[var(--ocix-surface-muted)]',
)}>
```

- 斑马行零 schema 改动。
- hover 仅在有行操作时启用，避免误导。
- 表头单元格加 `whitespace-nowrap`，数值列右对齐（`column.align === 'right'` 或 format 为 number/currency/percent 时自动右对齐）。

### 4.5 chart：精修（保留手写 SVG，不引入 recharts）

初版不加依赖，只做视觉精修：

| 项 | 现状 | 改为 |
|---|---|---|
| 网格线 | `stroke="var(--border)"` 实色 | `stroke="var(--ocix-border)" strokeOpacity={0.5}` |
| 柱状图 | 全矩形 | 顶部圆角：正值柱 `rx` 仅作用于顶部两个角（path 或 rect + clipPath） |
| donut 中心 | label + value 两行小字 | 大号数值居中（`typography-ui-header font-semibold`），label 在下方 micro |
| Y 轴基线 | 与普通网格线一致 | 单独一条 `strokeOpacity={0.9}` 的基线 |
| 图例 | `bg` 色块 | 保持，但色板切到 `--ocix-chart-*` |

recharts 升级列为独立后续项（见 §9），不进本期范围。

### 4.6 list：徽章语义化

list item 的 `badge` 当前是无语义灰徽章。允许 `badgeTone`（**schema 扩展**）：

```json
{ "title": "订单 #1234", "badge": "逾期", "badgeTone": "error" }
```

复用 status/badge 节点的 tone class 映射。

### 4.7 callout：图标 + 左侧强调条

```tsx
<div className={cn('rounded-lg border px-3 py-2.5', toneClass)}>
  <div className="flex gap-2">
    <InfoIcon className="mt-0.5 size-4 shrink-0" />  {/* 按 tone 选 Info/AlertTriangle/XCircle/CheckCircle */}
    <div>...</div>
  </div>
</div>
```

图标选择映射固定，不需要 schema 改动。

### 4.8 progress：完成态变色

```tsx
<div className={cn(
  'h-full rounded-full transition-[width]',
  value >= 1 ? 'bg-[var(--ocix-success)]' : 'bg-[var(--ocix-primary)]',
)} style={{ width: `${value * 100}%` }} />
```

零 schema 改动；`transition-[width]` 是 CSS 合成属性，GPU 开销可忽略。

### 4.9 新增 divider 节点

三处改动：

1. `types.ts` 无需改（节点走 `type` 字符串 + 可选字段）。
2. `DeclarativeInteractiveView.tsx`：

```tsx
if (node.type === 'divider') {
  return <hr className="border-[var(--ocix-border)]" />;
}
```

3. `generatedLayout.ts`：白名单中加入 `divider`（无数据字段，最简节点）。
4. `packages/web/server/lib/interactive-ui/package-format.js` 的静态校验节点清单同步加入。

### 4.10 加载与空态

`DeclarativeInteractiveView` 当前 query 期间空白。增加：

```tsx
const [queryLoading, setQueryLoading] = React.useState(false);
// entries.length > 0 且 queryData 为空时：
{queryLoading && (
  <div className="space-y-3">
    <Skeleton className="h-20 rounded-xl" />
    <Skeleton className="h-40 rounded-xl" />
  </div>
)}
```

复用现有 `components/ui/skeleton.tsx`。Skeleton 颜色需在 `.ocix-scope` 内覆盖为 `--ocix-surface-muted`。

空数据态：data-table 行数为 0 时显示 `暂无数据`（走 i18n），居中 `typography-meta text-[var(--ocix-muted-fg)] py-6 text-center`。

## 5. Native SDK 组件扩充

### 5.1 新增组件

从 shadcn 官方源码复制以下组件到 `packages/ui/src/components/ui/`（项目已是 shadcn 体系，复制即拥有，无新增依赖）：

| 组件 | 来源 | 依赖检查 |
|---|---|---|
| `badge.tsx` | https://ui.shadcn.com/docs/components/badge | 无 |
| `separator.tsx` | https://ui.shadcn.com/docs/components/separator | 无 |
| `progress.tsx` | https://ui.shadcn.com/docs/components/progress | 无（或复用渲染器逻辑手写 20 行） |
| `table.tsx` | https://ui.shadcn.com/docs/components/table | 无 |
| `tabs.tsx` | https://ui.shadcn.com/docs/components/tabs | 需确认底层库（@base-ui 已有 Tabs；如官网用 radix 则改写或手写） |

复制后统一把内部颜色 token 换成 `--ocix-*`（同 §3.1 映射表），保证 Native 组件与声明式渲染器同色。

### 5.2 扩充 `NativeActivationHost`

`packages/ui/src/lib/interactive-ui/types.ts`：

```ts
ui: {
  Button: React.ComponentType<Record<string, unknown>>;
  Card: React.ComponentType<Record<string, unknown>>;
  CardHeader: React.ComponentType<Record<string, unknown>>;
  CardTitle: React.ComponentType<Record<string, unknown>>;
  CardContent: React.ComponentType<Record<string, unknown>>;
  Badge: React.ComponentType<Record<string, unknown>>;
  Skeleton: React.ComponentType<Record<string, unknown>>;
  Separator: React.ComponentType<Record<string, unknown>>;
  Progress: React.ComponentType<{ value?: number }>;
};
```

`nativeRegistry.ts` 同步注入。**这是 `apiVersion: 1` 契约的向后兼容扩展**（只增不改），无需升级 apiVersion。

### 5.3 Native 样式约束更新

更新开发者手册 §样式部分：

- 允许引用 `--ocix-*` 变量（附完整清单，即本文 §2.2）。
- 保留原禁令：不硬编码 hex/调色板色、不引入全局样式、不自建主题系统。
- 推荐使用 `ui.*` 暴露组件而非手写同类元素。

## 6. generated-layout 边界同步

`generatedLayout.ts` 是模型生成快照的 sanitizer，必须与渲染器同步：

- 白名单放行：metric 的 `tone`/`trend`/`trendValue`、flow 步骤的 `status`、list 的 `badgeTone`、新节点 `divider`。
- `tone`/`status` 等枚举值沿用现有 `TONES` 校验集合模式，新增 `TRENDS = new Set(['up','down','flat'])`、`STEP_STATUSES = new Set([...])`。
- 长度上限沿用现有常量（`trendValue` 用 80 字符上限）。

原则不变：generated-layout 依然 data-only，不获得 query/action 权限。

## 7. 样式安全边界（不变的红线）

本次美化**不开放**以下通道，开发与 code review 时逐项核对：

- 声明式 schema 不接受任何颜色字符串（hex/rgb/hsl/oklch/url）。所有色彩表达必须通过 `tone`/`trend`/`status` 等语义枚举。
- 不接受 `style`、`className`、任意 HTML。
- `--ocix-*` 变量由平台定义，扩展不可覆盖（`.ocix-scope` 由渲染器挂载，扩展 JSON 无法注入 CSS，天然免疫）。
- Native 仍是受信同页代码；样式约束靠文档 + 安装校验中的静态检查（已有），本次不新增运行时隔离（Shadow DOM 属架构遗留开放问题 #4，不在本期范围）。

## 8. 验收标准

- [ ] 明暗模式手动切换（应用设置 → 外观），OCIX 面板在两套色板下对比度正常、无语义色错配。
- [ ] 切换应用自定义主题（如橙色），OCIX 面板颜色**不变**。
- [ ] acme-sales 示例扩展的 metric 在提供 `tone`/`trend` 后正确着色与显示箭头；不提供时与旧版视觉等价。
- [ ] data-table 奇偶行可区分；有行操作的表格 hover 有高亮。
- [ ] flow 三步（completed/active/pending）三色正确，连线虚实正确。
- [ ] query 加载期间出现 Skeleton 而非空白；空表格显示空态文案。
- [ ] generated-layout 快照中的非法 `tone`/`status` 值被 sanitizer 剥离。
- [ ] Native 示例扩展通过 `host.ui.Card`/`Badge` 渲染，颜色与声明式视图一致。
- [ ] 移动端（Capacitor）宽度下布局不破：metric-grid 列数降级、表格横向滚动正常。
- [ ] VS Code 宿主：unsupported 行为不受影响（OCIX 在 VS Code 本就显式不支持）。

## 9. 实施顺序与工作量

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | `ocix-theme.css` + scope 挂载 + token 机械替换 | 0.5 天 |
| P1 | metric 趋势色、flow 分态、table 斑马/hover、progress 完成态（高视觉收益项） | 1 天 |
| P2 | chart 精修、callout 图标、divider 节点、加载/空态 | 1 天 |
| P3 | shadcn 组件复制（Badge/Separator/Progress/Table）+ Native SDK 扩充 | 1 天 |
| P4 | generatedLayout 同步、package-format 校验同步、示例扩展与文档更新 | 0.5 天 |
| P5 | 验收清单逐项过、截图归档到 docs | 0.5 天 |

合计约 **4.5 天**。P0+P1 落地即有显著观感提升，可作为第一个可评审的 PR 边界。

后续独立项（不在本期）：recharts + shadcn chart 替换手写 SVG（需新增依赖，单独评审 bundle 与 generated-layout 边界）；Native CSS 隔离方案（架构开放问题 #4）。

## 10. 参考资料

- shadcn/ui 官方 dashboard 示例（明暗切换基准）：https://ui.shadcn.com/examples/dashboard
- shadcn charts 色板：https://ui.shadcn.com/charts
- 视觉质感参照：https://linear.app （边框极淡、留白分层）
- 表格密度参照：https://www.notion.so
- 本项目 shadcn 配置：`components.json`（new-york / neutral / cssVariables）
