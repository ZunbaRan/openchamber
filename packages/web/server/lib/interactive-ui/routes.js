import { InteractiveUIRuntimeError } from './runtime.js';

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
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0;background:transparent}</style></head><body data-ocix-artifact-broker><script>(()=>{"use strict";const frame=document.createElement("iframe"),pending=[];let channel="",loaded=false,loadCount=0,navigationBlocked=false;const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value)).byteLength}catch{return Infinity}};const record=value=>value&&typeof value==="object"&&!Array.isArray(value);const keys=value=>Object.keys(value).every(key=>["source","direction","bridgeVersion","channelId","sequence","type","payload"].includes(key));const validChannel=value=>typeof value==="string"&&value.length>=16&&value.length<=128;const hostMessage=value=>record(value)&&size(value)<=16384&&keys(value)&&value.source==="openchamber-host"&&value.direction==="host-to-artifact"&&value.bridgeVersion===1&&value.type==="host.init"&&validChannel(value.channelId);const artifactMessage=value=>record(value)&&size(value)<=8192&&keys(value)&&value.source==="openchamber-artifact"&&value.direction==="artifact-to-host"&&value.bridgeVersion===1&&value.channelId===channel;const reportNavigation=()=>{navigationBlocked=true;if(!channel)return;parent.postMessage({source:"openchamber-artifact-broker",direction:"broker-to-host",bridgeVersion:1,channelId:channel,type:"broker.navigationBlocked",payload:{}},"*")};addEventListener("message",event=>{const value=event.data;if(event.source===parent&&hostMessage(value)){channel=value.channelId;if(navigationBlocked){reportNavigation();return}if(loaded)frame.contentWindow?.postMessage(value,"*");else pending.splice(0,pending.length,value);return}if(event.source===frame.contentWindow&&artifactMessage(value))parent.postMessage(value,"*")});frame.title="Artifact content";frame.setAttribute("sandbox","allow-scripts");frame.src=${JSON.stringify(dataUrl)};frame.addEventListener("load",()=>{loadCount+=1;if(loadCount>1){frame.remove();reportNavigation();return}loaded=true;for(const message of pending.splice(0))frame.contentWindow?.postMessage(message,"*")});document.body.append(frame)})();</script></body></html>`;
};

const setArtifactDocumentHeaders = (res, scripts) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', scripts ? brokerContentSecurityPolicy() : staticArtifactContentSecurityPolicy());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
};

export const registerInteractiveUIRoutes = (app, { express, runtime, manager, artifactStore }) => {
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

  app.post('/api/interactive-ui/manager/extensions/:extensionId/rollback', async (req, res) => {
    try {
      res.json(await manager.rollback(req.params.extensionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/extensions/:extensionId', async (req, res) => {
    try {
      const result = await manager.uninstall(req.params.extensionId);
      try {
        const credentials = await runtime.removeExtensionConnections(req.params.extensionId);
        res.json({ ...result, credentials });
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
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getViewDescriptor(req.params.viewId, tool));
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
      res.json(await runtime.invokeAction(req.params.actionId, req.body));
    } catch (error) {
      sendError(res, error);
    }
  });
};
