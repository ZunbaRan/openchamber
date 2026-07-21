import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.dirname(projectRoot);
const corpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'unified-acceptance-corpus.json');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-model-routing');
const reportPath = path.join(outputDirectory, 'report.json');
const baseUrl = (process.env.OPENCHAMBER_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:47832').replace(/\/$/, '');
const requestTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_REQUEST_TIMEOUT_MS || 30_000);
const caseTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_CASE_TIMEOUT_MS || 180_000);
const nonArtifactCaseTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_NON_ARTIFACT_CASE_TIMEOUT_MS || 90_000);
const maxCaseAttempts = Number(process.env.OPENCHAMBER_ACCEPTANCE_CASE_ATTEMPTS || 2);
const crmPackagePath = process.env.OPENCHAMBER_ACCEPTANCE_CRM_PACKAGE
  ? path.resolve(process.env.OPENCHAMBER_ACCEPTANCE_CRM_PACKAGE)
  : path.join(workspaceRoot, 'extension', 'dist', 'com.demo.simple.crm-1.2.0.ocix');
const requestedCaseIds = new Set((process.env.OPENCHAMBER_ACCEPTANCE_CASE_IDS || '').split(',').map((value) => value.trim()).filter(Boolean));
const relevantTools = new Set(['interactive_ui', 'html_artifact', 'simple_crm_open_overview', 'simple_crm_open_workspace']);
const requiredBusinessTools = ['simple_crm_open_overview', 'simple_crm_open_workspace'];
const crmExtensionId = 'com.demo.simple.crm';
const disabledFixtureTools = ['crm_open_dashboard', 'sales_get_summary', 'sales_get_dashboard'];

const defaultModels = [
  { providerID: 'openai', modelID: 'gpt-5.4', family: 'openai', required: true },
  { providerID: 'alibaba-coding-plan-cn', modelID: 'qwen3.7-plus', family: 'non-openai', required: true },
  { providerID: 'opencode', modelID: 'big-pickle', family: 'non-openai', required: true },
];

const configuredModels = (process.env.OPENCHAMBER_ACCEPTANCE_MODELS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    const slash = value.indexOf('/');
    assert(slash > 0 && slash < value.length - 1, `Invalid model selector ${value}`);
    const providerID = value.slice(0, slash);
    const modelID = value.slice(slash + 1);
    return { providerID, modelID, family: providerID === 'openai' ? 'openai' : 'non-openai', required: true };
  });
const modelPlan = configuredModels.length > 0 ? configuredModels : defaultModels;

