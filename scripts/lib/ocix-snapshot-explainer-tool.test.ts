import { describe, expect, mock, test } from 'bun:test';

/**
 * The @opencode-ai/plugin package is provided by the OpenCode host at runtime
 * and is not installed in this repository. The Tool source keeps its real
 * import; the test supplies a minimal chainable schema mock before the
 * dynamic import so the module-level `tool({...})` call executes unchanged.
 */
interface ToolDefinition {
  description: string;
  args: unknown;
  execute: (rawArgs: unknown) => string;
}

type ToolMock = ((definition: ToolDefinition) => ToolDefinition) & {
  schema: Record<string, (value?: unknown) => unknown>;
};

const chainable = (value: unknown) => ({
  value,
  optional: () => chainable(value),
  describe: () => chainable(value),
  max: () => chainable(value),
});

const toolMock: ToolMock = mock((definition: ToolDefinition) => ({ ...definition }));
toolMock.schema = {
  enum: (values?: unknown) => chainable(values),
  object: (fields?: unknown) => chainable(fields),
  string: () => chainable(null),
  number: () => chainable(null),
  boolean: () => chainable(null),
  array: () => chainable(null),
  union: () => chainable(null),
};

mock.module('@opencode-ai/plugin', () => ({ tool: toolMock }));

const toolModule = await import('../../examples/interactive-ui/trusted-snapshot-explainer/agent-runtime/tools/ocix_explain_trust_pipeline.ts');

const {
  buildSnapshotExplainerResult,
  normalizeExplainerArgs,
  FOCUS_VALUES,
  DEPTH_VALUES,
  EXPLAINER_VIEW_ID,
  EXPLAINER_DATA_SCHEMA,
  EXPLAINER_FIXTURE_ID,
  CONTENT_BOUNDS,
} = toolModule;

const defaultTool = toolModule.default as ToolDefinition;
const INTERACTIVE_RESULT_SCHEMA = 'openchamber://interactive-result/v1';

const FORBIDDEN_ENVELOPE_KEYS = new Set([
  'dataRef', 'updatedAt', 'connector', 'action', 'credential', 'credentials',
  'token', 'gateway', 'dashboard', 'fetch', 'websocket', 'eventsource',
]);
const URL_PATTERN = /https?:\/\/|www\./;
const LIVE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const parseEnvelope = (raw: unknown) => {
  const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  expect(envelope).toBeTypeOf('object');
  return envelope;
};

const walkForbidden = (node: unknown, path: string): void => {
  if (typeof node === 'string') {
    expect(node, `${path} string must not contain a URL`).not.toMatch(URL_PATTERN);
    expect(node, `${path} string must not be a live timestamp`).not.toMatch(LIVE_TIMESTAMP_PATTERN);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walkForbidden(entry, `${path}[${index}]`));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    expect(FORBIDDEN_ENVELOPE_KEYS.has(key), `${path}.${key} is a forbidden authority/live key`).toBe(false);
    walkForbidden(value, `${path}.${key}`);
  }
};

