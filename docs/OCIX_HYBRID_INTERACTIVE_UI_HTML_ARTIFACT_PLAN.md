# OCIX 混合 Interactive UI + HTML Artifact 计划与实现合同

> 状态：核心 Runtime、打包、安装、对话渲染与 Business Bridge 已实现；真实签名混合包、Agent Runtime、CRM API、生命周期、正常对话 ToolPart、统一视觉/a11y、Qwen 17 条冻结语料、macOS packaged desktop 与性能总门禁均已通过；Windows/Linux/Capacitor 为待补实机证据<br>
> 更新：2026-07-22

## 1. 固定术语：2×2

| 生成角色 / 形式 | Interactive UI | HTML Artifact |
|---|---|---|
| Agent Generated | 模型按标准组件 schema 组合；无 API | 模型返回临时 HTML/SVG/受限 JS；无 API |
| Third-party Extension | OCIX Installed Declarative / Trusted Native；Gateway API | OCIX 签名 HTML；sandbox；Business Bridge → Gateway API |

这两个维度解决的是不同问题：Interactive UI / HTML Artifact 决定表现形式；Agent Generated / Third-party Extension 决定代码来源、生命周期和业务权限。后续设计、日志、设置页和验收均使用这四个格子，不再用更多并列层级混称。

## 2. 产品目标

一个 `.ocix` 允许只包含 `views[]`、只包含 `artifacts[]`，或两者同时存在。一次安装同时完成：

- 签名包、发布者与文件完整性验证；
- OpenChamber Host surface 安装；
- OpenCode Tools 与 Skills 的全局受管部署；
- 动态 Agent Capability Catalog；
- Connector 与 Secret Store 配置；
- 对话 ToolPart 内联渲染；
- enable/disable、update/rollback 与可恢复 uninstall。

扩展开发者实现业务模板与第三方 API。OpenChamber 提供规范、沙箱、Bridge、Gateway、确认和生命周期，不复制第三方系统的 RBAC/ABAC。

## 3. 已实现合同

### 3.1 Manifest

`views[]` 保持现有 Declarative/Native 合同。新增 `artifacts[]`：

```json
{
  "id": "com.acme.crm.explorer",
  "title": "CRM Explorer",
  "entry": "ui/artifacts/explorer.html",
  "tools": ["crm_open_explorer"],
  "routing": {
    "intents": ["crm.explorer"],
    "priority": 82,
    "operation": "mixed"
  },
  "displayModes": ["inline", "workspace", "fullscreen"],
  "inlineHeight": 520,
  "capabilities": {
    "scripts": true,
    "businessActions": ["com.acme.crm.query", "com.acme.crm.approve"]
  }
}
```

所有 surface ID 位于 extension namespace。`businessActions` 必须是顶层 `actions[]` 的子集；Tool、intent、entry、大小和重复项在 pack 前与 install staging 时各检查一次。

### 3.2 Tool result

Third-party HTML Artifact 使用独立引用协议：

```json
{
  "$schema": "openchamber://installed-html-artifact-result/v1",
  "schemaVersion": 1,
  "artifact": "com.acme.crm.explorer",
  "mode": "live",
  "summary": "CRM explorer opened",
  "context": { "scope": "default" }
}
```

Envelope 不携带 HTML、URL、Token、action 或脚本。Host 根据已安装注册表解析 Artifact，并复核 completed Tool 的名字是否绑定该 surface。Agent Generated HTML 继续使用 `openchamber://html-artifact-result/v1`，两种 schema 不互相升级。

### 3.3 Business Bridge

安装后的 HTML 可以调用：

```js
await window.openchamber.business.query('com.acme.crm.query', input);
await window.openchamber.business.execute('com.acme.crm.approve', input);
```

完整路径：

```text
sandboxed HTML
  → artifact.businessRequest(requestId, intent, action, input)
  → channel / sequence / size / concurrency 校验
  → Host 固定 extensionId + artifactId + originating Tool
  → Gateway 校验 action 子集、connector、origin、permission
  → Secret Store 服务端注入 Key
  → 第三方 HTTP API
  → host.businessResult(data 或脱敏 error)
  → sandboxed HTML Promise resolve/reject
```

iframe 不能传入 extensionId、Connector URL、credential 或客户端确认布尔值。`permission: ask` 由 Host 弹窗确认后使用一次性 challenge token 重试；业务 API 最终按 Key scope、revision 和自身规则授权。

### 3.4 隔离

- Host iframe 只加载 OpenChamber authenticated route。
- broker 再创建 opaque-origin `sandbox="allow-scripts"` content iframe。
- CSP 为 `connect-src 'none'`，禁用 worker/frame/object/media/form/base。
- 安装与 serve 都拒绝远程资源、脚本 `src`、fetch/XHR/WebSocket/EventSource/Worker/WebAssembly/eval/Function、iframe/form/object/embed。
- Host 只发送主题 token、locale、timezone、viewport、mode、reduced-motion 与 Envelope context。
- 每个实例最多四个并发业务请求；消息和输入有字节上限；reload/navigation 会关闭内容。

签名证明来源和完整性；sandbox 限制运行能力。两者都需要，不能互相替代。

## 4. 开发与打包

