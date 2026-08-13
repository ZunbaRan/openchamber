import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createHTMLArtifactStore } from './artifact-store.js';
import { registerInteractiveUIRoutes } from './routes.js';
import { InteractiveUIWorkbenchStoreError } from './workbench-store.js';

const temporaryDirectories = [];
const envelope = (scripts = false) => ({
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Artifact fixture',
  html: '<!doctype html><html><body><svg aria-label="fixture"></svg></body></html>',
  capabilities: { scripts },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 360 },
});

const createApp = async (
  environment = {},
  runtime = {},
  uiAuthController = null,
  workbenchStore = null,
  manager = {},
) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-routes-'));
  temporaryDirectories.push(dataDirectory);
  const app = express();
  if (typeof uiAuthController?.requireAuth === 'function') {
    app.use('/api', (req, res, next) => {
      Promise.resolve(uiAuthController.requireAuth(req, res, next)).catch(next);
    });
  }
  registerInteractiveUIRoutes(app, {
    express,
    runtime,
    manager,
    workbenchStore,
    artifactStore: createHTMLArtifactStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      environment,
    }),
  });
  app.delete('/api/session/:sessionId', (req, res) => {
    if (req.params.sessionId === 'ses_failed') return res.status(503).json({ error: 'upstream unavailable' });
    res.json(true);
  });
  return app;
};

