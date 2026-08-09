import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const nativeTemplatePath = path.join(projectRoot, 'examples', 'interactive-ui', 'acme-crm', 'dist', 'ui.mjs');
const packageFormatPath = '../../packages/web/server/lib/interactive-ui/package-format.js';

export const HYBRID_CRM_FIXTURE = Object.freeze({
  extensionId: 'com.demo.simple.crm',
  connectorId: 'crm-api',
  overviewViewId: 'com.demo.simple.crm.overview',
  workspaceViewId: 'com.demo.simple.crm.workspace',
  artifactId: 'com.demo.simple.crm.explorer',
  queryActionId: 'com.demo.simple.crm.dashboard.query',
  writeActionId: 'com.demo.simple.crm.opportunity.advance',
  toolNames: [
    'simple_crm_open_overview',
    'simple_crm_open_workspace',
    'simple_crm_open_explorer',
  ],
  baseToolNames: [
    'simple_crm_open_overview',
    'simple_crm_open_workspace',
  ],
  explorerToolName: 'simple_crm_open_explorer',
  skillName: 'simple-crm-interactive-ui',
  publisherId: 'com.demo.simple.crm.publisher',
  publisherName: 'Simple CRM Demo',
  keyId: 'release-2026',
});

export const DEMO_KEYS = Object.freeze({
  full: 'ocix-test-full-access',
  readonly: 'ocix-test-readonly-access',
  revoked: 'ocix-test-revoked-access',
});

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
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const authorize = (request) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  if (token === DEMO_KEYS.revoked || !Object.values(DEMO_KEYS).includes(token)) return 'revoked';
  return token === DEMO_KEYS.readonly ? 'readonly' : 'full';
};

export const assertHybridCrmFixtureAvailable = async () => {
  await fs.access(nativeTemplatePath);
};

