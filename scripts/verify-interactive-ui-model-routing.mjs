import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  HYBRID_CRM_FIXTURE,
  createHybridCrmPackage,
  startHybridCrmApi,
} from './lib/interactive-ui-hybrid-crm-fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'unified-acceptance-corpus.json');
// The frozen conversational corpus is an INPUT contract only: this runner
// reads it and never writes to it (issue-098 preserves the frozen corpus).
const interleavingCorpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'conversational-interleaving-corpus.json');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-model-routing');
const reportPath = path.join(outputDirectory, 'report.json');
const baseUrl = (process.env.OPENCHAMBER_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:47832').replace(/\/$/, '');
const requestTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_REQUEST_TIMEOUT_MS || 30_000);
const caseTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_CASE_TIMEOUT_MS || 180_000);
const nonArtifactCaseTimeoutMs = Number(process.env.OPENCHAMBER_ACCEPTANCE_NON_ARTIFACT_CASE_TIMEOUT_MS || 90_000);
const maxCaseAttempts = Number(process.env.OPENCHAMBER_ACCEPTANCE_CASE_ATTEMPTS || 2);
const crmPackagePath = process.env.OPENCHAMBER_ACCEPTANCE_CRM_PACKAGE
  ? path.resolve(process.env.OPENCHAMBER_ACCEPTANCE_CRM_PACKAGE)
  : null;
// OPENCHAMBER_ACCEPTANCE_CASE_IDS selects a diagnostic subset. A subset run
// can never be complete (issue-098): one full run must report the whole
// legacy 17-case group plus the I1-I5 group.
const requestedCaseIds = new Set((process.env.OPENCHAMBER_ACCEPTANCE_CASE_IDS || '').split(',').map((value) => value.trim()).filter(Boolean));
const relevantTools = new Set(['interactive_ui', 'html_artifact', ...HYBRID_CRM_FIXTURE.toolNames]);
const requiredBusinessTools = HYBRID_CRM_FIXTURE.toolNames;
const crmExtensionId = 'com.demo.simple.crm';
const disabledFixtureTools = ['crm_open_dashboard', 'sales_get_summary', 'sales_get_dashboard'];

