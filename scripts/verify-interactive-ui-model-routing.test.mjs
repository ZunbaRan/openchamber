import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  REPORT_SCHEMA,
  TRANSIENT_FAILURE_PATTERN,
  buildFinalReport,
  buildInterleavingModelEntry,
  buildPartialReport,
  classifyFailure,
  computeComplete,
  gradeInterleavingMessages,
  normalizeApiAssistantMessages,
  redact,
  summarize,
  summarizeInterleaving,
} from './verify-interactive-ui-model-routing.mjs';

const projectRoot = path.resolve(import.meta.dir, '..');
const legacyCorpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'unified-acceptance-corpus.json');
const interleavingCorpusPath = path.join(projectRoot, 'examples', 'interactive-ui', 'conversational-interleaving-corpus.json');

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
const interleavingCorpus = await readJson(interleavingCorpusPath);
const runnerSource = await fs.readFile(path.join(import.meta.dir, 'verify-interactive-ui-model-routing.mjs'), 'utf8');
const expectationFor = (id) => interleavingCorpus.cases.find((corpusCase) => corpusCase.id === id).expectation;

const textPart = (partId, text) => ({ partId, type: 'text', text });
const toolPart = (partId, tool, state, metadata) => ({ partId, type: 'tool', tool, state, ...(metadata ? { metadata } : {}) });
const message = (messageId, parts) => ({ messageId, parts });
const interactiveOutput = (view, mode = 'snapshot', extra = {}) =>
  JSON.stringify({ $schema: 'openchamber://interactive-result/v1', view, schemaVersion: 1, mode, ...extra });

// Deterministic finalized transcripts with synthetic demo content only — the
// frozen corpus is the plan/model-runner INPUT schema and never stores them.
const TRANSCRIPTS = {
  I1: [
    message('m1', [
      textPart('p1', 'RLHF 强化学习分为五个阶段，先看整体流程说明。'),
      textPart('p2', '```show-widget\n{"title":"RLHF 流程总览","widget_code":"<div>rlhf-pipeline-overview</div>"}\n```'),
      textPart('p3', '接下来是交互视图，可以切换每个阶段的样本权重。'),
      toolPart('p4', 'interactive_ui', { status: 'completed', input: { presentation: 'steps' }, output: interactiveOutput('generated-declarative') }),
    ]),
    message('m2', [textPart('p5', '以上就是 RLHF 的完整流程，共五个阶段。')]),
  ],
  I2: [
    message('m1', [
      textPart('p1', '先看注意力机制的计算过程。'),
      toolPart('p2', 'interactive_ui', { status: 'completed', input: {}, output: interactiveOutput('generated-declarative') }),
    ]),
    message('m2', [
      textPart('p3', '接下来说明它与 KV 缓存复用之间的关系。'),
      toolPart('p4', 'interactive_ui', { status: 'completed', input: {}, output: interactiveOutput('generated-declarative') }),
    ]),
    message('m3', [textPart('p5', '二者共同降低自回归生成阶段的重复计算。')]),
  ],
  I3: [
    message('m1', [
      textPart('p1', [
        '阶段总览如下。',
        '```show-widget\n{"title":"阶段总览","widget_code":"<div>stage-overview</div>"}\n```',
        '奖励闭环的完整机制如下。',
        '```show-widget\n{"title":"奖励闭环","widget_code":"<div>reward-loop</div>"}\n```',
        '以上就是两个核心视图，均以纯组件方式渲染。',
      ].join('\n\n')),
    ]),
  ],
  I4: [
    message('m1', [textPart('p1', '正在打开企业 CRM 工作台。')]),
    message('m2', [
      toolPart('p2', 'simple_crm_open_workspace', {
        status: 'completed',
        input: { surface: 'workspace' },
        output: interactiveOutput('com.demo.simple.crm.workspace', 'live'),
      }),
    ]),
    message('m3', [textPart('p3', '已加载客户与商机概况，数据来自 CRM 连接器。')]),
  ],
  I5: [
    message('m1', [textPart('p1', '该页面已迁移到新地址，因此返回 HTTP 404。')]),
  ],
};

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

