# MCP Apps 稳定化代码审查报告

> 日期：2026-08-03  
> 审查对象：OpenChamber、OpenCode Fork、`tldraw-mcp-app`  
> 审查角色：代码审查、自动化验收与修改计划；不负责本轮具体开发  
> 结论等级：**自动化主链大部分通过，但尚未达到发布验收条件**

## 1. 结论边界

本报告基于：

- 源码静态审查。
- OpenChamber Interactive UI/MCP App 测试。
- OpenChamber TypeScript 类型检查。
- OpenCode MCP App、HTTP API、lifecycle 测试。
- `tldraw-mcp-app` 单元测试、构建、分发校验与严格 MCP 2026 探针。
- 现有四份稳定化设计、实施和主报告。

本轮**没有使用 computer-use 在打包后的 OpenChamber 客户端中逐项点击**，也没有完成截图级的 23 项产品验收。因此本文严格区分：

1. **Confirmed**：由源码或命令稳定证明的问题。
2. **High-risk**：源码中存在明确架构风险，但尚未在真实客户端中复现。
3. **Unverified**：自动化覆盖不足，必须通过真实客户端验收确认。

本文不能证明 Excalidraw 或 tldraw 在真实客户端中必然失败；它证明的是当前证据不足以宣布发布通过，并存在需要开发 Agent 修复或补证的项目。

## 2. 当前发布判断

当前判断为 **Conditional No-Go**：

- MCP 2026 服务端、协议适配、App metadata 和严格绑定测试表现良好。
- OpenChamber Interactive UI 自动化测试通过。
- 但 OpenChamber 类型门禁失败。
- ready-but-blank 检测使用的“首次绘制”证据不可靠。
- tldraw 写权限存在跨实例共享状态风险。
- `csp-metadata-missing` 尚未接入运行链路。
- 23 项产品验收和 DMG 一致性仍未完成。

满足本文第 8 节的重新验收门禁后，才能改为 Go。

## 3. 自动化验收结果

### 3.1 OpenChamber

| 验证 | 结果 |
|---|---|
| Interactive UI 全量测试 | `168 pass / 0 fail` |
| MCP App 聚焦测试 | `82 pass / 0 fail`；包含于上述 168 项中 |
| `packages/ui` TypeScript 类型检查 | **失败**，2 个 `TS2339` |

执行命令：

```bash
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui

cd packages/ui
bun run type-check
```

### 3.2 OpenCode Fork

| 验证 | 结果 |
|---|---|
| App metadata、Session Tool、HTTP API | `18 pass / 0 fail` |
| MCP lifecycle，真实 loopback 服务 | `35 pass / 0 fail` |

执行命令：

```bash
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/app.test.ts test/mcp/session-tools.test.ts test/server/httpapi-mcp.test.ts
bun test test/mcp/lifecycle.test.ts
```

说明：lifecycle 首次在受限沙箱中运行时，所有 `Bun.serve({ port: 0 })` 用例因无法监听临时端口失败；在允许 loopback 的环境重跑后 `35/35` 通过。这批失败是测试环境污染，不计为产品回归。

### 3.3 tldraw MCP App

| 验证 | 结果 |
|---|---|
| 单元/协议测试 | `205 pass / 0 fail` |
| `npm run build:server` | 通过 |
| `npm run verify` | 通过 |
| `npm run accept` | 通过 |

独立 acceptance 包含：测试、服务构建、distribution verify、托管服务启停、状态检查和严格 MCP 2026 Apps probe。验收报告路径：

```text
/var/folders/19/k4c21tcd5gn762c2tbny9wh40000gn/T/
tldraw-mcp-acceptance-dRL79S/acceptance-report.json
```

该结果证明独立服务与协议链路正常，不等价于 OpenChamber/Electron 产品级 UI 验收。

## 4. 审查发现

### AUD-001：ready-but-blank 的首次绘制证据不可靠

- 等级：**P0 / Confirmed**
- 影响：Excalidraw 空白页可能被错误标记为 `ready`，发布门禁 1 和 EX-06 无法由当前实现证明。
- 文件：`openchamber/packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`
- 关键位置：约 1608、1688、1821、2212、2381 行。

当前逻辑：

