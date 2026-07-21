# OpenChamber Installed Declarative / Trusted Native 开发手册

> 规范：OCIX v1 Managed Distribution Preview<br>
> 更新日期：2026-07-20<br>
> 配套 Agent skill：`.agents/skills/build-openchamber-interactive-extension/`<br>
> 架构背景：[Interactive UI 扩展架构](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)

## 1. 当前交付状态

Installed Declarative / Trusted Native 已经达到“企业开发者预览 v1”：一个扩展可以在不修改 OpenChamber 功能源码的情况下被发现、绑定 Agent tool、内联显示、查询真实 HTTP API，并通过服务端确认挑战执行写操作。

本次开发工具补齐了：

- Declarative + Trusted Native 双 runtime starter。
- OpenCode Custom Tool 和 Agent Skill starter。
- `create` 脚手架命令，拒绝覆盖已有目录。
- `validate` 命令，复用真实 server runtime 并增加字段级 Declarative 检查。
- Declarative 写后自动刷新 query。
- 安全 binding 仅访问自有属性，拒绝 `__proto__`、`prototype` 和 `constructor`。
- CRM/Sales 可运行示例与双 HTTP server 系统测试。
- 自描述 Ed25519 `.ocix` 包：签名覆盖扩展身份、公钥和每个文件的 path、size、SHA-256；安装前展示 publisher fingerprint、Tool/Skill 与权限。
- Extension Manager：确认式信任、Tool/Skill 全局受管安装、多扩展冲突保护、启停、更新、回滚、可恢复卸载和持久化信任库。
- 自描述签名 marketplace catalog 协议、URL-only 添加流程、客户端和静态目录生成 CLI。
- OCIX Connector Authentication v1：Extension Manager 内配置/签发/测试/断开业务连接，服务端 Secret Store 与 Gateway Key 注入。

这已经是一条可用于企业私有分发、内测渠道和静态公共目录的完整技术链，但不等于 OpenChamber 官方已经运营一个公共市场。公网域名/CDN、扩展审核组织、离线根密钥仪式、签名密钥吊销/透明日志、恶意软件响应、Native ABI 兼容窗口、VS Code Gateway 和远程 OpenCode 双端协商仍属于部署方或后续平台治理。业务 Key 的权限、RBAC/ABAC、撤销和审计由接入的第三方系统负责，不是 OpenChamber 要复制的一套多用户权限系统。

## 2. 什么时候选择哪种 runtime

| 需求 | Installed Declarative | Trusted Native |
|---|---:|---:|
| 指标、状态、键值、列表、流程 | 首选 | 可以 |
| 标准 bar/line/area/donut 图表 | 首选 | 可以 |
| 时间线、活动、对比、tabs/accordion、code、sparkline、标准 Git graph/tree/diff | 首选 | 可以 |
| 标准表格和确认式行操作 | 首选 | 可以 |
| 需要平台自动统一布局和主题 | 首选 | 需要遵循 Host 样式 |
| 多步骤表单、复杂本地状态 | 受限 | 首选 |
| 现有 React 业务模块拆分 | 不适合直接搬运 | 首选 |
| 地图、画布、拖拽、复杂编辑器 | 当前不适合 | 首选 |
| 公共不可信第三方代码 | 不执行代码，可用 | 不允许默认信任 |
| 模型一次性生成任意视觉 | 先用 Agent Generated 子集 | DSL 确有缺口时使用独立 HTML Artifact，不是 Native/OCIX |

建议从 Declarative 开始。只有当标准 primitive 无法表达交互时再使用 Native。一个扩展可以同时提供 overview Declarative View 和 workspace Native View。

## 3. 五分钟创建扩展

从仓库根目录运行：

```bash
node scripts/interactive-ui-extension.mjs create \
  ./local-extensions/acme-operations \
  --id com.acme.operations \
  --name "Acme Operations" \
  --tool-prefix operations
```

生成目录：

```text
acme-operations/
├── openchamber.extension.json
├── ui/
│   └── declarative/
│       └── overview.view.json
├── dist/
│   └── ui.mjs
└── agent-runtime/
    ├── tools/
    │   ├── operations_open_overview.ts
    │   └── operations_open_workspace.ts
    └── skills/
        └── operations-interactive-ui/
            └── SKILL.md
```

先运行校验，确保 starter 与本机 runtime 一致：

```bash
node scripts/interactive-ui-extension.mjs validate \
  ./local-extensions/acme-operations
```

