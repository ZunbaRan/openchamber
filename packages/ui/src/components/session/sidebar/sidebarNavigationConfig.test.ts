import { describe, expect, test } from 'bun:test';

import { SIDEBAR_PRIMARY_NAV_ITEMS } from './sidebarNavigationConfig';

describe('SIDEBAR_PRIMARY_NAV_ITEMS', () => {
  test('keeps the agreed Codex-style semantic navigation order', () => {
    expect(SIDEBAR_PRIMARY_NAV_ITEMS.map((item) => item.id)).toEqual([
      'projects',
      'git',
      'scheduled',
      'applications',
      'plugins',
    ]);
  });

  test('routes applications and plugins to separate existing settings pages', () => {
    const applications = SIDEBAR_PRIMARY_NAV_ITEMS.find((item) => item.id === 'applications');
    const plugins = SIDEBAR_PRIMARY_NAV_ITEMS.find((item) => item.id === 'plugins');

    expect(applications).toEqual({
      id: 'applications',
      icon: 'window',
      target: 'interactive-ui.extensions',
    });
    expect(plugins).toEqual({
      id: 'plugins',
      icon: 'plug-2',
      target: 'plugins',
    });
    expect(applications?.target).not.toBe(plugins?.target);
  });
});
