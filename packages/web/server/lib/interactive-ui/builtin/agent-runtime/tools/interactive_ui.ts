import { tool } from '@opencode-ai/plugin';

const scalar = tool.schema.union([
  tool.schema.string(),
  tool.schema.number(),
  tool.schema.boolean(),
]);

const widget = tool.schema.object({
  type: tool.schema.string().describe('组件类型：text、code-block、callout、metric、metric-grid、progress、status、flow、chart、table、comparison、list、timeline、activity-feed、tree、diff-summary、sparkline、git-graph 或 divider'),
  title: tool.schema.string().optional().describe('组件标题；chart、table、list、callout 可用'),
  label: tool.schema.string().optional().describe('metric、progress、status 的短标签'),
  value: scalar.optional().describe('metric/status 的值，或 progress 的 0 到 1 数字'),
  text: tool.schema.string().optional().describe('text/callout 的正文'),
  language: tool.schema.string().optional().describe('code-block 的语言标识'),
  detail: tool.schema.string().optional().describe('metric/progress 的补充说明'),
  tone: tool.schema.string().optional().describe('语义色：neutral、info、success、warning、error；metric 还可用 positive、negative'),
  trend: tool.schema.string().optional().describe('metric 趋势：up、down、flat'),
  trendValue: tool.schema.string().optional().describe('metric 趋势说明，例如 +12.4%'),
  columns: tool.schema.number().optional().describe('metric-grid 的响应式列数，1 到 4'),
  metrics: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    value: scalar,
    detail: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
    trend: tool.schema.string().optional(),
    trendValue: tool.schema.string().optional(),
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
  columns?: number;
  metrics?: Array<{ label: string; value: Scalar; detail?: string; tone?: string; trend?: string; trendValue?: string }>;
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
  commits?: Array<{ id: string; message: string; branch?: string; parents?: string[]; author?: string; timestamp?: string }>;
  tableColumns?: Array<{ key: string; label: string; format?: string; render?: string; align?: string }>;
  tableRows?: Array<{ cells: Array<{ key: string; value: Scalar }> }>;
};

type SectionInput = {
  title?: string;
  columns?: number;
  widgets: WidgetInput[];
};

type InteractiveUIArgs = {
  title?: unknown;
  summary?: unknown;
  sections?: unknown;
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

const toNode = (rawInput: unknown): Record<string, unknown> | null => {
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
    };
  }
  if (type === 'metric-grid') {
    return { type: 'metric-grid', columns: clampColumns(input.columns ?? 3), items: asArray(input.metrics).slice(0, 12) };
  }
  if (type === 'progress') {
    return { type: 'progress', label: input.label, value: typeof input.value === 'number' ? input.value : Number(input.value) || 0, detail: input.detail };
  }
  if (type === 'status') {
    return { type: 'status', label: input.label, value: input.value ?? '', tone: input.tone ?? 'neutral' };
  }
  if (type === 'divider') return { type: 'divider' };
  if (type === 'flow') return { type: 'flow', data: asArray(input.steps).slice(0, 12) };
  if (type === 'list') return { type: 'list', title: input.title, ordered: input.ordered === true, items: asArray(input.items).slice(0, 30) };
  if (type === 'timeline' || type === 'activity-feed' || type === 'tree' || type === 'diff-summary') {
    return { type, title: input.title, items: asArray(input.items).slice(0, 30) };
  }
  if (type === 'sparkline') return { type: 'sparkline', label: input.label, value: input.value, values: asArray(input.sparklineValues).filter((value) => typeof value === 'number' && Number.isFinite(value)).slice(0, 60) };
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
    };
  }
  if (type === 'table') {
    const columns = asArray(input.tableColumns).slice(0, 8);
    const formats = new Map(columns.map((column) => [column.key, column.format]));
    return {
      type: 'data-table',
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
  description: '在没有匹配的已安装业务 Tool 或 MCP Tool 时，为当前任务临时组合一个只读 Interactive UI。适合把用户提供的数据、模型推导结果、流程或明确标注的示例/模拟数据展示为指标、图表、表格、流程、状态、列表和说明。不得伪造 CRM、ERP、销售、财务等企业系统事实，也不得冒充已安装业务模块；若业务 Tool 已匹配或本回合已返回 openchamber://interactive-result/v1，就不要再调用本 Tool 重复展示。图表不得把单位或数量级不兼容的系列放在同一单轴中，必须拆图并保持标签、绘制值与无障碍值一致。Tool 完成后只补一句不含指标、表格或章节复述的结论或下一步，然后结束回答。Use for one ad-hoc primary View only when no installed business tool matches; never call it after a specialized Tool already returned an Interactive Result, never fabricate business metrics, keep incompatible units on separate charts, and after the View return exactly one short conclusion or next-step sentence without restating its metrics or sections.',
  args: {
    title: tool.schema.string().describe('这次可视化的简短标题'),
    summary: tool.schema.string().describe('一句话给出结论、目标或范围，不要重复标题'),
    sections: tool.schema.array(tool.schema.object({
      title: tool.schema.string().optional().describe('分区标题'),
      columns: tool.schema.number().optional().describe('本分区响应式列数，1 到 4；图表和表格通常使用 1'),
      widgets: tool.schema.array(widget).min(1).max(12),
    })).min(1).max(8).describe('根据任务现场设计的页面分区；优先选择最能表达信息的组件组合。标准组件能表达时不要要求 HTML Artifact'),
  },
  async execute(rawArgs) {
    const args = (asRecord(rawArgs) ?? {}) as InteractiveUIArgs;
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.slice(0, 160) : 'Interactive UI';
    const summary = typeof args.summary === 'string' ? args.summary.slice(0, 1_000) : '';
    const sections = parseSections(args.sections);
    if (sections.length === 0) {
      throw new Error('interactive_ui requires at least one valid section');
    }
    const renderedSections = sections.flatMap((section) => {
      const children = section.widgets.map(toNode).filter((node): node is Record<string, unknown> => node !== null);
      if (children.length === 0) return [];
      return [{
        type: 'section',
        title: section.title,
        children: clampColumns(section.columns) > 1
          ? [{ type: 'grid', columns: clampColumns(section.columns), children }]
          : children,
      }];
    });
    if (renderedSections.length === 0) {
      throw new Error('interactive_ui requires at least one supported widget');
    }
    const layout = {
      type: 'stack',
      title,
      children: [
        ...(summary ? [{ type: 'text', value: summary }] : []),
        ...renderedSections,
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
