import { tool } from '@opencode-ai/plugin';

/**
 * Trusted Snapshot Explainer Tool.
 *
 * Deterministic, read-only OCIX trust-model explainer. The Tool never touches
 * a Connector, action, network, storage, credential, or live channel: it
 * builds a fixed Interactive Result envelope from bundled lesson tables keyed
 * by focus/depth, so identical arguments always produce identical bytes.
 */

export const EXPLAINER_VIEW_ID = 'com.openchamber.demo.snapshot-explainer.ocix-trust';
export const EXPLAINER_DATA_SCHEMA = 'openchamber://snapshot-explainer-data/v1';
export const EXPLAINER_FIXTURE_ID = 'ocix-trust-pipeline';
export const EXPLAINER_FIXTURE_VERSION = 1;

export const FOCUS_VALUES = ['overview', 'signature', 'installation', 'replay'] as const;
export type TrustExplainerFocus = (typeof FOCUS_VALUES)[number];

export const DEPTH_VALUES = ['quick', 'detailed'] as const;
export type TrustExplainerDepth = (typeof DEPTH_VALUES)[number];

export const CONTENT_BOUNDS = Object.freeze({
  title: 120,
  thesis: 800,
  minStages: 1,
  maxStages: 8,
  stageId: 64,
  stageTitle: 80,
  stageBody: 800,
  maxPoints: 6,
  point: 160,
  maxNotes: 4,
  note: 240,
  totalText: 16000,
});

interface ExplainerStage {
  id: string;
  title: string;
  body: string;
  points: readonly string[];
}

interface ExplainerLesson {
  title: string;
  thesis: string;
  stages: readonly ExplainerStage[];
  quickNotes: readonly string[];
  detailedNotes: readonly string[];
}

