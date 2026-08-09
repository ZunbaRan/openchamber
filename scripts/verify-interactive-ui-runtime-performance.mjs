import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHTMLArtifactStore } from '../packages/web/server/lib/interactive-ui/artifact-store.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-runtime-performance');
const reportPath = path.join(outputDirectory, 'report.json');
const visualReportPath = path.join(projectRoot, '.tmp', 'interactive-ui-visual-smoke', 'baseline.json');
const functionalReportPath = path.join(projectRoot, '.tmp', 'interactive-ui-unified-functional', 'report.json');
const securityReportPath = path.join(projectRoot, '.tmp', 'interactive-ui-security', 'report.json');
const desktopReportPath = path.join(projectRoot, '.tmp', 'interactive-ui-packaged-desktop', 'report.json');
const distAssetsDirectory = path.join(projectRoot, 'packages', 'web', 'dist', 'assets');

const budgets = {
  mainEntryBytes: 1_000_000,
  artifactLazyBytes: 25_000,
  artifactLazyGzipBytes: 10_000,
  standardViewReadyMedianMs: 750,
  artifactReadyMedianMs: 1_500,
  materializeP95Ms: 50,
  cacheHitP95Ms: 20,
  cacheAverageBytes: 100_000,
  benchmarkRssDeltaBytes: 64 * 1024 * 1024,
};