const waitForDocumentStatus = async (app, documentPath, expectedStatus) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request(app).get(documentPath);
    if (response.status === expectedStatus) return response;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for Artifact document status ${expectedStatus}`);
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('HTML Artifact routes', () => {
  test('keeps every Interactive UI route behind the scope-aware global API gate', async () => {
    const calls = [];
    const app = await createApp({}, {
      getCapabilities: () => ({ scriptsMode: 'unsupported' }),
    }, {
      requireAuth(req, res, next) {
        calls.push(`${req.method} ${req.originalUrl}`);
        if (req.headers.authorization !== 'Bearer test-client'
          && !req.headers.cookie?.includes('oc_tunnel_session=test-tunnel')) {
          res.status(401).json({ locked: true });
          return;
        }
        next();
      },
    });

    await request(app).get('/api/interactive-ui/artifacts/capabilities').expect(401);
    await request(app).get('/api/interactive-ui/artifacts/capabilities').set('Authorization', 'Bearer test-client').expect(200);
    await request(app).get('/api/interactive-ui/artifacts/capabilities').set('Cookie', 'oc_tunnel_session=test-tunnel').expect(200);
    await request(app).post('/api/interactive-ui/artifacts/materialize').set('Authorization', 'Bearer test-client').send(envelope()).expect(201);
    expect(calls).toEqual([
      'GET /api/interactive-ui/artifacts/capabilities',
      'GET /api/interactive-ui/artifacts/capabilities',
      'GET /api/interactive-ui/artifacts/capabilities',
      'POST /api/interactive-ui/artifacts/materialize',
    ]);
  });

  test('materializes a static document with a non-script CSP', async () => {
    const app = await createApp();
    const materialized = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .send(envelope())
      .expect(201);
    expect(materialized.body.documentPath).toMatch(/^\/api\/interactive-ui\/artifacts\/[a-f0-9]{64}\/document$/);

    const document = await request(app).get(materialized.body.documentPath).expect(200);
    expect(document.headers['content-type']).toContain('text/html');
    expect(document.headers['content-security-policy']).toContain("default-src 'none'");
    expect(document.headers['content-security-policy']).not.toContain('script-src');
    expect(document.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(document.headers['content-security-policy']).toContain("frame-ancestors 'self' openchamber-ui://app");
    expect(document.headers['content-security-policy']).not.toContain('frame-ancestors *');
    expect(document.headers['x-content-type-options']).toBe('nosniff');
    expect(document.headers['referrer-policy']).toBe('no-referrer');
    expect(document.text).toContain('aria-label="fixture"');
  });

  test('adds inline script permission only behind the scripts gate', async () => {
    const app = await createApp({ OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true' });
    const materialized = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .send(envelope(true))
      .expect(201);
    const document = await request(app).get(materialized.body.documentPath).expect(200);
    expect(document.headers['content-security-policy']).toContain("script-src 'unsafe-inline'");
    expect(document.headers['content-security-policy']).not.toContain('unsafe-eval');
    expect(document.headers['content-security-policy']).toContain('frame-src data:');
    expect(document.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(document.headers['content-security-policy']).toContain("frame-ancestors 'self' openchamber-ui://app");
    expect(document.headers['content-security-policy']).not.toContain('navigate-to');
    expect(document.text).toContain('data-ocix-artifact-broker');
    expect(document.text).toContain('broker.navigationBlocked');
    expect(document.text).toContain('openchamber-artifact-broker-internal');
    expect(document.text).toContain('wheel-boundary');
    const encodedArtifact = document.text.match(/data:text\/html;base64,([A-Za-z0-9+/=]+)/)?.[1];
    expect(encodedArtifact).toBeTruthy();
    const innerDocument = Buffer.from(encodedArtifact, 'base64').toString('utf8');
    expect(innerDocument).toContain('openchamberArtifact');
    expect(innerDocument).toContain('artifact.heartbeat');
    expect(innerDocument).toContain("frame-src 'none'");
  });

  test('serves installed third-party Artifacts through the brokered Business Bridge', async () => {
    const runtime = {
      async getInstalledArtifactDescriptor(artifactId, tool) {
        return { artifact: { id: artifactId }, tool, documentPath: '/api/interactive-ui/extensions/com.acme.crm/artifacts/com.acme.crm.explorer' };
      },
      async getInstalledArtifactDocument() {
        return {
          source: '<!doctype html><html><body><script>window.openchamber.business.query("com.acme.crm.query", {})</script></body></html>',
          integrity: 'sha256-fixture',
        };
      },
    };
    const app = await createApp({}, runtime);
    const descriptor = await request(app)
      .get('/api/interactive-ui/installed-artifacts/com.acme.crm.explorer?tool=crm_open_explorer')
      .expect(200);
    expect(descriptor.body.tool).toBe('crm_open_explorer');

    const document = await request(app)
      .get('/api/interactive-ui/extensions/com.acme.crm/artifacts/com.acme.crm.explorer')
      .expect(200);
    expect(document.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(document.headers.etag).toBe('"sha256-fixture"');
    expect(document.text).toContain('data-ocix-artifact-broker');
    expect(document.text).toContain('host.businessResult');
  });

  test('authorizes Workbench business actions against the persisted tile and discards spoofed authorization', async () => {
    const calls = [];
    const runtime = {
      async getWorkbenchCatalog() {
        return {
          extensions: [{
            id: 'com.acme.crm',
            version: '1.4.0',
            surfaces: [{ surfaceId: 'com.acme.crm.explorer' }],
          }],
        };
      },
      async prepareWorkbenchTile(tile) {
        return tile;
      },
      async invokeAction(actionId, body) {
        calls.push({ actionId, body });
        return { data: { ok: true } };
      },
    };
    const workbenchStore = {
      async read(projectId) {
        return {
          projectId,
          activeBoardId: 'default',
          boards: [{
            id: 'default',
            tiles: [{
              tileId: 'tile_crm',
              source: {
                kind: 'third-party-extension',
                extensionId: 'com.acme.crm',
                surfaceId: 'com.acme.crm.explorer',
                compatibleVersion: '^1.0.0',
              },
              form: 'html-artifact',
              context: {},
              contextDigest: 'sha256-real',
              layout: { column: 0, row: 0, columns: 6, rows: 4 },
              displayMode: 'tile',
              relationship: null,
              origin: null,
            }],
          }],
        };
      },
    };
    const app = await createApp({}, runtime, null, workbenchStore);
    const response = await request(app)
      .post('/api/interactive-ui/actions/com.acme.crm.query')
      .send({
        extensionId: 'com.acme.crm',
        artifactId: 'com.acme.crm.explorer',
        instanceId: 'artifact-channel',
        input: {},
        workbench: { projectId: 'project-1', tileId: 'tile_crm' },
        __workbenchAuthorization: {
          projectId: 'attacker-project',
          tileId: 'attacker-tile',
          contextDigest: 'sha256-spoofed',
        },
      })
      .expect(200);

    expect(response.body).toEqual({ data: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.__workbenchAuthorization).toEqual({
      projectId: 'project-1',
      tileId: 'tile_crm',
      contextDigest: 'sha256-real',
    });

    await request(app)
      .post('/api/interactive-ui/actions/com.acme.crm.query')
      .send({
        extensionId: 'com.attacker.crm',
        artifactId: 'com.acme.crm.explorer',
        input: {},
        workbench: { projectId: 'project-1', tileId: 'tile_crm' },
      })
      .expect(403);
    expect(calls).toHaveLength(1);

    runtime.getWorkbenchCatalog = async () => ({
      extensions: [{
        id: 'com.acme.crm',
        version: '2.0.0',
        surfaces: [{ surfaceId: 'com.acme.crm.explorer' }],
      }],
    });
    await request(app)
      .post('/api/interactive-ui/actions/com.acme.crm.query')
      .send({
        extensionId: 'com.acme.crm',
        artifactId: 'com.acme.crm.explorer',
        input: {},
        workbench: { projectId: 'project-1', tileId: 'tile_crm' },
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workbench_migration_required');
      });
    expect(calls).toHaveLength(1);
  });

  test('migrates a persisted Tile through the runtime and reports uninstall impact', async () => {
    const currentTile = {
      tileId: 'tile_crm',
      source: {
        kind: 'third-party-extension',
        extensionId: 'com.acme.crm',
        surfaceId: 'com.acme.crm.overview',
        compatibleVersion: '^1.0.0',
      },
      form: 'interactive-ui',
      context: { territory: 'apac' },
      contextDigest: 'sha256-old',
      layout: { column: 0, row: 0, columns: 6, rows: 4 },
      displayMode: 'tile',
      relationship: null,
      origin: null,
    };
    const calls = [];
    const runtime = {
      async migrateWorkbenchTile(tile) {
        calls.push({ kind: 'runtime', tile });
        return {
          ...tile,
          source: { ...tile.source, compatibleVersion: '^2.0.0' },
          context: { region: 'apac' },
          contextDigest: 'sha256-new',
        };
      },
    };
    const workbenchStore = {
      async read(projectId) {
        return {
          projectId,
          activeBoardId: 'default',
          boards: [{ id: 'default', revision: 3, tiles: [currentTile] }],
        };
      },
      async migrateTile(projectId, tileId, expectedRevision, tile) {
        calls.push({ kind: 'store', projectId, tileId, expectedRevision, tile });
        return {
          snapshot: {
            projectId,
            activeBoardId: 'default',
            boards: [{ id: 'default', revision: 4, tiles: [tile] }],
          },
          tile,
        };
      },
      async getExtensionTileImpact(extensionId) {
        calls.push({ kind: 'impact', extensionId });
        return { tiles: 3, projects: 2 };
      },
    };
    const app = await createApp({}, runtime, null, workbenchStore);
    const migrated = await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile_crm/migrate')
      .send({ expectedRevision: 3 })
      .expect(200);
    expect(migrated.body.tile).toMatchObject({
      source: { compatibleVersion: '^2.0.0' },
      context: { region: 'apac' },
    });
    expect(calls[1]).toMatchObject({
      kind: 'store',
      projectId: 'project-1',
      tileId: 'tile_crm',
      expectedRevision: 3,
    });

    const impact = await request(app)
      .get('/api/interactive-ui/manager/extensions/com.acme.crm/uninstall-impact')
      .expect(200);
    expect(impact.body).toEqual({ tiles: 3, projects: 2 });
  });

  test('replaces a generated Tile snapshot through the narrow CAS route', async () => {
    const calls = [];
    const expectedSnapshotRef = `snapshot_${'a'.repeat(64)}`;
    const generatedEnvelope = {
      $schema: 'openchamber://interactive-result/v1',
      schemaVersion: 1,
      view: 'com.openchamber.builtin.interactive-ui.generated',
      mode: 'snapshot',
      context: { title: 'Refreshed dashboard' },
      data: { values: [3, 5, 8] },
    };
    const workbenchStore = {
      async replaceGeneratedTileSnapshot(projectId, tileId, expectedRevision, sourceSnapshotRef, form, nextEnvelope) {
        calls.push({
          projectId,
          tileId,
          expectedRevision,
          expectedSnapshotRef: sourceSnapshotRef,
          form,
          envelope: nextEnvelope,
        });
        if (expectedRevision === 3) {
          throw new InteractiveUIWorkbenchStoreError(
            'Workbench board changed since it was loaded',
            'workbench_revision_conflict',
            409,
            { expectedRevision: 3, actualRevision: 4 },
          );
        }
        const tile = {
          tileId,
          source: { kind: 'agent-generated', snapshotRef: `snapshot_${'b'.repeat(64)}` },
          form,
        };
        return {
          snapshot: {
            projectId,
            activeBoardId: 'default',
            boards: [{ id: 'default', revision: expectedRevision + 1, tiles: [tile] }],
          },
          tile,
          generatedSnapshot: {
            snapshotRef: tile.source.snapshotRef,
            form,
            envelope: nextEnvelope,
          },
        };
      },
    };
    const app = await createApp({}, {}, null, workbenchStore);

    const response = await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({ expectedRevision: 4, expectedSnapshotRef, form: 'interactive-ui', envelope: generatedEnvelope })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.snapshot.boards[0].revision).toBe(5);
    expect(calls).toEqual([{
      projectId: 'project-1',
      tileId: 'tile-generated',
      expectedRevision: 4,
      expectedSnapshotRef,
      form: 'interactive-ui',
      envelope: generatedEnvelope,
    }]);

    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({ expectedRevision: 3, expectedSnapshotRef, form: 'interactive-ui', envelope: generatedEnvelope })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'workbench_revision_conflict',
          expectedRevision: 3,
          actualRevision: 4,
        });
      });

    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({ form: 'interactive-ui', envelope: generatedEnvelope })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workbench_revision_required');
      });
    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({ expectedRevision: 4, form: 'interactive-ui', envelope: generatedEnvelope })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workbench_snapshot_ref_required');
      });
    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({
        expectedRevision: 4,
        expectedSnapshotRef: 'snapshot_not-a-digest',
        form: 'interactive-ui',
        envelope: generatedEnvelope,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workbench_snapshot_ref_invalid');
      });
    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({
        expectedRevision: 5,
        expectedSnapshotRef,
        form: 'interactive-ui',
        envelope: generatedEnvelope,
        source: { kind: 'third-party-extension' },
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('invalid_workbench_snapshot_replace');
      });
    await request(app)
      .post('/api/interactive-ui/workbench/boards/project-1/tiles/tile-generated/replace-generated-snapshot')
      .send({ expectedRevision: 4, expectedSnapshotRef, form: 'html-artifact', envelope: envelope(true) })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('artifact_scripts_unsupported');
      });
    expect(calls).toHaveLength(2);
  });

  test('returns an explicit capability error instead of silently stripping scripts', async () => {
    const app = await createApp();
    const response = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .send(envelope(true))
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'artifact_scripts_unsupported',
      staticAvailable: true,
    });
  });

  test('removes extension credentials and board tiles during uninstall', async () => {
    const calls = [];
    const app = await createApp(
      {},
      {
        async removeExtensionConnections(extensionId) {
          calls.push({ kind: 'credentials', extensionId });
          return { removed: 1 };
        },
      },
      null,
      {
        async removeExtensionTiles(extensionId) {
          calls.push({ kind: 'tiles', extensionId });
          return { removed: 2, projects: 1 };
        },
      },
      {
        async uninstall(extensionId) {
          calls.push({ kind: 'extension', extensionId });
          return { removed: true };
        },
      },
    );

    const response = await request(app)
      .delete('/api/interactive-ui/manager/extensions/com.acme.crm')
      .expect(200);

    expect(response.body).toEqual({
      removed: true,
      credentials: { removed: 1 },
      workbench: { removed: 2, projects: 1 },
    });
    expect(calls).toEqual([
      // All fallible external cleanup runs first while the shell still exists;
      // manager.uninstall is only called after cleanup succeeds.
      { kind: 'credentials', extensionId: 'com.acme.crm' },
      { kind: 'tiles', extensionId: 'com.acme.crm' },
      { kind: 'extension', extensionId: 'com.acme.crm' },
    ]);
  });

  test('adds uninstall recovery state without reading or mutating hostile error details', async () => {
    let detailsGetterReads = 0;
    const cleanupError = new InteractiveUIWorkbenchStoreError(
      'Workbench cleanup failed',
      'workbench_write_failed',
      500,
    );
    Object.defineProperty(cleanupError, 'details', {
      configurable: true,
      get() {
        detailsGetterReads += 1;
        return { path: '/private/workbench.json', accessKey: 'sk-uninstall-secret' };
      },
    });
    Object.freeze(cleanupError);
    const app = await createApp(
      {},
      {
        async removeExtensionConnections() {
          throw cleanupError;
        },
      },
      null,
      {
        async removeExtensionTiles() {
          throw new Error('must not be called');
        },
      },
      {
        async uninstall() {
          throw new Error('must not be called');
        },
      },
    );

    const response = await request(app)
      .delete('/api/interactive-ui/manager/extensions/com.acme.crm')
      .expect(500);

    expect(response.body).toEqual({
      error: 'Workbench cleanup failed',
      code: 'workbench_write_failed',
      extensionRemoved: false,
    });
    expect(detailsGetterReads).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain('/private/workbench.json');
    expect(JSON.stringify(response.body)).not.toContain('sk-uninstall-secret');
  });

  test('fails closed before impact or uninstall cleanup when Workbench storage is unavailable', async () => {
    const calls = [];
    const app = await createApp(
      {},
      {
        async removeExtensionConnections() {
          calls.push('credentials');
          return { removed: 1 };
        },
      },
      null,
      null,
      {
        async uninstall() {
          calls.push('extension');
          return { removed: true };
        },
      },
    );

    await request(app)
      .get('/api/interactive-ui/manager/extensions/com.acme.crm/uninstall-impact')
      .expect(501)
      .expect(({ body }) => expect(body.code).toBe('workbench_unsupported'));
    await request(app)
      .delete('/api/interactive-ui/manager/extensions/com.acme.crm')
      .expect(501)
      .expect(({ body }) => {
        expect(body.code).toBe('workbench_unsupported');
        expect(body.extensionRemoved).toBe(false);
      });
    expect(calls).toEqual([]);
  });

  test('tracks session references and cleans shared content only after successful final deletion', async () => {
    const app = await createApp();
    const first = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .set('X-OpenChamber-Session-ID', 'ses_first')
      .send(envelope())
      .expect(201);
    const second = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .set('X-OpenChamber-Session-ID', 'ses_second')
      .send(envelope())
      .expect(200);
    expect(first.body.sessionReferenceTracked).toBe(true);
    expect(second.body.artifactId).toBe(first.body.artifactId);

    await request(app).delete('/api/session/ses_first').expect(200);
    await waitForDocumentStatus(app, first.body.documentPath, 200);

    await request(app).delete('/api/session/ses_second').expect(200);
    await waitForDocumentStatus(app, first.body.documentPath, 404);
  });

  test('does not release a session reference when the authoritative delete fails', async () => {
    const app = await createApp();
    const materialized = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .set('X-OpenChamber-Session-ID', 'ses_failed')
      .send(envelope())
      .expect(201);

    await request(app).delete('/api/session/ses_failed').expect(503);
    await waitForDocumentStatus(app, materialized.body.documentPath, 200);
  });

  test('does not release a session reference for nested session deletes', async () => {
    const app = await createApp();
    app.delete('/api/session/:sessionId/message/:messageId', (_req, res) => res.json({ acknowledged: true }));
    const materialized = await request(app)
      .post('/api/interactive-ui/artifacts/materialize')
      .set('X-OpenChamber-Session-ID', 'ses_nested')
      .send(envelope())
      .expect(201);

    await request(app).delete('/api/session/ses_nested/message/msg_1').expect(200);
    await waitForDocumentStatus(app, materialized.body.documentPath, 200);
  });
});