describe('classifyFailure (issue-098 retry policy)', () => {
  test('classifies explicit transient transport/provider failures as transient', () => {
    const transient = [
      'request timed out',
      'Session s1 did not complete within 180000ms',
      '502 Bad Gateway',
      '503 Service Unavailable',
      '504 Gateway Timeout',
      'temporarily unavailable',
      'socket hang up',
      'ECONNRESET',
      'the session was aborted',
    ];
    for (const messageText of transient) {
      expect(classifyFailure(messageText), messageText).toBe('transient');
      expect(TRANSIENT_FAILURE_PATTERN.test(messageText), messageText).toBe(true);
    }
  });

  test('classifies semantic mismatches and unclassified errors as semantic (never retried)', () => {
    const semantic = [
      'model refused to call a visualization tool',
      'the response contained no interactive result envelope',
      'a forbidden tool was called',
      'provider returned 400 invalid request',
      'model output was malformed',
      undefined,
      null,
      '',
      '   ',
    ];
    for (const messageText of semantic) {
      expect(classifyFailure(messageText), String(messageText)).toBe('semantic');
    }
  });
});

describe('redact', () => {
  test('strips bearer tokens, api keys, sk- keys, and query secrets', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: [REDACTED]');
    expect(redact('api_key=super-secret-value')).not.toContain('super-secret-value');
    expect(redact('token: sekrit')).toContain('token: [REDACTED]');
    expect(redact('sk-abcdefghijklmnopqrstuvwxyz123456')).toContain('sk-[REDACTED]');
    expect(redact('https://x.test/?code=abc&token=def')).not.toContain('code=abc');
    expect(redact('plain error without secrets')).toBe('plain error without secrets');
  });
});

// ---------------------------------------------------------------------------
// API message normalization
// ---------------------------------------------------------------------------

describe('normalizeApiAssistantMessages', () => {
  test('maps text and tool parts, drops reasoning parts, keeps order, and falls back on missing ids', () => {
    const apiMessages = [
      {
        id: 'msg-1',
        info: { role: 'assistant' },
        parts: [
          { id: 'p-1', type: 'text', text: '先看流程。' },
          { id: 'p-2', type: 'reasoning', text: 'model internal reasoning must never be retained' },
          { id: 'p-3', type: 'tool', tool: 'interactive_ui', state: { status: 'completed', input: {}, output: interactiveOutput('generated-declarative') } },
          { id: 'p-4', type: 'step-start', stepType: 'plan' },
        ],
      },
    ];
    const finalized = normalizeApiAssistantMessages(apiMessages);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].messageId).toBe('msg-1');
    expect(finalized[0].parts).toHaveLength(2);
    expect(finalized[0].parts[0]).toEqual({ partId: 'p-1', type: 'text', text: '先看流程。' });
    expect(finalized[0].parts[1]).toEqual({
      partId: 'p-3',
      type: 'tool',
      tool: 'interactive_ui',
      state: { status: 'completed', input: {}, output: interactiveOutput('generated-declarative') },
    });
  });

  test('falls back to deterministic ids when message/part ids are absent', () => {
    const finalized = normalizeApiAssistantMessages([
      { parts: [{ type: 'text', text: 'hi' }, { type: 'tool', tool: 'read', state: { status: 'error' } }] },
    ]);
    expect(finalized[0].messageId).toBe('m0');
    expect(finalized[0].parts.map((part) => part.partId)).toEqual(['0:0', '0:1']);
  });

  test('fails closed on malformed parts', () => {
    expect(() => normalizeApiAssistantMessages([{ id: 'm1', parts: [{ id: 'p1', type: 'text', text: 42 }] }])).toThrow(/text/);
    expect(() => normalizeApiAssistantMessages([{ id: 'm1', parts: [{ id: 'p1', type: 'tool', tool: '', state: { status: 'completed' } }] }])).toThrow(/tool name/);
    expect(() => normalizeApiAssistantMessages([{ id: 'm1', parts: [{ id: 'p1', type: 'tool', tool: 'read' }] }])).toThrow(/state/);
    expect(() => normalizeApiAssistantMessages('nope')).toThrow(/array/);
  });
});

// ---------------------------------------------------------------------------
// Interleaving grading against the frozen corpus
// ---------------------------------------------------------------------------

