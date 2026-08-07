# OCIX Direct Remote 服务开发指南

> 状态：Remote R1–R3 已实现；本文是第三方服务端的最小可执行合同  
> 日期：2026-08-07  
> 适用：Settings → Interactive UI Extensions → Remote apps 中以 **Manifest URL + Access Key** 直接连接的第三方服务  
> 不适用：Local `.ocix`、Hosted 薄 `.ocix`、MCP Apps、Agent Generated UI

## 1. 先分清交付方式

| 方式 | 用户入口 | UI / Tool 字节 | 是否需要 `.ocix` |
|---|---|---|---|
| Local Package | 选择签名包 | 全部在包内 | 是 |
| Hosted thin package | 选择签名薄包 | 远端签名 Manifest + 资源 | 是 |
| **Direct Remote** | **Manifest URL + Access Key** | **远端签名 Manifest + 按需资源** | **否** |

Direct Remote 复用 Hosted 的签名 Manifest 内核，不是第四套 OCIX 协议。连接时 Client 只拉取并验签 Manifest；Declarative JSON、Trusted Native ESM、HTML Artifact 和图标只在第一次实际使用时按 path 拉取、校验 MIME/SHA-256，并写入进程内短 TTL 缓存。

## 2. 最小服务组成

一个可连接的 Direct Remote 服务至少提供：

```text
GET  /openchamber.remote.json       签名 Manifest；不接收业务 Access Key
GET  /resources/<version>/<file>    签名索引中的公开资源；不接收业务 Access Key
GET  /api/health                    Connector test；校验 Access Key
GET  /api/...                       业务查询；校验 Access Key
POST /api/...                       可选写操作；校验 Access Key 与 revision
```

硬约束：

1. 非 loopback 部署必须使用 HTTPS；URL 不得含 credential、query 或 fragment。
2. Manifest 和资源下载请求**不会携带业务 Access Key**。内容信任来自 Ed25519 签名与资源 hash；业务身份只在 Gateway 请求业务 API 时注入。
3. Direct Remote 当前必须恰好声明一个 `auth.type = "api-key"` Connector。零个、多个或 `issued-key` 均会拒绝连接。
4. Manifest、资源和业务 API 可以同 origin，也可以分 origin；每个 origin 必须进入对应签名权限摘要。
5. 每个发布版本使用不可变资源 URL。不要在同一个 semver 下更换 Manifest 或资源字节。

## 3. 签名 Manifest

入口文档 schema 为：

```json
{
  "$schema": "openchamber://hosted-ocix-manifest/v1",
  "app": {
    "id": "com.acme.remote",
    "version": "1.0.0",
    "publishedAt": "2026-08-07T00:00:00.000Z"
  },
  "publisher": {
    "id": "com.acme.publisher",
    "name": "Acme",
    "keyId": "release-2026",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  },
  "permissions": {},
  "extension": {},
  "resources": [],
  "update": {
    "required": false,
    "changeSummary": "Optional signed release note"
  },
  "signature": {
    "algorithm": "ed25519",
    "keyId": "release-2026",
    "value": "<base64 Ed25519 signature>"
  }
}
```

### 3.1 规范化与签名

签名前移除顶层 `signature`，对对象键递归按 Unicode/JavaScript 默认字符串顺序排序；数组保序；省略值为 `undefined` 的字段。对规范化对象执行 `JSON.stringify`，以 UTF-8 字节作为 Ed25519 消息，签名结果用标准 Base64 编码。

```js
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .flatMap((key) => value[key] === undefined ? [] : [[key, canonicalize(value[key])]]),
  )
}

const message = Buffer.from(JSON.stringify(canonicalize(unsignedManifest)))
const value = crypto.sign(null, message, privateKey).toString('base64')
```

`publisher.keyId` 必须与 `signature.keyId` 完全一致。私钥不得进入服务目录、Git、Manifest、容器镜像或测试证据；Manifest 只携带公钥。首次连接时 OpenChamber 从公钥本地派生 fingerprint，并要求用户确认。

### 3.2 资源索引

```json
{
  "path": "ui/declarative/overview.view.json",
  "url": "https://apps.example.com/releases/1.0.0/overview.view.json",
  "mimeType": "application/json",
  "sha256": "sha256-<base64 digest>"
}
```

- `sha256` 是原始响应字节的 SHA-256，再以标准 Base64 编码并加 `sha256-` 前缀。
- HTTP `Content-Type` 去掉 `charset` 后必须与 `mimeType` 一致。
- `extension.views[].entry`、`extension.artifacts[].entry` 和 `extension.icon` 必须精确命中唯一的 `resources[].path`。
- 禁止 traversal、重复 path、symlink 语义和 Host 保留命名空间（例如 `agent-runtime/`、`.openchamber*`）。
- Remote 不下发任意 OpenCode Tool/Skill 文件；Host 从经过验证的 surface/tool/routing 元数据生成受管 Tool shim。

## 4. 权限摘要必须与 Manifest 自洽

