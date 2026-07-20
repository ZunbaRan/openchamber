# ChatGPT/Codex Desktop 可视化与 Artifact 本地静态调研

> 调研日期：2026-07-18<br>
> 性质：为 OpenChamber 设计服务的只读静态分析记录，不是 OpenAI 公开 API 文档<br>
> 关联设计：[Interactive UI 扩展架构](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)

## 1. 结论

本机应用展示出的路线不是“让模型生成 React 后直接插进主页面”，而是把不同信任级别的内容分开处理：

1. Documents、Presentations、Spreadsheets、Sites 等持久 Artifact 由专用 plugin/skill 生成文件或站点。
2. 临时可视化由 Agent 生成线程作用域 HTML fragment，Host 通过 `codex-inline-vis` 指令识别并在专用隔离环境中内联展示。
3. 隔离容器并不等于明显的第三方 iframe 外观。Host 负责透明背景、主题、宽度、高度和窄桥接，因此用户看到的仍是对话流中的一体化卡片。
4. 该临时可视化被明确禁止直接调用 tools；需要真实业务权限的长期模块不能复用它的信任模型。

这与 OpenChamber 的三层路线一致：有界 Declarative 同页渲染、管理员安装的 Trusted Native 同页执行、任意模型代码进入视觉无感但安全存在的 HTML Artifact sandbox。

## 2. 调研对象与方法

### 2.1 对象

只读检查了两个本地样本：

| 样本 | 标识 | 版本 |
|---|---|---|
| `/Applications/ChatGPT.app` | `com.openai.codex` | `26.715.31251`，build `5538` |
| `/Users/loloru/Downloads/ChatGPT.dmg` | 同一桌面产品线的较新镜像 | `26.715.31925`，build `5551` |

应用 UI 名称与 bundle identifier 并不完全一致，因此本文使用“ChatGPT/Codex Desktop”描述该本地 Electron 客户端，不把结论外推到所有 ChatGPT 客户端。

### 2.2 方法

- 读取 `Info.plist` 和 Electron `app.asar` 目录结构。
- 对 DMG 只读挂载，抽取与 Artifact、inline visualization、sandbox 和 Host Bridge 相关的前端资源，完成后卸载。
- 在压缩 bundle 中定位协议字符串、分支和消息处理器，再结合已安装的 bundled `visualize` skill 说明理解生成侧约束。
- 没有登录、截取 token、发起网络请求、修改应用、绕过签名或执行其中的任意业务代码。

### 2.3 证据边界

这些发现是特定构建的实现细节：

- 公开 Codex 手册没有把 `codex-inline-vis`、Host Bridge 字段或 sandbox ID 定义成第三方稳定 API。
- 压缩代码中的字段可能在下一版重命名或删除。
- 静态分析能确认代码路径和约束，不能证明服务端所有策略或未触发分支。
- 本文只记录接口形状和安全设计，不复制应用源代码。

因此，OpenChamber 可以借鉴架构，不能直接依赖这些内部名字做产品兼容。

## 3. 能力分层

### 3.1 持久 Artifact

本地资源中可见的 Artifact 生成入口包括：

- Documents：`documents@openai-primary-runtime`
- Presentations：`presentations@openai-primary-runtime`
- Spreadsheets：`spreadsheets@openai-primary-runtime`
- Sites：`sites@openai-bundled`

生成提示会引导 Agent 调用对应 skill/plugin。Documents、Presentations 和 Spreadsheets 产出可下载、可继续编辑的文件；Sites 产出站点并在应用内浏览器中预览。这类 Artifact 的核心是“持久交付物”，不是一条 ToolPart 内的临时 React 组件。

### 3.2 Inline Visualization

另一条代码路径识别单行指令：

```text
::codex-inline-vis{file="<thread-scoped-file>.html"}
```

Host 从允许的线程可视化目录读取该文件，将其作为 `visualization-file` 能力加载，然后在 `codex-inline-visualization` 隔离环境中显示。它解决的是图表、模拟器、可调实验、地图和探索器等“需要现场生成表现形式”的任务。

### 3.3 Notebook、Mermaid 与 App/Site 预览

bundle 中也存在 Notebook preview、Mermaid diagram、App generation 和 in-app browser 等路径。它们说明桌面端并非只有一种“卡片 renderer”，而是按资源形态选择宿主：

- 确定性图形可以使用 Mermaid 等受控 renderer。
- 文件型成果进入 Artifact tab 或文件预览。
- 站点进入应用内浏览器。
- 临时交互可视化进入 inline visualization sandbox。

## 4. Inline Visualization 完整路径

```text
用户要求图表/模拟器/可视化
  → Agent 读取 visualize skill
  → Agent 在当前任务的可视化目录写入 HTML fragment
  → Agent 输出 codex-inline-vis 文件指令
  → 消息 renderer 严格匹配指令
  → Host 校验文件能力与可访问范围
  → Host 构建主题、locale、timezone、尺寸和桥接环境
  → fragment 在专用 sandbox 中执行
  → 内容上报 intrinsic height
  → Host 在对话流中调整容器高度
  → 用户交互可本地更新，或通过窄桥接发送 follow-up
```

关键点是 HTML 文件不是直接作为主页面 DOM 的 `innerHTML` 执行。消息里只保存或引用一个资源，真正的执行发生在受控环境。

## 5. 生成侧契约

本机 bundled `visualize` skill 给 Agent 的约束比普通网页开发严格：

- 输出 HTML fragment，不是完整 `html/head/body` 文档。
- 文件位于当前任务专用目录，并通过唯一 directive 引用。
- 单个 fragment 有大小限制；当前 skill 记录为小于 2 MB。
- 禁止 `fetch`、XHR 和 WebSocket，不把临时页面变成任意网络客户端。
- 外部脚本/样式只能使用受控 CDN allowlist；Host 提供主题、基础 CSS、图标和工具。
- 本地筛选、排序、拖动、输入和模拟可以在 fragment 内完成。
- 需要继续与 Agent 对话时使用 `window.openai.sendFollowUpMessage`，而不是直接操作聊天 DOM。

