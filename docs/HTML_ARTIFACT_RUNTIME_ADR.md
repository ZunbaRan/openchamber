# HTML Artifact Runtime ADR

> 状态：Static v1 accepted；Scripts runtime 保持安全评审中  
> 日期：2026-07-21  
> 关联计划：[Interactive UI 视觉、HTML Artifact 与统一验收计划](./INTERACTIVE_UI_VISUAL_HTML_ARTIFACT_AND_UNIFIED_TEST_PLAN.md)

## 1. 决策摘要

OpenChamber 将 HTML Artifact 作为第三条、独立于 Declarative 与 Trusted Native 的对话内 UI 路径：

| 路径 | 输入信任级别 | 执行位置 | 允许能力 |
|---|---|---|---|
| Generated Declarative | 不可信 data-only | 宿主 allowlist renderer | 标准组件、本地展示状态 |
| Installed Declarative / Trusted Native | 已安装、签名、用户信任 | 宿主 renderer | Business Gateway、确认式操作、Host UI Kit |
| HTML Artifact | 不可信 HTML/CSS/SVG；可选 JS 仍是实验输入 | opaque-origin sandbox iframe；Scripts 需额外隔离门禁 | 临时自定义表现；本地脚本计算仅在通过能力门禁的 Runtime 开放 |

HTML Artifact 不得调用 Business Gateway、Tool、MCP、Connector 或 Secret。需要真实企业数据与写操作时必须使用已安装 OCIX 扩展。

## 2. v1 Result Contract

Artifact 使用独立、严格匹配的 Result Envelope。普通文本、Markdown、代码块或 Interactive Result 不会启用 Artifact renderer。

