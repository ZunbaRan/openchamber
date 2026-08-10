import { describe, expect, test } from 'bun:test';
import {
  createHTMLArtifactBridgeRateLimiter,
  createHTMLArtifactBusinessResultMessage,
  createHTMLArtifactHostInitMessage,
  isHTMLArtifactBrokerNavigationMessage,
  parseHTMLArtifactBridgeMessage,
} from './artifactBridge';
import type { HTMLArtifactBusinessResultMessage } from './artifactBridge';

const message = (overrides: Record<string, unknown> = {}) => ({
  source: 'openchamber-artifact',
  direction: 'artifact-to-host',
  bridgeVersion: 1,
  channelId: 'channel-1',
  sequence: 1,
  type: 'artifact.resize',
  payload: { height: 480 },
  ...overrides,
});

const businessRequestMessage = (payload: unknown) => message({
  type: 'artifact.businessRequest',
  payload,
});

describe('HTML Artifact bridge parser', () => {
  test('builds a bounded host init snapshot with the current viewport and theme context', () => {
    expect(createHTMLArtifactHostInitMessage({
      channelId: 'channel-1',
      mode: 'inline',
      locale: 'zh-CN',
      timezone: 'Asia/Singapore',
      reducedMotion: true,
      theme: 'dark',
      tokens: { '--ocix-surface': '#111' },
      viewport: { width: 680, height: 420 },
    })).toEqual({
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: 1,
      channelId: 'channel-1',
      sequence: 1,
      type: 'host.init',
      payload: {
        mode: 'inline',
        locale: 'zh-CN',
        timezone: 'Asia/Singapore',
        reducedMotion: true,
        theme: 'dark',
        tokens: { '--ocix-surface': '#111' },
        viewport: { width: 680, height: 420 },
      },
    });
  });

  test('accepts a strict message on the active channel', () => {
    expect(parseHTMLArtifactBridgeMessage(message(), 'channel-1', 0)).toEqual({
      type: 'artifact.resize',
      payload: { height: 480 },
      sequence: 1,
    });
  });

  test('accepts only a channel-bound execution heartbeat payload', () => {
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.heartbeat',
      payload: { leaseId: 'lease-1' },
    }), 'channel-1', 0)).toEqual({
      type: 'artifact.heartbeat',
      payload: { leaseId: 'lease-1' },
      sequence: 1,
    });
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.heartbeat',
      payload: { leaseId: 'lease-1', privileged: true },
    }), 'channel-1', 0)).toBeNull();
  });

  test('rejects forged channels, replayed sequences, unknown fields and oversized payloads', () => {
    expect(parseHTMLArtifactBridgeMessage(message(), 'another-channel', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message(), 'channel-1', 1)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({ privileged: true }), 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.copyText',
      payload: { text: 'x'.repeat(9_000) },
    }), 'channel-1', 0)).toBeNull();
  });

  test('rejects non-http links and host capability requests', () => {
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.openExternal',
      payload: { url: 'javascript:alert(1)' },
    }), 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.callTool',
      payload: { tool: 'bash' },
    }), 'channel-1', 0)).toBeNull();
  });

  test('allows business requests only for installed third-party Artifacts', () => {
    const request = businessRequestMessage({
      requestId: 'request-1',
      intent: 'query',
      action: 'com.demo.crm.list',
      input: { stage: 'qualified' },
    });
    expect(parseHTMLArtifactBridgeMessage(request, 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(request, 'channel-1', 0, { allowBusiness: true })).toEqual({
      type: 'artifact.businessRequest',
      payload: {
        requestId: 'request-1',
        intent: 'query',
        action: 'com.demo.crm.list',
        input: { stage: 'qualified' },
      },
      sequence: 1,
    });
    expect(parseHTMLArtifactBridgeMessage(businessRequestMessage({
      requestId: 'request-1', intent: 'query', action: 'invalid', input: {},
    }), 'channel-1', 0, { allowBusiness: true })).toBeNull();
  });

  test('allows bounded dashboard events only for installed third-party Artifacts', () => {
    const dashboardEvent = message({
      type: 'artifact.dashboardEvent',
      payload: {
        eventId: 'customer.selected',
        payload: { customerId: 'cust-1001' },
      },
    });
    expect(parseHTMLArtifactBridgeMessage(dashboardEvent, 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(
      dashboardEvent,
      'channel-1',
      0,
      { allowBusiness: true },
    )).toEqual({
      type: 'artifact.dashboardEvent',
      payload: {
        eventId: 'customer.selected',
        payload: { customerId: 'cust-1001' },
      },
      sequence: 1,
    });
  });

  test('builds a channel-bound business result without exposing host internals', () => {
    expect(createHTMLArtifactBusinessResultMessage({
      channelId: 'channel-1',
      requestId: 'request-1',
      ok: true,
      data: { total: 3 },
    })).toEqual({
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: 1,
      channelId: 'channel-1',
      sequence: 1,
      type: 'host.businessResult',
      payload: { requestId: 'request-1', ok: true, data: { total: 3 } },
    });
  });

  test('accepts only the strict broker navigation signal on the active channel', () => {
    const brokerMessage = {
      source: 'openchamber-artifact-broker',
      direction: 'broker-to-host',
      bridgeVersion: 1,
      channelId: 'channel-1',
      type: 'broker.navigationBlocked',
      payload: {},
    };
    expect(isHTMLArtifactBrokerNavigationMessage(brokerMessage, 'channel-1')).toBe(true);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, channelId: 'forged' }, 'channel-1')).toBe(false);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, privileged: true }, 'channel-1')).toBe(false);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, payload: { url: 'https://example.com' } }, 'channel-1')).toBe(false);
  });

  test('bounds total messages and resize floods in independent rolling windows', () => {
    const limiter = createHTMLArtifactBridgeRateLimiter({ messageLimit: 3, resizeLimit: 2 });
    expect(limiter.allowMessage(0)).toBe(true);
    expect(limiter.allowMessage(10)).toBe(true);
    expect(limiter.allowMessage(20)).toBe(true);
    expect(limiter.allowMessage(30)).toBe(false);
    expect(limiter.allowResize(30)).toBe(true);
    expect(limiter.allowResize(40)).toBe(true);
    expect(limiter.allowResize(50)).toBe(false);
    expect(limiter.allowMessage(1_000)).toBe(true);
    expect(limiter.allowResize(1_030)).toBe(true);
    limiter.reset();
    expect(limiter.allowMessage(1_031)).toBe(true);
    expect(limiter.allowResize(1_031)).toBe(true);
  });
});

