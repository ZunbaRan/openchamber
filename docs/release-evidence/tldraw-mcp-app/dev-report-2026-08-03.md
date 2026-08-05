# OpenChamber × tldraw MCP App 开发报告

**报告日期：** 2026-08-03  
**依据文档：** [TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md](../../TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md)  
**工作范围：** 按清单推进双主线（独立 `tldraw-mcp-app` + OpenChamber 产品链）  
**结论（可直接对外使用的表述）：**

> MCP 2026 协议、独立服务和主编辑/保存/图片路径已恢复并通过当前自动化；旧版全绿报告不能替代本轮验收。完整 self-contained E2E **尚未全绿**，卡在 multi-page rich-text 编辑；Electron/DMG、回归矩阵与独立仓首 commit 仍未完成。**不能宣布可发布完成。**

关联上下文：

- [TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md](../../TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md)
- [TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md](../../TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md)
- [MCP_2026_APP_DEVELOPMENT_LESSONS.md](../../MCP_2026_APP_DEVELOPMENT_LESSONS.md)
- [tldraw-mcp-app/docs/ACCEPTANCE.md](../../../../tldraw-mcp-app/docs/ACCEPTANCE.md)

---

## 1. 项目定位与完成门禁

| 主线 | 目标 | 当前判断 |
|------|------|----------|
| A. 独立 tldraw MCP App | 可独立进程运行的 Server/App、锁与 provenance、协议验收 | **基本达标**（unit/verify/accept 全绿） |
| B. OpenChamber 产品集成 | 真实模型选 Tool → 预览 → 全屏编辑 → App-only → Save/导出/恢复/Pin | **部分达标**（核心 Edit/Save/Image 通过；整跑未完） |
| 回归 | Excalidraw / Legacy MCP / OCIX / HTML Artifact | **未做本轮验证** |
| Electron | 安装版人工冒烟 | **未开始** |

---

## 2. 本轮开发前的阻塞（清单记录）

清单指出上一轮失败点（2026-08-02）：

1. **Fullscreen 过早交互**：外壳已渲染，但 `Tldraw.onMount` 未完成 → `+ Note` 静默失败
2. **CSP**：`data:image/svg+xml` 被 `default-src 'none'` 拦截
3. **验收 helper 缺陷**：`editorReady: false` 被误判为非法 marker（13/14）
4. 旧全绿报告 **不能** 替代 Host 生命周期改造后的当前代码

---

## 3. 本轮已完成的工作

### 3.1 P0-1 浏览器验收 helper

**文件：** `openchamber/scripts/lib/tldraw-mcp-app-browser-acceptance.mjs`

- `editorReady === false` 只记 `app-declared-editor-not-ready`
- 仅非 boolean 且非 nullish 的值记 `invalid-editor-ready-marker`
- **结果：** `node --test scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs` → **14/14**

### 3.2 P0-2 编辑器真实就绪契约（App）

**文件：** `tldraw-mcp-app/src/app.tsx` 及对应单测

| 契约 | 实现 |
|------|------|
| 状态 | `editorReady` / `editorStatus`：`loading \| rendering \| ready \| error` |
| DOM | `.acceptance-shell[data-editor-ready]` / `[data-editor-status]` |
| 重置 | inline、canvas 身份变更、resync、卸载编辑器 |
| 置 true | onMount + 权威状态 + `.tl-canvas` 正尺寸（rAF + 2s 墙钟兜底） |
| 防抖 | Host 重复发当前 fullscreen **不再** 清空 ready |
| 门禁 | `+ Note` / Save / SVG / PNG 未 ready 时 disabled |
| 可诊断 | 程序调用不再静默 return，写入 status |

### 3.3 P0-3 E2E 等待真实 ready

**文件：** `openchamber/scripts/verify-tldraw-mcp-app-browser.mjs`

- Fullscreen checkpoint 使用 `waitForEditorReadyApp`
- 要求 mode/fullscreen + readiness + shell 尺寸，而不是只等外壳 paint

### 3.4 P0-4 CSP（Broker / App / 规范化）

**文件：**

- `openchamber/packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`
- `openchamber/packages/ui/src/lib/interactive-ui/mcpApp.ts`
- 相关测试

| 修复 | 说明 |
|------|------|
| Broker CSP | 增加 `img-src/font-src/media-src data: blob:`，避免 srcdoc 继承 `default-src 'none'` 拦离线资源 |
| App CSP | `img-src/media-src/font-src` 显式 `data: blob:` |
| normalize | 允许 `data:` / `blob:` / `about:` 作 resource/frame；**connect-src 仍拒绝** |

### 3.5 本轮 E2E 暴露后追加修复（opaque sandbox）

| 故障现象 | 根因 | 修复 |
|----------|------|------|
| `crypto.randomUUID is not a function` | opaque `about:srcdoc` 无 randomUUID | `createAppRandomId()`（getRandomValues 回退） |
| `Cannot read properties of undefined (reading 'digest')` | 无 `crypto.subtle` | `sha256Hex` + 纯 JS `sha256HexSync` |
| `mcp-asset:` invalid protocol | tldraw `srcUrl` 只允许 `http/https/data/asset` | 新 patch：`patches/tldraw-v5.0.2-mcp-asset-srcurl.patch` |

