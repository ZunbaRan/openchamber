# Generative Widget（CodePilot / Claude 风格）接入计划

> **状态**：实现已合入；验收执行见测试交接文档  
> **日期**：2026-08-04（状态更新 2026-08-05）  
> **性质**：fork 内部实施说明（OpenChamber UI + managed OpenCode fork）  
> **测试交接（给他人执行）**：[GENERATIVE_WIDGET_TEST_HANDOFF.md](./GENERATIVE_WIDGET_TEST_HANDOFF.md)  
> **参考源码目录**：[docs/references/codepilot-generative-widget/](./references/codepilot-generative-widget/)  
> **上游**：https://github.com/op7418/CodePilot（BSL-1.1，**仅参考，禁止整包拷贝进产品运行时**）

---

## 0. 给后续 Agent 的工作入口

若任务是「接入 CodePilot 风格 widget / Claude interactive UI / generative widget」：

1. **先读完本文**（产品边界 + 落点 + 验收）。  
2. **再读参考树** [references/codepilot-generative-widget/README.md](./references/codepilot-generative-widget/README.md)。  
3. **按本文 Phase 0→3 实现**；不要把实现放进 OCIX / HTML Artifact / MCP Apps 目录。  
4. **重写** `packages/ui/src/lib/generative-widget/**` 与 `components/chat/generative-widget/**`，对照参考源码行为，**不要** `import` 参考目录或把 BSL 文件当产品依赖。  
5. 改动 OpenCode 时只做 **system/instruction 注入**（+ 可选 skill），不要改 Part schema。

### 硬边界（违反即做错）

| 允许 | 禁止 |
|---|---|
| 独立轨 **Generative Widget** | 与 OCIX 安装/签名/Gateway 融合 |
| 解析 assistant **text part** 中的 `show-widget` 围栏 | 做成 Custom Tool result / HTML Artifact envelope |
| sandbox iframe + `connect-src 'none'` | widget 直连业务 API / 持有 token / 调 Business Gateway |
| follow-up：`sendMessage` 窄桥 | 把 widget 交互变成任意 tool 执行 |
| CDN 白名单（与 CodePilot 对齐时可保留） | `allow-same-origin` / 任意 `fetch` |

### 一句话产品定义

> **模型在对话文本里输出 `show-widget` JSON 围栏；Host 在对话流中用 receiver iframe 流式预览并终态执行脚本；无企业 API、无 OCIX、历史可从 text 重放。**

---

## 1. 背景与动机

### 1.1 体感差异

| | OpenChamber 现状（偏 Codex） | CodePilot widget（偏 Claude Desktop） |
|---|---|---|
| 触发 | Tool（`interactive_ui` / HTML Artifact envelope） | 文本围栏 `show-widget` |
| 表现 | 有界 Declarative 组件 或 严 Artifact | 任意 HTML/SVG + sandbox JS + CDN Chart.js |
| 流式 | Tool 状态机 | text delta 边生成边预览 |
| 企业数据 | OCIX + Gateway | 无（本轨也不做） |

用户目标：在 **fork 的 openchamber + opencode** 中增加 **与 CodePilot 功能对等** 的 widget 轨，且 **不与 OCIX 融合、不参与 API 调用**。

### 1.2 为何不复用现有轨

| 现有轨 | 为何不适合 |
|---|---|
| Declarative `interactive_ui` | 平台原语，不是 free-form HTML |
| HTML Artifact | envelope + materialize + 默认禁 CDN/script 分级；流式与 Claude 味相反 |
| OCIX | 企业信任与 Gateway；与临时可视化正交 |
| MCP Apps | 第三方 `ui://` App 协议 |

并轨只会拖累两边合同。正确做法是 **第五条对话 UI 轨**。

### 1.3 能力分层（接入后）

```text
1. Generative Widget   ← 本计划（CodePilot/Claude 同款）
2. Agent Declarative   ← interactive_ui
3. HTML Artifact       ← 严格隔离文档
4. OCIX Installed      ← 企业扩展 + Gateway
5. MCP Apps            ← 第三方 App host
```

意图路由（产品文案 / agent routing 提示应遵守）：

