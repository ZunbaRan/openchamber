import type { IconName } from '@/components/icon/icons';

/**
 * Curated icon whitelist for declarative `metric.icon` (Style v2). A small
 * business-semantic subset keeps Agent icon selection reliable; the raw
 * sprite names are Host-owned, so remote URLs or arbitrary names are
 * impossible by construction.
 */
const OCIX_METRIC_ICONS = [
  'bar-chart-2',
  'donut-chart',
  'pie-chart',
  'pulse',
  'database-2',
  'server',
  'user',
  'user-3',
  'briefcase',
  'archive',
  'stack',
  'target',
  'rocket',
  'lightbulb',
  'calendar',
  'time',
  'timer',
  'list-check-2',
  'file-text',
  'folder',
  'global',
  'shield-check',
  'scales-3',
  'survey',
  'task',
  'clipboard',
  'star',
  'heart',
  'inbox-archive',
] as const satisfies readonly IconName[];

const ICON_SET: ReadonlySet<string> = new Set(OCIX_METRIC_ICONS);

export const sanitizeOcixMetricIcon = (value: unknown): IconName | undefined => (
  typeof value === 'string' && ICON_SET.has(value) ? value as IconName : undefined
);
