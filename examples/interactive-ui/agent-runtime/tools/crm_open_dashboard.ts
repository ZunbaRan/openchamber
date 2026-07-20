import { tool } from '@opencode-ai/plugin';

export default tool({
  description: '当用户询问企业 CRM、客户、商机、销售管道或跟进情况时，打开对话内 CRM Interactive UI 工作台。Use for CRM/customer/opportunity/pipeline questions.',
  args: {
    focus: tool.schema.string().optional().describe('可选关注范围，例如 overview、customers 或 pipeline'),
  },
  async execute(args) {
    const baseUrl = process.env.OCIX_DEMO_API_URL;
    const token = process.env.OCIX_DEMO_TOKEN;
    if (!baseUrl || !token) throw new Error('OCIX demo CRM system is not configured');

    const focus = args.focus || 'overview';
    const response = await fetch(new URL('/crm/dashboard', `${baseUrl.replace(/\/+$/, '')}/`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ focus }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `CRM API failed (${response.status})`);

    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.openchamber.demo.crm.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: `CRM：${data.customerCount} 个重点客户，销售管道 ${data.pipelineValue}`,
      context: { focus },
      data,
      dataRef: {
        connector: 'crm-api',
        resource: 'crm.dashboard',
        revision: data.updatedAt,
      },
      updatedAt: data.updatedAt,
    });
  },
});
