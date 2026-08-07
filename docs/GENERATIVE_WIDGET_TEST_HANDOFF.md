# Generative Widget 测试交接文档

> **用途**：让其他人按本文独立完成 **Generative Widget（`show-widget`）** 端到端验证，无需回溯设计讨论。  
> **状态**：实现已合入主线；本文供 **人工验收 + 自动门禁**。  
> **日期**：2026-08-05  
> **性质**：测试执行手册（非设计文）

---

## 0. 30 秒结论（给测试同学）

| 项 | 内容 |
|---|---|
| 测什么 | 对话里模型（或 fixture 文本）输出 `show-widget` JSON 围栏 → UI 用沙箱 iframe 渲染可交互 widget |
| 不测什么 | OCIX / HTML Artifact / MCP Apps / Business Gateway；widget **不能** 调企业 API |
| 成功标准 | 单元测试全绿 + 下文 **G1–G8 / S1–S4** 手工项通过，并按 §9 回填结果 |
| 预计耗时 | 自动门禁 ~5 分钟；UI + 模型 E2E ~30–60 分钟 |

---

## 1. 产品边界（必读，避免测错轨）

Generative Widget 是 **第 5 条对话 UI 轨**，与下面四条 **独立**：

| 轨 | 触发方式 | 本测试是否覆盖 |
|---|---|---|
| **Generative Widget** | assistant **text** 中的 ` ```show-widget ` 围栏 | **是（唯一目标）** |
| Declarative `interactive_ui` | Tool + 平台组件 | 否（仅做不回归冒烟） |
| HTML Artifact | Tool envelope | 否 |
| OCIX | 安装扩展 + Gateway | 否 |
| MCP Apps | `ui://` 第三方 App | 否 |

**一句话**：模型在文本里写 JSON 围栏；Host 解析并 sandbox 渲染；无 tool result、无 OCIX 签名、无业务 token。

Wire format（唯一合法入口）：

````markdown
```show-widget
{"title":"Hello","widget_code":"<div style='padding:8px'>Hello world</div>"}
```
````

- `widget_code` 必须是 **JSON 字符串**（不是裸 HTML 围栏）。  
- 裸 ` ```html ` **不是** widget。  
- 说明文字写在围栏 **外**；多个 widget 用 **多个独立围栏**。

---

## 2. 版本与仓库钉扎

在开始测试前确认本地检出（或等价已含 merge 的提交）：

| 仓库 | 建议基线 | 关键提交 |
|---|---|---|
| `openchamber` | `dd81675a` 或更新（含 widget merge） | `1af98c56` `merge: integrate generative widget` |
| `opencode`（fork） | `ed8c5c7d` 或更新（含 prompt+skill） | `bb7f1435` `feat(session): inject generative-widget prompt and on-demand skill` |

快速自检：

```bash
# openchamber
cd /path/to/openchamber
git log --oneline --grep='generative widget' -5
test -f packages/ui/src/lib/generative-widget/parseShowWidget.ts && echo "UI widget OK"

# opencode fork
cd /path/to/opencode
git log --oneline --grep='generative-widget' -5
test -f packages/opencode/src/session/prompt/generative-widget.txt && echo "OpenCode prompt OK"
test -f packages/opencode/src/skill/generative-widget-guidelines.ts && echo "OpenCode skill OK"
```

**重要**：OpenChamber UI 渲染围栏；**模型会不会主动写围栏** 依赖 **带 prompt 注入的 OpenCode fork**。若连上游官方 OpenCode（无 `generative-widget.txt`），模型侧 E2E 可能失败，但 **fixture 粘贴渲染** 仍可测 UI。

---

## 3. 环境准备

### 3.1 依赖

- macOS / Linux（本文以本地 web 开发为主）
- **Bun** ≥ 仓库要求（openchamber `packageManager: bun@1.3.x`）
- Node ≥ 22（若脚本需要）
- 已配置可用的 LLM（OpenCode provider / API key），用于 §7 模型 E2E
- 浏览器：Chrome 或 Edge 最新稳定版（需 DevTools）

### 3.2 安装与构建

```bash
# --- OpenChamber ---
cd /path/to/openchamber
bun install
bun run type-check:ui
bun run lint:ui