1. Broker 只要发现内部 iframe 的 `getBoundingClientRect().width/height > 0`，就发送 `broker.visible-content`。
2. Host 收到 `visible-content` 后调用 `markFirstPaint()`。
3. AppBridge `onsizechange` 也会直接调用 `markFirstPaint()`。

iframe 有布局尺寸并不表示页面已经画出文字、Canvas、SVG 或其他可见像素。一个完全空白的 iframe 同样可能满足条件。

#### 修改方向

1. `onsizechange` 只能记录布局里程碑，禁止直接作为 first-paint 证据。
2. `getBoundingClientRect()` 只能说明容器存在，不能发送 `visible-content`。
3. 在 Host 注入的、nonce 绑定的 App bootstrap 中采集更强的渲染信号，例如：
   - `document.body` 出现满足面积阈值的可见元素；
   - Canvas/SVG/主要根节点出现并完成至少一次 `requestAnimationFrame`；
   - 可用时结合 `PerformanceObserver`/paint timing；
   - 信号只用于诊断状态，不授予任何额外 RPC 权限。
4. first-paint 信号必须绑定当前 `bindingEpoch`、nonce、iframe source 和 opaque origin。
5. 增加真实浏览器 fixture：
   - 有尺寸但无内容，必须进入 `ready-but-blank`；
   - 只有空 Canvas，仍不得误判；
   - 延迟渲染内容，在 deadline 前应转为 ready；
   - 旧 epoch 的 paint 消息不得使新 App ready。

#### 验收标准

- AppBridge initialized、iframe load、sizechange 均不能单独解除 blank watchdog。
- 空白 fixture 在规定时间进入稳定的 `ready-but-blank`。
- 正常 Excalidraw/tldraw 页面在真实浏览器中进入 ready，且截图含非空内容。

### AUD-002：tldraw mutation authority 为模块级全局状态

- 等级：**P0-B / High-risk**
- 影响：聊天 inline、App Board、Pin、Review 和 fullscreen/Edit 同时存在时可能相互覆盖读写权限。
- 文件：`tldraw-mcp-app/src/app.tsx`
- 关键位置：约 518、525、7480 行。

当前实现使用：

```ts
let activeMutationAuthority: "none" | "current-revision" = "none";
```

每个组件实例都会在 effect 中修改这个模块级变量，而 `TLDRAW_UI_OVERRIDES.actions()` 又读取同一个变量。这破坏了实例隔离，并且行为可能取决于挂载顺序。

当前 `editor.updateInstanceState({ isReadonly })` 和各程序化写入口的实例级检查能降低风险，但不能证明共享 action override 安全。因此不能仅凭源码正则测试认定 TL-03/TL-04 已通过。

#### 修改方向

推荐按 Editor 实例绑定权限，而不是引入另一个组件级全局值：

1. 使用 `WeakMap<Editor, MutationAuthority>`，以 `actions(editor, actions)` 的 `editor` 作为 key。
2. action wrapper 在实际 `onSelect` 执行时读取该 Editor 的当前权限，不在 overrides 初始化时固化权限。
3. Editor unmount 时删除 WeakMap 条目。
4. 保留 `isReadonly` 作为编辑器底层保护。
5. 所有 save/restore/add/delete/import 等程序化写入口继续调用实例级 `hasMutationAuthority()`。
6. recovery-copy、historical review 与 current revision 的权限状态必须分别定义，不共享布尔值。

#### 必补测试

至少同时挂载两个实例：

1. inline + fullscreen：fullscreen 可编辑，inline 不能写。
2. inline + App Board：两个实例均只读，但 zoom/pan 可用。
3. historical Review + current Edit：Review 不能写，Edit 可写。
4. 卸载最后挂载的实例，不改变仍存活实例的权限。
5. 交换挂载顺序，行为完全一致。
6. 键盘 delete/cut/paste/undo/redo 与按钮、菜单、程序化 action 都受同一权限规则约束。

### AUD-003：OpenChamber UI 类型检查失败

- 等级：**P1 / Confirmed / Release blocker**
- 文件：`openchamber/packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts`
- 位置：1974-1975 行。

错误：

```text
TS2339: Property 'toMatch' does not exist on type ...
```

#### 修改方向

