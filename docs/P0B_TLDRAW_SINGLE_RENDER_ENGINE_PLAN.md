# P0-B：tldraw 单渲染引擎 — 详细实施方案

> 日期：2026-08-03
> 状态：**Stage 1-3 已实施完成（2026-08-03）**，Stage 5 人工验收待执行

**实施进度**
- ✅ Stage 1 统一挂载（Tldraw 恒挂载 + hideUi/isReadonly + streaming overlay 条件化）
- ✅ Stage 2 mutationAuthority 只读 gate（save/restore/add 守卫 + UI actions 兜底）
- ✅ Stage 3 camera 契约（sanitizeSnapshotSession + scheduleZoomToFit 泛化）
- ✅ Stage 4 测试改造（3 个旧测试重写 + 3 个新测试；全量 205/205；build + verify 通过；upstream-lock.json 已刷新评审基线）
- ⏳ Stage 5 人工验收（TL-01~07，见 §7）
> 关联：[MCP_APPS_EXCALIDRAW_TLDRAW_STABILIZATION_PLAN.md](./MCP_APPS_EXCALIDRAW_TLDRAW_STABILIZATION_PLAN.md) §4.2 / §6.5 / §8.2（TL-01~07）
> 目标文件：`tldraw-mcp-app/src/app.tsx`（9029 行）、`tldraw-mcp-app/test/app.parity.test.mjs`、`test/app.behavior.test.mjs`
> 产生方式：专项研究（agent team 因提供商配额中断后由主代理手工完成代码解剖），所有事实均标注文件行号，可复核

---

## 1. 现状解剖（代码事实）

### 1.1 双渲染引擎现状

`AcceptanceCanvas`（app.tsx:5990 起）的渲染分支（app.tsx:8829-8860）：

```tsx
{inline ? (
  <InlineCanvasPreview
    state={streamingPreview?.state ?? canvasState}
    streaming={streamingPreview?.active ?? false}
    resolveAsset={resolvePreviewAsset}
  />
) : (
  <div className="canvas">
    {editorAssetUrls && authoritativeReady ? <Tldraw ... /> : <div className="editor-loading">…}
  </div>
)}
```

**事实**：
1. `InlineCanvasPreview`（app.tsx:5561）在 inline 模式下**无条件渲染**（`streaming` 仅切换 CSS 动画类 `.is-streaming`）；它是**静态 SVG**——无任何 zoom/pan/交互处理器，viewBox 由节点包围盒计算（app.tsx:5600-5620）
2. `lightweightPreviewScene`（app.tsx:5324）从 `semanticDocument` 或 legacy `diagram` 构建节点/边，另解出 image asset
3. **`<Tldraw>` 只在 fullscreen 分支出现一次**（app.tsx:8837）；inline↔fullscreen 切换 = Tldraw 整体卸载/重挂载，editor 实例销毁重建
4. 现有测试**显式固化**了这一架构：`test/app.parity.test.mjs:38-62` 断言 `[...source.matchAll(/<Tldraw\b/g)].length === 1`（"the official editor must mount only in the fullscreen branch"）且 inline 分支 `doesNotMatch(/<Tldraw/)`——**P0-B 必须重写该测试**

### 1.2 已有可复用能力（关键发现）

