import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('SettingsWindow native surface occlusion', () => {
  test('marks its full-window backdrop as an Electron native-surface occluder', () => {
    const source = readFileSync(fileURLToPath(new URL('./SettingsWindow.tsx', import.meta.url)), 'utf8');
    const backdrop = source.match(/<Dialog\.Backdrop[\s\S]*?\/>/)?.[0] ?? '';

    expect(backdrop).toContain('data-oc-native-surface-occluder="true"');
  });
});
