# Interactive UI R0 真实对话流视觉审计

> 状态：第二轮美化范围已冻结。  
> 审计日期：2026-07-21  
> 执行计划：[Interactive UI 美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)

本文记录 R0 的真实 OpenChamber 对话流证据、视觉缺陷和 R1/R2 冻结范围。它不是正式视觉 Golden；正式发布基线仍由 `tests/visual/interactive-ui/golden/` 和 `bun run test:interactive-ui-visual` 管理。

## 1. 审计环境

- Host：`bun run demo:interactive-ui:start` 启动的真实 OpenChamber Web 对话入口。
- OpenCode：OpenChamber 管理的隔离实例；不读取用户全局 Tool、Skill 或 OCIX。
- 模型：Big Pickle 与已有 Qwen3.7 Plus 历史会话。
- 业务数据：隔离 Mock Business API；CRM 返回 3 个客户、3 个商机和 ¥2,660,000 管道。
- 桌面取样：1280 × 720，dark，zh-CN。
- 移动取样：Hosted Mobile 真实入口，390 × 844，dark，zh-CN。
- 全尺寸/主题辅助证据：现有 62 张版本化 Golden 已覆盖 light/dark、1440/1024/768/390、zh-CN/en 和适用的 Artifact 显示模式。
- 本轮本地截图：`.tmp/interactive-ui-r0-audit/`。这些图片只用于缺陷评审，不替代 Gate R 后重新生成的 Golden。

为使审计环境可重复，演示脚本只向隔离配置安装以下 Tool，且启动门禁要求每个名称恰好出现一次：

```text
interactive_ui
html_artifact
crm_open_dashboard
sales_get_summary
sales_get_dashboard
```

## 2. 真实路径结果

| ID | 真实会话 | 期望路径 | 实际结果 | 数据/交互 | 截图 |
|---|---|---|---|---|---|
| A1 | LLM RLHF 完整流程可视化 | Generated Declarative | `interactive_ui` 成功，流程、风险表和输入输出表均在回答内渲染 | Snapshot | `01-generated-rlhf-desktop-dark.png` |
| A2 | 三日天气趋势 | Generated Declarative | `interactive_ui` 成功，指标卡、折线图和柱状图可见 | 用户提供的固定数据 | `02b-generated-weather-header-desktop-dark.png` |
| A3 | 最近一周模型性能运营看板 | Generated Declarative | `interactive_ui` 成功，指标、趋势、模型表和风险提示可见 | 明确标注的示例数据 | `02c/02d-generated-model-operations-*.png` |
| A4 | 华东区 2026-07 销售概览 | Installed Declarative | Agent 选择 `sales_get_summary`，Declarative View 在回答内成功渲染 | Live，销售额 1,820,000、48 单 | `03-installed-declarative-sales-desktop-dark.png` |
| A5 | 企业 CRM 客户与商机查看 | Trusted Native | Agent 选择 `crm_open_dashboard`，Native View 与真实业务数据成功渲染 | Live，3 客户、3 商机、管道 2,660,000 | `04-trusted-native-crm-desktop-dark.png` |
| A6 | 极简静态 SVG 双节点图 | Static Artifact | `html_artifact` 成功，iframe 在回答内显示并可进入 workspace/fullscreen | 无脚本、无网络 | `05-static-artifact-desktop-dark.png` |
| A7 | 学习率与损失曲线模拟器 | Scripts Artifact | `html_artifact` 成功，滑块模拟器在 workspace 内显示 | Experimental、模拟数据、无网络 | `06-scripts-artifact-workspace-desktop-dark.png` |
| A8 | 模型运营看板移动端 | Hosted Mobile | 真实 `mobile.html` 会话入口可重放 Generated View | 390 × 844 | `08b/08c-hosted-mobile-*.png` |

结论：路由与渲染基础都存在，本轮不是补独立 demo，而是修复真实对话流中已经可复现的产品质量问题。

## 3. 缺陷台账

### Blocking

