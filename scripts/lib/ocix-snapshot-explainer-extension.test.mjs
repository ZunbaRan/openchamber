import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateExtension, generateSigningKeys, packExtension, verifyPackageFile } from '../interactive-ui-extension.mjs';
import { verifyExtensionPackage } from '../../packages/web/server/lib/interactive-ui/package-format.js';
import { normalizeExtensionManifest } from '../../packages/web/server/lib/interactive-ui/runtime.js';
import * as explainer from '../../examples/interactive-ui/trusted-snapshot-explainer/ui/native/ocix-trust-explainer.mjs';

const EXTENSION_ID = 'com.openchamber.demo.snapshot-explainer';
const VIEW_ID = 'com.openchamber.demo.snapshot-explainer.ocix-trust';
const TOOL_NAME = 'ocix_explain_trust_pipeline';
const SKILL_NAME = 'ocix-trusted-snapshot-explainer';
const DATA_SCHEMA = 'openchamber://snapshot-explainer-data/v1';

const TEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'examples', 'interactive-ui', 'trusted-snapshot-explainer');
const EXPECTED_INVENTORY = [
  'README.md',
  'agent-runtime/skills/ocix-trusted-snapshot-explainer/SKILL.md',
  'agent-runtime/tools/ocix_explain_trust_pipeline.ts',
  'openchamber.extension.json',
  'ui/native/ocix-trust-explainer.mjs',
];

const temporaryRoots = [];
const withTemporaryRoot = async (fn) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocix-snapshot-explainer-test-'));
  temporaryRoots.push(root);
  try {
    return await fn(root);
  } finally {
    // Tests may assert on files inside root; cleanup happens in after().
  }
};

test.after(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const validSnapshot = (overrides = {}) => {
  const snapshot = {
    $schema: DATA_SCHEMA,
    schemaVersion: 1,
    source: {
      kind: 'bundled-fixture',
      authority: 'generated',
      fixtureId: 'ocix-trust-pipeline',
      fixtureVersion: 1,
      label: 'OCIX trust pipeline · bundled deterministic fixture',
    },
    live: false,
    title: 'OCIX trust model at a glance',
    thesis: 'The signed package is the trust root; this installed snapshot explains the boundary from deterministic inline data.',
    stages: [
      {
        id: 'trust-boundary',
        title: 'One trust boundary per extension',
        body: 'Capabilities are granted by declaration only, from the packaged manifest.',
        points: ['The signed manifest is the trust root', 'No capability is granted implicitly'],
      },
      {
        id: 'snapshot-contract',
        title: 'Deterministic snapshot, not live state',
        body: 'Inline data only; no refresh channel exists.',
        points: ['mode is always snapshot', 'No timestamps or random ids'],
      },
    ],
    notes: ['An installed, simulated, non-live snapshot.'],
  };
  return structuredClone({ ...snapshot, ...overrides });
};

test('module exposes the frozen extension identity and activation contract', () => {
  assert.equal(explainer.EXPLAINER_EXTENSION_ID, EXTENSION_ID);
  assert.equal(explainer.EXPLAINER_VIEW_ID, VIEW_ID);
  assert.equal(explainer.EXPLAINER_DATA_SCHEMA, DATA_SCHEMA);
  assert.equal(explainer.extension.id, EXTENSION_ID);
  assert.equal(explainer.extension.apiVersion, 1);
  assert.equal(typeof explainer.extension.activate, 'function');
  assert.equal(typeof explainer.parseSnapshotExplainerData, 'function');
  assert.equal(typeof explainer.selectExplainerStrings, 'function');
});

test('activation registers the exact view id through the host and returns a disposer', () => {
  let registered = null;
  const host = {
    react: { createElement: () => null, useState: () => [null, () => {}] },
    ui: {},
    views: {
      register(definition) {
        registered = definition;
        return () => { registered = null; };
      },
    },
  };
  const disposer = explainer.extension.activate(host);
  assert.equal(typeof disposer, 'function');
  assert.equal(registered.id, VIEW_ID);
  assert.deepEqual(registered.displayModes, ['inline']);
  assert.equal(typeof registered.component, 'function');
  disposer();
  assert.equal(registered, null);
});

test('decoder accepts a valid bounded snapshot and returns a frozen normalized copy', () => {
  const snapshot = validSnapshot();
  const decoded = explainer.parseSnapshotExplainerData(snapshot);
  assert.notEqual(decoded, null);
  assert.deepEqual(decoded, snapshot);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.source), true);
  assert.equal(Object.isFrozen(decoded.stages), true);
  // The normalized copy must not share mutable identity with the input.
  assert.notEqual(decoded.stages, snapshot.stages);
});

