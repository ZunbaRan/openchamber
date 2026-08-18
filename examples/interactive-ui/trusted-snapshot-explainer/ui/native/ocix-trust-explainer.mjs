/**
 * Trusted Snapshot Explainer — installed deterministic-snapshot Native view.
 *
 * Self-contained module with no imports and no host I/O. It reads only
 * props.snapshot and props.context, decodes the inline snapshot with a strict
 * fail-closed validator, and renders local accordion state. The lane declares
 * no Connector, action, network, storage, credential, Gateway, or dashboard
 * authority: no network transport, no persistence, no timers, no external
 * links, and no dynamic markup are used anywhere in this module.
 */

export const EXPLAINER_EXTENSION_ID = 'com.openchamber.demo.snapshot-explainer';
export const EXPLAINER_VIEW_ID = 'com.openchamber.demo.snapshot-explainer.ocix-trust';
export const EXPLAINER_DATA_SCHEMA = 'openchamber://snapshot-explainer-data/v1';
export const EXPLAINER_FIXTURE_ID = 'ocix-trust-pipeline';
export const EXPLAINER_FIXTURE_VERSION = 1;
export const EXPLAINER_SOURCE_KIND = 'bundled-fixture';
export const EXPLAINER_SOURCE_AUTHORITY = 'generated';

export const EXPLAINER_BOUNDS = Object.freeze({
  title: 120,
  thesis: 800,
  minStages: 1,
  maxStages: 8,
  stageId: 64,
  stageTitle: 80,
  stageBody: 800,
  maxPoints: 6,
  point: 160,
  maxNotes: 4,
  note: 240,
  sourceLabel: 160,
  totalText: 16000,
});

const STAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCKED_KEY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainRecord = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Exact own-key validation for one record level: the own key set must be
 * exactly `allowed` (no extras, no missing), every own key must be a plain
 * data property (accessors are rejected), symbol keys are rejected, and no
 * key may carry an undefined value or a blocked name.
 */
const checkRecordKeys = (value, allowed, location) => {
  if (!isPlainRecord(value)) {
    throw new Error(`${location} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${location} must not contain symbol keys`);
  }
  const keys = Object.getOwnPropertyNames(value);
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key) => !allowed.has(key))) {
    throw new Error(`${location} must have exactly the keys: ${expected.join(', ')}`);
  }
  for (const key of keys) {
    if (BLOCKED_KEY_NAMES.has(key)) {
      throw new Error(`${location}.${key} is a blocked key name`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new Error(`${location}.${key} must be a plain data property`);
    }
    if (descriptor.value === undefined) {
      throw new Error(`${location}.${key} must not be undefined`);
    }
  }
};

const checkBoundedString = (value, location, min, max) => {
  if (typeof value !== 'string') throw new Error(`${location} must be a string`);
  if (value.length < min || value.length > max) {
    throw new Error(`${location} length must be within ${min}..${max}`);
  }
};