describe('HTML Artifact bridge bounded JSON counter', () => {
  const parseWithInput = (input: unknown) => parseHTMLArtifactBridgeMessage(
    businessRequestMessage({
      requestId: 'request-1',
      intent: 'query',
      action: 'com.demo.crm.list',
      input,
    }),
    'channel-1',
    0,
    { allowBusiness: true },
  );

  test('accepts a nested input at the exact 48 KiB boundary and rejects one byte over', () => {
    // A bare string of N ASCII chars serialises to 2 + N JSON bytes.
    // N = 49150 -> 49_152 (exact cap); N = 49151 -> 49_153 (rejected).
    expect(parseWithInput('a'.repeat(49_150))).not.toBeNull();
    expect(parseWithInput('a'.repeat(49_151))).toBeNull();
  });

  test('counts multibyte UTF-8 exactly at the boundary (2-byte chars)', () => {
    // 'é' (U+00E9) is 2 UTF-8 bytes: JSON bytes = 2 + 2N.
    // N = 24575 -> 2 + 49_150 = 49_152 (exact cap, accepted).
    expect(parseWithInput('é'.repeat(24_575))).not.toBeNull();
    expect(parseWithInput('é'.repeat(24_576))).toBeNull();
  });

  test('counts 4-byte astral characters per surrogate pair', () => {
    // U+1F600 is a surrogate pair serialised as 4 UTF-8 bytes: JSON = 2 + 4N.
    // N = 12287 -> 49_150 (under cap, accepted); N = 12288 -> 49_154 (rejected).
    expect(parseWithInput('😀'.repeat(12_287))).not.toBeNull();
    expect(parseWithInput('😀'.repeat(12_288))).toBeNull();
  });

  test('fails closed on cyclic inputs without recursing forever', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(parseWithInput(cyclic)).toBeNull();
  });

  test('fails closed on accessor inputs without reading the getter', () => {
    let accessorRead = false;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get: () => { accessorRead = true; return 'x'; },
    });
    expect(parseWithInput(accessor)).toBeNull();
    expect(accessorRead).toBe(false);
  });

  test('fails closed on deeply nested, non-plain, bigint and non-finite inputs', () => {
    let deep: unknown = [];
    for (let i = 0; i < 1_100; i++) deep = [deep];
    expect(parseWithInput(deep)).toBeNull();
    expect(parseWithInput(new Date(0))).toBeNull();
    expect(parseWithInput({ n: 10n })).toBeNull();
    expect(parseWithInput({ n: Infinity })).toBeNull();
    expect(parseWithInput({ n: NaN })).toBeNull();
  });

  test('short-circuits before reading a large trailing property once the cap is exceeded', () => {
    let trailingRead = false;
    const input: Record<string, unknown> = {
      // 50_002 bytes alone already exceeds the 48 KiB input cap but keeps the
      // whole business message under the 64 KiB whole-message cap.
      big: 'x'.repeat(50_000),
    };
    Object.defineProperty(input, 'trailing', {
      enumerable: true,
      get: () => { trailingRead = true; return 1; },
    });
    expect(parseWithInput(input)).toBeNull();
    expect(trailingRead).toBe(false);
  });

  test('rejects oversized whole messages before validating any content', () => {
    // copyText text is size-bounded per field, but the whole-message 8 KiB cap
    // must also reject a message whose total JSON exceeds it.
    const oversized = message({
      type: 'artifact.copyText',
      payload: { text: 'x'.repeat(7_500), extra: 'y'.repeat(2_000) },
    });
    expect(parseHTMLArtifactBridgeMessage(oversized, 'channel-1', 0)).toBeNull();
  });
});

