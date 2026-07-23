import { tool } from '@opencode-ai/plugin';

export default tool({
  description: '仅当用户明确要求查看 OpenChamber Interactive UI 组件库、组件 Gallery 或开发验收样例时使用。返回一张对话流内的只读组件画廊；不要为普通可视化任务自动选择本 Tool。Use only when the user explicitly asks for the OpenChamber Interactive UI component gallery or a developer acceptance sample; never select it for ordinary visualization.',
  args: {},
  async execute() {
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
                { label: 'Components', value: 31, detail: 'Safe declarative primitives', trend: 'up', trendValue: '+3', tone: 'positive' },
                { label: 'Renderer', value: 'Inline', detail: 'Conversation-native', tone: 'info' },
                { label: 'Authority', value: 'Read only', detail: 'No business API', tone: 'neutral' },
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
