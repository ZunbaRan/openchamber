import { beforeEach, describe, expect, mock, test } from 'bun:test';

type ConfigResponse = { data: Record<string, unknown> };

(mock as unknown as { restore?: () => void }).restore?.();

const configResolvers: Array<(response: ConfigResponse) => void> = [];
let configCalls = 0;
const promptAsyncCalls: unknown[][] = [];
const promptAsyncResults: Array<unknown> = [];
const capabilitiesCalls: unknown[][] = [];
const mcpResourceCalls: unknown[][] = [];
const mcpToolCallCalls: unknown[][] = [];
let routingPayload: unknown = [];
const capabilitiesMock = mock(async (...args: unknown[]) => {
  capabilitiesCalls.push(args);
  return {
  data: {
    distribution: 'ZunbaRan/opencode',
    version: '1.18.9-oc.1',
    upstreamVersion: '1.18.9',
    upstreamCommit: 'upstream-sha',
    forkCommit: 'fork-sha',
    apiVersion: 2,
    managedUpdate: true,
    features: {
      mcpLegacy: true,
      mcp20260728: true,
      mcpApps: true,
      mcpAppToolCall: true,
    },
  },
  };
});
const mcpResourceMock = mock(async (parameters: Record<string, unknown>, ...args: unknown[]) => {
  mcpResourceCalls.push([parameters, ...args]);
  return {
  data: {
    server: parameters.server,
    resourceUri: parameters.resourceUri,
    mimeType: 'text/html;profile=mcp-app',
    html: '<!doctype html><title>MCP App</title>',
    sha256: 'sha256-test',
  },
  };
});
const mcpToolCallMock = mock(async (parameters: Record<string, unknown>, ...args: unknown[]) => {
  mcpToolCallCalls.push([parameters, ...args]);
  return {
  data: {
    content: [{ type: 'text', text: String(parameters.name) }],
  },
  };
});

const promptAsyncMock = mock(async (...args: unknown[]) => {
  promptAsyncCalls.push(args);
  const next = promptAsyncResults.shift();
  if (next instanceof Error) throw next;
  return next ?? { response: new Response(null, { status: 200 }) };
});

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: mock(() => ({
    config: {
      get: mock(() => {
        configCalls += 1;
        return new Promise<ConfigResponse>((resolve) => {
          configResolvers.push(resolve);
        });
      }),
    },
    session: {
      promptAsync: promptAsyncMock,
    },
    global: {
      capabilities: capabilitiesMock,
    },
    mcp: {
      app: {
        resource: mcpResourceMock,
        toolCall: mcpToolCallMock,
      },
    },
  })),
}));

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-url', () => ({
  getRuntimeUrlResolver: mock(() => ({
    api: (path: string) => path,
  })),
}));

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: mock(() => ''),
  getRuntimeKey: mock(() => 'test-runtime'),
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async () => new Response(JSON.stringify(routingPayload), {
    headers: { 'Content-Type': 'application/json' },
  })),
}));

mock.module('@/lib/startupTrace', () => ({
  markStartupTrace: mock(() => undefined),
}));

const { opencodeClient } = await import(`./client?cache-test=${Date.now()}`);
const { clearInteractiveUIRoutingCache } = await import('@/lib/interactive-ui/routing');
const { getRoutingInspectionSnapshot, resetRoutingInspectorForTests } = await import('@/lib/interactive-ui/routingInspector');

beforeEach(() => {
  promptAsyncCalls.length = 0;
  promptAsyncResults.length = 0;
  capabilitiesCalls.length = 0;
  mcpResourceCalls.length = 0;
  mcpToolCallCalls.length = 0;
  routingPayload = [];
  clearInteractiveUIRoutingCache();
  resetRoutingInspectorForTests();
});

describe('opencodeClient MCP App SDK routing', () => {
  test('loads bound resources and tool calls through the directory-scoped SDK', async () => {
    const resource = await opencodeClient.getMcpAppResource({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      force: true,
    });
    expect(resource.html).toContain('MCP App');
    expect(mcpResourceCalls).toEqual([[{
      directory: '/workspace/mcp-app',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      force: 'true',
    }, { signal: undefined }]]);

    const result = await opencodeClient.callMcpAppTool({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      name: 'weather.refresh',
      arguments: { city: 'Singapore' },
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'weather.refresh' }],
    });
    expect(mcpToolCallCalls).toEqual([[{
      directory: '/workspace/mcp-app',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      name: 'weather.refresh',
      arguments: { city: 'Singapore' },
    }, { signal: undefined }]]);
  });

  test('reads fork distribution capabilities through the SDK', async () => {
    const capabilities = await opencodeClient.getDistributionCapabilities();
    expect(capabilities.distribution).toBe('ZunbaRan/opencode');
    expect(capabilities.features.mcpApps).toBe(true);
    expect(capabilitiesCalls).toEqual([[{ signal: undefined }]]);
  });
});