const redact = (value) => String(value ?? '')
  .replace(/(authorization|access[_ -]?key|api[_ -]?key|token|secret)(\s*[:=]\s*)[^\s,;}]+/gi, '$1$2[REDACTED]')
  .replace(/Bearer\s+[^\s,;}]+/gi, 'Bearer [REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
  .replace(/([?&](?:token|key|code|secret)=[^&#\s]*)/gi, '[REDACTED_QUERY]');

const request = async (pathname, init = {}) => {
  const { timeoutMs = requestTimeoutMs, ...fetchInit } = init;
  const method = fetchInit.method || 'GET';
  const retryable = method === 'GET' || (method === 'POST' && pathname.startsWith('/api/session?'));
  const attempts = retryable ? 3 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...fetchInit,
        headers: {
          Accept: 'application/json',
          ...(fetchInit.body ? { 'Content-Type': 'application/json' } : {}),
          ...(fetchInit.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (retryable && [502, 503, 504].includes(response.status) && attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          continue;
        }
        throw new Error(`${method} ${pathname} failed (${response.status})`);
      }
      const text = await response.text();
      return text.trim() ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
};

const waitForOpenCodeReady = async (timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const tools = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`, {
        timeoutMs: 10_000,
      });
      if (Array.isArray(tools) && tools.includes('interactive_ui') && tools.includes('html_artifact')) return tools;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`OpenCode did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
};

const waitForBusinessTools = async (expected, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tools = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`);
      const present = requiredBusinessTools.every((tool) => Array.isArray(tools) && tools.includes(tool));
      if (present === expected) return tools;
    } catch {
      // A managed OpenCode restart is expected after install/uninstall. A 503
      // is not evidence that tools are absent; only a successful inventory is.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Simple CRM Agent Runtime did not become ${expected ? 'available' : 'unavailable'} within ${timeoutMs}ms`);
};

const ensureBusinessTools = async () => {
  const initialTools = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`);
  if (requiredBusinessTools.every((tool) => Array.isArray(initialTools) && initialTools.includes(tool))) {
    return { mode: 'existing', installedByTest: false };
  }

  const manager = await request('/api/interactive-ui/manager');
  if (manager?.extensions?.some((extension) => extension?.id === crmExtensionId)) {
    throw new Error('Simple CRM is installed but its Agent Runtime is unavailable; the routing test will not mutate an existing installation');
  }

  const packageBuffer = await fs.readFile(crmPackagePath);
  const packageBase64 = packageBuffer.toString('base64');
  const inspection = await request('/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: JSON.stringify({ packageBase64 }),
    timeoutMs: 60_000,
  });
  assert.equal(inspection?.extension?.id, crmExtensionId, 'Acceptance OCIX has an unexpected extension id');
  assert.equal(typeof inspection?.publisher?.fingerprint, 'string', 'Acceptance OCIX has no publisher fingerprint');
  await request('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: JSON.stringify({
      packageBase64,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    }),
    timeoutMs: 60_000,
  });
  await waitForBusinessTools(true);
  return { mode: 'temporary-ocix', installedByTest: true, packageVersion: inspection.extension.version };
};

const modelKey = ({ providerID, modelID }) => `${providerID}/${modelID}`;

const archiveSession = async (sessionId) => {
  try {
    await request(`/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'PATCH',
      body: JSON.stringify({ time: { archived: Date.now() } }),
    });
  } catch {
    // The test result remains valid if a best-effort archive fails.
  }
};

