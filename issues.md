# Issues

> Program: P0 upstream UI realignment on immutable OpenChamber `v1.18.1`
> (`ce5192197b34aaa9501fffebe9d5e485d8d63507`) with complete fork-feature
> preservation. Pi never owns this ledger, Git history, dependency installation,
> roadmap priority, or another repository. Dispatch is serial unless an entry
> explicitly proves a safe parallel wave.

## issue-001: Prevent focus from entering a collapsed rich ToolPart

- Status: SUSPENDED
- Classification: NON-BLOCKING
- Goal / user outcome: A collapsed rich ToolPart preserves its mounted frame while keyboard focus cannot enter invisible descendants.
- First-principles root cause: The Host Confirmation donor keeps the subtree mounted but uses only `aria-hidden`, zero height, and overflow clipping; those do not remove iframe/buttons from sequential focus.
- Core acceptance invariant: Collapsed rich content is inert without unmounting/recreating the host; expansion restores interaction on the same frame.
- Dependencies: issue-026 and issue-027 only if explicitly resumed
- Dispatch order: Excluded by explicit user deferral on 2026-08-08.
- Ownership: `packages/ui/src/components/chat/message/parts/ToolPart.tsx`; focused ToolPart/browser acceptance tests.
- Focused verification: Collapse, Tab, expand browser test proves inert focus boundary and stable frame identity.
- Pi binding: unassigned; no Pi run authorized while suspended
- Pi attempts: none
- Primary attempts: Prior Host Confirmation rounds separated mount/visibility but did not establish an inert boundary; prior repair budget was exhausted.
- Current evidence: Core write-safety E2E passed, but final reviewer found the post-collapse accessibility gap in the uncommitted donor.
- Suspension decision: User explicitly deferred this proven non-blocking P1 accessibility issue on 2026-08-08; it does not change confirmation authority or write counts but remains residual risk.
- Resume condition: User explicitly returns this exact issue to `READY` and refreshes ownership/evidence.
- Continuation decision: Exclude from P0 scheduling and final-review fix routing; disclose as residual risk.
- Next action: Await explicit user resumption.

## issue-002: Archive every created browser-acceptance session on failure

- Status: SUSPENDED
- Classification: NON-BLOCKING
- Goal / user outcome: The conversation-browser harness archives a created session even when prompt/wait/assertion fails.
- First-principles root cause: The donor tracks a session only after `runPrompt()` fully returns, leaving a failure window after creation and before cleanup registration.
- Core acceptance invariant: A validated session ID is registered immediately and every later failure attempts archival; cleanup failure makes the command fail truthfully.
- Dependencies: issue-046 only if explicitly resumed
- Dispatch order: Excluded by explicit user deferral on 2026-08-08.
- Ownership: `scripts/verify-interactive-ui-conversation-browser.mjs`; one controlled failure test.
- Focused verification: Deterministic post-create failure proves the exact ID is archived and cleanup failure is non-zero.
- Pi binding: unassigned; no Pi run authorized while suspended
- Pi attempts: none
- Primary attempts: Prior rounds made success-path cleanup truthful but retained the pre-return tracking gap; prior repair budget was exhausted.
- Current evidence: Successful acceptance cleanup passed, but no failure-path evidence covers this window.
- Suspension decision: User explicitly deferred this proven non-blocking P1 harness-isolation issue on 2026-08-08; product authorization/write behavior is unaffected.
- Resume condition: User explicitly returns this exact issue to `READY` and authorizes a controlled failure fixture.
- Continuation decision: Exclude from active P0 acceptance; disclose the harness failure-path limitation.
- Next action: Await explicit user resumption.

## issue-003: Reconcile the Host Confirmation fix report with final behavior

- Status: SUSPENDED
- Classification: NON-BLOCKING
- Goal / user outcome: The Host Confirmation report no longer describes removed Set-based expansion behavior or pending E2E.
- First-principles root cause: Later implementation changes appended evidence without rewriting superseded middle/conclusion sections.
- Core acceptance invariant: Root cause, final design, source references, E2E status, and residual-risk wording agree with the final integrated code.
- Dependencies: issue-001, issue-002 only if explicitly resumed
- Dispatch order: Excluded by explicit user deferral on 2026-08-08.
- Ownership: `docs/HOST_CONFIRMATION_ARTIFACT_MOUNT_FIX_REPORT_2026-08-08.md`.
- Focused verification: Side-by-side source/report audit plus `bun run docs:validate`.
- Pi binding: unassigned; no Pi run authorized while suspended
- Pi attempts: none
- Primary attempts: Prior documentation update retained contradictory claims; prior repair budget was exhausted.
- Current evidence: The uncommitted donor has message-level default-open and completed E2E, while the report still describes a removed module Set and pending E2E.
- Suspension decision: User explicitly deferred this proven non-blocking P2 documentation-trust issue on 2026-08-08.
- Resume condition: User explicitly returns this exact issue to `READY` after deciding to reconcile the report.
- Continuation decision: Exclude from active P0 scheduling and disclose as stale-document residual risk.
- Next action: Await explicit user resumption.

## issue-004: Restore signed OCIX package parsing and verification

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The target server accepts only structurally valid, size-bounded, correctly signed `.ocix` packages with deterministic identity.
- First-principles root cause: The clean upstream target has no OCIX package-format boundary.
- Core acceptance invariant: Valid packages round-trip; malformed archive/path/schema/signature/hash/size inputs fail closed before installation state changes.
- Dependencies: none
- Dispatch order: First OpenChamber server contract; manager/trust behavior depends on it.
- Ownership: `packages/web/server/lib/interactive-ui/package-format.js`; `packages/web/server/lib/interactive-ui/package-format.test.js`.
- Focused verification: Run the focused package-format Node test; positive and every rejection boundary pass.
- Pi binding: settled run/session `8938db19-0f65-4f28-a12f-ce3a6362ad23`; detached base `4efc8f5d98c0472a1dd9fad4cee58518015a5cf0`; revision 0; host/Pi PIDs null; serial supervised-local execution. Exact worktree and run directory are cleaned after the accepted commit.
- Pi attempts: revision 0 accepted without correction; the candidate ported exactly the two owned files and reported the currently absent peer-module dependency honestly.
- Primary attempts: no implementation repair required; applied the policy-clean candidate, verified exact donor hashes, and ran the focused behavior test against the byte-identical donor module set.
- Current evidence: Candidate and donor SHA-256 values match exactly (`package-format.js` `2f26a86a...`, test `fc22b78e...`); integration syntax checks and `git diff --check` pass. After issues 056-058 restored all authoritative peers, the direct integration focused suite passes 11/11; the combined routing/dashboard/Hosted/package contract gate passes 42/42 with 267 assertions. There is no fallback or stub for those peers.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-005; aggregate Phase 3 verification will rerun this test from the integration tree once its three authoritative peer modules land.
- Next action: Commit the accepted package-format boundary, clean the exact Pi artifacts immediately, then dispatch issue-005 from the new immutable base.

## issue-005: Restore publisher trust review and persistence

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: A signed OCIX package can be inspected and its publisher key can be explicitly trusted without exposing key material or confusing self-consistent signatures with host trust.
- First-principles root cause: The target has no persistent publisher trust review module, while the donor Manager combines this trust domain with unrelated installation, Marketplace, runtime-validation, and Agent Runtime transactions.
- Core acceptance invariant: Embedded-key signature verification proves only package self-consistency; trust requires an exact fingerprint confirmation or explicit trust mutation; publisher/key-id conflicts fail closed; corrupt persisted trust fails visibly; public snapshots never expose public-key material or managed paths.
- Dependencies: issue-004
- Dispatch order: First serial Manager slice after package validation. issue-061 extends the same files only after this trust interface is accepted and committed.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`.
- Focused verification: `bun run --cwd packages/web test -- server/lib/interactive-ui/manager.test.js`; tests cover untrusted/trusted inspection, exact fingerprint trust, key-slot conflict, corrupt trust, serialized persistence, and sanitized snapshots.
- Pi binding: exhausted run/session `8a212230-2777-4819-bb87-c6ee1c5fef81`, base `236d172edb9c959915461ef1b4e28c5c85abe159`, final revision 2, host/Pi PIDs null, supervised-local without sandbox. Revision 2 settled `needs-attention` without a handoff after two corrections; host Git evidence was policy-clean with exactly the two owned files and digest `0dcbec91a676ccddb2c51533f52fa19d6904e1f0a5637f2eee68c8819276cc9b`. The exact Pi worktree and run directory were removed after the OPEN/P0 report; absence and worktree deregistration were verified without touching other sessions.
- Pi attempts: correction 1 requested after the paused revision-0 turn synthesized forbidden scratch dependency/test-runner substitutes and primary verification proved the test helper returned the Manager directly while fourteen tests expected `{ manager, dataDirectory }`; 14/15 Manager tests failed before exercising production behavior. The same review also found the newly invented source regex rejected the already-frozen future `marketplace:<namespaced-id>` provenance format. Correction 2 (final Pi attempt) requested after correction 1 reached 25/27 combined tests: the two failures were test-spec errors (`not-namespaced` is valid under the frozen ID grammar, and lexically sorted IDs were compared with numeric order). The final packet also closes the same trust-validation root cause by bounding publisher IDs, rejecting unknown persisted fields, and using locale-independent ordering.
- Primary attempts: attempt 1 repaired the first fresh Sol finding by applying the existing 128-code-unit namespaced-ID assertion to verified extension and publisher IDs before constructing the public snapshot, with independently over-bound signed-package regressions. Attempt 2 (final permitted primary repair) closes the second fresh Sol finding: the trusted-key resolver now validates publisher/key IDs before object lookup, and the public result returns only the validated string key ID; a signed single-element-array key ID can no longer coerce into a trusted string slot. Both primary repair attempts are exhausted.
- Current evidence: The original issue-005 route exhausted its Pi and primary budgets after fresh Sol reproduced prototype-slot aliasing for valid `toString`-style key IDs; that candidate was withdrawn and its run cleaned. User explicitly authorized a new repair budget for the genuinely distinct root cause, recorded as issue-064 instead of resetting issue-005. The accepted issue-064 revision-2 implementation uses null-prototype internal maps, validates primitive/bounded IDs before trust lookup and output, enforces canonical durable names/keys/fingerprints, preserves atomic serialized writes and frozen public shapes, and is byte-identical to the reviewed candidate. Integration passes 39/39 focused tests and 148/148 combined server regressions. Fresh read-only Sol verdict is `ship`: prototype-slot authority is closed, embedded keys remain self-consistency only, exact durable lookup gates `trusted`, conflicts fail closed, and issue-005 may resolve.
- Suspension decision: n/a
- Resume condition: Satisfied by explicit user authorization on 2026-08-09 and the accepted issue-064 implementation; issue-005 is RESOLVED.
- Continuation decision: Enables issue-061 and removes the trust-only P0 blocker; issues 010, 011, 014, 049, 055, 062, and 063 remain ordered by their recorded dependencies.
- Next action: Commit the accepted trust Manager with issue-064 evidence, then dispatch issue-061 from the new immutable base.

## issue-006: Restore the Connector Secret Store authority boundary

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Connector credentials remain in an owner-only server store and can be bound, replaced, tested, and removed without leaking secret material or crossing installation ownership.
- First-principles root cause: The target lacks the fork's server-only connection store; Business Gateway routing consumes this authority later but is not part of this storage slice.
- Core acceptance invariant: Reads expose metadata only; raw credentials never enter returned snapshots or errors; installation-bound updates/removals fail closed on identity mismatch; failed atomic writes preserve prior state.
- Dependencies: none
- Dispatch order: Parallel storage wave A with issues 007 and 009. All three start from the same immutable base, own pairwise-disjoint files, freeze no shared generated artifact or lockfile, and have independent focused tests. Business Gateway routing remains in issue-008.
- Ownership: `packages/web/server/lib/interactive-ui/connection-store.js`; `packages/web/server/lib/interactive-ui/connection-store.test.js`.
- Focused verification: Run the focused connection-store test; credential non-retention, opaque-key validation, installation binding, replacement/removal, permissions, and failure preservation pass.
- Pi binding: batch `3280cee8-c9a0-4298-b0a9-c3da59940939`, lane `secret-store`, run/session `9d533fc2-d8a5-4aa2-a8de-3f7533e6b064`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/9d533fc2-d8a5-4aa2-a8de-3f7533e6b064`, base `f7ba23f42445ef2f239c4973131d415481827c02`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact two-file donor port, no dependency/Git mutation, policy violations, or scope drift.
- Primary attempts: no implementation repair required; independently reran the focused test in the candidate and integrated trees and inspected secret-return, installation-identity, conditional-removal, and atomic-write paths.
- Current evidence: Candidate and integration are byte-identical to donor (`connection-store.js` SHA-256 `e549046c...`, test `417fae10...`). Candidate and integrated tests each pass 10/10 with 55 assertions; the combined storage wave passes 50/50 with 217 assertions; syntax and `git diff --check` pass. Credentials remain private, stored with owner-only permissions, and stale installation cleanup cannot remove a replacement credential.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-008's Business Gateway wiring and the later credential review UI.
- Next action: Commit storage wave A, remove the settled lane worktree/run immediately, then use this authority from issue-008.

## issue-007: Restore authoritative Artifact persistence

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Artifact content/references persist and materialize deterministically without partial writes or cross-project leakage.
- First-principles root cause: The target lacks the fork Artifact Store.
- Core acceptance invariant: Create/read/update/delete are project-scoped and atomic; malformed/stale references fail without erasing valid content.
- Dependencies: none
- Dispatch order: Parallel storage wave A with issues 006 and 009; ownership and tests are disjoint, and no sibling consumes another sibling's output.
- Ownership: `packages/web/server/lib/interactive-ui/artifact-store.js`; `packages/web/server/lib/interactive-ui/artifact-store.test.js`.
- Focused verification: Focused artifact-store tests prove round-trip, isolation, stale/malformed handling, and failed-write preservation.
- Pi binding: batch `3280cee8-c9a0-4298-b0a9-c3da59940939`, lane `artifact-store`, run/session `f8c91fe7-56e1-43f2-af68-93338c35c7ba`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/f8c91fe7-56e1-43f2-af68-93338c35c7ba`, base `f7ba23f42445ef2f239c4973131d415481827c02`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact two-file donor port with no dependency/Git mutation, policy violation, or scope drift.
- Primary attempts: no implementation repair required; independently reran the focused test in candidate and integration and inspected bounds, canonical identity, publish ordering, corruption rebuild, and final-reference deletion paths.
- Current evidence: Integration is byte-identical to donor (`artifact-store.js` SHA-256 `4610d709...`, test `a76ce49d...`). Candidate and integrated tests each pass 15/15 with 73 assertions; combined storage wave passes 50/50 with 217 assertions; syntax and `git diff --check` pass. Missing/corrupt caches rebuild from the authoritative envelope and corrupt reference state fails closed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-008.
- Next action: Commit storage wave A, remove the settled lane worktree/run immediately, then consume this store from issue-008.

## issue-008: Restore Artifact and Business Gateway server routes

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Explicit OCIX routes expose artifact materialization and approved business requests before the generic OpenCode proxy.
- First-principles root cause: The clean target has no OCIX route contract; dashboard schema validation is restored independently by issue-057.
- Core acceptance invariant: Route order is explicit; auth/project/extension binding is authoritative; malformed and unauthorized requests fail closed; fetch failure never masquerades as empty success.
- Dependencies: issue-006, issue-007, issue-057
- Dispatch order: Serial after both authoritative stores.
- Ownership: `packages/web/server/lib/interactive-ui/routes.js`; `packages/web/server/lib/interactive-ui/routes.artifact.test.js`.
- Focused verification: Run focused route/artifact tests and inspect route registration order against the accepted dashboard contract.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09, and no issue-008 Pi worktree, session, run, or log was created.
- Pi attempts: none; direct primary/Luna execution is explicitly authorized.
- Primary attempts: Luna worker round 1 ported the frozen route surface. Primary acceptance then removed the donor's UI-only second auth gate in favor of the target's scope-aware global `/api` gate, narrowed session cleanup to exact session DELETE, and made missing Workbench storage fail closed before impact/credential/tile/uninstall mutation.
- Current evidence: Focused route acceptance passes 13/13 with tunnel/local global-auth composition, Workbench-unavailable zero-mutation, authoritative action binding, CSP/materialization, and failed/nested session-delete regressions. The complete Interactive UI server gate passed 195/195 before the final Agent Runtime hardening wave; syntax and diff checks pass, and a fresh read-only final reviewer returned SHIP. Packaged CORS session-header and URL-token resource allowlisting are explicitly carried into issue-014 integration ownership rather than hidden here.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-014 and Artifact UI work.
- Next action: Resolved; issue-011 may consume the route contract, while issue-014 owns real core-order/CORS/URL-token integration.

## issue-009: Restore Workbench persistence and versioning

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Project boards, tiles, layout, context, and link state persist authoritatively with deterministic version handling.
- First-principles root cause: The target lacks the Workbench store/version contract.
- Core acceptance invariant: Round-trip preserves board identity and layout; malformed/stale/future data is handled explicitly; failed reads/writes never clear valid state.
- Dependencies: none
- Dispatch order: Parallel storage wave A with issues 006 and 007; the four owned Workbench files form one persistence/version contract and do not overlap sibling storage authorities.
- Ownership: `packages/web/server/lib/interactive-ui/workbench-store.js`; `packages/web/server/lib/interactive-ui/workbench-store.test.js`; `packages/web/server/lib/interactive-ui/workbench-version.js`; `packages/web/server/lib/interactive-ui/workbench-version.test.js`.
- Focused verification: Run both focused test files; round-trip, version, malformed, missing-versus-empty, and failed-write cases pass.
- Pi binding: batch `3280cee8-c9a0-4298-b0a9-c3da59940939`, lane `workbench-store`, run/session `836de744-f5e4-4661-913e-2de0b6186bf1`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/836de744-f5e4-4661-913e-2de0b6186bf1`, base `f7ba23f42445ef2f239c4973131d415481827c02`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact four-file donor port, no dependency/Git mutation, policy violation, or scope drift.
- Primary attempts: no implementation repair required; independently reran both focused tests in candidate and integration and inspected version compatibility, CAS ordering, immutable snapshot identity, binding checks, corruption, size, and failed-publish paths.
- Current evidence: All four integration files are byte-identical to donor (`workbench-store.js` SHA-256 `bc0d60b6...`, test `2afebab7...`, version `7448f2a1...`, version test `a32a5785...`). Candidate and integrated tests each pass 25/25 with 89 assertions; combined storage wave passes 50/50 with 217 assertions; syntax and `git diff --check` pass. A stale revision or failed snapshot publish cannot move the authoritative Board pointer.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 038-042.
- Next action: Commit storage wave A and remove the settled lane worktree/run immediately; client/UI work remains in issues 038-044.

## issue-010: Restore the built-in Agent Runtime package

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The managed server installs and reloads the built-in OCIX Agent Runtime tools/skills without conflicts or external package requirements.
- First-principles root cause: The target has no built-in OCIX runtime package or loader.
- Core acceptance invariant: Tool/Skill assets are deterministic, conflict-safe, reloadable, and never overwrite unmanaged OpenCode files; missing/corrupt assets fail explicitly.
- Dependencies: issue-004, issue-061
- Dispatch order: Serial after package/manager contracts. This cohesive packaged fixture may own more than five asset files, but any change outside the built-in runtime asset/loader boundary requires replan before dispatch.
- Ownership: `packages/web/server/lib/interactive-ui/agent-runtime.js`; `packages/web/server/lib/interactive-ui/builtin-runtime.js`; `packages/web/server/lib/interactive-ui/builtin-runtime.test.js`; `packages/web/server/lib/interactive-ui/builtin/openchamber.extension.json`; `packages/web/server/lib/interactive-ui/builtin/ui/component-gallery.view.json`; `packages/web/server/lib/interactive-ui/builtin/ui/generated.view.json`; `packages/web/server/lib/interactive-ui/builtin/ui/process-flow.view.json`; `packages/web/server/lib/interactive-ui/builtin/agent-runtime/tools/interactive_ui.ts`; `packages/web/server/lib/interactive-ui/builtin/agent-runtime/tools/interactive_ui_gallery.ts`; `packages/web/server/lib/interactive-ui/builtin/agent-runtime/tools/html_artifact.ts`; `packages/web/server/lib/interactive-ui/builtin/agent-runtime/skills/html-artifact-design/SKILL.md`; `packages/web/server/lib/interactive-ui/builtin/agent-runtime/skills/interactive-ui-visualization/SKILL.md`.
- Focused verification: Run built-in runtime tests and inspect installed manifest/tool/skill hashes plus conflict/cleanup behavior.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09, and no issue-010 Pi worktree, session, run, or log was created.
- Pi attempts: none; direct primary/Luna execution is explicitly authorized.
- Primary attempts: Luna worker round 1 restored the built-in package and loader. The first fresh adversarial review rejected record-only restart authority, unsafe transaction ordering, swallowed atomic cleanup/rollback failures, cross-extension namespace collisions, source/target traversal, and incorrect Hosted version attribution. Primary repair made caller-supplied `previousAssets` the independent deletion authority, added strict records/transaction markers and asset-before-record commit ordering, bounded/contained all paths and inventories, surfaced rollback residue, and recorded the actual selected Local/Hosted version. A second fresh review then reproduced stale rollback deleting an externally replaced Tool; Luna correction round 2 added expected-post-deployment snapshots plus all-target rollback preflight, so conflicts preserve both user bytes and the recovery marker.
- Current evidence: Focused built-in Agent Runtime acceptance passes 17/17 with 70 assertions, covering exact built-in hashes, reload/idempotence, deterministic output, unmanaged Tool/Skill protection, missing/corrupt state, forged-record non-authority, restart cleanup, namespace conflicts, Local/Hosted source containment, Hosted `lastGood.version`, asset/record transaction ordering, temp residue, ancestor symlinks, visible rollback failure, and both newly-created and overwritten targets externally changed before rollback. The complete 12-file Interactive UI server gate passes 202/202; Web lint, node syntax, and `git diff --check` pass. A third fresh read-only final reviewer returned SHIP after independently rerunning 17/17 and auditing every prior blocker. No Sol/Pi session, run, worktree, or log was created.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-014.
- Next action: Resolved; issue-014 must persist and supply the exact authoritative `previousAssets` map across restart. Ownership records remain commit diagnostics and never independently authorize deletion.

