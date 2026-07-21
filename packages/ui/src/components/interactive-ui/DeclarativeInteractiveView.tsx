import React from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  displayDeclarativeValue,
  resolveDeclarativeValue,
} from '@/lib/interactive-ui/bindings';
import { sanitizeGeneratedLayout } from '@/lib/interactive-ui/generatedLayout';
import { classifyInteractiveUIError } from '@/lib/interactive-ui/state';
import type {
  DeclarativeActionDefinition,
  DeclarativeBindingScope,
  DeclarativeViewDefinition,
  DeclarativeViewNode,
  InteractiveResultEnvelope,
  InteractiveViewHost,
} from '@/lib/interactive-ui/types';
import {
  AccordionPrimitive,
  ActivityFeedPrimitive,
  CodeBlockPrimitive,
  ComparisonPrimitive,
  DiffSummaryPrimitive,
  GitGraphPrimitive,
  SparklinePrimitive,
  TabsPrimitive,
  TimelinePrimitive,
  TreePrimitive,
} from './DeclarativeAdvancedPrimitives';
import { InteractiveUIStateNotice } from './InteractiveUIStateNotice';

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
  align?: string;
};

type ChartSeries = {
  key: string;
  label?: string;
};

type ChartTooltipState = {
  x: number;
  y: number;
  label: string;
  series: string;
  value: string;
};

const CHART_COLORS = [
  'var(--ocix-chart-1)',
  'var(--ocix-chart-2)',
  'var(--ocix-chart-3)',
  'var(--ocix-chart-4)',
  'var(--ocix-chart-5)',
];

const OCIX_PANEL = 'rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3';
const OCIX_TITLE = 'typography-ui-label font-medium text-[var(--ocix-foreground)]';
const OCIX_META = 'typography-meta text-[var(--ocix-muted-foreground)]';

const HorizontalOverflowRegion: React.FC<{
  children: React.ReactNode;
  label?: string;
  className?: string;
}> = ({ children, label, className }) => {
  const { t } = useI18n();
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const handleVisibilityChange = React.useCallback((visibility: 'both' | 'none' | 'top' | 'bottom' | 'left' | 'right') => {
    setHasOverflow(visibility !== 'none');
  }, []);
  const accessibleLabel = label
    ? `${label}. ${t('interactiveUI.common.horizontalScrollHint')}`
    : t('interactiveUI.common.horizontalScrollHint');

  return (
    <div className={cn('min-w-0', className)}>
      <ScrollShadow
        orientation="horizontal"
        size={28}
        className="min-w-0 overflow-x-auto"
        role={hasOverflow ? 'region' : undefined}
        aria-label={hasOverflow ? accessibleLabel : undefined}
        tabIndex={hasOverflow ? 0 : undefined}
        onVisibilityChange={handleVisibilityChange}
      >
        {children}
      </ScrollShadow>
      {hasOverflow ? (
        <div className="flex items-center justify-end gap-1.5 px-2 py-1.5 typography-micro text-[var(--ocix-muted-foreground)]">
          <Icon name="arrow-left-right" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('interactiveUI.common.horizontalScrollHint')}</span>
        </div>
      ) : null}
    </div>
  );
};

const metricToneClass = (tone: unknown): string => {
  if (tone === 'positive' || tone === 'success') return 'text-[var(--ocix-success)]';
  if (tone === 'negative' || tone === 'error') return 'text-[var(--ocix-error)]';
  if (tone === 'warning') return 'text-[var(--ocix-warning)]';
  if (tone === 'info') return 'text-[var(--ocix-info)]';
  return 'text-[var(--ocix-foreground)]';
};

const trendIcon = (trend: unknown): IconName | null => {
  if (trend === 'up') return 'arrow-up';
  if (trend === 'down') return 'arrow-down';
  if (trend === 'flat') return 'subtract';
  return null;
};

