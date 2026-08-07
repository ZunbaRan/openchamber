# OCIX Declarative / Trusted Native 样式优化 v2 详细规划

> **状态**：**已实现并合入主线**；合并后自动化验收通过，人工视觉矩阵与真实模型对话仍待执行  
> **日期**：2026-08-05（状态回写 2026-08-07）  
> **范围**：Declarative 渲染层 + Trusted Native Host UI Kit 的视觉与构图能力；**不**改 Business Gateway / Remote / LDR 后端  
> **Agent 入口简报（讨论结论 / 推荐冻结）**：[OCIX_STYLE_V2_AGENT_BRIEF.md](./OCIX_STYLE_V2_AGENT_BRIEF.md)  
> **父文档**：[美化开发指南](./INTERACTIVE_UI_BEAUTIFICATION.md) · [R0 视觉审计](./INTERACTIVE_UI_R0_VISUAL_AUDIT.md) · [执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md) · [开发者手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)  
> **输入方案**：用户五层递进提案（Token v2 → 渲染变体 → 构图模式 → Native Kit → 规范与验收）

---

## 0. 术语

| 用语 | 本文含义 |
|------|----------|
| **Style v2** | 本规划：在 A 阶段 / R0–R2「有没有」之后，解决「好看且有层级」的结构性问题 |
| **Token v2** | `ocix-theme.css` 完整语义 token（圆角、海拔、字阶角色、图表色扩展、primary tint/shade） |
| **Emphasis tier** | 面板强调层级：`hero` / `standard` / `quiet`（渲染层或可选 schema） |
| **Layout mode** | 可选构图模式：`dashboard-hero` / `master-detail` / `report` 等 |
| **Native Kit** | `activationHost.ui` / `nativeUIKit` 暴露的宿主组件集 |
| **Style Contract** | 未来文档 `OCIX_STYLE_CONTRACT.md`：可验收的视觉合同 |

**与其它轨正交：**

| 轨 | 关系 |
|----|------|
| Remote Hosted / LDR | 交付与数据；**不**解决「卡片堆」 |
| HTML Artifact | 表现力兜底；本规划目标是 **少被迫走 Artifact 只因「不好看」** |
| Generative Widget | 独立 fence；风格不共享本 Kit，但对话流内观感应协调 |

---

## 1. 目标与非目标

### 1.1 目标

1. 消除 Declarative **单视觉公式**（全部 `OCIX_PANEL` 同款白卡）导致的单调与「一眼假」。  
2. 补齐 **Token 词汇**，使渲染器与 Native Kit 有可共用的层次语言。  
3. 用 **构图模式** 把 Agent Generated 从「堆 12 个盒子」升级为「选模式 + 填槽」。  
4. 扩充 Native Kit，在 **Tailwind 扫描硬约束** 下提高可信扩展的天花板。  
5. 冻结 **风格合同 + Gallery + Golden** 验收路径，避免再次「改完无参照」。

### 1.2 非目标（本规划）

| 不做 | 原因 |
|------|------|
| 本阶段写生产代码 | 先冻结合同与批次 |
| 液态玻璃 / blur / backdrop-filter / 渐变动画 | 性能红线（既有美化约束） |
| 用户可选 OCIX 品牌色板 / 主题市场 | v1 仅 light/dark 两套固定板 |
| Declarative 任意 color / className / style 通道 | 安全与可静态验证 |
| 默认引入 recharts 进 Declarative 路径 | 先 SVG 加深；Native 可选后置 |
| 用本规划替代企业权限 / Gateway | 样式与业务权限解耦 |
| 一次重写全部 30+ 节点外观 | 按依赖分批；存量 JSON 默认受益 |

### 1.3 成功标准（实施后）

- 同一份旧 view JSON **零改动** 即可呈现：hero metric 可辨、次级 quiet、表格密度/行态分层。  
- Agent 使用 `layout.mode`（或等价）后，对话流首屏 **有且仅有一个视觉焦点**，面板数受 skill 上限约束。  
- Native 扩展用 Kit 即可完成审批表单（Select/Checkbox/…）与确认 Dialog，**无需**扩展内自定义响应式 class。  
- light/dark、关键断点、focus、reduced-motion 有 Style Contract 断言；Gallery 覆盖新 variant/mode。

---

## 2. 根因诊断（与代码对齐）

上一轮（2026-07，A 阶段 + R0/R1/R2）解决的是 **「有没有」**：明暗双板、tone/trend、sticky 表头、tooltip、骨架屏、基础 Native Kit。  
「仍然不好看」来自更深结构，且与当前实现一致：

### 2.1 单一视觉公式

`DeclarativeInteractiveView.tsx` 中：

