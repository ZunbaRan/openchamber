import { tool } from '@opencode-ai/plugin';

const scalar = tool.schema.union([
  tool.schema.string(),
  tool.schema.number(),
  tool.schema.boolean(),
]);

const widget = tool.schema.object({
  type: tool.schema.string().describe('组件类型：text、code-block、callout、metric、metric-grid、progress、status、flow、chart、table、comparison、list、timeline、activity-feed、agenda、funnel、network、tree、diff-summary、sparkline、gauge、heatmap、kanban、git-graph 或 divider'),
  title: tool.schema.string().optional().describe('组件标题；chart、table、list、callout 可用'),
  label: tool.schema.string().optional().describe('metric、progress、status 的短标签'),
  value: scalar.optional().describe('metric/status 的值，或 progress 的 0 到 1 数字'),
  text: tool.schema.string().optional().describe('text/callout 的正文'),
  language: tool.schema.string().optional().describe('code-block 的语言标识'),
  detail: tool.schema.string().optional().describe('metric/progress 的补充说明'),
  tone: tool.schema.string().optional().describe('语义色：neutral、info、success、warning、error；metric 还可用 positive、negative'),
  trend: tool.schema.string().optional().describe('metric 趋势：up、down、flat'),
  trendValue: tool.schema.string().optional().describe('metric 趋势说明，例如 +12.4%'),
  emphasis: tool.schema.string().optional().describe('metric 强调层级：hero（唯一视觉焦点）、standard（默认）、quiet（无卡片描边）'),
  icon: tool.schema.string().optional().describe('metric 图标，仅可用白名单：bar-chart-2、donut-chart、pie-chart、pulse、database-2、server、user、user-3、briefcase、archive、stack、target、rocket、lightbulb、calendar、time、timer、list-check-2、file-text、folder、global、shield-check、scales-3、survey、task、clipboard、star、heart、inbox-archive'),
  columns: tool.schema.number().optional().describe('metric-grid 的响应式列数，1 到 4'),
  metrics: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    value: scalar,
    detail: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
    trend: tool.schema.string().optional(),
    trendValue: tool.schema.string().optional(),
    emphasis: tool.schema.string().optional(),
    icon: tool.schema.string().optional(),
  })).max(12).optional().describe('metric-grid 的指标卡'),
  steps: tool.schema.array(tool.schema.object({
    title: tool.schema.string(),
    description: tool.schema.string().optional(),
    status: tool.schema.string().optional().describe('步骤状态：completed、active、error、pending'),
  })).max(12).optional().describe('flow 的有序步骤'),
  items: tool.schema.array(tool.schema.object({
    id: tool.schema.string().optional(),
    parentId: tool.schema.string().optional(),
    title: tool.schema.string(),
    description: tool.schema.string().optional(),
    badge: tool.schema.string().optional(),
    badgeTone: tool.schema.string().optional().describe('徽章语义色：neutral、info、success、warning、error'),
    actor: tool.schema.string().optional(),
    action: tool.schema.string().optional(),
    timestamp: tool.schema.string().optional(),
    status: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
    path: tool.schema.string().optional(),
    additions: tool.schema.number().optional(),
    deletions: tool.schema.number().optional(),
  })).max(30).optional().describe('list、timeline、activity-feed、tree 或 diff-summary 的条目'),
  ordered: tool.schema.boolean().optional().describe('list 是否显示序号'),
  chartVariant: tool.schema.string().optional().describe('chart 类型：bar、line、area 或 donut'),
  chartSeries: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
  })).max(5).optional().describe('chart 的数据系列；同一张图只能放单位与数量级兼容的系列，不同量纲（例如调用量与毫秒延迟）必须拆成两张图，禁止用未实际换算的 /100 等标签伪装缩放'),
  chartPoints: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    values: tool.schema.array(tool.schema.number()).max(5),
  })).max(30).optional().describe('chart 数据点；values 顺序必须与 chartSeries 一致'),
  sparklineValues: tool.schema.array(tool.schema.number()).max(60).optional().describe('sparkline 的数值序列'),
  minimum: tool.schema.number().optional().describe('gauge 的最小值，默认 0'),
  maximum: tool.schema.number().optional().describe('gauge 的最大值，默认 100'),
  unit: tool.schema.string().optional().describe('gauge 的单位，例如 %、ms、GB'),
  heatmapCells: tool.schema.array(tool.schema.object({
    row: tool.schema.string(),
    column: tool.schema.string(),
    value: tool.schema.number(),
    label: tool.schema.string().optional(),
  })).max(60).optional().describe('heatmap 单元格；row/column 是两轴分类，value 决定色阶'),
  kanbanColumns: tool.schema.array(tool.schema.object({
    id: tool.schema.string().describe('ASCII 列标识，例如 todo、doing、done'),
    title: tool.schema.string(),
    tone: tool.schema.string().optional(),
  })).max(6).optional().describe('kanban 的列，按这里的顺序显示'),
  kanbanCards: tool.schema.array(tool.schema.object({
    id: tool.schema.string().optional(),
    column: tool.schema.string().describe('必须对应 kanbanColumns.id'),
    title: tool.schema.string(),
    description: tool.schema.string().optional(),
    badge: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
  })).max(40).optional().describe('kanban 的只读卡片'),
  agendaEntries: tool.schema.array(tool.schema.object({
    id: tool.schema.string().optional(),
    title: tool.schema.string(),
    date: tool.schema.string().optional().describe('分组日期标签，例如 7 月 22 日'),
    time: tool.schema.string().optional().describe('开始时间标签，例如 09:30'),
    endTime: tool.schema.string().optional(),
    description: tool.schema.string().optional(),
    location: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
  })).max(40).optional().describe('agenda 的只读日程条目，最多覆盖 14 个日期分组'),
  funnelStages: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    value: tool.schema.number(),
    detail: tool.schema.string().optional(),
  })).max(8).optional().describe('funnel 的阶段，按业务漏斗顺序排列；value 必须使用同一单位'),
  networkNodes: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    label: tool.schema.string(),
    detail: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
  })).max(30).optional().describe('network 的节点；只适合小型关系图，复杂拓扑应改用 HTML Artifact'),
  networkEdges: tool.schema.array(tool.schema.object({
    source: tool.schema.string().describe('必须对应 networkNodes.id'),
    target: tool.schema.string().describe('必须对应 networkNodes.id'),
    label: tool.schema.string().optional(),
  })).max(60).optional().describe('network 的有向关系'),
  commits: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    message: tool.schema.string(),
    branch: tool.schema.string().optional(),
    parents: tool.schema.array(tool.schema.string()).max(4).optional(),
    author: tool.schema.string().optional(),
    timestamp: tool.schema.string().optional(),
  })).max(40).optional().describe('git-graph 的提交数据'),
  tableColumns: tool.schema.array(tool.schema.object({
    key: tool.schema.string().describe('ASCII 字段键，例如 name 或 revenue'),
    label: tool.schema.string(),
    format: tool.schema.string().optional().describe('可选 number、percent、date 或 currency:CNY；percent 单元格可传 0 到 1 的比例或 0 到 100 的百分点，Tool 会规范化后再显示'),
    render: tool.schema.string().optional().describe('设为 status 时显示状态胶囊'),
    align: tool.schema.string().optional().describe('列对齐：left、center、right'),
  })).max(8).optional(),
  density: tool.schema.string().optional().describe('table 密度：comfortable（默认）或 compact'),
  toneColumn: tool.schema.string().optional().describe('table 行状态着色的字段键；该列值匹配 approved/failed/pending 等状态词时整行着色'),
  searchable: tool.schema.boolean().optional().describe('table 显示本地搜索框（只过滤当前内联数据，不触发业务查询）'),
  sortable: tool.schema.boolean().optional().describe('table 列头可点击排序（本地状态）'),
  pageSize: tool.schema.number().optional().describe('table 分页大小，1 到 50；设置后显示分页栏'),
  filterable: tool.schema.boolean().optional().describe('list 显示本地过滤框'),
  orientation: tool.schema.string().optional().describe('flow 方向：horizontal（默认）或 vertical（纵向步骤，适合报告叙事）'),
  stacked: tool.schema.boolean().optional().describe('chart variant=bar 时堆叠显示各系列构成'),
  referenceValue: tool.schema.number().optional().describe('chart 的参考线数值（例如目标值或均值）'),
  referenceLabel: tool.schema.string().optional().describe('chart 参考线的短标签'),
  tableRows: tool.schema.array(tool.schema.object({
    cells: tool.schema.array(tool.schema.object({
      key: tool.schema.string(),
      value: scalar,
    })).max(8),
  })).max(50).optional().describe('table 行；每个 cells.key 对应 tableColumns.key'),
});