校验不会请求企业 API，也不会执行 Native bundle。它验证：

- manifest ID、版本、重复项、connector、origin permission 和 action。
- entry 必须位于扩展目录内，类型和大小受限。
- View ID、runtime、tool binding、Declarative schema 与 Native asset。
- `agent-runtime/tools` 的单文件默认导出、保留名称、重复名称，以及 `agent-runtime/skills` 的目录和 frontmatter。
- Declarative primitive、binding path、action 引用、深度和节点数。
- Native 开发信任声明和可静态识别的 activation contract。

最后仍需要在真实 Host 中运行 Native 代码，静态校验不能证明组件不会抛错。

## 4. 先定义业务 API

starter 预期一个服务端 API：

### 4.1 查询

```http
POST /interactive-ui/overview
Authorization: Bearer <server-side-token>
Content-Type: application/json

{"scope":"default"}
```

建议响应：

```json
{
  "updatedAt": "2026-07-18T10:30:00Z",
  "activeCount": 18,
  "totalValue": 1280000,
  "completionRate": 0.72,
  "items": [
    {
      "id": "ITEM-1042",
      "name": "Renewal approval",
      "owner": "Lin",
      "status": "pending",
      "revision": 7
    }
  ]
}
```

### 4.2 写入

```http
POST /interactive-ui/items/approve
Authorization: Bearer <server-side-token>
Content-Type: application/json

{"itemId":"ITEM-1042","revision":7}
```

建议响应：

```json
{
  "message": "Item approved",
  "item": {
    "id": "ITEM-1042",
    "status": "approved",
    "revision": 8
  }
}
```

业务 API 应用 revision、ETag 或业务版本拒绝过期写入。OpenChamber 负责确认和转发，但不能替代业务系统的并发控制、授权和审计。

## 5. Manifest

`openchamber.extension.json` 是 Host 安装契约。

### 5.1 顶层字段

| 字段 | 当前 v1 行为 |
|---|---|
| `$schema` | 应为 `openchamber://extension/v1`；CLI 强制检查 |
| `id` | 至少两段的 namespaced ID，如 `com.acme.operations` |
| `name` | 注册表显示名 |
| `version` | CLI 要求 semver；Native 更新后必须递增 |
| `agentRouting` | 可选的受约束 Agent 路由元数据：业务域、意图、示例和数据权威性 |
| `connectors` | 服务端 HTTP(S) 连接定义 |
| `views` | Declarative/Native entry 与 tool binding |
| `actions` | Gateway allowlist |
| `permissions.network` | connector origin allowlist |
| `trust` | runtime 类型说明；生产授权来自 `.ocix` 包签名和 Host 信任库，不依赖该字段自报 |

`publisher` 等额外元数据可以保留，但 v1 registry 不把它作为授权依据。

### 5.2 Agent Routing

新扩展应声明结构化路由元数据，让 OpenChamber 能从当前已启用的 OCIX 动态生成 Agent Capability Catalog：

```json
{
  "agentRouting": {
    "domain": "operations",
    "intents": [
      "operations.overview",
      "operations.item.view",
      "operations.item.approve"
    ],
    "examples": {
      "zh-CN": ["打开运营概览", "查看待审批项目"],
      "en": ["open operations overview", "show pending items"]
    },
    "dataAuthority": "connected-business-system"
  },
  "views": [
    {
      "id": "com.acme.operations.overview",
      "tools": ["operations_open_overview"],
      "routing": {
        "intents": ["operations.overview", "operations.item.view"],
        "priority": 80,
        "operation": "read"
      }
    }
  ]
}
```

规则：

- `domain` 和 `intents` 是短标识符，不是自由文本提示词；intent 必须位于 domain namespace 中。
- `dataAuthority` 只能是 `generated`、`user-provided` 或 `connected-business-system`。企业扩展通常使用最后一种。
- 多 View 扩展必须为每个 View 声明 `routing`，消除 overview/workspace 歧义；`priority` 为 0–100，`operation` 为 `read`、`write` 或 `mixed`。
- `views[].tools` 必须至少绑定一个小写下划线 Tool 名称；打包的 Tool 文件名必须与它完全相同。
- `examples` 只用于开发和验收，不会拼接进系统提示词。系统上下文只包含经过校验的 ID、intent、operation、dataAuthority 和脱敏连接状态。
- Tool description 本身仍须独立说明业务域、真实数据来源和与通用 `interactive_ui` 的优先级，因为没有 routing 字段的旧 OCIX 仍然兼容运行。
- 业务 Connector 未配置或过期时仍应选择业务 Tool，由它返回配置要求；不得退回通用 Tool 伪造企业数据。

