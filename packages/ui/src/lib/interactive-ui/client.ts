import { runtimeFetch } from '@/lib/runtime-fetch';
import type {
  InteractiveActionErrorPayload,
  InteractiveActionRequest,
  InstalledHTMLArtifactDescriptor,
  InteractiveViewDescriptor,
} from './types';
import type { HTMLArtifactResultEnvelope } from './artifactResult';

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
  toolName = '',
  options?: { launchSource?: 'tool' | 'workbench' },
): Promise<InteractiveViewDescriptor> => {
  const query = new URLSearchParams();
  if (toolName) query.set('tool', toolName);
  if (options?.launchSource === 'workbench') query.set('launch', 'workbench');
  const response = await runtimeFetch(`/api/interactive-ui/views/${encodeURIComponent(viewId)}?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return readJsonResponse<InteractiveViewDescriptor>(response);
};

export const getInstalledHTMLArtifactDescriptor = async (
  artifactId: string,
  toolName = '',
  options?: { launchSource?: 'tool' | 'workbench' },
): Promise<InstalledHTMLArtifactDescriptor> => {
  const query = new URLSearchParams();
  if (toolName) query.set('tool', toolName);
  if (options?.launchSource === 'workbench') query.set('launch', 'workbench');
  const response = await runtimeFetch(`/api/interactive-ui/installed-artifacts/${encodeURIComponent(artifactId)}?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return readJsonResponse<InstalledHTMLArtifactDescriptor>(response);
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

export interface HTMLArtifactMaterialization {
  artifactId: string;
  schemaVersion: 1;
  scripts: boolean;
  inlineHeight: number;
  preferred: 'inline' | 'workspace' | 'fullscreen';
  allowExpand: boolean;
  documentBytes: number;
  cspRevision: number;
  cacheHit: boolean;
  cacheRebuilt: boolean;
  sessionReferenceTracked: boolean;
  documentPath: string;
  metadataPath: string;
}

export const materializeHTMLArtifact = async (
  envelope: HTMLArtifactResultEnvelope,
  sessionId?: string,
): Promise<HTMLArtifactMaterialization> => {
  const response = await runtimeFetch('/api/interactive-ui/artifacts/materialize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(sessionId ? { 'X-OpenChamber-Session-ID': sessionId } : {}),
    },
    body: JSON.stringify(envelope),
  });
  return readJsonResponse<HTMLArtifactMaterialization>(response);
};