const expectBoundData = (envelope: Record<string, unknown>, focus: string, depth: string) => {
  expect(envelope.$schema).toBe(INTERACTIVE_RESULT_SCHEMA);
  expect(envelope.view).toBe(EXPLAINER_VIEW_ID);
  expect(envelope.schemaVersion).toBe(1);
  expect(envelope.mode).toBe('snapshot');
  expect(envelope.context).toEqual({ focus, depth });
  expect(typeof envelope.summary).toBe('string');
  expect(envelope.summary).toContain('Installed snapshot-explainer example');
  expect(envelope.summary).toContain('not live data');

  const data = envelope.data as Record<string, unknown>;
  expect(data.$schema).toBe(EXPLAINER_DATA_SCHEMA);
  expect(data.schemaVersion).toBe(1);
  expect(data.live).toBe(false);
  expect(typeof data.title).toBe('string');
  expect(typeof data.thesis).toBe('string');
  expect(Array.isArray(data.notes)).toBe(true);

  const source = data.source as Record<string, unknown>;
  expect(source).toEqual({
    kind: 'bundled-fixture',
    authority: 'generated',
    fixtureId: EXPLAINER_FIXTURE_ID,
    fixtureVersion: 1,
    label: 'OCIX trust pipeline · bundled deterministic fixture',
  });

  const stages = data.stages as Array<Record<string, unknown>>;
  expect(stages.length).toBeGreaterThanOrEqual(CONTENT_BOUNDS.minStages);
  expect(stages.length).toBeLessThanOrEqual(CONTENT_BOUNDS.maxStages);
  const ids = new Set<string>();
  let totalText = 0;
  for (const stage of stages) {
    expect(typeof stage.id).toBe('string');
    expect(stage.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(ids.has(stage.id as string)).toBe(false);
    ids.add(stage.id as string);
    expect((stage.title as string).length).toBeGreaterThanOrEqual(1);
    expect((stage.title as string).length).toBeLessThanOrEqual(CONTENT_BOUNDS.stageTitle);
    expect((stage.body as string).length).toBeGreaterThanOrEqual(1);
    expect((stage.body as string).length).toBeLessThanOrEqual(CONTENT_BOUNDS.stageBody);
    const points = stage.points as string[];
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(CONTENT_BOUNDS.maxPoints);
    for (const point of points) {
      expect(typeof point).toBe('string');
      expect(point.length).toBeGreaterThanOrEqual(1);
      expect(point.length).toBeLessThanOrEqual(CONTENT_BOUNDS.point);
    }
  }
  const notes = data.notes as string[];
  expect(notes.length).toBeLessThanOrEqual(CONTENT_BOUNDS.maxNotes);
  for (const note of notes) {
    expect(typeof note).toBe('string');
    expect(note.length).toBeGreaterThanOrEqual(1);
    expect(note.length).toBeLessThanOrEqual(CONTENT_BOUNDS.note);
  }
  const collectText = (node: unknown): void => {
    if (typeof node === 'string') {
      totalText += node.length;
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) collectText(entry);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const value of Object.values(node)) collectText(value);
    }
  };
  collectText(data);
  expect(totalText).toBeLessThanOrEqual(CONTENT_BOUNDS.totalText);
};

