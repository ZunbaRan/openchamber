import { parseHTMLArtifactResultEnvelope } from '@/lib/interactive-ui/artifactResult';
import { parseInstalledHTMLArtifactResultEnvelope } from '@/lib/interactive-ui/installedArtifactResult';
import { parseInteractiveResultEnvelope } from '@/lib/interactive-ui/result';
import { ACTIVITY_STANDALONE_TOOL_NAMES } from '../../lib/turns/constants';

// Keep only tools with a direct in-app navigation destination compact. Every
// other tool uses ToolPart so custom, plugin, and MCP calls expose their input
// and output through the common expandable renderer.
const STATIC_TOOL_NAMES = new Set<string>(['read', 'skill']);

const HIDDEN_INPUT_PREVIEW_TOOL_NAMES = new Set<string>([
    'apply_patch',
    'edit',
    'multiedit',
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
    const output = readCompletedToolOutput(part);
    if (!output) return false;
    return parseInteractiveResultEnvelope(output) !== null
        || parseHTMLArtifactResultEnvelope(output) !== null
        || parseInstalledHTMLArtifactResultEnvelope(output) !== null;
};

const POST_RICH_RESULT_TEXT_LENGTH_LIMIT = 240;
const POST_RICH_RESULT_STRUCTURED_TEXT_LENGTH_LIMIT = 120;

/**
 * Keep a concise conclusion visible after a rich result, but move a verbose
 * model-authored recap behind a disclosure. The original text remains in the
 * message for inspection, export, and copy actions.
 */
export const shouldCollapsePostRichResultText = (
    parts: readonly unknown[],
    partIndex: number,
    isMessageCompleted: boolean,
    hasEarlierRichResultInTurn = false,
): boolean => {
    if (!isMessageCompleted || partIndex < 0 || partIndex >= parts.length) {
        return false;
    }

    const part = parts[partIndex];
    if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'text') {
        return false;
    }

    const text = (part as { text?: unknown }).text;
    if (typeof text !== 'string') {
        return false;
    }
    const candidate = text.trim();
    if (!candidate || (!hasEarlierRichResultInTurn && !parts.slice(0, partIndex).some(hasRichToolResult))) {
        return false;
    }

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