脚手架现在默认生成一个混合包：Declarative overview、Trusted Native workspace、HTML Artifact explorer、三个 Tools 和一个 Skill。

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new-extension \
  --id com.acme.operations --name "Acme Operations" --tool-prefix operations

node scripts/interactive-ui-extension.mjs validate /absolute/new-extension
```

`validate` 不访问真实业务 API、不执行 Native bundle，但会解析 Declarative、检查 Native activation 特征、硬化 HTML、验证 action 子集和 Tool/Skill packaging。开发详情见 [扩展开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md) 与 `$build-openchamber-interactive-extension`。

## 5. 实施批次

| 批次 | 范围 | 状态 |
|---|---|---|
| H1 | `artifacts[]` normalize/discovery/routing/descriptor | 已完成 |
| H2 | installed result parser 与 ToolPart 对话渲染 | 已完成 |
| H3 | 双层 sandbox、Business Bridge、Gateway action 子集 | 已完成 |
| H4 | pack/verify/install staging、混合 Agent Runtime | 已完成 |
| H5 | Extension Manager 安装审查展示 surface 与 sandbox 权限 | 已完成 |
| H6 | 混合脚手架、CLI validator、开发 Skill/手册 | 已完成 |
| H7a | 真实签名混合 OCIX + bundled OpenCode + 本地 API + Gateway + 生命周期 | 已完成 |
| H7b | 正常 OpenChamber 对话中 ToolPart 选中并渲染两类 Third-party surface | 已完成 |
| H8 | light/dark、窄宽、workspace/fullscreen Golden 与 a11y | 已完成 |
| H9 | Qwen 固定语料路由与安全/性能/打包统一验收 | 已完成（已验证 Runtime 范围） |
| H10 | 组件库 2.0 首批 `gauge`/`heatmap`/`kanban`、对话 Gallery | 已完成 |
| H11 | Scripts Artifact 执行租约、心跳、停止/重启 | 已完成（Web 仍为 experimental） |
| H12 | Marketplace 已安装/可更新状态与扩展诊断 | 已完成 |
| H13 | Business connection 公共健康状态（configured ≠ reachable） | 已完成 |
| H14 | 第二批 Declarative primitives：`agenda`/`funnel`/`network` | 已完成 |
| H15 | Managed Desktop 独立 Scripts Artifact Runner 与强制资源终止 | 已完成（Web 保持 experimental） |

Marketplace 搜索、筛选、批量更新和开发目录 hot reload 未进入 H13–H15，本轮不继续扩展 Market。

## 6. 验收门槛

功能门槛：

1. 同一 `.ocix` 安装后发现三个示例 Tools 和 Skill，无 `OPENCODE_CONFIG_DIR`。
2. 自然语言分别选中 Third-party Interactive UI 与 Third-party HTML Artifact；每轮只有一个主 surface。
3. HTML Artifact 在正常 OpenChamber 对话流内渲染，不依赖 standalone demo。
4. query 返回非空真实数据；断开 API 不能伪装为空成功。
5. write 在确认前零上游请求，确认后带 revision 请求，成功后刷新。
6. 伪造 Tool、extension、Artifact、action、channel、sequence 或 confirmation challenge 均失败。
7. descriptor、HTML、Envelope、日志和浏览器消息中没有 Key。
8. disable/enable、update/rollback、uninstall 与连接清理成立。

模型门槛默认使用 Qwen3.7 Plus 跑冻结语料。它能稳定理解业务 Tool 优先、标准组件优先、表达力缺口才选 HTML Artifact，即可证明普通模型可用性。OpenAI、Big Pickle 或其他 Provider 可作为对照矩阵，但不再是普通开发完成的阻断项。

## 7. 下一步

`bun run test:interactive-ui-functional` 已证明真实签名混合包能被 bundled OpenCode 发现，并用确定性本地 CRM API 完成 Artifact query、确认式 write、禁用/启用、版本回滚/恢复、卸载凭据清理和重装。`bun run test:html-artifact-browser` 已证明双层 sandbox 与 Business Bridge 的真实浏览器消息往返。`bun run test:interactive-ui-conversation-browser` 已进一步证明 Qwen3.7 Plus 在正常 OpenChamber 会话中调用混合包后，Third-party HTML Artifact 和 Installed Interactive UI 均由聊天 `ToolPart` 内联渲染，Artifact sandbox 内读取到真实非空 CRM 数据。

视觉/a11y 已完成 54 个运行场景与 62 张 Golden，Qwen3.7 Plus 已在相同 17 条语料上 17/17 通过；Artifact 误选、业务越权与重复主视图均为 0。macOS arm64 unpacked `.app` 已证明签名混合 OCIX 安装、3 个 Agent tools、Gateway 非空数据、Third-party HTML Artifact 渲染和整应用重启恢复；性能门禁确认 Artifact 继续独立 lazy load，缓存命中 p95 低于 1 ms。

当前可称为 **Web + macOS managed desktop 发布候选**。统一组合报告的 `complete=false` 仅表示 Windows、Linux 与 Capacitor 尚无实机/CI 证据；它们不能伪报为通过，也不阻断已验证 Runtime 的候选状态。确认式 write 已由 functional/browser bridge 门禁覆盖；若发布审查要求人工可见证据，再补正常聊天确认弹窗录像或截图。后续核心工作转为外部平台 CI 与发布治理，不再扩大本批协议范围。