test('decoder rejects missing and extra keys at every level', () => {
  for (const key of ['$schema', 'schemaVersion', 'source', 'live', 'title', 'thesis', 'stages', 'notes']) {
    const snapshot = validSnapshot();
    delete snapshot[key];
    assert.equal(explainer.parseSnapshotExplainerData(snapshot), null, `missing data.${key} must be rejected`);
  }
  for (const [location, factory] of [
    ['data', () => ({ ...validSnapshot(), extra: true })],
    ['source', () => validSnapshot({ source: { ...validSnapshot().source, extra: true } })],
    ['stage', () => validSnapshot({
      stages: [{ ...validSnapshot().stages[0], extra: true }],
    })],
  ]) {
    assert.equal(explainer.parseSnapshotExplainerData(factory()), null, `extra key in ${location} must be rejected`);
  }
  for (const key of ['kind', 'authority', 'fixtureId', 'fixtureVersion', 'label']) {
    const source = { ...validSnapshot().source };
    delete source[key];
    assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ source })), null, `missing source.${key} must be rejected`);
  }
  for (const key of ['id', 'title', 'body', 'points']) {
    const stage = { ...validSnapshot().stages[0] };
    delete stage[key];
    assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [stage] })), null, `missing stage.${key} must be rejected`);
  }
});

test('decoder rejects wrong types and fixed-value mismatches', () => {
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ $schema: 'openchamber://other/v1' })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ schemaVersion: 2 })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ live: true })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ live: 'false' })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ title: 42 })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ thesis: ['x'] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: {} })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ notes: 'one note' })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ source: { ...validSnapshot().source, kind: 'live-fixture' } })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ source: { ...validSnapshot().source, authority: 'connected-business-system' } })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ source: { ...validSnapshot().source, fixtureId: 'other-fixture' } })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ source: { ...validSnapshot().source, fixtureVersion: 2 } })), null);
  const stage = validSnapshot().stages[0];
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, points: 'none' }] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, body: 5 }] })), null);
});

test('decoder rejects oversized text, arrays, and duplicate or invalid stage ids', () => {
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ title: 'x'.repeat(121) })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ thesis: 'x'.repeat(801) })), null);
  const stage = validSnapshot().stages[0];
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, title: 'x'.repeat(81) }] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, body: 'x'.repeat(801) }] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, points: Array.from({ length: 7 }, () => 'p') }] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [{ ...stage, points: ['x'.repeat(161)] }] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ notes: Array.from({ length: 5 }, () => 'n') })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ notes: ['n'.repeat(241)] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({ stages: [] })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({
    stages: Array.from({ length: 9 }, (_, index) => ({ ...stage, id: `stage-${index}` })),
  })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({
    stages: [{ ...stage, id: 'Stage-1' }],
  })), null);
  assert.equal(explainer.parseSnapshotExplainerData(validSnapshot({
    stages: [stage, { ...stage }],
  })), null);
  // Total text bound: 16 000 characters across the whole snapshot. Eight
  // stages at the per-field maxima push the sum past the limit.
  const longSnapshot = validSnapshot({ thesis: 'x'.repeat(800), title: 'y'.repeat(120) });
  longSnapshot.stages = Array.from({ length: 8 }, (_, index) => ({
    ...stage,
    id: `stage-${index}`,
    title: 't'.repeat(30),
    body: 'b'.repeat(800),
    points: Array.from({ length: 6 }, (_, pointIndex) => `p${index}-${pointIndex}`.padEnd(160, 'z')),
  }));
  longSnapshot.notes = Array.from({ length: 4 }, () => 'n'.repeat(240));
  assert.equal(explainer.parseSnapshotExplainerData(longSnapshot), null);
});

test('decoder rejects non-plain objects, accessors, blocked and symbol keys', () => {
  const stage = validSnapshot().stages[0];
  // structuredClone normalizes prototypes, so the non-plain stage must be
  // installed after cloning to preserve its custom prototype.
  const customProto = validSnapshot();
  customProto.stages = [Object.assign(Object.create({ inherited: true }), stage)];
  assert.equal(explainer.parseSnapshotExplainerData(customProto), null);

  class Stage {
    constructor() {
      this.id = stage.id;
      this.title = stage.title;
      this.body = stage.body;
      this.points = stage.points;
    }
  }
  const classInstance = validSnapshot();
  classInstance.stages = [new Stage()];
  assert.equal(explainer.parseSnapshotExplainerData(classInstance), null);

  const accessor = validSnapshot();
  Object.defineProperty(accessor, 'title', { get: () => 't', enumerable: true });
  assert.equal(explainer.parseSnapshotExplainerData(accessor), null);

  const nonEnumerable = validSnapshot();
  Object.defineProperty(nonEnumerable, 'thesis', { value: nonEnumerable.thesis, enumerable: false });
  assert.equal(explainer.parseSnapshotExplainerData(nonEnumerable), null);

  const protoKey = validSnapshot();
  Object.defineProperty(protoKey, '__proto__', { value: 'polluted', enumerable: true });
  assert.equal(explainer.parseSnapshotExplainerData(protoKey), null);

  const constructorKey = validSnapshot({ stages: [stage] });
  Object.defineProperty(constructorKey.stages[0], 'constructor', { value: 'x', enumerable: true });
  assert.equal(explainer.parseSnapshotExplainerData(constructorKey), null);

  const symbolKey = validSnapshot();
  symbolKey[Symbol('extra')] = true;
  assert.equal(explainer.parseSnapshotExplainerData(symbolKey), null);

  const undefinedKey = validSnapshot({ title: undefined });
  assert.equal(explainer.parseSnapshotExplainerData(undefinedKey), null);
});

