import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open one authoritative Interop Local CRM customer workspace from the connected local CRM API. Use it for a specific customer and its opportunities; it may request confirmation before advancing an opportunity. Prefer it over generic interactive_ui. If the Connector is unavailable, still call this Tool and let the Surface report the connection problem. A successful result is terminal and already rendered: call no other primary Surface Tool this turn.',
  args: {
    customerId: tool.schema.string().describe('Customer ID such as CUS-1001'),
    scope: tool.schema.string().optional().describe('CRM scope; defaults to default'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.interop.crm.customer',
      schemaVersion: 1,
      mode: 'live',
      summary: `Local CRM customer ${args.customerId} opened successfully`,
      context: {
        scope: args.scope || 'default',
        customerId: args.customerId,
      },
      updatedAt: '2026-07-28T00:00:00.000Z',
    });
  },
});
