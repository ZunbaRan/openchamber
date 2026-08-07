import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { displayDeclarativeValue } from '@/lib/interactive-ui/bindings';
import type { DeclarativeViewNode } from '@/lib/interactive-ui/types';

type Resolver = (value: unknown) => unknown;

interface PrimitiveProps {
  node: DeclarativeViewNode;
  resolveValue: Resolver;
  emptyLabel: string;
}

interface ContainerPrimitiveProps extends PrimitiveProps {
  renderChildren: (value: unknown) => React.ReactNode;
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const resolvedRecords = (value: unknown, resolveValue: Resolver): Record<string, unknown>[] => {
  const resolved = resolveValue(value);
  return Array.isArray(resolved)
    ? resolved.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
};

const PANEL = 'rounded-[var(--ocix-radius-md)] border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3';
const TITLE = 'typography-ui-label font-medium text-[var(--ocix-foreground)]';
const META = 'typography-meta text-[var(--ocix-muted-foreground)]';

const dotClass = (tone: unknown): string => {
  if (tone === 'success' || tone === 'completed') return 'bg-[var(--ocix-success)]';
  if (tone === 'error') return 'bg-[var(--ocix-error)]';
  if (tone === 'warning' || tone === 'pending') return 'bg-[var(--ocix-warning)]';
  if (tone === 'info' || tone === 'active') return 'bg-[var(--ocix-info)]';
  return 'bg-[var(--ocix-muted-foreground)]';
};

export const TimelinePrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const items = resolvedRecords(node.items ?? node.data, resolveValue);
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-3', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      {items.length === 0 ? <div className={cn('py-5 text-center', META)}>{emptyLabel}</div> : (
        <ol className="space-y-0">
          {items.map((item, index) => (
            <li key={`${displayDeclarativeValue(item.title)}:${index}`} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
              <div className="relative flex justify-center">
                {index < items.length - 1 ? <span aria-hidden="true" className="absolute bottom-[-0.25rem] top-3 w-px bg-[var(--ocix-border)]" /> : null}
                <span aria-hidden="true" className={cn('relative z-10 mt-1.5 size-2.5 rounded-full ring-4 ring-[var(--ocix-surface)]', dotClass(item.tone ?? item.status))} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className={cn('min-w-0 break-words', TITLE)}>{displayDeclarativeValue(resolveValue(item.title))}</span>
                  {item.timestamp !== undefined ? <time className={cn('shrink-0', META)}>{displayDeclarativeValue(resolveValue(item.timestamp))}</time> : null}
                </div>
                {item.description !== undefined ? <div className={cn('mt-0.5 break-words', META)}>{displayDeclarativeValue(resolveValue(item.description))}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export const ActivityFeedPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const items = resolvedRecords(node.items ?? node.data, resolveValue);
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      {items.length === 0 ? <div className={cn('py-5 text-center', META)}>{emptyLabel}</div> : (
        <ul className="divide-y divide-[var(--ocix-border)]">
          {items.map((item, index) => {
            const actor = displayDeclarativeValue(resolveValue(item.actor ?? item.title));
            return (
              <li key={`${actor}:${index}`} className="flex min-w-0 gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ocix-surface-muted)] typography-micro font-semibold text-[var(--ocix-foreground)]">
                  {actor.slice(0, 1).toUpperCase() || '•'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words typography-meta text-[var(--ocix-foreground)]">
                      <strong className="font-medium">{actor}</strong>{item.action !== undefined ? ` ${displayDeclarativeValue(resolveValue(item.action))}` : ''}
                    </span>
                    {item.timestamp !== undefined ? <time className="typography-micro text-[var(--ocix-muted-foreground)]">{displayDeclarativeValue(resolveValue(item.timestamp))}</time> : null}
                  </div>
                  {item.description !== undefined ? <div className={cn('mt-0.5 break-words', META)}>{displayDeclarativeValue(resolveValue(item.description))}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const ComparisonPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const columns = resolvedRecords(node.columns, (value) => value).filter((column) => typeof column.key === 'string');
  const rows = resolvedRecords(node.data ?? node.items, resolveValue);
  return (
    <section className="min-w-0 overflow-auto rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)]">
      {node.title ? <h3 className={cn('border-b border-[var(--ocix-border)] px-3 py-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <table className="w-full min-w-[30rem] border-collapse">
        <thead className="sticky top-0 z-10 bg-[var(--ocix-surface-muted)]">
          <tr>{columns.map((column) => <th key={String(column.key)} className="px-3 py-2 text-left typography-meta font-medium text-[var(--ocix-muted-foreground)]">{displayDeclarativeValue(column.label ?? column.key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row.id ?? rowIndex)} className={cn('border-t border-[var(--ocix-border)]', rowIndex % 2 === 1 && 'bg-[var(--ocix-surface-muted)]/50')}>
              {columns.map((column, columnIndex) => (
                <td key={String(column.key)} className={cn('max-w-[20rem] whitespace-normal break-words px-3 py-2 typography-meta text-[var(--ocix-foreground)]', columnIndex === 0 && 'font-medium')}>
                  {displayDeclarativeValue(resolveValue(row[String(column.key)]))}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={Math.max(1, columns.length)} className={cn('px-3 py-6 text-center', META)}>{emptyLabel}</td></tr> : null}
        </tbody>
      </table>
    </section>
  );
};

export const TabsPrimitive: React.FC<ContainerPrimitiveProps> = ({ node, resolveValue, renderChildren, emptyLabel }) => {
  const items = resolvedRecords(node.items, resolveValue);
  const [selected, setSelected] = React.useState(0);
  const tabSetId = React.useId();
  const active = Math.min(selected, Math.max(0, items.length - 1));
  if (items.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const selectFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div role="tablist" className="mb-3 flex flex-wrap gap-1.5 border-b border-[var(--ocix-border)] pb-2">
        {items.map((item, index) => (
          <Button
            key={`${displayDeclarativeValue(item.label)}:${index}`}
            id={`${tabSetId}-tab-${index}`}
            role="tab"
            variant="chip"
            size="xs"
            aria-controls={`${tabSetId}-panel-${index}`}
            aria-selected={active === index}
            aria-pressed={active === index}
            tabIndex={active === index ? 0 : -1}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
            onClick={() => setSelected(index)}
          >
            {displayDeclarativeValue(resolveValue(item.label ?? item.title))}
          </Button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={`${tabSetId}-panel-${index}`}
          id={`${tabSetId}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${tabSetId}-tab-${index}`}
          hidden={active !== index}
        >
          {renderChildren(item.children)}
        </div>
      ))}
    </section>
  );
};

export const AccordionPrimitive: React.FC<ContainerPrimitiveProps> = ({ node, resolveValue, renderChildren, emptyLabel }) => {
  const items = resolvedRecords(node.items, resolveValue);
  const [openIndex, setOpenIndex] = React.useState<number | null>(node.defaultOpen === false ? null : 0);
  const accordionId = React.useId();
  if (items.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div className="divide-y divide-[var(--ocix-border)]">
        {items.map((item, index) => {
          const expanded = openIndex === index;
          return (
            <div key={`${displayDeclarativeValue(item.label ?? item.title)}:${index}`}>
              <Button id={`${accordionId}-trigger-${index}`} variant="ghost" size="sm" className="w-full justify-between rounded-none px-0" aria-controls={`${accordionId}-panel-${index}`} aria-expanded={expanded} onClick={() => setOpenIndex(expanded ? null : index)}>
                <span className="truncate">{displayDeclarativeValue(resolveValue(item.label ?? item.title))}</span>
                <Icon name="arrow-down-s" className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
              </Button>
              <div
                id={`${accordionId}-panel-${index}`}
                role="region"
                aria-labelledby={`${accordionId}-trigger-${index}`}
                className="pb-3"
                hidden={!expanded}
              >
                {renderChildren(item.children)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const CodeBlockPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue }) => {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const code = displayDeclarativeValue(resolveValue(node.value ?? node.data));
  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timeout);
  }, [copied]);
  const copyCode = async () => {
    const result = await copyTextToClipboard(code);
    if (!result.ok) return;
    setCopied(true);
  };
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--ocix-border)] bg-[var(--syntax-background)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ocix-border)] px-3 py-2 typography-micro text-[var(--ocix-muted-foreground)]">
        <span className="truncate">{displayDeclarativeValue(resolveValue(node.title))}</span>
          <div className="flex shrink-0 items-center gap-2">
            <span>{displayDeclarativeValue(resolveValue(node.language))}</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => void copyCode()} aria-label={copied ? t('interactiveUI.code.copied') : t('interactiveUI.code.copy')}>
              <Icon name={copied ? 'check' : 'file-copy'} className="size-3.5" />
              <span>{copied ? t('interactiveUI.code.copied') : t('interactiveUI.code.copy')}</span>
            </Button>
          </div>
      </div>
      <pre className="max-h-96 overflow-auto p-3 typography-code text-[var(--syntax-foreground)]"><code>{code}</code></pre>
    </section>
  );
};

export const SparklinePrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const resolved = resolveValue(node.values ?? node.data);
  const values = Array.isArray(resolved) ? resolved.map(Number).filter(Number.isFinite).slice(0, 60) : [];
  if (values.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const extent = max - min || 1;
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 160},${36 - ((value - min) / extent) * 32}`).join(' ');
  return (
    <section className={PANEL}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {node.label ? <div className={META}>{displayDeclarativeValue(resolveValue(node.label))}</div> : null}
          {node.value !== undefined ? <div className="typography-body font-semibold text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(node.value))}</div> : null}
        </div>
        <svg viewBox="0 0 160 40" className="h-10 w-36 shrink-0" aria-hidden="true">
          <polyline points={points} fill="none" stroke="var(--ocix-chart-1)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </section>
  );
};

const gaugeColor = (tone: unknown): string => {
  if (tone === 'success') return 'var(--ocix-success)';
  if (tone === 'warning') return 'var(--ocix-warning)';
  if (tone === 'error') return 'var(--ocix-error)';
  if (tone === 'info') return 'var(--ocix-info)';
  return 'var(--ocix-chart-1)';
};

export const GaugePrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue }) => {
  const minimum = Number(resolveValue(node.minimum));
  const maximum = Number(resolveValue(node.maximum));
  const rawValue = Number(resolveValue(node.value));
  const safeMinimum = Number.isFinite(minimum) ? minimum : 0;
  const safeMaximum = Number.isFinite(maximum) && maximum > safeMinimum ? maximum : safeMinimum + 100;
  const value = Number.isFinite(rawValue) ? Math.max(safeMinimum, Math.min(safeMaximum, rawValue)) : safeMinimum;
  const progress = (value - safeMinimum) / (safeMaximum - safeMinimum);
  const circumference = 2 * Math.PI * 52;
  const displayValue = `${displayDeclarativeValue(value)}${node.unit ? ` ${displayDeclarativeValue(resolveValue(node.unit))}` : ''}`;
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div className="grid items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <svg
          viewBox="0 0 132 132"
          className="mx-auto size-32"
          role="meter"
          aria-label={displayDeclarativeValue(resolveValue(node.label ?? node.title))}
          aria-valuemin={safeMinimum}
          aria-valuemax={safeMaximum}
          aria-valuenow={value}
        >
          <circle cx="66" cy="66" r="52" fill="none" stroke="var(--ocix-surface-muted)" strokeWidth="12" />
          <circle
            cx="66"
            cy="66"
            r="52"
            fill="none"
            stroke={gaugeColor(node.tone)}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 66 66)"
          />
          <text x="66" y="62" textAnchor="middle" className="fill-[var(--ocix-foreground)] text-[18px] font-semibold">{displayValue}</text>
          <text x="66" y="82" textAnchor="middle" className="fill-[var(--ocix-muted-foreground)] text-[10px]">{Math.round(progress * 100)}%</text>
        </svg>
        <div className="min-w-0">
          {node.label ? <div className="typography-body font-semibold text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(node.label))}</div> : null}
          {node.detail ? <div className={cn('mt-1 break-words', META)}>{displayDeclarativeValue(resolveValue(node.detail))}</div> : null}
          <div className={cn('mt-2', META)}>{displayDeclarativeValue(safeMinimum)} – {displayDeclarativeValue(safeMaximum)}</div>
        </div>
      </div>
    </section>
  );
};

export const HeatmapPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const cells: Array<Record<string, unknown> & { row: string; column: string; value: number }> = resolvedRecords(node.cells ?? node.data, resolveValue).flatMap((entry) => {
    const value = Number(entry.value);
    return typeof entry.row === 'string' && typeof entry.column === 'string' && Number.isFinite(value)
      ? [{ ...entry, row: entry.row, column: entry.column, value }]
      : [];
  });
  if (cells.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const rows = Array.from(new Set(cells.map((cell) => cell.row)));
  const columns = Array.from(new Set(cells.map((cell) => cell.column)));
  const byCoordinate = new Map(cells.map((cell) => [`${cell.row}\u0000${cell.column}`, cell]));
  const values = cells.map((cell) => cell.value);
  const minimum = Math.min(...values);
  const extent = Math.max(...values) - minimum || 1;
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)]">
      {node.title ? <h3 className={cn('border-b border-[var(--ocix-border)] px-3 py-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div className="overflow-x-auto p-3" tabIndex={0}>
        <table className="w-full min-w-[28rem] border-separate border-spacing-1">
          <thead><tr><th className="w-24" />{columns.map((column) => <th key={column} className="px-1 pb-1 text-center typography-micro font-medium text-[var(--ocix-muted-foreground)]">{column}</th>)}</tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row}>
              <th className="pr-2 text-right typography-micro font-medium text-[var(--ocix-muted-foreground)]">{row}</th>
              {columns.map((column) => {
                const cell = byCoordinate.get(`${row}\u0000${column}`);
                const intensity = cell ? 0.14 + ((cell.value - minimum) / extent) * 0.86 : 0;
                const label = cell ? displayDeclarativeValue(resolveValue(cell.label ?? cell.value)) : '';
                return (
                  <td key={column} className="relative h-9 min-w-12 overflow-hidden rounded-md text-center typography-micro text-[var(--ocix-foreground)]" title={cell ? `${row} · ${column}: ${label}` : undefined}>
                    {cell ? <span aria-hidden="true" className="absolute inset-0 bg-[var(--ocix-chart-seq-4)]" style={{ opacity: intensity }} /> : null}
                    <span className="relative">{label}</span>
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
};

export const KanbanPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const columns = resolvedRecords(node.columns, resolveValue).filter((column) => typeof column.id === 'string');
  const cards = resolvedRecords(node.cards ?? node.items, resolveValue);
  if (columns.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-3', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div className="min-w-0 overflow-x-auto pb-1" tabIndex={0}>
        <div className="grid min-w-max grid-flow-col auto-cols-[minmax(14rem,18rem)] gap-3">
          {columns.map((column) => {
            const columnCards = cards.filter((card) => card.column === column.id);
            return (
              <section key={String(column.id)} className="rounded-xl bg-[var(--ocix-surface-muted)] p-2.5">
                <header className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dotClass(column.tone))} />
                    <h4 className="truncate typography-meta font-semibold text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(column.title ?? column.label))}</h4>
                  </div>
                  <span className="typography-micro text-[var(--ocix-muted-foreground)]">{columnCards.length}</span>
                </header>
                <ol className="space-y-2">
                  {columnCards.map((card, index) => (
                    <li key={String(card.id ?? `${column.id}:${index}`)} className="rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-2.5">
                      <div className="flex items-start gap-2">
                        <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', dotClass(card.tone))} />
                        <div className="min-w-0 flex-1">
                          <div className="break-words typography-meta font-medium text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(card.title))}</div>
                          {card.description ? <div className={cn('mt-1 break-words', META)}>{displayDeclarativeValue(resolveValue(card.description))}</div> : null}
                        </div>
                        {card.badge ? <span className="max-w-24 shrink-0 truncate rounded-full border border-[var(--ocix-border)] px-2 py-0.5 typography-micro text-[var(--ocix-muted-foreground)]">{displayDeclarativeValue(resolveValue(card.badge))}</span> : null}
                      </div>
                    </li>
                  ))}
                  {columnCards.length === 0 ? <li className={cn('rounded-lg border border-dashed border-[var(--ocix-border)] px-3 py-5 text-center', META)}>{emptyLabel}</li> : null}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const AgendaPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const entries = resolvedRecords(node.entries ?? node.items ?? node.data, resolveValue).flatMap((entry, index) => {
    const itemTitle = displayDeclarativeValue(resolveValue(entry.title));
    if (!itemTitle) return [];
    return [{
      id: displayDeclarativeValue(resolveValue(entry.id ?? index)),
      title: itemTitle,
      date: displayDeclarativeValue(resolveValue(entry.date)),
      time: displayDeclarativeValue(resolveValue(entry.time)),
      endTime: displayDeclarativeValue(resolveValue(entry.endTime)),
      description: displayDeclarativeValue(resolveValue(entry.description)),
      location: displayDeclarativeValue(resolveValue(entry.location)),
      tone: entry.tone,
    }];
  }).slice(0, 40);
  if (entries.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const grouped = entries.reduce<Map<string, typeof entries>>((groups, entry) => {
    const key = entry.date || 'Upcoming';
    groups.set(key, [...(groups.get(key) ?? []), entry]);
    return groups;
  }, new Map());
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-3', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <div className="space-y-4">
        {Array.from(grouped.entries()).slice(0, 14).map(([date, dateEntries]) => (
          <section key={date} aria-label={date} className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <h4 className="pt-2 typography-meta font-semibold text-[var(--ocix-muted-foreground)]">{date}</h4>
            <ol className="space-y-2">
              {dateEntries.map((entry) => (
                <li key={entry.id} className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-3 rounded-lg bg-[var(--ocix-surface-muted)] p-2.5">
                  <time className="typography-micro font-medium text-[var(--ocix-muted-foreground)]">{entry.time}{entry.endTime ? `–${entry.endTime}` : ''}</time>
                  <div className="min-w-0 border-l border-[var(--ocix-border)] pl-3">
                    <div className="flex items-start gap-2">
                      <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', dotClass(entry.tone))} />
                      <div className="min-w-0">
                        <div className="break-words typography-meta font-medium text-[var(--ocix-foreground)]">{entry.title}</div>
                        {entry.description ? <div className={cn('mt-0.5 break-words', META)}>{entry.description}</div> : null}
                        {entry.location ? <div className={cn('mt-1 break-words', META)}>{entry.location}</div> : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
};

export const FunnelPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const stages = resolvedRecords(node.stages ?? node.items ?? node.data, resolveValue).flatMap((stage, index) => {
    const stageLabel = displayDeclarativeValue(resolveValue(stage.label ?? stage.title));
    const value = Number(resolveValue(stage.value));
    if (!stageLabel || !Number.isFinite(value)) return [];
    return [{ label: stageLabel, value, detail: displayDeclarativeValue(resolveValue(stage.detail)), index }];
  }).slice(0, 8);
  if (stages.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const maximum = Math.max(...stages.map((stage) => Math.max(0, stage.value)), 1);
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-3', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      <ol className="space-y-2" aria-label={displayDeclarativeValue(resolveValue(node.title ?? 'Funnel'))}>
        {stages.map((stage) => {
          const width = Math.max(10, (Math.max(0, stage.value) / maximum) * 100);
          return (
            <li key={`${stage.label}:${stage.index}`} className="grid gap-1.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
              <span className="break-words typography-meta font-medium text-[var(--ocix-foreground)]">{stage.label}</span>
              <div className="h-7 overflow-hidden rounded-md bg-[var(--ocix-surface-muted)]" aria-hidden="true">
                <div className="h-full rounded-md bg-[var(--ocix-chart-1)]" style={{ width: `${width}%`, opacity: Math.max(0.45, 1 - stage.index * 0.07) }} />
              </div>
              <span className="typography-meta tabular-nums text-[var(--ocix-foreground)]">{displayDeclarativeValue(stage.value)}{stage.detail ? ` · ${stage.detail}` : ''}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export const NetworkPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const nodes = resolvedRecords(node.nodes, resolveValue).flatMap((entry, index) => {
    const id = typeof entry.id === 'string' ? entry.id : `node-${index + 1}`;
    const nodeLabel = displayDeclarativeValue(resolveValue(entry.label ?? entry.title));
    return nodeLabel ? [{ id, label: nodeLabel, detail: displayDeclarativeValue(resolveValue(entry.detail ?? entry.description)), tone: entry.tone }] : [];
  }).slice(0, 30);
  const nodeIds = new Set(nodes.map((entry) => entry.id));
  const edges = resolvedRecords(node.edges, resolveValue).flatMap((entry) => {
    if (typeof entry.source !== 'string' || typeof entry.target !== 'string' || !nodeIds.has(entry.source) || !nodeIds.has(entry.target)) return [];
    return [{ source: entry.source, target: entry.target, label: displayDeclarativeValue(resolveValue(entry.label)) }];
  }).slice(0, 60);
  if (nodes.length === 0) return <div className={cn(PANEL, 'text-center', META)}>{emptyLabel}</div>;
  const positions = new Map(nodes.map((entry, index) => {
    const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return [entry.id, { x: 160 + Math.cos(angle) * 112, y: 120 + Math.sin(angle) * 84 }] as const;
  }));
  const accessibleTitle = displayDeclarativeValue(resolveValue(node.title ?? 'Network'));
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-3', TITLE)}>{accessibleTitle}</h3> : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1.35fr)_minmax(12rem,0.65fr)]">
        <div className="min-w-0 overflow-x-auto rounded-lg bg-[var(--ocix-surface-muted)] p-2" tabIndex={0}>
          <svg viewBox="0 0 320 240" className="mx-auto h-auto min-w-[18rem] max-w-xl" role="img" aria-label={`${accessibleTitle}: ${nodes.length} nodes, ${edges.length} connections`}>
            {edges.map((edge, index) => {
              const source = positions.get(edge.source)!;
              const target = positions.get(edge.target)!;
              return <line key={`${edge.source}:${edge.target}:${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="var(--ocix-border)" strokeWidth="2"><title>{edge.label || `${edge.source} to ${edge.target}`}</title></line>;
            })}
            {nodes.map((entry, index) => {
              const position = positions.get(entry.id)!;
              const color = `var(--ocix-chart-${(index % 8) + 1})`;
              return (
                <g key={entry.id} role="graphics-symbol" aria-label={`${entry.label}${entry.detail ? `: ${entry.detail}` : ''}`} tabIndex={0}>
                  <circle cx={position.x} cy={position.y} r="14" fill={color} stroke="var(--ocix-surface)" strokeWidth="3" />
                  <text x={position.x} y={position.y + 25} textAnchor="middle" className="fill-[var(--ocix-foreground)] text-[9px] font-medium">{entry.label.slice(0, 18)}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <ol className="space-y-1.5" aria-label={`${accessibleTitle} nodes`}>
          {nodes.map((entry, index) => (
            <li key={entry.id} className="flex min-w-0 gap-2 rounded-lg bg-[var(--ocix-surface-muted)] px-2.5 py-2">
              <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: `var(--ocix-chart-${(index % 8) + 1})` }} />
              <span className="min-w-0 break-words typography-meta text-[var(--ocix-foreground)]"><strong className="font-medium">{entry.label}</strong>{entry.detail ? ` · ${entry.detail}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

type GitCommit = {
  id: string;
  message: string;
  branch: string;
  parents: string[];
  author?: string;
  timestamp?: string;
};

export const GitGraphPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const commits = resolvedRecords(node.commits ?? node.data, resolveValue).map((entry, index): GitCommit => ({
    id: displayDeclarativeValue(entry.id || index),
    message: displayDeclarativeValue(entry.message ?? entry.title),
    branch: displayDeclarativeValue(entry.branch || 'main'),
    parents: Array.isArray(entry.parents) ? entry.parents.map(displayDeclarativeValue).slice(0, 4) : [],
    ...(entry.author !== undefined ? { author: displayDeclarativeValue(entry.author) } : {}),
    ...(entry.timestamp !== undefined ? { timestamp: displayDeclarativeValue(entry.timestamp) } : {}),
  }));
  const branches = Array.from(new Set(commits.map((commit) => commit.branch))).slice(0, 6);
  const laneByBranch = new Map(branches.map((branch, index) => [branch, index]));
  const laneByCommit = new Map(commits.map((commit) => [commit.id, laneByBranch.get(commit.branch) ?? 0]));
  const graphWidth = Math.max(34, branches.length * 22 + 12);
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      {commits.length === 0 ? <div className={cn('py-5 text-center', META)}>{emptyLabel}</div> : (
        <ol>
          {commits.map((commit, index) => {
            const lane = laneByCommit.get(commit.id) ?? 0;
            const x = 12 + lane * 22;
            return (
              <li key={`${commit.id}:${index}`} className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] gap-2">
                <svg width={graphWidth} height="48" viewBox={`0 0 ${graphWidth} 48`} aria-hidden="true">
                  {branches.map((branch, branchIndex) => <line key={branch} x1={12 + branchIndex * 22} x2={12 + branchIndex * 22} y1="0" y2="48" stroke="var(--ocix-border)" strokeWidth="2" />)}
                  {commit.parents.map((parent) => {
                    const parentLane = laneByCommit.get(parent);
                    if (parentLane === undefined || parentLane === lane) return null;
                    const parentX = 12 + parentLane * 22;
                    return <path key={parent} d={`M ${x} 16 C ${x} 32, ${parentX} 32, ${parentX} 48`} fill="none" stroke="var(--ocix-chart-2)" strokeWidth="2" />;
                  })}
                  <circle cx={x} cy="16" r="5" fill="var(--ocix-chart-1)" stroke="var(--ocix-surface)" strokeWidth="2" />
                </svg>
                <div className="min-w-0 pb-2 pt-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <code className="shrink-0 typography-micro text-[var(--ocix-muted-foreground)]">{commit.id.slice(0, 8)}</code>
                    <span className="min-w-[8rem] flex-1 break-words typography-meta font-medium text-[var(--ocix-foreground)]">{commit.message}</span>
                    <span className="max-w-40 shrink-0 truncate rounded-full bg-[var(--ocix-surface-muted)] px-2 py-0.5 typography-micro text-[var(--ocix-muted-foreground)]" title={commit.branch}>{commit.branch}</span>
                  </div>
                  {(commit.author || commit.timestamp) ? <div className={cn('mt-0.5', META)}>{[commit.author, commit.timestamp].filter(Boolean).join(' · ')}</div> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export const TreePrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const items = resolvedRecords(node.items ?? node.data, resolveValue);
  const byId = new Map(items.flatMap((item) => typeof item.id === 'string' ? [[item.id, item] as const] : []));
  const depthOf = (item: Record<string, unknown>): number => {
    let depth = 0;
    let parent = typeof item.parentId === 'string' ? byId.get(item.parentId) : undefined;
    const seen = new Set<Record<string, unknown>>([item]);
    while (parent && depth < 6 && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = typeof parent.parentId === 'string' ? byId.get(parent.parentId) : undefined;
    }
    return depth;
  };
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      {items.length === 0 ? <div className={cn('py-5 text-center', META)}>{emptyLabel}</div> : (
        <ul className="space-y-1">
          {items.map((item, index) => {
            const depth = depthOf(item);
            return (
              <li key={String(item.id ?? index)} className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5" style={{ paddingInlineStart: `${Math.min(3.5, depth * 0.75 + 0.5)}rem` }}>
                <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', dotClass(item.tone ?? item.status))} />
                <div className="min-w-0">
                  <div className="break-words typography-meta font-medium text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(item.label ?? item.title))}</div>
                  {item.description !== undefined ? <div className={cn('break-words', META)}>{displayDeclarativeValue(resolveValue(item.description))}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const DiffSummaryPrimitive: React.FC<PrimitiveProps> = ({ node, resolveValue, emptyLabel }) => {
  const items = resolvedRecords(node.items ?? node.data, resolveValue);
  return (
    <section className={PANEL}>
      {node.title ? <h3 className={cn('mb-2', TITLE)}>{displayDeclarativeValue(resolveValue(node.title))}</h3> : null}
      {items.length === 0 ? <div className={cn('py-5 text-center', META)}>{emptyLabel}</div> : (
        <ul className="divide-y divide-[var(--ocix-border)]">
          {items.map((item, index) => (
            <li key={`${displayDeclarativeValue(item.path)}:${index}`} className="flex min-w-0 items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 break-all typography-code text-[var(--ocix-foreground)]">{displayDeclarativeValue(resolveValue(item.path ?? item.title))}</span>
              {item.status !== undefined ? <span className="max-w-24 shrink-0 truncate typography-micro text-[var(--ocix-muted-foreground)]" title={displayDeclarativeValue(resolveValue(item.status))}>{displayDeclarativeValue(resolveValue(item.status))}</span> : null}
              <span className="shrink-0 typography-micro text-[var(--ocix-success)]">+{Math.max(0, Number(resolveValue(item.additions)) || 0)}</span>
              <span className="shrink-0 typography-micro text-[var(--ocix-error)]">−{Math.max(0, Number(resolveValue(item.deletions)) || 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