### 3.6 文档

- `TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md`：明确 `data-editor-ready` 为产品/测试共用契约
- `MCP_2026_APP_DEVELOPMENT_LESSONS.md`：新增「外壳就绪 ≠ 可交互」「Broker CSP 继承到 srcdoc」
- 清单中 P0-1～P0-4 多项已勾选

### 3.7 构建与哈希（独立 App）

| 项 | 值 |
|----|-----|
| 发行版本 | `1.3.0` |
| `app.tsx` SHA256 | `076eb1d9620c804773a50bba515fb71375fb5490a60dff147269d1d0d4a99270` |
| `dist/app.html` SHA256 | `c3cb241521443b4742ef679a5e08e51b233977e44601a34d4651fc648826a71c` |
| lock ↔ provenance | **一致** |
| 上游 patches | 4 个（含新建 `mcp-asset-srcurl`） |

上游 patch 列表：

1. `patches/tldraw-v5.0.2-style-embedder-sandbox.patch`
2. `patches/tldraw-v5.0.2-inline-translation-data-url.patch`
3. `patches/tldraw-v5.0.2-export-data-url-csp.patch`
4. `patches/tldraw-v5.0.2-mcp-asset-srcurl.patch`（本轮新增）

---

## 4. 验证状态（本轮）

### 4.1 独立 tldraw MCP App

| 命令 | 结果 |
|------|------|
| `npm run build:app` | 通过 |
| `npm run verify` | 通过 |
| `npm test` | **193/193** 通过 |
| `npm run accept` | 通过 |
| `npm run test:restart-persistence` | 本轮早期通过（后续改动后建议再跑一次） |

### 4.2 OpenChamber Host 聚焦

| 命令 | 结果 |
|------|------|
| acceptance helper 单测 | 14/14 |
| `McpAppRenderer.test.ts` + `mcpApp.test.ts` | 通过（含 CSP 用例更新） |
| `packages/ui` type-check | 通过 |
| `bun run build:web` | 通过 |

### 4.3 完整产品链 self-contained E2E

| 命令 | 结果 |
|------|------|
| `bun run test:tldraw-mcp-app-browser:self-contained` | **失败（未全绿）** |

**最新报告（本机运行目录，可能被清理）：**

```text
openchamber/.tmp/tldraw-mcp-app-browser-orchestrated/2026-08-03T02-06-32-792Z/browser/report.json
```

| Checkpoint | 状态 |
|------------|------|
| MCP 2026 capability and visibility | **pass** |
| Agent semantic tool creation | **pass** |
| Inline preview in conversation | **pass** |
| Fullscreen Edit, app-only add, move, rename, connect, Save | **pass** |
| Restricted image upload, exact asset Save, and same-canvas recovery | **pass** |
| Real multi-page UI, in-flight Save page switch, and page-scoped exports | **fail** |
| Done / 历史 / 会话恢复 | **未执行** |
| Pin / App Board fullscreen | **未执行** |
| `browser.consoleErrors` | **[]（0 条）** |

**失败信息：**

```text
Timed out waiting for tldraw rich-text editor
```

发生在 multi-page 流程：`addLabeledRectangleOnActivePage` → 双击矩形 → 等待 `[contenteditable="true"]`（超时 8s）。

---

## 5. 仓库与代码状态

| 仓库 | 状态 |
|------|------|
| `openchamber` | 分支 `docs/interactive-ui-mcp-apps`，约 `95b1954f`；工作区有大量未提交改动（含本轮 MCP App/Host 修复） |
| `tldraw-mcp-app` | **`main` 仍无任何 commit**（清单 P2-1 仍阻塞） |
| OpenCode fork | 本轮未单独重跑 fork 后端测试；依赖既有 E2E 前半段已通过的能力协商 |

---

## 6. 未完成项清单（完整）

### 6.1 发布阻塞（必须完成）

| ID | 项 | 状态 | 说明 |
|----|-----|------|------|
| P0-5 | Save 不切换画布（完整复验） | 部分 | Fullscreen Save 已过；multi-page 中 in-flight Save 未跑到 |
| P0-6 | SVG/PNG 真导出 | 未完 | 本轮 E2E 未执行到导出 checkpoint |
| P0-7 | App Board Pin / 真全屏 | 未完 | 未执行到 |
| P0-8 | self-contained E2E 全绿 | **阻塞中** | multi-page rich-text 超时 |
| P1-1 | 多页面与完整编辑体验 | **阻塞中** | 同上失败点 |
| P1-2 | 冲突、断线和恢复 | 未做 | |
| P1-3 | 安全验收 | 未做 | |
| P1-4 | locale 和无网运行 | 未做 | |
| 6.5 | Excalidraw/Legacy/OCIX/Artifact 回归 | 未做 | |
| 6.6 | Electron/DMG 人工冒烟 | 未做 | 依赖 Web 全绿后 |
| P2-1 | 独立仓首个可回滚 commit | 未做 | `tldraw-mcp-app` 无 git 历史 |
| P2-2 | CI（unit/build/verify/accept） | 未做 | |
| 发布证据归档 | 本文件以外的截图/下载/90 天 artifact | 部分 | 仅有本机 `.tmp` 与本开发报告 |

