/**
 * Privacy-safe finalized-transcript normalizer + strict evaluator for
 * interleaved text/visual conversations (issue-091).
 *
 * The frozen corpus (`examples/interactive-ui/conversational-interleaving-corpus.json`)
 * is the plan/model-runner INPUT schema — each case carries only
 * `id`/`locale`/`prompt`/`tools.disable`/`expectation`; it never stores model
 * outputs. Deterministic transcripts used by unit tests live in the test
 * file. This module provides:
 *
 *   - `normalizeAssistantTranscript(finalizedAssistantMessages)`: consumes
 *     finalized assistant messages ONLY (API/message order, part-index order
 *     — never timestamp-sorted) and produces `InterleavingEvidence`.
 *     Raw text, prompts, widget code, widget titles, tool input/output, and
 *     business rows are NEVER retained — text events carry only a
 *     `meaningful` flag, visuals carry runtime/source labels, malformed
 *     widgets carry a stable failure code from the production parser.
 *   - `evaluateInterleavingExpectation(evidence, expectation)`: strict policy
 *     evaluation with stable codes/diagnostics (code + index + safe
 *     runtime/source labels only).
 *   - `validateConversationalInterleavingCorpus` /
 *     `loadConversationalInterleavingCorpus`: strict validator/loader for the
 *     frozen exactly-I1..I5 corpus.
 *   - `projectPrivacySafeEvidence` / `buildPrivacySafeReport`: projections
 *     that strip every transient or raw field.
 *
 * Production parsers are reused — never reimplemented: the show-widget
 * scanner (`parseAllShowWidgets` in `finalized-strict` mode), the interactive
 * result / HTML artifact envelope parsers, and the MCP App binding parser.
 */

import {
  parseAllShowWidgets,
  textContainsShowWidget,
  type MalformedWidgetCode,
} from '../../packages/ui/src/lib/generative-widget/parseShowWidget.ts';
import { parseInteractiveResultEnvelope } from '../../packages/ui/src/lib/interactive-ui/result.ts';
import { parseHTMLArtifactResultEnvelope } from '../../packages/ui/src/lib/interactive-ui/artifactResult.ts';
import { parseInstalledHTMLArtifactResultEnvelope } from '../../packages/ui/src/lib/interactive-ui/installedArtifactResult.ts';
import { parseMcpAppBinding } from '../../packages/ui/src/lib/interactive-ui/mcpApp.ts';

export const INTERLEAVING_EVIDENCE_SCHEMA = 'openchamber://interleaving-evidence/v1' as const;
export const INTERLEAVING_REPORT_SCHEMA = 'openchamber://interleaving-report/v1' as const;
export const CONVERSATIONAL_INTERLEAVING_CORPUS_SCHEMA = 'openchamber://conversational-interleaving-corpus/v1' as const;

// ---------------------------------------------------------------------------
// Input contract (finalized assistant messages)
// ---------------------------------------------------------------------------

export type FinalizedToolStatus = 'pending' | 'running' | 'completed' | 'error';

