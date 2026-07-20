import type { DeclarativeBindingScope } from './types';

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const readPath = (root: unknown, path: string): unknown => {
  const segments = path.split('.').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (
      !SAFE_PATH_SEGMENT.test(segment)
      || BLOCKED_PATH_SEGMENTS.has(segment)
      || current === null
      || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const formatValue = (value: unknown, format: string | undefined, locale: string): unknown => {
  if (!format) return value;
  if (format === 'number' && typeof value === 'number') {
    return new Intl.NumberFormat(locale).format(value);
  }
  if (format === 'percent' && typeof value === 'number') {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
  }
  if (format.startsWith('currency:') && typeof value === 'number') {
    const currency = format.slice('currency:'.length).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
    }
  }
  if (format === 'date' && (typeof value === 'string' || typeof value === 'number')) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(locale).format(date);
  }
  return value;
};

const isBinding = (value: unknown): value is { $path?: string; $row?: string; fallback?: unknown; format?: string } => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (typeof (value as { $path?: unknown }).$path === 'string' || typeof (value as { $row?: unknown }).$row === 'string')
);

export const resolveDeclarativeValue = (
  value: unknown,
  scope: DeclarativeBindingScope,
  locale = 'en',
): unknown => {
  if (isBinding(value)) {
    const resolved = typeof value.$path === 'string'
      ? readPath(scope, value.$path)
      : readPath(scope.row, value.$row ?? '');
    return formatValue(resolved === undefined ? value.fallback : resolved, value.format, locale);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveDeclarativeValue(entry, scope, locale));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveDeclarativeValue(entry, scope, locale)]),
    );
  }
  return value;
};

export const displayDeclarativeValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};
