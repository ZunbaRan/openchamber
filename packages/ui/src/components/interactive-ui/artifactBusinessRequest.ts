import {
  InteractiveUIRequestError,
  invokeInteractiveAction,
} from '@/lib/interactive-ui/client';
import type { InteractiveConfirmation, InteractiveToolContext } from '@/lib/interactive-ui/types';
import {
  InteractiveActionCancelledError,
  runActionWithConfirmation,
} from './interactiveActionConfirmation';

interface ArtifactBusinessRequest {
  extensionId: string;
  artifactId: string;
  instanceId: string;
  action: string;
  input: unknown;
  intent: 'query' | 'execute';
  tool?: Pick<InteractiveToolContext, 'id' | 'name'>;
  workbench?: {
    projectId: string;
    tileId: string;
  };
}

type ArtifactBusinessRequestResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string };

type ArtifactBusinessConfirm = (options: InteractiveConfirmation) => Promise<boolean>;

export const executeArtifactBusinessRequest = async (
  request: ArtifactBusinessRequest,
  confirm: ArtifactBusinessConfirm,
): Promise<ArtifactBusinessRequestResult> => {
  const invoke = (confirmationToken?: string) => invokeInteractiveAction({
    extensionId: request.extensionId,
    artifactId: request.artifactId,
    instanceId: request.instanceId,
    action: request.action,
    input: request.input,
    ...(request.tool ? { tool: request.tool } : {}),
    ...(request.workbench ? { workbench: request.workbench } : {}),
    ...(confirmationToken ? { confirmationToken } : {}),
  });

  try {
    // Queries never open a confirmation dialog; only installed writes are gated.
    if (request.intent === 'query') {
      return { ok: true, data: await invoke() };
    }
    return { ok: true, data: await runActionWithConfirmation(invoke, confirm) };
  } catch (requestError) {
    if (requestError instanceof InteractiveActionCancelledError) {
      return { ok: false, error: 'Action cancelled', code: 'action_cancelled' };
    }
    const payload = requestError instanceof InteractiveUIRequestError ? requestError.payload : {};
    return {
      ok: false,
      error: payload.error || (requestError instanceof Error ? requestError.message : 'Business request failed'),
      ...(payload.code ? { code: payload.code } : {}),
    };
  }
};
