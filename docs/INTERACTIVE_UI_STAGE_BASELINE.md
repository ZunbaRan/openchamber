# Interactive UI 阶段基线与缺陷台账

> 文档性质：P0/P1 阶段证据，不是正式视觉 Golden 或最终发布报告。  
> 生成日期：2026-07-21  
> 主计划：[Interactive UI 美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)

## 1. 可重复入口

运行：

```bash
bun run test:interactive-ui-visual
```

命令会执行生产 Web 构建，使用隔离数据目录启动 OpenChamber、真实 mock Business Gateway 与 Chromium，并输出：

- 阶段截图：`.tmp/interactive-ui-visual-smoke/*.png`
- 机器可读结果：`.tmp/interactive-ui-visual-smoke/baseline.json`

这些文件是本地阶段证据，不作为发布包内容。正式 Golden 只在美化和 Artifact 合同通过 Gate AB 后创建。

## 2. 固定六条 Host 路径

| Runtime | 固定样例 | 数据语义 | 阶段断言 |
|---|---|---|---|
| `generated` | 模型评测与 LLM 强化学习组合页 | Generated Snapshot | 标准组件、summary、Snapshot metadata、表格局部滚动 |
| `declarative` | Sales summary | Connected Business System | Installed Declarative、真实 mock 数据、Live metadata |
| `native` | Sales dashboard | Connected Business System | Trusted Native、Host UI Kit、真实 mock 数据 |
| `crm` | CRM dashboard | Connected Business System | CRM Native、客户/商机非空数据、Live metadata |
| `artifact-static` | 神经网络静态 SVG | Model-generated Artifact | 空 sandbox、主题、响应式、三种显示模式 |
| `artifact-interactive` | 学习率模拟器 | Model-generated Artifact | `allow-scripts`、Bridge ready、确定性 SVG、三种显示模式 |

真实 Agent 对话、跨模型 Tool 选择和真实 Simple CRM 服务不由本阶段 fixture 代替，统一在 P3 运行。

## 3. 2026-07-21 阶段结果

矩阵：

```text
6 runtimes
× (light/dark × 1440/1024/768/390 zh-CN + light × 390 en)
= 54 cases
```

结果：

- 54/54 结构与截图 smoke 通过。
- 浏览器 Runtime error：0。
- 页面级横向溢出：0；390 px 表格保持局部滚动。
- Static Artifact sandbox：空；Scripts Artifact sandbox：仅 `allow-scripts`，但这只证明功能/视觉路径，不代表 Scripts 通过生产安全门禁。
- Artifact inline/workspace/fullscreen 均可进入；模式切换复用同一个 iframe。
- 真实浏览器复核确认 Scripts Artifact 的 inline → fullscreen → inline → workspace 状态均保持 `ready`，控制台 error/warning 为 0。
- blocked、crashed、scripts-disabled 三类失败态均显示语义 Notice、移除 iframe，并保留默认折叠的原始 Tool 输出；浏览器结构断言与人工审图均通过。

人工审图曾发现学习率 SVG 坐标轴缺少 `fill:none`，导致路径闭合成黑色三角形；fixture 已修复并重新生成全部 54 组证据。这说明阶段门禁必须同时包含结构断言和人工审图。

## 4. 性能与 bundle 基线

以下数字来自本机开发构建，仅用于发现明显回归，不作为跨设备 SLA：

| 路径 | ready 中位数 |
|---|---:|
| Generated | 215 ms |
| Installed Declarative | 206 ms |
| Trusted Native | 218 ms |
| CRM Native | 226 ms |
| Static Artifact | 215 ms |
| Scripts Artifact | 202 ms |

| Chunk | 原始大小 | gzip |
|---|---:|---:|
| Main | 893,199 B | 260,552 B |
| Interactive UI fixture entry | 14,763 B | 6,083 B |
| HTML Artifact lazy chunk | 15,753 B | 6,047 B |

Vite 仍报告项目原有的大 chunk 和 KaTeX 字体解析警告；本阶段没有把 HTML Artifact chunk 合并进主聊天入口。正式性能预算与回归阈值在 P3 冻结。

## 5. 缺陷台账

| 分类 | 缺口 | 下一批 | 发布影响 |
|---|---|---|---|
| resolved | Artifact 的 blocked、crashed、scripts-disabled、unsupported 已使用统一 Notice；原始 Tool fallback 默认折叠并通过结构断言和人工审图 | A2 | 视觉合同已冻结 |
| resolved | Static Artifact capability、cache 命中/清理、缺失/损坏重建、共享会话引用和最后引用释放均通过 store/route/system/browser 门禁 | B1 | Static 实现合同已冻结；打包 Desktop 发布验证仍归 B3 |
| blocking | 打包 Desktop 尚未在无任何 OpenCode 覆盖变量的全新环境验证首次启动 | B3 | 未完成前不能声明用户无需额外安装 OpenCode |
| blocking | Simple CRM 必须在 P3 分别证明 Tool、View、真实业务数据和确认式写入 | C1 | fallback 空壳不得算业务闭环 |
| resolved | Hosted/Capacitor Mobile capability 明确为 Static supported、Scripts unsupported；390 px scripts-disabled UI 已通过 | B1/B2 | 不再依赖隐式降级 |
| compatibility | Windows、Linux 与 VS Code Artifact 尚未实测 | C3 | 不得推断为已支持 |
| external | OpenAI、Qwen3.7 Plus、Big Pickle 的同语料真实对话矩阵尚未执行 | C3 | Provider 不可用时必须记录外部阻断 |
| resolved / deferred | 直接 sandbox iframe 的 download/navigation 请求旁路已由 Broker + opaque 子 frame 修复；仍没有独立可终止 renderer | B2 / 后续 | 零未授权请求与 Bridge allowlist 已通过；Scripts 保持 experimental/default-off，只有独立终止边界完成后才能升级 production/stable |
| later | workspace/fullscreen 对短内容保留较大空白，可在不改变协议的前提下继续微调布局 | A2/后续 | 不阻断功能，但需在正式 Golden 前人工决定 |

## 6. 基线冻结规则

- A2 可以修改视觉与状态实现，但必须重新运行本基线并解释 bundle、ready 或截图变化。
- Gate AB 之后不再新增标准组件、不扩大 Bridge、不改变 Tool 路由优先级。
- `.tmp` 截图不直接进入版本化 Golden；P3 使用固定字体、时间、数据与稳定 mask 重新生成正式基线。
- 任何 fallback、空数据壳或 demo 页成功都不能替代真实对话和真实业务数据证据。