```json
{
  "$schema": "openchamber://html-artifact-result/v1",
  "schemaVersion": 1,
  "title": "Git 分支探索器",
  "summary": "交互查看提交与合并关系",
  "html": "<!doctype html><html>...</html>",
  "capabilities": {
    "scripts": false
  },
  "display": {
    "preferred": "inline",
    "allowExpand": true,
    "inlineHeight": 420
  },
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

合同边界：

- 整个 Result Envelope UTF-8 最大 256 KiB，`html` 最大 192 KiB。
- `title` 最大 120 字符，`summary` 最大 500 字符。
- `display.preferred` 只允许 `inline`、`workspace`、`fullscreen`。
- `display.inlineHeight` 只允许 120–900 px。
- `capabilities.scripts` 默认 `false`；请求脚本而 runtime 未启用时返回明确 unsupported，不静默改变页面语义。
- 顶层以及 `capabilities`、`display` 中的未知字段均拒绝，不把未来字段意外带入当前 runtime。
- Agent 不提供或控制 Artifact ID。服务端对规范化合同重新计算 SHA-256。

v1 只支持单一、自包含 HTML 文档。CSS、SVG、图片 data URI 与脚本必须内联；不支持 npm、动态模块、CDN、远程字体、远程图片或多文件资源表。

## 3. Materialize、存储与回放

Tool 消息中的完整 Result Envelope 是历史事实来源。页面渲染时调用：

1. `POST /api/interactive-ui/artifacts/materialize`，服务端重复验证合同；UI 通过 `X-OpenChamber-Session-ID` 传入当前会话引用。
2. 服务端对规范化 Envelope 计算 SHA-256，产生不可变 `artifactId`。
3. 内容写入 `<OPENCHAMBER_DATA_DIR>/interactive-ui/artifacts/<artifactId>/`。
4. 临时目录完整写入后原子 rename；目录为用户私有权限。
5. 相同内容命中同一 ID，不重复保存。
6. UI 使用 `GET /api/interactive-ui/artifacts/:artifactId/document` 加载专用文档。

缓存不存在时，历史消息用原 Tool output 再次 materialize，不调用模型。缓存不是消息内容的替代品。Artifact 不进入 OCIX Extension Manager、Publisher 或 Marketplace。

v1 已交付内容寻址、去重、丢失/损坏重建、用户主动清理和会话引用联动。相同 Artifact 可被多个会话引用；只有最后一个成功删除的会话释放后才删除内容。上游会话删除失败或任一无关引用索引损坏时保守保留内容，避免错误清理。全局 250 MiB LRU 仍是后续缓存治理增量；任何缓存清理都不会删除聊天消息中的 Artifact source。

缓存命中不是只相信目录名或 metadata：服务端把缓存中的完整 document 与当前 Envelope 确定性生成的 document 比较；缺失或不一致时原子重建，并通过 `cacheRebuilt` 返回恢复事实。

## 4. Sandbox 与 CSP

Artifact iframe 永不加入 `allow-same-origin`。静态页面使用空 sandbox；只有 `capabilities.scripts=true` 且 Host 明确启用实验能力时使用 `sandbox="allow-scripts"`。

明确禁止：

- forms、popups、top navigation、downloads、modals、pointer lock；
- 父页面 DOM、Cookie、Local Storage、IndexedDB；
- fetch、XHR、WebSocket、EventSource、Beacon；
- worker、service worker、nested iframe、object、embed；
- eval、`new Function`、WebAssembly 与远程资源。

所有非 fragment 的 `href`/`xlink:href` 在 materialize 阶段拒绝，避免 Static Artifact 的点击导航先发出请求再由 Host 判定 blocked。fragment 仍可用于同文档 SVG `<use>` 等本地引用。

静态 CSP：

```text
default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;
font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none';
object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none';
```

脚本实验能力不直接把不可信文档作为 Host iframe 响应。服务端先返回受信 Broker：外层响应只允许内联 Broker 脚本和一个 `data:` 子 frame，并通过 CSP `sandbox allow-scripts` 强制子页面成为 opaque origin；真正的 Artifact 文档以 base64 `data:` URL 装入内层 `sandbox="allow-scripts"` iframe，同时在文档开头注入自己的 `frame-src 'none'`、`connect-src 'none'` 等 CSP。两层都不加入 `unsafe-eval`、`wasm-unsafe-eval` 或任何网络 origin。

响应还必须设置 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、受限 `Permissions-Policy` 与 `Cache-Control: private, no-store`。

iframe sandbox 是权限隔离，不是所有 runtime 上的 CPU/内存进程隔离。因而：

- Static Artifact 在 Web/Desktop 首先可用。
- Interactive JS Artifact 按 Runtime 分级：Managed Desktop 在独立 Runner 中默认开启；普通 Web 默认关闭，只有显式实验开关才开启。
- VS Code、Mobile 与外部 OpenCode 必须通过 capability 明示 static、scripts 或 unsupported，不能弱化 sandbox 后继续运行。

2026-07-21 的端到端浏览器探针先证明：直接 sandbox iframe 即使没有 `allow-downloads`，脚本创建的下载/导航仍可能产生实际请求；CSP 中已经废弃或实现不一致的 navigation 声明不能替代行为证据。随后实现的受信 Broker + opaque `data:` 子 frame 已通过 form、nested frame、download、self-navigation、meta refresh 及脚本 API 攻击矩阵：全部攻击代码实际运行，目标服务器请求数为零，伪造 Bridge 消息被拒绝，子页面导航触发 `broker.navigationBlocked` 并被移除。2026-07-22 又在 Managed Desktop 增加独立 `WebContentsView` Runner、无 main-world API 的专用 preload、主进程 URL/权限/弹窗/请求门禁、强制 Stop、租约、并发、CPU 与内存终止。因此 Desktop Scripts 升为 supported/default-on；普通 Web 仍因缺少等价可终止边界而保持 experimental/default-off。

## 5. Narrow Host Bridge

Bridge 版本为 1，基于 `postMessage`。由于 iframe 是 opaque origin，Host 不以 `event.origin` 作为唯一凭据，而同时校验：

- `event.source === iframe.contentWindow`；
- 每次 mount 随机 channel ID；
- 固定方向、消息类型、版本与严格 payload schema；
- 单调 sequence、消息大小、每秒频率与 resize 频率。

Host → Artifact：v1 只发送 `host.init`；mode 或 theme 变化时重复发送同一严格消息。`host.visibility` 与 `host.themeChanged` 尚未进入 v1 协议。

Artifact → Host：`artifact.ready`、`artifact.resize`、`artifact.copyText`、`artifact.openExternal`、`artifact.proposeFollowUp`、`artifact.requestExpand`、`artifact.reportError`。

v1 不存在 `callTool`、`businessQuery`、`businessAction`、`getToken`、文件读写或剪贴板读取。复制、打开链接、展开和填入 follow-up 还要经过 Host 的用户激活与协议校验；follow-up 只填入输入框，不自动发送。

## 6. 显示与失败语义

- Artifact 默认嵌入对话流；workspace/fullscreen 是同一 revision 的显示模式。
- Host 使用同一个 `<dialog>` 容器：inline 时以非 modal 形式参与消息布局，workspace/fullscreen 时把同一节点提升到浏览器 Top Layer。不得通过复制或重建 iframe 来绕过聊天区的 `overflow`/stacking context，否则交互状态和历史语义会漂移。
- Managed Desktop 的 `WebContentsView` 不继承 DOM 的 overflow/stacking context，普通父 `View` 也不会提供等价于 CSS `overflow:hidden` 的子 View 裁剪。Host 必须计算执行面与 viewport、滚动容器和其它裁剪祖先的可见交集；主进程把 `WebContentsView` 本身限制在该交集内，可信 Broker 则让内部 Artifact iframe 保持完整执行面尺寸，并按裁掉的距离做负偏移。Broker 应用布局并回执后才能显示原生 View；裁剪产生的 viewport 高度不得通过 `artifact.resize` 回写为内容高度。完全滚出时隐藏 Runner，不能把负坐标钳制为 0 后让其覆盖标题栏、侧栏或输入区。
- 标题、来源、错误、重试与展开控件由 Host 绘制，Artifact 不能覆盖。
- inline 高度限制在 120–900 px。Bridge 不可用时使用合同中的 `inlineHeight`。
- CSP、materialize、加载或 Bridge 失败时保留 title/summary 和原始 Tool output fallback。
- 历史消息不重新调用模型；相同 Envelope 产生相同 Artifact ID。

## 7. Feature Flags 与紧急关闭

- `OPENCHAMBER_HTML_ARTIFACTS_STATIC`：默认开启；设为 `0`/`false` 时 materialize 返回 unsupported。
- `OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS`：Managed Desktop 默认开启并可设为 `0`/`false` 紧急关闭；Web 默认关闭，只有明确设为 `1`/`true` 才允许脚本 Envelope。

Capability API 在 Managed Desktop Runner 可用且开关未关闭时返回 `scriptsMode: "supported"`；Web 显式开启时只返回 `"experimental"`；关闭时返回 `"unsupported"`。Runtime 不能用 Web iframe 的结果冒充 Desktop 独立终止证据。

两个开关独立。发现脚本稳定性或安全问题时可以立即关闭 scripts，而保留 static Artifact 与全部 Declarative/OCIX 能力。

## 8. 验收约束

实现必须证明：严格协议不误激活；内容寻址、缓存丢失/损坏重建和会话引用清理成立；URL token 只对白名单 document GET 生效；Static CSP、空 sandbox 与导航源校验使实际未授权请求数为零；失败时普通 Tool output 仍可见。Scripts 只有在真实请求计数、Bridge 攻击和独立终止三项同时通过后才允许升级。统一 E2E 再验证 inline/workspace/fullscreen、主题与 locale、历史回放、跨模型路由和多 runtime 降级。
