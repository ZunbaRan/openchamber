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
let mcpResourceAvailable = true;
let mcpToolCallAvailable = true;
const partUpdateCalls: unknown[][] = [];
const sessionMessageCalls: unknown[][] = [];
const runtimeFetchCalls: Array<[string | URL | Request, RequestInit | undefined]> = [];
let sessionMessageParts: unknown[] = [];
let runtimeFetchErrorStatus: number | null = null;

const capabilitiesMock = mock(async (...args: unknown[]) => {
  capabilitiesCalls.push(args);
  return {
    data: {
      distribution: 'ZunbaRan/opencode',
      version: '1.18.10-oc.1',
      upstreamVersion: '1.18.10',
      upstreamCommit: 'upstream-sha',
      forkCommit: 'fork-sha',
      apiVersion: '2',
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
const partUpdateMock = mock(async (parameters: Record<string, unknown>, ...args: unknown[]) => {
  partUpdateCalls.push([parameters, ...args]);
  return { data: parameters.part };
});
const sessionMessageMock = mock(async (parameters: Record<string, unknown>, ...args: unknown[]) => {
  sessionMessageCalls.push([parameters, ...args]);
  return { data: { parts: sessionMessageParts } };
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
      message: sessionMessageMock,
    },
    global: {
      capabilities: capabilitiesMock,
    },
    mcp: {
      app: {
        ...(mcpResourceAvailable ? { resource: mcpResourceMock } : {}),
        ...(mcpToolCallAvailable ? { toolCall: mcpToolCallMock } : {}),
      },
    },
    part: {
      update: partUpdateMock,
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
  runtimeFetch: mock(async (input: string | URL | Request, init?: RequestInit) => {
    runtimeFetchCalls.push([input, init]);
    const url = input.toString();
    if (runtimeFetchErrorStatus !== null) {
      return new Response('error', { status: runtimeFetchErrorStatus });
    }
    if (url.includes('/mcp/app/resource')) {
      const query = new URL(url, 'http://openchamber.test').searchParams;
      return new Response(JSON.stringify({
        server: query.get('server'),
        resourceUri: query.get('resourceUri'),
        mimeType: 'text/html;profile=mcp-app',
        html: '<!doctype html><title>MCP App</title>',
        sha256: 'sha256-test',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/mcp/app/tool-call')) {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: String(body.name) }],
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
    });
  }),
}));

mock.module('@/lib/startupTrace', () => ({
  markStartupTrace: mock(() => undefined),
}));

const { opencodeClient } = await import(`./client?cache-test=${Date.now()}`);

beforeEach(() => {
  promptAsyncCalls.length = 0;
  promptAsyncResults.length = 0;
  capabilitiesCalls.length = 0;
  mcpResourceCalls.length = 0;
  mcpToolCallCalls.length = 0;
  mcpResourceAvailable = true;
  mcpToolCallAvailable = true;
  partUpdateCalls.length = 0;
  sessionMessageCalls.length = 0;
  runtimeFetchCalls.length = 0;
  sessionMessageParts = [];
  runtimeFetchErrorStatus = null;
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

describe('opencodeClient MCP App and message-part wrappers', () => {
  const toolPart = {
    id: 'prt_1',
    sessionID: 'ses_1',
    messageID: 'msg_1',
    type: 'tool' as const,
    callID: 'call_1',
    tool: 'weather_current',
    state: {
      status: 'completed' as const,
      input: { city: 'Singapore' },
      output: 'Sunny',
      title: '',
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };

  test('reads fork distribution capabilities through the generated SDK method', async () => {
    const capabilities = await opencodeClient.getDistributionCapabilities();
    expect(capabilities.distribution).toBe('ZunbaRan/opencode');
    expect(capabilities.upstreamVersion).toBe('1.18.10');
    expect(capabilities.features.mcpApps).toBe(true);
    expect(capabilitiesCalls).toEqual([[{ signal: undefined }]]);
  });

  test('getMcpAppResource sends the exact MCP identity GET and forwards AbortSignal', async () => {
    const controller = new AbortController();
    const resource = await opencodeClient.getMcpAppResource({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_origin',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
      force: true,
      signal: controller.signal,
    });

    expect(resource.html).toContain('MCP App');
    expect(resource.sha256).toBe('sha256-test');
    expect(mcpResourceCalls).toEqual([]);
    expect(runtimeFetchCalls).toHaveLength(1);
    const resourceUrl = new URL(String(runtimeFetchCalls[0]?.[0]), 'http://openchamber.test');
    expect(resourceUrl.pathname).toBe('/api/mcp/app/resource');
    expect(Object.fromEntries(resourceUrl.searchParams)).toEqual({
      directory: '/workspace/mcp-app',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      partID: 'prt_origin',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
      force: 'true',
    });
    expect(runtimeFetchCalls[0]?.[1]?.method).toBe('GET');
    expect(runtimeFetchCalls[0]?.[1]?.signal).toBe(controller.signal);
  });

  test('callMcpAppTool posts the exact bound JSON identity body and forwards AbortSignal', async () => {
    const controller = new AbortController();
    const result = await opencodeClient.callMcpAppTool({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_origin',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
      name: 'weather.refresh',
      arguments: { city: 'Singapore' },
      signal: controller.signal,
    });

    expect(result).toEqual({ content: [{ type: 'text', text: 'weather.refresh' }] });
    expect(mcpToolCallCalls).toEqual([]);
    expect(runtimeFetchCalls).toHaveLength(1);
    expect(String(runtimeFetchCalls[0]?.[0])).toBe(
      '/api/mcp/app/tool-call?directory=%2Fworkspace%2Fmcp-app',
    );
    expect(runtimeFetchCalls[0]?.[1]?.method).toBe('POST');
    expect(runtimeFetchCalls[0]?.[1]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(runtimeFetchCalls[0]?.[1]?.body))).toEqual({
      sessionID: 'ses_1',
      messageID: 'msg_1',
      partID: 'prt_origin',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
      name: 'weather.refresh',
      arguments: { city: 'Singapore' },
    });
  });

  test('updateMessagePart persists through scoped SDK part.update with exact identity and signal', async () => {
    const controller = new AbortController();
    const persisted = await opencodeClient.updateMessagePart({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_1',
      part: toolPart,
      signal: controller.signal,
    });

    expect(persisted).toEqual(toolPart);
    expect(partUpdateCalls).toEqual([[{
      directory: '/workspace/mcp-app',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      partID: 'prt_1',
      part: toolPart,
    }, { signal: controller.signal }]]);
  });

  test('getMessagePart returns the exact matching part and rejects when it is absent', async () => {
    sessionMessageParts = [toolPart];
    const found = await opencodeClient.getMessagePart({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_1',
    });
    expect(found).toEqual(toolPart);
    expect(sessionMessageCalls).toEqual([[{
      directory: '/workspace/mcp-app',
      sessionID: 'ses_1',
      messageID: 'msg_1',
    }, { signal: undefined }]]);

    sessionMessageParts = [];
    await expect(opencodeClient.getMessagePart({
      directory: '/workspace/mcp-app',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_missing',
    })).rejects.toThrow('Get session message part failed: part not found');
  });

  test('fails diagnostically when generated MCP App SDK methods are absent', async () => {
    mcpToolCallAvailable = false;
    await expect(opencodeClient.callMcpAppTool({
      directory: '/workspace/external-cli-tool',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
      name: 'weather.refresh',
    })).rejects.toThrow('The selected OpenCode CLI does not support MCP App tool calls');
    expect(runtimeFetchCalls).toEqual([]);

    mcpResourceAvailable = false;
    await expect(opencodeClient.getMcpAppResource({
      directory: '/workspace/external-cli-resource',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_1',
      server: 'weather',
      resourceUri: 'ui://weather/current',
      toolKey: 'weather_weather_current',
    })).rejects.toThrow('The selected OpenCode CLI does not support MCP Apps');
    expect(runtimeFetchCalls).toEqual([]);
  });

  test('fails diagnostically on non-ok MCP App resource responses', async () => {
    runtimeFetchErrorStatus = 404;
    let error: unknown = null;
    try {
      await opencodeClient.getMcpAppResource({
        directory: '/workspace/mcp-app',
        sessionId: 'ses_1',
        messageId: 'msg_1',
        partId: 'prt_origin',
        server: 'weather',
        resourceUri: 'ui://weather/current',
        toolKey: 'weather_weather_current',
      });
    } catch (caught) {
      error = caught;
    }

    expect(runtimeFetchCalls).toHaveLength(1);
    expect(error instanceof Error ? error.message : String(error)).toContain('Load MCP App resource failed (404)');
    expect((error as Error & { status?: number }).status).toBe(404);
  });
});
