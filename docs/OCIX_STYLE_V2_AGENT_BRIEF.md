# OCIX Style v2 — Agent 引用简报（反馈与推荐）

> **用途**：给后续 Agent / 协作者的 **实现合同 + 设计决策 + 剩余验收** 入口文案。  
> **状态**：**已实现并合入主线**；合并后自动化验收通过，8 预设 × 明暗人工审图与真实模型对话仍待执行  
> **日期**：2026-08-05（状态回写 2026-08-07）  
> **详细设计（执行级）**：[OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md)  
> **视觉合同 / 验收**：[OCIX_STYLE_CONTRACT.md](./OCIX_STYLE_CONTRACT.md) · [OCIX_STYLE_V2_DEV_REPORT_AND_TEST_PLAN.md](./OCIX_STYLE_V2_DEV_REPORT_AND_TEST_PLAN.md)  
> **相关历史**：[INTERACTIVE_UI_BEAUTIFICATION.md](./INTERACTIVE_UI_BEAUTIFICATION.md) · [INTERACTIVE_UI_R0_VISUAL_AUDIT.md](./INTERACTIVE_UI_R0_VISUAL_AUDIT.md)

**读本文可快速对齐方向；维护实现前必须再读视觉合同、详细规划、开发报告与 change-discipline。**

---

## 1. 一句话

上一轮美化解决的是 **「有没有」**（token 初版、tone/trend、sticky、tooltip、骨架、基础 Native Kit）。  
Style v2 已按 **Token 词汇 → 渲染强调层 → 构图模式 → Kit 扩充 → 合同与 Golden** 五层落地，解决 **「好看且有层级」**，而不是再刷一版换皮。

---

## 2. 实现前根因（历史背景；已由 Style v2 收口）

| # | 根因 | 实现前锚点 |
|---|------|----------|
| 1 | **单一视觉公式** | `DeclarativeInteractiveView.tsx` 中 `OCIX_PANEL = rounded-xl border … p-3`，多类节点同款白卡 |
| 2 | **Token 层偏薄** | `packages/ui/src/styles/ocix-theme.css` 主要是 surface/border/前景/状态色/5 个 chart 色；**缺**圆角刻度、海拔阴影、display 字阶、primary tint/shade、sequential、delta 独立色 |
| 3 | **只有原子、没有构图** | Agent 拿 metric/chart/table「砖」；Skill `interactive-ui-visualization` 偏节点字典，易生成「平铺盒子堆」 |
| 4 | **Native Kit 天花板低** | `nativeUIKit` ≈ Button/Card/Badge/Notice/Table/Tabs/Input/Textarea/EmptyState…；缺表单控件、浮层、布局原语。扩展 **Tailwind 不进宿主扫描则 class 失效** → 事实上只能用 Kit + `--ocix-*` |

补充事实：

- `INTERACTIVE_UI_BEAUTIFICATION.md` 曾把旧 token 能力描述得偏乐观；当前以磁盘实现与 [Style Contract](./OCIX_STYLE_CONTRACT.md) 为准。  
- R0 已记 **R0-M01**（卡片套卡片、等权边框）；v2 是其系统化收口，不是推翻 R1。  
- 图表仍是手绘 SVG；recharts 曾评估后搁置为独立依赖评审。

---

## 3. 对用户五层方案的反馈

**总体评价：方向正确，建议原样采纳分层，不要合并成一次大改。**

| 层 | 方案内容 | 反馈 |
|----|----------|------|
| **L1 Token v2** | 圆角/阴影/字阶/图表色/primary tint | **必须先做**。没有词汇，渲染器与 Kit 无法统一说话。 |
| **L2 渲染变体** | hero / standard / quiet；表/图加深 | **高 ROI、零 JSON 也可受益**。应用自动规则，避免存量扩展一无所获。 |
| **L3 构图模式** | dashboard-hero / master-detail / report | **Agent Generated 最大杠杆**。仅靠 Skill 劝说约束力弱；需要可选 schema + sanitizer。 |
| **L4 Native Kit** | 表单/浮层/Stat/布局原语 | **必要，但排在 L1 之后**。L1 是地基；对话流频率上 Declarative 更先被看见。 |
| **L5 规范验收** | Style Contract + Gallery + Golden | **每层退出都要挂验收**；L5 是冻结合同，不是最后才想起文档。 |

不建议：

- 「只调 CSS、不动结构」——治不好构图与 Kit 天花板。  
- 「先上 recharts 换图表观感」——依赖评审重，Declarative 路径不划算。  
- 「开放任意 className/hex 让扩展自己美化」——破坏安全边界与一致性。  
- 「view 级多 accent 换个性」——企业看板易变彩虹。  
- 「预设做成扩展/视图级自由选择」——风格预设只能是 Host 级；Workbench 混排必须同皮（见 Q5 修订）。  
- 「为单一品牌引入专属字体（如 Claude serif）」——字阶全局统一 sans，预设只改色板/圆角/海拔。

