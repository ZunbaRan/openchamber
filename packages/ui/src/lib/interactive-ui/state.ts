import { InteractiveUIRequestError } from './client';

export type InteractiveUIFailureState =
  | 'unconfigured'
  | 'unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'stale'
  | 'error';

export const classifyInteractiveUIError = (error: unknown): Exclude<InteractiveUIFailureState, 'stale'> => {
  if (error instanceof InteractiveUIRequestError) {
    const code = error.payload.code;
    if (code === 'connector_unconfigured') return 'unconfigured';
    if (code === 'connector_unauthorized' || error.status === 401) return 'unauthorized';
    if (code === 'connector_forbidden' || error.status === 403) return 'forbidden';
    if (code === 'upstream_timeout' || code === 'upstream_error' || error.status >= 500) return 'unreachable';
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'unreachable';
  return 'error';
};
