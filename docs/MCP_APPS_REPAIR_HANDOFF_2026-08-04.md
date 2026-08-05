# MCP Apps 修复交接文档（核验与剩余校验）

> 交接日期：2026-08-04
> 交接对象：核验者 / 真机校验执行人
> 输入依据：`MCP_APPS_NO_GO_REPAIR_PLAN_2026-08-04.md`（修复计划）+ `MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md`（25+3 真机验收）
> 关联：`MCP_APPS_STABILIZATION_MASTER_REPORT.md`（实施总记录）
> 本文目的：**开发者已完成全部可自动化修复与门禁；本文交付核验证据 + 剩余真机校验清单，供你执行核验与 Go/No-Go 判定。**

---

## 0. 交接速览

| 项目 | 状态 |
|---|---|
| 稳定化计划 P0-A/B/C/D 修复 | ✅ 代码完成 |
| 审计 AUD-001/002/003/004/007 | ✅ 代码完成 |
| No-Go 修复 WP-0~WP-7 | ✅ 代码完成 |
| 自动化门禁（Gate A/B） | ✅ 全部退出码 0 |
| 自包含浏览器 E2E（Gate C） | ✅ `ok: true`（干净环境 run） |
| **Electron computer-use 25+3（Gate D/E）** | ⏳ **待你执行**（本文 §5） |
| 产物一致性（DMG/CLI/SDK/resource） | ⏳ **待打包后核验** |

**当前结论**：Conditional No-Go —— 自动化链路全绿，但尚未有真机（Electron）验收证据，不能直接发布。

---

## 1. 版本与 Provenance（核验锚点）

核验时请先固定并记录以下 hash，任何不一致即按 AU-03 失败处理。

| 仓库 | commit | 分支 | 版本 | 提交状态 |
|---|---|---|---|---|
| `openchamber` | `95b1954f3c77509e78129a3214142da0464ac46e` | `docs/interactive-ui-mcp-apps` | ui 1.17.1 | **工作区有未提交改动**（见 §1.1） |
| `opencode` | `bf12c7a79358ae763733d6e67de93af5d6715226` | `openchamber-apps` | 1.18.10 | **工作区有未提交改动** |
| `tldraw-mcp-app` | `cee989b07e4d71016537db997b2c539f96e6d4c3` | `main` | 1.3.0 | ✅ 已提交（首个 commit，工作区干净） |

**产物 hash**（`tldraw-mcp-app/dist/`，`npm run verify`=0 时与 lock/provenance 一致）：
- `dist/app.html` SHA256: `28a0d6a9…`（取 `sha256sum dist/app.html`）
- `dist/server.mjs` SHA256: `6941f260…`
- 上游 tldraw 固定 **v5.0.2**，commit `6aa92784`、archive `fe6aca7e`（`config/upstream-lock.json`）

### 1.1 注意：openchamber / opencode 为未提交工作区
`tldraw-mcp-app` 已提交首个 commit（`cee989b`）；但 `openchamber` 与 `opencode` 的修复仍是**工作区未提交改动**。核验/发布前：
- 用 `git -C openchamber status --porcelain` 与 `git -C opencode status --porcelain` 记录未提交文件清单与 diff hash；
- **发布 DMG 前必须先提交 openchamber/opencode 的修复并固定 commit**，否则无法回溯到固定版本（AU-03 前提）。

---

## 2. 本次修复内容（按模块，含文件路径）

### P0-A · Excalidraw 空白诊断（openchamber）
- `packages/ui/src/lib/interactive-ui/mcpApp.ts`：新增 runtime 状态机（9 相位 + 9 错误码 + reducer + epoch 守卫 + ready-but-blank deadline + 诊断脱敏）。
- `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`：接入 reducer；resource 加载/CSP 校验/first-paint 双因子/`csp-metadata-missing` fail-closed。
- **已修崩溃**：`currentCanvasId()` 渲染期调 `setStatus` 的 TDZ。

### P0-B · tldraw 单渲染引擎（tldraw-mcp-app）
- `src/app.tsx`：inline 从静态 semantic-SVG 改为**真实 tldraw v5 只读模式**；`.acceptance-shell` 注入 Surface Contract V1（`data-surface-contract/-role/-authority-state/-render-ready/-mutation-authority/-canvas-id/-revision`）；inline 只读、fullscreen 可写；camera 仅存内存不进 revision。

