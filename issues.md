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

## issue-005: Restore extension trust, install, update, rollback, and uninstall

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Signed extensions move through trust/install/update/rollback/uninstall atomically without deleting valid prior state on failure.
- First-principles root cause: The target has no authoritative Extension Manager or trust store.
- Core acceptance invariant: Publisher slot/fingerprint and package identity are enforced; conflicts fail closed; failed writes preserve the prior installed version and unmanaged OpenCode files.
- Dependencies: issue-004
- Dispatch order: Serial after package validation.
- Ownership: `packages/web/server/lib/interactive-ui/manager.js`; `packages/web/server/lib/interactive-ui/manager.test.js`.
- Focused verification: Run focused manager tests covering trust, conflict, update, rollback, uninstall, failure atomicity, and unmanaged-file preservation.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor manager/test are large feature-owned files; target has neither.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables route/runtime and client-manager issues.
- Next action: Queue behind issue-004.

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

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Explicit OCIX routes expose artifact materialization and approved business requests before the generic OpenCode proxy.
- First-principles root cause: The clean target has no OCIX route contract; dashboard schema validation is restored independently by issue-057.
- Core acceptance invariant: Route order is explicit; auth/project/extension binding is authoritative; malformed and unauthorized requests fail closed; fetch failure never masquerades as empty success.
- Dependencies: issue-006, issue-007, issue-057
- Dispatch order: Serial after both authoritative stores.
- Ownership: `packages/web/server/lib/interactive-ui/routes.js`; `packages/web/server/lib/interactive-ui/routes.artifact.test.js`.
- Focused verification: Run focused route/artifact tests and inspect route registration order against the accepted dashboard contract.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: All files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-014 and Artifact UI work.
- Next action: Queue after issues 006-007.

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

- Status: READY
- Classification: NORMAL
- Goal / user outcome: The managed server installs and reloads the built-in OCIX Agent Runtime tools/skills without conflicts or external package requirements.
- First-principles root cause: The target has no built-in OCIX runtime package or loader.
- Core acceptance invariant: Tool/Skill assets are deterministic, conflict-safe, reloadable, and never overwrite unmanaged OpenCode files; missing/corrupt assets fail explicitly.
- Dependencies: issue-004, issue-005
- Dispatch order: Serial after package/manager contracts. This cohesive packaged fixture may own more than five asset files, but any change outside the built-in runtime asset/loader boundary requires replan before dispatch.
- Ownership: `packages/web/server/lib/interactive-ui/agent-runtime.js`; `packages/web/server/lib/interactive-ui/builtin-runtime.js`; `packages/web/server/lib/interactive-ui/builtin-runtime.test.js`; `packages/web/server/lib/interactive-ui/builtin/**`.
- Focused verification: Run built-in runtime tests and inspect installed manifest/tool/skill hashes plus conflict/cleanup behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Runtime loader and self-contained assets exist only in donor.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-014.
- Next action: Queue behind issues 004-005; split assets if first-candidate scope exceeds the frozen package boundary.

## issue-011: Restore Direct Remote manifest connection and consent

- Status: READY
- Classification: NORMAL
- Goal / user outcome: A signed Remote Manifest URL plus Access Key can be inspected/connected with publisher identity, permission review, and consent preserved.
- First-principles root cause: The target lacks Remote OCIX manifest lifecycle and hosted adapter.
- Core acceptance invariant: Inspect does not fetch signed resources; manifest identity/signature/slot/key requests are request-bound; credentials remain server-side; failed reconnect does not clear a valid shell.
- Dependencies: issue-004, issue-005, issue-006, issue-008, issue-012, issue-058, issue-060
- Dispatch order: Serial remote trust-domain lane before cache/update behavior.
- Ownership: `packages/web/server/lib/interactive-ui/routes.remote.test.js`.
- Focused verification: Run focused Remote route tests against the accepted Manager/routes/Remote verifier/cache contracts; prove inspect/connect separation, signature/slot/key errors, non-retention, and valid-shell preservation.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor owns these files; target has none.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-012.
- Next action: Queue after security dependencies.

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

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Connected Remote apps expose truthful health/update state and require re-consent when signed identity/permissions change.
- First-principles root cause: The target has no OCIX runtime health/update state machine; pure routing normalization is restored independently by issue-056.
- Core acceptance invariant: Health is request-bound; stale responses cannot overwrite newer state; changed publisher/permissions fail closed into re-consent; failed update preserves the prior runnable version.
- Dependencies: issue-011, issue-012, issue-056
- Dispatch order: Serial after cache semantics.
- Ownership: `packages/web/server/lib/interactive-ui/runtime.js`; `packages/web/server/lib/interactive-ui/runtime.test.js`.
- Focused verification: Focused runtime tests prove stale response ordering, update rollback, health, and re-consent transitions against the accepted routing contract.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor files are feature-owned and target lacks them.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-014.
- Next action: Queue behind issues 011-012.

