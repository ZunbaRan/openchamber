# Interactive UI package and lifecycle seams

This directory contains the accepted server-side foundations for Interactive UI
extensions. The current target owns six deliberately bounded seams:

- package-format.js parses, signs, and verifies OCIX packages and signed Marketplace
  catalogs.
- manager.js owns direct publisher trust, the Local package lifecycle, the
  signed Marketplace install transaction, and the bounded Direct Remote
  signed-manifest inspect/connect/health/update shell transaction.
- runtime.js owns the request-bound Remote health/resource adapter and keeps
  stale lifecycle responses from overwriting newer observations.
- agent-runtime.js materializes declared Agent Tools and Skills into an OpenCode
  configuration directory. It is a standalone loader/transaction helper, not a
  Manager lifecycle hook yet.
- builtin-runtime.js describes the shipped built-in Agent Runtime assets
  (version 1.3.0) and its narrowly scoped legacy-hash migration allowlist.
- The *.test.js files in this directory are the executable contract for the
  seams above.

This document records only behavior present in the target source and tests. It
does **not** make the larger donor implementation true: Hosted execution,
production runtime/HTTP registration, UI, capability endpoints, Business
Gateway wiring, and automatic Agent Runtime reconciliation are not wired by
this documentation or by the current Manager/runtime pair. Issue-014 still owns
that production registration boundary.

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
marketplace:<namespaced-id>. Legacy `remote-confirmation` slots may be parsed
only as bounded migration evidence and are never Local-package authority:
resolveTrustedKey() ignores both `remote-confirmation` and legacy
marketplace:* slots for Local verification. Marketplace installation uses a
request-bound catalog publisher key instead (see below), so delegated trust is
never promoted into global Local trust.

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

## Direct Remote inspect and connect boundary

Direct Remote uses the accepted signed Hosted-manifest kernel, but its consent
is intentionally scoped to one installation instead of widening global Local
publisher trust.

- inspectRemote() normalizes a credential-free HTTPS manifest URL (loopback
  HTTP only), fetches and verifies exactly one signed manifest, runs the
  injected pure metadata validator, validates declared surface resources and
  the one api-key connector, and returns a sanitized publisher/permission/hash
  review. It fetches no signed resource bytes and writes no shell, state,
  trust, cache, or credential data.
- connectRemote() always refetches and reverifies the current manifest. The
  caller must confirm both its locally derived publisher fingerprint and exact
  manifest hash. An existing global own publisher/key slot with another
  fingerprint conflicts; an absent slot is **not** populated. The confirmed
  canonical public key is stored only in private Remote installation metadata,
  where it can reverify that shell after restart without authorizing an
  unrelated Local package. A separate private remote-consents.json record
  stores only an installation-bound digest and timestamp. It is not a global
  publisher key slot; it prevents a rewritten installations.json plus a
  self-signed replacement shell from silently redefining prior consent.
- The installed shell contains the canonical signed manifest, normalized
  extension metadata, and deterministic host-generated Tool shims, not Remote
  resource bodies. Its complete file index, one-version root, signed identity,
  scoped public key, connector binding, accepted hash, and approved permissions
  are revalidated before the root is exposed or re-enabled. Unknown durable
  fields, symlinks, unmanaged sibling versions, deterministic Tool/state
  co-tampering, signed-identity substitution, or consent mismatch fail closed.
  Public snapshots remove file hashes, generation id,
  installation id, scoped public key, and managed paths.
- connectRemote() returns only enumerable extension and connector summaries.
  Its non-enumerable capability closes over the exact credential runtime and a
  fresh private installation id; it can configure/remove only that
  installation's server-side credential and roll back only that shell. A stale
  capability cannot configure or remove credentials for a replacement.
  Credential configuration failure is
  coordinated by the route so conditional credential cleanup runs before the
  exact shell rollback; the Access Key never enters Manager state or a public
  response.
- Activation and state publication reuse the accepted Manager transaction.
  Adapter or durable-write failure restores the activation result. Remote
  publication uses no-replace hard links from inert staging files keyed by
  both lexical target and payload hash. Repeated failure for the same pair
  reuses one entry, while different targets never share a mutable inode merely
  because their bytes match.
- Remote failure, rollback, and uninstall cleanup never unlinks, renames,
  removes, or recursively deletes a shell, staging file, pending journal,
  reservation marker, or newly created directory through a mutable path after
  asynchronous verification. Exact inert residue is retained instead. A
  candidate journal and marker are strictly transaction-bound and remain
  non-authoritative even after a completed update becomes active; only exact
  installation state, installation-scoped consent, and the credential
  transaction grant runtime authority. Initial connected versions created
  without an update marker remain valid under their deterministic shell
  integrity contract.
- A later operation may resume or reuse retained bytes only after a fresh
  confirmation and an exact deterministic whole-shell hash check; no existing
  byte is adopted loosely or overwritten. A partial or modified residue fails
  closed while the prior active Remote version remains available.
  An already-installed reconnect performs no shell, state,
  trust, activation, or credential mutation, preserving the valid connection.

