import http from 'node:http';
import { fileURLToPath } from 'node:url';

const readJsonBody = async (request) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

export const startMockBusinessServer = async ({ port = 0, token = 'demo-secret' } = {}) => {
  const orderStatusLabels = { pending: '待批准', review: '待复核', approved: '已批准' };
  const crmStageLabels = { qualified: '已筛选', proposal: '方案阶段', negotiation: '谈判阶段', won: '已赢单' };
  const orders = new Map([
    ['SO-1001', { id: 'SO-1001', customer: '星河制造', amount: 328000, status: 'pending', revision: 1 }],
    ['SO-1002', { id: 'SO-1002', customer: '远山零售', amount: 186000, status: 'review', revision: 3 }],
  ]);
  const customers = [
    { id: 'C-1001', name: '星河制造', industry: '智能制造', owner: '林晓', health: '健康' },
    { id: 'C-1002', name: '远山零售', industry: '连锁零售', owner: '周宁', health: '需关注' },
    { id: 'C-1003', name: '澄海能源', industry: '新能源', owner: '林晓', health: '健康' },
  ];
  const opportunities = new Map([
    ['OP-2001', { id: 'OP-2001', name: '智能工厂二期', customer: '星河制造', amount: 860000, stage: 'proposal', probability: 0.65, revision: 4 }],
    ['OP-2002', { id: 'OP-2002', name: '门店数据中台', customer: '远山零售', amount: 520000, stage: 'qualified', probability: 0.4, revision: 2 }],
    ['OP-2003', { id: 'OP-2003', name: '能源预测平台', customer: '澄海能源', amount: 1280000, stage: 'negotiation', probability: 0.82, revision: 6 }],
  ]);
  const crmStages = ['qualified', 'proposal', 'negotiation', 'won'];

  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      if (request.method === 'POST' && request.url === '/dashboard') {
        const input = await readJsonBody(request);
        json(response, 200, {
          region: typeof input.region === 'string' ? input.region : 'east',
          period: typeof input.period === 'string' ? input.period : '2026-07',
          revenue: 1820000,
          orderCount: 48,
          completionRate: 0.875,
          trend: [
            { date: '07-01', revenue: 240000 },
            { date: '07-08', revenue: 360000 },
            { date: '07-15', revenue: 510000 },
            { date: '07-22', revenue: 710000 }
          ],
          anomalies: Array.from(orders.values(), (order) => ({
            ...order,
            statusLabel: orderStatusLabels[order.status] ?? order.status,
          })),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/orders/approve') {
        const input = await readJsonBody(request);
        const order = orders.get(input.orderId);
        if (!order) {
          json(response, 404, { error: 'Order not found' });
          return;
        }
        if (order.revision !== input.revision) {
          json(response, 409, { error: 'Order revision changed' });
          return;
        }
        if (order.status !== 'pending') {
          json(response, 409, { error: 'Order is not pending approval' });
          return;
        }
        order.status = 'approved';
        order.revision += 1;
        json(response, 200, {
          order: { ...order, statusLabel: orderStatusLabels[order.status] ?? order.status },
          message: `订单 ${order.id} 已批准`,
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/crm/dashboard') {
        await readJsonBody(request);
        const pipeline = Array.from(opportunities.values());
        const pipelineValue = pipeline.reduce((total, opportunity) => total + opportunity.amount, 0);
        const weightedValue = pipeline.reduce((total, opportunity) => total + opportunity.amount * opportunity.probability, 0);
        json(response, 200, {
          customerCount: customers.length,
          pipelineValue,
          weightedWinRate: pipelineValue > 0 ? weightedValue / pipelineValue : 0,
          customers,
          opportunities: pipeline.map((opportunity) => ({
            ...opportunity,
            stageLabel: crmStageLabels[opportunity.stage] ?? opportunity.stage,
          })),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/crm/opportunities/advance') {
        const input = await readJsonBody(request);
        const opportunity = opportunities.get(input.opportunityId);
        if (!opportunity) {
          json(response, 404, { error: 'Opportunity not found' });
          return;
        }
        if (opportunity.revision !== input.revision) {
          json(response, 409, { error: 'Opportunity revision changed' });
          return;
        }
        const currentStage = crmStages.indexOf(opportunity.stage);
        if (currentStage < 0 || currentStage >= crmStages.length - 1) {
          json(response, 409, { error: 'Opportunity cannot be advanced further' });
          return;
        }
        opportunity.stage = crmStages[currentStage + 1];
        opportunity.probability = [0.4, 0.65, 0.82, 1][currentStage + 1];
        opportunity.revision += 1;
        json(response, 200, {
          opportunity: {
            ...opportunity,
            stageLabel: crmStageLabels[opportunity.stage] ?? opportunity.stage,
          },
          message: `商机 ${opportunity.name} 已推进到${crmStageLabels[opportunity.stage] ?? opportunity.stage}`,
        });
        return;
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock business server did not expose a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startMockBusinessServer({ port: Number(process.env.OCIX_DEMO_PORT) || 47831 });
  console.log(`OCIX mock business system listening on ${server.url}`);
}
