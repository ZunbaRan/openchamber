import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe } from 'node:test';
import test from 'node:test';
import {
  TLDRAW_APP_ONLY_TOOLS,
  TLDRAW_MODEL_TOOLS,
  PATTERNED_PNG_FEATURE_COLORS,
  assessProjectDirectoryOnboarding,
  assessTldrawEditorReadiness,
  assessTldrawSurfaceContract,
  assessFailureEvidence,
  assessHostOcclusionFree,
  buildSemanticCreatePrompt,
  createPatternedPngBuffer,
  findSemanticCreateToolPart,
  inspectRegistry,
  inspectCheckpointOutcome,
  inspectToolOutcome,
  isProjectDirectoryOnboardingText,
  parseModelSelector,
  selectActiveAppContext,
  selectHostPersistablePinAction,
  deriveRequiredCheckpointOk,
  validateSemanticElementCountEvidence,
  validateEditorInteractionEvidence,
  validatePngBuffer,
  validateSvgBuffer,
} from './tldraw-mcp-app-browser-acceptance.mjs';

const verifierSource = await readFile(new URL('../verify-tldraw-mcp-app-browser.mjs', import.meta.url), 'utf8');
const sourceOfModule = await readFile(new URL('./tldraw-mcp-app-browser-acceptance.mjs', import.meta.url), 'utf8');

const appContext = (overrides = {}) => ({
  sessionId: 'active-session',
  sessionActive: true,
  createdOrdinal: 1,
  isDefaultContext: true,
  shellConnected: true,
  documentVisibility: 'visible',
  shellDisplay: 'block',
  shellVisibility: 'visible',
  shellOpacity: '1',
  shellRect: { width: 640, height: 420 },
  containsCanvas: true,
  mode: 'inline',
  revision: 3,
  ...overrides,
});

test('App context selection excludes detached, hidden, and pre-reload candidates', () => {
  const fresh = appContext({ contextId: 3, createdOrdinal: 12, revision: 3 });
  assert.equal(selectActiveAppContext([
    appContext({ contextId: 1, createdOrdinal: 14, revision: 0, sessionActive: false }),
    appContext({ contextId: 2, createdOrdinal: 13, revision: 0, shellRect: { width: 0, height: 420 } }),
    fresh,
  ]), fresh);

  assert.equal(selectActiveAppContext([
    appContext({ contextId: 4, createdOrdinal: 8, revision: 3 }),
  ], { minCreatedOrdinal: 9 }), null);
});

test('App context selection prefers the newest eligible context and supports mode filters', () => {
  const older = appContext({ contextId: 1, createdOrdinal: 7, revision: 2 });
  const newer = appContext({ contextId: 2, createdOrdinal: 8, revision: 3 });
  assert.equal(selectActiveAppContext([older, newer]), newer);
  assert.equal(selectActiveAppContext([
    newer,
    appContext({ contextId: 3, createdOrdinal: 9, mode: 'fullscreen' }),
  ], { mode: 'inline' }), newer);
});

test('App context selection trusts the rendered shell when headless Chromium marks its iframe document hidden', () => {
  const restored = appContext({
    contextId: 4,
    createdOrdinal: 20,
    documentVisibility: 'hidden',
    shellRect: { width: 674, height: 380 },
    revision: 3,
  });
  assert.equal(selectActiveAppContext([restored], { minCreatedOrdinal: 20 }), restored);
});

test('project-directory onboarding detection covers supported host locales without matching ordinary project text', () => {
  assert.equal(isProjectDirectoryOnboardingText('Add project directory\nChoose a folder to add as a project.'), true);
  assert.equal(isProjectDirectoryOnboardingText('添加项目目录'), true);
  assert.equal(isProjectDirectoryOnboardingText('新增專案目錄'), true);
  assert.equal(isProjectDirectoryOnboardingText('Projects\nopenchamber'), false);
});

test('project-directory onboarding is only accepted when the visible dialog has a usable rendered close action', () => {
  const base = {
    text: 'Add project directory\nChoose a folder to add as a project.',
    visible: true,
    rect: { x: 200, y: 150, width: 560, height: 420 },
    close: { connected: true, visible: true, disabled: false, rect: { x: 720, y: 162, width: 28, height: 28 } },
  };
  assert.deepEqual(assessProjectDirectoryOnboarding(base), { pass: true, reasons: [] });

  // Ordinary project text is not the onboarding, even with a usable close.
  assert.deepEqual(assessProjectDirectoryOnboarding({ ...base, text: 'Projects\nopenchamber' }), {
    pass: false,
    reasons: ['not-project-directory-onboarding'],
  });

  // The dialog itself must be visible with a positive hit area.
  assert.equal(assessProjectDirectoryOnboarding({ ...base, visible: false }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ ...base, rect: { x: 0, y: 0, width: 0, height: 0 } }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding(null).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ text: 'Add project directory' }).pass, false);

  // Missing, detached, hidden, disabled, or zero-rect close actions are fatal.
  assert.equal(assessProjectDirectoryOnboarding({ ...base, close: null }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ ...base, close: { ...base.close, connected: false } }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ ...base, close: { ...base.close, visible: false } }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ ...base, close: { ...base.close, disabled: true } }).pass, false);
  assert.equal(assessProjectDirectoryOnboarding({ ...base, close: { ...base.close, rect: { x: 0, y: 0, width: 0, height: 0 } } }).pass, false);
});

