import { tool } from '@opencode-ai/plugin';

const scalar = tool.schema.union([
  tool.schema.string(),
  tool.schema.number(),
  tool.schema.boolean(),
]);

const widget = tool.schema.object({
  type: tool.schema.string().describe('组件类型：text、callout、metric、metric-grid、progress、status、flow、chart、table 或 list'),
  title: tool.schema.string().optional().describe('组件标题；chart、table、list、callout 可用'),
  label: tool.schema.string().optional().describe('metric、progress、status 的短标签'),
  value: scalar.optional().describe('metric/status 的值，或 progress 的 0 到 1 数字'),
  text: tool.schema.string().optional().describe('text/callout 的正文'),
  detail: tool.schema.string().optional().describe('metric/progress 的补充说明'),
  tone: tool.schema.string().optional().describe('语义色：neutral、info、success、warning、error'),
  columns: tool.schema.number().optional().describe('metric-grid 的响应式列数，1 到 4'),
  metrics: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    value: scalar,
    detail: tool.schema.string().optional(),
    tone: tool.schema.string().optional(),
  })).max(12).optional().describe('metric-grid 的指标卡'),
  steps: tool.schema.array(tool.schema.object({
    title: tool.schema.string(),
    description: tool.schema.string().optional(),
  })).max(12).optional().describe('flow 的有序步骤'),
  items: tool.schema.array(tool.schema.object({
    title: tool.schema.string(),
    description: tool.schema.string().optional(),
    badge: tool.schema.string().optional(),
  })).max(30).optional().describe('list 的条目'),
  ordered: tool.schema.boolean().optional().describe('list 是否显示序号'),
  chartVariant: tool.schema.string().optional().describe('chart 类型：bar、line、area 或 donut'),
  chartSeries: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
  })).max(5).optional().describe('chart 的数据系列'),
  chartPoints: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    values: tool.schema.array(tool.schema.number()).max(5),
  })).max(30).optional().describe('chart 数据点；values 顺序必须与 chartSeries 一致'),
  tableColumns: tool.schema.array(tool.schema.object({
    key: tool.schema.string().describe('ASCII 字段键，例如 name 或 revenue'),
    label: tool.schema.string(),
    format: tool.schema.string().optional().describe('可选 number、percent、date 或 currency:CNY'),
    render: tool.schema.string().optional().describe('设为 status 时显示状态胶囊'),
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
  detail?: string;
  tone?: string;
  columns?: number;
  metrics?: Array<{ label: string; value: Scalar; detail?: string; tone?: string }>;
  steps?: Array<{ title: string; description?: string }>;
  items?: Array<{ title: string; description?: string; badge?: string }>;
  ordered?: boolean;
  chartVariant?: string;
  chartSeries?: Array<{ label: string }>;
  chartPoints?: Array<{ label: string; values: number[] }>;
  tableColumns?: Array<{ key: string; label: string; format?: string; render?: string }>;
  tableRows?: Array<{ cells: Array<{ key: string; value: Scalar }> }>;
};

type SectionInput = {
  title?: string;
  columns?: number;
  widgets: WidgetInput[];
};

const clampColumns = (value: number | undefined): number => Math.max(1, Math.min(4, Math.trunc(value ?? 1)));

const toNode = (input: WidgetInput): Record<string, unknown> | null => {
  const type = input.type
    ?? (input.chartPoints || input.chartSeries ? 'chart' : undefined)
    ?? (input.tableRows || input.tableColumns ? 'table' : undefined)
    ?? (input.metrics ? 'metric-grid' : undefined)
    ?? (input.steps ? 'flow' : undefined)
    ?? (input.items ? 'list' : undefined)
    ?? (input.text ? 'text' : undefined);
  if (type === 'text') return { type: 'text', value: input.text ?? String(input.value ?? '') };
  if (type === 'callout') {
    return { type: 'callout', title: input.title, value: input.text ?? String(input.value ?? ''), tone: input.tone ?? 'info' };
  }
  if (type === 'metric') {
    return { type: 'metric', label: input.label, value: input.value ?? '', detail: input.detail, tone: input.tone };
  }
  if (type === 'metric-grid') {
    return { type: 'metric-grid', columns: clampColumns(input.columns ?? 3), items: input.metrics ?? [] };
  }
  if (type === 'progress') {
    return { type: 'progress', label: input.label, value: typeof input.value === 'number' ? input.value : Number(input.value) || 0, detail: input.detail };
  }
  if (type === 'status') {
    return { type: 'status', label: input.label, value: input.value ?? '', tone: input.tone ?? 'neutral' };
  }
  if (type === 'flow') return { type: 'flow', data: input.steps ?? [] };
  if (type === 'list') return { type: 'list', title: input.title, ordered: input.ordered === true, items: input.items ?? [] };
  if (type === 'chart') {
    const series = (input.chartSeries ?? []).map((item, index) => ({ key: `series_${index + 1}`, label: item.label }));
    const data = (input.chartPoints ?? []).map((point) => Object.fromEntries([
      ['label', point.label],
      ...series.map((item, index) => [item.key, point.values[index] ?? 0]),
    ]));
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
    return {
      type: 'data-table',
      title: input.title,
      columns: input.tableColumns ?? [],
      data: (input.tableRows ?? []).map((row) => Object.fromEntries(row.cells.map((cell) => [cell.key, cell.value]))),
    };
  }
  return null;
};

export default tool({
  description: '优先使用此工具直接在当前 OpenChamber 对话内生成 Interactive UI。当用户要求“看看、画一下、可视化、看板、仪表盘、图表、对比、流程”时，应直接调用本工具，不要先调用通用报告/HTML/数据分析 skill，也不要创建文件；只有用户明确要求 HTML、网站或可下载报告时才改用那些能力。本工具不是固定模板，可按任务自由组合指标、图表、表格、流程、状态、列表和说明。',
  args: {
    title: tool.schema.string().describe('这次可视化的简短标题'),
    summary: tool.schema.string().describe('一句话给出结论、目标或范围，不要重复标题'),
    sections: tool.schema.array(tool.schema.object({
      title: tool.schema.string().optional().describe('分区标题'),
      columns: tool.schema.number().optional().describe('本分区响应式列数，1 到 4；图表和表格通常使用 1'),
      widgets: tool.schema.array(widget).min(1).max(12),
    })).min(1).max(8).describe('根据任务现场设计的页面分区；优先选择最能表达信息的组件组合'),
  },
  async execute(rawArgs) {
    const args = rawArgs as { title: string; summary: string; sections: SectionInput[] };
    const layout = {
      type: 'stack',
      title: args.title,
      children: [
        { type: 'text', value: args.summary },
        ...args.sections.map((section) => {
          const children = section.widgets.map(toNode).filter((node): node is Record<string, unknown> => node !== null);
          return {
            type: 'section',
            title: section.title,
            children: clampColumns(section.columns) > 1
              ? [{ type: 'grid', columns: clampColumns(section.columns), children }]
              : children,
          };
        }),
      ],
    };

    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.builtin.interactive-ui.generated',
      schemaVersion: 1,
      mode: 'snapshot',
      summary: args.summary,
      context: { title: args.title },
      data: { layout },
      updatedAt: new Date().toISOString(),
    });
  },
});
