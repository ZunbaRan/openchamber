# OCIX 与 OpenChamber 桌面打包踩坑手册

> 适用范围：签名 `.ocix`、静态 Marketplace catalog、Agent Runtime 部署，以及 Electron macOS 打包验收。  
> 打包包含两条不同流水线：扩展包把企业能力交付给 OpenChamber；桌面包把 OpenChamber、Web 资源和 bundled OpenCode 一起交付给最终用户。

## 1. 两种“打包”不要混为一谈

| 产物 | 必须包含 | 成功标准 |
|---|---|---|
| `.ocix` | manifest、View/Native assets、Agent Tool/Skill、文件索引、发布者身份、公钥和 Ed25519 签名 | 安装器能检查、提示信任、验证、安装、启用并让对话发现 Tool/View |
| OpenChamber Desktop `.app` | 当前 Web assets、Electron main、Web server/runtime、生产内置 Tool/Skill、bundled OpenCode、所需 native modules | 在干净机器语义下启动，不依赖外部 OpenCode，并完成真实内容与生命周期验收 |

`.ocix` 通过不证明 `.app` 包含了最新扩展 Runtime；`.app` 能启动也不证明 `.ocix` 的 Agent 半边可发现。

## 2. `.ocix` 打包踩坑

### 2.1 只打包 UI，安装后模型没有 Tool 可选

开发目录至少应形成以下结构：

```text
openchamber.extension.json
ui/
  declarative/
  native/
agent-runtime/
  tools/
    <globally-unique-tool>.ts
  skills/
    <skill-name>/SKILL.md
```

View 声明的业务 Tool 必须由 `agent-runtime/tools` 提供，或在 manifest/文档中明确属于独立治理的 MCP。不能把“UI 已安装”当作 Agent 能力已部署。

### 2.2 为每个扩展设置 `OPENCODE_CONFIG_DIR`

**问题**：一个进程只能使用一套配置目录。把它指向 `simple-crm/agent-runtime` 后，第二个扩展就没有自然位置，多个扩展也无法统一治理。

**当前合同**：Managed Local OpenCode 使用共享的全局 Tool/Skill 目录。Extension Manager 把 active version 的 Tool 写入 `~/.config/opencode/tools/<tool>.<ext>`，Skill 写入 `~/.config/opencode/skills/<skill-name>`，并记录 owner、version 和 hash。启用、禁用、升级、回滚和卸载都由安装器协调；不要给用户留下每扩展环境变量配置步骤。

测试可以通过专用环境变量把这套共享目录重定向到临时位置，但那是隔离手段，不是产品安装方式。

### 2.3 Tool/Skill 名称冲突时静默覆盖

全局 Agent 文件可能属于用户、另一个 OCIX，或已被安装后手动修改。静默覆盖会造成供应链和回滚问题。

安装器必须拒绝以下情况：

- 目标是用户自有、未登记的文件；
- 目标由另一个已启用扩展拥有；
- 受管副本的实际 hash 与记录不一致；
- Tool 文件名不唯一、没有默认导出，或 Skill frontmatter 与目录名不一致。

失败应保持原 active version 和原文件有效，不得留下半安装状态。

### 2.4 把公钥当作 Secret，或把私钥打进包

`.ocix` 应内嵌发布者 ID、名称、Key ID 和 **公钥**，便于安装器检查签名并展示 fingerprint。公钥不是业务 Access Key，也不是 Secret。

**绝不能进入包、仓库、日志或 UI 的是私钥。** 私钥只用于离线签名。生产环境应通过独立渠道核对 fingerprint；“包内公钥能验证包内签名”只证明自洽和完整性，不证明发布者的现实身份，也不证明 Native 代码安全。

### 2.5 先信任再检查，或保留手工录入发布者表单

推荐安装流是：

```text
选择 .ocix
  → 解析签名索引和内嵌公钥
  → 验证包自洽、文件 hash、扩展 ID 和 publisher/key ID
  → 展示 fingerprint、Native 状态、网络权限、Tool/Skill 和 routing 摘要
  → 用户确认信任
  → 写入受信发布者并安装
```

用户不应预先手抄 Publisher ID、Key ID 和 PEM。Marketplace 同理：先检查签名 catalog 和内嵌 identity，再询问是否信任。

