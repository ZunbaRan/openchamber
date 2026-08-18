import React from 'react';
import type { DialogContent } from '@/components/ui/dialog';
import type { InteractiveConfirmation } from '@/lib/interactive-ui/types';
import { useInteractiveConfirmation } from './InteractiveConfirmationDialog';

export interface InstalledArtifactConfirmationHandle {
  confirm(options: InteractiveConfirmation): Promise<boolean>;
}

interface InstalledArtifactConfirmationHostProps {
  /**
   * Optional portal container for the rendered confirmation popup, matching
   * DialogContent's portalContainer. Expanded installed Artifacts pass their
   * native dialog host so the popup joins the same top layer; inline,
   * embedded-workbench, and every other surface keep the default body portal.
   */
  portalContainer?: React.ComponentProps<typeof DialogContent>['portalContainer'];
  /**
   * When true, the confirmation popup consumes Escape itself: it prevents the
   * keydown default so an expanded host `<dialog>` stays in the top layer and
   * settles the pending confirmation false explicitly. Default callers retain
   * Base UI's Escape dismissal.
   */
  consumeEscape: boolean;
}

/**
 * Subordinate lazy module for the installed-only HTML Artifact confirmation
 * path. HTMLArtifactView dynamically imports this host and renders it only
 * when the envelope is an installed Artifact, so generated and static
 * Artifacts never load this chunk or instantiate the confirmation hook. The
 * handle exposes only confirm(); the controller, popup, and data attributes
 * stay private to this module.
 */
export const InstalledArtifactConfirmationHost = React.forwardRef<
  InstalledArtifactConfirmationHandle,
  InstalledArtifactConfirmationHostProps
>(({ portalContainer, consumeEscape }, forwardedRef) => {
  const { confirm, dialog } = useInteractiveConfirmation({ portalContainer, consumeEscape });
  React.useImperativeHandle(forwardedRef, () => ({ confirm }), [confirm]);
  // The popup portals itself (host top layer while expanded, body otherwise),
  // so the host renders nothing until a confirmation request exists.
  return <>{dialog}</>;
});

InstalledArtifactConfirmationHost.displayName = 'InstalledArtifactConfirmationHost';