## issue-014: Register the OCIX runtime and capability before generic proxying

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Web/Electron managed runtimes initialize OCIX services once, expose `interactive-ui.ocix.v1`, and route explicit endpoints before the generic OpenCode proxy.
- First-principles root cause: The target lifecycle has no fork runtime factory, explicit route registration, or capability publication.
- Core acceptance invariant: Initialization is deterministic/fail-closed, route order is explicit, cleanup is complete, and unsupported runtimes report a reduced capability instead of silent emptiness.
- Dependencies: issues 005-013
- Dispatch order: Final server integration seam after authoritative modules are accepted.
- Ownership: `packages/web/server/lib/opencode/feature-routes-runtime.js`; `packages/web/server/lib/opencode/feature-routes-runtime.test.js`; `packages/web/server/lib/opencode/core-routes.js`; `packages/web/server/lib/interactive-ui/runtime.js`; `packages/web/server/lib/interactive-ui/runtime.test.js`.
- Focused verification: Run focused feature-route/runtime tests; inspect explicit route-before-proxy ordering and cleanup/capability behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Target has active upstream lifecycle files; donor adapters cannot replace them wholesale.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables all OpenChamber UI client/runtime work.
- Next action: Queue after server DAG acceptance.

## issue-015: Restore Interactive UI result and state schemas

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Agent-generated Interactive UI envelopes parse into deterministic ready/error/stale states with safe fallback.
- First-principles root cause: The target has no OCIX result/state schema boundary.
- Core acceptance invariant: Valid envelopes round-trip; malformed/unknown/oversized data yields explicit fallback and never executes unvalidated layout/action data.
- Dependencies: issue-014
- Dispatch order: First shared UI schema lane.
- Ownership: `packages/ui/src/lib/interactive-ui/result.ts`; `packages/ui/src/lib/interactive-ui/result.test.ts`; `packages/ui/src/lib/interactive-ui/state.ts`; `packages/ui/src/lib/interactive-ui/types.ts`.
- Focused verification: Run focused result tests and package UI typecheck; inspect malformed fallback behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: All files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 016, 021, and 026.
- Next action: Queue after server integration.

## issue-016: Restore bindings and generated-layout sanitization

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Declarative views bind only approved data/actions and sanitize generated layout before rendering.
- First-principles root cause: The target lacks OCIX binding and layout validation.
- Core acceptance invariant: Unknown paths/actions/primitives and malformed/oversized layouts fail closed; valid bindings preserve intended values without code execution.
- Dependencies: issue-015
- Dispatch order: Schema lane before Declarative renderer.
- Ownership: `packages/ui/src/lib/interactive-ui/bindings.ts`; `packages/ui/src/lib/interactive-ui/bindings.test.ts`; `packages/ui/src/lib/interactive-ui/generatedLayout.ts`; `packages/ui/src/lib/interactive-ui/generatedLayout.test.ts`.
- Focused verification: Run both focused tests and UI typecheck; all malformed and unauthorized cases reject deterministically.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 021-022.
- Next action: Queue behind issue-015.

## issue-017: Restore Artifact and Installed Artifact result schemas

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Agent-generated and installed HTML Artifact envelopes remain distinct, validated, persistable, and safely fallback-capable.
- First-principles root cause: The target lacks both Artifact result contracts and their state model.
- Core acceptance invariant: Source identity and sandbox/business bindings cannot be confused; malformed/unknown payloads never cross into a more privileged renderer.
- Dependencies: issue-015
- Dispatch order: Schema lane before Artifact hosts.
- Ownership: `packages/ui/src/lib/interactive-ui/artifactResult.ts`; `packages/ui/src/lib/interactive-ui/artifactResult.test.ts`; `packages/ui/src/lib/interactive-ui/installedArtifactResult.ts`; `packages/ui/src/lib/interactive-ui/installedArtifactResult.test.ts`; `packages/ui/src/lib/interactive-ui/artifactState.ts`.
- Focused verification: Run both schema test files and UI typecheck; cross-source and malformed cases fail closed.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Five files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 023-025 and 026.
- Next action: Queue behind issue-015.

