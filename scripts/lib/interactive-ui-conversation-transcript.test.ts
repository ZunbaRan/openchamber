import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { parseAllShowWidgets } from '../../packages/ui/src/lib/generative-widget/parseShowWidget.ts';
import corpusJson from '../../examples/interactive-ui/conversational-interleaving-corpus.json';
import {
  CONVERSATIONAL_CORPUS_CASE_IDS,
  buildPrivacySafeReport,
  evaluateInterleavingExpectation,
  isMeaningfulText,
  loadConversationalInterleavingCorpus,
  normalizeAssistantTranscript,
  projectPrivacySafeEvidence,
  validateConversationalInterleavingCorpus,
  type CorpusCaseId,
  type FinalizedAssistantMessage,
  type InterleavingExpectation,
} from './interactive-ui-conversation-transcript.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (deterministic, synthetic demo content only — the frozen
// corpus is the plan/model-runner input schema and never stores transcripts)
// ---------------------------------------------------------------------------

const textPart = (partId: string, text: string): FinalizedAssistantMessage['parts'][number] => ({
  partId,
  type: 'text',
  text,
});

const toolPart = (
  partId: string,
  tool: string,
  state: { status: 'pending' | 'running' | 'completed' | 'error'; input?: Record<string, unknown>; output?: string; error?: string },
  metadata?: Record<string, unknown>,
): FinalizedAssistantMessage['parts'][number] => ({ partId, type: 'tool', tool, state, ...(metadata ? { metadata } : {}) });

const interactiveOutput = (view: string, mode: 'snapshot' | 'live' = 'snapshot', extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ $schema: 'openchamber://interactive-result/v1', view, schemaVersion: 1, mode, ...extra });

const generatedHtmlOutput = (title: string): string =>
  JSON.stringify({
    $schema: 'openchamber://html-artifact-result/v1',
    schemaVersion: 1,
    title,
    html: '<div>demo-artifact</div>',
    capabilities: { scripts: false },
    display: { preferred: 'inline', allowExpand: true, inlineHeight: 240 },
  });

const installedHtmlOutput = (artifact: string): string =>
  JSON.stringify({ $schema: 'openchamber://installed-html-artifact-result/v1', schemaVersion: 1, artifact, mode: 'snapshot' });

const mcpAppMetadata = (): Record<string, unknown> => ({
  mcpApp: {
    server: 'demo-server',
    tool: 'demo_tool',
    toolKey: 'demo_tool',
    resourceUri: 'ui://demo',
    meta: { resourceUri: 'ui://demo' },
  },
});

const message = (messageId: string, parts: FinalizedAssistantMessage['parts']): FinalizedAssistantMessage => ({ messageId, parts });

const baseExpectation = (kind: InterleavingExpectation['kind']): InterleavingExpectation => ({ kind });

/** Deterministic finalized transcripts that satisfy the frozen corpus cases. */
const FIXTURES: Record<CorpusCaseId, readonly FinalizedAssistantMessage[]> = {
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
      textPart('p3', '接下来是 KV 缓存如何复用中间结果。'),
      toolPart('p4', 'interactive_ui', { status: 'completed', input: {}, output: interactiveOutput('generated-declarative') }),
    ]),
    message('m3', [textPart('p5', '两者结合后，生成阶段的推理延迟可以大幅下降。')]),
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
// Normalizer
// ---------------------------------------------------------------------------