### P0-C · 画布配额（tldraw-mcp-app）
- `src/canvas-store.mjs`：active/archived 配额拆分、`CanvasQuotaExceededError` 结构化错误、create 幂等、retentionClass、审计 receipt。
- `src/server.mjs`：单一配额权威、结构化错误透传、移除生产默认 `interop-acceptance`、fixture 启动归档。

### P1-D · revision provenance（tldraw-mcp-app）
- revision 条目带 `provenance`（6 种 origin + `unknown-legacy` 迁移）；`test-fixture` 默认隐藏；restore 记 `restoredFromRevision`。

### 审计修复
- AUD-001 ready-but-blank 双因子；AUD-002 多实例 mutation authority 隔离；AUD-003 类型门禁；AUD-004 csp 接线；AUD-007 报告一致性。

### WP-2 · 验收器改造（openchamber）
- `scripts/verify-tldraw-mcp-app-browser.mjs`：`assessTldrawSurfaceContract` 纯谓词；inline/恢复/locale/Pin 全部改复合条件；失败附 surface dump/截图。

---

## 3. 已通过的自动化证据（Gate A/B/C）

核验时请**用当前源码重跑**（旧报告不可作为通过证据）：

```bash
# OpenChamber
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui   # 期望 172/172
bun run --cwd packages/ui type-check                                                     # 期望退出码 0

# OpenCode Fork
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/app.test.ts test/mcp/session-tools.test.ts test/server/httpapi-mcp.test.ts  # 期望 18/18
bun test test/mcp/lifecycle.test.ts                                                            # 期望 35/35

# tldraw MCP App
cd /Users/loloru/Documents/data/project/openChamber/tldraw-mcp-app
npm test                 # 期望 206/206
npm run build:server     # 退出码 0
npm run verify           # 退出码 0（source/dist/lock 一致）
npm run test:restart-persistence

# 自包含浏览器 E2E（Gate C）
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun run test:tldraw-mcp-app-browser:self-contained   # 期望报告 ok: true
```

**开发者最近一次干净环境 E2E 结果**：run `2026-08-04T02-50-55-818Z`，`ok: true`，
路径 `openchamber/.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-04T02-50-55-818Z/browser/report.json`：
9 checkpoint 通过（含 inline Contract V1、Edit 交互、多页面、SVG/PNG 导出、恢复身份 rev=5/canvasId 匹配/readonly=none），
runtimeErrors=0、pageErrors=0。

---

## 4. 已知限制与 blocked 项（必须如实告知核验者）

1. **headless 会话恢复不可靠**：headless Chrome 多次 reload 后，OpenChamber 对虚拟化 MCP App 消息的恢复不稳定。E2E 中 **locale 切换（zh-CN/zh-TW）** 与 **Pin/App Board** 两个 checkpoint 以 `blocked: 'openchamber-headless-session-restore'` 诚实记录（附截图），**不算通过**，也**不能当作失败**——需在**真实可见环境**复核。
2. **EX-06 双因子仍是布局证据**：当前 first-paint 判定 = `size-changed(height≥24)` + `layout-visible`，两者都是布局类信号。真机 EX-06 可能仍揭示假阳性；通过标准必须是**实际内容证据**，不是两个尺寸信号同时成立。
3. **App 端 revision 来源标签未实现**：服务端已有 provenance 字段，但 **App UI 尚未显示** `restored from rN` / `test-fixture` / `unknown-legacy` 标签。RV-01/RV-04 若 App 端无标签，应按**失败**记录，不得以"服务端已有字段"判过。
4. **flaky**：同代码干净环境可跑通，连续运行因 Chrome/服务状态退化出现随机漂移；以干净环境 run 为准，跑前清理残留 Chrome 进程。

---

## 5. 待你执行的剩余校验：Electron computer-use 25 + 3

完整步骤、触发语句、通过标准见 **`MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md` §6~§14**。此处给执行顺序与判定要点速查：

