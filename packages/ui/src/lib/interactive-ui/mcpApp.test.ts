import { describe, expect, test } from 'bun:test';
import {
  MCP_APP_RESULT_SCHEMA,
  createMcpAppResultEnvelope,
  normalizeMcpAppCspSource,
  parseMcpAppBinding,
} from './mcpApp';

const metadata = {
  mcpApp: {
    server: 'crm',
    tool: 'crm_overview',
    toolKey: 'crm_crm_overview',
    resourceUri: 'ui://crm/overview',
    meta: {
      resourceUri: 'ui://crm/overview',
      visibility: ['model', 'app'],
      preferred: { maxHeight: 640, border: true },
      csp: { connectDomains: ['https://crm.example.com'] },
    },
  },
  structuredContent: { customers: 3 },
  mcpResultMeta: { trace: 'redacted-id' },
};

describe('MCP App tool metadata', () => {
  test('allows secure origins and loopback development servers in CSP declarations', () => {
    expect(normalizeMcpAppCspSource('https://CRM.Example.com')).toBe('https://crm.example.com');
    expect(normalizeMcpAppCspSource('https://*.Example.com:8443')).toBe('https://*.example.com:8443');
    expect(normalizeMcpAppCspSource('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(normalizeMcpAppCspSource('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeMcpAppCspSource('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(normalizeMcpAppCspSource('http://crm.example.com')).toBeNull();
    expect(normalizeMcpAppCspSource('https://crm.example.com/path')).toBeNull();
    expect(normalizeMcpAppCspSource('javascript:alert(1)')).toBeNull();
    expect(normalizeMcpAppCspSource('https://*.example.com:99999')).toBeNull();
  });

  test('parses a bound MCP App without confusing it with OCIX envelopes', () => {
    expect(parseMcpAppBinding(metadata)).toEqual({
      server: 'crm',
      tool: 'crm_overview',
      toolKey: 'crm_crm_overview',
      resourceUri: 'ui://crm/overview',
      meta: {
        resourceUri: 'ui://crm/overview',
        visibility: ['model', 'app'],
        preferred: { maxHeight: 640, border: true, domain: undefined },
        csp: {
          connectDomains: ['https://crm.example.com'],
          resourceDomains: undefined,
          frameDomains: undefined,
          baseUriDomains: undefined,
        },
        permissions: undefined,
      },
    });
    expect(parseMcpAppBinding({
      ...metadata,
      mcpApp: { ...metadata.mcpApp, resourceUri: 'https://crm.example.com/app' },
    })).toBeNull();
  });

  test('preserves structured content and binding data in a dedicated envelope', () => {
    const binding = parseMcpAppBinding(metadata);
    expect(binding).not.toBeNull();
    const envelope = createMcpAppResultEnvelope({
      binding: binding!,
      toolInput: { range: 'week' },
      toolOutput: 'CRM overview loaded',
      metadata,
    });
    expect(envelope).toEqual({
      $schema: MCP_APP_RESULT_SCHEMA,
      schemaVersion: 1,
      source: 'mcp-app',
      title: 'crm_overview',
      summary: 'MCP App from crm',
      binding,
      arguments: { range: 'week' },
      result: {
        content: [{ type: 'text', text: 'CRM overview loaded' }],
        structuredContent: { customers: 3 },
        _meta: { trace: 'redacted-id' },
      },
    });
  });
});