describe('normalizeAssistantTranscript', () => {
  test('maps all three production result envelope kinds with matching sources', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        toolPart('p1', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
      ]),
      message('m2', [
        toolPart('p2', 'simple_crm_open_workspace', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.workspace', 'live') }),
      ]),
      message('m3', [
        toolPart('p3', 'html_artifact', { status: 'completed', output: generatedHtmlOutput('Demo Artifact') }),
      ]),
      message('m4', [
        toolPart('p4', 'simple_crm_open_explorer', { status: 'completed', output: installedHtmlOutput('com.demo.simple.crm.explorer') }),
      ]),
    ]);

    expect(evidence.visuals.map((visual) => `${visual.runtime}/${visual.source}`)).toEqual([
      'interactive-ui/agent-generated',
      'interactive-ui/installed',
      'html-artifact/agent-generated',
      'html-artifact/installed',
    ]);
    expect(evidence.visuals.map((visual) => visual.messageIndex)).toEqual([0, 1, 2, 3]);
    expect(evidence.visuals.every((visual) => visual.segmentIndex === 0)).toBe(true);
    expect(evidence.visuals.map((visual) => visual.partKey)).toEqual(['0:0', '1:0', '2:0', '3:0']);
  });

  test('classifies generic tools as presentation, installed envelopes as business, and read/bash as ordinary', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        toolPart('p1', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
        toolPart('p2', 'simple_crm_open_workspace', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.workspace', 'live') }),
        toolPart('p3', 'read', { status: 'completed', output: 'some file content' }),
        toolPart('p4', 'bash', { status: 'completed', output: 'ok' }),
        // A failed business call carries no installed envelope: ordinary.
        toolPart('p5', 'simple_crm_open_overview', { status: 'error', input: {}, error: 'denied' }),
      ]),
    ]);
    expect(evidence.toolCalls.map((call) => `${call.tool}:${call.classification}`)).toEqual([
      'interactive_ui:presentation',
      'simple_crm_open_workspace:business',
      'read:ordinary',
      'bash:ordinary',
      'simple_crm_open_overview:ordinary',
    ]);
    expect(evidence.counts.businessToolCalls).toBe(1);
  });

  test('pending, running, error, and malformed tool parts produce no successful visual but privacy-safe toolCalls', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        toolPart('p1', 'interactive_ui', { status: 'pending', input: {} }),
        toolPart('p2', 'interactive_ui', { status: 'running', input: {} }),
        toolPart('p3', 'simple_crm_open_workspace', { status: 'error', input: {}, error: 'boom' }),
        toolPart('p4', 'read', { status: 'completed', output: 'not an envelope' }),
      ]),
    ]);
    expect(evidence.visuals).toHaveLength(0);
    expect(evidence.toolCalls).toHaveLength(4);
    expect(evidence.toolCalls.map((call) => call.state)).toEqual(['pending', 'running', 'error', 'completed']);
    expect(evidence.toolCalls.map((call) => call.classification)).toEqual(['presentation', 'presentation', 'ordinary', 'ordinary']);
    // Privacy-safe shape: only name/state/classification + locations.
    for (const call of evidence.toolCalls) {
      expect(Object.keys(call).sort()).toEqual([
        'classification', 'messageId', 'messageIndex', 'partId', 'partIndex', 'partKey', 'segmentIndex', 'state', 'tool',
      ]);
    }
  });

  test('preserves message/part/segment order without timestamp sorting', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', 'before'),
        textPart('p2', '```show-widget\n{"widget_code":"<div>first</div>"}\n```'),
        textPart('p3', 'between'),
      ]),
      message('m2', [
        textPart('p4', '```show-widget\n{"widget_code":"<div>second</div>"}\n```'),
        textPart('p5', 'after'),
      ]),
    ]);

    const sequence = [
      ...evidence.texts.map((text) => ({ kind: 'text', ...text })),
      ...evidence.visuals.map((visual) => ({ kind: 'visual', ...visual })),
    ].sort((a, b) => (a as { messageIndex: number }).messageIndex - (b as { messageIndex: number }).messageIndex
      || (a as { partIndex: number }).partIndex - (b as { partIndex: number }).partIndex
      || (a as { segmentIndex: number }).segmentIndex - (b as { segmentIndex: number }).segmentIndex);

    expect(sequence.map((entry) => entry.kind)).toEqual([
      'text', 'visual', 'text', 'visual', 'text',
    ]);
    // Exact locations survive: messageId/partId/segmentIndex/partKey.
    const firstVisual = evidence.visuals[0];
    expect(firstVisual).toMatchObject({ messageId: 'm1', messageIndex: 0, partId: 'p2', partIndex: 1, segmentIndex: 0, partKey: '0:1' });
    const secondVisual = evidence.visuals[1];
    expect(secondVisual).toMatchObject({ messageId: 'm2', messageIndex: 1, partId: 'p4', partIndex: 0, segmentIndex: 0, partKey: '1:0' });
  });

  test('widget marker failures become stable-code malformed records', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', [
          '```show-widget\n{"widget_code":"<div>open</div>"}',
          '```show-widget\n{"widget_code":"<div>truncated</div>"',
        ].join('\n')),
      ]),
    ]);
    expect(evidence.visuals).toHaveLength(0);
    expect(evidence.malformedWidgets).toHaveLength(2);
    expect(evidence.malformedWidgets.map((record) => record.code).sort()).toEqual(['truncated-json', 'unclosed-fence']);
    expect(evidence.malformedWidgets.every((record) => record.messageId === 'm1' && record.partKey === '0:0')).toBe(true);
    expect(evidence.counts.malformedWidgets).toBe(2);
  });

  test('meaningful threshold requires at least two Unicode letters/numbers', () => {
    expect(isMeaningfulText('ab')).toBe(true);
    expect(isMeaningfulText('a1')).toBe(true);
    expect(isMeaningfulText('中文')).toBe(true);
    expect(isMeaningfulText('a')).toBe(false);
    expect(isMeaningfulText('1')).toBe(false);
    expect(isMeaningfulText('中')).toBe(false);
    expect(isMeaningfulText('🙂🙂')).toBe(false);
    expect(isMeaningfulText('   ')).toBe(false);
  });

  test('ignores whitespace-only text parts', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [textPart('p1', '   \n\t  '), textPart('p2', 'real text')]),
    ]);
    expect(evidence.texts).toHaveLength(1);
    expect(evidence.texts[0].partId).toBe('p2');
    expect(evidence.texts[0].meaningful).toBe(true);
  });

  test('MCP App parts never count as one of the four-track visuals', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        // Would parse as an interactive result, but the App binding excludes it.
        toolPart('p1', 'demo_tool', { status: 'completed', output: interactiveOutput('generated-declarative') }, mcpAppMetadata()),
      ]),
    ]);
    expect(evidence.visuals).toHaveLength(0);
    expect(evidence.counts.mcpApps).toBe(1);
    expect(evidence.counts.visuals).toBe(0);
    expect(evidence.toolCalls).toHaveLength(1);
    expect(evidence.toolCalls[0].classification).toBe('ordinary');
  });

  test('widget titles exist only in transient in-process evidence', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', '```show-widget\n{"title":"阶段总览","widget_code":"<div>stage-overview</div>"}\n```'),
      ]),
    ]);
    const widget = evidence.visuals.find((visual) => visual.runtime === 'show-widget');
    expect(widget?.widgetTitle).toBe('阶段总览');
    const projected = projectPrivacySafeEvidence(evidence);
    expect(projected.visuals.some((visual) => 'widgetTitle' in visual)).toBe(false);
    expect(projected.visuals[0]).not.toHaveProperty('widgetTitle');
  });

  test('rejects structurally invalid finalized messages (fail closed)', () => {
    expect(() => normalizeAssistantTranscript([{ parts: [] } as unknown as FinalizedAssistantMessage])).toThrow(/messageId/);
    expect(() => normalizeAssistantTranscript([
      message('m1', [{ partId: 'p1', type: 'image' } as unknown as FinalizedAssistantMessage['parts'][number]]),
    ])).toThrow(/unknown part type/);
    expect(() => normalizeAssistantTranscript([
      message('m1', [toolPart('p1', 'read', { status: 'finished' } as never)]),
    ])).toThrow(/status/);
  });
});

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

