# MCP Apps 修复后独立核验报告

> 核验日期：2026-08-04  
> Run ID：`2026-08-04-acceptance-02`  
> 角色：独立核验；未修改产品源码，未提交、推送、打包或发布  
> 结论：**NO-GO**

## 1. 结论

Gate A 与 Gate B 在当前源码上独立复跑通过，但新的 self-contained 真实浏览器 Gate C
在 `Done, reopen and exact history recovery` 失败：选择历史 revision 后，点击刷新最新状态，
120 秒内未返回 latest revision 5。按照冻结计划，Gate C 任一 checkpoint 失败或未运行都必须
立即停止，因此没有构建 DMG，也没有开始 Electron computer-use 25+3。

此外，代码与证据审查发现两个独立 P0：

1. Gate C 的 checkpoint 包装器会把返回 `{ blocked: ... }` 的结果记成 `status: pass`，并允许
   最终报告写入 `ok:true`。开发交接引用的 `2026-08-04T02-50-55-818Z` 报告确实把 locale
   recovery 和 Pin/App Board 的 blocked 结果标成 pass，不能作为全绿证据。
2. EX-06/AUD-001 的 first-paint 判定仍仅为 App `size-changed` 与 Broker 非零布局两个布局信号，
   没有真实内容或像素证据。合法布局但空白的 App 仍可被判 ready。

因此，即使本次 Gate C 没有在 history recovery 超时，当前候选也不能进入发布候选阶段。

## 2. 候选身份

| 仓库 | 身份 | 当前状态 |
|---|---|---|
| OpenChamber | `95b1954f3c77509e78129a3214142da0464ac46e` | 工作区未提交；tracked diff SHA256 `abb1c3bb89fd100f8a5dd1080115cf4c1e33ac04846e5c410e957d52b075f7a3`；`status --porcelain` 106 项 |
| OpenCode | `bf12c7a79358ae763733d6e67de93af5d6715226` | 工作区未提交；tracked diff SHA256 `e4b9ec8a88ec09f8c3e8df87b02a70c14a12df1bec721bfc741e41ee4d575959`；`status --porcelain` 18 项 |
| tldraw MCP App | `cee989b07e4d71016537db997b2c539f96e6d4c3` | clean |

OpenChamber/OpenCode 的 diff hash 不包含 untracked 文件，所以它们仍不具备可发布的完整 commit
身份；AU-03 在提交并冻结同源构建前保持 blocked。

tldraw 构建产物：

- `dist/app.html`: `28a0d6a99d75e6f0ea767134782d1c569d6407977d80849d4fa06a2b6038839c`
- `dist/server.mjs`: `6941f2606ca97e321eb941f54eb39918d004f08cae828cab4b244e184fa96d3a`

## 3. 独立运行结果

| Gate | 命令/范围 | 结果 |
|---|---|---:|
| A | `npm test` | PASS，206/206；第一次沙箱运行因禁止 loopback 监听失败，授权本机临时端口后原命令通过 |
| A | `npm run build:server` | PASS |
| A | `npm run verify` | PASS，App/Server SHA256 与上表一致 |
| A | `npm run accept` | PASS，独立 acceptance `status: passed` |
| A | `npm run test:restart-persistence` | PASS，1/1 |
| A | 隔离服务 `npm run probe` | PASS，`ok:true`；Save、幂等 replay、export、semantic v2、archive/delete 全链通过；服务已停止 |
| B | OpenChamber focused tests | PASS，172/172 |
| B | OpenChamber UI type-check | PASS |
| B | OpenCode MCP/App/API | PASS，18/18 |
| B | OpenCode lifecycle | PASS，35/35；第一次沙箱运行无法监听随机端口，授权后原命令通过 |
| C | predicate/negative tests | PASS，24/24 |
| C | self-contained browser product chain | **FAIL**，exit 1；`Timed out waiting for return to latest revision 5` |
| D/E | DMG / Electron 25+3 | NOT RUN，按 Gate C stop rule 停止 |

新 Gate C 机器报告：[browser/report.json](./machine-run/browser/report.json)，编排报告见
[orchestration.json](./machine-run/orchestration.json)。失败前通过协议协商、Agent semantic create、
authoritative inline、Edit/Save、受限图片、多页面和真实 SVG/PNG export；history recovery 失败后，
下游 locale、Pin/App Board 与 fallback checkpoint 均未运行。

## 4. 证据缺陷

- 新失败运行没有在超时点保存 final surface state 或失败截图；现有截图只覆盖失败前状态，仍未满足
  No-Go 修复计划 WP-2.3 的 timeout 诊断要求。
- [`01-inline-preview.png`](./machine-run/browser/01-inline-preview.png) 被 `Add project directory` 对话框遮挡，截图没有证明 inline 画布真实内容
  可见；DOM contract 通过不能替代冻结计划要求的非背景截图证据。
- semantic create checkpoint 将同一个 Tool response 中的 semantic document 长度同时记录为
  `toolElementCount` 与 `authoritativeElementCount`，没有读取权威 canvas state；WP-3 的三方核对
  尚未实现。
- tldraw revision provenance 已由 Server 返回，但 App parser/UI 丢弃并不展示 restored/test-fixture/
  unknown-legacy 来源；RV-01/RV-04 按计划应失败。

## 5. Standards 审查

1. **P1** OpenChamber 对显式空 `visibility` 扩权为 `model+app`，OpenCode 对同一输入 fail-closed；
   违反共享合同一致性和“冲突先解决”要求。
2. **P2** `McpAppRenderer.tsx` 同时聚合下载、队列、CSP、Loader、sandbox controller 与 React
   呈现，bridge 不再轻薄，模块职责过度集中。
3. **P2** tldraw 架构/README 与当前单真实 renderer、默认画布行为仍有过期描述。

Fowler judgement calls：OpenCode `src/mcp/index.ts` 可能存在 Divergent Change 与局部重复。

## 6. Spec 审查

1. **P0** blocked checkpoint 可被记作 pass/`ok:true`。
2. **P0** first-paint 仍以两个布局信号冒充真实内容证据。
3. **P1** revision provenance 未进入 App parser/UI。
4. **P1** semantic element count 没有独立读取权威 state。
5. **P1** authoritative first-paint predicate/截图没有证明非背景真实可见内容。
6. **P2** Lessons/Master Report 仍保留静态 SVG、23 项和含 blocked `ok:true` 等过期口径。

## 7. 清理与安全

- 独立 tldraw probe 服务已正常停止。
- Gate C orchestrator 日志显示 OpenChamber/OpenCode 已 graceful shutdown。
- 对本轮 JSON/log 执行 credential-like pattern 扫描，命中文件数为 0。
- 没有 reset、clean、commit、push、DMG build 或发布操作。

## 8. 复测准入

至少完成以下修复后再创建新 run ID：

1. blocked/not-run 必须使 Gate C `ok:false`，并添加负向测试。
2. EX-06 使用 App 可验证的真实内容/paint receipt，而不是两个布局信号。
3. 修复 history latest recovery，并在 timeout 保存 final surface dump 与截图。
4. 读取独立权威 canvas state 完成 semantic count 三方核对。
5. 在 App 中保留并展示 revision provenance。
6. 修正文档口径，提交并冻结 OpenChamber/OpenCode 候选身份。

完成后需从 Gate A/B/C 重新串行运行；Gate C 全绿且无 blocked/not-run 后，才能进入同源 DMG
和 Electron computer-use 25+3。
