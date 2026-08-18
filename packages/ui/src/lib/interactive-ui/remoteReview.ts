import type { RemoteInspection } from './extensionManager';

// Remote connect review state: the access key is bound to an explicit inspect
// ATTEMPT identity, captured as an immutable snapshot BEFORE the request is
// sent. Success/failure actions carry the requestId and only affect the
// matching active attempt, so stale completion after close or a newer attempt
// is ignored, and an inspection can never be bound to draft key state that
// changed while the request was in flight. CONNECT completion is equally
// requestId-bound: connectSucceeded/connectFailed must carry the requestId
// captured by beginConnect, so a late completion for a closed or superseded
// review can never clear or rebind a newer review/key. Cancel, dialog
// close/escape, inspection failure, connect failure, and connect success are
// all clearing terminal paths that drop every key-bearing field (attempt,
// review, draft key) and the connect identity; the URL may remain.

export interface RemoteReview {
  inspection: RemoteInspection;
  accessKey: string;
}

export interface RemoteInspectAttempt {
  requestId: string;
  url: string;
  accessKey: string;
}

export interface RemoteReviewState {
  draftUrl: string;
  draftAccessKey: string;
  attempt: RemoteInspectAttempt | null;
  review: RemoteReview | null;
  connectRequestId: string | null;
}

export type RemoteReviewAction =
  | { type: 'setDraftUrl'; url: string }
  | { type: 'setDraftAccessKey'; accessKey: string }
  | { type: 'beginInspect'; requestId: string; url: string; accessKey: string }
  | { type: 'inspectSucceeded'; requestId: string; inspection: RemoteInspection }
  | { type: 'inspectFailed'; requestId: string }
  | { type: 'closeReview' }
  | { type: 'setReviewAccessKey'; accessKey: string }
  | { type: 'beginConnect'; requestId: string }
  | { type: 'connectSucceeded'; requestId: string }
  | { type: 'connectFailed'; requestId: string };

export const INITIAL_REMOTE_REVIEW_STATE: RemoteReviewState = {
  draftUrl: '',
  draftAccessKey: '',
  attempt: null,
  review: null,
  connectRequestId: null,
};

const clearKeys = (state: RemoteReviewState): RemoteReviewState => ({
  ...state,
  attempt: null,
  review: null,
  draftAccessKey: '',
  connectRequestId: null,
});

export const remoteReviewReducer = (state: RemoteReviewState, action: RemoteReviewAction): RemoteReviewState => {
  switch (action.type) {
    case 'setDraftUrl':
      return { ...state, draftUrl: action.url };
    case 'setDraftAccessKey':
      return { ...state, draftAccessKey: action.accessKey };
    case 'beginInspect':
      // Immutable snapshot taken BEFORE the request: the request uses this
      // captured URL and the success binds the inspection only to this
      // captured key, never to mutable draft state.
      return { ...state, attempt: { requestId: action.requestId, url: action.url, accessKey: action.accessKey } };
    case 'inspectSucceeded':
      if (state.attempt?.requestId !== action.requestId) return state; // stale completion: ignored
      return {
        draftUrl: state.draftUrl,
        draftAccessKey: '',
        attempt: null,
        review: { inspection: action.inspection, accessKey: state.attempt.accessKey },
        connectRequestId: null,
      };
    case 'inspectFailed':
      if (state.attempt?.requestId !== action.requestId) return state; // stale failure: ignored
      return clearKeys(state);
    case 'closeReview':
      // Cancel / dialog close / escape: drop the attempt, review, and keys.
      return clearKeys(state);
    case 'setReviewAccessKey':
      return state.review
        ? { ...state, review: { ...state.review, accessKey: action.accessKey } }
        : state;
    case 'beginConnect':
      // Non-secret identity of the CURRENT connect request; completion actions
      // must carry the same requestId to be honored.
      return { ...state, connectRequestId: action.requestId };
    case 'connectSucceeded':
      if (state.connectRequestId !== action.requestId) return state; // stale completion: ignored
      return { ...INITIAL_REMOTE_REVIEW_STATE };
    case 'connectFailed':
      if (state.connectRequestId !== action.requestId) return state; // stale completion: ignored
      // A failed connect is a clearing terminal path like cancel/close: the
      // attempt, the review (and its captured key), the draft key, and the
      // connect identity are dropped immediately. Only the non-secret URL may
      // remain for retry.
      return clearKeys(state);
  }
};