export interface FinalizedToolState {
  status: FinalizedToolStatus;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export type FinalizedAssistantPart =
  | { partId: string; type: 'text'; text: string }
  | { partId: string; type: 'tool'; tool: string; state: FinalizedToolState; metadata?: Record<string, unknown> };

export interface FinalizedAssistantMessage {
  messageId: string;
  parts: readonly FinalizedAssistantPart[];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type VisualRuntime = 'show-widget' | 'interactive-ui' | 'html-artifact';
export type VisualSource = 'assistant-text' | 'agent-generated' | 'installed';
export type ToolCallState = FinalizedToolStatus;
export type ToolCallClassification = 'presentation' | 'business' | 'ordinary';

/** The four production visual tracks (P2). MCP Apps are NOT one of them. */
export const FOUR_TRACK_RUNTIMES: readonly VisualRuntime[] = ['show-widget', 'interactive-ui', 'html-artifact'] as const;

/** Generic presentation tools: their calls are presentation-classified. */
export const GENERIC_PRESENTATION_TOOLS: ReadonlySet<string> = new Set(['interactive_ui', 'html_artifact']);

export interface VisualEvent {
  messageId: string;
  messageIndex: number;
  partId: string;
  partIndex: number;
  segmentIndex: number;
  partKey: string;
  runtime: VisualRuntime;
  source: VisualSource;
  /**
   * TRANSIENT, in-process only: the show-widget title is carried so the
   * evaluator can compare `expectedWidgetTitlesInOrder` (I3). It is stripped
   * by `projectPrivacySafeEvidence` and never appears in any projection.
   */
  widgetTitle?: string;
}

export interface TextEvent {
  messageId: string;
  messageIndex: number;
  partId: string;
  partIndex: number;
  segmentIndex: number;
  partKey: string;
  /** true only with at least two Unicode letters/numbers; content is never retained. */
  meaningful: boolean;
}

export interface ToolCallRecord {
  messageId: string;
  messageIndex: number;
  partId: string;
  partIndex: number;
  segmentIndex: number;
  partKey: string;
  /** Tool name only — never input/output/error content. */
  tool: string;
  state: ToolCallState;
  classification: ToolCallClassification;
}

export interface MalformedWidgetRecord {
  messageId: string;
  messageIndex: number;
  partId: string;
  partIndex: number;
  segmentIndex: number;
  partKey: string;
  /** Stable failure code from the production parser — never the fence body. */
  code: MalformedWidgetCode;
}

export interface InterleavingCounts {
  visuals: number;
  widgetVisuals: number;
  toolVisuals: number;
  texts: number;
  meaningfulTexts: number;
  toolCalls: number;
  businessToolCalls: number;
  malformedWidgets: number;
  mcpApps: number;
}

export interface InterleavingEvidence {
  schema: typeof INTERLEAVING_EVIDENCE_SCHEMA;
  visuals: readonly VisualEvent[];
  texts: readonly TextEvent[];
  toolCalls: readonly ToolCallRecord[];
  malformedWidgets: readonly MalformedWidgetRecord[];
  counts: InterleavingCounts;
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

export type ExpectationKind =
  | 'text-visual-text'
  | 'multiple-visuals-with-text-between'
  | 'multiple-widgets-in-one-text-part'
  | 'single-business-view'
  | 'no-visual';

export const EXPECTATION_KINDS: readonly ExpectationKind[] = [
  'text-visual-text',
  'multiple-visuals-with-text-between',
  'multiple-widgets-in-one-text-part',
  'single-business-view',
  'no-visual',
];

export interface AllowedVisual {
  runtime: VisualRuntime;
  source: VisualSource;
}

export interface InterleavingExpectation {
  kind: ExpectationKind;
  minVisuals?: number;
  maxVisuals?: number;
  exactVisuals?: number;
  /** Object allowlist: entries are {runtime, source}, never "runtime/source" strings. */
  allowedVisuals?: readonly AllowedVisual[];
  acceptedToolNames?: readonly string[];
  forbiddenToolNames?: readonly string[];
  expectedWidgetTitlesInOrder?: readonly string[];
  maxToolVisuals?: number;
  requireMeaningfulText?: boolean;
  maxMalformedWidgets?: number;
}

export interface InterleavingEvaluation {
  passed: boolean;
  /** Stable failure codes (deduplicated, in first-failure order). */
  codes: readonly string[];
  /** Stable diagnostics: code + index + safe runtime/source labels only. */
  diagnostics: readonly string[];
  counts: InterleavingCounts;
  /** Present only when the expectation declares expectedWidgetTitlesInOrder. */
  widgetTitlesMatched?: boolean;
}

// ---------------------------------------------------------------------------
// Corpus contract (plan/model-runner input schema — never model outputs)
// ---------------------------------------------------------------------------

export const CONVERSATIONAL_CORPUS_CASE_IDS = ['I1', 'I2', 'I3', 'I4', 'I5'] as const;
export type CorpusCaseId = (typeof CONVERSATIONAL_CORPUS_CASE_IDS)[number];

export interface InterleavingCaseTools {
  /** Tool names disabled by the scenario. I3 disables the generic presentation tools plus the frozen business presentation tools. */
  disable: readonly string[];
}

export interface InterleavingCorpusCase {
  id: CorpusCaseId;
  locale: string;
  /** User prompt (Appendix-C semantics). May live in the corpus; every projection omits it. */
  prompt: string;
  tools: InterleavingCaseTools;
  expectation: InterleavingExpectation;
}

export interface ConversationalInterleavingCorpus {
  $schema: typeof CONVERSATIONAL_INTERLEAVING_CORPUS_SCHEMA;
  cases: readonly InterleavingCorpusCase[];
}

// ---------------------------------------------------------------------------
// Privacy-safe projections
// ---------------------------------------------------------------------------

export interface PrivacySafeVisualEvent {
  messageId: string;
  messageIndex: number;
  partId: string;
  partIndex: number;
  segmentIndex: number;
  partKey: string;
  runtime: VisualRuntime;
  source: VisualSource;
}

export interface PrivacySafeEvidence {
  schema: typeof INTERLEAVING_EVIDENCE_SCHEMA;
  visuals: readonly PrivacySafeVisualEvent[];
  texts: readonly TextEvent[];
  toolCalls: readonly ToolCallRecord[];
  malformedWidgets: readonly MalformedWidgetRecord[];
  counts: InterleavingCounts;
}

export interface PrivacySafeCaseReport {
  id: string;
  passed: boolean;
  codes: readonly string[];
  diagnostics: readonly string[];
  counts: InterleavingCounts;
  widgetTitlesMatched?: boolean;
}

export interface PrivacySafeReport {
  schema: typeof INTERLEAVING_REPORT_SCHEMA;
  corpus: string;
  generatedAt: string;
  privacy: string;
  cases: readonly PrivacySafeCaseReport[];
}

export const PRIVACY_STATEMENT =
  'No prompt text, model text, widget code, widget title, tool input, tool output, or business data is retained.';

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeToolName = (tool: string): string => tool.trim().toLowerCase();

/** Count Unicode letters/numbers; stops early once `>= 2`. */
const countUnicodeAlphanumerics = (text: string): number => {
  let count = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      count += 1;
      if (count >= 2) return count;
    }
  }
  return count;
};

/** meaningful=true only with at least two Unicode letters/numbers. */
export const isMeaningfulText = (text: string): boolean => countUnicodeAlphanumerics(text) >= 2;

/** Which production envelope (if any) a completed tool output parsed into. */
type EnvelopeOutcome =
  | { kind: 'interactive' }
  | { kind: 'generated-artifact' }
  | { kind: 'installed-artifact' }
  | { kind: 'none' };

/**
 * Privacy-safe tool classification:
 * - `presentation`: generic presentation tool names (interactive_ui, html_artifact).
 * - `business`: a completed call from a non-generic tool that returned an
 *   installed Interactive/Artifact envelope (installed business view).
 * - `ordinary`: everything else — arbitrary non-generic tools such as
 *   read/bash, failed calls, pending/running calls, and MCP App parts.
 */
const classifyToolCall = (toolName: string, outcome: EnvelopeOutcome): ToolCallClassification => {
  const normalized = normalizeToolName(toolName);
  if (GENERIC_PRESENTATION_TOOLS.has(normalized)) return 'presentation';
  if (outcome.kind === 'interactive' || outcome.kind === 'installed-artifact') return 'business';
  return 'ordinary';
};

const isFinalizedToolStatus = (status: unknown): status is FinalizedToolStatus => (
  status === 'pending' || status === 'running' || status === 'completed' || status === 'error'
);

/**
 * Normalize finalized assistant messages (message order, part order, segment
 * order — never timestamp-sorted) into privacy-safe interleaving evidence.
 * Text parts are split with the production scanner in `finalized-strict`
 * mode; whitespace-only text is ignored; malformed widgets become stable-code
 * records; MCP App parts never produce a four-track visual.
 */
export const normalizeAssistantTranscript = (
  finalizedAssistantMessages: readonly FinalizedAssistantMessage[],
): InterleavingEvidence => {
  const visuals: VisualEvent[] = [];
  const texts: TextEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const malformedWidgets: MalformedWidgetRecord[] = [];
  let mcpApps = 0;

  finalizedAssistantMessages.forEach((message, messageIndex) => {
    if (!isRecord(message)) throw new TypeError(`finalizedAssistantMessages[${messageIndex}]: expected an object`);
    if (typeof message.messageId !== 'string' || !message.messageId.trim()) {
      throw new TypeError(`finalizedAssistantMessages[${messageIndex}]: messageId must be a non-empty string`);
    }
    if (!Array.isArray(message.parts)) {
      throw new TypeError(`finalizedAssistantMessages[${messageIndex}]: parts must be an array`);
    }
    const messageId = message.messageId;
    message.parts.forEach((part, partIndex) => {
      if (!isRecord(part)) throw new TypeError(`${messageId}.parts[${partIndex}]: expected an object`);
      if (typeof part.partId !== 'string' || !part.partId.trim()) {
        throw new TypeError(`${messageId}.parts[${partIndex}]: partId must be a non-empty string`);
      }
      const partKey = `${messageIndex}:${partIndex}`;
      const location = { messageId, messageIndex, partId: part.partId, partIndex, partKey };

      if (part.type === 'text') {
        if (typeof part.text !== 'string') throw new TypeError(`${messageId}.parts[${partIndex}]: text part requires a string text`);
        // Ignore whitespace-only text parts entirely.
        const trimmed = part.text.trim();
        if (!trimmed) return;
        // Reuse the production marker predicate (the collapse classifier's
        // permissive detection): marker-free parts are a single text segment,
        // marker parts go through the finalized-strict production scanner.
        const segments = textContainsShowWidget(trimmed)
          ? parseAllShowWidgets(part.text, { mode: 'finalized-strict' })
          : [{ type: 'text' as const, content: trimmed }];
        segments.forEach((segment, segmentIndex) => {
          if (segment.type === 'text') {
            texts.push({ ...location, segmentIndex, meaningful: isMeaningfulText(segment.content) });
          } else if (segment.type === 'widget') {
            visuals.push({
              ...location,
              segmentIndex,
              runtime: 'show-widget',
              source: 'assistant-text',
              ...(segment.data.title ? { widgetTitle: segment.data.title } : {}),
            });
          } else {
            malformedWidgets.push({ ...location, segmentIndex, code: segment.code });
          }
        });
        return;
      }

      if (part.type === 'tool') {
        if (typeof part.tool !== 'string') throw new TypeError(`${messageId}.parts[${partIndex}]: tool part requires a string tool name`);
        const state = part.state;
        if (!isRecord(state) || !isFinalizedToolStatus(state.status)) {
          throw new TypeError(`${messageId}.parts[${partIndex}]: tool part requires a state with status pending|running|completed|error`);
        }
        const toolName = part.tool;
        const output = state.status === 'completed' && typeof state.output === 'string' ? state.output : undefined;
        const isMcpApp = parseMcpAppBinding(part.metadata) !== null;

        // Parse the output once with the production envelope parsers — the
        // result drives both the classification and the visual event.
        let outcome: EnvelopeOutcome = { kind: 'none' };
        let interactive: ReturnType<typeof parseInteractiveResultEnvelope> = null;
        let generatedArtifact: ReturnType<typeof parseHTMLArtifactResultEnvelope> = null;
        let installedArtifact: ReturnType<typeof parseInstalledHTMLArtifactResultEnvelope> = null;
        if (!isMcpApp && output !== undefined) {
          interactive = parseInteractiveResultEnvelope(output);
          if (interactive) {
            outcome = { kind: 'interactive' };
          } else {
            generatedArtifact = parseHTMLArtifactResultEnvelope(output);
            if (generatedArtifact) {
              outcome = { kind: 'generated-artifact' };
            } else {
              installedArtifact = parseInstalledHTMLArtifactResultEnvelope(output);
              if (installedArtifact) outcome = { kind: 'installed-artifact' };
            }
          }
        }

        // Privacy-safe call record: name/state/classification only.
        toolCalls.push({
          ...location,
          segmentIndex: 0,
          tool: toolName,
          state: state.status,
          classification: classifyToolCall(toolName, outcome),
        });

        // MCP Apps are NOT one of the four visual tracks: a bound App never
        // produces a four-track visual, regardless of its output payload.
        if (isMcpApp) {
          mcpApps += 1;
          return;
        }

        if (interactive) {
          // interactive_ui => agent-generated; any other Interactive Result => installed.
          visuals.push({
            ...location,
            segmentIndex: 0,
            runtime: 'interactive-ui',
            source: normalizeToolName(toolName) === 'interactive_ui' ? 'agent-generated' : 'installed',
          });
        } else if (generatedArtifact) {
          visuals.push({ ...location, segmentIndex: 0, runtime: 'html-artifact', source: 'agent-generated' });
        } else if (installedArtifact) {
          visuals.push({ ...location, segmentIndex: 0, runtime: 'html-artifact', source: 'installed' });
        }
        return;
      }

      throw new TypeError(`${messageId}.parts[${partIndex}]: unknown part type ${String((part as { type?: unknown }).type)}`);
    });
  });

  const counts: InterleavingCounts = {
    visuals: visuals.length,
    widgetVisuals: visuals.filter((visual) => visual.runtime === 'show-widget').length,
    toolVisuals: visuals.filter((visual) => visual.runtime !== 'show-widget').length,
    texts: texts.length,
    meaningfulTexts: texts.filter((text) => text.meaningful).length,
    toolCalls: toolCalls.length,
    businessToolCalls: toolCalls.filter((call) => call.classification === 'business').length,
    malformedWidgets: malformedWidgets.length,
    mcpApps,
  };

  return {
    schema: INTERLEAVING_EVIDENCE_SCHEMA,
    visuals,
    texts,
    toolCalls,
    malformedWidgets,
    counts,
  };
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

interface EventLocation {
  messageIndex: number;
  partIndex: number;
  segmentIndex: number;
}

const compareLocations = (a: EventLocation, b: EventLocation): number => (
  a.messageIndex - b.messageIndex || a.partIndex - b.partIndex || a.segmentIndex - b.segmentIndex
);

const hasMeaningfulTextBefore = (evidence: InterleavingEvidence, order: EventLocation): boolean => (
  evidence.texts.some((text) => text.meaningful && compareLocations(text, order) < 0)
);

const hasMeaningfulTextAfter = (evidence: InterleavingEvidence, order: EventLocation): boolean => (
  evidence.texts.some((text) => text.meaningful && compareLocations(text, order) > 0)
);

const hasMeaningfulTextBetween = (evidence: InterleavingEvidence, from: EventLocation, to: EventLocation): boolean => (
  evidence.texts.some((text) => text.meaningful && compareLocations(text, from) > 0 && compareLocations(text, to) < 0)
);

const visualKey = (visual: Pick<VisualEvent, 'runtime' | 'source'>): string => `${visual.runtime}/${visual.source}`;

/**
 * Evaluate normalized evidence against a strict interleaving expectation.
 * Diagnostics contain stable codes, indexes, and safe runtime/source labels
 * ONLY — never raw text, titles, tool names in free form, or envelope content.
 */
export const evaluateInterleavingExpectation = (
  evidence: InterleavingEvidence,
  expectation: InterleavingExpectation,
): InterleavingEvaluation => {
  const codes: string[] = [];
  const diagnostics: string[] = [];
  const add = (code: string, detail: string): void => {
    codes.push(code);
    diagnostics.push(detail);
  };
  const { counts } = evidence;

  // --- generic count bounds ------------------------------------------------
  if (expectation.exactVisuals !== undefined && counts.visuals !== expectation.exactVisuals) {
    add('visual-count-mismatch', `visual-count-mismatch:expected=${expectation.exactVisuals}:actual=${counts.visuals}`);
  }
  if (expectation.minVisuals !== undefined && counts.visuals < expectation.minVisuals) {
    add('visual-count-below-min', `visual-count-below-min:min=${expectation.minVisuals}:actual=${counts.visuals}`);
  }
  if (expectation.maxVisuals !== undefined && counts.visuals > expectation.maxVisuals) {
    add('visual-count-above-max', `visual-count-above-max:max=${expectation.maxVisuals}:actual=${counts.visuals}`);
  }
  if (expectation.maxToolVisuals !== undefined && counts.toolVisuals > expectation.maxToolVisuals) {
    add('tool-visual-over-limit', `tool-visual-over-limit:limit=${expectation.maxToolVisuals}:actual=${counts.toolVisuals}`);
  }
  const maxMalformedWidgets = expectation.maxMalformedWidgets ?? 0;
  if (counts.malformedWidgets > maxMalformedWidgets) {
    add('malformed-widget-over-limit', `malformed-widget-over-limit:limit=${maxMalformedWidgets}:actual=${counts.malformedWidgets}`);
  }
  if (expectation.requireMeaningfulText === true && counts.meaningfulTexts < 1) {
    add('meaningful-text-required', 'meaningful-text-required');
  }

  // --- visual runtime/source allowlist -------------------------------------
  if (expectation.allowedVisuals) {
    const allowed = new Set(expectation.allowedVisuals.map((entry) => visualKey(entry)));
    evidence.visuals.forEach((visual, index) => {
      if (!allowed.has(visualKey(visual))) {
        add('disallowed-visual', `disallowed-visual:index=${index}:${visualKey(visual)}`);
      }
    });
  }

  // --- tool policy (a failed forbidden call still violates) -----------------
  if (expectation.forbiddenToolNames) {
    const forbidden = new Set(expectation.forbiddenToolNames.map(normalizeToolName));
    evidence.toolCalls.forEach((call, index) => {
      if (forbidden.has(normalizeToolName(call.tool))) {
        add('forbidden-tool-call', `forbidden-tool-call:index=${index}`);
      }
    });
  }
  // Only business-classified calls are held to the accepted allowlist;
  // unrelated ordinary tools (read/bash/...) are never flagged.
  if (expectation.acceptedToolNames) {
    const accepted = new Set(expectation.acceptedToolNames.map(normalizeToolName));
    evidence.toolCalls.forEach((call, index) => {
      if (call.classification === 'business' && !accepted.has(normalizeToolName(call.tool))) {
        add('unaccepted-tool-call', `unaccepted-tool-call:index=${index}`);
      }
    });
  }

  // --- widget titles (transient, in-process only; never surfaced) ----------
  let widgetTitlesMatched: boolean | undefined;
  if (expectation.expectedWidgetTitlesInOrder) {
    const actualTitles = evidence.visuals
      .filter((visual) => visual.runtime === 'show-widget')
      .map((visual) => visual.widgetTitle ?? null);
    const expectedTitles = expectation.expectedWidgetTitlesInOrder;
    widgetTitlesMatched = actualTitles.length === expectedTitles.length
      && actualTitles.every((title, index) => title === expectedTitles[index]);
    if (!widgetTitlesMatched) add('widget-title-order-mismatch', 'widget-title-order-mismatch');
  }

  // --- kind-specific semantic rules ----------------------------------------
  switch (expectation.kind) {
    case 'text-visual-text': {
      if (counts.visuals < 1) {
        add('visual-count-below-min', `visual-count-below-min:min=1:actual=${counts.visuals}`);
      } else {
        if (!hasMeaningfulTextBefore(evidence, evidence.visuals[0])) add('missing-text-before', 'missing-text-before');
        if (!hasMeaningfulTextAfter(evidence, evidence.visuals[counts.visuals - 1])) add('missing-text-after', 'missing-text-after');
      }
      break;
    }
    case 'multiple-visuals-with-text-between': {
      if (counts.visuals < 2) {
        add('visual-count-below-min', `visual-count-below-min:min=2:actual=${counts.visuals}`);
      } else {
        for (let gap = 0; gap + 1 < counts.visuals; gap += 1) {
          if (!hasMeaningfulTextBetween(evidence, evidence.visuals[gap], evidence.visuals[gap + 1])) {
            add('missing-text-between', `missing-text-between:gap=${gap}`);
          }
        }
        if (!hasMeaningfulTextAfter(evidence, evidence.visuals[counts.visuals - 1])) {
          add('missing-text-after', 'missing-text-after');
        }
      }
      break;
    }
    case 'multiple-widgets-in-one-text-part': {
      if (counts.visuals < 2) {
        add('visual-count-below-min', `visual-count-below-min:min=2:actual=${counts.visuals}`);
      }
      evidence.visuals.forEach((visual, index) => {
        if (visual.runtime !== 'show-widget') {
          add('non-widget-visual', `non-widget-visual:index=${index}:${visualKey(visual)}`);
        }
      });
      const widgetVisuals = evidence.visuals.filter((visual) => visual.runtime === 'show-widget');
      const partKeys = new Set(widgetVisuals.map((visual) => visual.partKey));
      if (partKeys.size > 1) {
        widgetVisuals.forEach((visual, index) => {
          if (visual.partKey !== widgetVisuals[0].partKey) {
            add('widgets-in-multiple-parts', `widgets-in-multiple-parts:index=${index}`);
          }
        });
      }
      for (let gap = 0; gap + 1 < widgetVisuals.length; gap += 1) {
        if (!hasMeaningfulTextBetween(evidence, widgetVisuals[gap], widgetVisuals[gap + 1])) {
          add('missing-text-between', `missing-text-between:gap=${gap}`);
        }
      }
      if (widgetVisuals.length >= 1 && !hasMeaningfulTextAfter(evidence, widgetVisuals[widgetVisuals.length - 1])) {
        add('missing-text-after', 'missing-text-after');
      }
      break;
    }
    case 'single-business-view': {
      if (counts.visuals !== 1) {
        add('visual-count-mismatch', `visual-count-mismatch:expected=1:actual=${counts.visuals}`);
      } else if (evidence.visuals[0].source !== 'installed') {
        add('business-view-not-installed', `business-view-not-installed:index=0:${visualKey(evidence.visuals[0])}`);
      }
      // Duplicate/missing business-call checks count every call whose
      // normalized name is in the accepted allowlist — including failed
      // duplicate calls. Without an allowlist, fall back to the
      // installed-business classification.
      const accepted = expectation.acceptedToolNames
        ? new Set(expectation.acceptedToolNames.map(normalizeToolName))
        : null;
      const businessCalls = accepted
        ? evidence.toolCalls.filter((call) => accepted.has(normalizeToolName(call.tool))).length
        : counts.businessToolCalls;
      if (businessCalls === 0) add('missing-business-call', 'missing-business-call');
      if (businessCalls > 1) add('duplicate-business-call', `duplicate-business-call:count=${businessCalls}`);
      break;
    }
    case 'no-visual': {
      if (counts.visuals !== 0) {
        evidence.visuals.forEach((visual, index) => {
          add('unexpected-visual', `unexpected-visual:index=${index}:${visualKey(visual)}`);
        });
      }
      evidence.toolCalls.forEach((call, index) => {
        if (call.classification === 'presentation') {
          add('presentation-tool-call', `presentation-tool-call:index=${index}`);
        }
      });
      break;
    }
  }

  return {
    passed: codes.length === 0,
    codes: [...new Set(codes)],
    diagnostics,
    counts,
    ...(widgetTitlesMatched !== undefined ? { widgetTitlesMatched } : {}),
  };
};

// ---------------------------------------------------------------------------
// Privacy-safe projections
// ---------------------------------------------------------------------------

/** Strip the transient widgetTitle (and any future raw field) from evidence. */
export const projectPrivacySafeEvidence = (evidence: InterleavingEvidence): PrivacySafeEvidence => ({
  schema: evidence.schema,
  visuals: evidence.visuals.map(({ widgetTitle: _title, ...rest }) => rest),
  texts: evidence.texts,
  toolCalls: evidence.toolCalls,
  malformedWidgets: evidence.malformedWidgets,
  counts: evidence.counts,
});

export const buildPrivacySafeReport = (input: {
  corpusId: string;
  cases: readonly { id: string; evaluation: InterleavingEvaluation }[];
  generatedAt?: string;
}): PrivacySafeReport => ({
  schema: INTERLEAVING_REPORT_SCHEMA,
  corpus: input.corpusId,
  generatedAt: input.generatedAt ?? new Date().toISOString(),
  privacy: PRIVACY_STATEMENT,
  cases: input.cases.map(({ id, evaluation }) => ({
    id,
    passed: evaluation.passed,
    codes: evaluation.codes,
    diagnostics: evaluation.diagnostics,
    counts: evaluation.counts,
    ...(evaluation.widgetTitlesMatched !== undefined ? { widgetTitlesMatched: evaluation.widgetTitlesMatched } : {}),
  })),
});

// ---------------------------------------------------------------------------
// Strict corpus loader/validator (plan/model-runner input schema)
// ---------------------------------------------------------------------------

export type CorpusValidationResult =
  | { ok: true; corpus: ConversationalInterleavingCorpus }
  | { ok: false; errors: readonly string[] };

const CORPUS_KEYS = new Set(['$schema', 'cases']);
const CASE_KEYS = new Set(['id', 'locale', 'prompt', 'tools', 'expectation']);
const TOOLS_KEYS = new Set(['disable']);
const EXPECTATION_KEYS = new Set([
  'kind',
  'minVisuals',
  'maxVisuals',
  'exactVisuals',
  'allowedVisuals',
  'acceptedToolNames',
  'forbiddenToolNames',
  'expectedWidgetTitlesInOrder',
  'maxToolVisuals',
  'requireMeaningfulText',
  'maxMalformedWidgets',
]);
const ALLOWED_VISUAL_KEYS = new Set(['runtime', 'source']);

const unknownKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] => (
  Object.keys(value).filter((key) => !allowed.has(key))
);

const VISUAL_RUNTIMES: readonly VisualRuntime[] = ['show-widget', 'interactive-ui', 'html-artifact'];
const VISUAL_SOURCES: readonly VisualSource[] = ['assistant-text', 'agent-generated', 'installed'];

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const uniqueStrings = (entries: readonly string[], path: string, errors: string[]): void => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      errors.push(`${path}[${index}]: expected a non-empty string`);
      return;
    }
    if (seen.has(entry)) errors.push(`${path}[${index}]: duplicate value "${entry}"`);
    seen.add(entry);
  });
};

