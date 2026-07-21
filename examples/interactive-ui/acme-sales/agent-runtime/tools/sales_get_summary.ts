import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the authoritative connected sales-system Declarative summary for a region and period. Prefer this business Tool over generic interactive_ui for sales summaries, anomalous orders, and approval workflows. After it returns, its OCIX View is already rendered: do not call interactive_ui/html_artifact or create a second visualization for the same sales data.',
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
