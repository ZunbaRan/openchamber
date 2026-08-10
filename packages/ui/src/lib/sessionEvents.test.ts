import { afterEach, describe, expect, test } from 'bun:test';

import { MAX_COMPOSER_PREFILL_TEXT_LENGTH, sessionEvents } from './sessionEvents';

type PrefillRequest = Parameters<typeof sessionEvents.requestComposerPrefill>[0];

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    dispose?.();
  }
});

describe('sessionEvents composer prefill contract', () => {
  test('delivers a request with the exact text and an optional sessionId', () => {
    const received: Array<{ sessionId?: string; text: string }> = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        received.push(request);
      }),
    );

    sessionEvents.requestComposerPrefill({ sessionId: 'session-1', text: 'Summarize the diff' });
    sessionEvents.requestComposerPrefill({ text: 'Without a session' });

    expect(received).toEqual([
      { sessionId: 'session-1', text: 'Summarize the diff' },
      { text: 'Without a session' },
    ]);
  });

  test('preserves valid text exactly without trimming', () => {
    const received: string[] = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        received.push(request.text);
      }),
    );

    sessionEvents.requestComposerPrefill({ text: '  keep surrounding spaces  ' });

    expect(received).toEqual(['  keep surrounding spaces  ']);
  });

  test('returns a disposer that stops future delivery', () => {
    const received: string[] = [];
    const dispose = sessionEvents.onComposerPrefillRequest((request) => {
      received.push(request.text);
    });

    sessionEvents.requestComposerPrefill({ text: 'first' });
    dispose();
    sessionEvents.requestComposerPrefill({ text: 'second' });

    expect(received).toEqual(['first']);
  });

  test('unsubscribing one listener leaves the others active', () => {
    const first: string[] = [];
    const second: string[] = [];
    const disposeFirst = sessionEvents.onComposerPrefillRequest((request) => {
      first.push(request.text);
    });
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        second.push(request.text);
      }),
    );

    sessionEvents.requestComposerPrefill({ text: 'shared' });
    disposeFirst();
    sessionEvents.requestComposerPrefill({ text: 'after' });

    expect(first).toEqual(['shared']);
    expect(second).toEqual(['shared', 'after']);
  });

  test('delivers to listeners in subscription order', () => {
    const order: string[] = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        order.push('first');
      }),
    );
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        order.push('second');
      }),
    );

    sessionEvents.requestComposerPrefill({ text: 'ordered' });

    expect(order).toEqual(['first', 'second']);
  });

  test('drops empty and whitespace-only text payloads', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    sessionEvents.requestComposerPrefill({ sessionId: 'session-1', text: '' });
    sessionEvents.requestComposerPrefill({ text: '   ' });
    sessionEvents.requestComposerPrefill({ text: '\n\t' });

    expect(calls).toBe(0);
  });

  test('rejects null, non-object, and malformed payloads without invoking listeners', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    sessionEvents.requestComposerPrefill(null as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill(undefined as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill('text' as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill(42 as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill(['text'] as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ text: 'ok', extra: 'key' } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({} as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ sessionId: 'session-1' } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill(new Date() as unknown as PrefillRequest);

    expect(calls).toBe(0);
  });

  test('rejects non-string text without invoking listeners', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    sessionEvents.requestComposerPrefill({ text: 42 } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ text: null } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ text: { nested: true } } as unknown as PrefillRequest);

    expect(calls).toBe(0);
  });

  test('rejects oversized text and accepts the boundary length', () => {
    const received: string[] = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        received.push(request.text);
      }),
    );

    sessionEvents.requestComposerPrefill({ text: 'x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH) });
    sessionEvents.requestComposerPrefill({ text: 'x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH + 1) });

    expect(received).toEqual(['x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH)]);
  });

  test('rejects invalid sessionId without invoking listeners', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    sessionEvents.requestComposerPrefill({ sessionId: '', text: 'ok' } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ sessionId: 'x'.repeat(129), text: 'ok' } as unknown as PrefillRequest);
    sessionEvents.requestComposerPrefill({ sessionId: 7, text: 'ok' } as unknown as PrefillRequest);

    expect(calls).toBe(0);
  });

  test('fails closed on accessors and hostile proxies without throwing or rereading', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    let getterReads = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'text', {
      get() {
        getterReads += 1;
        return getterReads === 1 ? 'ok' : 'x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH + 1);
      },
    });
    expect(() => sessionEvents.requestComposerPrefill(accessor as unknown as PrefillRequest)).not.toThrow();
    expect(getterReads).toBe(0);

    const throwingTraps = new Proxy({}, {
      ownKeys() {
        return ['text'];
      },
      getOwnPropertyDescriptor() {
        throw new Error('hostile descriptor trap');
      },
      get() {
        throw new Error('hostile get trap');
      },
    });
    expect(() => sessionEvents.requestComposerPrefill(throwingTraps as unknown as PrefillRequest)).not.toThrow();

    expect(calls).toBe(0);
  });

  test('rejects symbol keys and non-enumerable fields without invoking listeners', () => {
    let calls = 0;
    disposers.push(
      sessionEvents.onComposerPrefillRequest(() => {
        calls += 1;
      }),
    );

    const withSymbol: Record<PropertyKey, unknown> = { text: 'ok' };
    withSymbol[Symbol('extra')] = 'ignored';
    sessionEvents.requestComposerPrefill(withSymbol as unknown as PrefillRequest);

    const nonEnumerable: Record<string, unknown> = { sessionId: 'session-1' };
    Object.defineProperty(nonEnumerable, 'text', { value: 'hidden', enumerable: false });
    sessionEvents.requestComposerPrefill(nonEnumerable as unknown as PrefillRequest);

    expect(calls).toBe(0);
  });

  test('captures own data values exactly once from a stateful proxy', () => {
    let getReads = 0;
    const target = { text: 'own value', sessionId: 'session-1' };
    const stateful = new Proxy(target, {
      get(proxyTarget, property) {
        getReads += 1;
        if (property === 'text') {
          return getReads === 1 ? 'first read' : 'x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH + 1);
        }
        return Reflect.get(proxyTarget, property);
      },
    });
    const received: Array<{ sessionId?: string; text: string }> = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        received.push(request);
      }),
    );

    sessionEvents.requestComposerPrefill(stateful as unknown as PrefillRequest);

    expect(getReads).toBe(0);
    expect(received).toEqual([{ sessionId: 'session-1', text: 'own value' }]);
  });

  test('reads each descriptor exactly once from a stateful descriptor proxy', () => {
    let ownKeysCalls = 0;
    let descriptorReads = 0;
    const target = { text: 'own value', sessionId: 'session-1' };
    const stateful = new Proxy(target, {
      ownKeys(proxyTarget) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(proxyTarget);
      },
      getOwnPropertyDescriptor(proxyTarget, property) {
        descriptorReads += 1;
        const descriptor = Reflect.getOwnPropertyDescriptor(proxyTarget, property);
        if (descriptor && property === 'text') {
          // First read returns a valid value; any later read would be
          // oversized and must never be observed.
          return {
            ...descriptor,
            value: descriptorReads === 1 ? 'first snapshot' : 'x'.repeat(MAX_COMPOSER_PREFILL_TEXT_LENGTH + 1),
          };
        }
        return descriptor;
      },
    });
    const received: Array<{ sessionId?: string; text: string }> = [];
    disposers.push(
      sessionEvents.onComposerPrefillRequest((request) => {
        received.push(request);
      }),
    );

    sessionEvents.requestComposerPrefill(stateful as unknown as PrefillRequest);

    expect(ownKeysCalls).toBe(1);
    expect(descriptorReads).toBe(2);
    expect(received).toEqual([{ sessionId: 'session-1', text: 'first snapshot' }]);
  });
});