type Scalar = string | number | boolean;
type WidgetInput = {
  type?: string;
  title?: string;
  label?: string;
  value?: Scalar;
  text?: string;
  language?: string;
  detail?: string;
  tone?: string;
  trend?: string;
  trendValue?: string;
  emphasis?: string;
  icon?: string;
  columns?: number;
  metrics?: Array<{ label: string; value: Scalar; detail?: string; tone?: string; trend?: string; trendValue?: string; emphasis?: string; icon?: string }>;
  steps?: Array<{ title: string; description?: string; status?: string }>;
  items?: Array<{
    id?: string;
    parentId?: string;
    title: string;
    description?: string;
    badge?: string;
    badgeTone?: string;
    actor?: string;
    action?: string;
    timestamp?: string;
    status?: string;
    tone?: string;
    path?: string;
    additions?: number;
    deletions?: number;
  }>;
  ordered?: boolean;
  chartVariant?: string;
  chartSeries?: Array<{ label: string }>;
  chartPoints?: Array<{ label: string; values: number[] }>;
  sparklineValues?: number[];
  minimum?: number;
  maximum?: number;
  unit?: string;
  heatmapCells?: Array<{ row: string; column: string; value: number; label?: string }>;
  kanbanColumns?: Array<{ id: string; title: string; tone?: string }>;
  kanbanCards?: Array<{ id?: string; column: string; title: string; description?: string; badge?: string; tone?: string }>;
  agendaEntries?: Array<{ id?: string; title: string; date?: string; time?: string; endTime?: string; description?: string; location?: string; tone?: string }>;
  funnelStages?: Array<{ label: string; value: number; detail?: string }>;
  networkNodes?: Array<{ id: string; label: string; detail?: string; tone?: string }>;
  networkEdges?: Array<{ source: string; target: string; label?: string }>;
  commits?: Array<{ id: string; message: string; branch?: string; parents?: string[]; author?: string; timestamp?: string }>;
  tableColumns?: Array<{ key: string; label: string; format?: string; render?: string; align?: string }>;
  tableRows?: Array<{ cells: Array<{ key: string; value: Scalar }> }>;
  density?: string;
  toneColumn?: string;
  searchable?: boolean;
  sortable?: boolean;
  pageSize?: number;
  filterable?: boolean;
  orientation?: string;
  stacked?: boolean;
  referenceValue?: number;
  referenceLabel?: string;
};