| ID | 问题 | 证据 | R1/R2 退出断言 | 主要责任区 |
|---|---|---|---|---|
| R0-B01 | 业务 Tool 已返回 Trusted Native View 后，Big Pickle 又调用 `interactive_ui`，同一批 CRM 数据被 Native、Generated 和最终 Markdown 重复展示 | A5 会话先出现 `crm_open_dashboard`，随后再次出现 `interactive_ui` | 已安装业务 Tool 返回可渲染 View 后，同一 assistant turn 不再调用通用 UI Tool；固定业务语料最多产生一个主 View | 内置 Skill、Tool 描述、路由验收器 |
| R0-B02 | Desktop Web 根入口在 390px 保留完整左侧栏，主内容被压成单字竖排 | `07-generated-model-operations-mobile-390-dark.png` | Desktop 根入口在窄屏要么切换到受支持的窄屏 Shell，要么明确跳转/引导到 Hosted Mobile；不得产生单字列或页面级横向溢出 | App Shell / responsive layout |

### High

| ID | 问题 | 证据 | R1/R2 退出断言 | 主要责任区 |
|---|---|---|---|---|
| R0-H01 | Tool 活动行、展开 Tool 标题和 View 标题重复；天气历史会话甚至出现两个 `Interactive ui` 行 | A1、A2 | Rich View ready 时只保留一个紧凑、可展开的 Tool 状态入口；失败/调试输出仍可访问 | `TurnActivity.tsx`、`ToolPart.tsx`、`InteractiveUIView.tsx` |
| R0-H02 | Tool summary、View summary 和模型最终说明重复相同信息，长页面首屏被摘要占据 | A1、A2、A3 | Host 不重复显示语义相同的 summary；View 本体和模型文本各自最多承担一次说明职责 | Tool/View Host、内置 Skill 示例 |
| R0-H03 | Static Artifact 在暗色对话中出现大面积白色 iframe 外层与双层边框，像嵌入网页而非同一产品 | `05-static-artifact-desktop-dark.png` | Artifact 默认 body/viewport 透明并继承 Host 色彩合同；无白色 gutter、双边框和双滚动 | `HTMLArtifactView.tsx`、document materializer、authoring guide |
| R0-H04 | Scripts Artifact workspace 的控制区与图表区使用强白底，和暗色 Host 割裂 | `06-scripts-artifact-workspace-desktop-dark.png` | 示例与生成规范使用注入的 Host Token；light/dark 都达到可读对比度且不依赖硬编码白底 | Artifact template/Skill、Host Token 注入 |
| R0-H05 | 不同量纲共用单轴时产生误导。模型运营看板将调用量与 P95 延迟放在同一轴，延迟线几乎贴零且标签写成 `ms/100`、数据仍为原值 | `02c-generated-model-operations-desktop-dark.png` | Tool/Skill 明确禁止不兼容量纲共用单轴；优先拆图。图例单位、无障碍值和绘制值必须一致 | `interactive_ui` schema 描述、Skill、组合示例、validator 测试 |
| R0-H06 | Hosted Mobile 390 的图表末端 x 轴标签被裁切，长表格未提供明显的横向滚动提示 | `08b-hosted-mobile-model-operations-header-390-dark.png` | 390px 图表首尾标签可读；宽表局部滚动并显示可发现的滚动/列冻结提示；页面本身不横向滚动 | Declarative chart/table primitives |

### Medium

| ID | 问题 | 证据 | R1/R2 退出断言 | 主要责任区 |
|---|---|---|---|---|
| R0-M01 | Declarative、Native 都有明显“卡片套卡片”和多层等权边框，信息层级偏弱 | A2、A3、A4、A5 | Section 默认使用标题与留白分层；只有独立语义面板使用边框 | `ocix-theme.css`、Declarative primitives、Native UI Kit |
| R0-M02 | 暗色次级文本、坐标轴、来源元数据对比度不足 | A1–A5 | 正文、secondary、muted、axis、disabled 分层明确并通过当前 a11y 对比度门禁 | `--ocix-*` Token、chart theme |
| R0-M03 | CRM 与 Sales 中文页面直接显示 `proposal`、`qualified`、`negotiation`、`pending`、`review` | A4、A5 | 示例扩展将枚举值映射为 locale label，同时保留稳定原始 value 用于业务请求 | Acme CRM/Sales 示例与开发手册 |
| R0-M04 | 长 View 下方持续被固定 Composer 覆盖；Artifact workspace 也与底部输入区争抢高度 | A1–A3、A6、A7 | 对话滚动容器有足够 bottom inset；workspace 的可用高度扣除 Composer/安全区，无内容被永久遮挡 | Chat layout、Artifact workspace |
| R0-M05 | Tool 名称按原始标识机械转成 `Interactive ui`、`Crm open dashboard`、`Sales get summary` | A2、A4、A5 | 内置和扩展 Tool 提供可本地化 display label；缺失 label 时才使用安全 fallback | Tool metadata / rendering |
| R0-M06 | Scripts Artifact 生成耗时约 73 秒，期间只有通用 “using html_artifact” 状态 | A7 | 长 Tool 调用显示阶段化、可取消、可恢复状态；取消不损坏会话历史 | Turn activity / Artifact lifecycle |

