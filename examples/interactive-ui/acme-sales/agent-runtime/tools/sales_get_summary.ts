import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the demo sales summary for a region and period',
  args: {
    region: tool.schema.string().describe('Sales region, for example east'),
    period: tool.schema.string().describe('Reporting period in YYYY-MM format'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.demo.sales.summary',
      schemaVersion: 1,
      mode: 'live',
      summary: `${args.region} ${args.period} sales summary opened`,
      context: args,
      updatedAt: new Date().toISOString(),
    });
  },
});
