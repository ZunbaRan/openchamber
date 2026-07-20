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

export const registerInteractiveUIRoutes = (app, { express, runtime, manager }) => {
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
      res.json(await manager.uninstall(req.params.extensionId));
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

  app.get('/api/interactive-ui/extensions', async (_req, res) => {
    try {
      res.json(await runtime.listExtensions());
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
