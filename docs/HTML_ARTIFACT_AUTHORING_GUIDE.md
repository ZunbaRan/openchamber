# OpenChamber HTML Artifact 编写手册

> 状态：Developer Preview  
> 适用协议：`openchamber://html-artifact-result/v1`  
> 安全与 Runtime 决策：[HTML Artifact Runtime ADR](./HTML_ARTIFACT_RUNTIME_ADR.md)

## 1. 什么时候使用

HTML Artifact 是 Agent 在对话流中临时生成的、自包含 UI 文档。它用于标准 Interactive UI 组件无法合理表达的任务，例如：

- 自定义 SVG 拓扑、几何图或领域专用图形；
- 参数驱动的本地模拟器；
- 关系、网络或空间探索器；
- 不适合固化成 OCIX 企业模块的一次性可视化。

选择顺序必须是：

```text
已安装业务 Tool / MCP
  → Generated Declarative interactive_ui
  → HTML Artifact
```

以下场景不要使用 Artifact：

- CRM、ERP、审批、订单等真实企业查询或写操作；
- 需要 Token、Connector、Business Gateway、Tool、MCP 或文件系统；
- metric、chart、table、flow、timeline、comparison、git-graph 等标准组件已经足够；
- 用户明确要求网站、可下载 HTML 工程或长期托管页面。

## 2. 输出合同

Tool 必须返回单个 JSON 对象，不要使用 Markdown 代码围栏：

```json
{
  "$schema": "openchamber://html-artifact-result/v1",
  "schemaVersion": 1,
  "title": "学习率模拟器",
  "summary": "使用模拟数据；拖动滑块观察曲线变化。",
  "html": "<!doctype html><html>...</html>",
  "capabilities": { "scripts": true },
  "display": {
    "preferred": "inline",
    "allowExpand": true,
    "inlineHeight": 420
  }
}
```

约束：

- Envelope 最大 256 KiB，`html` 最大 192 KiB；
- `title` 最大 120 字符，`summary` 最大 500 字符；
- `inlineHeight` 为 120–900 的整数；
- `preferred` 只允许 `inline`、`workspace`、`fullscreen`；
- 所有 CSS、SVG、图片 data URI 与可选脚本都在一个 HTML 字符串中；
- 未知字段会被拒绝，不存在“Host 自动忽略”的扩展字段。

## 3. Static 与 scripts

优先使用 `scripts: false`。Static Artifact 使用空 iframe sandbox，没有脚本权限，适合图解、拓扑和复杂 SVG。

只有本地交互确实必要时才使用 `scripts: true`。当前 scripts 能力：

- 默认关闭，必须由 `OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS=true` 明确开启；
- capability API 报告 `scriptsMode: "experimental"`；
- Host iframe 仅获得 `allow-scripts`；受信 Broker 再把 Artifact 装入 opaque `data:` 子 frame。浏览器攻击矩阵已经证明 form、nested frame、download、self-navigation、meta refresh 与脚本网络 API 不会产生目标请求；Artifact 仍没有 same-origin、网络、表单、弹窗或 Host 权限；
- 在 Web 与当前 Desktop iframe 中不能保证独立终止恶意无限循环，因此不能描述为生产安全脚本环境。

如果 Runtime 没有开启 scripts，Host 返回明确 unsupported。Agent 应改做 Static Artifact 或 Generated Declarative，不能悄悄删掉脚本后返回一个失效页面。

## 4. 视觉与主题合同

### 4.1 透明与响应式

- `html`、`body` 与最外层页面 shell 使用透明背景；Artifact Host 已经绘制统一 surface 与边框，不再绘制第二个整页边框或白色画布；
- 只有内部具有独立语义的控制区、图表区或节点可以使用 `--ocix-surface-muted` / `--ocix-surface-subtle`，禁止硬编码 `white`、`#fff` 等页面底色；
- 宽度使用 `width: 100%`、Grid/Flex、`viewBox` 和 `auto-fit/minmax`；
- 不使用 `100vw` 或固定桌面宽度；
- 390 px 内容宽度下不得出现页面级横向滚动；复杂图表可在自己的局部容器滚动；
- 触控目标至少约 36 px，正文避免小于 12 px。

### 4.2 Scripts Artifact Token