---

## 4. 五个拍板问题 — 推荐冻结

后续 Agent **默认按下列决策执行**；若产品改口，先改详细规划 §3，再动代码。

| ID | 问题 | **推荐决策** |
|----|------|----------------|
| **Q1** | 风格走向 | **shadcn / Linear 冷静专业**（企业向、与现有 token 兼容）。不做杂志感/强色彩个性。 |
| **Q2** | 图表 | **Declarative：手绘 SVG 加深**；**Native：可选 recharts 后置单模块评审**。不把 recharts 塞进 Declarative 默认路径。 |
| **Q3** | Schema | **允许可选字段小步演进**（全 optional，缺省=现状）。纯渲染层做不出可靠构图。走 `openchamber-change-discipline`。 |
| **Q4** | 优先级 | **L1 → L2 → L3 先行**，再 L4；L5 合同随层推进、在主路径后冻结 Golden。 |
| **Q5** | 色板 | **风格预设制（2026-08-05 用户拍板修订）**：8 套策展预设（linear 默认 / vercel / notion / claude / apple / figma / binance / slack，各明暗双板），**Host 级用户设置**，扩展仅可通过 manifest/skill 推荐、用户可自选覆盖。语义色仅 success/warning/error/info + 独立 delta；**仍禁止** view 声明 `accent: teal\|amber` 与 per-extension 覆盖（防彩虹红线保留）。详见 [OCIX_STYLE_PRESETS.md](./OCIX_STYLE_PRESETS.md)。 |

### 性能边界（务必遵守）

| 允许 | 禁止 |
|------|------|
| 低 alpha、小半径的 **静态 `box-shadow` 海拔**（token 化） | `filter: blur` / `backdrop-filter` / 液态玻璃 |
| color/opacity/border 短 transition + reduced-motion | 渐变字、无限装饰动画 |
| Host 图标名枚举（若有 `metric.icon`） | Declarative 任意 hex、远程图/字体、任意 className |

---

## 5. 推荐技术要点（压缩版）

### 5.1 L1 Token（`ocix-theme.css` + `ocix-presets.css`）

补：`--ocix-radius-sm/md/lg`、`--ocix-shadow-1/2`、display 字阶（**tabular-nums**）、chart 扩到 8 + sequential、delta 色、primary tint/shade。  
作用域仍是 `.ocix-scope` light/dark；**不**跟用户自定义宿主 accent。  
**预设制（2026-08-05 修订）**：上述为槽位契约；数值由 8 套风格预设填充（`ocix-presets.css`，`.ocix-scope[data-ocix-preset]`），Host 级设置 `ocix.stylePreset`，默认 `linear` 并对齐 Linear 官方值（一次性 Golden 刷新）。字阶全局统一，不随预设变。数值矩阵见 [OCIX_STYLE_PRESETS.md](./OCIX_STYLE_PRESETS.md)。

### 5.2 L2 Emphasis

三档：`hero` | `standard` | `quiet`。  
无 schema 时自动：metric-grid **首项 hero**（items 很多时勿全员 hero）；section 默认 quiet；嵌套防套卡。  
表格：行态 tint、密度、数字 `tabular-nums`。  
图表：轻网格、参考线、donut 多系列上限、图例本地显隐——**仍 SVG**。

### 5.3 L3 Layout mode

v1 只冻三个：`dashboard-hero`、`master-detail`、`report`；缺省=今日自由堆叠。  
**推荐方案 α**：`layoutMode` + 约定 section id 槽位（改动面小于独立 slots 树）。  
同步改 Skill：从节点字典 → **构图指南**（单焦点、KPI≤4、异量纲拆图、勿为单句建看板）。  
新字段必须进：类型、tool schema、**generatedLayout sanitizer 白名单**、Gallery、文档。

### 5.4 L4 Native Kit 顺序

1. Select / Checkbox / Radio / Switch  
2. Dialog / Sheet / Popover / Tooltip  
3. Stat / DescriptionList / Avatar / Pagination  
4. **Stack / Grid / Split**（破扩展响应式 class 硬约束）  

优先包装宿主已有 `@/components/ui/*`，涂 `--ocix-*`。Date 控件后置。

### 5.5 L5

新建 `OCIX_STYLE_CONTRACT.md`（token/variant/mode/a11y/禁止项）。  
`interactive_ui_gallery` = 视觉规范展示间。  
Golden 按门禁分批刷新，禁止静默漂移。

---

## 6. 已执行的实施顺序（历史）

