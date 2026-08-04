import { describe, expect, test } from 'bun:test';

import {
  matchesTrustedDesktopFileOrigin,
  saveDesktopBinaryFile,
} from './desktop';

const withDesktopWindow = async <T>(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  callback: () => Promise<T>,
): Promise<T> => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __OPENCHAMBER_DESKTOP__: { invoke },
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:57123',
      location: {
        href: 'http://127.0.0.1:57123/chat',
        origin: 'http://127.0.0.1:57123',
      },
    },
  });
  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'window', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
};

describe('trusted desktop file IPC origins', () => {
  test('accepts the packaged UI and the exact injected sidecar origin', () => {
    expect(matchesTrustedDesktopFileOrigin('openchamber-ui://app/index.html', '')).toBe(true);
    expect(matchesTrustedDesktopFileOrigin(
      'http://127.0.0.1:57123/chat',
      'http://127.0.0.1:57123',
    )).toBe(true);
  });

  test('rejects remote pages and loopback aliases that main IPC does not trust', () => {
    expect(matchesTrustedDesktopFileOrigin(
      'https://remote.example.com/chat',
      'http://127.0.0.1:57123',
    )).toBe(false);
    expect(matchesTrustedDesktopFileOrigin(
      'http://localhost:57123/chat',
      'http://127.0.0.1:57123',
    )).toBe(false);
  });
});

describe('desktop MCP App binary save IPC', () => {
  test('sends request-bound cancellation immediately while native save is pending', async () => {
    const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let resolveSave!: (result: unknown) => void;

    await withDesktopWindow(async (command, args) => {
      invocations.push({ command, args });
      if (command === 'desktop_save_binary_file') {
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return { cancelled: true };
    }, async () => {
      const controller = new AbortController();
      const saving = saveDesktopBinaryFile(
        'canvas.svg',
        'image/svg+xml',
        new TextEncoder().encode('<svg/>'),
        controller.signal,
      );
      await Promise.resolve();

      const requestId = invocations[0]?.args?.requestId;
      expect(typeof requestId).toBe('string');
      controller.abort();

      expect(await saving).toBe('cancelled');
      expect(invocations.map(({ command, args }) => ({ command, requestId: args?.requestId }))).toEqual([
        { command: 'desktop_save_binary_file', requestId },
        { command: 'desktop_cancel_binary_file_save', requestId },
      ]);

      // The abandoned invoke remains observed and may finish after the UI has
      // already returned cancellation; it must not produce an unhandled result.
      resolveSave({ saved: false, cancelled: true });
      await Promise.resolve();
    });
  });

  test('does not start native IPC for an already-aborted request', async () => {
    let invocations = 0;
    await withDesktopWindow(async () => {
      invocations += 1;
      return { saved: true };
    }, async () => {
      const controller = new AbortController();
      controller.abort();
      expect(await saveDesktopBinaryFile(
        'canvas.svg',
        'image/svg+xml',
        new Uint8Array(),
        controller.signal,
      )).toBe('cancelled');
    });
    expect(invocations).toBe(0);
  });
});