const checkStringArray = (value, location, maxItems, minItem, maxItem) => {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${location} must be an array of at most ${maxItems} strings`);
  }
  for (let index = 0; index < value.length; index += 1) {
    checkBoundedString(value[index], `${location}[${index}]`, minItem, maxItem);
  }
};

/**
 * Strict decoder for openchamber://snapshot-explainer-data/v1. Validates exact
 * own keys at every level, primitive types, array/object bounds, unique stable
 * stage ids, enum/fixed values, and total text limits. Returns a frozen,
 * re-normalized plain snapshot, or null when anything fails (fail closed).
 */
export const parseSnapshotExplainerData = (value) => {
  try {
    checkRecordKeys(value, new Set([
      '$schema', 'schemaVersion', 'source', 'live', 'title', 'thesis', 'stages', 'notes',
    ]), 'data');
    if (value.$schema !== EXPLAINER_DATA_SCHEMA) {
      throw new Error('data.$schema must be openchamber://snapshot-explainer-data/v1');
    }
    if (value.schemaVersion !== 1) throw new Error('data.schemaVersion must be 1');
    if (value.live !== false) throw new Error('data.live must be false');

    checkRecordKeys(value.source, new Set([
      'kind', 'authority', 'fixtureId', 'fixtureVersion', 'label',
    ]), 'data.source');
    if (value.source.kind !== EXPLAINER_SOURCE_KIND) {
      throw new Error('data.source.kind must be bundled-fixture');
    }
    if (value.source.authority !== EXPLAINER_SOURCE_AUTHORITY) {
      throw new Error('data.source.authority must be generated');
    }
    if (value.source.fixtureId !== EXPLAINER_FIXTURE_ID) {
      throw new Error('data.source.fixtureId must be ocix-trust-pipeline');
    }
    if (value.source.fixtureVersion !== EXPLAINER_FIXTURE_VERSION) {
      throw new Error('data.source.fixtureVersion must be 1');
    }
    checkBoundedString(value.source.label, 'data.source.label', 1, EXPLAINER_BOUNDS.sourceLabel);

    checkBoundedString(value.title, 'data.title', 1, EXPLAINER_BOUNDS.title);
    checkBoundedString(value.thesis, 'data.thesis', 1, EXPLAINER_BOUNDS.thesis);
    checkStringArray(value.notes, 'data.notes', EXPLAINER_BOUNDS.maxNotes, 1, EXPLAINER_BOUNDS.note);

    if (!Array.isArray(value.stages)
      || value.stages.length < EXPLAINER_BOUNDS.minStages
      || value.stages.length > EXPLAINER_BOUNDS.maxStages) {
      throw new Error(`data.stages must be an array of ${EXPLAINER_BOUNDS.minStages}..${EXPLAINER_BOUNDS.maxStages} stages`);
    }
    const seenIds = new Set();
    const stages = value.stages.map((stage, index) => {
      const location = `data.stages[${index}]`;
      checkRecordKeys(stage, new Set(['id', 'title', 'body', 'points']), location);
      checkBoundedString(stage.id, `${location}.id`, 1, EXPLAINER_BOUNDS.stageId);
      if (!STAGE_ID_PATTERN.test(stage.id)) {
        throw new Error(`${location}.id must match ${STAGE_ID_PATTERN}`);
      }
      if (seenIds.has(stage.id)) throw new Error(`${location}.id duplicates ${stage.id}`);
      seenIds.add(stage.id);
      checkBoundedString(stage.title, `${location}.title`, 1, EXPLAINER_BOUNDS.stageTitle);
      checkBoundedString(stage.body, `${location}.body`, 1, EXPLAINER_BOUNDS.stageBody);
      checkStringArray(stage.points, `${location}.points`, EXPLAINER_BOUNDS.maxPoints, 1, EXPLAINER_BOUNDS.point);
      return {
        id: stage.id,
        title: stage.title,
        body: stage.body,
        points: [...stage.points],
      };
    });

    let totalText = 0;
    const accumulate = (text) => {
      totalText += text.length;
      if (totalText > EXPLAINER_BOUNDS.totalText) {
        throw new Error(`total snapshot text exceeds ${EXPLAINER_BOUNDS.totalText} characters`);
      }
    };
    const collectStrings = (node) => {
      if (typeof node === 'string') {
        accumulate(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const entry of node) collectStrings(entry);
        return;
      }
      if (isPlainRecord(node)) {
        for (const key of Object.keys(node)) collectStrings(node[key]);
      }
    };
    collectStrings(value);

    return Object.freeze({
      $schema: value.$schema,
      schemaVersion: value.schemaVersion,
      source: Object.freeze({
        kind: value.source.kind,
        authority: value.source.authority,
        fixtureId: value.source.fixtureId,
        fixtureVersion: value.source.fixtureVersion,
        label: value.source.label,
      }),
      live: false,
      title: value.title,
      thesis: value.thesis,
      stages: Object.freeze(stages),
      notes: Object.freeze([...value.notes]),
    });
  } catch {
    return null;
  }
};

export const EXPLAINER_STRINGS = Object.freeze({
  zh: Object.freeze({
    viewTitle: 'OCIX 信任模型 · 已安装快照讲解',
    viewSubtitle: '确定性内联快照 · 无连接器、无动作、无网络、无存储、无凭据',
    notice: '已安装快照 · 示例/模拟 · 非实时数据（不访问任何实时业务系统或网络）',
    sourcePrefix: '数据源',
    unknownSource: '未知',
    stageSection: '讲解步骤',
    stagePointsLabel: '要点',
    notesTitle: '小结',
    depthLabel: '深度',
    focusLabel: '主题',
    errorTitle: '无法验证快照数据',
    errorBody: '已拒绝渲染未通过严格校验的快照。本示例只渲染已安装的确定性内联快照，不访问任何实时系统。',
    errorSource: '未通过校验 · 已拒绝渲染',
  }),
  en: Object.freeze({
    viewTitle: 'OCIX trust model · installed snapshot explainer',
    viewSubtitle: 'Deterministic inline snapshot · no connector, action, network, storage, or credential',
    notice: 'Installed snapshot · Example/simulation · not live data (no live business system or network access)',
    sourcePrefix: 'Source',
    unknownSource: 'unknown',
    stageSection: 'Lesson stages',
    stagePointsLabel: 'Points',
    notesTitle: 'Notes',
    depthLabel: 'Depth',
    focusLabel: 'Focus',
    errorTitle: 'Snapshot data could not be verified',
    errorBody: 'Rendering was refused because the snapshot failed strict validation. This example renders only an installed deterministic inline snapshot and never touches a live system.',
    errorSource: 'rejected by validation · not rendered',
  }),
});

/**
 * Visible strings are selected from the host locale with a zh-CN/en pair and
 * an English fallback for unknown locales. Strings never pass through the
 * React app i18n system: this extension is a self-contained Native module.
 */
export const selectExplainerStrings = (locale) => {
  if (typeof locale === 'string' && locale.toLowerCase().startsWith('zh')) {
    return EXPLAINER_STRINGS.zh;
  }
  return EXPLAINER_STRINGS.en;
};

export const extension = {
  id: EXPLAINER_EXTENSION_ID,
  apiVersion: 1,
  activate(activationHost) {
    const React = activationHost.react;
    const { Badge, Notice } = activationHost.ui;

    function TrustExplainerView(props) {
      const [openStageId, setOpenStageId] = React.useState(null);
      const locale = props.host && props.host.context ? props.host.context.locale : '';
      const strings = selectExplainerStrings(locale);
      const context = isPlainRecord(props.context) ? props.context : {};
      const focus = typeof context.focus === 'string' ? context.focus : 'overview';
      const depth = typeof context.depth === 'string' ? context.depth : 'detailed';
      const decoded = parseSnapshotExplainerData(props.snapshot);
      const rejected = props.dataRef !== undefined || decoded === null;

      if (rejected) {
        return React.createElement('section', {
          'data-ocix-snapshot-explainer': '',
          role: 'alert',
          className: 'min-w-0 space-y-3',
        },
          React.createElement(Notice, { tone: 'error', heading: strings.errorTitle }, strings.errorBody),
          React.createElement('p', {
            'data-ocix-snapshot-source': strings.errorSource,
            className: 'typography-micro text-[var(--ocix-muted-foreground)]',
          }, `${strings.sourcePrefix}: ${strings.errorSource}`));
      }

      const toggleStage = (stageId) => {
        setOpenStageId((current) => (current === stageId ? null : stageId));
      };

      const stageElements = decoded.stages.map((stage) => {
        const open = openStageId === stage.id;
        return React.createElement('article', {
          key: stage.id,
          'data-ocix-snapshot-stage': stage.id,
          className: 'overflow-hidden rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)]',
        },
          React.createElement('button', {
            type: 'button',
            onClick: () => toggleStage(stage.id),
            'aria-expanded': open,
            className: 'flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-[var(--ocix-surface-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ocix-focus-ring)]',
          },
            React.createElement('span', { className: 'typography-meta font-medium text-[var(--ocix-foreground)]' }, stage.title),
            React.createElement(Badge, { tone: 'neutral' }, open ? '−' : '+')),
          open
            ? React.createElement('div', { className: 'space-y-2 border-t border-[var(--ocix-border)] px-3 py-2.5' },
                React.createElement('p', { className: 'typography-body text-[var(--ocix-foreground)]' }, stage.body),
                stage.points.length > 0
                  ? React.createElement('ul', { className: 'list-disc space-y-1 pl-4 typography-meta text-[var(--ocix-muted-foreground)]' },
                      ...stage.points.map((point, index) => React.createElement('li', { key: `${stage.id}:${index}` }, point)))
                  : null)
            : null);
      });

      return React.createElement('section', {
        'data-ocix-snapshot-explainer': '',
        'aria-label': strings.viewTitle,
        className: 'min-w-0 space-y-4',
      },
        React.createElement('div', { className: 'flex flex-wrap items-start justify-between gap-3' },
          React.createElement('div', { className: 'min-w-0' },
            React.createElement('h2', { className: 'typography-body font-semibold text-[var(--ocix-foreground)]' }, strings.viewTitle),
            React.createElement('p', { className: 'mt-1 typography-meta text-[var(--ocix-muted-foreground)]' }, strings.viewSubtitle)),
          React.createElement('div', { className: 'flex flex-wrap items-center gap-2' },
            React.createElement(Badge, { tone: 'info' }, `${strings.focusLabel}: ${focus}`),
            React.createElement(Badge, { tone: 'neutral' }, `${strings.depthLabel}: ${depth}`))),
        React.createElement('div', {
          role: 'status',
          'data-ocix-snapshot-source': decoded.source.label,
          className: 'rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-subtle)] px-3 py-2 typography-micro text-[var(--ocix-muted-foreground)]',
        },
          strings.notice,
          React.createElement('span', { className: 'ml-1' }, `· ${strings.sourcePrefix}: ${decoded.source.label}`)),
        React.createElement('div', { className: 'space-y-2' },
          React.createElement('h3', { className: 'typography-meta font-medium text-[var(--ocix-foreground)]' }, strings.stageSection),
          ...stageElements),
        decoded.notes.length > 0
          ? React.createElement('div', { className: 'rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] px-3 py-2.5' },
              React.createElement('h3', { className: 'typography-meta font-medium text-[var(--ocix-foreground)]' }, strings.notesTitle),
              React.createElement('ul', { className: 'mt-1 list-disc space-y-1 pl-4 typography-meta text-[var(--ocix-muted-foreground)]' },
                ...decoded.notes.map((note, index) => React.createElement('li', { key: `note:${index}` }, note))))
          : null);
    }

    return activationHost.views.register({
      id: EXPLAINER_VIEW_ID,
      component: TrustExplainerView,
      displayModes: ['inline'],
    });
  },
};
