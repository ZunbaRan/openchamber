import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-security');
const reportPath = path.join(outputDirectory, 'report.json');
const MAX_CAPTURED_OUTPUT = 80_000;

const redact = (value) => String(value ?? '')
  .replace(/(authorization|access[_ -]?key|api[_ -]?key|token|secret)(\s*[:=]\s*)[^\s,;}]+/gi, '$1$2[REDACTED]')
  .replace(/Bearer\s+[^\s,;}]+/gi, 'Bearer [REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
  .replace(/([?&](?:token|key|code|secret)=[^&#\s]*)/gi, '[REDACTED_QUERY]');

const run = (id, command, args, extraEnvironment = {}) => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const append = (current, chunk) => `${current}${String(chunk)}`.slice(-MAX_CAPTURED_OUTPUT);
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    const durationMs = Date.now() - startedAt;
    if (code === 0) {
      resolve({ id, command: [command, ...args].join(' '), durationMs, stdout, stderr });
      return;
    }
    reject(new Error(redact(`${id} failed (${signal ?? code})\n${stderr || stdout}`)));
  });
});

const parseVerifierJson = (output, label) => {
  const marker = '{\n  "ok": true';
  const index = output.lastIndexOf(marker);
  assert.notEqual(index, -1, `${label} did not emit its machine-readable result`);
  return JSON.parse(output.slice(index));
};

const matrixItem = (id, boundary, attack, status, evidence, note = undefined) => ({
  id,
  boundary,
  attack,
  status,
  evidence,
  ...(note ? { note } : {}),
});

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const commands = [];
commands.push(await run('security-unit-suite', 'bun', [
  'test',
  'packages/ui/src/lib/interactive-ui/generatedLayout.test.ts',
  'packages/ui/src/lib/interactive-ui/artifactBridge.test.ts',
  'packages/ui/src/lib/interactive-ui/artifactResult.test.ts',
  'packages/web/server/lib/interactive-ui/package-format.test.js',
  'packages/web/server/lib/interactive-ui/manager.test.js',
  'packages/web/server/lib/interactive-ui/connection-store.test.js',
  'packages/web/server/lib/interactive-ui/runtime.test.js',
  'packages/web/server/lib/interactive-ui/artifact-store.test.js',
  'packages/web/server/lib/interactive-ui/routes.artifact.test.js',
  'packages/web/server/lib/interactive-ui/routing.test.js',
]));
commands.push(await run('system-boundary-suite', 'node', ['scripts/interactive-ui-system-test.mjs']));
commands.push(await run('ocix-package-suite', 'bun', ['run', 'test:interactive-ui-extension']));
commands.push(await run('artifact-static-browser', 'node', ['scripts/verify-html-artifact-browser.mjs']));
commands.push(await run(
  'artifact-scripts-browser',
  'node',
  ['scripts/verify-html-artifact-browser.mjs'],
  { OPENCHAMBER_TEST_ARTIFACT_SCRIPTS: 'true' },
));

const staticBrowser = parseVerifierJson(
  commands.find((entry) => entry.id === 'artifact-static-browser').stdout,
  'Static Artifact browser verifier',
);
const scriptsBrowser = parseVerifierJson(
  commands.find((entry) => entry.id === 'artifact-scripts-browser').stdout,
  'Scripts Artifact browser verifier',
);
assert.equal(staticBrowser.blockedNetworkRequests, 0);
assert.equal(scriptsBrowser.blockedNetworkRequests, 0);
assert.equal(staticBrowser.runtimeErrors, 0);
assert.equal(scriptsBrowser.runtimeErrors, 0);

const declarative = [
  matrixItem('decl-unknown-node', 'generated-declarative', 'Unknown or Native node injection', 'passed', ['security-unit-suite']),
  matrixItem('decl-prototype-keys', 'generated-declarative', '__proto__/prototype/constructor data keys', 'passed', ['security-unit-suite']),
  matrixItem('decl-arbitrary-visuals', 'generated-declarative', 'Arbitrary color/style/className and invalid variants', 'passed', ['security-unit-suite']),
  matrixItem('decl-executable-properties', 'generated-declarative', 'Script/event/executable properties', 'passed', ['security-unit-suite']),
  matrixItem('decl-business-capabilities', 'generated-declarative', 'query/action/binding/host token escalation', 'passed', ['security-unit-suite']),
  matrixItem('decl-resource-bounds', 'generated-declarative', 'Depth/node/row/column/text overrun', 'passed', ['security-unit-suite']),
];