### Later（不阻塞本轮）

- 独立进程/renderer 对 Scripts Artifact CPU 死循环和内存攻击的强制终止；在完成前继续 `experimental/default-off`。
- Windows/Linux Desktop 实机视觉与 Secret Store 验收；未执行时保持 `unverified`。
- 公共 Artifact 模板市场、远程模板下载和任意第三方脚本依赖。

## 4. R1 冻结范围

本轮不新增 Declarative 节点。现有 metric、chart、table、flow、timeline、activity、comparison、git graph、tree、diff、tabs、accordion、code 和 callout 足以覆盖固定语料；优先修复组合规则、密度、图表可读性和 Host Shell。

R1 只允许以下产品变化：

1. 统一 Tool/Rich View 外壳，消除重复状态与摘要，同时保留失败和原始输出 fallback。
2. 收紧 `--ocix-*` surface、border、text、semantic、chart、spacing、radius、focus 和 reduced-motion Token。
3. 精修 metric、chart、table、flow 与高密度组件的 dark/light、390px 和键盘路径。
4. 让 Declarative 与 Native UI Kit 使用相同层级规则；修复 Acme CRM/Sales 的枚举本地化。
5. 更新 Tool schema、内置 Skill 和 few-shot：业务 Tool 优先、已有 View 不二次生成、异量纲拆图、摘要不重复。
6. 修复 Desktop 390 Shell 的灾难性挤压，并保留 Hosted Mobile 作为正式移动入口。

以下变化被明确冻结：

- 不增加任意 style、className、color、script、query、binding 或 Host 访问。
- 不增加新的企业权限或 Business Gateway 能力。
- 不为单个业务页面增加专用 Declarative 节点。
- 不在 R1 更新正式 Golden；只生成临时审图截图。

## 5. R2 冻结范围

R2 只处理 Artifact 产品体验与作者体验：

1. Host 主题/locale/timezone/viewport Token 注入和透明 viewport 基础样式。
2. inline/workspace/fullscreen 的同实例、可用高度、滚动和状态保持。
3. Static Artifact 的白色 gutter、双边框、失败 fallback 和历史重放体验。
4. Scripts 示例的 Host 风格、加载/取消/失败状态；能力仍为 experimental/default-off。
5. Authoring Guide、模板和本地校验更新。

Artifact Bridge 仍只允许 resize、受控复制、受控外链、填入 follow-up 和请求展开。本轮不增加网络、Tool、Token、Gateway、文件系统或 storage 能力。

## 6. Gate R 前验收清单

- [ ] R0-B01、R0-B02 全部关闭。
- [ ] R0-H01 至 R0-H06 全部关闭，并具有定向回归测试。
- [ ] R0-M01 至 R0-M06 关闭或有经记录的非阻断发布结论。
- [ ] 七个真实会话路径在改造后重新人工审阅。
- [ ] light/dark × 1440/1024/768/390 × zh-CN/en 阶段截图通过。
- [ ] Web build、UI type-check/lint、定向组件测试和 Artifact Browser 测试通过。
- [ ] 不新增未冻结的 schema、Bridge、路由优先级或企业权限。

完成以上清单后才进入 Gate R，并重新生成正式 Golden 与统一验收结果。