const waitForCompletion = async (sessionId, timeoutMs = caseTimeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let idleTerminalObservations = 0;
  while (Date.now() < deadline) {
    const [messages, statuses] = await Promise.all([
      request(`/api/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(projectRoot)}`),
      request(`/api/session/status?directory=${encodeURIComponent(projectRoot)}`).catch(() => ({})),
    ]);
    const assistantMessages = (Array.isArray(messages) ? messages : []).filter((message) => message?.info?.role === 'assistant');
    const latest = assistantMessages.at(-1);
    const finish = latest?.info?.finish;
    const status = statuses?.[sessionId]?.type ?? 'idle';
    const terminal = ['stop', 'error', 'cancelled'].includes(finish)
      || (finish === 'tool-calls' && assistantMessages.flatMap((message) => message.parts ?? [])
        .filter((part) => part?.type === 'tool')
        .every((part) => ['completed', 'error'].includes(part?.state?.status)));
    if (terminal && status === 'idle') idleTerminalObservations += 1;
    else idleTerminalObservations = 0;
    if (idleTerminalObservations >= 2) return assistantMessages;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Session ${sessionId} did not complete within ${timeoutMs}ms`);
};

const evaluateCase = async (model, testCase, routingSystem) => {
  const startedAt = Date.now();
  let sessionId = null;
  try {
    const created = await request(`/api/session?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'POST',
      body: JSON.stringify({
        directory: projectRoot,
        title: `Interactive UI C3 · ${model.modelID} · ${testCase.id}`,
      }),
    });
    sessionId = created?.id;
    assert.equal(typeof sessionId, 'string', 'OpenCode did not return a session id');
    await request(`/api/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'POST',
      body: JSON.stringify({
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: 'build',
        system: routingSystem,
        tools: Object.fromEntries(disabledFixtureTools.map((toolName) => [toolName, false])),
        parts: [{ type: 'text', text: testCase.prompt }],
      }),
    });
    const assistantMessages = await waitForCompletion(
      sessionId,
      testCase.category === 'artifact' ? caseTimeoutMs : Math.min(caseTimeoutMs, nonArtifactCaseTimeoutMs),
    );
    const toolParts = assistantMessages.flatMap((message) => message.parts ?? []).filter((part) => part?.type === 'tool');
    const primaryToolParts = toolParts.filter((part) => {
      if (!relevantTools.has(part.tool) || part.state?.status !== 'completed' || typeof part.state?.output !== 'string') {
        return false;
      }
      return part.state.output.includes('"$schema":"openchamber://interactive-result/v1"')
        || part.state.output.includes('"$schema":"openchamber://html-artifact-result/v1"');
    });
    const routeTools = primaryToolParts.map((part) => part.tool);
    const actualTool = routeTools[0] ?? null;
    const toolStates = toolParts
      .filter((part) => relevantTools.has(part.tool))
      .map((part) => ({ tool: part.tool, status: part.state?.status ?? 'unknown' }));
    const acceptableTools = Array.isArray(testCase.acceptableTools)
      ? testCase.acceptableTools
      : [testCase.expectedTool];
    const expectedRouteCount = actualTool === null ? 0 : 1;
    const duplicatePrimaryView = routeTools.length > expectedRouteCount;
    const matched = acceptableTools.includes(actualTool)
      && routeTools.length === expectedRouteCount;
    return {
      id: testCase.id,
      category: testCase.category,
      expectedPath: testCase.expectedPath,
      expectedTool: testCase.expectedTool,
      acceptableTools,
      actualTool,
      matched,
      duplicatePrimaryView,
      artifactSelected: routeTools.includes('html_artifact'),
      routeTools,
      toolStates,
      finishes: assistantMessages.map((message) => message.info?.finish).filter(Boolean),
      sessionId,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (sessionId) {
      await request(`/api/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(projectRoot)}`, {
        method: 'POST',
        timeoutMs: 30_000,
      }).catch(() => {});
    }
    return {
      id: testCase.id,
      category: testCase.category,
      expectedPath: testCase.expectedPath,
      expectedTool: testCase.expectedTool,
      actualTool: null,
      matched: false,
      artifactSelected: false,
      routeTools: [],
      toolStates: [],
      sessionId,
      durationMs: Date.now() - startedAt,
      error: redact(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    if (sessionId) await archiveSession(sessionId);
  }
};

const evaluateCaseWithRetry = async (model, testCase, routingSystem) => {
  const attempts = [];
  for (let attempt = 1; attempt <= maxCaseAttempts; attempt += 1) {
    await waitForOpenCodeReady();
    const result = await evaluateCase(model, testCase, routingSystem);
    attempts.push({
      attempt,
      sessionId: result.sessionId,
      durationMs: result.durationMs,
      actualTool: result.actualTool,
      matched: result.matched,
      error: result.error,
    });
    const transientError = typeof result.error === 'string'
      && /(timeout|timed out|did not complete|aborted|502|503|504|temporarily unavailable)/i.test(result.error);
    if (!transientError || attempt >= maxCaseAttempts) {
      return {
        ...result,
        durationMs: attempts.reduce((total, entry) => total + entry.durationMs, 0),
        attempts,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error('Case retry loop exited unexpectedly');
};

const percentage = (matched, total) => total === 0 ? 1 : matched / total;

const summarize = (cases) => {
  const category = (predicate) => cases.filter(predicate);
  const business = category((entry) => entry.category === 'business');
  const generated = category((entry) => entry.expectedTool === 'interactive_ui');
  const artifact = category((entry) => entry.expectedTool === 'html_artifact');
  const nonArtifact = category((entry) => entry.expectedTool !== 'html_artifact');
  const directBusiness = cases.find((entry) => entry.id === 'negative-artifact-crm-direct');
  const metrics = {
    total: cases.length,
    matched: cases.filter((entry) => entry.matched).length,
    errors: cases.filter((entry) => entry.error).length,
    businessToolAccuracy: percentage(business.filter((entry) => entry.matched).length, business.length),
    generatedAccuracy: percentage(generated.filter((entry) => entry.matched).length, generated.length),
    artifactAccuracy: percentage(artifact.filter((entry) => entry.matched).length, artifact.length),
    artifactMisselectionRate: percentage(nonArtifact.filter((entry) => entry.artifactSelected).length, nonArtifact.length),
    artifactBusinessViolation: directBusiness?.artifactSelected === true,
    duplicatePrimaryViewRate: percentage(cases.filter((entry) => entry.duplicatePrimaryView).length, cases.length),
  };
  return {
    ...metrics,
    thresholds: {
      businessToolAccuracy: 0.95,
      generatedAccuracy: 0.95,
      artifactAccuracy: 0.90,
      artifactMisselectionRate: 0.05,
      artifactBusinessViolation: false,
      duplicatePrimaryViewRate: 0,
    },
    passed: metrics.errors === 0
      && metrics.businessToolAccuracy >= 0.95
      && metrics.generatedAccuracy >= 0.95
      && metrics.artifactAccuracy >= 0.90
      && metrics.artifactMisselectionRate <= 0.05
      && metrics.artifactBusinessViolation === false
      && metrics.duplicatePrimaryViewRate === 0,
  };
};

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
assert.equal(corpus.$schema, 'openchamber://interactive-ui-unified-acceptance-corpus/v1');
const cases = corpus.cases.filter((testCase) => requestedCaseIds.size === 0 || requestedCaseIds.has(testCase.id));
assert(cases.length > 0, 'No acceptance cases were selected');
if (requestedCaseIds.size === 0) assert.equal(cases.length, 16);

await waitForOpenCodeReady();
const businessRuntime = await ensureBusinessTools();
const [providerConfig, routing] = await Promise.all([
  request('/api/config/providers'),
  request('/api/interactive-ui/capabilities'),
]);
assert.equal(typeof routing?.system, 'string');
const providers = new Map((providerConfig?.providers ?? []).map((provider) => [provider.id, provider]));
const availableModels = [];
const unavailableModels = [];
for (const model of modelPlan) {
  const provider = providers.get(model.providerID);
  if (provider && provider.models && Object.prototype.hasOwnProperty.call(provider.models, model.modelID)) availableModels.push(model);
  else unavailableModels.push({ ...model, reason: 'provider-or-model-not-connected' });
}

const modelResults = [];
for (const model of availableModels) {
  const modelCases = [];
  for (const testCase of cases) {
    const result = await evaluateCaseWithRetry(model, testCase, routing.system);
    modelCases.push(result);
    const partial = {
      $schema: 'openchamber://interactive-ui-model-routing-report/v1',
      generatedAt: new Date().toISOString(),
      baseUrl: new URL(baseUrl).origin,
      corpus: { schema: corpus.$schema, selectedCases: cases.map((entry) => entry.id) },
      models: [...modelResults, { ...model, key: modelKey(model), status: 'running', cases: modelCases }],
      unavailableModels,
      complete: false,
    };
    await fs.writeFile(reportPath, `${JSON.stringify(partial, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(JSON.stringify({ model: modelKey(model), case: testCase.id, actualTool: result.actualTool, matched: result.matched, error: result.error ?? null }));
  }
  modelResults.push({ ...model, key: modelKey(model), status: 'completed', summary: summarize(modelCases), cases: modelCases });
}

