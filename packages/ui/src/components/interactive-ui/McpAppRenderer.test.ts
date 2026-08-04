import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MCP_APP_FULLSCREEN_STYLE,
  MCP_APP_OPAQUE_DOCUMENT_SANDBOX,
  MCP_APP_SANDBOX_PROXY_SANDBOX,
  MCP_APP_RESOURCE_LOAD_TIMEOUT_MS,
  MCP_APP_TEARDOWN_TIMEOUT_MS,
  McpAppRenderer,
  McpAppResourceLoadTimeoutError,
  activateMcpAppBridgeAfterTeardown,
  buildMcpAppHostCapabilities,
  buildMcpAppBindingEpoch,
  buildMcpAppBrokerCsp,
  buildMcpAppDocumentPolicy,
  buildMcpAppDialogClassName,
  buildMcpAppDisplayContext,
  buildMcpAppPresentationLayout,
  buildMcpAppSandboxFrameSources,
  createMcpAppModelContextUpdateHandler,
  createMcpAppBrokerDocument,
  createMcpAppBridgeTeardownController,
  createMcpAppBindingAuthorityGuard,
  createMcpAppLoaderHostController,
  createMcpAppLoaderDocument,
  createMcpAppOpaqueDocumentUrl,
  createMcpAppPersistableEnvelopeDispatcher,
  createMcpAppResourceLoadController,
  createMcpAppSandboxProxyHostController,
  createMcpAppToolNotificationQueue,
  downloadMcpAppFiles,
  formatMcpAppDownloadSize,
  injectMcpAppResourceCsp,
  linkMcpAppOperationAbortSignals,
  openMcpAppExternalLink,
  prepareMcpAppDownloads,
  restoreMcpAppLoaderFrame,
  resolveMcpAppHostGeometry,
  resolveMcpAppDisplayMode,
  resolveMcpAppIframeAllowAttribute,
} from './McpAppRenderer';
import {
  createMcpAppResultEnvelope,
  mcpAppFirstPaintVerdict,
  parseMcpAppBinding,
  type McpAppResultEnvelope,
} from '@/lib/interactive-ui/mcpApp';
import { opencodeClient } from '@/lib/opencode/client';

describe('MCP App resource loading lifecycle', () => {
  const createHarness = <Resource,>() => {
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let nextTimer = 0;
    let resolve!: (resource: Resource) => void;
    let reject!: (error: unknown) => void;
    let observedSignal: AbortSignal | undefined;
    const successes: Resource[] = [];
    const errors: Error[] = [];
    const controller = createMcpAppResourceLoadController<Resource>({
      load: (signal) => {
        observedSignal = signal;
        return new Promise<Resource>((resolveRequest, rejectRequest) => {
          resolve = resolveRequest;
          reject = rejectRequest;
        });
      },
      onSuccess: (resource) => successes.push(resource),
      onError: (error) => errors.push(error),
      schedule: (callback, delay) => {
        nextTimer += 1;
        timers.set(nextTimer, { callback, delay });
        return nextTimer;
      },
      cancel: (handle) => timers.delete(handle as number),
    });
    return {
      controller,
      timers,
      successes,
      errors,
      resolve,
      reject,
      get signal() {
        if (!observedSignal) throw new Error('expected resource load signal');
        return observedSignal;
      },
      expire: () => {
        const next = timers.entries().next().value as [number, { callback: () => void }] | undefined;
        if (!next) return false;
        timers.delete(next[0]);
        next[1].callback();
        return true;
      },
    };
  };

  test('clears the timeout after a successful resource load', async () => {
    const harness = createHarness<{ sha256: string }>();

    expect([...harness.timers.values()].map(timer => timer.delay)).toEqual([
      MCP_APP_RESOURCE_LOAD_TIMEOUT_MS,
    ]);
    harness.resolve({ sha256: 'verified-resource' });
    await harness.controller.completion;

    expect(harness.successes).toEqual([{ sha256: 'verified-resource' }]);
    expect(harness.errors).toEqual([]);
    expect(harness.timers.size).toBe(0);
    expect(harness.signal.aborted).toBe(false);
  });

  test('aborts a hung request and reports a recognizable retryable timeout error', async () => {
    const harness = createHarness<{ sha256: string }>();

    expect(harness.expire()).toBe(true);
    await harness.controller.completion;

    expect(harness.signal.aborted).toBe(true);
    expect(harness.successes).toEqual([]);
    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]).toBeInstanceOf(McpAppResourceLoadTimeoutError);
    expect(harness.errors[0]?.name).toBe('McpAppResourceLoadTimeoutError');
    expect(harness.errors[0]?.message).toBe('MCP App resource could not be loaded');

    harness.reject(new DOMException('aborted', 'AbortError'));
    await Promise.resolve();
    expect(harness.errors).toHaveLength(1);
  });

  test('aborts on unmount, clears the timeout, and does not report an error', async () => {
    const harness = createHarness<{ sha256: string }>();

    harness.controller.dispose();
    await harness.controller.completion;

    expect(harness.signal.aborted).toBe(true);
    expect(harness.timers.size).toBe(0);
    expect(harness.successes).toEqual([]);
    expect(harness.errors).toEqual([]);

    harness.reject(new DOMException('aborted', 'AbortError'));
    await Promise.resolve();
    expect(harness.errors).toEqual([]);
  });
});

describe('MCP App App Board remount stability', () => {
  test('uses the latest persistence callback without replacing the bridge-facing dispatcher', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    const first = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-1' },
      toolOutput: 'revision 1',
      metadata: {},
    });
    const second = {
      ...first,
      result: { ...first.result, content: [{ type: 'text' as const, text: 'revision 2' }] },
    };
    const callbacks: string[] = [];
    let callback: ((next: McpAppResultEnvelope) => Promise<void>) | undefined = async () => {
      callbacks.push('first');
    };
    let latest = first;
    const dispatcher = createMcpAppPersistableEnvelopeDispatcher({
      getCallback: () => callback,
      setLatestEnvelope: (next) => {
        latest = next;
      },
    });

    callback = async () => {
      callbacks.push('replacement');
    };
    const sameDispatcher = dispatcher;
    await dispatcher(second);

    expect(dispatcher).toBe(sameDispatcher);
    expect(callbacks).toEqual(['replacement']);
    expect(latest).toBe(second);
  });

  test('restores the opaque Loader source after srcdoc teardown before a replacement starts', () => {
    const removed: string[] = [];
    const frame = {
      src: '',
      removeAttribute: (name: string) => removed.push(name),
    };

    restoreMcpAppLoaderFrame(frame, 'data:text/html;base64,bG9hZGVy');

    expect(removed).toEqual(['srcdoc']);
    expect(frame.src).toBe('data:text/html;base64,bG9hZGVy');
  });
});

describe('MCP App tool notification ordering', () => {
  test('sends input before exactly one newest completed result across a deferred transition', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    let envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-1' },
      toolOutput: '',
      metadata: {},
    });
    let status: 'running' | 'completed' = 'running';
    const events: string[] = [];
    let resolveInput!: () => void;
    const inputGate = new Promise<void>((resolve) => {
      resolveInput = resolve;
    });
    const bridge = {
      sendToolInput: async ({ arguments: args }: { arguments: Record<string, unknown> }) => {
        events.push(`input:${String(args.canvasId)}`);
        await inputGate;
      },
      sendToolResult: async (result: McpAppResultEnvelope['result']) => {
        const text = result.content[0] as { text?: string } | undefined;
        events.push(`result:${text?.text ?? ''}`);
      },
    };
    const notifications = createMcpAppToolNotificationQueue({
      getBridge: () => bridge as never,
      isReady: () => true,
      getEnvelope: () => envelope,
      getStatus: () => status,
    });

    const initializing = notifications.flush();
    await Promise.resolve();
    status = 'completed';
    envelope = {
      ...envelope,
      result: { ...envelope.result, content: [{ type: 'text', text: 'revision 2' }] },
    };
    const completion = notifications.flush();
    resolveInput();
    await Promise.all([initializing, completion]);

    expect(events).toEqual(['input:canvas-1', 'result:revision 2']);
  });

  test('publishes one full result per bridge epoch and suppresses persisted model-context echoes', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    let envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-1' },
      toolOutput: 'full authoritative result',
      metadata: {
        structuredContent: {
          canvasId: 'canvas-1',
          revision: 1,
          authority: { server: 'tldraw' },
        },
      },
    });
    const results: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const bridge = {
      sendToolInput: async () => undefined,
      sendToolResult: async (result: McpAppResultEnvelope['result']) => {
        const text = result.content[0] as { text?: string } | undefined;
        results.push(text?.text ?? '');
        if (results.length === 1) {
          markFirstStarted();
          await firstGate;
        }
      },
    };
    const notifications = createMcpAppToolNotificationQueue({
      getBridge: () => bridge as never,
      isReady: () => true,
      getEnvelope: () => envelope,
      getStatus: () => 'completed',
    });

    const initial = notifications.flush();
    await firstStarted;
    envelope = {
      ...envelope,
      result: {
        ...envelope.result,
        content: [{ type: 'text', text: 'compact persisted summary' }],
        structuredContent: { canvasId: 'canvas-1', revision: 2 },
      },
    };
    const persistedEcho = notifications.flush();
    releaseFirst();
    await Promise.all([initial, persistedEcho]);
    await notifications.flush();

    expect(results).toEqual(['full authoritative result']);

    notifications.reset();
    await notifications.flush();
    expect(results).toEqual([
      'full authoritative result',
      'compact persisted summary',
    ]);
  });

  test('fails closed instead of publishing a second complete input when arguments mutate', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    let envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-1' },
      toolOutput: '',
      metadata: {},
    });
    const inputs: unknown[] = [];
    const violations: string[] = [];
    const notifications = createMcpAppToolNotificationQueue({
      getBridge: () => ({
        sendToolInput: async (params: unknown) => { inputs.push(params); },
        sendToolResult: async () => undefined,
        sendToolCancelled: async () => undefined,
      }),
      isReady: () => true,
      getEnvelope: () => envelope,
      getStatus: () => 'running',
      onProtocolViolation: (reason) => violations.push(reason),
    });

    expect(await notifications.flush()).toBe('input');
    envelope = { ...envelope, arguments: { canvasId: 'canvas-2' } };
    await expect(notifications.flush()).rejects.toThrow('complete tool input changed');
    expect(inputs).toHaveLength(1);
    expect(violations).toHaveLength(1);
    expect(await notifications.flush()).toBe('idle');
  });

  test('publishes one cancellation after complete input and never publishes a result', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    const envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-1' },
      toolOutput: '',
      metadata: {},
    });
    const events: string[] = [];
    const notifications = createMcpAppToolNotificationQueue({
      getBridge: () => ({
        sendToolInput: async () => { events.push('input'); },
        sendToolResult: async () => { events.push('result'); },
        sendToolCancelled: async ({ reason }) => { events.push(`cancel:${reason}`); },
      }),
      isReady: () => true,
      getEnvelope: () => envelope,
      getStatus: () => 'cancelled',
      getCancellationReason: () => 'user interrupted',
    });

    expect(await notifications.flush()).toBe('cancelled');
    expect(await notifications.flush()).toBe('idle');
    expect(events).toEqual(['input', 'cancel:user interrupted']);
  });
});

describe('MCP App bridge teardown lifecycle', () => {
  const createHarness = ({ active = true }: { active?: boolean } = {}) => {
    const events: string[] = [];
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let nextTimer = 0;
    let resolveTeardown: (() => void) | null = null;
    const controller = createMcpAppBridgeTeardownController({
      shouldRequestTeardown: () => active,
      requestTeardown: () => {
        events.push('teardown:request');
        return new Promise<void>((resolve) => {
          resolveTeardown = () => {
            events.push('teardown:response');
            resolve();
          };
        });
      },
      disposeLoader: () => events.push('loader:dispose'),
      removeLifecycleListeners: () => events.push('listeners:remove'),
      releaseAppDocument: () => events.push('document:release'),
      clearBridgeReference: () => events.push('bridge:clear'),
      closeTransport: async () => {
        events.push('transport:close');
      },
      schedule: (callback, delay) => {
        nextTimer += 1;
        timers.set(nextTimer, { callback, delay });
        return nextTimer;
      },
      cancel: (handle) => timers.delete(handle as number),
    });
    return {
      controller,
      events,
      timers,
      respond: () => resolveTeardown?.(),
      expire: () => {
        const next = timers.entries().next().value as [number, { callback: () => void }] | undefined;
        if (!next) return false;
        timers.delete(next[0]);
        next[1].callback();
        return true;
      },
    };
  };

  test('awaits the teardown response before revoking the document and transport', async () => {
    const harness = createHarness();
    const disposal = harness.controller.dispose();

    expect(harness.events).toEqual(['teardown:request']);
    expect([...harness.timers.values()].map(timer => timer.delay)).toEqual([
      MCP_APP_TEARDOWN_TIMEOUT_MS,
    ]);
    harness.respond();
    await disposal;

    expect(harness.events).toEqual([
      'teardown:request',
      'teardown:response',
      'loader:dispose',
      'listeners:remove',
      'document:release',
      'bridge:clear',
      'transport:close',
    ]);
    expect(harness.timers.size).toBe(0);
  });

  test('uses the bounded timeout before cleanup when an App does not respond', async () => {
    const harness = createHarness();
    const disposal = harness.controller.dispose();

    expect(harness.events).toEqual(['teardown:request']);
    expect(harness.expire()).toBe(true);
    await disposal;

    expect(harness.events).toEqual([
      'teardown:request',
      'loader:dispose',
      'listeners:remove',
      'document:release',
      'bridge:clear',
      'transport:close',
    ]);
  });

  test('is idempotent across repeated unmount, pin, and fullscreen cleanup signals', async () => {
    const harness = createHarness();
    const unmount = harness.controller.dispose();
    const pinRemountCleanup = harness.controller.dispose();
    const fullscreenExitCleanup = harness.controller.dispose();

    expect(unmount).toBe(pinRemountCleanup);
    expect(unmount).toBe(fullscreenExitCleanup);
    expect(harness.events).toEqual(['teardown:request']);
    harness.respond();
    await Promise.all([unmount, pinRemountCleanup, fullscreenExitCleanup]);

    expect(harness.events.filter(event => event === 'teardown:request')).toHaveLength(1);
    expect(harness.events.filter(event => event === 'document:release')).toHaveLength(1);
    expect(harness.events.filter(event => event === 'transport:close')).toHaveLength(1);
  });

  test('skips protocol teardown for a queued remount that never connected', async () => {
    const harness = createHarness({ active: false });
    await harness.controller.dispose();

    expect(harness.events).toEqual([
      'loader:dispose',
      'listeners:remove',
      'document:release',
      'bridge:clear',
      'transport:close',
    ]);
    expect(harness.timers.size).toBe(0);
  });

  test('does not activate a pin/remount replacement until the previous transport closes', async () => {
    const harness = createHarness();
    const priorDisposal = harness.controller.dispose();
    const replacementEvents: string[] = [];
    const replacement = activateMcpAppBridgeAfterTeardown(
      priorDisposal,
      () => false,
      () => {
        replacementEvents.push('replacement:connect');
      },
    );

    await Promise.resolve();
    expect(replacementEvents).toHaveLength(0);
    harness.respond();
    await replacement;

    expect(harness.events.at(-1)).toBe('transport:close');
    expect(replacementEvents).toEqual(['replacement:connect']);
  });

  test('re-arms the Loader only after the previous srcdoc bridge finishes teardown', async () => {
    const harness = createHarness();
    const priorDisposal = harness.controller.dispose();
    const replacementEvents: string[] = [];
    const frame = {
      src: 'about:blank',
      removeAttribute: (name: string) => replacementEvents.push(`remove:${name}`),
    };
    const replacement = activateMcpAppBridgeAfterTeardown(
      priorDisposal,
      () => false,
      () => {
        restoreMcpAppLoaderFrame(frame, 'data:text/html;base64,bG9hZGVy');
        replacementEvents.push(`connect:${frame.src}`);
      },
    );

    await Promise.resolve();
    expect(replacementEvents).toEqual([]);
    harness.respond();
    await replacement;

    expect(harness.events.at(-1)).toBe('transport:close');
    expect(replacementEvents).toEqual([
      'remove:srcdoc',
      'connect:data:text/html;base64,bG9hZGVy',
    ]);
  });

  test('does not connect a replacement that unmounted while waiting on the barrier', async () => {
    const harness = createHarness();
    const priorDisposal = harness.controller.dispose();
    let replacementDisposed = false;
    const replacementEvents: string[] = [];
    const replacement = activateMcpAppBridgeAfterTeardown(
      priorDisposal,
      () => replacementDisposed,
      () => {
        replacementEvents.push('replacement:connect');
      },
    );

    replacementDisposed = true;
    harness.respond();
    await replacement;

    expect(replacementEvents).toHaveLength(0);
  });
});

