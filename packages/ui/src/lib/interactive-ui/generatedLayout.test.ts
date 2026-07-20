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
});
