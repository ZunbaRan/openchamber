import { describe, expect, test } from 'bun:test';
import {
  MCP_APP_RESULT_SCHEMA,
  MCP_APP_RUNTIME_PHASES,
  applyMcpAppModelContextUpdate,
  canRenderMcpAppToolState,
  createMcpAppResultEnvelope,
  createMcpAppRuntimeState,
  mcpAppRuntimeFailureText,
  mcpAppRuntimeIsTerminal,
  normalizeMcpAppConnectCspSource,
  normalizeMcpAppCspSource,
  parseMcpAppBinding,
  persistMcpAppEnvelopeToToolPart,
  reduceMcpAppRuntime,
  resolveMcpAppToolLifecycleStatus,
  validateMcpAppCspMetadata,
} from './mcpApp';
import type { McpAppRuntimePhase } from './mcpApp';

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
  test('mounts Apps while tools are running but not before binding or after errors', () => {
    expect(canRenderMcpAppToolState('pending')).toBe(false);
    expect(canRenderMcpAppToolState('running')).toBe(true);
    expect(canRenderMcpAppToolState('completed')).toBe(true);
    expect(canRenderMcpAppToolState('error')).toBe(false);
  });

  test('keeps only explicit cancellation errors mounted long enough to notify the App', () => {
    expect(resolveMcpAppToolLifecycleStatus({ status: 'running' })).toBe('running');
    expect(resolveMcpAppToolLifecycleStatus({ status: 'completed' })).toBe('completed');
    expect(resolveMcpAppToolLifecycleStatus({
      status: 'error',
      metadata: { interrupted: true },
      error: 'stopped',
    })).toBe('cancelled');
    expect(resolveMcpAppToolLifecycleStatus({
      status: 'error',
      error: 'Request was aborted by the user',
    })).toBe('cancelled');
    expect(resolveMcpAppToolLifecycleStatus({
      status: 'error',
      error: 'database unavailable',
    })).toBeNull();
  });

  test('allows secure origins and loopback development servers in CSP declarations', () => {
    expect(normalizeMcpAppCspSource('https://CRM.Example.com')).toBe('https://crm.example.com');
    expect(normalizeMcpAppCspSource('https://*.Example.com:8443')).toBe('https://*.example.com:8443');
    expect(normalizeMcpAppCspSource('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(normalizeMcpAppCspSource('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeMcpAppCspSource('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(normalizeMcpAppCspSource('data:')).toBe('data:');
    expect(normalizeMcpAppCspSource('blob:')).toBe('blob:');
    expect(normalizeMcpAppCspSource('about:')).toBe('about:');
    expect(normalizeMcpAppCspSource('http://crm.example.com')).toBeNull();
    expect(normalizeMcpAppCspSource('https://crm.example.com/path')).toBeNull();
    expect(normalizeMcpAppCspSource('javascript:alert(1)')).toBeNull();
    expect(normalizeMcpAppCspSource('https://*.example.com:99999')).toBeNull();
  });

  test('allows secure WebSockets and loopback development sockets only for connect-src', () => {
    expect(normalizeMcpAppConnectCspSource('wss://SYNC.Example.com')).toBe('wss://sync.example.com');
    expect(normalizeMcpAppConnectCspSource('wss://*.Example.com:8443')).toBe('wss://*.example.com:8443');
    expect(normalizeMcpAppConnectCspSource('ws://127.0.0.1:5173')).toBe('ws://127.0.0.1:5173');
    expect(normalizeMcpAppConnectCspSource('ws://localhost:3000')).toBe('ws://localhost:3000');
    expect(normalizeMcpAppConnectCspSource('ws://example.com')).toBeNull();
    expect(normalizeMcpAppConnectCspSource('wss://example.com/socket')).toBeNull();
    expect(normalizeMcpAppConnectCspSource('data:')).toBeNull();
    expect(normalizeMcpAppConnectCspSource('blob:')).toBeNull();
    expect(normalizeMcpAppConnectCspSource('about:')).toBeNull();
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
    expect(parseMcpAppBinding({
      ...metadata,
      mcpApp: {
        ...metadata.mcpApp,
        meta: { ...metadata.mcpApp.meta, resourceUri: 'ui://crm/other' },
      },
    })).toBeNull();
  });

  test('does not mount an MCP App for a failed tool result', () => {
    expect(parseMcpAppBinding({
      ...metadata,
      mcpIsError: true,
      mcpResult: { isError: true },
    })).toBeNull();
    expect(parseMcpAppBinding({
      ...metadata,
      mcpResult: { isError: true },
    })).toBeNull();
  });

  test('defaults missing visibility and normalizes legacy top-level display hints', () => {
    expect(parseMcpAppBinding({
      mcpApp: {
        server: 'legacy-app',
        tool: 'open_canvas',
        toolKey: 'legacy-app_open_canvas',
        resourceUri: 'ui://legacy-app/canvas',
        meta: {
          resourceUri: 'ui://legacy-app/canvas',
          maxHeight: 720,
          prefersBorder: false,
          domain: 'legacy-app.example.com',
        },
      },
    })).toEqual({
      server: 'legacy-app',
      tool: 'open_canvas',
      toolKey: 'legacy-app_open_canvas',
      resourceUri: 'ui://legacy-app/canvas',
      meta: {
        resourceUri: 'ui://legacy-app/canvas',
        visibility: ['model', 'app'],
        preferred: {
          maxHeight: 720,
          border: false,
          domain: 'legacy-app.example.com',
        },
        csp: undefined,
        permissions: undefined,
      },
    });
  });

  test('keeps an explicit empty visibility declaration fail-closed', () => {
    expect(parseMcpAppBinding({
      ...metadata,
      mcpApp: {
        ...metadata.mcpApp,
        meta: { ...metadata.mcpApp.meta, visibility: [] },
      },
    })?.meta.visibility).toEqual([]);
  });

  test('rejects malformed or unknown visibility values', () => {
    expect(parseMcpAppBinding({
      ...metadata,
      mcpApp: {
        ...metadata.mcpApp,
        meta: { ...metadata.mcpApp.meta, visibility: 'app' },
      },
    })).toBeNull();
    expect(parseMcpAppBinding({
      ...metadata,
      mcpApp: {
        ...metadata.mcpApp,
        meta: { ...metadata.mcpApp.meta, visibility: ['model', 'host'] },
      },
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

  test('creates an immutable full envelope from the latest structured model context', () => {
    const binding = parseMcpAppBinding(metadata);
    expect(binding).not.toBeNull();
    const original = createMcpAppResultEnvelope({
      binding: binding!,
      toolInput: { canvasId: 'interop-acceptance' },
      toolOutput: 'Opened revision 13',
      metadata: {
        ...metadata,
        structuredContent: {
          canvasId: 'interop-acceptance',
          revision: 13,
          notes: [],
        },
      },
    });

    const updated = applyMcpAppModelContextUpdate(original, {
      structuredContent: {
        canvasId: 'interop-acceptance',
        revision: 15,
        notes: [{ id: 'note-1', text: 'Persist me' }],
        snapshot: { document: { pages: 1 } },
      },
    });

    expect(updated).not.toBe(original);
    expect(updated.result).not.toBe(original.result);
    expect(updated.result.structuredContent).toEqual({
      canvasId: 'interop-acceptance',
      revision: 15,
      notes: [{ id: 'note-1', text: 'Persist me' }],
      snapshot: { document: { pages: 1 } },
    });
    expect(original.result.structuredContent).toEqual({
      canvasId: 'interop-acceptance',
      revision: 13,
      notes: [],
    });
    expect({
      $schema: updated.$schema,
      source: updated.source,
      title: updated.title,
      arguments: updated.arguments,
    }).toEqual({
      $schema: MCP_APP_RESULT_SCHEMA,
      source: 'mcp-app',
      title: 'crm_overview',
      arguments: { canvasId: 'interop-acceptance' },
    });
    expect(updated.binding).toBe(original.binding);
    expect({
      server: updated.binding.server,
      tool: updated.binding.tool,
      toolKey: updated.binding.toolKey,
      resourceUri: updated.binding.resourceUri,
    }).toEqual({
      server: 'crm',
      tool: 'crm_overview',
      toolKey: 'crm_crm_overview',
      resourceUri: 'ui://crm/overview',
    });
  });

  test('persists text and structured App context into the canonical completed ToolPart', () => {
    const binding = parseMcpAppBinding(metadata)!;
    const originalPart = {
      id: 'prt_ctx',
      sessionID: 'ses_ctx',
      messageID: 'msg_ctx',
      type: 'tool' as const,
      callID: 'call_ctx',
      tool: 'crm_crm_overview',
      state: {
        status: 'completed' as const,
        input: { range: 'week' },
        output: 'Old model context',
        title: '',
        metadata,
        time: { start: 1, end: 2 },
      },
    };
    const envelope = applyMcpAppModelContextUpdate(createMcpAppResultEnvelope({
      binding,
      toolInput: originalPart.state.input,
      toolOutput: originalPart.state.output,
      metadata: originalPart.state.metadata,
    }), {
      content: [{ type: 'text', text: 'Saved CRM revision 4' }],
      structuredContent: { revision: 4, customers: 5 },
    });
    const persisted = persistMcpAppEnvelopeToToolPart(originalPart, envelope);
    expect(persisted.state.status).toBe('completed');
    if (persisted.state.status !== 'completed') throw new Error('expected completed state');
    expect(persisted.state.output).toBe(
      'Saved CRM revision 4\n\nStructured content:\n{"revision":4,"customers":5}',
    );
    expect(persisted.state.metadata.structuredContent).toEqual({ revision: 4, customers: 5 });
    expect(persisted.state.metadata.mcpAppModelContextContent).toEqual([
      { type: 'text', text: 'Saved CRM revision 4' },
    ]);
    expect(createMcpAppResultEnvelope({
      binding,
      toolInput: persisted.state.input,
      toolOutput: persisted.state.output,
      metadata: persisted.state.metadata,
    }).result.content).toEqual([{ type: 'text', text: 'Saved CRM revision 4' }]);
    expect(originalPart.state.output).toBe('Old model context');
  });

  test('rejects unsupported media context instead of advertising false host capabilities', () => {
    const binding = parseMcpAppBinding(metadata)!;
    const envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: {},
      toolOutput: 'Original',
      metadata,
    });
    expect(() => applyMcpAppModelContextUpdate(envelope, {
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    })).toThrow('only supports text content');
  });

  test('rejects non-serializable or oversized structured model context', () => {
    const binding = parseMcpAppBinding(metadata)!;
    const originalPart = {
      id: 'prt_ctx_limit',
      sessionID: 'ses_ctx',
      messageID: 'msg_ctx',
      type: 'tool' as const,
      callID: 'call_ctx_limit',
      tool: 'crm_crm_overview',
      state: {
        status: 'completed' as const,
        input: {},
        output: 'Old',
        title: '',
        metadata,
        time: { start: 1, end: 2 },
      },
    };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const base = createMcpAppResultEnvelope({
      binding,
      toolInput: {},
      toolOutput: 'Old',
      metadata,
    });
    expect(() => persistMcpAppEnvelopeToToolPart(originalPart, {
      ...base,
      result: { ...base.result, structuredContent: cyclic },
    })).toThrow('must be JSON serializable');
    expect(() => persistMcpAppEnvelopeToToolPart(originalPart, {
      ...base,
      result: { ...base.result, structuredContent: { value: 'x'.repeat(140 * 1024) } },
    })).toThrow('exceeds the host limit');
  });
});

describe('MCP App runtime model (P0-A diagnostics)', () => {
  const epoch = (suffix = 'a') => `epoch-${suffix}`;

  test('tracks phases and milestones in order', () => {
    let state = createMcpAppRuntimeState(epoch());
    const sequence: McpAppRuntimePhase[] = [
      'fetching-resource',
      'mounting-sandbox',
      'loading-dependencies',
      'waiting-app-bridge',
      'delivering-tool-data',
      'ready',
    ];
    for (const phase of sequence) {
      state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase, at: 100 });
      expect(state.phase).toBe(phase);
      expect(state.milestones[phase]).toBe(100);
    }
    expect(state.failure).toBeNull();
    expect(mcpAppRuntimeIsTerminal(state)).toBe(true);
  });

  test('enters failed with the stable code, retryability, and sanitized detail', () => {
    let state = createMcpAppRuntimeState(epoch());
    state = reduceMcpAppRuntime(state, {
      type: 'failed',
      epoch: epoch(),
      code: 'dependency-unreachable',
      safeDetail: 'https://esm.sh',
      at: 200,
    });
    expect(state.phase).toBe('failed');
    expect({
      code: state.failure?.code,
      retryable: state.failure?.retryable,
      safeDetail: state.failure?.safeDetail,
      at: state.failure?.at,
    }).toEqual({
      code: 'dependency-unreachable',
      retryable: true,
      safeDetail: 'https://esm.sh',
      at: 200,
    });
    // failed is terminal: later phases are ignored
    const after = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'ready' });
    expect(after.phase).toBe('failed');
  });

  test('marks csp-metadata-missing as non-retryable and ready as terminal', () => {
    let state = createMcpAppRuntimeState(epoch());
    state = reduceMcpAppRuntime(state, { type: 'failed', epoch: epoch(), code: 'csp-metadata-missing' });
    expect(state.failure?.retryable).toBe(false);
    state = createMcpAppRuntimeState(epoch());
    state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'ready' });
    const afterFailure = reduceMcpAppRuntime(state, {
      type: 'failed',
      epoch: epoch(),
      code: 'tool-data-delivery-failed',
    });
    expect(afterFailure.phase).toBe('ready');
  });

  test('ignores stale events from a superseded binding epoch', () => {
    let state = createMcpAppRuntimeState(epoch('new'));
    const stale = reduceMcpAppRuntime(state, {
      type: 'failed',
      epoch: epoch('old'),
      code: 'script-failed',
    });
    expect(stale).toBe(state);
    expect(stale.phase).toBe('resolving-binding');
    // the old iframe's phase event must not advance the new instance
    const stalePhase = reduceMcpAppRuntime(state, {
      type: 'phase',
      epoch: epoch('old'),
      phase: 'ready',
    });
    expect(stalePhase.phase).toBe('resolving-binding');
  });

  test('switches epochs atomically and clears previous diagnostics', () => {
    let state = createMcpAppRuntimeState(epoch('one'));
    state = reduceMcpAppRuntime(state, { type: 'failed', epoch: epoch('one'), code: 'bridge-timeout' });
    state = reduceMcpAppRuntime(state, { type: 'epoch', epoch: epoch('two') });
    expect(state.phase).toBe('resolving-binding');
    expect(state.failure).toBeNull();
    expect(state.epoch).toBe(epoch('two'));
  });

  test('produces stable user-facing text without sensitive data', () => {
    expect(mcpAppRuntimeFailureText({
      code: 'tool-data-delivery-failed',
      retryable: true,
      at: 1,
    })).toEqual('MCP App initialized but Tool data delivery failed');
    expect(mcpAppRuntimeFailureText({
      code: 'dependency-blocked',
      retryable: false,
      at: 1,
      safeDetail: 'https://esm.sh',
    })).toContain("https://esm.sh");
  });
});

