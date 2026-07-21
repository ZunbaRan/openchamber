import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const toneClass = (tone: Tone): string => {
  if (tone === 'success') return 'border-[var(--ocix-success-border)] bg-[var(--ocix-success-background)] text-[var(--ocix-success)]';
  if (tone === 'warning') return 'border-[var(--ocix-warning-border)] bg-[var(--ocix-warning-background)] text-[var(--ocix-warning)]';
  if (tone === 'error') return 'border-[var(--ocix-error-border)] bg-[var(--ocix-error-background)] text-[var(--ocix-error)]';
  if (tone === 'info') return 'border-[var(--ocix-info-border)] bg-[var(--ocix-info-background)] text-[var(--ocix-info)]';
  return 'border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] text-[var(--ocix-muted-foreground)]';
};

export const NativeCard = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <Card className={cn('gap-3 border-[var(--ocix-border)] bg-[var(--ocix-surface)] py-3 text-[var(--ocix-foreground)]', className)} {...props} />
);

export const NativeCardHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <CardHeader className={cn('gap-1 px-3', className)} {...props} />
);

export const NativeCardTitle = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <CardTitle className={cn('typography-ui-label', className)} {...props} />
);

export const NativeCardContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <CardContent className={cn('px-3', className)} {...props} />
);

export const NativeBadge = ({ className, tone = 'neutral', ...props }: React.ComponentProps<'span'> & { tone?: Tone }) => (
  <span className={cn('inline-flex rounded-full border px-2 py-0.5 typography-micro', toneClass(tone), className)} {...props} />
);

export const NativeNotice = ({
  className,
  tone = 'neutral',
  heading,
  children,
  action,
  ...props
}: React.ComponentProps<'div'> & {
  tone?: Tone;
  heading: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div
    className={cn('flex min-w-0 flex-wrap items-start gap-3 rounded-xl border p-3 typography-meta', toneClass(tone), className)}
    role={tone === 'error' ? 'alert' : 'status'}
    {...props}
  >
    <span className="mt-1 size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="font-medium">{heading}</div>
      {children ? <div className="mt-0.5 text-[var(--ocix-muted-foreground)]">{children}</div> : null}
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
);

export const NativeSeparator = ({ className, orientation = 'horizontal', ...props }: React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }) => (
  <div
    role="separator"
    aria-orientation={orientation}
    className={cn(orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', 'shrink-0 bg-[var(--ocix-border)]', className)}
    {...props}
  />
);

export const NativeProgress = ({ className, value = 0, ...props }: React.ComponentProps<'div'> & { value?: number }) => {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-[var(--ocix-surface-muted)]', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized * 100)} {...props}>
      <div className={cn('h-full rounded-full', normalized >= 1 ? 'bg-[var(--ocix-success)]' : 'bg-[var(--ocix-primary)]')} style={{ width: `${normalized * 100}%` }} />
    </div>
  );
};

export const NativeTable = ({ className, containerClassName, ...props }: React.ComponentProps<'table'> & { containerClassName?: string }) => (
  <div className={cn('min-w-0 overflow-auto rounded-xl border border-[var(--ocix-border)]', containerClassName)}>
    <table className={cn('w-full min-w-[28rem] border-collapse text-left', className)} {...props} />
  </div>
);
export const NativeTableHeader = ({ className, ...props }: React.ComponentProps<'thead'>) => <thead className={cn('sticky top-0 z-10 bg-[var(--ocix-surface-muted)]', className)} {...props} />;
export const NativeTableBody = (props: React.ComponentProps<'tbody'>) => <tbody {...props} />;
export const NativeTableRow = ({ className, ...props }: React.ComponentProps<'tr'>) => <tr className={cn('border-t border-[var(--ocix-border)]', className)} {...props} />;
export const NativeTableHead = ({ className, ...props }: React.ComponentProps<'th'>) => <th className={cn('whitespace-nowrap px-3 py-2 typography-meta font-medium text-[var(--ocix-muted-foreground)]', className)} {...props} />;
export const NativeTableCell = ({ className, ...props }: React.ComponentProps<'td'>) => <td className={cn('px-3 py-2 typography-meta text-[var(--ocix-foreground)]', className)} {...props} />;

type TabsContextValue = { value: string; setValue: (value: string) => void; baseId: string };
const TabsContext = React.createContext<TabsContextValue | null>(null);

export const NativeTabs = ({ value, defaultValue = '', onValueChange, children, ...props }: React.ComponentProps<'div'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const baseId = React.useId();
  const selected = value ?? internalValue;
  const setValue = React.useCallback((next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  }, [onValueChange, value]);
  const context = React.useMemo(() => ({ value: selected, setValue, baseId }), [baseId, selected, setValue]);
  return <TabsContext.Provider value={context}><div {...props}>{children}</div></TabsContext.Provider>;
};

export const NativeTabsList = ({ className, ...props }: React.ComponentProps<'div'>) => <div role="tablist" className={cn('flex flex-wrap gap-1.5 border-b border-[var(--ocix-border)] pb-2', className)} {...props} />;

export const NativeTabsTrigger = ({ value, children, onClick, ...props }: Omit<React.ComponentProps<typeof Button>, 'value'> & { value: string }) => {
  const context = React.useContext(TabsContext);
  const selected = context?.value === value;
  const encodedValue = encodeURIComponent(value);
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0 || tabs.length === 0) return;
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next]?.click();
    tabs[next]?.focus();
  };
  return (
    <Button
      id={context ? `${context.baseId}-tab-${encodedValue}` : undefined}
      role="tab"
      variant="chip"
      size="xs"
      aria-controls={context ? `${context.baseId}-panel-${encodedValue}` : undefined}
      aria-selected={selected}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={(event) => { context?.setValue(value); onClick?.(event); }}
      {...props}
    >
      {children}
    </Button>
  );
};

export const NativeTabsContent = ({ value, ...props }: React.ComponentProps<'div'> & { value: string }) => {
  const context = React.useContext(TabsContext);
  const encodedValue = encodeURIComponent(value);
  return context?.value === value ? (
    <div
      id={`${context.baseId}-panel-${encodedValue}`}
      role="tabpanel"
      aria-labelledby={`${context.baseId}-tab-${encodedValue}`}
      {...props}
    />
  ) : null;
};

export const NativeEmptyState = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('rounded-xl border border-dashed border-[var(--ocix-border)] px-4 py-8 text-center typography-meta text-[var(--ocix-muted-foreground)]', className)} {...props} />
);