let businessRuntimeCleanup = businessRuntime.installedByTest ? 'pending' : 'not-required';
if (businessRuntime.installedByTest) {
  await request(`/api/interactive-ui/manager/extensions/${encodeURIComponent(crmExtensionId)}`, {
    method: 'DELETE',
    timeoutMs: 60_000,
  });
  await waitForBusinessTools(false);
  businessRuntimeCleanup = 'passed';
}

const complete = requestedCaseIds.size === 0
  && unavailableModels.length === 0
  && modelResults.length === modelPlan.length
  && modelResults.every((entry) => entry.summary.passed);
const report = {
  $schema: 'openchamber://interactive-ui-model-routing-report/v1',
  generatedAt: new Date().toISOString(),
  baseUrl: new URL(baseUrl).origin,
  corpus: { schema: corpus.$schema, selectedCases: cases.map((entry) => entry.id) },
  prerequisites: {
    businessRuntime: businessRuntime.mode,
    businessRuntimeCleanup,
  },
  models: modelResults,
  unavailableModels,
  externalBlockers: unavailableModels.map((model) => `${modelKey(model)} is not connected`),
  complete,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({
  ok: modelResults.every((entry) => entry.summary.passed),
  complete,
  reportPath: path.relative(projectRoot, reportPath),
  prerequisites: report.prerequisites,
  models: modelResults.map((entry) => ({ key: entry.key, summary: entry.summary })),
  unavailableModels,
}, null, 2));

if (!modelResults.every((entry) => entry.summary.passed)) process.exitCode = 1;