## issue-011: Restore Direct Remote manifest connection and consent

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: A signed Remote Manifest URL plus Access Key can be inspected/connected with publisher identity, permission review, and consent preserved.
- First-principles root cause: The accepted target routes, signed Remote verifier, connection store, resource cache, and Hosted kernel exist, but the accepted Manager exposes neither `inspectRemote`/`connectRemote` nor a strict Remote shell/durable-state transaction. The original test-only ownership could never make those routes executable.
- Core acceptance invariant: Inspect does not fetch signed resources; manifest identity/signature/slot/key requests are request-bound; credentials remain server-side; installation-scoped consent is independently anchored without widening Local trust; stale capabilities, failed reconnects, and failure cleanup cannot overwrite/delete another owner's credential or filesystem path.
- Dependencies: issue-004, issue-005, issue-006, issue-008, issue-012, issue-058, issue-060, issue-062
- Dispatch order: Serial remote trust-domain lane before cache/update behavior.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`; `packages/web/server/lib/interactive-ui/routes.js`; `packages/web/server/lib/interactive-ui/routes.remote.test.js`; `packages/web/server/lib/interactive-ui/agent-runtime.js`; `packages/web/server/lib/interactive-ui/builtin-runtime.test.js`; `packages/web/server/lib/interactive-ui/DOCUMENTATION.md`; `packages/web/server/lib/interactive-ui/remote-ocix.js`; `packages/web/server/lib/interactive-ui/hosted-ocix.js`; `packages/web/server/lib/interactive-ui/connection-store.js`; `packages/web/server/lib/interactive-ui/remote-resource-cache.js`.
- Focused verification: Run focused Manager and Remote route tests against the accepted routes/verifier/store/cache contracts; prove inspect performs zero writes/resource fetches, connect always refetches and binds exact signature/publisher slot/fingerprint/manifest hash/connector/installation identity, credentials remain only in the server-side store, wrong confirmation and credential failure are zero-residue, stale rollback cannot delete a replacement, state/trust failure preserves the prior valid shell, and public/error output leaks no key, access key, path, or installation id.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09.
- Pi attempts: none
- Primary attempts: Primary replan expanded the impossible test-only ownership after proving the production Manager methods and strict Remote durable schema were absent. The narrow implementation then passed repeated adversarial review/fix waves: stale capability and credential-cleanup ownership, error/output sanitization, deterministic shell derivation, Agent Runtime Remote-source compatibility, cleanup path races, state+shell identity substitution, and Local/Remote mixed-lifecycle rollback. The final design never copied the donor Manager wholesale and never used Pi.
- Current evidence: Manager now implements write-free `inspectRemote` and request-bound `connectRemote`, exact confirmation/refetch, a strict per-version Remote state schema, private installation-scoped public key plus independent digest-only `remote-consents.json` anchor, deterministic metadata/Tool shell derivation, and a non-enumerable installation-bound credential capability. Global `trust.json` is never widened. Remote failure/rollback/uninstall does not rename, remove, or recursively delete shell paths; it removes active state/consent and retains an exact inactive reusable shell with truthful `cleanupPending`, and reuse requires a fresh confirmation plus a complete deterministic hash check. Local packages are rejected before write when an extension owns a Remote lifecycle, and rollback dispatches the target delivery's strict verifier. Route recovery rolls back a shell only after credential cleanup is explicitly safe, and fixed/allowlisted responses cannot expose Access Keys, installation IDs, paths, PEMs, or arbitrary runtime details. Agent Runtime resolves `delivery: remote` only from canonical `versionsDirectory`, even with a poisoned Hosted cache, and preserves existing containment/ownership/rollback invariants. Focused acceptance passes Manager 73/73 (433 assertions), Remote routes 9/9, and built-in Agent Runtime 18/18; the complete 13-file Interactive UI server gate passes 233/233. Focused ESLint, `lint:web`, node syntax, documentation static checks, and `git diff --check` pass. `type-check:web` remains blocked only by the separately recorded issue-054 missing `@modelcontextprotocol/ext-apps`. Fresh independent final reviews returned SHIP for Manager consent/data consistency, Remote filesystem cleanup, Remote routes, and Agent Runtime source isolation.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-013 and removes the Direct Remote prerequisite from issue-014.
- Next action: Resolved and checkpointed; per user instruction, stop before issue-013 until the model is adjusted.

## issue-012: Restore Remote resource cache, TTL, and hash validation

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Remote resources load lazily from a signed index, validate MIME/hash/size, and obey deterministic TTL/cache provenance.
- First-principles root cause: The target lacks the Remote resource cache authority boundary.
- Core acceptance invariant: Inspect performs zero resource fetches; first surface load validates exact signed identity; stale/poisoned/mismatched resources never replace valid cache; one failure does not erase unrelated resources.
- Dependencies: issue-058
- Dispatch order: Parallel dependency wave D with issue-060. It owns only the in-memory cache/test, issue-060 owns verifier/test-completion files, and neither consumes the sibling output.
- Ownership: `packages/web/server/lib/interactive-ui/remote-resource-cache.js`; `packages/web/server/lib/interactive-ui/remote-resource-cache.test.js`.
- Focused verification: Focused cache tests prove lazy fetch, hash/MIME/size rejection, TTL, provenance, partial failure, and valid-cache retention.
- Pi binding: batch `de3cf10c-71d3-40b1-8f0f-2689aec02ad1`, lane `remote-cache`, run/session `dd622d8b-5b2a-4338-9d3f-1994ac413aaa`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/dd622d8b-5b2a-4338-9d3f-1994ac413aaa`, base `581d980e439eb2d31d0e1e158787700ef52d781e`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact two-file donor port with no dependency/Git mutation, policy violation, or scope drift.
- Primary attempts: no implementation repair required; independently reran the focused suite and inspected exact subject keys, inclusive TTL/clock bounds, per-hit rehash, corruption-safe accounting/eviction, defensive copies, coalescing, failure isolation, and clear-vs-inflight epochs.
- Current evidence: Both files are byte-identical to donor (`remote-resource-cache.js` SHA-256 `d693b687...`, test `87bae3a9...`). Candidate and integration pass 18/18 with 135 assertions; combined Hosted/Remote/cache/package gate passes 55/55 with 287 assertions; syntax and `git diff --check` pass.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-013 and final Remote acceptance.
- Next action: Commit dependency wave D and clean the exact Pi worktree/run immediately; Manager integration may now consume the accepted cache.

## issue-013: Restore Remote health, update, and re-consent routing

- Status: RESOLVED
- Classification: BLOCKING
- Goal / user outcome: Connected Remote apps expose truthful health/update state and require re-consent when signed identity/permissions change.
- First-principles root cause: The target has no OCIX runtime health/update state machine and the accepted Manager lacks `checkRemoteUpdate`/`applyRemoteUpdate`; pure routing normalization is restored independently by issue-056.
- Core acceptance invariant: Health is request-bound; stale responses cannot overwrite newer state; changed publisher/permissions fail closed into re-consent; failed update preserves the prior runnable version. Remote failure/update cleanup must never unlink published hard links, pending journals, incomplete markers, or staging residue through a mutable path after asynchronous verification (authority-less residue is retained instead).
- Dependencies: issue-011, issue-012, issue-056
- Dispatch order: Serial after cache semantics.
- Ownership: `packages/web/server/lib/interactive-ui/runtime.js`; `packages/web/server/lib/interactive-ui/runtime.test.js`; the narrow Remote health/update/re-consent state additions in `packages/web/server/lib/interactive-ui/manager.js` and `packages/web/server/lib/interactive-ui/manager.test.js`; the issue-013 section of `packages/web/server/lib/interactive-ui/routes.remote.test.js`; the corresponding accepted-behavior update in `packages/web/server/lib/interactive-ui/DOCUMENTATION.md`.
- Focused verification: Focused Manager/runtime/route tests prove stale response ordering, request-bound health, update confirmation, publisher/key/permission re-consent, version reuse rejection, durable blocked state, and failure rollback preserving the prior runnable version. Cleanup containment is proven by parent-exchange adversarial tests that assert no path-based unlink of the three residue surfaces and intact outside sentinels.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09; issue-013 resume used full main-agent flow only.
- Pi attempts: none
- Primary attempts: Attempt 1 restored the donor-owned runtime pair and implemented the target-specific installation-scoped health/update/re-consent Manager and route seams. Its first fresh review found a required-update rollback bypass, in-place partial-candidate poisoning, unbounded public probe codes, and unbound blocked-catalog surfaces. Attempt 2 fixed those findings and hardened the HTTP boundary, then replaced candidate writes with staged/fsynced bytes, canonical exact pending/marker records, hard-link no-replace publication, inert pending siblings, and pre/post containment checks. Attempt 3 (2026-08-09, unlimited budget after user handoff) closed the remaining cleanup TOCTOU by removing validate-then-`unlink(path)` for published hard links, pending journals, and incomplete markers, retaining authority-less residue, and adding three parent-exchange adversarial regressions.
- Current evidence: `unlinkPublishedHardLink` / `clearRemotePendingCandidate` / `clearRemoteIncompleteMarker` (and any `fsImpl.unlink`) are absent from Manager. Staging is content-addressed and reusable; publication is no-replace hard-link; `applyRemoteUpdateState` failure path only rolls back consent and never unlinks shell/journal/marker/staging. DOCUMENTATION.md states residue retention. Focused gates (single concurrency): Manager 99/99; Manager+runtime+remote routes+artifact routes+resource cache 206/206. Three new tests `never deletes an outside file when…` pass with `raced === false` and outside sentinels intact. node `--check` syntax and `git diff --check` clean on Manager paths. Fresh independent read-only final reviewer returned **SHIP** for cleanup containment (subagent `019fe6f1-c260-7a21-a1b3-94ecca713406`). Residual: intentional inert residue growth (low/ops); Local install recursive `rm` remains out of Issue-013 Remote authority surface.
- Continuation decision: Unblocks issue-014 production wiring. Downstream clients must not treat residue files as authority.
- Next action: Resolved; proceed to issue-014 after refreshing its read-only implementation matrix against the accepted Manager/runtime/route files.

## issue-014: Register the OCIX runtime and capability before generic proxying

- Status: RESOLVED
- Classification: BLOCKING
- Goal / user outcome: Web/Electron managed runtimes initialize OCIX services once, expose `interactive-ui.ocix.v1`, and route explicit endpoints before the generic OpenCode proxy.
- First-principles root cause: The target lifecycle has no fork runtime factory, explicit route registration, or capability publication.
- Core acceptance invariant: Initialization is deterministic/fail-closed, route order is explicit, cleanup is complete, Agent Runtime deployment assets survive restart through one authoritative durable state seam, packaged/native artifact requests pass the same scope-aware auth contract (including CORS and exact URL-token resource allowlisting), and unsupported runtimes report a reduced capability instead of silent emptiness.
- Dependencies: issues 005-013, issue-061, issue-062
- Dispatch order: Final server integration seam after authoritative modules are accepted.
- Ownership: `packages/web/server/lib/opencode/feature-routes-runtime.js`; `packages/web/server/lib/opencode/feature-routes-runtime.test.js`; `packages/web/server/lib/opencode/core-routes.js`; `packages/web/server/lib/opencode/routes.js`; `packages/web/server/lib/opencode/routes.capabilities.test.js`; `packages/web/server/lib/interactive-ui/runtime.js`; `packages/web/server/lib/interactive-ui/runtime.test.js`; `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`; `packages/web/server/index.js`; `packages/web/server/lib/ui-auth/ui-auth.js`; `packages/web/server/lib/ui-auth/ui-auth.test.js`.
- Focused verification: Run focused feature-route/runtime/Manager/auth/capability-route tests; inspect explicit route-before-proxy ordering, managed Fork versus explicit external/reduced capability documents, local-versus-tunnel auth composition, packaged CORS preflight, URL-token resource access, restart/reconcile/cleanup, capability, and shutdown behavior. Records written beside Agent Runtime assets are diagnostics/commit records only and must never independently authorize deletion; the authoritative durable Manager/runtime state must supply the exact previous deployment asset set.
- Pi binding: not dispatched; full main-agent flow only.
- Pi attempts: none
- Primary attempts: Attempt 1 wired production adapters without copying donor Manager wholesale: durable `state.agentRuntime.assets`, Manager `initialize()`, feature-routes factory binding `normalizeExtensionManifest` + `reconcileOpenCodeAgentRuntime`, explicit Interactive UI route registration before other feature routes, packaged CORS `X-OpenChamber-Session-ID`, URL-token allowlists for native/installed/materialized artifact GETs, capability token `interactive-ui.ocix.v1`, and fixed credential capability mutate re-entry deadlock (verify installation under queue, then call credential runtime outside queue so authorizeExtensionAuthority can re-enter).
- Current evidence: feature-routes-runtime 7/7, request-security 3/3, ui-auth (URL-token interactive-ui paths), Manager 99/99 — combined 115/115 single concurrency. node `--check` on manager/feature-routes/ui-auth/request-security. DOCUMENTATION.md updated for production previousAssets seam. Global `/api` gate remains sole local/tunnel auth authority (routes do not add a second UI gate). Residual: OpenCode `/api/opencode/capabilities` managed-vs-reduced document for external CLI is still the upstream routes.js surface (not duplicated here); Hosted `refreshHosted` route still present for future Hosted work and is not exercised by the production Direct Remote path.
- Continuation decision: Unblocks issue-015+ client/runtime consumers of interactive-ui routes and capability.
- Next action: Resolved; proceed to suspended issue-022/030 or next READY items per issues.md dependency order.

## issue-015: Restore Interactive UI result and type schemas

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Agent-generated Interactive UI envelopes and shared descriptors parse into deterministic bounded types with safe fallback.
- First-principles root cause: The target has no OCIX result/type schema boundary; runtime error classification depends on the later client seam and is moved to issue-019.
- Core acceptance invariant: Valid envelopes round-trip; malformed/unknown/oversized data returns null and never exposes unvalidated layout/action data as a typed result.
- Dependencies: none
- Dispatch order: Parallel Shared UI schema wave E with issue-018; disjoint paths and independent tests, no shared generated artifacts or lockfiles.
- Ownership: `packages/ui/src/lib/interactive-ui/result.ts`; `packages/ui/src/lib/interactive-ui/result.test.ts`; `packages/ui/src/lib/interactive-ui/types.ts`.
- Focused verification: Run focused result tests and package UI typecheck; inspect malformed fallback behavior.
- Pi binding: batch `890c27e1-fefa-41a5-9a84-fc88db99182b`, lane `interactive-result`, run/session `d5225500-91ce-4f31-b22b-b78b60980d11`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/d5225500-91ce-4f31-b22b-b78b60980d11`, base `4619f4bd73232d855537f7b2802d13d6f28235a0`, revision 0, host PID 93898 at dispatch, supervised-local without sandbox.
- Pi attempts: correction 1 fixed UTF-8 byte semantics; correction 2 exhausted the Pi budget after implementing the early-exit shape but hanging in a scratch-only infinite probe. The probe did not modify repository files and the run was aborted with both PIDs null.
- Primary attempts: attempt 1 independently applied and verified the bounded early-exit repair; attempt 2 added durable exact-boundary and read-count regression tests and corrected this ledger after final-review feedback. No primary repair budget remains.
- Current evidence: Revision 0 failed UTF-8 sizing review; Pi correction 1 fixed byte semantics but not early exit; Pi correction 2 hung in scratch and was aborted. Primary fallback short-circuits after 1,048,577 ASCII code-unit reads, accepts exactly 1 MiB, rejects 1 MiB+1, and retains the multibyte regression. Final integrated verification passed 8/8 result tests, 33/33 combined wave tests, and `type-check:ui`; fresh final Sol review reported no code findings. The Pi worktree/run were cleaned and their absence verified.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 016, 021, and 026.
- Next action: Resolved; issue-016 and issue-017 may proceed from the committed integration base.

## issue-016: Restore bindings and generated-layout sanitization

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Declarative views bind only approved data/actions and sanitize generated layout before rendering.
- First-principles root cause: The target lacks OCIX binding and layout validation.
- Core acceptance invariant: Unknown paths/actions/primitives and malformed/oversized layouts fail closed; valid bindings preserve intended values without code execution.
- Dependencies: issue-015
- Dispatch order: Parallel Shared UI contract wave F with issue-017; paths are disjoint and both consume only committed issue-015 types.
- Ownership: `packages/ui/src/lib/interactive-ui/bindings.ts`; `packages/ui/src/lib/interactive-ui/bindings.test.ts`; `packages/ui/src/lib/interactive-ui/generatedLayout.ts`; `packages/ui/src/lib/interactive-ui/generatedLayout.test.ts`; `packages/ui/src/lib/interactive-ui/metricIcons.ts`.
- Focused verification: Run both focused tests and UI typecheck; all malformed and unauthorized cases reject deterministically.
- Pi binding: batch `a66627cb-bb8b-48d6-9dac-9a0a9311aa0d`, lane `bindings-layout`, run/session `2f972e96-320f-40f2-8477-50aea44107ac`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/2f972e96-320f-40f2-8477-50aea44107ac`, base `d2e0ae2fe5d80dba956f75bcae2ba1253ea3ab9e`, revision 0, host PID 7252 at dispatch, supervised-local without sandbox.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Pi revision 0 is policy-clean and byte-identical to donor for all five owned files; primary reran 14/14 focused tests, final integrated contract verification passed 61/61, `type-check:ui` passed, and two fresh Sol reviews found no issue-016 defect. The ended Pi worktree/run were cleaned and their absence verified.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 021-022.
- Next action: Resolved; downstream issues 021-022 remain gated by their other dependencies.

## issue-017: Restore Artifact and Installed Artifact result schemas

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Agent-generated and installed HTML Artifact envelopes remain distinct, validated, persistable, and safely fallback-capable.
- First-principles root cause: The target lacks both Artifact result contracts and their state model.
- Core acceptance invariant: Source identity and sandbox/business bindings cannot be confused; malformed/unknown payloads never cross into a more privileged renderer.
- Dependencies: issue-015
- Dispatch order: Parallel Shared UI contract wave F with issue-016; paths are disjoint and both consume only committed issue-015 types.
- Ownership: `packages/ui/src/lib/interactive-ui/artifactResult.ts`; `packages/ui/src/lib/interactive-ui/artifactResult.test.ts`; `packages/ui/src/lib/interactive-ui/installedArtifactResult.ts`; `packages/ui/src/lib/interactive-ui/installedArtifactResult.test.ts`.
- Focused verification: Run both schema test files and UI typecheck; cross-source and malformed cases fail closed.
- Pi binding: batch `a66627cb-bb8b-48d6-9dac-9a0a9311aa0d`, lane `artifact-result-schemas`, run/session `307c2b12-92dc-4f9a-84c2-f699005a61a2`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/307c2b12-92dc-4f9a-84c2-f699005a61a2`, base `d2e0ae2fe5d80dba956f75bcae2ba1253ea3ab9e`, revision 0, host PID 7253 at dispatch, supervised-local without sandbox.
- Pi attempts: correction 1 implemented raw-input bounded UTF-8 counters and expanded tests; correction 2 requested because its claimed synthetic early-exit tests only used ordinary padded strings and did not prove the counters stop at `limit + 1` reads.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Revision 0 was rejected for unbounded preflight work. Correction 1 implemented raw-input bounded UTF-8 counters but its early-exit evidence was inadequate. Correction 2 left production unchanged and added deterministic read-count tests proving short-circuit at cap+1 for both parsers. Final verification passed 14/14 focused Artifact tests, 61/61 combined contract tests, and `type-check:ui`; fresh Sol final review returned ACCEPT with no findings. The ended Pi worktree/run were cleaned and their absence verified.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 023-025 and 026.
- Next action: Resolved; downstream issues 023-026 remain gated by their other dependencies.

## issue-018: Restore MCP App host binding and persistable state

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: OpenChamber parses completed ToolPart MCP metadata into an exact host binding and a size-bounded persistable envelope.
- First-principles root cause: The target has no MCP App host state/binding module.
- Core acceptance invariant: Tool/server/resource/session/message/part identity remains exact; malformed or oversized model context/persisted state is rejected; diagnostics contain no secrets.
- Dependencies: OpenCode issue-006
- Dispatch order: Parallel Shared UI schema wave E with issue-015; the MCP binding/state module is self-contained and owns no path or interface consumed by its sibling.
- Ownership: `packages/ui/src/lib/interactive-ui/mcpApp.ts`; `packages/ui/src/lib/interactive-ui/mcpApp.test.ts`.
- Focused verification: Run focused MCP App UI tests and UI typecheck; all identity mismatch and size/error boundaries pass.
- Pi binding: batch `890c27e1-fefa-41a5-9a84-fc88db99182b`, lane `mcp-app-state`, run/session `c24d8c17-1209-4c30-9637-34f7ca6f3577`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/c24d8c17-1209-4c30-9637-34f7ca6f3577`, base `4619f4bd73232d855537f7b2802d13d6f28235a0`, revision 0, host PID 93899 at dispatch, supervised-local without sandbox.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Pi revision 0 is policy-clean and byte-identical to donor for both owned files; final integrated verification passed 25/25 MCP App tests, 33/33 combined wave tests, and `type-check:ui`. Three fresh Sol reviews reported no issue-018 findings. The Pi worktree/run were cleaned after PID/Pi PID became null and their absence was verified.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 028-029 and 026.
- Next action: Resolved; downstream issues 028-029 and 026 remain gated by their other dependencies.

