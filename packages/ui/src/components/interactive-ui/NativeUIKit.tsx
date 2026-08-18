import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio } from '@/components/ui/radio';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from '@/components/icon/Icon';
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

/* ------------------------------------------------------------------------
 * Style v2 — N1 form controls
 * -------------------------------------------------------------------- */

export interface NativeSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export const NativeSelect = ({
  className,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
}: {
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: NativeSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <Select value={value} onValueChange={(next) => onValueChange?.(next)} disabled={disabled}>
    <SelectTrigger
      aria-label={ariaLabel}
      className={cn('w-full border-[var(--ocix-border)] bg-[var(--ocix-surface)] text-[var(--ocix-foreground)]', className)}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const NativeCheckbox = ({
  className,
  label,
  description,
  ...checkboxProps
}: React.ComponentProps<typeof Checkbox> & { label?: React.ReactNode; description?: React.ReactNode }) => (
  <label className={cn('flex min-w-0 items-start gap-2.5 typography-meta text-[var(--ocix-foreground)]', checkboxProps.disabled && 'opacity-50', className)}>
    <Checkbox {...checkboxProps} />
    {label !== undefined || description !== undefined ? (
      <span className="min-w-0 flex-1">
        {label !== undefined ? <span className="block">{label}</span> : null}
        {description !== undefined ? <span className="mt-0.5 block typography-micro text-[var(--ocix-muted-foreground)]">{description}</span> : null}
      </span>
    ) : null}
  </label>
);

export const NativeRadioGroup = ({
  className,
  value,
  onValueChange,
  options,
  disabled,
  ariaLabel,
}: {
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: NativeSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <div role="radiogroup" aria-label={ariaLabel} className={cn('flex flex-col gap-2', className)}>
    {options.map((option) => (
      <label
        key={option.value}
        className={cn('flex items-center gap-2.5 typography-meta text-[var(--ocix-foreground)]', (disabled || option.disabled) && 'opacity-50')}
      >
        <Radio
          checked={value === option.value}
          onChange={() => onValueChange?.(option.value)}
          disabled={disabled || option.disabled}
        />
        <span className="min-w-0">{option.label}</span>
      </label>
    ))}
  </div>
);

export const NativeSwitch = ({
  className,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
}: {
  className?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <div className={cn('flex items-center justify-between gap-3', className)}>
    {label !== undefined || description !== undefined ? (
      <div className="min-w-0">
        {label !== undefined ? <div className="typography-meta text-[var(--ocix-foreground)]">{label}</div> : null}
        {description !== undefined ? <div className="mt-0.5 typography-micro text-[var(--ocix-muted-foreground)]">{description}</div> : null}
      </div>
    ) : null}
    <Switch
      checked={checked}
      onCheckedChange={(next) => onCheckedChange?.(Boolean(next))}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  </div>
);

/* ------------------------------------------------------------------------
 * Style v2 — N2 overlays (thin aliases over the audited Host primitives)
 * -------------------------------------------------------------------- */

export const NativeDialog = Dialog;
export const NativeDialogContent = DialogContent;
export const NativeDialogDescription = DialogDescription;
export const NativeDialogFooter = DialogFooter;
export const NativeDialogHeader = DialogHeader;
export const NativeDialogTitle = DialogTitle;
export const NativeDialogTrigger = DialogTrigger;

export const NativeTooltip = Tooltip;
export const NativeTooltipContent = TooltipContent;
export const NativeTooltipProvider = TooltipProvider;
export const NativeTooltipTrigger = TooltipTrigger;

/* ------------------------------------------------------------------------
 * Style v2 — N3 data display
 * -------------------------------------------------------------------- */

export const NativeStat = ({
  className,
  label,
  value,
  delta,
  trend,
  detail,
}: {
  className?: string;
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  trend?: 'up' | 'down' | 'flat';
  detail?: React.ReactNode;
}) => (
  <div className={cn('rounded-[var(--ocix-radius-md)] border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3', className)}>
    <div className="typography-meta text-[var(--ocix-muted-foreground)]">{label}</div>
    <div className="ocix-type-display mt-1 flex items-center gap-1.5 text-[var(--ocix-foreground)]">
      {trend ? (
        <Icon
          name={trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'subtract'}
          className={cn('size-4 shrink-0', trend === 'up' ? 'text-[var(--ocix-delta-up)]' : trend === 'down' ? 'text-[var(--ocix-delta-down)]' : 'text-[var(--ocix-delta-flat)]')}
          aria-hidden="true"
        />
      ) : null}
      <span className="min-w-0 break-words">{value}</span>
    </div>
    {delta !== undefined ? (
      <div className={cn(
        'mt-0.5 typography-micro',
        trend === 'up' ? 'text-[var(--ocix-delta-up)]' : trend === 'down' ? 'text-[var(--ocix-delta-down)]' : 'text-[var(--ocix-delta-flat)]',
      )}>
        {delta}
      </div>
    ) : null}
    {detail !== undefined ? <div className="mt-1 typography-meta text-[var(--ocix-muted-foreground)]">{detail}</div> : null}
  </div>
);

export const NativeDescriptionList = ({
  className,
  items,
  columns = 1,
}: {
  className?: string;
  items: Array<{ label: React.ReactNode; value: React.ReactNode }>;
  columns?: 1 | 2;
}) => (
  <dl className={cn('grid grid-cols-1 gap-2', columns === 2 && 'sm:grid-cols-2', className)}>
    {items.map((item, index) => (
      <div key={index} className="min-w-0">
        <dt className="typography-meta text-[var(--ocix-muted-foreground)]">{item.label}</dt>
        <dd className="break-words typography-body text-[var(--ocix-foreground)]">{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const NativeAvatar = ({
  className,
  name,
  src,
  size = 32,
}: {
  className?: string;
  name: string;
  src?: string;
  size?: number;
}) => {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--ocix-selection)] typography-meta font-medium text-[var(--ocix-selection-foreground)]', className)}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
};

export const NativePagination = ({
  className,
  page,
  pageCount,
  onPageChange,
}: {
  className?: string;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
}) => {
  const boundedCount = Math.max(1, Math.trunc(pageCount));
  const boundedPage = Math.max(1, Math.min(boundedCount, Math.trunc(page)));
  return (
    <nav aria-label="Pagination" className={cn('flex items-center gap-2 typography-meta', className)}>
      <Button variant="outline" size="xs" disabled={boundedPage <= 1} onClick={() => onPageChange?.(boundedPage - 1)} aria-label="Previous page">
        <Icon name="arrow-left-s" className="size-3.5" aria-hidden="true" />
      </Button>
      <span className="ocix-type-value text-[var(--ocix-muted-foreground)]">{boundedPage} / {boundedCount}</span>
      <Button variant="outline" size="xs" disabled={boundedPage >= boundedCount} onClick={() => onPageChange?.(boundedPage + 1)} aria-label="Next page">
        <Icon name="arrow-right-s" className="size-3.5" aria-hidden="true" />
      </Button>
    </nav>
  );
};

/* ------------------------------------------------------------------------
 * Style v2 — N4 layout primitives. Extensions cannot rely on unscanned
 * Tailwind classes, so responsive layout must come from the Kit.
 * -------------------------------------------------------------------- */

const GAP_CLASSES: Record<number, string> = {
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
};

const resolveGap = (gap: number | undefined): string => GAP_CLASSES[gap ?? 3] ?? 'gap-3';

export const NativeStack = ({
  className,
  direction = 'vertical',
  gap = 3,
  children,
}: {
  className?: string;
  direction?: 'vertical' | 'horizontal';
  gap?: 1 | 2 | 3 | 4 | 6;
  children?: React.ReactNode;
}) => (
  <div className={cn('flex min-w-0', direction === 'vertical' ? 'flex-col' : 'flex-row flex-wrap items-center', resolveGap(gap), className)}>
    {children}
  </div>
);

const GRID_COLUMN_CLASSES: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

export const NativeGrid = ({
  className,
  columns = 2,
  gap = 3,
  children,
}: {
  className?: string;
  columns?: 1 | 2 | 3 | 4;
  gap?: 1 | 2 | 3 | 4 | 6;
  children?: React.ReactNode;
}) => (
  <div className={cn('grid min-w-0', GRID_COLUMN_CLASSES[columns] ?? GRID_COLUMN_CLASSES[2], resolveGap(gap), className)}>
    {children}
  </div>
);

const SPLIT_RATIO_CLASSES = {
  '1:1': 'lg:grid-cols-2',
  '1:2': 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
  '2:1': 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
} as const;

export const NativeSplit = ({
  className,
  ratio = '1:1',
  gap = 3,
  children,
}: {
  className?: string;
  ratio?: keyof typeof SPLIT_RATIO_CLASSES;
  gap?: 1 | 2 | 3 | 4 | 6;
  children?: React.ReactNode;
}) => (
  <div className={cn('grid min-w-0 grid-cols-1', SPLIT_RATIO_CLASSES[ratio] ?? SPLIT_RATIO_CLASSES['1:1'], resolveGap(gap), className)}>
    {children}
  </div>
);