- 「画流程图 / 示意 / 可交互图表 / 计算器」→ Generative Widget  
- 「结构化运营看板（平台组件）」→ Declarative  
- 「真实 CRM / 写回」→ OCIX  
- 「tldraw 类第三方 App」→ MCP Apps  

---

## 2. CodePilot 源码分析

### 2.1 模块地图

| 职责 | 上游路径 | 本仓库参考副本 |
|---|---|---|
| iframe 宿主 | `src/components/chat/WidgetRenderer.tsx` | `references/.../src/WidgetRenderer.tsx` |
| 错误边界 | `WidgetErrorBoundary.tsx` | 同名 |
| 清理 + receiver srcdoc | `src/lib/widget-sanitizer.ts` | 同名 |
| CSS 变量 + utilities | `src/lib/widget-css-bridge.ts` | 同名 |
| 提示词 / 指南 | `src/lib/widget-guidelines.ts` | 同名 |
| 解析 / 持久渲染 | `MessageItem.tsx`（`parseAllShowWidgets`） | `MessageItem.full.tsx` + `excerpts/parse-and-partial.ts` |
| 流式渲染 | `StreamingMessage.tsx` | `StreamingMessage.full.tsx` + excerpt |
| 钻取桥 | `ChatView.tsx` `__widgetSendMessage` | `excerpts/ChatView-widgetSendMessage.tsx` |
| 架构说明 | `docs/handover/generative-ui.md` | `docs/generative-ui.md` |
| UX 文章 | `docs/generative-ui-article.md` | 同名 |

上游完整说明：参考副本 `docs/generative-ui.md`。

### 2.2 端到端数据流

```text
用户消息
  → 服务端组装 system：WIDGET_WIRE_FORMAT + WIDGET_SYSTEM_PROMPT
  → （关键词命中时）再加载 diagram/chart/interactive 等 guidelines
  → 模型输出 assistant text delta（含 ```show-widget ...）

流式 UI：
  content 变化
    → 检测 show-widget 标记
    → 未闭合：before 文本照常 markdown；partial widget_code → WidgetRenderer(isStreaming)
    → 已闭合：parseAllShowWidgets → 交替 text | widget | malformed

WidgetRenderer：
  mount → buildReceiverSrcdoc(CSP + receiver + CSS bridge) → iframe
  ready → isStreaming ? widget:update(sanitizeForStreaming) : widget:finalize(sanitizeForIframe)
  resize → 高度缓存（防 remount 跳）
  theme → MutationObserver → widget:theme
  sendMessage → 宿主发 follow-up 用户消息

持久化：
  消息 content 仍是纯文本（含围栏）→ 历史重开再 parse，无独立 blob 表
```

### 2.3 Wire format（必须与模型约定一致）

````markdown
```show-widget
{"title":"<人类可读标题>","widget_code":"<JSON 字符串形式的 HTML/SVG>"}
```
````

规则（来自 `widget-guidelines.ts`）：

1. **唯一**合法入口是 `show-widget` + **JSON**；原始 ` ```html ` 不当 widget。  
2. `widget_code` 内优先 **单引号 HTML 属性**，避免 `\"` 转义灾难。  
3. 不要 `DOCTYPE/html/head/body`；背景透明。  
4. 建议每 widget ≤ 3000 chars。  
5. 流式顺序：SVG 先 `<defs>`；HTML 先 `<style>` 再内容，`<script>` 最后。  
6. CDN 白名单：`cdnjs.cloudflare.com`、`cdn.jsdelivr.net`、`unpkg.com`、`esm.sh`。  
7. 解释性文字写在围栏 **外**；多 widget 用 **多个** 独立围栏交错。  
8. 钻取：`onclick="window.__widgetSendMessage('…')"`（≤ 500 字符，宿主限流）。

Canonical 最小 JSON 常量：`CANONICAL_SHOW_WIDGET_JSON`（参考 `widget-guidelines.ts`）。

### 2.4 安全模型（三层）

实现时必须保持语义等价：

1. **流式** `sanitizeForStreaming`  
   - 剥：`iframe/object/embed/form/meta/link/base`  
   - 剥：所有 `on*`、所有 `<script>`、`javascript:`/`data:` URL  

2. **终态** `sanitizeForIframe`  
   - 仅剥危险嵌套标签；**保留** script 与 handler（在 sandbox 内）  