## issue-019: Restore the browser OCIX manager client

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Settings and Workbench call explicit OCIX runtime APIs with correct runtime URL/auth switching and truthful failure semantics.
- First-principles root cause: The target has no shared client for OpenChamber-owned extension/runtime endpoints.
- Core acceptance invariant: Runtime switching invalidates stale requests; failures are not converted to empty authoritative state; credentials are never persisted or logged client-side.
- Dependencies: issue-014, issue-015, issue-017
- Dispatch order: Client seam before Settings/Workbench UI.
- Ownership: `packages/ui/src/lib/interactive-ui/client.ts`; `packages/ui/src/lib/interactive-ui/state.ts`; `packages/ui/src/lib/interactive-ui/artifactState.ts`; `packages/ui/src/lib/interactive-ui/extensionManager.ts`; `packages/ui/src/lib/interactive-ui/extensionManager.test.ts`.
- Focused verification: Run extension-manager client tests and UI typecheck; request fidelity, switching, failed fetch, and cleanup pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Files are donor-only and must use target RuntimeAPIs primitives.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-024 and issues 035-042.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-020: Restore routing and remote-review client state

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Applications UI displays request-bound routing traces and Remote permission review without stale or credential-bearing state.
- First-principles root cause: The target lacks fork routing inspector and Remote review client contracts.
- Core acceptance invariant: Newer request IDs win; failed/cancelled/closed review clears key state; visible diagnostics are safe and failed fetch is not an empty success.
- Dependencies: issue-013, issue-019
- Dispatch order: Client state before Settings sections.
- Ownership: `packages/ui/src/lib/interactive-ui/remoteReview.ts`; `packages/ui/src/lib/interactive-ui/remoteReview.test.ts`; `packages/ui/src/lib/interactive-ui/routingInspector.ts`; `packages/ui/src/lib/interactive-ui/routingInspector.test.ts`; `packages/ui/src/lib/interactive-ui/routing.ts`.
- Focused verification: Run remote-review and routing-inspector tests plus UI typecheck; stale request, cancel/close, non-retention, and failure cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Five donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-035.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-021: Restore the Declarative Interactive UI renderer

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Valid Agent Generated and Installed Declarative views render with approved primitives, bindings, actions, state notices, and no horizontal overflow.
- First-principles root cause: The target has no Declarative host renderer.
- Core acceptance invariant: Only sanitized layouts/primitives/actions render; malformed/stale/error states remain explicit; one failed widget cannot erase unrelated content.
- Dependencies: issue-015, issue-016, issue-022
- Dispatch order: Renderer after schemas/bindings.
- Ownership: `packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx`; `packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIStateNotice.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIStateNotice.test.tsx`.
- Focused verification: Run Declarative/state-notice tests and UI typecheck; inspect malformed, action, narrow-layout, and overflow boundaries.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Five feature-owned donor files; `DeclarativeInteractiveView.tsx` imports issue-022's suspended `DeclarativeAdvancedPrimitives.tsx`, while `InteractiveUIView.tsx` imports the suspended native registry. Final donor behavior also includes Host Confirmation carry-forward and must be reconciled with issue-025.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-026.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-022: Restore Trusted Native and Host Native UI Kit

- Status: RESOLVED
- Classification: BLOCKING
- Goal / user outcome: Trusted Native OCIX views render only registered components with the Style v2 token contract.
- First-principles root cause: The target lacks native registries and UI Kit.
- Core acceptance invariant: Unknown components/props/actions fail closed; registered primitives receive scoped tokens and cannot escape the host authority boundary. Scope dispose installs the replacement `currentScope` before invoking old disposers; loads check authority generation after token refresh and before URL construction/import as well as after import.
- Dependencies: issue-015, issue-016
- Dispatch order: Parallel feature contract wave G with issue-030; paths and protocols are disjoint and shared schemas are frozen.
- Ownership: `packages/ui/src/components/interactive-ui/NativeUIKit.tsx`; `packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx`; `packages/ui/src/components/interactive-ui/nativeRegistry.ts`; `packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts`; `packages/ui/src/components/interactive-ui/DeclarativeAdvancedPrimitives.tsx`; narrow authority-generation seam in `packages/ui/src/lib/runtime-url.ts` required to distinguish A→B→same-A resolver reinstalls.
- Focused verification: Run NativeUIKit tests and UI typecheck; unknown registry/prop/action cases reject and scoped tokens render.
- Pi binding: not used for the 2026-08-09 resume; full main-agent flow only.
- Pi attempts: prior two corrections exhausted under old budget (see history below).
- Primary attempts: Prior attempts 1–2 under Pi budget (see suspension history). Attempt 3 (2026-08-09 unlimited handoff): (a) `scopeFor` installs the new scope before `disposeScope` so re-entrant loads bind to the live authority; (b) `assertScopeAuthority` after auth refresh, before URL construction, and after import; (c) regressions for refresh-time A→B and disposer re-entrancy during dispose.
- Current evidence: `bun test packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx` → **32/32** (including new refresh-generation and dispose re-entrancy cases). Prior High defects closed by design change + deterministic tests.
- Continuation decision: Unblocks issue-026 and Trusted Native/Style acceptance paths that depended on host-authority invariants.
- Next action: Resolved; do not reopen Native registry dispose/authority paths without a new defect report.

## issue-023: Restore the HTML Artifact sandbox bridge

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: HTML Artifacts communicate through a versioned, size/rate-limited host bridge without direct business or privileged API access.
- First-principles root cause: The target lacks the Artifact bridge parser/host-init boundary.
- Core acceptance invariant: Origin/version/type/size/rate violations fail closed; Agent Generated content cannot invoke business APIs; safe messages preserve exact request identity.
- Dependencies: issue-017
- Dispatch order: Security bridge before Artifact view.
- Ownership: `packages/ui/src/lib/interactive-ui/artifactBridge.ts`; `packages/ui/src/lib/interactive-ui/artifactBridge.test.ts`.
- Focused verification: Run bridge tests and UI typecheck; malformed, rate, size, origin, business-authority, and safe-init cases pass.
- Pi binding: run/session `79b71ec9-e8d8-47d9-84aa-f813e51f8973`, base `8f8c0b5d5d3cabcc84e79df97f962de61e81e86a`, final revision 2, supervised-local without sandbox. Revision 0 reached `ready` with host/Pi PIDs null and was content-hash-identically integrated. Its temporary state was cleaned too early; to preserve the plugin-mandated same-run correction boundary, the exact run/session ID and candidate worktree were minimally rehydrated at the same base and hashes before correction 1. No replacement run was created and the attempt counter remained zero until the correction call. Revision 2 settled `needs-attention` with host/Pi PIDs null; after its policy-clean partial diff was hash-integrated and the attempt budget exhausted, the exact worktree and run/session directory were deleted and absence verified.
- Pi attempts: correction 1 requested after fresh Sol/High and primary reproductions proved non-atomic proxy rereads, structured-clone-preserved array expando size bypasses, unbounded lease passthrough, invalid limit/clock rate-limit bypasses, and a nullable success-result response that leaves requests uncorrelated. Correction 2 (final Pi attempt) requested after primary inspection proved correction 1 still rereads top-level builder inputs: stateful root proxies produced 100,000-character `channelId` values in both host-init and result fallback messages. Its claimed payload-proxy regression wrapped the wrong object, ordinary sparse arrays were over-rejected, the two rate windows shared one clock, and `__proto__` token copying was not own-data safe.
- Primary attempts: attempt 1 after Pi exhaustion fixed the remaining invalid-options semantic gap: an explicitly present non-number rate limit or non-object options value previously fell back to the default allowance instead of failing closed. The exact edit makes non-plain/non-object options and present non-number descriptors resolve to CAPTURE_FAILED; focused verification passed 47/47 with 145 assertions. Attempt 2 (final) replaced five test-only matchers unsupported by the repository's Bun type declarations with equivalent boolean/try-catch assertions; the full ten-file suite passes 165/165 with 549 assertions, and UI typecheck now reports only the pre-existing issue-054 missing `@modelcontextprotocol/ext-apps` dependency. No primary repair attempts remain.
- Current evidence: Revision 0 restored the pure bridge and passed its initial tests but fresh Sol returned `fix-first` on five adversarial boundaries. Correction 1 fixed the deep parser snapshot, array expandos, lease reconstruction, invalid rate config/time, and correlated oversized-success failure but left top-level builder TOCTOU. Correction 2 exhausted Pi retries and settled `needs-attention` without handoff after policy-clean partial edits; its content-hash-identical candidate supplied root captures, complete-message caps, independent clocks, sparse handling, and actual proxy regressions. After two bounded primary repairs, independent reproductions return captured payload text `short`, 189/273-byte business/host root-proxy messages, reject array expandos, and deny invalid limits. The focused bridge suite passes 47/47; the ten-file suite passes 165/165; `git diff --check` passes; candidate-owned TypeScript errors are zero and only issue-054's missing `@modelcontextprotocol/ext-apps` remains. A new fresh Sol/High final reviewer returned `ship` with no actionable issue-023 findings; residual nullable host-init handling is explicitly assigned to dependent issue-024.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-024 and issue-025.
- Next action: Commit only the accepted bridge files and this ledger update; queue issue-024 from the resulting immutable base while preserving its explicit nullable host-init handling requirement.

## issue-024: Restore the Agent Generated HTML Artifact host

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Agent Generated HTML renders in the intended sandbox with explicit loading/error/stale state and stable execution surface.
- First-principles root cause: The target has no Artifact view/state host.
- Core acceptance invariant: Sanitized content stays sandboxed, failure is visible, frame lifecycle is deterministic, and no business/native privilege is available.
- Dependencies: issue-017, issue-019, issue-023
- Dispatch order: Host after schema/bridge.
- Ownership: `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactStateNotice.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactStateNotice.test.tsx`; `packages/ui/src/components/interactive-ui/DOCUMENTATION.md`.
- Focused verification: Run state/Artifact focused tests and UI typecheck; inspect sandbox flags, error/fallback, remount, and privilege boundary.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Source reconciliation proves every safe donor generation of the host depends on `materializeHTMLArtifact` and the typed `artifactState` classifier owned by issue-019. Rendering `envelope.html` directly would bypass the server materialization/sanitization boundary, while importing the donor modules before issue-019 would leave the package uncompilable. Later donor revisions also mix Installed Artifact, Business Gateway, Workbench, routing-observer, and Electron Runner responsibilities, so whole-file donor copying remains excluded.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-025 and issue-026.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-025: Restore Installed Artifact host confirmation write safety

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Third-party Installed Artifacts can request business writes only through a host-top-layer confirmation with Cancel as safe focus and exactly one write after Confirm.
- First-principles root cause: The clean target lacks the Installed Artifact confirmation host; the latest implementation exists only as an uncommitted descendant donor.
- Core acceptance invariant: Escape/Cancel perform zero upstream writes and preserve authoritative pending state; Confirm performs exactly one request-bound write; popup cannot be trapped inside the sandbox; secrets never enter the frame.
- Dependencies: issue-006, issue-017, issue-019, issue-023, issue-024
- Dispatch order: Serial security/UI lane after gateway and Artifact host. It explicitly does not resume suspended issue-001.
- Ownership: `packages/ui/src/components/interactive-ui/InstalledArtifactConfirmationHost.tsx`; `packages/ui/src/components/interactive-ui/InstalledArtifactConfirmationHost.test.tsx`; `packages/ui/src/components/interactive-ui/InteractiveConfirmationDialog.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`; `packages/ui/src/components/interactive-ui/artifactBusinessRequest.ts`.
- Focused verification: Run Installed Artifact host tests and conversation-browser Confirm/Escape/Cancel evidence; exactly 0/0/1 writes and host-top-layer focus are required.
- Pi binding: batch `253e064d-9f86-4be5-b110-cf74637a8c22`, run `5e4a19e6-e6f5-4ada-ac68-276ba696223d`, base `eb9ce926`, final revision 2; policy-clean one-file handoff.
- Pi attempts: Correction 1 implemented the exact adapter but overran without handoff; correction 2 made no edits and immediately formalized the existing candidate. Pi retry budget exhausted cleanly.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Resolved 2026-08-10. Target DialogContent now exposes only an optional BaseDialog portal container, destructures it before popup prop spread, and keeps `undefined` as the original body-portal default. No retained confirmation file required modification. Primary independently ran confirmation/installed-host tests **27/27**, covering Cancel/Confirm and fail-closed lifecycle behavior, plus `git diff --check`.
- Suspension decision: n/a; only issue-001/002/003 remain suspended
- Resume condition: n/a
- Continuation decision: Enables issue-026/027 and final product acceptance.
- Next action: Resolved; include real top-layer confirmation behavior in final browser acceptance.

## issue-026: Add narrow rich-result dispatch to the target ToolPart

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Target-release ordinary Tool UI remains intact while completed OCIX, Artifact, Installed Artifact, and MCP App results select the correct lazy renderer and preserve raw fallback.
- First-principles root cause: The upstream ToolPart knows none of the fork envelopes/metadata, while the donor ToolPart contains large unrelated UI drift.
- Core acceptance invariant: Only exact validated bindings select rich renderers; unknown/malformed content uses upstream fallback; ordinary Tool typography/expansion stays target-owned; persistence/Pin observations retain exact identity.
- Dependencies: issues 015-025, issue-028, issue-029
- Dispatch order: Late serial host seam after every renderer contract freezes.
- Ownership: `packages/ui/src/components/chat/message/parts/ToolPart.tsx`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.ts`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.test.ts`.
- Focused verification: Run helper/renderer dispatch tests, UI typecheck/lint, and inspect diff against `v1.18.1` to prove only adapter/state logic was added.
- Pi binding: batch `253e064d-9f86-4be5-b110-cf74637a8c22`, run `8cbac29c-52b7-4ceb-a8b1-9071762a0042`, base `eb9ce926`, final revision 1; policy-clean formal handoff.
- Pi attempts: Correction 1 only finalized the already complete revision-0 candidate after primary recoverably paused an overlong verification turn; no code changed in correction.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Resolved 2026-08-10. The immutable v1.18.1 helper is restored byte-identically beside the fork rich-result predicates; five boundary tests cover non-glob isolation, whitespace, exact description preservation, normalized names, and invalid input. Primary independently ran ToolPart/helper tests **38/38** and `git diff --check`. Pi's controlled typecheck delta removed exactly the owned missing-export error with no new error.
- Suspension decision: n/a; collapsed-focus issue-001 stays suspended
- Resume condition: n/a
- Continuation decision: Enables conversation/browser acceptance.
- Next action: Resolved; include ToolPart in final retained UI gates.

## issue-027: Restore message-level default-open rich-result state

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Completed rich results open by default once, remain user-collapsible, and keep mounted execution state through message rerenders.
- First-principles root cause: StrictMode/toggle auto-expansion can race and collapse a new Artifact; module-global memory is also incorrect across message lifecycles.
- Core acceptance invariant: Default-open is bounded to message/ToolPart identity; user collapse is respected; frame/host remains mounted; no module-global Set leaks identity. Suspended inert behavior is not silently implemented.
- Dependencies: issue-026
- Dispatch order: Serial after ToolPart adapter because it shares state/host files.
- Ownership: `packages/ui/src/components/chat/ChatContainer.tsx`; `packages/ui/src/components/chat/ChatMessage.tsx`; `packages/ui/src/components/chat/message/parts/ToolPart.tsx`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.ts`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.test.ts`.
- Focused verification: Focused state tests plus browser default-open/collapse/re-expand/frame-identity check; inspect absence of module-global expansion Set.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Latest uncommitted donor passes default-open/host-preservation E2E; final reviewer only rejected the separately suspended inert boundary.
- Suspension decision: n/a; issue-001 remains excluded
- Resume condition: n/a
- Continuation decision: Enables final conversation-browser acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-028: Restore MCP AppBridge rendering and lifecycle

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: A validated MCP App resource initializes in a sandboxed broker iframe, exchanges model context/host calls, supports display modes, and tears down deterministically.
- First-principles root cause: The target has no MCP App renderer/AppBridge host.
- Core acceptance invariant: Readiness and teardown ordering are deterministic; App-only calls use bound backend authority; CSP/permissions/display/model-context limits fail closed; errors are isolated and safe.
- Dependencies: issue-018, OpenCode issue-005
- Dispatch order: Renderer after backend and binding contracts.
- Ownership: `packages/ui/src/components/interactive-ui/McpAppRenderer.tsx`; `packages/ui/src/components/interactive-ui/McpAppRenderer.test.ts`.
- Focused verification: Run MCP App renderer tests and UI typecheck; readiness, teardown, display, tool-call, model-context, and failure cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Two donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-026 and tldraw acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-029: Restore OpenCode capability and MCP App client wrappers

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Shared UI reads the fork capability document and performs exact MCP App resource/tool-call requests across supported runtimes.
- First-principles root cause: Target `opencode/client.ts` lacks fork API gaps and runtime capability diagnostics.
- Core acceptance invariant: Request parameters preserve session/message/part/tool/server/resource identity; managed fork vs external legacy capability is explicit; failure is diagnostic, never silent empty.
- Dependencies: OpenCode issues 005-006 and the accepted OpenCode issue-011 SDK regeneration, issue-014, issue-018
- Dispatch order: Serial client seam before renderer/ToolPart acceptance.
- Ownership: `packages/ui/src/lib/opencode/client.ts`; matching focused client tests discovered in the target package before dispatch.
- Focused verification: Run focused client tests and UI typecheck; inspect exact session/message/part/tool/server/resource fidelity through scoped Fork SDK methods, managed-versus-explicit-reduced capability behavior, runtime-base reconnection, AbortSignal forwarding, and bounded diagnostic errors.
- Pi binding: batch `d82216c1-d5c3-4f02-b92f-ff4dd99c3f90`, run `9b812839-db5a-4ad1-983d-6b8b5b301439`, base `d9f6632f`, final revision 2.
- Pi attempts: Correction 1 replaced the false generated-SDK serializer assumption with identity-complete runtime transport while retaining SDK capability/method gating; correction 2 added exact request, signal, persistence, absence, and failure regressions. Pi retry budget exhausted cleanly with a formal handoff.
- Primary attempts: No implementation attempt; primary integrated the byte-identical Pi candidate and independently reran the focused gate.
- Current evidence: Resolved 2026-08-10. `getDistributionCapabilities` and message-part operations use the fork SDK. Because installed fork SDK `1.18.10-oc.1` omits `partID`/`toolKey` from its MCP App serializers, MCP resource/tool calls deliberately use the runtime-scoped HTTP seam after checking generated SDK method availability, preserving the exact directory/session/message/part/server/resource/tool identity and `AbortSignal`. `bun test packages/ui/src/lib/opencode/` passes **17/17**; full UI typecheck errors fell **255 → 248**, with all seven owned client-contract errors removed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 028 and 026.
- Next action: Resolved; downstream renderer/ToolPart acceptance may consume the restored wrapper contract.

## issue-030: Restore Generative Widget parsing and sanitization

- Status: RESOLVED
- Classification: BLOCKING
- Goal / user outcome: Streaming/final `show-widget` fences parse deterministically and produce sandbox-safe HTML/CSS/JS under fixed CSP/allowlist limits.
- First-principles root cause: The target has no Generative Widget wire parser or sanitizer.
- Core acceptance invariant: Partial fences do not leak raw executable content; malformed/oversized/disallowed URLs/CSP/connect behavior fail closed; finalized valid widgets persist identically. Truncated JSON decodes only the still-open `widget_code` string and rejects completed non-string `title` values.
- Dependencies: OpenCode issue-007
- Dispatch order: Parallel feature contract wave G with issue-022; paths and protocols are disjoint and the OpenCode prompt contract is committed.
- Ownership: `packages/ui/src/lib/generative-widget/parseShowWidget.ts`; `packages/ui/src/lib/generative-widget/parseShowWidget.test.ts`; `packages/ui/src/lib/generative-widget/sanitizer.ts`; `packages/ui/src/lib/generative-widget/sanitizer.test.ts`.
- Focused verification: Run parser/sanitizer tests and UI typecheck; streaming, malformed, CSP, allowlist, and size cases pass.
- Pi binding: not used for the 2026-08-09 resume; full main-agent flow only.
- Pi attempts: prior two corrections exhausted under old budget.
- Primary attempts: Prior attempts 1–2 under Pi budget. Attempt 3 (2026-08-09 unlimited handoff): rewrote `extractTruncatedWidget` with escape-aware JSON string reading, complete non-string title fail-closed, and exact Sol reviewer regressions plus partial→final identity.
- Current evidence: `bun test packages/ui/src/lib/generative-widget/parseShowWidget.test.ts` → **15/15** (was 12 + 3 new truncated cases). Combined with NativeUIKit **47/47**. Sanitizer suite unchanged this wave (DOMPurify path already accepted previously).
- Continuation decision: Unblocks issues 031-034 and final Generative Widget acceptance that depend on deterministic wire parse.
- Next action: Resolved; proceed to READY consumers (031+) as scheduled.

