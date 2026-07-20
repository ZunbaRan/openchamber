# OCIX Connector Authentication & Credential Provisioning v1

> 状态：已实现（2026-07-20）。本文定义 Installed Declarative / Trusted Native 扩展连接第三方业务系统时的认证边界、manifest 合约和签发协议。

## 1. 目标与非目标

OCIX 只标准化“OpenChamber 如何安全地取得、保存并携带第三方系统颁发的 Key”。Key 能访问哪些租户、对象和操作，由第三方业务系统决定并在每次 API 请求中校验。

OpenChamber 负责：

- 验证已签名扩展及其声明的 Connector、网络 Origin、Action 和写操作确认策略。
- 在服务端保存连接凭据，并只向声明的 Connector 请求注入。
- 提供手工 Key 配置、一次性连接码换 Key、连接测试、断开和卸载清理。
- 将第三方的 `401`、`403` 等结果明确返回，不自行伪造业务授权结果。

第三方系统负责：

- 用户登录、租户选择和 Key 的签发、权限范围、到期、轮换、撤销及审计。
- 判断 Key 是否可以读取或修改具体业务对象。
- 对写操作执行幂等、revision/ETag、业务审批和最终审计。

本协议不要求 OpenChamber 实现多用户企业部署、组织 RBAC/ABAC、OAuth session 或第三方账号体系。平台仍保留安装信任、网络 allowlist 和写操作确认；这些是客户端安全边界，不是业务权限系统。

## 2. 信任与认证是两条链

```text
.ocix Ed25519 签名
  → 证明包的来源密钥和完整性
  → 用户决定是否安装 Trusted Native / Declarative 扩展

第三方 Access Key
  → 证明当前连接在第三方系统中的业务身份与权限
  → 第三方 API 在每次请求中决定允许或拒绝
```

将公钥放进 `.ocix` 不会自动授予业务权限；将业务 Key 配置到 Connector 也不会让未签名代码获得安装信任。

## 3. Manifest 合约

### 3.1 推荐：手工配置 `api-key`

适用于第三方系统已有 Access Key/API Token 页面，用户可以复制一个最小权限 Key。

```json
{
  "connectors": [
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
  ],
  "permissions": {
    "network": ["${OCIX_BUSINESS_API_URL}"]
  }
}
```

`placement` v1 只允许 Header。未指定时默认为 `Authorization: Bearer <key>`。也可以使用 `X-API-Key` 并把 `prefix` 设为空字符串。`Cookie`、`Host`、`Origin`、`Content-Length`、代理认证头以及 `X-OpenChamber-*` 等危险或宿主保留 Header 会被拒绝。

### 3.2 推荐的零拷贝流程：`issued-key`

适用于第三方系统愿意实现一次性连接码交换端点。用户只把短期、单次使用的 setup code 输入 OpenChamber；真正的 Access Key 通过服务端到服务端交换取得。

```json
{
  "connectors": [
    {
      "id": "business-api",
      "type": "http",
      "baseUrl": "${OCIX_BUSINESS_API_URL}",
      "auth": {
        "type": "issued-key",
        "provisioningUrl": "${OCIX_CREDENTIAL_ISSUER_URL}",
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
  ],
  "permissions": {
    "network": [
      "${OCIX_BUSINESS_API_URL}",
      "${OCIX_CREDENTIAL_ISSUER_URL}"
    ]
  }
}
```

`provisioningUrl` 必须是 HTTPS；仅本机回环开发地址允许 HTTP。它不能包含 URL 用户名/密码，其 Origin 必须出现在 `permissions.network` 中。OpenChamber 不把该 URL 或 setup code 暴露给扩展 UI。

### 3.3 兼容类型

- `none`：公开或由网络边界认证的 API，不注入凭据。
- `env-bearer`：从 OpenChamber 服务端环境变量读取 Bearer Token。保留给旧扩展和受控部署；新模板默认不使用，因为它不支持 Extension Manager 内独立配置与轮换。

## 4. 一次性连接码交换协议

OpenChamber 向 `provisioningUrl` 发送：

```http
POST /.well-known/ocix/v1/credentials
Accept: application/json
Content-Type: application/json
```

```json
{
  "$schema": "openchamber://credential-request/v1",
  "extensionId": "com.acme.crm",
  "connectorId": "crm-api",
  "installationId": "3f0c6fbe-...",
  "setupCode": "single-use-short-lived-code"
}
```