3. **iframe**  
   - `sandbox="allow-scripts"`（**无** `allow-same-origin` / top-navigation / popups）  
   - CSP：`default-src 'none'; script-src 'unsafe-inline' <CDN>; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src 'none'`  
   - 链接 click → `postMessage` → 父窗口 `window.open`  
   - **禁止** fetch/XHR/WebSocket（无业务 API）

### 2.5 Receiver 协议（postMessage）

| 方向 | type | 含义 |
|---|---|---|
| iframe → parent | `widget:ready` | receiver 就绪（另用 `iframe.onload` 兜底） |
| parent → iframe | `widget:update` | 流式 HTML（无 script） |
| parent → iframe | `widget:finalize` | 终态 HTML；分离 script 后执行；visual 相同则跳过 DOM 替换 |
| iframe → parent | `widget:resize` | `{ height, first? }` |
| parent → iframe | `widget:theme` | `{ vars, isDark }` |
| iframe → parent | `widget:link` | 外链 |
| iframe → parent | `widget:sendMessage` | 钻取追问 |
| iframe → parent | `widget:publish` | 跨 widget（v1.1 可选） |
| iframe 内 | `window.__widgetSendMessage` / `__widgetPublish` | 由 receiver 注入 |

Receiver 构建：`buildReceiverSrcdoc`（`widget-sanitizer.ts`）。

### 2.6 UX 清单（实现时逐项对照）

详见参考 `docs/generative-ui-article.md` 与 `docs/generative-ui.md`「UX 优化清单」。摘要：

| 问题 | 修复要点 |
|---|---|
| 围栏出现时前文消失 | 无完整 fence 时直接渲染 before 文本 |
| 高度从 0 跳 | 首次 resize 禁用 transition；模块级 height cache |
| finalize 闪烁 | visual HTML 相同则不换 DOM；height lock |
| remount 滚动回跳 | cache key = widgetCode 前 200 字符 |
| script 源码露出来 | partial 截断未闭合 `<script>` + shimmer |
| ready 竞态 | `onLoad` 兜底 |
| React remount | 稳定 `key=w-N`；overlay 不改变组件树类型 |

### 2.7 CodePilot 有意不在 v1 移植的部分

| 模块 | 说明 |
|---|---|
| Dashboard pin MCP | 项目级看板持久化；独立产品，二期 |
| Buddy hatch 特殊消息 | CodePilot 产品彩蛋 |
| Sandpack | 文件预览，非对话 widget |
| `codepilot_load_widget_guidelines` MCP tool | 可改为 OpenCode Skill / 关键词注入长指南 |

---

## 3. OpenChamber / OpenCode 现状接入点

### 3.1 消息渲染（OpenChamber UI）

```text
OpenCode Session / SSE
  → packages/ui sync
  → MessageBody.tsx
  → part.type === "text"
  → AssistantTextPart.tsx
  → MarkdownRenderer
```

关键文件：

- `packages/ui/src/components/chat/message/MessageBody.tsx`（约 1869、1930 行挂载 `AssistantTextPart`）  
- `packages/ui/src/components/chat/message/parts/AssistantTextPart.tsx`（**主改点**：在 `MarkdownRenderer` 前分支）  
- 已有 `parseGeneratedJsonResult` 先例：在 finalize 时解析特殊文本形态 → 专用 UI（同一文件 78–88 行）。Widget 应用 **同类策略**，但要覆盖 **streaming**。

### 3.2 提示组装（OpenCode fork）

- `opencode/packages/opencode/src/session/system.ts` — system 块组装（含 MCP instructions）  
- `session/prompt.ts` / `session/instruction.ts` — instructions 合并  
- `config/config.ts` — `instructions` 数组合并  

**最小侵入**：追加一段固定 `GENERATIVE_WIDGET` system 片段；长指南用 skill 或按关键词 `prompt_append`。

### 3.3 已有轨勿混用的目录

- `packages/ui/src/lib/interactive-ui/**` — Declarative / Artifact / MCP App / OCIX client  
- `packages/ui/src/components/interactive-ui/**` — 同上 UI  
- `packages/web/server/lib/interactive-ui/**` — Artifact materialize、OCIX  

新代码使用 **`generative-widget`** 命名空间（见 §4）。