describe('HTML Artifact host init and business result safe builders', () => {
  test('preserves a safe bounded untrusted context in host init', () => {
    const context = { customerId: 'cust-1', tags: ['a', 'b'] };
    const built = createHTMLArtifactHostInitMessage(baseInit({ context }));
    expect(built).not.toBeNull();
    expect(built!.payload.context).toEqual(context);
    expect(built!.payload.tokens).toEqual({ '--x': 'y' });
  });

  test('rejects an oversized untrusted context (no partial host init)', () => {
    const context = { payload: 'x'.repeat(300 * 1024) };
    const built = createHTMLArtifactHostInitMessage({
      channelId: 'channel-1',
      mode: 'inline',
      locale: 'en',
      timezone: 'UTC',
      reducedMotion: false,
      theme: 'light',
      tokens: { '--x': 'y' },
      viewport: { width: 100, height: 100 },
      context,
    });
    expect(built).toBeNull();
  });

  test('rejects a cyclic or accessor context (no partial host init)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(createHTMLArtifactHostInitMessage(baseInit({ context: cyclic }))).toBeNull();

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'x', { enumerable: true, get: () => 'y' });
    expect(createHTMLArtifactHostInitMessage(baseInit({ context: accessor }))).toBeNull();
  });

  test('rejects invalid oversized tokens (no partial host init)', () => {
    expect(createHTMLArtifactHostInitMessage(baseInit({
      tokens: { ['--big']: 'x'.repeat(MAX_HOST_INIT_TOKEN_VALUE_CHARS + 1) },
    }))).toBeNull();
  });

  test('rejects host init with invalid required structural inputs', () => {
    expect(createHTMLArtifactHostInitMessage(baseInit({ channelId: '' }))).toBeNull();
    expect(createHTMLArtifactHostInitMessage(baseInit({ viewport: { width: 10.5, height: 20 } }))).toBeNull();
    expect(createHTMLArtifactHostInitMessage(baseInit({
      executionLease: { id: 'l', expiresAt: 0, heartbeatIntervalMs: 0 },
    }))).toBeNull();
    expect(createHTMLArtifactHostInitMessage(baseInit({ mode: 'bogus' as never }))).toBeNull();
  });

  test('returns a bounded ok:false result for invalid or oversized success data', () => {
    const base = { channelId: 'channel-1', requestId: 'request-1' };
    const payload = (result: HTMLArtifactBusinessResultMessage | null) =>
      (result!.payload as { requestId: string; ok: boolean; error?: string; code?: string });
    const oversized = createHTMLArtifactBusinessResultMessage({
      ...base,
      ok: true,
      data: { big: 'x'.repeat(70 * 1024) },
    });
    expect(oversized).not.toBeNull();
    expect(payload(oversized)).toEqual({
      requestId: 'request-1',
      ok: false,
      error: 'Business result data is invalid',
      code: 'business_result_invalid',
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(payload(createHTMLArtifactBusinessResultMessage({ ...base, ok: true, data: cyclic })).ok).toBe(false);
    expect(payload(createHTMLArtifactBusinessResultMessage({ ...base, ok: true, data: cyclic })).code).toBe('business_result_invalid');
    const fromInfinity = createHTMLArtifactBusinessResultMessage({ ...base, ok: true, data: { n: Infinity } });
    expect(payload(fromInfinity).ok).toBe(false);
    expect(payload(fromInfinity).requestId).toBe('request-1');
  });

  test('rejects business results with invalid required inputs', () => {
    expect(createHTMLArtifactBusinessResultMessage({ channelId: '', requestId: 'r', ok: true })).toBeNull();
    expect(createHTMLArtifactBusinessResultMessage({ channelId: 'c', requestId: '', ok: true })).toBeNull();
    expect(createHTMLArtifactBusinessResultMessage({ channelId: 'c', requestId: 'r', ok: 'yes' as never })).toBeNull();
  });

  test('builds a bounded failure result with a bounded error and code', () => {
    expect(createHTMLArtifactBusinessResultMessage({
      channelId: 'channel-1',
      requestId: 'request-1',
      ok: false,
      error: 'Business API is unavailable for this Artifact',
      code: 'business_api_unavailable',
    })).toEqual({
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: 1,
      channelId: 'channel-1',
      sequence: 1,
      type: 'host.businessResult',
      payload: {
        requestId: 'request-1',
        ok: false,
        error: 'Business API is unavailable for this Artifact',
        code: 'business_api_unavailable',
      },
    });
  });

  test('accepts an exact-cap success data payload and bounds the complete message', () => {
    const base = { channelId: 'channel-1', requestId: 'request-1', ok: true as const };
    // A bare string of N ASCII chars serialises to 2 + N JSON bytes.
    // N = 65534 -> 65_536 (exact 64 KiB data cap); N = 65535 -> 65_537 (rejected).
    const exact = createHTMLArtifactBusinessResultMessage({
      ...base,
      data: 'a'.repeat(65_534),
    });
    expect(exact).not.toBeNull();
    expect(exact!.payload.ok).toBe(true);
    expect((exact!.payload as { data: unknown }).data).toBe('a'.repeat(65_534));
    // One byte over the data cap yields a bounded ok:false result, never null
    // (a null frame would leave the Artifact request hanging).
    const over = createHTMLArtifactBusinessResultMessage({
      ...base,
      data: 'a'.repeat(65_535),
    });
    expect(over).not.toBeNull();
    expect(over!.payload.ok).toBe(false);
    expect((over!.payload as { code?: string }).code).toBe('business_result_invalid');
    expect((over!.payload as { requestId: string }).requestId).toBe('request-1');
  });
});