### 2.6 签名只覆盖 manifest，没有覆盖全部文件

签名索引必须覆盖扩展/发布者身份、时间戳以及每个文件的路径、字节长度和 SHA-256。否则攻击者可以替换 Native bundle、Tool 或 Skill 而不破坏 manifest 签名。

还要拒绝路径穿越、绝对路径、symlink、重复标准化路径、未知关键字段和越界大小。

### 2.7 Marketplace 只校验 catalog，不校验最终包

完整验证顺序应为：

1. 固定并信任 Marketplace identity/key；
2. 验证 catalog 签名；
3. 校验 package URL 策略；
4. 下载并校验 catalog 声明的 package hash；
5. 校验 catalog 委派的 publisher key；
6. 再验证 `.ocix` 签名和文件索引。

任一层失败都不能继续安装。

### 2.8 外部 OpenCode Server 的双端部署被忽略

本地 Managed OpenCode 可由一次 `.ocix` 安装部署 Host 与 Agent 两半。使用外部 OpenCode Server 时，OpenChamber 不会把本机 `~/.config/opencode` 自动复制到远端：

- `.ocix` UI 仍安装在 OpenChamber Host；
- Tool/Skill 必须通过远端管理员的部署通道安装到 OpenCode Server；
- 当前没有远程双端自动协商，缺少任一半都应明确报错，不能用通用空 View 冒充成功。

## 3. Electron / Desktop 打包踩坑

### 3.1 验收的是旧 `.app`

**症状**：源码与开发环境正常，`test:interactive-ui-desktop-packaged` 却显示 `tools=0, skills=0` 或缺少新 UI。

**根因**：打包验收脚本读取 `packages/electron/dist` 中已经存在的 `.app`，不会自动替你重建。源码或资源变化后，旧 `.app` 仍可被找到并启动。

**规则**：任何 Web assets、server、内置 Runtime、Electron main/preload、依赖或资源变化后，必须先执行：

```bash
bun run electron:build
bun run test:interactive-ui-desktop-packaged
```

不要只凭文件存在判断新鲜度；必要时对包内资源 hash、版本或时间戳与源码构建结果做比对。

### 3.2 包里带了 OpenCode，但运行时偷偷用了系统 OpenCode

打包验收必须清除 `OPENCODE_BINARY`、`OPENCODE_CONFIG_DIR`、host/port、skip-start 等覆盖，并使用受限 `PATH`、全新 data/user-data/config。健康接口必须证明：

- `openCodeRunning === true`；
- `opencodeBinarySource === "bundled"`；
- resolved binary 指向 `.app/Contents/Resources/opencode-cli/opencode`；
- 实际 Tool inventory 包含内置 `interactive_ui`、`html_artifact` 和 `interactive-ui-visualization` Skill。

只有这样才能支持“用户无需额外安装 OpenCode”的发布声明。

### 3.3 内置 Tool/Skill 在源码中存在，但没进入生产资源

开发 demo 目录和生产内置 Runtime 是两套来源。打包必须携带当前 Web server 的 `builtin/agent-runtime`、manifest 和 View 资源，并在 OpenCode 启动前协调到干净配置目录。

包内容验收不能只检查文件存在；还要让 bundled OpenCode 实际列出 Tool/Skill，并让 Generated View 和 Artifact 返回非空 summary/metadata。

### 3.4 Web assets、Electron main 和 native modules 不是同一次构建

正确的 Electron package 流水线需要依次准备 Web assets、bundled OpenCode、main bundle，并按 Electron ABI 重建 native modules。跳过其中任一环节都可能得到“能打开但功能错位”的混合产物。

根命令 `bun run electron:build` 是命令源；不要直接拼装部分 `dist` 目录冒充最终包。

### 3.5 自定义协议 CSP 过宽或过窄

开发页面通常来自 loopback/HMR，打包页面来自 `openchamber-ui://app`。只允许 HTTP 会让打包 Artifact 空白；允许所有 custom scheme 或 `*` 又会扩大攻击面。

规则是精确允许产品拥有的 `openchamber-ui://app` Host，并保留 Artifact Broker/opaque child 的既有隔离。不通过关闭 CSP 修复白屏。