const inertBrokerTimers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

describe('MCP App sandbox bootstrap', () => {
  test('keeps App markup out of the independent opaque Broker and Loader URLs', () => {
    const html = [
      '<!doctype html><html><body>',
      '<script>window.example = "nested";</script>',
      '<div data-edge="</ScRiPt>">line\u2028separator\u2029paragraph</div>',
      '</body></html>',
    ].join('');
    const appUrl = createMcpAppOpaqueDocumentUrl(html);
    const bytes = Uint8Array.from(
      atob(appUrl.slice('data:text/html;charset=utf-8;base64,'.length)),
      (character) => character.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe(html);

    const loaderUrl = createMcpAppOpaqueDocumentUrl(
      createMcpAppLoaderDocument('channel-nonce'),
    );
    const document = createMcpAppBrokerDocument('channel-nonce');
    expect(document.toLowerCase().match(/<\/script/g)).toHaveLength(1);
    expect(document).not.toContain(html);
    expect(document).not.toContain(appUrl);
    expect(document).toContain(loaderUrl);
    expect(document).toContain(
      `app.setAttribute("sandbox",${JSON.stringify(MCP_APP_OPAQUE_DOCUMENT_SANDBOX)})`,
    );
    expect(document).toContain('app.srcdoc=html');
  });

  test('keeps the Broker URL bounded for a production-sized App resource', () => {
    const largeHtml = `<!doctype html><main>${'x'.repeat(4_400_000)}</main>`;
    const brokerDocument = createMcpAppBrokerDocument('large-app-nonce');
    const brokerUrl = createMcpAppOpaqueDocumentUrl(brokerDocument);

    expect(largeHtml.length).toBeGreaterThan(4_000_000);
    expect(brokerUrl.length).toBeLessThan(16_000);
    expect(brokerDocument).not.toContain(largeHtml.slice(-2_048));
    expect(brokerUrl.length).toBe(
      createMcpAppOpaqueDocumentUrl(createMcpAppBrokerDocument('small-app-nonce')).length,
    );
  });

  test('uses strict undeclared CSP defaults and prefixes policy before hostile App markup', () => {
    const policy = buildMcpAppDocumentPolicy({
      resourceUri: 'ui://demo/app.html',
      visibility: ['model', 'app'],
    }, {
      html: '<main>demo</main>',
      mimeType: 'text/html;profile=mcp-app',
      sha256: 'sha256:demo',
      server: 'demo-server',
      resourceUri: 'ui://demo/app.html',
    });
    expect(policy).toContain(`connect-src 'none'`);
    expect(policy).toContain(`frame-src 'none'`);
    expect(policy).toContain(`base-uri 'self'`);
    expect(policy).toContain(`img-src 'self' data: blob:`);
    expect(policy).not.toContain('connect-src data:');
    expect(policy).not.toContain('frame-src data:');
    expect(policy).not.toContain('https://');

    for (const html of [
      '<!-- <head> --><script>window.evil=true</script>',
      '<template><head><script>window.template=true</script></head></template><script>window.early=true</script>',
      '</head><base href="https://evil.example/"><script>window.base=true</script>',
      '<!doctype html><HTML><HEAD data-x="1"></HEAD><BODY><script>window.upper=true</script></BODY></HTML>',
    ]) {
      const injected = injectMcpAppResourceCsp(html, policy);
      expect(injected.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
      expect(injected.indexOf('Content-Security-Policy')).toBeLessThan(injected.indexOf('<script'));
      if (injected.includes('<base')) {
        expect(injected.indexOf('Content-Security-Policy')).toBeLessThan(injected.indexOf('<base'));
      }
      expect(injected.endsWith(html)).toBe(true);
    }
  });

  test('binds proxy nonce epochs to every Host authority field', () => {
    const base = {
      directory: '/workspace/a',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      partId: 'prt_1',
      server: 'tldraw',
      resourceUri: 'ui://tldraw/canvas.html',
      toolKey: 'tldraw_tldraw_open_canvas',
      resourceSha256: 'sha256:one',
      attempt: 0,
    };
    const initial = buildMcpAppBindingEpoch(base);
    for (const changed of [
      { directory: '/workspace/b' },
      { sessionId: 'ses_2' },
      { messageId: 'msg_2' },
      { partId: 'prt_2' },
      { server: 'other' },
      { resourceUri: 'ui://tldraw/other.html' },
      { toolKey: 'tldraw_other' },
      { resourceSha256: 'sha256:two' },
      { attempt: 1 },
    ]) {
      expect(buildMcpAppBindingEpoch({ ...base, ...changed })).not.toBe(initial);
    }
  });

  test('revokes old bridge handlers synchronously when the render binding epoch changes', () => {
    let current = 'epoch-a';
    let initialized = true;
    let disposed = false;
    const oldHandlerAuthority = createMcpAppBindingAuthorityGuard({
      bindingEpoch: 'epoch-a',
      getCurrentBindingEpoch: () => current,
      isInitialized: () => initialized,
      isDisposed: () => disposed,
    });
    expect(oldHandlerAuthority.isActive()).toBe(true);

    // This models the ref mutation performed during the replacement render,
    // before React runs the old layout-effect cleanup.
    current = 'epoch-b';
    expect(oldHandlerAuthority.ownsCurrentBinding()).toBe(false);
    expect(oldHandlerAuthority.isActive()).toBe(false);

    current = 'epoch-a';
    initialized = false;
    expect(oldHandlerAuthority.isActive()).toBe(false);
    initialized = true;
    disposed = true;
    expect(oldHandlerAuthority.isActive()).toBe(false);
  });

  test('aborts an in-flight operation when either its AppBridge request or binding is revoked', () => {
    const request = new AbortController();
    const binding = new AbortController();
    const linked = linkMcpAppOperationAbortSignals(request.signal, binding.signal);
    expect(linked.signal.aborted).toBe(false);

    binding.abort(new DOMException('binding replaced', 'AbortError'));
    expect(linked.signal.aborted).toBe(true);
    expect(linked.signal.reason).toBe(binding.signal.reason);
    linked.dispose();

    const preAborted = new AbortController();
    preAborted.abort(new DOMException('request cancelled', 'AbortError'));
    const immediate = linkMcpAppOperationAbortSignals(preAborted.signal);
    expect(immediate.signal.aborted).toBe(true);
    expect(immediate.signal.reason).toBe(preAborted.signal.reason);
    immediate.dispose();
  });

  test('requires exact source, opaque origin, and nonce for the official sandbox handshake', () => {
    const sent: unknown[] = [];
    const lifecycle: string[] = [];
    const target = {
      postMessage: (message: unknown) => sent.push(message),
    };
    const controller = createMcpAppSandboxProxyHostController({
      target,
      channelNonce: 'binding-nonce',
      appIdentity: 'sha256:resource:binding-nonce',
      appHtml: '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><main>App</main>',
      onProxyResourceMounted: () => lifecycle.push('mounted'),
      onAppReady: () => lifecycle.push('ready'),
      onInvalidated: (reason) => lifecycle.push(`invalid:${reason}`),
    });
    controller.start();
    const ready = {
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-proxy-ready',
      params: { nonce: 'binding-nonce' },
    };
    controller.handleMessage({ source: {}, origin: 'null', data: ready });
    controller.handleMessage({ source: target, origin: 'https://host.example', data: ready });
    controller.handleMessage({
      source: target,
      origin: 'null',
      data: { ...ready, params: { nonce: 'wrong' } },
    });
    expect(sent).toHaveLength(0);

    controller.handleMessage({ source: target, origin: 'null', data: ready });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-resource-ready',
      params: {
        html: '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><main>App</main>',
        sandbox: MCP_APP_OPAQUE_DOCUMENT_SANDBOX,
        openchamber: {
          nonce: 'binding-nonce',
          identity: 'sha256:resource:binding-nonce',
        },
      },
    });

    controller.handleAppInitialized();
    expect(lifecycle).toEqual([]);
    controller.handleMessage({
      source: target,
      origin: 'null',
      data: {
        source: 'openchamber-mcp-broker',
        type: 'broker.ready',
        nonce: 'binding-nonce',
      },
    });
    expect(sent.at(-1)).toEqual({
      source: 'openchamber-mcp-host',
      type: 'host.listening',
      nonce: 'binding-nonce',
    });
    expect(lifecycle).toEqual(['mounted', 'ready']);
  });

  test('does not lose an authenticated proxy-ready notification that races controller start', () => {
    const sent: unknown[] = [];
    const target = { postMessage: (message: unknown) => sent.push(message) };
    const controller = createMcpAppSandboxProxyHostController({
      target,
      channelNonce: 'early-ready-nonce',
      appIdentity: 'sha256:resource:early-ready-nonce',
      appHtml: '<!doctype html><main>App</main>',
      onProxyResourceMounted: () => {},
      onAppReady: () => {},
      onInvalidated: () => {},
    });
    controller.handleMessage({
      source: target,
      origin: 'null',
      data: {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-proxy-ready',
        params: { nonce: 'early-ready-nonce' },
      },
    });
    expect(sent).toEqual([]);
    controller.start();
    expect(sent).toHaveLength(1);
    expect((sent[0] as { method?: string }).method).toBe(
      'ui/notifications/sandbox-resource-ready',
    );
  });

  test('accepts the official resource-ready notification in the production Broker document', () => {
    const document = createMcpAppBrokerDocument('official-nonce');
    const script = document.slice(document.indexOf('<script>') + 8, document.lastIndexOf('</script>'));
    const parentMessages: unknown[] = [];
    const appMessages: unknown[] = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    const parent = { postMessage: (message: unknown) => parentMessages.push(message) };
    const appWindow = { postMessage: (message: unknown) => appMessages.push(message) };
    const app = {
      contentWindow: appWindow,
      src: '',
      setAttribute: () => {},
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'load') loadListener = listener;
      },
      remove: () => {},
    };
    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      },
      document: {
        createElement: () => app,
        body: { append: () => {} },
      },
    });
    expect(parentMessages.some((message) => {
      const candidate = message as {
        jsonrpc?: string;
        method?: string;
        params?: { nonce?: string };
      };
      return candidate.jsonrpc === '2.0'
        && candidate.method === 'ui/notifications/sandbox-proxy-ready'
        && candidate.params?.nonce === 'official-nonce';
    })).toBe(true);
    messageListener?.({
      source: parent,
      data: {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: {
          html: '<main>Official App</main>',
          sandbox: MCP_APP_OPAQUE_DOCUMENT_SANDBOX,
          openchamber: { nonce: 'official-nonce', identity: 'binding-epoch' },
        },
      },
    });
    loadListener?.();
    expect(appMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'loader.init',
      nonce: 'official-nonce',
      appHtml: '<main>Official App</main>',
    });
    expect(MCP_APP_SANDBOX_PROXY_SANDBOX).toBe('allow-scripts allow-same-origin');
  });

  test('validates raw App HTML in the nonce-bound Loader exactly once', () => {
    const document = createMcpAppLoaderDocument('loader-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const script = document.slice(scriptStart, scriptEnd);
    const messages: unknown[] = [];
    const blobs: Array<{ parts: unknown[]; options?: { type?: string } }> = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    class BlobMock {
      parts: unknown[];
      options?: { type?: string };

      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts;
        this.options = options;
        blobs.push(this);
      }
    }

    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      document: { readyState: 'complete' },
      Blob: BlobMock,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      },
    });

    expect(messages).toEqual([{
      source: 'openchamber-mcp-loader',
      type: 'loader.booted',
      nonce: 'loader-nonce',
    }]);
    messageListener?.({
      source: {},
      data: {
        source: 'openchamber-mcp-broker',
        type: 'loader.init',
        nonce: 'loader-nonce',
        appHtml: '<main>ignored</main>',
      },
    });
    expect(blobs).toHaveLength(0);

    const init = {
      source: 'openchamber-mcp-broker',
      type: 'loader.init',
      nonce: 'loader-nonce',
      appHtml: '<main>Large App</main>',
    };
    messageListener?.({ source: parent, data: init });

    expect(init.appHtml).toBe('');
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.parts).toEqual(['<main>Large App</main>']);
    expect(blobs[0]?.options?.type).toBe('text/html;charset=utf-8');
    expect(messages.at(-1)).toEqual({
      source: 'openchamber-mcp-loader',
      type: 'loader.transitioning',
      nonce: 'loader-nonce',
    });

    messageListener?.({ source: parent, data: {
      ...init,
      appHtml: '<main>second</main>',
    } });
    expect(blobs).toHaveLength(1);
    expect(document).toContain('maxHtml=8388608');
  });

  test('waits for the data Loader document load before announcing the verified handoff', () => {
    const document = createMcpAppLoaderDocument('loading-loader-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const messages: Array<Record<string, unknown>> = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    const parent = {
      postMessage: (message: unknown) => messages.push(message as Record<string, unknown>),
    };
    class BlobMock {
      size: number;

      constructor(parts: unknown[]) {
        this.size = new TextEncoder().encode(parts.join('')).byteLength;
      }
    }

    runInNewContext(document.slice(scriptStart, scriptEnd), {
      parent,
      document: { readyState: 'loading' },
      Blob: BlobMock,
      addEventListener: (
        type: string,
        listener: ((event: { source: unknown; data: unknown }) => void) | (() => void),
      ) => {
        if (type === 'message') {
          messageListener = listener as (event: { source: unknown; data: unknown }) => void;
        }
        if (type === 'load') loadListener = listener as () => void;
      },
    });

    const appHtml = '<main>App</main>';
    const base = {
      source: 'openchamber-mcp-host',
      nonce: 'loading-loader-nonce',
      identity: 'sha256:loading-app',
    };
    const send = (data: Record<string, unknown>) => messageListener?.({ source: parent, data });
    send({
      ...base,
      type: 'loader.begin',
      totalBytes: new TextEncoder().encode(appHtml).byteLength,
      totalUnits: appHtml.length,
      totalChunks: 1,
    });
    send({ ...base, type: 'loader.chunk', index: 0, data: appHtml });
    send({ ...base, type: 'loader.commit' });

    expect(messages.some(message => message.type === 'loader.transitioning')).toBe(false);

    loadListener?.();
    expect(messages.at(-1)).toEqual({
      source: 'openchamber-mcp-loader',
      type: 'loader.transitioning',
      nonce: 'loading-loader-nonce',
      identity: 'sha256:loading-app',
    });
  });

  test('Loader validates begin/chunk/ack/commit and releases malformed transfers', () => {
    const boot = () => {
      const document = createMcpAppLoaderDocument('chunk-loader-nonce');
      const scriptStart = document.indexOf('<script>') + '<script>'.length;
      const scriptEnd = document.lastIndexOf('</script>');
      const messages: Array<Record<string, unknown>> = [];
      const blobs: Array<{ parts: unknown[]; size: number }> = [];
      const scheduled: Array<() => void> = [];
      const replacements: string[] = [];
      let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
      const parent = { postMessage: (message: unknown) => messages.push(message as Record<string, unknown>) };
      class BlobMock {
        parts: unknown[];
        size: number;

        constructor(parts: unknown[]) {
          this.parts = parts;
          this.size = new TextEncoder().encode(parts.join('')).byteLength;
          blobs.push(this);
        }
      }
      runInNewContext(document.slice(scriptStart, scriptEnd), {
        parent,
        document: { readyState: 'complete' },
        Blob: BlobMock,
        location: { replace: (url: string) => replacements.push(url) },
        setTimeout: (callback: () => void) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        clearTimeout: () => {},
        addEventListener: (
          type: string,
          listener: (event: { source: unknown; data: unknown }) => void,
        ) => {
          if (type === 'message') messageListener = listener;
        },
      });
      return {
        parent,
        messages,
        blobs,
        scheduled,
        replacements,
        send: (data: Record<string, unknown>) => messageListener?.({ source: parent, data }),
      };
    };

    const appHtml = 'x'.repeat(256 * 1024 + 3);
    const transfer = boot();
    const base = {
      source: 'openchamber-mcp-host',
      nonce: 'chunk-loader-nonce',
      identity: 'sha256:chunk-app',
    };
    transfer.send({
      ...base,
      type: 'loader.begin',
      totalBytes: new TextEncoder().encode(appHtml).byteLength,
      totalUnits: appHtml.length,
      totalChunks: 2,
    });
    expect({
      type: transfer.messages.at(-1)?.type,
      identity: transfer.messages.at(-1)?.identity,
      nextIndex: transfer.messages.at(-1)?.nextIndex,
    }).toEqual({
      type: 'loader.begin-ack',
      identity: 'sha256:chunk-app',
      nextIndex: 0,
    });
    const firstChunk = appHtml.slice(0, 256 * 1024);
    transfer.send({ ...base, type: 'loader.chunk', index: 0, data: firstChunk });
    expect({
      type: transfer.messages.at(-1)?.type,
      index: transfer.messages.at(-1)?.index,
    }).toEqual({ type: 'loader.chunk-ack', index: 0 });

    // A duplicate block is acknowledged without retaining a second copy.
    transfer.send({ ...base, type: 'loader.chunk', index: 0, data: firstChunk });
    expect({
      type: transfer.messages.at(-1)?.type,
      index: transfer.messages.at(-1)?.index,
    }).toEqual({ type: 'loader.chunk-ack', index: 0 });
    transfer.send({ ...base, type: 'loader.chunk', index: 1, data: appHtml.slice(256 * 1024) });
    transfer.send({ ...base, type: 'loader.commit' });
    expect(transfer.blobs).toHaveLength(1);
    expect(transfer.blobs[0]?.parts).toEqual([appHtml]);
    expect(transfer.messages.at(-1)?.type).toBe('loader.transitioning');
    expect(transfer.scheduled).toHaveLength(0);
    expect(transfer.replacements).toHaveLength(0);
    expect(transfer.scheduled).toHaveLength(0);

    const outOfOrder = boot();
    outOfOrder.send({
      ...base,
      type: 'loader.begin',
      totalBytes: new TextEncoder().encode(appHtml).byteLength,
      totalUnits: appHtml.length,
      totalChunks: 2,
    });
    outOfOrder.send({ ...base, type: 'loader.chunk', index: 1, data: appHtml.slice(256 * 1024) });
    expect({
      type: outOfOrder.messages.at(-1)?.type,
      reason: outOfOrder.messages.at(-1)?.reason,
    }).toEqual({
      type: 'loader.invalidated',
      reason: 'out-of-order-chunk',
    });
    expect(outOfOrder.blobs).toHaveLength(0);

    const oversized = boot();
    oversized.send({
      ...base,
      type: 'loader.begin',
      totalBytes: 8 * 1024 * 1024 * 4 + 1,
      totalUnits: 8 * 1024 * 1024,
      totalChunks: 32,
    });
    expect({
      type: oversized.messages.at(-1)?.type,
      reason: oversized.messages.at(-1)?.reason,
    }).toEqual({
      type: 'loader.invalidated',
      reason: 'invalid-transfer-begin',
    });
    expect(oversized.blobs).toHaveLength(0);
  });

  test('direct Host controller transfers bounded chunks and requires App load plus AppBridge init', () => {
    const createTimers = () => {
      const timers = new Map<number, () => void>();
      const delays = new Map<number, number>();
      let nextId = 0;
      return {
        timers,
        delays,
        schedule: (callback: () => void, delay = 0) => {
          nextId += 1;
          timers.set(nextId, callback);
          delays.set(nextId, delay);
          return nextId;
        },
        cancel: (handle: unknown) => {
          timers.delete(handle as number);
          delays.delete(handle as number);
        },
        runNext: () => {
          const next = timers.entries().next().value as [number, () => void] | undefined;
          if (!next) return false;
          timers.delete(next[0]);
          delays.delete(next[0]);
          next[1]();
          return true;
        },
      };
    };

    const sent: Array<Record<string, unknown>> = [];
    const target = {
      postMessage: (message: unknown) => sent.push(message as Record<string, unknown>),
    };
    const timers = createTimers();
    const ready: string[] = [];
    const mounted: string[] = [];
    const invalidated: string[] = [];
    const diagnostics: Array<{ phase: string; detail: string; nextIndex: number; totalChunks: number }> = [];
    const appHtml = `<main>${'x'.repeat(256 * 1024 + 3)}😀</main>`;
    const controller = createMcpAppLoaderHostController({
      target,
      channelNonce: 'direct-loader-nonce',
      appIdentity: 'sha256:direct-loader-app',
      appHtml,
      hostOrigin: 'https://openchamber.local',
      mountAppDocument: (html) => mounted.push(html),
      onAppReady: () => ready.push('ready'),
      onInvalidated: (reason) => invalidated.push(reason),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      schedule: timers.schedule,
      cancel: timers.cancel,
      retryDelay: 1,
      retryMax: 4,
    });

    controller.start();
    expect(sent).toEqual([{
      source: 'openchamber-mcp-host',
      type: 'loader.begin',
      nonce: 'direct-loader-nonce',
      identity: 'sha256:direct-loader-app',
      totalBytes: new Blob([appHtml]).size,
      totalUnits: appHtml.length,
      totalChunks: 2,
    }]);
    expect('appHtml' in (sent[0] ?? {})).toBe(false);
    expect(timers.timers.size).toBe(1);

    // Wrong source, origin, and nonce cannot acknowledge the transfer.
    const beginAck = {
      source: 'openchamber-mcp-loader',
      type: 'loader.begin-ack',
      nonce: 'direct-loader-nonce',
      identity: 'sha256:direct-loader-app',
      nextIndex: 0,
    };
    controller.handleMessage({ source: {}, origin: 'null', data: beginAck });
    controller.handleMessage({ source: target, origin: 'https://attacker.example', data: beginAck });
    controller.handleMessage({
      source: target,
      origin: 'null',
      data: { ...beginAck, nonce: 'wrong-nonce' },
    });
    expect(timers.runNext()).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);

    controller.handleMessage({ source: target, origin: 'null', data: beginAck });
    expect(sent.at(-1)?.type).toBe('loader.chunk');
    expect((sent.at(-1)?.data as string).length).toBe(256 * 1024);
    expect(sent.at(-1)?.data).not.toBe(appHtml);

    // A lost ACK resends only the current chunk, never the complete App.
    expect(timers.runNext()).toBe(true);
    expect(sent.at(-1)).toEqual(sent.at(-2));
    const chunkAck = (index: number) => ({
      source: 'openchamber-mcp-loader',
      type: 'loader.chunk-ack',
      nonce: 'direct-loader-nonce',
      identity: 'sha256:direct-loader-app',
      index,
    });
    controller.handleMessage({ source: target, origin: 'null', data: chunkAck(0) });
    expect(sent.at(-1)?.type).toBe('loader.chunk');
    expect(sent.at(-1)?.index).toBe(1);
    expect((sent.at(-1)?.data as string).length).toBe(appHtml.length - 256 * 1024);

    // A duplicate stale ACK cannot skip the second chunk.
    const beforeDuplicateAck = sent.length;
    controller.handleMessage({ source: target, origin: 'null', data: chunkAck(0) });
    expect(sent).toHaveLength(beforeDuplicateAck);
    controller.handleMessage({ source: target, origin: 'null', data: chunkAck(1) });
    expect({
      source: sent.at(-1)?.source,
      type: sent.at(-1)?.type,
      identity: sent.at(-1)?.identity,
    }).toEqual({
      source: 'openchamber-mcp-host',
      type: 'loader.commit',
      identity: 'sha256:direct-loader-app',
    });

    controller.handleMessage({
      source: target,
      origin: 'null',
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.transitioning',
        nonce: 'direct-loader-nonce',
        identity: 'sha256:direct-loader-app',
      },
    });
    expect(sent.at(-1)?.type).toBe('loader.commit');
    expect(mounted).toEqual([appHtml]);
    expect(timers.timers.size).toBe(1);
    expect([...timers.delays.values()]).toEqual([45_000]);

    // Only the source-authenticated Loader transition lets the Host replace
    // the sandbox frame with the App document. A load event alone cannot make
    // a blocked or empty navigation ready; AppBridge must initialize as well.
    controller.handleLoad();
    expect(ready).toHaveLength(0);
    expect(diagnostics.at(-1)?.detail).toBe('app-document-loaded');
    // The superseded Loader load can race the srcdoc load. Duplicate load
    // bookkeeping is harmless until AppBridge identifies the final App.
    controller.handleLoad();
    expect(ready).toHaveLength(0);
    expect(invalidated).toHaveLength(0);
    expect(diagnostics.at(-1)?.detail).toBe('duplicate-load-before-app-initialized');
    controller.handleAppInitialized();
    expect(ready).toEqual(['ready']);
    expect(invalidated).toHaveLength(0);
    expect(diagnostics.at(-1)).toEqual({
      phase: 'ready',
      detail: 'app-ready',
      nextIndex: 2,
      totalChunks: 2,
    });
    // Any subsequent navigation replaces the authorized srcdoc App and revokes
    // the binding rather than silently granting authority to the new page.
    controller.handleLoad();
    expect(invalidated).toEqual(['navigation']);

    // The inverse ordering is valid too: AppBridge initialization can race the
    // load event, but neither signal grants authority on its own.
    const initializedFirstTarget = { postMessage: () => {} };
    const initializedFirstReady: string[] = [];
    const initializedFirst = createMcpAppLoaderHostController({
      target: initializedFirstTarget,
      channelNonce: 'initialized-first-nonce',
      appIdentity: 'sha256:initialized-first',
      appHtml: '<main>race</main>',
      hostOrigin: 'https://openchamber.local',
      mountAppDocument: () => {},
      onAppReady: () => initializedFirstReady.push('ready'),
      onInvalidated: () => {},
      schedule: createTimers().schedule,
      cancel: () => {},
    });
    const initializedFirstMessage = (type: string, extra: Record<string, unknown> = {}) => ({
      source: initializedFirstTarget,
      origin: 'null',
      data: {
        source: 'openchamber-mcp-loader',
        type,
        nonce: 'initialized-first-nonce',
        identity: 'sha256:initialized-first',
        ...extra,
      },
    });
    initializedFirst.start();
    initializedFirst.handleMessage(initializedFirstMessage('loader.begin-ack', { nextIndex: 0 }));
    initializedFirst.handleMessage(initializedFirstMessage('loader.chunk-ack', { index: 0 }));
    initializedFirst.handleMessage(initializedFirstMessage('loader.transitioning'));
    initializedFirst.handleAppInitialized();
    expect(initializedFirstReady).toHaveLength(0);
    initializedFirst.handleLoad();
    expect(initializedFirstReady).toEqual(['ready']);

    const timeoutTimers = createTimers();
    const timeoutReasons: string[] = [];
    const timeoutController = createMcpAppLoaderHostController({
      target: { postMessage: () => {} },
      channelNonce: 'direct-timeout-nonce',
      appIdentity: 'sha256:timeout-app',
      appHtml: '<main>No Loader ACK</main>',
      hostOrigin: 'https://openchamber.local',
      mountAppDocument: () => {},
      onAppReady: () => {},
      onInvalidated: (reason) => timeoutReasons.push(reason),
      schedule: timeoutTimers.schedule,
      cancel: timeoutTimers.cancel,
      retryDelay: 1,
      retryMax: 2,
    });
    timeoutController.start();
    expect(timeoutTimers.runNext()).toBe(true);
    expect(timeoutTimers.runNext()).toBe(true);
    expect(timeoutReasons).toEqual(['loader-begin-timeout']);
  });

  test('resends pending App markup when the Loader boots after the first init was lost', () => {
    const document = createMcpAppBrokerDocument('loader-ack-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const script = document.slice(scriptStart, scriptEnd);
    const parentMessages: unknown[] = [];
    const appMessages: unknown[] = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    const parent = {
      postMessage: (message: unknown) => parentMessages.push(message),
    };
    const appWindow = {
      postMessage: (message: unknown) => appMessages.push(message),
    };
    const app = {
      contentWindow: appWindow,
      src: '',
      setAttribute: () => {},
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'load') loadListener = listener;
      },
      remove: () => {},
    };

    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      },
      document: {
        createElement: () => app,
        body: { append: () => {} },
      },
    });

    const appHtml = '<main>Large MCP App</main>';
    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'loader-ack-nonce',
        appIdentity: 'sha256:loader-ack-app',
        appHtml,
      },
    });

    // The first init can race ahead of the Loader's inline message listener.
    // Model that lost delivery by observing it without acknowledging it.
    loadListener?.();
    expect(appMessages).toEqual([{
      source: 'openchamber-mcp-broker',
      type: 'loader.init',
      nonce: 'loader-ack-nonce',
      appHtml,
    }]);

    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.booted',
        nonce: 'loader-ack-nonce',
      },
    });
    expect(appMessages).toHaveLength(2);
    expect(appMessages[1]).toEqual(appMessages[0]);

    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.transitioning',
        nonce: 'loader-ack-nonce',
      },
    });
    // Once the Loader acknowledges the Blob transition, raw markup is no
    // longer retained and duplicate boot signals cannot trigger another init.
    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.booted',
        nonce: 'loader-ack-nonce',
      },
    });
    expect(appMessages).toHaveLength(2);

    loadListener?.();
    expect(parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'loader-ack-nonce',
    });
  });

  test('retries when Loader boot is dropped and fails closed after a bounded timeout', () => {
    const createHarness = (nonce: string) => {
      const document = createMcpAppBrokerDocument(nonce);
      const scriptStart = document.indexOf('<script>') + '<script>'.length;
      const scriptEnd = document.lastIndexOf('</script>');
      const script = document.slice(scriptStart, scriptEnd);
      const parentMessages: unknown[] = [];
      const appMessages: unknown[] = [];
      const timers = new Map<number, () => void>();
      let nextTimerId = 0;
      let removeCount = 0;
      let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
      let loadListener: (() => void) | undefined;
      const parent = {
        postMessage: (message: unknown) => parentMessages.push(message),
      };
      const appWindow = {
        postMessage: (message: unknown) => appMessages.push(message),
      };
      const app = {
        contentWindow: appWindow,
        src: '',
        setAttribute: () => {},
        addEventListener: (type: string, listener: () => void) => {
          if (type === 'load') loadListener = listener;
        },
        remove: () => {
          removeCount += 1;
        },
      };

      runInNewContext(script, {
        parent,
        setTimeout: (callback: () => void) => {
          nextTimerId += 1;
          timers.set(nextTimerId, callback);
          return nextTimerId;
        },
        clearTimeout: (timerId: number) => {
          timers.delete(timerId);
        },
        addEventListener: (
          type: string,
          listener: (event: { source: unknown; data: unknown }) => void,
        ) => {
          if (type === 'message') messageListener = listener;
        },
        document: {
          createElement: () => app,
          body: { append: () => {} },
        },
      });

      const runNextTimer = () => {
        const next = timers.entries().next().value as [number, () => void] | undefined;
        if (!next) return false;
        timers.delete(next[0]);
        next[1]();
        return true;
      };

      return {
        appMessages,
        appWindow,
        load: () => loadListener?.(),
        parent,
        parentMessages,
        removeCount: () => removeCount,
        runNextTimer,
        timers,
        dispatch: (source: unknown, data: unknown) => messageListener?.({ source, data }),
      };
    };

    const recovered = createHarness('timer-retry-nonce');
    const appHtml = '<main>Retry after dropped boot</main>';
    recovered.dispatch(recovered.parent, {
      source: 'openchamber-mcp-host',
      type: 'host.init',
      nonce: 'timer-retry-nonce',
      appIdentity: 'sha256:timer-retry-app',
      appHtml,
    });
    recovered.load();
    expect(recovered.appMessages).toHaveLength(1);
    expect(recovered.timers.size).toBe(1);

    // Neither the first loader.init nor loader.booted was delivered. The
    // bounded timer retries the still-pending markup independently.
    expect(recovered.runNextTimer()).toBe(true);
    expect(recovered.appMessages).toHaveLength(2);
    recovered.dispatch(recovered.appWindow, {
      source: 'openchamber-mcp-loader',
      type: 'loader.transitioning',
      nonce: 'timer-retry-nonce',
    });
    expect(recovered.timers.size).toBe(0);
    recovered.load();
    expect(recovered.parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'timer-retry-nonce',
    });

    const missedInitialLoad = createHarness('missed-load-nonce');
    missedInitialLoad.dispatch(missedInitialLoad.parent, {
      source: 'openchamber-mcp-host',
      type: 'host.init',
      nonce: 'missed-load-nonce',
      appIdentity: 'sha256:missed-load-app',
      appHtml: '<main>Initial load event omitted</main>',
    });
    expect(missedInitialLoad.appMessages).toHaveLength(0);
    // Chromium may already have a complete nested data: document without
    // delivering its first load event to the opaque Broker. The post-append
    // readiness fallback must start initialization without trusting that event.
    expect(missedInitialLoad.runNextTimer()).toBe(true);
    expect(missedInitialLoad.appMessages).toHaveLength(1);
    missedInitialLoad.dispatch(missedInitialLoad.appWindow, {
      source: 'openchamber-mcp-loader',
      type: 'loader.transitioning',
      nonce: 'missed-load-nonce',
    });
    // The first observed load can now be the Blob App transition rather than
    // the omitted Loader load, and must still complete readiness safely.
    missedInitialLoad.load();
    expect(missedInitialLoad.parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'missed-load-nonce',
    });

    const timedOut = createHarness('timer-timeout-nonce');
    timedOut.dispatch(timedOut.parent, {
      source: 'openchamber-mcp-host',
      type: 'host.init',
      nonce: 'timer-timeout-nonce',
      appIdentity: 'sha256:timer-timeout-app',
      appHtml: '<main>Never acknowledges</main>',
    });
    timedOut.load();
    for (let index = 0; index < 20; index += 1) {
      if (!timedOut.runNextTimer()) break;
    }
    expect(timedOut.appMessages).toHaveLength(16);
    expect(timedOut.removeCount()).toBe(1);
    expect(timedOut.timers.size).toBe(0);
    expect(timedOut.parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.invalidated',
      reason: 'loader-init-timeout',
      nonce: 'timer-timeout-nonce',
    });
  });

  test('retains pending App markup when Loader boot arrives before iframe load bookkeeping', () => {
    const document = createMcpAppBrokerDocument('early-boot-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const script = document.slice(scriptStart, scriptEnd);
    const parentMessages: unknown[] = [];
    const appMessages: unknown[] = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    const parent = {
      postMessage: (message: unknown) => parentMessages.push(message),
    };
    const appWindow = {
      postMessage: (message: unknown) => appMessages.push(message),
    };
    const app = {
      contentWindow: appWindow,
      src: '',
      setAttribute: () => {},
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'load') loadListener = listener;
      },
      remove: () => {},
    };

    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      },
      document: {
        createElement: () => app,
        body: { append: () => {} },
      },
    });

    const appHtml = '<main>Early Loader boot</main>';
    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'early-boot-nonce',
        appIdentity: 'sha256:early-boot-app',
        appHtml,
      },
    });
    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.booted',
        nonce: 'early-boot-nonce',
      },
    });
    expect(appMessages).toHaveLength(0);

    loadListener?.();
    expect(appMessages).toEqual([{
      source: 'openchamber-mcp-broker',
      type: 'loader.init',
      nonce: 'early-boot-nonce',
      appHtml,
    }]);
    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.transitioning',
        nonce: 'early-boot-nonce',
      },
    });
    loadListener?.();
    expect(parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'early-boot-nonce',
    });
  });

  test('mounts and becomes ready when the first Loader init succeeds without a boot signal', () => {
    const document = createMcpAppBrokerDocument('expected-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const script = document.slice(scriptStart, scriptEnd);
    const lifecycle: string[] = [];
    const messages: Array<{
      source: string;
      type: string;
      nonce: string;
      reason?: string;
    }> = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    let appendCount = 0;
    let removeCount = 0;
    const appMessages: unknown[] = [];
    const parent = {
      postMessage: (message: { source: string; type: string; nonce: string }) => {
        lifecycle.push(message.type);
        messages.push(message);
      },
    };
    const appWindow = { postMessage: (message: unknown) => appMessages.push(message) };
    const app = {
      contentWindow: appWindow,
      src: '',
      setAttribute: () => {},
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'load') loadListener = listener;
      },
      remove: () => {
        removeCount += 1;
      },
    };

    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        lifecycle.push(`${type}.registered`);
        // Browser-accurate: only the window `message` listener receives
        // postMessage events. Diagnostic probe listeners must not clobber it.
        if (type === 'message') messageListener = listener;
      },
      document: {
        createElement: () => app,
        body: {
          append: () => {
            appendCount += 1;
          },
        },
      },
    });

    // The trusted bootstrap registers the message listener first, then the
    // sandbox proxy announces boot (broker.booted + sandbox-proxy-ready whose
    // type is undefined), then the P0-A diagnostic probes are registered.
    expect(lifecycle).toEqual([
      'message.registered',
      'broker.booted',
      undefined,
      'securitypolicyviolation.registered',
      'error.registered',
      'unhandledrejection.registered',
    ]);
    expect(messages[0]).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.booted',
      nonce: 'expected-nonce',
    });
    expect(appendCount).toBe(0);

    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'wrong-nonce',
        appIdentity: 'wrong-nonce-app',
        appHtml: '<main>MCP App</main>',
      },
    });
    expect(appendCount).toBe(0);

    const appHtml = '<main>MCP App</main>';
    const createInit = () => ({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'expected-nonce',
        appIdentity: 'sha256:mcp-app',
        appHtml,
      },
    });
    messageListener?.(createInit());
    messageListener?.(createInit());
    expect(appendCount).toBe(1);
    expect(app.src.startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);

    // The first iframe load is the small Loader data document, not the App.
    loadListener?.();
    // The trusted bootstrap registers the message listener first, then the
    // sandbox proxy announces boot (broker.booted + sandbox-proxy-ready whose
    // type is undefined), then the P0-A diagnostic probes are registered.
    expect(lifecycle).toEqual([
      'message.registered',
      'broker.booted',
      undefined,
      'securitypolicyviolation.registered',
      'error.registered',
      'unhandledrejection.registered',
    ]);
    // Electron can deliver the Loader's early boot signal before the Broker's
    // load bookkeeping sees it (or omit it during a process handoff). The
    // first load is authoritative: initialization must not deadlock on booted.
    expect(appMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'loader.init',
      nonce: 'expected-nonce',
      appHtml,
    });
    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.transitioning',
        nonce: 'expected-nonce',
      },
    });
    // The second load is the authorized Blob transition and makes the App
    // ready. Any subsequent iframe navigation is revoked below.
    loadListener?.();
    expect(messages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'expected-nonce',
    });
    expect(lifecycle).toEqual([
      'message.registered',
      'broker.booted',
      undefined,
      'securitypolicyviolation.registered',
      'error.registered',
      'unhandledrejection.registered',
      'broker.ready',
    ]);

    // React effects can resend host.init after a benign Host rerender (for
    // example after a Workbench layout or model-context update). That signal
    // must reuse the already mounted App; only a second load event from the
    // privileged child is treated as an App navigation below.
    messageListener?.(createInit());
    expect(appendCount).toBe(1);
    expect(messages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.ready',
      nonce: 'expected-nonce',
    });
    expect(lifecycle).toEqual([
      'message.registered',
      'broker.booted',
      undefined,
      'securitypolicyviolation.registered',
      'error.registered',
      'unhandledrejection.registered',
      'broker.ready',
      'broker.ready',
    ]);

    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'expected-nonce',
        appIdentity: 'sha256:changed-app',
        appHtml: '<main>Changed App</main>',
      },
    });
    expect(removeCount).toBe(1);
    expect(messages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.invalidated',
      reason: 'resource-change',
      nonce: 'expected-nonce',
    });
  });

  test('includes declared resource domains in Broker CSP for the official Excalidraw esm.sh regression', () => {
    // Excalidraw resource metadata: _meta.ui.csp.resourceDomains=["https://esm.sh"]
    // and connectDomains=["https://esm.sh"]. The Broker must permit esm.sh so
    // Chromium inheritance/intersection into about:srcdoc does not block
    // Excalidraw JS/CSS/fonts.
    const brokerCsp = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['https://esm.sh'],
    });

    // Resource domains appear in all relevant fetch directives.
    expect(brokerCsp).toContain('script-src \'unsafe-inline\' https://esm.sh');
    expect(brokerCsp).toContain('style-src \'unsafe-inline\' https://esm.sh');
    expect(brokerCsp).toContain('img-src data: blob: https://esm.sh');
    expect(brokerCsp).toContain('font-src data: blob: https://esm.sh');
    expect(brokerCsp).toContain('media-src data: blob: https://esm.sh');
    // connectDomains appear in connect-src.
    expect(brokerCsp).toContain('connect-src https://esm.sh');
    // No wildcard anywhere.
    expect(brokerCsp).not.toContain('https://*');
    expect(brokerCsp).not.toContain('*');
    // data:/blob: schemes are preserved for offline assets.
    expect(brokerCsp).toContain('data:');
    expect(brokerCsp).toContain('blob:');
    // Strict base defaults remain.
    expect(brokerCsp).toContain(`default-src 'none'`);
    // No explicit baseUriDomains → base-uri 'self' (mirrors App document policy).
    expect(brokerCsp).toContain(`base-uri 'self'`);
    expect(brokerCsp).toContain(`form-action 'none'`);
    expect(brokerCsp).toContain(`object-src 'none'`);

    // The Broker document embeds the policy via a CSP meta tag.
    const document = createMcpAppBrokerDocument('excalidraw-nonce', brokerCsp);
    const outerPolicy = document.match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/,
    )?.[1];
    expect(outerPolicy).toContain('https://esm.sh');
    expect(outerPolicy).toContain('data: blob:');
    // No esm.sh hardcode in the fallback path.
    const fallbackDocument = createMcpAppBrokerDocument('fallback-nonce');
    expect(fallbackDocument).not.toContain('esm.sh');
  });

  test('falls back to strict offline Broker CSP when resource metadata is missing or invalid', () => {
    // No metadata → strict defaults, no network access.
    const undefinedCsp = buildMcpAppBrokerCsp(undefined);
    expect(undefinedCsp).toContain(`default-src 'none'`);
    expect(undefinedCsp).toContain(`script-src 'unsafe-inline'`);
    expect(undefinedCsp).toContain(`style-src 'unsafe-inline'`);
    expect(undefinedCsp).toContain('img-src data: blob:');
    expect(undefinedCsp).toContain('font-src data: blob:');
    expect(undefinedCsp).toContain('media-src data: blob:');
    expect(undefinedCsp).toContain(`connect-src 'none'`);
    expect(undefinedCsp).toContain('frame-src data: blob:');
    expect(undefinedCsp).toContain(`base-uri 'none'`);
    expect(undefinedCsp).not.toContain('https://');
    expect(undefinedCsp).not.toContain('http://');

    // Empty CSP object → same strict defaults.
    const emptyCsp = buildMcpAppBrokerCsp({});
    expect(emptyCsp).toBe(undefinedCsp);

    // Only resourceDomains declared, no connectDomains.
    const resourceOnly = buildMcpAppBrokerCsp({
      resourceDomains: ['https://cdn.example.com'],
    });
    expect(resourceOnly).toContain('https://cdn.example.com');
    expect(resourceOnly).toContain(`connect-src 'none'`);
    // connect-src stays 'none' when no connectDomains are declared.
    const resourceOnlyConnect = resourceOnly.match(/connect-src ([^;]+)/)?.[1] ?? '';
    expect(resourceOnlyConnect).toBe("'none'");
    // frame-src must never combine 'none' with other sources. When no
    // frameDomains are declared, frame-src stays data: blob: only.
    expect(resourceOnly).toContain('frame-src data: blob:');
    const resourceOnlyFrame = resourceOnly.match(/frame-src ([^;]+)/)?.[1] ?? '';
    expect(resourceOnlyFrame).not.toContain("'none'");
    expect(resourceOnlyFrame).toBe('data: blob:');

    // connectDomains with wss:// are normalized into connect-src only,
    // never leaked into fetch directives like script-src or style-src.
    const wsCsp = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['wss://sync.example.com'],
    });
    expect(wsCsp).toContain('connect-src wss://sync.example.com');
    expect(wsCsp).toContain('script-src \'unsafe-inline\' https://esm.sh');
    // wss:// must not appear in script-src.
    const wsScriptDirective = wsCsp.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(wsScriptDirective).not.toContain('wss://');

    // frameDomains are scoped to frame-src only. Never combine 'none'
    // with declared sources.
    const frameCsp = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
      frameDomains: ['https://frames.example.com'],
    });
    expect(frameCsp).toContain('frame-src data: blob: https://frames.example.com');
    // frameDomains must not appear in script-src.
    const frameScriptDirective = frameCsp.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(frameScriptDirective).not.toContain('frames.example.com');
    // Verify no stray 'none' in frame-src when domains are present.
    const frameDirective = frameCsp.match(/frame-src ([^;]+)/)?.[1] ?? '';
    expect(frameDirective).not.toContain("'none'");

    // Malformed domains are rejected by normalizeMcpAppCspSource during
    // validation and never reach the Broker. The function itself filters them.
    expect(buildMcpAppBrokerCsp({
      resourceDomains: ['https://*.example.com:99999'],
    })).toBe(undefinedCsp);
    expect(buildMcpAppBrokerCsp({
      resourceDomains: ['javascript:alert(1)'],
    })).toBe(undefinedCsp);
  });

  test('never combines frame-src none with other sources in Broker CSP', () => {
    // frameDomains declared alone — no 'none' combined with data: blob:.
    const frameOnly = buildMcpAppBrokerCsp({
      frameDomains: ['https://frames.example.com'],
    });
    expect(frameOnly).toContain('frame-src data: blob: https://frames.example.com');
    const frameOnlyDirective = frameOnly.match(/frame-src ([^;]+)/)?.[1] ?? '';
    expect(frameOnlyDirective).not.toContain("'none'");
    // Other fetch directives stay strict.
    expect(frameOnly).toContain(`script-src 'unsafe-inline'`);
    expect(frameOnly).toContain(`connect-src 'none'`);
    // 'https://frames.example.com' only in frame-src, not in script-src.
    const scriptOnly = frameOnly.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(scriptOnly).not.toContain('frames.example.com');

    // Multiple domains declared: esm.sh for resources, frames.example.com for frames.
    const mixed = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['https://esm.sh'],
      frameDomains: ['https://frames.example.com'],
    });
    expect(mixed).toContain('frame-src data: blob: https://frames.example.com');
    expect(mixed).toContain('script-src \'unsafe-inline\' https://esm.sh');
    expect(mixed).toContain('connect-src https://esm.sh');
    const mixedFrame = mixed.match(/frame-src ([^;]+)/)?.[1] ?? '';
    expect(mixedFrame).not.toContain("'none'");
    // esm.sh is NOT in frame-src; frames.example.com is NOT in script-src.
    expect(mixedFrame).not.toContain('esm.sh');
    const mixedScript = mixed.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(mixedScript).not.toContain('frames.example.com');

    // When no frameDomains declared but resourceDomains exist, frame-src stays
    // data: blob: with no 'none'.
    const noFrames = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
    });
    const noFramesDirective = noFrames.match(/frame-src ([^;]+)/)?.[1] ?? '';
    expect(noFramesDirective).toBe('data: blob:');
    expect(noFramesDirective).not.toContain("'none'");
  });

  test('mirrors declared baseUriDomains in Broker CSP and falls back to self when absent', () => {
    // Declared baseUriDomains appear only in base-uri.
    const baseOnly = buildMcpAppBrokerCsp({
      baseUriDomains: ['https://cdn.example.com'],
    });
    expect(baseOnly).toContain('base-uri https://cdn.example.com');
    expect(baseOnly).toContain(`script-src 'unsafe-inline'`);
    expect(baseOnly).toContain(`connect-src 'none'`);
    // baseUriDomains never leak into other directives.
    const baseOnlyScript = baseOnly.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(baseOnlyScript).not.toContain('cdn.example.com');

    // All-invalid baseUriDomains → strict defaults (base-uri 'none').
    const invalidBase = buildMcpAppBrokerCsp({
      baseUriDomains: ['javascript:alert(1)'],
    });
    expect(invalidBase).toContain(`base-uri 'none'`);
    expect(invalidBase).toContain(`connect-src 'none'`);
    expect(invalidBase).not.toContain('javascript:');

    // No explicit baseUriDomains but other domains present → base-uri 'self'.
    const noBase = buildMcpAppBrokerCsp({
      resourceDomains: ['https://esm.sh'],
    });
    expect(noBase).toContain(`base-uri 'self'`);

    // Bounded wildcard baseUriDomains survive normalization.
    const wildcardBase = buildMcpAppBrokerCsp({
      baseUriDomains: ['https://*.example.com'],
    });
    expect(wildcardBase).toContain('base-uri https://*.example.com');

    // Bare * and unbounded wildcard are rejected.
    const bareStar = buildMcpAppBrokerCsp({
      baseUriDomains: ['*'],
    });
    expect(bareStar).toContain(`base-uri 'none'`);
  });

  test('App document policy preserves offline data/about schemes from resource metadata', () => {
    const policy = buildMcpAppDocumentPolicy({
      resourceUri: 'ui://openchamber/interop-tldraw-contract-v5.0.2',
      visibility: ['model', 'app'],
      csp: {
        connectDomains: [],
        resourceDomains: ['data:'],
        frameDomains: ['about:'],
      },
    }, {
      html: '<main>tldraw</main>',
      mimeType: 'text/html;profile=mcp-app',
      sha256: 'sha256:tldraw',
      server: 'interop-tldraw-2026',
      resourceUri: 'ui://openchamber/interop-tldraw-contract-v5.0.2',
      meta: {
        csp: {
          connectDomains: [],
          resourceDomains: ['data:'],
          frameDomains: ['about:'],
        },
      },
    });
    expect(/img-src 'self' data:(?: data:)? blob:/.test(policy)).toBe(true);
    expect(/font-src 'self' data:(?: data:)? blob:/.test(policy)).toBe(true);
    expect(policy).toContain(`frame-src about:`);
    expect(policy).toContain(`connect-src 'none'`);
    expect(policy).not.toContain('https://');
  });

  test('revokes RPC authority after an unexpected third load of the privileged App iframe', () => {
    const document = createMcpAppBrokerDocument('navigation-nonce');
    const scriptStart = document.indexOf('<script>') + '<script>'.length;
    const scriptEnd = document.lastIndexOf('</script>');
    const script = document.slice(scriptStart, scriptEnd);
    const parentMessages: unknown[] = [];
    const appMessages: unknown[] = [];
    let messageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    let loadListener: (() => void) | undefined;
    let removeCount = 0;
    const appWindow = {
      postMessage: (message: unknown) => appMessages.push(message),
    };
    const parent = {
      postMessage: (message: unknown) => parentMessages.push(message),
    };
    const app = {
      contentWindow: appWindow,
      setAttribute: () => {},
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'load') loadListener = listener;
      },
      remove: () => {
        removeCount += 1;
      },
    };

    runInNewContext(script, {
      parent,
      ...inertBrokerTimers,
      addEventListener: (
        type: string,
        listener: (event: { source: unknown; data: unknown }) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      },
      document: {
        createElement: () => app,
        body: { append: () => {} },
      },
    });

    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.init',
        nonce: 'navigation-nonce',
        appIdentity: 'sha256:navigation-app',
        appHtml: '<main>Navigation App</main>',
      },
    });
    loadListener?.();
    messageListener?.({
      source: appWindow,
      data: {
        source: 'openchamber-mcp-loader',
        type: 'loader.transitioning',
        nonce: 'navigation-nonce',
      },
    });
    loadListener?.();
    messageListener?.({
      source: parent,
      data: {
        source: 'openchamber-mcp-host',
        type: 'host.listening',
        nonce: 'navigation-nonce',
      },
    });

    const firstRpc = { jsonrpc: '2.0', method: 'ui/initialize', id: 1 };
    messageListener?.({ source: appWindow, data: firstRpc });
    expect(parentMessages.at(-1)).toEqual(firstRpc);
    const appMessageCountBeforeNavigation = appMessages.length;

    loadListener?.();
    expect(removeCount).toBe(1);
    expect(parentMessages.at(-1)).toEqual({
      source: 'openchamber-mcp-broker',
      type: 'broker.invalidated',
      reason: 'navigation',
      nonce: 'navigation-nonce',
    });

    const messageCountAfterNavigation = parentMessages.length;
    messageListener?.({
      source: appWindow,
      data: { jsonrpc: '2.0', method: 'tools/call', id: 2 },
    });
    expect(parentMessages).toHaveLength(messageCountAfterNavigation);

    messageListener?.({
      source: parent,
      data: { jsonrpc: '2.0', result: {}, id: 3 },
    });
    expect(appMessages).toHaveLength(appMessageCountBeforeNavigation);
  });

  test('keeps resource permissions closed while permitting only local export frames', () => {
    expect(resolveMcpAppIframeAllowAttribute({
      camera: {},
      microphone: {},
      geolocation: {},
      clipboardWrite: {},
    })).toBe(undefined);

    const document = createMcpAppBrokerDocument('permissions-nonce');
    expect(document).not.toContain('setAttribute("allow"');
    expect(buildMcpAppSandboxFrameSources([])).toEqual(["'none'"]);
    expect(buildMcpAppSandboxFrameSources([
      'https://frames.example.com',
      'data:',
    ])).toEqual(['https://frames.example.com', 'data:']);
  });

  test('negotiates fullscreen while keeping unsupported pip requests in the current mode', () => {
    const fullscreen = buildMcpAppDisplayContext({
      currentMode: 'inline',
      requestedMode: 'fullscreen',
      theme: 'dark',
      locale: 'zh-CN',
      width: 1_440,
      height: 900,
      inlineMaxHeight: 520,
    });
    expect(fullscreen).toEqual({
      mode: 'fullscreen',
      hostContext: {
        theme: 'dark',
        locale: 'zh-CN',
        displayMode: 'fullscreen',
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: 1_440, height: 900 },
      },
    });

    const unsupported = buildMcpAppDisplayContext({
      currentMode: 'fullscreen',
      requestedMode: 'pip',
      theme: 'dark',
      locale: 'zh-CN',
      width: 1_440,
      height: 900,
      inlineMaxHeight: 520,
    });
    expect(unsupported.mode).toBe('fullscreen');
    expect(unsupported.hostContext.displayMode).toBe('fullscreen');
  });

  test('intersects Host display modes with modes declared by the initialized App', () => {
    expect(resolveMcpAppDisplayMode('inline', 'fullscreen', undefined)).toBe('inline');
    expect(resolveMcpAppDisplayMode('inline', 'fullscreen', {
      availableDisplayModes: ['inline'],
    })).toBe('inline');
    expect(resolveMcpAppDisplayMode('inline', 'fullscreen', {
      availableDisplayModes: ['inline', 'fullscreen'],
    })).toBe('fullscreen');
    expect(resolveMcpAppDisplayMode('fullscreen', 'pip', {
      availableDisplayModes: ['fullscreen', 'pip'],
    })).toBe('fullscreen');
    expect(resolveMcpAppDisplayMode('fullscreen', 'inline', {
      availableDisplayModes: ['fullscreen'],
    })).toBe('fullscreen');
  });

  test('returns inline dimensions when the App exits fullscreen', () => {
    const inline = buildMcpAppDisplayContext({
      currentMode: 'fullscreen',
      requestedMode: 'inline',
      theme: 'light',
      locale: 'en',
      width: 860,
      height: 520,
      inlineMaxHeight: 520,
    });

    expect(inline.mode).toBe('inline');
    expect(inline.hostContext.availableDisplayModes).toEqual(['inline', 'fullscreen']);
    expect(inline.hostContext.containerDimensions).toEqual({ width: 860, maxHeight: 520 });
  });

  test('uses viewport geometry only provisionally, then reports the fullscreen iframe content box', () => {
    expect(resolveMcpAppHostGeometry({
      mode: 'fullscreen',
      frameWidth: 1_360,
      frameHeight: 824,
      viewportWidth: 1_440,
      viewportHeight: 900,
      provisionalFullscreen: true,
    })).toEqual({ width: 1_440, height: 900 });

    expect(resolveMcpAppHostGeometry({
      mode: 'fullscreen',
      frameWidth: 1_360,
      frameHeight: 824,
      viewportWidth: 1_440,
      viewportHeight: 900,
    })).toEqual({ width: 1_360, height: 824 });
  });

  test('fills App Board tiles without retaining the chat inline height', () => {
    expect(buildMcpAppPresentationLayout({
      displayMode: 'inline',
      presentation: 'workbench',
      inlineHeight: 520,
    })).toEqual({
      fillContainer: true,
      iframeHeight: undefined,
    });

    expect(buildMcpAppPresentationLayout({
      displayMode: 'inline',
      presentation: 'inline',
      inlineHeight: 520,
    })).toEqual({
      fillContainer: false,
      iframeHeight: 520,
    });

    expect(MCP_APP_FULLSCREEN_STYLE).toEqual({
      height: '100dvh',
      width: '100vw',
      maxHeight: '100dvh',
      maxWidth: '100vw',
    });

    const fullscreenClasses = buildMcpAppDialogClassName({
      className: 'h-full min-h-0',
      fillContainer: true,
      fullscreen: true,
    }).split(/\s+/);
    expect(fullscreenClasses).toContain('h-[100dvh]');
    expect(fullscreenClasses).toContain('min-h-[100dvh]');
    expect(fullscreenClasses).not.toContain('h-full');
    expect(fullscreenClasses).not.toContain('min-h-0');
  });
});