### 6.2 当前首个失败点（建议下一轮只修这个）

**位置：** `openchamber/scripts/verify-tldraw-mcp-app-browser.mjs`  
**函数：** `addLabeledRectangleOnActivePage` / `waitForTextEditor`  
**现象：** 新页上画 geo 矩形后双击，8s 内未出现 rich-text `contenteditable`  
**影响：** 阻断 multi-page、按页导出，以及后续 Done/历史/Pin 等整跑

**可能方向（未实施）：**

1. 延长/放宽 text editor 等待，并记录更全的 DOM 诊断
2. 改手势：单击 + Enter / 工具栏 Text 入口，而不是仅双击
3. 确认 multi-page 后焦点是否仍在 App iframe session
4. 与 Fullscreen 主编辑路径中 rename 成功的手势对比差异

### 6.3 明确「不是」当前阻力的事

- 不是「代理无法操作电脑」：本轮已完整跑 Chrome 自动化 E2E
- 不是协议/Server 未实现：协商、模型 Tool、App-only、Save、asset upload 均已在产品链上证明
- 不是缺少 computer-use skill：项目自带 self-contained runner 即正确验收路径

---

## 7. 本轮涉及的主要文件

### tldraw-mcp-app

- `src/app.tsx` — editor-ready、randomId、sha256 回退
- `patches/tldraw-v5.0.2-mcp-asset-srcurl.patch` — **新增**
- `scripts/lib/source-patches.mjs` — 注册第 4 个 patch
- `config/upstream-lock.json` — source/output/patch 哈希
- `dist/*` — 重建产物
- `test/app.export.test.mjs`、`test/distribution.contract.test.mjs` 等

### openchamber

- `scripts/lib/tldraw-mcp-app-browser-acceptance.mjs`（+ `.test.mjs`）
- `scripts/verify-tldraw-mcp-app-browser.mjs`
- `packages/ui/.../McpAppRenderer.tsx`、`mcpApp.ts` 及测试
- `docs/TLDRAW_MCP_APP_COMPLETION_CHECKLIST.md`
- `docs/TLDRAW_MCP_APP_BROWSER_ACCEPTANCE.md`
- `docs/MCP_2026_APP_DEVELOPMENT_LESSONS.md`
- `docs/release-evidence/tldraw-mcp-app/dev-report-2026-08-03.md` — **本报告**

---

## 8. 风险与质量备注

1. **旧报告不可复用：** 2026-08-02 全绿与当前源码/dist 哈希不一致。
2. **`.tmp` 证据易失：** 正式候选需在本目录补充截图/下载 SHA，并上传 CI 或 prerelease artifact（保留 ≥90 天）。
3. **`tldraw-mcp-app` 无 commit：** 无法回滚/tag，发布前必须建基线。
4. **未做回归：** Host CSP 与 Broker 改动理论上影响所有 MCP App；需最小回归 Excalidraw 等。
5. **opaque sandbox 兼容性：** randomUUID / subtle / CSP 继承是真实 Host 路径特有坑，已写入 lessons。

---

## 9. 建议执行顺序（下一轮）

1. **只修** multi-page `waitForTextEditor` / 标注矩形手势，保留失败诊断字段。
2. 重跑：

   ```bash
   cd openchamber && bun run test:tldraw-mcp-app-browser:self-contained
   ```

3. 若全绿：补导出 SHA、Done/历史、Pin/App Board 检查项勾选。
4. 最小回归：Excalidraw MCP + Legacy MCP + 一个 OCIX/Artifact 路径。
5. `tldraw-mcp-app` 首个 commit + tag；更新本目录 release-evidence。
6. 同一 commit 构建 DMG，做 Electron 人工冒烟。

---

## 10. 一句话进度条

```text
协议/独立服务 ████████████ 100%
编辑器就绪契约 ████████████ 100%
CSP/图标/离线资源 ████████████ 100%（当前 E2E console 干净）
Fullscreen Edit/Save/Image ████████████ 100%（自动化已过）
完整 E2E 全绿 ████████░░░░  ~65%（卡 multi-page rich-text）
回归 + Electron + 发布基线 ░░░░░░░░░░░░    0%
────────────────────────────────
整体可发布进度约：55–60%（主链恢复，正式完成未达）
```

---

## 11. 复现与继续开发命令

### standalone tldraw

```bash
cd tldraw-mcp-app
npm run build:app
npm run verify
npm test
npm run accept
```

### OpenChamber 聚焦

```bash
cd openchamber
node --test scripts/lib/tldraw-mcp-app-browser-acceptance.test.mjs
bun test packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts \
  packages/ui/src/lib/interactive-ui/mcpApp.test.ts
bun run --cwd packages/ui type-check
```

### 完整产品链

```bash
cd openchamber
bun run build:web
bun run test:tldraw-mcp-app-browser:self-contained
```

---

*本报告由 2026-08-03 开发会话落盘，对应清单状态日期同日。*
