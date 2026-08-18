# OCIX Local Data Runtime（P3.1 决策入口）

> **状态**：roadmap P3.1 `planned`；未获得实现授权
> **更新日期**：2026-08-10
> **唯一逐文件实施合同**：[`P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md`](./P3_NEXT_WAVE_CAPABILITIES_IMPLEMENTATION_PLAN.md) §5、§11.1、§12–§17
> **父愿景**：[`OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md`](./OCIX_DUAL_PATH_HOSTED_AND_DEV_SERVER_PLAN.md)

本文只保留 P3.1 的产品边界和已冻结决策，供导航与评审。2026-08-05 的 Hono listener、端口池、runtime token、`runtime.json`、`Promise.race` 超时和单窗口连接模型均已删除；它们不是可实施合同。任何 Agent 不得从历史聊天、旧 commit 或缓存副本恢复这些设计。

---

## 1. 一句话定义

Local Data Runtime（LDR）为**已签名的 Local full OCIX 扩展**提供按项目隔离的 SQLite 业务持久化和有界 action handler。调用必须经过现有 Business Gateway；UI、Native View、HTML Artifact 和 Agent 都不能直接打开 SQLite。

```text
Agent Tool / Installed Surface
              │
              ▼
      Business Gateway
  allowlist · confirmation · secret boundary
              │
              ▼
   LocalDataRuntime.invoke()
  signed server module · projectKey · SQLite
```

LDR 与 Remote Hosted 正交：Remote Hosted 连接第三方服务；LDR 运行用户明确安装并信任的本机扩展后端。

---

## 2. 当前事实与开工门

代码审计确认：

- `better-sqlite3` 已是 Web/Electron 的直接依赖和既有打包能力；
- Hono 只以传递依赖存在，当前没有第二个 LDR transport consumer；
- Business Gateway 是唯一需要调用 LDR 的生产入口；
- 当前仓库尚无 LDR manifest 字段、loader、migration runner、数据库目录或生产 action dispatcher。

因此 P3.1 推荐 MVP 是 **Gateway 直接调用同进程 `LocalDataRuntime.invoke()`，零新增运行时依赖**。开工必须同时满足：

1. P1/P2 排期允许，且用户明确点名 P3.1；
2. 用户确认采用上述 direct adapter；Hono 不属于 P3.1 可选实现；
3. manifest、Trusted Host Code、迁移失败、卸载/删数据语义已经评审；
4. Agent 读取 roadmap、仓库 `AGENTS.md`、匹配 project skill 和详细蓝图；
5. 任何依赖安装、git、发布或 workflow 操作另有用户授权。

只授权“分析”或“做 PoC”不等于允许改产品、依赖或发布。

---

## 3. 冻结的产品合同

### 3.1 信任和包形态

- 只接受已签名、已安装、`delivery: local` 的 full OCIX 包。
- server entry 是包内预构建的**单文件同步 ESM**；不得在运行时编译 TypeScript、安装 npm 包或加载额外原生扩展。
- 扩展必须声明有界的 `localData.handler`、actions 和 migrations；字段精确 schema 以详细蓝图 §5.5 为准。
- server module 属于 **Trusted Host Code / 管理员同意后的本机代码**，不是安全沙箱。worker thread 或动态 import 不能被描述为恶意代码隔离边界。
- Hosted、Remote、Dev Hosted、unsigned development source 和 HTML Artifact 均不能获得 LDR server-code authority。

### 3.2 Authority 和项目隔离

- 对话authority来源为请求头中的OpenCode directory，经详细蓝图§4.4/§5.6的shared server-owned `project-inventory`（strict Git/plain typed result）+`project-authority`+incarnation ledger得到`projectKey`；现有realpath resolver与容错`getWorktrees()`列表均不足以授权。暂时inventory失败不tombstone，plain configured root缺可靠creation identity时fail closed。
- Workbench/Popout按蓝图§4.5使用server-private tile project-incarnation ref；public `projectId`/tile context不能覆盖它，legacy tile须显式rebind。client路径/projectId始终只作hint。
- write confirmation 必须绑定 `extensionId + actionId + projectKey + normalized input digest`，不能跨项目复用。
- 数据目录按 `projectKey / extensionId` 隔离；owner fingerprint 只写入 host-owned meta 做接管校验，普通换版本/换 key 不创建第二个 DB。路径必须由 server 组合并在 canonical data root 内验证。
- 一个 server 可同时服务多个窗口和项目；连接池按 key 管理，通过 lease 和 idle eviction 回收。禁止“切项目就关闭上一项目全部连接”的单窗口假设。