describe('MCP App model context persistence', () => {
  test('keeps the verified App document lifecycle stable across result-only envelope rehydration', () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw-2026',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw-2026_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas',
        meta: {
          resourceUri: 'ui://tldraw/canvas',
          visibility: ['model', 'app'],
          csp: {
            connectDomains: ['http://127.0.0.1:39512'],
            resourceDomains: [],
          },
        },
      },
    });
    expect(binding).not.toBeNull();
    const resource = {
      server: 'tldraw-2026',
      resourceUri: 'ui://tldraw/canvas',
      mimeType: 'text/html;profile=mcp-app',
      html: '<!doctype html><html><body>tldraw</body></html>',
      sha256: 'verified-resource-sha',
    };
    const initialPolicy = buildMcpAppDocumentPolicy(binding!.meta, resource);
    const rehydratedMeta = JSON.parse(JSON.stringify(binding!.meta));

    // A durable model-context write returns a fresh metadata object. Equal
    // primitive policy keys keep appDocument memoized and the iframe alive.
    expect(rehydratedMeta).not.toBe(binding!.meta);
    expect(buildMcpAppDocumentPolicy(rehydratedMeta, resource)).toBe(initialPolicy);

    expect(buildMcpAppDocumentPolicy({
      ...rehydratedMeta,
      csp: {
        ...rehydratedMeta.csp,
        connectDomains: ['http://127.0.0.1:39513'],
      },
    }, resource)).not.toBe(initialPolicy);
  });

  test('advertises bounded context updates and preserves sequential App snapshots', async () => {
    expect(buildMcpAppHostCapabilities(true)).toEqual({
      downloadFile: {},
      openLinks: {},
      serverTools: {},
      updateModelContext: {
        text: {},
        structuredContent: {},
      },
    });
    expect(buildMcpAppHostCapabilities(false, false)).toEqual({
      openLinks: {},
      serverTools: {},
    });
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw-2026',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw-2026_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas',
        meta: {
          resourceUri: 'ui://tldraw/canvas',
          visibility: ['model', 'app'],
        },
      },
      structuredContent: {
        canvasId: 'interop-acceptance',
        revision: 13,
        notes: [],
      },
    });
    expect(binding).not.toBeNull();
    let envelope = createMcpAppResultEnvelope({
      binding: binding!,
      toolInput: { canvasId: 'interop-acceptance' },
      toolOutput: 'Opened revision 13',
      metadata: {
        structuredContent: {
          canvasId: 'interop-acceptance',
          revision: 13,
          notes: [],
        },
      },
    });
    const promoted: typeof envelope[] = [];
    const handleUpdate = createMcpAppModelContextUpdateHandler(
      () => envelope,
      (next) => {
        envelope = next;
        promoted.push(next);
      },
    );

    expect(await handleUpdate({
      structuredContent: {
        canvasId: 'interop-acceptance',
        revision: 15,
        notes: [{ id: 'saved-note' }],
        snapshot: { document: { pages: 1 } },
      },
    })).toEqual({});
    expect(promoted).toHaveLength(1);
    expect(promoted[0].result.structuredContent).toEqual({
      canvasId: 'interop-acceptance',
      revision: 15,
      notes: [{ id: 'saved-note' }],
      snapshot: { document: { pages: 1 } },
    });
    expect(promoted[0].binding).toEqual(envelope.binding);

    expect(await handleUpdate({
      content: [{ type: 'text', text: 'Saved revision 16' }],
      structuredContent: { revision: 16 },
    })).toEqual({});
    expect(promoted).toHaveLength(2);
    expect(promoted[1].result.content).toEqual([
      { type: 'text', text: 'Saved revision 16' },
    ]);
    expect(promoted[1].result.structuredContent).toEqual({ revision: 16 });

    await expect(handleUpdate({})).rejects.toThrow('not persistable');
    expect(promoted).toHaveLength(2);
  });

  test('serializes concurrent model-context writes and computes from the latest committed envelope', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw-2026',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw-2026_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas',
        meta: {
          resourceUri: 'ui://tldraw/canvas',
          visibility: ['model', 'app'],
        },
      },
      structuredContent: { canvasId: 'serial-canvas', revision: 1 },
    });
    expect(binding).not.toBeNull();
    let envelope = createMcpAppResultEnvelope({
      binding: binding!,
      toolInput: { canvasId: 'serial-canvas' },
      toolOutput: 'Revision 1',
      metadata: {
        structuredContent: { canvasId: 'serial-canvas', revision: 1 },
      },
    });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const persisted: McpAppResultEnvelope[] = [];
    const handleUpdate = createMcpAppModelContextUpdateHandler(
      () => envelope,
      async (next) => {
        persisted.push(next);
        if (persisted.length === 1) await firstGate;
        envelope = next;
      },
    );

    const first = handleUpdate({
      structuredContent: { canvasId: 'serial-canvas', revision: 2 },
    });
    const second = handleUpdate({
      content: [{ type: 'text', text: 'Committed revision 2' }],
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted).toHaveLength(1);

    releaseFirst?.();
    expect(await first).toEqual({});
    expect(await second).toEqual({});
    expect(persisted).toHaveLength(2);
    expect(persisted[1].result.structuredContent).toEqual({
      canvasId: 'serial-canvas',
      revision: 2,
    });
    expect(persisted[1].result.content).toEqual([
      { type: 'text', text: 'Committed revision 2' },
    ]);
  });

  test('binds accepted and queued model-context writes to their original epoch and callback', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw-2026',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw-2026_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas',
        meta: { resourceUri: 'ui://tldraw/canvas', visibility: ['model', 'app'] },
      },
      structuredContent: { canvasId: 'canvas-a', revision: 1 },
    });
    if (!binding) throw new Error('expected binding');
    const envelopeA = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'canvas-a' },
      toolOutput: 'Revision 1',
      metadata: { structuredContent: { canvasId: 'canvas-a', revision: 1 } },
    });
    const envelopeB = createMcpAppResultEnvelope({
      binding: { ...binding, toolKey: 'tldraw-2026_other_canvas' },
      toolInput: { canvasId: 'canvas-b' },
      toolOutput: 'Revision 90',
      metadata: { structuredContent: { canvasId: 'canvas-b', revision: 90 } },
    });
    let currentEpoch = 'epoch-a';
    let currentEnvelope = envelopeA;
    let callback: (next: McpAppResultEnvelope) => Promise<void>;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const persistedA: McpAppResultEnvelope[] = [];
    const persistedB: McpAppResultEnvelope[] = [];
    callback = async (next) => {
      persistedA.push(next);
      await firstGate;
    };
    const handleUpdate = createMcpAppModelContextUpdateHandler(
      () => currentEnvelope,
      undefined,
      {
        getEpoch: () => currentEpoch,
        isCurrent: (epoch) => epoch === currentEpoch,
        getCallback: () => callback,
        onCommitted: (next) => { currentEnvelope = next; },
      },
    );

    const first = handleUpdate({ structuredContent: { canvasId: 'canvas-a', revision: 2 } });
    const queued = handleUpdate({ content: [{ type: 'text', text: 'queued A write' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(persistedA).toHaveLength(1);

    // React has replaced every dynamic value while the first A persistence is
    // still in flight. The queued A request must not read B or call B's writer.
    currentEpoch = 'epoch-b';
    currentEnvelope = envelopeB;
    callback = async (next) => { persistedB.push(next); };
    releaseFirst();

    await expect(first).rejects.toThrow('binding changed');
    await expect(queued).rejects.toThrow('binding changed');
    expect(persistedB).toEqual([]);
    expect(currentEnvelope).toBe(envelopeB);
    expect(currentEnvelope.result.structuredContent).toEqual({
      canvasId: 'canvas-b',
      revision: 90,
    });
  });

  test('rejects a failed persistence without advancing state or poisoning later updates', async () => {
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw-2026',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw-2026_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas',
        meta: {
          resourceUri: 'ui://tldraw/canvas',
          visibility: ['model', 'app'],
        },
      },
      structuredContent: { canvasId: 'failure-canvas', revision: 7 },
    });
    expect(binding).not.toBeNull();
    let envelope = createMcpAppResultEnvelope({
      binding: binding!,
      toolInput: { canvasId: 'failure-canvas' },
      toolOutput: 'Revision 7',
      metadata: {
        structuredContent: { canvasId: 'failure-canvas', revision: 7 },
      },
    });
    let attempts = 0;
    const handleUpdate = createMcpAppModelContextUpdateHandler(
      () => envelope,
      async (next) => {
        attempts += 1;
        if (attempts === 1) throw new Error('disk write failed');
        envelope = next;
      },
    );

    const failed = handleUpdate({
      structuredContent: { canvasId: 'failure-canvas', revision: 8 },
    });
    const recovered = handleUpdate({
      content: [{ type: 'text', text: 'Still revision 7' }],
    });
    await expect(failed).rejects.toThrow('disk write failed');
    expect(await recovered).toEqual({});
    expect(envelope.result.structuredContent).toEqual({
      canvasId: 'failure-canvas',
      revision: 7,
    });
    expect(envelope.result.content).toEqual([
      { type: 'text', text: 'Still revision 7' },
    ]);
  });
});

