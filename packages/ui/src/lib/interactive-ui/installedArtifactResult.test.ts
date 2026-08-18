import { describe, expect, test } from 'bun:test';
import {
  INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES,
  INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
  parseInstalledHTMLArtifactResultEnvelope,
} from './installedArtifactResult';

const validEnvelope = (overrides: Record<string, unknown> = {}) => ({
  $schema: INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
  schemaVersion: 1,
  artifact: 'com.demo.crm.pipeline',
  mode: 'live',
  summary: 'Open the live sales pipeline.',
  context: { stage: 'qualified' },
  updatedAt: '2026-07-21T00:00:00.000Z',
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

describe('parseInstalledHTMLArtifactResultEnvelope', () => {
  test('accepts the exact installed Artifact reference contract', () => {
    expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope()))).toEqual(validEnvelope());
  });

  test('rejects inline HTML, URLs, tokens and unknown fields', () => {
    for (const extra of [
      { html: '<script>alert(1)</script>' },
      { url: 'https://example.com' },
      { token: 'secret' },
      { action: 'com.demo.crm.list' },
    ]) {
      expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope(extra)))).toBeNull();
    }
  });

  test('rejects invalid IDs, modes, dates and oversized context', () => {
    expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ artifact: 'crm' })))).toBeNull();
    expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ mode: 'admin' })))).toBeNull();
    expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({ updatedAt: 'today' })))).toBeNull();
    expect(parseInstalledHTMLArtifactResultEnvelope(JSON.stringify(validEnvelope({
      context: 'x'.repeat(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES),
    })))).toBeNull();
  });

  test('bounded counter rejects a multibyte context that exceeds the byte cap', () => {
    // 22000 '界' chars: 22000 UTF-16 code units (< 64 KiB cap) but 66000 UTF-8
    // bytes (> 64 KiB). context is otherwise accepted as opaque data, so only a
    // byte-aware raw counter can reject this before parsing.
    const json = JSON.stringify(validEnvelope({ context: '界'.repeat(22000) }));
    expect(json.length).toBeLessThan(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(bytesOf(json)).toBeGreaterThan(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(parseInstalledHTMLArtifactResultEnvelope(json)).toBeNull();
  });

  test('bounded counter: raw exactly at the envelope cap is accepted, +1 is rejected', () => {
    const atLimit = paddedEnvelope(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(bytesOf(atLimit)).toBe(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES);
    expect(parseInstalledHTMLArtifactResultEnvelope(atLimit)).toEqual(validEnvelope());
    expect(parseInstalledHTMLArtifactResultEnvelope(atLimit + ' ')).toBeNull();
  });

  test('bounded counter counts multibyte UTF-8 bytes at the cap boundary', () => {
    const twoUnder = paddedEnvelope(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES - 2);
    expect(parseInstalledHTMLArtifactResultEnvelope(twoUnder)).toEqual(validEnvelope());
    // '界' is 3 UTF-8 bytes but a single UTF-16 code unit; if the counter
    // miscounted it as one byte this +1-byte payload would be accepted.
    const plusMultibyte = twoUnder + '界';
    expect(bytesOf(plusMultibyte)).toBe(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 1);
    expect(parseInstalledHTMLArtifactResultEnvelope(plusMultibyte)).toBeNull();
  });

  test('bounded counter short-circuits: reads exactly cap+1 code units and never trims', () => {
    // Synthetic string-like input (cast only in the test): length is above the
    // cap, charCodeAt returns ASCII 'a' (1 UTF-8 byte) and counts each read, and
    // trim() throws if reached. The counter must exit immediately at cap+1 bytes
    // and reject before any trim/parse, proving no full scan or allocation.
    let reads = 0;
    const input = {
      get length() { return INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 2; },
      charCodeAt() { reads += 1; return 0x61; },
      trim() { throw new Error('trim() must not be reached'); },
    };
    expect(parseInstalledHTMLArtifactResultEnvelope(input as unknown as string)).toBeNull();
    expect(reads).toBe(INSTALLED_HTML_ARTIFACT_MAX_ENVELOPE_BYTES + 1);
  });
});