### 5.1 执行顺序（对照 COMPUTER_USE 计划 §16）
1. 固定 commit/lock/DMG/resource hash（§1）；**先提交 openchamber/opencode** 再打包。
2. 顺序跑 §3 自动化门禁；全绿才继续。
3. 重跑 self-contained E2E（必须当前源码、新 run ID）；失败即停。
4. 安装 DMG，Clean profile，完成最小主链冒烟（Excalidraw/tldraw 首屏、Edit→Save、Pin→App Board）。
5. **EX-01~06**（Excalidraw；EX-07 放 §5.3 重启后做）。
6. **TL-01~07** + **AU-02**（多实例权限隔离）。
7. **RV-01~05**。
8. 独立低配额服务跑 **QT-01~06**（`TLDRAW_MCP_MAX_ACTIVE_CANVASES=2 TLDRAW_MCP_RUNTIME_DIR=<isolated> npm run serve`；QT-04/QT-06 需协议脚本辅助）。
9. 重启客户端 + MCP Server，做 **EX-07 / 历史恢复**。
10. **AU-03** DMG/CLI/SDK/resource 一致性。
11. Legacy MCP、Interactive UI/Artifact、OCIX 最小回归（§13）。
12. secret scan + 证据索引 + Go/No-Go。

### 5.2 关键判定红线（任一即 No-Go）
- Excalidraw/tldraw 出现**无诊断空白**。
- inline 或历史 Review **可修改** document。
- 多实例权限受**挂载顺序**影响。
- Save 切换 canvas 或 revision 非精确 `+1`。
- 历史恢复出现 403/404/binding error。
- quota 错误诱导 Agent 复用无关 canvas。
- fixture revision 默认暴露。
- DMG/CLI/SDK/resource hash 不一致。
- fallback 被当作成功。

### 5.3 证据要求（每个 case）
按 COMPUTER_USE 计划 §4.3：每轮新 run ID，证据放 `openchamber/docs/release-evidence/mcp-apps-stabilization/<run-id>/`（不得只放 `.tmp`）；每 case 记 pass/fail/blocked/not-run、步骤、期望/实际、session/message/part/server/resource/canvas/revision、截图/视频、是否出现 isError/fallback/403/blank/Retry；**不得保存任何 token**。

---

## 6. 判定口径（核验完成后填写）

```text
Automated gate:              PASS/FAIL
Self-contained browser E2E:  PASS/FAIL
Electron computer-use:       PASS/FAIL
Product cases:               N/25
Audit regressions:           N/3
Release gates:               N/7
Decision:                    GO / CONDITIONAL GO / NO-GO
```

- **GO**：25 产品用例全 pass + AU-01~03 pass + 7 项发布门禁满足 + E2E 与 computer-use 均通过 + 无 P0/P1。
- **CONDITIONAL GO**：仅允许非发布阻塞的 P2 视觉问题（须列明）。
- **NO-GO**：任一 P0/P1、发布门禁或产物一致性失败。

---

## 7. 文档索引

> 2026-08-04 后续真实打包与 Computer Use 核验又发现了“OpenCode fork 未进入 DMG”、
> 4 MiB resource 上限、native rebuild/Xcode、package cwd、camera 裁切等跨层问题。完整
> 复盘与当前未关闭项见
> [`TLDRAW_MCP_APP_DEVELOPMENT_REVIEW_RETROSPECTIVE_2026-08-04.md`](./TLDRAW_MCP_APP_DEVELOPMENT_REVIEW_RETROSPECTIVE_2026-08-04.md)。

| 文档 | 用途 |
|---|---|
| 本文 | 交接 + 剩余校验清单 |
| `MCP_APPS_COMPUTER_USE_ACCEPTANCE_PLAN_2026-08-03.md` | 25+3 真机验收细则（执行依据） |
| `MCP_APPS_NO_GO_REPAIR_PLAN_2026-08-04.md` | 修复计划（已执行完） |
| `MCP_APPS_STABILIZATION_MASTER_REPORT.md` | 实施总记录 + Gate C 证据 |
| `MCP_APPS_EXCALIDRAW_TLDRAW_STABILIZATION_PLAN.md` | 原始稳定化计划（需求源头） |
| `MCP_APPS_STABILIZATION_AUDIT_REPORT_2026-08-03.md` | 审计报告（AUD-001~007） |