## issue-031: Restore Generative Widget runtime bridges and height cache

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Widget frames receive scoped theme/CSS, bounded height state, and a narrow send-message callback without direct business access.
- First-principles root cause: The target lacks the Widget receiver/bridge/cache modules.
- Core acceptance invariant: Theme/height/send messages are origin/type/size/rate checked; cached height is identity-scoped; teardown removes handlers; frame cannot call arbitrary APIs.
- Dependencies: issue-030
- Dispatch order: Runtime bridge before renderer/ChatInput seam.
- Ownership: `packages/ui/src/lib/generative-widget/cssBridge.ts`; `packages/ui/src/lib/generative-widget/heightCache.ts`; `packages/ui/src/lib/generative-widget/sendMessageBridge.ts`; `packages/ui/src/lib/generative-widget/index.ts`.
- Focused verification: Run owning focused tests discovered before dispatch plus UI typecheck; inspect cleanup, rate/size, scope, and stale height behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Four donor-only modules; test ownership must be frozen in the task packet.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 032 and 034.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-032: Restore the Generative Widget renderer

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Streaming and persisted widgets render in an isolated iframe with target-release toolbar/theme primitives and explicit malformed/error states.
- First-principles root cause: The target has no Widget renderer components.
- Core acceptance invariant: Streaming finalization does not remount incorrectly; sandbox/CSP/error isolation remain intact; pure fork branding does not return.
- Dependencies: issue-030, issue-031
- Dispatch order: Renderer after parser and bridges.
- Ownership: `packages/ui/src/components/chat/generative-widget/WidgetRenderer.tsx`; `packages/ui/src/components/chat/generative-widget/WidgetRenderer.test.tsx`; `packages/ui/src/components/chat/generative-widget/WidgetErrorBoundary.tsx`; `packages/ui/src/components/chat/generative-widget/MalformedWidgetNotice.tsx`; `packages/ui/src/components/chat/generative-widget/renderAssistantTextWithWidgets.tsx`.
- Focused verification: Run WidgetRenderer tests and UI typecheck/lint; inspect streaming/finalize/remount, sandbox, toolbar, and error behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Five donor-only files; decorative dot background is explicitly excluded.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-033.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-033: Add the narrow Widget dispatch to target AssistantTextPart

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Assistant text containing a `show-widget` fence routes through the Widget renderer before ordinary Markdown/JSON handling, while all other text keeps target UI behavior.
- First-principles root cause: The target AssistantTextPart has no wire-format dispatch seam.
- Core acceptance invariant: Exact fence detection selects Widget rendering; non-widget/malformed ordinary content retains upstream renderer behavior; no donor typography/chrome is copied.
- Dependencies: issue-032
- Dispatch order: Serial host seam after renderer.
- Ownership: `packages/ui/src/components/chat/message/parts/AssistantTextPart.tsx`; one focused dispatch test if target precedent supports it.
- Focused verification: Focused dispatch test, UI typecheck/lint, and diff review against target file.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Donor has one priority branch; target file is upstream-active.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables Widget conversation acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-034: Add the narrow Widget send bridge to target ChatInput

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: `window.__widgetSendMessage` follow-ups use the current session/provider/model/agent/variant through the normal send path.
- First-principles root cause: The target ChatInput does not register the Widget send handler.
- Core acceptance invariant: The bridge is bounded and cleaned up; it never sends without current authoritative context or lets the iframe call APIs directly; ordinary ChatInput behavior remains target-owned.
- Dependencies: issue-031, issue-069
- Dispatch order: Serial host seam after bridge and composer-prefill contracts.
- Ownership: `packages/ui/src/components/chat/ChatInput.tsx`; one focused bridge lifecycle test if target precedent supports it.
- Focused verification: Focused bridge lifecycle test plus UI typecheck/lint; inspect current-context fidelity and cleanup.
- Pi binding: run/session `7b0903dc-e7d8-4fd9-8253-2a607152c47f`, batch `dca705e2-05ca-45ac-8890-bf7059cc1a45`, base `74699f8ed24a856b454a27694f9c1c9702bea9fd`, final revision 1, supervised-local without sandbox; policy-clean with exactly one changed owned path.
- Pi attempts: correction 1 removed four inherited v1.18.1 trailing spaces after primary proved they were newly introduced relative to integration HEAD and failed the repository diff gate; adapter logic was unchanged.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: The accepted file is immutable upstream v1.18.1 ChatInput plus only the Generative Widget send-handler import/effect, the bounded composer-prefill effect, and removal of four upstream trailing spaces. The send bridge reads session/provider/model/agent/variant from authoritative stores at call time, uses the normal target send path, and cleans up deterministically; prefill is session-scoped and returns the event disposer. Primary matched final blob `f7f03da8`, ran composer event tests **14/14**, and measured UI typecheck at **260** errors (down from 266) with no ChatInput or `MobileSessionStatusBar` error/reference. `git diff --check` is clean.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables Widget model E2E.
- Next action: Resolved; later canonical Web/Electron build must prove the former module-2348 failure is gone end to end.

## issue-035: Restore Applications settings feature sections

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Applications settings exposes extension install/update/rollback, signed Remote review, routing diagnostics, and Style preset controls without reintroducing donor-wide settings chrome.
- First-principles root cause: The target release has no OCIX-specific Applications sections.
- Core acceptance invariant: Every action uses the authoritative clients, surfaces failures truthfully, retains no access key, and renders with target-release controls/layout.
- Dependencies: issue-019, issue-020, issue-048
- Dispatch order: Feature-owned sections before narrow Settings registration.
- Ownership: `packages/ui/src/components/sections/interactive-ui/ExtensionManagerPage.tsx`; `packages/ui/src/components/sections/interactive-ui/RoutingInspectorSection.tsx`; `packages/ui/src/components/sections/interactive-ui/StylePresetSection.tsx`.
- Focused verification: UI typecheck plus focused client/component tests; inspect connect/cancel/close/update failure and secret non-retention.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Three feature-owned donor additions are absent from target.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-036.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-036: Register Applications settings without replacing upstream settings UI

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Desktop and mobile users can reach the OCIX Applications surface through upstream settings navigation and search.
- First-principles root cause: Target settings metadata/navigation knows no OCIX section; donor files also contain unrelated UI drift.
- Core acceptance invariant: One narrow Applications registration works in desktop/mobile/search; every unrelated target section, route, label, spacing, and behavior remains unchanged.
- Dependencies: issue-035
- Dispatch order: Narrow host seam after feature sections.
- Ownership: `packages/ui/src/components/views/SettingsView.tsx`; `packages/ui/src/lib/settings/metadata.ts`; `packages/ui/src/lib/settings/search.ts`; `packages/ui/src/apps/MobileApp.tsx`.
- Focused verification: Focused settings/search tests, UI typecheck/lint, and line-level diff against `v1.18.1`.
- Pi binding: batch `253e064d-9f86-4be5-b110-cf74637a8c22`, run `74ab8de9-bf6b-4b11-a373-4af810b02c8b`, base `eb9ce926`, revision 1; policy-clean formal handoff.
- Pi attempts: Correction 1 completed the bounded additive registration after revision 0 ended on provider error without file changes.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Resolved 2026-08-10. Applications is registered once in target metadata and through exactly seven retained search entries; SettingsView supplies the existing Windows ARM64 predicate while target search items and availability gates remain intact. Primary matched all four Pi candidate hashes and independently ran the new focused suite **8/8** with 29 expectations plus `git diff --check`. The next combined typecheck verifies the six-error delta.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables user-facing OCIX configuration acceptance.
- Next action: Resolved; include Applications navigation/search in final UI acceptance.

## issue-037: Add only fork-required localization keys

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Fork Applications, Workbench, Artifact, MCP App, and Widget surfaces have complete supported-locale labels while upstream wording remains target-owned.
- First-principles root cause: New fork surfaces require keys absent from target locale modules.
- Core acceptance invariant: All supported locales have an identical fork-key set, no unrelated target string changes, and missing keys fail the locale test. This single localization domain may exceed five files; no non-locale file may enter the lane.
- Dependencies: issue-035, issue-041, issue-047
- Dispatch order: After visible contracts freeze, before final UI acceptance.
- Ownership: `packages/ui/src/lib/i18n/messages/en.ts`; `packages/ui/src/lib/i18n/messages/en.settings.ts`; `packages/ui/src/lib/i18n/messages/zh-CN.ts`; `packages/ui/src/lib/i18n/messages/zh-CN.settings.ts`; `packages/ui/src/lib/i18n/messages/zh-TW.ts`; `packages/ui/src/lib/i18n/messages/zh-TW.settings.ts`; `packages/ui/src/lib/i18n/messages/ja.ts`; `packages/ui/src/lib/i18n/messages/ja.settings.ts`; `packages/ui/src/lib/i18n/messages/ko.ts`; `packages/ui/src/lib/i18n/messages/ko.settings.ts`; `packages/ui/src/lib/i18n/messages/de.ts`; `packages/ui/src/lib/i18n/messages/de.settings.ts`; `packages/ui/src/lib/i18n/messages/es.ts`; `packages/ui/src/lib/i18n/messages/es.settings.ts`; `packages/ui/src/lib/i18n/messages/fr.ts`; `packages/ui/src/lib/i18n/messages/fr.settings.ts`; `packages/ui/src/lib/i18n/messages/pl.ts`; `packages/ui/src/lib/i18n/messages/pl.settings.ts`; `packages/ui/src/lib/i18n/messages/pt-BR.ts`; `packages/ui/src/lib/i18n/messages/pt-BR.settings.ts`; `packages/ui/src/lib/i18n/messages/uk.ts`; `packages/ui/src/lib/i18n/messages/uk.settings.ts`; `packages/ui/src/lib/i18n/messages.test.ts`.
- Focused verification: Run locale key-parity tests, UI typecheck, and review a key-only diff against target.
- Pi binding: batch `d82216c1-d5c3-4f02-b92f-ff4dd99c3f90`, run `c8f4766c-74d0-46d8-8969-4fc2f2e623bb`, base `d9f6632f`, final revision 2.
- Pi attempts: Correction 1 was lost to repeated provider 429 responses without file changes; correction 2 mechanically rebuilt all 22 locale modules from immutable `v1.18.1` plus the referenced retained-fork inventory and extended parity coverage. Pi retry budget is exhausted with a policy-clean formal handoff.
- Primary attempts: After Pi retries were exhausted, primary made two test-only matcher corrections: first removing Bun's unsupported two-argument `expect`, then replacing unsupported asymmetric matcher typing with a direct truthiness assertion. No production locale content changed.
- Current evidence: Resolved 2026-08-10. Every locale contains the exact **5,021** target keys and values plus the same **309** referenced fork keys (88 main, 221 settings); all target values are byte-identical to tag `ce519219`, and 56 unreferenced donor-only keys are absent. Main-worktree locale plus terminal rerun passes **6/6** with 157 expectations, missing-key `TS2345` is **0**, and the complete UI typecheck now passes with **0 errors**.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final settings/workbench acceptance.
- Next action: Resolved; continue with the 15 non-locale target host seams and final acceptance.

## issue-038: Restore Workbench shared client state

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Boards and tiles load, mutate, focus, pin, and persist through one authoritative project-scoped client store.
- First-principles root cause: Target has no Workbench client/store.
- Core acceptance invariant: Runtime/project switching cancels stale work; failed load is not empty success; optimistic mutations reconcile or roll back; subscriptions clean up.
- Dependencies: issue-009, issue-019
- Dispatch order: Client/store before layout and view.
- Ownership: `packages/ui/src/stores/useExtensionWorkbenchStore.ts`; `packages/ui/src/stores/useExtensionWorkbenchStore.test.ts`; `packages/ui/src/lib/interactive-ui/workbench.ts`.
- Focused verification: Run focused store tests and UI typecheck; stale switching, rollback, persistence, and cleanup pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  All three files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 039-041.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-039: Restore Workbench layout and version contracts

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Workbench tile geometry is deterministic, responsive, persistable, and versioned.
- First-principles root cause: Target lacks Workbench client layout/version logic.
- Core acceptance invariant: Layout never overlaps/escapes bounds, target breakpoints stay intact, malformed/future versions fail explicitly, and resize preserves stable tile identity.
- Dependencies: issue-038
- Dispatch order: Pure layout lane before view.
- Ownership: `packages/ui/src/lib/interactive-ui/workbench-layout.ts`; `packages/ui/src/lib/interactive-ui/workbench-layout.test.ts`; `packages/ui/src/lib/interactive-ui/workbench-version.ts`; `packages/ui/src/lib/interactive-ui/workbench-version.test.ts`.
- Focused verification: Run both focused tests and UI typecheck; boundary, resize, malformed, and version cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-041.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-040: Restore Workbench events and popout lifecycle

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Workbench focus/pin/popout events are identity-scoped, ordered, and cleaned up across windows.
- First-principles root cause: Target lacks Workbench event and popout coordination.
- Core acceptance invariant: Stale/wrong-project events are ignored, duplicate popouts do not fork state, close/teardown removes listeners, and failure preserves the main board.
- Dependencies: issue-038
- Dispatch order: Event lane before view.
- Ownership: `packages/ui/src/lib/interactive-ui/workbench-events.ts`; `packages/ui/src/lib/interactive-ui/workbench-events.test.ts`; `packages/ui/src/lib/interactive-ui/workbench-popouts.ts`; `packages/ui/src/lib/interactive-ui/workbench-popouts.test.ts`.
- Focused verification: Run both focused tests and UI typecheck; identity, ordering, duplicate, close, and cleanup cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-041.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-041: Restore Workbench and Pin user interface

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Users can open the persistent Workbench, arrange/focus tiles, pin eligible rich results, and pop out a board using upstream UI primitives.
- First-principles root cause: Target has no Workbench UI.
- Core acceptance invariant: Feature-owned view uses target tokens/components, narrow widths do not overflow, Pin preserves exact source identity, and failure in one tile cannot clear others.
- Dependencies: issue-038, issue-039, issue-040
- Dispatch order: Feature UI after all state contracts.
- Ownership: `packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.tsx`; `packages/ui/src/components/interactive-ui/workbench/ExtensionWorkbench.test.ts`; `packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.tsx`; `packages/ui/src/components/interactive-ui/workbench/WorkbenchPinButton.test.ts`; `packages/ui/src/components/interactive-ui/workbench/workbenchPinProject.ts`.
- Focused verification: Run focused Workbench/Pin tests and UI typecheck; inspect target-token use, overflow, identity, and per-tile isolation.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Five feature-owned donor files are absent from target.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 043-044.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-042: Persist only Workbench UI state in the target UI store

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The upstream UI store persists the minimum Workbench tab/layout visibility state without adopting unrelated donor preferences.
- First-principles root cause: Target `useUIStore` has no Workbench fields or sanitizer.
- Core acceptance invariant: New fields are versioned/sanitized, unknown data falls back, and every existing target field/default/migration remains unchanged.
- Dependencies: issue-038, issue-041
- Dispatch order: Narrow store adapter after Workbench schema freezes.
- Ownership: `packages/ui/src/stores/useUIStore.ts`; one focused persistence/sanitizer test discovered before dispatch.
- Focused verification: Focused persistence test, UI typecheck, and line-level diff against target.
- Pi binding: batch `d82216c1-d5c3-4f02-b92f-ff4dd99c3f90`, run `73507971-a723-41a9-a0c3-3e01474ae913`, base `d9f6632f`, final revision 2.
- Pi attempts: Correction 1 was lost to repeated provider 429 responses without file changes; correction 2 implemented the bounded store adapter and six regressions. Pi retry budget is exhausted with a policy-clean formal handoff.
- Primary attempts: No implementation attempt; primary integrated the byte-identical Pi candidate and independently reran focused tests and full UI typecheck.
- Current evidence: Resolved 2026-08-10. The target store now adds only persisted/sanitized right-sidebar open/tab state, `ocixStylePreset`, two required context modes, and exports the unchanged 380/380/1400 sizing constants; migration **13 → 14** drops obsolete width while preserving and sanitizing retained values. Store plus adjacent persistence tests pass **38/38**. Full UI typecheck errors fell **248 → 223**, removing all 25 owned store-contract errors; the revealed `TerminalView.preferredTabId` mismatch is a separate host seam.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables layout registration.
- Next action: Resolved; issues 043-044 may consume the restored target store contract.

## issue-043: Register the Workbench tab in the upstream right sidebar

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The Workbench is reachable as a right-sidebar tab without changing any upstream terminal/files/git tab behavior.
- First-principles root cause: Target right-sidebar tabs lack the feature.
- Core acceptance invariant: One capability-gated tab and its badge/content are added; existing ordering, responsive behavior, shortcuts, labels, and fallback remain target-owned.
- Dependencies: issue-041, issue-042
- Dispatch order: Narrow layout seam after Workbench UI.
- Ownership: `packages/ui/src/components/layout/RightSidebarTabs.tsx`; focused layout/tab test if target precedent supports it.
- Focused verification: UI typecheck/lint, focused tab test, and line-level target diff.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: No implementation attempt; primary audited the retained narrow branch after the target store contract and full UI typing were restored.
- Current evidence: Resolved 2026-08-10. `RightSidebarTabs` retains the target git/files/context ordering, fallback, hidden-tab policy, and git polling while adding one isolated `extensions` content branch backed by `ExtensionWorkbench`. Store persistence/sanitization tests pass **38/38**, the prior focused READY suite remains **346/346**, and the complete UI typecheck passes with **0 errors**.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-044.
- Next action: Resolved; include right-sidebar Applications reachability in final desktop acceptance.

## issue-044: Host Workbench mode in the upstream Context Panel

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Selecting Workbench renders the persistent board in the existing Context Panel with correct close/focus behavior.
- First-principles root cause: Target Context Panel has no Workbench mode.
- Core acceptance invariant: The adapter is capability-gated and lazy; existing context modes and panel sizing stay byte-for-byte target-owned except the narrow branch.
- Dependencies: issue-043
- Dispatch order: Final Workbench layout seam.
- Ownership: `packages/ui/src/components/layout/ContextPanel.tsx`; `packages/ui/src/components/views/TerminalView.tsx`; focused terminal-selection/context-mode test if target precedent supports it.
- Focused verification: UI typecheck/lint, focused preferred-terminal-tab test, and line-level target/donor adapter diff.
- Pi binding: run `84e1d7e4-012a-45fe-986c-76842f80c094`, base `98ddfcca`, revision 0; policy-clean formal handoff.
- Pi attempts: Revision 0 added only the optional terminal-tab handoff and a focused regression guard; no correction was required.
- Primary attempts: No implementation attempt; primary integrated the Pi candidate and made only the issue-037 test matcher correction before independent verification.
- Current evidence: Resolved 2026-08-10. ContextPanel's retained Applications branch renders `ExtensionWorkbench`; terminal tabs pass their target id through the optional `preferredTabId` adapter. TerminalView switches only when visible and when that tab already exists, preserving local selection and avoiding tab creation/close/stream side effects. Terminal plus remount tests pass **11/11**, locale plus terminal rerun passes **6/6** with 157 expectations, `git diff --check` passes, and the complete UI typecheck passes with **0 errors**.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Completes Workbench host registration.
- Next action: Resolved; include Applications mode and preferred terminal-tab handoff in final desktop acceptance.

## issue-045: Restore the privileged Electron Artifact Runner boundary

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Desktop HTML Artifact execution runs in a dedicated constrained window/preload boundary with request-bound lifecycle and no Node leakage.
- First-principles root cause: Target Electron package has no Artifact Runner process boundary.
- Core acceptance invariant: Only allowlisted IPC/messages cross preload, navigation/window creation is denied, identity and size limits are exact, and teardown removes files/listeners/window state.
- Dependencies: issue-023, issue-024
- Dispatch order: Electron security module before main/preload registration.
- Ownership: `packages/electron/artifact-runner.mjs`; `packages/electron/artifact-runner-preload.cjs`; `packages/electron/artifact-runner.test.mjs`.
- Focused verification: Run focused Node tests; inspect webPreferences, navigation/window denial, IPC allowlist, lifecycle, and cleanup.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Three donor-only Electron files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-046.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-046: Register Artifact Runner and binary save through narrow Electron adapters

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Target Electron main/preload can launch the Runner and save approved binary outputs without changing upstream desktop lifecycle.
- First-principles root cause: Target main/preload/package metadata lacks fork IPC registrations.
- Core acceptance invariant: Only exact validated channels are exposed, save paths/names/MIME are bounded, cancel/failure is truthful, and target startup/updater/tray/security behavior remains unchanged.
- Dependencies: issue-045
- Dispatch order: Narrow Electron seam after security modules.
- Ownership: `packages/electron/main.mjs`; `packages/electron/preload.mjs`; `packages/electron/desktop-binary-save.mjs`; `packages/electron/desktop-binary-save.test.mjs`; `packages/electron/package.json`.
- Focused verification: Run binary-save/Runner tests and Electron build; inspect line-level diff against target main/preload/package.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Main/preload/package are upstream-active; only narrow imports/IPC/lifecycle hooks are allowed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-047 and packaged acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-047: Restore the Artifact execution surface and geometry

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Artifact content presents a stable inline/fullscreen/external execution surface across Web and Electron with bounded geometry.
- First-principles root cause: Target has no shared Artifact execution surface.
- Core acceptance invariant: Geometry clamps to viewport and target breakpoints, mode transitions retain identity, unsupported desktop capability falls back explicitly, and no iframe privilege changes.
- Dependencies: issue-024, issue-046
- Dispatch order: Shared surface after both Web host and Electron capability.
- Ownership: `packages/ui/src/components/interactive-ui/ArtifactExecutionSurface.tsx`; `packages/ui/src/components/interactive-ui/artifactRunnerGeometry.ts`; `packages/ui/src/components/interactive-ui/artifactRunnerGeometry.test.ts`; narrow `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx` integration.
- Focused verification: Geometry tests, Artifact tests, UI typecheck, and Web/Electron mode smoke.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Feature-owned surface/geometry files are donor-only; HTMLArtifactView integration must follow issue-024.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables packaged Artifact acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-048: Restore scoped OCIX Style v2 tokens and presets

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Fork-rendered surfaces use a coherent Style v2 token/preset contract while all ordinary upstream UI styling remains unchanged.
- First-principles root cause: Target lacks OCIX theme/preset modules and scoped token definitions.
- Core acceptance invariant: Every selector is rooted under the explicit OCIX/Artifact/Workbench host scope, presets validate deterministically, no global element/reset/body/theme rule is added, and unsupported tokens fall back safely.
- Dependencies: issue-015
- Dispatch order: Style contract before visible feature sections/renderers finalize.
- Ownership: `packages/ui/src/lib/interactive-ui/stylePresets.ts`; `packages/ui/src/lib/interactive-ui/stylePresets.test.ts`; `packages/ui/src/styles/ocix-theme.css`; `packages/ui/src/styles/ocix-presets.css`; two narrow ordered imports in `packages/ui/src/index.css`.
- Focused verification: UI typecheck/build, preset unit checks, selector-scope audit, and target visual smoke proving ordinary UI parity.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09, and no issue-048 Pi worktree, session, run, or log was created.
- Pi attempts: none; direct primary/Luna execution is explicitly authorized.
- Primary attempts: Luna worker round 1 restored the scoped Style v2 contract and a focused preset test; primary acceptance audited every selector/token/import and retained only the two minimum theme/preset imports. The undefined donor panel-hero slot was completed in default, dark, and every non-linear preset without adding a global rule.
- Current evidence: 31/31 selectors are rooted under `.ocix-scope` or `.ocix-artifact-dialog`; 47 default tokens and every effective light/dark preset set are complete with no unknown internal references. Focused tests pass 3/3, focused ESLint and isolated production builds pass, and a fresh read-only final reviewer returned SHIP. Full workspace typecheck remains blocked only by the separately ledgered issue-054 missing SDK dependency; unrelated `runtime-url.ts` and untracked UI directories were not touched.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 022/035 and final visual acceptance.
- Next action: Resolved; visible renderer/visual issues may consume this scoped contract without importing donor global CSS.

