import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInteractiveUIWorkbenchStore } from './workbench-store.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createStore = async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-workbench-'));
  temporaryDirectories.push(dataDirectory);
  let currentTime = Date.parse('2026-07-25T00:00:00.000Z');
  let id = 0;
  const cryptoImpl = {
    createHash: crypto.createHash,
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
  const store = createInteractiveUIWorkbenchStore({
    dataDirectory,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl,
    now: () => currentTime++,
  });
  return { dataDirectory, store };
};

const installedTile = (overrides = {}) => ({
  source: {
    kind: 'third-party-extension',
    extensionId: 'com.acme.crm',
    surfaceId: 'com.acme.crm.customers',
    compatibleVersion: '^2.0.0',
  },
  form: 'interactive-ui',
  context: { region: 'all' },
  contextDigest: 'sha256-context-all',
  layout: { column: 0, row: 0, columns: 6, rows: 4 },
  displayMode: 'tile',
  relationship: null,
  origin: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'tool-1' },
  ...overrides,
});

const interactiveSnapshotEnvelope = (title) => ({
  $schema: 'openchamber://interactive-result/v1',
  schemaVersion: 1,
  view: 'com.openchamber.builtin.interactive-ui.generated',
  mode: 'snapshot',
  context: { title },
  data: { values: [2, 3, 5] },
});

const mcpAppSnapshotEnvelope = (binding = {}, revision = 1, identity = {}) => {
  const canvasId = identity.canvasId ?? 'sales-dashboard';
  const authority = Object.hasOwn(identity, 'authority')
    ? identity.authority
    : {
        distribution: 'tldraw-mcp-app',
        installation: 'install-sales',
        scope: 'workspace',
        workspace: 'project-a',
        resourceUri: 'ui://sales/dashboard',
      };
  return {
    $schema: 'openchamber://mcp-app-result/v1',
    schemaVersion: 1,
    source: 'mcp-app',
    title: 'Sales dashboard',
    binding: {
      server: 'sales',
      tool: 'open_dashboard',
      toolKey: 'sales_open_dashboard',
      resourceUri: 'ui://sales/dashboard',
      meta: { resourceUri: 'ui://sales/dashboard', visibility: ['model', 'app'] },
      ...binding,
    },
    arguments: { region: 'apac', canvasId },
    result: {
      content: [{ type: 'text', text: 'ready' }],
      structuredContent: {
        canvasId,
        revision,
        ...(authority === undefined ? {} : { authority }),
      },
    },
  };
};

const generatedTile = (snapshotRef, overrides = {}) => ({
  source: { kind: 'agent-generated', snapshotRef },
  form: 'interactive-ui',
  context: {},
  contextDigest: 'sha256-generated-initial',
  layout: { column: 0, row: 0, columns: 6, rows: 4 },
  displayMode: 'tile',
  relationship: null,
  origin: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'tool-1' },
  ...overrides,
});