describe('gradeInterleavingMessages (oracle evaluator seam)', () => {
  test('frozen corpus validates exactly I1-I5 and every fixture transcript passes its expectation', async () => {
    for (const id of ['I1', 'I2', 'I3', 'I4', 'I5']) {
      const { evaluation } = await gradeInterleavingMessages(TRANSCRIPTS[id], expectationFor(id));
      expect(evaluation.passed, `${id} should pass: ${evaluation.diagnostics.join('; ')}`).toBe(true);
      expect(evaluation.codes).toEqual([]);
    }
  });

  test('I3 widget titles match in order', async () => {
    const { evaluation } = await gradeInterleavingMessages(TRANSCRIPTS.I3, expectationFor('I3'));
    expect(evaluation.widgetTitlesMatched).toBe(true);
  });

  test('semantic mismatches produce stable failure codes and are not transport errors', async () => {
    // I4 expects exactly one installed business view; a text-only response is a
    // semantic mismatch that must never be retried.
    const { evaluation } = await gradeInterleavingMessages(TRANSCRIPTS.I5, expectationFor('I4'));
    expect(evaluation.passed).toBe(false);
    expect(evaluation.codes).toContain('visual-count-mismatch');
    expect(evaluation.codes).toContain('missing-business-call');
    expect(classifyFailure(evaluation.passed ? undefined : undefined)).toBe('semantic');

    // A forbidden presentation tool call violates I5 even when the call failed.
    const withForbiddenCall = [
      message('m1', [
        textPart('p1', '该页面已迁移到新地址，因此返回 HTTP 404。'),
        toolPart('p2', 'interactive_ui', { status: 'error', input: {}, error: 'denied' }),
      ]),
    ];
    const forbidden = await gradeInterleavingMessages(withForbiddenCall, expectationFor('I5'));
    expect(forbidden.evaluation.passed).toBe(false);
    expect(forbidden.evaluation.codes).toContain('forbidden-tool-call');
    expect(forbidden.evaluation.codes).toContain('presentation-tool-call');
  });

  test('privacy-safe per-model interleaving entries retain no raw content', async () => {
    const secretRow = 'acme-corp-secret-row-42';
    const secretQuery = 'SELECT * FROM customers WHERE name = "secret-account"';
    const secretPhrase = 'top-secret-conversation-fragment';
    const sensitive = [
      secretRow,
      secretQuery,
      secretPhrase,
      '阶段总览',
      '奖励闭环',
      'rlhf-pipeline-overview',
      'stage-overview',
      'reward-loop',
      ...interleavingCorpus.cases.map((corpusCase) => corpusCase.prompt),
    ];

    const evaluations = [];
    for (const id of ['I1', 'I2', 'I3', 'I4', 'I5']) {
      const transcripts = id === 'I4'
        ? [
            message('m1', [textPart('p1', `intro ${secretPhrase}`)]),
            message('m2', [
              toolPart('p2', 'simple_crm_open_workspace', {
                status: 'completed',
                input: { query: secretQuery },
                output: interactiveOutput('com.demo.simple.crm.workspace', 'live', {
                  data: { opportunities: [{ id: 'opp-1', customer: secretRow }] },
                }),
              }),
            ]),
            message('m3', [textPart('p3', 'done')]),
          ]
        : TRANSCRIPTS[id];
      const { evaluation } = await gradeInterleavingMessages(transcripts, expectationFor(id));
      evaluations.push({ id, evaluation });
    }

    const entry = await buildInterleavingModelEntry({
      key: 'provider/model',
      status: 'completed',
      evaluations,
      corpusId: interleavingCorpus.$schema,
      includeCases: true,
    });
    expect(entry.passed).toBe(true);
    expect(entry.total).toBe(5);
    const serialized = JSON.stringify(entry);
    for (const raw of sensitive) {
      expect(serialized, `interleaving entry must not contain raw content`).not.toContain(raw);
    }
    expect(serialized).not.toContain('widgetTitle');
  });
});