Host 在 `host.init` 中注入只读语义 Token。常用项：

```css
--ocix-surface
--ocix-surface-muted
--ocix-surface-subtle
--ocix-foreground
--ocix-muted-foreground
--ocix-border
--ocix-primary
--ocix-primary-foreground
--ocix-focus-ring
--ocix-success / --ocix-warning / --ocix-error / --ocix-info
--ocix-*-background / --ocix-*-border
--ocix-chart-1 ... --ocix-chart-5
```

Artifact 必须为 Token 提供首帧 fallback，Host 注入后由 document element 的 inline style 覆盖：

```css
:root {
  color-scheme: light dark;
  --ocix-surface: #ffffff;
  --ocix-foreground: #171717;
  --ocix-border: #d4d4d4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ocix-surface: #1c1b1b;
    --ocix-foreground: #f3f1ef;
    --ocix-border: #45413e;
  }
}
```

### 4.3 Static Artifact 主题

Static Artifact 没有 Bridge，因此不能依赖 Host 注入 Token。它必须使用 `color-scheme` 与 `prefers-color-scheme` 提供完整 light/dark fallback。宿主会把当前 `color-scheme` 传给 iframe，使媒体查询与宿主模式一致。

不要只写 `var(--ocix-surface, #fff)`：Static 文档中没有该 Token 时会永远使用白色，导致暗色对话中出现突兀白块。

Static 文档不能包含页面链接。所有非 fragment 的 `href`/`xlink:href` 都会在 materialize 阶段拒绝；`#fragment` 仅用于同文档定位或 SVG `<use>`。需要打开外链时必须使用通过安全门禁的 Scripts Runtime 与 `artifact.openExternal`，由 Host 在近期用户操作后决定是否执行。

### 4.4 可复制的 Static 起点

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --ocix-surface-subtle: #f7f7f8;
      --ocix-foreground: #171717;
      --ocix-muted-foreground: #666;
      --ocix-border: #d4d4d4;
      --ocix-primary: #4263c7;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ocix-surface-subtle: #29282a;
        --ocix-foreground: #f3f1ef;
        --ocix-muted-foreground: #b7b2ae;
        --ocix-border: #555057;
        --ocix-primary: #9cb4ff;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: transparent; color: var(--ocix-foreground); }
    main { padding: 16px; }
    .visual { border-radius: 10px; background: var(--ocix-surface-subtle); }
    .hint { color: var(--ocix-muted-foreground); }
    @media (max-width: 480px) { main { padding: 12px; } }
  </style>
</head>
<body>
  <main>
    <h1>Artifact 标题</h1>
    <p class="hint">数据来源或“模拟数据”声明</p>
    <svg class="visual" viewBox="0 0 640 240" role="img" aria-labelledby="title desc">
      <title id="title">可视化名称</title>
      <desc id="desc">用文字解释图中的关键关系。</desc>
    </svg>
  </main>