| 能力 | 位置 | 说明 |
|---|---|---|
| 原生只读 | app.tsx:6272/6353/6540 | `editor.updateInstanceState({ isReadonly: true/false })` + `editor.getIsReadonly()` 已在用（历史 revision、服务端同步结算窗口） |
| 历史 revision 只读 + zoom-to-fit | `renderHistoricalState` app.tsx:6511 | 已强制 readonly + `scheduleFullscreenZoomToFit`；状态文案 "Reviewing historical revision N. It is read-only…" |
| zoom-to-fit | `scheduleFullscreenZoomToFit` app.tsx:6236 | rAF 帧探测后 `editor.zoomToFit({force:true, immediate:true})`，仅 fullscreen 生效 |
| camera 重置 | app.tsx:5887 | `editor.setCamera({x:0,y:0,z:1},{immediate:true})` |
| dirty 与 camera 隔离 | app.tsx:6429-6437 | store 监听 `{source:"user", scope:"document"}`——**camera/selection 属 instance 域，缩放平移不触发 dirty、不产生 revision**（B3 已半满足） |
| 幂等键忽略 session | `snapshotDocumentKey` app.tsx:578-585 | 文档指纹排除 camera/selection/currentPageId |
| 输入收敛 | `enforceBoundedEditorInputs` app.tsx:5905 | url/embed/svg-text/excalidraw/tldraw 外部处理器置 null，文件处理器保留走 asset bridge |
| UI 定制 | `TLDRAW_UI_OVERRIDES` app.tsx:514 / `TLDRAW_COMPONENTS` app.tsx:513 | 已删 insert-embed action 与 embed tool；`TLDRAW_COMPONENTS` 为空（fullscreen 显示完整 UI） |
| 就绪契约 | `editorReady` / `invalidateEditorReady` / `scheduleEditorReadyProbe` app.tsx:6026-6050 | 显式 editor 就绪探测（onMount 不算就绪，需 authoritative render + 正 hit area） |
| 流式预览状态 | `streamingPreview` app.tsx:6018，由 `ontoolinputpartial`（7121）/`ontoolinput`（7134）设置，`ontoolresult`/`ontoolcancelled`/`onteardown` 清除（7139-7150） | 语义 SVG 骨架数据已独立存在 |
| 模式切换脏保护 | `applyDisplayMode` app.tsx:7040+ | inline←fullscreen 且有 dirty 时走 host restore 协议 + session draft |
| 保存路径 | app.tsx:8061 | `saveSnapshot = editor.getSnapshot()`——**含 session（camera），camera 会进 revision**（B3 待改点） |
| tldraw API 确认 | 上游 bundle `.cache/upstream/tldraw-v5.0.2/bundle-next/app.js` | `hideUi` prop 存在（可隐藏全部 chrome）；`isReadonly` 实例状态为官方只读机制（14 处使用） |

### 1.3 服务端契约

- `snapshotSchema`（server.mjs）为 `z.unknown()` + safe-JSON + 尺寸校验——snapshot 带不带 session 都接受；session 剥离不破坏服务端
- revision 读取/恢复（P1-D 已落地）与 snapshot 结构无关

---

## 2. 目标架构

```
AppBridge / authoritative CanvasState（不变）
                  │
        AcceptanceCanvas（状态所有者，不变）
                  │
         CanvasSurface = <Tldraw>（恒挂载，只创建一次）
                  │                      │
   inline presentation              fullscreen editor
   instanceState.isReadonly=true    instanceState.isReadonly=false
   hideUi=true（chrome 隐藏）         hideUi=false（chrome 可见）
   camera 可交互（wheel/pan/pinch）   camera + 编辑交互
   mutationAuthority='none'         mutationAuthority='current-revision'
                  │
   streaming 语义 SVG overlay（仅 streamingPreview.active===true 时叠层显示）
```

**核心原则**：
1. `<Tldraw>` 从"仅 fullscreen"改为**两种模式恒挂载**；模式切换只改变 `hideUi` prop + 命令式 `updateInstanceState({isReadonly})` + 容器 class，**不卸载 store/editor**
2. `InlineCanvasPreview`（semantic SVG）降级为**仅流式骨架 overlay**（`streamingPreview?.active === true` 时绝对定位叠层），权威 snapshot 到达后同帧/短 crossfade 撤下
3. 只读= 双保险：实例状态 readonly（防编辑命令）+ AppBridge 层 `mutationAuthority` gate（防程序化写调用），不依赖隐藏按钮
4. camera 存内存 `CameraSessionState`，save payload 剥离 camera，不进 revision

---

## 3. 关键设计决策（D1~D7）

### D1：Tldraw 恒挂载，模式只改表现

**改动**（app.tsx:8829-8860 渲染区）：