test('locale selection provides zh-CN/en notices with English fallback', () => {
  const zh = explainer.selectExplainerStrings('zh-CN');
  const en = explainer.selectExplainerStrings('en');
  assert.notEqual(zh, en);
  assert.equal(zh.notice.includes('示例/模拟 · 非实时数据'), true);
  assert.equal(en.notice.includes('Example/simulation · not live data'), true);
  assert.equal(explainer.selectExplainerStrings('zh-Hans'), zh);
  assert.equal(explainer.selectExplainerStrings('en-US'), en);
  assert.equal(explainer.selectExplainerStrings('fr-FR'), en);
  assert.equal(explainer.selectExplainerStrings('de'), en);
  assert.equal(explainer.selectExplainerStrings(''), en);
  assert.equal(explainer.selectExplainerStrings(undefined), en);
});

test('module source carries the stable snapshot attributes and no dynamic markup', async () => {
  const source = await fs.readFile(path.join(EXTENSION_DIR, 'ui/native/ocix-trust-explainer.mjs'), 'utf8');
  assert.equal(source.includes('data-ocix-snapshot-explainer'), true);
  assert.equal(source.includes('data-ocix-snapshot-source'), true);
  assert.equal(source.includes('data-ocix-snapshot-stage'), true);
  assert.equal(source.includes('innerHTML'), false);
  assert.equal(source.includes('dangerouslySetInnerHTML'), false);
});

test('prohibited network/storage/authority surfaces are absent from example sources', async () => {
  const sourceFiles = EXPECTED_INVENTORY.filter((entry) => entry !== 'README.md');
  // Executable-surface tokens only: prose inside the Tool lesson tables may
  // legitimately name the banned transports (for example "WebSocket"), so the
  // scan targets the call/access forms that would actually execute.
  const forbiddenTokens = [
    'fetch(', 'XMLHttpRequest', 'new WebSocket', 'EventSource(', 'postMessage(',
    'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie',
    'innerHTML', 'http://', 'https://', 'Authorization', 'Bearer ',
    'setTimeout', 'setInterval', 'process.env', 'require(', 'import(',
  ];
  for (const file of sourceFiles.map((entry) => path.join(EXTENSION_DIR, entry))) {
    const content = await fs.readFile(file, 'utf8');
    for (const token of forbiddenTokens) {
      assert.equal(content.includes(token), false, `${path.relative(EXTENSION_DIR, file)} must not contain ${token}`);
    }
  }
  // The README is documentation and legitimately names the prohibited
  // surfaces; only executable/URL-shaped tokens are scanned there.
  const readme = await fs.readFile(path.join(EXTENSION_DIR, 'README.md'), 'utf8');
  for (const token of ['http://', 'https://', 'innerHTML', 'dangerouslySetInnerHTML']) {
    assert.equal(readme.includes(token), false, `README.md must not contain ${token}`);
  }
});

test('raw manifest declares the frozen identity with zero capability surfaces', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(EXTENSION_DIR, 'openchamber.extension.json'), 'utf8'));
  assert.equal(manifest.$schema, 'openchamber://extension/v1');
  assert.equal(manifest.id, EXTENSION_ID);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.agentRouting.domain, 'ocix-training');
  assert.deepEqual(manifest.agentRouting.intents, ['ocix-training.trust.explain', 'ocix-training.replay.explain']);
  assert.equal(manifest.agentRouting.dataAuthority, 'generated');
  assert.equal(manifest.connectors, undefined);
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.artifacts, undefined);
  assert.deepEqual(manifest.permissions.network, []);
  assert.deepEqual(manifest.trust, { mode: 'native-code', signature: 'development' });
  const view = manifest.views[0];
  assert.equal(view.id, VIEW_ID);
  assert.equal(view.runtime, 'native');
  assert.equal(view.entry, 'ui/native/ocix-trust-explainer.mjs');
  assert.equal(view.export, 'extension');
  assert.deepEqual(view.tools, [TOOL_NAME]);
  assert.equal(view.routing.priority, 60);
  assert.equal(view.routing.operation, 'read');
  assert.deepEqual(view.displayModes, ['inline']);
  assert.equal(view.dashboard, undefined);
});