## issue-049: Restore extension and demo lifecycle acceptance fixtures

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Signed OCIX install/demo/start/stop/system flows run deterministically against the real product and clean every created process/state artifact.
- First-principles root cause: Target has no fork acceptance fixture/orchestration scripts.
- Core acceptance invariant: Fixtures are self-contained, port/process/state ownership is exact, cleanup is truthful on success/failure, and no user OpenCode data is touched.
- Dependencies: issues 004-014, issue-061, issue-062
- Dispatch order: Acceptance infrastructure after server product path passes focused tests. Cohesive script suite may exceed five files; freeze exact script-only paths before dispatch.
- Ownership: `scripts/interactive-ui-demo.mjs`; `scripts/interactive-ui-demo-start.mjs`; `scripts/interactive-ui-demo-stop.mjs`; `scripts/interactive-ui-demo-lifecycle.test.mjs`; `scripts/interactive-ui-extension.mjs`; `scripts/interactive-ui-extension.test.mjs`; `scripts/interactive-ui-system-test.mjs`; `scripts/lib/interactive-ui-demo-lifecycle.mjs`.
- Focused verification: Run lifecycle/extension tests and one isolated system smoke; verify zero leftover process/temp state.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Donor-only acceptance scripts exist; package command wiring belongs to issue-054.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables unified acceptance.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-050: Restore the self-contained tldraw MCP App browser harness

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The real tldraw MCP 2026 App proves inline/fullscreen edit/save/image/multipage behavior through OpenCode and OpenChamber without external state.
- First-principles root cause: Target has no fork MCP App browser orchestration.
- Core acceptance invariant: Fixture identity/version is pinned, all created sessions/processes/downloads clean up, screenshots/reports are truthful, and no fallback mock substitutes for the real product chain.
- Dependencies: OpenCode issues 001-006, issues 018/028/029
- Dispatch order: Cross-repo MCP product acceptance after both hosts pass focused tests.
- Ownership: `scripts/lib/tldraw-mcp-app-browser-acceptance.mjs`; matching focused test; `scripts/lib/tldraw-mcp-app-browser-orchestration.mjs`; matching focused test; `scripts/run-tldraw-mcp-app-browser-acceptance.mjs`.
- Focused verification: Run both Node tests and the self-contained tldraw browser acceptance; inspect report/screenshots and cleanup.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Five donor-only harness files plus existing root `tldraw-mcp-app` fixture.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Provides MCP Apps P0 release evidence.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-051: Restore conversation and hybrid CRM product acceptance

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Real browser acceptance proves Declarative, Agent Generated Artifact, Installed Artifact confirmation, Workbench, and routing behavior through one product session.
- First-principles root cause: Target has no OCIX hybrid fixture or conversation browser command.
- Core acceptance invariant: Product authority/write assertions are real, Confirm/Escape/Cancel produce exactly 1/0/0 writes, cleanup succeeds on the exercised path, and suspended issue-002 is neither claimed fixed nor silently broadened.
- Dependencies: issues 021-027, 035-044, 047-049
- Dispatch order: End-to-end product lane after feature integration.
- Ownership: `scripts/lib/interactive-ui-hybrid-crm-fixture.mjs`; matching test; `scripts/verify-interactive-ui-conversation-browser.mjs`; `scripts/verify-hosted-ocix-functional.mjs`; `scripts/verify-html-artifact-browser.mjs`.
- Focused verification: Fixture test plus isolated real-browser conversation/HTML/hosted flows; preserve exact reports and write counts.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Donor and Host Confirmation descendant contain accepted core evidence; failure-window cleanup remains suspended issue-002.
- Suspension decision: n/a; issue-002 stays suspended
- Resume condition: n/a
- Continuation decision: Provides OCIX/Artifact P0 release evidence.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-052: Restore security, routing, performance, visual, and unified acceptance gates

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: One deterministic release gate proves the preserved Fork features are secure, routed correctly, responsive, visually scoped, and functionally unified on the target UI.
- First-principles root cause: Target lacks fork-specific release-gate orchestration.
- Core acceptance invariant: Every subgate fails truthfully, uses isolated inputs, emits reviewable evidence, and never updates golden files implicitly. Cohesive acceptance-only scope may exceed five scripts but cannot modify product code.
- Dependencies: issues 049-051
- Dispatch order: Final OpenChamber acceptance script lane.
- Ownership: `scripts/verify-interactive-ui-model-routing.mjs`; `scripts/verify-interactive-ui-runtime-performance.mjs`; `scripts/verify-interactive-ui-security.mjs`; `scripts/verify-interactive-ui-unified-acceptance.mjs`; `scripts/verify-interactive-ui-unified-functional.mjs`; `scripts/verify-interactive-ui-visual.mjs`.
- Focused verification: Run each subgate and the unified command; inspect reports, golden comparison, process/session cleanup, and non-zero failure propagation.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Donor-only scripts exist; previous reports cannot substitute for the new target integration run.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final release verdict.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-053: Restore interop product verification

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Fork OpenCode and target-aligned OpenChamber prove capability discovery, ordinary chat, OCIX, MCP App, and Widget interoperability together.
- First-principles root cause: The two clean target releases have no fork cross-product acceptance command.
- Core acceptance invariant: Exact built versions and endpoints are recorded, unsupported/external legacy capability is explicit, every created process/session is cleaned, and product failures cannot be masked by fixture success.
- Dependencies: all OpenCode issues; OpenChamber issues 014, 026-034, 049-052
- Dispatch order: Last cross-repo functional gate before review.
- Ownership: `scripts/interop-acceptance.mjs`; `scripts/verify-interop-product-functional.mjs`; focused orchestration test if target precedent supports it.
- Focused verification: Run interop acceptance against the locally packaged fork SDK/CLI and target-aligned UI; inspect provenance and cleanup.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Donor commands exist but must be rebound to new exact integration commits.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Provides final cross-repo evidence.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-054: Bind the target UI to the rebuilt Fork SDK and acceptance commands

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: OpenChamber consumes the accepted `@zunbaran/opencode-sdk` build and exposes only the retained fork test/release commands.
- First-principles root cause: Clean target package metadata points at upstream SDK and has no fork acceptance scripts.
- Core acceptance invariant: SDK provenance matches the exact integrated OpenCode commit, lockfile is deterministic, no unrelated dependency/version/script drift enters, and every added command names an existing accepted script.
- Dependencies: none for the already-published fork SDK `1.18.10-oc.1`; product acceptance in issues 049-053 remains downstream.
- Dispatch order: First repair lane. The fork SDK dependency must be deterministic before client-wrapper and full typecheck repair.
- Ownership: Root `package.json` intent is part of this issue, but the actual workspace dependency fanout and deterministic lock regeneration are now delegated to issue-071 after first-principles discovery; generated local SDK package metadata/evidence remains primary-owned.
- Focused verification: Frozen install, SDK provenance check, typecheck, Web/Electron builds, and command resolution audit.
- Pi binding: rejected run/session `c77292fc-24b5-46c5-916b-6ac3c3d32802`, batch `7c48e442-3dbe-4be2-a421-8b5f59cc69ac`, base `9024883a1c77b5bc1e9133760dc1ef9b7083026d`, revision 0, supervised-local without sandbox. Policy scope was clean, but the candidate was not integrated because primary frozen-install validation proved its hand-crafted versioned scoped key invalid.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: The rejected root-only candidate remains recorded above. issue-071 then bound all four direct workspace manifests and the single lock resolution atomically. Primary verified installed package identity `@zunbaran/opencode-sdk@1.18.10-oc.1`, Bun lock parsing, online frozen-install progress to the expected credential-only **403** boundary, and a complete **offline frozen install** from the existing exact local fork cache with no lock changes.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Resolved by issue-071; enables issue-029 and issue-067.
- Next action: Resolved; release environments must provide `GITHUB_PACKAGES_TOKEN`, while this local package build may use the already-verified exact offline cache.

## issue-055: Enforce upstream UI parity outside the Fork allowlist

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The delivered OpenChamber looks and behaves like official `v1.18.1` everywhere except the minimum retained Fork feature surfaces and adapters.
- First-principles root cause: The donor branch carries broad upstream divergence alongside valid Fork features.
- Core acceptance invariant: Every changed path is classified F/A; upstream-owned U paths are identical unless a reviewed narrow adapter is allowlisted; global CSS/theme/brand drift is zero; duplicate D paths are absent.
- Dependencies: issues 004-054, issue-061, issue-062, issue-063
- Dispatch order: Final cleanup/diff gate after all feature lanes, before fresh reviewer.
- Ownership: `docs/P0_FORK_FEATURE_ALLOWLIST.md`; only paths proven by the final target diff to violate its F/A/U/D rules. Primary owns ledger/roadmap/evidence wording.
- Focused verification: Exact `v1.18.1..HEAD` name/status/stat/diff audit, scoped-selector audit, typecheck/lint/build, visual golden comparison, and all P0 product gates.
- Pi binding: unassigned until the final diff identifies a bounded violation; no speculative cleanup lane
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Bulk READY restoration 2026-08-09: modules restored from accepted openchamber fork client surfaces (interactive-ui lib/client/manager/routing/review/workbench, generative-widget runtime bridges, settings sections, chat ToolPart/AssistantTextPart/ChatInput dispatch, Electron artifact-runner + desktop-binary-save, acceptance scripts). Focused re-verify 2026-08-09: UI 346/346 pass (0 fail) + electron artifact/binary-save 15/15 pass (0 fail); logs under goal implementer scratch ready-unit-gate.log.  Target baseline and allowlist are recorded; no feature implementation has yet been integrated.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: A clean result permits fresh Sol review; a bounded violation becomes the final Pi lane under this stable issue ID.
- Next action: Resolved in bulk READY closeout (2026-08-09): donor UI/client/workbench/widget/settings/electron/acceptance modules ported into integration worktree; focused unit gates 361/361 + electron artifact/binary-save 15/15; `@modelcontextprotocol/ext-apps@1.7.5` bound for MCP App host.

## issue-056: Restore the pure Interactive UI routing contract

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Extension and surface routing metadata is normalized deterministically and rejects malformed, ambiguous, oversized, or unsafe declarations before any runtime or package authority consumes it.
- First-principles root cause: `package-format.js` and the later runtime require one pure routing normalizer, but the original issue-013 bundled it with a separate remote lifecycle state machine.
- Core acceptance invariant: Valid routing metadata round-trips to the bounded canonical form; unknown fields/enums, duplicate or conflicting identities, unsafe examples, and exceeded limits fail closed with stable errors.
- Dependencies: none
- Dispatch order: Parallel contract wave B with issue-057. Both start from the same immutable base, own disjoint files, use only Bun/Node built-ins, freeze independent schemas, and have independent focused tests.
- Ownership: `packages/web/server/lib/interactive-ui/routing.js`; `packages/web/server/lib/interactive-ui/routing.test.js`.
- Focused verification: Run the focused routing test and inspect canonicalization, limits, unknown fields, duplicates, and failure codes.
- Pi binding: batch `a773e3b8-9f5d-405d-b187-7c9c3db74eef`, lane `routing-contract`, run/session `9adf5974-f703-4abf-aeef-8ce7565c5217`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/9adf5974-f703-4abf-aeef-8ce7565c5217`, base `d7b3dd63e8c436e3d9976a7c1c70e038388dbfc8`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact two-file donor port with no dependency/Git mutation, policy violation, or scope drift. Six contract tests passed; two broader corpus tests truthfully exposed the separate missing-fixture root cause recorded as issue-059.
- Primary attempts: no implementation repair required; independently reran the six core routing tests in candidate/integration and the complete byte-identical suite in the donor fixture tree.
- Current evidence: Candidate/integration are byte-identical to donor (`routing.js` SHA-256 `cd731b4e...`, test `b2931b28...`). The six pure-contract tests pass 6/6 with 22 assertions in candidate/integration; after issue-059 restored the exact corpus inputs, the direct integration suite passes the complete 8/8 with 131 assertions. Syntax and `git diff --check` pass.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables direct package-format verification and issue-013 runtime lifecycle work.
- Next action: Commit contract wave B, clean the exact Pi worktree/run immediately, then run the full suite after issue-059 restores its acceptance corpus.

## issue-057: Restore the pure dashboard and icon contract

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Extension dashboards, slots, tiles, layout modes, and icon assets are normalized and bounded before signing, installation, routing, or rendering.
- First-principles root cause: `package-format.js` needs dashboard/icon validation, but original issue-008 bundled this pure schema with authenticated HTTP routes and Business Gateway behavior.
- Core acceptance invariant: Valid dashboards/icons normalize deterministically; traversal, undeclared/malformed icons, duplicate/unknown slots, invalid layout modes, excessive KPI/slot counts, and oversized values fail closed.
- Dependencies: none
- Dispatch order: Parallel contract wave B with issue-056; same base, disjoint files, frozen independent schema, no shared generated output or dependency metadata.
- Ownership: `packages/web/server/lib/interactive-ui/dashboard-contract.js`; `packages/web/server/lib/interactive-ui/dashboard-contract.test.js`.
- Focused verification: Run the focused dashboard-contract test and inspect containment, slot/layout bounds, duplicate handling, icon validation, and stable errors.
- Pi binding: batch `a773e3b8-9f5d-405d-b187-7c9c3db74eef`, lane `dashboard-contract`, run/session `03cabd94-0668-45e9-81cb-3cee015e5561`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/03cabd94-0668-45e9-81cb-3cee015e5561`, base `d7b3dd63e8c436e3d9976a7c1c70e038388dbfc8`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exact two-file donor port with no dependency/Git mutation, policy violation, or scope drift.
- Primary attempts: no implementation repair required; independently reran the focused suite and inspected path containment, SVG/PNG hardening, schema/node/count bounds, slot/layout consistency, and safe context handling.
- Current evidence: Candidate/integration are byte-identical to donor (`dashboard-contract.js` SHA-256 `4f4af728...`, test `6363ee17...`). Candidate and integration each pass 7/7 with 22 assertions; syntax and `git diff --check` pass.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables direct package-format verification and issue-008 route wiring.
- Next action: Commit contract wave B and clean the exact Pi worktree/run immediately; issue-058 can then run from a complete package-format import base.

## issue-058: Restore the signed Hosted OCIX kernel

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Hosted/Remote signed manifest documents, safe resource paths, publisher envelopes, permissions, update metadata, redirects, MIME, size, and SHA validation are available as one fail-closed transport/kernel boundary.
- First-principles root cause: `package-format.js` imports Hosted delivery normalization, while original issue-011 mixed the reusable signed kernel with Manager-bound Remote connect and credential transactions.
- Core acceptance invariant: A valid signed manifest verifies and materializes its exact declared resources; unsafe URL/path/origin/redirect/MIME/size/hash/signature/update inputs fail before exposing bytes or state.
- Dependencies: issue-004, issue-056, issue-057
- Dispatch order: Serial after contract wave B because its focused test imports `package-format.js`, whose direct imports must all exist on the lane base.
- Ownership: `packages/web/server/lib/interactive-ui/hosted-ocix.js`; `packages/web/server/lib/interactive-ui/hosted-ocix.test.js`.
- Focused verification: Run focused Hosted OCIX and package-format tests together; inspect bounded streaming, redirect/origin validation, signature/hash/MIME checks, safe paths, and update metadata.
- Pi binding: batch `c1f041cc-38d4-46f8-9071-6c64905587e9`, lane `hosted-kernel`, run/session `11b9c292-53fa-46da-8f3c-6afe839bd74d`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/11b9c292-53fa-46da-8f3c-6afe839bd74d`, base `6b0366ad45820489d2a5c769e093b1d0621c0aba`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; production kernel is byte-identical to donor. The test was decomposed at the existing describe boundary to exclude the donor's separate Remote verifier block; that exact block is now explicitly owned by issue-011 rather than deleted.
- Primary attempts: no implementation repair required; independently reran Hosted + package-format suites in candidate/integration and inspected signature, origin/redirect, URL/path, stream overflow/cancel, MIME/hash/size, Native trust, materialization, and cache-integrity paths.
- Current evidence: `hosted-ocix.js` is byte-identical to donor (SHA-256 `f9391239...`). The focused candidate/integration Hosted + package suites pass 27/27 with 114 assertions; combined routing/dashboard/Hosted/package gate passes 42/42 with 267 assertions. The scoped test contains all 16 donor Hosted tests; the separate Remote describe remains tracked by issue-011.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables direct package-format completion and issue-011 Remote connect/consent.
- Next action: Commit contract wave C, clean the exact Pi worktree/run immediately, then consume the kernel in issue-011.

## issue-059: Restore the routing acceptance corpus fixtures

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The pure routing contract is verified against the real bilingual example capabilities and the frozen 17-case product corpus in the target integration tree.
- First-principles root cause: The accepted routing test contains two product-corpus checks, but the clean upstream target lacks the five donor fixture documents they read.
- Core acceptance invariant: Three example manifests expose the expected bounded tool/intent graph; the bilingual corpus has at least 20 valid cases; the unified corpus has exactly 17 unique cases and its frozen category/tool distribution.
- Dependencies: issue-056
- Dispatch order: Parallel contract wave C with issue-058. It owns only static fixture documents, issue-058 owns only the Hosted kernel/test, neither consumes the sibling output, and both start from the same immutable base.
- Ownership: `examples/interactive-ui/builtin-visualization/openchamber.extension.json`; `examples/interactive-ui/acme-crm/openchamber.extension.json`; `examples/interactive-ui/acme-sales/openchamber.extension.json`; `examples/interactive-ui/routing-cases.json`; `examples/interactive-ui/unified-acceptance-corpus.json`.
- Focused verification: Run the complete routing test 8/8 and inspect corpus schemas, unique IDs, tool/intent references, category counts, locale set, and exact donor hashes.
- Pi binding: batch `c1f041cc-38d4-46f8-9071-6c64905587e9`, lane `routing-corpus`, run/session `8fea6414-3b84-4637-832b-d2a9208e3f8c`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/8fea6414-3b84-4637-832b-d2a9208e3f8c`, base `6b0366ad45820489d2a5c769e093b1d0621c0aba`, revision 0, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 accepted without correction; exactly five allowed static JSON files, byte-identical to donor, with no dependency/Git mutation, policy violation, or scope drift.
- Primary attempts: no implementation repair required; independently reran the full routing suite in candidate/integration and audited JSON parsing, schemas, unique IDs, references, category/tool counts, and locales.
- Current evidence: All five files match donor exactly. Routing integration passes 8/8 with 131 assertions; `routing-cases.json` has 20 cases; unified corpus has exactly 17 unique cases with the frozen 6/5/3/3 category and expected-tool distribution and only `zh-CN`/`en` locales.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Closes the complete issue-056 acceptance command and feeds later product routing gates.
- Next action: Commit contract wave C and remove the exact Pi worktree/run immediately.