describe('HTML Artifact bridge atomic snapshot (issue-023 regressions)', () => {
  const parseWithInput = (input: unknown) => parseHTMLArtifactBridgeMessage(
    businessRequestMessage({
      requestId: 'request-1',
      intent: 'query',
      action: 'com.demo.crm.list',
      input,
    }),
    'channel-1',
    0,
    { allowBusiness: true },
  );

  const arrayWithLargeExpando = () => {
    const arr: unknown[] = ['ok'];
    Object.defineProperty(arr, 'extra', { enumerable: true, value: 'x'.repeat(100_000) });
    return arr;
  };

  test('cannot bypass business-input bounds with a 100k-character array expando', () => {
    // structuredClone/postMessage would preserve `.extra`, but the snapshot must
    // reject any array carrying an enumerable non-index expando.
    expect(parseWithInput(arrayWithLargeExpando())).toBeNull();
    expect(parseWithInput(['ok'])).not.toBeNull();
  });

  test('cannot bypass host-context bounds with a 100k-character array expando', () => {
    // An unsafe context now fails the whole host init (no partial init).
    expect(createHTMLArtifactHostInitMessage(baseInit({ context: arrayWithLargeExpando() }))).toBeNull();
  });

  test('cannot bypass business-result bounds with a 100k-character array expando', () => {
    const result = createHTMLArtifactBusinessResultMessage({
      channelId: 'channel-1',
      requestId: 'request-1',
      ok: true,
      data: arrayWithLargeExpando(),
    });
    expect(result).not.toBeNull();
    expect(result!.payload.ok).toBe(false);
    expect((result!.payload as { code?: string }).code).toBe('business_result_invalid');
  });

  test('fails closed on custom prototypes and own toJSON helpers', () => {
    expect(parseWithInput(Object.create({ inherited: 1 }))).toBeNull();
    const withToJSON: Record<string, unknown> = { a: 1 };
    withToJSON.toJSON = () => 'huge';
    expect(parseWithInput(withToJSON)).toBeNull();
    const arrToJSON: unknown[] = [1];
    (arrToJSON as { toJSON?: unknown }).toJSON = () => 'huge';
    expect(parseWithInput(arrToJSON)).toBeNull();
    // Non-canonical index keys are not valid array data.
    const arrayWithNonIndex = ['ok'];
    Object.defineProperty(arrayWithNonIndex, '1.5', { enumerable: true, value: 'x' });
    expect(parseWithInput(arrayWithNonIndex)).toBeNull();
  });

  test('accepts ordinary sparse arrays as bounded JSON null holes', () => {
    // A standard-prototype hole with no inherited indexed value serialises as
    // JSON null (donor-compatible), not as a rejection.
    // Built by extending length rather than a sparse literal so the fixture
    // stays a genuine hole (no-sparse-arrays-compliant).
    const sparseInput: unknown[] = [1];
    sparseInput[2] = 3;
    const sparse = parseWithInput(sparseInput);
    expect(sparse).not.toBeNull();
    expect((sparse!.payload as { input: unknown[] }).input).toEqual([1, null, 3]);
    expect(parseWithInput(new Array(3))).not.toBeNull();
  });

  test('rejects sparse holes that resolve to inherited indexed values', () => {
    // A has trap reporting an inherited indexed value at the hole must fail
    // closed rather than undercount the hole as a 4-byte null.
    const sparseInput: unknown[] = [1];
    sparseInput[2] = 3;
    const inheritedHole = new Proxy(sparseInput, {
      has(object, prop) {
        return prop === '1' || Reflect.has(object, prop);
      },
    });
    expect(parseWithInput(inheritedHole)).toBeNull();
  });

  test('captures the payload descriptor value instead of rereading a stateful payload proxy', () => {
    // The Proxy wraps message.payload, NOT the whole message. Its get trap
    // returns a 20k-character text on any direct read, but the snapshot must
    // use the own data descriptor value ('short') captured once, so the
    // accepted message is bounded and never contains the huge value.
    const payloadProxy = new Proxy({ text: 'short' }, {
      get(object, prop, receiver) {
        if (prop === 'text') return 'x'.repeat(20_000);
        return Reflect.get(object, prop, receiver);
      },
    });
    const result = parseHTMLArtifactBridgeMessage(
      message({ type: 'artifact.copyText', payload: payloadProxy }),
      'channel-1',
      0,
    );
    expect(result).not.toBeNull();
    expect((result!.payload as { text: string }).text).toBe('short');
    expect((result!.payload as { text: string }).text.length <= 8_000).toBe(true);
  });

  test('returns null for a revoked proxy instead of throwing', () => {
    const { proxy, revoke } = Proxy.revocable(message(), {});
    revoke();
    expect(parseHTMLArtifactBridgeMessage(proxy, 'channel-1', 0)).toBeNull();
    expect(isHTMLArtifactBrokerNavigationMessage(proxy, 'channel-1')).toBe(false);
  });

  test('rejects a host init whose execution lease carries extra fields', () => {
    const built = createHTMLArtifactHostInitMessage(baseInit({
      executionLease: {
        id: 'lease-1',
        expiresAt: 1_700_000_000_000,
        heartbeatIntervalMs: 5_000,
        injected: 'x'.repeat(3_000_000),
      },
    }));
    expect(built).toBeNull();
  });

  test('reconstructs an exact-key execution lease snapshot in host init', () => {
    const built = createHTMLArtifactHostInitMessage(baseInit({
      executionLease: { id: 'lease-1', expiresAt: 1_700_000_000_000, heartbeatIntervalMs: 5_000 },
    }));
    expect(built).not.toBeNull();
    expect(built!.payload.executionLease).toEqual({
      id: 'lease-1',
      expiresAt: 1_700_000_000_000,
      heartbeatIntervalMs: 5_000,
    });
  });
});

