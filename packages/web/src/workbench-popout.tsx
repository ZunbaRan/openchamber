import React from 'react';
import { createRoot } from 'react-dom/client';
import { createConfiguredWebAPIs } from './runtimeConfig';
import { RuntimeAPIProvider } from '@openchamber/ui/contexts/RuntimeAPIProvider';
import { ThemeSystemProvider } from '@openchamber/ui/contexts/ThemeSystemContext';
import { ThemeProvider } from '@openchamber/ui/components/providers/ThemeProvider';
import { InteractiveUIView } from '@openchamber/ui/components/interactive-ui/InteractiveUIView';
import { HTMLArtifactView } from '@openchamber/ui/components/interactive-ui/HTMLArtifactView';
import { I18nProvider, initializeLocale } from '@openchamber/ui/lib/i18n';
import {
  fetchWorkbenchCatalog,
  fetchWorkbenchGeneratedSnapshot,
  fetchWorkbenchSnapshot,
  getActiveWorkbenchBoard,
  type WorkbenchGeneratedSnapshot,
  type WorkbenchSurfaceDescriptor,
  type WorkbenchTile,
} from '@openchamber/ui/lib/interactive-ui/workbench';
import { INTERACTIVE_RESULT_SCHEMA } from '@openchamber/ui/lib/interactive-ui/types';
import { HTML_ARTIFACT_RESULT_SCHEMA } from '@openchamber/ui/lib/interactive-ui/artifactResult';
import { INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA } from '@openchamber/ui/lib/interactive-ui/installedArtifactResult';
import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs = createConfiguredWebAPIs();
window.__OPENCHAMBER_RUNTIME_APIS__ = runtimeAPIs;
initializeLocale();

const params = new URLSearchParams(window.location.search);
const projectId = (params.get('projectId') || '').slice(0, 512);
const tileId = (params.get('tileId') || '').slice(0, 128);

type PopoutState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      tile: WorkbenchTile;
      surface: WorkbenchSurfaceDescriptor | null;
      snapshot: WorkbenchGeneratedSnapshot | null;
    };

// This file is a standalone Vite entry rather than a reusable component module.
// eslint-disable-next-line react-refresh/only-export-components
const PopoutSurface: React.FC = () => {
  const [state, setState] = React.useState<PopoutState>({ status: 'loading' });

  React.useEffect(() => {
    const notifyClosed = () => {
      window.opener?.postMessage({
        source: 'openchamber-workbench-popout',
        type: 'closed',
        tileId,
      }, window.location.origin);
    };
    window.addEventListener('beforeunload', notifyClosed);
    return () => window.removeEventListener('beforeunload', notifyClosed);
  }, []);

  React.useEffect(() => {
    let active = true;
    if (!projectId || !tileId) {
      setState({ status: 'error', message: 'Workbench Popout context is incomplete.' });
      return () => { active = false; };
    }
    void Promise.all([
      fetchWorkbenchCatalog(),
      fetchWorkbenchSnapshot(projectId),
    ]).then(async ([catalog, boardSnapshot]) => {
      const tile = getActiveWorkbenchBoard(boardSnapshot)?.tiles.find(
        (candidate) => candidate.tileId === tileId,
      );
      if (!tile) throw new Error('Workbench tile is no longer available.');
      if (tile.source.kind === 'agent-generated') {
        const generated = await fetchWorkbenchGeneratedSnapshot(tile.source.snapshotRef);
        if (active) setState({ status: 'ready', tile, surface: null, snapshot: generated });
        return;
      }
      const installedSource = tile.source;
      const extension = catalog.extensions.find(
        (candidate) => candidate.id === installedSource.extensionId,
      );
      const surface = extension?.surfaces.find(
        (candidate) => candidate.surfaceId === installedSource.surfaceId,
      ) || null;
      if (!surface?.dashboard?.popout.supported) {
        throw new Error('This installed surface does not support Popout.');
      }
      if (active) setState({ status: 'ready', tile, surface, snapshot: null });
    }).catch((error) => {
      if (active) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Workbench Popout could not be loaded.',
        });
      }
    });
    return () => { active = false; };
  }, []);

  if (state.status === 'loading') {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6 text-muted-foreground">
        Loading Extension Workbench…
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6 text-center text-[var(--status-error)]">
        {state.message}
      </main>
    );
  }

  const { tile, surface, snapshot } = state;
  const interactiveEnvelope = snapshot?.form === 'interactive-ui'
    && snapshot.envelope.$schema === INTERACTIVE_RESULT_SCHEMA
    ? snapshot.envelope
    : tile.form === 'interactive-ui'
      && tile.source.kind === 'third-party-extension'
      && surface
      ? {
          $schema: INTERACTIVE_RESULT_SCHEMA,
          schemaVersion: 1 as const,
          view: tile.source.surfaceId,
          mode: 'live' as const,
          summary: surface.description ?? undefined,
          context: tile.context,
        }
      : null;
  const htmlEnvelope = snapshot?.form === 'html-artifact'
    && snapshot.envelope.$schema === HTML_ARTIFACT_RESULT_SCHEMA
    ? snapshot.envelope
    : tile.form === 'html-artifact' && tile.source.kind === 'third-party-extension' && surface
      ? {
          $schema: INSTALLED_HTML_ARTIFACT_RESULT_SCHEMA,
          schemaVersion: 1 as const,
          artifact: tile.source.surfaceId,
          mode: 'live' as const,
          summary: surface.description ?? undefined,
          context: tile.context,
        }
      : null;
  if (!interactiveEnvelope && !htmlEnvelope) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6 text-center text-[var(--status-error)]">
        Workbench Popout snapshot is incompatible.
      </main>
    );
  }
  document.title = surface?.title || 'OpenLoop Extension Workbench';
  return (
    <main className="h-full overflow-auto bg-background p-4 text-foreground">
      {interactiveEnvelope ? (
        <InteractiveUIView
          envelope={interactiveEnvelope}
          workbench={{ projectId, tileId }}
          fallback={<pre className="whitespace-pre-wrap">{JSON.stringify(interactiveEnvelope, null, 2)}</pre>}
          isMobile={false}
          traceContext={{ toolPartId: tileId }}
        />
      ) : htmlEnvelope ? (
        <HTMLArtifactView
          envelope={htmlEnvelope}
          workbench={{ projectId, tileId }}
          fallback={<pre className="whitespace-pre-wrap">{JSON.stringify(htmlEnvelope, null, 2)}</pre>}
          toolPartId={tileId}
          layoutEpoch="workbench-popout"
        />
      ) : null}
    </main>
  );
};

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeSystemProvider>
        <ThemeProvider>
          <RuntimeAPIProvider apis={runtimeAPIs}>
            <PopoutSurface />
          </RuntimeAPIProvider>
        </ThemeProvider>
      </ThemeSystemProvider>
    </I18nProvider>
  </React.StrictMode>,
);
