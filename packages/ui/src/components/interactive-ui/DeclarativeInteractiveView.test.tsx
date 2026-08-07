import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { DeclarativeInteractiveView } from './DeclarativeInteractiveView';
import { I18nProvider } from '@/lib/i18n';
import type { DeclarativeViewDefinition, InteractiveResultEnvelope, InteractiveViewHost } from '@/lib/interactive-ui/types';

describe('DeclarativeInteractiveView', () => {
  test('renders a bound process flow with ordered steps', () => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.process',
      layout: {
        type: 'flow',
        data: { $path: 'data.steps' },
      },
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {
        steps: [
          { title: '奖励建模', description: '定义可优化的偏好信号' },
          { title: '策略优化', description: '更新语言模型策略' },
        ],
      },
    };
    const host: InteractiveViewHost = {
      apiVersion: 1,
      business: {
        query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
        execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
      },
      dialog: { confirm: async () => false },
      notifications: { show() {} },
      dashboard: { emit: async () => {} },
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />
      </I18nProvider>,
    );

    expect(html).toContain('奖励建模');
    expect(html).toContain('定义可优化的偏好信号');
    expect(html).toContain('策略优化');
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });

  test('renders a model-composed dashboard through the generated-layout boundary', () => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.generated',
      layout: {
        type: 'generated-layout',
        data: { $path: 'data.layout' },
      },
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {
        layout: {
          type: 'stack',
          title: '模型运营看板',
          children: [
            { type: 'metric', label: '成功率', value: '96.8%', detail: '较上周 +1.4%' },
            {
              type: 'metric-grid',
              columns: 4,
              items: [
                { label: '当前 Loss', value: '0.342' },
                { label: '验证 Loss', value: '0.487' },
                { label: '学习率', value: '2.1e-5' },
                { label: 'Perplexity', value: '4.21' },
              ],
            },
            {
              type: 'chart',
              title: '每日请求量',
              variant: 'line',
              xKey: 'day',
              series: [{ key: 'requests', label: '请求' }],
              data: [{ day: '周一', requests: 120 }, { day: '周二', requests: 168 }],
            },
          ],
        },
      },
    };
    const host: InteractiveViewHost = {
      apiVersion: 1,
      business: {
        query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
        execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
      },
      dialog: { confirm: async () => false },
      notifications: { show() {} },
      dashboard: { emit: async () => {} },
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />
      </I18nProvider>,
    );

    expect(html).toContain('模型运营看板');
    expect(html).toContain('成功率');
    expect(html).toContain('96.8%');
    expect(html).toContain('当前 Loss');
    expect(html).toContain('@container/metric-grid');
    expect(html).toContain('@2xl/metric-grid:grid-cols-4');
    expect(html).toContain('data-ocix-metric-grid');
    expect(html).toContain('每日请求量');
    expect(html).toContain('周一');
    expect(html).toContain('<svg');
    expect(html).toContain('role="graphics-symbol"');
    expect(html).toContain('aria-label="周一 · 请求: 120"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-orientation="horizontal"');
  });

  test('keeps empty charts visible and table headers sticky', () => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.empty-states',
      layout: {
        type: 'stack',
        children: [
          { type: 'chart', title: '暂无趋势', xKey: 'day', series: [{ key: 'value', label: '数值' }], data: [] },
          { type: 'data-table', title: '明细', columns: [{ key: 'name', label: '名称' }], data: [] },
        ],
      },
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {},
    };
    const host: InteractiveViewHost = {
      apiVersion: 1,
      business: {
        query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
        execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
      },
      dialog: { confirm: async () => false },
      notifications: { show() {} },
      dashboard: { emit: async () => {} },
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />
      </I18nProvider>,
    );

    expect(html).toContain('暂无趋势');
    expect(html.match(/No data\./g)).toHaveLength(2);
    expect(html).toContain('sticky top-0');
    expect(html.match(/data-orientation="horizontal"/g)).toHaveLength(1);
  });

  test('renders advanced generated primitives with a standard git graph', () => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.advanced',
      layout: { type: 'generated-layout', data: { $path: 'data.layout' } },
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {
        layout: {
          type: 'stack',
          children: [
            { type: 'timeline', title: '里程碑', items: [{ title: '设计完成', timestamp: '今天', tone: 'success' }] },
            {
              type: 'git-graph',
              title: '提交图',
              commits: [
                { id: 'a1b2c3d', message: 'Merge feature', branch: 'main', parents: ['d4e5f6'] },
                { id: 'd4e5f6', message: 'Add view', branch: 'feature/ui', parents: [] },
              ],
            },
            { type: 'diff-summary', title: '变更', items: [{ path: 'src/view.tsx', additions: 8, deletions: 2 }] },
            { type: 'gauge', title: '发布质量', label: '通过率', value: 92, minimum: 0, maximum: 100, unit: '%', tone: 'success' },
            { type: 'heatmap', title: '请求热力', cells: [{ row: '周一', column: '09:00', value: 18, label: '18' }] },
            {
              type: 'kanban',
              title: '交付看板',
              columns: [{ id: 'todo', title: '待办' }, { id: 'done', title: '完成', tone: 'success' }],
              cards: [{ id: 'task_1', column: 'todo', title: '完善 Gallery', badge: 'P1' }, { id: 'task_2', column: 'done', title: '接入会话流', tone: 'success' }],
            },
            { type: 'agenda', title: '日程', entries: [{ id: 'review', date: '今天', time: '09:30', title: '设计评审', location: '会议室' }] },
            { type: 'funnel', title: '转化漏斗', stages: [{ label: '线索', value: 80 }, { label: '成交', value: 24, detail: '30%' }] },
            { type: 'network', title: '调用关系', nodes: [{ id: 'agent', label: 'Agent' }, { id: 'host', label: 'Host' }], edges: [{ source: 'agent', target: 'host', label: 'Result' }] },
            { type: 'tabs', items: [{ label: '摘要', children: [{ type: 'text', value: '已完成' }] }, { label: '风险', children: [{ type: 'text', value: '无阻断' }] }] },
            { type: 'accordion', items: [
              { label: '详细信息', children: [{ type: 'text', value: '可访问区域' }] },
              { label: '发布说明', children: [{ type: 'text', value: '折叠内容仍保留 ARIA 目标' }] },
            ] },
            { type: 'code-block', title: '配置', language: 'json', value: '{"enabled":true}' },
          ],
        },
      },
    };
    const host: InteractiveViewHost = {
      apiVersion: 1,
      business: {
        query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
        execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
      },
      dialog: { confirm: async () => false },
      notifications: { show() {} },
      dashboard: { emit: async () => {} },
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />
      </I18nProvider>,
    );

    expect(html).toContain('里程碑');
    expect(html).toContain('设计完成');
    expect(html).toContain('Merge feature');
    expect(html).toContain('feature/ui');
    expect(html).toContain('src/view.tsx');
    expect(html).toContain('+8');
    expect(html).toContain('−2');
    expect(html).toContain('role="meter"');
    expect(html).toContain('请求热力');
    expect(html).toContain('09:00');
    expect(html).toContain('交付看板');
    expect(html).toContain('完善 Gallery');
    expect(html).toContain('设计评审');
    expect(html).toContain('转化漏斗');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="调用关系: 2 nodes, 1 connections"');
    expect(html).toContain('role="graphics-symbol"');
    expect(html).toContain('aria-controls=');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html.match(/role="region"/g)).toHaveLength(2);
    expect(html).toContain('无阻断');
    expect(html).toContain('折叠内容仍保留 ARIA 目标');
    expect(html).toContain('hidden=""');
    expect(html).toContain('Copy code');
    expect(html).toContain('file-copy');
  });

  test('keeps dense primitives locally scrollable and wraps long content', () => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.dense',
      layout: {
        type: 'stack',
        children: [
          {
            type: 'comparison',
            columns: [{ key: 'name', label: 'Name' }, { key: 'detail', label: 'Detail' }],
            data: [{ name: 'A very long account name that must wrap', detail: 'A dense comparison value that must remain readable at conversation width' }],
          },
          {
            type: 'git-graph',
            commits: [{ id: '1234567890', message: 'A long commit message that must wrap instead of forcing page overflow', branch: 'feature/very-long-branch-name', parents: [] }],
          },
          {
            type: 'tree',
            items: [
              { id: 'root', label: 'Root' },
              { id: 'nested', parentId: 'root', label: 'A deeply nested and very long tree label' },
            ],
          },
          { type: 'diff-summary', items: [{ path: 'packages/a/very/long/path/to/a/component.tsx', additions: 12, deletions: 3 }] },
        ],
      },
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {},
    };
    const host: InteractiveViewHost = {
      apiVersion: 1,
      business: {
        query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
        execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
      },
      dialog: { confirm: async () => false },
      notifications: { show() {} },
      dashboard: { emit: async () => {} },
      context: { runtime: 'web', locale: 'en' },
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />
      </I18nProvider>,
    );

    expect(html).toContain('overflow-auto');
    expect(html).toContain('break-words');
    expect(html).toContain('break-all');
    expect(html).toContain('feature/very-long-branch-name');
  });
});

