import { describe, expect, test } from 'bun:test';
import {
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
});