const validateExpectation = (value: unknown, path: string, errors: string[]): InterleavingExpectation | null => {
  if (!isRecord(value)) {
    errors.push(`${path}: expected an object`);
    return null;
  }
  for (const key of unknownKeys(value, EXPECTATION_KEYS)) errors.push(`${path}: unknown key "${key}"`);

  const kind = value.kind;
  if (!EXPECTATION_KINDS.includes(kind as ExpectationKind)) {
    errors.push(`${path}.kind: expected one of ${EXPECTATION_KINDS.join('|')}`);
    return null;
  }

  for (const field of ['minVisuals', 'maxVisuals', 'exactVisuals', 'maxToolVisuals', 'maxMalformedWidgets'] as const) {
    if (value[field] !== undefined && !isNonNegativeInteger(value[field])) {
      errors.push(`${path}.${field}: expected a non-negative integer`);
    }
  }

  const minVisuals = value.minVisuals as number | undefined;
  const maxVisuals = value.maxVisuals as number | undefined;
  const exactVisuals = value.exactVisuals as number | undefined;
  if (exactVisuals !== undefined && (minVisuals !== undefined || maxVisuals !== undefined)) {
    errors.push(`${path}: exactVisuals is mutually exclusive with minVisuals/maxVisuals`);
  }
  if (minVisuals !== undefined && maxVisuals !== undefined && minVisuals > maxVisuals) {
    errors.push(`${path}: minVisuals (${minVisuals}) exceeds maxVisuals (${maxVisuals})`);
  }

  // Kind-implied count compatibility.
  if (kind === 'no-visual') {
    if (exactVisuals !== undefined && exactVisuals !== 0) errors.push(`${path}: no-visual requires exactVisuals 0`);
    if (minVisuals !== undefined && minVisuals !== 0) errors.push(`${path}: no-visual requires minVisuals 0`);
    if (maxVisuals !== undefined && maxVisuals !== 0) errors.push(`${path}: no-visual requires maxVisuals 0`);
  }
  if (kind === 'single-business-view') {
    if (exactVisuals !== undefined && exactVisuals !== 1) errors.push(`${path}: single-business-view requires exactVisuals 1`);
    if (minVisuals !== undefined && minVisuals > 1) errors.push(`${path}: single-business-view requires minVisuals <= 1`);
    if (maxVisuals !== undefined && maxVisuals < 1) errors.push(`${path}: single-business-view requires maxVisuals >= 1`);
  }

  if (value.allowedVisuals !== undefined) {
    if (!Array.isArray(value.allowedVisuals)) {
      errors.push(`${path}.allowedVisuals: expected an array of {runtime, source} objects`);
    } else {
      const seen = new Set<string>();
      value.allowedVisuals.forEach((entry, index) => {
        const entryPath = `${path}.allowedVisuals[${index}]`;
        if (!isRecord(entry)) {
          errors.push(`${entryPath}: expected an object with {runtime, source}`);
          return;
        }
        for (const key of unknownKeys(entry, ALLOWED_VISUAL_KEYS)) errors.push(`${entryPath}: unknown key "${key}"`);
        const runtime = entry.runtime;
        const source = entry.source;
        if (typeof runtime !== 'string' || !VISUAL_RUNTIMES.includes(runtime as VisualRuntime)) {
          errors.push(`${entryPath}.runtime: expected show-widget|interactive-ui|html-artifact`);
        }
        if (typeof source !== 'string' || !VISUAL_SOURCES.includes(source as VisualSource)) {
          errors.push(`${entryPath}.source: expected assistant-text|agent-generated|installed`);
        }
        const key = `${String(runtime)}/${String(source)}`;
        if ((runtime === 'show-widget') !== (source === 'assistant-text')) {
          errors.push(`${entryPath}: show-widget requires source assistant-text; interactive-ui/html-artifact forbid assistant-text`);
        }
        if (seen.has(key)) errors.push(`${entryPath}: duplicate visual "${key}"`);
        seen.add(key);
      });
    }
  }

  if (value.acceptedToolNames !== undefined) {
    if (!Array.isArray(value.acceptedToolNames)) {
      errors.push(`${path}.acceptedToolNames: expected an array`);
    } else uniqueStrings(value.acceptedToolNames, `${path}.acceptedToolNames`, errors);
  }
  if (value.forbiddenToolNames !== undefined) {
    if (!Array.isArray(value.forbiddenToolNames)) {
      errors.push(`${path}.forbiddenToolNames: expected an array`);
    } else uniqueStrings(value.forbiddenToolNames, `${path}.forbiddenToolNames`, errors);
  }
  if (value.acceptedToolNames !== undefined && value.forbiddenToolNames !== undefined) {
    if (Array.isArray(value.acceptedToolNames) && Array.isArray(value.forbiddenToolNames)) {
      const accepted = new Set(value.acceptedToolNames as string[]);
      for (const tool of value.forbiddenToolNames as string[]) {
        if (accepted.has(tool)) errors.push(`${path}: tool "${tool}" is both accepted and forbidden`);
      }
    }
  }

  if (value.expectedWidgetTitlesInOrder !== undefined) {
    if (kind !== 'multiple-widgets-in-one-text-part' && kind !== 'text-visual-text') {
      errors.push(`${path}.expectedWidgetTitlesInOrder: only compatible with multiple-widgets-in-one-text-part or text-visual-text`);
    }
    if (!Array.isArray(value.expectedWidgetTitlesInOrder)) {
      errors.push(`${path}.expectedWidgetTitlesInOrder: expected an array`);
    } else uniqueStrings(value.expectedWidgetTitlesInOrder, `${path}.expectedWidgetTitlesInOrder`, errors);
  }

  if (value.requireMeaningfulText !== undefined && typeof value.requireMeaningfulText !== 'boolean') {
    errors.push(`${path}.requireMeaningfulText: expected a boolean`);
  }

  return {
    kind: kind as ExpectationKind,
    ...(minVisuals !== undefined ? { minVisuals } : {}),
    ...(maxVisuals !== undefined ? { maxVisuals } : {}),
    ...(exactVisuals !== undefined ? { exactVisuals } : {}),
    ...(Array.isArray(value.allowedVisuals)
      ? {
          allowedVisuals: (value.allowedVisuals as Array<Record<string, unknown>>).map((entry) => ({
            runtime: entry.runtime as VisualRuntime,
            source: entry.source as VisualSource,
          })),
        }
      : {}),
    ...(Array.isArray(value.acceptedToolNames) ? { acceptedToolNames: value.acceptedToolNames as string[] } : {}),
    ...(Array.isArray(value.forbiddenToolNames) ? { forbiddenToolNames: value.forbiddenToolNames as string[] } : {}),
    ...(Array.isArray(value.expectedWidgetTitlesInOrder) ? { expectedWidgetTitlesInOrder: value.expectedWidgetTitlesInOrder as string[] } : {}),
    ...(value.maxToolVisuals !== undefined ? { maxToolVisuals: value.maxToolVisuals as number } : {}),
    ...(value.requireMeaningfulText !== undefined ? { requireMeaningfulText: value.requireMeaningfulText as boolean } : {}),
    ...(value.maxMalformedWidgets !== undefined ? { maxMalformedWidgets: value.maxMalformedWidgets as number } : {}),
  };
};

