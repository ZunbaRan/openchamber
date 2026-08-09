import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_KEYS,
  HYBRID_CRM_FIXTURE,
  createHybridCrmPackage,
  createHybridCrmPublisherKeys,
  startHybridCrmApi,
} from './lib/interactive-ui-hybrid-crm-fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledOpenCodePath = path.join(projectRoot, 'packages', 'electron', 'resources', 'opencode-cli', 'opencode');
const builtInManifestPath = path.join(projectRoot, 'packages', 'web', 'server', 'lib', 'interactive-ui', 'builtin', 'openchamber.extension.json');
const corpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'unified-acceptance-corpus.json');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-unified-functional');
const reportPath = path.join(outputDirectory, 'report.json');
const extensionId = HYBRID_CRM_FIXTURE.extensionId;
const connectorId = HYBRID_CRM_FIXTURE.connectorId;
const overviewViewId = HYBRID_CRM_FIXTURE.overviewViewId;
const workspaceViewId = HYBRID_CRM_FIXTURE.workspaceViewId;
const explorerArtifactId = HYBRID_CRM_FIXTURE.artifactId;
const queryActionId = HYBRID_CRM_FIXTURE.queryActionId;
const writeActionId = HYBRID_CRM_FIXTURE.writeActionId;
const crmToolNames = HYBRID_CRM_FIXTURE.baseToolNames;
const explorerToolName = HYBRID_CRM_FIXTURE.explorerToolName;
const acceptanceToolNames = [...crmToolNames, explorerToolName];
const crmSkillName = HYBRID_CRM_FIXTURE.skillName;
const builtInToolNames = ['interactive_ui', 'html_artifact'];
const builtInExtensionVersion = JSON.parse(await fs.readFile(builtInManifestPath, 'utf8')).version;
const forbiddenUpstreamMessages = [
  'Invalid or revoked API key',
  'Key lacks write scope',
  'Opportunity revision changed',
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const assertNoSecretMaterial = (value, label, secretValues) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secretValues) {
    assert.equal(serialized.includes(secret), false, `${label} exposed credential material`);
  }
  assert.equal(serialized.includes('BEGIN PUBLIC KEY'), false, `${label} exposed publisher key material`);
};

