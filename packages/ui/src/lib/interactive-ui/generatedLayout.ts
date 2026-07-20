import type { DeclarativeViewNode } from './types';

const MAX_DEPTH = 6;
const MAX_NODES = 80;
const MAX_CHILDREN = 20;
const MAX_ROWS = 50;
const MAX_COLUMNS = 8;
const MAX_SERIES = 5;
const MAX_TEXT_LENGTH = 6_000;
const SAFE_DATA_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'error']);
const CHART_VARIANTS = new Set(['bar', 'line', 'area', 'donut']);
const COLUMN_FORMATS = new Set(['number', 'percent', 'date']);

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

const sanitizeTone = (value: unknown): string | undefined => (
  typeof value === 'string' && TONES.has(value) ? value : undefined
);

const sanitizeColumns = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : 1;
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
      if (!SAFE_DATA_KEY.test(key)) return null;
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
      return {
        type: source.type,
        ...(title ? { title } : {}),
        ...((source.type === 'row' || source.type === 'grid') ? { columns: sanitizeColumns(source.columns) } : {}),
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
          if (!metricLabel || metricValue === undefined) return null;
          return {
            label: metricLabel,
            value: metricValue,
            ...(detail ? { detail } : {}),
            ...(sanitizeTone(metric.tone) ? { tone: sanitizeTone(metric.tone) } : {}),
          };
        }))
        : [];
      return { type: 'metric-grid', columns: sanitizeColumns(source.columns), items };
    }

    if (source.type === 'metric') {
      const metricValue = sanitizeScalar(source.value);
      if (metricValue === undefined) return null;
      const detail = sanitizeString(source.detail, 240);
      const tone = sanitizeTone(source.tone);
      return {
        type: 'metric',
        ...(label ? { label } : {}),
        value: metricValue,
        ...(detail ? { detail } : {}),
        ...(tone ? { tone } : {}),
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
        return stepTitle ? { title: stepTitle, ...(description ? { description } : {}) } : null;
      }));
      return { type: 'flow', data };
    }

    if (source.type === 'data-table') {
      const columns = Array.isArray(source.columns)
        ? compact(source.columns.slice(0, MAX_COLUMNS).map((column) => {
          const entry = asRecord(column);
          if (!entry || typeof entry.key !== 'string' || !SAFE_DATA_KEY.test(entry.key)) return null;
          const columnLabel = sanitizeString(entry.label, 120);
          const rawFormat = sanitizeString(entry.format, 32);
          const format = rawFormat && (COLUMN_FORMATS.has(rawFormat) || /^currency:[A-Za-z]{3}$/.test(rawFormat))
            ? rawFormat
            : undefined;
          const render = entry.render === 'status' ? 'status' : undefined;
          return {
            key: entry.key,
            ...(columnLabel ? { label: columnLabel } : {}),
            ...(format ? { format } : {}),
            ...(render ? { render } : {}),
          };
        }))
        : [];
      return {
        type: 'data-table',
        ...(title ? { title } : {}),
        columns,
        data: sanitizeDataRows(source.data),
      };
    }

    if (source.type === 'chart') {
      const variant = typeof source.variant === 'string' && CHART_VARIANTS.has(source.variant) ? source.variant : 'bar';
      const xKey = typeof source.xKey === 'string' && SAFE_DATA_KEY.test(source.xKey) ? source.xKey : 'label';
      const series = Array.isArray(source.series)
        ? compact(source.series.slice(0, MAX_SERIES).map((item) => {
          const entry = asRecord(item);
          if (!entry || typeof entry.key !== 'string' || !SAFE_DATA_KEY.test(entry.key)) return null;
          const seriesLabel = sanitizeString(entry.label, 120);
          return { key: entry.key, ...(seriesLabel ? { label: seriesLabel } : {}) };
        }))
        : [];
      return {
        type: 'chart',
        ...(title ? { title } : {}),
        variant,
        xKey,
        series,
        data: sanitizeDataRows(source.data),
      };
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
          return itemTitle ? { title: itemTitle, ...(description ? { description } : {}), ...(badge ? { badge } : {}) } : null;
        }))
        : [];
      return { type: 'list', ...(title ? { title } : {}), ordered: source.ordered === true, items };
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