const LESSONS: Record<TrustExplainerFocus, ExplainerLesson> = {
  overview: {
    title: 'OCIX trust model at a glance',
    thesis: 'The OCIX trust model treats the signed package as the trust root. Everything a surface may do is declared inside that package; anything outside it is denied by default. This installed snapshot explains the boundary from deterministic inline data and never opens a live channel.',
    stages: [
      {
        id: 'trust-boundary',
        title: 'One trust boundary per extension',
        body: 'The signed manifest is the trust root, not a runtime heuristic. Capabilities are granted by declaration only: surfaces, tools, connectors, actions, and permissions all come from the packaged manifest.',
        points: [
          'The signed manifest is the trust root, not runtime heuristics',
          'No connector, action, network, storage, or credential authority is granted implicitly',
          'An installed snapshot explains this boundary from deterministic inline data',
        ],
      },
      {
        id: 'signed-package',
        title: 'Signed and integrity-checked',
        body: 'The publisher signs the canonical package index with Ed25519. Every file is listed with its size and SHA-256, and verification completes before any surface or Tool is exposed.',
        points: [
          'Ed25519 signature over the canonical package index',
          'SHA-256 per file with exact size checks',
          'Verification happens before any surface or Tool is exposed',
        ],
      },
      {
        id: 'snapshot-contract',
        title: 'Deterministic snapshot, not live state',
        body: 'The Tool returns mode=snapshot with inline data only. There is no dataRef, no updatedAt, no refresh channel, and no connector behind the view, so the render can never drift into live behavior.',
        points: [
          'Inline data only; dataRef is forbidden',
          'No live or generated timestamps and no random ids',
          'The same arguments replay byte-identically every time',
        ],
      },
      {
        id: 'non-live-disclosure',
        title: 'Always visibly non-live',
        body: 'Every successful screen states that it is an installed snapshot and an example, not live data. The zh-CN and en notices both mark the fixture as simulated, and unknown locales fall back to English.',
        points: [
          'zh-CN and en notices both mark the fixture as simulated',
          'Unknown locales fall back to English',
          'The host metadata row still shows the snapshot badge',
        ],
      },
    ],
    quickNotes: [
      'The signed package is the trust root; everything else is denied by default.',
      'This view is an installed, simulated, non-live snapshot.',
    ],
    detailedNotes: [
      'Determinism is enforced end to end: the builder takes no clock, entropy, environment, file, or network input.',
      'Fail-closed decoding means a single unexpected key, accessor, or oversized field refuses the whole render.',
      'The installed inventory is capability-free: zero connectors, actions, network permissions, and no dashboard.',
    ],
  },
  signature: {
    title: 'Signatures and verification',
    thesis: 'Signing makes the installed inventory tamper-evident. The publisher key signs a canonical JSON package index that lists every file with its exact size and SHA-256; any mismatch fails closed before anything is exposed.',
    stages: [
      {
        id: 'ed25519-signature',
        title: 'Ed25519 over the canonical index',
        body: 'The publisher private key signs the canonical, key-sorted JSON of the package index. The base64 signature is stored in the index while only the public key ships with the package.',
        points: [
          'Canonical stringify removes key-order ambiguity',
          'Only the public key ships with the package',
          'The private key never enters the package',
        ],
      },
      {
        id: 'package-index',
        title: 'The signed package index',
        body: 'openchamber.package.json lists every packaged file with its path, size, and SHA-256, then carries the signature over that canonical list.',
        points: [
          'The file list is the inventory root for source closure',
          'Every archive file must appear in the index',
          'Unsigned or extra files are rejected',
        ],
      },
      {
        id: 'publisher-fingerprint',
        title: 'Publisher fingerprint',
        body: 'The SPKI public key is hashed into a fingerprint that identifies the publisher. Trust decisions pin that fingerprint together with the key id.',
        points: [
          'Fingerprint is derived from the SPKI DER key bytes',
          'Key rotation changes both the fingerprint and the key id',
          'A conflicting trusted key fails closed',
        ],
      },
      {
        id: 'verification-failure',
        title: 'Fail closed on any mismatch',
        body: 'A size, hash, signature, or identity mismatch aborts the load. Nothing partial is ever rendered, and no file can mask a tampered sibling.',
        points: [
          'Signature failure is a hard error, not a warning',
          'Manifest identity must equal the signed index',
          'A tampered file cannot be masked by another file',
        ],
      },
    ],
    quickNotes: [
      'Signing covers a canonical index of every file; mismatches abort the load.',
      'Verification completes before any surface or Tool is exposed.',
    ],
    detailedNotes: [
      'The canonical form is key-sorted JSON, so whitespace and key order cannot change the signed bytes.',
      'Each file is checked by exact size and SHA-256 against the signed index.',
      'The publisher fingerprint is derived from the SPKI DER key bytes and pinned with the key id.',
    ],
  },
  installation: {
    title: 'The installed inventory',
    thesis: 'This extension is a minimal, closed, capability-free lane: one manifest, one Tool, one Skill, one Native view module, and a README. Packaging collects the whole directory into a signed archive, and the parsed capability has zero connectors, actions, network permissions, and no dashboard.',
    stages: [
      {
        id: 'manifest-inventory',
        title: 'Five files, one lane',
        body: 'The extension ships exactly five files. The manifest declares identity, routing, and trust metadata; the Tool and Skill live under agent-runtime; the Native entry is the view module.',
        points: [
          'Manifest declares id, version, routing, and trust metadata',
          'Tool and Skill are packaged under agent-runtime',
          'The Native entry is ui/native/ocix-trust-explainer.mjs',
        ],
      },
      {
        id: 'source-closure',
        title: 'Everything is in the signed archive',
        body: 'Packaging walks the extension directory and hashes every file into the signed index. Symbolic links and environment files are refused, and nothing outside the directory is referenced.',
        points: [
          'Symbolic links and environment files are refused',
          'Every packaged file is hashed into the index',
          'No build step or external asset is required',
        ],
      },
      {
        id: 'zero-capability',
        title: 'Zero connectors, actions, and network',
        body: 'The parsed capability has no connectors, no actions, an empty network list, and no dashboard surface. The view is read-only and its only interaction is local state inside the conversation.',
        points: [
          'permissions.network is empty when present',
          'No business query or execute surface exists',
          'The view is read-only with local interaction only',
        ],
      },
      {
        id: 'runtime-contract',
        title: 'The runtime contract that binds them',
        body: 'One extension id, one view id, one tool name, and one Skill keep every surface consistent: the manifest binds the Tool to the view, and the Native module registers the exact same view id.',
        points: [
          'The view id is namespaced under the extension id',
          'The Tool binds to the view in routing metadata',
          'The Native module registers the exact same view id',
        ],
      },
    ],
    quickNotes: [
      'Five files, all inside the signed archive; nothing external is referenced.',
      'Zero connectors, actions, network permissions, and no dashboard.',
    ],
    detailedNotes: [
      'Source closure is structural: packaging refuses symlinks, environment files, and private keys.',
      'The signed index is the inventory root; any unsigned or extra archive file is rejected.',
      'The single view binds exactly one Tool and one Skill under one extension id.',
    ],
  },
  replay: {
    title: 'Replayability of this example',
    thesis: 'Determinism is a design property of the whole lane, not a test artifact. The Tool builds the envelope from fixed lesson tables with no clock, entropy, environment, file, or network input, so identical arguments always produce identical bytes and the view never opens a live channel.',
    stages: [
      {
        id: 'deterministic-builder',
        title: 'A pure builder with fixed content',
        body: 'The Tool selects lesson tables by focus and depth and serializes them in a fixed key order. There are no timestamps, random ids, counters, environment reads, or file reads anywhere in the lane.',
        points: [
          'No timestamps, random ids, or counters',
          'No environment, file, or network reads',
          'Same arguments always produce the same bytes',
        ],
      },
      {
        id: 'byte-identical',
        title: 'Byte-identical across calls',
        body: 'JSON key order is fixed by construction and no locale-dependent formatting is applied inside the data, so serialization is stable across processes and sessions. Tests compare exact byte equality.',
        points: [
          'Object key order is written explicitly',
          'No locale-dependent formatting inside the data',
          'Test suites compare exact byte equality',
        ],
      },
      {
        id: 'no-live-channels',
        title: 'No live channels exist',
        body: 'There is no connector, action, dataRef, refresh, or streaming transport anywhere in the lane. The envelope mode is always snapshot and updatedAt never appears.',
        points: [
          'mode is always snapshot',
          'updatedAt and dataRef never appear',
          'Interaction is local accordion state only',
        ],
      },
      {
        id: 'local-interaction',
        title: 'Local interaction only',
        body: 'Expanding a stage or switching depth happens inside the view with component state. Nothing leaves the conversation: no fetch, no streaming transport, no storage, tokens, or timers.',
        points: [
          'No fetch, XHR, WebSocket, EventSource, or postMessage',
          'No storage, tokens, or timers',
          'Every screen labels itself as an installed snapshot',
        ],
      },
    ],
    quickNotes: [
      'The builder takes no clock, entropy, environment, file, or network input.',
      'Identical arguments produce identical bytes, checked by exact equality.',
    ],
    detailedNotes: [
      'Key order is fixed by construction, so serialization is stable across processes.',
      'Fail-closed decoding refuses any render that cannot be fully validated.',
      'The lane defines no connector, action, dataRef, refresh, or streaming transport.',
    ],
  },
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const readOwnDataProperty = (record: Record<string, unknown>, key: string): { ok: true; value: unknown } | { ok: false } => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
};

