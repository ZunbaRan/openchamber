# Interactive UI / OCIX Agent 自主测试手册

> 目标：让后续 Agent 能在没有人工逐条指挥的情况下，选择正确门禁、隔离环境、执行测试、处理可重试故障、清理现场并给出不夸大的发布结论。  
> 统一测试使用真实 OpenChamber Host、bundled OpenCode、签名 OCIX 和动态业务 API；独立 fixture 只用于定向调试。

## 1. Agent 的验收合同

自主测试不是“把所有命令跑一遍”。Agent 必须保证：

1. **先分类风险**：明确改动影响的模块、Runtime、持久化状态和外部合同；
2. **先窄后宽**：先运行最小回归，再运行受影响的真实链路，最后才运行组合门禁；
3. **证据隔离**：不读取用户现有的 Tool、Skill、OCIX、缓存、历史会话或业务 Key；
4. **成功可分解**：Tool selection、View rendering、真实数据、写入结果分别断言；
5. **失败不伪装**：fallback、空状态、旧 `.app`、不可用 Provider 和未测平台不能算通过；
6. **重试有边界**：只重试短暂基础设施故障，保留每次 attempt；
7. **结束可恢复**：无论通过、失败还是中断，都清理临时扩展、进程、端口和目录；
8. **结论有等级**：区分 `ok`、`complete`、`externalBlockers` 和 capability 状态。

## 2. 先按改动选择测试

| 改动类型 | 最小验证 | 追加验证 |
|---|---|---|
| Declarative schema/sanitizer/renderer | 对应单元测试、UI type-check/lint | functional、security、visual、model routing（若改变路由/表达力） |
| OCIX manifest/manager/Tool/Skill/Gateway | extension 与 server 定向测试 | functional、security、model routing |
| HTML Artifact parser/store/Bridge/Broker | Generated + Installed Artifact 单元测试与 browser | security；Business Bridge 改动增加真实 Gateway query/write；visual/performance |
| Tool description、Skill、system routing | 定向路由测试 | 同一 17 条语料的 model routing |
| ToolPart/聊天呈现/样式/响应式 | UI 测试与 type-check/lint | real Host、visual 62 Golden |
| Electron、自定义协议、bundled Runtime、资源 | Electron 定向测试/build | 重新 package、packaged desktop、performance |
| 新增/删除/重命名源码或 export/import shape | 所属测试、type-check/lint | `bun run dead-code` 并人工读报告 |
| 只改文档 | `bun run docs:validate` | 不运行无关全仓 Runtime 测试 |

测试范围以根 `package.json` 脚本为准。跨 workspace 或 Runtime 合同变化时，静态检查不能替代真实 Runtime 证据。

## 3. 自主执行协议

### Phase A：预检和冻结范围

1. 读取根 `AGENTS.md`、匹配 Skill、最近的 `DOCUMENTATION.md` 和 package README；
2. 记录本次改动的最高风险、实际消费者和需要支持的 Runtime；
3. 检查所需 fixture、签名测试包和本次明确要求的 Provider 是否可用；普通开发默认只要求 Qwen3.7 Plus，额外 Provider 不可用不构成阻断；
4. 使用固定语料 `examples/interactive-ui/unified-acceptance-corpus.json`；除非任务本身是修改协议/语料，不在验收失败后临时改 prompt、acceptable tools、viewport 或阈值；
5. 明确是否需要重新构建 Web 或 Electron 产物，不能复用来源不明的旧产物。

### Phase B：定向回归

先运行与改动最近的测试文件、package type-check 和 lint。若这里失败，立即修复并重跑；不要先用宽泛端到端测试制造更多噪音。

典型基础门禁：

```bash
bun run test:interactive-ui-extension
bun run test:interactive-ui
bun run test:html-artifact-browser
bun run type-check
bun run lint
```

只有修改或审查 Scripts Artifact 时，显式运行：

```bash
OPENCHAMBER_TEST_ARTIFACT_SCRIPTS=true bun run test:html-artifact-browser
```

该命令通过仍不改变 `experimental / default-off` 状态，因为普通 iframe 尚无独立 CPU/内存终止边界。

### Phase C：真实 Host 功能闭环

运行：

```bash
bun run test:interactive-ui-functional
```

验收器应使用独立临时 OpenChamber data、OpenCode config、Artifact cache、bundled OpenCode 和动态 CRM API。它必须验证：

- 内置 `interactive_ui`、`html_artifact` 和 Skill 被真实 OpenCode 发现；
- 签名 Simple CRM OCIX 的 Tool/Skill 被发现；
- 同一混合包的 Installed Declarative、Trusted Native 与 Third-party HTML Artifact 都能物化；
- CRM 返回固定非空业务数据；
- Interactive UI 与 HTML Artifact 均通过同一 Gateway 查询；未确认/取消不写入，确认后 revision 和查询结果更新；
- 401/403/409/upstream unavailable 被稳定分类且脱敏；
- install、upgrade、disable、enable、rollback、uninstall、清凭据和重装未配置等生命周期成立。