const flowStepClass = (status: unknown): string => {
  if (status === 'completed') return 'bg-[var(--ocix-success)] text-[var(--ocix-primary-foreground)]';
  if (status === 'error') return 'bg-[var(--ocix-error)] text-[var(--ocix-primary-foreground)]';
  if (status === 'pending') return 'bg-[var(--ocix-surface-muted)] text-[var(--ocix-muted-foreground)]';
  return 'bg-[var(--ocix-selection)] text-[var(--ocix-selection-foreground)]';
};

const calloutIcon = (tone: unknown): IconName => {
  if (tone === 'success') return 'checkbox-circle';
  if (tone === 'error') return 'close-circle';
  if (tone === 'warning') return 'error-warning';
  return 'information';
};

const isNumericColumn = (column: DataTableColumn): boolean => (
  column.align === 'right'
  || column.format === 'number'
  || column.format === 'percent'
  || column.format?.startsWith('currency:') === true
);

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
  if (tone === 'success') return 'border-[var(--ocix-success-border)] bg-[var(--ocix-success-background)] text-[var(--ocix-success)]';
  if (tone === 'error') return 'border-[var(--ocix-error-border)] bg-[var(--ocix-error-background)] text-[var(--ocix-error)]';
  if (tone === 'warning') return 'border-[var(--ocix-warning-border)] bg-[var(--ocix-warning-background)] text-[var(--ocix-warning)]';
  if (tone === 'info') return 'border-[var(--ocix-info-border)] bg-[var(--ocix-info-background)] text-[var(--ocix-info)]';
  const normalized = value.toLowerCase();
  if (['approved', 'success', 'completed', 'active', 'ok'].includes(normalized)) {
    return 'border-[var(--ocix-success-border)] bg-[var(--ocix-success-background)] text-[var(--ocix-success)]';
  }
  if (['failed', 'error', 'rejected', 'blocked'].includes(normalized)) {
    return 'border-[var(--ocix-error-border)] bg-[var(--ocix-error-background)] text-[var(--ocix-error)]';
  }
  if (['warning', 'pending', 'review'].includes(normalized)) {
    return 'border-[var(--ocix-warning-border)] bg-[var(--ocix-warning-background)] text-[var(--ocix-warning)]';
  }
  return 'border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] text-[var(--ocix-muted-foreground)]';
};