OpenChamber Web 在发送用户消息前调用 `GET /api/interactive-ui/capabilities`，并通过 OpenCode `session.promptAsync(..., system)` 原生字段附加固定模板的路由上下文。它不修改 `AGENTS.md`，不写入每扩展 `OPENCODE_CONFIG_DIR`，上下文最长 12,000 字符并按 Runtime 缓存 10 秒。外部 OpenCode Server 也能接收这段上下文，但只有远端实际存在的 Tool 才可调用；缺少 Agent Runtime 时必须报告双端部署缺失。

开发与验收时可以在 **Settings → Interactive UI Extensions → Routing Inspector** 查看最近的实际链路。它显示发送时注入的可用 Tool、声明的 intent/priority/operation/connection、实际观察到的 Tool 状态，以及 View 是否完成加载。这里的“候选”表示注入给模型的能力集合，并不是对模型隐藏推理或语义相关度的猜测。复制出的诊断报告已缩短会话/消息 ID，且不包含问题原文、Tool 输入输出、业务数据、接口地址或凭据。

### 5.3 Connector

```json
{
  "id": "business-api",
  "type": "http",
  "baseUrl": "${OCIX_BUSINESS_API_URL}",
  "auth": {
    "type": "api-key",
    "placement": {
      "type": "header",
      "name": "Authorization",
      "prefix": "Bearer "
    }
  },
  "test": {
    "method": "GET",
    "path": "/interactive-ui/health"
  }
}
```

规则：

- 只支持 HTTP(S)，URL 不能包含 username/password。
- base URL 可以引用一个全大写环境变量。
- 新扩展优先使用 `api-key`：用户从第三方系统创建最小权限 Key，再在 Settings → Interactive UI Extensions → Business connections 中配置。
- 如果第三方实现一次性 setup code 交换端点，使用 `issued-key`。真正的 Key 由 OpenChamber 服务端取得，不返回浏览器。
- `none` 用于无需凭据的 API；`env-bearer` 仅作为旧扩展/受控部署兼容类型。
- v1 只允许 Header 注入，默认是 `Authorization: Bearer <key>`；危险 Header、URL 凭据和 query-string token 会被拒绝。
- 建议声明固定的 `GET`/`HEAD` `test`，让设置页检查 Key 是否有效以及 scope 是否足够。
- Key value 只保存在 server Secret Store，永远不会进入 registry、View descriptor、Agent Tool 结果或浏览器 bundle。
- base URL 的 origin 必须出现在 `permissions.network`。

完整 `api-key`、`issued-key` manifest、请求/响应 schema、存储边界和第三方实现要求见 [OCIX Connector Authentication & Credential Provisioning v1](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)。第三方系统决定 Key 的权限、租户、过期、撤销、RBAC/ABAC 和最终业务授权；OpenChamber 不复刻这些规则。

### 5.4 Action

```json
{
  "id": "com.acme.operations.item.approve",
  "connector": "business-api",
  "risk": "write",
  "permission": "ask",
  "request": {
    "method": "POST",
    "path": "/interactive-ui/items/approve"
  },
  "confirmation": {
    "title": "Confirm this business update?",
    "description": "This action writes to the connected system."
  }
}
```

当前方法支持 GET、POST、PUT、PATCH 和 DELETE。path 必须是固定的 connector-relative path，不能包含 scheme 或 `..`。GET input 只能是 scalar query parameter；其他方法发送 JSON body。

推荐策略：

- 查询：`risk: read` + `permission: allow`。
- 写入：`risk: write` + `permission: ask`。
- 删除或不可逆操作：`risk: destructive` + `permission: ask`，并在业务服务端再次授权。
- 禁用能力：`permission: deny`。

当前 action 是 extension 级 allowlist，不是单个 View 的独立 allowlist；服务端仍验证发起 action 的 extension 是否拥有当前 View。

### 5.4 View

```json
{
  "id": "com.acme.operations.overview",
  "runtime": "declarative",
  "entry": "ui/declarative/overview.view.json",
  "tools": ["operations_open_overview"],
  "displayModes": ["inline", "workspace"]
}
```

- View ID 必须位于 extension namespace 下。
- `tools` 是安全绑定，不只是提示。Host 再次检查实际 ToolPart name。
- Native `entry` 只能是本地 `.mjs`/`.js`；不能从 manifest dynamic import 任意互联网 URL。
- 当前对话 Host 实际传入 `display.mode: inline`。workspace/fullscreen 只是 descriptor 能力声明，容器尚未交付。