业务测试结果必须分别记录 `Tool selected`、`View rendered`、`Business data loaded`。任何 fallback 或空 shell 都不能让这一批通过。

该功能验收覆盖真实签名、真实 Agent Runtime、Gateway 和业务 API，但不单独证明正常聊天 ToolPart 的浏览器呈现。涉及 ToolPart 或会话路由的发布候选还必须追加真实 OpenChamber 会话浏览器验收。

在已通过 `bun run demo:interactive-ui:start` 启动的本地 Host 上运行：

```bash
bun run test:interactive-ui-conversation-browser
```

该验收默认使用 `alibaba-coding-plan-cn/qwen3.7-plus`，临时安装同一签名混合 CRM 包并创建两个真实会话。它分别断言 Third-party HTML Artifact 与 Installed Interactive UI 由正常聊天 `ToolPart` 内联渲染，且跨 OOPIF sandbox 读取到 `Connected` 和非空 CRM 数据。截图与报告写入 `.tmp/interactive-ui-conversation-browser/`；测试结束后必须卸载临时扩展、清除连接与本次新增的 publisher trust，并归档测试会话。

### Phase D：安全、视觉和模型路由

按固定顺序执行：

```bash
bun run test:interactive-ui-security
bun run test:interactive-ui-visual
bun run test:interactive-ui-model-routing
```

关键规则：

- 安全测试观察实际网络请求、导航、Bridge 消息、Runtime error 和敏感信息，而不是只看 CSP/sandbox 字符串；
- 常规视觉测试只比较正式 Golden；不得自动调用 update 命令；
- Golden 只允许在有意视觉变更、人工逐张复核后通过 `bun run test:interactive-ui-visual:update` 更新；
- 默认模型门禁使用 Qwen3.7 Plus；显式选择多 Provider 对照时，对所有选定 Provider 使用同一 17 条语料和同一阈值；
- 临时 OCIX 安装后等待一次成功 Tool inventory，再开始模型用例；卸载后也必须等待成功清单证明 Tool 消失；
- 只有本次明确要求的不可用模型才写入 `externalBlockers`；可选对照模型写入 `unavailableModels`，不能换模型或降阈值冒充完成。

可以通过以下环境变量只做诊断性子集，但子集通过不能替代完整发布矩阵：

```bash
OPENCHAMBER_ACCEPTANCE_CASE_IDS=<comma-separated-case-ids> \
  bun run test:interactive-ui-model-routing

OPENCHAMBER_ACCEPTANCE_MODELS=<provider/model,...> \
  bun run test:interactive-ui-model-routing
```

### Phase E：Runtime、打包和性能

只要源码、Web assets、server、内置 Runtime 或 Electron 资源变化，就先重建实际包：

```bash
bun run electron:build
bun run test:interactive-ui-desktop-packaged
bun run test:interactive-ui-runtime-performance
```

打包测试必须在干净 data/user-data/config、清空覆盖变量和受限 PATH 下证明 bundled OpenCode、生产 Tool/Skill、Generated 内容、Static Artifact、cache 重建、显示模式、scripts-disabled fallback、整应用重启和退出清理。

性能测试依赖前面生成的视觉、功能和打包报告；若输入证据不是同一冻结版本，应重跑来源门禁，不能直接复用旧 JSON。

### Phase F：全仓收口与组合报告

根据实际改动运行：

```bash
bun run type-check
bun run lint
bun run docs:validate
bun run dead-code
bun run build:web
bun run test:interactive-ui-unified
```

注意：`bun run test:interactive-ui-unified` **只读取并组合已有子报告**，不会替你执行 R3-1 到 R3-6。运行它之前必须确认这些报告来自当前冻结版本：

```text
.tmp/interactive-ui-unified-functional/report.json
.tmp/interactive-ui-security/report.json
.tmp/interactive-ui-visual-smoke/baseline.json
.tmp/interactive-ui-model-routing/report.json
.tmp/interactive-ui-packaged-desktop/report.json
.tmp/interactive-ui-runtime-performance/report.json
```

`.tmp/interactive-ui-conversation-browser/report.json` 是 ToolPart 正常对话的追加发布证据，当前聚合器不会自动读取它；涉及聊天渲染的 Agent 必须单独检查其中 `ok`、两类 surface 断言和截图。

组合结果写入 `.tmp/interactive-ui-unified-acceptance/report.json`。

`dead-code` 使用 `--no-exit-code`，所以命令结束不代表零 warning。Agent 必须阅读输出，把新增问题与已知 baseline 噪音区分开。

## 4. 固定统一验收顺序

完整发布候选按以下顺序执行，后面的门禁依赖前面的机器证据：

```text
R3-1 functional
  → R3-2 security
  → R3-3 visual/a11y
  → R3-4 model routing
  → R3-5 packaged/runtime
  → R3-6 performance
  → R3-7 static/docs/aggregate
```

