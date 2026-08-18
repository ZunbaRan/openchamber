import { describe, expect, test } from 'bun:test';

import {
    isExpandableTool,
    isStaticTool,
    shouldCollapsePostRichResultText,
    type PostRichResultTextContext,
} from './toolRenderUtils';

describe('tool rendering classification', () => {
    test('keeps navigation tools compact', () => {
        expect(isStaticTool('read')).toBe(true);
        expect(isStaticTool('skill')).toBe(true);
        expect(isExpandableTool('read')).toBe(false);
        expect(isExpandableTool('skill')).toBe(false);
    });

    test('expands built-in tools without direct navigation', () => {
        expect(isExpandableTool('grep')).toBe(true);
        expect(isExpandableTool('webfetch')).toBe(true);
        expect(isExpandableTool('todowrite')).toBe(true);
        expect(isExpandableTool('plan_exit')).toBe(true);
    });

    test('expands custom and MCP tools', () => {
        expect(isExpandableTool('linear_list_issues')).toBe(true);
        expect(isExpandableTool('my-plugin_publish')).toBe(true);
        expect(isStaticTool('linear_list_issues')).toBe(false);
    });

    test('normalizes dotted and indexed tool names', () => {
        expect(isStaticTool('runtime.read:2')).toBe(true);
        expect(isExpandableTool('runtime.custom_tool:2')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Post-rich-result recap collapse classification
// ---------------------------------------------------------------------------

const richInteractiveResultPart = (): Record<string, unknown> => ({
    type: 'tool',
    state: {
        status: 'completed',
        output: JSON.stringify({
            $schema: 'openchamber://interactive-result/v1',
            view: 'com.acme.sales.dashboard',
            schemaVersion: 1,
            mode: 'live',
            context: { region: 'east' },
        }),
    },
});

const richMcpAppPart = (): Record<string, unknown> => ({
    type: 'tool',
    state: {
        status: 'completed',
        metadata: {
            mcpApp: {
                server: 'sales',
                tool: 'open_dashboard',
                toolKey: 'sales__open_dashboard',
                resourceUri: 'ui://sales/dashboard',
                meta: { resourceUri: 'ui://sales/dashboard' },
            },
        },
    },
});

const richHtmlArtifactPart = (): Record<string, unknown> => ({
    type: 'tool',
    state: {
        status: 'completed',
        output: JSON.stringify({
            $schema: 'openchamber://html-artifact-result/v1',
            schemaVersion: 1,
            title: 'Quarterly Report',
            html: '<div>report</div>',
            capabilities: { scripts: false },
            display: { preferred: 'inline', allowExpand: true, inlineHeight: 420 },
        }),
    },
});

const richInstalledArtifactPart = (): Record<string, unknown> => ({
    type: 'tool',
    state: {
        status: 'completed',
        output: JSON.stringify({
            $schema: 'openchamber://installed-html-artifact-result/v1',
            schemaVersion: 1,
            artifact: 'acme.dashboard',
            mode: 'live',
        }),
    },
});

const ordinaryToolPart = (): Record<string, unknown> => ({
    type: 'tool',
    state: { status: 'completed', output: 'plain text output from an ordinary tool' },
});

const textPart = (text: string): Record<string, unknown> => ({ type: 'text', text });

// > 240 chars so the plain length threshold applies.
const longProse = 'This is a lengthy model-authored recap. '.repeat(10);

const widgetText = '```show-widget\n{"title":"Sales","widget_code":"<div>chart</div>"}\n```';

const completed = (overrides?: Partial<PostRichResultTextContext>): PostRichResultTextContext => ({
    isMessageCompleted: true,
    ...overrides,
});

describe('shouldCollapsePostRichResultText', () => {
    test('C-01 rich result -> concise final text stays expanded', () => {
        const parts = [richInteractiveResultPart(), textPart('Done! Here is the dashboard.')];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });

    test('C-02 rich result -> long prose -> later rich result: interleaving explanation expanded', () => {
        const parts = [richInteractiveResultPart(), textPart(longProse), richMcpAppPart()];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });

    test('C-03 previous assistant rich result + current intermediate assistant message expanded', () => {
        const parts = [textPart(longProse)];
        const context = completed({
            isLastAssistantInTurn: false,
            hasEarlierRichResultInTurn: true,
        });
        expect(shouldCollapsePostRichResultText(parts, 0, context)).toBe(false);
    });

    test('undefined isLastAssistantInTurn (no turn grouping) is not coerced to false', () => {
        // Historical message-local behavior: a caller-provided earlier rich
        // result in the turn still counts, so the final long recap collapses.
        const parts = [textPart(longProse)];
        const context = completed({ isLastAssistantInTurn: undefined, hasEarlierRichResultInTurn: true });
        expect(shouldCollapsePostRichResultText(parts, 0, context)).toBe(true);
    });

    test('C-04 previous assistant rich result + final short explanation expanded', () => {
        const parts = [textPart('Short summary of the dashboard.')];
        const context = completed({
            isLastAssistantInTurn: true,
            hasEarlierRichResultInTurn: true,
        });
        expect(shouldCollapsePostRichResultText(parts, 0, context)).toBe(false);
    });

    test('C-05 previous assistant rich result + final 3+ bullet recap collapsed', () => {
        const parts = [textPart('- North region revenue up 12%\n- East region flat\n- West region down 3%')];
        const context = completed({
            isLastAssistantInTurn: true,
            hasEarlierRichResultInTurn: true,
        });
        expect(shouldCollapsePostRichResultText(parts, 0, context)).toBe(true);
    });

    test('C-06 rich result -> >240 chars final prose, no later visual, preserves collapse', () => {
        const parts = [richInteractiveResultPart(), textPart(longProse)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(true);
    });

    test('C-07 rich result -> >240 chars prose -> later widget text expanded', () => {
        const parts = [richInteractiveResultPart(), textPart(longProse), textPart(widgetText)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });

    test('C-08 streaming/incomplete message always expanded', () => {
        const parts = [richInteractiveResultPart(), textPart(longProse)];
        expect(shouldCollapsePostRichResultText(parts, 1, { isMessageCompleted: false })).toBe(false);
    });

    test('C-09 ordinary tool -> long text expanded', () => {
        const parts = [ordinaryToolPart(), textPart(longProse)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });

    test('C-10 text before any rich result expanded', () => {
        const parts = [textPart(longProse), richInteractiveResultPart()];
        expect(shouldCollapsePostRichResultText(parts, 0, completed())).toBe(false);
    });

    test('C-11 long text containing two show-widget fences expanded', () => {
        const twoWidgets = `${longProse}\n\`\`\`show-widget\n{"widget_code":"<div>a</div>"}\n\`\`\`\nmore prose\n\`\`\`show-widget\n{"widget_code":"<div>b</div>"}\n\`\`\``;
        const parts = [richInteractiveResultPart(), textPart(twoWidgets)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });

    test('C-12 MCP App, Interactive UI, generated and installed Artifact rich results share the rule', () => {
        for (const richPart of [richMcpAppPart(), richInteractiveResultPart(), richHtmlArtifactPart(), richInstalledArtifactPart()]) {
            const parts = [richPart, textPart(longProse)];
            expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(true);
        }
    });

    test('C-13 empty text, invalid index, and non-text parts expand without throwing', () => {
        const parts = [richInteractiveResultPart(), textPart('   ')];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
        expect(shouldCollapsePostRichResultText(parts, -1, completed())).toBe(false);
        expect(shouldCollapsePostRichResultText(parts, 99, completed())).toBe(false);
        expect(shouldCollapsePostRichResultText([ordinaryToolPart()], 0, completed())).toBe(false);
        expect(shouldCollapsePostRichResultText([{ type: 'text', text: 42 }], 0, completed())).toBe(false);
        expect(shouldCollapsePostRichResultText([null], 0, completed())).toBe(false);
    });

    test('C-14 standalone widget text -> final long recap enters existing threshold logic', () => {
        const parts = [textPart(widgetText), textPart(longProse)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(true);
    });

    test('C-15 malformed show-widget marker stays expanded', () => {
        const malformed = '```show-widget\n<div>raw html without a JSON wrapper</div>';
        const parts = [richInteractiveResultPart(), textPart(malformed)];
        expect(shouldCollapsePostRichResultText(parts, 1, completed())).toBe(false);
    });
});
