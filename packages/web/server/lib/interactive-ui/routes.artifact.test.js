import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createHTMLArtifactStore } from './artifact-store.js';
import { registerInteractiveUIRoutes } from './routes.js';

const temporaryDirectories = [];
const envelope = (scripts = false) => ({
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Artifact fixture',
  html: '<!doctype html><html><body><svg aria-label="fixture"></svg></body></html>',
  capabilities: { scripts },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 360 },
});

const createApp = async (environment = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-routes-'));
  temporaryDirectories.push(dataDirectory);
  const app = express();
  registerInteractiveUIRoutes(app, {
    express,
    runtime: {},
    manager: {},
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
    const encodedArtifact = document.text.match(/data:text\/html;base64,([A-Za-z0-9+/=]+)/)?.[1];
    expect(encodedArtifact).toBeTruthy();
    const innerDocument = Buffer.from(encodedArtifact, 'base64').toString('utf8');
    expect(innerDocument).toContain('openchamberArtifact');
    expect(innerDocument).toContain("frame-src 'none'");
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
});