describe('opencodeClient getConfig cache', () => {
  test('cleared stale in-flight requests do not repopulate cache or delete newer in-flight requests', async () => {
    const first = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(1);

    opencodeClient.clearConfigCache();

    const second = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(2);

    configResolvers[0]?.({ data: { model: 'old/model' } });
    expect(await first).toEqual({ model: 'old/model' });

    const third = opencodeClient.getConfig('/workspace/project');
    expect(configCalls).toBe(2);

    configResolvers[1]?.({ data: { model: 'new/model' } });
    expect(await second).toEqual({ model: 'new/model' });
    expect(await third).toEqual({ model: 'new/model' });

    const cached = await opencodeClient.getConfig('/workspace/project');
    expect(cached).toEqual({ model: 'new/model' });
    expect(configCalls).toBe(2);
  });
});

describe('opencodeClient prompt retry behavior', () => {
  const sendPrompt = (providerID = 'anthropic') => opencodeClient.sendMessage({
    id: 'ses_1',
    providerID,
    modelID: 'claude-sonnet',
    text: 'hello',
  });

  test('does not retry 504 prompt responses because the POST may already be accepted', async () => {
    promptAsyncResults.push({ response: new Response('gateway timeout', { status: 504 }) });

    let error: unknown = null;
    try {
      await sendPrompt('anthropic-504');
    } catch (caught) {
      error = caught;
    }

    expect(promptAsyncCalls.length).toBe(1);
    expect(error instanceof Error ? error.message : String(error)).toContain('Failed to send message (504)');
  });

  test('injects the redacted Interactive UI capability context through the OpenCode system field', async () => {
    routingPayload = {
      apiVersion: 1,
      revision: 'sha256-test',
      system: '<openchamber_interactive_ui_routing>tool=crm_open</openchamber_interactive_ui_routing>',
      skippedExtensions: 0,
      extensions: [{
        id: 'com.acme.crm',
        version: '1.0.0',
        domain: 'crm',
        dataAuthority: 'connected-business-system',
        connection: { required: true, configured: true, expired: false, status: 'configured' },
        tools: [{
          name: 'crm_open',
          views: ['com.acme.crm.overview'],
          intents: ['crm.overview'],
          priority: 90,
          operation: 'read',
          dataAuthority: 'connected-business-system',
        }],
      }],
    };

    await sendPrompt('anthropic-routing');

    expect(promptAsyncCalls).toHaveLength(1);
    expect((promptAsyncCalls[0]?.[0] as { system?: string })?.system)
      .toBe('<openchamber_interactive_ui_routing>tool=crm_open</openchamber_interactive_ui_routing>');
    const trace = getRoutingInspectionSnapshot()[0];
    expect(trace.sessionId).toBe('ses_1');
    expect(trace.systemInjected).toBe(true);
    expect(trace.candidates[0]?.tool).toBe('crm_open');
    expect(trace.status).toBe('awaiting-tool');
  });

  test('does not retry transport failures because the tunnel may have lost only the response', async () => {
    promptAsyncResults.push(new TypeError('Failed to fetch'));

    let error: unknown = null;
    try {
      await sendPrompt('anthropic-network');
    } catch (caught) {
      error = caught;
    }

    expect(promptAsyncCalls.length).toBe(1);
    expect(error instanceof Error ? error.message : String(error)).toContain('Failed to fetch');
  });

  test('does not fabricate an HTTP 500 when the SDK swallows a transport failure into result.error', async () => {
    // The SDK catches thrown fetch errors and returns { error, response: undefined }.
    // That is a transport failure, not a server 500 — it must surface as a
    // descriptive transport error, never as "Failed to send message (500): {}".
    promptAsyncResults.push({ error: new TypeError('relay tunnel reset: plaintext frame on established channel'), response: undefined });

    let error: unknown = null;
    try {
      await sendPrompt('anthropic-transport');
    } catch (caught) {
      error = caught;
    }

    expect(promptAsyncCalls.length).toBe(1);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain('Failed to send message (500)');
    expect(message).toContain('transport failure');
    expect(message).toContain('relay tunnel reset');
    expect((error as Error & { status?: number }).status).toBe(undefined);
  });

  test('does not retry 503 prompt responses because proxy errors can be ambiguous too', async () => {
    promptAsyncResults.push({ response: new Response('starting', { status: 503 }) });

    let error: unknown = null;
    try {
      await sendPrompt('anthropic-503');
    } catch (caught) {
      error = caught;
    }

    expect(promptAsyncCalls.length).toBe(1);
    expect(error instanceof Error ? error.message : String(error)).toContain('Failed to send message (503)');
  });
});