describe('MCP App file downloads', () => {
  const singleDownload = () => ({
    contents: [{
      type: 'resource' as const,
      resource: {
        uri: 'file:///service-topology.svg',
        mimeType: 'image/svg+xml',
        text: '<svg/>',
      },
    }],
  });

  const installTemporaryProperty = (
    target: object,
    property: PropertyKey,
    value: unknown,
  ) => {
    const previous = Object.getOwnPropertyDescriptor(target, property);
    Object.defineProperty(target, property, {
      configurable: true,
      writable: true,
      value,
    });
    return () => {
      if (previous) {
        Object.defineProperty(target, property, previous);
      } else {
        Reflect.deleteProperty(target, property);
      }
    };
  };

  const withTemporaryProperties = async <T>(
    properties: Array<{ target: object; property: PropertyKey; value: unknown }>,
    run: () => Promise<T>,
  ) => {
    const restore = properties.map(({ target, property, value }) => (
      installTemporaryProperty(target, property, value)
    ));
    try {
      return await run();
    } finally {
      for (const callback of restore.reverse()) callback();
    }
  };

  const browserWindow = (overrides: Record<string, unknown> = {}) => ({
    location: {
      href: 'https://openchamber.example/app',
      origin: 'https://openchamber.example',
    },
    setTimeout,
    ...overrides,
  });

  const trustedDesktopWindow = (
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) => ({
    location: {
      href: 'http://127.0.0.1:3901/app',
      origin: 'http://127.0.0.1:3901',
    },
    __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
    __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:3901',
    ...(invoke ? { __OPENCHAMBER_DESKTOP__: { invoke } } : {}),
  });

  test('accepts bounded self-contained text and binary file resources', () => {
    const prepared = prepareMcpAppDownloads({
      contents: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///service-topology.svg',
            mimeType: 'image/svg+xml',
            text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
          },
        },
        {
          type: 'resource',
          resource: {
            uri: 'file:///service-topology.png',
            mimeType: 'image/png',
            blob: 'iVBORw0KGgo=',
          },
        },
      ],
    });

    expect(prepared?.map(({ fileName, mimeType, bytes }) => ({
      fileName,
      mimeType,
      size: bytes.byteLength,
    }))).toEqual([
      {
        fileName: 'service-topology.svg',
        mimeType: 'image/svg+xml',
        size: 41,
      },
      {
        fileName: 'service-topology.png',
        mimeType: 'image/png',
        size: 8,
      },
    ]);
  });

  test('accepts zero-byte exports and reports their size accurately', () => {
    const prepared = prepareMcpAppDownloads({
      contents: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///empty.txt',
            mimeType: 'text/plain',
            text: '',
          },
        },
        {
          type: 'resource',
          resource: {
            uri: 'file:///empty.png',
            mimeType: 'image/png',
            blob: '',
          },
        },
      ],
    });

    expect(prepared?.map((item) => item.bytes.byteLength)).toEqual([0, 0]);
    expect(formatMcpAppDownloadSize(0)).toBe('0 B');
    expect(formatMcpAppDownloadSize(512)).toBe('512 B');
    expect(formatMcpAppDownloadSize(1025)).toBe('2 KiB');
  });

  test('sanitizes file names and rejects linked, remote, malformed, and oversized payloads', () => {
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: {
          uri: 'file:///report%2Ffinal.svg',
          mimeType: 'image/svg+xml',
          text: '<svg/>',
        },
      }],
    })?.[0]?.fileName).toBe('report_final.svg');

    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///CON.png', mimeType: 'image/png', blob: '' },
      }],
    })?.[0]?.fileName).toBe('_CON.png');
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: {
          uri: 'file:///safe%E2%80%AEgnp.svg',
          mimeType: 'image/svg+xml',
          text: '<svg/>',
        },
      }],
    })?.[0]?.fileName).toBe('safegnp.svg');

    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource_link',
        uri: 'https://example.com/report.svg',
        name: 'report.svg',
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'https://example.com/report.svg', text: '<svg/>' },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///bad.png', blob: 'not base64!' },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///large.bin', text: 'x'.repeat(20 * 1024 * 1024 + 1) },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///run.command', mimeType: 'text/plain', text: 'echo unsafe' },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///page.html', mimeType: 'text/html', text: '<script/>' },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: {
          uri: `file:///${'x'.repeat(8 * 1024)}.png`,
          mimeType: 'image/png',
          blob: '',
        },
      }],
    })).toBeNull();
    expect(prepareMcpAppDownloads({
      contents: [{
        type: 'resource',
        resource: { uri: 'file:///spoof.png', mimeType: 'image/png\u202e', blob: '' },
      }],
    })).toBeNull();
  });

  test('accepts one Web export through a host-owned anchor click and delayed URL cleanup', async () => {
    const events: string[] = [];
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click: () => events.push('anchor:click'),
      remove: () => events.push('anchor:remove'),
    } as unknown as HTMLAnchorElement;
    const documentMock = {
      body: {
        appendChild: (node: HTMLAnchorElement) => {
          expect(node).toBe(anchor);
          events.push('anchor:append');
          return node;
        },
      },
      createElement: (tagName: string) => {
        expect(tagName).toBe('a');
        events.push('anchor:create');
        return anchor;
      },
    };
    const confirmations: Array<{ fileName: string; mimeType: string; bytes: number[] }> = [];

    await withTemporaryProperties([
      {
        target: globalThis,
        property: 'window',
        value: browserWindow({
          setTimeout: (callback: () => void, delay: number) => {
            timers.push({ callback, delay });
            return timers.length;
          },
        }),
      },
      { target: globalThis, property: 'document', value: documentMock },
      {
        target: URL,
        property: 'createObjectURL',
        value: (blob: Blob) => {
          blobs.push(blob);
          return 'blob:openchamber-export';
        },
      },
      {
        target: URL,
        property: 'revokeObjectURL',
        value: (url: string) => revoked.push(url),
      },
    ], async () => {
      expect(await downloadMcpAppFiles(singleDownload(), async (download) => {
        confirmations.push({
          fileName: download.fileName,
          mimeType: download.mimeType,
          bytes: [...download.bytes],
        });
        return true;
      })).toEqual({});

      expect(confirmations).toEqual([{
        fileName: 'service-topology.svg',
        mimeType: 'image/svg+xml',
        bytes: [...new TextEncoder().encode('<svg/>')],
      }]);
      expect(anchor.href).toBe('blob:openchamber-export');
      expect(anchor.download).toBe('service-topology.svg');
      expect(anchor.rel).toBe('noopener');
      expect(events).toEqual([
        'anchor:create',
        'anchor:append',
        'anchor:click',
        'anchor:remove',
      ]);
      expect(blobs).toHaveLength(1);
      expect(blobs[0]?.type).toBe('image/svg+xml');
      expect(await blobs[0]?.text()).toBe('<svg/>');
      expect(timers).toHaveLength(1);
      expect(timers[0]?.delay).toBe(30_000);
      expect(revoked).toHaveLength(0);

      timers[0]?.callback();
      expect(revoked).toEqual(['blob:openchamber-export']);
    });
  });

  test('returns an observable Web cancellation without creating a download anchor', async () => {
    let confirmations = 0;
    let anchors = 0;

    await withTemporaryProperties([
      { target: globalThis, property: 'window', value: browserWindow() },
      {
        target: globalThis,
        property: 'document',
        value: {
          createElement: () => {
            anchors += 1;
            throw new Error('cancelled downloads must not create an anchor');
          },
        },
      },
    ], async () => {
      expect(await downloadMcpAppFiles(singleDownload(), async () => {
        confirmations += 1;
        return false;
      })).toEqual({ isError: true });
    });

    expect(confirmations).toBe(1);
    expect(anchors).toBe(0);
  });

  test('honors AbortSignal before and while awaiting Web confirmation', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    let confirmations = 0;
    expect(await downloadMcpAppFiles(singleDownload(), async () => {
      confirmations += 1;
      return true;
    }, preAborted.signal)).toEqual({ isError: true });
    expect(confirmations).toBe(0);

    const pendingAbort = new AbortController();
    let anchors = 0;
    let resolveConfirmation: ((accepted: boolean) => void) | null = null;
    let markConfirmationStarted: (() => void) | null = null;
    const confirmationStarted = new Promise<void>((resolve) => {
      markConfirmationStarted = resolve;
    });

    await withTemporaryProperties([
      { target: globalThis, property: 'window', value: browserWindow() },
      {
        target: globalThis,
        property: 'document',
        value: {
          createElement: () => {
            anchors += 1;
            throw new Error('aborted downloads must not create an anchor');
          },
        },
      },
    ], async () => {
      const result = downloadMcpAppFiles(singleDownload(), () => {
        markConfirmationStarted?.();
        return new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        });
      }, pendingAbort.signal);

      await confirmationStarted;
      pendingAbort.abort();
      resolveConfirmation?.(true);
      expect(await result).toEqual({ isError: true });
    });

    expect(anchors).toBe(0);
  });

  test('rejects Web batches before confirmation or automatic anchor downloads', async () => {
    let confirmations = 0;
    let anchors = 0;

    await withTemporaryProperties([
      { target: globalThis, property: 'window', value: browserWindow() },
      {
        target: globalThis,
        property: 'document',
        value: {
          createElement: () => {
            anchors += 1;
            throw new Error('Web batches must not create download anchors');
          },
        },
      },
    ], async () => {
      expect(await downloadMcpAppFiles({
        contents: [
          singleDownload().contents[0],
          {
            type: 'resource',
            resource: {
              uri: 'file:///service-topology.png',
              mimeType: 'image/png',
              blob: 'iVBORw0KGgo=',
            },
          },
        ],
      }, async () => {
        confirmations += 1;
        return true;
      })).toEqual({ isError: true });
    });

    expect(confirmations).toBe(0);
    expect(anchors).toBe(0);
  });

  test('uses trusted Desktop IPC and completes without a Web confirmation', async () => {
    const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let confirmations = 0;

    await withTemporaryProperties([{
      target: globalThis,
      property: 'window',
      value: trustedDesktopWindow(async (command, args) => {
        invocations.push({ command, args });
        return { saved: true };
      }),
    }], async () => {
      expect(await downloadMcpAppFiles(singleDownload(), async () => {
        confirmations += 1;
        return true;
      })).toEqual({});
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe('desktop_save_binary_file');
    const desktopArgs = invocations[0]?.args;
    expect(typeof desktopArgs?.requestId).toBe('string');
    expect(desktopArgs).toEqual({
      requestId: desktopArgs?.requestId,
      defaultFileName: 'service-topology.svg',
      mimeType: 'image/svg+xml',
      contentBase64: 'PHN2Zy8+',
    });
    expect(confirmations).toBe(0);
  });

  test('forwards Desktop AbortSignal and cancels the native transaction before a late save resolves', async () => {
    const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let resolveSave!: (value: { saved: boolean }) => void;
    const pendingSave = new Promise<{ saved: boolean }>((resolve) => {
      resolveSave = resolve;
    });
    const controller = new AbortController();

    await withTemporaryProperties([{
      target: globalThis,
      property: 'window',
      value: trustedDesktopWindow(async (command, args) => {
        invocations.push({ command, args });
        if (command === 'desktop_save_binary_file') return await pendingSave;
        return { cancelled: true };
      }),
    }], async () => {
      const result = downloadMcpAppFiles(singleDownload(), undefined, controller.signal);
      await Promise.resolve();
      expect(invocations[0]?.command).toBe('desktop_save_binary_file');
      controller.abort();
      expect(await result).toEqual({ isError: true });
      expect(invocations[1]).toEqual({
        command: 'desktop_cancel_binary_file_save',
        args: { requestId: invocations[0]?.args?.requestId },
      });
      resolveSave({ saved: true });
    });
  });

  test('reports Desktop Save-dialog cancellation without falling back to Web', async () => {
    let confirmations = 0;

    await withTemporaryProperties([{
      target: globalThis,
      property: 'window',
      value: trustedDesktopWindow(async () => ({ cancelled: true })),
    }], async () => {
      expect(await downloadMcpAppFiles(singleDownload(), async () => {
        confirmations += 1;
        return true;
      })).toEqual({ isError: true });
    });

    expect(confirmations).toBe(0);
  });

  test('reports Desktop file IPC as unavailable outside the trusted local origin', async () => {
    let invocations = 0;
    const untrustedDesktop = {
      ...trustedDesktopWindow(async () => {
        invocations += 1;
        return { saved: true };
      }),
      location: {
        href: 'https://remote.example/app',
        origin: 'https://remote.example',
      },
    };

    await withTemporaryProperties([{
      target: globalThis,
      property: 'window',
      value: untrustedDesktop,
    }], async () => {
      expect(await downloadMcpAppFiles(singleDownload())).toEqual({ isError: true });
    });

    expect(invocations).toBe(0);
  });
});

