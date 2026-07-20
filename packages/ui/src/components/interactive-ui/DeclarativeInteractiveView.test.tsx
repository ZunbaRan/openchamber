import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { DeclarativeInteractiveView } from './DeclarativeInteractiveView';
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
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />,
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
      context: { runtime: 'web', locale: 'zh-CN' },
    };

    const html = renderToStaticMarkup(
      <DeclarativeInteractiveView definition={definition} envelope={envelope} host={host} />,
    );

    expect(html).toContain('模型运营看板');
    expect(html).toContain('成功率');
    expect(html).toContain('96.8%');
    expect(html).toContain('每日请求量');
    expect(html).toContain('周一');
    expect(html).toContain('<svg');
  });
});
