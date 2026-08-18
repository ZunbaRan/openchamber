import { InteractiveUIRequestError } from '@/lib/interactive-ui/client';
import type { InteractiveConfirmation } from '@/lib/interactive-ui/types';

export class InteractiveActionCancelledError extends Error {
  constructor() {
    super('Action cancelled');
    this.name = 'InteractiveActionCancelledError';
  }
}

/**
 * Runs a business invoke behind the Host-owned confirmation gate.
 *
 * The first invoke carries no token. A prompt and single retry happen only
 * when the thrown value is an `InteractiveUIRequestError` with status 409, a
 * strict boolean `confirmationRequired === true`, and a non-empty string
 * `confirmationToken`; the retry sends that exact token, never a trimmed or
 * altered copy. Everything else propagates without a prompt or retry:
 * non-challenge errors, lookalike errors from other statuses, non-boolean
 * flags, missing/empty/non-string tokens, a throwing confirm callback, and
 * any retry error (including a second challenge). A user cancellation
 * surfaces as `InteractiveActionCancelledError` so callers classify by class,
 * never by comparing error text.
 */
export const runActionWithConfirmation = async <T>(
  invoke: (confirmationToken?: string) => Promise<T>,
  confirm: (options: InteractiveConfirmation) => Promise<boolean>,
): Promise<T> => {
  try {
    return await invoke();
  } catch (actionError) {
    if (!(actionError instanceof InteractiveUIRequestError)
      || actionError.status !== 409
      || actionError.payload.confirmationRequired !== true
      || typeof actionError.payload.confirmationToken !== 'string'
      || actionError.payload.confirmationToken.length === 0) {
      throw actionError;
    }
    const confirmationToken = actionError.payload.confirmationToken;
    const confirmed = await confirm(actionError.payload.confirmation ?? {});
    if (!confirmed) throw new InteractiveActionCancelledError();
    return invoke(confirmationToken);
  }
};