describe('MCP App external links', () => {
  test('opens HTTPS and loopback HTTP through the trusted host helper', async () => {
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
      return true;
    };

    expect(await openMcpAppExternalLink('https://excalidraw.com/#json=example', open)).toEqual({});
    expect(await openMcpAppExternalLink('http://127.0.0.1:3000/preview', open)).toEqual({});
    expect(await openMcpAppExternalLink('http://[::1]:3000/preview', open)).toEqual({});
    expect(opened).toEqual([
      'https://excalidraw.com/#json=example',
      'http://127.0.0.1:3000/preview',
      'http://[::1]:3000/preview',
    ]);
  });

  test('rejects insecure remote, credentialed, and non-HTTP URLs', async () => {
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
      return true;
    };

    for (const url of [
      'http://example.com/insecure',
      'https://user:password@example.com/private',
      'javascript:alert(1)',
      'file:///tmp/example',
      'data:text/html,example',
      'not a URL',
    ]) {
      expect(await openMcpAppExternalLink(url, open)).toEqual({ isError: true });
    }
    expect(opened).toEqual([]);
  });

  test('returns a protocol-level denial when the host cannot open the URL', async () => {
    expect(
      await openMcpAppExternalLink(
        'https://excalidraw.com/',
        async () => false,
      ),
    ).toEqual({ isError: true });
  });
});

