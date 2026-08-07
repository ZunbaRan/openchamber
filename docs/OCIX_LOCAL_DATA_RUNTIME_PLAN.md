# OCIX Local Data Runtime 详细规划  
## better-sqlite3 + Hono 内嵌轻量后端底座

> **状态**：设计规划（**本阶段不实施代码**）  
> **日期**：2026-08-05  
> **选型拍板**：数据存储 **better-sqlite3**；API 面 **Hono**；运行于 OpenChamber **同进程（内嵌）**  
> **场景**：**Host / 用户自研**小组件后端（双场景中的 **场景 B**）  
> **前端轨（不变）**：Installed Declarative / Trusted Native / HTML Artifact  
> **父文档**：[双场景愿景](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md) · [Remote 详细规划](./OCIX_REMOTE_MODE_DETAILED_PLAN.md)

---

## 0. 术语（先分清，避免和 Remote Hosted 混）

| 用语 | 本文含义 |
|------|----------|
| **Local Data Runtime（LDR）** | OpenChamber **内嵌**的轻量业务后端底座（better-sqlite3 + Hono） |
| **Host-local App / 自研 App** | 用户或 Agent 在本机/项目内开发的 OCIX 扩展，**业务 API 落在 LDR** |
| **Remote Hosted** | **第三方**远程交付：URL+Key + 签名 Manifest（见 Remote 规划）；**不是**本底座 |
| **Hosted 薄包** | 现有协议 delivery 形态之一；自研 App **可以**再打包成薄包/全量包分发，但 **开发期默认走 LDR** |
| **App** | 一个 OCIX `extensionId` 对应的扩展（可含多个 Surface + 一组 actions） |
| **Project** | OpenChamber 项目作用域；Board、路径、默认数据根可按项目隔离 |

**一句话：**

> **Remote Hosted = 怎么从网上连别人的扩展。**  
> **LDR = 自研扩展的数据与 API 跑在哪儿。**  
> 二者正交：前端都是三种 Surface；后端来源不同。

---

## 1. 目标与非目标

### 1.1 目标

1. 为 **自研 OCIX App** 提供可 **打进 OpenChamber 客户端** 的轻量后端。  
2. 技术栈与现网一致：已有 **better-sqlite3** 打包链路；API 用 **Hono** 薄路由。  
3. **多 App 强隔离**（数据、路由、凭据、Tool 名、失败域）。  
4. 业务调用仍经 **Business Gateway**（确认写、action 白名单）；UI 不直连 SQLite、不直连 Hono 乱端口。  
5. 给 **Agent** 一份可执行的 **App 开发规范**（scaffold 结构、schema、actions、禁止事项）。  
6. 说清与 **Remote Hosted / Local 全量包** 的关系与毕业路径。

### 1.2 非目标（本规划）

| 不做 | 原因 |
|------|------|
| 本阶段写生产代码 | 先冻结合同 |
| 替代第三方 Remote 后端 | 厂商自有 API |
| 把 PocketBase 定为默认 | 已选 better-sqlite3 + Hono；PB 最多未来可选增强 |
| 完整多用户 RBAC 中心 | 自研单机/项目库；企业权限仍归业务方 |
| 跨 App 共享一张业务表（默认） | 默认隔离；共享需显式「共享库」产品（后置） |
| 浏览器直连 Hono / 暴露公网 | 安全红线 |
| 与 MCP App 合并 | 平行轨 |

### 1.3 成功标准（未来实施后）

- 用户/Agent 可 scaffold 一个「订单列表 + 确认批准」App，无需外部数据库进程。  
- 两个 App 的 SQLite 文件与路由前缀互不可见。  
- 卸载/禁用 App 不留下可被另一 App 读到的默认可写数据面。  
- Desktop 打包仍只需现有 native 链路，不新增 Go 二进制。

---

## 2. 前因后果

### 2.1 前因

- 前端呈现已由 **Declarative / Trusted Native / HTML Artifact** 承担。  
- 缺的是 **自研时的本地业务持久化 + 受控 API**。  
- PocketBase 完整但多进程/跨语言；OC 已带 **better-sqlite3**，适合进程内。  
- Hono 轻、适合 loopback 薄 API，且 **可选**——逻辑核心是 action 分发。

### 2.2 决策