若在某一批修复代码，至少重跑该批以及所有受影响的后续批次。例如修改 Artifact Host CSS 后，应重跑 visual、packaged 和 performance；修改 OCIX Agent Runtime 后，应重跑 functional、model routing、packaged 和 aggregate。

## 5. 重试策略

| 失败 | 自动重试 | 规则 |
|---|---|---|
| GET/session create 出现 502/503/504 | 可以 | 有限次数、指数或线性退避，等待健康恢复 |
| completion timeout / connection aborted | 可以 | 终止旧 session，确认 OpenCode 与内置 Tool 恢复，再重试；保留所有 attempt |
| 安装/卸载后的 Tool inventory 暂时 503 | 等待，不判定 | 只有成功 inventory 才能证明存在/不存在 |
| 选错 Tool、重复主 View、Artifact 企业越权 | 不可以 | 这是语义失败，应修复路由/合同 |
| Golden 像素差 | 不可以 | 先人工检查原因；禁止自动更新 baseline 绕过 |
| 签名、hash、publisher、权限失败 | 不可以 | 供应链失败必须阻断 |
| Provider 未连接、平台无机器 | 不可以 | 记录 external blocker / unverified |

报告必须包含 attempt 数、session ID、时长、actual Tool 和脱敏错误。第二次成功不应被展示成首次成功。

## 6. 隔离与清理协议

### 6.1 隔离要求

- 使用临时 OpenChamber data、OpenCode config、Electron user-data 和 Artifact cache；
- 业务 API 绑定动态 loopback port，不占用用户固定服务；
- 测试 Secret 只在进程环境/服务端边界使用，绝不输出值；
- 禁用与目标无关的 fixture Tools 和 session recap/suggestion；
- 不读取或修改用户现有 OCIX、Tool、Skill、连接和历史缓存。

### 6.2 `finally` 清理顺序

1. 终止或归档测试 session；
2. 如果 OCIX 是测试临时安装的，则卸载；若测试前已存在，绝不擅自覆盖或删除；
3. 等待成功 Tool inventory，确认临时 Tool 已消失；
4. 停止业务 mock/API；
5. 停止 OpenChamber 根进程并清理 descendants；
6. 确认监听端口关闭；
7. 删除本次专用临时目录；
8. 保留 `.tmp` 下的脱敏机器报告和必要截图作为证据。

日常 demo 使用：

```bash
bun run demo:interactive-ui:start
bun run demo:interactive-ui:stop
```

若 Agent 被中断，恢复后先检查 Extension Manager、Tool inventory、demo 状态和端口，再继续执行；不要假定上一次 `finally` 已运行。

## 7. 自主判定与报告格式

组合报告的含义：

- `ok: true`：本机当前可执行的门禁全部通过；
- `complete: true`：Qwen3.7 Plus及本次明确要求的其他模型/平台都完成，且没有 external blocker；
- `complete: false` 不等于本地失败，必须同时说明缺失 Provider/平台；
- `releaseCandidate: static-first-tested-runtimes`：只对已验证 Runtime 发布 stable 能力；
- Scripts Artifact 继续列在 `experimentalDefaultOff`。

Agent 最终汇报至少包括：

```text
结果：通过 / 失败 / 本地通过但不完整
改动范围：实际被验证的模块与 Runtime
已运行：逐条命令及结果
机器证据：report.json / screenshot 路径
重试：哪些 case 重试、为何重试、最终 attempt
清理：临时 OCIX、进程、端口和目录状态
未运行或未验证：原因与影响
发布分级：stable / experimental / unsupported / unverified / blocked
```

不得使用“全部通过”概括 `complete: false`，也不得从 macOS arm64 推断 Windows/Linux/Capacitor。

## 8. 当前统一矩阵的已知边界

- Agent Generated Declarative：`stable`；
- Installed Declarative：已验收 Runtime 为 `stable`；
- Trusted Native：已验收 Runtime 为 `stable`；
- Static HTML Artifact：`stable`；
- Scripts HTML Artifact：`experimental / default-off`；
- VS Code / active E2EE relay Artifact：`unsupported`；
- Windows/Linux Desktop、Capacitor：`unverified`；
- 未连接但被当前任务明确指定为必需的 Provider：`external blocker`，保持原语料等待补跑；未指定的 OpenAI 等对照不阻塞普通开发。

这些标签必须随新证据更新，不能凭静态分析自行升级。

## 9. 关联资料

- [Interactive UI 统一验收报告](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md)
- [Interactive UI 美化、HTML Artifact 与统一测试执行计划](./INTERACTIVE_UI_BEAUTIFICATION_HTML_ARTIFACT_EXECUTION_PLAN.md)
- [开发踩坑手册](./INTERACTIVE_UI_DEVELOPMENT_PITFALLS.md)
- [OCIX 与桌面打包踩坑手册](./INTERACTIVE_UI_PACKAGING_PITFALLS.md)
- [HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md)