describe('MCP App protocol readiness', () => {
  const epoch = (suffix = 'a') => `epoch-${suffix}`;

  test('delivering-tool-data is the only phase between waiting-app-bridge and ready', () => {
    expect(MCP_APP_RUNTIME_PHASES).not.toContain('waiting-first-paint');
    const bridgeIndex = MCP_APP_RUNTIME_PHASES.indexOf('waiting-app-bridge');
    const deliveringIndex = MCP_APP_RUNTIME_PHASES.indexOf('delivering-tool-data');
    const readyIndex = MCP_APP_RUNTIME_PHASES.indexOf('ready');
    expect(bridgeIndex).toBeGreaterThanOrEqual(0);
    expect(deliveringIndex).toBeGreaterThan(bridgeIndex);
    expect(readyIndex).toBeGreaterThan(deliveringIndex);
  });

  test('a standards-only App reaches ready without any visual or semantic evidence', () => {
    let state = createMcpAppRuntimeState(epoch());
    state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'waiting-app-bridge' });
    state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'delivering-tool-data' });
    state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'ready' });
    expect(state.phase).toBe('ready');
    expect(state.failure).toBeNull();
    expect(state.milestones['delivering-tool-data']).toBeDefined();
    expect(state.milestones.ready).toBeDefined();
    expect(mcpAppRuntimeIsTerminal(state)).toBe(true);
  });

  test('a rejected delivery failure is terminal and blocks ready', () => {
    let state = createMcpAppRuntimeState(epoch());
    state = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'delivering-tool-data' });
    state = reduceMcpAppRuntime(state, { type: 'failed', epoch: epoch(), code: 'tool-data-delivery-failed' });
    expect(state.phase).toBe('failed');
    expect(state.failure?.retryable).toBe(true);
    const after = reduceMcpAppRuntime(state, { type: 'phase', epoch: epoch(), phase: 'ready' });
    expect(after.phase).toBe('failed');
  });
});

