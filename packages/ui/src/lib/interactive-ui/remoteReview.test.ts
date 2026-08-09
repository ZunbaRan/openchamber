import { describe, expect, test } from 'bun:test';
import {
  INITIAL_REMOTE_REVIEW_STATE,
  remoteReviewReducer,
  type RemoteReviewAction,
  type RemoteReviewState,
} from './remoteReview';
import type { RemoteInspection } from './extensionManager';

const inspection = (url: string): RemoteInspection => ({
  extension: { id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' },
  publisher: {
    id: 'com.acme.publisher',
    name: 'Acme',
    keyId: 'release-2026',
    fingerprint: `sha256-fingerprint-${url}`,
    trusted: false,
  },
  permissions: {
    resourceOrigins: [],
    networkOrigins: ['https://api.example.com'],
    externalLinkOrigins: [],
    credentialScopes: [],
    actionIds: [],
    agentToolNames: [],
    clipboard: false,
    popups: false,
    nativeCode: false,
  },
  manifest: {
    appEntryUrl: url,
    manifestHash: `sha256-hash-${url}`,
    publishedAt: '2026-08-05T00:00:00.000Z',
  },
  connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
});

// Runs a sequence of typed actions through the exact reducer the settings
// page uses, so the regression proves the real state machine.
const run = (state: RemoteReviewState, ...actions: RemoteReviewAction[]): RemoteReviewState => (
  actions.reduce(remoteReviewReducer, state)
);

describe('remoteReviewReducer', () => {
  test('first attempt A fails, then URL B review never receives key A', () => {
    const urlA = 'https://apps.example.com/a/manifest.json';
    const urlB = 'https://apps.example.com/b/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;

    // Attempt A fails: every key-bearing field is cleared (URL may remain).
    state = run(
      state,
      { type: 'setDraftUrl', url: urlA },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url: urlA, accessKey: 'sk-key-a' },
      { type: 'inspectFailed', requestId: 'attempt-a' },
    );
    expect(state.attempt).toBeNull();
    expect(state.review).toBeNull();
    expect(state.draftAccessKey).toBe('');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');

    // URL B reviewed with key B: the review carries B only.
    state = run(
      state,
      { type: 'setDraftUrl', url: urlB },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-b' },
      { type: 'beginInspect', requestId: 'attempt-b', url: urlB, accessKey: 'sk-key-b' },
      { type: 'inspectSucceeded', requestId: 'attempt-b', inspection: inspection(urlB) },
    );
    expect(state.review?.inspection.manifest.appEntryUrl).toBe(urlB);
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');
  });

  test('in-flight draft edits cannot rebind the captured key', () => {
    const url = 'https://apps.example.com/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      // The user edits the draft while the request is in flight.
      { type: 'setDraftAccessKey', accessKey: 'sk-key-edited-in-flight' },
      { type: 'setDraftUrl', url: 'https://apps.example.com/other/manifest.json' },
      // The stale-looking success for attempt A still binds to the captured key.
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
    );
    expect(state.review?.accessKey).toBe('sk-key-a');
    expect(JSON.stringify(state)).not.toContain('sk-key-edited-in-flight');
  });

  test('stale success after close is ignored', () => {
    const url = 'https://apps.example.com/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      { type: 'closeReview' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
    );
    expect(state.review).toBeNull();
    expect(state.attempt).toBeNull();
    expect(JSON.stringify(state)).not.toContain('sk-key-a');
  });

  test('stale success after a newer attempt is ignored; only the matching attempt binds', () => {
    const urlA = 'https://apps.example.com/a/manifest.json';
    const urlB = 'https://apps.example.com/b/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url: urlA, accessKey: 'sk-key-a' },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-b' },
      { type: 'beginInspect', requestId: 'attempt-b', url: urlB, accessKey: 'sk-key-b' },
      // attempt-a's completion arrives late: ignored, attempt-b stays active.
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(urlA) },
    );
    expect(state.review).toBeNull();
    expect(state.attempt?.requestId).toBe('attempt-b');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');

    state = run(state, { type: 'inspectSucceeded', requestId: 'attempt-b', inspection: inspection(urlB) });
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(state.review?.inspection.manifest.appEntryUrl).toBe(urlB);
    expect(JSON.stringify(state)).not.toContain('sk-key-a');
  });

  test('cancel and dialog close clear attempt, draft key, and review key', () => {
    const url = 'https://apps.example.com/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
      { type: 'setReviewAccessKey', accessKey: 'sk-key-edited' },
    );
    expect(state.review?.accessKey).toBe('sk-key-edited');
    state = run(state, { type: 'closeReview' });
    expect(state.review).toBeNull();
    expect(state.attempt).toBeNull();
    expect(state.draftAccessKey).toBe('');
    expect(JSON.stringify(state)).not.toContain('sk-key-edited');
    // URL remains for convenience but carries no key.
    expect(state.draftUrl).toBe(url);
  });

  test('connect success clears all key-bearing state', () => {
    const url = 'https://apps.example.com/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
      { type: 'beginConnect', requestId: 'connect-a' },
      { type: 'connectSucceeded', requestId: 'connect-a' },
    );
    expect(state).toEqual(INITIAL_REMOTE_REVIEW_STATE);
    expect(JSON.stringify(state)).not.toContain('sk-key-a');
  });

  test('matching connect failure clears the reviewed key, attempt, and draft key immediately', () => {
    const url = 'https://apps.example.com/manifest.json';
    // A fully reviewed state with a captured key and an edited review key.
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-draft-key' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-draft-key' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
      { type: 'setReviewAccessKey', accessKey: 'sk-review-key' },
      { type: 'beginConnect', requestId: 'connect-a' },
    );
    expect(state.review?.accessKey).toBe('sk-review-key');
    expect(state.attempt).toBeNull();

    state = run(state, { type: 'connectFailed', requestId: 'connect-a' });
    // Every key-bearing field is cleared; only the non-secret URL remains.
    expect(state.review).toBeNull();
    expect(state.attempt).toBeNull();
    expect(state.draftAccessKey).toBe('');
    expect(state.connectRequestId).toBeNull();
    expect(state.draftUrl).toBe(url);
    expect(JSON.stringify(state)).not.toContain('sk-review-key');
    expect(JSON.stringify(state)).not.toContain('sk-draft-key');
    expect(JSON.stringify(state)).not.toContain('sk-key');

    // connectFailed with a live attempt also clears it (stale attempt safety).
    state = run(
      state,
      { type: 'setDraftAccessKey', accessKey: 'sk-draft-key' },
      { type: 'beginInspect', requestId: 'attempt-b', url, accessKey: 'sk-draft-key' },
      { type: 'beginConnect', requestId: 'connect-b' },
      { type: 'connectFailed', requestId: 'connect-b' },
    );
    expect(state.attempt).toBeNull();
    expect(state.review).toBeNull();
    expect(state.draftAccessKey).toBe('');
    expect(state.connectRequestId).toBeNull();
    expect(JSON.stringify(state)).not.toContain('sk-draft-key');
  });

  test('stale connect completions after close cannot clear or rebind a newer review', () => {
    const url = 'https://apps.example.com/manifest.json';
    // Review A with a captured key, connect A starts, then the dialog is
    // closed and a NEW review B (with key B) is created.
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
      { type: 'beginConnect', requestId: 'connect-a' },
      { type: 'closeReview' },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-b' },
      { type: 'beginInspect', requestId: 'attempt-b', url, accessKey: 'sk-key-b' },
      { type: 'inspectSucceeded', requestId: 'attempt-b', inspection: inspection(url) },
    );
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(state.connectRequestId).toBeNull();

    // A's late failure/success must not clear review B or its key.
    state = run(state, { type: 'connectFailed', requestId: 'connect-a' });
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');
    state = run(state, { type: 'connectSucceeded', requestId: 'connect-a' });
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');

    // A matching completion for review B still clears everything.
    state = run(
      state,
      { type: 'beginConnect', requestId: 'connect-b' },
      { type: 'connectSucceeded', requestId: 'connect-b' },
    );
    expect(state).toEqual(INITIAL_REMOTE_REVIEW_STATE);
    expect(JSON.stringify(state)).not.toContain('sk-key-b');
  });

  test('in-flight review key edits stay secret-safe under stale connect completions', () => {
    const url = 'https://apps.example.com/manifest.json';
    let state = INITIAL_REMOTE_REVIEW_STATE;
    state = run(
      state,
      { type: 'setDraftUrl', url },
      { type: 'setDraftAccessKey', accessKey: 'sk-key-a' },
      { type: 'beginInspect', requestId: 'attempt-a', url, accessKey: 'sk-key-a' },
      { type: 'inspectSucceeded', requestId: 'attempt-a', inspection: inspection(url) },
      { type: 'beginConnect', requestId: 'connect-a' },
      // The user edits the review key while connect A is in flight.
      { type: 'setReviewAccessKey', accessKey: 'sk-key-b' },
      // A new connect attempt supersedes A.
      { type: 'beginConnect', requestId: 'connect-b' },
      // A's stale failure must not clear the edited key or the new identity.
      { type: 'connectFailed', requestId: 'connect-a' },
    );
    expect(state.review?.accessKey).toBe('sk-key-b');
    expect(state.connectRequestId).toBe('connect-b');
    expect(JSON.stringify(state)).not.toContain('sk-key-a');

    // B's matching success clears everything, key B included.
    state = run(state, { type: 'connectSucceeded', requestId: 'connect-b' });
    expect(state).toEqual(INITIAL_REMOTE_REVIEW_STATE);
    expect(JSON.stringify(state)).not.toContain('sk-key-b');
  });
});
