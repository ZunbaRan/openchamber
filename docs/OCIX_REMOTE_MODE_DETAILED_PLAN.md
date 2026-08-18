# OCIX Remote 模式详细规划

> **状态**：**R1–R3 已实现并合入；R4 指引、三类参考服务、自动化与本机验收包已完成，待用户实机验收**
> **日期**：2026-08-05（状态回写 2026-08-07）
> **父文档**：[OCIX 双场景愿景](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md)（场景 A 主路径展开）
> **范围**：第三方 **Remote** 连接、信任、Manifest、懒加载、TTL 缓存、health/update、re-consent
> **Host / 自研 API 基座**：场景 B 的当前唯一合同是 **better-sqlite3 + existing Gateway direct adapter**，见 [P3详细蓝图](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md#5-p31local-data-runtime) 与 [Local Data决策入口](./OCIX_LOCAL_DATA_RUNTIME_PLAN.md)（与本文 Remote 正交、仍未获实施授权；Hono不属于P3.1）

---

## 0. 文档怎么用

| 读者 | 读什么 |
|------|--------|
| 产品 / 决策 | §1–§3、§11、§13 |
| 协议 / 安全 | §4–§8、§10 |
| 实现 / 维护 | §5–§9、§14–§15；R1–R3 代码已合入，后续变更应保持本文安全不变量 |
| Host API 基座设计 | 只读 §12；**不在本阶段落地** |

**与父文档关系：** 双场景愿景仍是总纲；本文既是 **Remote 第三方路径** 的实现合同，也是剩余实机验收清单。若冲突，以本文对 Remote 的安全与生命周期合同为准，并回写父文档摘要。

**当前事实：** R1（安全连接）、R2（懒加载与 TTL）、R3（health/update 与完整 re-consent 生命周期）已实现并合入。R4 已提供独立 Direct Remote 开发指南、Declarative / Trusted Native / HTML Artifact 三类 loopback 参考服务、真实 Host 集成测试、本机 Electron 验收包与用户测试清单；仅剩用户实机记录。Local Data Runtime / Dev Hosted 不在这些提交范围内。

---

## 1. 前因后果

### 1.1 前因：我们已经有什么

OpenChamber OCIX 已具备较完整的 **Local / Hosted 技术栈**：

| 能力 | 现状（摘要） |
|------|----------------|
| Local 全量 `.ocix` | 签名包、Extension Manager、Publisher 指纹确认、Agent Tool/Skill 受管安装 |
| Hosted 薄包 | 薄包内身份 + 远程签名 Manifest URL；验签、资源 SHA、权限扩大确认、有界 last-good 缓存 |
| Surface | Declarative / Trusted Native / HTML Artifact + Business Gateway |
| Workbench | Catalog / Board / Pin 等（与交付模式正交） |
| Connector Auth v1 | Key 服务端保管、Gateway 注入、确认式 write |

父文档 [OCIX_DUAL_PATH…](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md) 已定：

- **场景 A（第三方）** 默认 **Remote Hosted**，不是默认发全量包
- **场景 B（自研）** Local / Dev Hosted + 未来 Server 开发
- 协议不另起「裸 connect」平行标准

### 1.2 问题：为什么还要单独规划 Remote

| 痛点 | 说明 |
|------|------|
| **分发心智** | 企业 SaaS 期望「给 URL + Key 就能用」，而不是发 zip / 教用户装包 |
| **热更** | Signed Manifest、Surface/icon资源与能力metadata可在服务端演进；不应要求终端用户反复装 `.ocix` |
| **与现网 Hosted 的差距** | 现有 Hosted 仍偏「薄包文件 + 有界落地缓存」；产品目标是 **零文件 UX + 懒加载 + TTL** |
| **信任叙事易混** | Access Key 常被误当成「代码也安全」；必须拆成 **业务身份** vs **内容签名** |
| **权限叙事易激** | 「天花板钉死」易被理解成永不扩权；应改为 **granted + re-consent（像更新协议）** |
| **Native 恐惧** | 同页代码信任成本高；Remote 默认应压低 Hosted Native 曝光 |

### 1.3 决策（已拍板）

1. **第三方默认 Remote**：URL + Key + 首次指纹/权限确认。
2. **`connect` 只处理签名 Manifest + 信任绑定**，不预拉全部 UI。
3. **Surface/icon等signed资源按需拉取**，校验path级`sha256`；Agent Tool由Host根据已验surface/tool/routing metadata生成受管shim，不下载任意Tool/Skill脚本。
4. **TTL 短缓存**（Surface/icon资源 + 已接受 Manifest 元数据/本体按策略），过期清理；**不做**第三方永久全量镜像。
5. **权限 = granted + re-consent**：可抬高，禁止静默扩大；`nativeCode` 0→1 同机制、更重策略。
6. **更新 = 分类自动**：权限未扩大可静默切换 accepted Manifest；扩大/换钥必须确认。
7. **流量不是优化一等公民**；瓶颈假设在 Agent 思考。
8. **业务 Host / API 基座** 本阶段只定理念，**不设计具体底层 API、不实施**。

### 1.4 后果（接受与不接受）

**接受：**

- 首次打开某 Surface 可能多一次资源下载（相对 Local 全量）。
- 缓存过期 + 离线 → 对应Surface资源不可用（信任态与Host受管Tool metadata仍在，需网络刷新）。
- 厂商必须维护 **可签名的 Manifest 发布流水线** 与稳定资源 URL/hash。
- 产品文案要教会「连接应用」≠「代码无害」。

**不接受：**

- 用 Key 代替包/Manifest 签名。
- 静默扩大权限或静默启用 Hosted Native。
- 无 hash 的裸 CDN 加载 Native 进主页面。
- 把 Remote 做成第三套与 Hosted 无关的协议（应是 Hosted 的产品主路径形态）。

### 1.5 成功时的世界（结果）

```text
用户：填应用 URL + Access Key → 确认指纹与权限 → 日常零配置
厂商：发版 = 签新 Manifest + 上新资源；不必逼用户重装客户端
OpenChamber：持有信任态 + TTL 缓存；Gateway 仍管业务调用与确认写
Agent：通过已注册 Tool 打开 Surface / 调业务；失败可解释（Key/网络/待确认权限）
```

---

## 2. 范围与非范围

### 2.1 本规划范围内（Remote 协议与产品合同）

- Remote 用户旅程与配置负担
- `connect` / `health` / `update_check` / `update_apply` 语义
- 签名 Manifest、指纹、granted、re-consent
- 资源懒加载、TTL 缓存键与失效
- 与 Declarative / Native / Artifact 在 **加载路径** 上的差异（不重写三种 runtime 本身）
- Host从已验surface/tool/routing metadata生成受管Agent Tool shim的边界；Remote不下发任意OpenCode Tool/Skill文件
- 错误码与可观察性要求
- 相对现有 Hosted 薄包的迁移方向
- Phase 状态、维护边界与剩余验收清单

### 2.2 本规划非范围（本阶段不做）

| 项 | 说明 |
|----|------|
| **新增协议分叉** | 不另造绕过 Hosted 签名、granted 与 Gateway 的 Remote 协议 |
| **业务 Host / API 基座具体设计** | 路由表、SDK 形状、语言栈、进程模型 → 仅 §12 理念 |
| **Server 开发（场景 B）** | 父文档 Phase 3–4，另文 |
| **官方公共 Marketplace 运营** | 审核组织、公网目录运营 |
| **跨 OCIX 事件联动** | Workbench 已有同扩展联动即可 |
| **把 MCP App 并入 OCIX** | 平行轨保持 |
| **Windows/Linux/Capacitor 与 macOS 同等证据** | 可并行，非 Remote 协议前置 |
| **Generative Widget** | 独立对话轨，无 Gateway |

### 2.3 与现有 Hosted 的定位

| | 既有 Hosted 薄包路径 | 当前 Remote（R1–R3） |
|--|---------------------------|--------------------------------|
| 入口 | 常需薄 `.ocix` + manifestUrl | **URL+Key 向导**（可不出现文件） |
| connect | 偏安装/refresh 拉资源落地 | **只验 Manifest + 信任态** |
| 缓存 | 有界 last-good 文件树 + 强 integrity 扫描 | **TTL 短缓存**；过期清理；非永久镜像 |
| 权限 | permission expansion + 确认 | 明确 **granted + re-consent** 产品语义 |
| 协议内核 | 签名 Manifest + SHA 资源 | **同一内核**，UX 与缓存策略演进 |

结论：**Remote = Hosted 内核上的产品主路径**，不是新协议族。

---

## 3. 产品定义

### 3.1 一句话

> **Client 持有 URL、Key 与信任锚；服务端持有可变 UI/能力；运行时 Client 发现签名 Manifest，按需拉取并校验资源；权限扩大须用户 re-consent。**

### 3.2 对外 / 对内

| | 文案 |
|--|------|
| **对外** | 只需应用地址和访问密钥；首次核对发布者指纹与权限；以后权限变多时像更新协议一样再确认；日常自动保持可用。 |
| **对内** | URL+Key → Manifest验签+信任绑定；打开时懒加载Surface/icon+hash+TTL；Host从metadata生成Tool shim；health/update；Gateway仍是业务唯一出口。 |

### 3.3 用户旅程

```text
【首次】
  设置/向导：应用 URL + Access Key
    → 拉取签名 Manifest 并验签
    → 展示：应用名、发布者指纹、权限摘要（含是否 nativeCode）
    → 用户确认
    → 写入信任态（granted、指纹、acceptedManifestMeta）
    → Key 入 Secret Store
    → （可选）轻量 health
    → 完成「已连接」——此时可不曾下载任何业务 UI 文件

【日常 · 对话打开 Surface】
  Agent Tool 或用户点磁贴
    → health（可 TTL 合并）
    → update_check（Manifest）
    → 若权限扩大 → re-consent 弹窗
    → 解析 entry 依赖 path
    → TTL 缓存命中？否则拉取 + hash + 写入缓存
    → 渲染 Declarative / Artifact /（若允许）Native
    → 业务读写走 Gateway（确认写不变）

【日常 · Agent Tool】
  Host读取已验Manifest中的surface/tool/routing metadata
    → 生成受管Tool shim并保持Tool名⊆granted.agentToolNames
    → business调用仍走Gateway；不下载/执行远程OpenCode Tool或Skill文件

【权限变多】
  新 Manifest candidate 有 expansion
    → 阻止静默切换
    → 弹窗展示 diff（多了哪些 origin/action/native…）
    → 同意：granted 抬高，接受新 Manifest
    → 拒绝：旧合同继续
```

### 3.4 配置负担目标

| 操作 | 频率 |
|------|------|
| URL | 首次 / 换环境 |
| Access Key | 首次 / 轮换 |
| 指纹 + 权限确认 | 首次；换钥；权限扩大 |
| 日常使用 | 零额外配置 |

---

## 4. 架构总览

### 4.1 逻辑结构

```text
┌─────────────────────────────────────────────────────────┐
│                 OpenChamber Host（统一栈）                 │
│  UI 向导 · Extension Manager/信任库 · TTL 资源缓存        │
│  Surface 渲染 · Workbench · Gateway · Connector Store     │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
     签名内容面 │                     │ 业务身份面
                ▼                     ▼
     厂商签名 Manifest            Access Key
     + 资源 CDN/源站              → Secret Store
                │                     │
                │                     ▼
                │              第三方业务 API
                │              （RBAC 归厂商）
                ▼
     Declarative / Artifact / Native(可选)
```

### 4.2 两条证明链（硬约束）

| 链 | 证明 | 不得证明 |
|----|------|----------|
| **签名 / 指纹** | 内容发布者与完整性 | 业务 API 授权 |
| **Access Key** | 业务系统授权调用 | Surface资源或Host-generated shim未被篡改 |

禁止：Key 代替签名；盲信响应体里的 fingerprint 字符串。

### 4.3 正交轴（保持父文档）

| 轴 | Remote 下默认 |
|----|----------------|
| 交付 | Remote Hosted（主） |
| 渲染 | **Declarative 首选**；Artifact 适合自由表现；**Native 默认关/强确认** |

---

## 5. 协议详细设计

### 5.1 对象与术语

| 术语 | 定义 |
|------|------|
| **appEntryUrl** | 用户配置的 **Signed Hosted Manifest URL**；现行R1–R3直接fetch/verify该文档，不存在厂商自定义connect握手端点 |
| **Signed Manifest** | 厂商签名的 Hosted Manifest 文档（与现 `HostedOcixManifestV1` 内核对齐） |
| **resource** | Manifest `resources[]` 一项：`path, url, mimeType, sha256` |
| **fingerprint** | 由验签用发布者公钥材料 **本地派生** 的稳定摘要 |
| **candidate permissions** | 当前验签 Manifest 推导的权限摘要 |
| **granted permissions** | 用户已同意的权限集合（持久） |
| **expansion** | candidate 相对 granted 的增量 |
| **accepted Manifest** | 用户合同下当前生效的 Manifest（元数据持久；本体可缓存） |
| **TTL 缓存** | path+sha256（及 extension/manifest 维度）绑定的短时字节缓存 |
| **信任态** | 持久：指纹、granted、acceptedManifestMeta、连接配置；**不含**永久全量文件树 |

### 5.2 `connect`（首次与重连）

#### 输入

```text
appEntryUrl
accessKey          // 或后续 setup code → issued-key 流（可沿用 Connector Auth v1）
```

#### 处理步骤（合同）

```text
1. 将`appEntryUrl`作为Manifest URL直接获取Signed Manifest字节；不解析第二种握手response
2. 验签（Ed25519 等，canonical payload）
   失败 → 拒绝，不写信任，Key 不用于「证明包合法」
3. 校验 schema / 身份字段 / resources 索引合法性
4. derive candidate permissions
   （含：资源 origin ⊆ 声明；native view ⇒ nativeCode 与 trust.mode）
5. fingerprint = F(publisher key material)
6. 决策：
   - 新指纹 → 强制确认 UI
   - 已知且 candidate ⊆ granted → 可无二次确认（策略允许时）
   - expansion 或换钥 → re-consent
7. 用户确认后：
   - 持久化信任态（§7）
   - Access Key → Connector Secret Store
8. 停止。不预拉 resources[] 全量。
```

#### 确认 UI 最低信息

- 应用显示名、extensionId、version
- 发布者指纹（可复制）
- 权限摘要：origins、actions、tools、clipboard/popups、**是否含同页 Native**
- 风险句：Key 只用于业务；内容由签名保证

#### 输出状态

```text
status: connected | pending_consent | rejected | error
extensionId
fingerprint
grantedPermissions          // 若已确认
acceptedManifestMeta        // version, manifestHash, keyId, …
connectorBinding            // 元数据，无明文 Key
```

### 5.3 `health`（连通性）

#### 触发

| 时机 | 行为 |
|------|------|
| 启动且有 Remote 扩展 | 后台批量，限流 |
| 打开 Surface / 磁贴 | 对该扩展 health（短 TTL 合并，如 30–60s） |
| Agent 即将调业务 Tool | 失败则 **可行动错误**，禁止静默空数据装成功 |
| 用户「测试连接」 | 立即 health + 可选 update_check |

#### 结果语义

| 结果 | 含义 | 客户端 |
|------|------|--------|
| `reachable` | 入口和/或业务 test 成功 | 正常 |
| `unreachable` | 网络/5xx/超时 | 明确离线 |
| `unauthorized` | 401 | 提示轮换 Key |
| `forbidden` | 403 | 业务侧权限不足 |
| `trust_invalid` | 签名/指纹合同失效 | 阻断，要求重新确认 |

**硬规则：** `reachable` **不是**授权源；不能替代 granted，也不能替代确认写。

#### 探针分层

| 探针 | 目的 |
|------|------|
| **入口探针** | Signed Manifest URL 可达且仍能进入同一验签链 |
| **业务探针** | Connector `test`（如 `GET /health`）+ 服务端注 Key |

### 5.4 `update_check` / `update_apply`

#### `update_check`

比较远程最新签名 Manifest 与本地 `acceptedManifestMeta`。

概念输入：

```text
extensionId
currentVersion / currentManifestHash
```

概念输出：

```text
status: none | available | required
remoteVersion
remoteManifestHash
changeSummary?                 // 展示用
permissionDelta: none | expanded | reduced
requiresUserConfirmation: boolean
// 完整切换仍以「拉取并验签完整 Manifest」为准
```

#### 分类自动更新（拍板）

```text
none → 结束

available 且 expansion = ∅（可 reduced）
  且 无 nativeCode 新增
  且 新 Manifest 验签通过
  → 自动：acceptedManifestMeta 切换到新版本
  → 不预拉全量资源；旧 TTL 条目因 sha256 维度自然失效
  → 已打开实例：默认保持至刷新；Native 禁止运行中热替换

available 且 expansion ≠ ∅
  或 nativeCode 0→1
  或 指纹/换钥
  → 不自动 apply；re-consent
  → 拒绝则整份合同留在旧 Manifest

required（厂商标强制，如安全回滚）
  → 尝试 apply（仍须验签）
  → 若含 expansion 仍须 re-consent（安全补丁且扩权时两者叠加）
  → 失败则 blocked，展示原因
```

#### 与「拉资源」的关系

- `update_apply` **默认只切换 accepted Manifest 合同**，不要求立刻下载所有 path。
- 下次打开Surface/icon时按**新hash**拉取；缓存键含sha256，旧字节不会误用。Host受管Tool shim按新verified metadata reconcile，不拉任意脚本。

### 5.5 资源懒加载

#### 触发

- 渲染某 `view` / `artifact`
- 需要已验Manifest allowlist中的Surface/icon资源
- 显式「刷新此 Surface」

#### 步骤

```text
1. 读取当前 accepted Manifest（内存或缓存；过期则先 update/刷新 Manifest）
2. 解析目标 entry → 依赖 path 集合（含传递依赖若协议声明）
3. for path in paths:
     cache_key = (extensionId, path, sha256, manifestHash?)
     if cache hit && !expired → use
     else:
       GET url（HTTPS；仅 loopback 可 http）
       校验 Content-Type 与 mimeType 策略
       校验 body sha256
       origin ⊆ granted.resourceOrigins
       写入 TTL 缓存
4. 交给对应 runtime 加载器（Declarative / Artifact / Native）
```

#### 失败

- hash/MIME/origin 失败 → **不用**该字节、不写入有效缓存
- 可重试；可提示「扩展资源校验失败」
- **禁止**回退到「未校验的任意 URL 内容」

### 5.6 TTL 短缓存（拍板细节）

#### 缓存什么

| 类别 | 示例 |
|------|------|
| UI | Declarative JSON、Native ESM、Artifact HTML/CSS/资产 |
| Agent能力metadata | 随Signed Manifest验签/更新；Host据此生成受管Tool shim，不作为远程脚本resource执行 |
| 合同 | 已接受 Manifest 本体（或等价元数据 + 按需再拉） |

#### 不缓存什么（持久层）

- Access Key / setup code
- 业务 API 响应体（Gateway 另议，非本缓存）
- 未通过校验的脏字节

#### 键与失效

```text
建议键：extensionId + path + sha256
可选再加：manifestHash（调试用）

失效：
  - ttl 到期 → 删除
  - accepted Manifest 切换导致 sha256 变化 → 旧键 naturally miss
  - 用户断开/卸载扩展 → 清空该 extension 缓存
  - 手动「清除扩展缓存」
```

#### TTL 建议

| 参数 | 建议默认 | 说明 |
|------|----------|------|
| `resourceCacheTtlSeconds` | 15–60 分钟 | 企业可配 |
| `updateCheckTtlSeconds` | 30–60 秒 | 合并探测 |
| `healthTtlSeconds` | 30–60 秒 | 合并探针 |

#### 性能立场

- 不为抠流量牺牲正确性。
- 假设用户体感瓶颈在 **Agent 思考**。
- TTL 的价值：同会话重复打开、Workbench 多 tile、脚本二次加载。

### 5.7 granted 与 re-consent

#### 权限字段（与现 Hosted 对齐，可演进）

```text
resourceOrigins
networkOrigins
externalLinkOrigins
credentialScopes
actionIds
agentToolNames
clipboard
popups
nativeCode
```

#### expansion 规则（集合差）

- 列表类：candidate 中多出的元素
- 布尔类：false→true（含 `nativeCode`）
- reduced：可静默（能力变少）

#### re-consent UI（协议更新感）

必须展示：

- 应用名、新旧 version（若有）
- **新增**权限 diff（人话 + 技术 id）
- 若含 `nativeCode`：单独风险段「将允许在 OpenChamber 主界面运行该扩展代码」
- 同意 / 拒绝；拒绝后旧版能力仍可用（除非 `required` 失败进入 blocked）

#### 同意后

```text
granted = candidate
acceptedManifestMeta = new
可选：失效与旧 sha 相关的缓存（或依赖键自然失效）
```

---

## 6. 运行时加载路径（Remote 下）

三种 Surface **协议形态不变**；变的是 **字节从哪来**。

| Runtime | Remote 加载 | 信任重点 |
|---------|-------------|----------|
| **Declarative** | 拉 `.view.json` 等 → Host renderer | schema 有界 + 签名 hash |
| **HTML Artifact** | 拉 html 等 → sandbox + Bridge | 隔离 + hash；业务走 Bridge→Gateway |
| **Trusted Native** | 拉 ESM → 主页面 activate | **高信任**；默认 Remote 关；须 granted.nativeCode + trust.mode |

**产品默认（第三方 Remote）：**

```text
主推 Declarative
需要自由视觉 → Artifact
Native → allowHostedNative 或显式强确认；文档不作为主路径教程第一步
```

---

## 7. 状态模型

### 7.1 持久信任态（必须）

```text
RemoteExtensionTrust {
  extensionId
  publisherId, keyId
  fingerprint
  grantedPermissions
  acceptedManifestMeta { version, manifestHash, signedAt?, keyId }
  appEntryUrl
  connectorRefs[]
  trustedAt, lastConsentAt, lastConnectAt
  status: active | pending_consent | blocked | disabled
}
```

### 7.2 短暂状态

```text
HealthCache { result, checkedAt }
UpdateProbeCache { result, checkedAt }
ResourceTtlCache { entries: path, sha256, bytes|blobRef, expiresAt }
PendingConsent { candidateManifestMeta, expansion, createdAt }
```

### 7.3 与 Local 全量包对比

| | Local | Remote |
|--|-------|--------|
| 文件树 | 持久安装目录 + 签名索引 | **无**永久全量树 |
| 信任 | 包指纹 + 权限 | 同左语义，入口为 URL |
| 更新 | 换包/升级流 | Manifest update + re-consent |
| 离线 | 通常可用 | 依赖 TTL 未过期缓存 |

---

## 8. 端到端时序（汇总）

### 8.1 首次 connect

```text
User                OC Host                 Vendor
 |-- URL+Key ------->|                        |
 |                   |-- GET Manifest ------->|
 |                   |<-- signed manifest ----|
 |                   | verify + fingerprint   |
 |<-- consent UI ----|                        |
 |-- accept -------->|                        |
 |                   | store trust + Key      |
 |<-- connected -----|                        |
 |                   | (no full UI download)  |
```

### 8.2 打开 Surface

```text
User/Agent          OC Host                 Vendor
 |-- open view ----->|                        |
 |                   | health / update_check  |
 |                   |-- GET Manifest? ------>|  (若需)
 |                   | re-consent if needed   |
 |                   |-- GET resource ------->|
 |                   | hash + TTL put         |
 |                   | render                 |
 |<-- UI ------------|                        |
 |-- business act -->| Gateway + Key -------->| Business API
```

---

## 9. 错误与可观察性

| 错误类 | 用户/Agent 可见（无密钥） | 系统行为 |
|--------|---------------------------|----------|
| Manifest 验签失败 | 发布者验证失败 | 不建立/不切换信任 |
| 指纹变更 | 密钥变化，需重新信任 | pending_consent |
| 权限扩大待确认 | 列出新增项 | 停在旧合同直至决定 |
| 资源 hash 不符 | 资源损坏或被篡改 | 不用、不缓存 |
| 缓存过期且不可达 | 需要网络刷新 | 明确失败 |
| 401/403 | Key 无效或业务拒绝 | 指导轮换 Key / 找管理员 |
| unreachable | 网络或服务不可用 | 不伪造业务数据 |
| native 未授权 | 未允许同页代码 | 拒绝加载 Native entry |

**日志禁区：** Access Key、setup code、原始业务响应体、完整 Secret。

**诊断可含：** extensionId、manifestHash、path、error code、fingerprint 前缀、permission diff（无敏感值）。

---

## 10. 安全不变量（清单）

1. 内容信任只来自 **验签 + hash**，不来自 Key。
2. 指纹只来自 **本地派生**，不来自远端明文字段。
3. 业务调用只经 **Gateway**；Remote UI与Host-generated shim不得持有业务token。
4. 任何时刻生效的权限 ≤ **granted**。
5. expansion 与换钥 **禁止静默**。
6. Native 加载 ⇒ `granted.nativeCode` 且 trust 模式正确。
7. 资源 URL：HTTPS（loopback 例外）；无嵌套凭证；origin ⊆ granted。
8. TTL 缓存不得把未校验字节标为有效。
9. 卸载/断开清除该扩展缓存与（按策略）凭据。
10. health=reachable 不提升权限。

---

## 11. 相对现状的演进路径与当前状态

| 阶段 | 目标 | 说明 |
|------|------|------|
| **R0 合同冻结** | 本文评审通过 | **已完成** |
| **R1 产品层** | URL+Key 向导 + 信任态 + re-consent 文案 | **已实现并合入** |
| **R2 加载策略** | connect 不预拉；懒加载 + TTL | **已实现并合入** |
| **R3 运行时打磨** | health/update 触发矩阵、Workbench、诊断 | **已实现并合入** |
| **R4 厂商文档与参考服务** | 签名发布、权限摘要、三类 runtime 参考 Remote 服务 | **实现完成，待用户实机验收** |
| **Hx Host API 基座** | §12 另项决策后单独立项 | **不随 R1–R3 偷偷做完** |

现有 `hosted-ocix.js` / Manager 的验签、expansion、权限字段是 **可复用内核**；Remote 规划是 **产品路径与缓存/懒加载合同** 的演进，而非推倒重来。

---

## 12. 业务 Host / API 基座——理念与场景 B 选型指针

> **场景 A（第三方 Remote）**：业务 API 在厂商侧；本文只定内容信任与 connect。
> **场景 B（自研 Host-local）**：内嵌底座选型与隔离见 **[P3详细蓝图](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md#5-p31local-data-runtime)** 与 **[OCIX_LOCAL_DATA_RUNTIME_PLAN.md](./OCIX_LOCAL_DATA_RUNTIME_PLAN.md)**（**better-sqlite3 + existing Gateway direct adapter**；未获实施授权）。
> Remote R1–R3 已实施；Local Data Runtime 仍为 **规划态不实施**，直至其 Phase 获得授权。

### 12.1 理念（与 Remote 的衔接；场景 A/B 共用）

| # | 理念 | 含义 |
|---|------|------|
| H1 | **UI 与业务分离** | Remote只拉signed Surface/icon资源；Host从verified metadata生成shim，业务数据与写操作不经由「资源 CDN 自由 fetch」 |
| H2 | **密钥不进前端** | Access Key 仅服务端/Host 保管；注入发生在 Gateway 出站 |
| H3 | **声明式动作边界** | 可调用的业务能力是 Manifest/扩展声明的 action 集合，且 ⊆ granted |
| H4 | **确认式高风险写** | 写操作可要求用户确认；客户端布尔「已确认」无效 |
| H5 | **厂商拥有业务授权** | 第三方 RBAC 在厂商系统；自研 LDR 为项目本地库，不做企业权限中心 |
| H6 | **Remote 不改变上述边界** | Remote 只解决「内容分发与信任」；自研数据面是另一条 connector |

### 12.2 场景 B 当前决策指针（唯一细节见P3蓝图）

- 存储：**better-sqlite3**；部署在 OpenChamber server同进程。
- 调用：既有 Business Gateway在policy/confirmation后 direct `LocalDataRuntime.invoke(request)`；无Hono、无listener、无LDR route prefix。
- 隔离：server-derived `projectKey(v2 canonical scope incarnation) × extensionId` 独立SQLite；publisher/key fingerprint只进meta做接管校验。
- 状态：P3.1仍未获实施授权；未来Hono只可能是独立ADR + 新roadmap slice + 第二真实transport consumer + 依赖评审 + 用户授权，不是P3.1选项。

### 12.3 后续实现者的边界

- 不借 Remote 规划之机重写 Gateway 内核
- 不新增「资源脚本直连业务 API」旁路
- 不借 Remote 维护或验收之机实施未经授权的 LDR / Dev Hosted 代码

---

## 13. 厂商（第三方）责任

| 责任 | 说明 |
|------|------|
| 密钥管理 | 发布者签名密钥与轮换；换钥会触发客户端 re-consent |
| Manifest 发布 | 每版本可验签；resources 完整且 hash 正确 |
| 资源托管 | HTTPS、稳定 URL 或可接受的版本化 URL；MIME 正确 |
| 权限摘要诚实 | 与真实 views/actions/tools/native 一致（客户端会交叉校验） |
| 业务 API | Key 签发、RBAC、审计；提供可探测的 health（若需要） |
| 变更沟通 | 扩权、nativeCode、required 更新应有 changeSummary |

**厂商不必：** 理解 OpenChamber 内部缓存实现；打包 Local 全量（Remote 主路径下）。

---

## 14. 实施分期与当前状态

### Phase R0 — 规划冻结（已完成）

- [x] 详细文档
- [x] 实现所需产品、安全与工程合同冻结
- [x] R1–R3 所需开放问题收口；余项继续由 §16 维护

### Phase R1 — 信任与向导（已完成）

- [x] URL+Key 向导
- [x] connect = Manifest 验签 + 指纹 + granted
- [x] re-consent UI
- [x] 信任态持久化

### Phase R2 — 懒加载与 TTL（已完成）

- [x] 按需资源与脚本
- [x] hash 校验与缓存键
- [x] 过期清理与卸载清理

### Phase R3 — health/update 矩阵（已完成）

- [x] 触发时机、TTL 合并、required、诊断

### Phase R4 — 第三方文档、参考服务与实机验收（待用户验收）

- [x] 审核第三方开发指引与内置 skill 的独立可执行性
- [x] 提供 Declarative / Trusted Native / HTML Artifact、不同品牌色的参考 Remote 服务
- [x] 清洁工作树打包本机客户端，并复验成品内 OpenCode prompt/skill
- [x] 编写供用户执行的测试文档：工作区根 `extension/USER_ACCEPTANCE_TEST.md`
- [ ] **便利性改进（不阻塞本轮实机验收）**：在工作区根 `extension/` 增加 `npm run connect:openchamber`，自动读取 `.runtime/connect-info/*.json`，通过 OpenChamber 正式的 `remote/inspect` → `remote/connect` API 批量连接参考服务；必须使用 inspect 返回的精确 Manifest hash 与发布者 fingerprint、支持幂等重复执行、不在 stdout/stderr/URL/日志中输出 Access Key，且不得直接修改 `installations.json`、`trust.json` 或 `connection-secrets.json`
- [ ] 用户完成真实客户端 × 参考服务验收并记录结果

**依赖 Host API 基座的工作单列 Hx，不阻塞 R0；R1–R3 可在现有 Gateway 上演进。**

---

## 15. 验收清单

R1–R3 合同项已由自动化测试覆盖；下列勾选表示代码与自动化证据齐备，**不表示 R4 的真实第三方服务 / 打包客户端人工验收已经完成**。

### 15.1 功能

- [x] 仅 URL+Key 完成首次连接并出现指纹+权限确认
- [x] 无 `.ocix` 文件时仍有可查询信任态
- [x] connect 后磁盘上 **无** 强制全量 UI 树
- [x] 首次打开Surface才拉对应UI/icon；Host Tool shim由verified metadata生成，任意Remote脚本下载为零
- [x] TTL 命中不再请求；过期后清理并重拉
- [x] 权限未扩大时可自动接受新 Manifest
- [x] 权限扩大 re-consent：同意抬高 granted，拒绝保持旧合同
- [x] nativeCode 扩大强提示 / 策略可拒
- [x] health 失败时业务 Tool 不装成功

### 15.2 安全

- [x] 验签失败永不信任
- [x] 指纹本地派生
- [x] Key 不进前端/日志
- [x] hash 失败不用脏资源
- [x] granted 外 action/origin 被拒
- [x] 无 granted.nativeCode 时 Native 不可加载

### 15.3 体验

- [ ] 日常路径零额外配置
- [ ] re-consent 文案可读（协议更新感）
- [ ] 错误可行动（换 Key / 检查网络 / 待确认权限）
- [ ] 三类参考 Remote 服务在正式打包客户端中均按预期显示并可操作

---

## 16. 开放问题（Remote 协议层）

| # | 问题 | 倾向（若需默认） |
|---|------|------------------|
| Q1（已决，R1） | appEntryUrl 是 Manifest URL 还是独立 connect 握手端点？ | 只接受direct Signed Hosted Manifest URL；`remote/inspect`与`remote/connect`是OpenChamber自身管理API，不是厂商入口协议 |
| Q2 | `resourceCacheTtlSeconds` 默认 15min 还是 60min？ | 30min 起点 |
| Q3 | 离线时是否允许「仅未过期 TTL」只读打开？ | 允许，需标记 stale/offline |
| Q4 | Declarative 打开中是否允许温和热替换？ | 默认否，与 Native 一致「下次打开」 |
| Q5 | 企业预置指纹白名单是否跳过首次确认？ | 可，仍不跳过扩权 re-consent |
| Q6（已决，R2） | Tool/Skill 与 OpenCode 全局目录如何reconcile？ | 不下载任意Remote Tool/Skill文件；Host根据已验surface/tool/routing metadata生成受管Tool shim并按hash/revision reconcile |
| Q7（已决，R3） | `required` 更新失败的阻塞范围 | 整个扩展 fail-closed 为 `remote_update_required_blocked`；旧/新能力都不可执行，直到满足required版本并成功验签/同意，或用户显式安装一个满足合同的已验证版本。不得降级成“只禁新能力” |

Host API 基座问题见 **§12.2**，不在此表强行关闭。

---

## 17. 风险

| 风险 | 缓解 |
|------|------|
| 与现 Hosted last-good 行为双轨难测 | 演进期明确「Remote 默认 TTL」；测试矩阵分模式 |
| 厂商 hash 流水线出错导致大面积不可用 | 校验错误可诊断；保留旧 accepted 合同 |
| 用户厌倦 re-consent | diff 清晰；避免无意义扩权；权限摘要稳定设计 |
| Native 被误开 | 默认 allowHostedNative=off；文案加重 |
| 把 Key 当信任 | 文档/UI 双链说明；安全评审门禁 |
| 范围蔓延到 Host API 重做 | §12 边界 + LDR / Dev Hosted 独立授权 |

---

## 18. 文档与代码索引

| 资源 | 用途 |
|------|------|
| [OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md) | 双场景总纲；Remote 摘要在 §5 |
| [OCIX_CONNECTOR_AUTHENTICATION_V1.md](./OCIX_CONNECTOR_AUTHENTICATION_V1.md) | Key / provision / test |
| [INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md) | 三种 Surface 开发 |
| `packages/web/server/lib/interactive-ui/hosted-ocix.js` | 现有验签/权限/expansion 内核参考 |
| `packages/web/server/lib/interactive-ui/DOCUMENTATION.md` | 现网 Hosted/Local 行为 |
| `docs/diagrams/ocix_dual_path_architecture_roadmap.excalidraw` | 愿景图 |

---

## 19. 当前结论与证据

1. **Remote 第三方路径 R1–R3 已实现并合入**：安全连接 `6473dcbb`、懒加载/TTL `459e27ad`、完整生命周期 `999d4761`。
2. 合入后的相关 server/runtime/manager 测试 179 项通过、production route 测试 7 项通过，workspace type-check 通过；这些是自动化证据，不替代实机验收。
3. R4 仍需以独立参考服务和正式打包客户端完成第三方开发指引、三类 Surface、品牌样式与交互体验验收。
4. **Host / API 基座、Dev Hosted 与 Local Data Runtime 仍未实现**，继续由独立计划和授权控制。

---

*维护：Remote 合同或实现状态变化时更新本文并同步父文档 §5 摘要；Host API 基座单独立项，不在本文扩张实施范围。*