type SectionInput = {
  id?: string;
  title?: string;
  columns?: number;
  widgets: WidgetInput[];
};

type InteractiveUIArgs = {
  title?: unknown;
  summary?: unknown;
  presentation?: unknown;
  layoutMode?: unknown;
  sections?: unknown;
};

const LAYOUT_MODES = ['dashboard-hero', 'master-detail', 'report'] as const;
type LayoutMode = (typeof LAYOUT_MODES)[number];

const LAYOUT_MODE_CONTRACT: Record<LayoutMode, { slots: readonly string[]; required: readonly string[] }> = {
  'dashboard-hero': { slots: ['kpis', 'main', 'aside'], required: ['kpis', 'main'] },
  'master-detail': { slots: ['master', 'detail'], required: ['master', 'detail'] },
  report: { slots: ['summary'], required: ['summary'] },
};

const MAX_SECTIONS_JSON_LENGTH = 100_000;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const parseSections = (value: unknown): SectionInput[] => {
  let candidate = value;
  if (typeof candidate === 'string') {
    if (candidate.length > MAX_SECTIONS_JSON_LENGTH) return [];
    try {
      candidate = JSON.parse(candidate.trim());
    } catch {
      return [];
    }
  }
  return asArray<unknown>(candidate).slice(0, 8).flatMap((rawSection) => {
    const section = asRecord(rawSection);
    if (!section) return [];
    const widgets = asArray<unknown>(section.widgets).slice(0, 12);
    if (widgets.length === 0) return [];
    return [{
      ...(typeof section.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(section.id) ? { id: section.id } : {}),
      ...(typeof section.title === 'string' ? { title: section.title.slice(0, 160) } : {}),
      ...(typeof section.columns === 'number' && Number.isFinite(section.columns) ? { columns: section.columns } : {}),
      widgets: widgets as WidgetInput[],
    }];
  });
};