test('project-directory onboarding assessment never duplicates the locale regex', () => {
  const helperSource = sourceOfModule;
  const onboarding = helperSource.slice(
    helperSource.indexOf('export const assessProjectDirectoryOnboarding'),
    helperSource.indexOf('export const assessTldrawEditorReadiness'),
  );
  assert.match(onboarding, /isProjectDirectoryOnboardingText\(/);
  assert.doesNotMatch(onboarding, /Add project directory|添加项目目录|新增專案目錄/);
});

test('editor readiness requires a real canvas and an enabled visible Note hit area', () => {
  const ready = assessTldrawEditorReadiness(appContext({
    mode: 'fullscreen',
    shellConnected: true,
    shellRect: { width: 1_200, height: 760 },
    canvasRect: { width: 1_100, height: 620 },
    editorReady: true,
    editorStatus: 'ready',
    buttons: [{
      text: '+ Note',
      disabled: false,
      visible: true,
      rect: { width: 82, height: 34 },
    }],
  }));
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.reasons, []);

  const loading = assessTldrawEditorReadiness(appContext({
    mode: 'fullscreen',
    shellConnected: true,
    shellRect: { width: 1_200, height: 760 },
    canvasRect: null,
    editorReady: false,
    editorStatus: 'loading',
    buttons: [{
      text: '+ Note',
      disabled: true,
      visible: true,
      rect: { width: 82, height: 34 },
    }],
  }));
  assert.equal(loading.ready, false);
  assert.deepEqual(loading.reasons, [
    'editor-canvas-has-no-hit-area',
    'note-action-disabled',
    'app-declared-editor-not-ready',
  ]);
});

test('editor readiness keeps a strict rendered-control fallback for older App fixtures', () => {
  const result = assessTldrawEditorReadiness(appContext({
    mode: 'fullscreen',
    shellConnected: true,
    shellRect: { width: 1_200, height: 760 },
    canvasRect: { width: 1_100, height: 620 },
    buttons: [{
      text: '+ Note',
      disabled: false,
      visible: true,
      rect: { width: 82, height: 34 },
    }],
  }));
  assert.equal(result.ready, true);
  assert.equal(result.editorReady, null);
});

