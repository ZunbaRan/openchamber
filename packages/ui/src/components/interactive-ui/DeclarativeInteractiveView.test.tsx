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
