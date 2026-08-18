import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('./OpenChamberPage.tsx', import.meta.url), 'utf8');
describe('embedded OpenCode desktop settings', () => {
    test('does not expose an external OpenCode CLI configuration section', () => {
        expect(pageSource).not.toContain('OpenCodeCliSettings');
    });
});
