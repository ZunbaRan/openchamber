import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./PromptNavigatorRail.tsx', import.meta.url), 'utf8');

describe('PromptNavigatorRail native surface occlusion', () => {
    test('suspends native artifact surfaces while the prompt preview panel is visible', () => {
        const previewPanel = source.match(/ref=\{panelRef\}[\s\S]*?onMouseEnter=\{cancelScheduledHide\}/)?.[0] ?? '';

        expect(previewPanel).toContain('data-oc-native-surface-occluder="true"');
    });
});
