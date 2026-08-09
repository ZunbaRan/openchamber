# Interactive UI package and lifecycle seams

This directory contains the accepted server-side foundations for Interactive UI
extensions. The current target owns five deliberately bounded seams:

- package-format.js parses, signs, and verifies OCIX packages and signed Marketplace
  catalogs.
- manager.js owns direct publisher trust, the Local package lifecycle, and the
  signed Marketplace install transaction.
- agent-runtime.js materializes declared Agent Tools and Skills into an OpenCode
  configuration directory. It is a standalone loader/transaction helper, not a
  Manager lifecycle hook yet.
- builtin-runtime.js describes the shipped built-in Agent Runtime assets
  (version 1.3.0) and its narrowly scoped legacy-hash migration allowlist.
- The *.test.js files in this directory are the executable contract for the
  seams above.

This document records only behavior present in the target source and tests. It
does **not** make the larger donor implementation true: Remote discovery and
updates, Hosted execution, HTTP route registration, UI, capability endpoints,
Business Gateway wiring, and automatic Agent Runtime reconciliation are not
wired by this documentation or by the current Manager.

## Package format and parser boundary

createExtensionPackage() creates a signed ZIP with an
openchamber.package.json index. verifyExtensionPackage() verifies the canonical
JSON index with Ed25519, then checks every archive member against the signed
path, size, and SHA-256 entry before returning bytes to the caller.

The parser is fail-closed:

- Archive size is limited to 20 MiB, uncompressed content to 16 MiB, each file
  to 8 MiB, the signed index to 1 MiB, and the file count to 512.
- Paths are normalized POSIX paths under the package root. Absolute paths,
  traversal, backslashes, duplicate/reserved entries, archive symlinks,
  unsigned members, missing members, and size/hash mismatches are rejected.
- .env files, likely private-key material, unsupported filesystem entries, and
  package-time symlinks are rejected. The parser never executes package code.
- The extension manifest has a bounded namespaced id and semantic version.
  Routing, dashboard metadata, icon bytes, Agent Tool/Skill descriptors, and
  native-code trust metadata are validated before a package is accepted.
  Agent Tools must be direct files with a default export; Skills must include
  matching SKILL.md frontmatter. Reserved OpenCode Tool names cannot be
  replaced.
- A Hosted thin manifest can be parsed and round-tripped by this package
  format, but it must contain only openchamber.extension.json. The Local
  Manager deliberately rejects any delivery metadata; parsing Hosted metadata
  is not Hosted lifecycle support.

An embedded publisher key can prove that a package is internally
self-consistent when inspection explicitly allows it. Host trust still comes
from the resolver supplied to verifyExtensionPackage(); without an exact
trusted key the normal verification path returns publisher_untrusted.
Signatures establish possession of a key and package integrity, not publisher
identity, code safety, or business-system authorization.

createSignedExtensionCatalog() and verifySignedExtensionCatalog() apply the
same Ed25519/canonicalization discipline to Marketplace catalogs. Catalog
entries carry the exact extension id/name/version, package URL/hash, and
publisher tuple used later by the Manager.

## Publisher trust and prototype-safe authority

The Manager stores direct trust in trust.json below its data directory's
interactive-ui/ directory. Trust and publisher maps use null prototypes, and
every lookup validates primitive type, length, and grammar before an object
slot is accessed. A regex-valid own key such as toString is allowed only when
an own durable slot exists; __proto__, prototype, and constructor are blocked.
A signed array or other non-string key id is never coerced into a trusted slot.

Each durable publisher/key record is canonicalized and revalidated on every
read: names are trimmed and bounded, the Ed25519 SPKI PEM is normalized, and
the stored fingerprint is recomputed from that key. Unknown fields, aliases,
non-canonical encodings, malformed timestamps, and fingerprint mismatches make
the store visibly corrupt instead of silently widening authority. Trust writes
are serialized, written through a unique temporary file, renamed atomically,
and kept under a 0700 directory with a 0600 file. Public Manager snapshots omit
public-key PEM and managed filesystem paths.

The accepted persisted source labels are manual, package-confirmation, and
marketplace:<namespaced-id>. A legacy marketplace:* slot is intentionally not a
Local-package authority: resolveTrustedKey() ignores it for Local verification.
Marketplace installation uses a request-bound catalog publisher key instead
(see below), so delegated trust is never promoted into global Local trust.

## Local package lifecycle

The Local lifecycle is implemented by the Manager's serialized mutation queue:

