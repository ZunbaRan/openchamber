import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-unified-acceptance');
const outputPath = path.join(outputDirectory, 'report.json');

const reportPaths = {
  workbenchUnit: '.tmp/extension-workbench/unit/report.json',
  functional: '.tmp/interactive-ui-unified-functional/report.json',
  security: '.tmp/interactive-ui-security/report.json',
  visual: '.tmp/interactive-ui-visual-smoke/baseline.json',
  routing: '.tmp/interactive-ui-model-routing/report.json',
  packagedDesktop: '.tmp/interactive-ui-packaged-desktop/report.json',
  artifactRunnerClipping: '.tmp/artifact-runner-clipping-packaged/report.json',
  performance: '.tmp/interactive-ui-runtime-performance/report.json',
};

const readReport = async (relativePath) => {
  try {
    return JSON.parse(await fs.readFile(path.join(projectRoot, relativePath), 'utf8'));
  } catch (error) {
    throw new Error(`Missing or invalid acceptance report ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const reports = Object.fromEntries(await Promise.all(Object.entries(reportPaths).map(async ([key, relativePath]) => [
  key,
  await readReport(relativePath),
])));

const securitySummary = reports.security?.summary ?? {};
const performance = reports.performance;
const performancePassed = performance.bundles.mainEntry.bytes <= performance.budgets.mainEntryBytes
  && performance.bundles.artifactLazy.bytes <= performance.budgets.artifactLazyBytes
  && performance.bundles.artifactLazy.gzipBytes <= performance.budgets.artifactLazyGzipBytes
  && performance.bundles.artifactRendererIsLazy === true
  && Object.entries(performance.readyMedianMs).every(([runtime, milliseconds]) => milliseconds <= (
    runtime.startsWith('artifact-')
      ? performance.budgets.artifactReadyMedianMs
      : performance.budgets.standardViewReadyMedianMs
  ))
  && performance.artifactStore.materialize.p95Ms <= performance.budgets.materializeP95Ms
  && performance.artifactStore.cacheHit.p95Ms <= performance.budgets.cacheHitP95Ms
  && performance.artifactStore.averageCacheBytes <= performance.budgets.cacheAverageBytes
  && performance.artifactStore.rssDeltaBytes <= performance.budgets.benchmarkRssDeltaBytes;

const gates = [
  {
    id: 'extension-workbench-unit',
    passed: reports.workbenchUnit?.ok === true
      && reports.workbenchUnit?.complete === true
      && reports.workbenchUnit?.cases?.fail === 0,
    report: reportPaths.workbenchUnit,
  },
  { id: 'functional', passed: reports.functional?.ok === true, report: reportPaths.functional },
  {
    id: 'security',
    passed: securitySummary.failed === 0
      && securitySummary.targetNetworkRequests?.static === 0
      && securitySummary.targetNetworkRequests?.scripts === 0
      && securitySummary.runtimeErrors?.static === 0
      && securitySummary.runtimeErrors?.scripts === 0,
    report: reportPaths.security,
  },
  {
    id: 'visual',
    passed: reports.visual?.ok === true
      && reports.visual?.goldens?.failures === 0
      && reports.visual?.runtimeErrors === 0,
    report: reportPaths.visual,
  },
  {
    id: 'available-model-routing',
    passed: Array.isArray(reports.routing?.models)
      && reports.routing.models.length > 0
      && reports.routing.models.every((model) => model?.summary?.passed === true)
      && reports.routing?.prerequisites?.businessRuntimeCleanup !== 'pending',
    report: reportPaths.routing,
  },
  {
    id: 'packaged-desktop-macos-arm64',
    passed: reports.packagedDesktop?.ok === true
      && reports.packagedDesktop?.runtimeErrors === 0
      && reports.packagedDesktop?.artifact?.scriptsMode === 'supported'
      && reports.packagedDesktop?.artifact?.scriptsRunner === 'desktop-runner:ready-then-stopped',
    report: reportPaths.packagedDesktop,
  },
  {
    id: 'artifact-runner-clipping-and-occlusion-macos-arm64',
    passed: reports.artifactRunnerClipping?.ok === true
      && reports.artifactRunnerClipping?.dialogOcclusion?.ok === true
      && reports.artifactRunnerClipping?.modeLifecycle?.ok === true,
    report: reportPaths.artifactRunnerClipping,
  },
  { id: 'runtime-performance', passed: performancePassed, report: reportPaths.performance },
];

const unavailableModels = Array.isArray(reports.routing?.unavailableModels) ? reports.routing.unavailableModels : [];
const externalBlockers = Array.isArray(reports.routing?.externalBlockers)
  ? reports.routing.externalBlockers
  : [];
const unverifiedPlatforms = performance.releaseScope?.unverified ?? [];
const localGatesPassed = gates.every((gate) => gate.passed);
const complete = localGatesPassed && reports.routing?.complete === true && externalBlockers.length === 0;

const report = {
  $schema: 'openchamber://interactive-ui-unified-acceptance-report/v1',
  generatedAt: new Date().toISOString(),
  ok: localGatesPassed,
  complete,
  releaseCandidate: complete ? 'macos-arm64' : (localGatesPassed ? 'tested-runtimes' : 'blocked'),
  gates,
  capabilities: {
    stable: [
      'agent-generated-declarative',
      'installed-declarative',
      'trusted-native',
      'static-html-artifact',
      'managed-desktop-scripts-html-artifact',
    ],
    experimentalDefaultOff: ['web-scripts-html-artifact'],
    verifiedRuntimes: performance.releaseScope?.verified ?? [],
    unsupportedRuntimes: performance.releaseScope?.unsupported ?? [],
  },
  routing: {
    models: reports.routing.models.map((model) => ({ key: model.key, summary: model.summary })),
    unavailableModels,
  },
  externalBlockers,
  unverifiedPlatforms,
  evidence: reportPaths,
};

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({
  ok: report.ok,
  complete: report.complete,
  releaseCandidate: report.releaseCandidate,
  gates: report.gates,
  externalBlockers: report.externalBlockers,
  unverifiedPlatforms: report.unverifiedPlatforms,
  reportPath: path.relative(projectRoot, outputPath),
}, null, 2));

assert.equal(localGatesPassed, true, 'One or more local Interactive UI acceptance gates failed');
