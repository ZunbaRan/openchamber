import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startMockBusinessServer } from '../examples/interactive-ui/mock-business-server.mjs';
import {
  learningRateSimulatorArtifact,
  staticNeuralNetworkArtifact,
  topologyExplorerArtifact,
} from '../examples/interactive-ui/artifact-fixtures.mjs';
import { createInteractiveUIRuntime } from '../packages/web/server/lib/interactive-ui/runtime.js';
import { registerInteractiveUIRoutes } from '../packages/web/server/lib/interactive-ui/routes.js';
import { createInteractiveUIExtensionManager } from '../packages/web/server/lib/interactive-ui/manager.js';
import { createHTMLArtifactStore } from '../packages/web/server/lib/interactive-ui/artifact-store.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(projectRoot, 'examples', 'interactive-ui');
const token = 'demo-secret';

const listen = (app) => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
  server.once('error', reject);
});

const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const readJson = async (response) => {
  const payload = await response.json();
  return { response, payload };
};

const decodeBrokerArtifact = (brokerHtml) => {
  assert.match(brokerHtml, /data-ocix-artifact-broker/);
  const encoded = brokerHtml.match(/data:text\/html;base64,([A-Za-z0-9+/=]+)/)?.[1];
  assert(encoded, 'scripts artifact broker must embed a base64 data document');
  return Buffer.from(encoded, 'base64').toString('utf8');
};

const mock = await startMockBusinessServer({ token });
const managerDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-ocix-system-'));
let gatewayServer;

