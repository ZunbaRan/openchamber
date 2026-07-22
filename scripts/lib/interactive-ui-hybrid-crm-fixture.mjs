import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspaceRoot = path.dirname(projectRoot);
const extensionRoot = path.join(workspaceRoot, 'extension');

export const HYBRID_CRM_FIXTURE = Object.freeze({
  extensionId: 'com.demo.simple.crm',
  connectorId: 'crm-api',
  artifactId: 'com.demo.simple.crm.explorer',
  queryActionId: 'com.demo.simple.crm.dashboard.query',
  writeActionId: 'com.demo.simple.crm.opportunity.advance',
  toolNames: [
    'simple_crm_open_overview',
    'simple_crm_open_workspace',
    'simple_crm_open_explorer',
  ],
  explorerToolName: 'simple_crm_open_explorer',
  skillName: 'simple-crm-interactive-ui',
});

export const hybridCrmFixturePaths = Object.freeze({
  apiModule: path.join(extensionRoot, 'simple-crm-api', 'crm-api-server.mjs'),
  extensionSource: path.join(extensionRoot, 'simple-crm'),
  publisherPrivateKey: path.join(extensionRoot, '.offline-keys', 'simple-crm-publisher', 'publisher.private.pem'),
});

export const assertHybridCrmFixtureAvailable = async () => {
  await Promise.all(Object.values(hybridCrmFixturePaths).map((requiredPath) => fs.access(requiredPath)));
};

export const startHybridCrmApi = async () => {
  await assertHybridCrmFixtureAvailable();
  const apiModule = await import(pathToFileURL(hybridCrmFixturePaths.apiModule).href);
  const server = await apiModule.startCrmApiServer({ host: '127.0.0.1', port: 0 });
  return { ...server, keys: apiModule.DEMO_KEYS };
};

export const createHybridCrmPackage = async ({
  temporaryRoot,
  crmApiUrl,
  version = '1.3.0',
  createdAt = '2026-07-21T00:00:00.000Z',
} = {}) => {
  if (typeof temporaryRoot !== 'string' || !temporaryRoot.trim()) {
    throw new Error('temporaryRoot is required for the hybrid CRM fixture');
  }
  if (typeof crmApiUrl !== 'string' || !crmApiUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('crmApiUrl must be a dynamic loopback URL');
  }
  await assertHybridCrmFixtureAvailable();

  const extensionDirectory = path.join(temporaryRoot, 'simple-crm-hybrid');
  await fs.cp(hybridCrmFixturePaths.extensionSource, extensionDirectory, { recursive: true });
  const manifestPath = path.join(extensionDirectory, 'openchamber.extension.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.version = version;
  manifest.connectors[0].baseUrl = crmApiUrl;
  manifest.permissions.network = [crmApiUrl];
  manifest.agentRouting.intents.push('crm.explorer');
  manifest.agentRouting.examples['zh-CN'].push('打开 CRM 可视化探索器');
  manifest.agentRouting.examples.en.push('open the CRM visual explorer');
  manifest.artifacts = [{
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
  }];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const artifactDirectory = path.join(extensionDirectory, 'ui', 'artifacts');
  await fs.mkdir(artifactDirectory, { recursive: true });
  await fs.writeFile(path.join(artifactDirectory, 'explorer.html'), `<!doctype html>
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
`, 'utf8');

  const toolDirectory = path.join(extensionDirectory, 'agent-runtime', 'tools');
  await fs.mkdir(toolDirectory, { recursive: true });
  await fs.writeFile(path.join(toolDirectory, `${HYBRID_CRM_FIXTURE.explorerToolName}.ts`), `import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the installed Simple CRM HTML Artifact explorer for authoritative customer and pipeline exploration through the Business Gateway. Prefer this Tool for explicit CRM explorer or custom canvas requests; do not call generic html_artifact for the same business data.',
  args: { scope: tool.schema.string().optional() },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://installed-html-artifact-result/v1',
      schemaVersion: 1,
      artifact: '${HYBRID_CRM_FIXTURE.artifactId}',
      mode: 'live',
      summary: 'Simple CRM explorer opened',
      context: { scope: args.scope || 'default' },
      updatedAt: new Date().toISOString(),
    });
  },
});
`, 'utf8');

  const [{ createExtensionPackage }, privateKey] = await Promise.all([
    import('../../packages/web/server/lib/interactive-ui/package-format.js'),
    fs.readFile(hybridCrmFixturePaths.publisherPrivateKey, 'utf8'),
  ]);
  const packageResult = await createExtensionPackage({
    extensionDirectory,
    privateKey,
    publisherId: 'com.demo.simple.crm.publisher',
    publisherName: 'Simple CRM Demo',
    keyId: 'release-2026',
    createdAt,
  });

  return { ...packageResult, extensionDirectory, manifest };
};