describe('summarizeInterleaving', () => {
  test('5/5 passes and 4/5 fails', () => {
    const passed = (id) => ({ id, passed: true });
    const failed = (id) => ({ id, passed: false });
    expect(summarizeInterleaving([passed('I1'), passed('I2'), passed('I3'), passed('I4'), passed('I5')]))
      .toEqual({ total: 5, passedCount: 5, failedCount: 0, passed: true });
    expect(summarizeInterleaving([passed('I1'), failed('I2'), passed('I3'), passed('I4'), passed('I5')]))
      .toEqual({ total: 5, passedCount: 4, failedCount: 1, passed: false });
    expect(summarizeInterleaving([])).toEqual({ total: 0, passedCount: 0, failedCount: 0, passed: false });
  });
});

// ---------------------------------------------------------------------------
// Unchanged legacy 17-case thresholds
// ---------------------------------------------------------------------------

describe('legacy summarize (17-case thresholds unchanged)', () => {
  const makePassingResult = (testCase) => ({
    id: testCase.id,
    category: testCase.category,
    expectedPath: testCase.expectedPath,
    expectedTool: testCase.expectedTool,
    acceptableTools: testCase.acceptableTools ?? [testCase.expectedTool],
    actualTool: testCase.expectedTool ?? null,
    matched: true,
    duplicatePrimaryView: false,
    artifactSelected: testCase.expectedTool === 'html_artifact',
    routeTools: testCase.expectedTool ? [testCase.expectedTool] : [],
    toolStates: [],
    finishes: ['stop'],
    sessionId: 'synthetic-session',
    durationMs: 1,
  });

  test('all 17 legacy cases passing keep the exact v1 thresholds, including duplicatePrimaryViewRate 0', async () => {
    const legacyCorpus = await readJson(legacyCorpusPath);
    expect(legacyCorpus.cases).toHaveLength(17);
    const results = legacyCorpus.cases.map(makePassingResult);
    const summary = summarize(results);
    expect(summary.passed).toBe(true);
    expect(summary.thresholds).toEqual({
      businessToolAccuracy: 0.95,
      generatedAccuracy: 0.95,
      artifactAccuracy: 0.90,
      artifactMisselectionRate: 0.05,
      artifactBusinessViolation: false,
      duplicatePrimaryViewRate: 0,
    });
    expect(summary.total).toBe(17);
    expect(summary.errors).toBe(0);
  });

  test('any duplicate primary view drives duplicatePrimaryViewRate above 0 and fails the group', async () => {
    const legacyCorpus = await readJson(legacyCorpusPath);
    const results = legacyCorpus.cases.map(makePassingResult);
    results[0].duplicatePrimaryView = true;
    const summary = summarize(results);
    expect(summary.duplicatePrimaryViewRate).toBeGreaterThan(0);
    expect(summary.passed).toBe(false);
  });

  test('an artifact mis-selection for a direct business request fails the artifact-business-violation threshold', async () => {
    const legacyCorpus = await readJson(legacyCorpusPath);
    const results = legacyCorpus.cases.map(makePassingResult);
    const directBusiness = results.find((result) => result.id === 'negative-artifact-crm-direct');
    directBusiness.artifactSelected = true;
    expect(summarize(results).passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// complete computation (all planned models, both groups, cleanup)
// ---------------------------------------------------------------------------

describe('computeComplete', () => {
  const passingLegacy = (count) => Array.from({ length: count }, () => ({ summary: { passed: true } }));
  const passingInterleaving = (count) => Array.from({ length: count }, () => ({ passed: true }));

  test('complete requires all planned models, both groups, and successful cleanup', () => {
    const args = {
      isSubset: false,
      plannedModelCount: 1,
      unavailableModels: [],
      modelResults: passingLegacy(1),
      interleavingModelResults: passingInterleaving(1),
      cleanupOk: true,
    };
    expect(computeComplete(args)).toBe(true);

    expect(computeComplete({ ...args, isSubset: true })).toBe(false);
    expect(computeComplete({ ...args, cleanupOk: false })).toBe(false);
    expect(computeComplete({ ...args, unavailableModels: [{ providerID: 'x', modelID: 'y' }] })).toBe(false);
    expect(computeComplete({ ...args, modelResults: passingLegacy(0) })).toBe(false);
    expect(computeComplete({ ...args, modelResults: [{ summary: { passed: false } }] })).toBe(false);
    expect(computeComplete({ ...args, interleavingModelResults: passingInterleaving(0) })).toBe(false);
    expect(computeComplete({ ...args, interleavingModelResults: [{ passed: false }, { passed: true }] })).toBe(false);
  });

  test('a diagnostic subset always emits complete=false', () => {
    expect(computeComplete({
      isSubset: true,
      plannedModelCount: 1,
      unavailableModels: [],
      modelResults: passingLegacy(1),
      interleavingModelResults: passingInterleaving(1),
      cleanupOk: true,
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Report assembly (v2 privacy-safe partial and final reports)
// ---------------------------------------------------------------------------

describe('report assembly', () => {
  const baseReportInput = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    baseUrl: 'http://127.0.0.1:47832',
    corpusSchema: 'openchamber://interactive-ui-unified-acceptance-corpus/v1',
    selectedCases: ['generated-zh-rlhf-flow', 'negative-unknown-capability'],
    interleavingCorpusSchema: interleavingCorpus.$schema,
    interleavingSelectedCases: ['I1', 'I2', 'I3', 'I4', 'I5'],
  };

  test('final report is v2, carries both groups, complete, and visible cleanup failures', () => {
    const report = buildFinalReport({
      ...baseReportInput,
      businessRuntimeMode: 'temporary-ocix',
      businessRuntimeCleanup: 'failed',
      businessRuntimeCleanupError: 'DELETE failed (500)',
      modelResults: [{ key: 'a/b', status: 'completed', summary: { passed: true }, cases: [] }],
      interleavingModelResults: [{ key: 'a/b', status: 'completed', passed: true, total: 5, passedCount: 5, failedCount: 0, report: { schema: 'openchamber://interleaving-report/v1', cases: [] } }],
      unavailableModels: [],
      sessionCleanupFailures: 0,
      executionError: null,
      complete: false,
    });
    expect(report.$schema).toBe(REPORT_SCHEMA);
    expect(report.$schema).toContain('/v2');
    expect(report.complete).toBe(false);
    expect(report.prerequisites.businessRuntimeCleanup).toBe('failed');
    expect(report.prerequisites.businessRuntimeCleanupError).toBe('DELETE failed (500)');
    expect(report.cleanup.sessionCleanupFailures).toBe(0);
    expect(report.interleaving.models).toHaveLength(1);
    expect(report.corpus.interleaving.selectedCases).toEqual(['I1', 'I2', 'I3', 'I4', 'I5']);
    expect(JSON.stringify(report, null, 2)).toContain('"complete": false');
  });

  test('final report retains no raw prompts, model text, widget titles, tool input/output, or business content', async () => {
    const sensitive = [
      'secret-customer-name-omega',
      'SELECT * FROM opportunities',
      '阶段总览',
      '奖励闭环',
      'widget_code_secret',
      'sk-live-model-key-1234567890abcdef',
      ...interleavingCorpus.cases.map((corpusCase) => corpusCase.prompt),
    ];
    // Interleaving group built from transcripts that contain raw content.
    const leakyTranscripts = [
      message('m1', [
        textPart('p1', '```show-widget\n{"title":"阶段总览","widget_code":"<div>widget_code_secret</div>"}\n```'),
        toolPart('p2', 'interactive_ui', {
          status: 'completed',
          input: { query: 'SELECT * FROM opportunities' },
          output: interactiveOutput('generated-declarative', 'snapshot', { rows: [{ customer: 'secret-customer-name-omega' }] }),
        }),
      ]),
      message('m2', [textPart('p3', '奖励闭环 done')]),
    ];
    const { evaluation } = await gradeInterleavingMessages(leakyTranscripts, expectationFor('I1'));
    const interleavingEntry = await buildInterleavingModelEntry({
      key: 'provider/model',
      status: 'completed',
      evaluations: [{ id: 'I1', evaluation }],
      corpusId: interleavingCorpus.$schema,
      includeCases: false,
    });

    const report = buildFinalReport({
      ...baseReportInput,
      businessRuntimeMode: 'temporary-ocix',
      businessRuntimeCleanup: 'passed',
      modelResults: [{ key: 'provider/model', status: 'completed', summary: { passed: true }, cases: [] }],
      interleavingModelResults: [interleavingEntry],
      unavailableModels: [],
      sessionCleanupFailures: 0,
      executionError: null,
      complete: false,
    });
    const serialized = JSON.stringify(report);
    for (const raw of sensitive) {
      expect(serialized, `final report must not retain raw content`).not.toContain(raw);
    }
    expect(serialized).not.toContain('widgetTitle');
    expect(serialized).not.toContain('interactiveOutput');
  });

  test('partial report always emits complete=false and both groups, with privacy-safe interleaving cases', async () => {
    const { evaluation } = await gradeInterleavingMessages(TRANSCRIPTS.I3, expectationFor('I3'));
    const partialInterleaving = await buildInterleavingModelEntry({
      key: 'provider/model',
      status: 'running',
      evaluations: [{ id: 'I3', evaluation }],
      corpusId: interleavingCorpus.$schema,
      includeCases: true,
    });
    const partial = buildPartialReport({
      ...baseReportInput,
      models: [{ key: 'provider/model', status: 'running', cases: [{ id: 'generated-zh-rlhf-flow', matched: true }] }],
      interleavingModels: [partialInterleaving],
      unavailableModels: [],
    });
    expect(partial.$schema).toBe(REPORT_SCHEMA);
    expect(partial.complete).toBe(false);
    expect(partial.models[0].status).toBe('running');
    expect(partial.interleaving.models[0].cases).toEqual([
      {
        id: 'I3',
        passed: true,
        codes: [],
        diagnostics: [],
        counts: partialInterleaving.cases[0].counts,
      },
    ]);
    const serialized = JSON.stringify(partial);
    expect(serialized).not.toContain('阶段总览');
    expect(serialized).not.toContain('奖励闭环');
    expect(serialized).not.toContain('widgetTitle');
  });
});

// ---------------------------------------------------------------------------
// Source-level invariants (issue-098)
// ---------------------------------------------------------------------------

describe('runner source invariants', () => {
  test('retry loops gate exclusively on classifyFailure(...) === transient', () => {
    expect(runnerSource.match(/const failureClass = classifyFailure\(result\.error\);/g)).toHaveLength(2);
    expect(runnerSource.match(/classifyFailure\(result\.error\)/g)).toHaveLength(2);
    expect(runnerSource).toContain("if (failureClass !== 'transient' || attempt >= maxCaseAttempts)");
    expect(runnerSource).toContain('Semantic mismatches are NEVER retried');
  });

  test('fixture, publisher, business-runtime, and session cleanup run in finally and failures stay visible', () => {
    expect(runnerSource.match(/finally\s*{/g)).toHaveLength(4);
    expect(runnerSource.match(/\/\/ Session cleanup runs unconditionally/g)).toHaveLength(2);
    expect(runnerSource).toContain("businessRuntimeCleanup = { status: 'failed'");
    expect(runnerSource).toContain('businessRuntimeCleanupError');
    expect(runnerSource).toContain('sessionCleanupFailures');
    expect(runnerSource).toContain('// Keep the temporary CRM API alive for every business case, then always');
    expect(runnerSource).toContain('// Fixture/business-runtime cleanup runs unconditionally;');
  });

  test('the I1-I5 group uses the frozen corpus with per-case tools.disable and the oracle transcript module', () => {
    expect(runnerSource).toContain('conversational-interleaving-corpus.json');
    expect(runnerSource).toContain('loadConversationalInterleavingCorpus');
    expect(runnerSource).toContain('buildPrivacySafeReport');
    expect(runnerSource).toContain('corpusCase.tools.disable');
    expect(runnerSource).toContain('interactive-ui-conversation-transcript.ts');
  });

  test('the frozen corpus is never written', () => {
    expect(runnerSource).toMatch(/interleavingCorpusPath/);
    expect(runnerSource).not.toMatch(/writeFile\([^)]*interleavingCorpusPath/);
    expect(runnerSource.match(/writeFile\(reportPath/g) ?? []).toHaveLength(2);
  });

  test('reports use the v2 schema', () => {
    expect(runnerSource).toContain("export const REPORT_SCHEMA = 'openchamber://interactive-ui-model-routing-report/v2'");
    expect(runnerSource).toContain("$schema: REPORT_SCHEMA");
  });
});
