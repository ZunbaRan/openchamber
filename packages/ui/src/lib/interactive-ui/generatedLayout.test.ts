import { describe, expect, test } from 'bun:test';
import { sanitizeGeneratedLayout } from './generatedLayout';

describe('sanitizeGeneratedLayout', () => {
  test('keeps snapshot UI nodes while removing executable properties', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      title: '业务概览',
      children: [
        {
          type: 'data-table',
          title: '机会列表',
          columns: [{ key: 'name', label: '客户' }, { key: 'status', label: '状态', render: 'status' }],
          data: [{ name: 'Northstar', status: 'active', ignored: { nested: true } }],
          rowActions: [{ label: '删除', action: 'crm.delete' }],
          queries: { secret: { action: 'secret.read' } },
        },
      ],
    });

    expect(layout).toEqual({
      type: 'stack',
      title: '业务概览',
      children: [{
        type: 'data-table',
        title: '机会列表',
        columns: [{ key: 'name', label: '客户' }, { key: 'status', label: '状态', render: 'status' }],
        data: [{ name: 'Northstar', status: 'active' }],
      }],
    });
    expect(JSON.stringify(layout)).not.toContain('crm.delete');
    expect(JSON.stringify(layout)).not.toContain('secret.read');
  });

  test('rejects bindings and unknown node types from generated data', () => {
    expect(sanitizeGeneratedLayout({ type: 'native-module', source: 'alert(1)' })).toBeNull();
    expect(sanitizeGeneratedLayout({ type: 'metric', label: 'Secret', value: { $path: 'host.token' } })).toBeNull();
  });

  test('keeps responsive metric columns and repairs the persisted single-child grid shape', () => {
    expect(sanitizeGeneratedLayout({
      type: 'metric-grid',
      columns: { default: 3 },
      items: [{ label: 'Loss', value: 0.342 }],
    })).toEqual({
      type: 'metric-grid',
      columns: 3,
      items: [{ label: 'Loss', value: 0.342 }],
    });

    expect(sanitizeGeneratedLayout({
      type: 'grid',
      columns: 4,
      children: [{
        type: 'metric-grid',
        columns: 3,
        items: [
          { label: 'Current loss', value: 0.342 },
          { label: 'Validation loss', value: 0.487 },
          { label: 'Learning rate', value: '2.1e-5' },
          { label: 'Perplexity', value: 4.21 },
        ],
      }],
    })).toEqual({
      type: 'metric-grid',
      columns: 4,
      items: [
        { label: 'Current loss', value: 0.342 },
        { label: 'Validation loss', value: 0.487 },
        { label: 'Learning rate', value: '2.1e-5' },
        { label: 'Perplexity', value: 4.21 },
      ],
    });
  });

  test('keeps reviewed visual semantics and strips invalid variants', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'section',
      variant: 'bordered',
      children: [
        { type: 'metric', label: 'Revenue', value: 128, tone: 'positive', trend: 'up', trendValue: '+12%' },
        {
          type: 'flow',
          data: [
            { title: 'Done', status: 'completed' },
            { title: 'Unsafe', status: 'running-script', className: 'hidden' },
          ],
        },
        { type: 'list', items: [{ title: 'Late', badge: 'Risk', badgeTone: 'error', style: 'color:red' }] },
        { type: 'divider', style: 'background:red' },
      ],
    });

    expect(layout).toEqual({
      type: 'section',
      variant: 'bordered',
      children: [
        { type: 'metric', label: 'Revenue', value: 128, tone: 'positive', trend: 'up', trendValue: '+12%' },
        { type: 'flow', data: [{ title: 'Done', status: 'completed' }, { title: 'Unsafe' }] },
        { type: 'list', ordered: false, items: [{ title: 'Late', badge: 'Risk', badgeTone: 'error' }] },
        { type: 'divider' },
      ],
    });
    expect(JSON.stringify(layout)).not.toContain('className');
    expect(JSON.stringify(layout)).not.toContain('style');
    expect(JSON.stringify(layout)).not.toContain('running-script');
  });

  test('bounds advanced primitives without opening executable channels', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      children: [
        {
          type: 'timeline',
          title: 'Release history',
          items: [{ title: 'v1', timestamp: 'Today', tone: 'success', onclick: 'steal()' }],
        },
        {
          type: 'tabs',
          items: [{ label: 'Summary', children: [{ type: 'text', value: 'Safe tab' }] }],
        },
        {
          type: 'git-graph',
          commits: [{ id: 'abc123', message: 'Initial', branch: 'main', parents: [], token: 'secret' }],
        },
        { type: 'sparkline', label: 'Latency', value: '42 ms', values: [40, 44, 42, 'bad'] },
        { type: 'gauge', label: 'Quality', value: 140, minimum: 0, maximum: 100, unit: '%', tone: 'success', onClick: 'steal()' },
        { type: 'heatmap', title: 'Load', cells: [{ row: 'Mon', column: '09:00', value: 7, html: '<script />' }] },
        {
          type: 'kanban',
          columns: [{ id: 'todo', title: 'Todo' }, { id: 'constructor', title: 'Blocked' }],
          cards: [{ id: 'card_1', column: 'todo', title: 'Safe', description: 'Visible', token: 'secret' }, { column: 'missing', title: 'Dropped' }],
        },
        { type: 'agenda', entries: [{ id: 'review', title: 'Review', date: 'Today', time: '09:00', location: 'HQ', onclick: 'steal()' }] },
        { type: 'funnel', stages: [{ label: 'Lead', value: 20, detail: 'all' }, { label: 'Bad', value: 'many' }] },
        {
          type: 'network',
          nodes: [{ id: 'agent', label: 'Agent', token: 'secret' }, { id: 'host', label: 'Host' }],
          edges: [{ source: 'agent', target: 'host', label: 'result' }, { source: 'agent', target: 'missing' }],
        },
        { type: 'diff-summary', items: [{ path: 'src/app.ts', additions: 3, deletions: 1, content: 'private' }] },
      ],
    });

    expect(layout).toEqual({
      type: 'stack',
      children: [
        { type: 'timeline', title: 'Release history', items: [{ title: 'v1', timestamp: 'Today', tone: 'success' }] },
        { type: 'tabs', items: [{ label: 'Summary', children: [{ type: 'text', value: 'Safe tab' }] }] },
        { type: 'git-graph', commits: [{ id: 'abc123', message: 'Initial', branch: 'main', parents: [] }] },
        { type: 'sparkline', label: 'Latency', value: '42 ms', values: [40, 44, 42] },
        { type: 'gauge', label: 'Quality', value: 100, minimum: 0, maximum: 100, unit: '%', tone: 'success' },
        { type: 'heatmap', title: 'Load', cells: [{ row: 'Mon', column: '09:00', value: 7 }] },
        { type: 'kanban', columns: [{ id: 'todo', title: 'Todo' }], cards: [{ id: 'card_1', column: 'todo', title: 'Safe', description: 'Visible' }] },
        { type: 'agenda', entries: [{ id: 'review', title: 'Review', date: 'Today', time: '09:00', location: 'HQ' }] },
        { type: 'funnel', stages: [{ label: 'Lead', value: 20, detail: 'all' }] },
        { type: 'network', nodes: [{ id: 'agent', label: 'Agent' }, { id: 'host', label: 'Host' }], edges: [{ source: 'agent', target: 'host', label: 'result' }] },
        { type: 'diff-summary', items: [{ path: 'src/app.ts', additions: 3, deletions: 1 }] },
      ],
    });
    expect(JSON.stringify(layout)).not.toContain('onclick');
    expect(JSON.stringify(layout)).not.toContain('token');
    expect(JSON.stringify(layout)).not.toContain('content');
  });

  test('drops prototype-sensitive keys from every model-authored data surface', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      children: [
        {
          type: 'data-table',
          columns: [
            { key: 'safe', label: 'Safe' },
            { key: 'constructor', label: 'Blocked constructor' },
            { key: 'prototype', label: 'Blocked prototype' },
          ],
          data: [JSON.parse('{"safe":"ok","constructor":"blocked","prototype":"blocked","__proto__":"blocked"}')],
        },
        {
          type: 'chart',
          xKey: 'constructor',
          series: [{ key: 'prototype' }, { key: 'safe' }],
          data: [{ safe: 1, constructor: 2, prototype: 3 }],
        },
        {
          type: 'comparison',
          columns: [{ key: 'constructor' }, { key: 'safe' }],
          data: [{ safe: 'visible', constructor: 'blocked' }],
        },
      ],
    });

    expect(layout).toEqual({
      type: 'stack',
      children: [
        { type: 'data-table', columns: [{ key: 'safe', label: 'Safe' }], data: [{ safe: 'ok' }] },
        { type: 'chart', variant: 'bar', xKey: 'label', series: [{ key: 'safe' }], data: [{ safe: 1 }] },
        { type: 'comparison', columns: [{ key: 'safe' }], data: [{ safe: 'visible' }] },
      ],
    });
    expect(JSON.stringify(layout)).not.toContain('constructor');
    expect(JSON.stringify(layout)).not.toContain('prototype');
    expect(JSON.stringify(layout)).not.toContain('__proto__');
  });

  test('keeps a valid layoutMode with its slot ids', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      title: 'Sales',
      layoutMode: 'dashboard-hero',
      children: [
        { type: 'section', id: 'kpis', children: [{ type: 'metric', label: 'Revenue', value: 10 }] },
        { type: 'section', id: 'main', children: [{ type: 'text', value: 'chart here' }] },
        { type: 'section', id: 'aside', children: [{ type: 'text', value: 'rail' }] },
      ],
    });

    expect(layout?.layoutMode).toBe('dashboard-hero');
    expect(layout?.children?.map((child) => child.id)).toEqual(['kpis', 'main', 'aside']);
  });

  test('strips an invalid layoutMode but preserves the content', () => {
    const missingRequired = sanitizeGeneratedLayout({
      type: 'stack',
      layoutMode: 'dashboard-hero',
      children: [
        { type: 'section', id: 'kpis', children: [{ type: 'metric', label: 'Revenue', value: 10 }] },
      ],
    });
    expect('layoutMode' in (missingRequired ?? {})).toBe(false);
    expect('id' in (missingRequired?.children?.[0] ?? {})).toBe(false);
    expect(missingRequired?.children?.[0]?.children?.length).toBe(1);

    const unknownSlot = sanitizeGeneratedLayout({
      type: 'stack',
      layoutMode: 'dashboard-hero',
      children: [
        { type: 'section', id: 'kpis', children: [{ type: 'metric', label: 'Revenue', value: 10 }] },
        { type: 'section', id: 'sidebar', children: [{ type: 'text', value: 'x' }] },
      ],
    });
    expect('layoutMode' in (unknownSlot ?? {})).toBe(false);

    const unknownMode = sanitizeGeneratedLayout({
      type: 'stack',
      layoutMode: 'kaban-style',
      children: [{ type: 'section', id: 'kpis', children: [{ type: 'metric', label: 'Revenue', value: 10 }] }],
    });
    expect('layoutMode' in (unknownMode ?? {})).toBe(false);
  });

  test('keeps metric emphasis and whitelisted icon while dropping unknown values', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'metric',
      label: 'Revenue',
      value: 1280000,
      emphasis: 'hero',
      icon: 'bar-chart-2',
    });
    expect(layout).toEqual({ type: 'metric', label: 'Revenue', value: 1280000, emphasis: 'hero', icon: 'bar-chart-2' });

    const dropped = sanitizeGeneratedLayout({
      type: 'metric',
      label: 'Revenue',
      value: 1,
      emphasis: 'banner',
      icon: 'https://evil.example/icon.svg',
    });
    expect(dropped).toEqual({ type: 'metric', label: 'Revenue', value: 1 });
  });

  test('keeps table density/toneColumn and chart referenceLine', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      children: [
        {
          type: 'data-table',
          density: 'compact',
          toneColumn: 'status',
          columns: [{ key: 'status', label: 'Status', render: 'status' }],
          data: [{ status: 'active' }],
        },
        {
          type: 'chart',
          series: [{ key: 'v' }],
          data: [{ label: 'a', v: 1 }],
          referenceLine: { value: 2, label: 'Target' },
        },
      ],
    });

    expect(layout?.children?.[0]?.density).toBe('compact');
    expect(layout?.children?.[0]?.toneColumn).toBe('status');
    expect(layout?.children?.[1]?.referenceLine).toEqual({ value: 2, label: 'Target' });

    const dropped = sanitizeGeneratedLayout({
      type: 'data-table',
      density: 'dense',
      toneColumn: '__proto__',
      columns: [{ key: 'a' }],
      data: [{ a: 1 }],
    });
    expect(dropped).toEqual({ type: 'data-table', columns: [{ key: 'a' }], data: [{ a: 1 }] });
  });

  test('keeps local-interactivity flags and clamps pagination', () => {
    const layout = sanitizeGeneratedLayout({
      type: 'stack',
      children: [
        {
          type: 'data-table',
          searchable: true,
          sortable: true,
          pagination: { pageSize: 500 },
          columns: [{ key: 'a' }],
          data: [{ a: 1 }],
        },
        { type: 'list', filterable: true, items: [{ title: 'x' }] },
        { type: 'flow', orientation: 'vertical', data: [{ title: 's' }] },
        { type: 'chart', stacked: true, series: [{ key: 'a' }], data: [{ label: 'l', a: 1 }] },
      ],
    });

    expect(layout?.children?.[0]?.searchable).toBe(true);
    expect(layout?.children?.[0]?.sortable).toBe(true);
    expect(layout?.children?.[0]?.pagination).toEqual({ pageSize: 50 });
    expect(layout?.children?.[1]?.filterable).toBe(true);
    expect(layout?.children?.[2]?.orientation).toBe('vertical');
    expect(layout?.children?.[3]?.stacked).toBe(true);

    const dropped = sanitizeGeneratedLayout({
      type: 'data-table',
      searchable: 'yes',
      sortable: 1,
      pagination: { pageSize: 'ten' },
      columns: [{ key: 'a' }],
      data: [{ a: 1 }],
    });
    expect(dropped).toEqual({ type: 'data-table', columns: [{ key: 'a' }], data: [{ a: 1 }] });

    const badOrientation = sanitizeGeneratedLayout({ type: 'flow', orientation: 'diagonal', data: [{ title: 's' }] });
    expect('orientation' in (badOrientation ?? {})).toBe(false);
  });
});
