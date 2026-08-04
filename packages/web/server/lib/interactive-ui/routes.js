import { InteractiveUIRuntimeError } from './runtime.js';
import { isWorkbenchVersionCompatible } from './workbench-version.js';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const WORKBENCH_SNAPSHOT_REF_PATTERN = /^snapshot_[a-f0-9]{64}$/;

const sendError = (res, error) => {
  if (error instanceof InteractiveUIRuntimeError || (Number.isInteger(error?.status) && typeof error?.code === 'string')) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details || {}),
    });
  }
  return res.status(500).json({ error: 'Interactive UI request failed', code: 'internal_error' });
};

const decodePackage = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 28 * 1024 * 1024 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const error = new Error('Extension package must be valid base64');
    error.code = 'invalid_package_encoding';
    error.status = 400;
    throw error;
  }
  return Buffer.from(value, 'base64');
};

const staticArtifactContentSecurityPolicy = () => [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' openchamber-ui://app",
].join('; ');

const brokerContentSecurityPolicy = () => [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  'frame-src data:',
  "object-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts',
  "frame-ancestors 'self' openchamber-ui://app",
].join('; ');

const createArtifactBrokerDocument = (artifactDocument) => {
  const dataUrl = `data:text/html;base64,${Buffer.from(artifactDocument, 'utf8').toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0;background:transparent}</style></head><body data-ocix-artifact-broker><script>(()=>{"use strict";const frame=document.createElement("iframe"),pending=[];let channel="",loaded=false,loadCount=0,navigationBlocked=false;const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value)).byteLength}catch{return Infinity}};const record=value=>value&&typeof value==="object"&&!Array.isArray(value);const keys=value=>Object.keys(value).every(key=>["source","direction","bridgeVersion","channelId","sequence","type","payload"].includes(key));const validChannel=value=>typeof value==="string"&&value.length>=16&&value.length<=128;const hostMessage=value=>record(value)&&size(value)<=2200000&&keys(value)&&value.source==="openchamber-host"&&value.direction==="host-to-artifact"&&value.bridgeVersion===1&&["host.init","host.businessResult"].includes(value.type)&&validChannel(value.channelId);const artifactMessage=value=>record(value)&&size(value)<=65536&&keys(value)&&value.source==="openchamber-artifact"&&value.direction==="artifact-to-host"&&value.bridgeVersion===1&&value.channelId===channel;const reportNavigation=()=>{navigationBlocked=true;if(!channel)return;parent.postMessage({source:"openchamber-artifact-broker",direction:"broker-to-host",bridgeVersion:1,channelId:channel,type:"broker.navigationBlocked",payload:{}},"*")};addEventListener("message",event=>{const value=event.data;if(event.source===parent&&hostMessage(value)){if(value.type==="host.init")channel=value.channelId;else if(!channel||value.channelId!==channel)return;if(navigationBlocked){reportNavigation();return}if(loaded)frame.contentWindow?.postMessage(value,"*");else pending.push(value);return}if(event.source===frame.contentWindow&&artifactMessage(value))parent.postMessage(value,"*")});frame.title="Artifact content";frame.setAttribute("sandbox","allow-scripts");frame.src=${JSON.stringify(dataUrl)};frame.addEventListener("load",()=>{loadCount+=1;if(loadCount>1){frame.remove();reportNavigation();return}loaded=true;for(const message of pending.splice(0))frame.contentWindow?.postMessage(message,"*")});document.body.append(frame)})();</script></body></html>`;
};

const setArtifactDocumentHeaders = (res, scripts) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', scripts ? brokerContentSecurityPolicy() : staticArtifactContentSecurityPolicy());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
};