## issue-018: Restore MCP App host binding and persistable state

- Status: READY
- Classification: NORMAL
- Goal / user outcome: OpenChamber parses completed ToolPart MCP metadata into an exact host binding and a size-bounded persistable envelope.
- First-principles root cause: The target has no MCP App host state/binding module.
- Core acceptance invariant: Tool/server/resource/session/message/part identity remains exact; malformed or oversized model context/persisted state is rejected; diagnostics contain no secrets.
- Dependencies: OpenCode issue-006; issue-015
- Dispatch order: Host contract after backend capability/HTTP behavior.
- Ownership: `packages/ui/src/lib/interactive-ui/mcpApp.ts`; `packages/ui/src/lib/interactive-ui/mcpApp.test.ts`.
- Focused verification: Run focused MCP App UI tests and UI typecheck; all identity mismatch and size/error boundaries pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Both files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 028-029 and 026.
- Next action: Queue after OpenCode capability route is accepted.

## issue-019: Restore the browser OCIX manager client

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Settings and Workbench call explicit OCIX runtime APIs with correct runtime URL/auth switching and truthful failure semantics.
- First-principles root cause: The target has no shared client for OpenChamber-owned extension/runtime endpoints.
- Core acceptance invariant: Runtime switching invalidates stale requests; failures are not converted to empty authoritative state; credentials are never persisted or logged client-side.
- Dependencies: issue-014
- Dispatch order: Client seam before Settings/Workbench UI.
- Ownership: `packages/ui/src/lib/interactive-ui/client.ts`; `packages/ui/src/lib/interactive-ui/extensionManager.ts`; `packages/ui/src/lib/interactive-ui/extensionManager.test.ts`.
- Focused verification: Run extension-manager client tests and UI typecheck; request fidelity, switching, failed fetch, and cleanup pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Files are donor-only and must use target RuntimeAPIs primitives.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 035-042.
- Next action: Queue behind issue-014.

## issue-020: Restore routing and remote-review client state

- Status: READY
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
- Current evidence: Five donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-035.
- Next action: Queue behind issues 013 and 019.

## issue-021: Restore the Declarative Interactive UI renderer

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Valid Agent Generated and Installed Declarative views render with approved primitives, bindings, actions, state notices, and no horizontal overflow.
- First-principles root cause: The target has no Declarative host renderer.
- Core acceptance invariant: Only sanitized layouts/primitives/actions render; malformed/stale/error states remain explicit; one failed widget cannot erase unrelated content.
- Dependencies: issue-015, issue-016
- Dispatch order: Renderer after schemas/bindings.
- Ownership: `packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.tsx`; `packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIView.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIStateNotice.tsx`; `packages/ui/src/components/interactive-ui/InteractiveUIStateNotice.test.tsx`.
- Focused verification: Run Declarative/state-notice tests and UI typecheck; inspect malformed, action, narrow-layout, and overflow boundaries.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Five feature-owned donor files; final donor behavior includes Host Confirmation carry-forward and must be reconciled with issue-025.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-026.
- Next action: Queue after issues 015-016; preserve target UI primitives.

## issue-022: Restore Trusted Native and Host Native UI Kit

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Trusted Native OCIX views render only registered components with the Style v2 token contract.
- First-principles root cause: The target lacks native registries and UI Kit.
- Core acceptance invariant: Unknown components/props/actions fail closed; registered primitives receive scoped tokens and cannot escape the host authority boundary.
- Dependencies: issue-015, issue-016
- Dispatch order: Parallel-capable with issue-021 only after shared schemas freeze, but serial by default.
- Ownership: `packages/ui/src/components/interactive-ui/NativeUIKit.tsx`; `packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx`; `packages/ui/src/components/interactive-ui/nativeRegistry.ts`; `packages/ui/src/components/interactive-ui/nativeUIKitRegistry.ts`; `packages/ui/src/components/interactive-ui/DeclarativeAdvancedPrimitives.tsx`.
- Focused verification: Run NativeUIKit tests and UI typecheck; unknown registry/prop/action cases reject and scoped tokens render.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Five donor-only feature files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-026 and Style acceptance.
- Next action: Queue after schemas.

