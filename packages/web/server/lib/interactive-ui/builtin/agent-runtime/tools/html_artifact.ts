import { tool } from '@opencode-ai/plugin';

export default tool({
  description: '生成一个在 OpenChamber 对话流中隔离渲染的、自包含 HTML Artifact。仅当已安装业务 Tool/MCP 不匹配，并且 interactive_ui 标准组件无法合理表达自定义 SVG、模拟器或探索器时使用。HTML/CSS/SVG/可选原生 JS 必须全部内联；禁止网络请求、远程资源、表单、弹窗、下载、iframe、Worker、存储、Tool/MCP/Business Gateway/Token 访问。页面必须响应式，避免固定视口宽度；html/body 和最外层页面保持透明，不绘制第二个整页边框或白色画布，内部语义区域优先使用 Host 注入的 --ocix-surface、--ocix-surface-muted、--ocix-surface-subtle、--ocix-foreground、--ocix-muted-foreground、--ocix-border、--ocix-primary、--ocix-success、--ocix-warning、--ocix-error Token，禁止硬编码 white/#fff 背景；静态页面使用 color-scheme/prefers-color-scheme 适配明暗主题。企业真实数据和写操作必须改用已安装 OCIX Tool。Static artifacts are preferred; scripts are experimental and must only implement local interaction over provided or clearly labeled simulated data. 只要 HTML 中包含 <script> 或 on* 事件处理器，scripts 必须显式设为 true；否则必须移除所有可执行标记。',
  args: {
    title: tool.schema.string().max(120).describe('Artifact 的简短标题'),
    summary: tool.schema.string().max(500).optional().describe('一句话说明用途、结论以及数据来源；模拟数据必须明确标注'),
    html: tool.schema.string().max(192 * 1024).describe('完整、自包含且响应式的 HTML 文档。内联 CSS/SVG；不得引用 URL、CDN、远程字体或远程图片。html/body 与最外层透明且无第二层整页边框；禁止硬编码白色画布；避免固定视口宽度，并适配 Host Token 或 prefers-color-scheme'),
    scripts: tool.schema.boolean().describe('必填。HTML 包含任何 <script> 或 on* 事件处理器时必须为 true；无脚本静态文档设为 false。true 仅用于本地参数交互，不得使用 eval、WebAssembly、Worker、网络或存储'),
    preferredDisplay: tool.schema.enum(['inline', 'workspace', 'fullscreen']).optional().describe('首选显示方式，默认 inline'),
    allowExpand: tool.schema.boolean().optional().describe('是否允许用户展开到 workspace/fullscreen，默认 true'),
    inlineHeight: tool.schema.number().int().min(120).max(900).optional().describe('对话内初始高度，120–900 px，默认 420'),
  },
  async execute(rawArgs) {
    const args = rawArgs as {
      title: string;
      summary?: string;
      html: string;
      scripts: boolean;
      preferredDisplay?: 'inline' | 'workspace' | 'fullscreen';
      allowExpand?: boolean;
      inlineHeight?: number;
    };
    const containsExecutableMarkup = /<\s*script\b|\son[a-z][a-z0-9:_-]*\s*=/i.test(args.html);
    if (containsExecutableMarkup && args.scripts !== true) {
      throw new Error('Artifact HTML contains executable markup. Set scripts=true for necessary local interaction, or remove every <script> and on* event handler.');
    }
    return JSON.stringify({
      $schema: 'openchamber://html-artifact-result/v1',
      schemaVersion: 1,
      title: args.title.trim(),
      ...(args.summary ? { summary: args.summary } : {}),
      html: args.html,
      capabilities: { scripts: args.scripts },
      display: {
        preferred: args.preferredDisplay ?? 'inline',
        allowExpand: args.allowExpand !== false,
        inlineHeight: Math.max(120, Math.min(900, Math.trunc(args.inlineHeight ?? 420))),
      },
      updatedAt: new Date().toISOString(),
    });
  },
});
