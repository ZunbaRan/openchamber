# Interactive UI 统一验收报告

> 日期：2026-07-22
> 范围：Agent Generated Declarative、Installed Declarative、Trusted Native、HTML Artifact Runtime v1、Managed Desktop 独立 Scripts Artifact Runner
> 结论：本机可执行的产品门禁全部通过；OpenAI 路由矩阵和非 macOS 桌面/Capacitor 仍明确标记为外部未验证，不推断通过。

> 2026-07-22 实现增量：Managed Desktop 已加入独立 Scripts Artifact Runner、主进程 CPU/内存/租约/并发门禁和强制 Stop；连接状态已拆为 credential 与 runtime health；Declarative 新增 `agenda`/`funnel`/`network`。最新 macOS arm64 打包报告已重新生成，确认 Scripts Artifact 使用 `desktop-runner` 并完成 `ready → stopped`；普通 Web Scripts 等级不变。

## 1. 发布结论

本轮已经把美化、HTML Artifact、Agent 路由、真实企业扩展和统一测试闭合到 OpenChamber 的真实 Host 与打包产物，而不是独立演示页。

| 能力 | 发布等级 | 验收结论 |
|---|---|---|
| Agent Generated Declarative | `stable` | Qwen3.7 Plus 与 Big Pickle 的固定语料均正确选择 `interactive_ui`；标准组件、视觉、a11y 和性能门禁通过 |
| Installed Declarative | `stable`（已验收 Runtime） | 签名 OCIX、真实 CRM API、查询、状态映射和生命周期通过 |
| Trusted Native | `stable`（已验收 Runtime） | Host UI Kit、确认/取消、权限拒绝、revision 冲突和写后刷新通过 |
| Static HTML Artifact | `stable` | Web、Hosted Mobile 390 和打包 macOS arm64 可显示、重放、重建并切换显示模式 |
| Scripts HTML Artifact | Managed Desktop `supported/default-on`；Web `experimental/default-off` | Desktop 独立 Runner、资源终止门禁及打包态 `ready → stopped` 均通过；Web 等级不变 |
| VS Code / E2EE relay Artifact | `unsupported` | 不降级为较弱的 `srcdoc`/blob 实现 |
| Windows/Linux Desktop、Capacitor | `unverified` | 本轮没有对应 CI 或实机证据 |
| OpenAI `gpt-5.4` 路由 | `unverified / external blocker` | 当前验收实例没有连接该 Provider；没有降低阈值或替换模型冒充通过 |

Static-first 版本可以进入 Web、Hosted Mobile 与 macOS arm64 的发布候选流程。若发布标准强制要求“三模型都完成相同语料”，则唯一剩余阻断是连接 OpenAI Provider 后补跑同一命令。

## 2. 统一验收摘要

| 批次 | 结果 | 机器证据 |
|---|---|---|
| 确定性功能与真实 CRM | 通过 | `.tmp/interactive-ui-unified-functional/report.json` |
| 安全攻击矩阵 | 27 通过、0 失败、1 个实验边界 | `.tmp/interactive-ui-security/report.json` |
| 视觉与可访问性 | 62/62 Golden，零像素差，0 Runtime error | `.tmp/interactive-ui-visual-smoke/baseline.json`、`tests/visual/interactive-ui/golden/` |
| 跨模型路由 | Qwen 16/16；Big Pickle 16/16；OpenAI 未连接 | `.tmp/interactive-ui-model-routing/report.json` |
| 打包 macOS Desktop | 通过 | `.tmp/interactive-ui-packaged-desktop/report.json` |
| Runtime 与性能 | 通过 | `.tmp/interactive-ui-runtime-performance/report.json` |
| 扩展/系统/Artifact 浏览器 | 通过 | 命令输出及对应 `.tmp` 产物 |
| 全仓静态门禁 | type-check、lint、docs、build 通过；dead-code 完成 | 命令输出 |
| 组合发布结论 | 本地门禁通过；外部未验证项结构化保留 | `.tmp/interactive-ui-unified-acceptance/report.json` |

## 3. Agent 路由矩阵

固定语料位于 `examples/interactive-ui/unified-acceptance-corpus.json`，共 16 条：Generated 6、业务 4、Artifact 3、负例 3。两个可用模型执行完全相同的 prompt 和期望路径，没有为单个模型修改语料或阈值。

| 指标 | Qwen3.7 Plus | Big Pickle | 门槛 |
|---|---:|---:|---:|
| 总场景 | 16/16 | 16/16 | 全量执行 |
| 业务 Tool 命中率 | 100% | 100% | ≥95% |
| Generated 命中率 | 100% | 100% | ≥95% |
| Artifact 命中率 | 100% | 100% | ≥90% |
| Artifact 误选率 | 0% | 0% | ≤5% |
| Artifact 企业越权 | 0 | 0 | 0 |
| 重复成功主 View | 0% | 0% | 0% |
| 最终错误 | 0 | 0 | 0 |

