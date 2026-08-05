import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the signed Interop Local CRM sales-funnel HTML Artifact backed by the connected Local CRM API. Use this specialized business Tool for stage distribution and customer pipeline cards, not generic html_artifact. The installed Artifact uses only the declared overview Gateway action and never receives credentials. A successful result is already rendered: call no other primary Surface Tool this turn.',
  args: {
    scope: tool.schema.string().optional().describe('CRM scope; defaults to default'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://installed-html-artifact-result/v1',
      schemaVersion: 1,
      artifact: 'com.openchamber.interop.crm.funnel',
      mode: 'live',
      summary: 'Local CRM sales funnel opened successfully',
      context: { scope: args.scope || 'default' },
      updatedAt: '2026-07-28T00:00:00.000Z',
    });
  },
});