## 6. Agent 半边：Tool、MCP 与 Skill

安装 UI 不会自动让模型知道何时打开它。Agent runtime 必须提供一个 tool，并在完成结果里返回严格 Envelope。

```json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.acme.operations.workspace",
  "schemaVersion": 1,
  "mode": "live",
  "summary": "Acme Operations workspace opened",
  "context": { "scope": "default" },
  "updatedAt": "2026-07-18T10:30:00Z"
}
```

### Custom Tool

starter 使用 `@opencode-ai/plugin` Custom Tool，适合本地开发和与 OpenChamber 一起部署的企业环境。Tool 的 description 决定模型是否会主动选择它。

### MCP

同一个 Envelope 可以由 Local/Remote MCP tool 返回。MCP 负责 tool discovery、业务读写和跨 Agent host 复用；当前 OCIX UI 不要求 MCP Apps metadata。若 MCP client 位于外部 OpenCode server，UI package 仍要安装在 OpenChamber Host。

### Skill

Skill 只告诉 Agent：什么用户意图对应 overview/workspace、何时询问 scope、什么时候不得声称写入成功。Skill 不能代替 API transport，也不能授予 UI 权限。

## 7. Installed Declarative

### 7.1 支持的 primitive

| 分类 | primitive |
|---|---|
| Layout | `stack`, `section`, `row`, `grid` |
| 指标 | `metric-grid`, `metric`, `progress`, `status`, `badge`, `key-value` |
| 内容 | `text`, `markdown`, `list`, `callout`, `flow` |
| 数据 | `data-table`, `chart` |
| 进阶数据/历史 | `timeline`, `activity-feed`, `comparison`, `sparkline`, `git-graph`, `tree`, `diff-summary` |
| 进阶组织 | `tabs`, `accordion`, `code-block`, `divider` |
| 受控入口 | `generated-layout`，只应由 built-in generated View 使用 |

`chart.variant` 当前支持 bar、line、area 和 donut；`series` 声明数值字段，`xKey` 声明分类字段。

### 7.2 Binding

```json
{ "$path": "query.overview.totalValue", "fallback": 0, "format": "currency:CNY" }
```

- `$path` 可从 `data`、`context`、`query` 和 `host` 读取。
- `$row` 只从当前 table row 读取。
- segment 只允许字母、数字、下划线和连字符。
- 只读取自有属性；显式拒绝 prototype 相关 segment。
- 支持 `number`、`percent`、`currency:XXX` 和 `date` format。
- 没有 eval、JSONPath 表达式、函数或模板代码。

### 7.3 Query

```json
{
  "queries": {
    "overview": {
      "action": "com.acme.operations.overview.query",
      "input": {
        "scope": { "$path": "context.scope", "fallback": "default" }
      }
    }
  }
}
```

View mount 后，Host 并行执行 queries。结果进入 `query.<name>`。失败会显示可见错误，不会伪装成空数据。

### 7.4 确认式行操作

`data-table.rowActions` 可以从 `$row` 组成 input，并通过 `when` 控制按钮。`host.business.execute` 首次调用若收到 `confirmation_required`，会向用户显示确认；确认后以 `confirmed: true` 重试。成功后 Declarative View 自动重新执行 queries，避免页面保留旧数据。

如果业务 action 还需要更复杂的表单、批量选择或多阶段状态，使用 Trusted Native。

## 8. Trusted Native

### 8.1 信任模型

Native bundle 在 OpenChamber 主 React 页面中运行，不是 sandbox。它可以获得与普通前端组件相近的 DOM 和运行时权限，因此只能安装管理员审核、固定版本的代码。

Native 不应获得业务 token。业务权限通过窄 Host SDK 和 server Gateway 提供，这能减少凭证泄漏，但不能把恶意 Native 变成安全代码。

### 8.2 Activation contract

```js
export const extension = {
  id: 'com.acme.operations',
  apiVersion: 1,
  activate(host) {
    const React = host.react;
    const { Button, Card, CardHeader, CardTitle, CardContent, EmptyState, Notice } = host.ui;
    function WorkspaceView(props) {
      // render with React.createElement or compiled JSX
    }
    return host.views.register({
      id: 'com.acme.operations.workspace',
      component: WorkspaceView,
      displayModes: ['inline'],
    });
  },
};
```

要求：

