import { runtimeFetch } from '@/lib/runtime-fetch';
import type {
  InteractiveActionErrorPayload,
  InteractiveActionRequest,
  InteractiveViewDescriptor,
} from './types';

export class InteractiveUIRequestError extends Error {
  readonly status: number;
  readonly payload: InteractiveActionErrorPayload;

  constructor(status: number, payload: InteractiveActionErrorPayload) {
    super(payload.error || `Interactive UI request failed (${status})`);
    this.name = 'InteractiveUIRequestError';
    this.status = status;
    this.payload = payload;
  }
}

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const errorPayload = payload && typeof payload === 'object'
      ? payload as InteractiveActionErrorPayload
      : { error: `Interactive UI request failed (${response.status})` };
    throw new InteractiveUIRequestError(response.status, errorPayload);
  }
  if (payload === null) throw new InteractiveUIRequestError(502, { error: 'Interactive UI returned an invalid response' });
  return payload;
};

export const getInteractiveViewDescriptor = async (
  viewId: string,
  toolName: string,
): Promise<InteractiveViewDescriptor> => {
  const query = new URLSearchParams({ tool: toolName });
  const response = await runtimeFetch(`/api/interactive-ui/views/${encodeURIComponent(viewId)}?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return readJsonResponse<InteractiveViewDescriptor>(response);
};

export const invokeInteractiveAction = async <TOutput = unknown>(
  request: InteractiveActionRequest,
): Promise<TOutput> => {
  const response = await runtimeFetch(`/api/interactive-ui/actions/${encodeURIComponent(request.action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await readJsonResponse<{ data: TOutput }>(response);
  return payload.data;
};