describe('HTML Artifact bridge builder root capture (issue-023 regressions)', () => {
  const statefulChannelIdProxy = (target: Record<string, unknown>) => {
    let reads = 0;
    return new Proxy(target, {
      get(object, prop, receiver) {
        if (prop === 'channelId') {
          reads += 1;
          return reads === 1 ? 'channel-1' : 'x'.repeat(100_000);
        }
        return Reflect.get(object, prop, receiver);
      },
    });
  };

  test('captures a stateful root proxy channelId once in host init', () => {
    const root = statefulChannelIdProxy(baseInit({}));
    const built = createHTMLArtifactHostInitMessage(root as never);
    expect(built).not.toBeNull();
    expect(built!.channelId).toBe('channel-1');
    expect(built!.channelId.length <= 128).toBe(true);
  });

  test('captures a stateful root proxy channelId once in a business result', () => {
    const root = statefulChannelIdProxy({ channelId: 'channel-1', requestId: 'request-1', ok: true, data: { total: 3 } });
    const result = createHTMLArtifactBusinessResultMessage(root as never);
    expect(result).not.toBeNull();
    expect(result!.channelId).toBe('channel-1');
    expect(result!.channelId.length <= 128).toBe(true);
  });

  test('captures a stateful error/code failure input and keeps the result bounded', () => {
    let errorReads = 0;
    const root = new Proxy(
      { channelId: 'channel-1', requestId: 'request-1', ok: false, error: 'short', code: 'c' },
      {
        get(object, prop, receiver) {
          if (prop === 'error') {
            errorReads += 1;
            return errorReads === 1 ? 'short' : 'x'.repeat(100_000);
          }
          return Reflect.get(object, prop, receiver);
        },
      },
    );
    const result = createHTMLArtifactBusinessResultMessage(root as never);
    expect(result).not.toBeNull();
    expect(result!.payload.ok).toBe(false);
    expect((result!.payload as { error: string }).error).toBe('short');
    expect((result!.payload as { error: string }).error.length <= 500).toBe(true);
  });

  test('returns null for a revoked builder input instead of throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ channelId: 'channel-1', requestId: 'request-1', ok: true }, {});
    revoke();
    expect(createHTMLArtifactBusinessResultMessage(proxy as never)).toBeNull();
    const initRevoked = Proxy.revocable(baseInit({}), {});
    initRevoked.revoke();
    expect(createHTMLArtifactHostInitMessage(initRevoked.proxy as never)).toBeNull();
  });

  test('preserves a __proto__ token key as an own data property', () => {
    const built = createHTMLArtifactHostInitMessage(baseInit({
      tokens: { ['__proto__']: 'custom' },
    }));
    expect(built).not.toBeNull();
    const tokens = built!.payload.tokens as Record<string, string>;
    expect(Object.prototype.hasOwnProperty.call(tokens, '__proto__')).toBe(true);
    expect(tokens['__proto__']).toBe('custom');
  });

  test('accepts a large but valid context and keeps the complete host init bounded', () => {
    const context = { data: 'x'.repeat(200 * 1024) };
    const built = createHTMLArtifactHostInitMessage(baseInit({ context }));
    expect(built).not.toBeNull();
    expect((built!.payload.context as { data: string }).data.length).toBe(200 * 1024);
  });
});

