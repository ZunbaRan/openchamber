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
});