const clampColumns = (value: number | undefined): number => Math.max(1, Math.min(4, Math.trunc(value ?? 1)));

const normalizeTableCellValue = (value: unknown, format: string | undefined): unknown => (
  format === 'percent'
  && typeof value === 'number'
  && Number.isFinite(value)
  && Math.abs(value) > 1
    ? value / 100
    : value
);

const toNode = (rawInput: unknown, inheritedMetricColumns?: number): Record<string, unknown> | null => {
  const input = asRecord(rawInput) as WidgetInput | null;
  if (!input) return null;
  const type = input.type
    ?? (input.chartPoints || input.chartSeries ? 'chart' : undefined)
    ?? (input.tableRows || input.tableColumns ? 'table' : undefined)
    ?? (input.metrics ? 'metric-grid' : undefined)
    ?? (input.steps ? 'flow' : undefined)
    ?? (input.items ? 'list' : undefined)
    ?? (input.text ? 'text' : undefined);
  if (type === 'text') return { type: 'text', value: input.text ?? String(input.value ?? '') };
  if (type === 'code-block') return { type: 'code-block', title: input.title, language: input.language, value: input.text ?? String(input.value ?? '') };
  if (type === 'callout') {
    return { type: 'callout', title: input.title, value: input.text ?? String(input.value ?? ''), tone: input.tone ?? 'info' };
  }
  if (type === 'metric') {
    return {
      type: 'metric',
      label: input.label,
      value: input.value ?? '',
      detail: input.detail,
      tone: input.tone,
      trend: input.trend,
      trendValue: input.trendValue,
      emphasis: input.emphasis,
      icon: input.icon,
    };
  }
  if (type === 'metric-grid') {
    return { type: 'metric-grid', columns: clampColumns(input.columns ?? inheritedMetricColumns ?? 3), items: asArray(input.metrics).slice(0, 12) };
  }
  if (type === 'progress') {
    return { type: 'progress', label: input.label, value: typeof input.value === 'number' ? input.value : Number(input.value) || 0, detail: input.detail };
  }
  if (type === 'status') {
    return { type: 'status', label: input.label, value: input.value ?? '', tone: input.tone ?? 'neutral' };
  }
  if (type === 'divider') return { type: 'divider' };
  if (type === 'flow') return { type: 'flow', data: asArray(input.steps).slice(0, 12), ...(input.orientation === 'vertical' ? { orientation: 'vertical' } : {}) };
  if (type === 'list') return { type: 'list', title: input.title, ordered: input.ordered === true, items: asArray(input.items).slice(0, 30), ...(input.filterable === true ? { filterable: true } : {}) };
  if (type === 'timeline' || type === 'activity-feed' || type === 'tree' || type === 'diff-summary') {
    return { type, title: input.title, items: asArray(input.items).slice(0, 30) };
  }
  if (type === 'sparkline') return { type: 'sparkline', label: input.label, value: input.value, values: asArray(input.sparklineValues).filter((value) => typeof value === 'number' && Number.isFinite(value)).slice(0, 60) };
  if (type === 'gauge') {
    return {
      type: 'gauge',
      title: input.title,
      label: input.label,
      value: typeof input.value === 'number' ? input.value : Number(input.value) || 0,
      minimum: input.minimum ?? 0,
      maximum: input.maximum ?? 100,
      unit: input.unit,
      detail: input.detail,
      tone: input.tone,
    };
  }
  if (type === 'heatmap') return { type: 'heatmap', title: input.title, cells: asArray(input.heatmapCells).slice(0, 60) };
  if (type === 'kanban') {
    return {
      type: 'kanban',
      title: input.title,
      columns: asArray(input.kanbanColumns).slice(0, 6),
      cards: asArray(input.kanbanCards).slice(0, 40),
    };
  }
  if (type === 'agenda') return { type: 'agenda', title: input.title, entries: asArray(input.agendaEntries).slice(0, 40) };
  if (type === 'funnel') return { type: 'funnel', title: input.title, stages: asArray(input.funnelStages).slice(0, 8) };
  if (type === 'network') {
    return {
      type: 'network',
      title: input.title,
      nodes: asArray(input.networkNodes).slice(0, 30),
      edges: asArray(input.networkEdges).slice(0, 60),
    };
  }
  if (type === 'git-graph') return { type: 'git-graph', title: input.title, commits: asArray(input.commits).slice(0, 40) };
  if (type === 'chart') {
    const series = asArray<unknown>(input.chartSeries).slice(0, 5).flatMap((rawItem, index) => {
      const item = asRecord(rawItem);
      return item && typeof item.label === 'string' ? [{ key: `series_${index + 1}`, label: item.label }] : [];
    });
    const data = asArray<unknown>(input.chartPoints).slice(0, 30).flatMap((rawPoint) => {
      const point = asRecord(rawPoint);
      if (!point || typeof point.label !== 'string') return [];
      const values = asArray<unknown>(point.values);
      return [Object.fromEntries([
        ['label', point.label],
        ...series.map((item, index) => [item.key, typeof values[index] === 'number' && Number.isFinite(values[index]) ? values[index] : 0]),
      ])];
    });
    return {
      type: 'chart',
      title: input.title,
      variant: input.chartVariant ?? 'bar',
      xKey: 'label',
      series,
      data,
      ...(typeof input.referenceValue === 'number' && Number.isFinite(input.referenceValue)
        ? { referenceLine: { value: input.referenceValue, label: input.referenceLabel } }
        : {}),
      ...(input.stacked === true ? { stacked: true } : {}),
    };
  }
  if (type === 'table') {
    const columns = asArray(input.tableColumns).slice(0, 8);
    const formats = new Map(columns.map((column) => [column.key, column.format]));
    return {
      type: 'data-table',
      title: input.title,
      ...(input.density === 'compact' || input.density === 'comfortable' ? { density: input.density } : {}),
      ...(typeof input.toneColumn === 'string' ? { toneColumn: input.toneColumn } : {}),
      ...(input.searchable === true ? { searchable: true } : {}),
      ...(input.sortable === true ? { sortable: true } : {}),
      ...(typeof input.pageSize === 'number' && Number.isFinite(input.pageSize)
        ? { pagination: { pageSize: Math.max(1, Math.min(50, Math.trunc(input.pageSize))) } }
        : {}),
      columns,
      data: asArray<unknown>(input.tableRows).slice(0, 50).flatMap((rawRow) => {
        const row = asRecord(rawRow);
        if (!row) return [];
        const cells = asArray<unknown>(row.cells).slice(0, 8).flatMap((rawCell) => {
          const cell = asRecord(rawCell);
          return cell && typeof cell.key === 'string'
            ? [[cell.key, normalizeTableCellValue(cell.value, formats.get(cell.key))] as const]
            : [];
        });
        return [Object.fromEntries(cells)];
      }),
    };
  }
  if (type === 'comparison') {
    const columns = asArray(input.tableColumns).slice(0, 8);
    const formats = new Map(columns.map((column) => [column.key, column.format]));
    return {
      type: 'comparison',
      title: input.title,
      columns,
      data: asArray<unknown>(input.tableRows).slice(0, 50).flatMap((rawRow) => {
        const row = asRecord(rawRow);
        if (!row) return [];
        const cells = asArray<unknown>(row.cells).slice(0, 8).flatMap((rawCell) => {
          const cell = asRecord(rawCell);
          return cell && typeof cell.key === 'string'
            ? [[cell.key, normalizeTableCellValue(cell.value, formats.get(cell.key))] as const]
            : [];
        });
        return [Object.fromEntries(cells)];
      }),
    };
  }
  return null;
};