1. Verify the signed package against an exact trusted publisher key before any
   extraction. A package with delivery metadata is rejected by this Local-only
   lifecycle.
2. Extract only signed bytes into a unique owner-controlled staging directory.
   The injected validateStagedPackage adapter validates that staged tree before
   the version destination or activation is changed.
3. Move the validated tree to the managed version store and ask the injected
   reconcileActivation adapter to apply the activation change. The adapter
   receives cloned previous/next state plus the managed versions directory and
   must return sanitized OpenCode booleans and a rollback function; the Manager
   does not implement OpenCode activation itself.
4. Commit installations.json atomically. The durable state records signed file
   hashes, a private generation id, publisher identity, source, active version,
   and activation history. Public install/list results strip hashes, generation
   ids, absolute paths, and key material.

Same-version identical package bytes are idempotent. Same-version different
bytes fail with version_conflict; an unmanaged destination fails with
unmanaged_version_conflict without overwriting it. Updates preserve accepted
versions and append activation history. setEnabled(true) and rollback()
re-hash the complete target version first. uninstall() moves the managed
version tree to opaque trash, commits the state removal, and returns only a
non-path recoveryId.

The installed-file integrity index is authoritative for Manager-owned Local
roots. Missing/extra files, symlinks, non-regular entries, edits, or a missing
index fail closed. getEnabledExtensionRoots() quarantines a corrupt active
root from exposure (and reports one warning per extension/error) rather than
returning an unverified path. It is an internal adapter result, not an
HTTP/UI response.

Failure ordering is part of the contract. Staging or validation failure leaves
no destination and does not call activation. An activation failure removes a
new first-install tree. A durable state-write failure calls the adapter's
rollback and removes/restores only the new mutation, preserving the exact
previous state and accepted versions. If uninstall state persistence fails,
the trash move is restored. Atomic store writes never replace the previous
durable document on failure.

## Marketplace request-bound verification

Marketplace operations are a separate trust chain from direct publisher trust.

- Catalog and package URLs must be credential-free HTTPS; HTTP is allowed only
  for loopback hosts, and fragments are rejected. URLs are length-bounded.
- Catalog transport is limited to 2 MiB and package transport to 20 MiB. The
  Manager owns a timeout even when an injected fetchImpl ignores abort. It
  requests redirect: error and defensively rejects a redirected or mismatched
  response URL. Non-OK, declared-oversize, and streaming-oversize responses are
  cancelled without consuming hostile bodies; readers release their lock.
  Upstream bodies and internal paths are not exposed in errors.
- addMarketplace() inspects and verifies a catalog, then requires an exact
  fingerprint confirmation before atomically persisting its canonical identity
  in marketplaces.json. The durable Marketplace store is strict, null-safe,
  owner-only, and re-fingerprints keys on every read.
- installFromMarketplace() selects an exact catalog id/version and publisher
  tuple, then checks a conflicting existing global slot **before** downloading
  package bytes. After download it checks the signed package hash and the
  complete extension/publisher tuple against that catalog entry. Verification
  passes the catalog's publisher key only for that request. It does not call
  trustPublisher() and never writes a delegated key to trust.json. A
  compatible pre-existing manual key remains manual; a different fingerprint
  fails closed with publisher_key_conflict.
- Installed metadata retains { type: marketplace, marketplaceId } as
  provenance. Removing a Marketplace removes its catalog configuration, not
  an unrelated global trust record. A Marketplace-delegated key cannot later
  authorize a direct Local package.

Sanitized catalog snapshots omit publisher PEM, package URLs, and managed
paths while retaining the ids, versions, hashes, fingerprints, and Marketplace
identity needed by the caller. Stable Manager errors carry a code/status and
only safe details such as a confirmation fingerprint.

## Agent Runtime loader boundary

reconcileOpenCodeAgentRuntime() is a standalone materializer. Its caller
supplies:

- the extension state and an authoritative previousAssets inventory;
- an OpenCode configDirectory plus Local versionsDirectory (and, only when the
  caller already has validated Hosted metadata, a hosted cache directory);
- optional built-in runtime metadata; and
- filesystem/path/crypto adapters for deterministic tests.

The loader reads enabled Local descriptors, resolves Tool/Skill source files
without following symlinks, and writes their bytes to tools/ and skills/.
Tool names, file extensions, Skill paths, source containment, ancestor types,
and cross-extension names are bounded. Existing user-owned files conflict
even when their bytes happen to equal the requested bytes, except for the
exact legacy hashes explicitly allowlisted by the built-in runtime. No user
file is adopted or overwritten implicitly. The built-in descriptor currently
contains the exact v1.3.0 Tool/Skill set and its three legacy asset hashes.

