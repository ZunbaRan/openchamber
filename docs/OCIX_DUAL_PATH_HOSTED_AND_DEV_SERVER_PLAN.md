# OCIX 双场景愿景：第三方远程主路径 + 自研本机/Server 开发

> 状态：**分期实施中：Remote R1–R3 已合入并通过自动化验证；Remote 实机验收、Dev Hosted 与 Local Data Runtime 待完成**
> 日期：2026-08-03（状态回写 2026-08-07）
> **Remote 详细合同与验收（场景 A）**：[OCIX_REMOTE_MODE_DETAILED_PLAN.md](./OCIX_REMOTE_MODE_DETAILED_PLAN.md)
> **P3.1/P3.2 逐文件实施蓝图**：[P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md) §5–§6、§11.1–§11.2（roadmap 仍为 planned，未授权实现）
> **权威边界**：本文是双场景愿景与 Remote R1–R3 历史记录；P3.1/P3.2 的实现合同、文件清单、测试和开始门只以上述 P3 蓝图为准。本文不得单独下发给实现 Agent。
> 关联：
> - [INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)
> - [OCIX_EXTENSION_WORKBENCH_DESIGN.md](./OCIX_EXTENSION_WORKBENCH_DESIGN.md)
> - [OCIX_CONNECTOR_AUTHENTICATION_V1.md](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)
> - [packages/web/server/lib/interactive-ui/DOCUMENTATION.md](../packages/web/server/lib/interactive-ui/DOCUMENTATION.md)

---

## 1. 愿景摘要

OpenChamber 的 OCIX 扩展体系保留 **同一套协议与三种 Surface runtime**，按**使用场景**分流默认交付方式：

| 场景 | 默认交付 | 目标用户 |
|------|----------|----------|
| **A. 第三方扩展** | **Hosted 薄包 + 远程签名 Manifest/UI 资源** 为主；Local 全量包为合规补充 | 企业 SaaS 厂商、内部应用中心 |
| **B. 自研扩展** | **Local 全量包** 或 **Dev Hosted（本机/项目源）**；配套 **Server 开发** 提供本机/项目 API | 产品/开发者在 OpenChamber 内用 Agent 搭业务模块 |

固定原则：

1. **协议不按场景分叉**：仍是 Local 全量 / Hosted 薄包；Declarative / Trusted Native / HTML Artifact 只是 `runtime` 字段。
2. **Remote 主路径 UX**：URL + Key + 首次指纹确认（§5）；`connect` / `health` / `update` 为运行时协议目标。
3. **信任锚**在 **已同意权限（granted）** + 验签派生指纹；**Access Key 只证业务身份**；内容远程签名下发。
4. **更新默认分类自动**（权限未扩大可静默；扩大/换钥必须 **re-consent** 再确认，语义类似更新用户协议）；每次运行主动探测连通性与更新。
5. **Remote 资源**：**connect 只验签 Manifest，不预拉全部UI**；真正打开Surface/icon时再拉并做TTL缓存。Agent Tool由Host根据已验metadata生成受管shim；不下载任意OpenCode Tool/Skill文件（§5.2.5）。
6. **Server 开发**是「API 供给层」，不是第四种 Surface，也不是新的 OCIX 包格式。
7. **MCP App** 仍是平行标准路线（如 tldraw），不并入 OCIX 包模型。

### 架构图（仅 `.excalidraw`）

| 图 | 文件 |
|----|------|
| 双场景历史愿景草图（2026-08-03；含旧Phase编号与已废弃边界，**不可作实现合同**） | [./diagrams/ocix_dual_path_architecture_roadmap.excalidraw](./diagrams/ocix_dual_path_architecture_roadmap.excalidraw) |
| **当前 OCIX 设计架构** | [./diagrams/ocix_current_architecture.excalidraw](./diagrams/ocix_current_architecture.excalidraw) |
| **OCIX ↔ MCP App + 二改切分** | [./diagrams/ocix_vs_mcp_app_extension_architecture.excalidraw](./diagrams/ocix_vs_mcp_app_extension_architecture.excalidraw) |

