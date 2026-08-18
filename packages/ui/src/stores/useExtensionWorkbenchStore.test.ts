import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { McpAppResultEnvelope } from '@/lib/interactive-ui/mcpApp';
import type {
  WorkbenchCatalog,
  WorkbenchGeneratedSnapshot,
  WorkbenchSnapshot,
} from '@/lib/interactive-ui/workbench';

let runtimeKey = 'runtime-a';
let requestHandler: (path: string, init?: RequestInit) => Promise<Response>;

const runtimeFetchMock = mock((path: string, init?: RequestInit) => requestHandler(path, init));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: (path: string, init?: RequestInit) => runtimeFetchMock(path, init),
}));
mock.module('@/lib/runtime-switch', () => ({
  getActiveRelayTunnel: () => null,
  getRuntimeApiBaseUrl: () => '',
  getRuntimeKey: () => runtimeKey,
  initializeRuntimeEndpoint: () => undefined,
  subscribeRuntimeEndpointChanged: () => () => undefined,
  subscribeRuntimeEndpointWillChange: () => () => undefined,
  switchRuntimeEndpoint: () => undefined,
}));

const { useExtensionWorkbenchStore } = await import('./useExtensionWorkbenchStore');

const snapshotRef = (character: string) => `snapshot_${character.repeat(64)}`;
const initialSnapshotRef = snapshotRef('a');
const concurrentSnapshotRef = snapshotRef('b');
const persistedSnapshotRef = snapshotRef('c');

const catalog: WorkbenchCatalog = {
  apiVersion: 1,
  extensions: [],
  errors: [],
};

const boardSnapshot = (revision: number, sourceSnapshotRef: string): WorkbenchSnapshot => ({
  $schema: 'openchamber://extension-board/v1',
  schemaVersion: 1,
  projectId: 'project-a',
  activeBoardId: 'default',
  boards: [{
    id: 'default',
    name: 'Default',
    revision,
    tiles: [{
      tileId: 'tile-mcp-app',
      source: { kind: 'agent-generated', snapshotRef: sourceSnapshotRef },
      form: 'mcp-app',
      context: {},
      contextDigest: `sha256-${sourceSnapshotRef}`,
      layout: { column: 0, row: 0, columns: 6, rows: 4 },
      displayMode: 'tile',
      relationship: null,
      origin: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'tool-1' },
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }],
  }],
});

const envelope = (revision: number): McpAppResultEnvelope => ({
  $schema: 'openchamber://mcp-app-result/v1',
  schemaVersion: 1,
  source: 'mcp-app',
  title: 'tldraw_open_canvas',
  binding: {
    server: 'tldraw-local',
    tool: 'tldraw_open_canvas',
    toolKey: 'tldraw-local_tldraw_open_canvas',
    resourceUri: 'ui://tldraw/canvas.html',
    meta: {
      resourceUri: 'ui://tldraw/canvas.html',
      visibility: ['model', 'app'],
    },
  },
  arguments: { canvasId: 'service-topology' },
  result: {
    content: [{ type: 'text', text: `Revision ${revision}` }],
    structuredContent: {
      canvasId: 'service-topology',
      revision,
      authority: {
        distribution: 'tldraw-mcp-app',
        installation: 'install-local',
        scope: 'workspace',
        workspace: 'project-a',
        resourceUri: 'ui://tldraw/canvas.html',
      },
    },
  },
});