export const startHybridCrmApi = async () => {
  const stageLabels = {
    qualified: '已筛选',
    proposal: '方案阶段',
    negotiation: '谈判阶段',
    won: '已赢单',
  };
  const stages = ['qualified', 'proposal', 'negotiation', 'won'];
  const customers = [
    { id: 'C-1001', name: '星河制造', industry: '智能制造', owner: '林晓', health: 'healthy' },
    { id: 'C-1002', name: '海风零售', industry: '连锁零售', owner: '周宁', health: 'at-risk' },
    { id: 'C-1003', name: '澄海能源', industry: '新能源', owner: '林晓', health: 'healthy' },
    { id: 'C-1004', name: '云图科技', industry: '企业软件', owner: '陈岚', health: 'healthy' },
  ];
  const opportunities = new Map([
    ['OP-2001', { id: 'OP-2001', name: '智能工厂二期', customer: '星河制造', amount: 860000, stage: 'proposal', probability: 0.65, revision: 4 }],
    ['OP-2002', { id: 'OP-2002', name: '门店数据中台', customer: '海风零售', amount: 520000, stage: 'qualified', probability: 0.4, revision: 2 }],
    ['OP-2003', { id: 'OP-2003', name: '能源预测平台', customer: '澄海能源', amount: 1280000, stage: 'negotiation', probability: 0.82, revision: 6 }],
    ['OP-2004', { id: 'OP-2004', name: '客户成功平台', customer: '云图科技', amount: 390000, stage: 'qualified', probability: 0.4, revision: 1 }],
  ]);

  const server = http.createServer(async (request, response) => {
    const access = authorize(request);
    if (access === 'revoked') {
      json(response, 401, { error: 'Invalid or revoked API key' });
      return;
    }
    try {
      if (request.method === 'GET' && request.url === '/health') {
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && request.url === '/dashboard') {
        await readJsonBody(request);
        const pipeline = Array.from(opportunities.values());
        const open = pipeline.filter((opportunity) => opportunity.stage !== 'won');
        const pipelineValue = open.reduce((total, opportunity) => total + opportunity.amount, 0);
        const weightedValue = open.reduce((total, opportunity) => total + opportunity.amount * opportunity.probability, 0);
        json(response, 200, {
          customerCount: customers.length,
          openOpportunityCount: open.length,
          pipelineValue,
          weightedWinRate: pipelineValue > 0 ? weightedValue / pipelineValue : 0,
          customers,
          opportunities: pipeline.map((opportunity) => ({
            ...opportunity,
            stageLabel: stageLabels[opportunity.stage] ?? opportunity.stage,
          })),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/opportunities/advance') {
        const input = await readJsonBody(request);
        if (access === 'readonly') {
          json(response, 403, { error: 'Key lacks write scope' });
          return;
        }
        const opportunity = opportunities.get(input.opportunityId);
        if (!opportunity) {
          json(response, 404, { error: 'Opportunity not found' });
          return;
        }
        if (opportunity.revision !== input.revision) {
          json(response, 409, { error: 'Opportunity revision changed' });
          return;
        }
        const currentStage = stages.indexOf(opportunity.stage);
        if (currentStage < 0 || currentStage >= stages.length - 1) {
          json(response, 409, { error: 'Opportunity cannot be advanced further' });
          return;
        }
        opportunity.stage = stages[currentStage + 1];
        opportunity.probability = [0.4, 0.65, 0.82, 1][currentStage + 1];
        opportunity.revision += 1;
        json(response, 200, {
          opportunity: {
            ...opportunity,
            stageLabel: stageLabels[opportunity.stage] ?? opportunity.stage,
          },
          message: `商机 ${opportunity.name} 已推进到${stageLabels[opportunity.stage] ?? opportunity.stage}`,
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
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Hybrid CRM API did not expose a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    keys: DEMO_KEYS,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const createManifest = ({ crmApiUrl, version, includeArtifact }) => ({
  $schema: 'openchamber://extension/v1',
  id: HYBRID_CRM_FIXTURE.extensionId,
  name: 'Simple CRM',
  shortName: 'Simple CRM',
  version,
  publisher: HYBRID_CRM_FIXTURE.publisherName,
  agentRouting: {
    domain: 'crm',
    intents: [
      'crm.overview',
      'crm.customer.list',
      'crm.opportunity.pipeline',
      'crm.opportunity.advance',
      ...(includeArtifact ? ['crm.explorer'] : []),
    ],
    examples: {
      'zh-CN': ['打开企业 CRM 工作台', '查看客户和商机管道', ...(includeArtifact ? ['打开 CRM 可视化探索器'] : [])],
      en: ['open the enterprise CRM workspace', 'show the customer and opportunity pipeline', ...(includeArtifact ? ['open the CRM visual explorer'] : [])],
    },
    dataAuthority: 'connected-business-system',
  },
  connectors: [{
    id: HYBRID_CRM_FIXTURE.connectorId,
    type: 'http',
    baseUrl: crmApiUrl,
    auth: {
      type: 'api-key',
      placement: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    },
    test: { method: 'GET', path: '/health' },
  }],
  views: [
    {
      id: HYBRID_CRM_FIXTURE.overviewViewId,
      title: 'Simple CRM 概览',
      runtime: 'declarative',
      entry: 'ui/declarative/overview.view.json',
      tools: ['simple_crm_open_overview'],
      routing: {
        intents: ['crm.overview', 'crm.customer.list', 'crm.opportunity.pipeline'],
        priority: 88,
        operation: 'read',
      },
      displayModes: ['inline', 'workspace', 'fullscreen'],
      dashboard: {
        description: '查看真实 CRM 客户和商机概览。',
        inputSchema: {
          type: 'object',
          properties: { scope: { type: 'string', minLength: 1, maxLength: 80 } },
        },
        defaultContext: { scope: 'default' },
      },
    },
    {
      id: HYBRID_CRM_FIXTURE.workspaceViewId,
      title: 'Simple CRM 工作台',
      runtime: 'native',
      entry: 'ui/native/workspace.mjs',
      export: 'extension',
      tools: ['simple_crm_open_workspace'],
      routing: {
        intents: ['crm.overview', 'crm.customer.list', 'crm.opportunity.pipeline', 'crm.opportunity.advance'],
        priority: 90,
        operation: 'mixed',
      },
      displayModes: ['inline', 'workspace', 'fullscreen'],
      dashboard: {
        description: '查看并通过确认操作推进真实 CRM 商机。',
        inputSchema: {
          type: 'object',
          properties: { focus: { type: 'string', minLength: 1, maxLength: 80 } },
        },
        defaultContext: { focus: 'overview' },
      },
    },
  ],
  ...(includeArtifact ? {
    artifacts: [{
      id: HYBRID_CRM_FIXTURE.artifactId,
      title: 'Simple CRM Explorer',
      entry: 'ui/artifacts/explorer.html',
      tools: [HYBRID_CRM_FIXTURE.explorerToolName],
      routing: { intents: ['crm.explorer'], priority: 92, operation: 'mixed' },
      displayModes: ['inline', 'workspace', 'fullscreen'],
      inlineHeight: 520,
      capabilities: {
        scripts: true,
        businessActions: [HYBRID_CRM_FIXTURE.queryActionId, HYBRID_CRM_FIXTURE.writeActionId],
      },
    }],
  } : {}),
  actions: [
    {
      id: HYBRID_CRM_FIXTURE.queryActionId,
      connector: HYBRID_CRM_FIXTURE.connectorId,
      risk: 'read',
      permission: 'allow',
      request: { method: 'POST', path: '/dashboard' },
    },
    {
      id: HYBRID_CRM_FIXTURE.writeActionId,
      connector: HYBRID_CRM_FIXTURE.connectorId,
      risk: 'write',
      permission: 'ask',
      request: { method: 'POST', path: '/opportunities/advance' },
      confirmation: {
        title: '推进商机阶段？',
        description: '该操作会更新企业 CRM 中的商机状态。',
      },
    },
  ],
  permissions: { network: [crmApiUrl] },
  trust: { mode: 'native-code', signature: 'test' },
});

const createDeclarativeView = () => ({
  $schema: 'openchamber://declarative-view/v1',
  id: HYBRID_CRM_FIXTURE.overviewViewId,
  title: 'Simple CRM 概览',
  queries: {
    dashboard: {
      action: HYBRID_CRM_FIXTURE.queryActionId,
      input: { scope: { $path: 'context.scope', fallback: 'default' } },
    },
  },
  layout: {
    type: 'stack',
    children: [
      {
        type: 'metric-grid',
        columns: { default: 3 },
        items: [
          { label: '客户数', value: { $path: 'query.dashboard.customerCount', fallback: 0, format: 'number' } },
          { label: '活跃商机', value: { $path: 'query.dashboard.openOpportunityCount', fallback: 0, format: 'number' } },
          { label: '商机金额', value: { $path: 'query.dashboard.pipelineValue', fallback: 0, format: 'currency:CNY' } },
        ],
      },
      {
        type: 'data-table',
        title: '商机管道',
        data: { $path: 'query.dashboard.opportunities', fallback: [] },
        rowKey: 'id',
        columns: [
          { key: 'name', label: '商机' },
          { key: 'customer', label: '客户' },
          { key: 'amount', label: '金额', format: 'currency:CNY' },
          { key: 'stageLabel', label: '阶段', render: 'status' },
        ],
      },
    ],
  },
});

const createArtifactDocument = () => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; padding: 24px; background: transparent; color: CanvasText; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
      h1 { margin: 0; font-size: 22px; }
      #status { color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 13px; }
      .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
      .metric { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 14px; padding: 16px; background: color-mix(in srgb, Canvas 94%, CanvasText 6%); }
      .label { color: color-mix(in srgb, CanvasText 60%, transparent); font-size: 12px; }
      .value { display: block; margin-top: 7px; font-size: 26px; font-weight: 700; }
      @media (max-width: 560px) { .metrics { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header><h1>Simple CRM Explorer</h1><div id="status">Waiting for Host</div></header>
    <section class="metrics" aria-label="CRM live metrics">
      <article class="metric"><span class="label">Customers</span><strong class="value" id="customers">—</strong></article>
      <article class="metric"><span class="label">Open opportunities</span><strong class="value" id="opportunities">—</strong></article>
      <article class="metric"><span class="label">Pipeline value</span><strong class="value" id="pipeline">—</strong></article>
    </section>
    <script>
      addEventListener('openchamber:host-init', async (event) => {
        const status = document.getElementById('status');
        try {
          const dashboard = await window.openchamber.business.query(
            '${HYBRID_CRM_FIXTURE.queryActionId}',
            { scope: event.detail.context?.scope || 'default' },
          );
          document.getElementById('customers').textContent = String(dashboard.customerCount);
          document.getElementById('opportunities').textContent = String(dashboard.openOpportunityCount);
          document.getElementById('pipeline').textContent = new Intl.NumberFormat('en', {
            style: 'currency', currency: 'USD', maximumFractionDigits: 0,
          }).format(dashboard.pipelineValue);
          status.textContent = 'Connected';
          document.body.dataset.businessReady = 'true';
        } catch (error) {
          status.textContent = error?.message || 'Business data unavailable';
          document.body.dataset.businessReady = 'false';
        }
      }, { once: true });
    </script>
  </body>
</html>
`;

const createToolSource = ({ name, view, summary, artifact }) => `import { tool } from '@opencode-ai/plugin';

export default tool({
  description: '${artifact
    ? 'Open the installed Simple CRM HTML Artifact explorer for authoritative customer and pipeline exploration through the Business Gateway.'
    : `Open the installed Simple CRM ${name.includes('workspace') ? 'native workspace' : 'declarative overview'} with authoritative customer and opportunity data through the Business Gateway.`} Prefer this business Tool over generic interactive_ui or html_artifact. Call it at most once per assistant turn; the successful result is already rendered.',
  args: { scope: tool.schema.string().optional() },
  async execute(args) {
    return JSON.stringify({
      $schema: '${artifact ? 'openchamber://installed-html-artifact-result/v1' : 'openchamber://interactive-result/v1'}',
      schemaVersion: 1,
      ${artifact ? `artifact: '${artifact}'` : `view: '${view}'`},
      mode: 'live',
      summary: '${summary}',
      context: { scope: args.scope || 'default', focus: args.scope || 'overview' },
      updatedAt: new Date().toISOString(),
    });
  },
});
`;

const populateExtensionDirectory = async ({ extensionDirectory, crmApiUrl, version, includeArtifact }) => {
  const manifest = createManifest({ crmApiUrl, version, includeArtifact });
  const declarativeDirectory = path.join(extensionDirectory, 'ui', 'declarative');
  const nativeDirectory = path.join(extensionDirectory, 'ui', 'native');
  const artifactDirectory = path.join(extensionDirectory, 'ui', 'artifacts');
  const toolDirectory = path.join(extensionDirectory, 'agent-runtime', 'tools');
  const skillDirectory = path.join(extensionDirectory, 'agent-runtime', 'skills', HYBRID_CRM_FIXTURE.skillName);
  await Promise.all([
    fs.mkdir(declarativeDirectory, { recursive: true }),
    fs.mkdir(nativeDirectory, { recursive: true }),
    fs.mkdir(toolDirectory, { recursive: true }),
    fs.mkdir(skillDirectory, { recursive: true }),
    ...(includeArtifact ? [fs.mkdir(artifactDirectory, { recursive: true })] : []),
  ]);

  const nativeTemplate = await fs.readFile(nativeTemplatePath, 'utf8');
  const nativeBundle = nativeTemplate
    .replaceAll('com.openchamber.demo.crm.dashboard', HYBRID_CRM_FIXTURE.workspaceViewId)
    .replaceAll('com.openchamber.demo.crm', HYBRID_CRM_FIXTURE.extensionId)
    .replaceAll('crm.dashboard.query', HYBRID_CRM_FIXTURE.queryActionId)
    .replaceAll('crm.opportunity.advance', HYBRID_CRM_FIXTURE.writeActionId);

  await Promise.all([
    fs.writeFile(path.join(extensionDirectory, 'openchamber.extension.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(declarativeDirectory, 'overview.view.json'), `${JSON.stringify(createDeclarativeView(), null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(nativeDirectory, 'workspace.mjs'), nativeBundle, 'utf8'),
    fs.writeFile(path.join(toolDirectory, 'simple_crm_open_overview.ts'), createToolSource({
      name: 'simple_crm_open_overview',
      view: HYBRID_CRM_FIXTURE.overviewViewId,
      summary: 'Simple CRM overview opened',
    }), 'utf8'),
    fs.writeFile(path.join(toolDirectory, 'simple_crm_open_workspace.ts'), createToolSource({
      name: 'simple_crm_open_workspace',
      view: HYBRID_CRM_FIXTURE.workspaceViewId,
      summary: 'Simple CRM workspace opened',
    }), 'utf8'),
    fs.writeFile(path.join(skillDirectory, 'SKILL.md'), `---
name: ${HYBRID_CRM_FIXTURE.skillName}
description: Open the signed Simple CRM OCIX views for authoritative customer and opportunity data.
---

# Simple CRM Interactive UI

- Use \`simple_crm_open_overview\` for a read-only customer and opportunity summary.
- Use \`simple_crm_open_workspace\` for the richer native workspace or confirmed opportunity updates.
${includeArtifact ? '- Use `simple_crm_open_explorer` when the user explicitly requests the installed CRM explorer.' : ''}
- Never use generic generated UI to invent CRM data.
- After a Simple CRM Tool returns, do not call a second primary visualization Tool.
`, 'utf8'),
    ...(includeArtifact ? [
      fs.writeFile(path.join(artifactDirectory, 'explorer.html'), createArtifactDocument(), 'utf8'),
      fs.writeFile(path.join(toolDirectory, `${HYBRID_CRM_FIXTURE.explorerToolName}.ts`), createToolSource({
        name: HYBRID_CRM_FIXTURE.explorerToolName,
        artifact: HYBRID_CRM_FIXTURE.artifactId,
        summary: 'Simple CRM explorer opened',
      }), 'utf8'),
    ] : []),
  ]);
  return manifest;
};

export const createHybridCrmPublisherKeys = async () => {
  const { generatePublisherKeyPair } = await import(packageFormatPath);
  return generatePublisherKeyPair();
};

export const createHybridCrmPackage = async ({
  temporaryRoot,
  crmApiUrl,
  version = '1.3.0',
  createdAt = '2026-07-21T00:00:00.000Z',
  includeArtifact = true,
  publisherKeys,
} = {}) => {
  if (typeof temporaryRoot !== 'string' || !temporaryRoot.trim()) {
    throw new Error('temporaryRoot is required for the hybrid CRM fixture');
  }
  if (typeof crmApiUrl !== 'string' || !crmApiUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('crmApiUrl must be a dynamic loopback URL');
  }
  await assertHybridCrmFixtureAvailable();

  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '-');
  const extensionDirectory = path.join(temporaryRoot, `simple-crm-hybrid-${safeVersion}`);
  await fs.rm(extensionDirectory, { recursive: true, force: true });
  const manifest = await populateExtensionDirectory({
    extensionDirectory,
    crmApiUrl,
    version,
    includeArtifact,
  });
  const keys = publisherKeys ?? await createHybridCrmPublisherKeys();
  const { createExtensionPackage } = await import(packageFormatPath);
  const packageResult = await createExtensionPackage({
    extensionDirectory,
    privateKey: keys.privateKey,
    publisherId: HYBRID_CRM_FIXTURE.publisherId,
    publisherName: HYBRID_CRM_FIXTURE.publisherName,
    keyId: HYBRID_CRM_FIXTURE.keyId,
    createdAt,
  });

  return { ...packageResult, extensionDirectory, manifest, publisherKeys: keys };
};