```ts
const OCIX_PANEL = 'rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3';
```

metric / 表 / 图 / 列表 / 流程等大量节点共用该常数。层级几乎只剩 `font-medium` vs `font-semibold`。  
R0 已记 **R0-M01「卡片套卡片、等权边框」**；R1 有所收紧，但 **emphasis tier 仍未成为系统**。

### 2.2 Token 层偏薄

当前 `packages/ui/src/styles/ocix-theme.css` 实质是：

- 3 级 surface + border  
- 2 级前景 + selection/focus  
- primary 一对  
- 4 组状态色（success/warning/error/info 各 text/bg/border）  
- **5** 个 categorical chart 色  
- reduced-motion 兜底  

**缺失**：圆角刻度、间距刻度、阴影/海拔、字号角色（display）、primary tint/shade、sequential 色、delta 与 success/error 解耦。  
说明：`INTERACTIVE_UI_BEAUTIFICATION.md` 实施状态段曾写「已提供密度/圆角/阴影/motion token」——**相对实现偏乐观**；本规划以 **磁盘上的 ocix-theme.css 为准**，并在 L1 真正补齐。

### 2.3 只有原子、没有构图

Agent 与扩展拿到的是 metric/chart/table 等「砖」；没有 KPI 横带、主从、报告分节等 **预制槽位**。  
Skill `interactive-ui-visualization` 仍偏 **节点字典 + 触发规则**，不是 **构图指南** → 生成结果易成「平铺盒子堆」。

### 2.4 Native Kit 天花板

`nativeUIKit` 现约：Button、Card*、Badge、Notice、Skeleton、Separator、Progress、Table*、Tabs*、Input、Textarea、EmptyState。  

**缺**：Select / Checkbox / Radio / Switch / Date；Dialog / Sheet / Popover / Tooltip；Stat / DescriptionList / Avatar / Pagination；Stack / Grid / Split 布局原语。  

硬约束（已踩坑）：扩展 bundle 手写 Tailwind class **若不在宿主扫描范围则不生效** → Native 开发者 **事实上只能** Kit + `--ocix-*`；Kit 小 = 天花板低。

### 2.5 图表

仍为手绘 SVG：可用但粗糙（参考线弱、网格偏重、donut 单系列、图例交互有限）。  
recharts/shadcn-chart 曾评估后搁置为 **独立依赖评审候选**（见美化文档）。

---

## 3. 拍板：五个问题（规划冻结建议）

> 下列为 **规划推荐冻结值**。实施前若产品改口，只改本节与受影响批次，不重开根因。

| ID | 问题 | **冻结决策** | 理由 |
|----|------|----------------|------|
| **Q1** | 风格走向 | **继续 shadcn / Linear 式冷静专业** | 与企业场景、既有 token、对话内融合一致；不大胆杂志感 |
| **Q2** | 图表路线 | **Declarative：手绘 SVG 加深 (a)**；**Native：后置可选 recharts 模块 (b)，单独评审** | Declarative 零依赖上限中等可接受；Native 本可信，依赖可单入口评审 |
| **Q3** | Schema 演进 | **允许可选字段小步演进**（全部 optional，缺省 = 现状） | 纯渲染层无法给 Agent 强构图；L3 ROI 依赖弱契约；走 change-discipline |
| **Q4** | 优先级 | **路线 A：L1 → L2 → L3 先行**；L4 Native Kit 紧随且共享 L1 token | 对话流出现频率最高；L1 是 L4 地基 |
| **Q5** | 色板哲学 | **风格预设制（2026-08-05 修订）**：8 套策展预设（linear/vercel/notion/claude/apple/figma/binance/slack，各明暗双板），**Host 级用户设置**，扩展仅可推荐；**仍禁止** view 级 `accent: teal\|amber` 与 per-extension 覆盖 | 详见 [OCIX_STYLE_PRESETS.md](./OCIX_STYLE_PRESETS.md)；防彩虹红线保留——任意时刻全局仅一套生效；语义色只用于 success/warning/error/info 与 delta |

### 3.1 性能边界澄清（阴影 vs blur）

| 手段 | 本规划 |
|------|--------|
| `filter: blur` / `backdrop-filter` / 大面积动态 blur | **禁止** |
| 低透明度、小半径 **`box-shadow` 静态海拔**（`--ocix-shadow-1/2`） | **允许**，作为 elevation token；需在 light/dark 各验一次，避免「泥影」 |
| 渐变色文字 / 无限动画 | **禁止** |
| CSS transition 仅 color/opacity/border ≤ ~150ms | 允许，且遵守 `prefers-reduced-motion` |

### 3.2 Schema 演进原则（Q3 细则）

