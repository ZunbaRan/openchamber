import { describe, expect, test } from 'bun:test';

import {
    hasRichToolResult,
    isExpandableTool,
    isStandaloneTool,
    isStaticTool,
    shouldCollapsePostRichResultText,
    shouldHideToolInputPreview,
} from './toolRenderUtils';
import { getToolMetadata } from '@/lib/toolHelpers';

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

    test('hides generated-view payloads while keeping ordinary tool input inspectable', () => {
        expect(shouldHideToolInputPreview('html_artifact')).toBe(true);
        expect(shouldHideToolInputPreview('runtime.interactive_ui:2')).toBe(true);
        expect(shouldHideToolInputPreview('bash')).toBe(false);
        expect(shouldHideToolInputPreview('crm_open_workspace')).toBe(false);
    });

    test('uses product names for built-in rich-result tools before completion', () => {
        expect(getToolMetadata('interactive_ui').displayName).toBe('Interactive UI');
        expect(getToolMetadata('html_artifact').displayName).toBe('HTML Artifact');
    });

    test('promotes exact completed Interactive UI and Artifact results out of Activity', () => {
        const interactivePart = {
            state: {
                status: 'completed',
                output: JSON.stringify({
                    $schema: 'openchamber://interactive-result/v1',
                    schemaVersion: 1,
                    view: 'com.acme.crm.overview',
                    mode: 'live',
                }),
            },
        };
        const artifactPart = {
            state: {
                status: 'completed',
                output: JSON.stringify({
                    $schema: 'openchamber://html-artifact-result/v1',
                    schemaVersion: 1,
                    title: 'Topology',
                    html: '<svg></svg>',
                    capabilities: { scripts: false },
                    display: { preferred: 'inline', allowExpand: true, inlineHeight: 320 },
                }),
            },
        };
        const installedArtifactPart = {
            state: {
                status: 'completed',
                output: JSON.stringify({
                    $schema: 'openchamber://installed-html-artifact-result/v1',
                    schemaVersion: 1,
                    artifact: 'com.demo.crm.pipeline',
                    mode: 'live',
                }),
            },
        };

        expect(hasRichToolResult(interactivePart)).toBe(true);
        expect(isStandaloneTool('crm_open_overview', interactivePart)).toBe(true);
        expect(hasRichToolResult(artifactPart)).toBe(true);
        expect(isStandaloneTool('html_artifact', artifactPart)).toBe(true);
        expect(hasRichToolResult(installedArtifactPart)).toBe(true);
        expect(isStandaloneTool('crm_open_pipeline', installedArtifactPart)).toBe(true);
        expect(isStandaloneTool('task')).toBe(true);
    });

    test('keeps pending, malformed, and ordinary tool results inside Activity', () => {
        expect(hasRichToolResult({
            state: {
                status: 'pending',
                output: JSON.stringify({ $schema: 'openchamber://interactive-result/v1' }),
            },
        })).toBe(false);
        expect(hasRichToolResult({
            state: {
                status: 'completed',
                output: '{"$schema":"openchamber://interactive-result/v1"}',
            },
        })).toBe(false);
        expect(isStandaloneTool('bash', {
            state: { status: 'completed', output: 'ok' },
        })).toBe(false);
    });

    test('collapses only verbose completed text that follows a rich result', () => {
        const richPart = {
            type: 'tool',
            state: {
                status: 'completed',
                output: JSON.stringify({
                    $schema: 'openchamber://interactive-result/v1',
                    schemaVersion: 1,
                    view: 'generated.dashboard',
                    mode: 'snapshot',
                }),
            },
        };
        const conciseText = { type: 'text', text: '看板已生成，可以继续筛选异常日期。' };
        const verboseText = {
            type: 'text',
            text: '看板已生成，包含以下内容：\n- 调用量趋势与峰值\n- 成功率变化和异常日期\n- P95 延迟趋势与风险说明\n- 每日明细和后续建议',
        };
        const duplicateArtifactRecap = {
            type: 'text',
            text: '已重新生成，关键变更：\n- scripts: true 已显式声明，拖拽交互正常执行\n- html、body 背景透明，并通过 Host Token 继承颜色',
        };

        expect(shouldCollapsePostRichResultText([richPart, conciseText], 1, true)).toBe(false);
        expect(shouldCollapsePostRichResultText([richPart, verboseText], 1, true)).toBe(true);
        expect(shouldCollapsePostRichResultText([richPart, duplicateArtifactRecap], 1, true)).toBe(true);
        expect(shouldCollapsePostRichResultText([richPart, verboseText], 1, false)).toBe(false);
        expect(shouldCollapsePostRichResultText([verboseText, richPart], 0, true)).toBe(false);
        expect(shouldCollapsePostRichResultText([{ type: 'tool', state: { status: 'completed', output: 'ok' } }, verboseText], 1, true)).toBe(false);
        expect(shouldCollapsePostRichResultText([verboseText], 0, true, true)).toBe(true);
    });
});