const validateTools = (value: unknown, path: string, errors: string[]): InterleavingCaseTools | null => {
  if (!isRecord(value)) {
    errors.push(`${path}: expected an object with a disable array`);
    return null;
  }
  for (const key of unknownKeys(value, TOOLS_KEYS)) errors.push(`${path}: unknown key "${key}"`);
  if (!Array.isArray(value.disable)) {
    errors.push(`${path}.disable: expected an array of tool names`);
    return null;
  }
  uniqueStrings(value.disable as string[], `${path}.disable`, errors);
  return { disable: value.disable as string[] };
};

/**
 * Strict validator for the frozen conversational-interleaving corpus:
 * exact unique IDs I1-I5; every case carries only id/locale/prompt/
 * tools.disable/expectation (unknown keys are rejected at the corpus, case,
 * tools, and expectation levels); allowedVisuals are {runtime, source}
 * objects; counts/allowlists are contradiction-free; I3 disables the generic
 * presentation tools plus the frozen business presentation tools. Model
 * outputs are never required or stored.
 */
export const validateConversationalInterleavingCorpus = (value: unknown): CorpusValidationResult => {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['corpus: expected an object'] };
  }
  for (const key of unknownKeys(value, CORPUS_KEYS)) errors.push(`corpus: unknown key "${key}"`);
  if (value.$schema !== CONVERSATIONAL_INTERLEAVING_CORPUS_SCHEMA) {
    errors.push(`corpus.$schema: expected "${CONVERSATIONAL_INTERLEAVING_CORPUS_SCHEMA}"`);
  }
  if (!Array.isArray(value.cases)) {
    errors.push('corpus.cases: expected an array');
    return { ok: false, errors };
  }

  const ids: string[] = [];
  const seenIds = new Set<string>();
  const validatedCases: InterleavingCorpusCase[] = [];

  value.cases.forEach((entry, index) => {
    const path = `corpus.cases[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    for (const key of unknownKeys(entry, CASE_KEYS)) errors.push(`${path}: unknown key "${key}"`);

    const id = entry.id;
    if (typeof id !== 'string' || !/^I[1-5]$/.test(id)) {
      errors.push(`${path}.id: expected one of I1|I2|I3|I4|I5`);
      // Keep the raw id in the set so the exact-I1-I5 check can also report
      // unexpected ids (e.g. "I6") alongside missing required ids.
      if (typeof id === 'string') ids.push(id);
      return;
    }
    ids.push(id);
    if (seenIds.has(id)) {
      errors.push(`${path}.id: duplicate case id "${id}"`);
      return;
    }
    seenIds.add(id);

    if (!isNonEmptyString(entry.locale)) errors.push(`${path}.locale: expected a non-empty string`);
    if (!isNonEmptyString(entry.prompt)) errors.push(`${path}.prompt: expected a non-empty string`);

    const tools = validateTools(entry.tools, `${path}.tools`, errors);
    const expectation = validateExpectation(entry.expectation, `${path}.expectation`, errors);
    if (!tools || !expectation) return;

    // I3 disables the generic presentation tools plus the frozen business
    // presentation tools; every disabled tool must be a forbidden call so the
    // policy and the runner's tool-disable list cannot drift apart.
    if (id === 'I3') {
      if (!tools.disable.includes('interactive_ui')) errors.push(`${path}.tools.disable: I3 must disable "interactive_ui"`);
      if (!tools.disable.includes('html_artifact')) errors.push(`${path}.tools.disable: I3 must disable "html_artifact"`);
    }
    for (const tool of tools.disable) {
      if (!expectation.forbiddenToolNames?.includes(tool)) {
        errors.push(`${path}: tools.disable tool "${tool}" must be listed in expectation.forbiddenToolNames`);
      }
    }

    validatedCases.push({
      id: id as CorpusCaseId,
      locale: String(entry.locale),
      prompt: String(entry.prompt),
      tools,
      expectation,
    });
  });

  // Exact I1-I5: no missing, no extra, no duplicates.
  const idSet = new Set(ids);
  for (const expectedId of CONVERSATIONAL_CORPUS_CASE_IDS) {
    if (!idSet.has(expectedId)) errors.push(`corpus.cases: missing required case id "${expectedId}"`);
  }
  for (const id of ids) {
    if (!CONVERSATIONAL_CORPUS_CASE_IDS.includes(id as CorpusCaseId)) {
      errors.push(`corpus.cases: unexpected case id "${id}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    corpus: { $schema: CONVERSATIONAL_INTERLEAVING_CORPUS_SCHEMA, cases: validatedCases },
  };
};

/** Load + strictly validate the frozen corpus file. */
export const loadConversationalInterleavingCorpus = async (filePath: string): Promise<CorpusValidationResult> => {
  const { readFile } = await import('node:fs/promises');
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return { ok: false, errors: [`load: ${error instanceof Error ? error.message : String(error)}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`parse: ${error instanceof Error ? error.message : String(error)}`] };
  }
  return validateConversationalInterleavingCorpus(parsed);
};
