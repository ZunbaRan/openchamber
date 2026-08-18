import type { IconName } from '@/components/icon/icons';

export const SIDEBAR_PRIMARY_NAV_ITEMS = [
  { id: 'projects', icon: 'folders', target: 'projects' },
  { id: 'git', icon: 'git-branch', target: 'git' },
  { id: 'scheduled', icon: 'calendar-schedule', target: 'scheduled' },
  { id: 'applications', icon: 'window', target: 'interactive-ui.extensions' },
  { id: 'plugins', icon: 'plug-2', target: 'plugins' },
] as const satisfies ReadonlyArray<{
  id: 'projects' | 'git' | 'scheduled' | 'applications' | 'plugins';
  icon: IconName;
  target: string;
}>;