- extension ID 与 manifest 完全一致。
- `apiVersion` 当前只能是 1。
- 使用 `host.react`，不要打包第二份 React。
- View ID 位于 extension namespace，并在 activation 时注册。
- 当前 loader 会按 `extension@version:assetPath` 缓存；开发时改 bundle 应递增 manifest version 或重启 Host。
- v1 没有完整 hot unload；不要依赖 deactivate 清理跨 View 全局状态。

### 8.3 View props

Native component 当前获得：

- `instanceId`, `extensionId`, `viewId`, `status`。
- Envelope 的 `context`, `snapshot`, `dataRef`。
- 原始 tool 的 id/name/input/output/error。
- `display.mode` 与 mobile 标记。
- `host.business`, `host.dialog`, `host.notifications`, `host.context`。

### 8.4 Business Host

```js
const data = await props.host.business.query(
  'com.acme.operations.overview.query',
  { scope: 'default' },
);

await props.host.business.execute(
  'com.acme.operations.item.approve',
  { itemId: item.id, revision: item.revision },
);
```

Native 不得直接 `fetch` 业务 origin。这样 connector URL、token、确认和 action allowlist 仍由 server 控制。

### 8.5 OpenChamber 风格

- 使用 Host UI Kit：`Button`、Card family、`Badge`、`Notice`、`Skeleton`、`Separator`、`Progress`、Table family、Tabs family、`Input`、`Textarea` 和 `EmptyState`；不可用、未授权、禁止、陈旧和错误反馈统一使用 `Notice`，不要自制重复 chrome。
- 使用 `.ocix-scope` 下的 semantic class/token，如 `--ocix-surface`、`--ocix-surface-muted`、`--ocix-foreground`、`--ocix-muted-foreground`、`--ocix-border` 和 `--ocix-{success,warning,error,info}`。
- 不硬编码 hex 或 Tailwind palette 色。
- 只使用 OpenChamber 构建中已经存在且由 Host UI Kit 文档保证的 utility/class；外部 bundle 的任意动态 class 不会自动被 Tailwind 扫描生成。扩展自身的响应式网格不要假设 `sm:*` / `xl:*` 一定存在，可使用 `repeat(auto-fit, minmax(...))` 的受限 inline style，或等待 Host UI Kit 提供对应布局 primitive。
- 设计窄屏布局、横向 table overflow、loading、empty、error 和 disabled state。
- Host UI Kit 是 `uiVersion: 1` 的只增契约；需要新共享 primitive 时应版本化扩展 Host SDK，而不是 import OpenChamber 私有源码。

### 8.6 Bundle 规则

v1 loader 只为 manifest entry 提供受认证 asset route。生产 bundle 应是单一 ESM 文件、无额外 chunk、无内嵌 React，且不超过 2 MB。不要依赖相对 dynamic import 的未注册 chunk。

## 9. 安装与加载

### 9.1 开发环境

```bash
export OCIX_BUSINESS_API_URL=https://business.example.internal
export OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR="$PWD/local-extensions/acme-operations"
bun run start:web
```

开发目录加载后，在 **Settings → Interactive UI Extensions → Business connections** 中配置第三方 Key。不要把真实 token 写入 shell history、仓库、日志或截图。开发根目录仍是 Host UI 调试旁路；完整安装和凭据生命周期必须用签名 `.ocix` 验收。

`OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` 只用于快速调试 Host UI/Gateway，不会让 OpenCode 自动发现该裸目录里的 Tool/Skill。需要验收真实对话流时，应打包并从 Extension Manager 安装 `.ocix`；不要为每个扩展设置 `OPENCODE_CONFIG_DIR`。安装器会把所有已启用扩展统一接入全局 `~/.config/opencode/tools` 与 `~/.config/opencode/skills`。

Host 按需读取 manifest，因此 Declarative JSON/manifest 修改通常不要求重启。Native ESM 受浏览器 module cache 和 extension version cache 影响，应递增版本。

### 9.2 生产签名与打包

生产发布不应把裸目录复制到数据目录。首次为发布者创建离线 Ed25519 密钥：

```bash
node scripts/interactive-ui-extension.mjs keygen ./offline-publisher-keys
```

`publisher.private.pem` 权限为 `0600`，必须留在离线签名环境、KMS 导出隔离区或受控 CI secret 中；不能放入扩展目录。打包器从私钥导出公钥并把它写入受签名的 `openchamber.package.json`，因此管理员不再手工粘贴公钥。公钥随包只能证明“此包与此签名密钥自洽”，不能证明发布者的现实身份；生产管理员仍应通过独立渠道核对 fingerprint。

