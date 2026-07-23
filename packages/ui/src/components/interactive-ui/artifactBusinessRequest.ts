import {
  InteractiveUIRequestError,
  invokeInteractiveAction,
} from '@/lib/interactive-ui/client';
import type { InteractiveToolContext } from '@/lib/interactive-ui/types';

interface ArtifactBusinessRequest {
  extensionId: string;
  artifactId: string;
  instanceId: string;
  action: string;
  input: unknown;
  intent: 'query' | 'execute';
  tool: Pick<InteractiveToolContext, 'id' | 'name'>;
}

type ArtifactBusinessRequestResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string };

export const executeArtifactBusinessRequest = async (
  request: ArtifactBusinessRequest,
): Promise<ArtifactBusinessRequestResult> => {
  const invoke = (confirmationToken?: string) => invokeInteractiveAction({
    extensionId: request.extensionId,
    artifactId: request.artifactId,
    instanceId: request.instanceId,
    action: request.action,
    input: request.input,
    tool: request.tool,
    ...(confirmationToken ? { confirmationToken } : {}),
  });

  try {
    return { ok: true, data: await invoke() };
  } catch (requestError) {
    let finalError = requestError;
    if (request.intent === 'execute'
      && requestError instanceof InteractiveUIRequestError
      && requestError.payload.confirmationRequired) {
      const confirmation = requestError.payload.confirmation ?? {};
      const text = [confirmation.title, confirmation.description].filter(Boolean).join('\n\n');
      if (typeof window.confirm === 'function'
        && window.confirm(text)
        && requestError.payload.confirmationToken) {
        try {
          return { ok: true, data: await invoke(requestError.payload.confirmationToken) };
        } catch (confirmedError) {
          finalError = confirmedError;
        }
      }
    }
    const payload = finalError instanceof InteractiveUIRequestError ? finalError.payload : {};
    return {
      ok: false,
      error: payload.error || (finalError instanceof Error ? finalError.message : 'Business request failed'),
      ...(payload.code ? { code: payload.code } : {}),
    };
  }
};