| 层 | 选型 |
|----|------|
| 存储 | **better-sqlite3**（统一 Node/Electron；不默认分叉 bun:sqlite） |
| API | **Hono**（loopback 或内部 fetch 适配器） |
| 部署 | **内嵌 OpenChamber server 进程** |
| 调用链 | UI/Agent → **Gateway** → LDR（禁止 UI→SQLite） |

### 2.3 后果

**得到：** 零额外业务后端二进制、与 Gateway 易对齐、多 App 可文件级隔离、Agent 生成 TS+SQL 友好。  

**付出：** 无开箱 PB Admin（可后补只读浏览）；表结构/migration 要规范；要自己做 App 级 mount 与生命周期。

---

## 3. 总体架构

### 3.1 逻辑图

```text
┌──────────────────────── OpenChamber Process ────────────────────────┐
│  Chat / Workbench / Surfaces                                         │
│    Declarative │ Trusted Native │ HTML Artifact                        │
│         │              │                 │                             │
│         └──────────────┴─────────────────┘                             │
│                        │ host.business / Tool                          │
│                        ▼                                               │
│              Business Gateway                                          │
│           (action allowlist · confirm write · secrets)                 │
│                        │                                               │
│                        ▼                                               │
│         ┌──────── Local Data Runtime (LDR) ────────┐                   │
│         │  Hono root (loopback only)               │                   │
│         │    /health                               │                   │
│         │    /v1/apps/:extensionId/*  ──┬── App A handlers             │
│         │                               ├── App B handlers             │
│         │  better-sqlite3               │                              │
│         │    apps/A/data.sqlite  ◄──────┘                              │
│         │    apps/B/data.sqlite                                        │
│         └──────────────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 与双场景的位置

```text
场景 A 第三方 Remote     场景 B 自研
  厂商 HTTP API            LDR (本规划)
       ▲                        ▲
       └──── Gateway ───────────┘
              ▲
         OCIX Surfaces
```

### 3.3 进程与端口模型

| 项 | 合同 |
|----|------|
| 进程 | **与 OpenChamber web/server 同进程**（Desktop 随主服务） |
| 监听 | 仅 **`127.0.0.1`**；端口由 OC 分配或固定配置段（如 39200–39299 池） |
| 公网 | **禁止**默认 bind `0.0.0.0` |
| 无 HTTP 模式（可选优化） | Gateway 识别 `connector.type = local-data` 时 **进程内直调** Hono `app.fetch`，不经 TCP |
| 健康检查 | `GET /health` 与 per-app `GET /v1/apps/:id/health` |

**推荐默认：** 实现上同时支持：

1. **内部 transport**（Gateway → `ldr.dispatch`）— 主路径，更快、无端口冲突。  
2. **loopback HTTP**（调试、外部 curl、未来可选）— 同一 Hono app。

Connector 配置示例（概念）：

```json
{
  "id": "local-data",
  "type": "local-data",
  "baseUrl": "http://127.0.0.1:39201",
  "appId": "com.acme.orders"
}
```

或：

```json
{
  "id": "local-data",
  "type": "local-data",
  "transport": "in-process",
  "appId": "com.acme.orders"
}
```

---

## 4. 存储设计（better-sqlite3）

### 4.1 数据根布局

```text
<OPENCHAMBER_DATA_DIR>/
  local-data/
    runtime.json                 # LDR 元数据：版本、端口、迁移全局状态
    projects/
      <projectId>/
        apps/
          <extensionId>/         # 见隔离 §6
            data.sqlite          # 主库
            data.sqlite-wal      # 若启用 WAL
            data.sqlite-shm
            migrations/          # 可选：已应用记录也可在库内
            meta.json            # schemaVersion、createdAt、flags
        shared/                  # 后置：显式共享库（默认不创建）