```tsx
{streamingPreview?.active === true ? (
  <InlineCanvasPreview
    state={streamingPreview.state}
    streaming
    resolveAsset={resolvePreviewAsset}
    className="canvas-overlay"   // 新增：绝对定位叠层
  />
) : null}
<div className={`canvas${inline ? " mode-inline" : " mode-fullscreen"}`}>
  {editorAssetUrls && authoritativeReady ? (
    <Tldraw
      ...（现有 props 不变）
      hideUi={inline}
      onMount={...现有逻辑不变...}
    />
  ) : (
    <div className="editor-loading">…（文案按模式区分，可选）</div>
  )}
</div>
```

**要点**：
- `hideUi` 是布尔 prop，变化只改 UI 不重建 editor（区别于 assets 数组 identity 陷阱，见 app.tsx:529 注释）
- 新增 `useEffect([displayMode])` 同步只读态：
  ```ts
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateInstanceState({
      isReadonly: displayMode === "inline" || historicalRevision !== undefined,
    });
  }, [displayMode, historicalRevision]);
  ```
  （`renderHistoricalState` 已设 readonly，此 effect 兜底模式切换竞态）
- `.canvas` 容器需显式尺寸：inline 复用 host context 尺寸（`shellStyleFromHost` app.tsx:5947 已提供）；`.preview-stage` 原 `min-height:190px`（app.tsx:8978）改为 `.canvas.mode-inline { min-height: 190px; }` 保持最小高度
- `.canvas-overlay`：`position:absolute; inset:0; background:inherit; z-index:1`；撤下时 150ms opacity crossfade（`.is-streaming` 动画保留，app.tsx:8985-8987）

**验证点**：切换模式后 `editorRef.current` 同一实例（内存地址不变）；`getIsReadonly()` 与模式一致；无卸载/重挂载日志。

### D2：mutationAuthority 只读 gate（AppBridge 层，非 UI 层）

新增状态：

```ts
type MutationAuthority = "none" | "current-revision";
const mutationAuthorityRef = useRef<MutationAuthority>("none");
const setMutationAuthority = (next: MutationAuthority) => {
  mutationAuthorityRef.current = next;
  // 同步：inline/历史 → none；fullscreen 当前 revision → current-revision
};
```

**设置点**：
- `applyDisplayMode`（app.tsx:7040）：inline → `"none"`；fullscreen 且非历史 → `"current-revision"`
- `renderHistoricalState`（app.tsx:6511）：→ `"none"`（已 readonly，补 gate）
- restore 成功/权威渲染完成（`acceptCanvasState` / `ontoolresult` 收尾）：恢复 `"current-revision"`（fullscreen 时）

**拦截点（每个入口首行加守卫，返回明确错误）**：
| 入口 | 位置 | 守卫行为 |
|---|---|---|
| 保存（atomic save 调用链） | `saveCurrentCanvas` 附近 app.tsx:8050+ | `mutationAuthorityRef.current !== "current-revision"` → 状态提示 + 不发请求 |
| Restore 按钮/流程 | 历史 Review UI 区 app.tsx:8610+ | 同上 |
| Apply/编辑操作（工具层） | `tldraw_apply_operations` 对应调用 | 同上 |
| 键盘删除/剪切/粘贴/复制 | `TLDRAW_UI_OVERRIDES.actions`（app.tsx:514 扩展） | authority 非 current 时替换为 no-op 或保持 readonly 语义 |
| 导出 | export 入口 app.tsx:8650 附近 | 只读允许导出（export 是读操作），**不拦截** |

**理由**：实例 readonly 拦截编辑器内命令，但程序化调用（如未来 Agent 驱动的 app-only 调用）不经过 UI；双保险且每层可单测。错误文案："This canvas is read-only in inline preview. Open the editor to make changes."（稳定 code：`read_only_preview`）。

### D3：streaming overlay 条件收紧

现状：`InlineCanvasPreview` 无条件渲染（app.tsx:8829）。改为仅 `streamingPreview?.active === true` 渲染（D1 中的条件分支）。

- `streamingPreview` 的 set/clear 逻辑（app.tsx:7121-7150）**不动**
- 权威 Tool Result 到达（`ontoolresult` → `acceptCanvasState`）→ `setStreamingPreview(undefined)`（现有逻辑）→ overlay 撤下，editor 已加载新权威 snapshot（`renderState`/`mutateFromServer` 现有链路）
- **结论**：B1"semantic SVG 仅保留流式骨架"通过条件渲染达成，`lightweightPreviewScene` 纯函数保留（行为测试不受影响）