test('repository validation accepts the extension with zero parsed capabilities', async () => {
  const validation = await validateExtension(EXTENSION_DIR);
  assert.equal(validation.extensionId, EXTENSION_ID);
  assert.equal(validation.version, '1.0.0');
  assert.equal(validation.delivery, 'local');
  assert.deepEqual(validation.nativeViews, [VIEW_ID]);
  assert.deepEqual(validation.declarativeViews, []);
  assert.deepEqual(validation.htmlArtifacts, []);
  assert.deepEqual(validation.actions, []);
  assert.deepEqual(validation.agentRuntime.tools.map((tool) => tool.name), [TOOL_NAME]);
  assert.deepEqual(validation.agentRuntime.skills.map((skill) => skill.name), [SKILL_NAME]);
  assert.deepEqual(validation.agentRuntime.unresolvedSurfaceTools, []);
});

test('pack and verify with a temporary Ed25519 key prove inventory, signing, and zero capability', async () => {
  await withTemporaryRoot(async (root) => {
    const keys = await generateSigningKeys({ outputDirectory: path.join(root, 'keys') });
    const packagePath = path.join(root, 'snapshot-explainer.ocix');
    const packed = await packExtension({
      extensionDirectory: EXTENSION_DIR,
      outputPath: packagePath,
      privateKeyPath: keys.privateKeyPath,
      publisherId: 'com.openchamber.demo.snapshot-explainer.publisher',
      publisherName: 'OpenChamber Demo',
      keyId: 'test-2026',
    });
    assert.equal(packed.extensionId, EXTENSION_ID);
    assert.equal(packed.version, '1.0.0');
    assert.equal(packed.delivery, 'local');
    assert.match(packed.packageHash, /^sha256-[A-Za-z0-9+/]{43}=$/);
    assert.match(packed.publisherFingerprint, /^sha256-[A-Za-z0-9+/]{43}=$/);
    assert.deepEqual(packed.agentRuntime.tools.map((tool) => tool.name), [TOOL_NAME]);
    assert.deepEqual(packed.agentRuntime.skills.map((skill) => skill.name), [SKILL_NAME]);

    const verified = await verifyPackageFile({
      packagePath,
      publicKeyPath: keys.publicKeyPath,
      publisherId: 'com.openchamber.demo.snapshot-explainer.publisher',
      keyId: 'test-2026',
    });
    assert.equal(verified.extensionId, EXTENSION_ID);
    assert.equal(verified.version, '1.0.0');
    assert.equal(verified.delivery, 'local');
    assert.equal(verified.publisherTrusted, true);
    assert.match(verified.packageHash, /^sha256-[A-Za-z0-9+/]{43}=$/);
    assert.equal(verified.publisherFingerprint, packed.publisherFingerprint);
    assert.deepEqual(verified.agentRuntime.tools.map((tool) => tool.name), [TOOL_NAME]);
    assert.deepEqual(verified.agentRuntime.skills.map((skill) => skill.name), [SKILL_NAME]);

    // Full package-format verification: signed inventory/source closure and
    // the zero-capability manifest, without any legacy fixture roots. The
    // signed manifest is raw JSON; runtime normalization proves the parsed
    // capability is empty.
    const buffer = await fs.readFile(packagePath);
    const full = await verifyExtensionPackage({ buffer, allowEmbeddedPublisherKey: true });
    assert.deepEqual([...full.files.keys()].sort(), EXPECTED_INVENTORY);
    assert.equal(full.packageHash, packed.packageHash);
    assert.equal(full.publisherFingerprint, packed.publisherFingerprint);
    assert.equal(full.manifest.connectors, undefined);
    assert.equal(full.manifest.actions, undefined);
    assert.equal(full.manifest.trust.mode, 'native-code');
    const normalized = normalizeExtensionManifest(full.manifest);
    assert.deepEqual(normalized.connectors, []);
    assert.deepEqual(normalized.actions, []);
    assert.deepEqual(normalized.views.map((view) => view.id), [VIEW_ID]);
    assert.deepEqual(normalized.views[0].tools, [TOOL_NAME]);
    assert.equal(normalized.views[0].dashboard, null);
    assert.equal(normalized.agentRouting.dataAuthority, 'generated');
    assert.equal(normalized.views[0].runtime, 'native');
    assert.deepEqual(normalized.views[0].displayModes, ['inline']);
    assert.equal(full.agentRuntime.tools.length, 1);
    assert.equal(full.agentRuntime.skills.length, 1);
    assert.equal(full.agentRuntime.unresolvedSurfaceTools.length, 0);
    assert.equal(full.publisherTrusted, false); // embedded-key mode only
  });
});
