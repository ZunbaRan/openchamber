# OCIX 风格预设系统（Style Presets）

> **状态**：设计规划（**本阶段不实施代码**）  
> **日期**：2026-08-05  
> **执行主计划**：[OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md)（本文替代其 §3 原 Q5 冻结值）  
> **入口简报**：[OCIX_STYLE_V2_AGENT_BRIEF.md](./OCIX_STYLE_V2_AGENT_BRIEF.md)  
> **数据来源**：[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（Linear / Claude / Notion / Figma / Vercel / Apple / Binance 的 DESIGN.md）+ 品牌官网与公认品牌知识演绎（Notion / Figma / Apple / Slack 深色；Slack 全套，仓库未收录）

---

## 1. 拍板（2026-08-05，用户介入设计方向）

| ID | 决策 | 内容 |
|----|------|------|
| **D-P1** | 生效粒度 | **Host 级用户设置**；扩展可通过 manifest / 开发 skill **推荐**预设，用户始终可自选覆盖；任意时刻全局仅一套生效 |
| **D-P2** | 首批范围 | **全量 8 套**：`linear`（默认）/ `vercel` / `notion` / `claude` / `apple` / `figma` / `binance` / `slack` |
| **D-P3** | 深色缺口 | 官方数据优先；缺失项按品牌哲学**演绎补齐**（Notion / Figma / Apple / Slack），全部进入审图清单（§5） |
| **D-P4** | 字体统一 | **字阶全局统一 sans，不随预设变化**；Claude 不引 serif；不为单一品牌破坏统一设计 |

**用户原话要点**：风格不要过于激进；色板按各 design 的颜色来；每套支持明暗两种。

**修订关系**：本文冻结值替代 v2 计划 §3 原 Q5「单一 indigo accent」。**防彩虹红线保留**（§2.3），只是从「唯一一套」放宽为「用户可选的一套策展预设」。

---

## 2. 架构：token 槽位 × 预设数据

「加一套和加八套工作量差不多」成立的前提：**预设是纯数据，不是代码分支**。

```text
.ocix-scope { --ocix-surface: …; --ocix-primary: …; }   /* 槽位：稳定契约 */
.ocix-scope[data-ocix-preset="claude"] { … }            /* 预设：只填值    */
.dark .ocix-scope[data-ocix-preset="claude"] { … }
```

- 组件永远只引用 `var(--ocix-*)`，不感知预设 id。
- 每套预设定义**三类值**：色板 / 圆角刻度 / 海拔刻度。**字阶与构图规则全局统一**（D-P4）。
- 实现形态（实施期）：`ocix-theme.css` 持有槽位与全局规则；新增 `ocix-presets.css` 持有 8×2 组数值数据。
- 默认预设 `linear` ≈ 现 indigo 值；L1 将其数值对齐 Linear 官方 token，接受**一次性 Golden 刷新**（在 L1 门禁内完成，非静默漂移）。

### 2.1 选择与持久化

- Host 设置项 `ocix.stylePreset`：**用户级**偏好（非项目级），默认 `linear`。
- 设置 UI：Settings 增加「Interactive UI 风格」选择器，含每套预设的实时缩略预览。
- 落点：经 RuntimeAPIs 持久化；`.ocix-scope` 挂载 `data-ocix-preset` 属性。

### 2.2 扩展推荐契约（D-P1 细则）

- manifest 可选字段 `style.recommendedPreset: "<presetId>"`：仅作 Extension Manager / 安装审查 UI 的**提示**，**永不自动应用**。
- 开发 skill `build-openchamber-interactive-extension` 后续批次增补「预设选择建议」一节（本阶段不改 skill）。
- 用户可忽略任何推荐自行选择；推荐与生效之间没有自动通道。

### 2.3 防彩虹红线（保留）

- view JSON / Generated 通道 / 扩展代码**不得**指定 preset 或 accent；Agent 的样式词汇仍只有 `tone` / `trend` / `emphasis` / `layout.mode`。
- Workbench 混排多个扩展时永远同皮；不存在 per-extension 覆盖。

---

## 3. 槽位清单（契约层）

与 v2 计划 §5.2 对齐。预设可填的槽位集合（缺失项回落 `linear` 默认）：

| 组 | 槽位 |
|----|------|
| 表面 | `surface` / `surface-muted` / `surface-subtle` |
| 边框 | `border`（各预设可派生 strong/soft，如需要） |
| 文字 | `foreground` / `muted-foreground` |
| 交互 | `selection`(+`-foreground`) / `focus-ring` |
| 主色 | `primary` / `primary-foreground` / `primary-tint` / `primary-shade` |
| 语义 | `success|warning|error|info` 各 `-background` / `-border` |
| 图表 | `chart-1…8`；`chart-seq-1…5`（heatmap/funnel 用） |
| Delta | `delta-up` / `delta-down` / `delta-flat`（与 status 解耦） |
| 圆角 | `radius-sm` / `radius-md` / `radius-lg` |
| 海拔 | `shadow-1` / `shadow-2`（允许为 `none`，此时靠阶梯/发丝线分层） |

**全局统一（预设不可改）**：字阶角色（display/title/label/meta/micro，display 强制 `tabular-nums`）、构图规则（单焦点、KPI≤4）、reduced-motion 兜底、a11y 门禁。

数值约定：文档用 hex 记录；实施时统一换算 oklch。

---

## 4. 八套预设

### 4.1 `linear`（默认）— 冷静技术感

- **性格**：深画布四级阶梯、发丝线、零阴影、薰衣草蓝仅作稀缺 accent。
- **来源**：awesome-design-md（官方数据全，含 dark）。

| 槽位 | Light | Dark |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#f5f6f6` / `#fafbfb` | `#010102` / `#0f1011` / `#141516` |
| border | `#e5e7ea`（演绎） | `#23252a`（strong `#34343a`） |
| foreground / muted-fg | `#282a30` / `#6b7280`（演绎） | `#f7f8f8` / `#8a8f98`（tertiary `#62666d`） |
| primary / on / hover(tint) / pressed(shade) | `#5e6ad2` / `#ffffff` / `#828fff` / `#5e69d1` | 同左（dark 原生） |
| selection / on | `#e8eafb`（演绎）/ `#3d47a8` | `#2a2f4a`（演绎）/ `#c8ceff` |
| 语义 | success `#27a644`；warning / error / info 沿用默认（实施期对齐） | 同族提亮 |

- **圆角**：8 / 12 / 16。**海拔**：`none`（surface 阶梯 + hairline 分层，Linear 哲学即无投影）。
- **Chart**：`#5e6ad2` `#828fff` `#27a644` `#f2994a` `#eb5757` `#2d9ee0` `#bb87fc` `#f2c94c`（Linear 产品标签色系）。
- **注意**：与现有 indigo 默认最接近；作为默认预设，L1 数值对齐 + 一次性 Golden 刷新。

### 4.2 `vercel` — 黑白工程感

- **性格**：墨黑/近白双色调、堆叠细阴影 + 内描边、克制链接蓝。
- **来源**：awesome-design-md；dark 按极性翻转 + Geist 公开色值演绎。

| 槽位 | Light | Dark |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#fafafa` / `#f5f5f5` | `#0a0a0a` / `#111111` / `#1a1a1a`（演绎） |
| border | `#ebebeb`（strong `#a1a1a1`） | `#262626`（演绎） |
| foreground / muted-fg | `#171717` / `#888888`（body `#4d4d4d`） | `#ededed` / `#a1a1a1` |
| primary / on | `#171717` / `#fafafa` | `#fafafa` / `#171717`（极性翻转） |
| info / link | `#0070f3`（deep `#0761d1`，soft `#d3e5ff`） | `#3291ff`（演绎） |
| 语义 | error `#ee0000`（soft `#f7d4d6`）；warning `#f5a623`（soft `#ffefcf`，deep `#ab570a`）；success 复用 info 蓝族或 `#0f9d58`（演绎，审图定） | 同族提亮 |

- **圆角**：6 / 8 / 12。**海拔**：shadow-1 `0 1px 1px rgb(0 0 0 / 0.05), 0 2px 2px rgb(0 0 0 / 0.10)`；shadow-2 `0 2px 2px rgb(0 0 0 / 0.10), 0 8px 16px -4px rgb(0 0 0 / 0.10)`；并配 `inset 0 0 0 1px rgb(0 0 0 / 0.08)` 内描边。dark 下阴影降级为纯阶梯（O3 规则）。
- **Chart**：`#0070f3` `#50e3c2` `#7928ca` `#ff0080` `#f9cb28` `#eb367f` `#3291ff` `#a1a1a1`。
- **注意**：primary 为近黑，CTA 是"黑按钮"风格；与其他预设气质差异最大但极克制。

### 4.3 `notion` — 暖灰编辑感

- **性格**：暖炭文字、暖灰发丝线、矩形按钮、pastel 卡片底色文化。
- **来源**：awesome-design-md（light 全）；**dark 演绎**（Notion 产品公认暗色值）。

| 槽位 | Light | Dark（演绎） |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#f6f5f4` / `#fafaf9` | `#191919` / `#202020` / `#2c2c2c` |
| border | `#e5e3df`（soft `#ede9e4`，strong `#c8c4be`） | `#2f2f2f` ≈ rgb(255 255 255 / 0.094) |
| foreground / muted-fg | `#1a1a1a`（charcoal `#37352f`） / `#787671`（slate `#5d5b54`，stone `#a4a097`） | rgb(255 255 255 / 0.87) / rgb(255 255 255 / 0.46) |
| primary / on / shade | `#5645d4` / `#ffffff` / `#4534b3` | `#8b80f9`（演绎提亮）/ `#1a1a1a` |
| info / link | `#0075de`（pressed `#005bab`） | `#529cca` |
| 语义 | success `#1aae39`；warning `#dd5b00`；error `#e03131` | success `#4dab9a`；warning `#e0703a`；error `#df5452`（均演绎） |

- **圆角**：8 / 12。**海拔**：shadow-1 `0 1px 2px rgb(15 15 15 / 0.04)`；shadow-2 `0 4px 12px rgb(15 15 15 / 0.08)`（Notion 招牌软投影）；dark 下以阶梯为主。
- **Chart**：`#7b3ff2` `#0075de` `#2a9d99` `#1aae39` `#dd5b00` `#ff64c8` `#f5d75e` `#523410`；seq 可用 Notion pastel（`#e6e0f5`→`#7b3ff2`）。
- **注意**：暖灰中性色与 Claude 同属暖系但更灰；pastel 只进 chart/seq，不进面板底（防花哨）。

### 4.4 `claude` — 暖奶油人文感

- **性格**：奶油画布 + 珊瑚 accent、色块先于阴影、文学气质（**但按 D-P4 不引 serif**）。
- **来源**：awesome-design-md（light 全 + dark surface 族）。

| 槽位 | Light | Dark |
|---|---|---|
| surface / muted / subtle | `#faf9f5` / `#f5f0e8` / `#efe9de`（strong `#e8e0d2`） | `#181715` / `#1f1e1b` / `#252320` |
| border | `#e6dfd8`（soft `#ebe6df`） | `#33302b`（演绎） |
| foreground / muted-fg | `#141413`（body `#3d3d3a`） / `#6c6a64`（soft `#8e8b82`） | `#faf9f5` / `#a09d96` |
| primary / on / shade | `#cc785c` / `#ffffff` / `#a9583e` | `#d97757` / `#181715`（演绎，dark 提亮保对比） |
| 语义 | success `#5db872`；warning `#d4a017`；error `#c64545`；info 用 accent-teal `#5db8a6` 族 | 同族提亮 |

- **圆角**：8 / 12 / 16。**海拔**：几乎不用（`0 1px 3px rgb(20 20 19 / 0.08)` 仅 hover 抬升）；层级靠 cream→card→dark 色块对比。
- **Chart**：`#cc785c` `#5db8a6` `#e8a55a` `#5db872` `#c64545` `#8e8b82` `#a9583e` `#6c6a64`。
- **注意**：唯一暖色画布预设；dark 下 coral 需提亮否则对比度不足（审图点）。

### 4.5 `apple` — 画廊克制感

- **性格**：大留白、单一 Action Blue、发丝线、几乎无装饰。
- **来源**：awesome-design-md（light）；**dark 按 Apple HIG 系统色演绎**（营销站无完整 dark）。

| 槽位 | Light | Dark（HIG 演绎） |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#f5f5f7` / `#fafafc` | `#000000` / `#1c1c1e` / `#2c2c2e` |
| border | `#e0e0e0`（soft `#f0f0f0`） | `#38383a` |
| foreground / muted-fg | `#1d1d1f` / `#7a7a7a`（80% `#333333`） | `#ffffff` / rgb(235 235 245 / 0.6) |
| primary / on / tint | `#0066cc` / `#ffffff` / `#0071e3` | `#0a84ff` / `#ffffff` |
| 语义 | success `#34c759`；warning `#ff9500`；error `#ff3b30`；info 复用 primary | success `#30d158`；warning `#ff9f0a`；error `#ff453a`（HIG dark 系统色） |

- **圆角**：11 / 18（+ pill CTA 变体，见 §8 Figma 条同款说明）。**海拔**：`none`，发丝线 + 大留白分层；**明确排除** Apple 招牌 `backdrop-filter: blur`（性能红线，用实色替代）。
- **Chart**：`#0071e3` `#30d158` `#ff9f0a` `#ff453a` `#af52de` `#64d2ff` `#ffd60a` `#8e8e93`。
- **注意**：低密度预设，L2 的 padding/gap 可适当放大（density comfortable 为该预设默认观感）。

### 4.6 `figma` — 黑白骨架 + 跳跃 pastel

- **性格**：黑白 chrome、pill 按钮、pastel 色块、playful。
- **来源**：awesome-design-md（light）；**dark 按 Figma 产品暗色演绎**。

| 槽位 | Light | Dark（演绎） |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#f7f7f5` / `#fafafa` | `#1e1e1e` / `#2c2c2c` / `#383838` |
| border | `#e6e6e6`（soft `#f1f1f1`） | `#3d3d3d`（strong `#444444`） |
| foreground / muted-fg | `#000000` / `#5a5a5a`（演绎；营销站无中灰，产品有二级别灰） | `#ffffff` / rgb(255 255 255 / 0.7) |
| primary / on | `#000000` / `#ffffff` | `#0d99ff` / `#ffffff`（深底黑主色不可见，采用 Figma 产品 dark accent） |
| focus / link | `#0d99ff` | `#0d99ff` |
| 语义 | success `#1ea64a`；warning `#ffcd29`（产品黄）；error `#f24e1e`；info `#0d99ff` | success `#0acf83`；error `#ff7262`（产品色） |

- **圆角**：8 / 24；**按钮为 pill**（`radius-sm` 取 9999px——按钮圆角由 Kit/Button 消费 `--ocix-radius-*` 驱动，仅此预设全 pill）。**海拔**：shadow-1 `0 4px 16px rgb(0 0 0 / 0.06)` 稀疏使用；层级靠色块。
- **Chart**：`#0d99ff` `#f24e1e` `#ff7262` `#a259ff` `#1abcfe` `#0acf83` `#ff3d8b` `#ffcd29`；pastel（lime `#dceeb1` lilac `#c5b0f4` mint `#c8e6cd`）作 seq/填充底。
- **注意**：**Tier 2 个性预设**，设置 UI 标「活泼」提示；pastel 不用于业务面板底（防彩虹条款仍生效）。

### 4.7 `binance` — 金融扁平能量感

- **性格**：深近黑画布 + 单一明黄电压色、扁平色块、数字专用感。
- **来源**：awesome-design-md（明暗双板全）。

| 槽位 | Light | Dark |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#fafafa` / `#f5f5f5` | `#0b0e11` / `#1e2329` / `#2b3139` |
| border | `#eaecef`（strong `#cdd1d6`） | `#2b3139` |
| foreground / muted-fg | `#181a20` / `#707a8a`（`#929aa5`） | `#eaecef`（title `#ffffff`） / `#929aa5` |
| primary / on / shade | `#fcd535` / `#181a20` / `#f0b90b` | 同左（dark 原生，黑字黄底签名组合不反转） |
| 语义 | success = delta-up `#0ecb81`；error = delta-down `#f6465d`；info `#3b82f6`；warning `#f0b90b` 族 | 同左 |
| **delta** | up `#0ecb81` / down `#f6465d` / flat `#929aa5` | 同左 |

- **圆角**：6 / 8 / 12。**海拔**：`none`，纯扁平色块对比（明暗度阶梯）。
- **Chart**：`#fcd535` `#0ecb81` `#f6465d` `#3b82f6` `#2dbdb6` `#929aa5` `#f0b90b` `#eaecef`。
- **注意**：金融场景天然适配（涨跌语义色直接落 delta token）；黄 accent 只做小面积强调，禁大面积填充（品牌禁忌沿用）。

### 4.8 `slack` — 友好协作感（人工策展）

- **性格**：圆润友好、茄子紫品牌、四色活力点缀。
- **来源**：⚠️ awesome-design-md **未收录**；以下为 Slack 品牌指南 + 产品公认值**人工策展**，首轮审图后允许微调（O6）。

| 槽位 | Light | Dark（演绎） |
|---|---|---|
| surface / muted / subtle | `#ffffff` / `#f8f8f8` / `#f0f0f0` | `#1a1d21` / `#222529` / `#2c2f33` |
| border | `#dddddd`（soft `#e8e8e8`） | `#3b3e42` |
| foreground / muted-fg | `#1d1c1d` / `#616061` | `#d1d2d3`（title `#ffffff`） / `#ababad` |
| primary / on / shade | `#4a154b` / `#ffffff` / `#350d36` | `#7c2d82`（演绎提亮）/ `#ffffff` |
| info / link | `#1264a3` | `#1d9bd1` |
| 语义 | success `#007a5a`；warning `#ecb22e`；error `#e01e5a` | success `#2bac76`；warning `#ecb22e`；error `#e01e5a` |

- **圆角**：8 / 12 / 16。**海拔**：shadow-1 `0 1px 3px rgb(29 28 29 / 0.13)`（Slack 卡片轻影）。
- **Chart**：`#36c5f0` `#2bac76` `#ecb22e` `#e01e5a` `#4a154b` `#1264a3` `#1d9bd1` `#616061`。
- **注意**：logo 四色（蓝/绿/黄/红）天然构成 categorical chart 系；aubergine 深色下需提亮（审图点）。

---

## 5. 深色演绎清单（审图门禁）

| 预设 | 演绎项 | 依据 | 审图重点 |
|---|---|---|---|
| `notion` | 全部 dark 值 | Notion 产品暗色公认值 | 暖灰是否偏冷；primary 提亮后对比度 |
| `figma` | 全部 dark 值 | Figma 产品 dark UI | primary 从黑切到 `#0d99ff` 的品牌感损失是否可接受 |
| `apple` | 全部 dark 值 | Apple HIG 系统深色 | 纯黑画布在对话流内是否过闷 |
| `slack` | 全套（含 light 策展） | Slack 品牌指南 + 产品主题 | aubergine 提亮幅度 |
| `claude` | dark primary / border | coral 提亮惯例 | 珊瑚在 `#181715` 上的对比度 |
| `vercel` | dark 表面阶梯 | Geist 公开值 | 翻转后 primary 按钮可读性 |

`linear` / `binance` 为官方双板数据，无演绎项。

---

## 6. L2 emphasis 在每套预设下的表达

同一套 hero / standard / quiet 语义，按预设海拔哲学落地：

| 预设 | hero 表达 | standard | quiet |
|---|---|---|---|
| linear / apple / binance | hero tint 底（**无阴影**） | 阶梯 surface + hairline | 无底无边 |
| notion | tint 底 + shadow-1 | surface + hairline + shadow-1 | 无底无边 |
| vercel | shadow-2 + inset ring | surface + hairline + shadow-1 | 无底无边 |
| claude | cream-strong tint 底 | card 底 + hairline | 无底无边 |
| figma | pastel tint 底（限 chart 系 pastel） | surface + hairline | 无底无边 |
| slack | tint 底 + shadow-1 | surface + hairline | 无底无边 |

规则不变：单焦点、首项 hero、items≥5 全 standard、嵌套防套卡。

---

## 7. 验收与 Golden 策略

1. **对比度门禁**：8 预设 × light/dark 各跑一次既有 a11y 断言（focus-ring、正文、muted）。
2. **Golden**：`linear` 走全量基线（现有 54 场景/62 张，L1 一次性刷新）；其余每套 **light/dark × 3 关键场景**（dashboard-hero 声明式 / data-table 密度 / chart 族），约 +42 张，走 `:update` 门禁再生成，禁止静默漂移。
3. **Gallery**：`interactive_ui_gallery` 每预设一节（色板条 + 三 tier + KPI 带 + 图表）。
4. **商标免责**：显示名采用「Linear 风」「Claude 风」格式，设置页与文档注明「风格灵感来源，与品牌方无关」。
5. **故障回落**：未知 preset id 一律回落 `linear`。

---

## 8. 风险与开放项

| 项 | 内容 | 处置 |
|---|---|---|
| R1 | 演绎 dark 值偏差 | §5 审图清单；首轮只允许调色值，不改结构 |
| R2 | 维护成本 | 新增预设 = 数据行 + Golden 子集；Style Contract 收录清单，禁止代码分支 |
| R3 | Figma pill 按钮 | 按钮圆角由 Kit/Button 消费 `--ocix-radius-*`；仅 figma 预设 `radius-sm=9999px`，不新增 Button variant |
| R4 | Binance 涨跌语义 | delta token 已与 status 解耦；非金融数据在该预设下仍用 delta 中性规则 |
| R5 | 候选池 | Stripe / Raycast 记录为候选（awesome-design-md 均有），**首批不实施**；新增流程 = 数据行 + 审图 + Golden 子集 |
| **O6** | Slack 全套为人工策展 | 首轮审图后允许直接微调数值表，无需重开决策 |
