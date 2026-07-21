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
});
