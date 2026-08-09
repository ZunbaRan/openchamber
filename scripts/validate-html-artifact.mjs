import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHTMLArtifactStore } from '../packages/web/server/lib/interactive-ui/artifact-store.js';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: bun run validate:html-artifact -- <artifact-envelope.json>');
  process.exitCode = 2;
} else {
  let temporaryDirectory;
  try {
    const absolutePath = path.resolve(sourcePath);
    const envelope = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-validator-'));
    const store = createHTMLArtifactStore({
      dataDirectory: temporaryDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      environment: {
        OPENCHAMBER_HTML_ARTIFACTS_STATIC: 'true',
        OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS: 'true',
      },
    });
    const result = await store.materialize(envelope);
    console.log(JSON.stringify({
      ok: true,
      artifactId: result.artifactId,
      scripts: result.scripts,
      documentBytes: result.documentBytes,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'artifact_validation_failed',
      message: error instanceof Error ? error.message : 'Artifact validation failed',
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