const ocix = [
  matrixItem('ocix-signed-index', 'ocix', 'Unsigned, modified, or hash-mismatched package content', 'passed', ['security-unit-suite', 'ocix-package-suite']),
  matrixItem('ocix-publisher-trust', 'ocix', 'Untrusted publisher or tampered marketplace delegation', 'passed', ['security-unit-suite', 'ocix-package-suite']),
  matrixItem('ocix-secret-files', 'ocix', 'Packaging .env/private signing material', 'passed', ['security-unit-suite', 'ocix-package-suite']),
  matrixItem('ocix-network-capability', 'ocix', 'Undeclared origin, unsafe credential header, or path escape', 'passed', ['security-unit-suite']),
  matrixItem('ocix-cross-extension', 'ocix', 'Cross-extension view/action invocation', 'passed', ['security-unit-suite']),
  matrixItem('ocix-confirmed-write', 'ocix', 'Unconfirmed ask action or policy-denied write', 'passed', ['security-unit-suite', 'system-boundary-suite']),
  matrixItem('ocix-secret-output', 'ocix', 'Credential leakage through registry, routing, status, or management response', 'passed', ['security-unit-suite', 'system-boundary-suite']),
  matrixItem('ocix-agent-runtime-ownership', 'ocix', 'Overwrite, symlink, or delete of unmanaged global Tool/Skill', 'passed', ['security-unit-suite']),
];

const artifactBlockedCapabilities = new Set(scriptsBrowser.blockedCapabilities ?? []);
const browserCapability = (id, attack, capability) => {
  assert.equal(artifactBlockedCapabilities.has(capability), true, `Browser evidence is missing ${capability}`);
  return matrixItem(id, 'html-artifact-scripts', attack, 'passed', ['artifact-scripts-browser']);
};
const artifact = [
  browserCapability('artifact-parent-dom', 'Parent/host DOM access', 'parentDom'),
  browserCapability('artifact-storage', 'Cookie, localStorage, and IndexedDB persistence', 'localStorage'),
  browserCapability('artifact-popup', 'Popup creation', 'popup'),
  browserCapability('artifact-top-navigation', 'Top-level navigation', 'topNavigation'),
  browserCapability('artifact-network-fetch', 'fetch/XHR/WebSocket/Beacon to network, localhost, or Gateway', 'networkFetch'),
  browserCapability('artifact-worker', 'Worker and Service Worker execution', 'worker'),
  browserCapability('artifact-eval', 'eval and Function constructor', 'dynamicEval'),
  browserCapability('artifact-wasm', 'WebAssembly execution', 'wasm'),
  browserCapability('artifact-clipboard-read', 'Clipboard read', 'clipboardRead'),
  matrixItem('artifact-form-frame-download', 'html-artifact-scripts', 'Form, nested frame, download, self-navigation, and meta-refresh request', 'passed', ['artifact-scripts-browser'], 'All attack markers executed; the target server received zero requests.'),
  matrixItem('artifact-remote-static', 'html-artifact-static', 'Remote asset, navigation, event handler, or executable markup', 'passed', ['security-unit-suite', 'artifact-static-browser']),
  matrixItem('artifact-bridge-forgery', 'html-artifact-scripts', 'Forged source/channel/version/direction/sequence or host capability message', 'passed', ['security-unit-suite', 'artifact-scripts-browser']),
  matrixItem('artifact-payload-flood', 'html-artifact-scripts', 'Oversized payload, message flood, or resize flood', 'passed', ['security-unit-suite']),
  matrixItem('artifact-cpu-memory', 'html-artifact-scripts', 'Infinite CPU loop or memory exhaustion', 'experimental-boundary', ['security-unit-suite'], 'Web/Desktop iframe execution has no independently terminable CPU/memory boundary. Scripts remain experimental and default-off; Static Artifact is unaffected.'),
];

const matrices = { declarative, ocix, artifact };
const stableFailures = Object.values(matrices).flat().filter((entry) => entry.status === 'failed');
assert.deepEqual(stableFailures, []);

const report = {
  $schema: 'openchamber://interactive-ui-security-report/v1',
  generatedAt: new Date().toISOString(),
  releaseBoundary: {
    staticArtifact: 'stable-candidate',
    scriptsArtifact: 'experimental-default-off',
    scriptsReason: 'No independently terminable CPU/memory renderer boundary',
  },
  summary: {
    passed: Object.values(matrices).flat().filter((entry) => entry.status === 'passed').length,
    experimentalBoundary: Object.values(matrices).flat().filter((entry) => entry.status === 'experimental-boundary').length,
    failed: stableFailures.length,
    targetNetworkRequests: {
      static: staticBrowser.blockedNetworkRequests,
      scripts: scriptsBrowser.blockedNetworkRequests,
    },
    runtimeErrors: {
      static: staticBrowser.runtimeErrors,
      scripts: scriptsBrowser.runtimeErrors,
    },
  },
  commands: commands.map(({ id, command, durationMs }) => ({ id, command, durationMs, status: 'passed' })),
  matrices,
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({ ok: true, reportPath: path.relative(projectRoot, reportPath), ...report.summary }, null, 2));
