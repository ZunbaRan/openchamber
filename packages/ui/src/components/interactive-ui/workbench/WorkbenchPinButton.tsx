import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { HTMLArtifactResultEnvelope } from '@/lib/interactive-ui/artifactResult';
import type { InstalledHTMLArtifactResultEnvelope } from '@/lib/interactive-ui/installedArtifactResult';
import type { InteractiveResultEnvelope } from '@/lib/interactive-ui/types';
import {
  createWorkbenchGeneratedSnapshot,
  getActiveWorkbenchBoard,
  type WorkbenchSurfaceDescriptor,
  type WorkbenchTileDraft,
} from '@/lib/interactive-ui/workbench';
import {
  findNearestWorkbenchSlot,
} from '@/lib/interactive-ui/workbench-layout';
import { useExtensionWorkbenchStore } from '@/stores/useExtensionWorkbenchStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';

type PinEnvelope =
  | InteractiveResultEnvelope
  | HTMLArtifactResultEnvelope
  | InstalledHTMLArtifactResultEnvelope;

interface WorkbenchPinButtonProps {
  envelope: PinEnvelope;
  sessionId?: string;
  toolPartId: string;
}

const isInteractive = (envelope: PinEnvelope): envelope is InteractiveResultEnvelope => (
  envelope.$schema === 'openchamber://interactive-result/v1'
);

const isGeneratedArtifact = (envelope: PinEnvelope): envelope is HTMLArtifactResultEnvelope => (
  envelope.$schema === 'openchamber://html-artifact-result/v1'
);

const findInstalledSurface = (
  envelope: PinEnvelope,
): {
  extensionId: string;
  surface: WorkbenchSurfaceDescriptor;
} | null => {
  const catalog = useExtensionWorkbenchStore.getState().catalog;
  const surfaceId = isInteractive(envelope)
    ? envelope.view
    : envelope.$schema === 'openchamber://installed-html-artifact-result/v1'
      ? envelope.artifact
      : null;
  if (!surfaceId || !catalog) return null;
  for (const extension of catalog.extensions) {
    const surface = extension.surfaces.find((candidate) => (
      candidate.surfaceId === surfaceId && candidate.dashboard
    ));
    if (surface) return { extensionId: extension.id, surface };
  }
  return null;
};

const focusWorkbenchTile = (tileId: string) => {
  window.dispatchEvent(new CustomEvent('openchamber:workbench-focus-tile', {
    detail: { tileId },
  }));
};

export const WorkbenchPinButton: React.FC<WorkbenchPinButtonProps> = ({
  envelope,
  sessionId,
  toolPartId,
}) => {
  const { t } = useI18n();
  const [pending, setPending] = React.useState(false);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projects = useProjectsStore((state) => state.projects);
  const projectId = activeProjectId || projects[0]?.id || null;
  const setRightSidebarOpen = useUIStore((state) => state.setRightSidebarOpen);
  const setRightSidebarTab = useUIStore((state) => state.setRightSidebarTab);

  const handlePin = async () => {
    if (!projectId || pending) {
      if (!projectId) toast.error(t('workbench.pin.noProject'));
      return;
    }
    setPending(true);
    try {
      const store = useExtensionWorkbenchStore.getState();
      await store.load(projectId, { force: !store.catalog || store.projectId !== projectId });
      const installed = findInstalledSurface(envelope);
      const board = getActiveWorkbenchBoard(useExtensionWorkbenchStore.getState().snapshot);
      const occupied = board?.tiles.map((tile) => tile.layout) ?? [];
      let tile: WorkbenchTileDraft;

      if (installed) {
        const context = isInteractive(envelope)
          || envelope.$schema === 'openchamber://installed-html-artifact-result/v1'
          ? envelope.context
          : {};
        const layout = findNearestWorkbenchSlot(
          installed.surface.dashboard?.layout ?? { columns: 6, rows: 4 },
          occupied,
          { column: 0, row: 0 },
        );
        tile = {
          source: {
            kind: 'third-party-extension',
            extensionId: installed.extensionId,
            surfaceId: installed.surface.surfaceId,
          },
          form: installed.surface.form,
          context: context && typeof context === 'object' && !Array.isArray(context)
            ? context as Record<string, unknown>
            : {},
          layout,
          origin: {
            ...(sessionId ? { sessionId } : {}),
            toolCallId: toolPartId,
          },
        };
      } else {
        if (!isInteractive(envelope) && !isGeneratedArtifact(envelope)) {
          throw new Error(t('workbench.pin.installedSurfaceMissing'));
        }
        const form = isInteractive(envelope) ? 'interactive-ui' : 'html-artifact';
        const snapshot = await createWorkbenchGeneratedSnapshot(form, envelope);
        tile = {
          source: { kind: 'agent-generated', snapshotRef: snapshot.snapshotRef },
          form,
          context: {},
          layout: findNearestWorkbenchSlot(
            { columns: 6, rows: 4 },
            occupied,
            { column: 0, row: 0 },
          ),
          origin: {
            ...(sessionId ? { sessionId } : {}),
            toolCallId: toolPartId,
          },
        };
      }

      const result = await useExtensionWorkbenchStore.getState().pin(projectId, tile);
      setRightSidebarTab('extensions');
      setRightSidebarOpen(true);
      focusWorkbenchTile(result.tile.tileId);
      toast.success(result.created ? t('workbench.pin.added') : t('workbench.pin.focused'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workbench.pin.failed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => void handlePin()}
      aria-label={t('workbench.pin.aria')}
      title={t('workbench.pin.aria')}
    >
      <Icon name={pending ? 'refresh' : 'pushpin'} className={pending ? 'animate-spin' : undefined} />
      {t('workbench.pin.label')}
    </Button>
  );
};