The loader maintains deterministic per-extension records at
openchamber/<extension-id>.agent-runtime.v1.json and a transaction marker at
.agent-runtime.transaction.v1.json. Asset descriptors are SHA-256 based,
code-point sorted, and bounded to 4,096 managed assets. Ownership records are
written only after all corresponding Tool/Skill bytes reach their final
targets; records are removed only after asset removal.

**Ownership records are not deletion authority.** On every reconciliation the
caller-supplied previousAssets must exactly match the durable records. A
forged/edited record, a missing record, or a mismatch fails with
agent_runtime_state_invalid; a missing or externally edited managed file fails
with agent_runtime_modified. The loader never infers permission to delete a
file solely from a record. The authoritative previousAssets store and the
Manager/activation wiring are future issue-014 work; this target does not
persist or supply that seam.

Before mutation the loader writes a transaction marker. Atomic writes use
temporary files and reject ancestor symlinks. A failure restores changed bytes
and records; temporary-file cleanup failure is surfaced as
agent_runtime_rollback_failed and residue blocks the next run with
agent_runtime_recovery_required. The returned deployment includes a rollback
function. Before restoring or removing anything it preflights every changed
target against the exact deployed bytes (or an already-restored original
backup); an external replacement makes the whole rollback fail closed, leaves
that content untouched, and preserves the transaction marker for recovery.
Rollback failures remain visible rather than being reported as a successful
cleanup.

The loader can resolve a caller-provided Hosted cache path for its low-level
asset calculation, but it does not fetch, verify, update, or discover Hosted
manifests. It is not invoked by the current Manager automatically.

## Adapter and integration responsibilities

| Seam | This directory owns | Caller still owns |
| --- | --- | --- |
| Package format | Canonical schemas, bounds, signatures, hashes, and descriptor parsing | Selecting a trusted key and deciding when a package is allowed to install |
| Local Manager | Trust/state stores, staging, integrity, queueing, and recoverable file/state ordering | validateStagedPackage and reconcileActivation implementations |
| Marketplace | Catalog confirmation, bounded transport, request-scoped publisher verification, and provenance | User confirmation of the catalog fingerprint and any business/API policy |
| Agent Runtime | Source containment, conflict checks, deterministic materialization, ownership records, and rollback | Authoritative previousAssets, lifecycle timing, and OpenCode config ownership (issue-014 seam) |

Remote/Hosted loaders, HTTP routes, UI screens, capability exposure, and
Business Gateway/action execution require separate accepted integrations. A
caller must not treat the standalone Agent Runtime records or sanitized
Manager snapshots as proof that those surfaces are available.

## Focused validation

Run these from the integration worktree root:

~~~bash
bun run --cwd packages/web test -- \
  server/lib/interactive-ui/package-format.test.js \
  server/lib/interactive-ui/manager.test.js \
  server/lib/interactive-ui/builtin-runtime.test.js
~~~

The package-format tests cover signed file round trips, embedded-key
self-consistency, parser bounds, secrets, Hosted thin-package grammar, native
trust metadata, and catalog signatures. Manager tests cover prototype-safe
trust, Local lifecycle/rollback, integrity quarantine, Marketplace confirmation,
request-scoped delegated verification, redirect/deadline/size handling, exact
catalog binding, and sanitized snapshots. Built-in runtime tests cover the
v1.3.0 assets, idempotence, unmanaged-file protection, source/path safety,
ownership ordering, stale transaction recovery, and rollback failure reporting.

No repository Markdown-specific checker is defined for this package. For this
docs-only change, use the narrow static checks below and report their results;
they do not replace the focused runtime tests when source behavior changes:

~~~bash
git diff --check -- packages/web/server/lib/interactive-ui/DOCUMENTATION.md
node -e "const fs=require('node:fs'); const p='packages/web/server/lib/interactive-ui/DOCUMENTATION.md'; const s=fs.readFileSync(p,'utf8'); if(!s.endsWith('\n')) throw new Error('missing final newline'); for(const m of s.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){if(!m[1].startsWith('./')) throw new Error('unexpected external doc link: '+m[1]); const f='packages/web/server/lib/interactive-ui/'+m[1].slice(2); if(!fs.existsSync(f)) throw new Error('missing linked file: '+f)}}"
~~~
