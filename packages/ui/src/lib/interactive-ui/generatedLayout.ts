import type { DeclarativeViewNode } from './types';
import { sanitizeOcixMetricIcon } from './metricIcons';

const MAX_DEPTH = 6;
const MAX_NODES = 80;
const MAX_CHILDREN = 20;
const MAX_ROWS = 50;
const MAX_COLUMNS = 8;
const MAX_SERIES = 5;
const MAX_GRAPH_ITEMS = 60;
const MAX_KANBAN_COLUMNS = 6;
const MAX_KANBAN_CARDS = 40;
const MAX_HEATMAP_CELLS = 60;
const MAX_AGENDA_ENTRIES = 40;
const MAX_FUNNEL_STAGES = 8;
const MAX_NETWORK_NODES = 30;
const MAX_NETWORK_EDGES = 60;
const MAX_TEXT_LENGTH = 6_000;
const SAFE_DATA_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const BLOCKED_DATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'error']);
const METRIC_TONES = new Set([...TONES, 'positive', 'negative']);
const TRENDS = new Set(['up', 'down', 'flat']);
const STEP_STATUSES = new Set(['completed', 'active', 'error', 'pending']);
const CHART_VARIANTS = new Set(['bar', 'line', 'area', 'donut']);
const COLUMN_FORMATS = new Set(['number', 'percent', 'date']);
const COLUMN_ALIGNMENTS = new Set(['left', 'center', 'right']);
const EMPHASES = new Set(['hero', 'standard', 'quiet']);
const TABLE_DENSITIES = new Set(['comfortable', 'compact']);
const SAFE_SLOT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const LAYOUT_MODE_CONTRACT = {
  'dashboard-hero': { slots: new Set(['kpis', 'main', 'aside']), required: ['kpis', 'main'] },
  'master-detail': { slots: new Set(['master', 'detail']), required: ['master', 'detail'] },
  report: { slots: new Set(['summary']), required: ['summary'] },
} as const;
type LayoutMode = keyof typeof LAYOUT_MODE_CONTRACT;

const sanitizeEmphasis = (value: unknown): string | undefined => (
  typeof value === 'string' && EMPHASES.has(value) ? value : undefined
);

const sanitizeSlotId = (value: unknown): string | undefined => (
  typeof value === 'string' && SAFE_SLOT_ID.test(value) ? value : undefined
);

/**
 * Style v2 (L3): a stack may declare an optional composition mode whose
 * section ids must satisfy the mode contract. Invalid modes are stripped so
 * the layout degrades to the default stack — the authoring tool already
 * rejects malformed modes with a hard error, and persisted snapshots must
 * never lose their content.
 */
