import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import type { InteractiveConfirmation } from '@/lib/interactive-ui/types';

interface InteractiveConfirmationRequest {
  options: InteractiveConfirmation;
}

interface InteractiveConfirmationController {
  getSnapshot(): InteractiveConfirmationRequest | null;
  subscribe(listener: () => void): () => void;
  confirm(options: InteractiveConfirmation): Promise<boolean>;
  settle(value: boolean): void;
  refreshLifecycle(): void;
  scheduleDispose(): void;
  dispose(): void;
}

export const createInteractiveConfirmationController = (): InteractiveConfirmationController => {
  type PendingRequest = { resolve: (value: boolean) => void };
  let pending: PendingRequest | null = null;
  // Pure, referentially stable store snapshot: carries only a fresh copy of
  // the runtime-validated dialog copy (string title/description), never the
  // caller's options object, the resolver, or any confirmation token.
  let snapshot: InteractiveConfirmationRequest | null = null;
  let disposed = false;
  // StrictMode lifecycle generation; mirrors the proven pattern in
  // packages/ui/src/sync/sync-context.tsx (resourceLifecycleGenerationRef).
  let resourceLifecycleGeneration = 0;
  const listeners = new Set<() => void>();

  const getSnapshot = (): InteractiveConfirmationRequest | null => snapshot;

  const subscribe = (listener: () => void): (() => void) => {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const notify = (): void => {
    if (disposed) return;
    for (const listener of Array.from(listeners)) {
      if (disposed) break;
      listener();
    }
  };

  const settle = (value: boolean): void => {
    const request = pending;
    if (!request) return;
    pending = null;
    snapshot = null;
    request.resolve(value);
    notify();
  };

  const confirm = (options: InteractiveConfirmation): Promise<boolean> => {
    if (disposed || pending) return Promise.resolve(false);
    // Modal state minimization: copy only runtime-validated strings so the
    // caller's options object (and any secret-shaped extra fields) is never
    // retained by the store or the dialog.
    const validated: InteractiveConfirmation = {};
    if (typeof options.title === 'string') validated.title = options.title;
    if (typeof options.description === 'string') validated.description = options.description;
    return new Promise<boolean>((resolve) => {
      pending = { resolve };
      snapshot = { options: validated };
      notify();
    });
  };

  // React StrictMode replays effect cleanup/setup without recreating the
  // reused controller. Setup bumps the generation; the cleanup only schedules
  // a deferred dispose that runs when no newer setup superseded it, so the
  // replay never disposes the controller while a real unmount still disposes
  // promptly (next microtask) and fail-closed. Mirrors
  // packages/ui/src/sync/sync-context.tsx.
  const refreshLifecycle = (): void => {
    resourceLifecycleGeneration += 1;
  };

  const scheduleDispose = (): void => {
    const generation = resourceLifecycleGeneration;
    queueMicrotask(() => {
      if (resourceLifecycleGeneration !== generation) return;
      dispose();
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    listeners.clear();
    const request = pending;
    if (request) {
      pending = null;
      snapshot = null;
      request.resolve(false);
    }
  };

  return { getSnapshot, subscribe, confirm, settle, refreshLifecycle, scheduleDispose, dispose };
};

interface InteractiveConfirmationOptions {
  /**
   * Optional portal container for the rendered confirmation popup, matching
   * DialogContent's portalContainer. Omitted by default, so every existing
   * caller keeps the body-portaled popup; expanded installed Artifacts pass
   * their native dialog host so the popup joins the same top layer.
   */
  portalContainer?: React.ComponentProps<typeof DialogContent>['portalContainer'];
  /**
   * When true, the confirmation popup consumes Escape itself: its keydown
   * handler prevents the default (so a host native `<dialog>` in the top
   * layer stays open instead of firing its cancel default) and settles the
   * controller false explicitly. Default callers retain Base UI's Escape
   * dismissal.
   */
  consumeEscape?: boolean;
}

interface InteractiveConfirmationHook {
  confirm(options: InteractiveConfirmation): Promise<boolean>;
  dialog: React.ReactNode;
  /**
   * Stable explicit dismissal: settles the pending confirmation false
   * (idempotent). Used by hosts that consume Escape themselves (expanded
   * installed Artifacts) without relying on Base UI dismissing the popup.
   */
  cancelConfirmation(): void;
}

export const useInteractiveConfirmation = (options?: InteractiveConfirmationOptions): InteractiveConfirmationHook => {
  const controllerRef = React.useRef<InteractiveConfirmationController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createInteractiveConfirmationController();
  }
  const controller = controllerRef.current;
  const request = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // StrictMode-safe disposal: setup bumps the controller generation; cleanup
  // schedules a microtask-gated dispose that a replayed setup supersedes and
  // a real unmount executes promptly (mirrors sync-context.tsx). dispose
  // itself stays synchronous, pure, and notification-free.
  React.useEffect(() => {
    controller.refreshLifecycle();
    return () => controller.scheduleDispose();
  }, [controller]);

  const confirm = React.useCallback(
    (options: InteractiveConfirmation) => controller.confirm(options),
    [controller],
  );

  const cancelConfirmation = React.useCallback(() => {
    // settle is idempotent: without a pending request it is a no-op, so a
    // repeated Escape or a concurrent Base UI dismissal stays harmless.
    controller.settle(false);
  }, [controller]);

  const dialog = request ? (
    <InteractiveConfirmationDialog
      request={request}
      controller={controller}
      portalContainer={options?.portalContainer}
      consumeEscape={options?.consumeEscape}
    />
  ) : null;

  return { confirm, dialog, cancelConfirmation };
};

interface InteractiveConfirmationDialogProps {
  request: InteractiveConfirmationRequest;
  controller: InteractiveConfirmationController;
  portalContainer?: InteractiveConfirmationOptions['portalContainer'];
  consumeEscape?: InteractiveConfirmationOptions['consumeEscape'];
}

// eslint-disable-next-line react-refresh/only-export-components -- Internal dialog surface rendered by the hook; the file's exports are the hook and its DOM-free test-seam controller.
const InteractiveConfirmationDialog: React.FC<InteractiveConfirmationDialogProps> = ({
  request,
  controller,
  portalContainer,
  consumeEscape = false,
}) => {
  const { t } = useI18n();
  const title = request.options.title?.trim() || t('filesView.dialog.confirm');
  const description = request.options.description?.trim() ? request.options.description.trim() : undefined;
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) controller.settle(false);
      }}
    >
      {/* data-ocix-confirmation-dialog lands on the popup element; the
          cancel/confirm buttons carry data-ocix-confirmation-action so the
          browser acceptance can target them deterministically. */}
      <DialogContent
        portalContainer={portalContainer}
        initialFocus={consumeEscape ? cancelButtonRef : undefined}
        data-ocix-confirmation-dialog
        onKeyDown={(event) => {
          // consumeEscape hosts (expanded installed HTML Artifacts) own
          // Escape while the confirmation is open: preventing the keydown
          // default keeps the host's native top-layer <dialog> from firing
          // its cancel default (host stays expanded/modal), and the explicit
          // settle closes the popup and resolves the pending confirmation
          // false without relying on Base UI dismissing after the prevented
          // event. settle is idempotent, so a concurrent Base UI dismissal
          // stays harmless.
          if (consumeEscape && event.key === 'Escape') {
            event.preventDefault();
            controller.settle(false);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelButtonRef}
            variant="outline"
            data-ocix-confirmation-action="cancel"
            onClick={() => controller.settle(false)}
          >
            {t('filesView.dialog.cancel')}
          </Button>
          <Button variant="default" data-ocix-confirmation-action="confirm" onClick={() => controller.settle(true)}>
            {t('filesView.dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