type MountedMessageListener = (event: {
  source: unknown;
  origin: string;
  data: unknown;
}) => void;

class MountedClassList {
  private readonly values = new Set<string>();

  add(...values: string[]) { values.forEach((value) => this.values.add(value)); }
  remove(...values: string[]) { values.forEach((value) => this.values.delete(value)); }
  contains(value: string) { return this.values.has(value); }
  toString() { return [...this.values].join(' '); }
}

interface MountedNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  namespaceURI: string;
  ownerDocument: MountedDocument;
  parentNode: MountedNode | null;
  childNodes: MountedNode[];
  attributes: Map<string, string>;
  listeners: Map<string, Set<(...args: unknown[]) => void>>;
  classList: MountedClassList;
  style: Record<string, unknown>;
  dataset: Record<string, string>;
  contentWindow?: { postMessage: (message: unknown, targetOrigin?: string) => void };
  src: string;
  srcdoc?: string;
  open: boolean;
  clientWidth: number;
  clientHeight: number;
  textContent: string;
  nodeValue?: string;
  appendChild(child: MountedNode): MountedNode;
  insertBefore(child: MountedNode, reference: MountedNode | null): MountedNode;
  removeChild(child: MountedNode): MountedNode;
  setAttribute(name: string, value: unknown): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(name: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(name: string, listener: (...args: unknown[]) => void): void;
  dispatch(name: string, event?: unknown): void;
  show(): void;
  showModal(): void;
  close(): void;
}