### 3.6 只检查 Host 卡片，不检查 iframe 内容

空 Host、fallback 或错误卡也可能让选择器“存在”。打包验收至少要断言：

- Generated summary 和 metadata 非空，原始 JSON fallback 未显示；
- Static Artifact state 为 `ready`、iframe 数量为 1、summary 非空；
- cache 清空后以相同 content ID 重建；
- inline/workspace/fullscreen 复用同一 iframe；
- scripts 关闭时无 iframe，并显示明确 fallback；
- app 停止后端口关闭，重新启动后内容仍恢复；
- renderer Runtime error 为 0。

### 3.7 把构建 warning 当成 blocker，或完全忽略 warning

当前 Vite 的 KaTeX 字体解析和既有大 chunk 提示不自动等于打包失败；反过来，“命令退出 0”也不代表 bundle 没有退化。

应检查冻结预算和代码分割事实：Artifact renderer 必须继续是独立 lazy chunk，主聊天入口和 Artifact chunk 都不能超过已批准预算。warning 若属于历史基线，应在报告中明确，而不是宣称零 warning。

### 3.8 macOS 通过后宣称所有平台通过

当前真实证据覆盖 macOS arm64，并可使用 ad-hoc 签名完成本机验收。生产 Developer ID signing/notarization 是独立发布治理；Windows/Linux desktop 和 Capacitor 必须分别验证自定义协议、Secret Store、进程生命周期、CSP 和显示模式。

macOS 构建时缺少 Windows/Linux 可选 native dependency 的提示，不必阻断 macOS；但也绝不能由此推断其他平台通过。

## 4. 推荐命令

### 4.1 扩展包

以 [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md) 中的当前 CLI 参数为准：

```bash
bun run interactive-ui:extension -- validate /absolute/path/to/extension
bun run interactive-ui:extension -- pack /absolute/path/to/extension \
  --out /absolute/path/to/dist/extension.ocix \
  --private-key /absolute/offline-key-directory/publisher.private.pem \
  --publisher-id com.acme.publisher \
  --publisher-name "Acme" \
  --key-id release-2026
bun run interactive-ui:extension -- verify /absolute/path/to/extension.ocix
bun run test:interactive-ui-extension
```

不要把真实私钥路径或内容写入共享日志、报告和示例配置。

### 4.2 桌面包

```bash
bun run electron:build
bun run test:interactive-ui-desktop-packaged
bun run test:interactive-ui-runtime-performance
```

当前打包验收证据输出到：

```text
.tmp/interactive-ui-packaged-desktop/report.json
.tmp/interactive-ui-packaged-desktop/static-artifact-packaged-macos.png
```

## 5. 发布前检查表

- [ ] `.ocix` 同时包含 Host 与 Agent 两半，或明确声明受治理的外部 MCP；
- [ ] 包内只有公钥，没有私钥、Access Key 或 Token；
- [ ] 文件索引覆盖所有内容，签名和 hash 均验证；
- [ ] 用户在安装确认中看到 fingerprint、权限、Native 和 Tool/Skill 摘要；
- [ ] Tool/Skill 冲突不会覆盖用户或其他扩展文件；
- [ ] 扩展升级、回滚、禁用和卸载后 Agent Runtime 与 active version 一致；
- [ ] 源码/资源变化后已重新构建 `.app`；
- [ ] 干净环境证明使用 bundled OpenCode；
- [ ] 实际内容、cache 重建、显示模式、重启和进程退出均通过；
- [ ] 平台、签名和 Runtime 支持声明没有超出证据范围。

## 6. 关联资料

- [OCIX Extension Architecture](./INTERACTIVE_UI_EXTENSION_ARCHITECTURE.md)
- [Installed Declarative / Trusted Native 开发手册](./INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md)
- [OCIX Connector Authentication v1](./OCIX_CONNECTOR_AUTHENTICATION_V1.md)
- [Interactive UI 统一验收报告](./INTERACTIVE_UI_UNIFIED_ACCEPTANCE_REPORT.md)
- [OCIX 构建 Skill](../.agents/skills/build-openchamber-interactive-extension/SKILL.md)