```

**开发旁路（可选）：**  
`OPENCHAMBER_LOCAL_DATA_DIR` 指向项目仓库内 `.openchamber/local-data/`，便于 gitignore 与 Agent 可见。

### 4.2 每 App 一库（默认）

| 策略 | 默认 |
|------|------|
| 一 extensionId 一个 `data.sqlite` | **是** |
| 多 App 共用一库多 schema | **否**（禁止默认；见 §6.4） |
| 跨项目共用一库 | **否** |

打开方式（概念）：

```ts
// 伪代码
const db = new Database(dbPath, { readonly: false /* 按角色 */ });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
```

### 4.3 Schema 与 migration

| 项 | 合同 |
|----|------|
| 作者声明 | App 包内 `server/migrations/*.sql` 或 `server/schema.sql` |
| 运行时 | LDR 在 **enable / 首次 action** 时对应该库执行 migration |
| 版本表 | 每库 `_ldr_migrations(id, applied_at)` |
| 失败 | fail-closed：migration 失败则 App 数据面 `blocked`，Gateway 返回可诊断错误 |
| 降级 | v1 **不支持**自动 destructive downgrade；需新 migration 前向修 |

**Agent 规范：** 只允许追加 migration 文件；禁止「改写已发布 migration 内容」。

### 4.4 库内约定（建议）

```sql
-- 平台保留前缀，App 业务表禁止使用
-- _ldr_* 

CREATE TABLE IF NOT EXISTS _ldr_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _ldr_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

业务表示例：

```sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 4.5 备份与卸载

| 事件 | 行为 |
|------|------|
| 禁用 App | 关闭连接；**保留**文件 |
| 卸载 App（可恢复） | 保留直至「清除数据」 |
| 卸载 + 清除数据 | 删除 `apps/<extensionId>/` 目录 |
| 导出备份 | 拷贝 `data.sqlite`（先 checkpoint WAL） |

---

## 5. API 设计（Hono）

### 5.1 路由树

```text
GET  /health
GET  /v1/runtime
GET  /v1/apps/:extensionId/health
POST /v1/apps/:extensionId/actions/:actionId
GET  /v1/apps/:extensionId/actions          # 可选：调试列出已注册 action（生产可关）
```

**原则：**

- **不提供**通用 `/collections/:name` 任意 CRUD（避免绕过 action 合同）。  
- 每个业务能力 = **一个 actionId** = 一个 handler（或薄封装）。  
- Gateway 的 `actions[].id` 与 LDR path **可稳定映射**。

### 5.2 Action 调用合同

**请求（Gateway → LDR）：**

```http
POST /v1/apps/com.acme.orders/actions/orders.list
Content-Type: application/json
X-OpenChamber-Local-Data-Token: <runtime-internal-token>
X-OpenChamber-Project-Id: <projectId>

{
  "input": { "status": "open", "limit": 50 },
  "meta": {
    "extensionId": "com.acme.orders",
    "actionId": "orders.list",
    "risk": "read",
    "requestId": "…"
  }
}
```

**响应：**

```json
{
  "ok": true,
  "data": { "items": [ … ] }
}
```

或：

```json
{
  "ok": false,
  "error": {
    "code": "validation_failed" | "not_found" | "conflict" | "internal",
    "message": "人类可读，无密钥"
  }
}
```

### 5.3 与 Gateway action 声明对齐

OCIX manifest 片段（概念）：

```json
{
  "connectors": [
    {
      "id": "local-data",
      "type": "local-data",
      "transport": "in-process"
    }
  ],
  "actions": [
    {
      "id": "com.acme.orders.orders.list",
      "connector": "local-data",
      "risk": "read",
      "permission": "allow",
      "localData": {
        "actionId": "orders.list"
      }
    },
    {
      "id": "com.acme.orders.orders.approve",
      "connector": "local-data",
      "risk": "write",
      "permission": "ask",
      "idempotent": true,
      "localData": {
        "actionId": "orders.approve"
      }
    }
  ]
}
```

Gateway：

1. 校验全局 action id、权限、确认挑战。  
2. 解析 `localData.actionId` + extensionId。  
3. 调 LDR；**不把** SQLite 路径暴露给 UI。

### 5.4 Hono 模块挂载（多 App）

```text
rootApp = new Hono()
rootApp.get("/health", …)

for each enabled app:
  const appRouter = loadAppRouter(extensionId)  // 来自 App 包 server/ 或生成表
  rootApp.route(`/v1/apps/${extensionId}`, appRouter)
```

App 内：

```text
appRouter.post("/actions/:actionId", dispatch)
```

**热加载（开发）：** 监视 App `server/` 变更可重载 router；生产安装包以磁盘版本为准，改文件需走 integrity（若走签名安装）。

### 5.5 内部鉴权

LDR **不信任**浏览器直连：

| 机制 | 说明 |
|------|------|
| loopback only | 绑定 127.0.0.1 |
| **runtime token** | OC 启动时生成；仅 Gateway/主进程持有；请求头校验 |
| extension 绑定 | path 中的 extensionId 必须与 Gateway 已鉴权的扩展一致 |
| project 绑定 | 打开的 DB 必须属于当前 projectId |

无 token 的 loopback 请求 → 401。  
（调试模式可开 `OPENCHAMBER_LOCAL_DATA_DEBUG=1` 放宽，**仅 dev**。）

### 5.6 为何用 Hono 而不是「纯函数」

| | 纯 `dispatch(action)` | Hono |
|--|----------------------|------|
| 内部调用 | 自然 | `app.request()` / 抽 handler 亦可 |
| curl/调试 | 要另包 | 天然 HTTP |
| 中间件 | 自写 | 日志、token、超时现成 |
| 依赖 | 0 | 轻量新增 |

**合同：** 业务逻辑写在 **action handlers**；Hono 只是 **transport 适配层**。  
未来若去掉 HTTP，handlers 仍可复用。

---

## 6. 多 App 隔离（核心）

### 6.1 隔离维度总表

| 维度 | 隔离单位 | 机制 |
|------|----------|------|
| **数据文件** | extensionId × projectId | 独立 `data.sqlite` 路径 |
| **DB 连接** | 同上 | 独立 `Database` 实例；禁止把 db 句柄传给其他 App |
| **路由命名空间** | extensionId | `/v1/apps/:extensionId/...` |
| **Action 注册表** | extensionId | 只能 dispatch 本 App 注册的 actionId |
| **Gateway connector** | 每扩展自己的 connector 或共享类型但 appId 必填 | 跨扩展 action 不可指向他库 |
| **Agent Tool 名** | 全局唯一（现有规则） | `tool-prefix` + 冲突检测 |
| **文件系统 server 代码** | 扩展安装目录 / 开发目录 | 不读其他扩展 server/ |
| **密钥** | 一般无业务 Key；若有 | Secret Store 按 extension+connector |
| **失败域** | 单 App | migration/ handler 崩溃不卸载整个 LDR；Error 边界 |
| **资源配额（后置）** | 单 App | DB 文件大小上限、单查询超时 |

### 6.2 硬不变量（安全）

1. **App A 的 handler 不得获得 App B 的 `Database` 或路径。**  
2. **禁止** SQL `ATTACH DATABASE` 指向其他 App 路径（运行时包装 query API 或禁用 ATTACH）。  
3. **禁止** 相对路径跳出 `apps/<extensionId>/`。  
4. Gateway 调用必须同时校验：`extensionId`（来自 Tool/surface）= LDR path 中的 id。  
5. Trusted Native **不得** `require('better-sqlite3')` 打开业务库；只许 `host.business`。  
6. HTML Artifact **不得** 直连 loopback LDR；只许 Bridge → Gateway。

### 6.3 同项目多 App 协作

默认 **不共享表**。若产品需要「订单 App + 库存 App」协作：

| 模式 | 说明 | v1 |
|------|------|----|
| **事件/联动** | Workbench 同扩展内事件；跨扩展后置 | 跨扩展不做 |
| **显式共享库** | `shared/<name>.sqlite` + 双 App 声明 `usesShared: ["inventory"]` + 用户确认 | 后置 |
| **经 Gateway 互调** | A 的 action 调 B 的 action（仍隔离库） | 可规划，v1 可选 |

v1 推荐：需要共享数据时 **合并为一个 extensionId**（多 Surface），而不是两库乱连。

### 6.4 项目隔离

| | 行为 |
|--|------|
| 切换 OpenChamber 项目 | LDR 使用该 `projectId` 下路径；连接池切换/关闭上一项目句柄 |
| Board Pin | 仍按项目；数据默认项目本地 |
| 误用 | action 不得跨 projectId 打开他项目 sqlite |

### 6.5 并发与锁

- better-sqlite3 **单连接写串行** 足够小组件。  
- 每 App 自有连接；跨 App 无锁竞争。  
- 长写入用 transaction；设置 `busy_timeout`。  
- 查询超时：包装层对 handler 做 Promise.race（防拖死事件循环——注意同步 SQL 仍会占线程；v1 规范要求 handler 短小）。

---

## 7. Host-local App 包结构（开发与安装）

### 7.1 推荐目录

```text
my-orders-app/
├── openchamber.extension.json      # OCIX manifest
├── server/                         # LDR 侧（仅自研/安装后落数据面）
│   ├── package.json                # 可选：若需本地依赖，规范受限
│   ├── index.ts                    # 注册 actions → handlers
│   ├── migrations/
│   │   └── 001_init.sql
│   └── actions/
│       ├── orders-list.ts
│       └── orders-approve.ts
├── ui/
│   ├── declarative/
│   │   └── overview.view.json
│   └── artifacts/                  # 可选
│       └── explorer.html
├── dist/                           # Trusted Native 可选
│   └── ui.mjs
└── agent-runtime/
    ├── tools/
    │   ├── orders_open_overview.ts
    │   └── …
    └── skills/
        └── orders-local-data/
```

### 7.2 manifest 要点

- `connectors`：`type: local-data`  
- `actions`：全部指向该 connector；`risk`/`permission`/`localData.actionId`  
- `views` / `artifacts`：与现规范相同  
- **不要求** 第三方签名即可 **开发目录加载**；**分发**仍走 Local 全量包或未来导出流程  

### 7.3 server 代码加载信任

| 模式 | 信任 |
|------|------|
| 开发目录 `OPENCHAMBER_…_EXTENSIONS_DIR` | 本机开发者信任；不进签名安装叙事 |
| 签名 `.ocix` 安装 | server 文件进签名索引 + hash 复核（与现 OCIX 一致） |
| Remote Hosted 第三方 | **默认不加载远端任意 server 进 LDR**；第三方业务在厂商 API |

**重要：** LDR 的 server handlers 与 Trusted Native 一样是 **高信任代码**（同进程）。  
因此：

- 开发态 = 用户明确加载的目录  
- 分发态 = 必须签名安装  
- **Remote 只拉 UI 资源的路径，不得默认同源执行远程 server TS**

---

## 8. 与 Hosted / Remote / Local 包的关系

### 8.1 对照

| | Remote Hosted（第三方） | Host-local + LDR（自研） | Local 全量 `.ocix` |
|--|-------------------------|---------------------------|---------------------|
| UI 从哪来 | 签名 Manifest + 懒加载 | 本地/安装包 | 包内 |
| 业务 API | 厂商 HTTP | **LDR SQLite+Hono** | 常接外部或包内约定 |
| 信任 | 指纹 + granted | 开发者本机 / 签名包 | 签名包 |
| 多租户企业 API | 厂商 | 通常单机项目库 | 视扩展 |

### 8.2 「Hosted 怎么设计」（在本底座语境下）

这里的 **Hosted** 拆成两层理解：

#### A. 运行时「寄宿」在 OpenChamber Host 上（Host-local）

```text
OpenChamber Host
  ├── 托管 Surface 渲染
  ├── 托管 Gateway
  └── 托管 LDR（数据+API）
App 只提供：manifest + server handlers + ui + tools
```

这是 **默认开发与内测形态**。

#### B. 协议上的 Hosted 薄包分发（可选毕业）

自研完成后若要给同事/环境分发：

| 毕业路径 | 做法 |
|----------|------|
| **Local 全量包** | 打进 UI + server + tools + migrations；安装后 LDR 从包路径加载 handlers、数据仍在 dataDir |
| **薄包 + 内网 Manifest** | UI 可 Hosted；**server/LDR 仍应本地或受控**，不能默认「远端下载可执行 handler 就跑」 |
| **纯远程业务** | 后端迁到真 HTTP 服务，connector 改为 http，**脱离 LDR** |

**产品建议：**

1. 开发：Host-local + LDR  
2. 内部分发：签名 Local `.ocix`（含 server）  
3. 对外 SaaS：自建 API + Remote Hosted **仅 UI**（若需要）

### 8.3 数据是否进包？

| | 进 `.ocix`？ |
|--|-------------|
| migrations / handler 源码 | **是**（分发时） |
| `data.sqlite` 用户数据 | **否**（永远在 dataDir） |
| seed 数据 | 可选 `server/seed.sql`，首次 migration 后执行 |

---

## 9. 给 Agent 的 Host-local App 开发规范

> 本节可直接作为 Skill / scaffold 说明的源。

### 9.1 何时用本规范

用户意图类似：

- 「在 OpenChamber 里做一个本地订单/库存/备忘模块」  
- 「小组件要存数据、列表、确认批准」  
- 「不要外部数据库、不要 Docker」

**不要**用于：接客户已有 CRM 公网 API（应走 Remote + 厂商 API + Gateway http connector）。

### 9.2 强制架构

```text
1. UI：Declarative 优先；复杂态 Trusted Native；画布类 Artifact
2. 数据：仅通过 actions → Gateway → LDR
3. 存储：本 App 自己的 SQLite（由 LDR 管理路径）
4. 禁止：前端 fetch loopback、前端 better-sqlite3、硬编码绝对路径
5. 写操作：manifest risk=write + permission=ask（需确认的业务）
```

### 9.3 Scaffold 检查清单（Agent 必须生成）

- [ ] `openchamber.extension.json` 合法 id（反向域）  
- [ ] `connectors[]` 含 `local-data`  
- [ ] 每个 UI 操作有对应 `actions[]`  
- [ ] `server/migrations/001_*.sql`  
- [ ] `server/index.ts` 注册 action handlers  
- [ ] 至少一个 Declarative view + open Tool  
- [ ] Skill 说明「如何打开与演示」  
- [ ] `.gitignore` 忽略本地 sqlite（若数据在仓库旁路目录）

### 9.4 Action 设计规范

| 规则 | 说明 |
|------|------|
| 命名 | `domain.verb` 如 `orders.list` / `orders.approve` |
| 全局 id | `extensionId` 前缀或 manifest 完整 id 与 Gateway 一致 |
| 读 | `risk: read`, `permission: allow` |
| 写 | 默认 `permission: ask`；幂等写标 `idempotent: true` |
| 输入 | JSON 可校验；拒绝巨型 blob（上限后定，如 256KB） |
| 输出 | 稳定 JSON；列表带 `items`；错误用 code |
| SQL | **仅参数化**；禁止字符串拼接 SQL |
| 事务 | 多步写包在 transaction |
| 时长 | handler 目标 &lt; 100ms 量级；禁止超长同步扫描全表无 LIMIT |

### 9.5 Handler 伪代码模板

```ts
// server/actions/orders-approve.ts
export const actionId = "orders.approve";

export function handle(ctx: LocalDataContext, input: { id: string }) {
  if (!input?.id) {
    return { ok: false, error: { code: "validation_failed", message: "id required" } };
  }
  const result = ctx.db
    .query(
      `UPDATE orders SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'open'`
    )
    .run(new Date().toISOString(), input.id);
  if (result.changes === 0) {
    return { ok: false, error: { code: "conflict", message: "order not open or missing" } };
  }
  return { ok: true, data: { id: input.id, status: "approved" } };
}
```

`LocalDataContext`（平台注入，**只读字段**）：

```ts
type LocalDataContext = {
  extensionId: string;
  projectId: string;
  db: AppDatabase;        // 已限制 ATTACH / 路径的包装
  now(): string;
  requestId: string;
  // 无：其他 App 的 db、filesystem 任意路径、环境密钥全集
};
```

### 9.6 Declarative 绑定规范

- `query` 调 `….orders.list`  
- `rowActions` 调 `….orders.approve`（确认写）  
- 成功后依赖平台写后刷新 query  

### 9.7 Trusted Native 规范（若使用）

- 只用 `host.ui` + `host.business`  
- 禁止动态 `import` 本地 db  
- 错误展示用 Host Notice  

### 9.8 禁止清单（Agent 违反即错）

1. 在 UI 中写死 `http://127.0.0.1:…` 调 LDR  
2. 创建 `shared` 库或 ATTACH 他 App  
3. 把用户数据 sqlite 打进 git / ocix  
4. 使用 `eval` / 动态 SQL 表名来自用户输入且未白名单  
5. 监听 `0.0.0.0`  
6. 为「方便」共用一个全局 `data.sqlite` 给所有扩展  
7. 远程下载 handler 代码执行（开发目录与签名安装除外）

### 9.9 最小验收剧本（Agent 自测说明）

1. 启用扩展 → health ok  
2. 打开 overview → 列表可空  
3. seed 或 create → 列表有数据  
4. approve → 确认弹窗 → 状态变  
5. 再装另一 demo App → **看不到** 本 App 订单表数据  

---

## 10. 生命周期

```text
安装/开发加载
  → 校验 manifest + server 入口
  → 注册 action handlers 到 LDR
  → 确保 project/app 目录存在
  → （懒）open db + migrate

首次 action / 打开 surface
  → migrate if needed
  → dispatch

禁用
  → 注销路由；关闭 db；保留文件

卸载
  → 禁用 + 可选删数据

项目切换
  → 关闭旧 project 连接；新 project 路径

OC 退出
  → close all db；stop listen
```

---

## 11. 安全汇总

| 层 | 控制 |
|----|------|
| 网络 | loopback + 内部 token |
| 数据 | per-app 文件；禁 ATTACH 他库 |
| 调用 | Gateway action 合同 + 确认写 |
| 代码 | 开发目录本机信任 / 分发签名 |
| UI | 无直连 db/http LDR |
| 日志 | 无全表 dump；无密钥 |

---

## 12. 打包进客户端

| 组件 | 是否额外体积 |
|------|----------------|
| better-sqlite3 | **已有** Electron rebuild 链路 |
| Hono | 新增 JS 依赖（轻） |
| LDR 代码 | OC server 模块 |
| App | 用户安装/开发目录，非必须预置 |

**不**引入 PocketBase Go 二进制（本选型下）。

---

## 13. 分期（未来实施，本步不写代码）

| Phase | 内容 |
|-------|------|
| **L0** | 本文评审冻结 |
| **L1** | LDR 内核：路径、open/close db、migration、in-process dispatch、token |
| **L2** | Hono loopback + Gateway `local-data` connector |
| **L3** | scaffold CLI/模板 + Agent skill 规范落地 |
| **L4** | 多 App 隔离测试、卸载清数据、配额 |
| **L5** | 可选：只读数据浏览页、导出备份、shared 库（若仍需要） |

---

## 14. 验收清单（未来）

### 功能

- [ ] 单 App CRUD 经 Gateway 跑通  
- [ ] 确认写 approve  
- [ ] 双 App 数据互不可见  
- [ ] 项目切换数据不串  
- [ ] 禁用/卸载/清数据行为符合 §4.5 / §10  

### 安全

- [ ] 无 token 拒绝  
- [ ] 非 loopback 拒绑  
- [ ] ATTACH 他 App 路径失败  
- [ ] UI 直连尝试失败（契约测试）  

### 打包

- [ ] Desktop 含 better-sqlite3 原生模块  
- [ ] 无额外 Go 二进制依赖  

---

## 15. 开放问题

| # | 问题 | 倾向 |
|---|------|------|
| Q1 | 默认仅 in-process 还是默认开 loopback 端口？ | 默认 in-process；dev 开端口 |
| Q2 | App server 用 TS 谁编译？ | 安装前 build 进 dist；dev 用 bun 直接跑 |
| Q3 | 是否允许 App 自带 npm 原生依赖？ | v1 **否**，只能用平台注入的 ctx.db |
| Q4 | WAL 跨平台文件锁 | 沿用 better-sqlite3 默认；测 Desktop |
| Q5 | 与现有 git 用的 better-sqlite3 共存 | 独立连接与路径，无问题 |
| Q6 | 多窗口多 project 同时开 | 连接池按 projectId+extensionId |

---

## 16. 文档索引与维护

| 文档 | 关系 |
|------|------|
| 本文 | LDR + 自研 App 规范 |
| [OCIX_REMOTE_MODE_DETAILED_PLAN.md](./OCIX_REMOTE_MODE_DETAILED_PLAN.md) | 第三方 Remote；§12 Host 理念由本文具体化 **场景 B** |
| [OCIX_DUAL_PATH_…](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md) | 总纲；Server 开发 = LDR |
| 开发手册 | 三种 Surface；不替代本文 server 规范 |

**维护：** 选型或隔离不变量变更时先改本文；实施前开 L1 任务，不在未评审时写代码。

---

## 17. 结论

1. **底座** = **better-sqlite3（存）+ Hono（薄 API）+ OpenChamber 内嵌进程**。  
2. **Hosted/自研** = App 寄宿在 Host 上，数据在 per-app SQLite；与 **Remote Hosted 第三方** 分流。  
3. **多 App 隔离** = 文件、连接、路由、action、Gateway、Tool 全维度默认切断。  
4. **Agent** 按 §9 生成 manifest + migrations + handlers + Declarative，禁止 UI 直连。  
5. **本阶段只交付规划，不实施。**

---

*End of plan.*