describe('DeclarativeInteractiveView — Style v2', () => {
  const createHost = (): InteractiveViewHost => ({
    apiVersion: 1,
    business: {
      query: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected query'); },
      execute: async <TOutput,>(): Promise<TOutput> => { throw new Error('Unexpected action'); },
    },
    dialog: { confirm: async () => false },
    notifications: { show() {} },
    dashboard: { emit: async () => {} },
    context: { runtime: 'web', locale: 'en' },
  });

  const renderView = (layout: Record<string, unknown>): string => {
    const definition: DeclarativeViewDefinition = {
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.openchamber.test.style-v2',
      layout: layout as DeclarativeViewDefinition['layout'],
    };
    const envelope: InteractiveResultEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      view: definition.id,
      schemaVersion: 1,
      mode: 'snapshot',
      data: {},
    };
    return renderToStaticMarkup(
      <I18nProvider>
        <DeclarativeInteractiveView definition={definition} envelope={envelope} host={createHost()} />
      </I18nProvider>,
    );
  };

  test('heroes the first KPI in a small metric-grid and keeps 5+ grids standard', () => {
    const small = renderView({
      type: 'metric-grid',
      columns: 3,
      items: [
        { label: 'Revenue', value: 100, icon: 'bar-chart-2' },
        { label: 'Orders', value: 48 },
        { label: 'Refunds', value: 3 },
      ],
    });
    expect(small.match(/bg-\[var\(--ocix-panel-hero-bg\)\]/g)).toHaveLength(1);
    expect(small).toContain('ocix-type-display');

    const large = renderView({
      type: 'metric-grid',
      columns: 4,
      items: [
        { label: 'A', value: 1 }, { label: 'B', value: 2 }, { label: 'C', value: 3 }, { label: 'D', value: 4 }, { label: 'E', value: 5 },
      ],
    });
    expect(large).not.toContain('bg-[var(--ocix-panel-hero-bg)]');
  });

  test('renders dashboard-hero sections into slot regions', () => {
    const html = renderView({
      type: 'stack',
      layoutMode: 'dashboard-hero',
      children: [
        { type: 'section', id: 'kpis', children: [{ type: 'metric', label: 'Revenue', value: 10 }] },
        { type: 'section', id: 'main', children: [{ type: 'text', value: 'main visual' }] },
        { type: 'section', id: 'aside', children: [{ type: 'text', value: 'rail item' }] },
      ],
    });
    expect(html).toContain('data-ocix-layout-mode="dashboard-hero"');
    expect(html.match(/data-ocix-slot="kpis"/g)).toHaveLength(1);
    expect(html.match(/data-ocix-slot="main"/g)).toHaveLength(1);
    expect(html.match(/data-ocix-slot="aside"/g)).toHaveLength(1);
    expect(html).toContain('main visual');
    expect(html).toContain('rail item');
  });

  test('tints table rows through toneColumn and honors compact density', () => {
    const html = renderView({
      type: 'data-table',
      density: 'compact',
      toneColumn: 'status',
      columns: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status', render: 'status' }],
      data: [
        { name: 'Acme', status: 'active' },
        { name: 'Globex', status: 'blocked' },
      ],
    });
    expect(html).toContain('--ocix-success-background');
    expect(html).toContain('--ocix-error-background');
    expect(html).toContain('py-1.5');
  });

  test('drops panel chrome for metrics nested inside a bordered section', () => {
    const html = renderView({
      type: 'section',
      variant: 'bordered',
      children: [
        { type: 'metric', label: 'Nested KPI', value: 7 },
      ],
    });
    // The section owns the only panel; the nested metric renders quiet.
    expect(html.match(/rounded-\[var\(--ocix-radius-md\)\] border /g)).toHaveLength(1);
    expect(html).toContain('Nested KPI');
  });

  test('renders chart reference lines and legend toggle buttons', () => {
    const html = renderView({
      type: 'chart',
      title: 'Trend',
      variant: 'line',
      xKey: 'label',
      series: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }],
      data: [{ label: 'x', a: 1, b: 2 }],
      referenceLine: { value: 1.5, label: 'Target' },
    });
    expect(html).toContain('Target');
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('renders table search, sortable headers, and paginates initial rows', () => {
    const html = renderView({
      type: 'data-table',
      searchable: true,
      sortable: true,
      pagination: { pageSize: 2 },
      columns: [{ key: 'name', label: 'Name' }, { key: 'mrr', label: 'MRR', format: 'number', align: 'right' }],
      data: [
        { name: 'Acme', mrr: 42000 },
        { name: 'Globex', mrr: 28500 },
        { name: 'Initech', mrr: 9800 },
      ],
    });
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('sort-desc');
    expect(html.match(/<tr[^>]*class="[^"]*border-t[^"]*"/g)?.length).toBe(2);
    expect(html).toContain('1 / 2');
    expect(html).toContain('aria-label="Next page"');
  });

  test('renders a filterable list and a vertical flow', () => {
    const listHtml = renderView({
      type: 'list',
      filterable: true,
      items: [{ title: 'Alpha task' }, { title: 'Beta task' }],
    });
    expect(listHtml).toContain('type="search"');
    expect(listHtml).toContain('Alpha task');

    const flowHtml = renderView({
      type: 'flow',
      orientation: 'vertical',
      data: [
        { title: 'Collect', status: 'completed' },
        { title: 'Review', status: 'active' },
        { title: 'Ship', status: 'pending' },
      ],
    });
    expect(flowHtml).toContain('<ol');
    expect(flowHtml).toContain('Collect');
    expect(flowHtml).toContain('border-dashed');
    expect(flowHtml).toContain('border-solid');
  });

  test('renders stacked bars with one column per row', () => {
    const html = renderView({
      type: 'chart',
      variant: 'bar',
      stacked: true,
      series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      data: [
        { label: 'Q1', a: 10, b: 5 },
        { label: 'Q2', a: 8, b: 7 },
      ],
    });
    // 2 rows × 2 series = 4 stacked rects
    expect(html.match(/<rect/g)?.length).toBe(4);
    expect(html).toContain('role="graphics-symbol"');
  });
});
