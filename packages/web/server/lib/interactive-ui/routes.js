import { validateRemoteAccessKey } from './connection-store.js';
import { isWorkbenchVersionCompatible } from './workbench-version.js';

class InteractiveUIRouteError extends Error {
  constructor(message, status = 400, code = 'invalid_request', details = undefined) {
    super(message);
    this.name = 'InteractiveUIRouteError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const WORKBENCH_SNAPSHOT_REF_PATTERN = /^snapshot_[a-f0-9]{64}$/;
const SAFE_REMOTE_CREDENTIAL_STATUS_RANGE = { min: 400, max: 599 };

// The connection store's summary is deliberately small. Keep this route
// boundary strict as well because a runtime adapter may return a richer
// object (or accidentally include credential material) than the store does.
const sanitizeCredentialSummary = (value) => {
  const source = isRecord(value) && isRecord(value.credential) ? value.credential : value;
  if (!isRecord(source)) return {};
  const summary = {};
  if (typeof source.configured === 'boolean') summary.configured = source.configured;
  if (typeof source.expired === 'boolean') summary.expired = source.expired;
  if (source.source === 'manual' || source.source === 'provisioned') summary.source = source.source;
  for (const field of ['configuredAt', 'expiresAt']) {
    if (typeof source[field] === 'string' && source[field].length <= 128 && !/[\r\n\0]/.test(source[field])) {
      summary[field] = source[field];
    }
  }
  for (const field of ['displayName', 'name']) {
    if (typeof source[field] === 'string' && source[field].length <= 200 && !/[\r\n\0]/.test(source[field])) {
      summary[field] = source[field];
    }
  }
  if (typeof source.endpoint === 'string' && source.endpoint.length <= 4096 && !/[\r\n\0]/.test(source.endpoint)) {
    summary.endpoint = source.endpoint;
  }
  if (Array.isArray(source.headerNames) && source.headerNames.length <= 32
    && source.headerNames.every((name) => typeof name === 'string' && name.length <= 64 && !/[\r\n\0]/.test(name))) {
    summary.headerNames = [...source.headerNames];
  }
  return summary;
};

const safeRemoteCredentialErrorStatus = (value) => (
  Number.isInteger(value)
    && value >= SAFE_REMOTE_CREDENTIAL_STATUS_RANGE.min
    && value <= SAFE_REMOTE_CREDENTIAL_STATUS_RANGE.max
    ? value
    : 502
);

const safeRemoteCredentialError = (error, recovery) => new InteractiveUIRouteError(
  'Remote credential configuration failed',
  safeRemoteCredentialErrorStatus(error?.status),
  'remote_credential_configure_failed',
  recovery,
);

// Serializes cross-subsystem Interactive UI connection mutations: the ENTIRE
// Remote connect transaction (Manager install, Secret Store configuration,
// conditional cleanup, Manager/trust rollback), extension uninstall including
// credential/workbench cleanup, generic connection PUT, issued-key provision,
// and generic connection DELETE. Read-only inspect/list/test/action routes do
// not use it. The chain always advances after completion or failure, so a
// failed operation can never poison later ones; responses are sent only after
// the whole operation (including rollback) has finished.
//
// Coordinators are scoped per manager instance (WeakMap keyed by the manager
// object): two route registrations sharing the same manager serialize, but
// unrelated manager/runtime/data-directory instances never block one another.
const createMutationCoordinator = () => {
  let tail = Promise.resolve();
  const runExclusive = (operation) => {
    const pending = tail.then(operation, operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  return { runExclusive };
};
const coordinatorByManager = new WeakMap();
const coordinatorFor = (manager) => {
  let coordinator = coordinatorByManager.get(manager);
  if (!coordinator) {
    coordinator = createMutationCoordinator();
    coordinatorByManager.set(manager, coordinator);
  }
  return coordinator;
};

const sendError = (res, error) => {
  if (error instanceof InteractiveUIRouteError || (Number.isInteger(error?.status) && typeof error?.code === 'string')) {
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
}) => {
  // The target server installs its scope-aware `/api` gate before feature
  // routes. Do not add a UI-only second gate here: tunnel requests must remain
  // under tunnel auth, while local requests remain under UI auth.

  const authorizeWorkbenchAction = async (request) => {
    if (!isRecord(request)) return request;
    const {
      __workbenchAuthorization: _untrustedAuthorization,
      ...cleanRequest
    } = request;
    if (!isRecord(request.workbench)) return cleanRequest;
    if (!workbenchStore) {
      throw new InteractiveUIRouteError(
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
      throw new InteractiveUIRouteError(
        'Workbench action context is incomplete',
        400,
        'invalid_workbench_action',
      );
    }
    const snapshot = await workbenchStore.read(projectId);
    const board = snapshot.boards.find((candidate) => candidate.id === snapshot.activeBoardId);
    const tile = board?.tiles.find((candidate) => candidate.tileId === tileId);
    if (!tile) {
      throw new InteractiveUIRouteError(
        'Workbench tile was not found',
        404,
        'workbench_tile_not_found',
      );
    }
    if (tile.source.kind !== 'third-party-extension') {
      throw new InteractiveUIRouteError(
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
      throw new InteractiveUIRouteError(
        'Workbench tile does not own this action surface',
        403,
        'workbench_surface_mismatch',
      );
    }
    if ((request.viewId && tile.form !== 'interactive-ui')
      || (request.artifactId && tile.form !== 'html-artifact')) {
      throw new InteractiveUIRouteError(
        'Workbench tile form does not match the requested action',
        403,
        'workbench_form_mismatch',
      );
    }
    const catalog = await runtime.getWorkbenchCatalog();
    const extension = catalog.extensions.find((candidate) => candidate.id === tile.source.extensionId);
    const surface = extension?.surfaces.find((candidate) => candidate.surfaceId === tile.source.surfaceId);
    if (!extension || !surface) {
      throw new InteractiveUIRouteError(
        'Workbench extension or surface is disabled or unavailable',
        409,
        'workbench_surface_unavailable',
      );
    }
    if (!isWorkbenchVersionCompatible(tile.source.compatibleVersion, extension.version)) {
      throw new InteractiveUIRouteError(
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
      throw new InteractiveUIRouteError(
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

  // Keep only the exact official OpenCode session DELETE request on the generic
  // proxy; nested session resources must never release Artifact references.
  // Cleanup runs only after that authoritative request succeeds, and failure is
  // conservative: stale cache may remain, but another session's Artifact is
  // never deleted on an unconfirmed session mutation.
  app.delete('/api/session/:sessionId', (req, res, next) => {
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

  app.post('/api/interactive-ui/manager/remote/inspect', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.inspectRemote(req.body?.appEntryUrl));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/remote/connect', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!isRecord(req.body)) {
        const error = new Error('Remote connect body is invalid');
        error.code = 'remote_connect_body_invalid';
        error.status = 400;
        throw error;
      }
      // Validate the opaque Access Key with the shared Remote validator BEFORE
      // entering manager.connectRemote — before any trust, staging, Manager
      // state, Agent Runtime, or Secret Store write. The validator preserves
      // the exact string byte-for-byte (leading/trailing spaces are valid
      // credential material and are never trimmed); this exact value is the
      // only one captured by the coordinated transaction and forwarded to
      // runtime.configureRemoteConnection.
      const accessKey = validateRemoteAccessKey(req.body.accessKey);
      // The whole transaction (Manager install + Secret Store configuration +
      // conditional cleanup + Manager/trust rollback) runs under the mutation
      // coordinator so no other connection mutation can interleave.
      const outcome = await coordinatorFor(manager).runExclusive(async () => {
        const connected = await manager.connectRemote({
          appEntryUrl: req.body.appEntryUrl,
          confirmedPublisherFingerprint: req.body.confirmedPublisherFingerprint,
          confirmedManifestHash: req.body.confirmedManifestHash,
        }, runtime);
        // The route uses ONLY the opaque manager-owned capability bound to
        // this exact installation AND this exact runtime (configure/remove/
        // rollback operations with zero redirection); raw installationId/
        // trustAdded are never destructured, passed, or serialized.
        try {
          const credential = await connected.capability.configureCredential(accessKey);
          return {
            status: 201,
            body: {
              extension: connected.extension,
              connector: connected.connector,
              credential: sanitizeCredentialSummary(credential),
            },
          };
        } catch (error) {
          // Failure-atomic for the newly connected extension, bound to THIS
          // connect's installation identity: conditionally remove only that
          // installation's credential, then uninstall the new shell, and drop
          // the publisher trust only when this operation added it and no other
          // installed version uses it. The original error is preserved and only
          // sanitized recovery details are added; the installation id and the
          // access key never appear in the response or logs.
          const recovery = { credentialRemoved: false, extensionRemoved: false, trustRolledBack: false };
          let credentialCleanupSafe = false;
          try {
            const removed = await connected.capability.removeCredential();
            if (removed?.removed === true) {
              recovery.credentialRemoved = true;
              credentialCleanupSafe = true;
            } else if (removed?.removed === false && removed?.mismatch !== true) {
              // An explicit clean absence is safe: this connect did not leave
              // a credential behind, so deleting only its new shell is safe.
              credentialCleanupSafe = true;
            } else if (removed?.mismatch === true) {
              recovery.credentialMismatch = true;
            } else {
              recovery.credentialRollbackBlocked = true;
            }
          } catch {
            recovery.credentialRollbackError = 'remote_credential_rollback_failed';
          }
          if (credentialCleanupSafe) {
            try {
              const rollback = await connected.capability.rollback();
              recovery.extensionRemoved = rollback?.removed === true;
              recovery.trustRolledBack = rollback?.trustRolledBack === true;
            } catch {
              recovery.rollbackError = 'remote_rollback_failed';
            }
          } else {
            recovery.rollbackSkipped = true;
          }
          throw safeRemoteCredentialError(error, recovery);
        }
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(outcome.status).json(outcome.body);
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

  app.post('/api/interactive-ui/manager/extensions/:extensionId/remote/update-check', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.checkRemoteUpdate(req.params.extensionId, {
        force: req.body?.force === true,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/remote/update-apply', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.applyRemoteUpdate(req.params.extensionId, {
        confirmedManifestHash: req.body?.confirmedManifestHash,
        confirmedPublisherFingerprint: req.body?.confirmedPublisherFingerprint,
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
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.getExtensionTileImpact(req.params.extensionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/extensions/:extensionId', async (req, res) => {
    try {
      // Uninstall (credential/workbench cleanup + shell removal) is a
      // cross-subsystem mutation and runs under the manager-scoped coordinator
      // so it cannot interleave with a Remote connect transaction. ALL
      // fallible external cleanup runs FIRST while the shell still exists, so
      // any remaining secret still has an owner; manager.uninstall is only
      // called after cleanup succeeds.
      const outcome = await coordinatorFor(manager).runExclusive(async () => {
        if (!workbenchStore) {
          throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
        }
        const credentials = await runtime.removeExtensionConnections(req.params.extensionId);
        const workbench = await workbenchStore.removeExtensionTiles(req.params.extensionId);
        const result = await manager.uninstall(req.params.extensionId);
        return {
          ...result,
          credentials,
          workbench,
        };
      });
      res.json(outcome);
    } catch (error) {
      // Cleanup or uninstall failure leaves the managed extension installed
      // (manager.uninstall restores from trash on its own failure), so the
      // response never claims extension removal.
      error.details = { ...(error.details ?? {}), extensionRemoved: false };
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
        throw new InteractiveUIRouteError('Extension Workbench migration is unavailable', 501, 'workbench_unsupported');
      }
      const current = await workbenchStore.read(req.params.projectId);
      const board = current.boards.find((candidate) => candidate.id === current.activeBoardId);
      const tile = board?.tiles.find((candidate) => candidate.tileId === req.params.tileId);
      if (!tile) {
        throw new InteractiveUIRouteError('Workbench tile was not found', 404, 'workbench_tile_not_found');
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
        throw new InteractiveUIRouteError('Extension Workbench snapshot replacement is unavailable', 501, 'workbench_unsupported');
      }
      if (!isRecord(req.body)
        || Object.keys(req.body).some((key) => !['expectedRevision', 'expectedSnapshotRef', 'form', 'envelope'].includes(key))
        || !['interactive-ui', 'html-artifact', 'mcp-app'].includes(req.body.form)
        || !isRecord(req.body.envelope)) {
        throw new InteractiveUIRouteError(
          'Workbench generated snapshot replacement body is invalid',
          400,
          'invalid_workbench_snapshot_replace',
        );
      }
      if (!Number.isInteger(req.body.expectedRevision) || req.body.expectedRevision < 0) {
        throw new InteractiveUIRouteError(
          'expectedRevision is required',
          400,
          'workbench_revision_required',
        );
      }
      if (req.body.expectedSnapshotRef === undefined) {
        throw new InteractiveUIRouteError(
          'expectedSnapshotRef is required',
          400,
          'workbench_snapshot_ref_required',
        );
      }
      if (typeof req.body.expectedSnapshotRef !== 'string'
        || !WORKBENCH_SNAPSHOT_REF_PATTERN.test(req.body.expectedSnapshotRef)) {
        throw new InteractiveUIRouteError(
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
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
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
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.configureConnection(req.params.extensionId, req.params.connectorId, req.body)
      ));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/provision', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.provisionConnection(req.params.extensionId, req.params.connectorId, req.body)
      ));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/test', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      // Manual health always uses force (bypasses a settled TTL entry while
      // still joining an in-flight probe). An optional update check also runs
      // forced and contributes a safe update result when the extension is a
      // Remote app; the response may include it.
      const health = await runtime.testConnection(req.params.extensionId, req.params.connectorId, { force: true });
      if (req.body?.checkForUpdates !== true) {
        res.json(health);
        return;
      }
      let update = null;
      try {
        update = await manager.checkRemoteUpdate(req.params.extensionId, { force: true });
      } catch (error) {
        if (error?.code !== 'remote_extension_required' && error?.code !== 'extension_not_found') throw error;
      }
      res.json(update ? { ...health, update } : health);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/connections/:extensionId/:connectorId', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.removeConnection(req.params.extensionId, req.params.connectorId)
      ));
      res.json(result);
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