### 3.3 Handler 与调用语义

- 唯一生产入口是 `LocalDataRuntime.invoke(request)`；server-only authority/context 都封装在该 request 中，首版不启动 HTTP listener。
- handler 接收 server 构造的只读 context、已验证 input 和受限 DB adapter，不接收任意 filesystem/network/secret/runtime object。
- v1 handler 必须同步返回 JSON-compatible value；返回 Promise、stream、function、class instance、cycle 或超限结果均 fail closed。
- unknown field、unknown action、未声明 write、权限不满足、项目不匹配或 extension disabled 时均在执行前拒绝。
- 结果在事务 commit 前做可序列化和大小检查；默认上限、SQL 限制与错误码以详细蓝图为准。
- `Promise.race` 不能抢占同步 SQLite 或死循环，因此不是 v1 安全/超时机制。

### 3.4 SQLite 与 migration

- 每个 `projectKey × extensionId` 使用独立 DB；owner fingerprint 存 `_ldr_meta` 并在接管时核对。启用 WAL、foreign keys，关闭 trusted schema，并使用蓝图冻结的同步级别。
- migrations 随签名包发布，按版本和 digest 进入不可伪造 ledger；首次调用时在项目维度惰性迁移。
- migration 必须事务化、串行化和可重放；失败回滚本次migration、保留迁移前schema/data，并把该 `projectKey × extensionId` 显式标记 blocked，按详细蓝图的修复/再试流程恢复；不承诺自动回退或继续运行旧generation，也不能破坏其他 App。
- 不自动执行 destructive downgrade；降级、卸载、删数据、保留数据与 owner 换钥必须走显式产品语义和确认。
- DB、WAL、SHM、ledger 和备份都属于用户业务数据，不能打进 `.ocix` 或发布证据。

---

## 4. 明确删除和禁止恢复的旧方案

下列内容不属于 P3.1 MVP：

- Hono root app、`127.0.0.1` listener、端口池、`/health` 或 curl 调试口；
- runtime bearer token、`runtime.json`、connector `baseUrl` 或 UI 直连 loopback；
- 开发环境跳过签名、降低路径校验或从项目目录加载任意 server source；
- `localData.actionId`、另一套 HTTP route schema 或与 Gateway 并存的第二 action registry；
- 任意 SQL、任意 Node module、任意 network、任意 secret 注入；
- 把 worker、vm、timeout 或 `Promise.race` 宣称为强安全沙箱；
- 跨 extension/跨 project 共库、自动 destructive migration 或静默删数据；
- 把 Remote R1–R3、Dev Hosted、Marketplace、MCP Apps 或 Shell 混进 P3.1。

如果未来出现第二个真实 transport consumer，必须在 P3.1 之外另写增量 ADR/roadmap slice、证明 direct call 不足、核实 Hono 当前官方兼容性与许可证，并取得用户对直接依赖和产品暴露面的明确批准。

---

## 5. 低能力 Agent 的执行入口

不要从本文自行推导文件改动。实施 Agent 必须按详细蓝图逐项领取：

- §5：完整方案、manifest、module ABI、project authority、DB/migration/lifecycle；
- §11.1：精确 A/M/V/R 文件表；
- §12：平台、权限、数据与安全矩阵；
- §13.1：测试、负例、打包和证据；
- §15：文件唯一 owner、串行波次和 handoff；
- §16–§17：回滚、风险和 DoD。

若代码事实与蓝图不一致，Agent 只提交差异报告并停下；不得擅自增加 transport、依赖、权限或兼容层。

---

## 6. 合格结束状态

- 未获用户授权：保持 `planned`，只有文档和审计结果。
- 用户拒绝 direct adapter 且没有第二 consumer：保持 `planned`，记录选型 blocker，不写代码。
- 本地实现和测试完成但缺 git/release 权限：交付 code-ready handoff，roadmap 不写 `done`。
- 只有详细蓝图 §17 的功能、安全、打包、回放和文档门禁全部闭环，且按 roadmap 更新，才可声明完成。