验证并打包：

```bash
node scripts/interactive-ui-extension.mjs pack ./local-extensions/acme-operations \
  --out ./dist/acme-operations-1.0.0.ocix \
  --private-key ./offline-publisher-keys/publisher.private.pem \
  --publisher-id com.acme.publisher \
  --publisher-name "Acme" \
  --key-id release-2026
```

使用包内公钥做完整性验签：

```bash
node scripts/interactive-ui-extension.mjs verify ./dist/acme-operations-1.0.0.ocix
```

如需把另行取得的发布者公钥作为身份 pin，再运行：

```bash
node scripts/interactive-ui-extension.mjs verify ./dist/acme-operations-1.0.0.ocix \
  --public-key ./offline-publisher-keys/publisher.public.pem \
  --publisher-id com.acme.publisher \
  --key-id release-2026
```

`.ocix` 是 ZIP，但 Host 不信任 ZIP 目录本身。`openchamber.package.json` 的 Ed25519 签名覆盖扩展 ID/name/version、发布者、时间和所有文件的 path/size/SHA-256；安装器拒绝路径穿越、symlink、未签名额外文件、缺失文件、hash 不符、`.env`、私钥和超限包。压缩包当前上限 20 MB，解压总量 16 MB，单文件 8 MB，最多 512 个文件。

### 9.3 Extension Manager

在 **Settings → Interactive UI Extensions** 中：

1. 选择 `.ocix`。Host 使用包内公钥验证签名和全部文件索引，但尚不自动信任发布者身份。
2. 弹窗展示扩展 ID/version、发布者、key ID、fingerprint、Agent Tools、Skills、网络权限和 Native-code 状态。管理员通过独立渠道核对后选择“信任并安装”。
3. Host 在 staging 中运行真实 manifest/View/Agent Runtime 校验，然后把版本移入托管目录。
4. 当前 active version 的 Tool 会作为 OpenChamber 管理的副本写入 `~/.config/opencode/tools/<tool>.<ext>`，Skill 会复制到 `~/.config/opencode/skills/<skill-name>`；安装器记录 owner/version/hash，并刷新受管 OpenCode。Tool 文件应保持单文件自包含，只依赖普通全局 OpenCode Tool 可解析的包。
5. 多个扩展共享上述全局目录。Tool/Skill 名称必须全局唯一；若目标属于用户、被外部修改或已归另一扩展所有，安装会失败且不会覆盖。
6. 更新包必须使用新 semver；旧版本保留，回滚时 UI 与 Agent Runtime 一起切换。Disable 会同时移除 UI discovery 与受管 Tool/Skill，Enable 恢复；Uninstall 先移除受管全局文件并把扩展版本移动到 `<OPENCHAMBER_DATA_DIR>/interactive-ui/trash`。

管理状态位于 `<OPENCHAMBER_DATA_DIR>/interactive-ui`，版本位于 `<OPENCHAMBER_DATA_DIR>/extensions/<extension-id>/<version>`。runtime 只从持久化状态加载已启用 active version。`OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` 仍然存在，但明确属于开发 source：它绕过生产安装状态，不能作为未知第三方分发入口。

### 9.4 签名 marketplace

Marketplace 是可静态托管的签名 JSON catalog；不要求专用服务端。catalog 的每个条目固定 package URL、package SHA-256 和发布者公钥，整个 catalog 再由 marketplace Ed25519 key 签名，catalog 本身也携带该 public key。管理员只输入 catalog URL，OpenChamber 先做自洽验签并弹窗显示 marketplace identity/key ID/fingerprint；用户确认后才固定该 key。之后客户端验证 catalog 身份与签名、下载包、复核 catalog package hash、信任该 catalog 声明的 publisher key，最后再次执行 `.ocix` 包签名验证。

创建 `entries.json` 后生成 catalog：

```json
[
  {
    "id": "com.acme.operations",
    "name": "Acme Operations",
    "version": "1.0.0",
    "packageUrl": "https://extensions.example.com/acme-operations-1.0.0.ocix",
    "packageHash": "sha256-<pack 命令输出>",
    "publisher": {
      "id": "com.acme.publisher",
      "name": "Acme",
      "keyId": "release-2026",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
    }
  }
]
```