---

## 4. 目标架构

### 4.1 包结构（实现时创建）

```text
packages/ui/src/lib/generative-widget/
  parseShowWidget.ts       # 从 excerpts/parse-and-partial 重写
  sanitizer.ts             # 对照 widget-sanitizer 重写
  cssBridge.ts             # 对照 widget-css-bridge；token 映射到 OC 主题
  guidelines.ts            # wire format + 短 system 文案（可从 guidelines 改写）
  heightCache.ts
  index.ts

packages/ui/src/components/chat/generative-widget/
  WidgetRenderer.tsx
  WidgetErrorBoundary.tsx
  MalformedWidgetNotice.tsx
  AssistantTextWithWidgets.tsx   # 可选：从 AssistantTextPart 抽出

# OpenCode / managed config（二选一或组合）
opencode 或 openchamber managed instructions:
  generative-widget-capability.md   # 短 wire format + 规则
  skills/generative-widget-guidelines/SKILL.md  # 可选长指南
```

### 4.2 运行时流（目标）

```text
OpenCode 注入 generative-widget system 片段
  → 模型 text part 含 show-widget
  → AssistantTextPart：
       streaming → partial parse + WidgetRenderer(isStreaming)
       finalized → parseAllShowWidgets + WidgetRenderer(finalize)
  → Chat 容器注册 sendMessage 桥（限长 + 限流）
  → 无服务端 materialize；无 Gateway
```

### 4.3 配置

| 配置项 | 建议 |
|---|---|
| `generativeWidget.enabled` | 默认 `true`（Desktop/Web）；可在 Settings 关闭 |
| Bridge / 无 iframe 渠道 | 强制 off 或降级为「显示源码围栏」 |
| CDN | v1 与 CodePilot 相同白名单；企业可后续 vendor |

### 4.4 主题映射

CodePilot 将 Anthropic 变量映射到宿主 OKLCH。OpenChamber 应对齐现有 CSS 变量（`--background`、`--foreground`、`--muted`、`--border`、`--chart-1..5`、status tokens 等），**保持 widget 作者侧变量名不变**（`--color-background-primary` 等），以便模型复用 Claude/CodePilot 指南。

实现参考：`references/.../src/widget-css-bridge.ts` 的 `WIDGET_CSS_BRIDGE` + `WIDGET_UTILITIES` + `resolveThemeVars`。

---

## 5. 实施步骤（按 Phase 执行）

### Phase 0 — Spike（不接模型）

**目标**：本地 fixture 证明 receiver + 安全 + 高度 + Chart.js。

1. 新建 `lib/generative-widget` + `components/chat/generative-widget`。  
2. 对照参考重写 `sanitizer` / `cssBridge` / `WidgetRenderer` / `ErrorBoundary`。  
3. Story / 临时 demo 页或单测：  
   - 纯 SVG widget  
   - 含 Chart.js CDN 的 widget  
   - 恶意 `<script>` 在 streaming 时不可执行  
   - finalize 后交互可用  
   - `connect-src` 下 fetch 失败  

**完成标准**：人工确认卡片主题融合、无控制台 CSP 误杀白名单 CDN。

### Phase 1 — 对话 text 接入

1. 实现 `parseShowWidget.ts`（对照 `excerpts/parse-and-partial.ts`）。  
2. 改 `AssistantTextPart.tsx`：  
   - 检测 `show-widget` 标记；  
   - streaming：partial 路径；  
   - finalized：`parseAllShowWidgets` 分段渲染 Markdown + Widget。  
3. 注意与现有 `parseGeneratedJsonResult` 的优先级：  
   - **若含 show-widget，优先 widget 分段**；不要被 JSON card 吞掉。  
4. 单元测试：  
   - 合法 JSON 围栏  
   - 畸形围栏 → Malformed notice  
   - 多 widget 交错  
   - partial 未闭合 script 截断  

**完成标准**：用 fixture 文本注入 message store 可在真实 Chat 里看到 widget。

### Phase 2 — 模型会生成

1. OpenCode fork / managed instructions 注入：  
   - `WIDGET_WIRE_FORMAT_SPEC` + 精简 `WIDGET_SYSTEM_PROMPT`（去掉 codepilot 专有 tool 名，改为 OpenChamber 表述）。  