interface MountedDocument extends MountedNode {
  body: MountedNode;
  documentElement: MountedNode & { lang: string };
  defaultView: MountedWindow;
  activeElement: MountedNode | null;
  createElement(tag: string): MountedNode;
  createElementNS(namespace: string, tag: string): MountedNode;
  createTextNode(text: string): MountedNode;
  getElementById(id: string): MountedNode | null;
}

interface MountedWindow {
  document: MountedDocument;
  navigator: { userAgent: string; platform: string; maxTouchPoints: number; language: string };
  location: { href: string; origin: string; protocol: string };
  innerWidth: number;
  innerHeight: number;
  addEventListener(name: string, listener: MountedMessageListener): void;
  removeEventListener(name: string, listener: MountedMessageListener): void;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  matchMedia(): { matches: boolean; addEventListener(): void; removeEventListener(): void };
  HTMLIFrameElement: new () => object;
  HTMLFrameSetElement: new () => object;
  HTMLInputElement: new () => object;
  HTMLTextAreaElement: new () => object;
  HTMLSelectElement: new () => object;
  HTMLOptionElement: new () => object;
  HTMLAnchorElement: new () => object;
}

const installMountedRendererDom = () => {
  const outbound = new Map<object, unknown[]>();
  const windowListeners = new Map<string, Set<MountedMessageListener>>();
  const removalEvents: string[] = [];
  let iframeAttributeHook: ((node: MountedNode, name: string, value: string) => void) | null = null;
  let nodeRemovalHook: ((parent: MountedNode, child: MountedNode) => void) | null = null;

  const document = {
    nodeType: 9,
    nodeName: '#document',
    tagName: '#document',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    parentNode: null,
    childNodes: [],
    attributes: new Map(),
    listeners: new Map(),
    classList: new MountedClassList(),
    style: {},
    dataset: {},
    src: '',
    open: false,
    clientWidth: 1024,
    clientHeight: 768,
    textContent: '',
    activeElement: null,
    addEventListener(name: string, listener: (...args: unknown[]) => void) {
      const listeners = (document as unknown as { listeners: Map<string, Set<(...args: unknown[]) => void>> }).listeners;
      const group = listeners.get(name) ?? new Set();
      group.add(listener);
      listeners.set(name, group);
    },
    removeEventListener(name: string, listener: (...args: unknown[]) => void) {
      (document as unknown as { listeners: Map<string, Set<(...args: unknown[]) => void>> }).listeners
        .get(name)?.delete(listener);
    },
  } as unknown as MountedDocument;

  const makeNode = (tag: string, namespace = 'http://www.w3.org/1999/xhtml'): MountedNode => {
    const upper = tag.toUpperCase();
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const attributes = new Map<string, string>();
    const node = {
      nodeType: 1,
      nodeName: upper,
      tagName: upper,
      namespaceURI: namespace,
      ownerDocument: document,
      parentNode: null,
      childNodes: [],
      attributes,
      listeners,
      classList: new MountedClassList(),
      style: {
        setProperty() {},
        getPropertyValue() { return ''; },
      },
      dataset: {},
      src: '',
      open: false,
      clientWidth: 860,
      clientHeight: 520,
      textContent: '',
      appendChild(child: MountedNode) {
        const previousParent = child.parentNode;
        if (previousParent) {
          const previousIndex = previousParent.childNodes.indexOf(child);
          if (previousIndex >= 0) previousParent.childNodes.splice(previousIndex, 1);
        }
        node.childNodes.push(child);
        child.parentNode = node;
        return child;
      },
      insertBefore(child: MountedNode, reference: MountedNode | null) {
        const previousParent = child.parentNode;
        if (previousParent) {
          const previousIndex = previousParent.childNodes.indexOf(child);
          if (previousIndex >= 0) previousParent.childNodes.splice(previousIndex, 1);
        }
        const index = reference ? node.childNodes.indexOf(reference) : -1;
        if (index < 0) node.childNodes.push(child);
        else node.childNodes.splice(index, 0, child);
        child.parentNode = node;
        return child;
      },
      removeChild(child: MountedNode) {
        nodeRemovalHook?.(node, child);
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        removalEvents.push(`remove:${child.tagName}`);
        return child;
      },
      setAttribute(name: string, rawValue: unknown) {
        const value = String(rawValue);
        attributes.set(name, value);
        if (name === 'src') node.src = value;
        if (upper === 'IFRAME') iframeAttributeHook?.(node, name, value);
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      removeAttribute(name: string) {
        attributes.delete(name);
        if (name === 'src') node.src = '';
      },
      addEventListener(name: string, listener: (...args: unknown[]) => void) {
        const group = listeners.get(name) ?? new Set();
        group.add(listener);
        listeners.set(name, group);
      },
      removeEventListener(name: string, listener: (...args: unknown[]) => void) {
        listeners.get(name)?.delete(listener);
      },
      dispatch(name: string, event?: unknown) {
        for (const listener of listeners.get(name) ?? []) listener(event);
      },
      show() { node.open = true; },
      showModal() { node.open = true; },
      close() { node.open = false; },
      contains(other: MountedNode) {
        if (other === node) return true;
        return node.childNodes.some((child) => (child as unknown as { contains?: (value: MountedNode) => boolean }).contains?.(other));
      },
      compareDocumentPosition() { return 0; },
      focus() {},
      blur() {},
      click() {},
    } as unknown as MountedNode;
    Object.defineProperty(node, 'firstChild', {
      get: () => node.childNodes[0] ?? null,
    });
    if (upper === 'IFRAME') {
      const frameWindow = {
        postMessage: (message: unknown) => {
          const messages = outbound.get(frameWindow) ?? [];
          messages.push(message);
          outbound.set(frameWindow, messages);
          const method = (message as { method?: unknown } | null)?.method;
          if (typeof method === 'string') removalEvents.push(`post:${method}`);
        },
      };
      node.contentWindow = frameWindow;
    }
    return node;
  };

  Object.assign(document, {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (namespace: string, tag: string) => makeNode(tag, namespace),
    createTextNode: (text: string) => ({
      ...makeNode('#text'),
      nodeType: 3,
      nodeName: '#text',
      tagName: '#text',
      nodeValue: text,
      textContent: text,
    }),
    getElementById: (id: string) => {
      const visit = (node: MountedNode): MountedNode | null => {
        if (node.getAttribute?.('id') === id) return node;
        for (const child of node.childNodes ?? []) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(document.body);
    },
  });
  document.body = makeNode('body');
  document.documentElement = Object.assign(makeNode('html'), { lang: 'en-US' });

  let animationFrame = 0;
  const window = {
    document,
    navigator: { userAgent: 'test', platform: 'test', maxTouchPoints: 0, language: 'en-US' },
    location: { href: 'https://host.example/chat', origin: 'https://host.example', protocol: 'https:' },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(name: string, listener: MountedMessageListener) {
      const group = windowListeners.get(name) ?? new Set();
      group.add(listener);
      windowListeners.set(name, group);
    },
    removeEventListener(name: string, listener: MountedMessageListener) {
      windowListeners.get(name)?.delete(listener);
    },
    requestAnimationFrame(callback: () => void) {
      animationFrame += 1;
      callback();
      return animationFrame;
    },
    cancelAnimationFrame() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    HTMLIFrameElement: class {},
    HTMLFrameSetElement: class {},
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    HTMLOptionElement: class {},
    HTMLAnchorElement: class {},
  } as MountedWindow;
  document.defaultView = window;

  const globals = globalThis as unknown as {
    document?: MountedDocument;
    window?: MountedWindow;
    navigator?: MountedWindow['navigator'];
    ResizeObserver?: new (callback: () => void) => { observe(node: unknown): void; disconnect(): void };
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = {
    document: globals.document,
    window: globals.window,
    navigator: globals.navigator,
    ResizeObserver: globals.ResizeObserver,
    actEnvironment: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  globals.document = document;
  globals.window = window;
  globals.navigator = window.navigator;
  globals.ResizeObserver = class {
    private readonly callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { this.callback(); }
    disconnect() {}
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const find = (tag: string, node: MountedNode = document.body): MountedNode | null => {
    if (node.tagName === tag.toUpperCase()) return node;
    for (const child of node.childNodes) {
      const found = find(tag, child);
      if (found) return found;
    }
    return null;
  };

  return {
    document,
    window,
    outbound,
    removalEvents,
    find,
    dispatchMessage(source: unknown, data: unknown, origin = 'null') {
      const event = { source, data, origin };
      for (const listener of [...(windowListeners.get('message') ?? [])]) listener(event);
    },
    setIframeAttributeHook(hook: typeof iframeAttributeHook) {
      iframeAttributeHook = hook;
    },
    setNodeRemovalHook(hook: typeof nodeRemovalHook) {
      nodeRemovalHook = hook;
    },
    restore() {
      globals.document = previous.document;
      globals.window = previous.window;
      globals.navigator = previous.navigator;
      globals.ResizeObserver = previous.ResizeObserver;
      globals.IS_REACT_ACT_ENVIRONMENT = previous.actEnvironment;
    },
  };
};

const decodeMountedDocumentUrl = (url: string) => {
  const prefix = 'data:text/html;charset=utf-8;base64,';
  if (!url.startsWith(prefix)) throw new Error('expected an opaque HTML document URL');
  return new TextDecoder().decode(Uint8Array.from(
    atob(url.slice(prefix.length)),
    (character) => character.charCodeAt(0),
  ));
};

const mountedInlineScript = (html: string) => {
  const start = html.indexOf('<script>') + '<script>'.length;
  const end = html.lastIndexOf('</script>');
  if (start < '<script>'.length || end < start) throw new Error('inline script unavailable');
  return html.slice(start, end);
};

/**
 * Execute the exact generated outer Broker and nested opaque Loader around the
 * real iframe mounted by React. This is intentionally not a hand-written
 * second handshake: assigning the generated Loader URL boots its exact script,
 * its verified loader.transitioning acknowledgement drives the Broker's real
 * `app.srcdoc = html`, and that DOM-property navigation emits broker.ready.
 */
const executeMountedGeneratedBrokerRuntime = (
  dom: ReturnType<typeof installMountedRendererDom>,
  frame: MountedNode,
) => {
  const target = frame.contentWindow;
  if (!target) throw new Error('mounted iframe window unavailable');
  const originalTargetPostMessage = target.postMessage;
  const hostMessages: unknown[] = [];
  const brokerMessages: unknown[] = [];
  const appMessages: unknown[] = [];
  let brokerMessageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
  let loaderMessageListener: ((event: { source: unknown; data: unknown }) => void) | undefined;
  let loaderDocumentLoadListener: (() => void) | undefined;
  let innerFrameLoadListener: (() => void) | undefined;
  let mountedHtml = '';
  let innerSandbox = '';
  let innerRemoved = false;
  let innerMode: 'idle' | 'loader' | 'app' = 'idle';
  let innerSrc = '';
  let timerId = 0;

  const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
  const outerParent = {
    postMessage(message: unknown) {
      brokerMessages.push(snapshot(message));
      dom.dispatchMessage(target, message, 'null');
    },
  };
  const loaderParent = {
    postMessage(message: unknown) {
      brokerMessageListener?.({ source: innerWindow, data: message });
    },
  };
  const innerWindow = {
    postMessage(message: unknown) {
      if (innerMode === 'loader') {
        loaderMessageListener?.({ source: loaderParent, data: message });
        return;
      }
      if (innerMode === 'app') appMessages.push(snapshot(message));
    },
  };

  const executeLoader = (url: string) => {
    innerMode = 'loader';
    loaderMessageListener = undefined;
    loaderDocumentLoadListener = undefined;
    runInNewContext(mountedInlineScript(decodeMountedDocumentUrl(url)), {
      parent: loaderParent,
      document: { readyState: 'loading' },
      Blob,
      addEventListener: (
        type: string,
        listener: ((event: { source: unknown; data: unknown }) => void) | (() => void),
      ) => {
        if (type === 'message') {
          loaderMessageListener = listener as (event: { source: unknown; data: unknown }) => void;
        } else if (type === 'load') {
          loaderDocumentLoadListener = listener as () => void;
        }
      },
    });
  };

  const innerFrame = {
    title: '',
    contentWindow: innerWindow,
    setAttribute(name: string, value: string) {
      if (name === 'sandbox') innerSandbox = value;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === 'load') innerFrameLoadListener = listener;
    },
    remove() {
      innerRemoved = true;
    },
  } as {
    title: string;
    contentWindow: typeof innerWindow;
    src: string;
    srcdoc: string;
    setAttribute(name: string, value: string): void;
    addEventListener(type: string, listener: () => void): void;
    remove(): void;
  };
  Object.defineProperty(innerFrame, 'src', {
    get: () => innerSrc,
    set: (value: string) => {
      innerSrc = value;
      executeLoader(value);
    },
  });
  Object.defineProperty(innerFrame, 'srcdoc', {
    get: () => mountedHtml,
    set: (value: string) => {
      mountedHtml = value;
      innerMode = 'app';
      innerFrameLoadListener?.();
    },
  });

  target.postMessage = (message: unknown, targetOrigin?: string) => {
    originalTargetPostMessage.call(target, message, targetOrigin);
    hostMessages.push(snapshot(message));
    brokerMessageListener?.({ source: outerParent, data: message });
  };

  runInNewContext(mountedInlineScript(decodeMountedDocumentUrl(frame.src)), {
    parent: outerParent,
    document: {
      createElement: (tag: string) => {
        if (tag !== 'iframe') throw new Error(`unexpected Broker element: ${tag}`);
        return innerFrame;
      },
      body: {
        append: () => {
          // Browser ordering: the nested Loader document finishes before the
          // iframe's outer load event. That outer event sends loader.init; the
          // exact Loader then byte-validates and announces transitioning.
          loaderDocumentLoadListener?.();
          innerFrameLoadListener?.();
        },
      },
    },
    addEventListener: (
      type: string,
      listener: (event: { source: unknown; data: unknown }) => void,
    ) => {
      if (type === 'message') brokerMessageListener = listener;
    },
    setTimeout: () => {
      timerId += 1;
      return timerId;
    },
    clearTimeout: () => {},
  });

  return {
    appMessages,
    brokerMessages,
    hostMessages,
    get mountedHtml() { return mountedHtml; },
    get innerSandbox() { return innerSandbox; },
    get innerRemoved() { return innerRemoved; },
    sendAppMessage(data: unknown) {
      brokerMessageListener?.({ source: innerWindow, data });
    },
    triggerSecondNavigation() {
      innerFrameLoadListener?.();
    },
    restore() {
      target.postMessage = originalTargetPostMessage;
    },
  };
};

describe('MCP App first-paint watchdog lifecycle', () => {
  test('preserves evidence recorded before watchdog effect setup and resets only at an epoch boundary', () => {
    const source = readFileSync(new URL('./McpAppRenderer.tsx', import.meta.url), 'utf8');
    const waitingEffect = source.indexOf(
      "React.useEffect(() => {\n    if (runtimeState.phase !== 'waiting-first-paint') return;",
    );
    expect(waitingEffect).toBeGreaterThanOrEqual(0);
    const waitingEffectEnd = source.indexOf(
      '\n  }, [bindingEpoch, runtimeState.phase]);',
      waitingEffect,
    );
    expect(waitingEffectEnd).toBeGreaterThan(waitingEffect);

    expect(source.slice(waitingEffect, waitingEffectEnd)).not.toContain(
      'firstPaintEvidenceRef.current = {',
    );

    const epochReset = source.indexOf(
      'firstPaintEvidenceEpochRef.current !== bindingEpoch',
    );
    expect(epochReset).toBeGreaterThanOrEqual(0);
    expect(epochReset).toBeLessThan(waitingEffect);
    expect(source.indexOf(
      'firstPaintEvidenceEpochRef.current = bindingEpoch',
      epochReset,
    )).toBeGreaterThan(epochReset);

    // The evidence that arrived before the passive watchdog effect is still a
    // valid three-signal receipt; the effect must observe it, not erase it.
    expect(mcpAppFirstPaintVerdict({
      appSizeChanged: true,
      layoutVisible: true,
      appContentReady: true,
    })).toBe(true);
  });
});

describe('MCP App mounted production authority', () => {
  test('settles an App tools/call response through the mounted Broker boundary', async () => {
    const dom = installMountedRendererDom();
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const client = opencodeClient as unknown as {
      getMcpAppResource: (...args: unknown[]) => Promise<unknown>;
      callMcpAppTool: (...args: unknown[]) => Promise<unknown>;
    };
    const originalResource = client.getMcpAppResource;
    const originalToolCall = client.callMcpAppTool;
    const toolCalls: unknown[][] = [];
    client.getMcpAppResource = async () => ({
      html: '<!doctype html><main>Settlement fixture</main>',
      mimeType: 'text/html;profile=mcp-app',
      sha256: 'sha256:settlement-fixture',
    });
    client.callMcpAppTool = async (...args: unknown[]) => {
      toolCalls.push(args);
      return {
        content: [{ type: 'text', text: 'settled' }],
        structuredContent: { canvasId: 'settlement', revision: 1 },
      };
    };

    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: { resourceDomains: ['data:'], connectDomains: [] },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    const envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'settlement' },
      toolOutput: 'ready',
      metadata: {},
    });
    let mounted = true;
    let runtime: ReturnType<typeof executeMountedGeneratedBrokerRuntime> | null = null;
    try {
      await act(async () => {
        root.render(React.createElement(McpAppRenderer, {
          envelope,
          directory: '/workspace/settlement',
          sessionId: 'ses_settlement',
          messageId: 'msg_settlement',
          partId: 'prt_settlement',
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
      const frame = dom.find('iframe');
      if (!frame?.contentWindow) throw new Error('real renderer did not mount its proxy iframe');
      runtime = executeMountedGeneratedBrokerRuntime(dom, frame);
      expect(runtime.brokerMessages.some((message) => (
        (message as { type?: unknown }).type === 'broker.ready'
      ))).toBe(true);

      runtime.sendAppMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: {
          appInfo: { name: 'settlement-fixture', version: '1' },
          appCapabilities: { availableDisplayModes: ['inline'] },
          protocolVersion: '2026-01-26',
        },
      });
      runtime.sendAppMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      runtime.sendAppMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'tldraw_get_canvas_state', arguments: { canvasId: 'settlement' } },
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      });

      expect(toolCalls).toHaveLength(1);
      const [toolCall] = toolCalls[0] ?? [];
      expect((toolCall as { server?: unknown } | undefined)?.server).toBe('tldraw');
      expect((toolCall as { name?: unknown } | undefined)?.name).toBe('tldraw_get_canvas_state');
      expect((toolCall as { arguments?: unknown } | undefined)?.arguments).toEqual({ canvasId: 'settlement' });
      const response = runtime.appMessages.find((message) => (
        (message as { jsonrpc?: unknown; id?: unknown }).jsonrpc === '2.0'
        && (message as { id?: unknown }).id === 7
      ));
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 7,
        result: {
          content: [{ type: 'text', text: 'settled' }],
          structuredContent: { canvasId: 'settlement', revision: 1 },
        },
      });
    } finally {
      if (mounted) await act(async () => { root.unmount(); });
      runtime?.restore();
      client.getMcpAppResource = originalResource;
      client.callMcpAppTool = originalToolCall;
      dom.restore();
    }
  });

  test('mounts the real proxy handshake and rejects an old App call during binding-switch commit', async () => {
    const dom = installMountedRendererDom();
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const client = opencodeClient as unknown as {
      getMcpAppResource: (...args: unknown[]) => Promise<unknown>;
      callMcpAppTool: (...args: unknown[]) => Promise<unknown>;
    };
    const originalResource = client.getMcpAppResource;
    const originalToolCall = client.callMcpAppTool;
    const resourceCalls: unknown[][] = [];
    const toolCalls: unknown[][] = [];
    let resolveSecondResource!: (resource: unknown) => void;
    const secondResource = new Promise<unknown>((resolve) => {
      resolveSecondResource = resolve;
    });
    client.getMcpAppResource = async (...args: unknown[]) => {
      resourceCalls.push(args);
      if (resourceCalls.length === 2) return await secondResource;
      return {
        html: '<!doctype html><main>Mounted App</main>',
        mimeType: 'text/html;profile=mcp-app',
        sha256: 'sha256:mounted-app',
      };
    };
    client.callMcpAppTool = async (...args: unknown[]) => {
      toolCalls.push(args);
      return { content: [] };
    };

    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    const first = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'one' },
      toolOutput: 'ready',
      metadata: {},
    });
    let mounted = true;
    let brokerRuntime: ReturnType<typeof executeMountedGeneratedBrokerRuntime> | null = null;
    try {
      await act(async () => {
        root.render(React.createElement(McpAppRenderer, {
          envelope: first,
          directory: '/workspace/a',
          sessionId: 'ses_1',
          messageId: 'msg_1',
          partId: 'prt_1',
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
      const frame = dom.find('iframe');
      if (!frame?.contentWindow) throw new Error('real renderer did not mount its proxy iframe');
      expect(frame.getAttribute('sandbox')).toBe(MCP_APP_SANDBOX_PROXY_SANDBOX);
      const firstResourceCall = resourceCalls[0]?.[0] as {
        directory?: string;
        sessionId?: string;
        messageId?: string;
        partId?: string;
        toolKey?: string;
      } | undefined;
      expect(firstResourceCall?.directory).toBe('/workspace/a');
      expect(firstResourceCall?.sessionId).toBe('ses_1');
      expect(firstResourceCall?.messageId).toBe('msg_1');
      expect(firstResourceCall?.partId).toBe('prt_1');
      expect(firstResourceCall?.toolKey).toBe('tldraw_tldraw_open_canvas');
      const target = frame.contentWindow;
      brokerRuntime = executeMountedGeneratedBrokerRuntime(dom, frame);
      const outbound = dom.outbound.get(target) ?? [];
      const resourceReady = brokerRuntime.hostMessages.find((message) => (
        (message as { method?: unknown }).method === 'ui/notifications/sandbox-resource-ready'
      )) as { params?: { html?: string } } | undefined;
      expect(resourceReady?.params?.html?.startsWith(
        '<!doctype html><meta http-equiv="Content-Security-Policy"',
      )).toBe(true);
      expect(resourceReady?.params?.html).toContain(`connect-src 'none'`);
      expect(resourceReady?.params?.html).toContain(`frame-src 'none'`);
      expect(brokerRuntime.mountedHtml).toBe(resourceReady?.params?.html);
      expect(brokerRuntime.innerSandbox).toBe(MCP_APP_OPAQUE_DOCUMENT_SANDBOX);
      expect(brokerRuntime.brokerMessages.some((message) => (
        (message as { type?: unknown }).type === 'broker.ready'
      ))).toBe(true);
      expect(outbound.some((message) => (
        String((message as { method?: unknown }).method).includes('tool-input')
      ))).toBe(false);

      brokerRuntime.sendAppMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: {
          appInfo: { name: 'mounted-fixture', version: '1' },
          appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
          protocolVersion: '2026-01-26',
        },
      });
      await act(async () => { await Promise.resolve(); });
      expect(outbound.some((message) => (
        String((message as { method?: unknown }).method).includes('tool-input')
      ))).toBe(false);
      brokerRuntime.sendAppMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(outbound.filter((message) => (
        (message as { method?: unknown }).method === 'ui/notifications/tool-input'
      ))).toHaveLength(1);
      expect(outbound.filter((message) => (
        (message as { method?: unknown }).method === 'ui/notifications/tool-result'
      ))).toHaveLength(1);

      let injected = false;
      dom.setIframeAttributeHook((node, name, value) => {
        if (injected || node !== frame || name !== 'title' || value !== 'second-tool') return;
        injected = true;
        brokerRuntime?.sendAppMessage({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: { name: 'tldraw.refresh', arguments: {} },
        });
      });
      const second = {
        ...first,
        title: 'second-tool',
        binding: { ...first.binding, toolKey: 'tldraw_second_tool' },
      };
      await act(async () => {
        root.render(React.createElement(McpAppRenderer, {
          envelope: second,
          directory: '/workspace/a',
          sessionId: 'ses_1',
          messageId: 'msg_1',
          partId: 'prt_2',
        }));
        await Promise.resolve();
      });
      expect(injected).toBe(true);
      expect(toolCalls).toHaveLength(0);
      // The second resource request is deliberately unresolved. The renderer
      // must retain the old frame only for teardown instead of mounting its
      // HTML under the replacement part/tool authority.
      expect(resourceCalls).toHaveLength(2);
      expect(dom.find('iframe')).toBe(frame);
      expect(frame.getAttribute('aria-hidden')).toBe('true');
      const teardown = outbound.find((message) => (
        (message as { method?: unknown }).method === 'ui/resource-teardown'
      )) as { id?: string | number } | undefined;
      if (teardown?.id !== undefined) {
        expect(frame.src).not.toBe('');
        expect(dom.removalEvents).not.toContain('remove:IFRAME');
        dom.removalEvents.push('teardown:response');
        brokerRuntime.sendAppMessage({ jsonrpc: '2.0', id: teardown.id, result: {} });
        await act(async () => { await Promise.resolve(); });
      }
      expect(frame.src).toBe('');
      expect(dom.removalEvents.indexOf('remove:IFRAME')).toBeGreaterThan(
        dom.removalEvents.indexOf('teardown:response'),
      );
      brokerRuntime.restore();
      brokerRuntime = null;

      await act(async () => {
        resolveSecondResource({
          html: '<!doctype html><main>Replacement App</main>',
          mimeType: 'text/html;profile=mcp-app',
          sha256: 'sha256:replacement-app',
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(dom.find('iframe')).not.toBeNull();

      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      mounted = false;
      const teardownPost = dom.removalEvents.findIndex((event) => event === 'post:ui/resource-teardown');
      const dialogRemoval = dom.removalEvents.findIndex((event) => event === 'remove:DIALOG');
      expect(teardownPost).toBeGreaterThanOrEqual(0);
      expect(dialogRemoval).toBeGreaterThan(teardownPost);
    } finally {
      if (mounted) {
        await act(async () => { root.unmount(); });
      }
      client.getMcpAppResource = originalResource;
      client.callMcpAppTool = originalToolCall;
      brokerRuntime?.restore();
      dom.restore();
    }
  });

  test('fails closed after the generated verified App document navigates a second time', async () => {
    const dom = installMountedRendererDom();
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const client = opencodeClient as unknown as {
      getMcpAppResource: (...args: unknown[]) => Promise<unknown>;
    };
    const originalResource = client.getMcpAppResource;
    client.getMcpAppResource = async () => ({
      html: '<!doctype html><main>Navigation fixture</main>',
      mimeType: 'text/html;profile=mcp-app',
      sha256: 'sha256:navigation-fixture',
    });
    const binding = parseMcpAppBinding({
      mcpApp: {
        server: 'tldraw',
        tool: 'tldraw_open_canvas',
        toolKey: 'tldraw_tldraw_open_canvas',
        resourceUri: 'ui://tldraw/canvas.html',
        meta: {
          resourceUri: 'ui://tldraw/canvas.html',
          csp: {
            resourceDomains: ['data:'],
            connectDomains: [],
          },
        },
      },
    });
    if (!binding) throw new Error('expected binding');
    const envelope = createMcpAppResultEnvelope({
      binding,
      toolInput: { canvasId: 'navigation' },
      toolOutput: 'ready',
      metadata: {},
    });
    let mounted = true;
    let runtime: ReturnType<typeof executeMountedGeneratedBrokerRuntime> | null = null;
    try {
      await act(async () => {
        root.render(React.createElement(McpAppRenderer, {
          envelope,
          directory: '/workspace/navigation',
          sessionId: 'ses_navigation',
          messageId: 'msg_navigation',
          partId: 'prt_navigation',
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
      const frame = dom.find('iframe');
      if (!frame?.contentWindow) throw new Error('real renderer did not mount its proxy iframe');
      runtime = executeMountedGeneratedBrokerRuntime(dom, frame);
      expect(runtime.mountedHtml).toContain('Navigation fixture');
      expect(runtime.brokerMessages.some((message) => (
        (message as { type?: unknown }).type === 'broker.ready'
      ))).toBe(true);

      runtime.sendAppMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: {
          appInfo: { name: 'navigation-fixture', version: '1' },
          appCapabilities: { availableDisplayModes: ['inline'] },
          protocolVersion: '2026-01-26',
        },
      });
      runtime.sendAppMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      runtime.triggerSecondNavigation();
      expect(runtime.innerRemoved).toBe(true);
      expect(runtime.brokerMessages.some((message) => {
        const candidate = message as { type?: unknown; reason?: unknown };
        return candidate.type === 'broker.invalidated' && candidate.reason === 'navigation';
      })).toBe(true);
      const outbound = dom.outbound.get(frame.contentWindow) ?? [];
      const teardown = outbound.find((message) => (
        (message as { method?: unknown }).method === 'ui/resource-teardown'
      )) as { id?: string | number } | undefined;
      expect(teardown?.id).toBeDefined();
      expect(frame.src).not.toBe('');
      expect(dom.removalEvents).not.toContain('remove:IFRAME');
      if (teardown?.id !== undefined) {
        dom.removalEvents.push('teardown:response');
        // The Broker is intentionally closed after unexpected navigation, so
        // emulate the already-posted AppBridge response at the exact outer
        // window boundary only to complete React's bounded cleanup transaction.
        dom.dispatchMessage(frame.contentWindow, {
          jsonrpc: '2.0',
          id: teardown.id,
          result: {},
        });
        await act(async () => { await Promise.resolve(); });
      }
      expect(frame.src).toBe('');
      expect(dom.removalEvents.indexOf('remove:IFRAME')).toBeGreaterThan(
        dom.removalEvents.indexOf('teardown:response'),
      );

      await act(async () => { root.unmount(); });
      mounted = false;
    } finally {
      if (mounted) await act(async () => { root.unmount(); });
      runtime?.restore();
      client.getMcpAppResource = originalResource;
      dom.restore();
    }
  });
});
