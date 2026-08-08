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

  test('accepts a query-driven live envelope with context only', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.operations.workspace',
      schemaVersion: 1,
      mode: 'live',
      summary: 'Operations workspace opened',
      context: { scope: 'default' },
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.operations.workspace',
      schemaVersion: 1,
      mode: 'live',
      summary: 'Operations workspace opened',
      context: { scope: 'default' },
    });
  });

  test('does not heuristically activate arbitrary JSON or prose', () => {
    expect(parseInteractiveResultEnvelope('{"view":"com.acme.sales.dashboard"}')).toBeNull();
    expect(parseInteractiveResultEnvelope('Result: {"$schema":"openchamber://interactive-result/v1"}')).toBeNull();
  });

  test('rejects an envelope whose UTF-8 byte length exceeds the 1 MiB bound', () => {
    const oversize = JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(600_000),
    });
    // 600k x U+00E9 = ~1.2M UTF-8 bytes, but ~600k UTF-16 code units;
    // the string-length check alone would wrongly accept it.
    expect(oversize.length).toBeLessThan(1024 * 1024);
    expect(parseInteractiveResultEnvelope(oversize)).toBeNull();
  });

  test('accepts a multibyte envelope below the 1 MiB byte bound', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(10_000),
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(10_000),
    });
  });

  test('accepts exactly 1 MiB and rejects the next byte', () => {
    const maxBytes = 1024 * 1024;
    const base = {
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '',
    };
    const envelopeBytesWithoutSummary = JSON.stringify(base).length;
    const exact = JSON.stringify({
      ...base,
      summary: 'x'.repeat(maxBytes - envelopeBytesWithoutSummary),
    });
    const over = JSON.stringify({
      ...base,
      summary: 'x'.repeat(maxBytes - envelopeBytesWithoutSummary + 1),
    });

    expect(exact.length).toBe(maxBytes);
    expect(parseInteractiveResultEnvelope(exact)).not.toBeNull();
    expect(over.length).toBe(maxBytes + 1);
    expect(parseInteractiveResultEnvelope(over)).toBeNull();
  });

  test('stops reading once the UTF-8 byte limit is exceeded', () => {
    const maxBytes = 1024 * 1024;
    let codeUnitReads = 0;
    const syntheticCandidate = {
      length: maxBytes * 2,
      charCodeAt: () => {
        codeUnitReads += 1;
        return 0x78;
      },
    };
    const syntheticOutput = {
      trim: () => syntheticCandidate,
    } as unknown as string;

    expect(parseInteractiveResultEnvelope(syntheticOutput)).toBeNull();
    expect(codeUnitReads).toBe(maxBytes + 1);
  });

  test('rejects unsupported versions and malformed live references', () => {
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
      dataRef: { connector: 'sales-api' },
    }))).toBeNull();
  });
});