## issue-023: Restore the HTML Artifact sandbox bridge

- Status: READY
- Classification: NORMAL
- Goal / user outcome: HTML Artifacts communicate through a versioned, size/rate-limited host bridge without direct business or privileged API access.
- First-principles root cause: The target lacks the Artifact bridge parser/host-init boundary.
- Core acceptance invariant: Origin/version/type/size/rate violations fail closed; Agent Generated content cannot invoke business APIs; safe messages preserve exact request identity.
- Dependencies: issue-017
- Dispatch order: Security bridge before Artifact view.
- Ownership: `packages/ui/src/lib/interactive-ui/artifactBridge.ts`; `packages/ui/src/lib/interactive-ui/artifactBridge.test.ts`; `packages/ui/src/components/interactive-ui/artifactBusinessRequest.ts`.
- Focused verification: Run bridge tests and UI typecheck; malformed, rate, size, origin, business-authority, and safe-init cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Three donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-024 and issue-025.
- Next action: Queue behind issue-017.

## issue-024: Restore the Agent Generated HTML Artifact host

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Agent Generated HTML renders in the intended sandbox with explicit loading/error/stale state and stable execution surface.
- First-principles root cause: The target has no Artifact view/state host.
- Core acceptance invariant: Sanitized content stays sandboxed, failure is visible, frame lifecycle is deterministic, and no business/native privilege is available.
- Dependencies: issue-017, issue-023
- Dispatch order: Host after schema/bridge.
- Ownership: `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactStateNotice.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactStateNotice.test.tsx`; `packages/ui/src/components/interactive-ui/DOCUMENTATION.md`.
- Focused verification: Run state/Artifact focused tests and UI typecheck; inspect sandbox flags, error/fallback, remount, and privilege boundary.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor files include later uncommitted confirmation changes; whole-file donor copying is not accepted without source reconciliation.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-025 and issue-026.
- Next action: Queue after issues 017/023.

## issue-025: Restore Installed Artifact host confirmation write safety

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Third-party Installed Artifacts can request business writes only through a host-top-layer confirmation with Cancel as safe focus and exactly one write after Confirm.
- First-principles root cause: The clean target lacks the Installed Artifact confirmation host; the latest implementation exists only as an uncommitted descendant donor.
- Core acceptance invariant: Escape/Cancel perform zero upstream writes and preserve authoritative pending state; Confirm performs exactly one request-bound write; popup cannot be trapped inside the sandbox; secrets never enter the frame.
- Dependencies: issue-006, issue-017, issue-023, issue-024
- Dispatch order: Serial security/UI lane after gateway and Artifact host. It explicitly does not resume suspended issue-001.
- Ownership: `packages/ui/src/components/interactive-ui/InstalledArtifactConfirmationHost.tsx`; `packages/ui/src/components/interactive-ui/InstalledArtifactConfirmationHost.test.tsx`; `packages/ui/src/components/interactive-ui/InteractiveConfirmationDialog.tsx`; `packages/ui/src/components/interactive-ui/HTMLArtifactView.tsx`.
- Focused verification: Run Installed Artifact host tests and conversation-browser Confirm/Escape/Cancel evidence; exactly 0/0/1 writes and host-top-layer focus are required.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Prior focused tests and real Chrome core write-safety passed in `.worktrees/host-confirmation-integration`; three suspended residual issues remain excluded.
- Suspension decision: n/a; only issue-001/002/003 remain suspended
- Resume condition: n/a
- Continuation decision: Enables issue-026/027 and final product acceptance.
- Next action: Forward-port the accepted core behavior without adding the deferred inert/session-cleanup/report fixes.

