# MCP Apps 客户端主机开发指南

> 快照日期：2026-08-05。区分事实陈述（✅ 官方规范事实）、仓库事实（📦 本仓库代码验证）与建议（💡）。

## 目录

1. [2026-07-28 MCP 协议](#1-2026-07-28-mcp-协议)
2. [资源发现、调用与解析](#2-资源发现调用与解析)
3. [OpenChamber ↔ OpenCode ↔ MCP 服务器边界](#3-openchamber--opencode--mcp-服务器边界)
4. [MIME 与 8 MiB 字节验证](#4-mime-与-8-mib-字节验证)
5. [受信 Broker + 不透明 App 沙箱拓扑](#5-受信-broker--不透明-app-沙箱拓扑)
6. [Excalidraw CSP 继承事后分析](#6-excalidraw-csp-继承事后分析)
7. [MCP 线缆兼容性：现代 2026 适配器与旧版 SDK 回退](#7-mcp-线缆兼容性现代-2026-适配器与旧版-sdk-回退)
8. [将 OpenCode CLI 打包到 Electron](#8-将-opencode-cli-打包到-electron)
9. [测试金字塔](#9-测试金字塔)
10. [发布清单](#10-发布清单)
11. [参考资料](#11-参考资料)

---

## 1. 2026-07-28 MCP 协议

### 1.1 Streamable HTTP 传输（✅ 官方规范事实）

MCP 2026-07-28 支持两种传输：**Streamable HTTP**（`POST /mcp`）和 **stdio**。以下描述 Streamable HTTP 路径：

```http
POST /mcp HTTP/1.1
Host: mcp.example.com
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search
```

关键头部（✅）：
- `MCP-Protocol-Version`：宣告客户端/服务端协商的协议版本。
- `Mcp-Method`：逻辑方法名（如 `tools/call`、`tools/list`、`server/discover`）。
- `Mcp-Name`：**仅用于命名操作**，镜像 `params.name` 或 `params.uri`。典型使用：`tools/call`（工具名）、`resources/read`（资源 URI）、`prompts/get`（提示名）。`server/discover` **不使用** `Mcp-Name`，且该头部从不携带服务器身份。扩展方法可定义等效语义。

参考：https://modelcontextprotocol.io/specification/draft/basic/transports

**2026 年移除的特性**（✅）：
- `initialize` / `initialized` 握手已完全删除。
- `Mcp-Session-Id` 头部已删除。2026 协议为无状态请求-响应模型：每个请求自包含，无会话生命周期。
- 不存在 `GET /.well-known/mcp` 端点；服务器发现通过 `server/discover` JSON-RPC 方法完成。
- 不存在 `annotations.mcpApp` 字段。Apps 通过 MCP Apps 扩展（2026-01-26）的 `_meta.ui` 键声明，独立于核心线缆协议版本。

### 1.2 服务端发现 (`server/discover`)（✅ 官方规范事实）

```json
// 请求——params._meta 携带必需的协议/能力，以及建议提供的客户端身份
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "opencode",
        "version": "1.18.10"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}

// 响应——服务端身份在 result._meta 的命名空间键中
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "supportedVersions": ["2026-07-28"],
    "capabilities": {
      "tools": {},
      "resources": {}
    },
    "resultType": "complete",
    "ttlMs": 300000,
    "cacheScope": "public",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "excalidraw-mcp-server",
        "version": "2.1.0"
      }
    }
  }
}
```

关键字段（✅）：
- `params._meta`：`io.modelcontextprotocol/protocolVersion` 和 `io.modelcontextprotocol/clientCapabilities` 是必需的每请求信封。`io.modelcontextprotocol/clientInfo` 为 **SHOULD**（推荐但非强制）。
- 参考：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- `supportedVersions`：服务端支持的协议版本列表。
- `capabilities`：服务端能力声明。
- `resultType`：固定为 `"complete"`。
- `ttlMs` / `cacheScope`：缓存策略。官方示例使用 `"public"` 作用域。
- `result._meta["io.modelcontextprotocol/serverInfo"]`：服务端身份在响应的命名空间 `_meta` 键中，不在顶层 `serverInfo`。

### 1.3 每请求信封与 Apps 元数据边界（✅ 官方规范事实）

MCP 2026 核心协议要求 `_meta` 使用**命名空间键**（如 `io.modelcontextprotocol/protocolVersion`）。`protocolVersion` 和 `clientCapabilities` 是必需的；`clientInfo` 为 SHOULD。上例的空 `{}` 表示客户端尚未声明核心扩展能力；不要把服务端的 `tools` / `resources` 能力结构复制到客户端能力中。

这与 MCP Apps 扩展（2026-01-26）的 `_meta.ui` 是不同的层级，且 Apps 扩展的 `_meta.ui` 又分为两层：
- **Tool 定义级 `_meta.ui`**：标准字段为 `resourceUri`、`visibility`，位于 Tool 声明的 `_meta` 中。本仓库还发送 `preferred.maxHeight` 作为预标准时代的宿主兼容提示；它不是 Apps 2026-01-26 的稳定标准字段，其他宿主可以忽略。
- **资源内容级 `_meta.ui`**：`csp`、`permissions`、`prefersBorder`、`domain`。在 `resources/read` 返回内容的 `_meta` 中，不在 Tool 定义中。

核心协议不存在独立的 `annotations` 命名空间。Apps 扩展（2026-01-26 规范）通过上述两层 `_meta.ui` 声明 UI 关联。

---

## 2. 资源发现、调用与解析

### 2.1 整体请求流（📦 仓库事实）

```
OpenChamber UI                              ─┐
  │ McpAppRenderer / mcpApp.ts               │ 主机级验证、沙箱、CSP
  │ 调用 opencodeClient.getMcpAppResource()  │
  ↓                                          ─┘
OpenCode 本地 HTTP API                       ─┐
  │ packages/ui/src/lib/opencode/client.ts    │ HTTP 客户端（非 MCP 传输）
  │ → OpenCode 内部 HTTP 路由                │
  ↓                                          ─┘
OpenCode Core                                ─┐
  │ packages/opencode/src/mcp/               │
  │ connection-adapter.ts: 现代 2026 / 旧版  │
  │ app.ts: _meta.ui 提取、8 MiB 上限        │
  │ POST /mcp → MCP 服务器                   │
  ↓                                          ─┘
MCP 服务器 (远程或本地)                      ─┐
  响应 → OpenCode → OpenChamber              │
```

**方向**：OpenChamber UI → 本地 OpenCode HTTP API → 远程/本地 MCP 服务器。
OpenChamber 从不直接调用 MCP 服务器。

### 2.2 嵌套 `_meta.ui.resourceUri` 与弃用扁平键（📦 仓库事实）

MCP Tool 定义上使用 `_meta.ui` 声明 MCP App 关联：

```json
{
  "name": "excalidraw_create_diagram",
  "_meta": {
    "ui": {
      "resourceUri": "ui://excalidraw/editor.html",
      "visibility": ["model", "app"]
    }
  }
}
```

`csp` 不属于 Tool 元数据。它随 `resources/read` 返回的资源内容声明：

```json
{
  "uri": "ui://excalidraw/editor.html",
  "mimeType": "text/html;profile=mcp-app",
  "text": "<!doctype html>...",
  "_meta": {
    "ui": {
      "csp": {
        "resourceDomains": ["https://esm.sh"],
        "connectDomains": ["https://esm.sh"]
      }
    }
  }
}
```

**键路径规则**（📦 OpenCode `packages/opencode/src/mcp/app.ts`）：
- ✅ `_meta.ui.resourceUri`（嵌套键）是权威来源。
- ⚠️ 弃用扁平键 `_meta["ui/resourceUri"]` 为向后兼容保留。OpenCode 先检查嵌套键，缺失时回退到扁平键。
- 这是 MCP Tool 定义级别的键，与 OpenChamber 内部的持久化绑定元数据（`binding.resourceUri` / `binding.meta.resourceUri`）是不同的概念。

### 2.3 OpenChamber 内部绑定一致性检查（📦 仓库事实）

OpenChamber 在 `parseMcpAppBinding()` 中执行独立的一致性验证：

```typescript
// packages/ui/src/lib/interactive-ui/mcpApp.ts
const resourceUri = typeof app.resourceUri === 'string' ? app.resourceUri : '';
const meta = record(app.meta);
// ...
if (meta.resourceUri !== undefined && meta.resourceUri !== resourceUri) return null;
```

这是 OpenChamber 持久化信封（`McpAppResultEnvelope`）内部的验证，确保 `binding.resourceUri` 与 `binding.meta.resourceUri` 一致。不要与 MCP Tool 定义上的 `_meta.ui.resourceUri` 键混淆。

### 2.4 MCP 变量 API（✅ 官方规范事实）

`app.RESOURCE_URI_META_KEY` 的值指向 `_meta.ui.resourceUri`：
- URL: `https://apps.extensions.modelcontextprotocol.io/api/variables/app.RESOURCE_URI_META_KEY.html`

---

## 3. OpenChamber ↔ OpenCode ↔ MCP 服务器边界

### 3.1 责任划分（📦 仓库事实）

| 层 | 位置 | 职责 |
|---|---|---|
| **MCP 传输/发现** | `packages/opencode/src/mcp/connection-adapter.ts`、`index.ts` | 现代 2026 适配器、旧版 SDK 回退、发现、目录、资源、工具调用 |
| **Apps 元数据** | `packages/opencode/src/mcp/app.ts` | `_meta.ui` 提取、嵌套+弃用扁平 resourceUri、8 MiB 字节上限 (`MAX_RESOURCE_BYTES`) |
| **OpenCode HTTP 路由** | OpenCode 内部路由 | 向 OpenChamber 暴露上述能力的 HTTP API |
| **OpenChamber 客户端** | `packages/ui/src/lib/opencode/client.ts` | 本地 OpenCode 的 HTTP 客户端（`@opencode-ai/sdk/v2`），不是 MCP 传输层 |
| **MCP App 主机** | `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx` | 沙箱拓扑、CSP 策略、AppBridge 生命周期、Loader 握手 |
| **运行时状态/验证** | `packages/ui/src/lib/interactive-ui/mcpApp.ts` | CSP 标准化、元数据验证、状态机、规范化函数 |

### 3.2 关键边界（📦 仓库事实）

```typescript
// OpenChamber → 本地 OpenCode HTTP API（不是 MCP 传输）
const raw = await opencodeClient.getMcpAppResource({
  directory, sessionId, messageId, partId,
  server: envelope.binding.server,
  resourceUri: envelope.binding.resourceUri,
  toolKey: envelope.binding.toolKey,
  signal, force: attempt > 0,
});

// OpenChamber 主机验证（AUD-004）
const cspVerdict = validateMcpAppCspMetadata(
  loaded.meta?.csp ?? envelope.binding.meta.csp,
);
if (!cspVerdict.ok) {
  recordFailure('csp-metadata-missing', `resource CSP metadata ${cspVerdict.detail}`);
  return; // 失败关闭→绝不挂载
}

// 构建已验证的文档策略（两层 CSP）
const appPolicy = buildMcpAppDocumentPolicy(envelope.binding.meta, resource);
const appHtml = injectMcpAppResourceCsp(resource.html, appPolicy);
const brokerPolicy = buildMcpAppBrokerCsp(resource.meta?.csp ?? envelope.binding.meta.csp);
```

### 3.3 AppBridge SDK 类型（📦 仓库事实）

```typescript
// @modelcontextprotocol/ext-apps/app-bridge
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

// 生命周期：
// 1. new AppBridge(null, hostInfo, hostCapabilities, { hostContext })
// 2. bridge.connect(transport) → Promise<void>
// 3. bridge.oninitialized 回调（App 发送标准 ui/notifications/initialized 后触发）
// 4. bridge.sendToolInput / sendToolResult / sendToolCancelled
// 5. 就绪 = initialized + 初始 Tool 数据送达成功，见 3.4（无首绘证据门禁）
```

### 3.4 协议就绪生命周期：无首绘证据门禁（📦 仓库事实）

真实打包 Computer Use 验收发现：官方 Excalidraw App 的可见画布渲染正确，4 秒后却
被宿主替换成 “MCP App unavailable / initialized but shows no visible content”。
旧宿主在 AppBridge initialized 之外还要求三种**可选的 / 专有的**证据才进入
`ready`：`ui/notifications/size-changed`（含可见高度阈值）、broker
`layout-visible`、以及 OpenChamber 私有 model-context payload
（`openchamberContentReady` + `renderedSemanticElementCount`）。协议合规的第三方
App 一项都不需要发：`size-changed` 是可选布局信息（`autoResize: false` 只关闭
自动上报，SDK 缺省 `autoResize: true` 才会用 ResizeObserver 自动发送；App 仍可
手动调用 `sendSizeChanged`，合规 App 也可能完全不发送任何 `size-changed` 通知），
`update-model-context` 是可选模型上下文，不透明沙箱外不存在通用的“首绘/像素/
语义”证明。

协议对齐的就绪定义（运行时 `ready` 阶段）：

```text
ui/notifications/initialized（标准 App 初始化通知）
  → delivering-tool-data：flush 已排队的初始 Tool input/result
  → 初始送达 flush 成功（idle/input/result）→ ready
    （只由本次 AppBridge 的 oninitialized 初始送达路径授予，且必须通过该
    bridge effect 的 hasActiveAuthority 校验：!disposed + initialized +
    当前 binding epoch）
  → flush 返回 cancelled → 保留既有 teardown，永不 ready
  → flush 被拒绝 / 协议违规 → 既有 protocol-violation 失败路径，永不 ready
```

- `McpAppRuntimePhase` 在 `waiting-app-bridge` 与 `ready` 之间只有
  `delivering-tool-data`；`waiting-first-paint` 已删除；
- 异步完成必须经过宿主既有 ownership/activity guard（binding epoch、bridge 活跃、
  未 teardown），stale / unmounted / rebound 的迟到结果不推进 ready；迟到拒绝
  也不能使替换中的 bridge 失效；后续 envelope/status 变化触发的普通 flush 只处理
  取消/违规，本身不再授予 ready；
- `ui/notifications/size-changed` 继续驱动 inline 高度（size-based inline-height
  行为保留），但不再是就绪证据；broker `layout-visible` 只是可选诊断 telemetry；
- 可选的 model-context 持久化保留：所有 `ui/update-model-context` 请求都通过共享
  的 update handler（`applyMcpAppModelContextUpdate`）落盘，tldraw 的
  `openchamberContentReady` / `renderedSemanticElementCount` payload 与其它快照
  一样持久化，不带任何就绪门禁；
- 已退役且无兼容回退：`waiting-first-paint`、`ready-but-blank`、
  `MCP_APP_READY_BLANK_DEADLINE_MS`、`McpAppFirstPaintEvidence`、
  `mcpAppFirstPaintVerdict`、`isMcpAppContentReadyUpdate`。

回归：`McpAppRenderer.test.ts` / `mcpApp.test.ts` 用 Excalidraw 风格 standards-only
App 建模（初始化 + 成功送达、无 size-change / 专有 model context → ready 并保持；
送达失败 → fail-closed，绝不假 ready）。

---

## 4. MIME 与 8 MiB 字节验证

### 4.1 权威字节上限（📦 OpenCode 仓库事实）

OpenCode 在 `packages/opencode/src/mcp/app.ts` 中定义权威字节上限：

```typescript
// packages/opencode/src/mcp/app.ts
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024; // 8 MiB
```

OpenChamber 渲染器/Loader 使用相同的数值作为**字符数防御边界**，但它不是第二个
8 MiB 字节权威：

```typescript
// packages/ui/src/components/interactive-ui/McpAppRenderer.tsx
const MCP_APP_MAX_HTML_LENGTH = 8 * 1024 * 1024; // 8 MiB (字符数)
const MCP_APP_MAX_IDENTITY_LENGTH = 16 * 1024;    // 16 KiB
const MCP_APP_LOADER_CHUNK_LENGTH = 256 * 1024;   // 256 KiB 分块
```

### 4.2 拒绝策略（📦 仓库事实）

**绝不截断**：UTF-8 资源超过 8 MiB 时由 OpenCode 的 `MAX_RESOURCE_BYTES` 权威拒绝。
OpenChamber 随后还拒绝超过 8,388,608 个 JavaScript 字符单元的 HTML
（`invalid-app-html`），Loader 则把最坏 UTF-8 传输预算限制为字符上限的 4 倍。
正常链路中 OpenCode 的 8 MiB 字节门先执行；宿主字符门是纵深防御，不能描述成
“OpenChamber 也执行相同的 8 MiB 字节限制”。不存在“截断后渲染”路径。

### 4.3 Loader 分块传输验证（📦 仓库事实）

```javascript
// createMcpAppLoaderDocument 生成的 Loader 脚本
const maxHtml = 8388608;      // 8,388,608 个 JavaScript 字符单元
const maxBytes = maxHtml * 4; // UTF-8 最坏情况传输预算 32 MiB

// begin 阶段：totalBytes 上限验证
if (!Number.isSafeInteger(data.totalBytes) || data.totalBytes > maxBytes) {
  invalidate("invalid-transfer-begin");
}
```

---

## 5. 受信 Broker + 不透明 App 沙箱拓扑

### 5.1 拓扑结构（📦 仓库事实）

```
┌─────────────────────────────────────────────┐
│ OpenChamber React Host (trusted origin)     │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Broker iframe                         │  │
│  │ src: data:text/html;base64,...        │  │
│  │ sandbox: allow-scripts allow-same-origin│
│  │ (opaque origin)                       │  │
│  │                                       │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │ App iframe                      │  │  │
│  │  │ srcdoc: <!doctype html>...      │  │  │
│  │  │ sandbox: allow-scripts          │  │  │
│  │  │ (opaque origin, NO same-origin) │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 5.2 沙箱属性策略（📦 仓库事实）

```typescript
// App 沙箱：允许脚本，禁止 same-origin（强制唯一不透明源）
export const MCP_APP_OPAQUE_DOCUMENT_SANDBOX = 'allow-scripts';

// Broker 沙箱：允许脚本 + same-origin（Broker 通过 postMessage 与 Host 通信）
export const MCP_APP_SANDBOX_PROXY_SANDBOX = 'allow-scripts allow-same-origin';
```

### 5.3 握手协议（📦 仓库事实）

```
Broker 启动
  → broker.booted (postMessage → parent)
  → sandbox-proxy-ready (JSON-RPC 通知 → parent)

Host 收到 sandbox-proxy-ready
  → sandbox-resource-ready (JSON-RPC 通知，携带 App HTML + sandbox + openchamber nonce/identity)

Broker 收到 sandbox-resource-ready
  → 创建 App iframe (src=Loader URL)
  → Loader 验证分块传输
  → App HTML → srcdoc
  → broker.ready

Host 收到 broker.ready
  → host.listening
  → AppBridge 连接开始
```

### 5.4 导航吊销（📦 仓库事实）

```javascript
// createMcpAppBrokerDocument 内 Broker 脚本
app.addEventListener("load", () => {
  loadCount += 1;
  if (appLoaded) {
    invalidate("navigation"); // 第二次 load = 未授权导航
    return;
  }
  // ...
});
```

Host 端监控额外的 load：

```typescript
const handleLoad = () => {
  if (phase === 'ready') {
    close('navigation'); // 就绪后的任何导航都是侵入
    return;
  }
};
```

### 5.5 权限策略（📦 仓库事实）

```typescript
// 不透明沙箱源无法安全使用摄像头/麦克风/地理位置 → 始终关闭
export const resolveMcpAppIframeAllowAttribute = (
  permissions: McpAppResultEnvelope['binding']['meta']['permissions'] | undefined,
): undefined => {
  void permissions;
  return undefined;
};
```

---

## 6. Excalidraw CSP 继承事后分析

### 6.1 问题描述（📦 仓库事实）

官方 Excalidraw 资源元数据完整到达 OpenChamber：

```json
{
  "_meta": {
    "ui": {
      "csp": {
        "resourceDomains": ["https://esm.sh"],
        "connectDomains": ["https://esm.sh"]
      }
    }
  }
}
```

App 以 `about:srcdoc` 形式嵌套在受信 Broker iframe 之下。原实现中 `createMcpAppBrokerDocument(channelNonce)` 硬编码了严格离线 CSP（仅 `data:` / `blob:` 方案，无远程源）。Chromium 将 Broker 的策略容器**继承/交集**到嵌套的 `about:srcdoc` App 中。App 自身 CSP 声明了 `https://esm.sh`，但 Broker CSP 没有。交集结果：esm.sh 被阻止。

### 6.2 根因（📦 仓库事实）

```
Broker CSP:        script-src 'unsafe-inline'  (无 https://esm.sh)
App srcdoc CSP:    script-src 'self' https://esm.sh 'unsafe-inline'
                          ↓
有效 CSP（交集）:   script-src 'unsafe-inline'
                          ↓
esm.sh 脚本/CSS/字体被 Chromium 阻止 ❌
```

### 6.3 修复方案（📦 仓库事实）

创建 `buildMcpAppBrokerCsp()` 函数，接收已验证的 CSP 元数据，返回**品牌化类型** `McpAppBrokerPolicy`。只有此函数可以产生该类型，`createMcpAppBrokerDocument` 只接受此类型（不接受原始字符串）：

```typescript
// packages/ui/src/components/interactive-ui/McpAppRenderer.tsx

// 品牌化类型——只有 buildMcpAppBrokerCsp 可产生
declare const MCP_APP_BROKER_POLICY_BRAND: unique symbol;
export type McpAppBrokerPolicy = string & { [MCP_APP_BROKER_POLICY_BRAND]: true };

export const buildMcpAppBrokerCsp = (
  policy: NonNullable<McpAppResource['meta']>['csp'] | undefined,
): McpAppBrokerPolicy => {
  // 缺失/无效 → STRICT_DEFAULTS（无远程源、无无界通配符/裸 *）
  if (!policy) return STRICT_DEFAULTS;

  // 标准化：resourceDomains → script/style/img/font/media-src
  //         connectDomains → connect-src
  //         frameDomains → frame-src (绝不与 'none' 组合)
  const resourceSources = normalizeSources(policy.resourceDomains);
  const networkSources = normalizeConnectSources(policy.connectDomains);
  const rawFrameSources = normalizeSources(policy.frameDomains);
  const rawBaseSources = normalizeSources(policy.baseUriDomains);

  if (
    resourceSources.length === 0
    && networkSources.length === 0
    && rawFrameSources.length === 0
    && rawBaseSources.length === 0
  ) {
    return STRICT_DEFAULTS; // 全部无效 → 严格离线
  }

  // frame-src 始终含 data: blob: (Broker 自身 Loader 需要)
  // 有 frameDomains 时追加，无 frameDomains 时不追加 'none'
  // baseUriDomains 有效时镜像到 base-uri；未显式声明时使用 'self'
  // 缺失或全部无效的元数据仍走上面的 STRICT_DEFAULTS（base-uri 'none'）
  return [...].join('; ') as McpAppBrokerPolicy;
};

export const createMcpAppBrokerDocument = (
  channelNonce: string,
  brokerCspPolicy?: McpAppBrokerPolicy, // 品牌化类型，非原始 string
) => { /* ... */ };
```

### 6.4 Broker 文档 URL 延迟计算（📦 仓库事实）

`sandboxProxyDocumentUrl` 在资源加载前返回 `null`，布局效应守卫检查其存在：

```typescript
// McpAppRenderer 组件内部
const sandboxProxyDocumentUrl = React.useMemo(
  () => {
    if (!resource) return null; // 资源加载前 → null
    const effectiveCsp = resource.meta?.csp ?? envelope.binding.meta.csp;
    return createMcpAppOpaqueDocumentUrl(
      createMcpAppBrokerDocument(channelNonce, buildMcpAppBrokerCsp(effectiveCsp)),
    );
  },
  [channelNonce, resource, envelope.binding.meta.csp],
);

// 布局效应守卫
if (!frame || !target || !resource || !appDocument || !sandboxProxyDocumentUrl) return;
```

**关键约束**（📦 仓库事实）：
- ✅ 无 `esm.sh` 硬编码、无无界通配符/裸 `*`；Broker 不信任 App 自带策略作为唯一安全边界
- ✅ 不削弱沙箱/nonce/source/message/navigation 规则
- ✅ 缺失/无效元数据 → 严格离线默认
- ✅ `frame-src` 绝不将 `'none'` 与 `data:`、`blob:` 或声明的 frameDomains 组合
- ✅ Broker CSP 仅通过品牌化 `McpAppBrokerPolicy` 类型进入 `createMcpAppBrokerDocument`

---

## 7. MCP 线缆兼容性：三层独立设计

### 7.1 三层架构（📦 OpenCode 仓库事实）

OpenCode 通过 `packages/opencode/src/mcp/connection-adapter.ts` 和 `index.ts` 管理三层独立的兼容性：

| 层 | 规范版本 | 关注点 |
|---|---|---|
| **核心线缆** | 2026-07-28 vs 旧版 | 传输方式（无状态请求 vs initialize 握手）、HTTP 头（MCP-Protocol-Version；旧版有状态 Streamable HTTP 可选 Mcp-Session-Id）、发现（server/discover vs initialize 能力协商） |
| **MCP Apps 扩展** | 2026-01-26 | Tool `_meta.ui` 结构（嵌套 `_meta.ui.resourceUri`、弃用扁平 `_meta["ui/resourceUri"]`）、CSP 元数据、权限 |
| **OpenChamber 持久化信封** | OpenChamber 内部 | `binding.resourceUri` / `binding.meta.resourceUri` 一致性检查、`McpAppResultEnvelope` 结构兼容 |

### 7.2 核心线缆兼容性矩阵（📦 仓库事实 + 💡 建议）

| 特性 | 旧版 SDK | 现代 2026-07-28 |
|---|---|---|
| **传输** | `initialize`/`initialized` 握手；Streamable HTTP 服务端可选签发 `Mcp-Session-Id`，stdio 无此 HTTP 头 | 无状态请求，无初始化会话 |
| **发现** | 隐式（initialize 响应中） | 显式 `server/discover`，带 `ttlMs`/`cacheScope` |
| **头部** | 仅 HTTP 传输适用；有状态 Streamable HTTP 可选 `Mcp-Session-Id` | HTTP 端点使用 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` |
| **缓存** | 无 | `ttlMs` / `cacheScope` |
| **适配器位置** | `packages/opencode/src/mcp/connection-adapter.ts` | 同上（优先现代 2026-07-28，回退旧版） |

### 7.3 MCP Apps 扩展兼容性（📦 仓库事实）

Apps 扩展使用独立的 2026-01-26 规范版本。Tool `_meta.ui` 的标准字段包含
`resourceUri`/`visibility`；资源内容 `_meta.ui` 包含
`csp`/`permissions`/`prefersBorder`/`domain`。本仓库的 `preferred.maxHeight` 只是
预标准兼容提示，不应作为通用 Apps 合同。扩展通过核心线缆协商后独立启用，
不依赖核心线缆版本：
- 现代 2026 线缆与旧版线缆均使用相同的 `_meta.ui` 结构。
- OpenCode 的 `app.ts` 先检查嵌套键，缺失时回退到扁平键——与核心线缆版本无关。

**重要**：不要将嵌套 `_meta.ui` 仅归属于核心 2026 线缆，也不要假设旧版线缆使用不同的"元数据广告"机制——Apps 扩展的 `_meta.ui` 结构是独立的。

### 7.4 推荐（💡 建议）

- **服务器端**：旧版 2025-11-25 Streamable HTTP 同样使用 `/mcp`（通过 `initialize` 握手后），而 HTTP+SSE（`/sse`）是更早的传统传输。推荐实现显式的现代/旧版适配器（如 OpenCode 的 `connection-adapter.ts`），对运营有用的场景可选择性地提供分离端点。
- **适配器边界**：保持 `connection-adapter.ts` 中现代/旧版适配器的显式边界，使未来弃用旧版路径时不需重构。

---

## 8. 将 OpenCode CLI 打包到 Electron

### 8.1 真实打包流程（📦 仓库事实）

OpenChamber Electron 使用 `packages/electron/scripts/prepare-opencode-cli.mjs` 下载并验证 OpenCode CLI 二进制文件：

```bash
# 从锁定文件下载托管的 OpenCode CLI（版本/架构/哈希均已锁定）
bun run prepare:opencode-cli

# 验证分阶段的 CLI
bun run verify:opencode-cli

# 验证运行时 CLI
bun run verify:opencode-cli:runtime

# 验证打包后的 CLI
bun run verify:opencode-cli:packaged
```

### 8.2 锁定文件结构（📦 仓库事实，2026-08-04 快照）

`packages/electron/opencode-cli.lock.json` 的字段说明（实际值以仓库当前文件为准）：

```jsonc
{
  "schema": "com.openchamber.opencode-cli-lock.v1",  // 锁定文件格式版本
  "repository": "ZunbaRan/opencode",                  // 上游仓库
  "releaseTag": "v1.18.10-oc.1",                      // 发布标签
  "version": "1.18.10-oc.1",                          // 语义版本
  "upstreamCommit": "...",                             // 上游提交 SHA
  "forkCommit": "...",                                 // Fork 提交 SHA
  "sdk": {
    "package": "@zunbaran/opencode-sdk",              // 配套 SDK 包名
    "version": "1.18.10-oc.1",                        // SDK 版本
    "sha256": "..."                                    // SDK 完整性哈希
  },
  "artifacts": {
    "darwin-arm64": {
      "file": "opencode-darwin-arm64.zip",
      "url": "https://github.com/.../releases/download/...",
      "sha256": "..."                                 // 分平台 SHA256
    }
    // darwin-x64, windows-arm64, windows-x64, linux-arm64, linux-x64
  }
}
```

> 快照时实际值：`version` = `1.18.10-oc.1`，`releaseTag` = `v1.18.10-oc.1`。

> **当前交付边界（2026-08-04）**：仓库锁中的 `forkCommit` 仍是
> `bf12c7a79358ae763733d6e67de93af5d6715226`，而本轮通过测试的 OpenCode
> 源码提交是 `67c454892fe47ed1906b41250a1eff4e499b0801`。本轮成功构建的 arm64
> Electron 包明确使用了下节的 `local-override`，因此它是开发验收包，不是托管发布
> 候选；该候选在 prepare 时显式设置了 `OPENCODE_FORK_COMMIT`，所以 staged
> `distribution.json` 的 `forkCommit` 直接报告 `67c454892fe47ed1906b41250a1eff4e499b0801`（见 8.4 样例）。若不设置覆盖变量，常规打包仍会下载 lock 所指向的旧制品。正式发布前必须从
> `67c454892fe47ed1906b41250a1eff4e499b0801` 构建并发布新的 CLI/SDK 版本，生成六个平台制品哈希，更新 lock 的
> `version`、`releaseTag`、`forkCommit`、SDK 哈希和平台哈希，再用**无 override**
> 的常规路径重打包。仅修改 lock 中的 commit 字段会伪造 provenance，禁止这样做。

### 8.3 本地覆盖（📦 仓库事实）

通过环境变量 `OPENCHAMBER_OPENCODE_CLI_PATH` 使用本地构建的 OpenCode 二进制：

```bash
OPENCHAMBER_OPENCODE_CLI_PATH=/path/to/local/opencode bun run prepare:opencode-cli
```

`prepare-opencode-cli.mjs` 的本地覆盖分支会检测此环境变量，读取二进制的真实版本，复制它而非从 GitHub 下载，并在 `resources/opencode-cli/distribution.json` 中标记 `"localOverride": true`。本地覆盖时 `forkCommit` 只有在 **`OPENCODE_FORK_COMMIT` 未设置**时才默认写为 `"local-uncommitted"`；显式设置 `OPENCODE_FORK_COMMIT` 时，prepare 把该值原样写入 `distribution.json`（本轮候选显式提供了 `OPENCODE_FORK_COMMIT=67c454892fe47ed1906b41250a1eff4e499b0801`，因而 `distribution.json` 直接报告该精确 SHA）。未显式设置时精确源码 commit 必须**独立记录**：从 OpenCode 源码 worktree（如 `git rev-parse HEAD`）或该次构建的 provenance 取，作为与 CLI 版本并列的证据，不能从 `distribution.json` 推断。不要依赖固定行号；以该分支和分发清单为准。

验证器也必须区分两种真相来源：托管发布以 `opencode-cli.lock.json` 为准；本地覆盖以刚生成的 `distribution.json` 为准。如果运行时校验仍无条件拿 lock 中的 `forkCommit` 与本地二进制比较，它会在**正确打入新 fork** 时反而误报旧提交不匹配。可靠做法是先解析 staged `distribution.json`，校验签名前二进制 SHA-256，再用 `version` / `upstreamCommit` 核对 `/global/capabilities`；本地覆盖且**未设置** `OPENCODE_FORK_COMMIT` 时，`distribution.json` 的 `forkCommit` 是 `"local-uncommitted"`，不参与对比，精确源码 commit 必须从源码 worktree / 构建 provenance 独立记录（显式设置 `OPENCODE_FORK_COMMIT` 时则直接与 `distribution.json` 记录的精确 SHA 核对）。这不是放宽门禁，而是让门禁绑定到本次实际分发物。

macOS 包还有第二层边界：`electron-builder` / `codesign` 会给嵌套 Mach-O 写入签名，因此 `.app` 内 CLI 的字节 SHA-256 可能与签名前 `distribution.json.sha256` 不同。发布校验应拆成两段：

1. **签名前来源完整性**：staged CLI 必须精确匹配 `distribution.json.sha256`；
2. **签名后包完整性**：验证 App/嵌套 CLI 的代码签名，另记签名后 SHA；实际启动包内 CLI，再用 `/global/capabilities` 核对 version/upstream/fork，并检查内置 Tool。

不要因为签名后哈希变化就跳过校验，也不要把签名前哈希误称为包内最终文件哈希。本次 arm64 包的运行时核验确认 `1.18.10-oc.1`、upstream `e024e2ef…`、fork `67c454892fe47ed1906b41250a1eff4e499b0801`，并发现 `html_artifact` / `interactive_ui` 两个内置 Tool。

### 8.4 分发清单（📦 仓库事实）

`resources/opencode-cli/distribution.json` 由 prepare 脚本生成。托管发布模式会记录锁文件中的 `releaseTag` / `forkCommit`；本地覆盖模式会明确记录 `releaseTag: "local-override"`、`localOverride: true`。`forkCommit` 只有在 **`OPENCODE_FORK_COMMIT` 未设置**时才默认写为 `"local-uncommitted"`；本轮候选显式设置了 `OPENCODE_FORK_COMMIT`，因此实际 `distribution.json` 直接报告精确源码 SHA：

```json
{
  "schema": "com.openchamber.opencode-cli-lock.v1",
  "repository": "ZunbaRan/opencode",
  "releaseTag": "local-override",
  "version": "1.18.10-oc.1",
  "upstreamCommit": "e024e2ef92293a81a06b6cc418422c52207ce85d",
  "forkCommit": "67c454892fe47ed1906b41250a1eff4e499b0801",
  "target": "darwin-arm64",
  "sha256": "fa86f2271100b57a522d0aa6d25ee75132381cb09c867c2258bec35a304b3d80",
  "localOverride": true
}
```

> 注意：上面的 `forkCommit` 是显式 `OPENCODE_FORK_COMMIT` 写入的真实值，等于本轮
> OpenCode 源码 worktree 的 `git rev-parse HEAD`。若**未设置** `OPENCODE_FORK_COMMIT`，
> 本地覆盖模式会把 `forkCommit` 写为 `"local-uncommitted"`，此时精确源码 commit 必须
> 从 OpenCode 源码 worktree / 构建 provenance 独立记录（如 `git rev-parse HEAD`），
> 并作为与 `distribution.json` 并列的证据保存。

### 8.5 重要说明（📦 仓库事实）

- **对 OpenCode 源码的修改在构建二进制前无效**。仅编辑 `../opencode` 中的源文件不会改变打包的 CLI。必须先用 `bun run build` 构建二进制，然后通过 `OPENCHAMBER_OPENCODE_CLI_PATH` 指向或以 `prepare:opencode-cli` 重新打包。
- `package.json` 中不存在对 `../opencode` 的文件依赖或 SDK 的 `file:` 引用——CLI 作为独立二进制分发。

### 8.6 自包含验收必须固定运行路径并验证 /health 实际解析结果（📦 仓库事实）

浏览器自包含门禁 `scripts/run-tldraw-mcp-app-browser-acceptance.mjs` 过去不显式传
CLI：orchestrator 会把所有 `OPENCODE_*` / `OPENCHAMBER_*` 从继承环境剥离，demo
服务器因此在 PATH 上找到 `~/.opencode/bin/opencode`（官方 `1.18.4`）。该 CLI 能连接
Tool，却不协商 MCP Apps capability，协商门禁最终超时（“OpenChamber MCP 2026 Apps
negotiation did not become ready”），且存在假绿/假红两种风险：fork 源码已改，但
OpenChamber/测试根本没跑那个 fork。

修复后的选择规则（`scripts/lib/tldraw-mcp-app-browser-orchestration.mjs`）：

1. 显式变量 `OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH` 优先；
2. 缺省用 staged CLI `packages/electron/resources/opencode-cli/opencode`；
3. `realpath` 规范化后必须是可执行文件，否则在任何 spawn 之前失败并给出可操作提示；
4. **绝不回退** PATH / `~/.opencode` / 其他已安装 CLI（fail-closed）；
5. 选择结果以 `OPENCODE_BINARY=<canonical path>` 显式传入 demo 子进程；
6. `/health` 就绪时校验 `opencodeBinaryResolved` 等于所选 canonical 路径，不匹配立即
   fatal，不轮询到超时；
7. orchestration 报告与日志记录 source / requested / resolved / `--version` 身份证据。
8. demo 子进程注入隔离的 `OPENCODE_CONFIG_CONTENT`：恰好一个 remote MCP server
   `interop-tldraw-2026`（`type: remote`、`oauth: false`、`timeout: 30000`、
   `enabled: true`），URL 指向本次启动的 tldraw MCP；门禁不读取用户/项目配置，
   也不依赖 demo 消费未使用的环境变量；协商出现明确的永久错误状态时立即 fatal。

```bash
# 显式固定 CLI 运行自包含浏览器门禁
OPENCHAMBER_TLDRAW_ACCEPTANCE_REPO_DIR=/path/to/tldraw-mcp-app \
OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH=/path/to/staged/opencode \
bun run test:tldraw-mcp-app-browser:self-contained
```

运行时身份证据必须与打包证据分列（见 8.3 的 staged/签名后哈希区别）：

- staged `distribution.json.sha256` 是签名前来源完整性；
- `.app` 内二进制哈希是签名后包内真实字节；在本轮 macOS electron-builder/codesign
  流程中二者不同（codesign 改写字节），其它平台/流程不一定改写，但两个哈希语义
  始终不同，必须分别记录、分别核对；
- 旧安装的 `app.asar` 可能早于源码 commit，用它做 UI 结论会产生过期证据。

四个门禁各自独立，不能互相冒充：

| 门禁 | 入口 | 证明 | 不能证明 |
|---|---|---|---|
| 协议/单元 | `node --test scripts/lib/*.test.mjs`、tldraw `verify-dist.mjs`、协议探针 | 契约与聚焦行为 | 真实浏览器可见性 |
| 独立浏览器 | `bun run test:tldraw-mcp-app-browser:self-contained`（固定 `OPENCODE_BINARY`） | 真实 Server + managed OpenCode + 浏览器 + 精确 CLI | 打包桌面环境 |
| 打包 Electron | `packages/electron/scripts/verify-packaged-interactive-ui.mjs`（断言 `opencodeBinarySource === 'bundled'`、`opencodeBinaryResolved` 等于包内路径） | 打包边界与 bundled CLI | 真实 Computer Use 交互 |
| 真实 Computer Use | 打包应用上的人工/自动化 UI 验收 | 端到端 UI 行为 | 由前三者取代 |

> **当前状态（2026-08-05）**：最终 Electron UI 验收仍为 pending；不得声称已通过。

### 8.7 自包含验收必须注册隔离项目身份（📦 仓库事实）

浏览器门禁曾出现这样的假红：tldraw inline / 历史 / locale 检查点全部通过，点击 Pin 后
却等待新 App Board tile 超时，浏览器 instrumentation 观测到点击后对
`/api/interactive-ui/workbench/*` 的请求为零。这不是 Pin API、tldraw App 或宿主渲染
bug，而是验收 harness 的环境身份 bug：

- 隔离 demo 启动时把 `settings.json` 覆盖为只含 `sessionRecapEnabled` /
  `sessionSuggestionEnabled`（`scripts/interactive-ui-demo.mjs`），没有注册 project；
- 权威 message directory 是干净集成 worktree，不属于 demo 里仅有的合成 'home' 项目；
  模块级函数 `resolveWorkbenchPinProject`（
  `packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx`，由
  `WorkbenchPinButton` 组件在渲染时调用）对与所有已注册 project 都无关的目录有意返回
  null，组件内的 `handlePin` 因此在 `projectId === null` 时于任何网络请求之前 return
  （pending 在 guard 之后才 set，按钮本身 enabled，两者均已排除）。

修复（commit `5b87cb69`）不改产品代码，而是让验收注册真实项目：

1. `deriveWorkbenchProjectId`（`scripts/lib/tldraw-mcp-app-browser-orchestration.mjs`）
   与 server `createProjectIdFromPath`（`packages/web/server/lib/projects/project-id.js`）
   和 UI `createProjectIdFromPath`（`packages/ui/src/lib/projectId.ts`）共用
   `path_<base64url(abs path)>` 归一化；verifier 也导入同一 helper，保证轮询的 board
   就是 Pin 持久化的 board；
2. `configureAcceptanceProject` 在 `/health` 就绪后、MCP 协商与浏览器 verifier 之前
   PUT `/api/config/settings`，注册恰好一个 project（`id` / `path` /
   `activeProjectId` / `lastDirectory` 全部等于验收 worktree）；
3. 对响应 fail-closed：非 2xx / 非 JSON / malformed / 额外或错配 project /
   `activeProjectId` 或 `lastDirectory` 不匹配 → 抛错终止，绝不把不完整回显当成功；
4. orchestration report 记录 `acceptanceProject` 证据。

**为什么顺序不能换**（📦 仓库事实 + 💡 建议）：

- 必须在 `/health` 之后：settings 端点由 OpenChamber server 提供，health 是 server 与
  托管 CLI 已就绪的最早可靠信号；
- 必须在 MCP 协商之前：Pin 是纯宿主侧行为，若等协商完成再注册，Pin 失败会被误归因于
  MCP 状态，回归再次落入“服务健康但 UI 无反应”的歧义；
- settings 变更必须 round-trip 校验：2xx 只证明请求被接受；server 侧 settings runtime
  会 sanitize / migrate / 合并字段
  （`packages/web/server/lib/opencode/settings-runtime.js`），必须回读响应并断言恰好
  一个 project 且四字段全部一致，任一不匹配立即 fatal。

聚焦测试覆盖 helper 归一化（尾斜杠、Windows 分隔符、空值）与
`configureAcceptanceProject` 的成功证据、非 2xx、malformed、mismatched 等失败路径；
当前 `node --test scripts/lib/*.test.mjs` 69/69 通过（acceptance 49 + orchestration 20）。

本节附带的浏览器 E2E 是**项目注册 / 环境身份修复**的修复后证据，不是最终整体验收：
2026-08-04T18-19-09-153Z 那次 run 通过全部 11 个检查点（含 Pin/App Board
fullscreen）、47 次 AppBridge 交换、零 runtime/console/page 错误、零
isError/fallback（本地示例证据目录：
`.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-04T18-19-09-153Z/`，不在仓库内）。
其后的宿主顶层遮挡 fail-closed 硬化见 8.8：**最终**的真实浏览器 E2E 以 8.8 末尾的
2026-08-04T19-23-36-871Z/browser/report.json（11/11 检查点 status 全为 pass）为准。
两次 run 是同一门禁的不同修复阶段，不可互相顶替，18-19-09 run 不得再当作最终验收。

注意：这只是验收 harness 的环境身份修复。浏览器 E2E 不能当作打包 Electron /
Computer Use 验收；打包桌面环境与真实 Computer Use 验收仍为 pending（见上表）。

### 8.8 自包含验收必须拒绝宿主顶层遮挡：host-visible screenshot gate（📦 仓库事实）

浏览器门禁还出现过一类与 8.7 并列的假阳性：真实宿主在会话上方打开顶层
`DirectoryExplorerDialog`（"Add project directory" onboarding dialog）覆盖
conversation——它在宿主合成画面里确实遮住 inline MCP App；但旧 verifier 通过
CDP/evaluate 直接进入 child iframe context 操作 DOM，绕过了宿主根 document 的
指针命中与视觉可见性，于是交互检查全部通过，用户可见 UI 却被 dialog 盖住
（“交互检查通过但用户可见 UI 被遮挡”）。修复只改验收 harness，不碰产品代码，分两个
commit：commit `451700f9` 引入/强化了真实 onboarding 检测（根 document 可见顶层
`role=dialog` 序列化 + 受支持文案身份匹配）、真实 close 按钮点击（点击匹配 dialog 的
真实渲染 `button[data-slot="dialog-close"]` 并断言成功）与根 dialog 的截图前可见性
门槛（`preScreenshotAbsent`）；commit `42571b47` 随后 fail-closed 硬化：关闭后匹配弹窗
消失 **且** 可见 `[data-slot="dialog-overlay"]` 计数归零、截图前任何无关可见顶层
dialog 都是硬失败、backdropCount 必须是非负安全整数（malformed 计数 fail-closed 而
不强转 0），并输出显式 occlusion verdict（`occlusionVerdict` pass/reasons +
`serializedPreScreenshotDialogs`）作为证据。两 commit 合并后的完整门槛把截图从装饰变成
门槛：

1. **宿主根文档可见性**：只序列化根 document 的可见顶层 `role=dialog`（排除嵌套
   dialog；App iframe 内部的 dialog 属于 child target，从不参与）。可见性用
   connected + 正 bounding rect + computed style（`display` / `visibility` / `opacity`）
   判定，不用 `offsetParent`——fixed 定位元素的 `offsetParent === null` 是已知陷阱。
   Helper：`inspectHostOnboardingDialogs`。
2. **顶层 overlay 身份与关闭门槛**：只按受支持 onboarding 文案身份匹配
   （`isProjectDirectoryOnboardingText`：`Add project directory` / `添加项目目录` /
   `新增專案目錄`）；要求真实 `button[data-slot="dialog-close"]` connected、visible、
   enabled 且正 hit rect（`assessProjectDirectoryOnboarding`）；点击匹配 dialog 的真实
   渲染按钮并断言点击成功，关闭后**同时**等待两个条件——匹配弹窗消失 **且** 可见
   `[data-slot="dialog-overlay"]` 计数归零（残留 backdrop 也是遮挡，必须 fail-closed）；
   不使用 Escape 或 React 内部状态，也不按 close-usability 掩盖遮挡。Helper：
   `dismissHostProjectDirectoryOnboarding`。
3. **iframe 双层证据 / host-visible screenshot gate**：截图门槛必须同时证明两层——
   宿主根 document 在截图时刻满足全部三个条件：无匹配的顶层 dialog
   （`preScreenshotAbsent` / `matchingOnboardingAbsent`）、可见 backdrop 计数为零
   （`preScreenshotBackdropAbsent`）、无任何可见顶层 dialog 残留
   （`preScreenshotDialogsAbsent`；纯判定 `assessHostOcclusionFree` 汇总为一个
   `occlusionVerdict`）；以及 child iframe 的 App surface 已就绪（`.acceptance-shell`
   的 `data-editor-ready` 契约与 `.tl-canvas` 正尺寸，见
   `docs/MCP_2026_APP_DEVELOPMENT_LESSONS.md` 第 12 节）。**残留 backdrop 或截图前
   任何可见宿主 dialog 都是硬失败**，失败会把序列化 host dialog 状态作为证据抛出；
   **screenshot 是门槛而非装饰**：先断言宿主侧可见性，再
   `captureVisibleContentScreenshot('inline-preview')`，不允许“先截后解释”。

聚焦测试（`scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs`，49 个用例）断言
`assessProjectDirectoryOnboarding` 对隐藏 / 零 rect / 缺失 / detached / disabled
close 全部 fail-closed；`assessHostOcclusionFree` 对残留 backdrop 与无关可见顶层
dialog 均 fail-closed；inline 检查点顺序为 route 选择 → onboarding 关闭（等待匹配弹窗
消失且 backdrop 归零）→ surface 验收 → 截图前 occlusion verdict；verifier 源码不含
`dispatchKeyEvent` / Escape / `__react`；wait 与 pre-screenshot 门只按身份和计数匹配。
当前 `node --test scripts/lib/*.test.mjs` 69/69 通过（acceptance 49 + orchestration 20）。

最新真实 E2E（单一环境证据，2026-08-05；`generatedAt=2026-08-04T19:24:42.106Z`）：
本地、未跟踪的证据文件 `.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-04T19-23-36-871Z/browser/report.json`
（`ok=true`、`requiredCheckpointOk=true`），11/11 检查点 status 全为 `pass`。
`projectDirectoryOnboarding`：status=`dismissed`、dialogCount=`1`、backdropCount=`1`、
remainingDialogs=`0`、remainingBackdropCount=`0`、remainingDialogsAbsent=`true`、
remainingBackdropAbsent=`true`、preScreenshotAbsent=`true`、preScreenshotBackdropAbsent=`true`、
preScreenshotDialogsAbsent=`true`；截图前 occlusionVerdict.pass=`true`
（reasons=`[]`、dialogCount=`0`、backdropCount=`0`）、
serializedPreScreenshotDialogs=`{dialogs:[],backdropCount:0}`。47 次 AppBridge 交换，
0 isError、0 fallback；诊断日志 matchingLines 总计 0；screenshots 共 11 张，
其中 `01-inline-preview.png` 经 root 人工检查确认无 onboarding / backdrop / 可见
顶层 dialog（人工检查证据，非普遍保证）。**这是测试原则 + OpenChamber 具体实现参考，
不是“所有宿主都一定有该弹窗”的泛化**：任何宿主顶层 overlay 都不允许覆盖首张截图。
它仍然不是打包 Electron / Computer Use 验收；打包桌面环境与真实 Computer Use 验收
仍为 pending（见 8.6 四个门禁表）。

---

## 9. 测试金字塔

### 9.1 测试层次（📦 仓库事实 + 💡 建议）

```
          ┌─────────┐
          │  E2E    │  💡 Computer Use 测试 + DevTools 控制台验证
          ├─────────┤
          │ 集成    │  📦 沙箱拓扑测试、CSP 交集测试、Broker CSP 品牌化类型测试
          ├─────────┤
          │ 单元    │  📦 buildMcpAppBrokerCsp 单元测试、CSP 标准化测试
          └─────────┘
```

### 9.2 当前单元测试（📦 仓库事实）

在**执行沙箱外**运行的测试结果（沙箱内因本地套接字绑定被拒绝而报告 EADDRINUSE）：

- **OpenCode MCP 聚焦测试套件**：在 `opencode/packages/opencode` 中一次运行 7 个 MCP / HTTP API / code-mode 测试文件 — 110 pass, 0 fail（409 次断言）。
- **OpenChamber Renderer 聚焦测试**：`bun test packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts` — 68 pass, 0 fail（464 次断言）。
- **OpenChamber 交互 UI 目录套件**：`bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui` — 179 pass, 0 fail（885 次断言）。
- **OpenChamber UI 类型检查**：`bun run --cwd packages/ui type-check` — 退出码 0。

> 注意：这是两个独立仓库的独立测试调用，非单次合并输出。发布时应重新运行下方清单，不把旧日志当作当前提交的证明。

关键测试组：

```typescript
// packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts
describe('MCP App sandbox bootstrap', () => {
  // esm.sh 回归测试
  test('includes declared resource domains in Broker CSP for the official Excalidraw esm.sh regression', ...);

  // 无元数据 → 严格离线默认
  test('falls back to strict offline Broker CSP when resource metadata is missing or invalid', ...);

  // 绝不将 'none' 与其他源组合
  test('never combines frame-src none with other sources in Broker CSP', ...);
});
```

### 9.3 执行沙箱限制说明（📦 仓库事实）

在执行沙箱（本地套接字绑定被拒绝的环境）下运行时，`Bun.serve({ port: 0 })` 可能无法绑定端口并报告 EADDRINUSE。沙箱外重新运行后，OpenCode 聚焦套件为 110/110，OpenChamber Renderer 聚焦测试为 68/68。打包的 Electron 进程不受此影响——这是测试执行环境的限制，不是 Electron 端口冲突行为。

### 9.4 Computer Use / DevTools 验收（💡 建议）

打包后验收步骤：
1. 启动打包的 Electron 应用。
2. 触发 Excalidraw（或 Tldraw）MCP App 工具调用。
3. 在 DevTools 控制台中验证：无 CSP 违规（`[Report Only]` 除外）、无 `Script error.`、AppBridge 初始化完成。
4. 验证 `ui/notifications/sandbox-proxy-ready` 和 `ui/notifications/sandbox-resource-ready` 消息已交换。
5. 验证就绪按协议对齐生命周期进行（见 3.4）：`ui/notifications/initialized` 后初始
   Tool input/result 送达成功即进入 ready 并保持；Excalidraw 这类禁用 autoResize、
   不发专有 model context 的 standards-only App 不得出现
   “MCP App unavailable / initialized but shows no visible content”，也不能在
   初始化后 4 秒被替换成错误页。

---

## 10. 发布清单

### 10.1 代码层面（📦 仓库事实）

- [ ] `buildMcpAppBrokerCsp()` 返回 `McpAppBrokerPolicy` 品牌化类型
- [ ] `createMcpAppBrokerDocument()` 接受 `McpAppBrokerPolicy`（非原始 `string`）
- [ ] `sandboxProxyDocumentUrl` 在资源加载后构建（`null` 之前）
- [ ] 布局效应守卫包括 `!sandboxProxyDocumentUrl`
- [ ] 无硬编码域名、无无界通配符/裸 `*`（有界 `https://*.example.com` 有效）
- [ ] CSP 标准化使用 `normalizeMcpAppCspSource` / `normalizeMcpAppConnectCspSource`
- [ ] `frame-src` 绝不将 `'none'` 与 `data:`、`blob:` 或声明的 frameDomains 组合

### 10.2 测试层面

- [ ] `bun test packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts` → 71 pass
- [ ] `bun test packages/ui/src/lib/interactive-ui/mcpApp.test.ts` → 26 pass
- [ ] 协议就绪回归：Excalidraw 风格 standards-only App（无 autoResize/size-change、
  无专有 model context）初始化 + 成功送达通知 → ready 并保持；送达失败 →
  fail-closed 不假 ready；ready 只由 AppBridge oninitialized 初始送达路径在
  hasActiveAuthority 校验下授予，普通 envelope/status flush 不授予
  （`waiting-first-paint` / `ready-but-blank` /
  `MCP_APP_READY_BLANK_DEADLINE_MS` / `McpAppFirstPaintEvidence` /
  `mcpAppFirstPaintVerdict` / `isMcpAppContentReadyUpdate` 已退役，无兼容回退）
- [ ] `bun run typecheck` 无错误
- [ ] `bun run dead-code` 无新增死代码
- [ ] `bun run verify:opencode-cli` 通过
- [ ] `bun run verify:opencode-cli:packaged` 通过
- [ ] 自包含浏览器门禁固定 `OPENCODE_BINARY`，并在 `/health.opencodeBinaryResolved` 不匹配时 fail-closed（`scripts/lib/tldraw-mcp-app-browser-orchestration.test.mjs` 在完整门禁前运行）
- [ ] 自包含浏览器门禁在 `/health` 后、MCP 协商前 PUT `/api/config/settings` 注册唯一验收项目，并对回显 fail-closed 校验（`deriveWorkbenchProjectId` / `configureAcceptanceProject`，聚焦测试 69/69）
- [ ] 自包含浏览器门禁在首个 inline 截图前检查宿主根 document 顶层可见 dialog：按受支持文案身份匹配并 fail-closed 关闭 `Add project directory` onboarding，关闭后同时等待匹配弹窗消失且可见 backdrop 计数归零（`inspectHostOnboardingDialogs` / `dismissHostProjectDirectoryOnboarding` / `assessProjectDirectoryOnboarding`）；截图前 `assessHostOcclusionFree` 的 occlusion verdict 要求匹配 onboarding 消失、可见 backdrop 计数为零、无任何可见顶层 dialog 残留——残留 backdrop 或任何可见宿主 dialog 都是硬失败（`preScreenshotAbsent` / `preScreenshotBackdropAbsent` / `preScreenshotDialogsAbsent`；不使用 Escape 或 React 内部状态；`node --test scripts/lib/*.test.mjs` 69/69）
- [ ] 测试入口显式生成/拷贝被 `.gitignore` 忽略的产物（如 examples / templates 的 `dist/ui.mjs`），fixture tracked / self-contained；干净 worktree 不依赖主 checkout 的历史 `dist`（见 lessons 8.5；本次仅测试环境补齐，不视为仓库自包含性已修复）
- [ ] 最终打包 Electron UI 验收（真实 Computer Use）完成（当前为 pending）
- [ ] 无 `OPENCHAMBER_OPENCODE_CLI_PATH` 时，托管 lock 的 `forkCommit`、CLI/SDK 发布版本与 `/global/capabilities` 指向同一已发布提交（当前 `bf12…` vs `67c…` 尚未满足，故当前包不可作为正式发布候选）

### 10.3 回归检查

- [ ] Tldraw/Excalidraw 等声明 `resourceDomains` 的 App 可正常加载外部资源
- [ ] 无 CSP 元数据的 App 保持离线（不获得网络访问）
- [ ] 沙箱拓扑不被削弱
- [ ] postMessage nonce 绑定不变
- [ ] 导航吊销不变

---

## 11. 参考资料

| 资源 | URL | 说明 |
|---|---|---|
| MCP 2026-07-28 发布候选博客 | https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ | 核心线缆协议变更（initialize/Mcp-Session-Id 移除，POST /mcp JSON-RPC，server/discover） |
| MCP 服务端发现规范 | https://modelcontextprotocol.io/specification/draft/server/discover | server/discover 请求/响应格式、命名空间 `_meta` 键 |
| MCP Apps 扩展规范 (2026-01-26) | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx | Apps 扩展规范（`_meta.ui` 结构、CSP、权限）——独立于核心线缆版本 |
| MCP Extensions Apps 概述 | https://modelcontextprotocol.io/extensions/apps/overview | 官方概述文档 |
| RESOURCE_URI_META_KEY 变量 | https://apps.extensions.modelcontextprotocol.io/api/variables/app.RESOURCE_URI_META_KEY.html | `_meta.ui.resourceUri` 键路径 |

### 11.1 OpenChamber 内部参考文件

| 文件 | 路径 | 说明 |
|---|---|---|
| McpAppRenderer | `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx` | 沙箱、CSP、AppBridge、Broker、Loader |
| McpAppRenderer 测试 | `packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts` | 单元测试（68 个聚焦用例） |
| mcpApp 库 | `packages/ui/src/lib/interactive-ui/mcpApp.ts` | CSP 标准化、元数据验证、状态机 |
| mcpApp 库测试 | `packages/ui/src/lib/interactive-ui/mcpApp.test.ts` | 库单元测试 |
| OpenChamber OpenCode 客户端 | `packages/ui/src/lib/opencode/client.ts` | 本地 OpenCode HTTP 客户端 |
| OpenCode MCP 适配器 | `packages/opencode/src/mcp/connection-adapter.ts` | 现代 2026 / 旧版 SDK 适配器 |
| OpenCode Apps 元数据 | `packages/opencode/src/mcp/app.ts` | `_meta.ui` 提取、`MAX_RESOURCE_BYTES` |
| Electron CLI 准备 | `packages/electron/scripts/prepare-opencode-cli.mjs` | CLI 下载/验证/本地覆盖 |
| CLI 锁定文件 | `packages/electron/opencode-cli.lock.json` | 版本、提交、SHA256 |
| App Bridge | `node_modules/@modelcontextprotocol/ext-apps/app-bridge` | MCP App Bridge 官方包 |

### 11.2 关键符号速查

```typescript
// CSP 标准化（packages/ui/src/lib/interactive-ui/mcpApp.ts）
normalizeMcpAppCspSource(value: string): string | null        // https://, data:, blob:, about:
normalizeMcpAppConnectCspSource(value: string): string | null  // https://, wss://, ws://loopback

// CSP 验证（packages/ui/src/lib/interactive-ui/mcpApp.ts）
validateMcpAppCspMetadata(value): { ok: boolean; detail?: string }

// 文档策略构建（packages/ui/src/components/interactive-ui/McpAppRenderer.tsx）
buildMcpAppDocumentPolicy(bindingMeta, resource): string       // App srcdoc CSP
buildMcpAppBrokerCsp(policy): McpAppBrokerPolicy               // Broker iframe CSP (品牌化)
injectMcpAppResourceCsp(html, policy): string                  // 将 CSP 注入 HTML

// Broker/Loader 文档（packages/ui/src/components/interactive-ui/McpAppRenderer.tsx）
createMcpAppBrokerDocument(channelNonce, brokerCspPolicy?: McpAppBrokerPolicy): string
createMcpAppLoaderDocument(channelNonce): string
createMcpAppOpaqueDocumentUrl(html): string

// 沙箱常量（packages/ui/src/components/interactive-ui/McpAppRenderer.tsx）
MCP_APP_OPAQUE_DOCUMENT_SANDBOX          // 'allow-scripts'
MCP_APP_SANDBOX_PROXY_SANDBOX            // 'allow-scripts allow-same-origin'

// 握手方法（packages/ui/src/components/interactive-ui/McpAppRenderer.tsx）
MCP_APP_SANDBOX_PROXY_READY_METHOD       // 'ui/notifications/sandbox-proxy-ready'
MCP_APP_SANDBOX_RESOURCE_READY_METHOD    // 'ui/notifications/sandbox-resource-ready'
```