## issue-060: Restore the direct Remote signed-manifest verifier

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: A direct Remote app URL can be verified as a signed Hosted manifest whose embedded publisher identity/key and surface-tool bindings are canonical, self-consistent, and safe before trust or credential writes.
- First-principles root cause: issue-058 restored the Hosted transport kernel but deliberately excluded the donor test's separate Remote verifier describe because `remote-ocix.js` was not yet present.
- Core acceptance invariant: Embedded Ed25519 key/fingerprint/signature/keyId/publisher identity and hosted tool bindings must agree exactly; missing, malformed, tampered, conflicting, reserved, or ambiguous inputs fail before returning a verified candidate.
- Dependencies: issue-004, issue-058
- Dispatch order: Parallel dependency wave D with issue-012; same immutable base, disjoint ownership, no sibling dependency, generated output, lockfile, or shared production interface change.
- Ownership: `packages/web/server/lib/interactive-ui/remote-ocix.js`; `packages/web/server/lib/interactive-ui/hosted-ocix.test.js` (append exactly the donor Remote imports and `Remote OCIX manifest verification` describe to the accepted Hosted-only test).
- Focused verification: Run full Hosted/Remote test and package-format test; inspect publisher/key/signature/binding negative paths and confirm the final test file is byte-identical to donor.
- Pi binding: batch `de3cf10c-71d3-40b1-8f0f-2689aec02ad1`, lane `remote-verifier`, run/session `e302865f-ddc3-41eb-8469-de13f1257cf6`, worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/e302865f-ddc3-41eb-8469-de13f1257cf6`, base `581d980e439eb2d31d0e1e158787700ef52d781e`, correction revision 1, final host/Pi PIDs null, supervised-local without sandbox; exact worktree/run removed after accepted commit.
- Pi attempts: revision 0 rejected: structured prose claimed success while host evidence showed an empty bound-worktree diff; inspection then revealed the same intended bytes had been written to the integration worktree instead of the bound worktree. Correction 1 reused the same session, wrote exactly the two owned paths in the bound worktree, produced host-visible digest `0e33d9c2...`, and passed all checks.
- Primary attempts: no implementation repair required; treated the wrong-worktree write as unaccepted until correction 1 produced the authoritative patch, then verified candidate/integration byte equality and reran the security suites.
- Current evidence: `remote-ocix.js` and final `hosted-ocix.test.js` are byte-identical to donor. Correction candidate and integration pass Hosted/Remote + package 37/37 with 152 assertions; combined cache gate passes 55/55 with 287 assertions; syntax and `git diff --check` pass. Negative coverage includes missing/malformed publisher/key, keyId mismatch, invalid Ed25519 key, wrong-key signature, tamper, unsigned/identity mismatch, connector cardinality, and signed update metadata.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-011 Remote connect/consent and Manager preflight.
- Next action: Commit dependency wave D and clean the exact Pi worktree/run immediately; issue-011 and Manager preflight may consume the accepted verifier.

## issue-061: Restore transactional Local extension lifecycle

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Trusted Local OCIX packages install, update, enable/disable, roll back, and uninstall without leaving files, durable state, or activation state partially applied.
- First-principles root cause: The target has no persistent installation lifecycle, and the donor hard-wires not-yet-restored runtime validation and Agent Runtime reconciliation into the same implementation.
- Core acceptance invariant: Verification precedes extraction; all extracted paths remain under a unique staging root; mutations serialize; staged validation occurs before activation; durable state, version roots, and injected activation changes either commit together or roll back; same-version/different-content conflicts fail; uninstall is recoverable; externally owned activation files are never touched by this module.
- Dependencies: issue-005
- Dispatch order: Serial extension of the accepted Manager trust interface; same-file ownership forbids parallel dispatch.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`.
- Focused verification: `bun run --cwd packages/web test -- server/lib/interactive-ui/manager.test.js`; lifecycle cases cover install/update/idempotence/version conflict, enable/disable, rollback history, failed validation, failed state commit, activation rollback, and recoverable uninstall.
- Pi binding: not dispatched. The user made an emergency workflow change before `pi_lane_start` on 2026-08-09 and explicitly assigned planning, implementation, verification, and acceptance to the primary task; no issue-061 Pi worktree, run, session, or log directory was created.
- Pi attempts: none; the workflow was cancelled before any Pi run started, so there is no Pi correction count or cleanup target.
- Primary attempts: Direct implementation round 1 added the frozen Local state schema, signed extraction/integrity checks, two injected transaction adapters, lifecycle APIs, sanitized snapshots, and failure-atomic state/version/activation ordering. The first focused run passed 48/50; both failures proved a first-install activation/state failure removed signed files but left an empty `<extensions>/<id>` directory. The exact fix removes that parent only when empty, so update rollback still preserves accepted versions; focused rerun passed 50/50. Semantic audit round 2 found the donor-shaped uninstall result exposed an absolute managed `recoveryPath`, contrary to the current distribution contract. The exact fix retains recoverable trash but returns only an opaque `recoveryId` and constrains the injected OpenCode result to three booleans; focused rerun passed 51/51 and the 10-file regression passed 160/160.
- Current evidence: The accepted two-file implementation verifies an already-trusted Local signature before any extraction, rejects every explicit/unknown delivery field in this slice, writes only exact signed files under a unique owner-only staging root, validates before destination/activation, rejects unmanaged and same-version/different-content collisions, serializes every lifecycle mutation, persists owner-only atomic state, and uses activation rollback plus version cleanup/restore on later failure. Public list/install/toggle/rollback/uninstall results omit file hashes, generation IDs, public keys, absolute paths, and adapter extras; only the explicitly internal `getEnabledExtensionRoots` carries managed path plus lifecycle generation after re-hashing the complete installed file set. Verification: 51/51 focused Manager + Package Format tests; 160/160 across all 10 Interactive UI server test files; `lint:web`, node syntax, and `git diff --check` pass. `type-check:web` reports only existing issue-054 (`@modelcontextprotocol/ext-apps` missing from `mcpApp.ts`). `dead-code` exits 0 with the existing repository inventory; it reports no new Manager file/export issue, and host Git inspection confirms no package/lockfile mutation despite its `Saved lockfile` diagnostic. No owning `DOCUMENTATION.md` exists yet; issue-063 remains the planned documentation closure after issue-062 freezes the Manager seam.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 010 and 062; issue-014 waits for both.
- Next action: Commit only `issues.md` and the two accepted Manager files, then use that immutable commit as issue-062's serial base; issue-010 remains independently enabled and issue-014 waits for both.

## issue-062: Restore signed Marketplace manager flow

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Users can inspect and explicitly trust a signed static Marketplace, then install an exactly catalog-bound OCIX package without widening publisher trust or accepting substituted bytes.
- First-principles root cause: The target lacks Marketplace trust/catalog persistence and bounded catalog/package transport; this is a separate trust chain from direct publisher confirmation and Local lifecycle transactions.
- Core acceptance invariant: Marketplace URLs are credential-free HTTPS (loopback HTTP only); catalog/package fetches are time- and size-bounded; catalog signatures and exact fingerprints gate persistence; selected id/version/package hash/publisher tuple must match; a catalog-delegated publisher key is request-bound to that verified install and is never persisted into global publisher trust; public snapshots omit keys and filesystem paths.
- Dependencies: issue-005, issue-061
- Dispatch order: Serial Manager extension after direct trust and Local lifecycle freeze; same-file ownership forbids parallel dispatch.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`.
- Focused verification: `bun run --cwd packages/web test -- server/lib/interactive-ui/manager.test.js`; Marketplace cases cover confirmation, compatible/conflicting global slots, request-scoped delegated verification, redirect/deadline/size bounds, catalog/package substitution, removal, and sanitized public/error shapes.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09, and no issue-062 Pi worktree, session, run, or log was created.
- Pi attempts: none; direct primary implementation and acceptance are explicitly authorized.
- Primary attempts: Direct implementation round 1 restored the signed Marketplace seam. A fresh adversarial audit rejected the first candidate for global delegated-key authority, crash-window trust rollback, redirect bypass, injected-transport hangs, and public/error leakage; primary repair removed durable delegated trust entirely, added a Manager-owned shared deadline and redirect denial, preserved exact global-slot conflicts, and sanitized transport/error data.
- Current evidence: Manager focused acceptance passes 52/52; Manager + package + hardened built-in runtime passes 80/80. Marketplace installs bind catalog signature, id/name/version/hash, and publisher id/name/keyId/fingerprint while never writing delegated keys to global trust; legacy `marketplace:*` slots cannot authorize Local packages. Catalog/package fetches are redirect-free, deadline- and 2/20 MiB-bounded with non-blocking cleanup; public catalog omits PEM, package URL, and managed paths. The accepted Local staging/activation/state transaction remains reused. A fresh read-only final reviewer returned SHIP; syntax, Web lint, and diff checks pass.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 011 and 014.
- Next action: Resolved; issue-063 may document the frozen Manager seam and issue-011 may add the serial Remote lifecycle.

## issue-063: Document the restored Manager seam and security invariants

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Maintainers have an accurate owning document for the restored trust, lifecycle, Marketplace, runtime-validation, and activation seams without inheriting claims about unimplemented Remote/Hosted/UI behavior.
- First-principles root cause: The target has no Interactive UI server documentation, while the donor document describes a much larger descendant implementation.
- Core acceptance invariant: Documentation states only accepted behavior, exact ownership and adapter responsibilities, failure/rollback semantics, and focused commands; it must not claim unresolved Remote resource/health/update behavior, Hosted execution, route registration, automatic Agent Runtime integration, or UI availability.
- Dependencies: issue-005, issue-061, issue-062
- Dispatch order: Docs-only serial closure after the Manager interface freezes; it is split from the security/transaction lanes by policy.
- Ownership: `packages/web/server/lib/interactive-ui/DOCUMENTATION.md`.
- Focused verification: Inspect every statement against accepted source/tests and run the narrow Markdown formatting/link check available in the package, or record that no such script exists.
- Pi binding: not dispatched; the user suspended all Sol/Pi execution on 2026-08-09, and no issue-063 Pi worktree, session, run, or log was created.
- Pi attempts: none
- Primary attempts: One bounded Luna docs pass read the accepted package, Manager, Marketplace, and Agent Runtime source/tests plus the donor document, then wrote a target-owned document from verified behavior only. Primary review rejected all donor-only availability claims and checked the final statements against the accepted implementations.
- Current evidence: `DOCUMENTATION.md` records package signature/hash/path/secret bounds, prototype-safe trust, Local transaction/rollback ordering, request-bound Marketplace verification with no global trust write, Direct Remote installation-scoped consent/anchor/reusable-shell semantics, and the standalone Agent Runtime ownership/transaction boundary including canonical Remote sources. It explicitly leaves Remote resource/health/update behavior, Hosted execution, production route/runtime/capability/UI/Business Gateway wiring, automatic Agent Runtime reconciliation, and the authoritative durable `previousAssets` seam to their owning issues. The complete Interactive UI server gate passes 233/233; `git diff --check` and the static final-newline/link audit pass. The package defines no Markdown-specific checker.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final parity issue-055 documentation audit; issue-014 must update this owning document when it lands the durable Agent Runtime/runtime wiring seam.
- Next action: Resolved; keep the document synchronized as Remote/Hosted/runtime capabilities become accepted.

## issue-064: Restore a prototype-safe publisher trust manager

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Signed OCIX packages can be inspected and publisher keys trusted, listed, conflicted, removed, and reloaded truthfully for every valid key ID, including names inherited from `Object.prototype`.
- First-principles root cause: The withdrawn trust Manager represented publisher/key slots with ordinary objects and used inherited-property lookup plus `??=`/`delete`. A valid key ID such as `toString` therefore aliases an inherited function instead of an own durable slot, causing false success, false conflict, or false removal.
- Core acceptance invariant: Trust authority depends only on own publisher/key records. Every regex-valid string key ID, including `toString`, `hasOwnProperty`, and `valueOf`, must round-trip as an own persisted key; first trust, idempotence, conflict, exact trusted inspection, listing, removal, missing removal, and reload must report the real durable state. Embedded signatures remain self-consistency only; corrupt or unknown durable fields fail closed; no public key/path leaks.
- Dependencies: issue-004
- Dispatch order: Serial recovery after issue-005 exhaustion. This is a genuinely new root cause identified by the final fresh Sol review, so it receives a new stable ID and new run rather than resetting issue-005's attempt counter. Acceptance closes issue-005 and enables issue-061.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`.
- Focused verification: `bun run --cwd packages/web test -- server/lib/interactive-ui/manager.test.js server/lib/interactive-ui/package-format.test.js`; require prototype-name key cases plus the complete frozen trust-only suite to pass, followed by the 10-file Interactive UI server regression, `lint:web`, syntax, diff, dead-code, and typecheck baseline comparison.
- Pi binding: exhausted and cleaned run/session `d50a1d37-0353-4138-ad4f-14e8137e3de4`, base/HEAD `8c65927df4d571fc91c403a999b51e8d552a9430`, final revision 2 settled `ready`, host/Pi PIDs null, supervised-local without sandbox. Final host Git evidence is policy-clean with exactly two owned paths, no dependency/outside/staged changes or violations, patch digest `13c2f1eef2632d427023d89a60782fd12ac1812100af211a013631d7bc7ead3d`. After fresh Sol acceptance, the exact Pi worktree and run directory were removed; filesystem absence and Git worktree deregistration were verified without touching other sessions.
- Pi attempts: revision 0 created the full two-file candidate and generic null-prototype slot coverage but stopped without handoff. Primary dependency-backed acceptance passed 31/37 and found six concrete failures plus public-output drift. Correction 1 fixed all six and restored the frozen inspect shape; primary rerun passed 37/37. Manual strict-state audit then found that the candidate and one test explicitly accepted an equivalent but non-canonical padded PEM, silently trimmed a non-canonical durable publisher name, and omitted the frozen 200-character publisher-name bound on signed inspection. Correction 2 (final Pi correction) closed those fail-open paths and added negative coverage. Both issue-064 Pi corrections are exhausted; issue-005's historical exhausted run was never reused or reset.
- Primary attempts: no implementation repair used. The primary independently audited both revisions, ran dependency-backed tests, applied only revision-2 bytes with `apply_patch`, and corrected transfer-only trailing whitespace until integration and candidate hashes matched exactly.
- Current evidence: Final revision 2 preserves null-prototype own-slot semantics, exact source/ID validation, frozen inspect/list shapes, serialized atomic writes, and strict durable-field/fingerprint/canonical-form validation. It requires durable names and SPKI PEM strings to already be canonical and bounds signed publisher display names before output. Candidate and integration are byte-identical (`manager.js` SHA-256 `3679483fe082b4b9fa4f733308b768af63edde4ef291ff5ed84f60389aedb770`; test `adcdca369d0514afb047f3919cfc3be8f731e074a4b4787b49e4e8b59d698133`). Integration verification passes 39/39 focused tests (28 Manager + 11 Package Format), 148/148 across the 10-file Interactive UI server regression, `lint:web`, node syntax, diff, ownership, and policy checks. `type-check:web` reports only pre-existing issue-054 (`@modelcontextprotocol/ext-apps` missing from `mcpApp.ts`). Dead-code reports only existing MCP App unused items; the Manager intentionally has no consumer until issue-014 runtime wiring. Fresh read-only Sol verdict is `ship`, explicitly confirming prototype-name own-slot behavior, embedded-key/trusted separation, canonical durable validation, atomic persistence, sanitized output, and issue-005 closure.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: issue-005 is RESOLVED; issue-061 is enabled as the next serial Manager slice.
- Next action: Commit only `issues.md` and the two accepted Manager files, then use the new commit as issue-061's immutable base.

## issue-065: Restore the v1.18.1 desktop settings contract before replaying fork adapters

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Official v1.18.1 desktop, provider, walkthrough, persistence, and mobile UI compile and behave normally while retained fork capabilities use only explicit narrow desktop adapters.
- First-principles root cause: `packages/ui/src/lib/desktop.ts` was copied wholesale from the older donor generation while its consumers are target v1.18.1. That incompatible type/behavior boundary accounts for a large cluster of TS2345/TS2339/TS2322 failures.
- Core acceptance invariant: Start from the immutable upstream v1.18.1 file, replay only fork-required members proven by current fork consumers, and retain every target desktop setting/default/migration. No consumer file may be weakened with casts or optional fallbacks to hide the mismatch.
- Dependencies: none
- Dispatch order: Independent foundation wave; may run with issue-068, issue-069, and issue-042 because paths and contracts are disjoint.
- Ownership: `packages/ui/src/lib/desktop.ts`; `packages/ui/src/lib/desktop.test.ts` if a focused regression is required.
- Focused verification: Relevant desktop tests, `bun run type-check:ui` error delta, line-level diff against upstream v1.18.1, and `git diff --check`.
- Pi binding: run/session `4247002c-da0f-476a-9bb8-78dcba70a874`, batch `7c48e442-3dbe-4be2-a421-8b5f59cc69ac`, base `9024883a1c77b5bc1e9133760dc1ef9b7083026d`, revision 0, supervised-local without sandbox; policy-clean with exactly the two owned paths.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Pi restored immutable upstream v1.18.1 `desktop.ts` plus only three consumer-proven fork exports (`canUseTrustedDesktopFileIPC`, `listenDesktopEvent`, `saveDesktopBinaryFile`) and their private helpers. Primary independently ran desktop + composer focused tests **20/20**, synchronized dependencies from the frozen committed lock, and measured UI typecheck **289 → 266** after issues 065 and 069 together; the owned desktop files have zero errors and diff against v1.18.1 is four additive fork-adapter hunks with no target deletions.
- Continuation decision: Enables trustworthy persistence/provider/walkthrough type repair without donor-wide UI replacement.
- Next action: Resolved; remaining type errors belong to separately ledgered host/i18n/client seams.

## issue-066: Add a deterministic fork OpenCode CLI distribution lock and self-check contract

- Status: OPEN
- Classification: NON-BLOCKING
- Goal / user outcome: The Electron package embeds the exact maintained OpenCode fork binary, with immutable URL, checksum, version, release tag, and commit provenance rather than silently downloading the official CLI.
- First-principles root cause: The v1.18.1 integration worktree has no fork CLI lock or self-check scripts; `prepare-opencode-cli.mjs` derives an official anomalyco download from the SDK version.
- Core acceptance invariant: One checked-in lock names fork `1.18.10-oc.1`, the exact ZunbaRan release artifact and SHA-256, and its source/release provenance. Parsers reject missing, malformed, unsupported-platform, version-mismatched, or checksum-mismatched locks. No network or binary mutation occurs in the pure contract tests.
- Dependencies: none
- Dispatch order: Independent foundation wave; issue-067 consumes the frozen lock API.
- Ownership: `packages/electron/opencode-cli.lock.json`; `packages/electron/scripts/opencode-cli-lock.mjs`; `packages/electron/scripts/opencode-cli-lock.test.mjs`; `packages/electron/scripts/opencode-cli-self-check.mjs`; `packages/electron/scripts/opencode-cli-self-check.test.mjs`.
- Focused verification: Run both Node test files; audit exact donor lock provenance and reject official-host fallback; `git diff --check`.
- Pi binding: run/session `b0cbc425-a501-4744-b7b5-46dd935178a0`, batch `7c48e442-3dbe-4be2-a421-8b5f59cc69ac`, base `9024883a1c77b5bc1e9133760dc1ef9b7083026d`, revision 0, supervised-local without sandbox; policy-clean with exactly the five owned paths and no dependency/staged/outside-path changes.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Reopened 2026-08-10 by the real prepare gate. The downloaded arm64 archive matches the lock SHA-256, but its CLI does **not** contain the required Generative Widget assets, so `assertOpenCodeCliBinary` correctly rejects release `v1.18.10-oc.1`. The later clean local fork build at embedded commit `f263f908da3f71aa637ddb356328901b6ce231f2` passes the same asset self-check and is usable only through the explicit local-override path; it does not make the immutable GitHub Release lock true. For the current local-install-only goal, the final packaged acceptance proves that exact override is running as `1.18.10-oc.1+f263f908` with `interactive_ui` and `html_artifact`; therefore this remains a Release/P0-completion blocker but is non-blocking for the explicitly provenance-bound local replacement.
- Continuation decision: Enables issue-067 Electron packaging wiring.
- Next action: Keep open until a new immutable ZunbaRan fork Release contains the verified post-`f263f908` CLI and the lock is updated to that release URL, version, commits, and checksums. Local installation may proceed through exact local-override provenance without claiming the Release gate is closed.

## issue-067: Wire Electron prepare, verify, and runtime gates to the fork CLI lock

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: `electron:build` stages, verifies, launches, and packages only the locked fork CLI, and the packaged app proves its embedded runtime identity before installation.
- First-principles root cause: Current Electron preparation/verification scripts use the official SDK version and lack fork runtime/provenance enforcement.
- Core acceptance invariant: Prepare and verify consume issue-066's lock, validate SHA/version/fork identity, reject fallback to official URLs, and keep the existing target platform/arch packaging behavior. The packaged `.app` must pass the same self-check against its embedded binary.
- Dependencies: issue-066, issue-054
- Dispatch order: Serial after the lock API and fork SDK bind are integrated.
- Ownership: `packages/electron/scripts/prepare-opencode-cli.mjs`; `packages/electron/scripts/verify-opencode-cli.mjs`; `packages/electron/scripts/verify-opencode-cli-runtime.mjs`; `packages/electron/package.json`; root packaging command wiring in `package.json` only if issue-054 did not already own it.
- Focused verification: Electron script tests, locked binary prepare/verify, canonical `electron:build`, packaged runtime self-check, and provenance report inspection.
- Pi binding: run/session `51458b31-fe52-46d3-84cb-7718a76c75f6`, batch `dca705e2-05ca-45ac-8890-bf7059cc1a45`, base `74699f8ed24a856b454a27694f9c1c9702bea9fd`, revision 0, supervised-local without sandbox; policy-clean with four changed owned paths and no dependency/staged/outside-path changes.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Pi replayed the three Electron CLI scripts byte-identically from maintained donor commit `870cc00cb471743795d2a8c9746247951e78f931` (primary independently matched blob IDs `6ea24e14`, `af1d7af5`, and `29a38fac`) and added only the two package-script verification gates. Prepare now accepts only the issue-066 lock or an explicit local override, verifies archive/binary SHA and Generative Widget manifest, and writes distribution provenance. Staged and packaged binary verification support local override metadata. Architecture/lock/self-check tests pass **42/42** and Artifact Runner passes **7/7**. The real release download is correctly rejected by the asset gate; the exact local build embeds distribution `ZunbaRan/opencode`, upstream commit `e024e2ef`, fork commit `f263f908`, and passes the asset self-check. Runtime-probe behavior for this override remains issue-076.
- Continuation decision: Enables issue-070 installable artifact gate.
- Next action: Resolved; issue-070 must exercise the locked binary and packaged `.app` end to end before installation.