`permissions` 至少包含：

```json
{
  "resourceOrigins": ["https://apps.example.com"],
  "networkOrigins": ["https://api.example.com"],
  "externalLinkOrigins": [],
  "credentialScopes": ["orders.read"],
  "actionIds": ["com.acme.remote.orders.query"],
  "agentToolNames": ["acme_remote_open_orders"],
  "clipboard": false,
  "popups": false,
  "nativeCode": false
}
```

Client 会从 `resources`、`extension.permissions.network`、`actions`、surface Tool bindings 和 Native runtime 重新推导权限，并要求签名摘要覆盖推导结果。摘要不能少报；未使用能力也不要多报。

Trusted Native 还必须同时满足：

- `permissions.nativeCode = true`
- `extension.trust.mode = "native-code"`

Native 在 Host 页面同进程运行；签名只证明来源与完整性，不证明代码安全。

## 5. Extension 合同

Direct Remote 内嵌的 `extension` 与 Local OCIX 使用同一 `openchamber://extension/v1` schema：

- `id` / `version` 必须与 `app` 完全一致。
- `agentRouting.domain` 与 intents 使用 namespaced 标识符；业务数据使用 `connected-business-system`。
- 每个 View / Artifact 绑定全局唯一的小写下划线 Tool 名，并声明 surface routing。
- Connector base URL origin 必须在 `extension.permissions.network` 与顶层 `permissions.networkOrigins` 中。
- read action 使用 `risk: "read", permission: "allow"`；write/destructive action使用 `permission: "ask"`，并携带 revision/ETag 语义。
- Artifact 的 `capabilities.businessActions` 必须是顶层 action 子集。
- Workbench surface 使用有界 `dashboard.inputSchema`；需要实体 ID 的详情页不得伪造默认 ID。

完整 Surface 与 Gateway 合同见 [Interactive UI + HTML Artifact 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md) 和 [Connector Authentication v1](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)。

## 6. 三种 Surface 与品牌表达

| Surface | 适用 | 品牌表达边界 |
|---|---|---|
| Declarative | 指标、表格、图表、状态、标准流程 | 使用语义 tone、Host 布局与图表序列；不接受任意 CSS/颜色 |
| Trusted Native | 表单、复杂状态、协调交互 | 仅 Host React、Host UI Kit 与 `--ocix-*` token；不得自带 React/组件库或全局 CSS |
| Installed HTML Artifact | 自由 SVG/Canvas/交互探索器 | 自包含 HTML；所有颜色映射到 `--ocix-*` token；禁止 fetch/XHR/远程资产/存储 |

品牌区分应来自名称、图标、内容语言、构图与**所选择的语义 token 槽位**，不是把固定 hex/rgb 调色板注入 Host。品牌图标可以是签名资源；Surface 在 light/dark 和不同 Host 风格预设下必须保持可读。

## 7. 更新合同

| 变化 | Client 行为 |
|---|---|
| 同 key、权限相同或减少、新 semver | 可自动接受新 Manifest；资源仍按需下载 |
| 新 origin/action/tool、`nativeCode` 0→1 | 必须 re-consent；拒绝后旧合同继续可用 |
| 发布者换钥 | 使用新 `keyId`，必须确认新 fingerprint；同 `keyId` 换公钥会 fail closed |
| `update.required = true` | 无法安全应用时阻断使用；不能靠断网绕过已观察到的 required 更新 |
| 更新拉取或原子提交失败 | 保留旧 Manifest、granted、资源与 Agent Runtime |

每次变更 Manifest 必须重新计算所有资源 hash 并重新签名。不要重用 semver 发布不同 Manifest；不要把 Access Key 放进 Manifest 或资源 URL。

## 8. 本地开发与人工验收

loopback 开发允许：

```text
Manifest URL: http://127.0.0.1:<port>/openchamber.remote.json
Access Key:   由本地参考服务运行时生成或显式配置的测试凭据
```

验收顺序：

1. Inspect：只访问 Manifest，显示本地派生 fingerprint、完整权限摘要与 Native 警告；无 trust、secret、resource 写入。
2. Confirm connect：提交精确 fingerprint + Manifest hash；Key 只写服务端 Secret Store。
3. 首次打开 surface：此时才请求对应资源，并检查 Content-Type/hash。
4. 再次打开：TTL 内不重复下载；进程重启后缓存自然清空。
5. Connector test：有效 Key → reachable；错误 Key → 401；只读 Key 对写操作 → 403。
6. 写操作：用户确认前服务端不得收到业务写请求；确认后携带 revision。
7. 更新：同权限新版本自动切换；扩权/Native/换钥出现 re-consent；required 失败阻断。
8. 负向：篡改资源、错误 MIME、跨 origin redirect、未声明 action、停服和无效签名均 fail closed，且不泄漏 Key。

可运行参考服务位于工作区根的 `extension/`。它们用于开发/验收，不是官方公共服务，也不应携带生产凭据或离线生产私钥。
