import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the demo sales dashboard for a region and period',
  args: {
    region: tool.schema.string().describe('Sales region, for example east'),
    period: tool.schema.string().describe('Reporting period in YYYY-MM format'),
  },
  async execute(args) {
    const baseUrl = process.env.OCIX_DEMO_API_URL;
    const token = process.env.OCIX_DEMO_TOKEN;
    if (!baseUrl || !token) throw new Error('OCIX demo business system is not configured');

    const response = await fetch(new URL('/dashboard', `${baseUrl.replace(/\/+$/, '')}/`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Sales API failed (${response.status})`);

    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.demo.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: `${args.region} ${args.period} revenue: ${data.revenue}`,
      context: args,
      data,
      dataRef: {
        connector: 'sales-api',
        resource: 'sales.dashboard',
        revision: data.updatedAt,
      },
      updatedAt: data.updatedAt,
    });
  },
});