```bash
node scripts/interactive-ui-extension.mjs catalog ./entries.json \
  --out ./public/catalog.json \
  --private-key ./offline-market-keys/publisher.private.pem \
  --marketplace-id com.acme.marketplace \
  --marketplace-name "Acme Marketplace" \
  --key-id catalog-2026
```

将 `catalog.json` 和 `.ocix` 上传到 HTTPS CDN/对象存储，然后在 Extension Manager 只添加 catalog URL，并在确认弹窗中核对 marketplace fingerprint。loopback 开发允许 HTTP，非本机目录与包只允许 HTTPS 且 URL 不能嵌入 credential。

这使私有市场、合作伙伴目录和任何人可访问的公共静态市场都具备相同的技术能力。OpenChamber 仓库没有伪造一个“已经运营”的官方市场：上架审核、账号/付费、举报、恶意包下架、吊销列表、透明日志、CDN 和 SLA 是公共市场服务本身的运营面。

### 9.5 外部 OpenCode server

当 OpenChamber 管理的是同一台机器上的 OpenCode 时，`.ocix` 已经完成双端安装，不需要额外环境变量。只有 OpenChamber 连接另一台机器/容器里的外部 OpenCode server 时，才仍是双端部署：

```text
OpenChamber Host
  └─ manifest + Declarative/Native UI + Gateway credentials

OpenCode Server
  └─ Custom Tool/Plugin/MCP + Agent Skill
```

两端缺一不可。OpenChamber 不会把本机 `~/.config/opencode` 文件远程复制到外部 server；该 server 的管理员需要通过其部署通道安装同一包中的 `agent-runtime`。UI 只装在 OpenChamber 时，模型不会产生 Envelope；Agent tool 只装在外部 OpenCode 时，ToolPart 会回退并报告 View 未安装。远程能力协商和远程安装尚未实现。

## 10. 完整调用路径

### 10.1 打开模块

```text
用户：“打开运营工作台，看看待审批项目”
  → OpenChamber 获取当前 OCIX Capability Catalog（无 Secret / Connector URL）
  → 通过 OpenCode prompt system 字段注入固定路由策略
  → OpenCode Agent 根据显式请求、Catalog、tool description/skill 选择 operations_open_workspace
  → Tool 返回 strict Interactive Result Envelope 字符串
  → OpenChamber 收到 completed ToolPart
  → parser 校验 schema/view/version/mode
  → ToolPart 自动展开首个有效 OCIX result
  → GET /api/interactive-ui/views/<view>?tool=operations_open_workspace
  → server 发现扩展并复核 tool/view binding
  → Native descriptor 返回受认证 assetPath、exportName、integrity
  → browser 从 OpenChamber asset route dynamic import ESM
  → extension activate，注册 workspace component
  → component 内联挂载到当前 ToolPart
  → component 调 host.business.query
  → POST /api/interactive-ui/actions/<query-action>
  → Gateway 检查 extension/view/action/connector/origin
  → server 从 Secret Store 读取并注入 Key，调用真实企业 API
  → JSON 结果返回 component，页面更新
```

### 10.2 确认写入

```text
用户点击 Approve
  → Native/Declarative 调 host.business.execute
  → Gateway 发现 permission=ask 且 confirmed=false
  → 返回 409 confirmation_required，不请求上游
  → Host 显示确认
  → 用户确认后以 confirmed=true 重试
  → Gateway 注入 Key，请求固定 action path
  → 企业 API 按该 Key 的 scope 校验业务权限与 revision
  → 返回更新结果和 requestId
  → View 刷新 query
```

确认是防误操作，不是业务授权。企业 API 必须自己判断当前主体是否有权写入。

## 11. 错误与回退

| 失败 | 用户结果 |
|---|---|
| Tool 未选中 | 普通文本回答；可明确要求使用 tool |
| 外部 OpenCode 缺少 OCIX Tool | 明确报告 Agent Runtime 半边未部署；不伪造替代看板 |
| Connector 未配置/过期 | 仍进入业务 Tool，由模块显示连接配置要求 |
| Envelope 非法 | 普通 Tool UI |
| View 未安装 | 可见错误 + 原始 Tool UI |
| tool/view 不匹配 | 403 + fallback |
| Declarative query 失败 | View 内可见错误，原数据不伪装成成功 |
| Native asset/activate/render 失败 | Error Boundary 回退原始 Tool UI |
| action 未声明/denied | server 拒绝 |
| 用户取消确认 | 不请求上游 |
| 上游超时/非 JSON/过大 | Gateway 返回明确错误 |
| revision 冲突 | 企业 API 错误显示，View 可刷新后重试 |