describe('HTML Artifact bridge rate limiter bounds (issue-023 regressions)', () => {
  test('keeps message and resize windows independently monotonic', () => {
    const limiter = createHTMLArtifactBridgeRateLimiter({ messageLimit: 5, resizeLimit: 2 });
    expect(limiter.allowMessage(10)).toBe(true);
    expect(limiter.allowResize(1000)).toBe(true); // advances the resize window far ahead
    // With a shared latest timestamp this would be rejected (20 < 1000);
    // independent windows use the message window's own latest timestamp (10).
    expect(limiter.allowMessage(20)).toBe(true);
    expect(limiter.allowMessage(30)).toBe(true);
    expect(limiter.allowResize(1001)).toBe(true); // resize window still independent
  });

  test('fails closed on a revoked or accessor options object without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ messageLimit: 3, resizeLimit: 2 }, {});
    revoke();
    let threw = false;
    let messageAllowed = true;
    let resizeAllowed = true;
    try {
      const limiter = createHTMLArtifactBridgeRateLimiter(proxy as never);
      messageAllowed = limiter.allowMessage(0);
      resizeAllowed = limiter.allowResize(0);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(messageAllowed).toBe(false);
    expect(resizeAllowed).toBe(false);

    const accessorOpts: Record<string, number> = {};
    Object.defineProperty(accessorOpts, 'messageLimit', { enumerable: true, get: () => 3 });
    const accessorLimiter = createHTMLArtifactBridgeRateLimiter(accessorOpts as never);
    expect(accessorLimiter.allowMessage(0)).toBe(false); // accessor capture failed -> deny-all
  });

  test('fails closed on invalid, nonpositive, or too-large configuration', () => {
    for (const invalid of [Infinity, -Infinity, NaN, 0, -1, 1.5, 1_000_001]) {
      const limiter = createHTMLArtifactBridgeRateLimiter({ messageLimit: invalid, resizeLimit: 2 });
      expect(limiter.allowMessage(0)).toBe(false);
    }
    for (const invalid of [null, '3', true, []]) {
      const limiter = createHTMLArtifactBridgeRateLimiter(
        { messageLimit: invalid as never, resizeLimit: 2 },
      );
      expect(limiter.allowMessage(0)).toBe(false);
    }
    expect(createHTMLArtifactBridgeRateLimiter(null as never).allowMessage(0)).toBe(false);
    const resized = createHTMLArtifactBridgeRateLimiter({ messageLimit: 2, resizeLimit: Infinity });
    expect(resized.allowResize(0)).toBe(false);
    expect(resized.allowMessage(0)).toBe(true);
  });

  test('rejects non-finite and backward timestamps without pushing', () => {
    const limiter = createHTMLArtifactBridgeRateLimiter({ messageLimit: 3, resizeLimit: 3 });
    expect(limiter.allowMessage(100)).toBe(true);
    expect(limiter.allowMessage(NaN)).toBe(false);
    expect(limiter.allowMessage(Infinity)).toBe(false);
    expect(limiter.allowMessage(50)).toBe(false); // backward clock
    expect(limiter.allowMessage(100)).toBe(true);
    expect(limiter.allowMessage(100)).toBe(true);
    expect(limiter.allowMessage(100)).toBe(false); // 3 within the window
  });
});

const MAX_HOST_INIT_TOKEN_VALUE_CHARS = 4_096;

const baseInit = (overrides: Record<string, unknown> = {}) => ({
  channelId: 'channel-1',
  mode: 'inline' as const,
  locale: 'en',
  timezone: 'UTC',
  reducedMotion: false,
  theme: 'light' as const,
  tokens: { '--x': 'y' },
  viewport: { width: 100, height: 100 },
  ...overrides,
});