</body>
</html>
```

将完整 Result Envelope 保存为 JSON 后，可在不启动 OpenChamber 的情况下运行合同、大小、安全与 materialize 校验：

```bash
bun run validate:html-artifact -- examples/interactive-ui/static-artifact.example.json
```

仓库中的 [`examples/interactive-ui/static-artifact.example.json`](../examples/interactive-ui/static-artifact.example.json) 是一份可直接复制和修改的完整 Envelope。校验成功会输出 Artifact ID、脚本能力和最终文档大小；失败会返回稳定的错误码与不含原始 HTML 的错误摘要。

## 5. 可访问性

- 根文档设置正确 `lang`；
- SVG 使用 `<title>`、`<desc>` 与 `aria-labelledby`；
- 原生按钮、input、output 优先，不用不可聚焦的 `div` 模拟控件；
- 每个输入有 `<label for>`，动态数值使用 `<output for>`；
- 键盘 focus 使用 `:focus-visible`，不能只提供 hover；
- 状态不能只靠颜色，必须有文本、图标或形状；
- 动态筛选结果可使用克制的 `aria-live="polite"`；
- 遵守 `prefers-reduced-motion`，不要持续背景动画。

## 6. 脚本边界

允许：

- DOM 查询与本地事件处理；
- 数学计算、数组变换和 SVG path 更新；
- 自包含的筛选、折叠、拖动与模拟；
- 通过 `window.openchamberArtifact.send(...)` 请求受控 Bridge 操作。

`scripts` 是必填能力声明：完全无可执行标记的文档设为 `false`；只要 HTML 包含任何 `<script>` 或 `on*` 事件处理器，就必须设为 `true`。内置 Tool 会在返回 Envelope 前拒绝矛盾声明，避免对话文字误报“已渲染”而 Host 实际拒绝加载。

禁止：

- `fetch`、XHR、WebSocket、EventSource、Beacon；
- Worker、Service Worker、WebAssembly、`eval`、`new Function`；
- iframe、object、embed、form、popup、download、页面跳转；
- Cookie、Local Storage、IndexedDB；
- Tool、MCP、Business Gateway、Connector、Token、父页面 DOM；
- 远程脚本、样式、字体、图片或 CDN。

即使 CSP 会再次阻断这些能力，生成内容仍应在 materialize 阶段被拒绝。不要把 CSP 当作编写规范的替代品。

## 7. Narrow Bridge

脚本文档收到 `openchamber:host-init` 事件，其 `detail` 包含：

- `mode`；
- `locale`、`timezone`；
- `theme`、allowlisted `tokens`；
- `reducedMotion`。
- `viewport.width`、`viewport.height`（iframe 当前可用内容尺寸）。

Host 在 mode 或 theme 变化时重复发送 `host.init`。v1 没有独立的 `host.themeChanged` 或 `host.visibility` 消息。

可请求的 Artifact → Host 消息只有：

- `artifact.resize`；
- `artifact.copyText`；
- `artifact.openExternal`；
- `artifact.proposeFollowUp`；
- `artifact.requestExpand`；
- `artifact.reportError`。

复制、外链、follow-up 和展开还需要近期用户激活。follow-up 只填充输入框，不自动发送。

## 8. 数据声明

`summary` 和页面内必须区分：

- 用户提供的数据；
- 模型推导或估算的数据；
- 示例/模拟数据；
- 实时业务数据。

Artifact 不能自行获得实时业务数据，因此不得把模型生成数字标成“实时”“已同步”或“来自 CRM”。需要真实数据时改用 OCIX。

## 9. 固定验收 fixture

仓库提供三份确定性 fixture：

- `staticNeuralNetworkArtifact`：静态自定义 SVG；
- `learningRateSimulatorArtifact`：滑块同时更新数值与 SVG path；
- `topologyExplorerArtifact`：键盘可用的关系筛选与响应式布局。

它们位于 `examples/interactive-ui/artifact-fixtures.mjs`。`bun run test:interactive-ui` 会验证 materialize、CSP、缓存与三个 fixture。Static 的默认浏览器门禁验证空 sandbox、相对导航拒绝、CSP 阻断真实子资源请求、scripts-disabled 和进程清理。

运行确定性 Chromium 交互验收：

```bash
bun run test:html-artifact-browser
```

脚本会启动临时 loopback Artifact Server 与隔离 Chrome profile，完成断言后关闭进程并删除临时数据。非标准 Chrome 安装位置可通过 `OPENCHAMBER_TEST_CHROME` 指定。

Scripts 安全探针必须显式启用：

```bash
OPENCHAMBER_TEST_ARTIFACT_SCRIPTS=true bun run test:html-artifact-browser
```

它除了断言学习率变化后 `output` 与 SVG `d` 同时改变，还会记录真实网络请求并攻击 storage、popup、navigation、download、frame、worker、eval、Wasm 与 Bridge 边界。该命令全部通过以前，Scripts 只允许作为受控开发实验，不能作为生产验收结果。

## 10. 提交前检查

- [ ] 标准 Interactive UI 组件确实无法合理表达；
- [ ] 真实业务能力已排除或改用 OCIX；
- [ ] Envelope 严格匹配 v1，且在大小限制内；
- [ ] 默认 static；scripts 使用理由明确并标为 experimental；
- [ ] 没有网络、存储、远程资源或 Host 权限；
- [ ] light/dark、390 px、键盘与 reduced motion 可用；
- [ ] 数据来源明确；
- [ ] static/scripts CSP 与 sandbox 精确；
- [ ] 历史重建产生相同 Artifact ID；
- [ ] 交互 fixture 同时验证数据状态和图形状态。