server action timeout 当前为 15 秒，manifest/view 上限 512 KB，Native bundle 和上游 JSON 响应上限 2 MB。

## 12. 验收

### 12.1 扩展级

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/extension
```

### 12.2 平台回归

```bash
bun run test:interactive-ui-extension
bun run test:interactive-ui
bun test packages/web/server/lib/interactive-ui/package-format.test.js \
  packages/web/server/lib/interactive-ui/manager.test.js
bun test \
  packages/ui/src/lib/interactive-ui/result.test.ts \
  packages/ui/src/lib/interactive-ui/bindings.test.ts \
  packages/ui/src/lib/interactive-ui/generatedLayout.test.ts \
  packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx
```

### 12.3 对话流验收

1. 用自然语言询问业务模块，确认模型主动选择 tool。
2. 若模型没有选择，明确说“使用 `<tool_name>` 打开工作台”。
3. 确认 UI 在正常 OpenChamber 对话 ToolPart 内显示，不以 standalone harness 作为验收。
4. 确认 query 使用真实 API 数据。
5. 执行 write，确认上游在用户确认前没有收到请求。
6. 确认 revision 更新且页面刷新。
7. 故意破坏 View ID 或关闭 API，确认 fallback 和错误可见。

仓库示例可运行：

```bash
bun run demo:interactive-ui:start
```

演示会在后台运行，日志写入 `.tmp/interactive-ui-demo/demo.log`。结束后执行：

```bash
bun run demo:interactive-ui:stop
```

如果需要让进程留在当前终端并直接查看输出，仍可使用 `bun run demo:interactive-ui`。

测试提示包括“打开企业 CRM，看看客户和商机管道”。

## 13. 配套开发 skill

仓库内 skill 位于：

```text
.agents/skills/build-openchamber-interactive-extension/
```

其他开发者或 Agent 拿到仓库后，可以明确要求：

```text
使用 $build-openchamber-interactive-extension，
把我们的工单模块做成 OpenChamber 风格的 Declarative 概览和 Native 工作台，
查询接口是 POST /tickets/overview，关闭工单需要确认并携带 revision。
```

skill 会要求 Agent 先划分 query/write、选择 runtime、使用脚手架、保持 token 在 server、验证扩展，并最终以真实对话流而不是独立 demo 验收。

## 14. 当前已知限制

- `.ocix` Ed25519 包签名、内嵌公钥检查与确认式发布者信任、Agent Tool/Skill 全局受管安装、Extension Manager 和自描述签名 marketplace catalog 已实现并测试；`trust.signature` manifest 字段本身仍不是授权依据。
- Connector Authentication v1 的手工 Key、一次性连接码签发、连接测试、替换、断开和卸载清理已实现；业务 RBAC/ABAC、Key scope、撤销与业务审计由第三方系统实现。
- Marketplace key 等价于该目录的发布委托：目录一旦被攻破，攻击者可能声明新的 publisher key，因此生产环境必须保护离线市场 key，并规划 key rotation/revocation。
- 当前没有在线签名密钥吊销列表、签名透明日志、恶意软件扫描服务或官方托管公共市场；这些是分发生态治理，不应由客户端假装完成。
- Native 仍是管理员或受信 marketplace 授权的同页代码；签名证明来源与完整性，不证明代码安全。
- Native Host SDK v1 已包含常用 Card/Badge/Table/Tabs/Form/State primitives，但不是完整的任意组件框架；缺失能力应走 Host SDK 版本化，而不是私有源码 import。
- Native asset integrity 当前用于 descriptor/ETag；dynamic import 路径没有浏览器 SRI 参数。
- Native 没有完整 hot unload 和 ABI 兼容协商。
- Installed Native 的 workspace/fullscreen 产品容器仍未统一；HTML Artifact 已支持同一 iframe 的 inline/workspace/fullscreen。
- VS Code 尚无 Interactive UI Gateway，保持明确 unsupported。
- HTML Artifact Runtime v1 已实现独立 schema、Tool、内容寻址重放、sandbox/CSP、主题/resize/follow-up Bridge 和展开模式；scripts 生产默认关闭，且 Artifact 永远不能获得 Connector/Token/Tool/Gateway/网络权限。VS Code 与 active E2EE relay 仍明确 unsupported。
- MCP Apps 仍在 Roadmap。

这些限制不影响在受控企业部署中开发和验证真实模块，但上线到公共生态前必须完成治理阶段。