### D4：camera 契约（B3）

```ts
// 内存态，不入 store/revision
const cameraSessionRef = useRef<Partial<Record<string, { x: number; y: number; z: number }>>>({});
```

1. **首屏**：inline 与 fullscreen 都执行 zoom-to-fit——`scheduleFullscreenZoomToFit`（app.tsx:6236）泛化为 `scheduleZoomToFit(editor)`（去掉 `displayModeRef.current !== "fullscreen"` 条件，app.tsx:6241），首次权威渲染后两种模式都调用（`ontoolresult`/`acceptCanvasState` 收尾处）
2. **camera 捕获**：模式切换前（`applyDisplayMode` 开头）`cameraSessionRef.current[canvasId] = editor.getCamera()`；切换后 `editor.setCamera(saved, {immediate:true})`（若无存档则 zoom-to-fit）
3. **不入 revision**：保存路径 app.tsx:8061 改为 `saveSnapshot = sanitizeSnapshotSession(editor.getSnapshot())`——新增纯函数：
   ```ts
   function sanitizeSnapshotSession(snapshot) {
     // 保留 session 结构（loadSnapshot 兼容），但 camera 归零、selection 清空
     if (!isRecord(snapshot.session)) return snapshot;
     return { ...snapshot, session: { ...snapshot.session, camera: { x: 0, y: 0, z: 1 }, selectedShapeIds: [] } };
   }
   ```
   - 服务端 `snapshotSchema` 是宽松校验（server.mjs），接受；历史 revision 读取不受影响
   - `snapshotDocumentKey` 已忽略 session（app.tsx:578），**幂等语义不变**
   - 备选：整体剥掉 session——**不推荐**（`snapshotActivePageId` app.tsx:5106 依赖 session.currentPageId 选页）
4. **切换 revision**：`renderHistoricalState` 已调 `scheduleFullscreenZoomToFit`（app.tsx:6548）→ 泛化后 inline 也生效，符合 B3"切换 revision 后重新 zoom-to-fit"
5. **camera 不触发 dirty**：已由 store 监听 scope:"document" 保证（app.tsx:6429-6437），无额外改动

### D5：历史 revision 只读复用

`renderHistoricalState`（app.tsx:6511）已完整实现"只读 + zoom-to-fit + 状态文案"；统一挂载后 inline 历史 Review 自动获得：
- 只读（isReadonly=true 已有）
- camera 交互（wheel/pan，readonly 不禁相机）
- 不可保存（D2 gate）
- "Edit 按钮改为 Review"（TL-02/04 相关）：现有历史 UI（app.tsx:8610+）已提供 Review 语义，按钮文案核对即可

### D6：就绪契约复用

`editorAssetUrls && authoritativeReady` 门（app.tsx:8836）在两种模式统一生效：
- inline 首次挂载：editor 未就绪时显示 `editor-loading` 占位 + streaming overlay（若流式激活），避免"黑色空白"
- 与 P0-A 的 ready-but-blank watchdog 语义一致（AppBridge initialized ≠ 可交互，editorReady 探测为准）

### D7：保留项与不改动

- `enforceBoundedEditorInputs`（app.tsx:5905）、asset bridge、`TLDRAW_UI_OVERRIDES`（只扩展 actions gate）、`TLDRAW_OPTIONS`（app.tsx:532）不变
- `applyDisplayMode` 的 dirty 保护 + host restore 协议（app.tsx:7040-7085）**保留**（虽单 editor 后 dirty 跨模式自然保留，但 host 侧协议必须兼容）
- 导出、尺寸上报（size-changed）、主题/字体加载链路不动

---

## 4. 分阶段实施步骤

### Stage 1：统一挂载（核心改造）