# --- OpenCode fork（模型会输出 show-widget 时必须用此二进制）---
cd /path/to/opencode
bun install
# 按仓库惯例构建 CLI，例如：
bun run --cwd packages/opencode build
# 记下产物路径，常见类似：
# packages/opencode/dist/opencode-darwin-arm64
# 或 packages/opencode/bin/opencode
```

将 OpenChamber 指向该 fork（任选其一，以本机实际环境变量名为准）：

```bash
export OPENCODE_BINARY="/absolute/path/to/opencode/packages/opencode/dist/opencode-darwin-arm64"
# 若环境使用下列别名，同样设置：
# export OPENCHAMBER_OPENCODE_PATH=...
# export OPENCHAMBER_OPENCODE_BIN=...
```

### 3.3 启动 OpenChamber（开发）

```bash
cd /path/to/openchamber
bun run dev
# 或
bun run dev:web:hmr
```

按终端提示打开 Web UI，登录/选择项目，**新建一个干净 session** 用于 widget 测试。

若连接外部已运行的 OpenCode：

```bash
export OPENCODE_SKIP_START=true
export OPENCODE_PORT=4096   # 或 OPENCODE_HOST=https://...
```

确认该外部 OpenCode **就是** 上述 fork，而不是未打补丁的上游。

---

## 4. 自动门禁（必须先过）

在 **openchamber** 根目录执行：

```bash
# A. Generative Widget 单元测试（解析 / 消毒 / 指南）
bun test packages/ui/src/lib/generative-widget/

# B. UI 类型与 lint（若时间紧可只做 A；完整验收建议 A+B）
bun run type-check:ui
bun run lint:ui
```

| 门禁 | 期望 |
|---|---|
| A | 全部 PASS，无失败 |
| B | 无 error（既有 warning 可记录但不阻塞本轨） |

**失败则停止手工 E2E**，把日志贴回开发；不要用「模型 prompt 绕过」掩盖解析/安全回归。

可选 OpenCode 侧冒烟（确认 prompt 文件被打包进二进制后仍存在于源码树）：

```bash
cd /path/to/opencode
rg -n "generative-widget|PROMPT_GENERATIVE_WIDGET|GENERATIVE_WIDGET_GUIDELINES" \
  packages/opencode/src/session packages/opencode/src/skill
