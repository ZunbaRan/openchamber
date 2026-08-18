import { describe, expect, test } from 'bun:test';
import { InteractiveUIRequestError } from '@/lib/interactive-ui/client';
import type { InteractiveActionErrorPayload, InteractiveConfirmation } from '@/lib/interactive-ui/types';
import { createInteractiveConfirmationController } from './InteractiveConfirmationDialog';
import {
  InteractiveActionCancelledError,
  runActionWithConfirmation,
} from './interactiveActionConfirmation';

const confirmation: InteractiveConfirmation = {
  title: 'Approve write?',
  description: 'This updates customer records.',
};

const makeChallenge = (status: number, overrides: Partial<InteractiveActionErrorPayload> = {}) =>
  new InteractiveUIRequestError(status, {
    error: 'Confirmation required',
    code: 'confirmation_required',
    confirmationRequired: true,
    confirmation,
    ...overrides,
  });

const confirmationChallenge = (token?: string) =>
  makeChallenge(409, token === undefined ? {} : { confirmationToken: token });

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
};

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('interactive confirmation controller', () => {
  test('confirm resolves true exactly once and clears the snapshot', async () => {
    const controller = createInteractiveConfirmationController();
    const promise = controller.confirm(confirmation);
    expect(controller.getSnapshot()?.options).toEqual(confirmation);
    controller.settle(true);
    expect(await promise).toBe(true);
    expect(controller.getSnapshot()).toBeNull();
    controller.settle(true);
    controller.settle(false);
  });

  test('cancel resolves false', async () => {
    const controller = createInteractiveConfirmationController();
    const promise = controller.confirm(confirmation);
    controller.settle(false);
    expect(await promise).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
  });

  test('a concurrent second request resolves false without replacing the first', async () => {
    const controller = createInteractiveConfirmationController();
    const first = controller.confirm(confirmation);
    const second = controller.confirm({ title: 'Second request' });
    expect(await second).toBe(false);
    expect(controller.getSnapshot()?.options).toEqual(confirmation);
    controller.settle(true);
    expect(await first).toBe(true);
  });

  test('dispose resolves the pending request false exactly once', async () => {
    const controller = createInteractiveConfirmationController();
    const promise = controller.confirm(confirmation);
    controller.dispose();
    expect(await promise).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
    controller.dispose();
  });

  test('a subscriber that synchronously disposes during request notification never leaks the promise', async () => {
    const controller = createInteractiveConfirmationController();
    controller.subscribe(() => controller.dispose());
    const promise = controller.confirm(confirmation);
    expect(await promise).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
  });

  test('dispose settles the promise without notifying subscribers', async () => {
    const controller = createInteractiveConfirmationController();
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });
    controller.confirm(confirmation);
    expect(notifications).toBe(1);
    controller.dispose();
    expect(notifications).toBe(1);
  });

  test('after dispose, subscriptions are inert and requests resolve false', async () => {
    const controller = createInteractiveConfirmationController();
    controller.dispose();
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => {
      notifications += 1;
    });
    const promise = controller.confirm(confirmation);
    expect(await promise).toBe(false);
    unsubscribe();
    expect(notifications).toBe(0);
    expect(controller.getSnapshot()).toBeNull();
  });

  test('the snapshot is token-free and null before any request (SSR server snapshot)', async () => {
    const controller = createInteractiveConfirmationController();
    expect(controller.getSnapshot()).toBeNull();
    const promise = controller.confirm(confirmation);
    const snapshot = controller.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(Object.keys(snapshot!)).toEqual(['options']);
    expect(Object.keys(snapshot!.options)).toEqual(['title', 'description']);
    controller.settle(true);
    expect(await promise).toBe(true);
  });

  test('the snapshot never retains the caller object or secret-shaped fields', async () => {
    const controller = createInteractiveConfirmationController();
    const optionsWithSecrets = {
      title: 'Approve write?',
      description: 'This updates customer records.',
      confirmationToken: 'secret-token',
      accessKey: 'secret-key',
    } as InteractiveConfirmation;
    const promise = controller.confirm(optionsWithSecrets);
    const snapshot = controller.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(Object.keys(snapshot!)).toEqual(['options']);
    expect(Object.keys(snapshot!.options)).toEqual(['title', 'description']);
    expect((snapshot!.options as Record<string, unknown>).confirmationToken).toBe(undefined);
    expect((snapshot!.options as Record<string, unknown>).accessKey).toBe(undefined);
    expect(snapshot!.options).not.toBe(optionsWithSecrets);
    controller.settle(true);
    expect(await promise).toBe(true);
  });

  test('only runtime-validated string title/description enter the snapshot', async () => {
    const controller = createInteractiveConfirmationController();
    const promise = controller.confirm({
      title: 123 as unknown as string,
      description: 'valid description',
    });
    const snapshot = controller.getSnapshot();
    expect(Object.keys(snapshot!.options)).toEqual(['description']);
    expect(snapshot!.options.description).toBe('valid description');
    controller.settle(false);
    expect(await promise).toBe(false);
  });

  test('a replayed setup supersedes the queued dispose (StrictMode safe)', async () => {
    const controller = createInteractiveConfirmationController();
    controller.refreshLifecycle();
    controller.scheduleDispose();
    controller.refreshLifecycle();
    await flushMicrotasks();
    const promise = controller.confirm(confirmation);
    controller.settle(true);
    expect(await promise).toBe(true);
  });

  test('a real unmount disposes promptly and fail-closed', async () => {
    const controller = createInteractiveConfirmationController();
    controller.refreshLifecycle();
    controller.scheduleDispose();
    await flushMicrotasks();
    const promise = controller.confirm(confirmation);
    expect(await promise).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
  });

  test('the deferred real-unmount dispose settles a pending request false', async () => {
    const controller = createInteractiveConfirmationController();
    controller.refreshLifecycle();
    const promise = controller.confirm(confirmation);
    controller.scheduleDispose();
    await flushMicrotasks();
    expect(await promise).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
  });
});