**改动**：app.tsx 渲染区（8829-8860）按 D1 重写；新增 `useEffect([displayMode, historicalRevision])` 只读同步；`.canvas.mode-inline` / `.canvas-overlay` CSS（8978 附近）。
**验证**：`bun test test/app.behavior.test.mjs`（纯函数测试应全过）；`test/app.parity.test.mjs` 会失败 1-2 项（预期，见 Stage 4）；`npm run build` 通过。
**风险**：inline 首次挂载 editor 的加载成本与 `editorAssetUrls` 门——需要人工观察首屏（验收 A1）。

### Stage 2：mutationAuthority gate

**改动**：D2 全部拦截点 + `TLDRAW_UI_OVERRIDES.actions` 扩展。
**验证**：新增源码级测试（见 §5.2 T2）；`bun test` 全量。

### Stage 3：camera 契约

**改动**：D4 全部（`scheduleZoomToFit` 泛化、cameraSessionRef、`sanitizeSnapshotSession` 接入保存路径、切换钩子）。
**验证**：新增测试 T3/T4；服务端协议测试全量回归（session 剥离不应影响 `server.protocol.test.mjs`）。

### Stage 4：测试改造 + 全量回归

**改动**：重写 `test/app.parity.test.mjs:38-62`（见 §5.1）；新增 §5.2 测试；检查 `app.export.test.mjs`、`probe.contract.test.mjs` 等对 `<Tldraw`/`InlineCanvasPreview` 的引用。
**验证**：`npm test` 全量 203+ 项通过；`npm run build` + `verify:dist` 通过。

### Stage 5：人工验收（需用户执行）

见 §7 清单（TL-01~07 + 回归点）。

---

## 5. 测试计划

### 5.1 必须重写的现有测试

`test/app.parity.test.mjs:38-62` "inline rendering is lightweight SVG and the only Tldraw mount is fullscreen"：
- 删除断言：`<Tldraw` 只出现在 fullscreen 分支、inline 分支 `doesNotMatch(/<Tldraw/)`
- 新断言：
  - 全文件 `<Tldraw` 恰好 1 处（**单挂载**语义保留）
  - `hideUi={inline}`（或等价的 `hideUi={displayMode === "inline"}`）出现在 Tldraw props
  - inline 分支渲染条件为 `streamingPreview?.active === true`（overlay 条件化）
  - `InlineCanvasPreview` 组件带 `className="canvas-overlay"` 或等价的叠层标记

### 5.2 新增测试（沿用源码级断言惯例）

| # | 测试 | 断言要点 |
|---|---|---|
| T1 | inline 与 fullscreen 共享单一 Tldraw 挂载 | 单 `<Tldraw`；模式只改 hideUi/readonly |
| T2 | mutationAuthority 拦截写入口 | save/restore/apply 入口含 `mutationAuthorityRef.current !== "current-revision"` 守卫与 `read_only_preview` 文案 |
| T3 | save payload 剥离 camera | 保存路径调用 `sanitizeSnapshotSession`；函数本体断言 session.camera 归零、selectedShapeIds 清空、currentPageId 保留 |
| T4 | camera 跨模式互传 | `cameraSessionRef` 在 applyDisplayMode 读写；切换后 `setCamera` 调用 |
| T5 | zoom-to-fit 两种模式 | `scheduleZoomToFit` 无 fullscreen 条件限制；首屏与 revision 切换路径调用 |
| T6 | streaming overlay 条件 | overlay 渲染条件 == `streamingPreview?.active === true`；非流式不渲染 |
| T7 | 历史 Review 只读 gate | `renderHistoricalState` 路径 + mutationAuthority → none |
| T8 | dirty 与 camera 隔离回归 | store 监听 scope:"document"（现有行为，防回归） |

### 5.3 保留不动

- `lightweightPreviewScene` 相关行为测试（app.behavior.test.mjs:885/908 等）——纯函数不变
- 服务端协议测试——除确认 session 剥离兼容外不动

---

## 6. 风险与回退