describe('ocix_explain_trust_pipeline snapshot builder', () => {
  test('produces a deterministic Interactive Result for every focus/depth combination', () => {
    for (const focus of FOCUS_VALUES) {
      for (const depth of DEPTH_VALUES) {
        const args = { focus, depth };
        const first = buildSnapshotExplainerResult(args);
        const second = buildSnapshotExplainerResult({ ...args });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        const envelope = parseEnvelope(first);
        expectBoundData(envelope, focus, depth);
        walkForbidden(envelope, 'envelope');
      }
    }
  });

  test('applies documented defaults when arguments are absent', () => {
    expect(normalizeExplainerArgs(undefined)).toEqual({ focus: 'overview', depth: 'detailed' });
    expect(normalizeExplainerArgs({})).toEqual({ focus: 'overview', depth: 'detailed' });
    expect(normalizeExplainerArgs({ focus: 'replay' })).toEqual({ focus: 'replay', depth: 'detailed' });
    expect(normalizeExplainerArgs({ depth: 'quick' })).toEqual({ focus: 'overview', depth: 'quick' });
    const envelope = parseEnvelope(buildSnapshotExplainerResult(undefined));
    expect(envelope.context).toEqual({ focus: 'overview', depth: 'detailed' });
  });

  test('returns byte-identical results across independent invocations with no shared mutable state', () => {
    const original = buildSnapshotExplainerResult({ focus: 'signature', depth: 'detailed' });
    (original.data as Record<string, unknown>).title = 'mutated';
    const fresh = buildSnapshotExplainerResult({ focus: 'signature', depth: 'detailed' });
    expect(fresh).not.toBe(original);
    expect((fresh.data as Record<string, unknown>).title).not.toBe('mutated');
  });

  test('produces a fresh serializable envelope object for every call', () => {
    for (const focus of FOCUS_VALUES) {
      const raw = buildSnapshotExplainerResult({ focus });
      expect(typeof raw).toBe('object');
      const envelope = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      expect(Object.keys(envelope).sort()).toEqual(['$schema', 'context', 'data', 'mode', 'schemaVersion', 'summary', 'view']);
      expect(Object.keys(envelope.data as Record<string, unknown>).sort())
        .toEqual(['$schema', 'live', 'notes', 'schemaVersion', 'source', 'stages', 'thesis', 'title']);
    }
  });

  test('rejects unknown keys', () => {
    expect(() => buildSnapshotExplainerResult({ focus: 'overview', extra: 1 })).toThrow(/unknown argument: extra/);
    expect(() => buildSnapshotExplainerResult({ depth: 'quick', mode: 'live' })).toThrow(/unknown argument: mode/);
    expect(() => normalizeExplainerArgs({ '': 'x' })).toThrow(/unknown argument/);
  });

  test('rejects invalid enum values and missing/undefined values without coercion', () => {
    expect(() => buildSnapshotExplainerResult({ focus: 'bogus' })).toThrow(/focus must be one of/);
    expect(() => buildSnapshotExplainerResult({ depth: 'full' })).toThrow(/depth must be one of/);
    expect(() => buildSnapshotExplainerResult({ focus: 1 })).toThrow(/focus must be one of/);
    expect(() => buildSnapshotExplainerResult({ depth: ['quick'] })).toThrow(/depth must be one of/);
    expect(() => buildSnapshotExplainerResult({ focus: 'OVERVIEW' })).toThrow(/focus must be one of/);
    expect(() => buildSnapshotExplainerResult({ focus: undefined })).toThrow(/focus must be one of/);
    expect(() => buildSnapshotExplainerResult({ depth: null })).toThrow(/depth must be one of/);
    expect(() => buildSnapshotExplainerResult({ focus: 'overview', depth: '' })).toThrow(/depth must be one of/);
  });

  test('rejects non-plain objects', () => {
    expect(() => buildSnapshotExplainerResult([])).toThrow(/plain object/);
    expect(() => buildSnapshotExplainerResult('overview')).toThrow(/plain object/);
    expect(() => buildSnapshotExplainerResult(42)).toThrow(/plain object/);
    expect(() => buildSnapshotExplainerResult(new Date())).toThrow(/plain object/);
    expect(() => buildSnapshotExplainerResult(new Map([['focus', 'overview']]))).toThrow(/plain object/);
    expect(() => buildSnapshotExplainerResult({ focus: 'overview' } as unknown)).not.toThrow();

    class Args {
      focus = 'overview';
    }
    expect(() => buildSnapshotExplainerResult(new Args())).toThrow(/plain object/);

    const customProto = Object.create({ inherited: true });
    customProto.focus = 'overview';
    expect(() => buildSnapshotExplainerResult(customProto)).toThrow(/plain object/);

    const nullProto = Object.create(null);
    nullProto.focus = 'signature';
    expect(normalizeExplainerArgs(nullProto)).toEqual({ focus: 'signature', depth: 'detailed' });
  });

  test('rejects accessor properties and prototype/symbol tricks', () => {
    const accessor = {};
    Object.defineProperty(accessor, 'focus', { get: () => 'overview', enumerable: true });
    expect(() => buildSnapshotExplainerResult(accessor)).toThrow(/plain data property/);

    const protoKey = {};
    Object.defineProperty(protoKey, '__proto__', { value: 'polluted', enumerable: true });
    expect(() => buildSnapshotExplainerResult(protoKey)).toThrow(/unknown argument/);

    const constructorKey = {};
    Object.defineProperty(constructorKey, 'constructor', { value: 'x', enumerable: true });
    expect(() => buildSnapshotExplainerResult(constructorKey)).toThrow(/unknown argument/);

    const symbolKey = { focus: 'overview' };
    (symbolKey as Record<symbol, unknown>)[Symbol('extra')] = true;
    expect(() => buildSnapshotExplainerResult(symbolKey)).toThrow(/symbol keys/);

    const nonEnumerable = { focus: 'overview' };
    Object.defineProperty(nonEnumerable, 'depth', { value: 'quick', enumerable: false });
    expect(() => buildSnapshotExplainerResult(nonEnumerable)).toThrow(/plain data property/);
  });

  test('default handler only serializes the pure builder', () => {
    expect(typeof defaultTool.description).toBe('string');
    expect(defaultTool.args).toBeTruthy();
    expect(defaultTool.execute(undefined)).toBe(JSON.stringify(buildSnapshotExplainerResult(undefined)));
    expect(defaultTool.execute({ focus: 'signature' })).toBe(JSON.stringify(buildSnapshotExplainerResult({ focus: 'signature' })));
    expect(defaultTool.execute({ focus: 'installation', depth: 'quick' }))
      .toBe(JSON.stringify(buildSnapshotExplainerResult({ focus: 'installation', depth: 'quick' })));
    expect(() => defaultTool.execute({ focus: 'bogus' })).toThrow(/focus must be one of/);
  });
});
