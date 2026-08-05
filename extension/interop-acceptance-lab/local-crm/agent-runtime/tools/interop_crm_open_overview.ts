import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the authoritative Interop Local CRM overview backed by the connected local CRM API. Use this business Tool instead of generic interactive_ui for CRM customers, opportunity pipeline, and forecasts. If the Connector is unavailable, still call this Tool so the Surface reports setup status rather than inventing data. A successful result is already rendered: call at most one primary Surface Tool this turn and do not follow with interactive_ui, html_artifact, or a duplicate Markdown dashboard.',
  args: {
    scope: tool.schema.string().optional().describe('CRM scope; defaults to default'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.interop.crm.overview',
      schemaVersion: 1,
      mode: 'live',
      summary: 'Local CRM overview opened successfully',
      context: { scope: args.scope || 'default' },
      updatedAt: '2026-07-28T00:00:00.000Z',
    });
  },
});