| 风险 | 等级 | 缓解 |
|---|---|---|
| inline 挂载完整 editor 的加载成本/首屏时间 | 中 | `editorAssetUrls` 门 + editor-loading 占位 + streaming overlay 兜底；D6 |
| hideUi 隐藏后无任何编辑入口，但用户期望 inline 可点 Edit | 低 | Edit 入口在宿主侧（displayMode 切换），不受 hideUi 影响；TL-04 验收确认 |
| session 剥离影响历史渲染（loadSnapshot 兼容性） | 中 | 保留 session 结构仅归零 camera（D4），`snapshotActivePageId` 依赖的 currentPageId 保留；Stage 3 后跑全量协议测试 |
| readonly 下键盘快捷键（delete 等）仍可触发 | 中 | 实例 readonly + `TLDRAW_UI_OVERRIDES.actions` gate 双保险（D2）；T2 覆盖 |
| 模式切换竞态（editor 未就绪时切模式） | 低 | editorReady 探测契约（D6）+ `useEffect` 幂等同步 readonly |
| `.canvas` inline 尺寸异常（高度塌陷） | 中 | `.canvas.mode-inline{min-height:190px}` + host context 尺寸；验收 TL-06 专项检查 |
| 现有测试固化双引擎（parity:38-62）被改后失去"防回退"锚点 | 低 | 新测试 T1/T6 以单挂载+overlay 条件重建锚点 |
| **回退方案**：Stage 1 完成后保留 `git stash` 快照；若人工验收 TL-02/06 不通过，可仅回退渲染区（restore 分支结构），其余 Stage 独立可弃 |

---

## 7. 人工验收步骤（TL-01~07）

前置：`npm run build` 后 `npm run serve`，OpenChamber 连接并让模型创建画布。

| 用例 | 操作 | 通过标准 |
|---|---|---|
| TL-01 | 模型创建含 text/arrow/rectangle/ellipse 的语义画布；切换 inline↔Edit | 两种模式字体、箭头、圆角、换行**完全一致**（截图对比）；inline 不再有"近似 SVG 图" |
| TL-02 | inline 下滚轮缩放、拖拽平移、触控板 pinch | 可缩放平移；服务端 revision 不变（`tldraw_list_canvas_revisions` 确认） |
| TL-03 | inline 下尝试：键盘 Delete、拖拽 shape、双击改文字、粘贴图片 | 全部被拒；无 dirty 标记；无 save 请求发出（服务端日志确认） |
| TL-04 | inline → 点 Edit（宿主切换 fullscreen） | 同一 canvas、同一 revision、内容一致、**camera 沿用 inline 视角** |
| TL-05 | Edit 中未保存修改 → 返回 inline | 走 host restore 协议（确认弹窗）；已保存内容一致 |
| TL-06 | App Board 上打开 tile | tile 内只读可缩放；点击后 fullscreen 打开全宽容器；高度不塌陷 |
| TL-07 | 模型创建 100+ shape 画布 | inline 缩放浏览流畅；无 shape 丢失；与 Edit 视图 shape 数一致 |
| 回归 | 历史 revision Review（r1 标签、restore）；导出 PNG/SVG；图片 asset 显示 | 全部正常；camera 归零后历史快照首屏 zoom-to-fit |

---

## 8. 工作量估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| Stage 1 | 统一挂载改造 | 0.5-1 天 |
| Stage 2 | mutationAuthority gate | 0.5 天 |
| Stage 3 | camera 契约 | 0.5-1 天 |
| Stage 4 | 测试改造与回归 | 1 天 |
| Stage 5 | 人工验收 + 修补 | 0.5-1 天（含用户时间） |
| **合计** | | **3-4.5 人日** |

---

## 9. 已知限制与后续

1. 本方案未经 agent 对抗审查（配额中断）；建议实施前由第二人按 §1 事实清单抽查
2. inline 与 fullscreen 的**像素级一致性**（TL-01）最终以人工截图对比为准；若 tldraw 自身在两种容器尺寸下有渲染差异（字体回退、动画），需在 Stage 5 记录并评估接受度
3. 与 P0-A 的联动：统一挂载后 inline 也有真实 editor，P0-A 的 ready-but-blank watchdog 对 inline 的判定更准确（editor 就绪 ≈ 有真实内容）
4. 后续可选：inline 小地图（计划 §4.2 可选）、streaming overlay 与 editor 的 crossfade 动效调优