```text
S0  确认 Q1–Q5 / 字段草案          （可只做文档）
S1  L1 Token v2
S2  L2 渲染 emphasis + 表/图 SVG
S3  L3 layout mode + sanitizer + Skill
S5  Style Contract 冻结 + Golden     （可与 S3 收尾合并）
S4a Native 表单+浮层
S4b Native 展示+布局原语
S6  （可选）Native recharts 评审
```

**最小闭环（对话流立刻变好看）**：S1 → S2 → S3 → S5。  
上述 S1–S5 与 S4a/S4b 已完成；S6 仍是独立依赖评审。后续修改生产渲染器、Kit、skill 或 Golden 必须有明确需求，并继续遵守视觉合同与仓库门禁。

---

## 7. 与其它 OCIX 轨的关系（勿混）

| 轨 | 文档 | 和 Style v2 |
|----|------|-------------|
| Remote Hosted（第三方） | `OCIX_REMOTE_MODE_DETAILED_PLAN.md` | 正交：交付与信任，不修「卡片堆」 |
| Local Data Runtime（better-sqlite3 + Hono） | `OCIX_LOCAL_DATA_RUNTIME_PLAN.md` | 正交：自研后端底座 |
| HTML Artifact | 既有 Artifact 文档 | 兜底表现力；Style v2 目标是 **少因不好看被迫上 Artifact** |
| Generative Widget | `GENERATIVE_WIDGET_*` | 独立 fence；不共享本 Kit |

前端三种 Surface 不变：**Installed Declarative / Trusted Native / HTML Artifact**。

---

## 8. 给后续 Agent 的工作纪律

1. **先读**本文对齐决策；**实现前读** [OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md](./OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md)。  
2. 契约/schema/导出/打包变更遵守 **`openchamber-change-discipline`**。  
3. 存量 view JSON **零改动必须仍可渲染且应自动变好**；可选字段只能增强。  
4. 不要重新发明第二套 OCIX 色板或绕开 `.ocix-scope`。  
5. 不要把「美化」做成任意 CSS 通道。  
6. 每层独立可验收；不要 L1–L4 搅在一个 PR 里无法回滚。  
7. 改 Skill / tool 描述时保持：**业务 Tool 优先、已有 View 不二次生成、异量纲拆图**。  
8. 验证用仓库既有脚本（`test:interactive-ui-visual` 等），以 `package.json` 为准。

---

## 9. 仍可微调的开放项（默认值已写）

| ID | 默认倾向 |
|----|----------|
| O1 L3 α vs β | **α**（layoutMode + section id） |
| O2 hero 自动规则 | **首 metric hero**，其余 standard |
| O3 shadow 若 dark 脏 | 先上 shadow-1 审图；不行则砍 shadow、靠 border/tint |
| O4 Date 进 N1？ | **否** |
| O5 Style Contract 语言 | 先中文 |
| O6 Slack 预设人工策展 | 接受（awesome-design-md 未收录）；首轮审图后可微调数值 |

产品若推翻 Q1–Q5 或 O*，**更新详细规划 §3 与本简报 §4**，避免 Agent 各写各的。

---

## 10. 文档索引（复制给其它 Agent）

```text
入口简报（本文）:
  openchamber/docs/OCIX_STYLE_V2_AGENT_BRIEF.md

详细规划（层设计、验收、代码触点）:
  openchamber/docs/OCIX_DECLARATIVE_NATIVE_STYLE_V2_PLAN.md

风格预设系统（Q5 修订后专文，8 套预设数值矩阵）:
  openchamber/docs/OCIX_STYLE_PRESETS.md

历史美化 / R0 / 上一代执行门禁:
  openchamber/docs/INTERACTIVE_UI_BEAUTIFICATION.md
  openchamber/docs/INTERACTIVE_UI_R0_VISUAL_AUDIT.md
  openchamber/docs/INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md

关键实现文件:
  packages/ui/src/styles/ocix-theme.css
  packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx
  packages/ui/src/components/interactive-ui/NativeUIKit.tsx
  packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts
  packages/web/server/lib/interactive-ui/builtin/agent-runtime/skills/interactive-ui-visualization/SKILL.md
```

---

## 11. 推荐立场摘要（可对外转述）

1. **认同**「单调」是结构性问题，不是缺两笔 CSS。  
2. **认同**五层递进；**反对**换皮式美化与一次砸全。  
3. **冻结**冷静专业 + **风格预设制（Host 级 8 套，扩展可推荐，防彩虹保留）** + Declarative 不引 recharts + 可选 schema + L1–L3 优先。  
4. **阴影**用 token 化 box-shadow，**不等于**放开 blur。  
5. **最大产品杠杆**在 L3 构图 + Skill 升级；**最大工程地基**在 L1 Token。  
6. **当前实现已合入主线**；自动化验收已通过，人工 8×2 预设审图、真实模型对话与预设 Golden 子矩阵仍按开发报告收口。
