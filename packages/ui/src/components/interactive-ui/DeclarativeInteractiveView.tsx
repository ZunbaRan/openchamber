import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  displayDeclarativeValue,
  resolveDeclarativeValue,
} from '@/lib/interactive-ui/bindings';
import { sanitizeGeneratedLayout } from '@/lib/interactive-ui/generatedLayout';
import type {
  DeclarativeActionDefinition,
  DeclarativeBindingScope,
  DeclarativeViewDefinition,
  DeclarativeViewNode,
  InteractiveResultEnvelope,
  InteractiveViewHost,
} from '@/lib/interactive-ui/types';

interface DeclarativeInteractiveViewProps {
  definition: DeclarativeViewDefinition;
  envelope: InteractiveResultEnvelope;
  host: InteractiveViewHost;
}

type DataTableColumn = {
  key: string;
  label?: string;
  format?: string;
  render?: string;
};

type ChartSeries = {
  key: string;
  label?: string;
};

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const asNodes = (value: unknown): DeclarativeViewNode[] => (
  Array.isArray(value) ? value.filter((entry): entry is DeclarativeViewNode => !!asRecord(entry) && typeof entry.type === 'string') : []
);

const columnsClass = (value: unknown): string => {
  const record = asRecord(value);
  const count = typeof record?.default === 'number'
    ? Math.max(1, Math.min(4, Math.trunc(record.default)))
    : typeof value === 'number'
      ? Math.max(1, Math.min(4, Math.trunc(value)))
      : 1;
  if (count === 4) return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';
  if (count === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1';
};

const statusClass = (value: string, tone?: unknown): string => {
  if (tone === 'success') return 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]';
  if (tone === 'error') return 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]';
  if (tone === 'warning') return 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]';
  if (tone === 'info') return 'border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]';
  const normalized = value.toLowerCase();
  if (['approved', 'success', 'completed', 'active', 'ok'].includes(normalized)) {
    return 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]';
  }
  if (['failed', 'error', 'rejected', 'blocked'].includes(normalized)) {
    return 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]';
  }
  if (['warning', 'pending', 'review'].includes(normalized)) {
    return 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]';
  }
  return 'border-border bg-[var(--surface-muted)] text-muted-foreground';
};

