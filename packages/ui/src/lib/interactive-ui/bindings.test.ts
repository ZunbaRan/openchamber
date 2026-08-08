import { describe, expect, test } from 'bun:test';
import { resolveDeclarativeValue } from './bindings';

describe('resolveDeclarativeValue', () => {
  test('resolves constrained data and row bindings recursively', () => {
    const result = resolveDeclarativeValue({
      revenue: { $path: 'query.dashboard.revenue' },
      orderId: { $row: 'id' },
    }, {
      query: { dashboard: { revenue: 1820000 } },
      row: { id: 'SO-1001' },
    }, 'en-US');
    expect(result).toEqual({ revenue: 1820000, orderId: 'SO-1001' });
  });

  test('does not traverse prototype paths', () => {
    expect(resolveDeclarativeValue({ $path: 'data.__proto__.polluted', fallback: 'safe' }, { data: {} })).toBe('safe');
    expect(resolveDeclarativeValue({ $path: 'data.constructor.prototype', fallback: 'safe' }, { data: {} })).toBe('safe');
  });

  test('only resolves own properties', () => {
    const inherited = Object.create({ secret: 'hidden' }) as Record<string, unknown>;
    inherited.visible = 'shown';

    expect(resolveDeclarativeValue({ $path: 'data.visible' }, { data: inherited })).toBe('shown');
    expect(resolveDeclarativeValue({ $path: 'data.secret', fallback: 'safe' }, { data: inherited })).toBe('safe');
  });
});
