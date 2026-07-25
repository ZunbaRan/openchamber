import { describe, expect, test } from 'bun:test';
import { useUpdateStore } from './useUpdateStore';

describe('desktop update policy', () => {
  test('does not invoke native or web update checks when the desktop build disables updates', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const invokedCommands: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'openchamber-ui:' },
        __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
        __OPENCHAMBER_DESKTOP__: {
          updatesEnabled: false,
          invoke: async (command: string) => {
            invokedCommands.push(command);
            return null;
          },
        },
      },
    });

    try {
      useUpdateStore.getState().reset();
      const nextCheck = await useUpdateStore.getState().checkForUpdates();
      const state = useUpdateStore.getState();
      expect(nextCheck).toBeNull();
      expect(invokedCommands).toEqual([]);
      expect(state.runtimeType).toBe('desktop');
      expect(state.available).toBe(false);
      expect(state.info).toBeNull();
      expect(state.error).toBeNull();
    } finally {
      useUpdateStore.getState().reset();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  test('uses only the native fork updater when desktop updates are enabled', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const invokedCommands: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'openchamber-ui:' },
        __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
        __OPENCHAMBER_DESKTOP__: {
          updatesEnabled: true,
          invoke: async (command: string) => {
            invokedCommands.push(command);
            return command === 'desktop_check_for_updates'
              ? {
                updatesEnabled: true,
                available: true,
                currentVersion: '1.16.3',
                version: '1.16.4',
                body: 'Fork release',
              }
              : null;
          },
        },
      },
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { throw new Error('Desktop update checks must not call the web update API'); },
    });

    try {
      useUpdateStore.getState().reset();
      const nextCheck = await useUpdateStore.getState().checkForUpdates();
      const state = useUpdateStore.getState();
      expect(nextCheck).toBeNull();
      expect(invokedCommands).toEqual(['desktop_check_for_updates']);
      expect(state.runtimeType).toBe('desktop');
      expect(state.available).toBe(true);
      expect(state.info?.version).toBe('1.16.4');
      expect(state.info?.body).toBe('Fork release');
      expect(state.error).toBeNull();
    } finally {
      useUpdateStore.getState().reset();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
      else Reflect.deleteProperty(globalThis, 'fetch');
    }
  });
});