第三方成功响应：

```json
{
  "$schema": "openchamber://credential-response/v1",
  "credentialType": "api-key",
  "accessKey": "secret-value",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "display": {
    "name": "CRM production · sales-read-write"
  }
}
```

- `accessKey` 必填，最大 16 KiB，不得包含换行或 NUL。
- `expiresAt` 可选，但若提供必须是未来的 ISO 时间；到期后 OpenChamber 停止注入并要求重新连接。
- `display.name` 可选，只是可公开显示的标签，不能包含秘密。
- `installationId` 在同一扩展 Connector 的重新签发中保持稳定，可供第三方关联、轮换或撤销；它不是用户身份。
- setup code 最大 8 KiB，应该短期、单次使用，并由第三方在成功或失败达到阈值后作废。
- 响应最大 64 KiB，交换超时 15 秒。交换失败时不会覆盖当前仍有效的 Key。

## 5. 运行时路径

```text
用户安装并信任 .ocix
  → Extension Manager 发现 Connector
  → 用户粘贴 Access Key，或输入一次性 setup code
  → OpenChamber Server 保存 Key
  → Agent Tool 返回 Interactive Result Envelope（不含 Key）
  → Declarative / Native View 调用 Host Business SDK（不含 Key）
  → Gateway 校验 extension/view/action/confirmation/network
  → Gateway 在最后一跳注入 Key
  → 第三方 API 用自己的权限模型返回 2xx / 401 / 403
  → Gateway 返回业务数据或受控错误（仍不含 Key）
```

配置和管理端点：

- `GET /api/interactive-ui/connections`
- `PUT /api/interactive-ui/connections/:extensionId/:connectorId`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/provision`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/test`
- `DELETE /api/interactive-ui/connections/:extensionId/:connectorId`

这些端点只返回 `configured`、`expired`、来源、时间和可公开标签。它们从不返回 `accessKey`、setup code 或签发地址。

## 6. 存储与安全边界

当前实现把凭据保存在 OpenChamber 数据目录的 `interactive-ui/connection-secrets.json`，目录权限为 `0700`、文件权限为 `0600`，写入使用同目录临时文件加原子替换。卸载扩展时会删除该扩展的所有连接凭据。

该 v1 存储依赖操作系统账号和磁盘安全，并不宣称静态加密。拥有 OpenChamber 服务账号或磁盘读取权限的攻击者仍可能读取 Key。需要更强保证的部署应把数据目录放在加密磁盘上；未来可以用系统 Keychain/KMS 后端替换存储实现，但不改变 manifest 和签发协议。

无论使用哪种后端，以下内容都禁止出现业务 Key：

- `.ocix` 包、manifest、Tool/Skill、Interactive Result Envelope；
- Declarative JSON、Native props、浏览器存储和 URL；
- Agent 输出、错误响应、普通日志和截图；
- marketplace catalog 或发布者签名元数据。

## 7. 第三方 API 要求

第三方系统至少应：

1. 为不同环境和用途签发不同 Key，并让管理员选择 scope。
2. 在所有业务 API 上重新校验 Key，而不是信任前端是否隐藏按钮。
3. 对写操作支持 revision/ETag 与幂等键，避免重复提交和覆盖新数据。
4. 返回 `401` 表示 Key 无效/到期，`403` 表示 Key 有效但没有该操作权限。
5. 提供撤销、轮换与审计；`issued-key` 最好让 `installationId` 可被定位和撤销。
6. 不在错误消息和响应体中回显 Key。

OpenChamber 会把 `401` 映射为 `connector_unauthorized`，把 `403` 映射为 `connector_forbidden`。它不会根据第三方的角色模型自行提升或缩减权限。

## 8. 开发与验收清单

- Connector Origin 和签发 Origin 均在 `permissions.network` 中。
- 使用 Header 注入，Key 不进入 query string、body 模板或前端代码。
- 声明安全的 `GET`/`HEAD` 固定相对路径作为 `test`。
- 新扩展优先使用 `api-key`；第三方支持时使用 `issued-key`。
- 通过 `node scripts/interactive-ui-extension.mjs validate <extension>`。
- 验证未配置、有效、错误 Key、权限不足、到期、断开、轮换和卸载清理。
- 在真实对话中确认 Agent 只拿到 Tool/Skill 与业务数据，拿不到任何凭据。
