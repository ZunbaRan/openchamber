# Trusted Snapshot Explainer

A standalone, generated **Trusted Native OCIX example** that explains the OCIX
trust model from deterministic inline snapshot data. It is replayable, visibly
non-live, signed/package-valid, and declares **no** Connector, action,
network, storage, credential, Gateway, dashboard, or business-data authority.

## Identity

| Surface | Value |
|---|---|
| Extension id | `com.openchamber.demo.snapshot-explainer` |
| Version | `1.0.0` |
| View id | `com.openchamber.demo.snapshot-explainer.ocix-trust` |
| Tool | `ocix_explain_trust_pipeline` |
| Skill | `ocix-trusted-snapshot-explainer` |
| Agent domain | `ocix-training` (intents `ocix-training.trust.explain`, `ocix-training.replay.explain`) |
| Data authority | `generated` |
| View runtime | `native` · read · priority 60 · `displayModes: ["inline"]` |
| Trust | `native-code` / `development` |

## Inventory

- `openchamber.extension.json` — manifest: generated kind, native-code trust,
  full read-only presentation of one inline view, empty network permissions.
- `agent-runtime/tools/ocix_explain_trust_pipeline.ts` — strict enum-only Tool
  (`focus`: `overview`/`signature`/`installation`/`replay`; `depth`:
  `quick`/`detailed`, both optional). The pure `buildSnapshotExplainerResult`
  builder rejects unknown keys, accessors, non-plain objects, invalid or
  missing values, and never coerces; the default handler only serializes it.
  Output is a deterministic `openchamber://interactive-result/v1` envelope,
  `mode=snapshot`, inline data only — never `dataRef`, `updatedAt`, a live or
  generated timestamp, a random id, or a network location.
- `agent-runtime/skills/ocix-trusted-snapshot-explainer/SKILL.md` — when to
  call the Tool, and never for business data or generic routing corpora.
- `ui/native/ocix-trust-explainer.mjs` — self-contained Native module
  (no imports). Exports `extension` (id / `apiVersion: 1` / `activate`), the
  pure strict decoder `parseSnapshotExplainerData`, and
  `selectExplainerStrings`. Exact own keys at every level, fixed
  schemas/versions/source, `live=false`, bounded stages/ids/text, unique stage
  ids, and total text limits; any violation or a `dataRef` fails closed to a
  localized error state — no partial rendering.
- `README.md` — this file.

## Data contract

`data` follows `openchamber://snapshot-explainer-data/v1`:

- `source`: `kind=bundled-fixture`, `authority=generated`,
  `fixtureId=ocix-trust-pipeline`, `fixtureVersion=1`, bounded `label`.
- `live` is always `false`.
- `title` ≤ 120, `thesis` ≤ 800, `stages` 1–8, stage `id` matches
  `^[a-z0-9]+(?:-[a-z0-9]+)*$` and is unique, stage `title` ≤ 80,
  stage `body` ≤ 800, `points` ≤ 6 of ≤ 160 chars each, `notes` ≤ 4 of ≤ 240
  chars each; total snapshot text ≤ 16 000 characters.

## Visible non-live labeling

Visible strings are selected from `props.host.context.locale` with a zh-CN/en
pair and English fallback for unknown locales (no React app i18n involvement).
Every successful screen carries the notice; zh-CN includes
`示例/模拟 · 非实时数据` and en includes `Example/simulation · not live data`.
Stable attributes: `data-ocix-snapshot-explainer` on the root,
`data-ocix-snapshot-source` on the source/notice element, and
`data-ocix-snapshot-stage` on each stage. Interaction is local-only
accordion state; there is no fetch, XHR, WebSocket, EventSource, postMessage
authority, host action, external link, timer, or persistence.

## Validation

```sh
node scripts/interactive-ui-extension.mjs validate examples/interactive-ui/trusted-snapshot-explainer
```

The bundled tests additionally prove validation, signing, packaging, and
verification with a temporary Ed25519 key:

```sh
bun test scripts/lib/ocix-snapshot-explainer-tool.test.ts
node --test scripts/lib/ocix-snapshot-explainer-extension.test.mjs
```

This example is **not** installed by default and is **not** part of generic
RLHF routing or evaluation corpora.