优先使用当前测试类型已经支持的断言，不建议为了两条测试扩大全局类型：

```ts
expect(/.../.test(policy)).toBe(true);
```

或者拆成稳定的 `toContain()` 断言。修复后必须把 `bun run type-check` 纳入“自动化全部通过”的硬门禁。

### AUD-004：`csp-metadata-missing` 只有模型定义，没有运行时接线

- 等级：**P1 / Confirmed**
- 影响：EX-04 未实现；诊断报告声称支持的错误码不会由真实渲染器产生。
- 文件：
  - `openchamber/packages/ui/src/lib/interactive-ui/mcpApp.ts`
  - `openchamber/packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`

`mcpApp.ts` 定义了 `csp-metadata-missing` 和用户文案，但 Renderer 中没有对应 `recordFailure('csp-metadata-missing')` 路径。最新主报告也把 EX-04 标记为“未接线”。

#### 修改方向

1. 在 App resource 进入 sandbox 之前判定 CSP metadata 是否存在、是否结构有效。
2. 缺失与 malformed 必须使用不同的内部诊断 detail，但对用户只显示稳定、脱敏的信息。
3. 明确产品策略：
   - 若规范要求 CSP metadata 必填，缺失时直接 fail-closed；
   - 若兼容旧 App，必须提供受限 legacy profile，并明确标记来源，不能静默当作完整策略。
4. 失败状态必须稳定、不可被 Retry 无限循环掩盖。

#### 验收标准

- 无 CSP、空 CSP、非法 origin、合法 offline CSP、合法远端依赖 CSP 均有独立测试。
- EX-04 在真实客户端中显示明确错误，而不是空白或泛化的 script error。

### AUD-005：历史会话恢复缺少持久化重启测试

- 等级：**P1 / Unverified**
- 文件：`opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- 关键位置：117-143、162-203 行。

当前代码正确地要求：

- 精确 `sessionID/messageID/partID`。
- 完成状态的 ToolPart。
- 精确 tool key、server、resource URI 和 origin metadata。

这些约束是安全边界，**不得通过宽松匹配来修复历史 403/404**。当前缺口是没有自动化证明：创建会话、持久化、退出、重启、重新连接 MCP Server 后，同一个 ToolPart 仍能恢复 resource 和 app-only tool authority。

#### 修改方向

1. 新增进程级持久化测试：
   - 创建 MCP App ToolPart；
   - 关闭 OpenCode；
   - 从同一数据库和配置重启；
   - 重新发现/连接 MCP Server；
   - 通过原始 session/message/part 读取 resource；
   - AppBridge 调用绑定的 app-only tool。
2. resource registry 未就绪时应返回可区分的“server/catalog 尚未恢复”，而不是误报 binding 失效。
3. 服务端资源发生合法更新时，旧 ToolPart 的 resource identity 策略需要明确：允许同 URI 新内容，还是固定历史 hash。
4. 保留跨会话、跨 message、跨 server、跨 resource 的 403 负向测试。

### AUD-006：23 项产品验收尚未完成

- 等级：**Release evidence gap / Confirmed**

最新主报告自己的状态显示：

- Excalidraw EX-01~07：多数待人工，EX-04 未接线。
- tldraw TL-01~07：代码就绪或部分就绪，但全部缺真实客户端视觉/交互证据。
- revision RV-01、RV-02、RV-05：部分完成。
- quota QT-04、QT-05、QT-06：部分完成。
- 明确标记“已实现”的只有 RV-03、RV-04、QT-01、QT-02、QT-03。

因此不能把“205/205 单测通过”解释为“23 项产品验收通过”。

### AUD-007：报告状态与真实门禁不一致

- 等级：**P2 / Confirmed**

`MCP_APPS_STABILIZATION_MASTER_REPORT.md` 使用“自动化全通过”，但 `packages/ui` 的 `type-check` 实际失败。`MCP_APPS_STABILIZATION_IMPLEMENTATION_RECORD.md` 又保留 P0-B 未完成的早期状态，容易被误认为当前结论。

#### 修改方向

1. 主报告的“自动化通过”必须同时包含 test、type-check、build、verify。
2. 历史实施记录顶部标记“已被主报告取代，不代表当前状态”。
3. 每项验收记录：commit、构建产物 hash、测试命令、退出码、证据文件。
4. 代码就绪、自动化通过、computer-use 通过、用户确认必须是四种不同状态。

## 5. 不应采用的修复方式

1. 不得放宽 OpenCode 的 session/message/server/resource 精确绑定。
2. 不得把 iframe load、sizechange 或非零尺寸继续当作真实绘制证据。
3. 不得通过允许任意网络、移除 CSP 或加入 `allow-same-origin` 来解决 Excalidraw 空白。
4. 不得为了解决 tldraw 多实例问题退回双渲染引擎。
5. 不得把 fallback、Original Tool Output 或空白 iframe 算作 UI 验收通过。
6. 不得只更新报告状态而没有新的测试或截图证据。

## 6. 开发 Agent 建议执行顺序

### 第一批：必须先修

1. AUD-003：修复 TypeScript 类型门禁。
2. AUD-001：重构 first-paint evidence。
3. AUD-002：实现每 Editor 实例的 mutation authority。
4. AUD-004：接通 CSP metadata 缺失诊断。

### 第二批：自动化补证

1. 多实例 tldraw 权限测试。
2. blank/late-paint/real-paint 浏览器 fixture。
3. OpenCode 持久化重启与历史 resource 恢复测试。
4. quota 并发、teardown、generation 测试。
5. revision provenance App UI 与内部 revision 开关。

### 第三批：真实客户端验收

1. 构建与源码 commit 对应的 OpenCode Fork。
2. 写入并校验 OpenChamber CLI lock。
3. 构建 DMG，记录 DMG、内置 CLI 和 App resource hash。
4. 使用 computer-use 在安装后的正式客户端执行 23 项用例。
5. 每项保存截图/视频、runtime phase、ToolPart binding 和失败状态。

## 7. 开发完成后的自动化命令

```bash
# OpenChamber
cd /Users/loloru/Documents/data/project/openChamber/openchamber
bun test packages/ui/src/lib/interactive-ui packages/ui/src/components/interactive-ui
cd packages/ui
bun run type-check