2. 可选：Skill `generative-widget-guidelines`，description 含可视化关键词。  
3. 真会话验收用例见 §7。  

**完成标准**：不手动灌文本，模型自主输出可渲染 widget。

### Phase 3 — 体验与桥

1. 高度缓存、finalize 锁高、稳定 key、shimmer。  
2. Chat 级 `sendMessage` 桥（对照 ChatView excerpt：type check、trim、≤500、2s 限流）。  
3. 链接外开；主题 `MutationObserver`。  
4. Settings 开关 + locale 字符串（`locale-ui-patterns`）。  
5. 移动端基础可用性（可降级）。  

### Phase 4 — 可选（CodePilot 扩展，非对话核心）

- Pin 到 Workbench / 侧栏（仍无 API，只存 HTML 快照）  
- 导出 PNG  
- 跨 widget publish  

**默认不纳入「功能完全一样」的 v1 门禁**，除非产品明确要求。

---

## 6. 文件级改动清单（实现 checklist）

### 6.1 新建（OpenChamber）

- [ ] `packages/ui/src/lib/generative-widget/parseShowWidget.ts`  
- [ ] `packages/ui/src/lib/generative-widget/sanitizer.ts`  
- [ ] `packages/ui/src/lib/generative-widget/cssBridge.ts`  
- [ ] `packages/ui/src/lib/generative-widget/guidelines.ts`  
- [ ] `packages/ui/src/lib/generative-widget/heightCache.ts`  
- [ ] `packages/ui/src/lib/generative-widget/index.ts`  
- [ ] `packages/ui/src/components/chat/generative-widget/WidgetRenderer.tsx`  
- [ ] `packages/ui/src/components/chat/generative-widget/WidgetErrorBoundary.tsx`  
- [ ] `packages/ui/src/components/chat/generative-widget/MalformedWidgetNotice.tsx`  
- [ ] 对应 `*.test.ts(x)`  

### 6.2 修改（OpenChamber）

- [ ] `AssistantTextPart.tsx` — 分支渲染  
- [ ] Chat 容器 / session 发送路径 — `sendMessage` 桥  
- [ ] Settings（可选）— enable 开关  
- [ ] i18n 文案  

### 6.3 OpenCode fork / managed runtime

- [ ] system 或 instructions 注入 wire format + capability  
- [ ] （可选）skill 长指南  
- [ ] **禁止** 新 business tool  

### 6.4 明确不改

- [ ] OCIX package schema / Gateway  
- [ ] HTML Artifact materialize API  
- [ ] MCP Apps host  
- [ ] OpenCode Part 类型定义  

---

## 7. 验收标准

### 7.1 功能（对齐 CodePilot 对话 widget）

| # | 场景 | 期望 |
|---|---|---|
| A1 | 「用示意图解释 LLM 训练流程」 | 出现 SVG/HTML widget，非仅 markdown 列表 |
| A2 | 「做一个可拖动滑块的贷款利息计算器」 | finalize 后滑块改变显示；无网络 API |
| A3 | 流式生成过程中 | 看到渐进预览；不应整段 script 当文本刷出 |
| A4 | 一条回复多 widget + 中间说明文字 | 交错正确 |
| A5 | 畸形围栏 | Malformed 提示，聊天不崩 |
| A6 | 刷新/重开历史会话 | widget 仍可渲染 |
| A7 | 点击 drill-down | 发出用户 follow-up（限流生效） |
| A8 | 主题切换 | widget 颜色跟随 |
| A9 | 关闭 feature flag | 退化为普通代码块或原始 fence 文本 |
| A10 | 与 OCIX CRM 同会话 | OCIX 路径不变；widget 不调用 Gateway |

### 7.2 安全

| # | 检查 |
|---|---|
| S1 | iframe 无 `allow-same-origin` |
| S2 | `connect-src 'none'` 下 `fetch` 失败 |
| S3 | 流式阶段无 script 执行 |
| S4 | 嵌套 iframe/object 被剥 |

### 7.3 回归

- Declarative `interactive_ui`、HTML Artifact、MCP App、OCIX pin 既有用例不回归。  
- `AssistantTextPart` 的 `GeneratedJsonResultCard` 路径在无 show-widget 时仍工作。