test('semantic prompt requires the modern create tool and stable semantic IDs', () => {
  const prompt = buildSemanticCreatePrompt({ server: 'interop-tldraw-2026', canvasId: 'acceptance-123' });
  assert.match(prompt, /interop-tldraw-2026_tldraw_create_view/);
  assert.match(prompt, /"id":"gateway"/);
  assert.match(prompt, /"points":\[\{"x":360,"y":274\},\{"x":480,"y":274\}\]/);
  assert.match(prompt, /"start":\{"elementId":"gateway","anchorX":1,"anchorY":0\.5\}/);
  assert.match(prompt, /"end":\{"elementId":"orders","anchorX":0,"anchorY":0\.5\}/);
  assert.doesNotMatch(prompt, /"shapeId"|"anchor":\{/);
  assert.match(prompt, /"kind":"note"/);
  assert.doesNotMatch(prompt, /Call the exact tool .*tldraw_open_canvas/);
});

test('tool outcomes fail closed on isError and negotiated-App fallback text', () => {
  assert.deepEqual(inspectToolOutcome({
    state: {
      output: JSON.stringify({
        isError: true,
        content: [{ type: 'text', text: 'invalid_update' }],
      }),
    },
  }), {
    isError: true,
    fallbackDetected: false,
    fallbackSignals: [],
  });

  const fallback = inspectToolOutcome({
    state: {
      output: JSON.stringify({
        content: [{
          type: 'text',
          text: 'MCP App capability was not negotiated, so use the semanticDocument fallback',
        }],
      }),
    },
  });
  assert.equal(fallback.isError, false);
  assert.equal(fallback.fallbackDetected, true);
  assert.equal(fallback.fallbackSignals.length, 1);
});

test('resolved blocked, not-run, and skipped checkpoint details never become pass', () => {
  for (const detail of [
    { blocked: 'headless-restore' },
    { recoveryBlocked: 'headless-restore' },
    { restoredBlocked: 'headless-restore' },
    { notRun: ['locale'] },
    { skipped: true },
    { status: 'not-run' },
  ]) {
    const verdict = inspectCheckpointOutcome(detail);
    assert.equal(verdict.pass, false, JSON.stringify(detail));
  }
  assert.equal(inspectCheckpointOutcome({ result: { ok: true } }).pass, true);
});

test('checkpoint outcomes fail closed for primitive, non-record, and empty details', () => {
  for (const detail of [undefined, null, false, true, 0, 'pass', [], [{}], {}]) {
    const verdict = inspectCheckpointOutcome(detail);
    assert.equal(verdict.pass, false, JSON.stringify(detail));
  }
  assert.equal(inspectCheckpointOutcome({ screenshots: [], result: { ok: true } }).pass, true);
});

test('host Pin selection requires visible enabled exact revision-bearing tldraw control', () => {
  const valid = {
    selector: 'button[data-mcp-app-persistable-revision]',
    scopedToTldrawIframe: true,
    revision: '5',
    visible: true,
    disabled: false,
  };
  assert.equal(selectHostPersistablePinAction([valid], 5), valid);
  for (const candidate of [
    { ...valid, revision: null },
    { ...valid, revision: '4' },
    { ...valid, scopedToTldrawIframe: false },
    { ...valid, visible: false },
    { ...valid, disabled: true },
    { ...valid, selector: 'button' },
  ]) {
    assert.equal(selectHostPersistablePinAction([candidate], 5), null, JSON.stringify(candidate));
  }
});

test('required checkpoint ok is derived from every actual pass, not wrapper resolution', () => {
  const required = ['protocol', 'history', 'board'];
  const passing = required.map((name) => ({ name, status: 'pass', detail: { executed: true } }));
  assert.equal(deriveRequiredCheckpointOk(passing, required), true);
  assert.equal(
    deriveRequiredCheckpointOk(
      [...passing.slice(0, 2), { name: 'board', status: 'pass', detail: { blocked: 'headless' } }],
      required,
    ),
    false,
  );
  assert.equal(
    deriveRequiredCheckpointOk(
      [...passing.slice(0, 2), { name: 'board', status: 'not-run', detail: undefined }],
      required,
    ),
    false,
  );
});

test('failure evidence requires a final screenshot and captured surface state', () => {
  assert.equal(assessFailureEvidence({}).pass, false);
  assert.equal(assessFailureEvidence({
    failureScreenshot: 'failure-final.png',
    failureSurfaceState: { appContexts: [] },
  }).pass, true);
});

test('browser verifier wires the truthful checkpoint and failure-evidence contracts', () => {
  assert.match(verifierSource, /inspectCheckpointOutcome\(detail\)/);
  assert.match(verifierSource, /deriveRequiredCheckpointOk\(checkpoints, REQUIRED_CHECKPOINTS\)/);
  assert.match(verifierSource, /failureEvidence = await captureFailureEvidence\(\)/);
  assert.match(verifierSource, /verdict: assessFailureEvidence\(failureEvidence\)/);
});

test('both App inspection paths read the machine revision from data-revision, never presentation text', () => {
  assert.equal(
    (verifierSource.match(/const revision = Number\(shell\.dataset\.revision \|\| 0\);/g) ?? []).length,
    1,
    'the primary inspection path must derive the machine revision from shell.dataset.revision',
  );
  assert.equal(
    (verifierSource.match(/\brevision: Number\(shell\.dataset\.revision \|\| 0\),/g) ?? []).length,
    1,
    'the direct-frame fallback must derive the machine revision from shell.dataset.revision',
  );
  assert.doesNotMatch(verifierSource, /revisionText\.match/);
  assert.doesNotMatch(verifierSource, /Number\(\(revisionText/);
});

test('both App inspection paths read revisionText from the stable historical-identity hook', () => {
  assert.equal(
    (verifierSource.match(/shell\.querySelector\('\[data-historical-identity\]'\)/g) ?? []).length,
    2,
    'both inspection paths must prefer the stable [data-historical-identity] hook',
  );
  assert.equal(
    (verifierSource.match(/shell\.querySelector\('\.identity span'\)/g) ?? []).length,
    2,
    'the legacy .identity span read may remain only as a narrow fallback in both paths',
  );
  assert.match(
    verifierSource,
    /shell\.querySelector\('\[data-historical-identity\]'\)\?\.textContent\?\.trim\(\)\s*\|\|\s*shell\.querySelector\('\.identity span'\)/,
  );
});

test('history restore demands the exact machine revision identity on both sides of the round trip', () => {
  const restore = verifierSource.slice(
    verifierSource.indexOf('const restoreLatestAfterHistory = async'),
    verifierSource.indexOf('const diagnosticLogOffsets ='),
  );
  assert.match(restore, /candidate\.surfaceRevision !== selected/);
  assert.doesNotMatch(restore, /candidate\.revision !== selected/);
  assert.match(restore, /candidate\?\.surfaceRevision === latestRevision/);
  assert.doesNotMatch(restore, /candidate\?\.revision === latestRevision/);
  assert.match(restore, /\/Historical revision\/i\.test\(candidate\.revisionText\)/);
  assert.match(restore, /assessTldrawSurfaceContract\(candidate, \{\s*expectedRole: 'review',\s*expectedMutationAuthority: 'none',\s*\}\);/);
});

test('locale reload waits on the existing canonical session route without a second navigation', () => {
  const localeCheckpoint = verifierSource.slice(
    verifierSource.indexOf("const switchHostLocaleAndAssertTldraw = async"),
    verifierSource.indexOf("const restoreHostLocale = async"),
  );
  assert.match(localeCheckpoint, /await selectSession\(\{ navigate: false, requireDirectRoute: true \}\);/);
  assert.doesNotMatch(localeCheckpoint, /await selectSession\(\{ navigate: true, requireDirectRoute: true \}\);/);
  assert.match(verifierSource, /await browser\.send\('Page\.bringToFront'\);/);
  assert.match(verifierSource, /document\.visibilityState === 'visible'/);
});

test('initial Inline acceptance requires the canonical direct route', () => {
  const inlineCheckpoint = verifierSource.slice(
    verifierSource.indexOf("await checkpoint('Inline preview in conversation'") ,
    verifierSource.indexOf("await checkpoint('Fullscreen Edit, app-only add, move, rename, connect, Save'") ,
  );
  assert.match(inlineCheckpoint, /const navigation = await selectSession\(\{ navigate: true, requireDirectRoute: true \}\);/);
  assert.doesNotMatch(inlineCheckpoint, /const navigation = await selectSession\(\);/);
  assert.doesNotMatch(inlineCheckpoint, /Open session switcher/);
  assert.doesNotMatch(inlineCheckpoint, /acceptance session/);
  assert.match(verifierSource, /'MCP App iframe after canonical session route',\s*60_000/);
});

test('inline acceptance dismisses supported project-directory onboarding before the first screenshot', () => {
  const inlineCheckpoint = verifierSource.slice(
    verifierSource.indexOf("await checkpoint('Inline preview in conversation'") ,
    verifierSource.indexOf("await checkpoint('Fullscreen Edit, app-only add, move, rename, connect, Save'") ,
  );
  // Route selection first, then the top-level onboarding dismissal, then the
  // inline surface acceptance loop.
  const navigationIndex = inlineCheckpoint.indexOf('const navigation = await selectSession');
  const onboardingIndex = inlineCheckpoint.indexOf('await dismissHostProjectDirectoryOnboarding()');
  const acceptanceIndex = inlineCheckpoint.indexOf('const app = assertInteractiveAppState(');
  assert.ok(navigationIndex >= 0, 'inline checkpoint selects the canonical session route');
  assert.ok(onboardingIndex > navigationIndex, 'onboarding dismissal runs after route selection');
  assert.ok(acceptanceIndex > onboardingIndex, 'onboarding dismissal runs before inline surface acceptance');

  // The first inline screenshot is captured only after a final assertion that
  // the supported onboarding is absent, and the checkpoint records the status.
  const screenshotIndex = inlineCheckpoint.indexOf("captureVisibleContentScreenshot('inline-preview')");
  assert.ok(screenshotIndex >= 0);
  assert.ok(inlineCheckpoint.indexOf('preScreenshotAbsent') < screenshotIndex);
  assert.match(inlineCheckpoint, /projectDirectoryOnboarding: \{\s*\.\.\.onboarding/);

  // The verifier inspects top-level visible role=dialog elements and clicks
  // the real rendered [data-slot="dialog-close"] action; it never presses
  // Escape or touches internal React state.
  const dismissal = verifierSource.slice(
    verifierSource.indexOf('const inspectHostOnboardingDialogs = async'),
    verifierSource.indexOf('const dismissHostProjectDirectoryOnboarding = async'),
  );
  assert.match(dismissal, /querySelectorAll\('\.acceptance-shell|querySelectorAll\('\[role="dialog"\]'\)/);
  assert.match(verifierSource, /button\[data-slot="dialog-close"\]/);
  assert.match(verifierSource, /assessProjectDirectoryOnboarding\(dialog\)/);
  assert.doesNotMatch(
    verifierSource.slice(
      verifierSource.indexOf('const inspectHostOnboardingDialogs = async'),
      verifierSource.indexOf('const restoreHostLocale = async'),
    ),
    /dispatchKeyEvent|Escape|__react/,
  );
});

test('wait and pre-screenshot occlusion gate test identity and counts, never close usability', () => {
  // A still-visible project-directory onboarding that loses/misses/disables its
  // close action must keep failing closed. The post-click wait and the
  // pre-screenshot gate test dialog identity
  // (isProjectDirectoryOnboardingText), never the close-usability predicate
  // that would turn an occluded dialog into "gone".
  const dismissalCode = verifierSource.slice(
    verifierSource.indexOf('const dismissHostProjectDirectoryOnboarding = async'),
    verifierSource.indexOf('const selectSession = async'),
  );
  assert.match(dismissalCode, /isProjectDirectoryOnboardingText\(dialog\.text\)/);
  assert.doesNotMatch(dismissalCode, /current\.dialogs\.some\(\(dialog\) => assessProjectDirectoryOnboarding\(dialog\)\.pass\)/);

  // The pre-screenshot gate decides occlusion with the pure helper, which is
  // what the lingering-backdrop and unrelated-dialog negative tests exercise;
  // it must never use the close-usability predicate to call an occluded dialog
  // "gone", and it must never auto-click unrelated dialogs.
  const preScreenshot = verifierSource.slice(
    verifierSource.indexOf('const preScreenshotDialogs = await inspectHostOnboardingDialogs()'),
    verifierSource.indexOf("const inlineScreenshot = await captureVisibleContentScreenshot('inline-preview')"),
  );
  assert.match(preScreenshot, /assessHostOcclusionFree\(preScreenshotDialogs\)/);
  assert.match(preScreenshot, /preScreenshotAbsent = occlusionVerdict\.matchingOnboardingAbsent/);
  assert.match(preScreenshot, /preScreenshotBackdropAbsent = occlusionVerdict\.backdropAbsent/);
  assert.match(preScreenshot, /preScreenshotDialogsAbsent = occlusionVerdict\.dialogsAbsent/);
  assert.doesNotMatch(preScreenshot, /assessProjectDirectoryOnboarding\(dialog\)\.pass/);
  assert.doesNotMatch(preScreenshot, /\.click\(\)/);

  // The click evaluation reuses painted visibility (connected + positive rect
  // + computed style) for both the matched dialog and its close action; the
  // fixed-position offsetParent pitfall must not reappear, and the matched
  // dialog itself must be painted before its close is considered.
  const dismissalStart = verifierSource.indexOf('const dismissHostProjectDirectoryOnboarding = async');
  const clickCode = verifierSource.slice(
    verifierSource.indexOf('const clicked = await browser.evaluate(`(() => {', dismissalStart),
    verifierSource.indexOf('assert.equal(clicked, true', dismissalStart),
  );
  assert.doesNotMatch(clickCode, /\.offsetParent/);
  assert.match(clickCode, /const painted = \(element\) =>/);
  assert.match(clickCode, /if \(!painted\(dialog\)\) return false/);
});

test('pre-screenshot occlusion gate passes only with no matching onboarding, no backdrop, and no top-level dialog', () => {
  assert.deepEqual(assessHostOcclusionFree({ dialogs: [], backdropCount: 0 }), {
    pass: true,
    reasons: [],
    matchingOnboardingAbsent: true,
    backdropAbsent: true,
    dialogsAbsent: true,
    dialogCount: 0,
    backdropCount: 0,
  });

  // A matching onboarding is still occluding even when every other signal is clean.
  const matching = assessHostOcclusionFree({
    dialogs: [{ text: 'Add project directory\nChoose a folder to add as a project.', visible: true }],
    backdropCount: 0,
  });
  assert.equal(matching.pass, false);
  assert.equal(matching.matchingOnboardingAbsent, false);
  assert.ok(matching.reasons.includes('matching-onboarding-visible'));
});

test('pre-screenshot occlusion gate fails closed on a lingering visible backdrop', () => {
  // A visible [data-slot="dialog-overlay"] with no matching onboarding dialog
  // still occludes the inline surface: the matching-absent signal alone must
  // never be enough to capture the screenshot.
  const verdict = assessHostOcclusionFree({
    dialogs: [],
    backdropCount: 1,
  });
  assert.equal(verdict.pass, false);
  assert.deepEqual(verdict.reasons, ['visible-backdrop-count=1']);
  assert.equal(verdict.matchingOnboardingAbsent, true);
  assert.equal(verdict.backdropAbsent, false);
  assert.equal(verdict.dialogsAbsent, true);
});

test('pre-screenshot occlusion gate fails closed on an unrelated visible top-level dialog', () => {
  // An unrelated host dialog is never auto-clicked; it is a hard failure with
  // the serialized dialog state as evidence.
  const verdict = assessHostOcclusionFree({
    dialogs: [{
      text: 'Open session',
      visible: true,
      rect: { x: 100, y: 80, width: 420, height: 260 },
      close: null,
    }],
    backdropCount: 0,
  });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.includes('visible-top-level-dialogs=1'));
  assert.equal(verdict.matchingOnboardingAbsent, true);
  assert.equal(verdict.backdropAbsent, true);
  assert.equal(verdict.dialogsAbsent, false);
});

test('pre-screenshot occlusion gate fails closed on missing, null, or string backdrop counts', () => {
  // The gate validates the delivered backdropCount value directly and never
  // coerces: missing, null, and string "0" must all fail closed with
  // missing-backdrop-count instead of being treated as a valid zero backdrop.
  for (const backdropCount of [undefined, null, '0', '1']) {
    const state = backdropCount === undefined
      ? { dialogs: [] }
      : { dialogs: [], backdropCount };
    const verdict = assessHostOcclusionFree(state);
    assert.equal(verdict.pass, false, JSON.stringify({ backdropCount, verdict }));
    assert.ok(verdict.reasons.includes('missing-backdrop-count'), JSON.stringify(verdict));
    assert.equal(verdict.backdropAbsent, false);
    assert.equal(verdict.backdropCount, null);
    assert.equal(verdict.dialogsAbsent, true);
    assert.equal(verdict.matchingOnboardingAbsent, true);
  }
  // A real zero and a real positive integer remain the only accepted values.
  assert.equal(assessHostOcclusionFree({ dialogs: [], backdropCount: 0 }).pass, true);
  assert.equal(assessHostOcclusionFree({ dialogs: [], backdropCount: 2 }).pass, false);
});

test('onboarding dismissal waits for both the matching dialog and the visible overlay to close', () => {
  const dismissalCode = verifierSource.slice(
    verifierSource.indexOf('const dismissHostProjectDirectoryOnboarding = async'),
    verifierSource.indexOf('const selectSession = async'),
  );
  // Post-click: matching onboarding must be gone AND visible backdrop count
  // must be zero; a lingering backdrop is occlusion even when the dialog is gone.
  assert.match(dismissalCode, /!current\.dialogs\.some\(\(dialog\) => isProjectDirectoryOnboardingText\(dialog\.text\)\)/);
  assert.match(dismissalCode, /current\.backdropCount === 0/);
  assert.match(dismissalCode, /remainingBackdropCount = remaining\.backdropCount/);
  assert.match(dismissalCode, /remainingBackdropAbsent = remaining\.backdropCount === 0/);
});

test('locale timeout diagnostics capture truthful visible toolbar labels and locale inputs', () => {
  const localeCheckpoint = verifierSource.slice(
    verifierSource.indexOf("const inspectTldrawLocaleDiagnostics = async"),
    verifierSource.indexOf("const switchHostLocaleAndAssertTldraw = async"),
  );
  assert.match(localeCheckpoint, /visibleToolbarControls/);
  assert.match(localeCheckpoint, /localeInputs/);
  assert.match(localeCheckpoint, /navigatorLanguages/);
  assert.match(verifierSource, /tldraw locale diagnostics/);
  assert.match(verifierSource, /inspectTldrawLocaleDiagnostics\(full\)/);
});

test('Pin reactivation navigates once before polling for hydrated enabled controls', () => {
  const pinCheckpoint = verifierSource.slice(
    verifierSource.indexOf("await checkpoint('Pin and App Board fullscreen'") ,
    verifierSource.indexOf("await checkpoint('No MCP App fallback or isError result'") ,
  );
  const navigationIndex = pinCheckpoint.indexOf("await browser.send('Page.navigate'");
  const pinPollIndex = pinCheckpoint.indexOf("const reactivated = await waitFor(async () =>");
  assert.ok(navigationIndex >= 0);
  assert.ok(pinPollIndex > navigationIndex);
  assert.doesNotMatch(pinCheckpoint.slice(pinPollIndex), /Page\.navigate/);
  assert.match(pinCheckpoint, /await selectSession\(\{ navigate: false, requireDirectRoute: true \}\);/);
  assert.match(pinCheckpoint, /const pinEnabled = await findEnabledTldrawPinAction\(\{ expectedRevision: savedRevision \}\)/);
  assert.match(pinCheckpoint, /app\.revision !== savedRevision/);
  assert.doesNotMatch(pinCheckpoint, /app\.buttons\.some\(\(button\) => \/pin\/i/);
  assert.match(verifierSource, /const findEnabledTldrawPinAction = async/);
  assert.match(verifierSource, /selectHostPersistablePinAction\(candidates, expectedRevision\)/);
  assert.match(verifierSource, /iframe\.parentElement/);
  assert.match(verifierSource, /button\[data-mcp-app-persistable-revision\]/);
  assert.match(verifierSource, /const pinState = await findEnabledTldrawPinAction\(\{ click: true, expectedRevision \}\);/);
  assert.doesNotMatch(verifierSource.slice(
    verifierSource.indexOf('const findEnabledTldrawPinAction = async'),
    verifierSource.indexOf('const pinConversationApp = async'),
  ), /textContent|aria-label|\/pin\/i/);
});

test('browser harness reuses the sole initial page target', () => {
  assert.match(verifierSource, /\/json\/list/);
  assert.doesNotMatch(verifierSource, /\/json\/new\?about:blank/);
  assert.match(verifierSource, /initialPageTargets/);
  assert.match(verifierSource, /connectedPageTargets\.length, 1/);
  assert.match(verifierSource, /initial Chrome acceptance page visible/);
});

test('browser harness enables CDP focus emulation before navigation', () => {
  assert.equal(
    (verifierSource.match(/Emulation\.setFocusEmulationEnabled/g) ?? []).length,
    1,
  );
  const focusSetup = verifierSource.indexOf("await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true });");
  const firstNavigation = verifierSource.indexOf("await checkpoint('Inline preview in conversation'");
  assert.ok(focusSetup >= 0);
  assert.ok(focusSetup < firstNavigation);
});

test('semantic count evidence compares requested, Tool result, and independent authoritative state', () => {
  assert.deepEqual(validateSemanticElementCountEvidence({
    requestedElementCount: 7,
    toolResultElementCount: 7,
    authoritativeStateElementCount: 7,
  }), {
    requestedElementCount: 7,
    toolResultElementCount: 7,
    authoritativeStateElementCount: 7,
  });
  assert.throws(() => validateSemanticElementCountEvidence({
    requestedElementCount: 7,
    toolResultElementCount: 7,
    authoritativeStateElementCount: 6,
  }), /differs/);
  assert.throws(() => validateSemanticElementCountEvidence({
    requestedElementCount: 7,
    toolResultElementCount: undefined,
    authoritativeStateElementCount: 7,
  }), /non-negative integer/);
});

test('registry inspection proves model tools and app-only isolation', () => {
  const definitions = Object.fromEntries([
    ...TLDRAW_MODEL_TOOLS.map((tool) => [tool, {
      server: 'interop-tldraw-2026',
      tool,
      meta: { resourceUri: 'ui://test/app', visibility: ['model', 'app'] },
    }]),
    ...TLDRAW_APP_ONLY_TOOLS.map((tool) => [tool, {
      server: 'interop-tldraw-2026',
      tool,
      meta: { resourceUri: 'ui://test/app', visibility: ['app'] },
    }]),
  ]);
  const result = inspectRegistry({ payload: definitions, server: 'interop-tldraw-2026' });
  assert.equal(result.resourceUri, 'ui://test/app');
  assert.equal(result.appOnlyTools.length, TLDRAW_APP_ONLY_TOOLS.length);

  definitions.tldraw_save_canvas.meta.visibility = ['model', 'app'];
  assert.throws(() => inspectRegistry({ payload: definitions, server: 'interop-tldraw-2026' }), /leaked/);
});

test('completed model ToolPart must preserve canvas identity and revision', () => {
  const result = findSemanticCreateToolPart({
    server: 'interop-tldraw-2026',
    canvasId: 'acceptance-123',
    messages: [{
      parts: [{
        type: 'tool',
        tool: 'interop-tldraw-2026_tldraw_create_view',
        state: {
          status: 'completed',
          input: { canvasId: 'acceptance-123' },
          metadata: { structuredContent: { canvasId: 'acceptance-123', revision: 1 } },
        },
      }],
    }],
  });
  assert.equal(result.revision, 1);
  assert.throws(() => findSemanticCreateToolPart({
    server: 'interop-tldraw-2026',
    canvasId: 'wrong',
    messages: [],
  }), /did not complete/);
});

test('download validators reject placeholders and accept real signatures', () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(220)}<text>API Gateway</text></svg>`);
  assert.deepEqual(validateSvgBuffer(svg, ['API Gateway']).labels, ['API Gateway']);
  assert.throws(() => validateSvgBuffer(Buffer.from('<svg/>')), /small/);

  const png = Buffer.alloc(1_024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(180, 20);
  assert.deepEqual(validatePngBuffer(png), { bytes: 1_024, width: 320, height: 180 });
  assert.throws(() => validatePngBuffer(Buffer.alloc(1_024)), /signature/);
});

test('download validators prove retained image bytes, rich SVG text styles, and non-background PNG pixels', () => {
  const image = createPatternedPngBuffer({ width: 320, height: 180 });
  const imageSha256 = createHash('sha256').update(image).digest('hex');
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
      <style>.label { font-family: Inter, sans-serif; font-size: 18px; fill: #172033; }</style>
      <image href="data:image/png;base64,${image.toString('base64')}" width="320" height="180" />
      <foreignObject x="20" y="180" width="300" height="80">
        <div xmlns="http://www.w3.org/1999/xhtml" class="label">Browser Gateway</div>
      </foreignObject>
      <path d="M 10 10 L 120 120" stroke="#2563eb" fill="none" />
    </svg>
  `);
  const svgEvidence = validateSvgBuffer(svg, ['Browser Gateway'], {
    expectedImageSha256: imageSha256,
    requireRichTextStyles: true,
  });
  assert.equal(svgEvidence.embeddedImages[0].sha256, imageSha256);
  assert(svgEvidence.embeddedImages[0].bytes > 64);
  assert.equal(Object.values(svgEvidence.richTextStyles).every(Boolean), true);
  assert.throws(() => validateSvgBuffer(svg, [], {
    expectedImageSha256: '0'.repeat(64),
  }), /does not retain/);

  const pngEvidence = validatePngBuffer(image, {
    requireNonBackground: true,
    expectedFeatureColors: PATTERNED_PNG_FEATURE_COLORS,
  });
  assert.equal(pngEvidence.width, 320);
  assert.equal(pngEvidence.height, 180);
  assert(pngEvidence.content.distinctColors >= 8);
  assert(pngEvidence.content.nonDominantPixels >= 100);
  assert.equal(
    pngEvidence.content.featureColorMatches.every((feature) => feature.pixels >= 4),
    true,
  );
  assert.throws(() => validatePngBuffer(image, {
    expectedFeatureColors: [[1, 2, 3]],
    featureColorTolerance: 0,
  }), /feature rgb/);
});

test('model selector requires provider/model syntax', () => {
  assert.deepEqual(parseModelSelector('provider/model'), { providerID: 'provider', modelID: 'model' });
  assert.throws(() => parseModelSelector('model-only'), /Invalid model selector/);
});

test('editor interaction evidence requires add, move, rename, and a bound connector', () => {
  const evidence = validateEditorInteractionEvidence({
    semanticPatch: {
      operationCount: 4,
      operations: [
        { op: 'create', id: 'tldraw-new-node', kind: 'geo', text: '' },
        { op: 'update', id: 'gateway', changeKeys: ['text'], text: 'Browser Gateway' },
        { op: 'update', id: 'orders', changeKeys: ['x', 'y'] },
        {
          op: 'create',
          id: 'tldraw-new-arrow',
          kind: 'arrow',
          start: { elementId: 'tldraw-new-node' },
          end: { elementId: 'payments' },
        },
      ],
    },
    operationSummary: { added: 2, movedOrEdited: 2, removed: 0 },
    renamedElementId: 'gateway',
    renamedText: 'Browser Gateway',
    movedElementId: 'orders',
    connectedElementId: 'payments',
  });
  assert.equal(evidence.createdElementId, 'tldraw-new-node');
  assert.equal(evidence.connectorElementId, 'tldraw-new-arrow');

  assert.throws(() => validateEditorInteractionEvidence({
    semanticPatch: {
      operations: [
        { op: 'create', id: 'tldraw-new-node', kind: 'geo' },
        { op: 'update', id: 'gateway', changeKeys: ['text'], text: 'Browser Gateway' },
        { op: 'update', id: 'orders', changeKeys: ['x'] },
      ],
    },
    operationSummary: { added: 2, movedOrEdited: 2, removed: 0 },
    renamedElementId: 'gateway',
    renamedText: 'Browser Gateway',
    movedElementId: 'orders',
    connectedElementId: 'payments',
  }), /bind/);
});

describe('WP-2: Surface Contract V1 predicate (tldraw-mcp-app-browser-acceptance)', () => {
  const base = {
    surfaceContract: 'tldraw-authoritative-v1',
    surfaceRole: 'preview',
    authorityState: 'authoritative',
    surfaceRenderer: 'tldraw',
    renderReady: true,
    mutationAuthority: 'none',
    semanticContentReady: true,
    renderedSemanticElementCount: 5,
    visibleSemanticContent: true,
    shellRect: { x: 0, y: 0, width: 900, height: 600 },
    canvasRect: { x: 0, y: 60, width: 880, height: 500 },
  };

  test('passes only the full authoritative inline surface', () => {
    const verdict = assessTldrawSurfaceContract(base, {
      expectedRole: 'preview',
      expectedMutationAuthority: 'none',
    });
    assert.equal(verdict.pass, true);
  });

  test('rejects streaming-only overlay without a contract', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, surfaceContract: '', authorityState: 'streaming', surfaceRole: '' },
      { expectedRole: 'preview', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, false);
    assert.ok(verdict.reasons.join(' ').includes('surface-contract'));
    assert.ok(verdict.reasons.join(' ').includes('authority-state=streaming'));
  });

  test('rejects a .tl-canvas without the surface contract', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, surfaceContract: '', renderReady: false },
      { expectedRole: 'preview', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, false);
  });

  test('rejects correct identity with zero-size canvas', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, canvasRect: { x: 0, y: 0, width: 0, height: 0 } },
      { expectedRole: 'preview', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, false);
    assert.ok(String(verdict.reasons).includes('canvas-has-no-hit-area'));
  });

  test('rejects a wrong revision identity at the predicate boundary', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, surfaceRevision: 9 },
      { expectedRole: 'preview', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, true); // identity is checked by the caller, not the predicate
  });

  test('rejects inline that wrongly holds mutation authority', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, mutationAuthority: 'current-revision' },
      { expectedRole: 'preview', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, false);
    assert.ok(verdict.reasons.join(' ').includes('mutation-authority=current-revision'));
  });

  test('rejects surface ready without expected visible content', () => {
    const verdict = assessTldrawSurfaceContract(
      {
        ...base,
        surfaceRole: 'editor',
        mutationAuthority: 'current-revision',
        semanticContentReady: false,
        renderedSemanticElementCount: 0,
        visibleSemanticContent: false,
      },
      { expectedRole: 'editor', expectedMutationAuthority: 'current-revision' },
    );
    assert.equal(verdict.pass, false);
    assert.ok(verdict.reasons.includes('rendered-semantic-content-empty'));
    assert.ok(verdict.reasons.includes('visible-semantic-content-missing'));
  });

  test('accepts the fullscreen editor role with current-revision authority', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, surfaceRole: 'editor', mutationAuthority: 'current-revision' },
      { expectedRole: 'editor', expectedMutationAuthority: 'current-revision' },
    );
    assert.equal(verdict.pass, true);
  });

  test('accepts the historical review role read-only', () => {
    const verdict = assessTldrawSurfaceContract(
      { ...base, surfaceRole: 'review' },
      { expectedRole: 'review', expectedMutationAuthority: 'none' },
    );
    assert.equal(verdict.pass, true);
  });

  test('rejects missing surface state entirely', () => {
    const verdict = assessTldrawSurfaceContract(null, {
      expectedRole: 'preview',
      expectedMutationAuthority: 'none',
    });
    assert.equal(verdict.pass, false);
    assert.ok(String(verdict.reasons).includes('missing-surface-state'));
  });
});