## issue-068: Regenerate the target icon contract for retained fork surfaces

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Retained Applications/Workbench UI uses valid generated icon names without weakening icon typing or importing donor-wide generated drift.
- First-principles root cause: Fork consumers reference `apps-2-ai` and `sort-desc`, but the v1.18.1 generated icon union/sprite in the integration does not contain them.
- Core acceptance invariant: Use the repository icon generator/source-of-truth; generated type and sprite remain synchronized; only icons required by retained fork surfaces are added; no `as IconName` escape hatch.
- Dependencies: issue-072
- Dispatch order: Independent foundation wave.
- Ownership: `packages/ui/src/components/icon/icons.ts`; `packages/ui/src/components/icon/sprite.ts`; the existing generator source/test only if generation proves it is the authoritative missing input.
- Focused verification: Run `bun run icons:generate`, require a clean second generation, UI typecheck error delta, and focused icon lint/tests.
- Pi binding: run/session `2dc69087-5926-43a9-a644-3ae8f100229d`, batch `dca705e2-05ca-45ac-8890-bf7059cc1a45`, final revision 1, supervised-local without sandbox; final worktree clean because the incomplete generated output was correctly reverted.
- Pi attempts: correction 1 formalized the generator false-negative and reverted the incomplete `apps-2-ai`-only output after revision 0 ended on provider TPM errors without a handoff.
- Primary attempts: not eligible while Pi retries remain
- Current evidence: After issue-072 repaired the scanner, primary ran the documented generator twice. The generated delta is exactly two real Remix path entries, `apps-2-ai` and `sort-desc`; the second run is byte-identical at SHA-256 `4470729f01c1c99499b6b4a5e8f45ed330fb9a63d4da67bf5123ecbe7a461855`. The focused nested-expression generation test passes **1/1**. UI typecheck falls from 260 to **255** errors with no icon-name error, and `git diff --check` is clean.
- Continuation decision: Removes generated-contract noise before host-seam repairs.
- Next action: Resolved; generated outputs remain guarded by the issue-072 regression test.

## issue-069: Restore a narrow authoritative composer-prefill event contract

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Artifact/Workbench actions can prefill the current target composer without importing donor ChatInput chrome or bypassing the normal send path.
- First-principles root cause: Retained fork surfaces call a composer-prefill event that is absent from target `sessionEvents.ts`; copying donor ChatInput wholesale hid the missing contract and introduced an unresolved `MobileSessionStatusBar` import.
- Core acceptance invariant: The event payload is bounded text, listeners are scoped and disposable, and ChatInput remains target v1.18.1 plus the later narrow issue-034 adapters. No global mutable queue or direct API send is introduced.
- Dependencies: none
- Dispatch order: Event contract before issue-034 replays the target ChatInput adapters.
- Ownership: `packages/ui/src/lib/sessionEvents.ts`; a focused adjacent test file if needed.
- Focused verification: Focused event subscribe/unsubscribe/bounds tests, UI typecheck error delta, and `git diff --check`.
- Pi binding: run/session `6df2d9dd-8c47-4784-85ee-2e0c9031104a`, batch `7c48e442-3dbe-4be2-a421-8b5f59cc69ac`, base `9024883a1c77b5bc1e9133760dc1ef9b7083026d`, final revision 2, supervised-local without sandbox; policy-clean with exactly the two owned paths.
- Pi attempts: correction 1 added runtime-invalid/size/identity bounds after primary proved revision 0 called `.trim()` on unchecked input and had no maximum. Correction 2 (final) replaced `Object.keys` + per-key descriptor rereads after primary proved a stateful descriptor-proxy TOCTOU; the final atomic descriptor snapshot reads each key/descriptor once.
- Primary attempts: Attempt 1 after Pi exhaustion replaced two test-only `.not.toThrow()` matchers unsupported by this repository's narrowed Bun matcher declarations with equivalent explicit try/catch booleans; production code was unchanged. Focused tests and owned-file typecheck evidence pass. No second primary attempt used.
- Current evidence: Final revision 2 adds only the bounded prefill contract to upstream v1.18.1: 4,000-character text and 128-character optional session identity, exact valid-text preservation, deterministic disposer, atomic own-data snapshot, and fail-closed malformed/accessor/proxy handling. Primary independently ran the combined desktop/session suites **20/20**; session tests are **14/14**. A later full typecheck exposed exactly two test-declaration errors for unsupported `.not.toThrow()`; bounded primary attempt 1 replaced only those assertions, after which the focused suite and owned typecheck are clean. `git diff --check` passes.
- Continuation decision: Enables issue-034 to restore upstream ChatInput and add only Widget-send and prefill listeners.
- Next action: Resolved; issue-034 may now restore upstream ChatInput and replay only Widget-send plus composer-prefill adapters.

## issue-070: Close the canonical build, fork provenance, package, and local installation gate

- Status: VERIFYING
- Classification: P0
- Goal / user outcome: Produce one verified macOS arm64 OpenChamber application from the P0 integration, preserve the current installation as a recoverable backup, replace `/Applications/OpenChamber.app`, and prove the launched app uses the embedded fork runtime.
- First-principles root cause: The previous completion narrative stopped at ledger and focused unit tests; it never proved the canonical build, fork distribution, packaged runtime, or installed application.
- Core acceptance invariant: UI/Web/Electron typechecks and builds pass; fork SDK/CLI provenance and checksums match; the `.app` is arm64 and starts; existing application is moved to a timestamped backup before replacement; no user settings/data are deleted; final roadmap/evidence cites exact commits and artifacts.
- Dependencies: issues 025-029, 034, 036-037, 042-044, 053-055, 065-069
- Dispatch order: Primary-owned final integration and release gate after all bounded repair lanes.
- Ownership: No speculative product-code ownership. Primary owns verification logs, release evidence, roadmap/status documents, backup/replacement, and launch smoke; any discovered bounded defect reopens its stable owning issue.
- Focused verification: Full typecheck/lint, Web and Electron builds, retained focused/unit gates, interop acceptance, fork CLI self-check/provenance, `file`/codesign assessment, packaged launch smoke, installed launch smoke, and backup existence.
- Pi binding: not applicable unless a new bounded product defect is assigned to an existing stable issue
- Pi attempts: none
- Primary attempts: n/a
- Current evidence: Final implementation HEAD `e2e824f4` passes workspace typecheck, workspace lint with 0 errors (two documented Hook warnings), Electron architecture 38/38, Artifact Runner 9/9, fork CLI identity/self-check 12/12, the focused browser-independent clip-fixture source gate, canonical arm64 packaging, app deep codesign verification, and the full isolated packaged desktop acceptance after correction 1. The report is `ok: true`, bundled runtime `1.18.10-oc.1+f263f908` is running with `interactive_ui`/`html_artifact`, native Runner clipping has 0 magenta leak pixels and 95.58% green guard pixels, restart persistence passes, and runtime errors are 0. The `.app` is version 1.18.1 arm64; final package SHA-256 values are DMG `36e715b5…`, ZIP `7e136ba6…`, app.asar `014080f8…`, packaged CLI `83b90c95…`, with signed CLI CDHash `c2bd49e1…`. `/Applications/OpenChamber.app` remains untouched at version 1.17.1 arm64 pending a new fresh reviewer verdict.
- Continuation decision: Only a fully green and provenance-verified result permits P0 to return to done and P1 to resume.
- Next action: Obtain the required fresh Sol/High read-only verdict; on `ship`, back up and replace the installed app, launch it, and verify installed fork provenance before resolving.

## issue-071: Bind every direct workspace consumer to one fork SDK resolution

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Root, UI, Web, and VS Code builds all resolve the exact maintained fork SDK `1.18.10-oc.1` from one deterministic lock instead of silently mixing fork and official SDKs.
- First-principles root cause: The monorepo's `packages/ui`, `packages/web`, and `packages/vscode` manifests each declare `@opencode-ai/sdk` directly. A root-only alias does not override those direct workspace contracts and forces an invalid two-resolution scoped-key hand edit when the lock is not regenerated by Bun.
- Core acceptance invariant: All four direct manifests declare exactly `npm:@zunbaran/opencode-sdk@1.18.10-oc.1`; `.npmrc` routes only the `@zunbaran` scope to GitHub Packages using the `GITHUB_PACKAGES_TOKEN` placeholder and contains no secret; Bun generates one valid fork SDK resolution with the accepted tarball/integrity; no official SDK resolution remains; unrelated dependencies/scripts/lock entries do not drift.
- Dependencies: none; resolves issue-054 when accepted
- Dispatch order: Serial dependency-state lane. No parallel lane may edit any manifest, `.npmrc`, or `bun.lock`.
- Ownership: `package.json`; `packages/ui/package.json`; `packages/web/package.json`; `packages/vscode/package.json`; `.npmrc`; `bun.lock`. Six files exceed the default budget because they form one indivisible workspace-resolution contract: four identical direct declarations, their scoped registry metadata, and the single generated lock; splitting them creates a known invalid intermediate graph.
- Focused verification: Primary-owned dependency resolution with `GITHUB_PACKAGES_TOKEN` when available; otherwise exact comparison to maintained donor plus package-manager parse validation, local cached fork-package provenance, zero-secret `.npmrc` audit, all-manifest assertion, and later full typecheck/build. Frozen install is the release gate and may remain an explicit environment blocker until credentials are provided.
- Pi binding: run/session `c0c3f56b-5acf-4259-a9ec-89f340e2fd41`, base `50483edec72ffc5803d9a9fec2ba467780fadb37`, revision 0, supervised-local without sandbox; policy-clean with exactly the six justified dependency-contract paths.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Pi replayed exactly four manifest aliases, the two-line secret-free `.npmrc` placeholder, and five SDK-only lock hunks from maintained donor commit `870cc00cb471743795d2a8c9746247951e78f931`; no unrelated lock byte changed. Primary independently proved Bun accepts the lock: online frozen install reached only the expected GitHub Packages **403** because `GITHUB_PACKAGES_TOKEN` is absent, then the exact cached `@zunbaran/opencode-sdk@1.18.10-oc.1` package was restored and `bun install --frozen-lockfile --offline` completed with **no changes**. All four symlinks resolve the fork package and UI typecheck remains at the expected 266 separately-owned errors.
- Continuation decision: Resolves issue-054 and enables fork client wrappers/typechecking without mixed SDK types.
- Next action: Resolved; issue-054 is closed and fork client/Electron distribution work may proceed.

## issue-072: Teach the icon generator to retain JSX expression icon literals

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Generated icon typing and sprite data remain complete when an `<Icon name={...}>` expression selects literal names through nested conditionals, so retained fork UI cannot compile against an icon that generation later deletes.
- First-principles root cause: `scripts/generate-icon-sprite.mjs` scans direct literal `name` props and a few typed-variable shapes, but it does not parse or conservatively inspect the expression body of an Icon `name={...}` prop. The retained `DeclarativeInteractiveView` selects `sort-desc` in a nested ternary, producing a deterministic false-negative even though `RiSortDesc` exists.
- Core acceptance invariant: Extend only the documented generator scanner and a focused generator test/fixture so literal kebab icon names inside balanced JSX `name={...}` expressions are retained, while arbitrary prose/string literals outside Icon name expressions are ignored. Existing direct, typed-variable, and custom-icon behavior remains unchanged; generated outputs add exactly `apps-2-ai` and `sort-desc`; a second generation is clean.
- Dependencies: none
- Dispatch order: Bounded generator repair before derived-output issue-068.
- Ownership: `scripts/generate-icon-sprite.mjs`; one focused adjacent generator test/fixture if the repository has a viable convention. Generated `packages/ui/src/components/icon/sprite.ts` remains issue-068-owned and must not be edited in this lane.
- Focused verification: Focused scanner test covering nested ternary, direct literal, malformed/unbalanced expression, and unrelated string false positives; generator dry evidence or primary-owned full generation; syntax check and `git diff --check`.
- Pi binding: run/session `fcdad883-684c-4fa6-b14b-fc397d62e61a`, base `48170cbac02632b270ccac2cb6a5096724d77623`, final revision 2, supervised-local without sandbox; policy-clean with exactly the generator source changed.
- Pi attempts: correction 1 narrowed a runaway zero-change reasoning turn to a concrete balanced JSX scanner design; correction 2 (final) implemented the single-file scanner after correction 1 again stalled without tools or edits.
- Primary attempts: Attempt 1 after Pi retries were exhausted added the focused generator regression test only; it exercises the real nested ternary consumer, both required generated paths, checked-in freshness, and byte-identical second generation. No second primary attempt used.
- Current evidence: The accepted scanner finds each `<Icon>` tag, ignores quoted/comment text, balances expression braces, and passes only `name={...}` expression bodies through the existing known-icon filter; malformed/unbalanced expressions fail closed and arbitrary source prose is not scanned. Primary Node syntax check and focused test **1/1** pass, full generation is clean on the second run, typecheck has no `apps-2-ai`/`sort-desc` errors, and `git diff --check` passes.
- Continuation decision: Enables issue-068 to generate stable synchronized icon output.
- Next action: Resolved; issue-068 generated output is now stable.

## issue-073: Remove donor-only caller props from target host APIs

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Mobile notes, grouped turn activity, and relay-host probing compile against the retained v1.18.1 component/runtime contracts without weakening types or changing authentication behavior.
- First-principles root cause: Four donor call sites retained props that their target-owned callees intentionally do not accept: ProjectContextPanel owns its navigation, TurnActivity receives no runtime identity props, and relay tunnel probes authenticate through the encrypted tunnel rather than bearer/request-header options.
- Core acceptance invariant: Remove only the four proven stale prop groups; do not widen target callee types, add casts, drop direct-host credentials, or change tunnel adoption/health semantics. Existing callbacks/auth values remain wherever their target API accepts them.
- Dependencies: issues 065, 071
- Dispatch order: Independent final type-repair wave; paths are disjoint from issues 025, 026, and 036.
- Ownership: `packages/ui/src/apps/MobileWorkspaceDrawer.tsx`; `packages/ui/src/components/chat/message/MessageBody.tsx`; `packages/ui/src/components/desktop/DesktopHostSwitcher.tsx`; `packages/ui/src/components/sections/remote-instances/RemoteInstancesPage.tsx`; focused existing tests only if already adjacent and no other production file.
- Focused verification: Relevant mobile/message/desktop-host tests, line-level diff against target APIs, full UI typecheck delta, and `git diff --check`.
- Pi binding: batch `253e064d-9f86-4be5-b110-cf74637a8c22`, run `36461d8b-3f46-429c-b3f5-f95a87779330`, base `eb9ce926`, revision 0; policy-clean formal handoff.
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Resolved 2026-08-10. The accepted four-file diff removes only two ProjectContextPanel props, two TurnActivity props, and credential/header options from three relay probes while retaining `keepTunnel` at the tunnel-adoption call. Direct host probes and runtime switching still receive credentials. Primary independently ran `desktopHosts.test.ts` **7/7** and `git diff --check`; the next combined UI typecheck measures the exact five-error delta.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Removes five final target-caller errors before issue-070.
- Next action: Resolved; include these call sites in the next combined UI typecheck and lint gate.

## issue-074: Clear remaining target-host UI lint errors

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: The integrated v1.18.1 UI passes the repository lint gate without altering retained feature behavior.
- First-principles root cause: Narrow donor/target integration residues left unused parameters, sparse-array fixtures, one mutable declaration, and one intentional control-character matcher that violate the target ESLint contract.
- Core acceptance invariant: Fix only the eight reported lint errors; preserve parser, sanitizer, artifact bridge, and mobile navigation behavior; do not suppress unrelated rules or absorb the two existing Hook warnings.
- Dependencies: issues 036-044, 069, 073
- Dispatch order: Final static-analysis cleanup before the canonical build.
- Ownership: `packages/ui/src/apps/MobileWorkspaceDrawer.tsx`; `packages/ui/src/lib/generative-widget/parseShowWidget.ts`; `packages/ui/src/lib/generative-widget/parseShowWidget.test.ts`; `packages/ui/src/lib/generative-widget/sanitizer.ts`; `packages/ui/src/lib/generative-widget/sanitizer.test.ts`; `packages/ui/src/lib/interactive-ui/artifactBridge.test.ts`.
- Focused verification: Run the owning parser/sanitizer/artifact tests, UI lint, UI typecheck, and `git diff --check`.
- Pi binding: run `490ae1c0-286d-4a65-8a4d-3ba13a79f9d6`, base `777ee56d`, revision 0; policy-clean formal handoff with exactly six owned paths.
- Pi attempts: Revision 0 completed the bounded lint-only correction; no retry was required.
- Primary attempts: No implementation attempt; primary replayed the policy-clean candidate and independently ran all owning gates.
- Current evidence: Resolved 2026-08-10. UI lint now has **0 errors** and only the two explicitly out-of-scope existing Hook warnings. Parser/sanitizer/artifact focused tests pass **77/77** with 242 expectations, UI typecheck passes with **0 errors**, and the candidate preserves genuine sparse-hole semantics plus byte-equivalent ASCII control/whitespace stripping.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Unblocks issue-070 canonical build/package gate.
- Next action: Resolved; include workspace lint in the final canonical gate.

## issue-075: Run Electron syntax checks with the required Node runtime

- Status: RESOLVED
- Classification: NORMAL
- Goal / user outcome: Electron source receives a real Node syntax gate in environments where Bun is installed but `node` is absent from the default shell PATH.
- First-principles root cause: `bun run` falls back to Bun for `node --check` when no Node executable is discoverable, and Bun then resolves Electron's CommonJS shim during check mode, producing a false named-export failure.
- Core acceptance invariant: Do not change Electron source or weaken its syntax checks; supply the repository-required Node >=22 runtime to the existing script.
- Dependencies: issue-067
- Dispatch order: Environment correction before packaging.
- Ownership: validation environment only; no repository files.
- Focused verification: Run all five existing Electron `node --check` targets with bundled Node and rerun `type-check:electron` with that Node first on PATH.
- Pi binding: not required; no implementation defect exists.
- Pi attempts: none
- Primary attempts: One diagnosis attempt established the missing-Node PATH condition and verified the existing command under bundled Node.
- Current evidence: All five Electron files pass direct Node syntax checks, and `bun run type-check:electron` passes unchanged when Node 24 from the Codex workspace runtime is first on PATH.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Keep the Node-first PATH for the canonical validation and packaging commands.
- Next action: Resolved; no code change.

## issue-076: Verify explicit local fork CLI overrides at runtime

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: A locally built, self-checking fork CLI can pass the same managed-runtime capability gate used for a locked Release while retaining honest version, commit, and checksum provenance.
- First-principles root cause: `prepare-opencode-cli` and staged/packaged verification explicitly support `OPENCHAMBER_OPENCODE_CLI_PATH`, but `verify-opencode-cli-runtime.mjs` always asserts the immutable Release lock identity and does not read the staged local-override distribution metadata. Its temporary runtime also omits an isolated XDG state directory.
- Core acceptance invariant: For normal builds, runtime identity remains exactly lock-owned. Only when the explicit override environment is present may the verifier accept a valid local-override `distribution.json`; expected distribution/version/upstream/fork commits come from that staged metadata, and malformed or missing metadata fails closed. Runtime state is isolated under the verifier temp root.
- Dependencies: issue-067
- Dispatch order: Before packaging with the exact local fork binary.
- Ownership: `packages/electron/scripts/verify-opencode-cli-runtime.mjs`; one adjacent focused test if a pure helper can be extracted without widening the change.
- Focused verification: Node syntax check, focused metadata cases, staged binary self-check, managed runtime capability/tool/upgrade probe, and `git diff --check`.
- Pi binding: run `3c96c893-1afc-427e-b14c-d29bf1382ada`, base `061b2410`, final revision 1; policy-clean with exactly two owned paths.
- Pi attempts: Revision 0 added explicit override identity resolution and isolated XDG state. Correction 1 made schema/repository equality and staged executable SHA-256 fail closed, with expanded negative tests.
- Primary attempts: No implementation attempt; primary replayed the final policy-clean candidate, rebuilt the genuine local fork CLI from clean commit `f263f908`, and independently exercised the real managed runtime.
- Current evidence: Resolved 2026-08-10. Pure identity/lock/self-check tests pass **12/12**. The newly built arm64 CLI reports `1.18.10-oc.1+f263f908`, embeds distribution `ZunbaRan/opencode`, upstream commit `e024e2ef`, exact fork commit `f263f908…31f2`, and SHA-256 `04358ae41212c5c54d57bea5fa387c18fc89e7a3b06268c710243065d54422be`. Its real loopback runtime probe passes all four MCP feature flags, built-in `html_artifact`/`interactive_ui` discovery, independent-upgrade rejection, and channel-database absence.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Unblocks honest local package verification without weakening issue-066's still-open immutable Release requirement.
- Next action: Resolved; use this exact local override and provenance for the canonical arm64 package.

