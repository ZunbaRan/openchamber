import { describe, expect, test } from 'bun:test';
import { parseInteractiveResultEnvelope } from './result';

describe('parseInteractiveResultEnvelope', () => {
  test('accepts a versioned live result envelope', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      context: { region: 'east' },
      dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'r1' },
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      context: { region: 'east' },
      dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'r1' },
    });
  });

  test('accepts a query-driven live envelope with context only', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.operations.workspace',
      schemaVersion: 1,
      mode: 'live',
      summary: 'Operations workspace opened',
      context: { scope: 'default' },
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.operations.workspace',
      schemaVersion: 1,
      mode: 'live',
      summary: 'Operations workspace opened',
      context: { scope: 'default' },
    });
  });

  test('does not heuristically activate arbitrary JSON or prose', () => {
    expect(parseInteractiveResultEnvelope('{"view":"com.acme.sales.dashboard"}')).toBeNull();
    expect(parseInteractiveResultEnvelope('Result: {"$schema":"openchamber://interactive-result/v1"}')).toBeNull();
  });

  test('rejects an envelope whose UTF-8 byte length exceeds the 1 MiB bound', () => {
    const oversize = JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(600_000),
    });
    // 600k x U+00E9 = ~1.2M UTF-8 bytes, but ~600k UTF-16 code units;
    // the string-length check alone would wrongly accept it.
    expect(oversize.length).toBeLessThan(1024 * 1024);
    expect(parseInteractiveResultEnvelope(oversize)).toBeNull();
  });

  test('accepts a multibyte envelope below the 1 MiB byte bound', () => {
    const result = parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(10_000),
    }));
    expect(result).toEqual({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '\u00e9'.repeat(10_000),
    });
  });

  test('accepts exactly 1 MiB and rejects the next byte', () => {
    const maxBytes = 1024 * 1024;
    const base = {
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      summary: '',
    };
    const envelopeBytesWithoutSummary = JSON.stringify(base).length;
    const exact = JSON.stringify({
      ...base,
      summary: 'x'.repeat(maxBytes - envelopeBytesWithoutSummary),
    });
    const over = JSON.stringify({
      ...base,
      summary: 'x'.repeat(maxBytes - envelopeBytesWithoutSummary + 1),
    });

    expect(exact.length).toBe(maxBytes);
    expect(parseInteractiveResultEnvelope(exact)).not.toBeNull();
    expect(over.length).toBe(maxBytes + 1);
    expect(parseInteractiveResultEnvelope(over)).toBeNull();
  });

  test('stops reading once the UTF-8 byte limit is exceeded', () => {
    const maxBytes = 1024 * 1024;
    let codeUnitReads = 0;
    const syntheticCandidate = {
      length: maxBytes * 2,
      charCodeAt: () => {
        codeUnitReads += 1;
        return 0x78;
      },
    };
    const syntheticOutput = {
      trim: () => syntheticCandidate,
    } as unknown as string;

    expect(parseInteractiveResultEnvelope(syntheticOutput)).toBeNull();
    expect(codeUnitReads).toBe(maxBytes + 1);
  });

  test('rejects unsupported versions and malformed live references', () => {
    expect(parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 2,
      mode: 'snapshot',
    }))).toBeNull();
    expect(parseInteractiveResultEnvelope(JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: 'com.acme.sales.dashboard',
      schemaVersion: 1,
      mode: 'live',
      dataRef: { connector: 'sales-api' },
    }))).toBeNull();
  });

  // Byte-exact output of buildSnapshotExplainerResult({ focus: 'overview', depth: 'detailed' })
  // from examples/interactive-ui/trusted-snapshot-explainer (the trusted snapshot
  // explainer Tool contract proven by scripts/lib/ocix-snapshot-explainer-tool.test.ts).
  // The envelope is mode=snapshot with inline nested data only: no dataRef, no
  // updatedAt, and the nested source object must survive the JSON round-trip.
  const snapshotExplainerEnvelope = `{"$schema":"openchamber://interactive-result/v1","view":"com.openchamber.demo.snapshot-explainer.ocix-trust","schemaVersion":1,"mode":"snapshot","summary":"Installed snapshot-explainer example · OCIX trust model at a glance (detailed) — bundled deterministic fixture, not live data.","context":{"focus":"overview","depth":"detailed"},"data":{"$schema":"openchamber://snapshot-explainer-data/v1","schemaVersion":1,"source":{"kind":"bundled-fixture","authority":"generated","fixtureId":"ocix-trust-pipeline","fixtureVersion":1,"label":"OCIX trust pipeline · bundled deterministic fixture"},"live":false,"title":"OCIX trust model at a glance","thesis":"The OCIX trust model treats the signed package as the trust root. Everything a surface may do is declared inside that package; anything outside it is denied by default. This installed snapshot explains the boundary from deterministic inline data and never opens a live channel.","stages":[{"id":"trust-boundary","title":"One trust boundary per extension","body":"The signed manifest is the trust root, not a runtime heuristic. Capabilities are granted by declaration only: surfaces, tools, connectors, actions, and permissions all come from the packaged manifest.","points":["The signed manifest is the trust root, not runtime heuristics","No connector, action, network, storage, or credential authority is granted implicitly","An installed snapshot explains this boundary from deterministic inline data"]},{"id":"signed-package","title":"Signed and integrity-checked","body":"The publisher signs the canonical package index with Ed25519. Every file is listed with its size and SHA-256, and verification completes before any surface or Tool is exposed.","points":["Ed25519 signature over the canonical package index","SHA-256 per file with exact size checks","Verification happens before any surface or Tool is exposed"]},{"id":"snapshot-contract","title":"Deterministic snapshot, not live state","body":"The Tool returns mode=snapshot with inline data only. There is no dataRef, no updatedAt, no refresh channel, and no connector behind the view, so the render can never drift into live behavior.","points":["Inline data only; dataRef is forbidden","No live or generated timestamps and no random ids","The same arguments replay byte-identically every time"]},{"id":"non-live-disclosure","title":"Always visibly non-live","body":"Every successful screen states that it is an installed snapshot and an example, not live data. The zh-CN and en notices both mark the fixture as simulated, and unknown locales fall back to English.","points":["zh-CN and en notices both mark the fixture as simulated","Unknown locales fall back to English","The host metadata row still shows the snapshot badge"]}],"notes":["Determinism is enforced end to end: the builder takes no clock, entropy, environment, file, or network input.","Fail-closed decoding means a single unexpected key, accessor, or oversized field refuses the whole render.","The installed inventory is capability-free: zero connectors, actions, network permissions, and no dashboard."]}}`;

  test('replays the trusted snapshot explainer inline snapshot through the production parser with no dataRef', () => {
    const parsed = parseInteractiveResultEnvelope(snapshotExplainerEnvelope);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(JSON.parse(snapshotExplainerEnvelope));
    expect(JSON.stringify(parsed)).toBe(snapshotExplainerEnvelope);
    expect(Object.hasOwn(parsed as object, 'dataRef')).toBe(false);
    expect(Object.hasOwn(parsed as object, 'updatedAt')).toBe(false);
    expect(parsed?.mode).toBe('snapshot');
    expect(parsed?.view).toBe('com.openchamber.demo.snapshot-explainer.ocix-trust');
    const data = parsed?.data as Record<string, unknown>;
    expect(data.live).toBe(false);
    expect(data.source).toEqual({
      kind: 'bundled-fixture',
      authority: 'generated',
      fixtureId: 'ocix-trust-pipeline',
      fixtureVersion: 1,
      label: 'OCIX trust pipeline · bundled deterministic fixture',
    });
    const stages = data.stages as Array<Record<string, unknown>>;
    expect(stages.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stages[0].points)).toBe(true);
  });
});