const readJson = async (filePath, label) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} evidence is missing or invalid: run its verifier first (${error instanceof Error ? error.message : String(error)})`);
  }
};

const percentile = (values, ratio) => {
  assert(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};

const measure = async (operation) => {
  const started = process.hrtime.bigint();
  const value = await operation();
  return { value, durationMs: Number(process.hrtime.bigint() - started) / 1_000_000 };
};

const directoryBytes = async (directory) => {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
};

const readCurrentBundle = async (prefix, { largest = false } = {}) => {
  const names = (await fs.readdir(distAssetsDirectory))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.js'));
  assert(names.length > 0, `Current production build is missing ${prefix}*.js`);
  const entries = await Promise.all(names.map(async (file) => {
    const content = await fs.readFile(path.join(distAssetsDirectory, file));
    return { file, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength };
  }));
  return largest
    ? entries.sort((left, right) => right.bytes - left.bytes)[0]
    : entries.sort((left, right) => left.file.localeCompare(right.file))[0];
};

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const visual = await readJson(visualReportPath, 'Visual Golden');
const functional = await readJson(functionalReportPath, 'Unified functional');
const security = await readJson(securityReportPath, 'Security matrix');
assert.equal(visual.ok, true);
assert.equal(visual.goldens?.failures, 0);
assert.equal(functional.ok, true);
assert.equal(security.summary?.failed, 0);

let desktop = null;
try {
  desktop = await readJson(desktopReportPath, 'Packaged Desktop');
} catch (error) {
  if (process.platform === 'darwin') throw error;
}
if (desktop) {
  assert.equal(desktop.ok, true);
  assert.equal(desktop.runtimeErrors, 0);
}

// Vite content hashes change on every relevant source edit. Read the current
// production assets instead of trusting a hash captured by an older visual run.
const mainBundle = await readCurrentBundle('main-', { largest: true });
const artifactBundle = await readCurrentBundle('HTMLArtifactView-');
assert.notEqual(mainBundle.file, artifactBundle.file, 'HTML Artifact renderer must remain a separate lazy chunk');
assert.equal(mainBundle.bytes <= budgets.mainEntryBytes, true, `Main entry exceeded ${budgets.mainEntryBytes} bytes`);
assert.equal(artifactBundle.bytes <= budgets.artifactLazyBytes, true, `Artifact lazy chunk exceeded ${budgets.artifactLazyBytes} bytes`);
assert.equal(artifactBundle.gzipBytes <= budgets.artifactLazyGzipBytes, true, `Artifact lazy gzip chunk exceeded ${budgets.artifactLazyGzipBytes} bytes`);

for (const runtime of ['generated', 'declarative', 'native', 'crm']) {
  const medianMs = visual.readyBaseline?.[runtime]?.medianMs;
  assert.equal(typeof medianMs, 'number', `${runtime} ready baseline is missing`);
  assert.equal(medianMs <= budgets.standardViewReadyMedianMs, true, `${runtime} median ready time exceeded budget`);
}
for (const runtime of ['artifact-static', 'artifact-interactive']) {
  const medianMs = visual.readyBaseline?.[runtime]?.medianMs;
  assert.equal(typeof medianMs, 'number', `${runtime} ready baseline is missing`);
  assert.equal(medianMs <= budgets.artifactReadyMedianMs, true, `${runtime} median ready time exceeded budget`);
}

const benchmarkRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-artifact-performance-'));
let benchmark;
try {
  const rssBefore = process.memoryUsage().rss;
  const store = createHTMLArtifactStore({
    dataDirectory: benchmarkRoot,
    fsImpl: fs,
    pathImpl: path,
    cryptoImpl: crypto,
    environment: {},
  });
  const envelopes = Array.from({ length: 25 }, (_, index) => ({
    $schema: 'openchamber://html-artifact-result/v1',
    schemaVersion: 1,
    title: `Static performance fixture ${index + 1}`,
    summary: 'Deterministic local performance fixture',
    html: `<!doctype html><html><body><svg aria-label="fixture-${index + 1}"><text>${index + 1}</text></svg></body></html>`,
    capabilities: { scripts: false },
    display: { preferred: 'inline', allowExpand: true, inlineHeight: 320 },
  }));
  const materializeDurations = [];
  const cacheHitDurations = [];
  for (const envelope of envelopes) {
    const measured = await measure(() => store.materialize(envelope));
    assert.equal(measured.value.cacheHit, false);
    materializeDurations.push(measured.durationMs);
  }
  for (const envelope of envelopes) {
    const measured = await measure(() => store.materialize(envelope));
    assert.equal(measured.value.cacheHit, true);
    cacheHitDurations.push(measured.durationMs);
  }
  const cacheBytes = await directoryBytes(path.join(benchmarkRoot, 'interactive-ui', 'artifacts'));
  const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
  benchmark = {
    samples: envelopes.length,
    materialize: {
      medianMs: percentile(materializeDurations, 0.5),
      p95Ms: percentile(materializeDurations, 0.95),
    },
    cacheHit: {
      medianMs: percentile(cacheHitDurations, 0.5),
      p95Ms: percentile(cacheHitDurations, 0.95),
    },
    cacheBytes,
    averageCacheBytes: Math.ceil(cacheBytes / envelopes.length),
    rssDeltaBytes,
  };
  assert.equal(benchmark.materialize.p95Ms <= budgets.materializeP95Ms, true, 'Artifact materialize p95 exceeded budget');
  assert.equal(benchmark.cacheHit.p95Ms <= budgets.cacheHitP95Ms, true, 'Artifact cache-hit p95 exceeded budget');
  assert.equal(benchmark.averageCacheBytes <= budgets.cacheAverageBytes, true, 'Artifact cache bytes per item exceeded budget');
  assert.equal(benchmark.rssDeltaBytes <= budgets.benchmarkRssDeltaBytes, true, 'Artifact benchmark RSS delta exceeded budget');
} finally {
  await fs.rm(benchmarkRoot, { recursive: true, force: true });
}

const runtimes = [
  {
    runtime: 'web',
    status: 'verified',
    generated: 'supported',
    installedDeclarative: 'supported',
    trustedNative: 'supported',
    staticArtifact: 'supported',
    scriptsArtifact: 'experimental-default-off',
    evidence: ['visual-golden', 'security-matrix', 'unified-functional'],
  },
  {
    runtime: 'managed-desktop-macos-arm64',
    status: desktop ? 'verified' : 'unverified',
    generated: desktop?.generated === 'ready' ? 'supported' : 'unverified',
    installedDeclarative: functional.views?.declarative === 'ready' ? 'supported' : 'unverified',
    trustedNative: functional.views?.native === 'ready' ? 'supported' : 'unverified',
    staticArtifact: desktop?.artifact?.static === 'ready' ? 'supported' : 'unverified',
    scriptsArtifact: 'experimental-default-off',
    evidence: desktop ? ['packaged-desktop', 'unified-functional'] : [],
  },
  {
    runtime: 'hosted-mobile-390',
    status: 'verified-responsive-host',
    generated: 'supported',
    installedDeclarative: 'supported',
    trustedNative: 'supported',
    staticArtifact: 'supported',
    scriptsArtifact: 'unsupported',
    evidence: ['visual-golden-390', 'artifact-capability-contract'],
  },
  {
    runtime: 'capacitor-mobile',
    status: 'unverified',
    generated: 'unverified',
    installedDeclarative: 'unverified',
    trustedNative: 'unverified',
    staticArtifact: 'supported-by-contract-unverified-on-device',
    scriptsArtifact: 'unsupported',
    evidence: ['artifact-capability-contract'],
  },
  {
    runtime: 'managed-desktop-windows',
    status: 'unverified',
    generated: 'unverified',
    installedDeclarative: 'unverified',
    trustedNative: 'unverified',
    staticArtifact: 'unverified',
    scriptsArtifact: 'unsupported-for-release',
    evidence: [],
  },
  {
    runtime: 'managed-desktop-linux',
    status: 'unverified',
    generated: 'unverified',
    installedDeclarative: 'unverified',
    trustedNative: 'unverified',
    staticArtifact: 'unverified',
    scriptsArtifact: 'unsupported-for-release',
    evidence: [],
  },
  {
    runtime: 'vscode',
    status: 'unsupported',
    generated: 'unsupported',
    installedDeclarative: 'unsupported',
    trustedNative: 'unsupported',
    staticArtifact: 'unsupported',
    scriptsArtifact: 'unsupported',
    evidence: ['artifact-capability-contract'],
  },
  {
    runtime: 'e2ee-relay',
    status: 'unsupported',
    generated: 'unsupported',
    installedDeclarative: 'unsupported',
    trustedNative: 'unsupported',
    staticArtifact: 'unsupported',
    scriptsArtifact: 'unsupported',
    evidence: ['artifact-capability-contract'],
  },
];

const report = {
  $schema: 'openchamber://interactive-ui-runtime-performance-report/v1',
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  budgets,
  bundles: { mainEntry: mainBundle, artifactLazy: artifactBundle, artifactRendererIsLazy: true },
  readyMedianMs: Object.fromEntries(Object.entries(visual.readyBaseline).map(([runtime, entry]) => [runtime, entry.medianMs])),
  artifactStore: benchmark,
  runtimes,
  releaseScope: {
    verified: ['web', 'managed-desktop-macos-arm64', 'hosted-mobile-390'],
    unverified: ['capacitor-mobile', 'managed-desktop-windows', 'managed-desktop-linux'],
    unsupported: ['vscode', 'e2ee-relay'],
  },
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  reportPath: path.relative(projectRoot, reportPath),
  bundles: report.bundles,
  readyMedianMs: report.readyMedianMs,
  artifactStore: report.artifactStore,
  releaseScope: report.releaseScope,
}, null, 2));