describe('Extension Workbench store', () => {
  it('returns an authoritative empty board when the project has no file', async () => {
    const { store } = await createStore();
    expect(await store.read('project-a')).toEqual({
      $schema: 'openchamber://extension-board/v1',
      schemaVersion: 1,
      projectId: 'project-a',
      activeBoardId: 'default',
      boards: [{ id: 'default', name: 'Default', revision: 0, tiles: [] }],
    });
  });

  it('persists a canonical tile and deduplicates the same source context', async () => {
    const { store } = await createStore();
    const first = await store.upsertTile('project-a', 0, installedTile());
    expect(first.created).toBe(true);
    expect(first.snapshot.boards[0].revision).toBe(1);
    expect(first.tile).toMatchObject({
      tileId: 'tile_00000000-0000-4000-8000-000000000001',
      context: { region: 'all' },
      displayMode: 'tile',
    });

    const second = await store.upsertTile('project-a', 1, installedTile({
      layout: { column: 6, row: 0, columns: 6, rows: 4 },
    }));
    expect(second.created).toBe(false);
    expect(second.tile.tileId).toBe(first.tile.tileId);
    expect(second.snapshot.boards[0].tiles).toHaveLength(1);
    expect(second.snapshot.boards[0].revision).toBe(2);
  });

  it('deduplicates the same tile across compatible minor upgrades but not major upgrades', async () => {
    const { store } = await createStore();
    const first = await store.upsertTile('project-a', 0, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.customers',
        compatibleVersion: '^2.1.0',
      },
    }));
    const compatible = await store.upsertTile('project-a', 1, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.customers',
        compatibleVersion: '^2.0.0',
      },
    }));
    expect(compatible.created).toBe(false);
    expect(compatible.tile.tileId).toBe(first.tile.tileId);

    const incompatible = await store.upsertTile('project-a', 2, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.customers',
        compatibleVersion: '^3.0.0',
      },
    }));
    expect(incompatible.created).toBe(true);
    expect(incompatible.snapshot.boards[0].tiles).toHaveLength(2);
  });

  it('updates multiple tile layouts atomically with one board revision', async () => {
    const { store } = await createStore();
    const first = await store.upsertTile('project-a', 0, installedTile());
    const second = await store.upsertTile('project-a', 1, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.pipeline',
        compatibleVersion: '^2.0.0',
      },
      contextDigest: 'sha256-context-pipeline',
      layout: { column: 6, row: 0, columns: 6, rows: 4 },
    }));

    const swapped = await store.updateTileLayouts('project-a', 2, [
      {
        tileId: first.tile.tileId,
        layout: { column: 6, row: 0, columns: 6, rows: 4 },
      },
      {
        tileId: second.tile.tileId,
        layout: { column: 0, row: 0, columns: 6, rows: 4 },
      },
    ]);

    expect(swapped.snapshot.boards[0].revision).toBe(3);
    expect(swapped.tiles).toHaveLength(2);
    expect(swapped.snapshot.boards[0].tiles.map((tile) => tile.layout)).toEqual([
      { column: 6, row: 0, columns: 6, rows: 4 },
      { column: 0, row: 0, columns: 6, rows: 4 },
    ]);
  });

  it('round-trips across a new store instance and isolates projects', async () => {
    const { dataDirectory, store } = await createStore();
    await store.upsertTile('project-a', 0, installedTile());
    const restarted = createInteractiveUIWorkbenchStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    expect((await restarted.read('project-a')).boards[0].tiles).toHaveLength(1);
    expect((await restarted.read('project-b')).boards[0].tiles).toEqual([]);
  });

  it('rejects stale revisions without overwriting the current board', async () => {
    const { store } = await createStore();
    await store.upsertTile('project-a', 0, installedTile());
    await expect(store.updateTile('project-a', 'tile-missing', 0, {
      layout: { column: 0, row: 1, columns: 6, rows: 4 },
    })).rejects.toMatchObject({
      code: 'workbench_revision_conflict',
      status: 409,
      details: { expectedRevision: 0, actualRevision: 1 },
    });
    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ contextDigest: 'sha256-context-all' }],
    });
  });

  it('updates layout/display mode and removes child relationships without deleting the child', async () => {
    const { store } = await createStore();
    const parent = await store.upsertTile('project-a', 0, installedTile());
    const child = await store.upsertTile('project-a', 1, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.customer-detail',
        compatibleVersion: '^2.0.0',
      },
      form: 'html-artifact',
      context: { customerId: 'customer-1' },
      contextDigest: 'sha256-customer-1',
      layout: { column: 6, row: 0, columns: 6, rows: 6 },
      relationship: {
        groupId: 'group-1',
        kind: 'customer',
        parentTileId: parent.tile.tileId,
      },
    }));
    const updated = await store.updateTile('project-a', child.tile.tileId, 2, {
      layout: { column: 0, row: 4, columns: 12, rows: 8 },
      displayMode: 'focus',
    });
    expect(updated.tile).toMatchObject({
      layout: { column: 0, row: 4, columns: 12, rows: 8 },
      displayMode: 'focus',
    });
    const removed = await store.removeTile('project-a', parent.tile.tileId, 3);
    expect(removed.snapshot.boards[0].tiles).toEqual([
      expect.objectContaining({
        tileId: child.tile.tileId,
        relationship: null,
      }),
    ]);
  });

  it('atomically replaces only migrated context/version while preserving Tile identity', async () => {
    const { store } = await createStore();
    const current = await store.upsertTile('project-a', 0, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.customers',
        compatibleVersion: '^1.0.0',
      },
      context: { territory: 'apac' },
      contextDigest: 'sha256-territory',
    }));
    const migrated = await store.migrateTile('project-a', current.tile.tileId, 1, {
      ...current.tile,
      source: {
        ...current.tile.source,
        compatibleVersion: '^2.0.0',
      },
      context: { region: 'apac' },
      contextDigest: 'sha256-region',
      layout: { column: 0, row: 0, columns: 6, rows: 5 },
    });
    expect(migrated.tile).toMatchObject({
      tileId: current.tile.tileId,
      source: { compatibleVersion: '^2.0.0' },
      context: { region: 'apac' },
      contextDigest: 'sha256-region',
    });
    expect(migrated.tile.createdAt).toBe(current.tile.createdAt);
    await expect(store.migrateTile('project-a', current.tile.tileId, 2, {
      ...migrated.tile,
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.attacker.crm',
        surfaceId: 'com.attacker.crm.customers',
        compatibleVersion: '^2.0.0',
      },
    })).rejects.toMatchObject({ code: 'workbench_migration_identity_mismatch' });
  });

  it('rejects sensitive context and malformed persisted files', async () => {
    const { dataDirectory, store } = await createStore();
    await expect(store.upsertTile('project-a', 0, installedTile({
      context: { accessToken: 'do-not-store' },
    }))).rejects.toMatchObject({ code: 'workbench_sensitive_context' });

    const digest = crypto.createHash('sha256').update('project-a').digest('base64url');
    const directory = path.join(dataDirectory, 'extension-workbench', 'boards');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${digest}.json`), '{bad-json', 'utf8');
    await expect(store.read('project-a')).rejects.toMatchObject({
      code: 'workbench_board_malformed',
      status: 409,
    });
  });

  it('removes only the uninstalled extension across stored projects', async () => {
    const { store } = await createStore();
    await store.upsertTile('project-a', 0, installedTile());
    await store.upsertTile('project-a', 1, installedTile({
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.bi',
        surfaceId: 'com.acme.bi.overview',
        compatibleVersion: '^1.0.0',
      },
      contextDigest: 'sha256-bi',
    }));
    await store.upsertTile('project-b', 0, installedTile());

    expect(await store.getExtensionTileImpact('com.acme.crm')).toEqual({ tiles: 2, projects: 2 });
    expect(await store.removeExtensionTiles('com.acme.crm')).toEqual({ removed: 2, projects: 2 });
    expect(await store.getExtensionTileImpact('com.acme.crm')).toEqual({ tiles: 0, projects: 0 });
    expect((await store.read('project-a')).boards[0].tiles).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ extensionId: 'com.acme.bi' }) }),
    ]);
    expect((await store.read('project-b')).boards[0].tiles).toEqual([]);
  });

  it('stores content-addressed generated snapshots separately from project boards', async () => {
    const { store, dataDirectory } = await createStore();
    const envelope = {
      $schema: 'openchamber://interactive-result/v1',
      schemaVersion: 1,
      view: 'com.openchamber.builtin.interactive-ui.generated',
      mode: 'snapshot',
      context: { title: 'Quarterly trend' },
      data: { values: [2, 3, 5] },
    };
    const first = await store.writeSnapshot('interactive-ui', envelope);
    const second = await store.writeSnapshot('interactive-ui', envelope);
    expect(second.snapshotRef).toBe(first.snapshotRef);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await store.readSnapshot(first.snapshotRef)).toMatchObject({
      $schema: 'openchamber://extension-workbench-snapshot/v1',
      form: 'interactive-ui',
      envelope,
    });

    const boardDirectory = path.join(dataDirectory, 'extension-workbench', 'boards');
    const snapshotDirectory = path.join(dataDirectory, 'extension-workbench', 'snapshots');
    await expect(fs.readdir(boardDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(snapshotDirectory)).toEqual([`${first.snapshotRef}.json`]);
  });

  it('stores MCP App snapshots with their protocol source identity', async () => {
    const { store } = await createStore();
    const envelope = {
      $schema: 'openchamber://mcp-app-result/v1',
      schemaVersion: 1,
      source: 'mcp-app',
      title: 'Sales dashboard',
      binding: {
        server: 'sales',
        tool: 'open_dashboard',
        toolKey: 'sales_open_dashboard',
        resourceUri: 'ui://sales/dashboard',
        meta: { resourceUri: 'ui://sales/dashboard', visibility: ['model', 'app'] },
      },
      arguments: { region: 'apac' },
      result: {
        content: [{ type: 'text', text: 'ready' }],
        structuredContent: { total: 42 },
      },
    };

    const snapshot = await store.writeSnapshot('mcp-app', envelope);
    expect(await store.readSnapshot(snapshot.snapshotRef)).toMatchObject({
      form: 'mcp-app',
      envelope: {
        source: 'mcp-app',
        binding: { server: 'sales', resourceUri: 'ui://sales/dashboard' },
      },
    });
  });

  it('deduplicates new MCP App snapshots for the same authority and canvas', async () => {
    const { store } = await createStore();
    const initialSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 1));
    const refreshedSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 2, {
      authority: {
        workspace: 'project-a',
        resourceUri: 'ui://sales/dashboard',
        scope: 'workspace',
        installation: 'install-sales',
        distribution: 'tldraw-mcp-app',
      },
    }));
    const first = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-initial',
    }));
    const second = await store.upsertTile('project-a', 1, generatedTile(refreshedSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-refreshed',
      origin: { sessionId: 'session-2', messageId: 'message-2', toolCallId: 'tool-2' },
    }));

    expect(second.created).toBe(false);
    expect(second.tile.tileId).toBe(first.tile.tileId);
    expect(second.tile.source.snapshotRef).toBe(initialSnapshot.snapshotRef);
    expect(second.snapshot.boards[0].tiles).toHaveLength(1);
  });

  it('keeps different MCP App canvases and authorities as separate Tiles', async () => {
    const { store } = await createStore();
    const initialSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 1));
    const otherCanvasSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 1, {
      canvasId: 'sales-dashboard-2',
    }));
    const otherAuthoritySnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 1, {
      authority: {
        distribution: 'tldraw-mcp-app',
        installation: 'install-other',
        scope: 'workspace',
        workspace: 'project-a',
        resourceUri: 'ui://sales/dashboard',
      },
    }));

    await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-initial',
    }));
    const otherCanvas = await store.upsertTile('project-a', 1, generatedTile(otherCanvasSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-other-canvas',
    }));
    const otherAuthority = await store.upsertTile('project-a', 2, generatedTile(otherAuthoritySnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-other-authority',
    }));

    expect(otherCanvas.created).toBe(true);
    expect(otherAuthority.created).toBe(true);
    expect(otherAuthority.snapshot.boards[0].tiles).toHaveLength(3);
  });

  it('replaces a generated Tile snapshot with one Board revision and restores it after restart', async () => {
    const { dataDirectory, store } = await createStore();
    const initialEnvelope = interactiveSnapshotEnvelope('Initial trend');
    const initialSnapshot = await store.writeSnapshot('interactive-ui', initialEnvelope);
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef));
    const initialSnapshotPath = path.join(
      dataDirectory,
      'extension-workbench',
      'snapshots',
      `${initialSnapshot.snapshotRef}.json`,
    );
    const initialSnapshotBytes = await fs.readFile(initialSnapshotPath, 'utf8');
    const nextEnvelope = interactiveSnapshotEnvelope('Refreshed trend');

    const replaced = await store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'interactive-ui',
      nextEnvelope,
    );

    expect(replaced.generatedSnapshot.snapshotRef).not.toBe(initialSnapshot.snapshotRef);
    expect(replaced.generatedSnapshot.envelope).toEqual(nextEnvelope);
    expect(replaced.snapshot.boards[0].revision).toBe(2);
    expect(replaced.tile).toMatchObject({
      tileId: pinned.tile.tileId,
      source: {
        kind: 'agent-generated',
        snapshotRef: replaced.generatedSnapshot.snapshotRef,
      },
      layout: pinned.tile.layout,
      origin: pinned.tile.origin,
      createdAt: pinned.tile.createdAt,
    });
    expect(replaced.tile.contextDigest).toBe(
      `sha256-${crypto.createHash('sha256').update(`interactive-ui\0${replaced.generatedSnapshot.snapshotRef}`).digest('base64')}`,
    );
    expect(await fs.readFile(initialSnapshotPath, 'utf8')).toBe(initialSnapshotBytes);
    expect((await store.readSnapshot(initialSnapshot.snapshotRef)).envelope).toEqual(initialEnvelope);

    const restarted = createInteractiveUIWorkbenchStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const restoredBoard = (await restarted.read('project-a')).boards[0];
    expect(restoredBoard).toMatchObject({
      revision: 2,
      tiles: [{
        tileId: pinned.tile.tileId,
        source: {
          kind: 'agent-generated',
          snapshotRef: replaced.generatedSnapshot.snapshotRef,
        },
      }],
    });
    expect((await restarted.readSnapshot(replaced.generatedSnapshot.snapshotRef)).envelope).toEqual(nextEnvelope);
  });

  it('rejects a stale generated snapshot replacement before writing a new snapshot', async () => {
    const { dataDirectory, store } = await createStore();
    const initialSnapshot = await store.writeSnapshot(
      'interactive-ui',
      interactiveSnapshotEnvelope('Initial trend'),
    );
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef));
    const snapshotDirectory = path.join(dataDirectory, 'extension-workbench', 'snapshots');
    const entriesBefore = await fs.readdir(snapshotDirectory);

    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      0,
      initialSnapshot.snapshotRef,
      'interactive-ui',
      interactiveSnapshotEnvelope('Stale replacement'),
    )).rejects.toMatchObject({
      code: 'workbench_revision_conflict',
      status: 409,
      details: { expectedRevision: 0, actualRevision: 1 },
    });

    expect(await fs.readdir(snapshotDirectory)).toEqual(entriesBefore);
    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ source: { kind: 'agent-generated', snapshotRef: initialSnapshot.snapshotRef } }],
    });
  });

  it('rejects a two-window stale snapshot replay even after the caller reloads the Board revision', async () => {
    const { dataDirectory, store } = await createStore();
    const initialSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope({}, 1));
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-initial',
    }));
    const winner = await store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 2),
    );
    const snapshotDirectory = path.join(dataDirectory, 'extension-workbench', 'snapshots');
    const entriesBeforeReplay = await fs.readdir(snapshotDirectory);

    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      2,
      initialSnapshot.snapshotRef,
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 3),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_ref_conflict',
      status: 409,
      details: {
        expectedSnapshotRef: initialSnapshot.snapshotRef,
        actualSnapshotRef: winner.generatedSnapshot.snapshotRef,
      },
    });

    expect(await fs.readdir(snapshotDirectory)).toEqual(entriesBeforeReplay);
    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 2,
      tiles: [{ source: { snapshotRef: winner.generatedSnapshot.snapshotRef } }],
    });
  });

  it('keeps the old Board authoritative when publishing the replacement Board fails', async () => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-workbench-'));
    temporaryDirectories.push(dataDirectory);
    let failBoardRename = false;
    const fsImpl = {
      ...fs,
      async rename(from, to) {
        if (failBoardRename && to.includes(`${path.sep}boards${path.sep}`)) {
          throw Object.assign(new Error('injected Board rename failure'), { code: 'EIO' });
        }
        return fs.rename(from, to);
      },
    };
    const store = createInteractiveUIWorkbenchStore({
      dataDirectory,
      fsImpl,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const initialSnapshot = await store.writeSnapshot(
      'interactive-ui',
      interactiveSnapshotEnvelope('Initial trend'),
    );
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef));

    failBoardRename = true;
    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'interactive-ui',
      interactiveSnapshotEnvelope('Unpublished replacement'),
    )).rejects.toMatchObject({ code: 'EIO' });

    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ source: { kind: 'agent-generated', snapshotRef: initialSnapshot.snapshotRef } }],
    });
    expect(await fs.readdir(path.join(dataDirectory, 'extension-workbench', 'snapshots')))
      .toHaveLength(2);
  });

  it('does not allow installed Tiles or snapshot forms to switch identity', async () => {
    const { store } = await createStore();
    const installed = await store.upsertTile('project-installed', 0, installedTile());
    await expect(store.replaceGeneratedTileSnapshot(
      'project-installed',
      installed.tile.tileId,
      1,
      `snapshot_${'a'.repeat(64)}`,
      'interactive-ui',
      interactiveSnapshotEnvelope('Replacement'),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_replace_unsupported',
      status: 409,
    });

    const initialSnapshot = await store.writeSnapshot(
      'interactive-ui',
      interactiveSnapshotEnvelope('Initial trend'),
    );
    const generated = await store.upsertTile(
      'project-generated',
      0,
      generatedTile(initialSnapshot.snapshotRef),
    );
    await expect(store.replaceGeneratedTileSnapshot(
      'project-generated',
      generated.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'html-artifact',
      {
        $schema: 'openchamber://html-artifact-result/v1',
        schemaVersion: 1,
        title: 'Wrong form',
        html: '<p>wrong form</p>',
      },
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_form_mismatch',
      status: 409,
      details: { expectedForm: 'interactive-ui' },
    });
    expect((await store.read('project-generated')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ source: { snapshotRef: initialSnapshot.snapshotRef } }],
    });
  });

  it('preserves MCP App server, resource, Tool, canvas, and authority identity', async () => {
    const { dataDirectory, store } = await createStore();
    const initialSnapshot = await store.writeSnapshot('mcp-app', mcpAppSnapshotEnvelope());
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef, {
      form: 'mcp-app',
    }));

    const mismatches = [
      ['server', { server: 'attacker' }],
      ['resourceUri', { resourceUri: 'ui://attacker/dashboard' }],
      ['toolKey', { toolKey: 'attacker_open_dashboard' }],
    ];
    for (const [field, binding] of mismatches) {
      await expect(store.replaceGeneratedTileSnapshot(
        'project-a',
        pinned.tile.tileId,
        1,
        initialSnapshot.snapshotRef,
        'mcp-app',
        mcpAppSnapshotEnvelope(binding, 2),
      )).rejects.toMatchObject({
        code: 'workbench_snapshot_binding_mismatch',
        status: 409,
        details: { field },
      });
    }
    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 2, { canvasId: 'another-canvas' }),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_binding_mismatch',
      status: 409,
      details: { field: 'canvasId' },
    });
    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 2, { authority: undefined }),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_binding_mismatch',
      status: 409,
      details: { field: 'authority' },
    });

    expect(await fs.readdir(path.join(dataDirectory, 'extension-workbench', 'snapshots')))
      .toEqual([`${initialSnapshot.snapshotRef}.json`]);
    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ source: { snapshotRef: initialSnapshot.snapshotRef } }],
    });

    const equivalentAuthorityEnvelope = mcpAppSnapshotEnvelope({}, 2);
    equivalentAuthorityEnvelope.result.authority = equivalentAuthorityEnvelope.result.structuredContent.authority;
    delete equivalentAuthorityEnvelope.result.structuredContent.authority;
    const replaced = await store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'mcp-app',
      equivalentAuthorityEnvelope,
    );
    expect(replaced.snapshot.boards[0].revision).toBe(2);
    expect(replaced.generatedSnapshot.snapshotRef).not.toBe(initialSnapshot.snapshotRef);
    expect(replaced.generatedSnapshot.envelope.result.structuredContent).toMatchObject({
      canvasId: 'sales-dashboard',
      revision: 2,
    });
  });

  it('rejects adding an authority to a previously authority-less MCP App Tile', async () => {
    const { store } = await createStore();
    const initialSnapshot = await store.writeSnapshot(
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 1, { authority: undefined }),
    );
    const pinned = await store.upsertTile('project-a', 0, generatedTile(initialSnapshot.snapshotRef, {
      form: 'mcp-app',
      contextDigest: 'sha256-mcp-no-authority',
    }));

    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      initialSnapshot.snapshotRef,
      'mcp-app',
      mcpAppSnapshotEnvelope({}, 2),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_binding_mismatch',
      status: 409,
      details: { field: 'authority' },
    });
  });

  it('rejects a malformed current snapshot reference without changing the Board', async () => {
    const { store } = await createStore();
    const pinned = await store.upsertTile('project-a', 0, generatedTile('snapshot_not-a-digest'));

    await expect(store.replaceGeneratedTileSnapshot(
      'project-a',
      pinned.tile.tileId,
      1,
      'snapshot_not-a-digest',
      'interactive-ui',
      interactiveSnapshotEnvelope('Replacement'),
    )).rejects.toMatchObject({
      code: 'workbench_snapshot_ref_invalid',
      status: 400,
    });
    expect((await store.read('project-a')).boards[0]).toMatchObject({
      revision: 1,
      tiles: [{ source: { snapshotRef: 'snapshot_not-a-digest' } }],
    });
  });

  it('rejects malformed or mismatched generated snapshots', async () => {
    const { dataDirectory, store } = await createStore();
    await expect(store.writeSnapshot('interactive-ui', {
      $schema: 'openchamber://html-artifact-result/v1',
      schemaVersion: 1,
      title: 'wrong form',
      html: '<p>wrong</p>',
    })).rejects.toMatchObject({ code: 'invalid_workbench_snapshot' });
    await expect(store.readSnapshot('snapshot_not-a-digest'))
      .rejects.toMatchObject({ code: 'workbench_snapshot_ref_invalid', status: 400 });

    const stored = await store.writeSnapshot(
      'interactive-ui',
      interactiveSnapshotEnvelope('Original'),
    );
    const storedPath = path.join(
      dataDirectory,
      'extension-workbench',
      'snapshots',
      `${stored.snapshotRef}.json`,
    );
    const tampered = JSON.parse(await fs.readFile(storedPath, 'utf8'));
    tampered.envelope.context.title = 'Tampered';
    await fs.writeFile(storedPath, JSON.stringify(tampered), 'utf8');
    await expect(store.readSnapshot(stored.snapshotRef)).rejects.toMatchObject({
      code: 'workbench_snapshot_malformed',
      status: 409,
    });
  });
});