```

应能看到：

- `session/prompt/generative-widget.txt`
- `session/system.ts` 注入 `PROMPT_GENERATIVE_WIDGET`
- `skill/generative-widget-guidelines.ts` + `skill/index.ts` 注册

---

## 5. UI 渲染验收（不依赖模型 — 优先做）

目的：证明 **接收端** 正确；把「模型不写围栏」与「UI 不渲染」拆开。

### 5.1 如何注入 fixture

任选一种你们环境支持的方式：

1. **开发者 fixture**（若会话支持粘贴/模拟 assistant 文本）— 把下方完整 assistant 文本注入为 **已完成** 的 text part。  
2. **人工模拟**：在调试工具或临时测试页调用 `parseAllShowWidgets` / 渲染组件（开发自测）。  
3. **模型强制**：用户消息写「**只输出下面这段，一字不改**」+ 粘贴 fixture（见 §7 的 G-F1）。

### 5.2 Fixture 用例

#### F1 — 最小合法 widget（必过）

用户侧或 fixture 内容：

````text
下面是一个问候卡片。

```show-widget
{"title":"Hello","widget_code":"<div style='padding:12px;font:14px system-ui;color:var(--color-text-primary,#111)'>Hello Generative Widget</div>"}
```

解释写在围栏外面。
````

| ID | 期望 | 结果 (P/F) | 备注 |
|---|---|---|---|
| F1.1 | 出现 **widget 卡片**，不是灰色代码块当唯一展示 |  |  |
| F1.2 | 卡片标题为 `Hello`（或等价 UI 标题区） |  |  |
| F1.3 | 正文可见 `Hello Generative Widget` |  |  |
| F1.4 | 围栏外「解释写在…」仍以 markdown 文本显示 |  |  |
| F1.5 | 控制台无 React crash / ErrorBoundary 整页白屏 |  |  |

#### F2 — 畸形围栏（必过）

````text
```show-widget
<div>not json</div>
```
````

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| F2.1 | 显示 **Malformed show-widget** 类提示，而不是崩溃 |  |  |
| F2.2 | 后续消息仍可正常发送 |  |  |

#### F3 — 缺 `widget_code`（必过）

````text
```show-widget
{"title":"x"}
```
````

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| F3.1 | Malformed 提示；聊天可用 |  |  |

#### F4 — 多 widget 交错（必过）

````text
第一部分说明。

```show-widget
{"title":"A","widget_code":"<div style='padding:8px'>Widget A</div>"}
```

中间说明。

```show-widget
{"title":"B","widget_code":"<div style='padding:8px'>Widget B</div>"}
```

结尾说明。
````

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| F4.1 | 顺序：文 → A → 文 → B → 文 |  |  |
| F4.2 | 两个 iframe/卡片均可见 |  |  |

#### F5 — 交互 + drill-down（必过）

````text
```show-widget
{"title":"Counter","widget_code":"<div style='padding:12px;font:14px system-ui'><button id='b' style='padding:6px 12px'>Click</button> <span id='n'>0</span><div style='margin-top:8px'><button onclick=\"window.__widgetSendMessage('用户点击了计数器，请继续解释')\">Ask more</button></div><script>document.getElementById('b').onclick=function(){var n=document.getElementById('n');n.textContent=String(+n.textContent+1)}</script></div>"}
```
````

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| F5.1 | finalize 后点击 `Click`，数字递增 |  |  |
| F5.2 | 点击 `Ask more`，会话中出现一条 **用户消息**（follow-up） |  |  |
| F5.3 | 2 秒内连点 `Ask more` 多次，**不会** 每点都发（限流 ~2s / 文本 ≤500） |  |  |

#### F6 — 历史重放（必过）

| ID | 步骤与期望 | 结果 | 备注 |
|---|---|---|---|
| F6.1 | 完成 F1 后刷新页面 / 离开再进入同一会话，widget 仍渲染 |  |  |
| F6.2 | 不依赖独立 blob 表；源数据仍是 message text 中的围栏 |  |  |

#### F7 — 主题（建议）

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| F7.1 | 切换 light/dark 后 widget 文字/背景不刺眼、能跟随 token |  |  |

---

## 6. 安全检查（必过，DevTools）

在已渲染的 widget 上打开 DevTools：

| ID | 检查 | 如何做 | 期望 | 结果 |
|---|---|---|---|---|
| S1 | sandbox | Elements → widget `iframe` | 有 `sandbox`，含 `allow-scripts`，**无** `allow-same-origin` |  |
| S2 | connect-src | Console 在 iframe 上下文执行 `fetch('https://example.com')` | 失败 / 被 CSP 拦 |  |
| S3 | 流式无 script | 模型或流式 fixture 生成过程中 | 未闭合前不应执行业务 script；不应整段 script 当可见纯文本长时间刷屏 |  |
| S4 | 嵌套危险标签 | fixture：`widget_code` 含 `<iframe src=...>` / `<object>` | 被剥除或不可用，宿主不崩 |  |

S4 fixture 示例：

````text
```show-widget
{"title":"Bad nest","widget_code":"<div>outer<iframe src='https://example.com'></iframe></div>"}
```
````

---

## 7. 模型端到端（依赖 OpenCode fork + LLM）

**前置**：确认当前 session 的 OpenCode 进程是 §2 的 fork，且 always-on prompt 已注入。

### 7.1 探测 prompt 是否生效（可选）

新会话发送：

> 你支持 show-widget 吗？请用最小合法 show-widget 输出一个标题为 Ping 的卡片，widget_code 里只写 Ping。

| ID | 期望 | 结果 | 备注 |
|---|---|---|---|
| M0 | 回复含 ` ```show-widget ` 且 JSON 可解析 |  | 若只给 markdown/html 围栏 → 记 **模型/prompt 失败**，UI 仍可用 §5 证明 |