const generatedSnapshot = (
  sourceSnapshotRef: string,
  revision: number,
): WorkbenchGeneratedSnapshot => ({
  $schema: 'openchamber://extension-workbench-snapshot/v1',
  schemaVersion: 1,
  snapshotRef: sourceSnapshotRef,
  form: 'mcp-app',
  envelope: envelope(revision),
  createdAt: '2026-08-03T00:00:00.000Z',
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const replaceRequestBody = (init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as {
    expectedRevision: number;
    expectedSnapshotRef: string;
  };
  return {
    expectedRevision: body.expectedRevision,
    expectedSnapshotRef: body.expectedSnapshotRef,
  };
};

describe('Extension Workbench generated snapshot reconciliation', () => {
  beforeEach(() => {
    runtimeKey = 'runtime-a';
    useExtensionWorkbenchStore.getState().resetForRuntimeSwitch();
    useExtensionWorkbenchStore.setState({
      runtimeKey,
      projectId: 'project-a',
      catalog,
      snapshot: boardSnapshot(1, initialSnapshotRef),
      loadState: 'ready',
      mutationPending: false,
      error: null,
    });
  });

  test('does not replay a stale envelope after another window replaces the same Tile snapshot', async () => {
    const replaceBodies: Array<{ expectedRevision: number; expectedSnapshotRef: string }> = [];
    requestHandler = async (path, init) => {
      if (path.endsWith('/workbench/catalog')) return jsonResponse(catalog);
      if (path.endsWith('/workbench/boards/project-a')) {
        return jsonResponse(boardSnapshot(2, concurrentSnapshotRef));
      }
      if (path.endsWith('/replace-generated-snapshot')) {
        replaceBodies.push(replaceRequestBody(init));
        return jsonResponse({
          error: 'Workbench board changed since it was loaded',
          code: 'workbench_revision_conflict',
          expectedRevision: 1,
          actualRevision: 2,
        }, 409);
      }
      throw new Error(`Unexpected Workbench request: ${path}`);
    };

    let conflict: unknown;
    try {
      await useExtensionWorkbenchStore.getState().updateGeneratedTileEnvelope(
        'project-a',
        'tile-mcp-app',
        'mcp-app',
        envelope(3),
      );
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as {
      code: string;
      status: number;
      payload: Record<string, unknown>;
    }).code).toBe('workbench_snapshot_ref_conflict');
    expect((conflict as { status: number }).status).toBe(409);
    expect((conflict as { payload: Record<string, unknown> }).payload).toEqual({
      expectedSnapshotRef: initialSnapshotRef,
      actualSnapshotRef: concurrentSnapshotRef,
    });

    expect(replaceBodies).toEqual([{
      expectedRevision: 1,
      expectedSnapshotRef: initialSnapshotRef,
    }]);
    const state = useExtensionWorkbenchStore.getState();
    expect(state.snapshot).toEqual(boardSnapshot(2, concurrentSnapshotRef));
    expect(state.mutationPending).toBe(false);
    expect(state.error).toBe('Workbench Tile snapshot changed in another window');
  });

  test('retries once when only the Board revision changed and the source snapshot is still current', async () => {
    const replaceBodies: Array<{ expectedRevision: number; expectedSnapshotRef: string }> = [];
    requestHandler = async (path, init) => {
      if (path.endsWith('/workbench/catalog')) return jsonResponse(catalog);
      if (path.endsWith('/workbench/boards/project-a')) {
        return jsonResponse(boardSnapshot(2, initialSnapshotRef));
      }
      if (path.endsWith('/replace-generated-snapshot')) {
        const body = replaceRequestBody(init);
        replaceBodies.push(body);
        if (replaceBodies.length === 1) {
          return jsonResponse({
            error: 'Workbench board changed since it was loaded',
            code: 'workbench_revision_conflict',
            expectedRevision: 1,
            actualRevision: 2,
          }, 409);
        }
        const snapshot = boardSnapshot(3, persistedSnapshotRef);
        return jsonResponse({
          snapshot,
          tile: snapshot.boards[0].tiles[0],
          generatedSnapshot: generatedSnapshot(persistedSnapshotRef, 3),
        });
      }
      throw new Error(`Unexpected Workbench request: ${path}`);
    };

    const persisted = await useExtensionWorkbenchStore.getState().updateGeneratedTileEnvelope(
      'project-a',
      'tile-mcp-app',
      'mcp-app',
      envelope(3),
    );

    expect(persisted.snapshotRef).toBe(persistedSnapshotRef);
    expect(replaceBodies).toEqual([
      { expectedRevision: 1, expectedSnapshotRef: initialSnapshotRef },
      { expectedRevision: 2, expectedSnapshotRef: initialSnapshotRef },
    ]);
    const state = useExtensionWorkbenchStore.getState();
    expect(state.snapshot).toEqual(boardSnapshot(3, persistedSnapshotRef));
    expect(state.mutationPending).toBe(false);
    expect(state.error).toBeNull();
  });
});