const readResponseBody = async (response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const createClient = (baseUrl, secretValues) => async (pathname, {
  method = 'GET',
  body,
  timeoutMs = 10_000,
} = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponseBody(response);
  assertNoSecretMaterial(payload, `${method} ${pathname}`, secretValues);
  return { status: response.status, payload };
};

const expectStatus = (result, status, label) => {
  assert.equal(result.status, status, `${label} returned ${result.status} (${result.payload?.code ?? 'no-code'})`);
  return result.payload;
};

const waitFor = async (operation, label, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}${lastError?.message ? `: ${lastError.message}` : ''}`);
};

const assertSafeGatewayError = (payload, { code, status, label }) => {
  assert.equal(payload?.code, code, `${label} returned an unexpected error code`);
  for (const message of forbiddenUpstreamMessages) {
    assert.equal(JSON.stringify(payload).includes(message), false, `${label} exposed upstream error text`);
  }
  if (status === 401) assert.equal(payload.error, 'Access key is invalid or expired');
  if (status === 403) assert.equal(payload.error, 'Access key does not have permission');
};

const findOpportunity = (dashboard, opportunityId) => {
  const opportunity = dashboard?.opportunities?.find((candidate) => candidate.id === opportunityId);
  assert(opportunity, `CRM dashboard did not include ${opportunityId}`);
  return opportunity;
};

for (const requiredPath of [
  bundledOpenCodePath,
  corpusPath,
]) {
  await fs.access(requiredPath);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-unified-functional-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const openCodeConfigDirectory = path.join(temporaryRoot, 'opencode-config');
const xdgConfigDirectory = path.join(temporaryRoot, 'xdg-config');
const xdgDataDirectory = path.join(temporaryRoot, 'xdg-data');
const xdgCacheDirectory = path.join(temporaryRoot, 'xdg-cache');
await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(openCodeConfigDirectory, { recursive: true });
await fs.mkdir(xdgConfigDirectory, { recursive: true });
await fs.mkdir(xdgDataDirectory, { recursive: true });
await fs.mkdir(xdgCacheDirectory, { recursive: true });
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

for (const key of [
  'OPENCODE_HOST',
  'OPENCODE_PORT',
  'OPENCODE_SKIP_START',
  'OPENCHAMBER_SKIP_OPENCODE_START',
  'OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR',
]) {
  delete process.env[key];
}
Object.assign(process.env, {
  OPENCHAMBER_DATA_DIR: dataDirectory,
  OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
  OPENCHAMBER_OPENCODE_CWD: projectRoot,
  OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
  OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'false',
  OPENCHAMBER_RUNTIME: 'web',
  OPENCODE_BINARY: bundledOpenCodePath,
  OPENCODE_CONFIG_DIR: openCodeConfigDirectory,
  OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE: 'true',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
  OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  XDG_CONFIG_HOME: xdgConfigDirectory,
  XDG_DATA_HOME: xdgDataDirectory,
  XDG_CACHE_HOME: xdgCacheDirectory,
});

let crmApi;
let openchamber;
let completed = false;
let failure;

try {
  const { startWebUiServer } = await import('../packages/web/server/index.js');
  crmApi = await startHybridCrmApi();
  const secretValues = Object.values(crmApi.keys);
  const publisherKeys = await createHybridCrmPublisherKeys();
  const [previousPackage, currentPackage, acceptancePackage] = await Promise.all([
    createHybridCrmPackage({
      temporaryRoot,
      crmApiUrl: crmApi.url,
      version: '1.1.1',
      includeArtifact: false,
      publisherKeys,
    }),
    createHybridCrmPackage({
      temporaryRoot,
      crmApiUrl: crmApi.url,
      version: '1.2.0',
      includeArtifact: false,
      publisherKeys,
    }),
    createHybridCrmPackage({
      temporaryRoot,
      crmApiUrl: crmApi.url,
      version: '1.3.0',
      includeArtifact: true,
      publisherKeys,
    }),
  ]);

  openchamber = await startWebUiServer({
    host: '127.0.0.1',
    port: 0,
    attachSignals: false,
    exitOnShutdown: false,
  });
  const baseUrl = `http://127.0.0.1:${openchamber.getPort()}`;
  const request = createClient(baseUrl, secretValues);

  const health = await waitFor(async () => {
    const result = await request('/health');
    return result.status === 200 && result.payload?.openCodeRunning === true ? result.payload : null;
  }, 'managed bundled OpenCode readiness');
  assert.equal(path.resolve(health.opencodeBinaryResolved), path.resolve(bundledOpenCodePath));

  const readAgentRuntime = async () => {
    const directory = encodeURIComponent(projectRoot);
    const [tools, skills] = await Promise.all([
      request(`/api/experimental/tool/ids?directory=${directory}`),
      request(`/api/config/skills?directory=${directory}`),
    ]);
    return {
      ready: tools.status === 200 && skills.status === 200,
      toolStatus: tools.status,
      skillStatus: skills.status,
      toolPayload: tools.payload,
      skillPayload: skills.payload,
      tools: Array.isArray(tools.payload) ? tools.payload : [],
      skills: Array.isArray(skills.payload?.skills) ? skills.payload.skills.map((skill) => skill?.name).filter(Boolean) : [],
    };
  };

  const waitForAgentRuntime = async (crmEnabled) => {
    let lastRuntime;
    try {
      return await waitFor(async () => {
        const runtime = await readAgentRuntime();
        lastRuntime = runtime;
        const builtInsPresent = builtInToolNames.every((tool) => runtime.tools.includes(tool));
        const crmToolsPresent = crmToolNames.every((tool) => runtime.tools.includes(tool));
        const crmSkillPresent = runtime.skills.includes(crmSkillName);
        return runtime.ready && builtInsPresent && crmToolsPresent === crmEnabled && crmSkillPresent === crmEnabled ? runtime : null;
      }, crmEnabled ? 'Simple CRM Agent Runtime discovery' : 'Simple CRM Agent Runtime removal');
    } catch (error) {
      const state = lastRuntime
        ? {
            toolStatus: lastRuntime.toolStatus,
            skillStatus: lastRuntime.skillStatus,
            toolError: Array.isArray(lastRuntime.toolPayload) ? null : lastRuntime.toolPayload,
            skillError: lastRuntime.skillStatus === 200 ? null : lastRuntime.skillPayload,
            toolCount: lastRuntime.tools.length,
            skillCount: lastRuntime.skills.length,
            builtInTools: builtInToolNames.map((tool) => lastRuntime.tools.includes(tool)),
            crmTools: crmToolNames.map((tool) => lastRuntime.tools.includes(tool)),
            builtInSkill: lastRuntime.skills.includes('interactive-ui-visualization'),
            crmSkill: lastRuntime.skills.includes(crmSkillName),
          }
        : { unavailable: true };
      throw new Error(`${error.message}; last state=${JSON.stringify(state)}`);
    }
  };

  const initialAgentRuntime = await waitForAgentRuntime(false);
  assert(initialAgentRuntime.skills.includes('interactive-ui-visualization'));
  const initialManager = expectStatus(await request('/api/interactive-ui/manager'), 200, 'initial manager');
  assert.deepEqual(initialManager.builtInRuntime, {
    id: 'com.openchamber.builtin.interactive-ui',
    version: builtInExtensionVersion,
    status: 'ready',
  });
  assert.equal(initialManager.extensions.length, 0);

  const packageBuffers = {
    previous: previousPackage.buffer,
    current: currentPackage.buffer,
  };
  const inspectPackage = async (buffer, expectedVersion, expectedTools = crmToolNames) => {
    const inspection = expectStatus(await request('/api/interactive-ui/manager/packages/inspect', {
      method: 'POST',
      body: { packageBase64: buffer.toString('base64') },
    }), 200, `inspect Simple CRM ${expectedVersion}`);
    assert.equal(inspection.extension.id, extensionId);
    assert.equal(inspection.extension.version, expectedVersion);
    assert.equal(typeof inspection.publisher.fingerprint, 'string');
    assert.deepEqual(inspection.agentRuntime.tools.map((tool) => tool.name).sort(), [...expectedTools].sort());
    assert(inspection.agentRuntime.skills.some((skill) => skill.name === crmSkillName));
    return inspection;
  };
  const installPackage = async (buffer, fingerprint) => expectStatus(await request('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64: buffer.toString('base64'),
      ...(fingerprint ? { confirmedPublisherFingerprint: fingerprint } : {}),
    },
    timeoutMs: 60_000,
  }), 201, 'install Simple CRM');

  const previousInspection = await inspectPackage(packageBuffers.previous, '1.1.1');
  const previousInstall = await installPackage(packageBuffers.previous, previousInspection.publisher.fingerprint);
  assert.equal(previousInstall.extension.activeVersion, '1.1.1');
  await waitForAgentRuntime(true);

  const currentInspection = await inspectPackage(packageBuffers.current, '1.2.0');
  assert.equal(currentInspection.publisher.trusted, true);
  const currentInstall = await installPackage(packageBuffers.current);
  assert.equal(currentInstall.extension.activeVersion, '1.2.0');
  await waitForAgentRuntime(true);

  const acceptanceInspection = await inspectPackage(acceptancePackage.buffer, '1.3.0', acceptanceToolNames);
  assert.equal(acceptanceInspection.publisher.trusted, true);
  assert.equal(acceptanceInspection.permissions.sandboxedArtifacts, true);
  assert.deepEqual(acceptanceInspection.agentRouting.artifacts.map((artifact) => artifact.id), [explorerArtifactId]);
  const acceptanceInstall = await installPackage(acceptancePackage.buffer);
  assert.equal(acceptanceInstall.extension.activeVersion, '1.3.0');
  await waitForAgentRuntime(true);
  await waitFor(async () => (await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool discovery');
  const installedAgentRuntime = await readAgentRuntime();

  const managerAfterUpgrade = expectStatus(await request('/api/interactive-ui/manager'), 200, 'manager after upgrade');
  const managedCrm = managerAfterUpgrade.extensions.find((extension) => extension.id === extensionId);
  assert(managedCrm);
  assert.equal(managedCrm.activeVersion, '1.3.0');
  assert.equal(managedCrm.enabled, true);

  const registry = expectStatus(await request('/api/interactive-ui/extensions'), 200, 'extension registry');
  const registeredCrm = registry.extensions.find((extension) => extension.id === extensionId);
  assert(registeredCrm);
  assert.equal(registeredCrm.version, '1.3.0');
  assert.deepEqual(registeredCrm.views.map((view) => view.runtime).sort(), ['declarative', 'native']);
  assert.deepEqual(registeredCrm.artifacts.map((artifact) => artifact.id), [explorerArtifactId]);

  const capabilitiesBeforeConnection = expectStatus(await request('/api/interactive-ui/capabilities'), 200, 'routing capabilities before connection');
  const crmCapabilityBeforeConnection = capabilitiesBeforeConnection.extensions.find((extension) => extension.id === extensionId);
  assert(crmCapabilityBeforeConnection);
  assert.equal(crmCapabilityBeforeConnection.connection.status, 'unconfigured');
  assert.deepEqual(crmCapabilityBeforeConnection.tools.map((tool) => tool.name).sort(), [...acceptanceToolNames].sort());
  assert.deepEqual(crmCapabilityBeforeConnection.tools.find((tool) => tool.name === explorerToolName)?.forms, ['html-artifact']);
  assert.equal(JSON.stringify(capabilitiesBeforeConnection).includes('127.0.0.1'), false);

  const overviewDescriptor = expectStatus(await request(`/api/interactive-ui/views/${overviewViewId}?tool=simple_crm_open_overview`), 200, 'CRM overview view');
  assert.equal(overviewDescriptor.view.runtime, 'declarative');
  assert.equal(overviewDescriptor.declarative.$schema, 'openchamber://declarative-view/v1');
  const workspaceDescriptor = expectStatus(await request(`/api/interactive-ui/views/${workspaceViewId}?tool=simple_crm_open_workspace`), 200, 'CRM workspace view');
  assert.equal(workspaceDescriptor.view.runtime, 'native');
  const nativeBundleResponse = await fetch(`${baseUrl}${workspaceDescriptor.native.assetPath}`, {
    headers: { Accept: 'text/javascript' },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(nativeBundleResponse.status, 200);
  const nativeBundle = await nativeBundleResponse.text();
  assert.match(nativeBundle, /com\.demo\.simple\.crm\.workspace/);
  assertNoSecretMaterial(nativeBundle, 'native bundle', secretValues);
  const explorerDescriptor = expectStatus(await request(`/api/interactive-ui/installed-artifacts/${explorerArtifactId}?tool=${explorerToolName}`), 200, 'CRM explorer Artifact');
  assert.equal(explorerDescriptor.artifact.id, explorerArtifactId);
  assert.equal(explorerDescriptor.artifact.business, true);
  const explorerDocumentResponse = await fetch(`${baseUrl}${explorerDescriptor.documentPath}`);
  assert.equal(explorerDocumentResponse.status, 200);
  const explorerDocument = await explorerDocumentResponse.text();
  assert.match(explorerDocument, /data-ocix-artifact-broker/);
  assert.match(explorerDocument, /host\.businessResult/);
  assertNoSecretMaterial(explorerDocument, 'installed Artifact document', secretValues);

  const overviewActionContext = {
    extensionId,
    viewId: overviewViewId,
    instanceId: 'unified-functional-overview',
    tool: { id: 'unified-functional-overview-tool', name: 'simple_crm_open_overview' },
  };
  const workspaceActionContext = {
    extensionId,
    viewId: workspaceViewId,
    instanceId: 'unified-functional-workspace',
    tool: { id: 'unified-functional-workspace-tool', name: 'simple_crm_open_workspace' },
  };
  const explorerActionContext = {
    extensionId,
    artifactId: explorerArtifactId,
    instanceId: 'unified-functional-explorer',
    tool: { id: 'unified-functional-explorer-tool', name: explorerToolName },
  };
  const queryDashboard = () => request(`/api/interactive-ui/actions/${queryActionId}`, {
    method: 'POST',
    body: { ...overviewActionContext, input: { scope: 'default' } },
  });
  const advanceOpportunity = (input, confirmationToken) => request(`/api/interactive-ui/actions/${writeActionId}`, {
    method: 'POST',
    body: { ...workspaceActionContext, input, ...(confirmationToken === undefined ? {} : { confirmationToken }) },
  });
  const queryDashboardFromArtifact = () => request(`/api/interactive-ui/actions/${queryActionId}`, {
    method: 'POST',
    body: { ...explorerActionContext, input: { scope: 'default' } },
  });
  const advanceOpportunityFromArtifact = (input, confirmationToken) => request(`/api/interactive-ui/actions/${writeActionId}`, {
    method: 'POST',
    body: { ...explorerActionContext, input, ...(confirmationToken === undefined ? {} : { confirmationToken }) },
  });

  const unconfiguredQuery = await queryDashboard();
  assert.equal(unconfiguredQuery.status, 503);
  assert.equal(unconfiguredQuery.payload.code, 'connector_unconfigured');

  const configureConnection = (accessKey) => request(`/api/interactive-ui/connections/${extensionId}/${connectorId}`, {
    method: 'PUT',
    body: { accessKey },
  });
  expectStatus(await configureConnection(DEMO_KEYS.full), 200, 'configure full CRM key');
  expectStatus(await request(`/api/interactive-ui/connections/${extensionId}/${connectorId}/test`, {
    method: 'POST',
  }), 200, 'test full CRM key');
  const configuredConnections = expectStatus(await request('/api/interactive-ui/connections'), 200, 'configured connections');
  const configuredCrm = configuredConnections.connections.find((connection) => connection.extension.id === extensionId);
  assert.equal(configuredCrm.credential.configured, true);

  const initialDashboard = expectStatus(await queryDashboard(), 200, 'query live CRM data').data;
  assert.equal(initialDashboard.customerCount, 4);
  assert.equal(initialDashboard.openOpportunityCount, 4);
  assert.equal(initialDashboard.customers.length, 4);
  assert.equal(initialDashboard.opportunities.length, 4);
  assert(initialDashboard.pipelineValue > 0);
  const artifactDashboard = expectStatus(await queryDashboardFromArtifact(), 200, 'query live CRM data from installed Artifact').data;
  assert.equal(artifactDashboard.customerCount, 4);
  const initialOpportunity = findOpportunity(initialDashboard, 'OP-2001');
  assert.equal(initialOpportunity.stage, 'proposal');
  assert.equal(initialOpportunity.revision, 4);

  const confirmation = await advanceOpportunity({ opportunityId: 'OP-2001', revision: 4 });
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.payload.code, 'confirmation_required');
  assert.equal(confirmation.payload.confirmationRequired, true);
  assert.match(confirmation.payload.confirmationToken, /^oc_confirmation_/);
  const afterCancel = expectStatus(await queryDashboard(), 200, 'query after cancelled write').data;
  assert.deepEqual(
    { stage: findOpportunity(afterCancel, 'OP-2001').stage, revision: findOpportunity(afterCancel, 'OP-2001').revision },
    { stage: 'proposal', revision: 4 },
  );

  const advanced = expectStatus(await advanceOpportunity(
    { opportunityId: 'OP-2001', revision: 4 },
    confirmation.payload.confirmationToken,
  ), 200, 'confirmed CRM write').data.opportunity;
  assert.equal(advanced.stage, 'negotiation');
  assert.equal(advanced.revision, 5);
  const afterWrite = expectStatus(await queryDashboard(), 200, 'query after confirmed write').data;
  assert.deepEqual(
    { stage: findOpportunity(afterWrite, 'OP-2001').stage, revision: findOpportunity(afterWrite, 'OP-2001').revision },
    { stage: 'negotiation', revision: 5 },
  );

  const artifactConfirmation = await advanceOpportunityFromArtifact({ opportunityId: 'OP-2004', revision: 1 });
  assert.equal(artifactConfirmation.status, 409);
  assert.equal(artifactConfirmation.payload.code, 'confirmation_required');
  assert.match(artifactConfirmation.payload.confirmationToken, /^oc_confirmation_/);
  const artifactAdvanced = expectStatus(
    await advanceOpportunityFromArtifact(
      { opportunityId: 'OP-2004', revision: 1 },
      artifactConfirmation.payload.confirmationToken,
    ),
    200,
    'confirmed CRM write from installed Artifact',
  ).data.opportunity;
  assert.equal(artifactAdvanced.revision, 2);

  expectStatus(await configureConnection(DEMO_KEYS.readonly), 200, 'configure readonly CRM key');
  expectStatus(await request(`/api/interactive-ui/connections/${extensionId}/${connectorId}/test`, {
    method: 'POST',
  }), 200, 'test readonly CRM key');
  const forbiddenConfirmation = await advanceOpportunity({ opportunityId: 'OP-2002', revision: 2 });
  assert.equal(forbiddenConfirmation.status, 409);
  assert.match(forbiddenConfirmation.payload.confirmationToken, /^oc_confirmation_/);
  const forbiddenWrite = await advanceOpportunity(
    { opportunityId: 'OP-2002', revision: 2 },
    forbiddenConfirmation.payload.confirmationToken,
  );
  assert.equal(forbiddenWrite.status, 403);
  assertSafeGatewayError(forbiddenWrite.payload, { code: 'connector_forbidden', status: 403, label: 'readonly write' });
  const afterForbidden = expectStatus(await queryDashboard(), 200, 'query after forbidden write').data;
  assert.deepEqual(
    { stage: findOpportunity(afterForbidden, 'OP-2002').stage, revision: findOpportunity(afterForbidden, 'OP-2002').revision },
    { stage: 'qualified', revision: 2 },
  );

  expectStatus(await configureConnection(DEMO_KEYS.full), 200, 'restore full CRM key');
  const conflictConfirmation = await advanceOpportunity({ opportunityId: 'OP-2001', revision: 4 });
  assert.equal(conflictConfirmation.status, 409);
  assert.match(conflictConfirmation.payload.confirmationToken, /^oc_confirmation_/);
  const revisionConflict = await advanceOpportunity(
    { opportunityId: 'OP-2001', revision: 4 },
    conflictConfirmation.payload.confirmationToken,
  );
  assert.equal(revisionConflict.status, 409);
  assertSafeGatewayError(revisionConflict.payload, { code: 'upstream_error', status: 409, label: 'revision conflict' });
  assert.equal(revisionConflict.payload.error, 'Business system rejected the request (409)');
  const afterConflict = expectStatus(await queryDashboard(), 200, 'query after revision conflict').data;
  assert.deepEqual(
    { stage: findOpportunity(afterConflict, 'OP-2001').stage, revision: findOpportunity(afterConflict, 'OP-2001').revision },
    { stage: 'negotiation', revision: 5 },
  );

  expectStatus(await configureConnection(DEMO_KEYS.revoked), 200, 'configure revoked CRM key');
  const unauthorizedQuery = await queryDashboard();
  assert.equal(unauthorizedQuery.status, 401);
  assertSafeGatewayError(unauthorizedQuery.payload, { code: 'connector_unauthorized', status: 401, label: 'revoked key query' });
  expectStatus(await configureConnection(DEMO_KEYS.full), 200, 'restore working CRM key');

  const disabled = expectStatus(await request(`/api/interactive-ui/manager/extensions/${extensionId}`, {
    method: 'PATCH',
    body: { enabled: false },
    timeoutMs: 60_000,
  }), 200, 'disable CRM extension');
  assert.equal(disabled.enabled, false);
  await waitForAgentRuntime(false);
  await waitFor(async () => !(await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool removal');
  const disabledCapabilities = expectStatus(await request('/api/interactive-ui/capabilities'), 200, 'capabilities after disable');
  assert.equal(disabledCapabilities.extensions.some((extension) => extension.id === extensionId), false);
  const disabledView = await request(`/api/interactive-ui/views/${overviewViewId}?tool=simple_crm_open_overview`);
  assert.equal(disabledView.status, 404);
  assert.equal(disabledView.payload.code, 'view_not_found');
  const disabledArtifact = await request(`/api/interactive-ui/installed-artifacts/${explorerArtifactId}?tool=${explorerToolName}`);
  assert.equal(disabledArtifact.status, 404);
  assert.equal(disabledArtifact.payload.code, 'artifact_not_found');

  const enabled = expectStatus(await request(`/api/interactive-ui/manager/extensions/${extensionId}`, {
    method: 'PATCH',
    body: { enabled: true },
    timeoutMs: 60_000,
  }), 200, 'enable CRM extension');
  assert.equal(enabled.enabled, true);
  await waitForAgentRuntime(true);
  await waitFor(async () => (await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool restoration');
  const afterEnable = expectStatus(await queryDashboard(), 200, 'query after re-enable').data;
  assert.equal(afterEnable.customerCount, 4);

  const rolledBack = expectStatus(await request(`/api/interactive-ui/manager/extensions/${extensionId}/rollback`, {
    method: 'POST',
    timeoutMs: 60_000,
  }), 200, 'rollback CRM extension');
  assert.equal(rolledBack.activeVersion, '1.2.0');
  await waitForAgentRuntime(true);
  await waitFor(async () => !(await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool removal after rollback');
  const registryAfterRollback = expectStatus(await request('/api/interactive-ui/extensions'), 200, 'registry after rollback');
  assert.equal(registryAfterRollback.extensions.find((extension) => extension.id === extensionId)?.version, '1.2.0');
  assert.equal(registryAfterRollback.extensions.find((extension) => extension.id === extensionId)?.artifacts.length, 0);
  const capabilitiesAfterRollback = expectStatus(await request('/api/interactive-ui/capabilities'), 200, 'capabilities after rollback');
  assert.equal(capabilitiesAfterRollback.extensions.some((extension) => extension.id === extensionId), true);
  const rolledBackArtifact = await request(`/api/interactive-ui/installed-artifacts/${explorerArtifactId}?tool=${explorerToolName}`);
  assert.equal(rolledBackArtifact.status, 404);
  assert.equal(rolledBackArtifact.payload.code, 'artifact_not_found');
  const restoredAcceptance = expectStatus(await request(`/api/interactive-ui/manager/extensions/${extensionId}/rollback`, {
    method: 'POST',
    timeoutMs: 60_000,
  }), 200, 'restore dynamic-port CRM acceptance version');
  assert.equal(restoredAcceptance.activeVersion, '1.3.0');
  await waitForAgentRuntime(true);
  await waitFor(async () => (await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool return after version restore');
  const afterRollback = expectStatus(await queryDashboard(), 200, 'query after rollback').data;
  assert.equal(afterRollback.customerCount, 4);

  await crmApi.close();
  crmApi = null;
  const unavailableQuery = await queryDashboard();
  assert.equal(unavailableQuery.status, 502);
  assert.equal(unavailableQuery.payload.code, 'upstream_unavailable');

  const uninstalled = expectStatus(await request(`/api/interactive-ui/manager/extensions/${extensionId}`, {
    method: 'DELETE',
    timeoutMs: 60_000,
  }), 200, 'uninstall CRM extension');
  assert.equal(uninstalled.removed, true);
  assert.equal(uninstalled.credentials.removed, 1);
  await waitForAgentRuntime(false);
  await waitFor(async () => !(await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool removal after uninstall');
  const managerAfterUninstall = expectStatus(await request('/api/interactive-ui/manager'), 200, 'manager after uninstall');
  assert.equal(managerAfterUninstall.extensions.some((extension) => extension.id === extensionId), false);
  const connectionsAfterUninstall = expectStatus(await request('/api/interactive-ui/connections'), 200, 'connections after uninstall');
  assert.equal(connectionsAfterUninstall.connections.some((connection) => connection.extension.id === extensionId), false);

  const reinstalled = await installPackage(acceptancePackage.buffer);
  assert.equal(reinstalled.extension.activeVersion, '1.3.0');
  await waitForAgentRuntime(true);
  await waitFor(async () => (await readAgentRuntime()).tools.includes(explorerToolName), 'Simple CRM Explorer Tool reinstall');
  const finalAgentRuntime = await readAgentRuntime();
  const finalConnections = expectStatus(await request('/api/interactive-ui/connections'), 200, 'connections after reinstall');
  const finalCrmConnection = finalConnections.connections.find((connection) => connection.extension.id === extensionId);
  assert(finalCrmConnection);
  assert.equal(finalCrmConnection.credential.configured, false);
  const queryAfterReinstall = await queryDashboard();
  assert.equal(queryAfterReinstall.status, 503);
  assert.equal(queryAfterReinstall.payload.code, 'connector_unconfigured');

  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  assert.equal(corpus.$schema, 'openchamber://interactive-ui-unified-acceptance-corpus/v1');
  assert.equal(corpus.cases.length, 17);
  const corpusCounts = Object.fromEntries(['generated', 'business', 'artifact', 'negative'].map((category) => [
    category,
    corpus.cases.filter((testCase) => testCase.category === category).length,
  ]));
  assert.deepEqual(corpusCounts, { generated: 6, business: 5, artifact: 3, negative: 3 });
  assert.equal(corpus.cases.filter((testCase) => testCase.category === 'business' || testCase.id === 'negative-artifact-crm-direct')
    .every((testCase) => acceptanceToolNames.includes(testCase.expectedTool)), true);

  const report = {
    ok: true,
    runtime: 'full-server',
    isolation: {
      openChamberData: true,
      openCodeConfig: true,
      demoExtensionInjection: false,
    },
    openCode: {
      bundledExecutable: true,
      builtInTools: builtInToolNames,
      builtInSkill: 'interactive-ui-visualization',
      installedTools: acceptanceToolNames,
      installedSkill: crmSkillName,
      restartReconciliation: 'passed',
    },
    views: {
      declarative: 'ready',
      native: 'ready',
      nativeBundle: 'ready',
      htmlArtifact: 'ready',
    },
    businessGateway: {
      customers: initialDashboard.customerCount,
      opportunities: initialDashboard.opportunities.length,
      pipelineValue: initialDashboard.pipelineValue,
      confirmation: 'required',
      cancellationPreservedData: true,
      confirmedWrite: 'passed',
      writeRefresh: 'passed',
      artifactQuery: 'passed',
      artifactConfirmedWrite: 'passed',
      unauthorized: 'mapped-and-redacted',
      forbidden: 'mapped-and-redacted',
      revisionConflict: 'mapped-and-redacted',
      unreachable: 'mapped',
    },
    lifecycle: [
      'install-1.1.1',
      'upgrade-1.2.0',
      'install-ephemeral-1.3.0-dynamic-connector',
      'disable',
      'enable',
      'rollback-1.2.0',
      'restore-1.3.0',
      'uninstall-with-credential-cleanup',
      'reinstall-1.3.0-unconfigured',
    ],
    corpus: {
      total: corpus.cases.length,
      counts: corpusCounts,
      execution: 'reserved-for-cross-model-C3',
    },
    redaction: 'passed',
    agentRuntimeCounts: {
      afterInstallTools: installedAgentRuntime.tools.length,
      afterReinstallTools: finalAgentRuntime.tools.length,
    },
  };
  assertNoSecretMaterial(report, 'acceptance report', secretValues);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  completed = true;
} catch (error) {
  failure = error;
} finally {
  if (openchamber) await openchamber.stop().catch(() => undefined);
  if (crmApi) await crmApi.close().catch(() => undefined);
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => undefined);
  if (!completed) await fs.rm(reportPath, { force: true }).catch(() => undefined);
}

if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);
