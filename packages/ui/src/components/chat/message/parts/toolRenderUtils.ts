import { parseHTMLArtifactResultEnvelope } from '@/lib/interactive-ui/artifactResult';
import { parseInstalledHTMLArtifactResultEnvelope } from '@/lib/interactive-ui/installedArtifactResult';
import { parseInteractiveResultEnvelope } from '@/lib/interactive-ui/result';
import {
    canRenderMcpAppToolState,
    parseMcpAppBinding,
} from '@/lib/interactive-ui/mcpApp';
import { textContainsShowWidget } from '@/lib/generative-widget/parseShowWidget';
import { ACTIVITY_STANDALONE_TOOL_NAMES } from '../../lib/turns/constants';

// Keep only tools with a direct in-app navigation destination compact. Every
// other tool uses ToolPart so custom, plugin, and MCP calls expose their input
// and output through the common expandable renderer.
const STATIC_TOOL_NAMES = new Set<string>(['read', 'skill']);

const HIDDEN_INPUT_PREVIEW_TOOL_NAMES = new Set<string>([
    'apply_patch',
    'edit',
    'multiedit',
    'openchamber',
    'interactive_ui',
    'html_artifact',
]);

const normalizeToolName = (toolName: unknown): string => {
    if (typeof toolName !== 'string') return '';
    const trimmed = toolName.trim().toLowerCase();
    if (!trimmed) return '';

    const withoutIndex = trimmed.replace(/:\d+$/, '');
    if (withoutIndex.includes('.')) {
        const parts = withoutIndex.split('.').filter(Boolean);
        return parts[parts.length - 1] ?? withoutIndex;
    }
    return withoutIndex;
};

export const isExpandableTool = (toolName: unknown): boolean => {
    return !isStaticTool(toolName);
};

const readCompletedToolOutput = (part: unknown): string | null => {
    if (!part || typeof part !== 'object') return null;
    const state = (part as { state?: unknown }).state;
    if (!state || typeof state !== 'object') return null;
    const status = (state as { status?: unknown }).status;
    const output = (state as { output?: unknown }).output;
    if (status !== 'completed' || typeof output !== 'string') return null;
    const candidate = output.trim();
    if (!candidate.startsWith('{') || !candidate.includes('openchamber://')) return null;
    return candidate;
};

export const hasRichToolResult = (part: unknown): boolean => {
    if (part && typeof part === 'object') {
        const state = (part as { state?: unknown }).state;
        if (state && typeof state === 'object') {
            const status = (state as { status?: unknown }).status;
            const metadata = (state as { metadata?: unknown }).metadata;
            if (
                typeof status === 'string'
                && canRenderMcpAppToolState(status)
                && parseMcpAppBinding(metadata)
            ) {
                return true;
            }
        }
    }
    const output = readCompletedToolOutput(part);
    if (!output) return false;
    return parseInteractiveResultEnvelope(output) !== null
        || parseHTMLArtifactResultEnvelope(output) !== null
        || parseInstalledHTMLArtifactResultEnvelope(output) !== null;
};

const POST_RICH_RESULT_TEXT_LENGTH_LIMIT = 240;
const POST_RICH_RESULT_STRUCTURED_TEXT_LENGTH_LIMIT = 120;

export interface PostRichResultTextContext {
    isMessageCompleted: boolean;
    /** undefined means no turn grouping and preserves historical message-local behavior. */
    isLastAssistantInTurn?: boolean;
    hasEarlierRichResultInTurn?: boolean;
}

/**
 * True when a part renders a rich visual surface: a rich Tool result (MCP App,
 * Interactive UI, generated or installed HTML Artifact) or show-widget text.
 * Reuses the production show-widget marker predicate rather than a local fence
 * regex so malformed markers still count as visuals.
 */
const isVisualPart = (part: unknown): boolean => {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' && textContainsShowWidget(text);
    }
    return hasRichToolResult(part);
};

/**
 * Keep a concise conclusion visible after a rich result, but move a verbose
 * model-authored recap behind a disclosure. The original text remains in the
 * message for inspection, export, and copy actions.
 *
 * Fails open for anything that is not a completed turn's final recap: streaming
 * or non-final assistant messages, interleaving explanations followed by
 * another visual, text that itself carries a show-widget marker, and text with
 * no preceding visual. Only the final long/structured text after the final
 * visual reaches the thresholds below.
 */
export const shouldCollapsePostRichResultText = (
    parts: readonly unknown[],
    partIndex: number,
    context: PostRichResultTextContext,
): boolean => {
    // 1. Incomplete message, invalid index, non-text part, or empty text => expanded.
    if (!context.isMessageCompleted || partIndex < 0 || partIndex >= parts.length) {
        return false;
    }

    const part = parts[partIndex];
    if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'text') {
        return false;
    }

    const text = (part as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) {
        return false;
    }

    // 2. If grouped and explicitly not the last assistant message => expanded.
    //    Undefined (no turn grouping) preserves historical message-local
    //    behavior and must not be coerced to false.
    if (context.isLastAssistantInTurn === false) {
        return false;
    }

    // 3. If the current text contains any show-widget marker, including a
    //    malformed marker => expanded. Widget text is a visual surface, never
    //    a hidden recap.
    if (textContainsShowWidget(text)) {
        return false;
    }

    // 4. If no earlier visual in the message and no earlier rich result in the
    //    turn => expanded. Earlier/later visuals are computed here so the
    //    caller never needs to leak message-local scan state.
    const hasEarlierVisualInMessage = parts.slice(0, partIndex).some(isVisualPart);
    if (!hasEarlierVisualInMessage && !context.hasEarlierRichResultInTurn) {
        return false;
    }

    // 5. If a later rich Tool result or show-widget text exists in the same
    //    message => expanded: the current text is an interleaving explanation,
    //    not the final recap.
    if (parts.slice(partIndex + 1).some(isVisualPart)) {
        return false;
    }

    // 6. Only the final text after the final visual reaches the thresholds:
    //    >240 chars, or >120 chars with the existing structured/list rules.
    const candidate = text.trim();
    if (candidate.length > POST_RICH_RESULT_TEXT_LENGTH_LIMIT) {
        return true;
    }

    const lines = candidate.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const structuredLineCount = lines.filter((line) => /^(?:[-*+]\s|\d+[.)]\s|#{1,6}\s)/.test(line)).length;
    return structuredLineCount >= 3
        || (structuredLineCount >= 2 && lines.length >= 3)
        || (candidate.length > POST_RICH_RESULT_STRUCTURED_TEXT_LENGTH_LIMIT && lines.length >= 5);
};

export const isStandaloneTool = (toolName: unknown, part?: unknown): boolean => {
    return ACTIVITY_STANDALONE_TOOL_NAMES.has(normalizeToolName(toolName))
        || hasRichToolResult(part);
};

export const isStaticTool = (toolName: unknown): boolean => {
    return STATIC_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const shouldHideToolInputPreview = (toolName: unknown): boolean => {
    return HIDDEN_INPUT_PREVIEW_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const getToolDescriptionFallback = (
    toolName: unknown,
    description: unknown,
    input: Record<string, unknown> | undefined,
): string => {
    if (typeof description === 'string' && description.trim().length > 0) {
        return description;
    }

    const globPattern = normalizeToolName(toolName) === 'glob' ? input?.pattern : undefined;
    return typeof globPattern === 'string' ? globPattern : '';
};
