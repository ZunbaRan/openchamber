import { describe, expect, test } from 'bun:test';
import {
  HTML_ARTIFACT_MAX_ENVELOPE_BYTES,
  HTML_ARTIFACT_MAX_HTML_BYTES,
  HTML_ARTIFACT_RESULT_SCHEMA,
  parseHTMLArtifactResultEnvelope,
} from './artifactResult';

const validEnvelope = (overrides: Record<string, unknown> = {}) => ({
  $schema: HTML_ARTIFACT_RESULT_SCHEMA,
  schemaVersion: 1,
  title: 'Branch explorer',
  summary: 'A self-contained graph',
  html: '<!doctype html><html><body><svg></svg></body></html>',
  capabilities: { scripts: false },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 420 },
  updatedAt: '2026-07-20T00:00:00.000Z',
  ...overrides,
});

const bytesOf = (value: string): number => new TextEncoder().encode(value).byteLength;

// A valid envelope JSON padded with ASCII spaces so the raw output is exactly
// `targetBytes` long. Space is legal JSON whitespace that trim() strips, so the
// trimmed payload is the same small valid envelope.
const paddedEnvelope = (targetBytes: number): string => {
  const json = JSON.stringify(validEnvelope());
  return json + ' '.repeat(Math.max(0, targetBytes - bytesOf(json)));
};

describe('parseHTMLArtifactResultEnvelope', () => {
  test('accepts and rebuilds the exact v1 contract', () => {
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope()))).toEqual(validEnvelope());
  });

  test('does not heuristically activate ordinary HTML or another result schema', () => {
    expect(parseHTMLArtifactResultEnvelope('<html><body>Hello</body></html>')).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify({
      ...validEnvelope(),
      $schema: 'openchamber://interactive-result/v1',
    }))).toBeNull();
  });

  test('rejects unknown executable or future fields', () => {
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ script: 'alert(1)' })))).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({
      capabilities: { scripts: false, network: true },
    })))).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({
      display: { preferred: 'inline', allowExpand: true, inlineHeight: 420, popup: true },
    })))).toBeNull();
  });

  test('enforces display, text, date and byte limits', () => {
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ title: 'x'.repeat(121) })))).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ updatedAt: 'not-a-date' })))).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({
      display: { preferred: 'inline', allowExpand: true, inlineHeight: 901 },
    })))).toBeNull();
    expect(parseHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({
      html: '界'.repeat(Math.floor(HTML_ARTIFACT_MAX_HTML_BYTES / 3) + 1),
    })))).toBeNull();
  });

  test('bounded counter: raw exactly at the envelope cap is accepted, +1 is rejected', () => {
    const atLimit = paddedEnvelope(HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(bytesOf(atLimit)).toBe(HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(parseHTMLArtifactResultEnvelope(atLimit)).toEqual(validEnvelope());
    // One extra trailing space is legal JSON whitespace that trim() would strip,
    // restoring the identical small envelope, yet the raw byte cap rejects it.
    expect(parseHTMLArtifactResultEnvelope(atLimit + ' ')).toBeNull();
  });

  test('bounded counter counts multibyte UTF-8 bytes at the cap boundary', () => {
    const twoUnder = paddedEnvelope(HTML_ARTIFACT_MAX_ENVELOPE_BYTES - 2);
    expect(parseHTMLArtifactResultEnvelope(twoUnder)).toEqual(validEnvelope());
    // '界' is 3 UTF-8 bytes but a single UTF-16 code unit; if the counter
    // miscounted it as one byte this +1-byte payload would be accepted.
    const plusMultibyte = twoUnder + '界';
    expect(bytesOf(plusMultibyte)).toBe(HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 1);
    expect(parseHTMLArtifactResultEnvelope(plusMultibyte)).toBeNull();
  });

  test('bounded counter short-circuits: reads exactly cap+1 code units and never trims', () => {
    // Synthetic string-like input (cast only in the test): length is above the
    // cap, charCodeAt returns ASCII 'a' (1 UTF-8 byte) and counts each read, and
    // trim() throws if reached. The counter must exit immediately at cap+1 bytes
    // and reject before any trim/parse, proving no full scan or allocation.
    let reads = 0;
    const input = {
      get length() { return HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 2; },
      charCodeAt() { reads += 1; return 0x61; },
      trim() { throw new Error('trim() must not be reached'); },
    };
    expect(parseHTMLArtifactResultEnvelope(input as unknown as string)).toBeNull();
    expect(reads).toBe(HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 1);
  });
});