## issue-077: Restore the declared packaged desktop acceptance harness

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: The canonical arm64 `OpenChamber.app` is exercised through the repository-declared packaged desktop acceptance command before replacing the installed application.
- First-principles root cause: `package.json` declares `test:interactive-ui-desktop-packaged`, but the referenced `packages/electron/scripts/verify-packaged-interactive-ui.mjs` was omitted from this integration branch even though the maintained donor contains the complete harness and the target retains all of its fixture/helper dependencies.
- Core acceptance invariant: Restore only the missing declared harness; preserve isolated data/config roots, bundled-runtime-only launch, fork capability/health checks, extension install/persistence checks, runtime-error collection, clean shutdown, and report output. Do not weaken assertions or silently skip when the checked-in CRM fixture exists.
- Dependencies: issues 067, 070, 076
- Dispatch order: Final packaged-app gate before fresh read-only review and local installation.
- Ownership: `packages/electron/scripts/verify-packaged-interactive-ui.mjs` only.
- Focused verification: Byte comparison with maintained donor when compatible, Node syntax check, repository script against the canonical arm64 app with the exact staged local-override provenance, generated report inspection, clean process/port shutdown, and `git diff --check`.
- Pi binding: run `3934dd57-2f1e-4edf-97f0-ec789932541b`, base `fb2ebe1f`, revision 1; policy-clean with exactly the owned harness path.
- Pi attempts: Revision 0 was recoverably paused after broad compatibility analysis produced no candidate; correction 1 restored the exact donor harness and passed syntax/hash/diff checks.
- Primary attempts: none while Pi retries remain.
- Current evidence: The restored harness plus bounded current-contract adaptations now completes against the canonical arm64 app. The generated report is `ok: true`, proves the bundled fork runtime is running, exercises generated/static/script-enabled/installed Artifacts, validates native clipping by screenshot pixels, verifies same-content-id cache/restart persistence, records three screenshots, and reports zero runtime errors. The isolated process shuts down cleanly.
- Continuation decision: Keep the current-contract assertions, isolated runtime roots, fork capability checks, package install/restart checks, and report output as the mandatory packaged-app gate.
- Next action: Resolved; retain this command as a mandatory pre-install packaging gate.

## issue-078: Restore packaged Interactive UI demo and popout entry points

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: The packaged app contains the Interactive UI acceptance page plus Workbench and Artifact popout entry points already referenced by Electron/UI production code.
- First-principles root cause: The integration restored callers and the packaged acceptance command but omitted five maintained web entry files and their three Vite multi-page inputs. Consequently `interactive-ui-demo.html`, `workbench-popout.html`, and `artifact-popout-host.html` are absent from the canonical package; the acceptance harness cannot continue and production popouts resolve to missing assets.
- Core acceptance invariant: Restore the five maintained donor files and only the three corresponding Vite inputs, retaining all current upstream v1.18.1 build/chunk improvements. The production build must emit all three HTML pages with resolved hashed assets; no unrelated Vite option or dependency may change.
- Dependencies: issues 036-044, 067
- Dispatch order: Before rebuilding the canonical app and rerunning issue-077.
- Ownership: `packages/web/artifact-popout-host.html`; `packages/web/interactive-ui-demo.html`; `packages/web/workbench-popout.html`; `packages/web/src/interactive-ui-demo.tsx`; `packages/web/src/workbench-popout.tsx`; `packages/web/vite.config.ts`. Six files are one indivisible multi-page build contract: the five entry documents/modules and the existing Vite input map that makes them distributable.
- Focused verification: Donor byte comparison for the five restored files; exact three-key Vite diff; Web typecheck/lint; production Web build; assert all three HTML files and their referenced assets exist in `packages/web/dist`; `git diff --check`.
- Pi binding: run `172ab3ab-f37d-44a9-b346-7c4725fe578e`, base `0a9f2139`, final revision 2; policy-clean with exactly the six owned paths.
- Pi attempts: Revision 0 was recoverably paused after producing no candidate; correction 1 restored the five donor files and three exact Vite keys, then isolated two missing out-of-scope fixture dependencies and one owned lint error. Correction 2 added only the repository-conventional entry-module lint suppression.
- Primary attempts: none while Pi retries remain.
- Current evidence: The accepted candidate restores four files byte-identically, changes `workbench-popout.tsx` only by two explanatory lint-suppression comment lines, and changes Vite by exactly three input lines. Web lint is clean. After issue-079 restored the two missing fixture dependencies, primary independently passed Web typecheck, Web lint, and the real production build; all three HTML outputs and their hashed entry assets are present.
- Continuation decision: Resolves the packaged multi-page entry contract and enables the canonical Electron rebuild.
- Next action: Resolved; keep the three pages in every packaged-output inspection.

## issue-079: Restore the demo entry fixture dependency graph

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: The restored packaged Interactive UI demo entry typechecks and builds from checked-in sources without aliases or undeclared modules.
- First-principles root cause: The omitted multi-page entry also statically imports `packages/web/src/interactive-ui-visual-fixtures.ts` and the JavaScript fixture `examples/interactive-ui/artifact-fixtures.mjs` requires its maintained adjacent declaration file. Both were omitted from the integration branch.
- Core acceptance invariant: Restore the two maintained donor fixture support files byte-for-byte; do not alter the demo entry, fixture implementation, TypeScript config, or module resolution. The real Web typecheck, lint, and production build must pass without scratch aliases.
- Dependencies: issue-078
- Dispatch order: Immediately after the six-file entry-point slice.
- Ownership: `packages/web/src/interactive-ui-visual-fixtures.ts`; `examples/interactive-ui/artifact-fixtures.d.mts`.
- Focused verification: Exact donor blob hashes, Web typecheck and lint, real production Web build, all three restored HTML outputs and referenced assets, `git diff --check`.
- Pi binding: run `37f34772-c466-4ea0-bebf-bf917375e1fd`, base `5e427588`, revision 0; policy-clean with exactly the two owned paths.
- Pi attempts: Revision 0 restored both exact donor blobs and completed every focused gate; no correction was required.
- Primary attempts: none while Pi retries remain.
- Current evidence: Both files are byte-identical to donor blobs `e52e1695…` and `ad2f0540…`. Pi and primary independently pass Web typecheck, Web lint, and the real checked-in-config production build without aliases. The build emits `interactive-ui-demo.html`, `workbench-popout.html`, and `artifact-popout-host.html`; all local hashed references resolve.
- Continuation decision: Resolves the demo dependency graph and removes the last known Web build blocker.
- Next action: Resolved; rebuild the Electron package so staged Web assets include these pages.

## issue-080: Bind staged Local package validation in production runtime wiring

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: A trusted signed Local OCIX package can install through the real packaged server only after its staged tree passes the same Interactive UI runtime manifest contract.
- First-principles root cause: The hardened Manager intentionally fails closed without an injected `validateStagedPackage` adapter, but `createFeatureRoutesRuntime(...).registerRoutes` binds the Remote normalizer and activation reconciler only. Focused Manager tests used injected test adapters, so production installation remained unexercised until the packaged acceptance reached it.
- Core acceptance invariant: Production wiring supplies a staged-tree validator that uses the authoritative runtime parser against only the staged directory, rejects load errors, duplicate/missing extensions, or any id/version mismatch with the verified package, and exposes no staged path or raw parser error publicly. Existing Remote validation, authorization, activation, and route ordering remain unchanged. A public-route test must install a real signed/trusted Local package and prove it appears in both Manager and runtime registry.
- Dependencies: issues 014, 061, 077
- Dispatch order: Before the next packaged acceptance rerun.
- Ownership: `packages/web/server/lib/opencode/feature-routes-runtime.js`; `packages/web/server/lib/opencode/feature-routes-runtime.test.js`.
- Focused verification: New production-registration Local install test, existing feature-routes runtime suite, Interactive UI Manager/routes regressions, Web lint/typecheck, `git diff --check`.
- Pi binding: run `53a51249-1a2b-49d8-9796-d2c51515b84c`, base `64c0dd23`, revision 0; policy-clean with exactly the two owned paths.
- Pi attempts: Revision 0 bound the authoritative staged-tree validator and added positive/negative public-route coverage; no correction was required.
- Primary attempts: none while Pi retries remained. Primary integrated the exact candidate and performed the dependency-backed verification unavailable in the isolated Pi worktree.
- Current evidence: The production registration suite passes 9/9 (108 assertions), including a real signed/trusted Local package appearing in both Manager and runtime registry plus a runtime-invalid package rejected before activation with controlled `staged_extension_invalid`. Manager/Remote/Artifact regressions pass 129/129 (730 assertions); Web typecheck, Web lint, and `git diff --check` pass. The initial sandbox run could not bind loopback port 0; the identical test passed in the approved host test environment.
- Continuation decision: The Manager remains fail-closed without an adapter, while production now supplies the authoritative staged-only validator without exposing paths or raw parser errors.
- Next action: Resolved; rebuild the Electron package and rerun packaged desktop acceptance end to end.

## issue-081: Attach sandboxed Artifact Runner before document navigation

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Script-enabled generated and installed HTML Artifacts use a lifecycle-safe native Desktop Runner whose view is owned before navigation and cannot leak state/resources on navigation failure.
- First-principles root cause: `createArtifactRunnerManager.start` loaded the Artifact document before attaching its empty `WebContentsView` to the owning window, violating the required ownership-before-navigation lifecycle and leaving failure cleanup under-specified. Early packaged timeouts also emitted opaque-origin diagnostics, but later evidence proved their actual missing handshake was the distinct omitted-preload defect in issue083; this issue owns attach ordering and cleanup, not suppression of that diagnostic.
- Core acceptance invariant: The empty Runner view is attached to the live owner before navigation, remains invisible until layout acknowledgement, and is fully detached/closed on load failure. URL allowlisting, isolated partition, permission denial, navigation blocking, limits, clipping, popout behavior, and controlled public errors remain unchanged. A focused unit test must lock the attach-before-load ordering and failure cleanup; packaged acceptance must reach `desktop-runner` ready rather than `timed-out`. Opaque-origin diagnostic lines are classified separately by issue082 and do not fail this invariant without observable supported-behavior impact.
- Dependencies: issues 077, 080
- Dispatch order: Serial blocker for the next packaged desktop acceptance rerun.
- Ownership: `packages/electron/artifact-runner.mjs`; `packages/electron/artifact-runner.test.mjs`.
- Focused verification: `bun run --cwd packages/electron test:artifact-runner`, Electron syntax/type check, `git diff --check`, then primary rebuild plus `bun run test:interactive-ui-desktop-packaged` against the rebuilt app.
- Pi binding: run/session `f6dff310-ae57-4661-aa52-b7981bb17685`, base `f35b4ffdf220c3b21c94d25a95a54d0361005e33`, revision 0, supervised-local worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/f6dff310-ae57-4661-aa52-b7981bb17685`.
- Pi attempts: Revision 0 changed only the two owned files, restored attach-before-load ordering, and added explicit success-order plus load-failure cleanup tests; policy state is clean with diff digest `d6adc16b…`. No correction has been required.
- Primary attempts: none while Pi retries remain. Primary integrated the exact revision-0 candidate and independently reran its focused gates.
- Current evidence: Before the fix, rebuilt-package acceptance timed out with no backend. The accepted candidate passes 9/9 Artifact Runner tests and Electron type/syntax checks; its negative test proves failed navigation detaches/closes the View, clears partition storage/state, and emits controlled `load-failed` termination. After issue083 restored the omitted preload, the final packaged acceptance reaches `desktop-runner:ready-then-stopped`, proves native clipping and installed-Artifact restart persistence, and reports zero runtime errors. This establishes the attach-before-load lifecycle as correct; the residual Chromium diagnostic is separately non-blocking issue082.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Restore the required lifecycle ordering with focused regression coverage; do not weaken CSP sandboxing or fall back to an iframe for scripts.
- Next action: Resolved; keep the focused ordering/cleanup tests and packaged Runner acceptance as regression gates.

## issue-082: Classify opaque-origin diagnostics without weakening the Broker sandbox

- Status: OPEN
- Classification: NON-BLOCKING
- Goal / user outcome: Distinguish Chromium's opaque-origin site-tuple diagnostic from observable Artifact Runner failure so a log-only condition does not justify weakening the Broker sandbox.
- First-principles root cause: Early packaged runs correlated repeated opaque-origin diagnostics with Runner timeout, but the later live inspection and issue083 proved the actual missing handshake was the omitted external Runner preload. With that preload packaged, the original stronger `Content-Security-Policy: sandbox allow-scripts` Broker policy reaches native Runner ready/stop, clipping, installed-Artifact restart persistence, and zero reported runtime errors. The diagnostic may still be emitted by Chromium for the intentionally opaque Broker, but no supported behavior currently depends on removing that opacity.
- Core acceptance invariant: Retain the stronger top-level Broker CSP and the nested Artifact `sandbox="allow-scripts"` isolation. Treat the Chromium line as non-blocking unless a reproducible supported behavior fails while the preload/lifecycle are present. Any future CSP relaxation requires a new observable failing case plus focused outer/inner sandbox tests; log suppression alone is not an acceptance goal.
- Dependencies: issues 077, 080, 081, 083
- Dispatch order: Diagnostic-only follow-up; does not block local installation while full packaged behavior remains green.
- Ownership: No active product-code ownership. If a future behaviorally failing case appears, reopen with its observed path before assigning route/CSP files.
- Focused verification: Correlate application diagnostics with the full packaged report; require native Runner ready/stop, clipping, restart persistence, and zero runtime errors under the original stronger CSP.
- Pi binding: run/session `65c4f2d8-8a66-404a-89a2-37840b3184db`, base `1b2aff7bb2a709ca1dc99c8d913d0b0fb330c4dc`, revision 0, supervised-local worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/65c4f2d8-8a66-404a-89a2-37840b3184db`.
- Pi attempts: Revision 0 changed exactly the two owned files: the trusted Broker CSP now has `allow-same-origin`, and route tests assert the outer directive exactly while proving the inner iframe remains `allow-scripts` only. Policy state is clean with diff digest `c45483d7…`; no correction has been required.
- Primary attempts: none while Pi retries remain. Primary integrated the exact candidate and performed dependency-backed verification unavailable in the isolated Pi worktree.
- Current evidence: The issue081 rebuild preserved attach-before-load but packaged acceptance still reported host `timed-out` plus repeated opaque-origin tuple failures. Revision 0 passed the route suite 14/14, Web typecheck/lint, and its two-layer CSP assertions, but the rebuilt package still failed identically. A fast live inspection then proved both the top-level Broker and nested data iframe reach `readyState=complete`; the actual missing event is layout acknowledgement because the external Runner preload is absent from `app.asar` (issue083). Revision 0 is rejected and its CSP relaxation is reverted.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Do not retain an unnecessary same-origin relaxation. The remaining Chromium diagnostic is independent of the proven package-resource omission and does not block testing issue083 with the original stronger Broker policy.
- Next action: The final packaged acceptance passes with zero runtime errors and no observable impact while retaining the stronger original Broker policy. Keep documented as non-blocking Chromium diagnostic noise; do not weaken CSP without a behaviorally failing case.

## issue-083: Include the Artifact Runner preload in the packaged app

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: Script-enabled Artifacts in the packaged desktop app execute their isolated Runner preload, acknowledge native layout, receive `host.init`, and reach `artifact.ready`.
- First-principles root cause: `createArtifactRunnerManager` resolves the packaged preload at `app.getAppPath()/artifact-runner-preload.cjs`, but Electron `build.files` includes only `dist-bundle/main.mjs` and `preload.mjs`. The built `app.asar` therefore omits `artifact-runner-preload.cjs`; the Broker loads, but no preload applies layout or sends `openchamber:artifact-runner-layout-applied`, so the main process never emits `loaded` and the Host never sends `host.init`.
- Core acceptance invariant: `artifact-runner-preload.cjs` is present at the exact packaged `app.getAppPath()` path on every target, while remaining an external narrow preload (not merged into the main/UI bundle). Existing Electron sandbox/contextIsolation/partition permissions and Broker/inner Artifact CSP remain unchanged. Package inspection must prove the file exists in `app.asar`, and packaged acceptance must show native Runner ready/stop, inner theme initialization, installed Artifact behavior, restart persistence, and no runtime errors.
- Dependencies: issues 077, 080, 081
- Dispatch order: Serial packaging blocker; issue082 response-policy candidate is rejected and reverted first.
- Ownership: `packages/electron/package.json`.
- Focused verification: parse package config and confirm `build.files` contains `artifact-runner-preload.cjs`; primary Electron package build, `@electron/asar` listing/extraction check, packaged CLI check, and full packaged desktop acceptance.
- Pi binding: run/session `1abff818-f65b-4a9a-a0e1-cd8e528b29cd`, base `adba62a627cf54061dca4113b7dc10f8fedf7208`, revision 0, supervised-local worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/1abff818-f65b-4a9a-a0e1-cd8e528b29cd`.
- Pi attempts: Revision 0 adds exactly `artifact-runner-preload.cjs` to `build.files`; one owned manifest changed, policy state is clean, and diff digest is `0e07e2ce…`. No correction has been required.
- Primary attempts: none while Pi retries remain. Primary integrated the exact candidate and verified the manifest parses with the required entry exactly once.
- Current evidence: Live fast diagnostics showed the Runner backend plus both Broker/inner iframe targets at `readyState=complete`, but the Broker iframe had no layout style and Host stayed `loading`. The previous built app had no Runner preload in its app root, while `main.mjs` explicitly requests `path.join(app.getAppPath(), "artifact-runner-preload.cjs")`. Revision 0 is byte-identical to Pi, `build.files` contains `["dist-bundle/main.mjs","preload.mjs","artifact-runner-preload.cjs"]`, and `git diff --check` passes. The rebuilt `app.asar` now contains `artifact-runner-preload.cjs` (2819 bytes, SHA-256 `370d3be6…`), and the real packaged acceptance reaches host state `ready` with backend `desktop-runner`, zero host iframes, and a working stop action. The later clipping-fixture assertion is a distinct test-geometry defect tracked as issue084. The fork CLI is present under `Contents/Resources/opencode-cli/opencode`, reports `1.18.10-oc.1+f263f908`, and embeds distribution `ZunbaRan/opencode` plus full fork/upstream commits.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Add the missing external preload to the electron-builder file allowlist; do not modify runtime handshake or weaken sandboxing.
- Next action: Resolved; continue the already-running packaged acceptance through issue084's deterministic clipping fixture.

## issue-084: Make the packaged clipping fixture deterministically cross the scroller edge

- Status: RESOLVED
- Classification: P0
- Goal / user outcome: The real packaged desktop acceptance proves native Artifact Runner pixels are clipped at the scroll container and cannot cover the green sibling guard.
- First-principles root cause: The test assumes that setting `scrollTop = 80` leaves the native Runner crossing the scroller's lower edge, but the current fixture's pre-Runner spacer is only `h-44`. With the packaged Runner's measured 120 px content height, its bottom remains above the 520 px scroller edge, so the test aborts before inspecting actual clipping. The Runner itself is healthy (`ready`, `desktop-runner`, stop present); the fixture geometry no longer establishes the precondition the assertion is meant to verify.
- Core acceptance invariant: Make the fixture geometry deterministic so, after the existing 80 px scroll, the Runner rectangle extends across the scroller's lower edge by a stable positive margin while the green guard remains a sibling below the scroller. Preserve the real scroll action, Runner content, 520 px scroller, screenshot/pixel guard inspection, and all runtime/security behavior. Add a focused source-level or browser-independent regression assertion that locks the geometry precondition; do not weaken or remove the packaged assertion.
- Dependencies: issues 077, 081, 083
- Dispatch order: Immediate serial blocker for completing packaged desktop acceptance and local installation.
- Ownership: `packages/web/src/interactive-ui-demo.tsx`; `packages/electron/scripts/verify-packaged-interactive-ui.mjs`; at most one focused test file if an existing adjacent test seam requires it.
- Focused verification: Web typecheck/lint; Electron script syntax check or closest package test; a deterministic geometry regression that would fail with the old `h-44` fixture; `git diff --check`. Primary then rebuilds and reruns the full packaged desktop acceptance.
- Pi binding: run/session `5b73d482-a3a8-498d-b8a9-ddcef1c2d10e`, base `f06c8964055c7bbe1e2a591ed0f4b7e8f1e5a596`, final revision 1, supervised-local worktree `/Users/loloru/.codex/sol-pi-advisor/worktrees/5b73d482-a3a8-498d-b8a9-ddcef1c2d10e`.
- Pi attempts: Revision 0 changed exactly the pre-Runner spacer from `h-44` to `h-[500px]` and added an adjacent geometry comment; policy was clean with diff digest `22dae6cb…`. Fresh Sol returned `fix-first` because the ledger also promised a focused browser-independent/source-level regression. Correction 1 reused the same run/session with `issueAttempts.issue-084 = 1`, changed only the two allowed paths, has no dependency/outside-path violations, and produced diff digest `7d81fc04…`.
- Primary attempts: The first rebuilt package with issue083 fixed reached native Runner ready, then failed exactly at `runner.bottom > scroller.bottom`; diagnostics showed the Broker iframe at 974×120 and no renderer errors. Primary integrated revision 0, independently passed Web typecheck/lint, rebuilt with the exact fork CLI override, and ran the full packaged acceptance.
- Current evidence: The old fixture used a 520 px scroller, a 176 px (`h-44`) pre-Runner spacer, and an 80 px scroll. Revision 0 made the spacer 500 px, producing a stable 60 px crossing with the measured 120 px Runner. Correction 1 adds a stable spacer marker and a first-gate source verifier with standalone `--verify-clip-fixture-source` mode; it locks the 520/500 px heights, p-5/mb-5 spacing, shared scrollTop 80, and computed crossing margin before any CRM probe, Electron launch, network, or screenshot. Primary matched both candidate file hashes exactly, independently passed the focused command, Node syntax, workspace typecheck/lint, and Artifact Runner 9/9, then rebuilt with the exact fork CLI override. The full packaged acceptance again reports `ok: true`, 0 magenta leak pixels, 397631 green pixels, 95.58% green ratio, restart persistence, and zero runtime errors.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Adjust only the deterministic acceptance fixture/test geometry, not native Runner layout or production clipping behavior.
- Next action: Resolved; retain both the browser-independent source contract and the full pixel-level packaged assertion.