describe('evaluateInterleavingExpectation', () => {
  test('passes every frozen corpus case against its local fixture', () => {
    const validated = validateConversationalInterleavingCorpus(corpusJson);
    if (!validated.ok) throw new Error(`corpus must validate: ${validated.errors.join('; ')}`);
    for (const corpusCase of validated.corpus.cases) {
      const evidence = normalizeAssistantTranscript(FIXTURES[corpusCase.id]);
      const evaluation = evaluateInterleavingExpectation(evidence, corpusCase.expectation);
      expect(evaluation.passed, `${corpusCase.id} should pass: ${evaluation.diagnostics.join('; ')}`).toBe(true);
      expect(evaluation.codes).toEqual([]);
    }
  });

  test('text-visual-text requires meaningful text before and after the visual', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [textPart('p1', '```show-widget\n{"widget_code":"<div>x</div>"}\n```')]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, baseExpectation('text-visual-text'));
    expect(evaluation.codes.sort()).toEqual(['missing-text-after', 'missing-text-before']);
    expect(evaluation.diagnostics).toEqual(['missing-text-before', 'missing-text-after']);
  });

  test('multiple-visuals-with-text-between requires a meaningful bridge and final text', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        toolPart('p1', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
        toolPart('p2', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, baseExpectation('multiple-visuals-with-text-between'));
    expect(evaluation.codes.sort()).toEqual(['missing-text-after', 'missing-text-between']);
    expect(evaluation.diagnostics).toContain('missing-text-between:gap=0');
  });

  test('multiple-widgets-in-one-text-part rejects split parts, non-widget visuals, and wrong title order', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', '```show-widget\n{"title":"B","widget_code":"<div>b</div>"}\n```'),
      ]),
      message('m2', [
        textPart('p2', '```show-widget\n{"title":"A","widget_code":"<div>a</div>"}\n```'),
        toolPart('p3', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('multiple-widgets-in-one-text-part'),
      expectedWidgetTitlesInOrder: ['A', 'B'],
    });
    expect(evaluation.widgetTitlesMatched).toBe(false);
    expect(evaluation.codes).toContain('widget-title-order-mismatch');
    expect(evaluation.codes).toContain('widgets-in-multiple-parts');
    expect(evaluation.codes).toContain('non-widget-visual');
  });

  test('single-business-view rejects generated sources, missing and duplicate business calls', () => {
    const generated = normalizeAssistantTranscript([
      message('m1', [toolPart('p1', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') })]),
    ]);
    const generatedEvaluation = evaluateInterleavingExpectation(generated, baseExpectation('single-business-view'));
    expect(generatedEvaluation.codes).toContain('business-view-not-installed');
    expect(generatedEvaluation.codes).toContain('missing-business-call');

    // Failed duplicate accepted business calls still count toward duplicates.
    const duplicated = normalizeAssistantTranscript([
      message('m1', [
        toolPart('p1', 'simple_crm_open_workspace', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.workspace', 'live') }),
        toolPart('p2', 'simple_crm_open_workspace', { status: 'error', input: {}, error: 'denied' }),
      ]),
    ]);
    const duplicateEvaluation = evaluateInterleavingExpectation(duplicated, {
      ...baseExpectation('single-business-view'),
      acceptedToolNames: ['simple_crm_open_workspace'],
    });
    expect(duplicateEvaluation.codes).toContain('duplicate-business-call');
    expect(duplicateEvaluation.codes).not.toContain('visual-count-mismatch');
    expect(duplicateEvaluation.codes).not.toContain('missing-business-call');

    const none = normalizeAssistantTranscript([message('m1', [textPart('p1', 'no view here')])]);
    const noneEvaluation = evaluateInterleavingExpectation(none, baseExpectation('single-business-view'));
    expect(noneEvaluation.codes).toContain('visual-count-mismatch');
    expect(noneEvaluation.codes).toContain('missing-business-call');
  });

  test('unrelated ordinary tools are tolerated by single-business-view and accepted allowlists', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', 'reading files first'),
        toolPart('p2', 'read', { status: 'completed', output: 'file content' }),
        toolPart('p3', 'bash', { status: 'completed', output: 'ok' }),
        toolPart('p4', 'simple_crm_open_workspace', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.workspace', 'live') }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('single-business-view'),
      acceptedToolNames: ['simple_crm_open_workspace'],
    });
    expect(evaluation.passed).toBe(true);
    expect(evaluation.codes).toEqual([]);
  });

  test('no-visual rejects unexpected visuals and presentation tool calls, including failed calls', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', '```show-widget\n{"widget_code":"<div>x</div>"}\n```'),
        toolPart('p2', 'interactive_ui', { status: 'error', input: {}, error: 'denied' }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, baseExpectation('no-visual'));
    expect(evaluation.codes).toContain('unexpected-visual');
    expect(evaluation.codes).toContain('presentation-tool-call');
  });

  test('a forbidden tool call violates even when the call failed', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [toolPart('p1', 'html_artifact', { status: 'error', input: {}, error: 'failed' })]),
    ]);
    expect(evidence.visuals).toHaveLength(0);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('no-visual'),
      forbiddenToolNames: ['html_artifact'],
    });
    expect(evaluation.codes).toContain('forbidden-tool-call');
  });

  test('count bounds, tool-visual limits, malformed limits, meaningful-text and allowlists', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p0', 'intro text'),
        textPart('p1', '```show-widget\n{"widget_code":"<div>x</div>"}\n```'),
        textPart('p2', '```show-widget\n{"widget_code":"<div>broken</div>"'),
        toolPart('p3', 'interactive_ui', { status: 'completed', output: interactiveOutput('generated-declarative') }),
        toolPart('p4', 'read', { status: 'completed', output: 'ordinary output' }),
        toolPart('p5', 'simple_crm_open_overview', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.overview', 'live') }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('text-visual-text'),
      minVisuals: 4,
      maxVisuals: 1,
      exactVisuals: 1,
      allowedVisuals: [{ runtime: 'show-widget', source: 'assistant-text' }],
      acceptedToolNames: ['interactive_ui'],
      maxToolVisuals: 0,
      requireMeaningfulText: true,
      maxMalformedWidgets: 0,
    });
    expect(evaluation.codes).toContain('visual-count-mismatch');
    expect(evaluation.codes).toContain('visual-count-below-min');
    expect(evaluation.codes).toContain('visual-count-above-max');
    expect(evaluation.codes).toContain('disallowed-visual');
    // Only the business-classified call is held to the accepted allowlist.
    expect(evaluation.codes).toContain('unaccepted-tool-call');
    expect(evaluation.codes).toContain('tool-visual-over-limit');
    expect(evaluation.codes).toContain('malformed-widget-over-limit');
    expect(evaluation.codes).not.toContain('meaningful-text-required');
  });

  test('requires meaningful text when requireMeaningfulText is set', () => {
    const evidence = normalizeAssistantTranscript([
      message('m1', [textPart('p1', '```show-widget\n{"widget_code":"<div>x</div>"}\n```')]),
    ]);
    // The only text segment is the widget fence itself (no letters before/after).
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('text-visual-text'),
      requireMeaningfulText: true,
    });
    expect(evaluation.codes).toContain('meaningful-text-required');
  });

  test('widget titles match in order on the I3 fixture', () => {
    const validated = validateConversationalInterleavingCorpus(corpusJson);
    if (!validated.ok) throw new Error('corpus must validate');
    const i3 = validated.corpus.cases.find((corpusCase) => corpusCase.id === 'I3');
    if (!i3) throw new Error('I3 missing');
    const evaluation = evaluateInterleavingExpectation(normalizeAssistantTranscript(FIXTURES.I3), i3.expectation);
    expect(evaluation.widgetTitlesMatched).toBe(true);
    expect(evaluation.codes).toEqual([]);
  });

  test('safe diagnostics carry only stable codes, indexes, and runtime/source labels', () => {
    const sensitive = ['阶段总览', 'simple_crm_open_workspace', 'generated-declarative'];
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', '```show-widget\n{"title":"阶段总览","widget_code":"<div>stage-overview</div>"}\n```'),
        textPart('p2', '```show-widget\n{"widget_code":"<div>broken</div>"'),
        toolPart('p3', 'simple_crm_open_workspace', { status: 'completed', output: interactiveOutput('com.demo.simple.crm.workspace', 'live') }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('single-business-view'),
      allowedVisuals: [{ runtime: 'interactive-ui', source: 'installed' }],
      forbiddenToolNames: ['interactive_ui'],
      expectedWidgetTitlesInOrder: ['其他标题'],
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.diagnostics.length).toBeGreaterThan(0);
    const pattern = /^[a-z0-9-]+(:[a-z0-9=./-]+)*$/;
    for (const diagnostic of evaluation.diagnostics) {
      expect(diagnostic, diagnostic).toMatch(pattern);
      for (const raw of sensitive) expect(diagnostic, diagnostic).not.toContain(raw);
    }
  });
});

