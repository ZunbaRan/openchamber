import { tool } from '@opencode-ai/plugin';

const validateArtifactHTML = (html: string, scripts: boolean): void => {
  if (html.includes('\0')) throw new Error('Artifact HTML contains invalid bytes. Regenerate a plain UTF-8 HTML document.');
  const elementCount = html.match(/<[a-z][a-z0-9:-]*(?:\s|\/?>)/gi)?.length ?? 0;
  if (elementCount > 4_000) throw new Error('Artifact HTML exceeds 4,000 elements. Simplify the page before retrying.');
  if (/<\s*(?:iframe|frame|frameset|object|embed|form|base|link)\b/i.test(html)
    || /<\s*meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh\b/i.test(html)) {
    throw new Error('Artifact HTML contains iframe, form, link, object, embed, base, or refresh markup. Remove it and keep all CSS/JS inline.');
  }
  if (/\b(?:href|src|action)\s*=\s*["']?\s*(?:javascript:|vbscript:)/i.test(html)
    || /\bhref\s*=\s*["']?\s*data\s*:/i.test(html)) {
    throw new Error('Artifact HTML contains a prohibited navigation target. Remove javascript:, vbscript:, and data: links.');
  }
  if (/\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(html)
    || /url\(\s*["']?\s*(?:https?:|\/\/)/i.test(html)) {
    throw new Error('Artifact HTML contains a remote resource. Inline every style, script, font, image, and SVG before retrying.');
  }
  if (!scripts) {
    for (const match of html.matchAll(/\b(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!target.startsWith('#')) throw new Error('Static Artifact links may only target a local #fragment.');
    }
  }
  const containsExecutableMarkup = /<\s*script\b|\son[a-z][a-z0-9:_-]*\s*=/i.test(html);
  if (containsExecutableMarkup && scripts !== true) {
    throw new Error('Artifact HTML contains executable markup. Set scripts=true for necessary local interaction, or remove every <script> and on* event handler.');
  }
  if (scripts && (/<\s*script\b[^>]*\bsrc\s*=/i.test(html)
    || /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|SharedWorker|Worker|WebAssembly)\s*(?:\(|\.)/i.test(html)
    || /\bnavigator\s*\.\s*(?:sendBeacon|serviceWorker)\b/i.test(html)
    || /\beval\s*\(/i.test(html)
    || /\b(?:new\s+)?Function\s*\(/.test(html))) {
    throw new Error('Interactive Artifact requested network, Worker, WebAssembly, eval, Function, or another prohibited capability. Keep scripts limited to local DOM interaction over inline data.');
  }
};

export default tool({
  description: '生成一个在 OpenLoop 对话流中隔离渲染的、自包含 HTML Artifact。定位：任务需要大画布、多区域页面或复杂本地状态，或用户明确要求 HTML Artifact，或需要播放/暂停、滑杆、拖拽、动画、自定义 SVG、模拟器或探索器等 interactive_ui 标准组件无法合理表达的局部交互时使用。HTML/CSS/SVG/可选原生 JS 必须全部内联；使用普通 HTML5 <script> 内容，不要用 CDATA 或注释包装脚本。禁止网络请求、远程资源、表单、弹窗、下载、iframe、Worker、存储、Tool/MCP/Business Gateway/Token 访问。页面必须响应式，避免固定视口宽度；html/body 和最外层页面保持透明，不绘制第二个整页边框或白色画布，内部语义区域优先使用 Host 注入的 --ocix-surface、--ocix-surface-muted、--ocix-surface-subtle、--ocix-foreground、--ocix-muted-foreground、--ocix-border、--ocix-primary、--ocix-success、--ocix-warning、--ocix-error Token，禁止硬编码 white/#fff 背景；静态页面使用 color-scheme/prefers-color-scheme 适配明暗主题。企业真实数据和写操作必须改用已安装 OCIX Tool。每个 Artifact 只承载一个焦点；只有与已渲染视觉真正不同的后续焦点才允许再出一个 Artifact，且不得复述已安装业务结果的数据或结论；示例、估算或模拟数据必须在 summary 与页面内明确标注。Static artifacts are preferred. Scripts run in an independently terminable Desktop renderer when available; Web scripts remain experimental and default-off. Scripts may only implement local interaction over provided or clearly labeled simulated data. 只要 HTML 中包含 <script> 或 on* 事件处理器，scripts 必须显式设为 true；否则必须移除所有可执行标记。Tool 会在返回前预检禁止标记、远程资源和执行能力；如果报错，根据错误删除对应能力后只重试一次。',
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
    validateArtifactHTML(args.html, args.scripts);
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
