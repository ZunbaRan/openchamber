import { tool } from '@opencode-ai/plugin';

const MODES = ['components', 'dashboard-hero', 'master-detail', 'report'] as const;
type GalleryMode = (typeof MODES)[number];

const buildModeLayout = (mode: Exclude<GalleryMode, 'components'>): Record<string, unknown> => {
  if (mode === 'dashboard-hero') {
    return {
      type: 'stack',
      title: 'Layout mode: dashboard-hero',
      layoutMode: 'dashboard-hero',
      children: [
        { type: 'text', value: 'KPI band + one dominant chart + supporting rail. First KPI renders hero automatically.' },
        {
          type: 'section',
          id: 'kpis',
          children: [
            {
              type: 'metric-grid',
              columns: 4,
              items: [
                { label: 'Revenue', value: '¥1,820,000', trend: 'up', trendValue: '+12.4%', tone: 'positive', icon: 'bar-chart-2' },
                { label: 'Orders', value: 48, trend: 'up', trendValue: '+6', tone: 'positive' },
                { label: 'Refunds', value: 3, trend: 'down', trendValue: '-2', tone: 'negative' },
                { label: 'Conversion', value: '4.8%', trend: 'flat', trendValue: '±0.1' },
              ],
            },
          ],
        },
        {
          type: 'section',
          id: 'main',
          title: 'Pipeline by month',
          children: [
            {
              type: 'chart',
              title: 'Monthly revenue vs target',
              variant: 'bar',
              xKey: 'label',
              series: [{ key: 'revenue', label: 'Revenue' }, { key: 'lastYear', label: 'Last year' }],
              data: [
                { label: 'Mar', revenue: 1180000, lastYear: 960000 },
                { label: 'Apr', revenue: 1320000, lastYear: 1040000 },
                { label: 'May', revenue: 1490000, lastYear: 1110000 },
                { label: 'Jun', revenue: 1820000, lastYear: 1250000 },
              ],
              referenceLine: { value: 1500000, label: 'Target' },
            },
          ],
        },
        {
          type: 'section',
          id: 'aside',
          title: 'Watchlist',
          children: [
            {
              type: 'list',
              items: [
                { title: 'Q3 renewal — Acme', description: 'Owner: Lin', badge: 'pending', badgeTone: 'warning' },
                { title: 'Expansion — Globex', description: 'Owner: Chen', badge: 'approved', badgeTone: 'success' },
              ],
            },
          ],
        },
      ],
    };
  }
  if (mode === 'master-detail') {
    return {
      type: 'stack',
      title: 'Layout mode: master-detail',
      layoutMode: 'master-detail',
      children: [
        { type: 'text', value: 'Collection on the left, detail pane on the right.' },
        {
          type: 'section',
          id: 'master',
          title: 'Customers',
          children: [
            {
              type: 'data-table',
              density: 'compact',
              toneColumn: 'status',
              columns: [
                { key: 'name', label: 'Name' },
                { key: 'mrr', label: 'MRR', format: 'currency:CNY', align: 'right' },
                { key: 'status', label: 'Status', render: 'status' },
              ],
              data: [
                { name: 'Acme Corp', mrr: 42000, status: 'active' },
                { name: 'Globex', mrr: 28500, status: 'pending' },
                { name: 'Initech', mrr: 0, status: 'blocked' },
              ],
            },
          ],
        },
        {
          type: 'section',
          id: 'detail',
          title: 'Acme Corp',
          children: [
            {
              type: 'key-value',
              items: [
                { label: 'Plan', value: 'Enterprise' },
                { label: 'Renewal', value: '2026-09-30' },
                { label: 'Owner', value: 'Lin' },
                { label: 'Health', value: '92 / 100' },
              ],
            },
            { type: 'callout', tone: 'info', value: 'Renewal conversation scheduled for next week.' },
          ],
        },
      ],
    };
  }
  return {
    type: 'stack',
    title: 'Layout mode: report',
    layoutMode: 'report',
    children: [
      { type: 'text', value: 'Conclusion first, evidence second.' },
      {
        type: 'section',
        id: 'summary',
        children: [
          { type: 'callout', tone: 'success', title: 'Conclusion', value: 'Release readiness is on track; two watch items remain for next sprint.' },
        ],
      },
      {
        type: 'section',
        title: 'Evidence',
        children: [
          {
            type: 'chart',
            title: 'Defect trend',
            variant: 'line',
            xKey: 'label',
            series: [{ key: 'open', label: 'Open defects' }],
            data: [
              { label: 'W1', open: 21 }, { label: 'W2', open: 17 }, { label: 'W3', open: 12 }, { label: 'W4', open: 8 },
            ],
            referenceLine: { value: 10, label: 'Gate' },
          },
        ],
      },
      {
        type: 'section',
        title: 'Risks',
        children: [
          { type: 'list', items: [{ title: 'Payment retry coverage', badge: 'watch', badgeTone: 'warning' }, { title: 'Docs freeze date', badge: 'ok', badgeTone: 'success' }] },
        ],
      },
    ],
  };
};