这些是本机 bundled plugin 对生成器的约束，不应被描述为所有 ChatGPT 产品永久不变的公开协议。

## 6. Host 注入与视觉无感

Host 构造的环境包含或引用以下信息：

- 当前主题和可视化 style variables。
- locale、timezone、平台和设备能力。
- `displayMode: inline` 与 `availableDisplayModes: [inline]`。
- 宿主最大宽度、移动端信息和高度边界。
- `notifyIntrinsicHeight`，让内容高度变化回传给外层。
- `openExternal`、`sendFollowUpMessage` 和 widget state 等受控能力。

当前 bundle 对 intrinsic height 做数值解析和上限裁剪，最大高度常量为 10,000 CSS 像素。Host 仍可在超高内容上提供滚动或布局控制。

这解释了为什么用户不一定感到自己在 iframe 中：

1. 外层没有第三方站点导航条或独立产品 chrome。
2. 背景、字体、边距和颜色来自宿主。
3. 高度随内容变化，不固定成一个小窗口。
4. Follow-up 和外链通过宿主桥接，交互仍然位于当前任务语境。

“视觉无感”与“安全同域”是两件事。前者由设计系统和尺寸协商实现，后者反而必须避免。

## 7. Bridge 与权限边界

静态资源中可确认的 Host 处理能力包括：

- `notifyIntrinsicHeight`
- `openExternal`
- `requestDisplayMode`，当前 inline visualization 返回 inline
- `sendFollowUpMessage`
- `updateWidgetState`

注入脚本会检查用户激活后再处理部分外部动作。Host 侧还包含 URL 校验和消息通道/RPC 路由。

最关键的安全信号是明确错误：

```text
Inline visualizations cannot call tools
```

也就是说，临时 HTML 可以表达交互，但不能自动继承 Agent 的 tool 权限、文件权限或企业 API token。它可以把用户意图发回对话，由 Agent 在正常权限和确认链路中继续执行。

## 8. 为什么仍然需要 sandbox

HTML/JavaScript 获得的不是“画图权限”，而是一整套执行能力。若与宿主同域运行，任意生成代码理论上可以：

- 读取对话 DOM、页面状态和可访问的浏览器存储。
- 伪造宿主控件、覆盖点击区域或监听用户输入。
- 访问同域 API，继承浏览器自动携带的 cookie 或认证上下文。
- 修改原型、注册全局事件、制造无限循环或破坏其他消息组件。
- 在历史消息重放时再次执行不可预测的副作用。

“不给 fragment token”不能解决同域 DOM、cookie、宿主状态和供应链脚本问题。sandbox、独立 origin、CSP、资源 allowlist、桥接 allowlist、大小/高度/CPU 边界需要组合使用。

对于已由管理员审核和安装的企业 Native 模块，可以接受同页信任；对于每次由模型现场生成的代码，不能把“用户想看一个图”解释成“用户同意执行拥有客户端权限的新插件”。

## 9. 与 OpenChamber 的直接映射

| ChatGPT/Codex Desktop 发现 | OpenChamber 对应路线 | 决策 |
|---|---|---|
| 固定 Artifact skill/plugin | Agent/企业扩展 skill + tool | 保留职责分离 |
| inline HTML fragment | HTML Artifact | 下一阶段实现 |
| inline sandbox + 自适应高度 | 透明、自适应 sandbox host | 视觉无感但隔离存在 |
| Host 注入主题/locale | Artifact design-system bridge | 只注入数据与窄能力 |
| 禁止 inline vis 调 tools | Artifact 不直接访问 Business Gateway | 权限回到 Agent/已安装扩展 |
| 持久文件/站点与临时 vis 分开 | Artifact 与 Installed UI 分开 | 不统一成一种 runtime |
| 本地交互 + follow-up bridge | 模拟器本地运行，业务动作回 Agent | 降低桥接权限 |

## 10. 对 OpenChamber HTML Artifact 的最低要求

开始实现前至少需要一个独立 ADR 固化：

1. 线程作用域资源目录、生命周期、历史重放和删除策略。
2. sandbox flags、独立 origin、CSP、CDN/离线资源 allowlist。
3. 最大文件、节点、高度、消息频率和运行时资源限制。
4. Host 注入的主题、locale、timezone、宽度与图标版本。
5. Bridge 方法的逐项 schema、用户激活要求和审计。
6. 禁止 API/token/tool/文件系统访问的强制边界。
7. fragment 失败时保留原始消息和可见错误。
8. Web、Desktop、VS Code、Mobile 的 capability matrix。

它应当在对话流中内联展示；侧边栏、workspace 或 fullscreen 可以是同一资源的额外 display mode，而不是唯一入口。

## 11. 不能从本次调研推出的结论

- 不能认为 `codex-inline-vis` 是对第三方开放的稳定 ChatGPT API。
- 不能认为所有 ChatGPT 平台都使用相同 Electron sandbox。
- 不能从客户端 bundle 推断服务端模型如何决定调用可视化 skill。
- 不能证明所有 Host Bridge 方法都对第三方 fragment 开放。
- 不能把本地 skill 的 CDN 和大小限制视为永久产品承诺。
- 不能据此复制 ChatGPT 的协议名称；OpenChamber 应定义并版本化自己的 Artifact contract。

本次逆向真正验证的是架构原则：任意生成表现力与宿主权限必须解耦，而良好的自适应和主题注入可以让这种隔离在视觉上几乎不可见。