const defaultModels = [
  { providerID: 'alibaba-coding-plan-cn', modelID: 'qwen3.7-plus', family: 'non-openai', required: true },
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

export const REPORT_SCHEMA = 'openchamber://interactive-ui-model-routing-report/v2';

export const redact = (value) => String(value ?? '')
  .replace(/authorization(\s*[:=]\s*)(?:Bearer\s+)?[^\s,;}]+/gi, 'Authorization$1[REDACTED]')
  .replace(/Bearer\s+[^\s,;}]+/gi, 'Bearer [REDACTED]')
  .replace(/(access[_ -]?key|api[_ -]?key|token|secret)(\s*[:=]\s*)[^\s,;}]+/gi, '$1$2[REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
  .replace(/([?&](?:token|key|code|secret)=[^&#\s]*)/gi, '[REDACTED_QUERY]');

// ---------------------------------------------------------------------------
// issue-098: retry policy. Semantic mismatches are NEVER retried. Only
// explicitly classified transient transport/provider failures may retry,
// and only up to maxCaseAttempts.
// ---------------------------------------------------------------------------
export const TRANSIENT_FAILURE_PATTERN = /(timeout|timed out|did not complete|aborted|502|503|504|temporarily unavailable|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/i;

export const classifyFailure = (errorMessage) => {
  if (typeof errorMessage !== 'string' || errorMessage.trim() === '') return 'semantic';
  return TRANSIENT_FAILURE_PATTERN.test(errorMessage) ? 'transient' : 'semantic';
};

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
      const failureText = error instanceof Error
        ? `${error.message} ${error.cause?.code ?? ''}`
        : String(error);
      if (!retryable || classifyFailure(failureText) !== 'transient' || attempt >= attempts) throw error;
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

const ensureBusinessTools = async (packageBuffer) => {
  const initialTools = await request(`/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`);
  if (requiredBusinessTools.every((tool) => Array.isArray(initialTools) && initialTools.includes(tool))) {
    return { mode: 'existing', installedByTest: false };
  }

  const manager = await request('/api/interactive-ui/manager');
  if (manager?.extensions?.some((extension) => extension?.id === crmExtensionId)) {
    throw new Error('Simple CRM is installed but its Agent Runtime is unavailable; the routing test will not mutate an existing installation');
  }

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
  try {
    await waitForBusinessTools(true);
  } catch (error) {
    let cleanupError = null;
    try {
      await request(`/api/interactive-ui/manager/extensions/${encodeURIComponent(crmExtensionId)}`, {
        method: 'DELETE',
        timeoutMs: 60_000,
      });
      await waitForBusinessTools(false);
    } catch (cleanupFailure) {
      cleanupError = redact(cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure));
    }
    const reason = redact(error instanceof Error ? error.message : String(error));
    throw new Error(`Temporary CRM activation failed: ${reason}; rollback=${cleanupError ?? 'passed'}`);
  }
  return { mode: 'temporary-ocix', installedByTest: true, packageVersion: inspection.extension.version };
};

const modelKey = ({ providerID, modelID }) => `${providerID}/${modelID}`;

const archiveSession = async (sessionId) => {
  try {
    await request(`/api/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'PATCH',
      body: JSON.stringify({ time: { archived: Date.now() } }),
    });
    return true;
  } catch {
    // Best-effort housekeeping, but the failure must stay visible: it is
    // counted and forces complete=false (issue-098).
    return false;
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
  let sessionArchived = false;
  let outcome;
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
        || part.state.output.includes('"$schema":"openchamber://html-artifact-result/v1"')
        || part.state.output.includes('"$schema":"openchamber://installed-html-artifact-result/v1"');
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
    outcome = {
      success: true,
      result: {
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
      },
    };
  } catch (error) {
    if (sessionId) {
      await request(`/api/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(projectRoot)}`, {
        method: 'POST',
        timeoutMs: 30_000,
      }).catch(() => {});
    }
    outcome = {
      success: false,
      result: {
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
      },
    };
  } finally {
    // Session cleanup runs unconditionally (issue-098).
    if (sessionId) sessionArchived = await archiveSession(sessionId);
  }
  return { ...outcome.result, sessionArchived };
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
    // issue-098: a semantic mismatch (no error, or an unclassified error)
    // must never retry; only explicit transient transport/provider failures
    // are retried, and only up to maxCaseAttempts.
    const failureClass = classifyFailure(result.error);
    if (failureClass !== 'transient' || attempt >= maxCaseAttempts) {
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

// The isolated legacy 17-case thresholds are unchanged (issue-098): the
// legacy group stays byte-for-byte the same summary contract as v1, including
// duplicatePrimaryViewRate === 0.
export const summarize = (cases) => {
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

// ---------------------------------------------------------------------------
// I1-I5 interleaving group (issue-098): the frozen conversational corpus is
// graded with the production oracle evaluator
// (scripts/lib/interactive-ui-conversation-transcript.ts) and the per-case
// tools.disable list. The corpus is TypeScript, so the runner needs a
// TypeScript-capable runtime (bun); under plain node main() fails fast with
// an actionable message instead of producing a misleading partial run.
// ---------------------------------------------------------------------------
let transcriptModulePromise = null;
export const loadTranscriptModule = () => {
  if (!transcriptModulePromise) {
    transcriptModulePromise = import('./lib/interactive-ui-conversation-transcript.ts').catch((error) => {
      transcriptModulePromise = null;
      throw error;
    });
  }
  return transcriptModulePromise;
};

/**
 * Adapt finalized OpenCode API assistant messages to the oracle's
 * FinalizedAssistantMessage contract. Non-text/non-tool parts (reasoning,
 * step-start, snapshots, ...) carry no four-track visual content and are
 * dropped at this boundary — they are also raw model output that must never
 * reach evidence or any report.
 */
export const normalizeApiAssistantMessages = (assistantMessages) => {
  assert(Array.isArray(assistantMessages), 'assistantMessages must be an array');
  return assistantMessages.map((message, messageIndex) => {
    assert(message && typeof message === 'object', `message[${messageIndex}] must be an object`);
    assert(Array.isArray(message.parts), `message[${messageIndex}].parts must be an array`);
    const messageId = typeof message.id === 'string' && message.id.trim() ? message.id : `m${messageIndex}`;
    const parts = message.parts
      .filter((part) => part && (part.type === 'text' || part.type === 'tool'))
      .map((part, keptIndex) => {
        const partId = typeof part.id === 'string' && part.id.trim() ? part.id : `${messageIndex}:${keptIndex}`;
        if (part.type === 'text') {
          assert(typeof part.text === 'string', `message[${messageIndex}].text part requires a string text`);
          return { partId, type: 'text', text: part.text };
        }
        assert(typeof part.tool === 'string' && part.tool.trim(), `message[${messageIndex}].tool part requires a tool name`);
        assert(part.state && typeof part.state === 'object' && !Array.isArray(part.state), `message[${messageIndex}].tool part requires a state object`);
        const state = { status: part.state.status };
        if (part.state.input !== undefined) state.input = part.state.input;
        if (part.state.output !== undefined) state.output = part.state.output;
        if (part.state.error !== undefined) state.error = part.state.error;
        return { partId, type: 'tool', tool: part.tool, state };
      });
    return { messageId, parts };
  });
};

/** Normalize + strictly evaluate finalized messages against an expectation. */
export const gradeInterleavingMessages = async (finalizedMessages, expectation) => {
  const transcript = await loadTranscriptModule();
  const evidence = transcript.normalizeAssistantTranscript(finalizedMessages);
  const evaluation = transcript.evaluateInterleavingExpectation(evidence, expectation);
  return { evidence, evaluation };
};

export const summarizeInterleaving = (evaluations) => {
  const total = evaluations.length;
  const passedCount = evaluations.filter((entry) => entry.passed === true).length;
  return {
    total,
    passedCount,
    failedCount: total - passedCount,
    passed: total > 0 && passedCount === total,
  };
};

const evaluateInterleavingCase = async (model, corpusCase, routingSystem) => {
  const startedAt = Date.now();
  let sessionId = null;
  let sessionArchived = false;
  let outcome;
  try {
    const created = await request(`/api/session?directory=${encodeURIComponent(projectRoot)}`, {
      method: 'POST',
      body: JSON.stringify({
        directory: projectRoot,
        title: `Interactive UI IL · ${model.modelID} · ${corpusCase.id}`,
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
        // Per-case tools.disable from the frozen corpus (issue-098).
        tools: Object.fromEntries(corpusCase.tools.disable.map((toolName) => [toolName, false])),
        parts: [{ type: 'text', text: corpusCase.prompt }],
      }),
    });
    const assistantMessages = await waitForCompletion(sessionId, Math.min(caseTimeoutMs, nonArtifactCaseTimeoutMs));
    const finalized = normalizeApiAssistantMessages(assistantMessages);
    const { evaluation } = await gradeInterleavingMessages(finalized, corpusCase.expectation);
    outcome = {
      success: true,
      result: {
        id: corpusCase.id,
        passed: evaluation.passed,
        codes: evaluation.codes,
        diagnostics: evaluation.diagnostics,
        counts: evaluation.counts,
        ...(evaluation.widgetTitlesMatched !== undefined ? { widgetTitlesMatched: evaluation.widgetTitlesMatched } : {}),
        sessionId,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (sessionId) {
      await request(`/api/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(projectRoot)}`, {
        method: 'POST',
        timeoutMs: 30_000,
      }).catch(() => {});
    }
    outcome = {
      success: false,
      result: {
        id: corpusCase.id,
        passed: false,
        codes: ['case-error'],
        diagnostics: [],
        counts: null,
        sessionId,
        durationMs: Date.now() - startedAt,
        error: redact(error instanceof Error ? error.message : String(error)),
      },
    };
  } finally {
    // Session cleanup runs unconditionally (issue-098).
    if (sessionId) sessionArchived = await archiveSession(sessionId);
  }
  return { ...outcome.result, sessionArchived };
};

const evaluateInterleavingCaseWithRetry = async (model, corpusCase, routingSystem) => {
  const attempts = [];
  for (let attempt = 1; attempt <= maxCaseAttempts; attempt += 1) {
    await waitForOpenCodeReady();
    const result = await evaluateInterleavingCase(model, corpusCase, routingSystem);
    attempts.push({
      attempt,
      sessionId: result.sessionId,
      durationMs: result.durationMs,
      passed: result.passed,
      error: result.error,
    });
    // issue-098: a semantic mismatch (passed=false without a transient
    // transport/provider error) is never retried.
    const failureClass = classifyFailure(result.error);
    if (failureClass !== 'transient' || attempt >= maxCaseAttempts) {
      return {
        ...result,
        durationMs: attempts.reduce((total, entry) => total + entry.durationMs, 0),
        attempts,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error('Interleaving case retry loop exited unexpectedly');
};

/**
 * Privacy-safe per-model interleaving group entry. The case projection comes
 * from the oracle's buildPrivacySafeReport, which retains only ids, pass
 * booleans, stable failure codes/diagnostics, and numeric counts — never
 * prompts, model text, widget code/titles, tool input/output, or business
 * rows.
 */
export const buildInterleavingModelEntry = async ({ key, status, evaluations, corpusId, includeCases }) => {
  const transcript = await loadTranscriptModule();
  const normalizedEvaluations = evaluations.map((entry) => entry.evaluation ?? entry);
  const report = transcript.buildPrivacySafeReport({
    corpusId,
    cases: evaluations.map((entry, index) => ({
      id: entry.id,
      evaluation: normalizedEvaluations[index],
    })),
  });
  const cases = report.cases.map(({ widgetTitlesMatched: _widgetTitlesMatched, ...entry }) => entry);
  return {
    key,
    status,
    ...summarizeInterleaving(normalizedEvaluations),
    ...(includeCases ? { cases } : { report: { ...report, cases } }),
  };
};

// ---------------------------------------------------------------------------
// Report assembly (privacy-safe by construction: only safe fields flow in)
// ---------------------------------------------------------------------------
export const computeComplete = ({ isSubset, plannedModelCount, unavailableModels, modelResults, interleavingModelResults, cleanupOk }) => (
  isSubset === false
  && unavailableModels.length === 0
  && modelResults.length === plannedModelCount
  && modelResults.every((entry) => entry.summary?.passed === true)
  && interleavingModelResults.length === plannedModelCount
  && interleavingModelResults.every((entry) => entry.passed === true)
  && cleanupOk === true
);

export const buildPartialReport = ({
  generatedAt,
  baseUrl,
  corpusSchema,
  selectedCases,
  interleavingCorpusSchema,
  interleavingSelectedCases,
  models,
  interleavingModels,
  unavailableModels,
}) => ({
  $schema: REPORT_SCHEMA,
  generatedAt,
  baseUrl,
  corpus: {
    schema: corpusSchema,
    selectedCases,
    interleaving: { schema: interleavingCorpusSchema, selectedCases: interleavingSelectedCases },
  },
  models,
  interleaving: { models: interleavingModels },
  unavailableModels,
  complete: false,
});

export const buildFinalReport = ({
  generatedAt,
  baseUrl,
  corpusSchema,
  selectedCases,
  interleavingCorpusSchema,
  interleavingSelectedCases,
  businessRuntimeMode,
  businessRuntimeCleanup,
  businessRuntimeCleanupError,
  modelResults,
  interleavingModelResults,
  unavailableModels,
  sessionCleanupFailures,
  executionError,
  complete,
}) => ({
  $schema: REPORT_SCHEMA,
  generatedAt,
  baseUrl,
  corpus: {
    schema: corpusSchema,
    selectedCases,
    interleaving: { schema: interleavingCorpusSchema, selectedCases: interleavingSelectedCases },
  },
  prerequisites: {
    businessRuntime: businessRuntimeMode,
    businessRuntimeCleanup,
    ...(businessRuntimeCleanupError ? { businessRuntimeCleanupError } : {}),
    ...(executionError ? { executionError } : {}),
  },
  cleanup: { sessionCleanupFailures },
  models: modelResults,
  interleaving: { models: interleavingModelResults },
  unavailableModels,
  externalBlockers: unavailableModels.map((model) => `${modelKey(model)} is not connected`),
  complete,
});

export const main = async () => {
  // The I1-I5 group is mandatory; its oracle is TypeScript. Under plain node
  // this import cannot resolve, so fail fast with an actionable message
  // instead of writing a misleading report.
  try {
    await loadTranscriptModule();
  } catch (error) {
    throw new Error(
      `The I1-I5 interleaving group requires a TypeScript-capable runtime; run with bun: `
      + `${redact(error instanceof Error ? error.message : String(error))}`,
    );
  }

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });

  let fixtureRoot = null;
  let fixtureApi = null;
  try {
    let crmPackageBuffer;
    if (crmPackagePath) {
      crmPackageBuffer = await fs.readFile(crmPackagePath);
    } else {
      fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-routing-hybrid-'));
      fixtureApi = await startHybridCrmApi();
      crmPackageBuffer = (await createHybridCrmPackage({
        temporaryRoot: fixtureRoot,
        crmApiUrl: fixtureApi.url,
        version: '1.3.0-routing.1',
      })).buffer;
    }

    const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  assert.equal(corpus.$schema, 'openchamber://interactive-ui-unified-acceptance-corpus/v1');
  const cases = corpus.cases.filter((testCase) => requestedCaseIds.size === 0 || requestedCaseIds.has(testCase.id));
  assert(cases.length > 0, 'No acceptance cases were selected');
  if (requestedCaseIds.size === 0) assert.equal(cases.length, 17);

  const transcript = await loadTranscriptModule();
  const interleavingCorpusResult = await transcript.loadConversationalInterleavingCorpus(interleavingCorpusPath);
  assert.equal(interleavingCorpusResult.ok, true, `Frozen conversational corpus must validate: ${interleavingCorpusResult.errors?.join('; ') ?? 'unknown error'}`);
  const interleavingCases = interleavingCorpusResult.corpus.cases;
  const interleavingCorpusSchema = interleavingCorpusResult.corpus.$schema;

  await waitForOpenCodeReady();
  const businessRuntime = await ensureBusinessTools(crmPackageBuffer);
  const availableModels = [];
  const unavailableModels = [];
  const modelResults = [];
  const interleavingModelsInternal = [];
  const interleavingModelResults = [];
  let sessionCleanupFailures = 0;
  let routing = null;
  let executionError = null;
  let businessRuntimeCleanup = { status: businessRuntime.installedByTest ? 'pending' : 'not-required', error: null };

  const writePartial = async ({ model, modelCases, interleavingEvaluations, interleavingStarted }) => {
    const partialInterleavingModels = [];
    for (const entry of interleavingModelsInternal) {
      partialInterleavingModels.push(await buildInterleavingModelEntry({
        key: entry.key,
        status: entry.status,
        evaluations: entry.evaluations,
        corpusId: interleavingCorpusSchema,
        includeCases: true,
      }));
    }
    if (interleavingStarted) {
      partialInterleavingModels.push(await buildInterleavingModelEntry({
        key: modelKey(model),
        status: 'running',
        evaluations: interleavingEvaluations,
        corpusId: interleavingCorpusSchema,
        includeCases: true,
      }));
    }
    const partial = buildPartialReport({
      generatedAt: new Date().toISOString(),
      baseUrl: new URL(baseUrl).origin,
      corpusSchema: corpus.$schema,
      selectedCases: cases.map((entry) => entry.id),
      interleavingCorpusSchema,
      interleavingSelectedCases: interleavingCases.map((entry) => entry.id),
      models: [...modelResults, { ...model, key: modelKey(model), status: 'running', cases: modelCases }],
      interleavingModels: partialInterleavingModels,
      unavailableModels,
    });
    await fs.writeFile(reportPath, `${JSON.stringify(partial, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  };

  try {
    const [providerConfig, routingResult] = await Promise.all([
      request('/api/config/providers'),
      request('/api/interactive-ui/capabilities'),
    ]);
    routing = routingResult;
    assert.equal(typeof routing?.system, 'string');
    const providers = new Map((providerConfig?.providers ?? []).map((provider) => [provider.id, provider]));
    for (const model of modelPlan) {
      const provider = providers.get(model.providerID);
      if (provider && provider.models && Object.prototype.hasOwnProperty.call(provider.models, model.modelID)) availableModels.push(model);
      else unavailableModels.push({ ...model, reason: 'provider-or-model-not-connected' });
    }

    for (const model of availableModels) {
      const modelCases = [];
      for (const testCase of cases) {
        const result = await evaluateCaseWithRetry(model, testCase, routing.system);
        modelCases.push(result);
        if (result.sessionArchived === false) sessionCleanupFailures += 1;
        await writePartial({ model, modelCases, interleavingEvaluations: [], interleavingStarted: false });
        console.log(JSON.stringify({ model: modelKey(model), case: testCase.id, actualTool: result.actualTool, matched: result.matched, error: result.error ?? null }));
      }
      modelResults.push({ ...model, key: modelKey(model), status: 'completed', summary: summarize(modelCases), cases: modelCases });

      // Separate I1-I5 5/5 group for the same model.
      const interleavingEvaluations = [];
      for (const corpusCase of interleavingCases) {
        const evaluation = await evaluateInterleavingCaseWithRetry(model, corpusCase, routing.system);
        interleavingEvaluations.push(evaluation);
        if (evaluation.sessionArchived === false) sessionCleanupFailures += 1;
        await writePartial({ model, modelCases, interleavingEvaluations, interleavingStarted: true });
        console.log(JSON.stringify({ model: modelKey(model), case: corpusCase.id, passed: evaluation.passed, error: evaluation.error ?? null }));
      }
      interleavingModelsInternal.push({ key: modelKey(model), status: 'completed', evaluations: interleavingEvaluations });
      interleavingModelResults.push(await buildInterleavingModelEntry({
        key: modelKey(model),
        status: 'completed',
        evaluations: interleavingEvaluations,
        corpusId: interleavingCorpusSchema,
        includeCases: false,
      }));
    }
  } catch (error) {
    executionError = redact(error instanceof Error ? error.message : String(error));
    console.error(`model-routing execution failed: ${executionError}`);
  } finally {
    // Fixture/business-runtime cleanup runs unconditionally; a cleanup
    // failure stays visible in the report and forces complete=false.
    if (businessRuntime.installedByTest) {
      try {
        await request(`/api/interactive-ui/manager/extensions/${encodeURIComponent(crmExtensionId)}`, {
          method: 'DELETE',
          timeoutMs: 60_000,
        });
        await waitForBusinessTools(false);
        businessRuntimeCleanup = { status: 'passed', error: null };
      } catch (error) {
        businessRuntimeCleanup = { status: 'failed', error: redact(error instanceof Error ? error.message : String(error)) };
        console.error(`model-routing business-runtime cleanup failed: ${businessRuntimeCleanup.error}`);
      }
    }
  }

  const cleanupOk = businessRuntimeCleanup.status === (businessRuntime.installedByTest ? 'passed' : 'not-required')
    && sessionCleanupFailures === 0;
  const complete = computeComplete({
    isSubset: requestedCaseIds.size > 0,
    plannedModelCount: modelPlan.length,
    unavailableModels,
    modelResults,
    interleavingModelResults,
    cleanupOk,
  });
  const report = buildFinalReport({
    generatedAt: new Date().toISOString(),
    baseUrl: new URL(baseUrl).origin,
    corpusSchema: corpus.$schema,
    selectedCases: cases.map((entry) => entry.id),
    interleavingCorpusSchema,
    interleavingSelectedCases: interleavingCases.map((entry) => entry.id),
    businessRuntimeMode: businessRuntime.mode,
    businessRuntimeCleanup: businessRuntimeCleanup.status,
    businessRuntimeCleanupError: businessRuntimeCleanup.error,
    modelResults,
    interleavingModelResults,
    unavailableModels,
    sessionCleanupFailures,
    executionError,
    complete,
  });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({
    ok: modelResults.every((entry) => entry.summary.passed) && interleavingModelResults.every((entry) => entry.passed),
    complete,
    reportPath: path.relative(projectRoot, reportPath),
    prerequisites: report.prerequisites,
    cleanup: report.cleanup,
    models: modelResults.map((entry) => ({ key: entry.key, summary: entry.summary })),
    interleaving: interleavingModelResults.map((entry) => ({
      key: entry.key,
      passed: entry.passed,
      summary: { total: entry.total, passedCount: entry.passedCount, failedCount: entry.failedCount },
    })),
    unavailableModels,
  }, null, 2));

    if (!complete) process.exitCode = 1;
  } finally {
    // Keep the temporary CRM API alive for every business case, then always
    // close it and remove publisher/package materialization on every exit.
    await fixtureApi?.close().catch(() => null);
    if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
};

const isDirectRun = typeof process !== 'undefined'
  && process.argv?.[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`model-routing acceptance failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  });
}