const DeclarativeChart: React.FC<{
  node: DeclarativeViewNode;
  resolveValue: (value: unknown) => unknown;
}> = ({ node, resolveValue }) => {
  const data = resolveValue(node.data);
  const rows = Array.isArray(data)
    ? data.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const series = Array.isArray(node.series)
    ? node.series.map(asRecord).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry.key === 'string') as ChartSeries[]
    : [];
  const xKey = typeof node.xKey === 'string' ? node.xKey : 'label';
  const variant = typeof node.variant === 'string' ? node.variant : 'bar';
  const values = rows.flatMap((row) => series.map((item) => Number(row[item.key])).filter(Number.isFinite));

  if (rows.length === 0 || series.length === 0 || values.length === 0) return null;

  if (variant === 'donut') {
    const item = series[0];
    const parts = rows.map((row) => ({
      label: displayDeclarativeValue(row[xKey]),
      value: Math.max(0, Number(row[item.key]) || 0),
    })).filter((part) => part.value > 0);
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    let offset = 0;
    return (
      <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
        {node.title ? <div className="mb-3 typography-ui-label font-medium text-foreground">{node.title}</div> : null}
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(10rem,0.8fr)_minmax(10rem,1.2fr)]">
          <svg viewBox="0 0 220 220" className="mx-auto size-full max-h-52 max-w-52" {...(node.title ? { role: 'img', 'aria-label': node.title } : { 'aria-hidden': true })}>
            <circle cx="110" cy="110" r="72" fill="none" stroke="var(--surface-muted)" strokeWidth="32" />
            {parts.map((part, index) => {
              const fraction = total > 0 ? part.value / total : 0;
              const currentOffset = offset;
              offset += fraction;
              return (
                <circle
                  key={`${part.label}:${index}`}
                  cx="110"
                  cy="110"
                  r="72"
                  fill="none"
                  pathLength="100"
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth="32"
                  strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`}
                  strokeDashoffset={-currentOffset * 100}
                  transform="rotate(-90 110 110)"
                />
              );
            })}
            <text x="110" y="105" textAnchor="middle" className="fill-muted-foreground typography-meta">{item.label ?? item.key}</text>
            <text x="110" y="128" textAnchor="middle" className="fill-foreground typography-body font-semibold">{displayDeclarativeValue(total)}</text>
          </svg>
          <div className="grid gap-2">
            {parts.map((part, index) => (
              <div key={`${part.label}:legend:${index}`} className="flex min-w-0 items-center gap-2 typography-meta">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{part.label}</span>
                <span className="font-medium text-foreground">{displayDeclarativeValue(part.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const width = 680;
  const height = 260;
  const margin = { top: 16, right: 18, bottom: 42, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const rawMinValue = Math.min(...values);
  const rawMaxValue = Math.max(...values);
  const rawExtent = rawMaxValue - rawMinValue;
  const useFocusedLineDomain = variant === 'line'
    && rawMinValue > 0
    && rawExtent > 0
    && rawExtent / rawMaxValue < 0.4;
  const domainPadding = useFocusedLineDomain ? rawExtent * 0.15 : 0;
  const minValue = useFocusedLineDomain ? Math.max(0, rawMinValue - domainPadding) : Math.min(0, rawMinValue);
  const maxValue = useFocusedLineDomain ? rawMaxValue + domainPadding : Math.max(0, rawMaxValue);
  const extent = maxValue - minValue || 1;
  const xAt = (index: number): number => margin.left + ((index + 0.5) / rows.length) * plotWidth;
  const yAt = (value: number): number => margin.top + ((maxValue - value) / extent) * plotHeight;
  const baseline = yAt(0);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const formatTick = (value: number): string => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

  return (
    <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
      {node.title ? <div className="mb-3 typography-ui-label font-medium text-foreground">{node.title}</div> : null}
      <div className="min-w-0 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[32rem] w-full" {...(node.title ? { role: 'img', 'aria-label': node.title } : { 'aria-hidden': true })}>
          {Array.from({ length: 5 }, (_, index) => {
            const ratio = index / 4;
            const y = margin.top + ratio * plotHeight;
            const value = maxValue - ratio * extent;
            return (
              <g key={`grid:${index}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
                <text x={margin.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground typography-micro">{formatTick(value)}</text>
              </g>
            );
          })}
          {variant === 'bar' ? rows.flatMap((row, rowIndex) => {
            const groupWidth = (plotWidth / rows.length) * 0.72;
            const barWidth = Math.max(2, groupWidth / series.length);
            return series.map((item, seriesIndex) => {
              const value = Number(row[item.key]);
              if (!Number.isFinite(value)) return null;
              const y = yAt(value);
              return (
                <rect
                  key={`${rowIndex}:${item.key}`}
                  x={xAt(rowIndex) - groupWidth / 2 + seriesIndex * barWidth}
                  y={Math.min(y, baseline)}
                  width={Math.max(1, barWidth - 2)}
                  height={Math.max(1, Math.abs(baseline - y))}
                  rx="3"
                  fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                />
              );
            });
          }) : series.map((item, seriesIndex) => {
            const points = rows.map((row, rowIndex) => {
              const value = Number(row[item.key]);
              return Number.isFinite(value) ? [xAt(rowIndex), yAt(value)] as const : null;
            }).filter((point): point is readonly [number, number] => point !== null);
            if (points.length === 0) return null;
            const linePath = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
            const areaPath = `${linePath} L ${points[points.length - 1][0]} ${baseline} L ${points[0][0]} ${baseline} Z`;
            return (
              <g key={item.key}>
                {variant === 'area' ? <path d={areaPath} fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]} opacity="0.14" /> : null}
                <path d={linePath} fill="none" stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {points.length <= 16 ? points.map(([x, y], pointIndex) => (
                  <circle key={`${item.key}:${pointIndex}`} cx={x} cy={y} r="3.5" fill="var(--surface-elevated)" stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]} strokeWidth="2" />
                )) : null}
              </g>
            );
          })}
          {rows.map((row, index) => index % labelEvery === 0 ? (
            <text key={`label:${index}`} x={xAt(index)} y={height - 14} textAnchor="middle" className="fill-muted-foreground typography-micro">
              {displayDeclarativeValue(row[xKey]).slice(0, 14)}
            </text>
          ) : null)}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((item, index) => (
          <div key={item.key} className="flex items-center gap-1.5 typography-meta text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
            {item.label ?? item.key}
          </div>
        ))}
      </div>
    </div>
  );
};