### 7.2 功能场景（对齐计划 A1–A8）

| ID | 用户提示（可原样粘贴） | 期望 | 结果 | 截图/备注 |
|---|---|---|---|---|
| G1 | 用示意图解释 LLM 训练的主要阶段（pretrain / SFT / RLHF），请用 show-widget 画，不要只给列表 | 出现 SVG/HTML widget |  |  |
| G2 | 做一个可拖动滑块的简易贷款利息计算器（本金、年利率、期数），结果实时更新；用 show-widget | finalize 后滑块可改结果；无网络请求 |  |  |
| G3 | （观察 G1/G2 流式过程） | 流式时有渐进预览；不应长时间把完整 script 当正文露出 |  |  |
| G4 | 请在同一条回复里输出两个 show-widget：一个柱状示意（可用简单 div），一个简短 SVG 图标，中间用文字说明分隔 | 交错 text/widget/text/widget |  |  |
| G5 | 复杂图表前请先 load skill `generative-widget-guidelines`，再用 show-widget + 白名单 CDN（如 Chart.js from cdn.jsdelivr.net）画一个简单柱状图 | 图可见；Network 仅白名单 CDN 或无跨域业务 API |  |  |
| G6 | 刷新后重开 G1 会话 | 历史 widget 仍在 |  |  |
| G7 | widget 内含「点此继续」按钮（`__widgetSendMessage`） | 点击产生用户 follow-up |  |  |
| G8 | 切换主题 | 颜色可接受 |  |  |

### 7.3 强制 fixture 兜底（模型不听话时）

用户消息：

> 请完整原样输出以下内容，不要修改、不要加解释：

然后粘贴 §5 的 F1 / F5 原文。用于区分 **UI bug** vs **模型合规性**。

---

## 8. 回归冒烟（简短，防止串轨）

| ID | 操作 | 期望 | 结果 |
|---|---|---|---|
| R1 | 普通编码问答（无可视化） | 正常 markdown；不应无故弹出空 widget |  |
| R2 | 若环境有 Declarative / Artifact 用例 | 原路径仍工作 |  |
| R3 | 无 show-widget 的 generated JSON card（若产品有） | 仍走原 card，不被 widget 分支吞掉 |  |

---

## 9. 结果回填模板（测试同学复制填写）

```markdown
## Generative Widget 验收结果

- 测试人：
- 日期：
- openchamber commit：
- opencode commit / binary path：
- 模型 / provider：
- 启动方式（dev / packaged / OPENCODE_*）：

### 自动门禁
- [ ] bun test packages/ui/src/lib/generative-widget/  → PASS / FAIL
- [ ] type-check:ui / lint:ui → PASS / FAIL / SKIP

### Fixture UI（§5）
| ID | P/F | 备注 |
| F1 |  |  |
| F2 |  |  |
| F3 |  |  |
| F4 |  |  |
| F5 |  |  |
| F6 |  |  |
| F7 |  |  |

### 安全（§6）
| ID | P/F | 备注 |
| S1 |  |  |
| S2 |  |  |
| S3 |  |  |
| S4 |  |  |

### 模型 E2E（§7）
| ID | P/F | 备注 |
| M0 |  |  |
| G1–G8 |  | 逐条或汇总 |

### 回归（§8）
| ID | P/F | 备注 |
| R1 |  |  |

### 结论
- [ ] **通过**（自动门禁 + F1–F6 + S1–S4 全过；G 至少 G1/G2/G6）
- [ ] **有条件通过**（UI 全过，模型偶发不写围栏 — 附 M0 日志）
- [ ] **不通过**（附失败 ID + 截图 + 控制台）

### 附件
- 截图路径：
- 控制台日志：
- 失败 session id：
```