Qwen 的天气场景和中文探索器场景首轮分别在 90 秒与 180 秒内未完成。验收器中止旧会话、确认 OpenCode 与内置 Tool 恢复健康后各重试一次，最终通过；报告保留两次 attempt，不把超时隐藏成首轮成功。Big Pickle 16 条均首轮完成。

路由修复同时收紧了 `interactive_ui` Tool 合同：无效 `sections` 或没有受支持 widget 会返回 Tool error，供模型纠正参数；失败调用不会产生成功的空 View，也不会被重复主 View 指标计入。

OpenAI `gpt-5.4` 在 Provider/Model 发现接口中不可用，因此总报告故意保持 `complete: false`，并写入 `externalBlockers`。这不影响两个已连接模型和确定性门禁的真实通过状态。

## 4. 企业扩展与真实数据闭环

`bun run test:interactive-ui-functional` 使用独立临时 OpenChamber data、OpenCode config、Artifact cache、bundled OpenCode 和动态 CRM API，不读取开发者现有的全局 Tool、Skill、OCIX 或历史缓存。

通过项：

- bundled OpenCode 发现内置 `interactive_ui`、`html_artifact`、Interactive UI Skill，以及安装后的两个 Simple CRM Tool/Skill。
- Installed Declarative overview、Trusted Native workspace 和 Native bundle 均为 `ready`。
- API 返回 4 个客户、4 个商机和 3,050,000 管道金额；fallback 空壳不计作成功。
- 未确认和取消不改变数据；确认写入后 OP-2001 从 proposal/revision 4 进入 negotiation/revision 5，并由查询结果同步刷新。
- 401、403、409 和 upstream unavailable 被映射为稳定错误分类，未回显第三方原始错误正文。
- OCIX 1.1.1 安装、1.2.0 升级、动态连接验收版、禁用、启用、回滚、恢复、卸载清凭据和重装未配置全部通过。
- 脱敏检查通过，UI、报告和日志不包含 Access Key、Token 或完整鉴权 URL。

因此 CRM 验收的三层结果——`Tool selected`、`View rendered`、`Business data loaded`——均分别成立。

## 5. HTML Artifact 验收

### 5.1 Static

Static Artifact 使用独立 Result Envelope、服务端内容 hash、内容寻址存储和历史按 hash 重建。真实 Chromium 验收结果：

- iframe `sandbox` 属性为空，不授予 script、same-origin、form、popup、download 或 top-navigation。
- 非 fragment 导航在物化或 Broker 层被拒绝。
- 实际目标服务器请求数为 0，Runtime error 为 0。
- inline、workspace、fullscreen 复用同一个 iframe/content ID；切换不丢局部状态。
- 清空 cache 后可以按相同 content ID 重建；应用重启后仍可恢复。
- Web、Hosted Mobile 390 和打包 macOS arm64 已有真实证据。

### 5.2 Scripts

Scripts 测试通过确定性学习率模拟器：滑块值从 `0.0016` 变化到 `0.1585`，SVG path 与 revision 同步变化。受信 Broker 与 opaque-origin 子 frame 阻断了以下能力：

`beacon`、剪贴板读取、cookie、动态 eval、Function constructor、IndexedDB、localStorage、fetch、parent DOM、popup、service worker、top navigation、Wasm、WebSocket、Worker、XHR。

浏览器记录到严格的 `broker.navigationBlocked`，目标网络请求为 0，Runtime error 为 0。Bridge 仍只允许 resize、受控复制、受控外链、follow-up 和展开，不允许 Tool、Gateway、Token、文件系统或任意网络。

Scripts 必须按 Runtime 判定：Managed Desktop 已使用可由主进程终止的独立 `WebContentsView` Runner，默认开启并保留 kill switch；普通 Web iframe 仍无法证明无限循环或内存攻击能由宿主独立终止，因此继续默认关闭，只在显式 flag 与 Runtime capability 同时满足时作为 experimental 使用。

## 6. 视觉、响应式与可访问性

正式基线覆盖 Generated、Installed Declarative、Trusted Native、Static Artifact、Scripts Artifact，以及 blocked/crashed/scripts-disabled 状态和适用的显示模式。

- 62/62 Golden 通过，最大变化像素比例 `0`，最大平均通道差 `0`。
- light/dark、1440/1024/768/390、zh-CN/en 已覆盖。
- 页面级无横向溢出；宽表和复杂图只在组件内部受控滚动。
- Desktop 390 自动收起侧栏；Hosted Mobile 390 保持可读对话列。
- 未命名控件、重复 ID、断裂 ARIA 引用、无标题 iframe、缺少 alt 的图片均为 0。
- Generated tabs/accordion 键盘路径通过。
- Generated、Installed、Native 与 Artifact 共用 OCIX Token、状态词汇和 Host 外壳；不再出现白色 gutter、双边框或卡片套卡片。