export const registerInteractiveUIRoutes = (app, {
  express,
  runtime,
  manager,
  artifactStore,
  workbenchStore = null,
  uiAuthController = null,
}) => {
  // Interactive UI owns both read-only descriptors and privileged mutations
  // (extension install/trust, connector credentials, and Business Gateway
  // actions).  Keep the route family behind the same UI auth gate as the rest
  // of the OpenChamber API.  The URL-token exception remains narrow and is
  // decided by ui-auth for the exact Native/Artifact document paths.
  if (typeof uiAuthController?.requireAuth === 'function') {
    app.use('/api/interactive-ui', (req, res, next) => {
      Promise.resolve(uiAuthController.requireAuth(req, res, next)).catch((error) => sendError(res, error));
    });
  }

  const authorizeWorkbenchAction = async (request) => {
    if (!isRecord(request)) return request;
    const {
      __workbenchAuthorization: _untrustedAuthorization,
      ...cleanRequest
    } = request;
    if (!isRecord(request.workbench)) return cleanRequest;
    if (!workbenchStore) {
      throw new InteractiveUIRuntimeError(
        'Extension Workbench is unavailable in this runtime',
        501,
        'workbench_unsupported',
      );
    }
    const projectId = typeof request.workbench.projectId === 'string'
      ? request.workbench.projectId.trim()
      : '';
    const tileId = typeof request.workbench.tileId === 'string'
      ? request.workbench.tileId.trim()
      : '';
    if (!projectId || !tileId) {
      throw new InteractiveUIRuntimeError(
        'Workbench action context is incomplete',
        400,
        'invalid_workbench_action',
      );
    }
    const snapshot = await workbenchStore.read(projectId);
    const board = snapshot.boards.find((candidate) => candidate.id === snapshot.activeBoardId);
    const tile = board?.tiles.find((candidate) => candidate.tileId === tileId);
    if (!tile) {
      throw new InteractiveUIRuntimeError(
        'Workbench tile was not found',
        404,
        'workbench_tile_not_found',
      );
    }
    if (tile.source.kind !== 'third-party-extension') {
      throw new InteractiveUIRuntimeError(
        'Generated Workbench tiles cannot call the Business Gateway',
        403,
        'workbench_business_not_allowed',
      );
    }
    const surfaceId = typeof request.viewId === 'string'
      ? request.viewId
      : typeof request.artifactId === 'string'
        ? request.artifactId
        : '';
    if (request.extensionId !== tile.source.extensionId || surfaceId !== tile.source.surfaceId) {
      throw new InteractiveUIRuntimeError(
        'Workbench tile does not own this action surface',
        403,
        'workbench_surface_mismatch',
      );
    }
    if ((request.viewId && tile.form !== 'interactive-ui')
      || (request.artifactId && tile.form !== 'html-artifact')) {
      throw new InteractiveUIRuntimeError(
        'Workbench tile form does not match the requested action',
        403,
        'workbench_form_mismatch',
      );
    }
    const catalog = await runtime.getWorkbenchCatalog();
    const extension = catalog.extensions.find((candidate) => candidate.id === tile.source.extensionId);
    const surface = extension?.surfaces.find((candidate) => candidate.surfaceId === tile.source.surfaceId);
    if (!extension || !surface) {
      throw new InteractiveUIRuntimeError(
        'Workbench extension or surface is disabled or unavailable',
        409,
        'workbench_surface_unavailable',
      );
    }
    if (!isWorkbenchVersionCompatible(tile.source.compatibleVersion, extension.version)) {
      throw new InteractiveUIRuntimeError(
        'Workbench tile requires migration before it can call the Business Gateway',
        409,
        'workbench_migration_required',
      );
    }
    try {
      await runtime.prepareWorkbenchTile({
        tileId: tile.tileId,
        source: {
          kind: 'third-party-extension',
          extensionId: tile.source.extensionId,
          surfaceId: tile.source.surfaceId,
        },
        form: tile.form,
        context: tile.context,
        layout: tile.layout,
        displayMode: tile.displayMode,
        relationship: tile.relationship,
        origin: tile.origin,
      });
    } catch (error) {
      throw new InteractiveUIRuntimeError(
        'Workbench tile is incompatible with the installed surface and requires migration',
        409,
        'workbench_migration_required',
        { causeCode: typeof error?.code === 'string' ? error.code : 'invalid_workbench_context' },
      );
    }
    return {
      ...cleanRequest,
      __workbenchAuthorization: {
        projectId,
        tileId,
        contextDigest: tile.contextDigest,
      },
    };
  };

  app.get('/api/interactive-ui/artifacts/capabilities', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(artifactStore.getCapabilities());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/artifacts/materialize', express.json({ limit: '300kb' }), async (req, res) => {
    try {
      const result = await artifactStore.materialize(req.body, {
        sessionId: req.get('x-openchamber-session-id') || undefined,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.cacheHit ? 200 : 201).json({
        ...result,
        documentPath: `/api/interactive-ui/artifacts/${result.artifactId}/document`,
        metadataPath: `/api/interactive-ui/artifacts/${result.artifactId}/metadata`,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/artifacts/:artifactId/document', async (req, res) => {
    try {
      const artifact = await artifactStore.getDocument(req.params.artifactId);
      setArtifactDocumentHeaders(res, artifact.metadata.scripts === true);
      res.send(artifact.metadata.scripts ? createArtifactBrokerDocument(artifact.html) : artifact.html);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/artifacts/:artifactId/metadata', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await artifactStore.getMetadata(req.params.artifactId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/artifacts/cache', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await artifactStore.clear());
    } catch (error) {
      sendError(res, error);
    }
  });

  // Keep the official OpenCode session DELETE request on the generic proxy.
  // Cleanup runs only after that authoritative request succeeds, and failure is
  // conservative: stale cache may remain, but another session's Artifact is
  // never deleted on an unconfirmed session mutation.
  app.use('/api/session/:sessionId', (req, res, next) => {
    if (req.method !== 'DELETE') return next();
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void artifactStore.releaseSession(req.params.sessionId).catch(() => undefined);
    });
    next();
  });

  app.get('/api/interactive-ui/manager', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.list());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/publishers', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.trustPublisher(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/publishers/:publisherId/keys/:keyId', async (req, res) => {
    try {
      res.json(await manager.removeTrustedPublisherKey(req.params.publisherId, req.params.keyId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/packages', express.json({ limit: '28mb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.installPackage(decodePackage(req.body?.packageBase64), {
        source: { type: 'file' },
        confirmedPublisherFingerprint: req.body?.confirmedPublisherFingerprint,
        confirmedHostedManifestHash: req.body?.confirmedHostedManifestHash,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/packages/inspect', express.json({ limit: '28mb' }), async (req, res) => {
    try {
      res.json(await manager.inspectPackage(decodePackage(req.body?.packageBase64)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/manager/extensions/:extensionId', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.json(await manager.setEnabled(req.params.extensionId, req.body?.enabled));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/hosted/refresh', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.refreshHosted(req.params.extensionId, {
        confirmedManifestHash: req.body?.confirmedManifestHash,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/rollback', async (req, res) => {
    try {
      res.json(await manager.rollback(req.params.extensionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/manager/extensions/:extensionId/uninstall-impact', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(workbenchStore
        ? await workbenchStore.getExtensionTileImpact(req.params.extensionId)
        : { tiles: 0, projects: 0 });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/extensions/:extensionId', async (req, res) => {
    try {
      const result = await manager.uninstall(req.params.extensionId);
      try {
        const credentials = await runtime.removeExtensionConnections(req.params.extensionId);
        const workbench = workbenchStore
          ? await workbenchStore.removeExtensionTiles(req.params.extensionId)
          : { removed: 0, projects: 0 };
        res.json({
          ...result,
          credentials,
          workbench,
        });
      } catch (error) {
        error.details = { ...(error.details ?? {}), extensionRemoved: true, recoveryPath: result.recoveryPath ?? null };
        sendError(res, error);
      }
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.addMarketplace(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces/inspect', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.json(await manager.inspectMarketplace(req.body?.catalogUrl));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/marketplaces/:marketplaceId', async (req, res) => {
    try {
      res.json(await manager.removeMarketplace(req.params.marketplaceId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/manager/marketplaces/:marketplaceId/catalog', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.fetchMarketplaceCatalog(req.params.marketplaceId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces/:marketplaceId/install', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.installFromMarketplace(req.params.marketplaceId, req.body?.extensionId, req.body?.version));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/capabilities', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getRoutingCapabilities());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions', async (_req, res) => {
    try {
      res.json(await runtime.listExtensions());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/catalog', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getWorkbenchCatalog());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/snapshots', express.json({ limit: '600kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      if (req.body?.form === 'html-artifact') {
        await artifactStore.materialize(req.body?.envelope);
      }
      const snapshot = await workbenchStore.writeSnapshot(req.body?.form, req.body?.envelope);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(snapshot);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/snapshots/:snapshotRef', async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.readSnapshot(req.params.snapshotRef));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/boards/:projectId', async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.read(req.params.projectId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      if (req.body?.tile?.source?.kind === 'agent-generated') {
        await workbenchStore.readSnapshot(req.body?.tile?.source?.snapshotRef);
      }
      const tile = await runtime.prepareWorkbenchTile(req.body?.tile);
      const result = await workbenchStore.upsertTile(req.params.projectId, req.body?.expectedRevision, tile);
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.updateTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
        req.body?.patch,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/workbench/boards/:projectId/layouts', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.updateTileLayouts(
        req.params.projectId,
        req.body?.expectedRevision,
        req.body?.layouts,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/migrate', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore || typeof runtime.migrateWorkbenchTile !== 'function') {
        throw new InteractiveUIRuntimeError('Extension Workbench migration is unavailable', 501, 'workbench_unsupported');
      }
      const current = await workbenchStore.read(req.params.projectId);
      const board = current.boards.find((candidate) => candidate.id === current.activeBoardId);
      const tile = board?.tiles.find((candidate) => candidate.tileId === req.params.tileId);
      if (!tile) {
        throw new InteractiveUIRuntimeError('Workbench tile was not found', 404, 'workbench_tile_not_found');
      }
      const migrated = await runtime.migrateWorkbenchTile(tile);
      const result = await workbenchStore.migrateTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
        migrated,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/replace-generated-snapshot', express.json({ limit: '600kb' }), async (req, res) => {
    try {
      if (!workbenchStore || typeof workbenchStore.replaceGeneratedTileSnapshot !== 'function') {
        throw new InteractiveUIRuntimeError('Extension Workbench snapshot replacement is unavailable', 501, 'workbench_unsupported');
      }
      if (!isRecord(req.body)
        || Object.keys(req.body).some((key) => !['expectedRevision', 'expectedSnapshotRef', 'form', 'envelope'].includes(key))
        || !['interactive-ui', 'html-artifact', 'mcp-app'].includes(req.body.form)
        || !isRecord(req.body.envelope)) {
        throw new InteractiveUIRuntimeError(
          'Workbench generated snapshot replacement body is invalid',
          400,
          'invalid_workbench_snapshot_replace',
        );
      }
      if (!Number.isInteger(req.body.expectedRevision) || req.body.expectedRevision < 0) {
        throw new InteractiveUIRuntimeError(
          'expectedRevision is required',
          400,
          'workbench_revision_required',
        );
      }
      if (req.body.expectedSnapshotRef === undefined) {
        throw new InteractiveUIRuntimeError(
          'expectedSnapshotRef is required',
          400,
          'workbench_snapshot_ref_required',
        );
      }
      if (typeof req.body.expectedSnapshotRef !== 'string'
        || !WORKBENCH_SNAPSHOT_REF_PATTERN.test(req.body.expectedSnapshotRef)) {
        throw new InteractiveUIRuntimeError(
          'expectedSnapshotRef is invalid',
          400,
          'workbench_snapshot_ref_invalid',
        );
      }
      if (req.body.form === 'html-artifact') {
        await artifactStore.materialize(req.body.envelope);
      }
      const result = await workbenchStore.replaceGeneratedTileSnapshot(
        req.params.projectId,
        req.params.tileId,
        req.body.expectedRevision,
        req.body.expectedSnapshotRef,
        req.body.form,
        req.body.envelope,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRuntimeError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.removeTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/connections', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.listConnections());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put('/api/interactive-ui/connections/:extensionId/:connectorId', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.configureConnection(req.params.extensionId, req.params.connectorId, req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/provision', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.provisionConnection(req.params.extensionId, req.params.connectorId, req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/test', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.testConnection(req.params.extensionId, req.params.connectorId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/connections/:extensionId/:connectorId', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.removeConnection(req.params.extensionId, req.params.connectorId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/views/:viewId', async (req, res) => {
    try {
      const tool = typeof req.query?.tool === 'string' ? req.query.tool : '';
      const launchSource = req.query?.launch === 'workbench' ? 'workbench' : 'tool';
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getViewDescriptor(req.params.viewId, tool, { launchSource }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/installed-artifacts/:artifactId', async (req, res) => {
    try {
      const tool = typeof req.query?.tool === 'string' ? req.query.tool : '';
      const launchSource = req.query?.launch === 'workbench' ? 'workbench' : 'tool';
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getInstalledArtifactDescriptor(req.params.artifactId, tool, { launchSource }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/icon', async (req, res) => {
    try {
      const icon = await runtime.getExtensionIcon(req.params.extensionId);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Type', icon.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(icon.content);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/artifacts/:artifactId', async (req, res) => {
    try {
      const artifact = await runtime.getInstalledArtifactDocument(req.params.extensionId, req.params.artifactId);
      setArtifactDocumentHeaders(res, true);
      res.setHeader('ETag', `"${artifact.integrity}"`);
      res.send(createArtifactBrokerDocument(artifact.source));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/native/:viewId', async (req, res) => {
    try {
      const bundle = await runtime.getNativeBundle(req.params.extensionId, req.params.viewId);
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('ETag', `"${bundle.integrity}"`);
      res.send(bundle.source);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/actions/:actionId', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.invokeAction(
        req.params.actionId,
        await authorizeWorkbenchAction(req.body),
      ));
    } catch (error) {
      sendError(res, error);
    }
  });
};
