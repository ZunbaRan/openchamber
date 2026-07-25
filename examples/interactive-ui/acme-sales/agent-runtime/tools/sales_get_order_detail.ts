import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the installed Sales order-detail HTML Artifact for a specific order. Use it only when the user names an order ID; otherwise ask for the missing ID. The Artifact receives context from OpenChamber and never receives credentials.',
  args: {
    orderId: tool.schema.string().describe('Order ID, for example SO-1001'),
    region: tool.schema.string().optional().describe('Sales region, for example east'),
    period: tool.schema.string().optional().describe('Reporting period in YYYY-MM format'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://installed-html-artifact-result/v1',
      schemaVersion: 1,
      artifact: 'com.openchamber.demo.sales.order-detail',
      mode: 'live',
      summary: `Order ${args.orderId} detail opened`,
      context: {
        orderId: args.orderId,
        region: args.region || 'east',
        period: args.period || '2026-07',
      },
      updatedAt: new Date().toISOString(),
    });
  },
});