1. **仅 optional 字段**；旧 JSON / Generated sanitizer 缺省路径像素级兼容（允许「更好看」但不可破布局语义）。  
2. 新字段必须进入：**类型**、`interactive_ui` tool schema 描述、**generatedLayout sanitizer 白名单**、Gallery fixture、开发者文档。  
3. **禁止** 任意 CSS、任意 className、任意 hex。  
4. 图标仅允许 **Host 图标名枚举**（若引入 `metric.icon`），禁止远程 URL。  
5. 契约变更走 `openchamber-change-discipline` + 既有 Interactive UI 测试入口。

---

## 4. 总体架构：五层递进

```text
L1 Token v2          ── 地基（无 JSON 变更）
    ↓
L2 渲染层变体        ── 默认按节点类型自动 emphasis；可选 schema 微调
    ↓
L3 构图模式          ── 可选 layout.mode + skill 构图指南（Agent 最大杠杆）
    ↓
L4 Native Kit 扩充   ── 表单 / 浮层 / 数据展示 / 布局原语（共享 L1）
    ↓
L5 规范与验收        ── Style Contract + Gallery + Golden 扩充
```

每层 **独立可验收**；上层可依赖下层，下层不依赖上层。

```text
┌─────────────────────────────────────────────────────────────┐
│  Conversation / Workbench / Artifact host (.ocix-scope)     │
├─────────────────────────────────────────────────────────────┤
│  L3 Layout modes (optional)                                 │
│    dashboard-hero │ master-detail │ report │ (default stack) │
├─────────────────────────────────────────────────────────────┤
│  L2 Emphasis + node polish                                  │
│    hero metric │ standard panel │ quiet │ table density     │
│    SVG chart deepen (Declarative only in this plan)         │
├─────────────────────────────────────────────────────────────┤
│  L1 --ocix-* Token v2                                       │
│    radius · elevation · type roles · chart · primary tint   │
├─────────────────────────────────────────────────────────────┤
│  L4 Native Kit (Trusted code only)                          │
│    forms · overlays · Stat/DL · Stack/Grid/Split            │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. L1 Token v2（地基）

### 5.1 文件与挂载

- **唯一源**：`packages/ui/src/styles/ocix-theme.css`（经 `packages/ui/src/index.css` `@import`）  
- 作用域：`.ocix-scope`；dark：`.dark .ocix-scope` / `[data-theme='dark'] .ocix-scope`  
- **宿主主题**：用户自定义 accent **仍不**驱动 OCIX 业务面（保持独立固定板）

### 5.2 提案变量表

| 类别 | 现状 | Token v2 |
|------|------|----------|
| 圆角 | 硬编码 `rounded-xl` | `--ocix-radius-sm/md/lg` → 建议 **8 / 12 / 16**（px 语义）；组件按角色选 |
| 海拔 | 无 | `--ocix-shadow-1`、`--ocix-shadow-2`（light/dark 分别调；低 alpha、小 blur **仅 shadow 参数**） |
| 间距 | 散落 p-3/gap | `--ocix-space-1…5`（4/8/12/16/24）可选；L1 至少文档化常用 |
| 字阶角色 | 借用宿主 typography | OCIX 角色类或变量：`display`（KPI 大数）/ `title` / `label` / `meta` / `micro`；display **强制 `tabular-nums`** |
| 图表 categorical | 5 | **8**（`--ocix-chart-1…8`） |
| 图表 sequential | 无 | `--ocix-chart-seq-1…5`（单色相深浅，heatmap/funnel） |
| Delta | 复用 success/error | `--ocix-delta-up/down/flat`（**与** status 语义解耦，避免「涨=成功」误读） |
| Primary | 单色 | 保持单一 hue；加 `--ocix-primary-tint` / `--ocix-primary-shade`（hover / subtle 底） |
| 面板 | 隐式 | 语义辅助：`--ocix-panel-hero-bg` 可用 `color-mix` primary-tint，**非**新 accent |

> **预设制（2026-08-05 修订，替代原 Q5）**：上表定义的是**槽位契约**；具体数值由 **8 套风格预设** 填充，见 [OCIX_STYLE_PRESETS.md](./OCIX_STYLE_PRESETS.md)。预设 = 纯数据（色板 / 圆角刻度 / 海拔刻度三组值），默认 `linear`；**字阶、构图规则全局统一，不随预设变化**。实现上 `ocix-theme.css` 持槽位与规则，新增 `ocix-presets.css` 持 8×2 组数值。

### 5.3 字阶落地策略

**推荐**：在 `.ocix-scope` 内增加 **组件类**（而非强迫改全局 `typography.css`）：

```css
.ocix-scope .ocix-type-display { font-size: …; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.ocix-scope .ocix-type-title { … }
/* label/meta/micro 可映射既有 typography-ui-label / typography-meta / typography-micro */
```

避免污染 Settings / Chat 全局字阶。

**统一字体决策（2026-08-05，D-P4）**：字阶**全局统一 sans，不随预设变化**；Claude 预设不引 serif，Apple 不引 17px 正文——不为单一品牌破坏统一设计。预设只可改色板 / 圆角 / 海拔三组值。

### 5.4 L1 验收

- [ ] light/dark 变量齐全，无未定义引用  
- [ ] 对比度：foreground / muted / axis 级文本通过既有 a11y 门禁（**8 预设 × 明暗各跑一次**）  
- [ ] focus-ring 在 elevation 面板上仍清晰  
- [ ] reduced-motion 块仍生效  
- [ ] 无新增 blur/backdrop-filter  
- [ ] 8×2 预设数值表落地（`ocix-presets.css`），未知 preset id 回落 `linear`  
- [ ] `linear` 默认预设数值对齐后 Golden 一次性刷新（走 `:update` 门禁，非静默漂移）

**预估**：1–2 人日（槽位）+ 2–3 人日（8 套数值表与明暗演绎审图迭代）。

---

## 6. L2 渲染层变体（存量 JSON 直接受益）

### 6.1 Emphasis tier 系统

替换单一 `OCIX_PANEL` 为函数/映射：

| Tier | 视觉 | 默认用于 |
|------|------|----------|
| **hero** | display 字号；hero tint 底 + 加大 padding + shadow-1（**无**左侧 accent 色条，2026-08-06 审图移除） | 首个 metric-grid 中的首卡、或 `metric.emphasis=hero` |
| **standard** | 现 `OCIX_PANEL` ≈ border + surface + padding | 表、图、列表、独立卡 |
| **quiet** | 无 border 无底，靠留白 | 嵌套次级、section 内说明、divider 附近 |

**默认规则（无 schema 时）：**

1. 顶层 `metric-grid` 的 items → 第一项 **hero**，其余 **standard**（或全部 standard 若 items≥5，避免满屏 hero）。  
2. `section` 默认 quiet；仅 `variant=bordered` 或独立语义块 standard。  
3. 嵌套在 standard 内的子节点默认 quiet，防止卡片套卡片（延续 R0-M01）。

**可选 schema（Q3）：**

```json
{
  "type": "metric",
  "label": "销售额",
  "value": 1280000,
  "emphasis": "hero",
  "icon": "money-cny-circle",
  "tone": "positive",
  "trend": "up",
  "trendValue": "+12.4%"
}
```

`panel.variant` / `emphasis` 枚举：`hero | standard | quiet`（命名实施时二选一，全仓统一）。

### 6.2 表格

- 数字列：`tabular-nums` + 右对齐（已有则加固）  
- **行状态底**：整行 tint（success/warning/error 的 background 极淡），不仅 badge  
- **密度**：`density: comfortable | compact`（optional）；compact 减小 py  
- sticky header 保持；hover 行用 surface-muted，不用强阴影  

### 6.3 图表（Declarative SVG 加深，Q2-a）

| 项 | 内容 |
|----|------|
| 网格 | 更轻的 stroke / 更少横线 |
| 参考线 | 可选均值线 / 目标线（数据字段 optional） |
| Donut | 多系列环（有上限，如 ≤4） |
| 图例 | 可点击隐藏系列（纯本地 state） |
| 色 | 用 chart-1…8；heatmap 用 sequential |
| **不做** | 本层不引 recharts |

### 6.4 L2 验收

- [ ] 旧 fixture / 旧扩展 JSON 无 schema 变更即可肉眼层级改善  
- [ ] `DeclarativeInteractiveView` 单测 + 组件测不回归  
- [ ] 390px 下 hero 不撑破；无页面级横向滚动  
- [ ] 异量纲拆图规则保持（R0-H05）  

**预估**：2–4 人日（含图表加深取子集则可切分）。

---

## 7. L3 构图模式（Agent Generated 最大杠杆）

### 7.1 为什么需要 schema

仅靠 skill 提示「请少堆盒子」**约束力弱**（R0 已见模型重复调用与烂布局）。  
可选 `layout.mode` 把自由度收到 **槽位**，仍兼容缺省「自由 stack」。

### 7.2 模式定义（v1 冻结三个）

| Mode | 槽位 | 适用 |
|------|------|------|
| **`dashboard-hero`** | `kpis[]`（≤4）+ `main`（chart/table 二选一主）+ `aside`（list/callout/status） | 运营看板、销售概览 |
| **`master-detail`** | `master`（list/table）+ `detail`（key-value / section 组） | 客户列表、工单、配置项 |
| **`report`** | `title` + `summary`（callout）+ `sections[]`（有序分节） | 长说明、复盘、审计摘要 |
| **缺省 / 省略** | 现状：sections + widgets 自由堆叠 | 兼容全部存量 |

JSON 形态（示意，实施时对齐 tool schema）：

```json
{
  "presentation": "stack",
  "layout": {
    "mode": "dashboard-hero",
    "kpis": [ { "type": "metric", "label": "…", "value": 1 } ],
    "main": { "type": "chart", "…": "…" },
    "aside": { "type": "list", "…": "…" }
  }
}
```

或挂在现有 sections 之上的 **元字段**（二选一，实施 L3 时定一种，禁止两套并行）：

- **方案 α**：`view.layoutMode` + 约定 section id（`kpi` / `main` / `aside`）  
- **方案 β**：专用 `layout: { mode, slots }` 节点  

**规划推荐 α**：改动面小，易映射现有 `sections[]`，skill 好教。

### 7.3 构图硬规则（写入 skill + 可选 validator）

1. **单屏视觉焦点只能有一个**（一个 hero 区或一个 main 图）。  
2. **单 View 面板上限**：建议 KPI≤4、主区图表≤2、表格≤1 大表 + 细节表折叠。  
3. **结论优先**：report 必须先 summary callout。  
4. **不兼容量纲不共轴**（保持现规则）。  
5. **勿为单句答案建 dashboard**。  

### 7.4 Skill 升级

文件：

- `packages/web/server/lib/interactive-ui/builtin/agent-runtime/skills/interactive-ui-visualization/SKILL.md`  
- 示例/runtime 副本保持同步  

从 **节点字典** 升级为：

1. 何时用 mode vs 自由堆叠  
2. 三模式槽位表 + do/don't  
3. 密度与焦点  
4. 与业务 Tool / 已有 View 不重复（保持现有路由纪律）  

### 7.5 L3 验收

- [ ] 无 `layout.mode` 的路径与今日行为一致  
- [ ] Gallery 增加三模式示例  
- [ ] Skill 变更后 routing/model 相关测不回归  
- [ ] sanitizer 拒绝未知 mode / 超限槽位  

**预估**：3–5 人日（含 schema/tool/skill/sanitizer）。

---

## 8. L4 Native Kit 扩充

### 8.1 优先级（业务真实需求）

| 批次 | 组件 | 理由 |
|------|------|------|
| **N1 表单** | Select、Checkbox、Radio、Switch | 审批、筛选刚需 |
| **N2 浮层** | Dialog、Sheet、Popover、Tooltip | 下钻、二次确认；Tooltip 与 Declarative 图表 tip 可共享 token |
| **N3 数据展示** | Stat（含 delta chip）、DescriptionList、Avatar、Pagination | 对齐 Declarative hero/metric 语言 |
| **N4 布局原语** | Stack、Grid、Split | **解决扩展不能自定义响应式 class 的硬约束** |

Date 控件：N1 后置评估（复杂度高；可用 Input + 业务格式先顶）。

### 8.2 实现约束

1. **只** 通过 `nativeUIKit` / `activationHost.ui` 导出；扩展 **禁止** 依赖未扫描 Tailwind 任意 class。  
2. 全部消费 `--ocix-*`；不跟宿主用户 accent。  
3. 优先 **包装** 宿主已有 `@/components/ui/*`（Radix 等），再涂 OCIX token，避免第二套无障碍实现。  
4. 每个组件 = **活规范**：Story/Gallery 一节 + 开发者手册一节。  
5. 浮层 z-index / portal 必须在 `.ocix-scope` 与对话/Workbench 层级下可测，避免被 Composer 挡住（关联 R0-M04 意识）。  

### 8.3 recharts（Q2-b，可选后置）

- **不** 进入 Declarative 默认路径。  
- 若做：仅 `nativeUIKit.Chart`（或 `Charts.*`）可选模块；**单独** bundle/性能/许可证评审；默认示例扩展可不依赖。  

### 8.4 L4 验收

- [ ] `NativeUIKit.test.tsx` 覆盖新组件 a11y 基本角色  
- [ ] Acme CRM/Sales 至少一处改用新表单/Dialog（证明可迁移）  
- [ ] 扩展模板与 developer guide 更新  
- [ ] 打包后 Tailwind 扫描仍包含 Kit 源路径  

**预估**：N1+N2 约 4–6 人日；N3+N4 约 3–5 人日。

---

## 9. L5 规范与验收

### 9.1 新文档 `OCIX_STYLE_CONTRACT.md`（实施 L1 时起草，L5 冻结）

建议目录：

1. Token 清单（变量名、语义、light/dark 样例）  
2. Emphasis / variant 词汇表  
3. Layout mode 槽位与上限  
4. 对比度、focus、reduced-motion、触控最小尺寸  
5. 明暗对等规则（同一结构两边都有层级）  
6. **禁止** 清单（任意色、blur、远程字体图等）  
7. Native Kit 使用义务（扩展样式通道）  

### 9.2 Gallery

- `interactive_ui_gallery` 扩为 **视觉规范展示间**  
- 覆盖：token 色板条、三 tier 面板、三 layout mode、表格密度、图表加深、（L4 后）Native 嵌入示例说明  

### 9.3 Golden

- 现有约 54 场景 / 62 张：变体扩充后 **按门禁再生成**，禁止静默漂移  
- 命令源：`package.json` 中 `test:interactive-ui-visual` 等既有脚本  
- 策略：L1/L2 合并一次 Golden 刷新；L3 加 mode 场景；L4 加 Native 场景  

### 9.4 与旧文档关系

| 文档 | 关系 |
|------|------|
| `INTERACTIVE_UI_BEAUTIFICATION.md` | 保留为历史 + 原则；**实施状态**需在 v2 落地后回写纠正 token 夸大 |
| `INTERACTIVE_UI_R0_VISUAL_AUDIT.md` | 缺陷台账；v2 关闭 R0-M01 残余与「单调感」类项 |
| `INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md` | 上一代执行门禁；v2 **新开批次** 不重开已关闭 Gate 的假进度 |
| 本文件 | **Style v2 唯一执行主计划**（直至实施完成） |

---

## 10. 给 Agent / 扩展开发者的规范摘要

### 10.1 Agent（Generated Declarative）

1. 优先判断是否已有业务 View；有则 **停止** 再生成。  
2. 需要看板时 **先选 layout mode**，再填槽；不要先堆 12 个 metric。  
3. 单焦点；KPI≤4；异量纲拆图。  
4. 示例/估算数据必须标注。  
5. 最终 prose 一句结论，不重复 View 内数字。  
6. 样式 **只** 通过节点语义（tone/trend/emphasis/mode），禁止幻想 className。

### 10.2 Trusted Native 扩展作者

1. **只用** `host.ui` / Kit + `--ocix-*`。  
2. 表单与确认走 Kit；不要手写第三套按钮。  
3. 布局用 Stack/Grid/Split（L4 后）；不要依赖扩展内 `md:grid-cols-2` 等未扫描类。  
4. 失败/陈旧统一 Notice tone。  
5. 枚举值做 locale 映射（R0-M03）。  

### 10.3 明确禁止

- 任意 hex/rgb 进 Declarative JSON  
- 远程图片/字体作装饰（Declarative）  
- 为「好看」升级为 HTML Artifact 且绕过业务 Tool  
- 多 accent 彩虹看板  

---

## 11. 分批实施计划（授权后）

| 批次 | 内容 | 依赖 | 退出标准 |
|------|------|------|----------|
| **S0** | 冻结 Q1–Q5（本文 §3）；列 schema 字段草案；列 Token 全表 PR 草稿 | — | 产品/负责人点头 |
| **S1** | L1 Token v2 槽位落地 + 类型角色类 + **8 套风格预设数值表（含 Host 级设置与 `data-ocix-preset` 挂载）** | S0 | 视觉抽检 light/dark × 8；无回归单测；`linear` 基线 Golden 一次刷新 |
| **S2** | L2 emphasis 自动规则 + 表/图加深（SVG） | S1 | 旧 JSON 明显分层；组件测绿 |
| **S3** | L3 layout mode（α 或 β）+ sanitizer + skill 构图指南 + Gallery 三模式 | S2 | 兼容缺省；Gallery 可演示 |
| **S4a** | Native N1 表单 + N2 浮层 | S1（可与 S3 部分并行） | Kit 导出 + 测 + 一例扩展迁移 |
| **S4b** | Native N3 展示 + N4 布局原语 | S4a | 模板与 guide 更新 |
| **S5** | `OCIX_STYLE_CONTRACT.md` 冻结 + Golden 刷新 + 美化文档状态回写 | S2+S3（+S4 若已做） | 合同与 golden 一致 |
| **S6（可选）** | Native recharts 模块评审与 PoC | S4 + 独立评审 | 有 bundle 数字再决定是否合入 |

### 11.1 推荐默认授权顺序

**S0 → S1 → S2 → S3 → S5（最小闭环，对话流立刻变好看）**  
然后 **S4a → S4b**；S6 仅当 Native 业务明确要复杂图。

### 11.2 风险

| 风险 | 缓解 |
|------|------|
| Golden 大面积像素 diff | 分批刷新；审图清单固定场景 |
| schema 膨胀 Agent 乱填 | 枚举收紧 + sanitizer + skill 示例 |
| shadow 在 dark「脏」 | 极低 alpha；可降级为仅 border 分层 |
| Kit 包装宿主 Dialog 层级冲突 | 在对话流 + Workbench 双场景测 portal |
| 文档与实现再漂移 | Style Contract 为唯一清单；BEAUTIFICATION 状态段回写 |
| 预设 dark 演绎值偏差（Notion/Figma/Apple/Slack） | PRESETS §5 审图清单；首轮只许调色值不改结构 |
| 预设膨胀为维护负担 | 预设 = 数据行 + Golden 子集，禁止代码分支；新增走 PRESETS §8-R5 流程 |

---

## 12. 关键代码触点（实施地图，非现在改）

| 区域 | 路径 |
|------|------|
| Token | `packages/ui/src/styles/ocix-theme.css`（槽位/规则）+ `ocix-presets.css`（8×2 预设数据，新增） |
| Declarative 渲染 | `…/DeclarativeInteractiveView.tsx`、`DeclarativeAdvancedPrimitives.tsx` |
| 类型 | `packages/ui/src/lib/interactive-ui/types.ts`、generatedLayout sanitizer |
| Tool schema | `packages/web/server/lib/interactive-ui/builtin/…/tools/interactive_ui.ts` |
| Gallery | `…/tools/interactive_ui_gallery.ts` |
| Skill | `…/skills/interactive-ui-visualization/SKILL.md` |
| Native | `NativeUIKit.tsx`、`nativeUIKitRegistry.ts` |
| 示例扩展 | `examples/interactive-ui/acme-*` |
| 视觉测 | `scripts/verify-interactive-ui-visual.mjs`、`tests/visual/interactive-ui/golden/` |
| 文档 | 新建 `OCIX_STYLE_CONTRACT.md`；回写 `INTERACTIVE_UI_BEAUTIFICATION.md` |

---

## 13. 开放问题（实施前可再收）

| ID | 问题 | 默认倾向 |
|----|------|----------|
| O1 | L3 用方案 α（section id）还是 β（slots 节点）？ | **α** |
| O2 | hero 自动规则：仅首 metric 还是整行 metric-grid 轻强调？ | **首项 hero + 其余 standard** |
| O3 | `--ocix-shadow-*` 若 dark 难看是否允许 L1 只上 radius/type 不上 shadow？ | **先上 shadow-1 审图，不行则砍 shadow 保留 border 层级** |
| O4 | Date 是否进 N1？ | **否，N1 后置** |
| O5 | Style Contract 是否中英双语？ | 先中文，与现有 OCIX 规划一致；关键枚举英文 |
| O6 | Slack 预设全套为人工策展（awesome-design-md 未收录） | 接受；首轮审图后可直接微调数值表，无需重开决策（PRESETS §8） |

---

## 14. 规划阶段交付与授权边界（历史，已由 §14.1 取代）

**本阶段（文档）：**

- [x] 根因与现状代码对齐  
- [x] Q1–Q5 规划冻结建议  
- [x] L1–L5 详细设计  
- [x] 分批 S0–S6 与验收  
- [x] Agent / Native 开发规范摘要  

**规划阶段未授权不做：**

- 改 `ocix-theme.css` / 渲染器 / Kit / skill / golden  

**规划阶段建议（历史记录）：**

1. **只确认 Q1–Q5 / O1–O5**（若与本文不一致则改本文），或  
2. **授权 S1（Token v2）** 开始实现，或  
3. **先出 Style Contract 骨架 + Token 精确数值表** 再动代码。

---

## 14.1 实施与合入状态（2026-08-07）

用户 2026-08-06 授权全量实施（不分阶段）。S6（Native recharts）按计划仍属可选依赖评审，未做。

实现提交 `2fdb7ae3` 已通过合并提交 `4132bcef` 进入 `docs/interactive-ui-mcp-apps`，合并收尾为 `3929ebbb`；原 `openchamber-style-v2` worktree 与 `feat/ocix-style-v2` 分支已在确认合入后删除。日常开发以主仓工作区为准。

| 批次 | 状态 | 证据 |
|------|------|------|
| S1 L1 Token + 预设 | **已实现** | `ocix-theme.css` 槽位（radius/shadow/type/chart-8/seq/delta/tint-shade）+ `ocix-presets.css` 7 套非默认预设（linear=默认槽位值）；`useUIStore.ocixStylePreset` 持久化；`data-ocix-preset` 挂载于 InteractiveUIView / HTMLArtifactView / ExtensionWorkbench；Settings → Applications 新增 `StylePresetSection`（10 locale 文案） |
| S2 L2 emphasis + 表/图 | **已实现** | `DeclarativeInteractiveView.tsx`：hero/standard/quiet 三档（首 KPI 自动 hero、≥5 全 standard、bordered section 内 quiet）、`metric.icon` 白名单（`metricIcons.ts`）、表格 `density`/`toneColumn` 行态、图表 8 色/轻网格/`referenceLine`/图例显隐/≤4 环 donut |
| S3 L3 layout mode | **已实现** | 方案 α：根 stack `layoutMode` + section `id` 槽位；Tool fail-closed 校验（未知 mode/id、缺槽、重复、KPI>4 均抛错）；sanitizer 非法降级剥离（内容保留）；渲染器三模式分区；skill 构图指南；gallery `mode` 参数三演示 |
| S4a/S4b L4 Native Kit | **已实现** | N1 Select/Checkbox/RadioGroup/Switch；N2 Dialog/Tooltip 族；N3 Stat/DescriptionList/Avatar/Pagination；N4 Stack/Grid/Split；registry + `NativeActivationHost.ui` 类型同步 |
| S5 L5 合同 + Golden | **已实现** | `docs/OCIX_STYLE_CONTRACT.md` 冻结；两处模块 DOCUMENTATION.md 回写；Golden 经 `:update` 门禁刷新 24 张（含 5 张基线期已漂移） |

**验证记录（worktree，2026-08-06）：**

- `type-check`（web/ui/electron/mobile 全 workspace）通过；`lint` 0 error（web 包 `workbench-popout.tsx` 1 error 为基线预存在，与本改动无关）。
- `bun test`（ui interactive-ui 全部 21 文件）：**196 pass**，含新增 sanitizer 6 例、渲染器 Style v2 5 例、Native Kit 4 例。
- `vitest run server/lib/interactive-ui`（web）：**127 pass**；`test:interactive-ui-extension`：**7 pass**；`docs:validate` 通过。
- `test:interactive-ui-visual`：端到端可运行；`:update` 后仅余 `artifact-interactive` 2 张亚像素抖动（动画帧时序，基线同型 flake，与本次改动无关）。
- `dead-code`（knip）已审视：本改动新增导出均在用；报告其余为基线存量。
- 环境备注：worktree 需复制主仓库的 `.npmrc`（GitHub Packages token 当前 403，SDK 已手动放入 bun store）及 gitignored 的 `examples/interactive-ui/*/dist/ui.mjs`、`templates/interactive-ui-extension/dist/ui.mjs` fixture。
- `bun.lock` 在 worktree 有 registry URL 噪音（bun install 副作用），提交前应还原。

**合并后验证（主仓，2026-08-07）：**

- Style v2 UI / sanitizer / Native Kit：32 pass；Remote/Manager 联合回归：179 pass；生产路由接线：7 pass。
- 全 workspace type-check 通过；Style v2 新增文件无 dead-code 命中。
- workspace lint 仍只有既有 `packages/web/src/workbench-popout.tsx:50` error；UI lint 无新增 error。
- `bun.lock` 镜像噪音已还原；三份同名主仓未跟踪副本已由分支最终版取代并清理。

**尚未完成的发布验收：** 8 预设 × 明暗人工视觉审查、Qwen 真实对话冻结语料、预设维度 Golden 子矩阵及 Desktop/移动抽样。未完成这些项前，不把 Style v2 状态写成“人工验收全部通过”。

---

## 15. 交叉链接

- 美化原则与历史 A 阶段：[INTERACTIVE_UI_BEAUTIFICATION.md](./INTERACTIVE_UI_BEAUTIFICATION.md)  
- R0 缺陷：[INTERACTIVE_UI_R0_VISUAL_AUDIT.md](./INTERACTIVE_UI_R0_VISUAL_AUDIT.md)  
- 上一代执行门禁：[INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)  
- 扩展开发：[INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)  
- 双场景后端（正交）：[OCIX_LOCAL_DATA_RUNTIME_PLAN.md](./OCIX_LOCAL_DATA_RUNTIME_PLAN.md) · [OCIX_REMOTE_MODE_DETAILED_PLAN.md](./OCIX_REMOTE_MODE_DETAILED_PLAN.md)  
- 风格预设系统（Q5 修订后专文）：[OCIX_STYLE_PRESETS.md](./OCIX_STYLE_PRESETS.md)  
- 开发报告与测试计划（实施证据与人工审查矩阵）：[OCIX_STYLE_V2_DEV_REPORT_AND_TEST_PLAN.md](./OCIX_STYLE_V2_DEV_REPORT_AND_TEST_PLAN.md)  