---

## 8. 提示词改写要点（OpenCode 侧）

从参考 `widget-guidelines.ts` 改写时：

1. 删除 `codepilot_*` tool 名。  
2. 钻取仍描述 `window.__widgetSendMessage`（由 **OpenChamber 宿主**注入，不是 OpenCode tool）。  
3. 保留 wire format 与 14 条 required rules 的语义。  
4. 长模块指南（diagram/chart/…）可拆 skill，避免每轮烧 token。  
5. 关键词门控可参考 `WIDGET_KEYWORDS`（中英可视化词）。

---

## 9. 许可证与合规

| 项 | 要求 |
|---|---|
| 参考目录 | `docs/references/codepilot-generative-widget/**` 仅供学习 |
| 产品代码 | 新写在 `packages/ui/.../generative-widget` |
| 归因 | 文档可写 “behavior inspired by CodePilot generative UI architecture” |
| 不要 | 把 BSL 源文件打进 npm 发布物或 Electron asar 当运行时模块 |

---

## 10. 风险与决策记录

| 风险 | 缓解 |
|---|---|
| CDN 企业网络不可达 | Settings：strict offline（仅 SVG/无 CDN）；或后续 vendor Chart.js |
| 模型乱输出 raw HTML fence | system 强调 ONLY show-widget JSON；malformed UI 引导重试 |
| 与 HTML Artifact 用户混淆 | 文档与 UI 文案称 **Generative Widget**；不出现在 OCIX 安装页 |
| fork 合并冲突 | OpenCode 仅 instruction 文本；逻辑在 OpenChamber UI |
| Mobile iframe 高度 | Phase 3 专项；可先 Desktop |

### 已锁定决策

1. **围栏触发，不 tool 触发**（保流式与 Claude 味）。  
2. **独立轨，不并 OCIX/Artifact**。  
3. **无业务 API**（`connect-src 'none'`）。  
4. **持久化 = text 内围栏**（无 materialize 目录）。  
5. **参考源码进 docs/references，实现必须重写**。

---

## 11. 参考索引

| 资源 | 路径 |
|---|---|
| 本计划 | `docs/GENERATIVE_WIDGET_CODEPILOT_PORT_PLAN.md` |
| 参考树说明 | `docs/references/codepilot-generative-widget/README.md` |
| 来源与许可 | `docs/references/codepilot-generative-widget/SOURCE_PROVENANCE.md` |
| 上游架构笔记 | `.../docs/generative-ui.md` |
| 上游 UX 文章 | `.../docs/generative-ui-article.md` |
| 解析 excerpt | `.../excerpts/parse-and-partial.ts` |
| 流式 excerpt | `.../excerpts/StreamingMessage-widget-branch.tsx` |
| 钻取桥 excerpt | `.../excerpts/ChatView-widgetSendMessage.tsx` |
| 既有 Codex/Artifact 调研 | `docs/CHATGPT_CODEX_DESKTOP_ARTIFACT_REVERSE_ENGINEERING.md` |
| 既有 Interactive UI 总方案 | `docs/AI_SDK_INTERACTIVE_UI_AND_MCP_APPS.md` |

### 上游完整文件（副本）

| 文件 | 行数量级 |
|---|---|
| `src/WidgetRenderer.tsx` | ~320 |
| `src/widget-sanitizer.ts` | ~270 |
| `src/widget-css-bridge.ts` | ~550 |
| `src/widget-guidelines.ts` | ~380 |
| `src/MessageItem.full.tsx` | ~1200 |
| `src/StreamingMessage.full.tsx` | ~650 |

---

## 12. 建议实现顺序（复制给执行 Agent）

```text
1. Phase 0: 重写 sanitizer + WidgetRenderer + cssBridge；fixture 测试
2. Phase 1: parseShowWidget + AssistantTextPart 接入 + unit tests
3. Phase 2: OpenCode/instructions 注入 + 真模型会话验收 A1–A4
4. Phase 3: UX 清单 + sendMessage 桥 + Settings + A5–A10 / S1–S4
5. 更新本文状态为 Implemented；补充 release evidence 链接
```

**完成定义**：§7 表格全部通过，且 OCIX/Artifact/MCP App 无回归；参考目录仍未被 import 进运行时。