try {
  const app = express();
  const runtime = createInteractiveUIRuntime({
    fsPromises: fs,
    path,
    crypto,
    extensionRoots: [extensionRoot],
    environment: {
      OCIX_DEMO_API_URL: mock.url,
      OCIX_DEMO_TOKEN: token,
    },
    logger: { info() {}, warn() {} },
  });
  const manager = createInteractiveUIExtensionManager({ dataDirectory: managerDataDirectory });
  const artifactStore = createHTMLArtifactStore({
    dataDirectory: managerDataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    environment: { OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true' },
  });
  registerInteractiveUIRoutes(app, { express, runtime, manager, artifactStore });
  gatewayServer = await listen(app);
  const address = gatewayServer.address();
  assert(address && typeof address !== 'string');
  const gateway = `http://127.0.0.1:${address.port}`;

  const managerSnapshot = await readJson(await fetch(`${gateway}/api/interactive-ui/manager`));
  assert.equal(managerSnapshot.response.status, 200);
  assert.deepEqual(managerSnapshot.payload.extensions, []);
  assert.deepEqual(managerSnapshot.payload.publishers, []);

  const registry = await readJson(await fetch(`${gateway}/api/interactive-ui/extensions`));
  assert.equal(registry.response.status, 200);
  assert.equal(registry.payload.extensions.length, 3);
  const salesExtension = registry.payload.extensions.find((extension) => extension.id === 'com.openchamber.demo.sales');
  const crmExtension = registry.payload.extensions.find((extension) => extension.id === 'com.openchamber.demo.crm');
  const visualizationExtension = registry.payload.extensions.find((extension) => extension.id === 'com.openchamber.builtin.interactive-ui');
  assert.equal(salesExtension.views.length, 2);
  assert.equal(crmExtension.views.length, 1);
  assert.equal(visualizationExtension.views.length, 2);
  assert.equal(JSON.stringify(registry.payload).includes(token), false, 'connector token must never reach the client registry');
  assert.equal(JSON.stringify(registry.payload).includes(mock.url), false, 'connector base URL must remain server-side');

  const connections = await readJson(await fetch(`${gateway}/api/interactive-ui/connections`));
  assert.equal(connections.response.status, 200);
  assert.equal(connections.payload.connections.length, 2);
  assert.equal(connections.payload.connections.every((connection) => connection.connector.authType === 'env-bearer'), true);
  assert.equal(connections.payload.connections.every((connection) => connection.credential.configured === true), true);
  assert.equal(JSON.stringify(connections.payload).includes(token), false, 'connection management must expose status only');

  const capabilities = await readJson(await fetch(`${gateway}/api/interactive-ui/capabilities`));
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.payload.extensions.length, 3);
  assert.match(capabilities.payload.revision, /^sha256-/);
  assert.equal(capabilities.payload.extensions.find((extension) => extension.id === 'com.openchamber.demo.crm')
    .tools.some((tool) => tool.name === 'crm_open_dashboard' && tool.priority === 90), true);
  assert.match(capabilities.payload.system, /matching installed business tool/);
  assert.equal(capabilities.payload.system.includes(token), false, 'routing prompt must not contain connector tokens');
  assert.equal(capabilities.payload.system.includes(mock.url), false, 'routing prompt must not contain connector URLs');
  assert.equal(capabilities.payload.system.includes('打开 CRM 工作台'), false, 'developer examples must not enter the routing prompt');
  assert.match(capabilities.payload.system, /html_artifact/);

  const artifactCapabilities = await readJson(await fetch(`${gateway}/api/interactive-ui/artifacts/capabilities`));
  assert.deepEqual(artifactCapabilities.payload, {
    schemaVersion: 1,
    static: true,
    scripts: true,
    scriptsMode: 'experimental',
    cspRevision: 3,
    runtimeSupport: {
      web: { static: 'supported', scripts: 'experimental' },
      managedDesktop: { static: 'supported', scripts: 'supported' },
      hostedMobile: { static: 'supported', scripts: 'unsupported' },
      capacitorMobile: { static: 'supported', scripts: 'unsupported' },
      vscode: { static: 'unsupported', scripts: 'unsupported' },
      e2eeRelay: { static: 'unsupported', scripts: 'unsupported' },
    },
  });

  const staticArtifactEnvelope = staticNeuralNetworkArtifact;
  const staticArtifact = await readJson(await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staticArtifactEnvelope),
  }));
  assert.equal(staticArtifact.response.status, 201);
  assert.match(staticArtifact.payload.artifactId, /^[a-f0-9]{64}$/);
  const staticDocument = await fetch(`${gateway}${staticArtifact.payload.documentPath}`);
  assert.equal(staticDocument.status, 200);
  assert.match(staticDocument.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.equal(staticDocument.headers.get('content-security-policy').includes('script-src'), false);
  assert.match(await staticDocument.text(), /三层神经网络结构/);

  const interactiveArtifact = await readJson(await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(learningRateSimulatorArtifact),
  }));
  assert.equal(interactiveArtifact.response.status, 201);
  const interactiveDocument = await fetch(`${gateway}${interactiveArtifact.payload.documentPath}`);
  assert.match(interactiveDocument.headers.get('content-security-policy'), /script-src 'unsafe-inline'/);
  assert.match(interactiveDocument.headers.get('content-security-policy'), /frame-src data:/);
  assert.match(interactiveDocument.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.equal(interactiveDocument.headers.get('content-security-policy').includes('unsafe-eval'), false);
  const interactiveDocumentHtml = decodeBrokerArtifact(await interactiveDocument.text());
  assert.match(interactiveDocumentHtml, /Math\.exp/);
  assert.match(interactiveDocumentHtml, /curve\.setAttribute\('d'/);
  assert.match(interactiveDocumentHtml, /openchamberArtifact/);

  const topologyArtifact = await readJson(await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(topologyExplorerArtifact),
  }));
  assert.equal(topologyArtifact.response.status, 201);
  const topologyDocument = await fetch(`${gateway}${topologyArtifact.payload.documentPath}`);
  assert.equal(topologyDocument.status, 200);
  const topologyDocumentHtml = decodeBrokerArtifact(await topologyDocument.text());
  assert.match(topologyDocumentHtml, /data-filter="api"/);

  const artifactCacheHit = await readJson(await fetch(`${gateway}/api/interactive-ui/artifacts/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staticArtifactEnvelope),
  }));
  assert.equal(artifactCacheHit.response.status, 200);
  assert.equal(artifactCacheHit.payload.artifactId, staticArtifact.payload.artifactId);
  assert.equal(artifactCacheHit.payload.cacheHit, true);

  const processFlow = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.builtin.interactive-ui.process-flow?tool=interactive_ui`));
  assert.equal(processFlow.response.status, 200);
  assert.equal(processFlow.payload.view.runtime, 'declarative');
  assert.equal(processFlow.payload.declarative.layout.children[1].type, 'flow');

  const generated = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.builtin.interactive-ui.generated?tool=interactive_ui`));
  assert.equal(generated.response.status, 200);
  assert.equal(generated.payload.view.runtime, 'declarative');
  assert.equal(generated.payload.declarative.layout.type, 'generated-layout');

  const declarative = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.demo.sales.summary?tool=sales_get_summary`));
  assert.equal(declarative.response.status, 200);
  assert.equal(declarative.payload.view.runtime, 'declarative');
  assert.equal(declarative.payload.declarative.$schema, 'openchamber://declarative-view/v1');

  const mismatchedTool = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.demo.sales.summary?tool=wrong_tool`));
  assert.equal(mismatchedTool.response.status, 403);
  assert.equal(mismatchedTool.payload.code, 'tool_view_mismatch');

  const native = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.demo.sales.dashboard?tool=sales_get_dashboard`));
  assert.equal(native.response.status, 200);
  assert.equal(native.payload.view.runtime, 'native');
  assert.match(native.payload.native.integrity, /^sha256-/);
  const nativeBundle = await fetch(`${gateway}${native.payload.native.assetPath}`);
  assert.equal(nativeBundle.status, 200);
  assert.match(await nativeBundle.text(), /com\.openchamber\.demo\.sales\.dashboard/);

  const crm = await readJson(await fetch(`${gateway}/api/interactive-ui/views/com.openchamber.demo.crm.dashboard?tool=crm_open_dashboard`));
  assert.equal(crm.response.status, 200);
  assert.equal(crm.payload.view.runtime, 'native');
  const crmBundle = await fetch(`${gateway}${crm.payload.native.assetPath}`);
  assert.equal(crmBundle.status, 200);
  assert.match(await crmBundle.text(), /com\.openchamber\.demo\.crm\.dashboard/);

  const actionContext = {
    extensionId: 'com.openchamber.demo.sales',
    viewId: 'com.openchamber.demo.sales.dashboard',
    instanceId: 'system-test-view',
    tool: { id: 'tool-system-test', name: 'sales_get_dashboard' },
  };
  const query = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/sales.dashboard.query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actionContext, input: { region: 'east', period: '2026-07' } }),
  }));
  assert.equal(query.response.status, 200);
  assert.equal(query.payload.data.revenue, 1820000);
  assert.equal(query.payload.data.anomalies[0].status, 'pending');

  const approvalInput = {
    orderId: query.payload.data.anomalies[0].id,
    revision: query.payload.data.anomalies[0].revision,
  };
  const confirmation = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/sales.order.approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actionContext, input: approvalInput }),
  }));
  assert.equal(confirmation.response.status, 409);
  assert.equal(confirmation.payload.confirmationRequired, true);
  assert.match(confirmation.payload.confirmationToken, /^oc_confirmation_/);

  const approval = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/sales.order.approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actionContext, input: approvalInput, confirmationToken: confirmation.payload.confirmationToken }),
  }));
  assert.equal(approval.response.status, 200);
  assert.equal(approval.payload.data.order.status, 'approved');
  assert.equal(approval.payload.data.order.revision, approvalInput.revision + 1);

  const refreshed = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/sales.dashboard.query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...actionContext, input: { region: 'east', period: '2026-07' } }),
  }));
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.payload.data.anomalies[0].status, 'approved');

  const crmActionContext = {
    extensionId: 'com.openchamber.demo.crm',
    viewId: 'com.openchamber.demo.crm.dashboard',
    instanceId: 'system-test-crm-view',
    tool: { id: 'tool-system-test-crm', name: 'crm_open_dashboard' },
  };
  const crmQuery = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/crm.dashboard.query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...crmActionContext, input: { focus: 'overview' } }),
  }));
  assert.equal(crmQuery.response.status, 200);
  assert.equal(crmQuery.payload.data.customerCount, 3);
  assert.equal(crmQuery.payload.data.opportunities.length, 3);

  const firstOpportunity = crmQuery.payload.data.opportunities[0];
  const crmConfirmation = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/crm.opportunity.advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...crmActionContext,
      input: { opportunityId: firstOpportunity.id, revision: firstOpportunity.revision },
    }),
  }));
  assert.equal(crmConfirmation.response.status, 409);
  assert.equal(crmConfirmation.payload.confirmationRequired, true);
  assert.match(crmConfirmation.payload.confirmationToken, /^oc_confirmation_/);

  const crmAdvance = await readJson(await fetch(`${gateway}/api/interactive-ui/actions/crm.opportunity.advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...crmActionContext,
      input: { opportunityId: firstOpportunity.id, revision: firstOpportunity.revision },
      confirmationToken: crmConfirmation.payload.confirmationToken,
    }),
  }));
  assert.equal(crmAdvance.response.status, 200);
  assert.equal(crmAdvance.payload.data.opportunity.stage, 'negotiation');
  assert.equal(crmAdvance.payload.data.opportunity.revision, firstOpportunity.revision + 1);

  const envelope = {
    $schema: 'openchamber://interactive-result/v1',
    view: 'com.openchamber.demo.sales.dashboard',
    schemaVersion: 1,
    mode: 'live',
    summary: '华东区 2026 年 7 月销售额 182 万元',
    context: { region: 'east', period: '2026-07' },
    data: refreshed.payload.data,
    dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'system-test' },
    updatedAt: refreshed.payload.data.updatedAt,
  };

  console.log(JSON.stringify({
    ok: true,
    extensions: registry.payload.extensions.map((extension) => extension.id),
    runtimes: registry.payload.extensions.flatMap((extension) => extension.views.map((view) => view.runtime)),
    routingRevision: capabilities.payload.revision,
    gateway,
    mockBusinessSystem: mock.url,
    approvedOrder: approval.payload.data.order,
    advancedOpportunity: crmAdvance.payload.data.opportunity,
    artifacts: {
      static: staticArtifact.payload.artifactId,
      interactive: interactiveArtifact.payload.artifactId,
      topology: topologyArtifact.payload.artifactId,
    },
    envelope,
  }, null, 2));
} finally {
  if (gatewayServer) await close(gatewayServer);
  await mock.close();
  await fs.rm(managerDataDirectory, { recursive: true, force: true });
}