// ---------------------------------------------------------------------------
// Corpus validator
// ---------------------------------------------------------------------------

describe('validateConversationalInterleavingCorpus', () => {
  const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  test('accepts the frozen corpus with exact unique IDs I1-I5 and object allowlists', async () => {
    const validated = validateConversationalInterleavingCorpus(corpusJson);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.corpus.cases.map((corpusCase) => corpusCase.id)).toEqual([...CONVERSATIONAL_CORPUS_CASE_IDS]);
      for (const corpusCase of validated.corpus.cases) {
        expect(Object.keys(corpusCase).sort()).toEqual(['expectation', 'id', 'locale', 'prompt', 'tools']);
        expect(corpusCase.tools).toHaveProperty('disable');
        for (const allowed of corpusCase.expectation.allowedVisuals ?? []) {
          expect(typeof allowed).toBe('object');
          expect(allowed).toHaveProperty('runtime');
          expect(allowed).toHaveProperty('source');
        }
      }
    }
    const loaded = await loadConversationalInterleavingCorpus(
      path.resolve(import.meta.dir, '../../examples/interactive-ui/conversational-interleaving-corpus.json'),
    );
    expect(loaded.ok).toBe(true);
  });

  test('rejects duplicate, missing, and extra case ids', () => {
    const duplicated = clone(corpusJson) as { cases: Array<{ id: string }> };
    duplicated.cases[1].id = 'I1';
    const duplicateResult = validateConversationalInterleavingCorpus(duplicated);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) expect(duplicateResult.errors.join('; ')).toContain('duplicate case id "I1"');

    const missing = clone(corpusJson) as { cases: Array<{ id: string }> };
    missing.cases = missing.cases.filter((corpusCase) => corpusCase.id !== 'I5');
    const missingResult = validateConversationalInterleavingCorpus(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.errors.join('; ')).toContain('missing required case id "I5"');

    const extra = clone(corpusJson) as { cases: Array<{ id: string }> };
    extra.cases[4].id = 'I6';
    const extraResult = validateConversationalInterleavingCorpus(extra);
    expect(extraResult.ok).toBe(false);
    if (!extraResult.ok) expect(extraResult.errors.join('; ')).toContain('unexpected case id "I6"');
  });

  test('rejects unknown keys at corpus, case, tools, and expectation levels', () => {
    const cases: Array<{ label: string; mutate: (value: Record<string, unknown>) => void }> = [
      { label: 'root', mutate: (root) => { root.extra = 1; } },
      { label: 'case', mutate: (root) => { ((root.cases as unknown[])[0] as Record<string, unknown>).extra = 1; } },
      { label: 'tools', mutate: (root) => { (((root.cases as unknown[])[0] as Record<string, unknown>).tools as Record<string, unknown>).extra = 1; } },
      { label: 'expectation', mutate: (root) => { (((root.cases as unknown[])[0] as Record<string, unknown>).expectation as Record<string, unknown>).extra = 1; } },
    ];
    for (const { label, mutate } of cases) {
      const modified = clone(corpusJson) as Record<string, unknown>;
      mutate(modified);
      const result = validateConversationalInterleavingCorpus(modified);
      expect(result.ok, `${label}: ${result.ok ? 'unexpectedly ok' : result.errors.join('; ')}`).toBe(false);
      if (!result.ok) expect(result.errors.join('; ')).toContain(`unknown key "extra"`);
    }
  });

  test('rejects contradictory and out-of-bounds counts', () => {
    const mutateExpectation = (mutate: (expectation: Record<string, unknown>) => void) => {
      const modified = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
      mutate(modified.cases[0].expectation);
      return validateConversationalInterleavingCorpus(modified);
    };
    const expectInvalid = (result: { ok: boolean; errors?: readonly string[] }, fragment: string) => {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join('; '), result.errors.join('; ')).toContain(fragment);
    };

    expectInvalid(mutateExpectation((expectation) => { expectation.minVisuals = 5; expectation.maxVisuals = 2; }), 'exceeds maxVisuals');
    expectInvalid(mutateExpectation((expectation) => { expectation.exactVisuals = 2; expectation.minVisuals = 1; }), 'mutually exclusive');
    expectInvalid(mutateExpectation((expectation) => { expectation.minVisuals = -1; }), 'non-negative integer');
    expectInvalid(mutateExpectation((expectation) => { expectation.maxVisuals = 1.5; }), 'non-negative integer');
    expectInvalid(mutateExpectation((expectation) => { expectation.maxToolVisuals = -2; }), 'non-negative integer');
    expectInvalid(mutateExpectation((expectation) => { expectation.maxMalformedWidgets = '0'; }), 'non-negative integer');

    const noVisual = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
    noVisual.cases[4].expectation.exactVisuals = 3;
    const noVisualResult = validateConversationalInterleavingCorpus(noVisual);
    expect(noVisualResult.ok).toBe(false);
    if (!noVisualResult.ok) expect(noVisualResult.errors.join('; ')).toContain('no-visual requires exactVisuals 0');

    const single = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
    single.cases[3].expectation.exactVisuals = 2;
    const singleResult = validateConversationalInterleavingCorpus(single);
    expect(singleResult.ok).toBe(false);
    if (!singleResult.ok) expect(singleResult.errors.join('; ')).toContain('single-business-view requires exactVisuals 1');
  });

  test('allowedVisuals must be {runtime, source} objects with valid, unique pairings', () => {
    const mutateAllowedVisuals = (allowedVisuals: unknown[]) => {
      const modified = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
      modified.cases[0].expectation.allowedVisuals = allowedVisuals;
      return validateConversationalInterleavingCorpus(modified);
    };
    const expectInvalid = (result: { ok: boolean; errors?: readonly string[] }) => {
      expect(result.ok).toBe(false);
    };
    // String entries are rejected: the allowlist is object-shaped.
    expectInvalid(mutateAllowedVisuals(['show-widget/assistant-text']));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'show-widget', source: 'installed' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'interactive-ui', source: 'assistant-text' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'unknown-runtime', source: 'agent-generated' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'interactive-ui', source: 'unknown-source' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'show-widget' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'show-widget', source: 'assistant-text' }, { runtime: 'show-widget', source: 'assistant-text' }]));
    expectInvalid(mutateAllowedVisuals([{ runtime: 'show-widget', source: 'assistant-text', extra: 1 }]));
  });

  test('rejects tool allowlist violations and widget-title incompatibility', () => {
    const modified = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
    modified.cases[0].expectation.acceptedToolNames = ['read', 'read'];
    const duplicateResult = validateConversationalInterleavingCorpus(modified);
    expect(duplicateResult.ok).toBe(false);

    modified.cases[0].expectation.acceptedToolNames = ['read'];
    modified.cases[0].expectation.forbiddenToolNames = ['read'];
    const overlapResult = validateConversationalInterleavingCorpus(modified);
    expect(overlapResult.ok).toBe(false);
    if (!overlapResult.ok) expect(overlapResult.errors.join('; ')).toContain('both accepted and forbidden');

    const titles = clone(corpusJson) as { cases: Array<{ expectation: Record<string, unknown> }> };
    titles.cases[4].expectation.expectedWidgetTitlesInOrder = ['x'];
    const titlesResult = validateConversationalInterleavingCorpus(titles);
    expect(titlesResult.ok).toBe(false);
    if (!titlesResult.ok) expect(titlesResult.errors.join('; ')).toContain('only compatible with');
  });

  test('validates tools.disable on every case and the I3 frozen disable list', () => {
    const withoutTools = clone(corpusJson) as { cases: Array<{ id: string; tools?: unknown }> };
    delete withoutTools.cases[0].tools;
    const missingResult = validateConversationalInterleavingCorpus(withoutTools);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.errors.join('; ')).toContain('tools: expected an object');

    const badShape = clone(corpusJson) as { cases: Array<{ id: string; tools: { disable: unknown } }> };
    badShape.cases[1].tools.disable = 'interactive_ui';
    const badShapeResult = validateConversationalInterleavingCorpus(badShape);
    expect(badShapeResult.ok).toBe(false);
    if (!badShapeResult.ok) expect(badShapeResult.errors.join('; ')).toContain('.disable: expected an array');

    const duplicated = clone(corpusJson) as { cases: Array<{ id: string; tools: { disable: string[] } }> };
    duplicated.cases[2].tools.disable = ['interactive_ui', 'html_artifact', 'interactive_ui'];
    const duplicatedResult = validateConversationalInterleavingCorpus(duplicated);
    expect(duplicatedResult.ok).toBe(false);
    if (!duplicatedResult.ok) expect(duplicatedResult.errors.join('; ')).toContain('duplicate value "interactive_ui"');

    const badDisabled = clone(corpusJson) as { cases: Array<{ id: string; tools: { disable: string[] } }> };
    badDisabled.cases[2].tools.disable = ['simple_crm_open_workspace'];
    const badDisabledResult = validateConversationalInterleavingCorpus(badDisabled);
    expect(badDisabledResult.ok).toBe(false);
    if (!badDisabledResult.ok) {
      const joined = badDisabledResult.errors.join('; ');
      expect(joined).toContain('I3 must disable "interactive_ui"');
      expect(joined).toContain('I3 must disable "html_artifact"');
    }

    const drifted = clone(corpusJson) as { cases: Array<{ id: string; tools: { disable: string[] }; expectation: { forbiddenToolNames: string[] } }> };
    drifted.cases[2].expectation.forbiddenToolNames = ['interactive_ui', 'html_artifact'];
    const driftedResult = validateConversationalInterleavingCorpus(drifted);
    expect(driftedResult.ok).toBe(false);
    if (!driftedResult.ok) expect(driftedResult.errors.join('; ')).toContain('must be listed in expectation.forbiddenToolNames');
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('privacy-safe projection', () => {
  /** Collect every string leaf in a JSON value (recursive). */
  const stringLeaves = (value: unknown, into: string[] = []): string[] => {
    if (typeof value === 'string') into.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => stringLeaves(entry, into));
    else if (value && typeof value === 'object') Object.values(value).forEach((entry) => stringLeaves(entry, into));
    return into;
  };

  test('report and evidence projections retain no raw corpus prompts or fixture content', () => {
    const validated = validateConversationalInterleavingCorpus(corpusJson);
    if (!validated.ok) throw new Error('corpus must validate');

    // Threat list: corpus prompts + every raw string in the local fixtures.
    const sensitive: string[] = validated.corpus.cases.map((corpusCase) => corpusCase.prompt);
    for (const corpusCase of validated.corpus.cases) {
      for (const assistantMessage of FIXTURES[corpusCase.id]) {
        for (const part of assistantMessage.parts) {
          if (part.type === 'text') {
            sensitive.push(part.text);
            for (const segment of parseAllShowWidgets(part.text, { mode: 'finalized-strict' })) {
              if (segment.type === 'widget') {
                if (segment.data.title) sensitive.push(segment.data.title);
                sensitive.push(segment.data.widget_code);
              }
            }
          } else if (part.type === 'tool') {
            if (typeof part.state.output === 'string') sensitive.push(part.state.output);
            if (part.state.input) sensitive.push(JSON.stringify(part.state.input));
          }
        }
      }
      if (corpusCase.expectation.expectedWidgetTitlesInOrder) {
        sensitive.push(...corpusCase.expectation.expectedWidgetTitlesInOrder);
      }
    }
    const distinctSensitive = [...new Set(sensitive)].filter((value) => value.trim().length >= 2);
    expect(distinctSensitive.length).toBeGreaterThan(10);

    const reports: Array<{ id: string; evaluation: ReturnType<typeof evaluateInterleavingExpectation> }> = [];
    const projectedLeaves: string[] = [];
    for (const corpusCase of validated.corpus.cases) {
      const evidence = normalizeAssistantTranscript(FIXTURES[corpusCase.id]);
      const evaluation = evaluateInterleavingExpectation(evidence, corpusCase.expectation);
      reports.push({ id: corpusCase.id, evaluation });
      const projected = projectPrivacySafeEvidence(evidence);
      // Transient widget titles must be gone from the projected evidence.
      for (const visual of projected.visuals) expect(visual).not.toHaveProperty('widgetTitle');
      stringLeaves(projected, projectedLeaves);
    }

    const report = buildPrivacySafeReport({
      corpusId: 'conversational-interleaving-corpus/v1',
      cases: reports,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const reportLeaves: string[] = [];
    stringLeaves(report, reportLeaves);

    for (const raw of distinctSensitive) {
      for (const leaf of [...projectedLeaves, ...reportLeaves]) {
        expect(leaf, `projection must not contain raw content`).not.toContain(raw);
      }
    }
    // The report only ever exposes the boolean, never the titles.
    for (const caseReport of report.cases) {
      const expectedKeys = caseReport.id === 'I3'
        ? ['codes', 'counts', 'diagnostics', 'id', 'passed', 'widgetTitlesMatched']
        : ['codes', 'counts', 'diagnostics', 'id', 'passed'];
      expect(Object.keys(caseReport).sort()).toEqual(expectedKeys);
    }
    expect(report.cases.find((caseReport) => caseReport.id === 'I3')?.widgetTitlesMatched).toBe(true);
    expect(JSON.stringify(report)).not.toContain('阶段总览');
    expect(JSON.stringify(report)).not.toContain('奖励闭环');
  });

  test('business rows and secrets inside tool envelopes never reach evidence or reports', () => {
    const secretRow = 'acme-corp-secret-row-42';
    const secretQuery = 'SELECT * FROM customers WHERE name = "secret-account"';
    const secretPhrase = 'top-secret-conversation-fragment';
    const evidence = normalizeAssistantTranscript([
      message('m1', [
        textPart('p1', `intro ${secretPhrase}`),
        toolPart('p2', 'simple_crm_open_workspace', {
          status: 'completed',
          input: { query: secretQuery },
          output: interactiveOutput('com.demo.simple.crm.workspace', 'live', {
            data: { opportunities: [{ id: 'opp-1', customer: secretRow }] },
          }),
        }),
      ]),
    ]);
    const evaluation = evaluateInterleavingExpectation(evidence, {
      ...baseExpectation('single-business-view'),
      acceptedToolNames: ['simple_crm_open_workspace'],
    });
    const projected = projectPrivacySafeEvidence(evidence);
    const report = buildPrivacySafeReport({
      corpusId: 'privacy-probe',
      cases: [{ id: 'probe', evaluation }],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const serialized = JSON.stringify({ projected, report });
    for (const secret of [secretRow, secretQuery, secretPhrase]) {
      expect(serialized).not.toContain(secret);
    }
    expect(evidence.visuals).toHaveLength(1);
    expect(evidence.visuals[0].runtime).toBe('interactive-ui');
  });
});