export default tool({
  description: '仅当用户明确要求查看 OpenChamber Interactive UI 组件库、组件 Gallery 或开发验收样例时使用。返回一张对话流内的只读组件画廊；不要为普通可视化任务自动选择本 Tool。Use only when the user explicitly asks for the OpenChamber Interactive UI component gallery or a developer acceptance sample; never select it for ordinary visualization.',
  args: {
    mode: tool.schema.enum(['components', 'dashboard-hero', 'master-detail', 'report']).optional().describe('画廊内容：components（默认组件集）；dashboard-hero / master-detail / report（Style v2 构图模式演示）'),
  },
  async execute(rawArgs) {
    const mode = MODES.find((entry) => entry === (rawArgs as { mode?: string } | undefined)?.mode) ?? 'components';
    if (mode !== 'components') {
      return JSON.stringify({
        $schema: 'openchamber://interactive-result/v1',
        view: 'com.openchamber.builtin.interactive-ui.gallery',
        schemaVersion: 1,
        mode: 'snapshot',
        summary: `Interactive UI layout mode gallery: ${mode}`,
        context: { title: `Layout mode: ${mode}` },
        data: { layout: buildModeLayout(mode) },
        updatedAt: new Date().toISOString(),
      });
    }
    const layout = {
      type: 'stack',
      title: 'Interactive UI Component Gallery',
      children: [
        {
          type: 'section',
          title: 'Overview',
          children: [
            {
              type: 'metric-grid',
              columns: 3,
              items: [
                { label: 'Components', value: 31, detail: 'Safe declarative primitives', trend: 'up', trendValue: '+3', tone: 'positive', icon: 'stack' },
                { label: 'Renderer', value: 'Inline', detail: 'Conversation-native', tone: 'info', icon: 'target' },
                { label: 'Authority', value: 'Read only', detail: 'No business API', tone: 'neutral', icon: 'shield-check' },
              ],
            },
          ],
        },
        {
          type: 'section',
          title: 'Local interactivity (search / sort / paginate — no business queries)',
          children: [
            {
              type: 'data-table',
              title: 'Revenue by account',
              density: 'compact',
              searchable: true,
              sortable: true,
              pagination: { pageSize: 5 },
              toneColumn: 'status',
              columns: [
                { key: 'name', label: 'Account' },
                { key: 'revenue', label: 'Revenue', format: 'currency:CNY', align: 'right' },
                { key: 'orders', label: 'Orders', format: 'number', align: 'right' },
                { key: 'status', label: 'Status', render: 'status' },
              ],
              data: [
                { name: 'Acme Corp', revenue: 420000, orders: 12, status: 'active' },
                { name: 'Globex', revenue: 285000, orders: 9, status: 'pending' },
                { name: 'Initech', revenue: 98000, orders: 4, status: 'active' },
                { name: 'Umbrella', revenue: 672000, orders: 21, status: 'active' },
                { name: 'Hooli', revenue: 158000, orders: 6, status: 'review' },
                { name: 'Stark Industries', revenue: 803000, orders: 17, status: 'active' },
                { name: 'Wayne Enterprises', revenue: 512000, orders: 14, status: 'pending' },
                { name: 'Wonka', revenue: 44000, orders: 2, status: 'blocked' },
              ],
            },
            {
              type: 'list',
              title: 'Filterable watchlist',
              filterable: true,
              items: [
                { title: 'Q3 renewal — Acme', description: 'Owner: Lin', badge: 'pending', badgeTone: 'warning' },
                { title: 'Expansion — Globex', description: 'Owner: Chen', badge: 'approved', badgeTone: 'success' },
                { title: 'Churn risk — Wonka', description: 'Owner: Zhao', badge: 'blocked', badgeTone: 'error' },
              ],
            },
          ],
        },
        {
          type: 'section',
          title: 'Decision surfaces',
          children: [
            {
              type: 'grid',
              columns: 2,
              children: [
                { type: 'gauge', title: 'Release confidence', label: 'Quality gate', value: 92, minimum: 0, maximum: 100, unit: '%', detail: 'Tests, accessibility, and visual review', tone: 'success' },
                { type: 'sparkline', label: 'P95 render latency', value: '38 ms', values: [52, 48, 45, 43, 41, 42, 38] },
              ],
            },
            {
              type: 'heatmap',
              title: 'Workload by day and time',
              cells: [
                { row: 'Mon', column: '09:00', value: 32 }, { row: 'Mon', column: '13:00', value: 58 }, { row: 'Mon', column: '17:00', value: 41 },
                { row: 'Tue', column: '09:00', value: 44 }, { row: 'Tue', column: '13:00', value: 76 }, { row: 'Tue', column: '17:00', value: 55 },
                { row: 'Wed', column: '09:00', value: 28 }, { row: 'Wed', column: '13:00', value: 66 }, { row: 'Wed', column: '17:00', value: 48 },
              ],
            },
          ],
        },
        {
          type: 'section',
          title: 'Workflow',
          children: [
            {
              type: 'kanban',
              title: 'Interactive UI 2.0',
              columns: [
                { id: 'planned', title: 'Planned' },
                { id: 'building', title: 'Building', tone: 'info' },
                { id: 'ready', title: 'Ready', tone: 'success' },
              ],
              cards: [
                { id: 'a11y', column: 'ready', title: 'Accessible primitives', description: 'Keyboard and semantic output', badge: 'Done', tone: 'success' },
                { id: 'gallery', column: 'building', title: 'Conversation Gallery', description: 'Review components in the real output flow', badge: 'P1', tone: 'info' },
                { id: 'maps', column: 'planned', title: 'Map primitive', description: 'Requires a reviewed data and privacy contract', badge: 'Next' },
              ],
            },
            {
              type: 'timeline',
              title: 'Lifecycle',
              items: [
                { title: 'Agent composes a layout', description: 'Only allowlisted fields are accepted', status: 'completed' },
                { title: 'Host sanitizes untrusted data', description: 'Executable channels are removed', status: 'completed' },
                { title: 'Conversation renders the View', description: 'Theme and locale come from OpenChamber', status: 'active' },
              ],
            },
          ],
        },
        {
          type: 'section',
          title: 'Planning and relationships',
          children: [
            {
              type: 'agenda',
              title: 'Today',
              entries: [
                { id: 'design', date: 'Jul 22', time: '09:30', endTime: '10:15', title: 'Design review', description: 'Freeze responsive and accessibility contracts', location: 'Studio', tone: 'info' },
                { id: 'release', date: 'Jul 22', time: '14:00', title: 'Release gate', description: 'Review model and visual acceptance evidence', tone: 'success' },
              ],
            },
            {
              type: 'funnel',
              title: 'Extension activation funnel',
              stages: [
                { label: 'Discovered', value: 120 },
                { label: 'Reviewed', value: 78 },
                { label: 'Installed', value: 54 },
                { label: 'Activated', value: 49, detail: '91% of installs' },
              ],
            },
            {
              type: 'network',
              title: 'Runtime boundary',
              nodes: [
                { id: 'agent', label: 'Agent', detail: 'Selects a governed Tool' },
                { id: 'host', label: 'OpenChamber', detail: 'Owns rendering and policy' },
                { id: 'gateway', label: 'Business Gateway', detail: 'Injects credentials server-side' },
                { id: 'system', label: 'Business API', detail: 'Owns permissions' },
              ],
              edges: [
                { source: 'agent', target: 'host', label: 'Interactive Result' },
                { source: 'host', target: 'gateway', label: 'Declared action' },
                { source: 'gateway', target: 'system', label: 'Scoped request' },
              ],
            },
          ],
        },
      ],
    };

    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.builtin.interactive-ui.gallery',
      schemaVersion: 1,
      mode: 'snapshot',
      summary: 'OpenChamber Interactive UI component gallery',
      context: { title: 'Interactive UI Component Gallery' },
      data: { layout },
      updatedAt: new Date().toISOString(),
    });
  },
});
