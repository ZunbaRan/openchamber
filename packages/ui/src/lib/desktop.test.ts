import { describe, expect, test } from 'bun:test';

import {
  canUseTrustedDesktopFileIPC,
  DEFAULT_DESKTOP_WINDOW_CONTROLS_POSITION,
  isBrowserClientRuntime,
  listenDesktopEvent,
  normalizeDesktopDockIconVariant,
  normalizeDesktopWindowControlsPosition,
  saveDesktopBinaryFile,
} from './desktop';

describe('browser client runtime', () => {
  test('uses browser file behavior only outside the Electron shell', () => {
    expect(isBrowserClientRuntime('web', false)).toBe(true);
    expect(isBrowserClientRuntime('web', true)).toBe(false);
  });

  test('keeps desktop and VS Code runtime behavior out of browser-only flows', () => {
    expect(isBrowserClientRuntime('desktop', false)).toBe(false);
    expect(isBrowserClientRuntime('vscode', false)).toBe(false);
  });
});

describe('fork desktop adapters', () => {
  test('trusted file IPC stays closed without an Electron shell', () => {
    expect(canUseTrustedDesktopFileIPC()).toBe(false);
  });

  test('binary save is unavailable when the trusted file IPC gate is closed', async () => {
    const outcome = await saveDesktopBinaryFile(
      'artifact.bin',
      'application/octet-stream',
      new Uint8Array([1, 2, 3]),
    );
    expect(outcome).toBe('unavailable');
  });

  test('event listening degrades to a no-op unlisten outside the Electron shell', async () => {
    const unlisten = await listenDesktopEvent('openchamber:test-event', () => {});
    expect(typeof unlisten).toBe('function');
    expect(unlisten()).toBe(undefined);
  });

  test('coexists with upstream v1.18.1 window-control normalization defaults', () => {
    expect(normalizeDesktopWindowControlsPosition('auto')).toBe(
      DEFAULT_DESKTOP_WINDOW_CONTROLS_POSITION,
    );
    expect(normalizeDesktopWindowControlsPosition('left')).toBe('left');
    expect(normalizeDesktopWindowControlsPosition('right')).toBe('right');
    expect(normalizeDesktopWindowControlsPosition('unknown')).toBe(undefined);
  });

  test('defaults persisted Dock icon values to the black variant', () => {
    expect(normalizeDesktopDockIconVariant(undefined)).toBe('black');
    expect(normalizeDesktopDockIconVariant('unknown')).toBe('black');
    expect(normalizeDesktopDockIconVariant('black')).toBe('black');
    expect(normalizeDesktopDockIconVariant('ice')).toBe('ice');
  });
});