describe('MCP App CSP metadata validation (AUD-004)', () => {
  test('missing, empty, and malformed metadata all fail closed', () => {
    expect(validateMcpAppCspMetadata(undefined)).toEqual({ ok: false, detail: 'missing' });
    expect(validateMcpAppCspMetadata(null)).toEqual({ ok: false, detail: 'missing' });
    expect(validateMcpAppCspMetadata({})).toEqual({ ok: false, detail: 'empty' });
    expect(validateMcpAppCspMetadata('csp' as never)).toEqual({ ok: false, detail: 'malformed' });
    expect(validateMcpAppCspMetadata([] as never)).toEqual({ ok: false, detail: 'malformed' });
    expect(validateMcpAppCspMetadata({ resourceDomains: 'data:' } as never)).toEqual({
      ok: false,
      detail: 'malformed',
    });
  });

  test('invalid domain declarations are rejected, valid offline and remote policies pass', () => {
    expect(validateMcpAppCspMetadata({ resourceDomains: ['https://esm.sh'] })).toEqual({ ok: true });
    expect(
      validateMcpAppCspMetadata({ resourceDomains: ['data:'], connectDomains: [] }),
    ).toEqual({ ok: true });
    expect(validateMcpAppCspMetadata({ resourceDomains: ['javascript:alert(1)'] })).toEqual({
      ok: false,
      detail: 'invalid-domain',
    });
    expect(
      validateMcpAppCspMetadata({ resourceDomains: ['https://esm.sh'], connectDomains: ['wss://esm.sh'] }),
    ).toEqual({ ok: true });
    expect(
      validateMcpAppCspMetadata({ resourceDomains: ['https://esm.sh'], connectDomains: ['https://*'] }),
    ).toEqual({ ok: false, detail: 'invalid-domain' });
  });
});