## issue-026: Add narrow rich-result dispatch to the target ToolPart

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Target-release ordinary Tool UI remains intact while completed OCIX, Artifact, Installed Artifact, and MCP App results select the correct lazy renderer and preserve raw fallback.
- First-principles root cause: The upstream ToolPart knows none of the fork envelopes/metadata, while the donor ToolPart contains large unrelated UI drift.
- Core acceptance invariant: Only exact validated bindings select rich renderers; unknown/malformed content uses upstream fallback; ordinary Tool typography/expansion stays target-owned; persistence/Pin observations retain exact identity.
- Dependencies: issues 015-025, issue-028, issue-029
- Dispatch order: Late serial host seam after every renderer contract freezes.
- Ownership: `packages/ui/src/components/chat/message/parts/ToolPart.tsx`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.ts`; `packages/ui/src/components/chat/message/parts/toolRenderUtils.test.ts`.
- Focused verification: Run helper/renderer dispatch tests, UI typecheck/lint, and inspect diff against `v1.18.1` to prove only adapter/state logic was added.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Target and donor ToolPart diverge heavily; whole-file replacement is forbidden. Current donor has no direct ToolPart component test.
- Suspension decision: n/a; collapsed-focus issue-001 stays suspended
- Resume condition: n/a
- Continuation decision: Enables conversation/browser acceptance.
- Next action: Queue after all rich modules and wrappers.

## issue-027: Restore message-level default-open rich-result state

- Status: READY
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
- Current evidence: Latest uncommitted donor passes default-open/host-preservation E2E; final reviewer only rejected the separately suspended inert boundary.
- Suspension decision: n/a; issue-001 remains excluded
- Resume condition: n/a
- Continuation decision: Enables final conversation-browser acceptance.
- Next action: Queue immediately after issue-026.

## issue-028: Restore MCP AppBridge rendering and lifecycle

- Status: READY
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
- Current evidence: Two donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-026 and tldraw acceptance.
- Next action: Queue after issue-018 and OpenCode HTTP acceptance.

## issue-029: Restore OpenCode capability and MCP App client wrappers

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Shared UI reads the fork capability document and performs exact MCP App resource/tool-call requests across supported runtimes.
- First-principles root cause: Target `opencode/client.ts` lacks fork API gaps and runtime capability diagnostics.
- Core acceptance invariant: Request parameters preserve session/message/part/tool/server/resource identity; managed fork vs external legacy capability is explicit; failure is diagnostic, never silent empty.
- Dependencies: OpenCode issues 005-006, issue-018
- Dispatch order: Serial client seam before renderer/ToolPart acceptance.
- Ownership: `packages/ui/src/lib/opencode/client.ts`; matching focused client tests discovered in the target package before dispatch.
- Focused verification: Run focused client tests and UI typecheck; inspect request fidelity and reduced-capability behavior.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor and target both have active client files; manual narrow replay is required.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 028 and 026.
- Next action: Discover exact target test owner before dispatch; do not broaden the lane.

## issue-030: Restore Generative Widget parsing and sanitization

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Streaming/final `show-widget` fences parse deterministically and produce sandbox-safe HTML/CSS/JS under fixed CSP/allowlist limits.
- First-principles root cause: The target has no Generative Widget wire parser or sanitizer.
- Core acceptance invariant: Partial fences do not leak raw executable content; malformed/oversized/disallowed URLs/CSP/connect behavior fail closed; finalized valid widgets persist identically.
- Dependencies: OpenCode issue-007
- Dispatch order: First Widget UI contract.
- Ownership: `packages/ui/src/lib/generative-widget/parseShowWidget.ts`; `packages/ui/src/lib/generative-widget/parseShowWidget.test.ts`; `packages/ui/src/lib/generative-widget/sanitizer.ts`; `packages/ui/src/lib/generative-widget/sanitizer.test.ts`.
- Focused verification: Run parser/sanitizer tests and UI typecheck; streaming, malformed, CSP, allowlist, and size cases pass.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 031-034.
- Next action: Queue after OpenCode prompt contract.

## issue-031: Restore Generative Widget runtime bridges and height cache

- Status: READY
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
- Current evidence: Four donor-only modules; test ownership must be frozen in the task packet.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 032 and 034.
- Next action: Queue behind issue-030.

## issue-032: Restore the Generative Widget renderer

- Status: READY
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
- Current evidence: Five donor-only files; decorative dot background is explicitly excluded.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-033.
- Next action: Queue behind issues 030-031.

## issue-033: Add the narrow Widget dispatch to target AssistantTextPart

- Status: READY
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
- Current evidence: Donor has one priority branch; target file is upstream-active.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables Widget conversation acceptance.
- Next action: Queue behind issue-032.

## issue-034: Add the narrow Widget send bridge to target ChatInput

- Status: READY
- Classification: NORMAL
- Goal / user outcome: `window.__widgetSendMessage` follow-ups use the current session/provider/model/agent/variant through the normal send path.
- First-principles root cause: The target ChatInput does not register the Widget send handler.
- Core acceptance invariant: The bridge is bounded and cleaned up; it never sends without current authoritative context or lets the iframe call APIs directly; ordinary ChatInput behavior remains target-owned.
- Dependencies: issue-031
- Dispatch order: Serial host seam after bridge module.
- Ownership: `packages/ui/src/components/chat/ChatInput.tsx`; one focused bridge lifecycle test if target precedent supports it.
- Focused verification: Focused bridge lifecycle test plus UI typecheck/lint; inspect current-context fidelity and cleanup.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor adds one effect; target ChatInput is upstream-active.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables Widget model E2E.
- Next action: Queue behind issue-031.

## issue-035: Restore Applications settings feature sections

- Status: READY
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
- Current evidence: Three feature-owned donor additions are absent from target.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-036.
- Next action: Queue after clients and Style contract.

## issue-036: Register Applications settings without replacing upstream settings UI

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Desktop and mobile users can reach the OCIX Applications surface through upstream settings navigation and search.
- First-principles root cause: Target settings metadata/navigation knows no OCIX section; donor files also contain unrelated UI drift.
- Core acceptance invariant: One narrow Applications registration works in desktop/mobile/search; every unrelated target section, route, label, spacing, and behavior remains unchanged.
- Dependencies: issue-035
- Dispatch order: Narrow host seam after feature sections.
- Ownership: `packages/ui/src/components/views/SettingsView.tsx`; `packages/ui/src/lib/settings/metadata.ts`; `packages/ui/src/lib/settings/search.ts`; `packages/ui/src/apps/MobileApp.tsx`.
- Focused verification: Focused settings/search tests, UI typecheck/lint, and line-level diff against `v1.18.1`.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: All four files are upstream-owned and diverge substantially in donor; whole-file replacement is forbidden.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables user-facing OCIX configuration acceptance.
- Next action: Queue immediately after issue-035.

## issue-037: Add only fork-required localization keys

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Fork Applications, Workbench, Artifact, MCP App, and Widget surfaces have complete supported-locale labels while upstream wording remains target-owned.
- First-principles root cause: New fork surfaces require keys absent from target locale modules.
- Core acceptance invariant: All supported locales have an identical fork-key set, no unrelated target string changes, and missing keys fail the locale test. This single localization domain may exceed five files; no non-locale file may enter the lane.
- Dependencies: issue-035, issue-041, issue-047
- Dispatch order: After visible contracts freeze, before final UI acceptance.
- Ownership: `packages/ui/src/lib/i18n/messages/*.settings.ts`; only unavoidable fork keys in the paired `packages/ui/src/lib/i18n/messages/*.ts`; `packages/ui/src/lib/i18n/messages.test.ts`.
- Focused verification: Run locale key-parity tests, UI typecheck, and review a key-only diff against target.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor locale files contain broad upstream drift, so only exact fork keys may be replayed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final settings/workbench acceptance.
- Next action: Freeze exact keys and split settings/base locale files if the first-candidate diff is not mechanically reviewable.

## issue-038: Restore Workbench shared client state

- Status: READY
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
- Current evidence: All three files are donor-only.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 039-041.
- Next action: Queue behind server store and client.

## issue-039: Restore Workbench layout and version contracts

- Status: READY
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
- Current evidence: Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-041.
- Next action: Queue behind issue-038.

## issue-040: Restore Workbench events and popout lifecycle

- Status: READY
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
- Current evidence: Four donor-only files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-041.
- Next action: Queue behind issue-038.

## issue-041: Restore Workbench and Pin user interface

- Status: READY
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
- Current evidence: Five feature-owned donor files are absent from target.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 043-044.
- Next action: Queue behind issues 038-040.

## issue-042: Persist only Workbench UI state in the target UI store

- Status: READY
- Classification: NORMAL
- Goal / user outcome: The upstream UI store persists the minimum Workbench tab/layout visibility state without adopting unrelated donor preferences.
- First-principles root cause: Target `useUIStore` has no Workbench fields or sanitizer.
- Core acceptance invariant: New fields are versioned/sanitized, unknown data falls back, and every existing target field/default/migration remains unchanged.
- Dependencies: issue-038, issue-041
- Dispatch order: Narrow store adapter after Workbench schema freezes.
- Ownership: `packages/ui/src/stores/useUIStore.ts`; one focused persistence/sanitizer test discovered before dispatch.
- Focused verification: Focused persistence test, UI typecheck, and line-level diff against target.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor and target stores diverge broadly; whole-file replacement is forbidden.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables layout registration.
- Next action: Freeze exact fields and test owner before dispatch.

## issue-043: Register the Workbench tab in the upstream right sidebar

- Status: READY
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
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Target file is upstream-active and donor has broad layout drift.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-044.
- Next action: Queue behind Workbench UI/store.

## issue-044: Host Workbench mode in the upstream Context Panel

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Selecting Workbench renders the persistent board in the existing Context Panel with correct close/focus behavior.
- First-principles root cause: Target Context Panel has no Workbench mode.
- Core acceptance invariant: The adapter is capability-gated and lazy; existing context modes and panel sizing stay byte-for-byte target-owned except the narrow branch.
- Dependencies: issue-043
- Dispatch order: Final Workbench layout seam.
- Ownership: `packages/ui/src/components/layout/ContextPanel.tsx`; focused context-mode test if target precedent supports it.
- Focused verification: UI typecheck/lint, focused mode test, and line-level target diff.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Target file is upstream-active; donor whole-file replay is forbidden.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Completes Workbench host registration.
- Next action: Queue behind issue-043.

## issue-045: Restore the privileged Electron Artifact Runner boundary

- Status: READY
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
- Current evidence: Three donor-only Electron files.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-046.
- Next action: Queue after Artifact bridge/host.

## issue-046: Register Artifact Runner and binary save through narrow Electron adapters

- Status: READY
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
- Current evidence: Main/preload/package are upstream-active; only narrow imports/IPC/lifecycle hooks are allowed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issue-047 and packaged acceptance.
- Next action: Queue behind issue-045.

## issue-047: Restore the Artifact execution surface and geometry

- Status: READY
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
- Current evidence: Feature-owned surface/geometry files are donor-only; HTMLArtifactView integration must follow issue-024.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables packaged Artifact acceptance.
- Next action: Queue behind issues 024/046.

## issue-048: Restore scoped OCIX Style v2 tokens and presets

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Fork-rendered surfaces use a coherent Style v2 token/preset contract while all ordinary upstream UI styling remains unchanged.
- First-principles root cause: Target lacks OCIX theme/preset modules and scoped token definitions.
- Core acceptance invariant: Every selector is rooted under the explicit OCIX/Artifact/Workbench host scope, presets validate deterministically, no global element/reset/body/theme rule is added, and unsupported tokens fall back safely.
- Dependencies: issue-015
- Dispatch order: Style contract before visible feature sections/renderers finalize.
- Ownership: `packages/ui/src/lib/interactive-ui/stylePresets.ts`; `packages/ui/src/styles/ocix-theme.css`; `packages/ui/src/styles/ocix-presets.css`; one narrow import in the target style entry after discovery.
- Focused verification: UI typecheck/build, preset unit checks, selector-scope audit, and target visual smoke proving ordinary UI parity.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor owns scoped files but also broad `design-system.css`/`mobile.css` drift that is explicitly excluded.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables issues 022/035 and final visual acceptance.
- Next action: Discover the smallest target style entry import; do not replay donor global CSS.

## issue-049: Restore extension and demo lifecycle acceptance fixtures

- Status: READY
- Classification: NORMAL
- Goal / user outcome: Signed OCIX install/demo/start/stop/system flows run deterministically against the real product and clean every created process/state artifact.
- First-principles root cause: Target has no fork acceptance fixture/orchestration scripts.
- Core acceptance invariant: Fixtures are self-contained, port/process/state ownership is exact, cleanup is truthful on success/failure, and no user OpenCode data is touched.
- Dependencies: issues 004-014
- Dispatch order: Acceptance infrastructure after server product path passes focused tests. Cohesive script suite may exceed five files; freeze exact script-only paths before dispatch.
- Ownership: `scripts/interactive-ui-demo*.mjs`; `scripts/interactive-ui-extension*.mjs`; `scripts/interactive-ui-system-test.mjs`; `scripts/lib/interactive-ui-demo-lifecycle.mjs`.
- Focused verification: Run lifecycle/extension tests and one isolated system smoke; verify zero leftover process/temp state.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor-only acceptance scripts exist; package command wiring belongs to issue-054.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables unified acceptance.
- Next action: Split lifecycle library/tests from command wrappers if the candidate is not mechanically auditable.

## issue-050: Restore the self-contained tldraw MCP App browser harness

- Status: READY
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
- Current evidence: Five donor-only harness files plus existing root `tldraw-mcp-app` fixture.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Provides MCP Apps P0 release evidence.
- Next action: Queue after backend/host integration.

## issue-051: Restore conversation and hybrid CRM product acceptance

- Status: READY
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
- Current evidence: Donor and Host Confirmation descendant contain accepted core evidence; failure-window cleanup remains suspended issue-002.
- Suspension decision: n/a; issue-002 stays suspended
- Resume condition: n/a
- Continuation decision: Provides OCIX/Artifact P0 release evidence.
- Next action: Queue after visible product path.

## issue-052: Restore security, routing, performance, visual, and unified acceptance gates

- Status: READY
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
- Current evidence: Donor-only scripts exist; previous reports cannot substitute for the new target integration run.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final release verdict.
- Next action: Freeze exact command graph and split if one script owns an independent bug domain.

## issue-053: Restore interop product verification

- Status: READY
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
- Current evidence: Donor commands exist but must be rebound to new exact integration commits.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Provides final cross-repo evidence.
- Next action: Queue after both repositories build and focused suites pass.

## issue-054: Bind the target UI to the rebuilt Fork SDK and acceptance commands

- Status: READY
- Classification: NORMAL
- Goal / user outcome: OpenChamber consumes the accepted `@zunbaran/opencode-sdk` build and exposes only the retained fork test/release commands.
- First-principles root cause: Clean target package metadata points at upstream SDK and has no fork acceptance scripts.
- Core acceptance invariant: SDK provenance matches the exact integrated OpenCode commit, lockfile is deterministic, no unrelated dependency/version/script drift enters, and every added command names an existing accepted script.
- Dependencies: OpenCode issues 010-011; OpenChamber issues 049-053
- Dispatch order: Late dependency/package seam after SDK packaging and scripts freeze.
- Ownership: `package.json`; `bun.lock`; generated local SDK package metadata/evidence outside source as directed by the release script.
- Focused verification: Frozen install, SDK provenance check, typecheck, Web/Electron builds, and command resolution audit.
- Pi binding: unassigned
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Donor package/lock include broad historical drift; only exact SDK alias/version and accepted commands may be replayed.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: Enables final cross-repo gates.
- Next action: Queue after OpenCode release artifacts are accepted.

## issue-055: Enforce upstream UI parity outside the Fork allowlist

- Status: READY
- Classification: NORMAL
- Goal / user outcome: The delivered OpenChamber looks and behaves like official `v1.18.1` everywhere except the minimum retained Fork feature surfaces and adapters.
- First-principles root cause: The donor branch carries broad upstream divergence alongside valid Fork features.
- Core acceptance invariant: Every changed path is classified F/A; upstream-owned U paths are identical unless a reviewed narrow adapter is allowlisted; global CSS/theme/brand drift is zero; duplicate D paths are absent.
- Dependencies: issues 004-054
- Dispatch order: Final cleanup/diff gate after all feature lanes, before fresh reviewer.
- Ownership: `docs/P0_FORK_FEATURE_ALLOWLIST.md`; only paths proven by the final target diff to violate its F/A/U/D rules. Primary owns ledger/roadmap/evidence wording.
- Focused verification: Exact `v1.18.1..HEAD` name/status/stat/diff audit, scoped-selector audit, typecheck/lint/build, visual golden comparison, and all P0 product gates.
- Pi binding: unassigned until the final diff identifies a bounded violation; no speculative cleanup lane
- Pi attempts: none
- Primary attempts: not eligible while Pi retries remain
- Current evidence: Target baseline and allowlist are recorded; no feature implementation has yet been integrated.
- Suspension decision: n/a
- Resume condition: n/a
- Continuation decision: A clean result permits fresh Sol review; a bounded violation becomes the final Pi lane under this stable issue ID.
- Next action: Recompute after issue-054, then dispatch only if a concrete parity violation exists.

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