On startup, a narrowly recognized pre-consent Remote record from the older
durable shape may be migrated once. The Manager derives the missing scoped
public key only from the exact Manager-owned signed shell, verifies its
signature, complete file index, manifest/package hash, publisher tuple and
fingerprint, connector, permissions, signed publishedAt, Agent Runtime
contract, and accepted manifest, then publishes the installation-scoped
consent before the key-bearing state. The old 1.17.x generated Tool bytes are
accepted only through an explicit byte-for-byte legacy writer contract; they
are never compared with the current generator or adopted from state alone.
Only after state is durable is the exact historical `remote-confirmation`
trust slot retired; that legacy source is never preserved as Local authority.
A failed phase leaves no stale snapshot restore or unlink: any exact consent
residue remains non-authoritative evidence until the serialized startup gate
retries the forward transition on the next operation/restart. A missing,
substituted, revoked, incomplete, aliased, or
otherwise unverifiable shell remains fail-closed; no network manifest or
credential data is used. A second restart sees the canonical newer shape and
performs no migration write beyond finishing an interrupted trust retirement.

Remote health and update behavior is request- and generation-bound. Stale
health responses cannot overwrite newer observations. Update application
rejects version reuse with different content, preserves the prior runnable
version on failure, and requires exact re-consent when signed publisher
identity or approved permissions change. Required-update blocking is durable
until the exact accepted update commits; successful application clears only
the superseded block and retains rollback integrity for the previous version.

The Manager deliberately requires a validateRemoteMetadata adapter and the
existing reconcileActivation adapter. Missing metadata validation returns a
controlled 503 before any manifest fetch; it is never skipped. Production
binding (issue-014) lives in
`packages/web/server/lib/opencode/feature-routes-runtime.js`: it wires
`normalizeExtensionManifest` as validateRemoteMetadata, binds
`reconcileOpenCodeAgentRuntime` as reconcileActivation with durable
`state.agentRuntime.assets` as the authoritative previousAssets map, calls
`initialize()` at server start, and registers explicit Interactive UI routes
before the generic OpenCode proxy. The focused Manager/runtime/routes and
feature-routes-runtime tests are the executable contract for health, resource
resolution, update ordering, blocked-update state, re-consent, and production
registration.

## Agent Runtime loader boundary

reconcileOpenCodeAgentRuntime() is a standalone materializer. Its caller
supplies:

- the extension state and an authoritative previousAssets inventory;
- an OpenCode configDirectory plus the canonical Manager-owned
  versionsDirectory used by Local and Direct Remote shells (and, only when the
  caller already has validated Hosted metadata, a hosted cache directory);
- optional built-in runtime metadata; and
- filesystem/path/crypto adapters for deterministic tests.

The loader reads enabled Local and Direct Remote descriptors from the
Manager-owned versionsDirectory. Direct Remote never falls through to the
Hosted cache, even when one is configured. Only an explicitly Hosted delivery
uses hostedCacheDirectory. The loader resolves Tool/Skill source files without
following symlinks and writes their bytes to tools/ and skills/.
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
file solely from a record. The authoritative previousAssets map is persisted on
Manager state as `agentRuntime.assets` after each successful activation; the
production reconcileActivation adapter (feature-routes-runtime) supplies that
map on the next reconcile and on `initialize()`.

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
| Direct Remote | Signed-manifest review, installation-scoped consent, metadata-only shell, strict durable state, request-bound health/resource/update lifecycle, retained inert transaction evidence, opaque credential capability, and exact rollback | Pure validateRemoteMetadata, reconcileActivation, credential runtime, and production lifecycle registration |
| Agent Runtime | Source containment, conflict checks, deterministic materialization, ownership records, and rollback | Authoritative previousAssets, lifecycle timing, and OpenCode config ownership (issue-014 seam) |

Hosted loaders, production runtime route registration, UI screens, capability
exposure, and Business Gateway/action execution require separate accepted
integrations. A
caller must not treat the standalone Agent Runtime records or sanitized
Manager snapshots as proof that those surfaces are available.

## Focused validation

Run these from the integration worktree root:

~~~bash
bun run --cwd packages/web test -- \
  server/lib/interactive-ui/package-format.test.js \
  server/lib/interactive-ui/manager.test.js \
  server/lib/interactive-ui/builtin-runtime.test.js \
  server/lib/interactive-ui/routes.remote.test.js
~~~

The package-format tests cover signed file round trips, embedded-key
self-consistency, parser bounds, secrets, Hosted thin-package grammar, native
trust metadata, and catalog signatures. Manager tests cover prototype-safe
trust, Local lifecycle/rollback, integrity quarantine, Marketplace confirmation,
request-scoped delegated verification, redirect/deadline/size handling, exact
catalog binding, Direct Remote consent/shell/rollback, and sanitized snapshots.
Remote route tests cover scope-aware auth, write-free inspection, server-side
opaque credentials, exact confirmation, failure cleanup, and reconnect
preservation. Built-in runtime tests cover the
v1.3.0 assets, idempotence, unmanaged-file protection, source/path safety,
ownership ordering, stale transaction recovery, and rollback failure reporting.

No repository Markdown-specific checker is defined for this package. For this
docs-only change, use the narrow static checks below and report their results;
they do not replace the focused runtime tests when source behavior changes:

~~~bash
git diff --check -- packages/web/server/lib/interactive-ui/DOCUMENTATION.md
node -e "const fs=require('node:fs'); const p='packages/web/server/lib/interactive-ui/DOCUMENTATION.md'; const s=fs.readFileSync(p,'utf8'); if(!s.endsWith('\n')) throw new Error('missing final newline'); for(const m of s.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){if(!m[1].startsWith('./')) throw new Error('unexpected external doc link: '+m[1]); const f='packages/web/server/lib/interactive-ui/'+m[1].slice(2); if(!fs.existsSync(f)) throw new Error('missing linked file: '+f)}}"
~~~
