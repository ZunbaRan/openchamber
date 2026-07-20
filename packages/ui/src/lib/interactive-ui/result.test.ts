import { describe, expect, test } from 'bun:test';
import { parseInteractiveResultEnvelope } from './result';

describe('parseInteractiveResultEnvelope', () => {
  test('accepts a versioned live result envelope', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      context: { region: 'east' },
      dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'r1' },
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      context: { region: 'east' },
      dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'r1' },
    });
  });

  test('does not heuristically activate arbitrary JSON or prose', () => {
    expect(parseInteractiveResultEnvelope('{"view":"com.acme.sales.dashboard"}')).toBeNull();
    expect(parseInteractiveResultEnvelope('Result: {"$schema":"openchamber://interactive-result/v1"}')).toBeNull();
  });

  test('rejects unsupported versions and incomplete live references', () => {
    expect(parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 2,
      mode: 'snapshot',
    }))).toBeNull();
    expect(parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
    }))).toBeNull();
  });
});
