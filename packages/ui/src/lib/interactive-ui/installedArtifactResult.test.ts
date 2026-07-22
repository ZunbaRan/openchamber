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
});