Golden 只能通过 `bun run test:interactive-ui-visual:update` 显式更新并人工复核；普通验收使用 `bun run test:interactive-ui-visual` 只做比较。

## 7. Runtime、打包与性能

macOS arm64 `.app` 使用当前源码重新构建后，在全新 user-data/data/config 下通过真实打包验收：

- 使用 `Contents/Resources/opencode-cli/opencode`，版本 1.18.3；不依赖用户额外安装 OpenCode。
- 包内 OpenCode 发现 `interactive_ui`、`html_artifact` 和 `interactive-ui-visualization` Skill。
- Generated 与 Static Artifact 实际内容为 `ready`，不是只出现空 Host 卡片。
- Scripts Artifact 使用独立 `WebContentsView` Runner，状态完成 `ready → stopped`；停止后 Runner 及其会话资源被销毁。
- cache 重建保持相同 content ID；inline/workspace/fullscreen、应用停止和二次启动均通过。
- 混合 OCIX `com.demo.simple.crm@1.3.0-packaged.1` 在打包态发现 3 个 Tool，并通过 4 条真实 Gateway 客户数据验收。
- Runtime error 为 0；报告位于 `.tmp/interactive-ui-packaged-desktop/report.json`，截图位于同目录。

性能结果：

| 项目 | 结果 |
|---|---:|
| 主入口 | 893,494 bytes / gzip 260,725 |
| Artifact lazy chunk | 15,753 bytes / gzip 6,050 |
| Artifact renderer 懒加载 | 通过 |
| Generated ready median | 265 ms |
| Declarative ready median | 193 ms |
| Native ready median | 197 ms |
| CRM ready median | 193 ms |
| Static Artifact ready median | 896 ms |
| Scripts Artifact ready median | 935 ms |
| Store materialize median / p95 | 0.97 ms / 2.05 ms |
| Store cache-hit median / p95 | 0.28 ms / 9.17 ms |
| 25 样本 RSS 增量 | 7,831,552 bytes |

Artifact 重代码没有进入聊天首屏主入口，所有冻结预算通过。

## 8. 执行命令

以下命令均在本轮最终冻结版本上通过：

```bash
bun run test:interactive-ui-functional
bun run test:interactive-ui-security
bun run test:interactive-ui-visual
bun run test:interactive-ui-model-routing
bun run test:interactive-ui-unified
bun run electron:build
bun run test:interactive-ui-desktop-packaged
bun run test:interactive-ui-runtime-performance
bun run test:interactive-ui-extension
bun run test:interactive-ui
bun run test:html-artifact-browser
OPENCHAMBER_TEST_ARTIFACT_SCRIPTS=true bun run test:html-artifact-browser
bun run type-check
bun run lint
bun run docs:validate
bun run dead-code
bun run build:web
```

补充说明：

- `docs:validate`：387 pages、43 sidebar links。
- `type-check` / `lint`：root、UI、Web、Electron、Mobile 全部通过。
- `dead-code` 使用仓库既有的 Knip `--no-exit-code` 策略完成，仍输出 UI/VSCode/Mobile 入口识别等历史基线噪音；不能将“命令通过”解释为“零 warning”。
- Vite 仍输出既有 KaTeX 字体解析和大 chunk 提示；Artifact 自身保持独立 lazy chunk，未形成新增发布阻断。

## 9. 运行与测试稳定性修复

统一矩阵暴露并修复了两个演示生命周期问题：

1. 临时 OCIX 卸载后，验收器不再把 OpenCode 重启期间的 `503` 当成“Tool 已消失”，而是等待一次成功的 Tool 清单。
2. `demo:interactive-ui:stop` 不再误匹配包含脚本文件名的外层 shell，并会清理父进程先退出后被 reparent 的 OpenCode 子进程。

隔离演示还关闭了与验收无关的 session recap/suggestion 小模型调用，减少并发噪音；普通产品默认行为没有改变。

## 10. 剩余项与下一步

本轮没有未修复的 Web/Hosted Mobile/macOS arm64 产品 blocker。剩余工作均有明确边界：

1. 连接 OpenAI Provider 后原样运行 `bun run test:interactive-ui-model-routing`，补齐第三模型；不得修改 16 条语料、acceptable tools 或阈值。
2. 若要声明 Windows/Linux Desktop 或 Capacitor 支持，需在对应 CI/实机补做自定义协议、Secret Store、Artifact CSP、进程生命周期和显示模式验收。
3. Managed Desktop Runner 已具备独立终止、CPU/内存/租约/并发门禁；若要把 `supported` 升为正式 `stable`，仍需完成独立安全审计和持续版本回归策略。
4. 日常 Simple CRM 演示若要免手动启动业务 API，应另补 demo lifecycle；统一功能验收已经证明真实动态 API 闭环，但不把测试服务器当作生产部署方案。
5. Marketplace 发现、审核、发布与更新通道不在本轮范围内；本轮仅保留现有扩展管理接口，不据此宣称公共市场可用。
