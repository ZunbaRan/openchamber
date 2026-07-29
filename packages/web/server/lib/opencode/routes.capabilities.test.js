import { afterEach, describe, expect, mock, test } from 'bun:test';
import { registerOpenCodeRoutes } from './routes.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const createHarness = () => {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (path, handler) => {
      routes.set(`${method.toUpperCase()} ${path}`, handler);
    };
  }

  registerOpenCodeRoutes(app, {
    crypto: globalThis.crypto,
    clientReloadDelayMs: 0,
    getOpenCodeResolutionSnapshot: async () => ({}),
    formatSettingsResponse: (value) => value,
    readSettingsFromDisk: async () => ({}),
    readSettingsFromDiskMigrated: async () => ({}),
    persistSettings: async (value) => value,
    sanitizeProjects: (value) => value,
    validateDirectoryPath: async () => ({ valid: true }),
    resolveProjectDirectory: async () => ({ directory: null }),
    getProviderSources: () => ({ sources: {} }),
    removeProviderConfig: () => undefined,
    refreshOpenCodeAfterConfigChange: async () => undefined,
    buildOpenCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic redacted' }),
  });

  const invoke = async (method, path, req = {}) => {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let statusCode = 200;
    let payload;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        payload = value;
        return this;
      },
    };
    await handler(req, res);
    return { statusCode, payload };
  };

  return { invoke };
};

describe('OpenCode distribution capability routes', () => {
  test('reports the managed fork capability handshake without querying an update feed', async () => {
    const fetchMock = mock(async (url) => {
      expect(String(url)).toBe('http://127.0.0.1:4096/global/capabilities');
      return Response.json({
        distribution: 'ZunbaRan/opencode',
        version: '1.18.9-oc.1',
        apiVersion: 2,
        managedUpdate: true,
        features: {
          mcpLegacy: true,
          mcp20260728: true,
          mcpApps: true,
          mcpAppToolCall: true,
        },
      });
    });
    globalThis.fetch = fetchMock;

    const { invoke } = createHarness();
    const response = await invoke('GET', '/api/opencode/capabilities');
    expect(response.statusCode).toBe(200);
    expect(response.payload.supported).toBe(true);
    expect(response.payload.capabilities.distribution).toBe('ZunbaRan/opencode');
    expect(response.payload.capabilities.features.mcpApps).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('degrades an external legacy CLI to ordinary MCP and text output', async () => {
    const fetchMock = mock(async (url) => {
      if (String(url).endsWith('/global/capabilities')) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      expect(String(url)).toBe('http://127.0.0.1:4096/global/health');
      return Response.json({ healthy: true, version: '1.18.9' });
    });
    globalThis.fetch = fetchMock;

    const { invoke } = createHarness();
    const response = await invoke('GET', '/api/opencode/capabilities');
    expect(response.statusCode).toBe(200);
    expect(response.payload.supported).toBe(false);
    expect(response.payload.capabilities.distribution).toBe('external-or-official');
    expect(response.payload.capabilities.features).toEqual({
      mcpLegacy: true,
      mcp20260728: false,
      mcpApps: false,
      mcpAppToolCall: false,
    });
    expect(response.payload.diagnostic).toContain('does not expose OpenChamber capabilities');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('refuses independent OpenCode upgrades', async () => {
    const { invoke } = createHarness();
    const response = await invoke('POST', '/api/opencode/upgrade');
    expect(response.statusCode).toBe(409);
    expect(response.payload.success).toBe(false);
    expect(response.payload.error).toContain('never upgrades OpenCode independently');
  });
});