export default tool({
  description: '在没有匹配的已安装业务 Tool、MCP Tool 或 App 时，为当前任务临时组合一个零安装 Interactive UI，是受管紧凑图/表/流程的默认呈现方式。适合把用户提供的数据、模型推导结果、流程或明确标注的示例/模拟数据展示为指标、图表、表格、流程、状态、列表和说明；可用 presentation=tabs 或 accordion 添加宿主控制的安全本地交互。若用户要求播放/暂停、滑杆、拖拽、动画模拟器、自定义探索器，或任务需要大画布、多区域、复杂本地状态，应改用 html_artifact。简短事实性回答、澄清、拒绝和错误保持纯文字，不要为一段话强造看板。每次调用只承载一个焦点；多个真正不同的焦点允许先后各出一个视觉，保持自然生成顺序，并在视觉前、后、之间用简短正文衔接，一轮内通常不超过四个主视觉——这是软指导，不是硬性限制。不得伪造 CRM、ERP、销售、财务等企业系统事实，也不得冒充或复述已安装业务模块；若业务 Tool 已匹配或本回合已返回 openchamber://interactive-result/v1，就不要再调用本 Tool 重画同一数据或同一结论，但同一结论的普通文字解释不受影响。图表不得把单位或数量级不兼容的系列放在同一单轴中，必须拆图并保持标签、绘制值与无障碍值一致；示例、估算或模拟数据必须明确标注。Use one focused View per call, only when no installed business Tool or MCP Tool matches. Tabs and accordion are safe Host-owned local interactions; use html_artifact for sliders, playback, drag, animation, custom simulation, or large-canvas/multi-region/complex-local-state pages. One call covers one focus; a later visual for a genuinely different focus may follow in natural order, with short bridging prose before, after, or between visuals. Normally at most four primary visuals per turn — soft guidance only, never a runtime gate. Never fabricate business metrics, keep incompatible units on separate charts, keep labels/plotted/accessible values consistent, and label example or simulated data. Never redraw an installed business result, and never render the same data or conclusion twice through another visual.',
  args: {
    title: tool.schema.string().describe('这次可视化的简短标题'),
    summary: tool.schema.string().describe('一句话给出结论、目标或范围，不要重复标题'),
    presentation: tool.schema.enum(['stack', 'tabs', 'accordion']).optional().describe('页面分区的展示方式：stack 直接排列（默认）；tabs 可切换页签；accordion 可展开/收起。tabs/accordion 时每个 section 都必须有 title'),
    layoutMode: tool.schema.enum(['dashboard-hero', 'master-detail', 'report']).optional().describe('可选构图模式：dashboard-hero（KPI 横带 + 主图 + 侧栏，槽位 kpis/main/aside，KPI 最多 4 个）；master-detail（左列表右详情，槽位 master/detail）；report（结论先行长文，槽位 summary）。设置后相关 section 必须带对应 id，且 presentation 保持默认 stack；信息少、无明确主次时不要使用'),
    sections: tool.schema.array(tool.schema.object({
      id: tool.schema.string().optional().describe('构图槽位标识，仅在 layoutMode 下使用：dashboard-hero 用 kpis/main/aside，master-detail 用 master/detail，report 用 summary；小写字母'),
      title: tool.schema.string().optional().describe('分区标题'),
      columns: tool.schema.number().optional().describe('本分区中多个 widgets 的响应式列数，1 到 4；只有一个 metric-grid 时优先设置 metric-grid 自身的 columns，若漏填则继承这里的列数'),
      widgets: tool.schema.array(widget).min(1).max(12),
    })).min(1).max(8).describe('必须直接传入结构化数组，禁止把数组 JSON.stringify 成字符串。根据任务现场设计页面分区；优先选择最能表达信息的组件组合。标准组件能表达时不要要求 HTML Artifact'),
  },
  async execute(rawArgs) {
    const args = (asRecord(rawArgs) ?? {}) as InteractiveUIArgs;
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.slice(0, 160) : 'Interactive UI';
    const summary = typeof args.summary === 'string' ? args.summary.slice(0, 1_000) : '';
    const presentation = args.presentation === 'tabs' || args.presentation === 'accordion' ? args.presentation : 'stack';
    const layoutMode = LAYOUT_MODES.find((mode) => mode === args.layoutMode);
    if (args.layoutMode !== undefined && !layoutMode) {
      throw new Error(`interactive_ui layoutMode must be one of: ${LAYOUT_MODES.join(', ')}`);
    }
    if (layoutMode && presentation !== 'stack') {
      throw new Error('interactive_ui layoutMode requires the default stack presentation');
    }
    const sections = parseSections(args.sections);
    if (sections.length === 0) {
      throw new Error('interactive_ui requires at least one valid section');
    }
    if (layoutMode) {
      const contract = LAYOUT_MODE_CONTRACT[layoutMode];
      const ids = sections.flatMap((section) => section.id ? [section.id] : []);
      const unknown = ids.filter((id) => !contract.slots.includes(id));
      if (unknown.length > 0) {
        throw new Error(`interactive_ui layoutMode=${layoutMode} has unknown section id(s): ${unknown.join(', ')}. Valid slots: ${contract.slots.join(', ')}`);
      }
      const missing = contract.required.filter((required) => !ids.includes(required));
      if (missing.length > 0) {
        throw new Error(`interactive_ui layoutMode=${layoutMode} requires section id(s): ${missing.join(', ')}`);
      }
      if (new Set(ids).size !== ids.length) {
        throw new Error('interactive_ui layoutMode section ids must be unique');
      }
      if (layoutMode === 'dashboard-hero') {
        const kpis = sections.find((section) => section.id === 'kpis');
        const kpiCount = kpis ? kpis.widgets.reduce((count, widgetInput) => {
          if (widgetInput.type === 'metric-grid' || (!widgetInput.type && widgetInput.metrics)) return count + asArray(widgetInput.metrics).length;
          return widgetInput.type === 'metric' ? count + 1 : count;
        }, 0) : 0;
        if (kpiCount > 4) {
          throw new Error(`interactive_ui layoutMode=dashboard-hero allows at most 4 KPI metrics in the kpis section (got ${kpiCount})`);
        }
      }
    }
    const renderedSections = sections.flatMap((section) => {
      const inheritedMetricColumns = section.widgets.length === 1 ? section.columns : undefined;
      const children = section.widgets
        .map((widgetInput) => toNode(widgetInput, inheritedMetricColumns))
        .filter((node): node is Record<string, unknown> => node !== null);
      if (children.length === 0) return [];
      return [{
        type: 'section',
        ...(section.id ? { id: section.id } : {}),
        title: section.title,
        children: children.length > 1 && clampColumns(section.columns) > 1
          ? [{ type: 'grid', columns: clampColumns(section.columns), children }]
          : children,
      }];
    });
    if (renderedSections.length === 0) {
      throw new Error('interactive_ui requires at least one supported widget');
    }
    if (presentation !== 'stack' && renderedSections.some((section) => typeof section.title !== 'string' || !section.title.trim())) {
      throw new Error(`interactive_ui presentation=${presentation} requires a title for every section`);
    }
    const body = presentation === 'stack'
      ? renderedSections
      : [{
          type: presentation,
          items: renderedSections.map((section) => ({
            label: section.title,
            children: section.children,
          })),
        }];
    const layout = {
      type: 'stack',
      title,
      ...(layoutMode ? { layoutMode } : {}),
      children: [
        ...(summary ? [{ type: 'text', value: summary }] : []),
        ...body,
      ],
    };

    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.builtin.interactive-ui.generated',
      schemaVersion: 1,
      mode: 'snapshot',
      summary,
      context: { title },
      data: { layout },
      updatedAt: new Date().toISOString(),
    });
  },
});