describe('runActionWithConfirmation', () => {
  test('resolves the first token-free invoke on success', async () => {
    const tokens: Array<string | undefined> = [];
    let confirmCalls = 0;
    const result = await runActionWithConfirmation(async (token) => {
      tokens.push(token);
      return 'ok';
    }, async () => {
      confirmCalls += 1;
      return true;
    });
    expect(result).toBe('ok');
    expect(tokens).toEqual([undefined]);
    expect(confirmCalls).toBe(0);
  });

  test('propagates a non-challenge error without a dialog', async () => {
    const failure = new Error('upstream boom');
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async () => {
      throw failure;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(failure);
    expect(confirmCalls).toBe(0);
  });

  test('propagates a challenge without a token without a dialog', async () => {
    const challenge = confirmationChallenge();
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async () => {
      throw challenge;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(challenge);
    expect(confirmCalls).toBe(0);
  });

  test('propagates a 409-shaped challenge from another status without a dialog', async () => {
    const lookalike = makeChallenge(403, { confirmationToken: 'exact-token' });
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async () => {
      throw lookalike;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(lookalike);
    expect(confirmCalls).toBe(0);
  });

  test('propagates a challenge with a non-boolean confirmationRequired flag without a dialog', async () => {
    const invalidFlag = makeChallenge(409, {
      confirmationRequired: 1 as unknown as boolean,
      confirmationToken: 'exact-token',
    });
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async () => {
      throw invalidFlag;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(invalidFlag);
    expect(confirmCalls).toBe(0);
  });

  test('propagates challenges with an empty or non-string token without a dialog', async () => {
    const invalidTokens = [
      makeChallenge(409, { confirmationToken: '' }),
      makeChallenge(409, { confirmationToken: 123 as unknown as string }),
    ];
    for (const challenge of invalidTokens) {
      let confirmCalls = 0;
      const caught = await captureRejection(runActionWithConfirmation(async () => {
        throw challenge;
      }, async () => {
        confirmCalls += 1;
        return true;
      }));
      expect(caught).toBe(challenge);
      expect(confirmCalls).toBe(0);
    }
  });

  test('a cancelled confirmation rejects with InteractiveActionCancelledError and never retries', async () => {
    let invokeCalls = 0;
    let confirmCalls = 0;
    const promise = runActionWithConfirmation(async (token) => {
      invokeCalls += 1;
      expect(token).toBe(undefined);
      throw confirmationChallenge('exact-token');
    }, async (options) => {
      confirmCalls += 1;
      expect(options).toEqual(confirmation);
      return false;
    });
    const caught = await captureRejection(promise);
    expect(caught instanceof InteractiveActionCancelledError).toBe(true);
    expect((caught as Error).name).toBe('InteractiveActionCancelledError');
    expect((caught as Error).message).toBe('Action cancelled');
    expect(invokeCalls).toBe(1);
    expect(confirmCalls).toBe(1);
  });

  test('confirms once and retries exactly once with the exact token bytes', async () => {
    const exactToken = '  exact-token  ';
    const tokens: Array<string | undefined> = [];
    let confirmCalls = 0;
    const result = await runActionWithConfirmation(async (token) => {
      tokens.push(token);
      if (token === undefined) throw confirmationChallenge(exactToken);
      return 'done';
    }, async (options) => {
      confirmCalls += 1;
      expect(options).toEqual(confirmation);
      return true;
    });
    expect(result).toBe('done');
    expect(tokens).toEqual([undefined, exactToken]);
    expect(confirmCalls).toBe(1);
  });

  test('a throwing confirm callback propagates without a retry', async () => {
    const confirmFailure = new Error('confirm exploded');
    let invokeCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async (token) => {
      invokeCalls += 1;
      expect(token).toBe(undefined);
      throw confirmationChallenge('exact-token');
    }, async () => {
      throw confirmFailure;
    }));
    expect(caught).toBe(confirmFailure);
    expect(invokeCalls).toBe(1);
  });

  test('a retry error propagates without another confirm', async () => {
    const retryFailure = new Error('retry failed');
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async (token) => {
      if (token === undefined) throw confirmationChallenge('exact-token');
      throw retryFailure;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(retryFailure);
    expect(confirmCalls).toBe(1);
  });

  test('a second challenge after retry propagates without another dialog or retry', async () => {
    const secondChallenge = confirmationChallenge('second-token');
    const tokens: Array<string | undefined> = [];
    let confirmCalls = 0;
    const caught = await captureRejection(runActionWithConfirmation(async (token) => {
      tokens.push(token);
      if (token === undefined) throw confirmationChallenge('exact-token');
      throw secondChallenge;
    }, async () => {
      confirmCalls += 1;
      return true;
    }));
    expect(caught).toBe(secondChallenge);
    expect(tokens).toEqual([undefined, 'exact-token']);
    expect(confirmCalls).toBe(1);
  });
});
