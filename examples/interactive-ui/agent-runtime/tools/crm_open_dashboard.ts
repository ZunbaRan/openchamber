import { tool } from '@opencode-ai/plugin';

export default tool({
  description: '从已连接的企业 CRM 获取真实客户、商机、销售管道和跟进数据，并在当前对话中打开唯一的 CRM 主工作台。CRM 领域请求应优先使用此 Tool；连接未配置时也应调用本 Tool 以返回配置提示，不得生成替代业务数据。成功返回后 View 已由 OpenChamber 渲染，本回合不要再调用 interactive_ui/html_artifact 或把相同数据重做成第二个看板。Use this connected-business-system Tool first; after it returns, do not select another visualization Tool for the same CRM data.',
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