/**
 * Strict argument validation: a plain object whose own keys are exactly
 * `focus` and/or `depth`, both plain data properties, no symbols, no unknown
 * keys, no accessors, no prototype tricks, and no coercion of values.
 * Absent optional keys fall back to their documented defaults.
 */
export const normalizeExplainerArgs = (input: unknown): { focus: TrustExplainerFocus; depth: TrustExplainerDepth } => {
  if (input === undefined) return { focus: 'overview', depth: 'detailed' };
  if (!isPlainRecord(input)) {
    throw new Error('ocix_explain_trust_pipeline input must be a plain object');
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new Error('ocix_explain_trust_pipeline input must not contain symbol keys');
  }
  let focus: TrustExplainerFocus = 'overview';
  let depth: TrustExplainerDepth = 'detailed';
  for (const key of Object.getOwnPropertyNames(input)) {
    if (key !== 'focus' && key !== 'depth') {
      throw new Error(`ocix_explain_trust_pipeline received an unknown argument: ${key}`);
    }
    const property = readOwnDataProperty(input, key);
    if (!property.ok) {
      throw new Error(`ocix_explain_trust_pipeline argument ${key} must be a plain data property`);
    }
    const value = property.value;
    if (key === 'focus') {
      if (typeof value !== 'string' || !(FOCUS_VALUES as readonly string[]).includes(value)) {
        throw new Error(`ocix_explain_trust_pipeline focus must be one of: ${FOCUS_VALUES.join(', ')}`);
      }
      focus = value as TrustExplainerFocus;
    } else {
      if (typeof value !== 'string' || !(DEPTH_VALUES as readonly string[]).includes(value)) {
        throw new Error(`ocix_explain_trust_pipeline depth must be one of: ${DEPTH_VALUES.join(', ')}`);
      }
      depth = value as TrustExplainerDepth;
    }
  }
  return { focus, depth };
};