> 用 [excalidraw.com](https://excalidraw.com) 或本地 Excalidraw 打开；不生成 PNG。历史愿景草图中的“raw项目目录资源源 / 启停健康检查 / 项目沙箱 / P2-P3旧编号”均已废弃，分别被P3蓝图的signed immutable Dev Hosted snapshot、same-process direct LDR、Trusted Host Code和当前roadmap编号取代；低能力Agent不得复制图中文字。

---

## 2. 背景与动机

### 2.1 已有能力

| 能力 | 状态 |
|------|------|
| Local 全量 `.ocix`（UI + Tools + Skills + connectors） | 已实现 |
| Hosted 薄包 + 远程签名 manifest/资源 + 权限扩大再确认 | 已实现 |
| Declarative / Trusted Native / 安装型 HTML Artifact | 已实现 |
| Business Gateway + Connector Auth v1 | 已实现 |
| Extension Manager + Workbench | 已实现 |
| OpenChamber 内「Server 开发」一等功能 | **未实现** |
| 第三方 Remote Hosted 运行时（URL+Key、懒加载、TTL、health/update、re-consent） | **R1–R3 已实现；实机验收待执行** |
| 第三方 Remote 开发指引、多 runtime 参考服务、自动化与本机验收包 | **已完成；只待用户按现有清单实机验收并记录** |

### 2.2 问题

- 第三方扩展若默认 Local 全量，热更成本高，不符合 SaaS 分发习惯。
- 自研用户若只能「外部写服务再装包」，无法形成「Agent 在 OpenChamber 里搭前后端」闭环。
- 若另造「只 connect + skill、无权限天花板」协议，会削弱签名扩展的安全叙事。

### 2.3 决策

**不新增第三套连接协议。**
用 **场景默认值 + Dev 开关 + Server 开发模块** 承接愿景，协议层继续 Local | Hosted。

---

## 3. 术语（对外命名）

| 推荐对外名称 | 含义 | 避免说法 |
|--------------|------|----------|
| **Remote Hosted** | 第三方：薄包 + 公网/内网签名资源源 | 「只 connect」 |
| **Local Package** | 完整 `.ocix`，资源全在包内 | 把全量包叫 Hosted |
| **Dev Hosted** | 自研：Hosted 合约，资源 origin 允许 loopback/项目 dev server | 「本地 hosted」含糊说法 |
| **Local Data Runtime** | 签名 Local full package 的单文件 handler/migration，经 Gateway direct adapter 在 OpenChamber server 同进程运行 | 叫「OCIX 第四形态」或独立 HTTP 进程 |
| **Surface runtime** | declarative \| native \| html-artifact | 三种「远程协议」 |

---

## 4. 目标架构

架构总览见 §1 配图；下列为文字合同。

### 4.1 双场景 × 统一栈

```text
                    ┌──────────────────────────────────────┐
                    │     OpenChamber Host（统一栈）         │
                    │  Workbench · Manager · Gateway · UI   │
                    └───────────────┬──────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
   场景 A：第三方扩展（主路径）                    场景 B：自研扩展
   Remote Hosted                                   Local Package / Dev Hosted
   薄包 + 远程签名 Manifest/UI                     签名本地包或签名开发资源
              │                                           │
              ▼                                           ▼
   厂商业务 API（Connector）                    Local full 才可声明 LDR handler
                                              Gateway → same-process LDR
                                              Dev Hosted 交付signed UI/metadata；Host生成受管Tool shim
```

### 4.2 正交两轴

| 轴 | 选项 | 说明 |
|----|------|------|
| **交付** | Local Package / Hosted（Remote 或 Dev） | 资源从哪来、如何验签 |
| **渲染** | Declarative / Native / HTML Artifact | UI 怎么画、信任边界 |

任意组合合法；产品默认值随场景不同。

### 4.3 推荐默认策略

| | Declarative | Native | HTML Artifact |
|--|:-----------:|:------:|:-------------:|
| 第三方 Remote Hosted | **首选** | 默认禁止或强确认 | **适合** |
| 自研 Local / Dev Hosted | 首选 | **允许** | 适合 |

### 4.4 信任矩阵

| | 第三方 Remote | 自研 Dev | 自研导出/分发 |
|--|:-------------:|:--------:|:-------------:|
| 发布者指纹确认 | 必须 | **必须**：signed manifest 内嵌 publisher，验签后本地派生 | 必须 |
| 权限天花板 | 必须 | **必须** | 必须 |
| 远程资源 SHA/MIME | 必须 | **必须**；无 dev bypass | 必须 |
| 权限扩大再确认 | 必须 | **必须**；拒绝保持 last-good | 必须 |
| Native 远程 | 慎 / 关 | 仍受 Hosted Native policy 与明确确认；不因 loopback 放宽 | 若 Hosted 仍慎 |
| API 进程生命周期 | 厂商 | LDR 仅签名 Local full、由 OpenChamber server 管理；Dev Hosted 不执行 server code | 不随 Hosted UI 包带走 |

---

## 5. Remote 模式协议目标（场景 A 主路径）

本节记录**第三方远程扩展**的产品连接体验。现行R1–R3已经冻结为direct Signed Hosted Manifest URL + OpenChamber自身`remote/inspect→remote/connect`管理流程；不存在厂商自定义「裸 connect」入口协议。

> **详细展开（前因后果、状态模型、时序、验收、Host API 仅理念）**：见 [OCIX_REMOTE_MODE_DETAILED_PLAN.md](./OCIX_REMOTE_MODE_DETAILED_PLAN.md)。Remote R1–R3 已按该合同实现并合入；R4 指引、三类参考服务、自动化与本机验收包已经备齐，唯一待办是用户按现有清单执行真实打包客户端验收并回写证据。Host-local / LDR 仍是独立规划，不因 Remote 完成而视为已实现。

**Remote 协议一句话目标（产品定义）：**

> **Client 持有 URL/Key 与信任锚；服务端持有可变 UI/能力；运行时 Client 按需拉取并校验签名资源（权限扩大须 re-consent）。**

与 MCP 对齐的心智：服务端更新 ≠ 升级 OpenChamber/OpenCode 客户端本体；而是 Client **重新发现** 服务端当前签名 Manifest，并在**实际需要**时拉取对应资源（类似 MCP list / resource 刷新，但多了验签与已同意权限）。

**产品一句话（对外）：**

> 只需应用地址和访问密钥；首次连接时核对发布者指纹与权限摘要；之后需要更多权限时像更新协议一样再确认；日常打开自动检测连通性并按策略用新内容。

**工程一句话（对内）：**

> URL+Key 是连接向导；`connect`完成Manifest验签+信任绑定（隐式安装态），**不预拉UI**；打开Surface/icon时再拉signed resource并hash校验；Host从已验metadata生成受管Tool shim；`health`/`update`探测变更；Surface资源TTL过期清理。

### 5.1 用户配置负担目标

| 用户操作 | 频率 | 说明 |
|----------|------|------|
| 填写 **Signed Manifest URL** | 首次 / 换环境 | direct Hosted Manifest（HTTPS；Dev Hosted loopback属于P3.2独立条件项） |
| 填写 **Access Key** | 首次 / 轮换 | 仅业务身份；进服务端 Secret Store |
| 确认 **发布者指纹 + 权限摘要** | **首次**；指纹变化或**权限相对已同意集合扩大**时再确认 | 像更新用户协议；不可对扩大静默跳过（企业可预置发布者白名单） |
| 日常打开 / 对话使用 | 每次 | **零额外配置**；后台 health/update；资源按需拉 + TTL 缓存 |

相对「选择 `.ocix` 文件 + 再配连接」：配置负担显著降低。
相对「永远只有两个字段、零确认」：多一次人类信任判断，作为默认可接受的最小安全成本。
相对「权限终身钉死」：**允许**通过 re-consent **抬高已同意权限**；禁止的是静默扩大。

**不作为默认主路径：** 仅存 URL+Key、connect 返回未签名任意 JSON、从不展示指纹、从不维护 granted 权限、静默扩大权限。

### 5.2 协议：`connect`（首次与重连）

#### 5.2.1 客户端输入

```text
appEntryUrl   // direct Signed Hosted Manifest URL
accessKey     // 业务 Access Key（或后续 issued-key 的 setup code 流）
```

用户不可见但必须落库的状态（「隐式安装 / 信任态」，**不是**全量 UI 包）：

```text
extensionId, publisherId, keyId
fingerprint              // 本地验签后派生，非远端口述
grantedPermissions       // 用户已同意的权限摘要（可 re-consent 抬高，见 §5.2.6）
acceptedManifestMeta     // version / manifestHash / 签名身份（当前已接受的内容合同）
trustedAt, lastConnectAt
connector endpoint 覆盖（可选）
// 注意：完整Surface资源树不是信任态必存项；见§5.2.5 TTL缓存
```

#### 5.2.2 OpenChamber connect流程的职责拆分

| 链 | 证明什么 | 材料 |
|----|----------|------|
| **签名 / 指纹** | 内容发布者身份与完整性 | 签名 envelope 内公钥/身份 → **本地（或 OC 服务端）验签后计算指纹** |
| **Access Key** | 业务系统授权 | 仅用于 Gateway 调业务 API 或明确的 provision 协议 |

禁止：用 Access Key 代替包签名；禁止盲信响应体里的 `"fingerprint": "..."` 字符串。

#### 5.2.3 Signed Manifest验签结果（签名 payload 内至少包含）

```text
publisher_id, key_id, public_key（或等价身份材料）
app_id / version / display_name
permissions（候选权限摘要，确认后成为 granted）:
  resourceOrigins, networkOrigins, actionIds,
  agentToolNames, nativeCode, clipboard, popups, …
resource_index   // path → url, mimeType, sha256（按需拉取时校验）
signature
```

客户端/OpenChamber Server（**connect 路径**）：

1. 拉签名 Manifest → 验签失败则拒绝；不建立信任；Key 不用于非业务用途。
2. `fingerprint = F(publisher 材料)`（稳定算法，展示如 `sha256-…`）。
3. 从 Manifest 推导 **candidate permissions**（与资源 origin、native views 等交叉校验）。
4. 与信任库比较：
   - **未见过** → 强制 UI 确认（指纹 + 应用名 + 权限摘要）。
   - **见过且 candidate ⊆ granted** → 可完成 connect（可刷新 acceptedManifestMeta）。
   - **换钥或 candidate 相对 granted 有扩大** → **re-consent**（§5.2.6），确认前不切换到扩大后的合同。
5. 确认后写入信任/安装记录（用户可无 `.ocix` 文件，但**不能无安装/信任态**）。
6. Key 仅写入 Connector Secret Store。
7. **connect 不预拉全部Surface资源**；仅在后续打开Surface/icon时按path拉取。Tool/Skill不是远程可执行resource，由Host按已验metadata生成受管shim（§5.2.5）。

#### 5.2.4 与现有 Hosted 的关系

| | 薄包文件安装 | URL+Key 向导 |
|--|--------------|--------------|
| 用户是否看见 `.ocix` | 可能 | **可不看见** |
| 本地是否有安装/信任态 | 有 | **必须有同等记录** |
| 是否预装全量 UI 文件 | 常见为落地缓存 | **默认否**；按需拉 + TTL 缓存 |
| 协议本质 | Hosted | **Hosted 的零文件 UX 壳 + 懒加载** |

#### 5.2.5 资源拉取与 TTL 短缓存（已拍板）

> 命名说明：下文「TTL短缓存」只指Surface/icon等signed resource；§5.5「分类自动更新」指Manifest更新。Host-generated Tool shim不进入远程字节缓存。

**目标：** 信任与内容分离——信任态持久；第三方Surface/icon字节不做成永久本地全量安装树，而用有期限缓存。

| 时机 | 行为 |
|------|------|
| `connect` / 重连 | 只拉并验签 **Manifest**；更新信任元数据；**不**要求拉齐所有 `resources[]` |
| 打开 Surface / 渲染 View | 按 entry 依赖 path **按需** HTTP(S) 拉取 UI 资源 |
| 需要 Agent Tool | Host使用已验Manifest metadata生成/更新受管shim；不拉取或执行任意Remote Tool/Skill脚本 |
| 拉取后 | 对 body 算 hash，必须等于当前 **已接受 Manifest** 中该 path 的 `sha256`；MIME/origin ⊆ granted |
| 缓存写入 | **TTL 短缓存**：只缓存allowlisted Surface/icon资源一段时间；命中则跳过网络 |
| 过期 | TTL 到期 **清理**该条目；下次需要时重新拉取并再验 hash |
| 验签失败 / hash 不符 | 拒绝使用该资源；不写入有效缓存；可重试或提示更新 |

**缓存范围（至少）：**

- Declarative JSON、Trusted Native ESM bundle、HTML Artifact 等 **UI 资源**
- Signed Manifest中的surface/tool/routing声明由Host验证后生成受管Tool shim；它们不是可下载执行的Remote脚本。
- 当前 **已接受的 Manifest** 本体（用于知道合法 hash；Manifest 本身也可短 TTL，过期后先刷新 Manifest 再拉资源）

**明确不做（默认 Remote）：**

- 把第三方扩展 **永久**落成与 Local 全量包等价的目录树
- 无 hash 校验的 CDN 直链加载 Native
- 用 Access Key 当资源完整性证明

**性能与流量：**

- 产品假设：端到端耗时主要在 **Agent 思考**，扩展资源流量通常不是瓶颈。
- 因此优先 **正确性与懒加载语义**；TTL 缓存用于避免同会话内重复下载与无谓等待，而不是为省流量做激进永久镜像。
- TTL 默认建议与 `updateCheckTtlSeconds` 同量级或略长（实现可配置，例如 15–60 分钟）；企业可调。

**打开 Surface 最小路径：**

```text
已有 accepted Manifest（connect 时建立）
  → 解析 view/artifact entry 依赖的 path 集合
  → 对每个 path：缓存命中且未过期？→ 用缓存字节
                 否则拉取 → hash 校验 → 写入 TTL 缓存 → 使用
  → 渲染 / activate Native / 加载 Artifact
```

#### 5.2.6 已同意权限（granted）与 re-consent

**术语（取代易误解的「终身钉死天花板」）：**

| 名称 | 含义 |
|------|------|
| **candidate permissions** | 当前验签通过的 Manifest 推导出的权限摘要 |
| **granted permissions** | 用户（或企业策略）**已点头同意**的权限集合 |
| **expansion** | candidate 相对 granted 的增量（多 origin/action/tool、`nativeCode` 0→1 等） |
| **re-consent** | 存在 expansion 时强制确认，语义类似 **更新用户协议** |

**规则：**

1. 首次确认后：`granted = candidate`，并记录 `acceptedManifestMeta`。
2. 内容更新且 `expansion = ∅`（权限未扩大，可缩小）：验签通过后可自动切换 accepted Manifest；资源仍按需拉、按新 hash 校验。
3. 存在 expansion：**禁止静默 apply**；弹窗展示增量（diff）；
   - **同意** → `granted = candidate`，接受新 Manifest，之后按需拉新资源；
   - **拒绝** → 保持旧 `granted` 与旧 accepted Manifest；不进入扩大后的合同。
4. **`nativeCode` false→true** 走同一 re-consent 机制，文案与策略更重（默认建议 `allowHostedNative=off` 或强确认）。
5. **换钥（指纹变）**：视为新发布者身份，走完整首次确认，不只是小补丁。
6. Gateway / 加载路径始终卡在 **当前 granted** 与 **当前 accepted Manifest** 的交集语义上，不得用「网上最新未同意版本」越权。

**产品体感：** 不是「第一次给的权限永远不能多」，而是「要更多权限必须再弹一次，像协议更新；不同意就继续旧版本能力」。

### 5.3 协议：`health` / 连通性（每次运行）

**目标：** 客户端在扩展相关运行时路径上**主动**检测远程是否可达，而不是只在用户点「测试连接」时才检查。

#### 5.3.1 触发时机（目标合同）

| 触发 | 行为 |
|------|------|
| OpenChamber 启动且存在已信任 Remote 扩展 | 后台批量 `health`（限流、并行上限） |
| 打开某 Remote 扩展 Surface / Workbench 磁贴 | 对该扩展 `health`（可合并短 TTL 缓存，如 30–60s） |
| Agent 即将调用该扩展业务 Tool | `health` 失败则返回可行动错误（配 Key / 检查网络），禁止静默伪造数据 |
| 用户手动「刷新 / 测试连接」 | 立即 `health` + 可选 `update` 检查 |

#### 5.3.2 `health` 语义

| 结果 | 含义 | UI / Agent |
|------|------|------------|
| `reachable` | 入口与/或业务 test 探针成功 | 正常 |
| `unreachable` | 网络/超时/5xx | 明确离线；保留 last-good UI 若策略允许 |
| `unauthorized` | 401 | 提示轮换 Key |
| `forbidden` | 403 | 提示权限不足（业务侧） |
| `trust_invalid` | 签名/指纹不再匹配 | 阻断业务调用，要求重新确认 |

`health` **不是**授权源：`reachable` 不能替代权限天花板或确认写。

业务探针继续走已有 Connector `test`（如 `GET /health`）+ 服务端注Key；入口探针只检测direct Manifest URL并进入相同验签链。`remote/inspect`/`remote/connect`是OpenChamber route，不是远端厂商endpoint。

### 5.4 协议：`update`（每次运行检测）

**目标：** Remote 服务端若有更新，客户端在运行期**主动发现**；是否**自动应用**由策略决定（见 §5.5 讨论与推荐）。

#### 5.4.1 触发时机

与 §5.3.1 对齐，并增加：

| 触发 | 行为 |
|------|------|
| 每次成功 `health` 之后（或并行） | `update_check`：比较远程版本/资源哈希与本地 last-good |
| TTL 到期（Hosted 已有 refresh 语义） | 强制 `update_check` |
| 应用从后台回前台（可选） | 防长时间挂起错过更新 |

#### 5.4.2 `update_check` 输入/输出（概念）

**请求（客户端 → 远程或经 OC 服务端代理）：**

```text
extensionId
currentVersion / currentManifestHash / resourceHashSet
permissionCeiling 摘要（可选，用于服务端诊断）
```

**响应（须可验签或落在已签名 HostedManifest 上）：**

```text
status: none | available | required
remoteVersion
remoteManifestHash
changeSummary（可选，展示用）
permissionDelta: none | expanded | reduced
requiresUserConfirmation: boolean
resources[]: { url, sha256, mimeType }  // 或指引去拉完整签名 manifest
```

#### 5.4.3 `update_apply` 行为

1. 拉取签名 HostedManifest / 资源。
2. 验签、MIME、SHA256、origin ⊆ 天花板。
3. 若 `permissionDelta = expanded` 或换钥 → **不得静默 apply**，进入确认流。
4. 原子切换 last-good；失败保留上一版本（fail-closed）。
5. 按已验tool/routing metadata刷新Host受管Tool shim（名称须仍⊆天花板；不下载Tool/Skill脚本）。
6. 已打开 Surface：见 §5.5（热替换 vs 下次打开再生效）。

### 5.5 讨论：服务端更新后，客户端是否直接更新完成？

这是产品/安全关键权衡。方案对比：

| 策略 | 做法 | 优点 | 风险 |
|------|------|------|------|
| **A. 始终自动 apply** | 检测到更新立即下载替换 | 用户无感、永远最新 | 权限扩大若未拦截则危险；打开中的 UI 可能中途换版 |
| **B. 分类自动**（**推荐默认**） | 见下方规则 | 兼顾安全与体验 | 实现稍复杂 |
| **C. 仅提示、用户点更新** | 只通知 | 最可控 | 配置/操作负担回升；版本长期漂移 |
| **D. 强制更新** | `required` 时阻断使用直到 apply | 适合安全补丁 | 离线/失败时不可用 |

#### 推荐默认：**策略 B — 分类自动更新**

```text
update_check 结果
  │
  ├─ none → 结束
  │
  ├─ available 且 permissionDelta = none|reduced
  │     且 无 nativeCode 新增
  │     且 资源均通过验签/哈希
  │     → 自动 update_apply（后台）
  │     → 已打开 Surface：默认「下次打开/刷新 tile 再生效」
  │        （可选：Declarative/HTML 允许温和热替换；Native 禁止热替换）
  │
  ├─ available 且 permissionDelta = expanded
  │     或 nativeCode 从 false→true
  │     或 发布者换钥
  │     → 不自动 apply；UI 提示确认；确认前继续 last-good
  │
  └─ required（远程标记强制，如安全回滚）
        → 尝试自动 apply（仍须过验签）
        → 失败则 Surface/业务 Tool 进入 blocked，展示原因
```

| 问题 | 推荐答案 |
|------|----------|
| 服务端一更新，客户端是否总是立刻完成更新？ | **否。** 仅「权限未扩大 + 验签通过」的内容更新默认可自动完成。 |
| 每次运行是否都要检测？ | **是。** 每次相关运行路径做 `health` + `update_check`（允许短 TTL 合并）。 |
| 自动更新是否打断正在看的页面？ | **默认不打断。** 切换 accepted Manifest 后，**已打开实例**可继续用打开时已校验的字节直至刷新；Native 禁止运行中热替换。 |
| 离线时？ | `health=unreachable`；TTL 缓存未过期的资源仍可尝试使用（若策略允许）；过期或未缓存则明确不可用；不假装在线更新成功。 |
| 本地是否永久镜像第三方包？ | **否。** 信任态持久；Surface/icon资源为TTL短缓存，过期清理；Host-generated shim另按verified metadata reconcile。 |

#### 企业策略开关（目标）

| 开关 | 默认 | 说明 |
|------|------|------|
| `autoUpdateContent` | on | 允许权限未扩大时的静默 Manifest/内容切换 |
| `autoUpdateRequireConfirmOnPermissionExpand` | on | **强制** re-consent，不可对第三方 Remote 关掉 |
| `blockOnUpdateRequiredFailure` | on | `required` 更新失败则不可用 |
| `updateCheckTtlSeconds` | 30–60 | 合并频繁打开的探测 |
| `resourceCacheTtlSeconds` | 15–60 分钟量级（可配） | Surface/icon资源缓存；过期清理 |
| `allowHostedNative` | off（建议） | 与 §4.3 一致 |

### 5.6 每次运行时序（目标）

```text
打开Remote Surface/icon或调用Host受管业务Tool
    │
    ▼
health（入口 + 可选业务 test）──失败──► 明确错误；可选使用未过期缓存字节
    │ 成功
    ▼
update_check（Manifest）── none ──► 使用当前 accepted Manifest
    │
    ├─ auto-applicable（无权限扩大）──► 切换 accepted Manifest
    │
    └─ needs re-consent（权限扩大/换钥）──► 弹窗；同意则抬高 granted；拒绝则保持旧合同
    │
    ▼
按需拉取Surface/icon entry资源；Tool shim只从verified metadata reconcile
    │  缓存命中且未过期 → 直接用
    │  否则下载 → hash 校验 → 写入 TTL 缓存
    ▼
渲染 / Host受管Tool shim / Gateway调用（均受granted约束）
```

### 5.7 错误与可观察性

| 错误类 | 用户/Agent 可见信息（无密钥） |
|--------|------------------------------|
| 验签失败 | 发布者验证失败，勿继续 |
| 指纹变更 | 发布者密钥变化，需重新信任 |
| 权限扩大待确认 | 列出新增 origin/action/tool/native（协议更新式文案） |
| 资源哈希不匹配 | 资源损坏或被篡改；不使用；可重试 |
| 缓存过期且不可达 | 需要网络以刷新该资源 |
| 401/403 | 密钥无效或业务侧拒绝 |
| 超时/不可达 | 网络或服务不可用 |

日志与诊断不得输出 Access Key、setup code、原始业务响应体。

### 5.8 验收要点（Remote 协议）

以下合同已由 R1–R3 实现与自动化测试覆盖；勾选不等同于真实第三方服务和打包客户端的人工验收已经完成。

- [x] 用户仅凭 URL+Key 可完成首次接入，并出现一次指纹 + 权限确认。
- [x] 无 `.ocix` 文件时仍存在可查询的安装/信任态（granted + accepted Manifest 元数据）。
- [x] 指纹为验签派生；篡改远程明文 fingerprint 字段无效。
- [x] **connect 不强制预拉全部 UI**；打开Surface/icon时才拉对应path。
- [x] 拉取的Surface/icon资源做hash校验并写TTL缓存；Tool由Host从已验metadata生成shim，不下载任意Tool/Skill脚本。
- [x] 每次打开 Surface / 业务 Tool 路径触发 health（TTL 内可合并）。
- [x] update_check：权限未扩大时可自动切换 accepted Manifest。
- [x] 权限扩大或换钥时 **re-consent**；拒绝则保持旧 granted / 旧 Manifest。
- [x] 用户同意 expansion 后 granted 抬高，新权限可用（非终身钉死）。
- [x] `nativeCode` 扩大走同一 re-consent，且受 `allowHostedNative` 约束。
- [x] 自动更新默认不打断正在交互的 Native 实例。
- [ ] 使用独立第三方参考服务与正式打包客户端完成实机验收并留存结果。

### 5.9 分期归入

| 协议能力 | 建议阶段 |
|----------|----------|
| URL+Key 向导 + connect 指纹确认（隐式信任态） | **Phase 1** 核心 |
| connect仅Manifest；Surface/icon按需拉+TTL缓存；Host生成Tool shim | **Phase 1** 核心 |
| granted + re-consent（含 nativeCode） | **Phase 1** 核心 |
| 每次运行 health | Phase 1 |
| update_check + 分类自动 apply | Phase 1–2 |
| `required` 强制更新与企业策略开关 | Phase 2–5 |
| 与 Server 开发 / Dev Hosted 联调 | Phase 2–3 |

---

## 6. Server 开发（新模块）边界

> **当前决策入口**：[OCIX_LOCAL_DATA_RUNTIME_PLAN.md](./OCIX_LOCAL_DATA_RUNTIME_PLAN.md)。
> 2026-08-10 审计确认当前只有 Business Gateway 一个真实 consumer；P3.1 冻结为 direct in-process `LocalDataRuntime.invoke()`，不使用 Hono。未来第二 transport 必须另立 ADR/roadmap slice和授权。

### 6.1 做什么

| 能力 | MVP 描述 |
|------|----------|
| **Local Data Runtime** | 进程内 **better-sqlite3** 深模块；Gateway 是 v1 唯一调用入口 |
| Scaffold | 签名 Local full package：单文件同步 ESM handler + migrations + 既有 Surface/Tool |
| Lifecycle | 按 `projectKey × extensionId` 惰性迁移、keyed pool、lease 与 idle eviction；owner fingerprint 只进 meta 做接管校验 |
| Bind | 既有 Gateway action allowlist/confirmation 后直接调用 LDR；不新增 HTTP connector |
| Scope | server canonical known-project directory 派生 `projectKey`；客户端 projectId/path 仅作 hint |
| 多 App 隔离 | 独立 SQLite、migration ledger、action registry 和 failure domain |

### 6.2 不做什么

- 不实现第三方 RBAC/ABAC
- 不把用户 `data.sqlite` 打进 `.ocix`
- 不开放任意公网 bind（默认 loopback / in-process）
- 不替代 Business Gateway 的确认写与密钥注入
- 不与 MCP App 协议合并
- 不把 Remote 第三方 UI 的远端脚本默认可执行进 LDR
- 不默认采用 PocketBase 为唯一底座（可选增强另议）
- 不启动 loopback/LAN listener，不创建端口池、runtime token、`runtime.json` 或调试绕过
- 不把 Trusted Host Code、worker 或 timeout 描述成恶意代码安全沙箱

### 6.3 与 OCIX 的接口

```text
Host-local App (server handlers + migrations)
        │
        ▼
Local Data Runtime (better-sqlite3, in-process)
        ▲
Business Gateway direct adapter
        ▲
OCIX Surface / Agent Tool
```

---

## 7. 非目标（本愿景明确不做）

- 官方公共 Marketplace 运营与审核组织
- 仅 Skill、无权限天花板的「裸远程插件」标准（无验签/无指纹确认/无权限天花板）
- 跨 OCIX 事件联动
- 将 MCP App 改为 OCIX
- Windows/Linux/Capacitor 与 macOS 同等证据作为本愿景的前置条件（可并行）
- 将 Access Key 用作包签名或发布者身份证明

---

## 8. 分期路线图

### Phase 0 — 叙事与默认值（文档/产品，低代码）

| 交付 | 验收 |
|------|------|
| 开发手册与 Settings 文案：第三方默认 Hosted / Remote | 文档与 UI 文案一致 |
| 术语表：Remote Hosted / Dev Hosted / Local Package | 本计划 §3 被引用 |
| Hosted 权限天花板与「仅 connect 不足」写入 pitfalls | 评审通过 |
| 本计划 §5 Remote 协议目标评审冻结 | connect / health / update 语义通过评审 |

### Phase 1 — 第三方 Remote 主路径产品化（R1–R3 已实现；实机验收待执行）

| 交付 | 验收 |
|------|------|
| **URL+Key 向导**：connect **只**验签 Manifest、本地派生指纹、首次确认、隐式信任态 | §5.8 清单 |
| **懒加载 + TTL 短缓存**：Surface/icon按需拉、hash校验、过期清理；Host生成受管Tool shim | 打开Surface才拉资源；Tool/Skill远程脚本下载为零 |
| **granted + re-consent**：权限扩大弹窗可同意抬高 / 拒绝保持旧合同 | 非终身钉死；禁止静默扩大 |
| **每次运行 health + update_check**；分类自动 apply（§5.5） | 扩大不静默；fail-closed |
| 安装流：薄包/市场目录/URL+Key 均可；无需理解全量 pack | 新用户可完成接入 |
| 第三方示例（CRM/Ops Lab）文档改为 Remote 优先步骤 | 按文档可完成连 API |

### Phase 2 — Dev Hosted（自研本机源）

| 交付 | 验收 |
|------|------|
| CLI 在 loopback 提供 project-bound、签名、不可变 release snapshot | 首次注册/每次 refresh 均验签、验 hash、绑定 canonical project；拒绝 unsigned/latest 资源 |
| 独立 `source.type = dev-hosted`，delivery 仍为 Hosted | 不复用 URL+Key Remote wizard，不降低 Hosted verifier 或权限确认 |
| CLI 非交互 JSON/退出码 + last-good generation | 失败不覆盖已激活 generation；产品 refresh 必须显式触发 |
| Declarative / Native / HTML Artifact 共用现有 Hosted loader | 不新建第四 runtime；不重做 Remote R1–R3 |

### Phase 3 — Server 开发 MVP

| 交付 | 验收 |
|------|------|
| 签名 Local full package 的 handler + migration scaffold | validator 拒绝 bare import、异步 handler、越界路径和未知字段 |
| Gateway → `LocalDataRuntime.invoke()` | query/write、confirmation、project binding 与 result limit 可测 |
| 与 Declarative starter 联调 | 对话打开 overview + 读取本项目 SQLite snapshot |
| Trusted Host Code 与数据隔离 | 明示管理员信任；跨项目/跨扩展/owner 换钥/迁移失败均 fail closed |

### Phase 4 — Agent 闭环「写有界 action handler + 写 UI」

| 交付 | 验收 |
|------|------|
| Skill/流程：生成签名包内的bounded LDR action handler/migration + Declarative页/action声明，经既有Gateway direct invoke | 单会话可走通demo业务；无任意HTTP route/listener |
| 可选：从 dev 一键 `pack` Local 或发布 Hosted 清单 | 可分发给同事 |

### Phase 5 — 治理与硬化（按需）

| 交付 | 验收 |
|------|------|
| Hosted Native 策略开关（企业默认关） | 配置可测 |
| Server 进程资源配额、日志保留 | 不拖垮桌面 |
| update 探测限流、并发与可观察性 | 不拖垮启动与多扩展 |
| 与发布证据/回归矩阵挂钩 | 清单项可勾选 |

---

## 9. 与现有代码的映射

| 现有模块 | 在本愿景中的角色 |
|----------|------------------|
| `hosted-ocix.js` | 场景 A 核心（connect/update 落地）；场景 B Dev 源扩展 |
| `package-format.js` / `manager.js` | Local + 薄包/隐式薄安装信任生命周期 |
| `connection-store.js` + Gateway | 两类场景共用 Connector；health 业务探针 |
| `workbench-store.js` | 统一工作台 |
| `templates/interactive-ui-extension` | 自研 Local / Dev 起点 |
| Extension Manager + `remoteReview.ts` | 已实现的 Remote 向导、指纹与 re-consent 体验 |
| `remote-ocix.js` / `remote-resource-cache.js` | 已实现的信任态、懒加载与 TTL 缓存 |
| **新建** `packages/web/server/lib/interactive-ui/local-data/runtime.js` 等（完整文件集只见 P3 蓝图 §11.1） | Phase 3 同进程 LDR 与 scaffold；不创建独立 listener |

不修改 OpenCode 协议即可实施 P3.1/P3.2；二者仍有独立用户开始门，且不得由 Remote 验收顺带启动。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Dev 信任泄漏到生产分发 | Dev Hosted 也必须签名、验 hash、绑定项目；不存在“开发时跳过，导出时再收紧”路径 |
| Trusted server code 任意代码执行 | 只允许签名 Local full package + 明确管理员同意；承认它不是沙箱，限制 ABI/输入/结果并隔离数据与失败域 |
| 第三方 Hosted 被换成恶意 manifest | 发布者密钥 + 资源 SHA + 权限天花板 |
| 盲信 connect 明文 fingerprint | **禁止**；指纹必须验签后派生（§5.2） |
| 自动更新静默扩大权限 | 权限扩大/换钥/nativeCode 必须 re-consent（§5.2.6 / §5.5） |
| 把 re-consent 做成「永远不能加权限」 | granted 可在用户同意后抬高；拒绝则留在旧合同 |
| connect预拉全量导致体感重 | connect只Manifest；Surface/icon懒加载+TTL缓存，Tool shim来自metadata（§5.2.5） |
| 无校验缓存脏资源 | 缓存键绑定 path+sha256+manifest；过期清理；hash 失败不入库 |
| 每次运行探测过重 | TTL 合并、并行上限、后台队列（§5.5 开关） |
| 热更新打断用户操作 | 默认已打开实例保持至刷新；Native 禁止运行中替换 |
| 过度优化流量 | 假设瓶颈在 Agent 思考；缓存为正确性与重复打开体验服务 |
| Native 远程扩大攻击面 | 默认禁 Hosted Native 或强确认 |
| 用户混淆 MCP App 与 OCIX | 设置与文档持续分源标识 |
| 协议分叉成三套 | 本计划强制「场景默认值 + Hosted UX，非新平行标准」 |

---

## 11. 成功标准

短期（Phase 1–2）：

- 第三方扩展以 **URL+Key + 首次指纹/权限确认** 完成接入（可无 `.ocix` 文件）。
- **connect 只验 Manifest**；Surface/icon资源按需拉取+TTL短缓存，Tool由Host按已验metadata生成shim。
- 每次运行路径执行 **health + update_check**；权限未扩大可自动切换；扩大则 **re-consent**（可抬高 granted）。
- 开发者可通过 project-bound Dev Hosted CLI 注册并显式刷新签名 release snapshot。

中期（Phase 3–4）：

- 在单一项目内：LDR 经 Gateway 提供业务 action + OCIX Surface 消费 + Agent 打开，无需独立后端进程（可选用）。
- 自研模块可 pack 为可安装 Local 或正式 Hosted。

长期：

- OpenChamber 成为「Agent 搭建企业模块」的默认环境：远程连第三方、本地造自己的。

---

## 12. P3 开始门（替代旧开放问题）

1. P3.1：用户明确授权冻结的 direct Gateway adapter，同时冻结 Trusted Host Code、migration 和删数据语义。第二 transport consumer即使未来出现，也只能触发独立 ADR + 新roadmap slice + 依赖评审 + 用户授权，不能成为P3.1的可选分支。
2. P3.2：用户明确授权 project-bound Dev Hosted；冻结 CLI JSON/退出码、开发私钥存储和 last-good refresh 语义。
3. Hosted Native、Remote update TTL/required policy 等既有 Remote 治理问题不由 P3.1/P3.2 顺带扩大。
4. LAN source、unsigned source、source-directory fallback、runtime trust bypass、独立 server listener 与脚本/计划任务共进程均不在已批准范围。
5. 所有精确文件、接口、波次、测试和 DoD 只按 P3 蓝图执行。

---

## 13. 建议下一步行动

1. 用户按已完成的 R4 清单，在真实打包客户端执行既有 Declarative、Trusted Native、HTML Artifact 参考服务验收并记录结果；不重复制作已存在的指南、服务或验收包。
2. 若实机发现缺陷，只修复对应 R4 缺陷并重跑现有自动化；便利脚本优化不冒充验收 blocker。
3. Remote 实机验收收口后，仍按roadmap与用户独立授权决定是否进入 Dev Hosted / Local Data Runtime；两者不得被 Remote 工作顺带实现。

---

*本文档同时记录已实现的 Remote R1–R3 与仍属规划的 Server 开发、Dev Hosted / Local Data Runtime；不得用整体“已完成”掩盖后两者尚未实现，也不得用整体“未实现”抹去 Remote 的已合入事实。*