**通过门禁建议**（可写进 release）：

1. 自动测试 A 必须 PASS  
2. F1–F6、S1–S4 必须 PASS  
3. G1、G2、G6 至少有一次成功（或 G-F1 强制 fixture 证明 UI，并单列「模型合规待优化」）

---

## 10. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 模型只输出 markdown / ` ```html ` | 未使用 fork，或二进制过旧未注入 prompt | 检查 `OPENCODE_BINARY`；确认 `generative-widget.txt` 注入；重建 opencode |
| 有围栏但显示代码块 | UI 未合入 / 未热更新 / 缓存旧 bundle | 确认 `AssistantTextPart` 走 widget 分支；硬刷新；重建 web |
| Malformed 满屏 | 模型 JSON 转义错误（双引号 HTML） | 属模型质量；用 F1 验证 UI；可提示模型用单引号属性 |
| 点击 Ask more 无反应 | send 桥未注册 / 超 500 字 / 2s 限流 | 看 ChatInput 是否 mount；缩短文案；间隔 2s 再点 |
| Chart.js 不加载 | CDN 不在白名单或离线 | 仅 `cdnjs.cloudflare.com` / `cdn.jsdelivr.net` / `unpkg.com` / `esm.sh` |
| fetch 成功连外网 | **安全回归，一票否决** | 查 CSP `connect-src`、sandbox 属性 |
| 与 OCIX 搞混 | 测错轨 | 回到 §1；widget 无 Gateway、无 `.ocix` |

---

## 11. 代码与文档索引

| 路径 | 说明 |
|---|---|
| `packages/ui/src/lib/generative-widget/` | 解析、消毒、CSS bridge、height cache、send 桥 |
| `packages/ui/src/components/chat/generative-widget/` | `WidgetRenderer`、ErrorBoundary、Malformed 提示、渲染入口 |
| `packages/ui/src/components/chat/message/parts/AssistantTextPart.tsx` | text part 接入点 |
| `packages/ui/src/components/chat/ChatInput.tsx` | `setGenerativeWidgetSendHandler` |
| `opencode/.../session/prompt/generative-widget.txt` | Always-on wire format（~350–600 tokens） |
| `opencode/.../session/system.ts` | 注入上述 prompt |
| `opencode/.../skill/generative-widget-guidelines.ts` | On-demand 长指南 skill |
| [GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md](./GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md) | 设计与完整验收矩阵 |
| [packages/ui/.../generative-widget/DOCUMENTATION.md](../packages/ui/src/components/chat/generative-widget/DOCUMENTATION.md) | 模块说明 |
| [references/codepilot-generative-widget/](./references/codepilot-generative-widget/) | 行为参考（禁止当产品依赖） |

---

## 12. 给分发者的说明

1. 把本文路径发给测试同学即可：  
   `openchamber/docs/GENERATIVE_WIDGET_TEST_HANDOFF.md`  
2. 同时告知 **openchamber / opencode 的 commit 或分支** 与 **如何设置 `OPENCODE_BINARY`**。  
3. 回收 §9 表格即可合入或打回；无需他们阅读完整 port plan。  
4. 若仅验证 UI、暂时没有 fork 二进制：明确要求 **只跑 §4 + §5 + §6**，§7 标 SKIP 并说明原因。

---

*文档维护：实现变更 wire format / sandbox / 注入路径时，同步改本文 §1、§4、§10。*
