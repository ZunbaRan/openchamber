import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHTMLArtifactStore, HTMLArtifactError } from './artifact-store.js';

const temporaryDirectories = [];
const createStore = async (environment = {}) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-'));
  temporaryDirectories.push(dataDirectory);
  return createHTMLArtifactStore({ dataDirectory, fsImpl: fs, pathImpl: path, cryptoImpl: crypto, environment });
};
const envelope = (overrides = {}) => ({
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Topology',
  summary: 'Static SVG fixture',
  html: '<!doctype html><html><body><svg aria-label="topology"></svg></body></html>',
  capabilities: { scripts: false },
  display: { preferred: 'inline', allowExpand: true, inlineHeight: 420 },
  ...overrides,
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('HTML Artifact store', () => {
  test('materializes immutable content, deduplicates it, and reads it back', async () => {
    const store = await createStore();
    const first = await store.materialize(envelope());
    const second = await store.materialize(envelope());
    expect(first.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.cacheHit).toBe(false);
    expect(second).toMatchObject({ artifactId: first.artifactId, cacheHit: true });
    expect(await store.getDocument(first.artifactId)).toMatchObject({
      metadata: { scripts: false, cspRevision: 3 },
    });
    const firstDocument = await store.getDocument(first.artifactId);
    expect(firstDocument.html).toContain('data-openchamber-artifact-base');
    expect(firstDocument.html).toContain('background:transparent!important');
  });

  test('deduplicates identical executable content while preserving per-message display metadata', async () => {
    const store = await createStore();
    const first = await store.materialize(envelope({ updatedAt: '2026-07-20T00:00:00.000Z' }));
    const second = await store.materialize(envelope({
      title: 'A different host title',
      updatedAt: '2026-07-21T00:00:00.000Z',
      display: { preferred: 'fullscreen', allowExpand: false, inlineHeight: 700 },
    }));
    expect(second).toMatchObject({
      artifactId: first.artifactId,
      cacheHit: true,
      preferred: 'fullscreen',
      allowExpand: false,
      inlineHeight: 700,
    });
  });

  test('reports the current response CSP revision for an existing cache entry', async () => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-legacy-csp-'));
    temporaryDirectories.push(dataDirectory);
    const store = createHTMLArtifactStore({ dataDirectory, fsImpl: fs, pathImpl: path, cryptoImpl: crypto });
    const materialized = await store.materialize(envelope());
    const metadataPath = path.join(dataDirectory, 'interactive-ui', 'artifacts', materialized.artifactId, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    await fs.writeFile(metadataPath, `${JSON.stringify({ ...metadata, cspRevision: 1 })}\n`, 'utf8');

    expect(await store.getMetadata(materialized.artifactId)).toMatchObject({
      artifactId: materialized.artifactId,
      cspRevision: 3,
    });
  });

  test('rebuilds missing or corrupt cached files from the authoritative envelope', async () => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-rebuild-'));
    temporaryDirectories.push(dataDirectory);
    const store = createHTMLArtifactStore({ dataDirectory, fsImpl: fs, pathImpl: path, cryptoImpl: crypto });
    const first = await store.materialize(envelope());
    const artifactDirectory = path.join(dataDirectory, 'interactive-ui', 'artifacts', first.artifactId);

    await fs.rm(path.join(artifactDirectory, 'document.html'));
    const rebuiltMissingDocument = await store.materialize(envelope());
    expect(rebuiltMissingDocument).toMatchObject({
      artifactId: first.artifactId,
      cacheHit: false,
      cacheRebuilt: true,
    });
    expect((await store.getDocument(first.artifactId)).html).toContain('data-openchamber-artifact-base');

    await fs.writeFile(path.join(artifactDirectory, 'metadata.json'), '{broken', 'utf8');
    const rebuiltCorruptMetadata = await store.materialize(envelope());
    expect(rebuiltCorruptMetadata).toMatchObject({
      artifactId: first.artifactId,
      cacheHit: false,
      cacheRebuilt: true,
    });
    expect((await store.getDocument(first.artifactId)).html).toContain('data-openchamber-artifact-base');
  });

  test('rejects unknown fields and scripts when the capability is disabled', async () => {
    const store = await createStore();
    await expect(store.materialize(envelope({ network: true }))).rejects.toMatchObject({ code: 'invalid_artifact_contract' });
    await expect(store.materialize(envelope({ capabilities: { scripts: true } }))).rejects.toMatchObject({
      code: 'artifact_scripts_unsupported',
      status: 409,
    });
  });

  test('allows scripts only through the explicit runtime gate', async () => {
    const store = await createStore({ OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true' });
    const result = await store.materialize(envelope({ capabilities: { scripts: true } }));
    expect(result.scripts).toBe(true);
    expect(store.getCapabilities()).toEqual({
      schemaVersion: 1,
      static: true,
      scripts: true,
      scriptsMode: 'experimental',
      cspRevision: 3,
      runtimeSupport: {
        web: { static: 'supported', scripts: 'experimental' },
        managedDesktop: { static: 'supported', scripts: 'experimental' },
        hostedMobile: { static: 'supported', scripts: 'unsupported' },
        capacitorMobile: { static: 'supported', scripts: 'unsupported' },
        vscode: { static: 'unsupported', scripts: 'unsupported' },
        e2eeRelay: { static: 'unsupported', scripts: 'unsupported' },
      },
    });
    const document = await store.getDocument(result.artifactId);
    expect(document.html).toContain('openchamberArtifact');
    expect(document.html).toContain('artifact.resize');
  });

  test('reports scripts as unsupported unless the explicit experimental gate is enabled', async () => {
    const store = await createStore();
    expect(store.getCapabilities()).toEqual({
      schemaVersion: 1,
      static: true,
      scripts: false,
      scriptsMode: 'unsupported',
      cspRevision: 3,
      runtimeSupport: {
        web: { static: 'supported', scripts: 'unsupported' },
        managedDesktop: { static: 'supported', scripts: 'unsupported' },
        hostedMobile: { static: 'supported', scripts: 'unsupported' },
        capacitorMobile: { static: 'supported', scripts: 'unsupported' },
        vscode: { static: 'unsupported', scripts: 'unsupported' },
        e2eeRelay: { static: 'unsupported', scripts: 'unsupported' },
      },
    });
  });

  test('kill switch blocks cached scripts without deleting static content', async () => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-kill-switch-'));
    temporaryDirectories.push(dataDirectory);
    const enabledStore = createHTMLArtifactStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      environment: { OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true' },
    });
    const staticArtifact = await enabledStore.materialize(envelope());
    const interactiveArtifact = await enabledStore.materialize(envelope({
      html: '<!doctype html><html><body><script>document.body.dataset.ready="true"</script></body></html>',
      capabilities: { scripts: true },
    }));

    const disabledStore = createHTMLArtifactStore({ dataDirectory, fsImpl: fs, pathImpl: path, cryptoImpl: crypto });
    expect((await disabledStore.getDocument(staticArtifact.artifactId)).html).toContain('data-openchamber-artifact-base');
    await expect(disabledStore.getDocument(interactiveArtifact.artifactId)).rejects.toMatchObject({
      code: 'artifact_scripts_unsupported',
      status: 409,
      details: { staticAvailable: true },
    });
    await expect(disabledStore.materialize(envelope({
      html: '<!doctype html><html><body><script>document.body.dataset.ready="true"</script></body></html>',
      capabilities: { scripts: true },
    }))).rejects.toMatchObject({ code: 'artifact_scripts_unsupported' });
  });

  test('rejects prohibited markup, remote resources, network primitives and oversized DOMs', async () => {
    const store = await createStore({ OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true' });
    for (const html of [
      '<form><input></form>',
      '<iframe></iframe>',
      '<object></object>',
      '<embed>',
      '<base href="/">',
      '<link rel="stylesheet" href="/theme.css">',
      '<meta http-equiv="refresh" content="0;url=/next">',
    ]) {
      await expect(store.materialize(envelope({ html }))).rejects.toMatchObject({ code: 'prohibited_artifact_markup' });
    }
    for (const html of [
      '<img src="https://example.com/pixel.png">',
      '<a href="//example.com">remote</a>',
      '<style>body{background:url(https://example.com/pixel.png)}</style>',
    ]) {
      await expect(store.materialize(envelope({ html }))).rejects.toMatchObject({ code: 'remote_artifact_resource' });
    }
    for (const html of [
      '<a href="javascript:alert(1)">unsafe</a>',
      '<a href="data:text/html,unsafe">unsafe</a>',
      '<a href="/next">relative</a>',
      '<a href="next">relative</a>',
      '<area href=/next>',
      '<svg><a xlink:href="/next"><text>next</text></a></svg>',
    ]) {
      await expect(store.materialize(envelope({ html }))).rejects.toMatchObject({ code: 'prohibited_artifact_navigation' });
    }
    await expect(store.materialize(envelope({
      html: '<svg><defs><path id="mark" d="M0 0h1v1z" /></defs><use href="#mark" /></svg>',
    }))).resolves.toMatchObject({ scripts: false });
    await expect(store.materialize(envelope({ html: '<button onclick="alert(1)">unsafe</button>' }))).rejects.toMatchObject({
      code: 'static_artifact_contains_event_handler',
    });
    for (const source of [
      'fetch("/api")',
      'new XMLHttpRequest()',
      'new WebSocket("ws://localhost")',
      'new EventSource("/events")',
      'new Worker("worker.js")',
      'WebAssembly.compile(new Uint8Array())',
      'navigator.sendBeacon("/event")',
      'navigator.serviceWorker.register("/sw.js")',
      'eval("1")',
      'new Function("return 1")',
    ]) {
      await expect(store.materialize(envelope({
        html: `<script>${source}</script>`,
        capabilities: { scripts: true },
      }))).rejects.toMatchObject({ code: 'prohibited_artifact_capability' });
    }
    await expect(store.materialize(envelope({
      html: '<script src="local.js"></script>',
      capabilities: { scripts: true },
    }))).rejects.toMatchObject({ code: 'prohibited_artifact_capability' });
    await expect(store.materialize(envelope({ html: '<i></i>'.repeat(4_001) }))).rejects.toMatchObject({
      code: 'artifact_dom_too_large',
    });
  });

  test('reports cleared cache as rematerializable from history', async () => {
    const store = await createStore();
    const result = await store.materialize(envelope());
    expect(await store.clear()).toEqual({ cleared: true, rematerializableFromHistory: true });
    await expect(store.getDocument(result.artifactId)).rejects.toBeInstanceOf(HTMLArtifactError);
    const rebuilt = await store.materialize(envelope());
    expect(rebuilt.artifactId).toBe(result.artifactId);
  });

  test('releases content only after the final referencing session is deleted', async () => {
    const store = await createStore();
    const first = await store.materialize(envelope(), { sessionId: 'ses_first' });
    const second = await store.materialize(envelope(), { sessionId: 'ses_second' });
    expect(first.sessionReferenceTracked).toBe(true);
    expect(second).toMatchObject({ artifactId: first.artifactId, cacheHit: true, sessionReferenceTracked: true });

    expect(await store.releaseSession('ses_first')).toEqual({
      released: true,
      removedArtifacts: 0,
      retainedArtifacts: 1,
    });
    expect((await store.getDocument(first.artifactId)).html).toContain('data-openchamber-artifact-base');

    expect(await store.releaseSession('ses_second')).toEqual({
      released: true,
      removedArtifacts: 1,
      retainedArtifacts: 0,
    });
    await expect(store.getDocument(first.artifactId)).rejects.toMatchObject({ code: 'artifact_not_found' });
    expect(await store.releaseSession('ses_second')).toEqual({
      released: true,
      removedArtifacts: 0,
      retainedArtifacts: 0,
    });
  });

  test('fails closed when another session reference is corrupt', async () => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-reference-'));
    temporaryDirectories.push(dataDirectory);
    const store = createHTMLArtifactStore({ dataDirectory, fsImpl: fs, pathImpl: path, cryptoImpl: crypto });
    const materialized = await store.materialize(envelope(), { sessionId: 'ses_target' });
    const referencesDirectory = path.join(dataDirectory, 'interactive-ui', 'artifacts', 'references');
    await fs.writeFile(path.join(referencesDirectory, 'corrupt.json'), '{broken', 'utf8');

    await expect(store.releaseSession('ses_target')).rejects.toMatchObject({ code: 'artifact_reference_corrupt' });
    expect((await store.getDocument(materialized.artifactId)).html).toContain('data-openchamber-artifact-base');
  });
});