const DeclarativeNode: React.FC<{
  node: DeclarativeViewNode;
  scope: DeclarativeBindingScope;
  locale: string;
  host: InteractiveViewHost;
  refreshQueries: () => void;
}> = ({ node, scope, locale, host, refreshQueries }) => {
  const [runningAction, setRunningAction] = React.useState<string | null>(null);
  const resolved = (value: unknown, row?: unknown) => resolveDeclarativeValue(value, { ...scope, row }, locale);

  const executeAction = async (action: DeclarativeActionDefinition, row?: unknown) => {
    setRunningAction(action.id || action.action);
    try {
      if (action.confirm && !await host.dialog.confirm(action.confirm)) return;
      await host.business.execute(action.action, resolved(action.input ?? {}, row));
      refreshQueries();
    } catch (error) {
      host.notifications.show({ message: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setRunningAction(null);
    }
  };

  const isActionVisible = (action: DeclarativeActionDefinition, row?: unknown): boolean => {
    if (!action.when) return true;
    const value = resolved(action.when.value, row);
    if ('equals' in action.when) return value === resolved(action.when.equals, row);
    return Boolean(value);
  };

  if (node.type === 'generated-layout') {
    const generatedLayout = sanitizeGeneratedLayout(resolved(node.data));
    return generatedLayout
      ? <DeclarativeNode node={generatedLayout} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} />
      : null;
  }

  if (node.type === 'stack' || node.type === 'section') {
    return (
      <section className={cn('min-w-0', node.type === 'section' && 'rounded-xl border border-border bg-[var(--surface-elevated)] p-3')}>
        {node.title ? <h3 className="mb-2 typography-ui-label font-medium text-foreground">{node.title}</h3> : null}
        <div className="space-y-3">
          {asNodes(node.children).map((child, index) => (
            <DeclarativeNode key={`${child.type}:${index}`} node={child} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} />
          ))}
        </div>
      </section>
    );
  }

  if (node.type === 'row' || node.type === 'grid') {
    return (
      <div className={cn('grid gap-3', columnsClass(node.columns ?? (node.type === 'row' ? 2 : 1)))}>
        {asNodes(node.children).map((child, index) => (
          <DeclarativeNode key={`${child.type}:${index}`} node={child} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} />
        ))}
      </div>
    );
  }

  if (node.type === 'metric-grid') {
    return (
      <div className={cn('grid gap-2', columnsClass(node.columns))}>
        {(Array.isArray(node.items) ? node.items : []).map((item, index) => {
          const metric = asRecord(item) ?? {};
          return (
            <div key={String(metric.label ?? index)} className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
              <div className="typography-meta text-muted-foreground">{displayDeclarativeValue(metric.label)}</div>
              <div className="mt-1 typography-body font-semibold text-foreground">{displayDeclarativeValue(resolved(metric.value))}</div>
              {metric.detail !== undefined ? <div className="mt-1 typography-meta text-muted-foreground">{displayDeclarativeValue(resolved(metric.detail))}</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (node.type === 'metric') {
    return (
      <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
        {node.label ? <div className="typography-meta text-muted-foreground">{node.label}</div> : null}
        <div className="mt-1 typography-body font-semibold text-foreground">{displayDeclarativeValue(resolved(node.value))}</div>
        {node.detail !== undefined ? <div className="mt-1 typography-meta text-muted-foreground">{displayDeclarativeValue(resolved(node.detail))}</div> : null}
      </div>
    );
  }

  if (node.type === 'text' || node.type === 'markdown') {
    return <div className="whitespace-pre-wrap typography-body text-foreground">{displayDeclarativeValue(resolved(node.value ?? node.data))}</div>;
  }

  if (node.type === 'progress') {
    const raw = Number(resolved(node.value));
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    return (
      <div className="space-y-1">
        {node.label ? <div className="typography-meta text-muted-foreground">{node.label}</div> : null}
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div className="h-full bg-[var(--primary-base)]" style={{ width: `${value * 100}%` }} />
        </div>
        {node.detail !== undefined ? <div className="typography-meta text-muted-foreground">{displayDeclarativeValue(resolved(node.detail))}</div> : null}
      </div>
    );
  }

  if (node.type === 'status' || node.type === 'badge') {
    const value = displayDeclarativeValue(resolved(node.value));
    return (
      <div className="flex min-w-0 items-center justify-between gap-3">
        {node.label ? <span className="typography-meta text-muted-foreground">{node.label}</span> : null}
        <span className={cn('inline-flex rounded-full border px-2 py-0.5 typography-meta', statusClass(value, node.tone))}>{value}</span>
      </div>
    );
  }

  if (node.type === 'key-value') {
    return (
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Array.isArray(node.items) ? node.items : []).map((item, index) => {
          const entry = asRecord(item) ?? {};
          return (
            <div key={String(entry.label ?? index)} className="min-w-0">
              <dt className="typography-meta text-muted-foreground">{displayDeclarativeValue(entry.label)}</dt>
              <dd className="truncate typography-body text-foreground">{displayDeclarativeValue(resolved(entry.value))}</dd>
            </div>
          );
        })}
      </dl>
    );
  }

  if (node.type === 'flow') {
    const value = resolved(node.data ?? node.items ?? []);
    const steps = Array.isArray(value)
      ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
      : [];
    return (
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] lg:gap-0">
        {steps.map((step, index) => (
          <div key={`${displayDeclarativeValue(step.title)}:${index}`} className="relative min-w-0 lg:pr-5">
            <div className="relative z-10 h-full rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--interactive-selection)] typography-meta font-semibold text-[var(--interactive-selection-foreground)]">
                  {index + 1}
                </span>
                <div className="typography-ui-label font-medium text-foreground">
                  {displayDeclarativeValue(resolved(step.title))}
                </div>
              </div>
              {step.description !== undefined ? (
                <div className="typography-meta text-muted-foreground">
                  {displayDeclarativeValue(resolved(step.description))}
                </div>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <div aria-hidden="true" className="mx-auto h-2 w-px bg-border lg:absolute lg:right-0 lg:top-1/2 lg:h-px lg:w-5" />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  if (node.type === 'chart') {
    return <DeclarativeChart node={node} resolveValue={resolved} />;
  }

  if (node.type === 'list') {
    const items = Array.isArray(node.items) ? node.items : [];
    const ListElement = node.ordered === true ? 'ol' : 'ul';
    return (
      <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3">
        {node.title ? <div className="mb-2 typography-ui-label font-medium text-foreground">{node.title}</div> : null}
        <ListElement className="space-y-2">
          {items.map((item, index) => {
            const entry = asRecord(item);
            const itemTitle = entry ? displayDeclarativeValue(resolved(entry.title)) : displayDeclarativeValue(resolved(item));
            return (
              <li key={`${itemTitle}:${index}`} className="flex min-w-0 gap-2.5 rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--interactive-selection)] typography-micro font-semibold text-[var(--interactive-selection-foreground)]">
                  {node.ordered === true ? index + 1 : '•'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="typography-meta font-medium text-foreground">{itemTitle}</span>
                    {entry?.badge !== undefined ? <span className="shrink-0 rounded-full border border-border px-2 py-0.5 typography-micro text-muted-foreground">{displayDeclarativeValue(resolved(entry.badge))}</span> : null}
                  </div>
                  {entry?.description !== undefined ? <div className="mt-0.5 typography-meta text-muted-foreground">{displayDeclarativeValue(resolved(entry.description))}</div> : null}
                </div>
              </li>
            );
          })}
        </ListElement>
      </div>
    );
  }

  if (node.type === 'callout') {
    const value = displayDeclarativeValue(resolved(node.value ?? node.data));
    return (
      <div className={cn('rounded-xl border px-3 py-2.5', statusClass('', node.tone))}>
        {node.title ? <div className="mb-1 typography-ui-label font-medium">{node.title}</div> : null}
        <div className="typography-meta">{value}</div>
      </div>
    );
  }

  if (node.type === 'data-table') {
    const data = resolved(node.data);
    const rows = Array.isArray(data) ? data : [];
    const columns = Array.isArray(node.columns)
      ? node.columns.map(asRecord).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry.key === 'string') as DataTableColumn[]
      : [];
    const actions = Array.isArray(node.rowActions)
      ? node.rowActions.filter((entry): entry is DeclarativeActionDefinition => !!asRecord(entry) && typeof entry.action === 'string' && typeof entry.label === 'string')
      : [];
    return (
      <div className="min-w-0 overflow-auto rounded-xl border border-border bg-[var(--surface-elevated)]">
        {node.title ? <div className="border-b border-border px-3 py-2 typography-ui-label font-medium text-foreground">{node.title}</div> : null}
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <thead className="bg-[var(--surface-muted)]">
            <tr>
              {columns.map((column) => <th key={column.key} className="px-3 py-2 typography-meta font-medium text-muted-foreground">{column.label ?? column.key}</th>)}
              {actions.length > 0 ? <th className="w-1 px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const rowRecord = asRecord(row) ?? {};
              const rowKey = typeof node.rowKey === 'string' ? rowRecord[node.rowKey] : rowIndex;
              const visibleActions = actions.filter((action) => isActionVisible(action, row));
              return (
                <tr key={String(rowKey ?? rowIndex)} className="border-t border-border">
                  {columns.map((column) => {
                    const value = resolveDeclarativeValue({ $row: column.key, format: column.format }, { ...scope, row }, locale);
                    return (
                      <td key={column.key} className="px-3 py-2 typography-meta text-foreground">
                        {column.render === 'status'
                          ? <span className={cn('inline-flex rounded-full border px-2 py-0.5', statusClass(displayDeclarativeValue(value)))}>{displayDeclarativeValue(value)}</span>
                          : displayDeclarativeValue(value)}
                      </td>
                    );
                  })}
                  {actions.length > 0 ? (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {visibleActions.map((action) => (
                        <Button
                          key={action.id || action.action}
                          variant="outline"
                          size="xs"
                          disabled={runningAction !== null}
                          onClick={() => void executeAction(action, row)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
};

export const DeclarativeInteractiveView: React.FC<DeclarativeInteractiveViewProps> = ({ definition, envelope, host }) => {
  const [queryData, setQueryData] = React.useState<Record<string, unknown>>({});
  const [queryError, setQueryError] = React.useState<Error | null>(null);
  const [queryRevision, setQueryRevision] = React.useState(0);
  const locale = host.context.locale;
  const refreshQueries = React.useCallback(() => setQueryRevision((revision) => revision + 1), []);

  React.useEffect(() => {
    const entries = Object.entries(definition.queries ?? {});
    if (entries.length === 0) return;
    let active = true;
    setQueryError(null);
    const baseScope: DeclarativeBindingScope = {
      data: envelope.data,
      context: envelope.context,
      query: {},
      host: { locale },
    };
    void Promise.all(entries.map(async ([key, query]) => {
      const input = resolveDeclarativeValue(query.input ?? {}, baseScope, locale);
      const value = await host.business.query(query.action, input);
      return [key, value] as const;
    })).then((results) => {
      if (active) setQueryData(Object.fromEntries(results));
    }).catch((error) => {
      if (active) setQueryError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => { active = false; };
  }, [definition.queries, envelope.context, envelope.data, host.business, locale, queryRevision]);

  const scope: DeclarativeBindingScope = {
    data: envelope.data,
    context: envelope.context,
    query: queryData,
    host: { locale },
  };

  return (
    <div className="min-w-0 space-y-3">
      {definition.title ? <h2 className="typography-body font-semibold text-foreground">{definition.title}</h2> : null}
      {queryError ? <div className="rounded-xl border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-2 typography-meta text-[var(--status-error)]">{queryError.message}</div> : null}
      <DeclarativeNode node={definition.layout} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} />
    </div>
  );
};