const buildSnapshotData = (focus: TrustExplainerFocus, depth: TrustExplainerDepth) => {
  const lesson = LESSONS[focus];
  return {
    $schema: EXPLAINER_DATA_SCHEMA,
    schemaVersion: 1,
    source: {
      kind: 'bundled-fixture',
      authority: 'generated',
      fixtureId: EXPLAINER_FIXTURE_ID,
      fixtureVersion: EXPLAINER_FIXTURE_VERSION,
      label: 'OCIX trust pipeline · bundled deterministic fixture',
    },
    live: false,
    title: lesson.title,
    thesis: lesson.thesis,
    stages: lesson.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      body: stage.body,
      points: [...stage.points],
    })),
    notes: depth === 'detailed' ? [...lesson.detailedNotes] : [...lesson.quickNotes],
  };
};

/**
 * Pure deterministic envelope builder. Returns a fresh
 * openchamber://interactive-result/v1 envelope with mode=snapshot and inline
 * data only: no dataRef, updatedAt, connector, action, credential, live or
 * generated timestamp, random id, or network location can ever appear.
 */
export const buildSnapshotExplainerResult = (input: unknown) => {
  const { focus, depth } = normalizeExplainerArgs(input);
  const lesson = LESSONS[focus];
  const envelope = {
    $schema: 'openchamber://interactive-result/v1',
    view: EXPLAINER_VIEW_ID,
    schemaVersion: 1,
    mode: 'snapshot',
    summary: `Installed snapshot-explainer example · ${lesson.title} (${depth}) — bundled deterministic fixture, not live data.`,
    context: { focus, depth },
    data: buildSnapshotData(focus, depth),
  };
  return envelope;
};

export default tool({
  description: '仅当用户要求解释 OCIX 信任模型、签名与验证、已安装扩展清单或确定性快照回放时使用。返回一个已安装的确定性快照示例（mode=snapshot、仅内联数据）：讲解 OCIX 的信任边界、Ed25519 签名包、零能力清单与可回放性；不访问任何连接器、动作、网络、存储或凭据。Use only when the user asks to explain the OCIX trust model, package signing and verification, the installed extension inventory, or deterministic snapshot replay. Returns an installed deterministic snapshot example (mode=snapshot, inline data only) explaining the OCIX trust boundary, Ed25519 signed packages, the zero-capability inventory, and replayability; it never touches a Connector, action, network, storage, or credential.',
  args: {
    focus: tool.schema.enum(['overview', 'signature', 'installation', 'replay']).optional().describe('讲解主题：overview（信任模型总览，默认）；signature（签名与验证）；installation（已安装清单与零能力）；replay（确定性回放）'),
    depth: tool.schema.enum(['quick', 'detailed']).optional().describe('讲解深度：quick（短要点）；detailed（详细要点，默认）'),
  },
  execute(rawArgs) {
    return JSON.stringify(buildSnapshotExplainerResult(rawArgs));
  },
});