const sanitizeLayoutMode = (
  value: unknown,
  children: DeclarativeViewNode[],
): { layoutMode?: LayoutMode; children: DeclarativeViewNode[] } => {
  if (typeof value !== 'string' || !(value in LAYOUT_MODE_CONTRACT)) {
    return { children };
  }
  const mode = value as LayoutMode;
  const contract = LAYOUT_MODE_CONTRACT[mode];
  const ids = children
    .filter((child) => child.type === 'section' && typeof child.id === 'string')
    .map((child) => child.id as string);
  const valid = ids.length > 0
    && ids.every((id) => contract.slots.has(id))
    && contract.required.every((required) => ids.includes(required));
  if (!valid) {
    return {
      children: children.map((child) => {
        if (child.type !== 'section' || child.id === undefined) return child;
        const rest = { ...child };
        delete rest.id;
        return rest;
      }),
    };
  }
  return { layoutMode: mode, children };
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const sanitizeString = (value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined => (
  typeof value === 'string' ? value.slice(0, maxLength) : undefined
);

const sanitizeScalar = (value: unknown): string | number | boolean | null | undefined => {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT_LENGTH);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
};

const isSafeDataKey = (value: unknown): value is string => (
  typeof value === 'string'
  && SAFE_DATA_KEY.test(value)
  && !BLOCKED_DATA_KEYS.has(value)
);

const sanitizeTone = (value: unknown): string | undefined => (
  typeof value === 'string' && TONES.has(value) ? value : undefined
);

const sanitizeMetricTone = (value: unknown): string | undefined => (
  typeof value === 'string' && METRIC_TONES.has(value) ? value : undefined
);

const sanitizeTrend = (value: unknown): string | undefined => (
  typeof value === 'string' && TRENDS.has(value) ? value : undefined
);

const sanitizeColumns = (value: unknown): number => {
  const record = asRecord(value);
  const numeric = typeof record?.default === 'number'
    ? record.default
    : typeof value === 'number'
      ? value
      : 1;
  return Math.max(1, Math.min(4, Math.trunc(numeric)));
};

const compact = <T>(values: Array<T | undefined | null>): T[] => (
  values.filter((value): value is T => value !== undefined && value !== null)
);

const sanitizeDataRows = (value: unknown): Array<Record<string, string | number | boolean | null>> => {
  if (!Array.isArray(value)) return [];
  return compact(value.slice(0, MAX_ROWS).map((entry) => {
    const record = asRecord(entry);
    if (!record) return null;
    const pairs = compact(Object.entries(record).slice(0, MAX_COLUMNS).map(([key, cell]) => {
      if (!isSafeDataKey(key)) return null;
      const sanitized = sanitizeScalar(cell);
      return sanitized === undefined ? null : [key, sanitized] as const;
    }));
    return Object.fromEntries(pairs);
  }));
};

/**
 * Treats model-authored layouts as untrusted data. Only the snapshot-oriented node
 * subset is accepted; queries, actions, bindings, and unknown properties are removed.
 */
export const sanitizeGeneratedLayout = (input: unknown): DeclarativeViewNode | null => {
  let nodeCount = 0;

  const sanitizeNode = (value: unknown, depth: number): DeclarativeViewNode | null => {
    const source = asRecord(value);
    if (!source || typeof source.type !== 'string' || depth > MAX_DEPTH || nodeCount >= MAX_NODES) return null;
    nodeCount += 1;

    const title = sanitizeString(source.title, 160);
    const label = sanitizeString(source.label, 160);

    if (source.type === 'stack' || source.type === 'section' || source.type === 'row' || source.type === 'grid') {
      const children = Array.isArray(source.children)
        ? compact(source.children.slice(0, MAX_CHILDREN).map((child) => sanitizeNode(child, depth + 1)))
        : [];
      const columns = sanitizeColumns(source.columns);
      // OpenChamber 1.16.2 briefly emitted a sole metric-grid inside a wider
      // grid when the model placed `columns` on the section. Preserve those
      // persisted conversations by applying the outer count to the metric grid.
      if (source.type === 'grid' && !title && children.length === 1 && children[0].type === 'metric-grid') {
        return { ...children[0], columns };
      }
      if (source.type === 'stack') {
        const layout = sanitizeLayoutMode(source.layoutMode, children);
        return {
          type: 'stack',
          ...(title ? { title } : {}),
          ...(layout.layoutMode ? { layoutMode: layout.layoutMode } : {}),
          children: layout.children,
        };
      }
      if (source.type === 'section') {
        const slotId = sanitizeSlotId(source.id);
        return {
          type: 'section',
          ...(slotId ? { id: slotId } : {}),
          ...(title ? { title } : {}),
          ...(source.variant === 'bordered' ? { variant: 'bordered' } : {}),
          children,
        };
      }
      return {
        type: source.type,
        ...(title ? { title } : {}),
        columns,
        children,
      };
    }

    if (source.type === 'metric-grid') {
      const items = Array.isArray(source.items)
        ? compact(source.items.slice(0, 12).map((item) => {
          const metric = asRecord(item);
          if (!metric) return null;
          const metricLabel = sanitizeString(metric.label, 120);
          const metricValue = sanitizeScalar(metric.value);
          const detail = sanitizeString(metric.detail, 240);
          const trendValue = sanitizeString(metric.trendValue, 80);
          const tone = sanitizeMetricTone(metric.tone);
          const trend = sanitizeTrend(metric.trend);
          const emphasis = sanitizeEmphasis(metric.emphasis);
          const icon = sanitizeOcixMetricIcon(metric.icon);
          if (!metricLabel || metricValue === undefined) return null;
          return {
            label: metricLabel,
            value: metricValue,
            ...(detail ? { detail } : {}),
            ...(tone ? { tone } : {}),
            ...(trend ? { trend } : {}),
            ...(trendValue ? { trendValue } : {}),
            ...(emphasis ? { emphasis } : {}),
            ...(icon ? { icon } : {}),
          };
        }))
        : [];
      return { type: 'metric-grid', columns: sanitizeColumns(source.columns), items };
    }

    if (source.type === 'metric') {
      const metricValue = sanitizeScalar(source.value);
      if (metricValue === undefined) return null;
      const detail = sanitizeString(source.detail, 240);
      const trendValue = sanitizeString(source.trendValue, 80);
      const tone = sanitizeMetricTone(source.tone);
      const trend = sanitizeTrend(source.trend);
      const emphasis = sanitizeEmphasis(source.emphasis);
      const icon = sanitizeOcixMetricIcon(source.icon);
      return {
        type: 'metric',
        ...(label ? { label } : {}),
        value: metricValue,
        ...(detail ? { detail } : {}),
        ...(tone ? { tone } : {}),
        ...(trend ? { trend } : {}),
        ...(trendValue ? { trendValue } : {}),
        ...(emphasis ? { emphasis } : {}),
        ...(icon ? { icon } : {}),
      };
    }

    if (source.type === 'text' || source.type === 'markdown') {
      const text = sanitizeString(source.value ?? source.data);
      return text === undefined ? null : { type: source.type, value: text };
    }

    if (source.type === 'progress') {
      const raw = typeof source.value === 'number' && Number.isFinite(source.value) ? source.value : 0;
      const detail = sanitizeString(source.detail, 240);
      return {
        type: 'progress',
        ...(label ? { label } : {}),
        value: Math.max(0, Math.min(1, raw)),
        ...(detail ? { detail } : {}),
      };
    }

    if (source.type === 'status' || source.type === 'badge') {
      const statusValue = sanitizeScalar(source.value);
      if (statusValue === undefined) return null;
      const tone = sanitizeTone(source.tone);
      return {
        type: source.type,
        ...(label ? { label } : {}),
        value: statusValue,
        ...(tone ? { tone } : {}),
      };
    }

    if (source.type === 'key-value') {
      const items = Array.isArray(source.items)
        ? compact(source.items.slice(0, 20).map((item) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const entryLabel = sanitizeString(entry.label, 120);
          const entryValue = sanitizeScalar(entry.value);
          return entryLabel && entryValue !== undefined ? { label: entryLabel, value: entryValue } : null;
        }))
        : [];
      return { type: 'key-value', items };
    }

    if (source.type === 'flow') {
      const rawSteps = Array.isArray(source.data) ? source.data : Array.isArray(source.items) ? source.items : [];
      const data = compact(rawSteps.slice(0, 12).map((step) => {
        const entry = asRecord(step);
        if (!entry) return null;
        const stepTitle = sanitizeString(entry.title, 120);
        const description = sanitizeString(entry.description, 500);
        const status = typeof entry.status === 'string' && STEP_STATUSES.has(entry.status) ? entry.status : undefined;
        return stepTitle ? { title: stepTitle, ...(description ? { description } : {}), ...(status ? { status } : {}) } : null;
      }));
      return {
        type: 'flow',
        data,
        ...(source.orientation === 'vertical' ? { orientation: 'vertical' } : {}),
      };
    }

    if (source.type === 'divider') {
      return { type: 'divider' };
    }

    if (source.type === 'data-table') {
      const columns = Array.isArray(source.columns)
        ? compact(source.columns.slice(0, MAX_COLUMNS).map((column) => {
          const entry = asRecord(column);
          if (!entry || !isSafeDataKey(entry.key)) return null;
          const columnLabel = sanitizeString(entry.label, 120);
          const rawFormat = sanitizeString(entry.format, 32);
          const format = rawFormat && (COLUMN_FORMATS.has(rawFormat) || /^currency:[A-Za-z]{3}$/.test(rawFormat))
            ? rawFormat
            : undefined;
          const render = entry.render === 'status' ? 'status' : undefined;
          const align = typeof entry.align === 'string' && COLUMN_ALIGNMENTS.has(entry.align) ? entry.align : undefined;
          return {
            key: entry.key,
            ...(columnLabel ? { label: columnLabel } : {}),
            ...(format ? { format } : {}),
            ...(render ? { render } : {}),
            ...(align ? { align } : {}),
          };
        }))
        : [];
      const density = typeof source.density === 'string' && TABLE_DENSITIES.has(source.density) ? source.density : undefined;
      const toneColumn = isSafeDataKey(source.toneColumn) ? source.toneColumn : undefined;
      const pageSizeRaw = asRecord(source.pagination)?.pageSize;
      const pageSize = typeof pageSizeRaw === 'number' && Number.isFinite(pageSizeRaw)
        ? Math.max(1, Math.min(50, Math.trunc(pageSizeRaw)))
        : undefined;
      return {
        type: 'data-table',
        ...(title ? { title } : {}),
        ...(density ? { density } : {}),
        ...(toneColumn ? { toneColumn } : {}),
        ...(source.searchable === true ? { searchable: true } : {}),
        ...(source.sortable === true ? { sortable: true } : {}),
        ...(pageSize !== undefined ? { pagination: { pageSize } } : {}),
        columns,
        data: sanitizeDataRows(source.data),
      };
    }

    if (source.type === 'chart') {
      const variant = typeof source.variant === 'string' && CHART_VARIANTS.has(source.variant) ? source.variant : 'bar';
      const xKey = isSafeDataKey(source.xKey) ? source.xKey : 'label';
      const series = Array.isArray(source.series)
        ? compact(source.series.slice(0, MAX_SERIES).map((item) => {
          const entry = asRecord(item);
          if (!entry || !isSafeDataKey(entry.key)) return null;
          const seriesLabel = sanitizeString(entry.label, 120);
          return { key: entry.key, ...(seriesLabel ? { label: seriesLabel } : {}) };
        }))
        : [];
      const referenceLineRecord = asRecord(source.referenceLine);
      const referenceLineValue = typeof referenceLineRecord?.value === 'number' && Number.isFinite(referenceLineRecord.value)
        ? referenceLineRecord.value
        : undefined;
      const referenceLineLabel = sanitizeString(referenceLineRecord?.label, 80);
      return {
        type: 'chart',
        ...(title ? { title } : {}),
        variant,
        xKey,
        series,
        data: sanitizeDataRows(source.data),
        ...(referenceLineValue !== undefined
          ? { referenceLine: { value: referenceLineValue, ...(referenceLineLabel ? { label: referenceLineLabel } : {}) } }
          : {}),
        ...(source.stacked === true ? { stacked: true } : {}),
      };
    }

    if (source.type === 'timeline' || source.type === 'activity-feed') {
      const items = Array.isArray(source.items)
        ? compact(source.items.slice(0, 30).map((item) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const itemTitle = sanitizeString(entry.title, 160);
          const actor = sanitizeString(entry.actor, 120);
          if (source.type === 'timeline' && !itemTitle) return null;
          if (source.type === 'activity-feed' && !actor && !itemTitle) return null;
          const description = sanitizeString(entry.description, 500);
          const action = sanitizeString(entry.action, 240);
          const timestamp = sanitizeString(entry.timestamp, 120);
          const tone = sanitizeTone(entry.tone);
          const status = typeof entry.status === 'string' && STEP_STATUSES.has(entry.status) ? entry.status : undefined;
          return {
            ...(itemTitle ? { title: itemTitle } : {}),
            ...(actor ? { actor } : {}),
            ...(action ? { action } : {}),
            ...(description ? { description } : {}),
            ...(timestamp ? { timestamp } : {}),
            ...(tone ? { tone } : {}),
            ...(status ? { status } : {}),
          };
        }))
        : [];
      return { type: source.type, ...(title ? { title } : {}), items };
    }

    if (source.type === 'comparison') {
      const columns = Array.isArray(source.columns)
        ? compact(source.columns.slice(0, MAX_COLUMNS).map((column) => {
          const entry = asRecord(column);
          if (!entry || !isSafeDataKey(entry.key)) return null;
          const columnLabel = sanitizeString(entry.label, 120);
          return { key: entry.key, ...(columnLabel ? { label: columnLabel } : {}) };
        }))
        : [];
      return { type: 'comparison', ...(title ? { title } : {}), columns, data: sanitizeDataRows(source.data) };
    }

    if (source.type === 'tabs' || source.type === 'accordion') {
      const items = Array.isArray(source.items)
        ? compact(source.items.slice(0, 8).map((item) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const itemLabel = sanitizeString(entry.label ?? entry.title, 120);
          if (!itemLabel) return null;
          const children = Array.isArray(entry.children)
            ? compact(entry.children.slice(0, MAX_CHILDREN).map((child) => sanitizeNode(child, depth + 1)))
            : [];
          return { label: itemLabel, children };
        }))
        : [];
      return {
        type: source.type,
        ...(title ? { title } : {}),
        ...(source.type === 'accordion' && source.defaultOpen === false ? { defaultOpen: false } : {}),
        items,
      };
    }

    if (source.type === 'code-block') {
      const value = sanitizeString(source.value ?? source.data);
      if (value === undefined) return null;
      const language = sanitizeString(source.language, 40);
      return { type: 'code-block', ...(title ? { title } : {}), ...(language ? { language } : {}), value };
    }

    if (source.type === 'sparkline') {
      const rawValues = Array.isArray(source.values) ? source.values : Array.isArray(source.data) ? source.data : [];
      const values = rawValues.slice(0, MAX_GRAPH_ITEMS).map(Number).filter(Number.isFinite);
      if (values.length === 0) return null;
      const sparkValue = sanitizeScalar(source.value);
      return {
        type: 'sparkline',
        ...(label ? { label } : {}),
        ...(sparkValue !== undefined ? { value: sparkValue } : {}),
        values,
      };
    }

    if (source.type === 'gauge') {
      const rawValue = typeof source.value === 'number' && Number.isFinite(source.value) ? source.value : 0;
      const rawMinimum = typeof source.minimum === 'number' && Number.isFinite(source.minimum) ? source.minimum : 0;
      const rawMaximum = typeof source.maximum === 'number' && Number.isFinite(source.maximum) ? source.maximum : 100;
      const minimum = Math.min(rawMinimum, rawMaximum - 1);
      const maximum = Math.max(rawMaximum, minimum + 1);
      const value = Math.max(minimum, Math.min(maximum, rawValue));
      const detail = sanitizeString(source.detail, 240);
      const unit = sanitizeString(source.unit, 40);
      const tone = sanitizeTone(source.tone);
      return {
        type: 'gauge',
        ...(title ? { title } : {}),
        ...(label ? { label } : {}),
        value,
        minimum,
        maximum,
        ...(detail ? { detail } : {}),
        ...(unit ? { unit } : {}),
        ...(tone ? { tone } : {}),
      };
    }

    if (source.type === 'heatmap') {
      const rawCells = Array.isArray(source.cells) ? source.cells : Array.isArray(source.data) ? source.data : [];
      const cells = compact(rawCells.slice(0, MAX_HEATMAP_CELLS).map((cell) => {
        const entry = asRecord(cell);
        if (!entry) return null;
        const row = sanitizeString(entry.row, 80);
        const column = sanitizeString(entry.column, 80);
        const cellLabel = sanitizeString(entry.label, 120);
        const value = typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : undefined;
        if (!row || !column || value === undefined) return null;
        return { row, column, value, ...(cellLabel ? { label: cellLabel } : {}) };
      }));
      return { type: 'heatmap', ...(title ? { title } : {}), cells };
    }

    if (source.type === 'kanban') {
      const columns = Array.isArray(source.columns)
        ? compact(source.columns.slice(0, MAX_KANBAN_COLUMNS).map((column) => {
          const entry = asRecord(column);
          if (!entry || !isSafeDataKey(entry.id)) return null;
          const columnTitle = sanitizeString(entry.title ?? entry.label, 120);
          const tone = sanitizeTone(entry.tone);
          return columnTitle ? { id: entry.id, title: columnTitle, ...(tone ? { tone } : {}) } : null;
        }))
        : [];
      const columnIds = new Set(columns.map((column) => column.id));
      const cards = Array.isArray(source.cards)
        ? compact(source.cards.slice(0, MAX_KANBAN_CARDS).map((card) => {
          const entry = asRecord(card);
          if (!entry || !isSafeDataKey(entry.column) || !columnIds.has(entry.column)) return null;
          const cardTitle = sanitizeString(entry.title, 160);
          if (!cardTitle) return null;
          const id = isSafeDataKey(entry.id) ? entry.id : undefined;
          const description = sanitizeString(entry.description, 500);
          const badge = sanitizeString(entry.badge, 80);
          const tone = sanitizeTone(entry.tone);
          return {
            ...(id ? { id } : {}),
            column: entry.column,
            title: cardTitle,
            ...(description ? { description } : {}),
            ...(badge ? { badge } : {}),
            ...(tone ? { tone } : {}),
          };
        }))
        : [];
      return { type: 'kanban', ...(title ? { title } : {}), columns, cards };
    }

    if (source.type === 'agenda') {
      const rawEntries = Array.isArray(source.entries) ? source.entries : Array.isArray(source.items) ? source.items : Array.isArray(source.data) ? source.data : [];
      const entries = compact(rawEntries.slice(0, MAX_AGENDA_ENTRIES).map((item, index) => {
        const entry = asRecord(item);
        if (!entry) return null;
        const itemTitle = sanitizeString(entry.title, 160);
        if (!itemTitle) return null;
        const id = typeof entry.id === 'string' && SAFE_GRAPH_ID.test(entry.id) ? entry.id : `agenda-${index + 1}`;
        const date = sanitizeString(entry.date, 80);
        const time = sanitizeString(entry.time, 40);
        const endTime = sanitizeString(entry.endTime, 40);
        const description = sanitizeString(entry.description, 500);
        const location = sanitizeString(entry.location, 160);
        const tone = sanitizeTone(entry.tone);
        return {
          id,
          title: itemTitle,
          ...(date ? { date } : {}),
          ...(time ? { time } : {}),
          ...(endTime ? { endTime } : {}),
          ...(description ? { description } : {}),
          ...(location ? { location } : {}),
          ...(tone ? { tone } : {}),
        };
      }));
      return { type: 'agenda', ...(title ? { title } : {}), entries };
    }

    if (source.type === 'funnel') {
      const rawStages = Array.isArray(source.stages) ? source.stages : Array.isArray(source.items) ? source.items : Array.isArray(source.data) ? source.data : [];
      const stages = compact(rawStages.slice(0, MAX_FUNNEL_STAGES).map((item) => {
        const entry = asRecord(item);
        if (!entry) return null;
        const stageLabel = sanitizeString(entry.label ?? entry.title, 120);
        const value = typeof entry.value === 'number' && Number.isFinite(entry.value) ? Math.max(0, entry.value) : undefined;
        if (!stageLabel || value === undefined) return null;
        const detail = sanitizeString(entry.detail, 120);
        return { label: stageLabel, value, ...(detail ? { detail } : {}) };
      }));
      return { type: 'funnel', ...(title ? { title } : {}), stages };
    }

    if (source.type === 'network') {
      const nodes = Array.isArray(source.nodes)
        ? compact(source.nodes.slice(0, MAX_NETWORK_NODES).map((item, index) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const nodeLabel = sanitizeString(entry.label ?? entry.title, 120);
          if (!nodeLabel) return null;
          const id = typeof entry.id === 'string' && SAFE_GRAPH_ID.test(entry.id) ? entry.id : `node-${index + 1}`;
          const detail = sanitizeString(entry.detail ?? entry.description, 240);
          const tone = sanitizeTone(entry.tone);
          return { id, label: nodeLabel, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) };
        }))
        : [];
      const nodeIds = new Set(nodes.map((entry) => entry.id));
      const edges = Array.isArray(source.edges)
        ? compact(source.edges.slice(0, MAX_NETWORK_EDGES).map((item) => {
          const entry = asRecord(item);
          if (!entry || typeof entry.source !== 'string' || typeof entry.target !== 'string' || !nodeIds.has(entry.source) || !nodeIds.has(entry.target)) return null;
          const edgeLabel = sanitizeString(entry.label, 120);
          return { source: entry.source, target: entry.target, ...(edgeLabel ? { label: edgeLabel } : {}) };
        }))
        : [];
      return { type: 'network', ...(title ? { title } : {}), nodes, edges };
    }

    if (source.type === 'git-graph') {
      const rawCommits = Array.isArray(source.commits) ? source.commits : Array.isArray(source.data) ? source.data : [];
      const commits = compact(rawCommits.slice(0, 40).map((commit, index) => {
          const entry = asRecord(commit);
          if (!entry) return null;
          const rawId = typeof entry.id === 'string' && SAFE_GRAPH_ID.test(entry.id) ? entry.id : `commit-${index + 1}`;
          const message = sanitizeString(entry.message ?? entry.title, 240);
          if (!message) return null;
          const branch = typeof entry.branch === 'string' && SAFE_GRAPH_ID.test(entry.branch) ? entry.branch : 'main';
          const parents = Array.isArray(entry.parents)
            ? entry.parents.filter((parent): parent is string => typeof parent === 'string' && SAFE_GRAPH_ID.test(parent)).slice(0, 4)
            : [];
          const author = sanitizeString(entry.author, 120);
          const timestamp = sanitizeString(entry.timestamp, 120);
          return { id: rawId, message, branch, parents, ...(author ? { author } : {}), ...(timestamp ? { timestamp } : {}) };
        }));
      return { type: 'git-graph', ...(title ? { title } : {}), commits };
    }

    if (source.type === 'tree') {
      const rawItems = Array.isArray(source.items) ? source.items : Array.isArray(source.data) ? source.data : [];
      const items = compact(rawItems.slice(0, MAX_GRAPH_ITEMS).map((item, index) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const itemLabel = sanitizeString(entry.label ?? entry.title, 160);
          if (!itemLabel) return null;
          const id = typeof entry.id === 'string' && SAFE_GRAPH_ID.test(entry.id) ? entry.id : `node-${index + 1}`;
          const parentId = typeof entry.parentId === 'string' && SAFE_GRAPH_ID.test(entry.parentId) ? entry.parentId : undefined;
          const description = sanitizeString(entry.description, 500);
          const tone = sanitizeTone(entry.tone);
          const status = typeof entry.status === 'string' && STEP_STATUSES.has(entry.status) ? entry.status : undefined;
          return { id, label: itemLabel, ...(parentId ? { parentId } : {}), ...(description ? { description } : {}), ...(tone ? { tone } : {}), ...(status ? { status } : {}) };
        }));
      return { type: 'tree', ...(title ? { title } : {}), items };
    }

    if (source.type === 'diff-summary') {
      const rawItems = Array.isArray(source.items) ? source.items : Array.isArray(source.data) ? source.data : [];
      const items = compact(rawItems.slice(0, MAX_ROWS).map((item) => {
          const entry = asRecord(item);
          if (!entry) return null;
          const path = sanitizeString(entry.path ?? entry.title, 500);
          if (!path) return null;
          const status = sanitizeString(entry.status, 80);
          const additions = typeof entry.additions === 'number' && Number.isFinite(entry.additions) ? Math.max(0, Math.trunc(entry.additions)) : 0;
          const deletions = typeof entry.deletions === 'number' && Number.isFinite(entry.deletions) ? Math.max(0, Math.trunc(entry.deletions)) : 0;
          return { path, ...(status ? { status } : {}), additions, deletions };
        }));
      return { type: 'diff-summary', ...(title ? { title } : {}), items };
    }

    if (source.type === 'list') {
      const items = Array.isArray(source.items)
        ? compact(source.items.slice(0, 30).map((item) => {
          if (typeof item === 'string') return item.slice(0, 500);
          const entry = asRecord(item);
          if (!entry) return null;
          const itemTitle = sanitizeString(entry.title, 160);
          const description = sanitizeString(entry.description, 500);
          const badge = sanitizeString(entry.badge, 80);
          const badgeTone = sanitizeTone(entry.badgeTone);
          return itemTitle ? {
            title: itemTitle,
            ...(description ? { description } : {}),
            ...(badge ? { badge } : {}),
            ...(badgeTone ? { badgeTone } : {}),
          } : null;
        }))
        : [];
      return {
        type: 'list',
        ...(title ? { title } : {}),
        ordered: source.ordered === true,
        items,
        ...(source.filterable === true ? { filterable: true } : {}),
      };
    }

    if (source.type === 'callout') {
      const text = sanitizeString(source.value ?? source.data);
      if (text === undefined) return null;
      const tone = sanitizeTone(source.tone) ?? 'info';
      return { type: 'callout', ...(title ? { title } : {}), value: text, tone };
    }

    return null;
  };

  return sanitizeNode(input, 0);
};