const DeclarativeChart: React.FC<{
  node: DeclarativeViewNode;
  resolveValue: (value: unknown) => unknown;
  emptyLabel: string;
}> = ({ node, resolveValue, emptyLabel }) => {
  const [tooltip, setTooltip] = React.useState<ChartTooltipState | null>(null);
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

  if (rows.length === 0 || series.length === 0 || values.length === 0) {
    return (
      <div className={cn(OCIX_PANEL, 'py-8 text-center')}>
        {node.title ? <div className={cn('mb-2', OCIX_TITLE)}>{node.title}</div> : null}
        <div className={OCIX_META}>{emptyLabel}</div>
      </div>
    );
  }

  if (variant === 'donut') {
    const item = series[0];
    const parts = rows.map((row) => ({
      label: displayDeclarativeValue(row[xKey]),
      value: Math.max(0, Number(row[item.key]) || 0),
    })).filter((part) => part.value > 0);
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    let offset = 0;
    const segments = parts.map((part) => {
      const fraction = total > 0 ? part.value / total : 0;
      const start = offset;
      offset += fraction;
      const angle = (start + fraction / 2) * Math.PI * 2 - Math.PI / 2;
      return {
        ...part,
        fraction,
        start,
        tooltip: {
          x: 110 + Math.cos(angle) * 72,
          y: 110 + Math.sin(angle) * 72,
          label: part.label,
          series: item.label ?? item.key,
          value: `${displayDeclarativeValue(part.value)} · ${new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(fraction)}`,
        },
      };
    });
    if (segments.length === 0) {
      return (
        <div className={cn(OCIX_PANEL, 'py-8 text-center')}>
          {node.title ? <div className={cn('mb-2', OCIX_TITLE)}>{node.title}</div> : null}
          <div className={OCIX_META}>{emptyLabel}</div>
        </div>
      );
    }
    return (
      <div className={OCIX_PANEL}>
        {node.title ? <div className={cn('mb-3', OCIX_TITLE)}>{node.title}</div> : null}
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(10rem,0.8fr)_minmax(10rem,1.2fr)]">
          <div className="relative mx-auto size-full max-h-52 max-w-52" onPointerLeave={() => setTooltip(null)}>
            <svg viewBox="0 0 220 220" className="size-full" role="group" aria-label={typeof node.title === 'string' ? node.title : undefined}>
              <circle cx="110" cy="110" r="72" fill="none" stroke="var(--ocix-surface-muted)" strokeWidth="32" aria-hidden="true" />
              {segments.map((segment, index) => (
                <circle
                  key={`${segment.label}:${index}`}
                  cx="110"
                  cy="110"
                  r="72"
                  fill="none"
                  pathLength="100"
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth="32"
                  strokeDasharray={`${segment.fraction * 100} ${100 - segment.fraction * 100}`}
                  strokeDashoffset={-segment.start * 100}
                  transform="rotate(-90 110 110)"
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${segment.label} · ${segment.tooltip.value}`}
                  onPointerEnter={() => setTooltip(segment.tooltip)}
                  onFocus={() => setTooltip(segment.tooltip)}
                  onBlur={() => setTooltip(null)}
                />
              ))}
              <text x="110" y="102" textAnchor="middle" className="fill-[var(--ocix-muted-foreground)] typography-micro">{item.label ?? item.key}</text>
              <text x="110" y="128" textAnchor="middle" className="fill-[var(--ocix-foreground)] typography-ui-header font-semibold">{displayDeclarativeValue(total)}</text>
            </svg>
            {tooltip ? (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 min-w-28 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface)] px-2.5 py-2 shadow-lg"
                style={{ left: `${(tooltip.x / 220) * 100}%`, top: `${(tooltip.y / 220) * 100}%` }}
              >
                <div className="typography-micro text-[var(--ocix-muted-foreground)]">{tooltip.label}</div>
                <div className="mt-0.5 flex items-center justify-between gap-3 typography-meta text-[var(--ocix-foreground)]">
                  <span>{tooltip.series}</span>
                  <span className="font-semibold">{tooltip.value}</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            {segments.map((segment, index) => (
              <div
                key={`${segment.label}:legend:${index}`}
                className="flex min-w-0 items-center gap-2 rounded-md typography-meta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ocix-focus-ring)]"
                tabIndex={0}
                onFocus={() => setTooltip(segment.tooltip)}
                onBlur={() => setTooltip(null)}
              >
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-[var(--ocix-muted-foreground)]">{segment.label}</span>
                <span className="font-medium text-[var(--ocix-foreground)]">{displayDeclarativeValue(segment.value)}</span>
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
    <div className={OCIX_PANEL}>
      {node.title ? <div className={cn('mb-3', OCIX_TITLE)}>{node.title}</div> : null}
      <HorizontalOverflowRegion label={node.title}>
        <div className="relative min-w-[32rem]" onPointerLeave={() => setTooltip(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="group" aria-label={typeof node.title === 'string' ? node.title : undefined}>
          {Array.from({ length: 5 }, (_, index) => {
            const ratio = index / 4;
            const y = margin.top + ratio * plotHeight;
            const value = maxValue - ratio * extent;
            return (
              <g key={`grid:${index}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="var(--ocix-border)" strokeOpacity="0.55" strokeDasharray="3 4" />
                <text x={margin.left - 8} y={y + 4} textAnchor="end" className="fill-[var(--ocix-muted-foreground)] typography-micro">{formatTick(value)}</text>
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
              const label = displayDeclarativeValue(row[xKey]);
              const seriesLabel = item.label ?? item.key;
              const tooltipState = {
                x: xAt(rowIndex) - groupWidth / 2 + seriesIndex * barWidth + barWidth / 2,
                y: Math.min(y, baseline),
                label,
                series: seriesLabel,
                value: displayDeclarativeValue(value),
              };
              return (
                <rect
                  key={`${rowIndex}:${item.key}`}
                  x={xAt(rowIndex) - groupWidth / 2 + seriesIndex * barWidth}
                  y={Math.min(y, baseline)}
                  width={Math.max(1, barWidth - 2)}
                  height={Math.max(1, Math.abs(baseline - y))}
                  rx="3"
                  fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${label} · ${seriesLabel}: ${displayDeclarativeValue(value)}`}
                  onPointerEnter={() => setTooltip(tooltipState)}
                  onFocus={() => setTooltip(tooltipState)}
                  onBlur={() => setTooltip(null)}
                />
              );
            });
          }) : series.map((item, seriesIndex) => {
            const points = rows.flatMap((row, rowIndex) => {
              const value = Number(row[item.key]);
              return Number.isFinite(value) ? [{
                x: xAt(rowIndex),
                y: yAt(value),
                label: displayDeclarativeValue(row[xKey]),
                value,
              }] : [];
            });
            if (points.length === 0) return null;
            const linePath = points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
            const areaPath = `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
            return (
              <g key={item.key}>
                {variant === 'area' ? <path d={areaPath} fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]} opacity="0.14" /> : null}
                <path d={linePath} fill="none" stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {points.map(({ x, y, label, value }, pointIndex) => {
                  const seriesLabel = item.label ?? item.key;
                  const tooltipState = {
                    x,
                    y,
                    label,
                    series: seriesLabel,
                    value: displayDeclarativeValue(value),
                  };
                  return (
                    <circle
                      key={`${item.key}:${pointIndex}`}
                      cx={x}
                      cy={y}
                      r={points.length <= 16 ? 3.5 : 6}
                      fill={points.length <= 16 ? 'var(--ocix-surface)' : 'transparent'}
                      stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                      strokeWidth={points.length <= 16 ? 2 : 0}
                      tabIndex={0}
                      role="graphics-symbol"
                      aria-label={`${label} · ${seriesLabel}: ${displayDeclarativeValue(value)}`}
                      onPointerEnter={() => setTooltip(tooltipState)}
                      onFocus={() => setTooltip(tooltipState)}
                      onBlur={() => setTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
          {rows.map((row, index) => (index === 0 || index === rows.length - 1 || index % labelEvery === 0) ? (
            <text key={`label:${index}`} x={xAt(index)} y={height - 14} textAnchor="middle" className="fill-[var(--ocix-muted-foreground)] typography-micro">
              {displayDeclarativeValue(row[xKey]).slice(0, 14)}
            </text>
          ) : null)}
        </svg>
        {tooltip ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 min-w-28 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface)] px-2.5 py-2 shadow-lg"
            style={{ left: `${(tooltip.x / width) * 100}%`, top: `${(tooltip.y / height) * 100}%` }}
          >
            <div className="typography-micro text-[var(--ocix-muted-foreground)]">{tooltip.label}</div>
            <div className="mt-0.5 flex items-center justify-between gap-3 typography-meta text-[var(--ocix-foreground)]">
              <span>{tooltip.series}</span>
              <span className="font-semibold">{tooltip.value}</span>
            </div>
          </div>
        ) : null}
        </div>
      </HorizontalOverflowRegion>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((item, index) => (
          <div key={item.key} className="flex items-center gap-1.5 typography-meta text-[var(--ocix-muted-foreground)]">
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
  emptyLabel: string;
}> = ({ node, scope, locale, host, refreshQueries, emptyLabel }) => {
  const [runningAction, setRunningAction] = React.useState<string | null>(null);
  const resolved = (value: unknown, row?: unknown) => resolveDeclarativeValue(value, { ...scope, row }, locale);
  const renderChildren = (value: unknown): React.ReactNode => (
    <div className="space-y-3">
      {asNodes(value).map((child, index) => (
        <DeclarativeNode key={`${child.type}:${index}`} node={child} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} emptyLabel={emptyLabel} />
      ))}
    </div>
  );

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
      ? <DeclarativeNode node={generatedLayout} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} emptyLabel={emptyLabel} />
      : null;
  }

  if (node.type === 'stack' || node.type === 'section') {
    return (
      <section className={cn('min-w-0', node.type === 'section' && node.variant === 'bordered' && OCIX_PANEL)}>
        {node.title ? <h3 className={cn('mb-2', OCIX_TITLE)}>{node.title}</h3> : null}
        <div className="space-y-3">
          {asNodes(node.children).map((child, index) => (
            <DeclarativeNode key={`${child.type}:${index}`} node={child} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} emptyLabel={emptyLabel} />
          ))}
        </div>
      </section>
    );
  }

  if (node.type === 'row' || node.type === 'grid') {
    return (
      <div className={cn('grid gap-3', columnsClass(node.columns ?? (node.type === 'row' ? 2 : 1)))}>
        {asNodes(node.children).map((child, index) => (
          <DeclarativeNode key={`${child.type}:${index}`} node={child} scope={scope} locale={locale} host={host} refreshQueries={refreshQueries} emptyLabel={emptyLabel} />
        ))}
      </div>
    );
  }

  if (node.type === 'metric-grid') {
    return (
      <div className={cn('grid gap-2', columnsClass(node.columns))}>
        {(Array.isArray(node.items) ? node.items : []).map((item, index) => {
          const metric = asRecord(item) ?? {};
          const tone = resolved(metric.tone);
          const trend = resolved(metric.trend);
          const trendName = trendIcon(trend);
          return (
            <div key={String(metric.label ?? index)} className={OCIX_PANEL}>
              <div className={OCIX_META}>{displayDeclarativeValue(metric.label)}</div>
              <div className={cn('mt-1 flex min-w-0 items-center gap-1 typography-body font-semibold', metricToneClass(tone))}>
                {trendName ? <Icon name={trendName} className="size-3.5 shrink-0" /> : null}
                <span className="min-w-0 break-words">{displayDeclarativeValue(resolved(metric.value))}</span>
              </div>
              {metric.trendValue !== undefined ? <div className={cn('mt-0.5 typography-micro', metricToneClass(tone))}>{displayDeclarativeValue(resolved(metric.trendValue))}</div> : null}
              {metric.detail !== undefined ? <div className={cn('mt-1', OCIX_META)}>{displayDeclarativeValue(resolved(metric.detail))}</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (node.type === 'metric') {
    const tone = resolved(node.tone);
    const trendName = trendIcon(resolved(node.trend));
    return (
      <div className={OCIX_PANEL}>
        {node.label ? <div className={OCIX_META}>{node.label}</div> : null}
        <div className={cn('mt-1 flex min-w-0 items-center gap-1 typography-body font-semibold', metricToneClass(tone))}>
          {trendName ? <Icon name={trendName} className="size-3.5 shrink-0" /> : null}
          <span className="min-w-0 break-words">{displayDeclarativeValue(resolved(node.value))}</span>
        </div>
        {node.trendValue !== undefined ? <div className={cn('mt-0.5 typography-micro', metricToneClass(tone))}>{displayDeclarativeValue(resolved(node.trendValue))}</div> : null}
        {node.detail !== undefined ? <div className={cn('mt-1', OCIX_META)}>{displayDeclarativeValue(resolved(node.detail))}</div> : null}
      </div>
    );
  }

  if (node.type === 'text' || node.type === 'markdown') {
    return <div className="whitespace-pre-wrap typography-body text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolved(node.value ?? node.data))}</div>;
  }

  if (node.type === 'progress') {
    const raw = Number(resolved(node.value));
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    return (
      <div className="space-y-1">
        {node.label ? <div className={OCIX_META}>{node.label}</div> : null}
        <div className="h-2 overflow-hidden rounded-full bg-[var(--ocix-surface-muted)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
          <div className={cn('h-full rounded-full transition-[width]', value >= 1 ? 'bg-[var(--ocix-success)]' : 'bg-[var(--ocix-primary)]')} style={{ width: `${value * 100}%` }} />
        </div>
        {node.detail !== undefined ? <div className={OCIX_META}>{displayDeclarativeValue(resolved(node.detail))}</div> : null}
      </div>
    );
  }

  if (node.type === 'status' || node.type === 'badge') {
    const value = displayDeclarativeValue(resolved(node.value));
    return (
      <div className="flex min-w-0 items-center justify-between gap-3">
        {node.label ? <span className={OCIX_META}>{node.label}</span> : null}
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
              <dt className={OCIX_META}>{displayDeclarativeValue(entry.label)}</dt>
              <dd className="break-words typography-body text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolved(entry.value))}</dd>
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
            <div className={cn('relative z-10 h-full', OCIX_PANEL)}>
              <div className="mb-2 flex items-center gap-2">
                <span className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full typography-meta font-semibold', flowStepClass(step.status))}>
                  {step.status === 'completed' ? <Icon name="check" className="size-3.5" /> : index + 1}
                </span>
                <div className={cn('min-w-0 break-words', OCIX_TITLE)}>
                  {displayDeclarativeValue(resolved(step.title))}
                </div>
              </div>
              {step.description !== undefined ? (
                <div className={cn('break-words', OCIX_META)}>
                  {displayDeclarativeValue(resolved(step.description))}
                </div>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <div aria-hidden="true" className={cn(
                'mx-auto h-2 w-px border-l lg:absolute lg:right-0 lg:top-1/2 lg:h-px lg:w-5 lg:border-l-0 lg:border-t',
                step.status === 'completed' ? 'border-solid border-[var(--ocix-success)]' : 'border-dashed border-[var(--ocix-border)]',
              )} />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  if (node.type === 'chart') {
    return <DeclarativeChart node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  }

  if (node.type === 'timeline') return <TimelinePrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'activity-feed') return <ActivityFeedPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'comparison') return <ComparisonPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'tabs') return <TabsPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} renderChildren={renderChildren} />;
  if (node.type === 'accordion') return <AccordionPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} renderChildren={renderChildren} />;
  if (node.type === 'code-block') return <CodeBlockPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'sparkline') return <SparklinePrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'git-graph') return <GitGraphPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'tree') return <TreePrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;
  if (node.type === 'diff-summary') return <DiffSummaryPrimitive node={node} resolveValue={resolved} emptyLabel={emptyLabel} />;

  if (node.type === 'divider') {
    return <hr className="border-[var(--ocix-border)]" />;
  }

  if (node.type === 'list') {
    const items = Array.isArray(node.items) ? node.items : [];
    const ListElement = node.ordered === true ? 'ol' : 'ul';
    return (
      <div className={OCIX_PANEL}>
        {node.title ? <div className={cn('mb-2', OCIX_TITLE)}>{node.title}</div> : null}
        <ListElement className="space-y-2">
          {items.map((item, index) => {
            const entry = asRecord(item);
            const itemTitle = entry ? displayDeclarativeValue(resolved(entry.title)) : displayDeclarativeValue(resolved(item));
            return (
              <li key={`${itemTitle}:${index}`} className="flex min-w-0 gap-2.5 rounded-lg bg-[var(--ocix-surface-muted)] px-3 py-2">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--ocix-selection)] typography-micro font-semibold text-[var(--ocix-selection-foreground)]">
                  {node.ordered === true ? index + 1 : '•'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="typography-meta font-medium text-[var(--ocix-foreground)]">{itemTitle}</span>
                    {entry?.badge !== undefined ? <span className={cn('shrink-0 rounded-full border px-2 py-0.5 typography-micro', statusClass('', resolved(entry.badgeTone)))}>{displayDeclarativeValue(resolved(entry.badge))}</span> : null}
                  </div>
                  {entry?.description !== undefined ? <div className={cn('mt-0.5', OCIX_META)}>{displayDeclarativeValue(resolved(entry.description))}</div> : null}
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
        <div className="flex gap-2">
          <Icon name={calloutIcon(node.tone)} className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            {node.title ? <div className="mb-1 typography-ui-label font-medium">{node.title}</div> : null}
            <div className="typography-meta">{value}</div>
          </div>
        </div>
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
      <div className="min-w-0 rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)]">
        {node.title ? <div className={cn('border-b border-[var(--ocix-border)] px-3 py-2', OCIX_TITLE)}>{node.title}</div> : null}
        <HorizontalOverflowRegion label={node.title}>
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--ocix-surface-muted)]">
            <tr>
              {columns.map((column) => <th key={column.key} className={cn('whitespace-nowrap px-3 py-2 typography-meta font-medium text-[var(--ocix-muted-foreground)]', isNumericColumn(column) && 'text-right')}>{column.label ?? column.key}</th>)}
              {actions.length > 0 ? <th className="w-1 px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const rowRecord = asRecord(row) ?? {};
              const rowKey = typeof node.rowKey === 'string' ? rowRecord[node.rowKey] : rowIndex;
              const visibleActions = actions.filter((action) => isActionVisible(action, row));
              return (
                <tr key={String(rowKey ?? rowIndex)} className={cn(
                  'border-t border-[var(--ocix-border)] transition-colors',
                  rowIndex % 2 === 1 && 'bg-[var(--ocix-surface-muted)]/50',
                  actions.length > 0 && 'hover:bg-[var(--ocix-surface-muted)]',
                )}>
                  {columns.map((column) => {
                    const value = resolveDeclarativeValue({ $row: column.key, format: column.format }, { ...scope, row }, locale);
                    return (
                      <td key={column.key} className={cn('px-3 py-2 typography-meta text-[var(--ocix-foreground)]', isNumericColumn(column) && 'text-right')}>
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
            {rows.length === 0 ? (
              <tr className="border-t border-[var(--ocix-border)]">
                <td colSpan={Math.max(1, columns.length + (actions.length > 0 ? 1 : 0))} className="px-3 py-6 text-center typography-meta text-[var(--ocix-muted-foreground)]">
                  {emptyLabel}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </HorizontalOverflowRegion>
      </div>
    );
  }

  return null;
};

export const DeclarativeInteractiveView: React.FC<DeclarativeInteractiveViewProps> = ({ definition, envelope, host }) => {
  const { t } = useI18n();
  const [queryData, setQueryData] = React.useState<Record<string, unknown>>({});
  const [queryError, setQueryError] = React.useState<Error | null>(null);
  const [queryRevision, setQueryRevision] = React.useState(0);
  const [queryLoading, setQueryLoading] = React.useState(() => Object.keys(definition.queries ?? {}).length > 0);
  const locale = host.context.locale;
  const refreshQueries = React.useCallback(() => setQueryRevision((revision) => revision + 1), []);

  React.useEffect(() => {
    const entries = Object.entries(definition.queries ?? {});
    if (entries.length === 0) {
      setQueryLoading(false);
      return;
    }
    let active = true;
    setQueryError(null);
    setQueryLoading(true);
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
    }).finally(() => {
      if (active) setQueryLoading(false);
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
      {definition.title ? <h2 className="typography-body font-semibold text-[var(--ocix-foreground)]">{definition.title}</h2> : null}
      {queryError ? (
        <InteractiveUIStateNotice
          state={Object.keys(queryData).length > 0 ? 'stale' : classifyInteractiveUIError(queryError)}
          onRetry={refreshQueries}
        />
      ) : null}
      {queryLoading && Object.keys(queryData).length === 0 ? (
        <div className="space-y-3 rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3" aria-label={t('common.loading')} aria-busy="true">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <DeclarativeNode
          node={definition.layout}
          scope={scope}
          locale={locale}
          host={host}
          refreshQueries={refreshQueries}
          emptyLabel={t('interactiveUI.common.noData')}
        />
      )}
    </div>
  );
};