# OpenCode Fork
cd /Users/loloru/Documents/data/project/openChamber/opencode/packages/opencode
bun test test/mcp/app.test.ts test/mcp/session-tools.test.ts test/server/httpapi-mcp.test.ts
bun test test/mcp/lifecycle.test.ts

# tldraw MCP App
cd /Users/loloru/Documents/data/project/openChamber/tldraw-mcp-app
npm test
npm run build:server
npm run verify
npm run accept
```

所有命令必须顺序运行，避免再次把本机内存打满。涉及 loopback server 的测试必须在允许监听 `127.0.0.1` 临时端口的环境执行。

## 8. 重新验收门禁

只有同时满足以下条件，审查结论才可改为 Go：

- [ ] OpenChamber test、type-check、build 全部退出码 0。
- [ ] OpenCode App/API/lifecycle 全部退出码 0。
- [ ] tldraw test、build、verify、accept 全部退出码 0。
- [ ] first-paint 不再由 sizechange/iframe 尺寸单独触发。
- [ ] 两个以上 tldraw App 实例同时挂载时权限互不干扰。
- [ ] EX-04 `csp-metadata-missing` 真实接线。
- [ ] 历史会话在进程重启后不出现错误的 403/404。
- [ ] Excalidraw EX-01~07 有真实客户端证据。
- [ ] tldraw TL-01~07 有真实客户端证据。
- [ ] revision RV-01~05 与 quota QT-01~06 完成。
- [ ] App Board、Pin、inline、Edit、Review、fullscreen 的组合路径通过。
- [ ] DMG 内置 OpenCode Fork 与验收源码、SDK、lock 完全一致。
- [ ] fallback 和 Original Tool Output 没有被计为 MCP App 成功。

## 9. 审查结语

本轮结果说明底层协议实现和 tldraw 独立服务已经具备较好的自动化基础；剩余风险主要集中在 OpenChamber Host 的真实渲染判定、tldraw 多实例隔离、历史恢复以及发布证据链。

开发 Agent 应先修复 Confirmed/High-risk 项，再交回审查方执行 computer-use 产品验收。当前不建议继续增加新功能或发布正式版本。
