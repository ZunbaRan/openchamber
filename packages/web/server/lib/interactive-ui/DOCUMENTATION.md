# Interactive UI server runtime

This module owns Local and Hosted OCIX discovery, Interactive UI/HTML Artifact assets, Agent Runtime ownership, and the Business Gateway. Standard MCP Apps are handled by the OpenCode fork and the UI MCP App host; they do not enter this OCIX runtime.

## Extension roots

The runtime discovers extensions from:

1. `<OPENCHAMBER_DATA_DIR>/extensions`
2. each path in `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR`, separated by the platform path delimiter

Each root may be one extension directory or a directory containing extension directories. Discovery is read on demand in v1 so development manifest/view changes are visible without a server restart.

Managed packages have three delivery modes:

- `local`: the signed `.ocix` contains all reviewed runtime assets, Tools, Skills, and descriptors.
- `hosted`: the signed thin `.ocix` contains publisher/app identity, manifest URL, initial permission summary, update policy, and minimum runtime version. The remote signed `HostedOcixManifestV1` supplies versioned surfaces/actions/resources; only bounded last-good resources are cached locally.
- `remote` (Phase R1): the appEntryUrl is a direct signed Hosted OCIX Manifest URL — no thin package and no handshake indirection. The signed payload carries the publisher envelope (`publisher: { id, name, keyId, publicKey }`). The manifest signature is verified with that embedded Ed25519 key, the key is normalized with the package-format helpers, and the fingerprint is derived locally (a fingerprint string from the server is never trusted). The signature `keyId` must equal `publisher.keyId`.

Remote connect persists only a small host-managed discovery shell — the signed Manifest, `openchamber.extension.json`, and host-generated Agent Runtime shims — plus trust, approved/granted permissions, accepted Manifest metadata (including the connect `installationId`), appEntryUrl, connector refs, and timestamps. It never fetches or persists `resources[]`, and there is no Hosted cache tree. Phase R1 supports exactly one connector with `auth.type === "api-key"`; zero or multiple eligible connectors are rejected with stable error codes. A publisher is reported as trusted only when the stored trust record carries exactly the candidate key (the stored public key is re-normalized and re-fingerprinted locally); a same publisher/keyId slot occupied by a different key inspects as untrusted and connect rejects it with `publisher_key_conflict` before any write. Remote surfaces are not loadable yet: resource lazy loading is Phase R2 and health/update automation is Phase R3 (no completion overclaim).

## Routes

- `GET /api/interactive-ui/manager`
- `POST /api/interactive-ui/manager/packages/inspect`
- `POST /api/interactive-ui/manager/packages`
- `POST /api/interactive-ui/manager/remote/inspect`
- `POST /api/interactive-ui/manager/remote/connect`
- extension lifecycle and signed marketplace routes under `/api/interactive-ui/manager/*`
- `POST /api/interactive-ui/manager/extensions/:extensionId/hosted/refresh`
- `GET /api/interactive-ui/connections`
- `GET /api/interactive-ui/capabilities`
- `PUT|DELETE /api/interactive-ui/connections/:extensionId/:connectorId`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/provision`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/test`
- `GET /api/interactive-ui/extensions`
- `GET /api/interactive-ui/views/:viewId?tool=:toolName`
- `GET /api/interactive-ui/installed-artifacts/:artifactId?tool=:toolName`
- `GET /api/interactive-ui/extensions/:extensionId/artifacts/:artifactId`
- `GET /api/interactive-ui/extensions/:extensionId/native/:viewId`
- `POST /api/interactive-ui/actions/:actionId`
- `GET /api/interactive-ui/artifacts/capabilities`
- `POST /api/interactive-ui/artifacts/materialize`
- `GET /api/interactive-ui/artifacts/:artifactId/document`
- `GET /api/interactive-ui/artifacts/:artifactId/metadata`
- `DELETE /api/interactive-ui/artifacts/cache`
- `POST /api/interactive-ui/workbench/snapshots`
- `GET /api/interactive-ui/workbench/snapshots/:snapshotRef`
- `GET /api/interactive-ui/workbench/boards/:projectId`
- Workbench Tile creation, layout, migration, removal, and lifecycle routes under `/api/interactive-ui/workbench/boards/:projectId/*`
- `POST /api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/replace-generated-snapshot`

The generated-Artifact capability response is runtime-specific. Managed Desktop defaults Scripts on and reports `scriptsMode: "supported"` because Electron supplies an independently terminable Runner; `OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS=false` is its kill switch. Web remains default-off and reports `"experimental"` only after explicit opt-in. This gate does not control signed installed HTML Artifacts: those are package-reviewed surfaces, still isolated by the same opaque-origin sandbox and CSP.

`runtimeSupport` is explicit for every shared surface. Web and Managed Desktop support Static Artifacts when the static gate is enabled; Managed Desktop Scripts are supported by the independent Runner while Web Scripts remain experimental. Hosted and Capacitor mobile support static content but always report scripts as unsupported. VS Code and active E2EE relay report both modes as unsupported instead of falling through to a weaker transport.

Materialization may include `X-OpenChamber-Session-ID`. A valid session ID records a bounded reference to the content-addressed Artifact and returns `sessionReferenceTracked: true`; `cacheHit` distinguishes reuse and `cacheRebuilt` reports replacement of a missing/corrupt cache entry. Successful authoritative `DELETE /api/session/:sessionId` responses release that session's references. Shared content is removed only after the final reference is released; failed session deletion and corrupt unrelated reference indexes preserve content conservatively. The packaged `openchamber-ui://app` origin reaches this route over loopback HTTP, so the shared CORS request-header allowlist must include `X-OpenChamber-Session-ID`.

These routes are registered before the generic OpenCode `/api` proxy. Only Native bundles, exact installed Artifact documents, and exact 64-hex generated Artifact documents may use short-lived URL authentication. Artifact descriptors/metadata and all mutations still require normal API authentication.

## Security invariants

- Manifest entries must stay inside the installed extension directory.
- Connectors are fixed HTTP(S) base URLs without embedded credentials.
- Connector origins must be explicitly declared in `permissions.network`.
- Actions use fixed connector-relative paths and declared methods.
- Action IDs, connectors, permissions, tool/surface relationships, and installed Artifact action subsets are checked server-side.
- `ask` actions return `confirmation_required` before any upstream request.
- `api-key` and `issued-key` credentials are stored server-side with owner-only file permissions and are injected only on the final Gateway request. Legacy `env-bearer` values remain server environment-only.
- Credential placement is Header-only; unsafe and host-reserved headers are rejected. Provisioning requires HTTPS except loopback development and an explicitly allowed Origin.
- Connection APIs return credential metadata plus ephemeral `unknown/reachable/unreachable/unauthorized/forbidden` health evidence and its last-check timestamp. `configured` never means `reachable`; health resets after credential replacement or process restart and is never an authorization source. Access Keys, setup codes, provisioning URLs, and raw credential responses never enter registry/view responses or Agent output.
- Third-party APIs own Key scopes, revocation, RBAC/ABAC, and final business authorization. Gateway maps `401`/`403` without inventing a second business permission system.
- Upstream requests have a timeout and bounded JSON response size.
- Every managed extension root is rechecked against the signed OCIX file-hash index before it is exposed to the runtime. A missing or mismatched integrity record quarantines both Host surfaces and managed Agent Tool/Skill files while keeping the installation visible for reinstall or recoverable uninstall; an edited Native bundle, Declarative definition, HTML Artifact, or manifest is never loaded.
- `ask` actions use a short-lived, one-time confirmation challenge bound to the extension, surface, originating Tool, instance, action, and exact input. A client-side `confirmed: true` flag is not an authorization signal and is ignored.
- Native assets are served from installed files, not arbitrary internet URLs.
- New `.ocix` and marketplace catalogs carry their Ed25519 public key inside the signed document. Inspection proves signature self-consistency and returns only identity, fingerprint, permissions, and Agent Runtime inventory; first trust still requires an explicit fingerprint confirmation.
- Packaged Agent Tools and Skills are validated before installation. Tool names match their file names, use one default export, cannot replace reserved built-ins, and Skill frontmatter must match its directory.
- For local managed OpenCode, enabled OCIX Tools are copied as OpenChamber-owned global Tools in `~/.config/opencode/tools`; Skills are copied to `~/.config/opencode/skills`. Persisted owner/version/hash metadata drives enable, disable, update, rollback, and uninstall.
- Reconciliation never overwrites unmanaged or externally modified global files. Global file changes and manager-state writes roll back together on failure. A bounded allowlist of exact hashes for previously shipped OpenChamber built-ins supports one-time ownership migration and upgrade; a file with any other hash remains user-owned and produces a conflict.
- Every OpenChamber-owned Tool/Skill write has a publisher/extension-namespaced ownership record under `<resolved-opencode-config>/openchamber`. Install records contain owner and install-time hash; update/uninstall changes only matching files. A user-modified global file is preserved and reported as a conflict.
- Hosted OCIX accepts only HTTPS manifest/resource URLs (loopback HTTP is development-only), rejects cross-origin redirects, verifies publisher signature, every resource SHA256, and actual HTTP `Content-Type` against the signed `mimeType`, validates minimum runtime, and materializes only normalized OCIX surfaces. A failed fetch, signature, hash, MIME, or compatibility check may keep only a last-good version whose local cache still passes a fresh exact-file integrity scan.
- Remote inspect performs no trust, install, secret, or resource write and never fetches `resources[]`. Remote connect refetches and reverifies the signed manifest (TOCTOU safe), requires the exact locally derived publisher fingerprint plus manifest hash, rejects connecting an already installed extension, then persists trust and the Remote shell before handing the access key to the existing `runtime.configureRemoteConnection`; the route validates the key with the shared opaque `validateRemoteAccessKey` (non-empty, length-bounded, no unsafe C0/DEL control characters) synchronously BEFORE `manager.connectRemote` — before any trust, staging, Manager state, Agent Runtime, or Secret Store write — and preserves the exact string byte-for-byte (leading/trailing spaces are valid credential material and are never trimmed); `setRemoteCredential` uses the same validator so route and store cannot drift, and `trustAdded`/`installationId` rollback bookkeeping never appears in the public response. Every connect generates one cryptographically random `installationId` that binds the shell metadata, the credential record, and the failure-atomic rollback. Credential storage uses an installation-bound store setter (refuses to overwrite a different installation's record with `remote_installation_conflict`) and a conditional remover (deletes only the exact installation's record; a stale cleanup returns a non-sensitive mismatch indicator), exposed through `runtime.configureRemoteConnection`/`runtime.removeRemoteConnection`; the generic PUT/DELETE connection APIs keep using the generic store methods, and both generic and Remote credential deletion work without the extension shell (orphan cleanup) — only configuring requires a valid installed connector. If credential storage/configuration fails, the route conditionally removes only that installation's credential, then invokes `manager.rollbackRemoteConnect` with the same `installationId` — which refuses ALL mutation when the current active Remote metadata belongs to a different installation (`remote_rollback_installation_changed`, 409) — and removes the publisher trust key only when this operation added it and no remaining installed version still references that publisher id/keyId; the original error is preserved with sanitized recovery details. Access keys and installation ids never appear in API responses, manager state, trust JSON, logs, or the review UI.
- Before ANY trust, shell, Manager state, Agent Runtime, or Secret Store write, both `inspectRemote` and `connectRemote` run one shared write-free preflight on the signed manifest's extension document: (a) the SAME single-sourced runtime metadata normalization used at load time (`normalizeExtensionManifest`) — connectors (auth type/placement/baseUrl vs `extension.permissions.network`), actions and connector references, views/artifacts/dashboard/routing, Native `trust.mode`, duplicate identities; (b) every shell-consumed resource reference (declarative/native/HTML entry and icon) must be a safe declared `resources[]` path using the Hosted OCIX kernel path rules (`safeRelativePath`) plus the runtime entry-extension rules — traversal such as `../../escape.txt` and missing/ambiguous references are rejected; and (c) the exact hosted Agent Runtime surface-tool binding constraints shared with materialization (`hostedSurfaceBindings`: tool pattern, reserved OpenCode built-ins, duplicate/cross-surface conflicts). All three layers reuse the pure helpers that later materialization uses, so the rules cannot drift. A signed-but-runtime-invalid manifest rejects with the stable runtime/kernel code (e.g. `network_not_allowed`, `invalid_manifest`, `invalid_hosted_resource`, `invalid_entry`, `invalid_hosted_agent_tool`) and leaves no trust, state, shell, Agent Runtime, or credential writes behind; the selected connector is cross-checked against the normalized metadata to keep the exact-one-`api-key` policy single-sourced. Credential/secret mutations that span the Manager, Secret Store, and Workbench are serialized by a mutation coordinator scoped PER MANAGER INSTANCE (WeakMap-keyed): two route registrations sharing the same manager serialize, unrelated manager/runtime/data-directory instances never block one another, and failures never poison later operations; read-only routes are uncoordinated, and installation-identity matching remains defense in depth for direct/internal callers. Extension uninstall runs ALL fallible external cleanup (credentials, Workbench tiles) FIRST while the shell still exists and calls `manager.uninstall` only after cleanup succeeds — a cleanup failure leaves the extension installed (any remaining secret still has an owner) and the response never claims extension removal.
- A Remote shell is re-verified on enable, initialization, runtime exposure, and Agent Runtime reconciliation against the CURRENT trusted publisher key: the trust-record public key is normalized and re-fingerprinted locally, and the reverified embedded publisher id, keyId, normalized public key, and fingerprint must exactly match both the persisted metadata and the accepted manifest keyId; any mismatch fails closed (`publisher_untrusted` or `remote_shell_integrity_failed`) and quarantines the shell. A manifest whose embedded publisher key differs from the current trust record is never accepted on the strength of its own self-consistent signature.
- Hosted cache integrity covers the original signed Hosted manifest, the generated runtime manifest, every signed remote resource, and every deterministic Agent Tool shim. Before enable, process initialization, runtime exposure, or Agent Runtime reconciliation, OpenChamber re-verifies the cached manifest with the currently trusted publisher key, rebuilds the expected integrity index from that signed document, and then hashes the exact local file set. A missing/untrusted signature, edited integrity record, symlink, extra file, missing file, or hash mismatch fails closed.
- Hosted permission, origin, action, credential-scope, or Native-code expansion creates a pending update and requires a new explicit confirmation. Native surfaces also require `trust.mode = "native-code"`. Permission-equivalent updates may advance automatically after TTL refresh.
- Hosted pages cannot call arbitrary network APIs. Resource loading is owned by the Hosted loader; business calls use a generated lightweight global Tool shim and the existing Business Gateway. Connector credentials remain server-side and the third-party server remains responsible for key RBAC/ABAC and revocation.
- Optional `agentRouting`, `views[].routing`, and `artifacts[].routing` metadata is validated at package and runtime load. Identifiers, counts, priority, operation, data-authority enums, and multi-surface declarations are bounded.
- The capability route exposes only extension/tool/intent/operation/data-authority IDs plus coarse connection state. It excludes examples, display names, Connector origins, credential identifiers, Keys, Tokens, and business response data.
- The fixed routing prompt prioritizes matching business Tools over generic generated UI, caps output at 12,000 characters, and tells external runtimes to call only Tools actually present in their current Tool set.
- Artifact envelopes use an independent exact schema and are revalidated on both client and server. The envelope is capped at 256 KiB, HTML at 192 KiB, markup at 4,000 elements, and display height at 120-900 px.
- `artifact-store.js` stores content-addressed documents under the OpenChamber data directory with owner-only permissions and atomic directory replacement. The hash covers executable content, so title or display metadata cannot create duplicate documents.
- `workbench-store.js` stores Generated Interactive UI, Generated HTML Artifact, and pinned MCP App envelopes as immutable, content-addressed snapshot records under the Workbench data root. A read recomputes the digest and rejects a malformed, missing, oversized, or content/reference-mismatched record; the mutable Board stores only the current snapshot reference.
- Replacing a generated Tile snapshot is a compare-and-swap operation. The caller supplies the active Board `expectedRevision`; the Store runs under the project write lock, rechecks Tile ownership and form, writes the complete immutable snapshot first, and only then increments the Board revision and atomically publishes the new reference. A stale revision or failed snapshot write leaves the previous Board pointer authoritative.
- A pinned MCP App snapshot cannot change its AppBridge authority while updating result/model context. `server`, `resourceUri`, and `toolKey` must exactly match the previously persisted snapshot or replacement fails with `workbench_snapshot_binding_mismatch`. Installed Tiles cannot use this generated-snapshot replacement route.
- History replay calls `materialize` again. Cache deletion is safe because the Tool result remains the source of truth and deterministically recreates the same Artifact ID.
- Cached metadata and document bytes are compared with the document deterministically derived from the authoritative Envelope. Missing or mismatched entries are atomically rebuilt instead of being trusted by ID alone.
- Static documents reject non-fragment `href`/`xlink:href` targets at materialization. Relative subresources that remain useful in authored markup are still blocked by document CSP; the Chromium verifier asserts that no request reaches the loopback target.
- Static scanning rejects frames, objects, embeds, forms, base/link/meta refresh, remote resources, scripts in static mode, and network/eval/worker/WebAssembly/service-worker primitives in interactive mode. Browser enforcement remains authoritative.
- Static document CSP uses `default-src 'none'`, inline style, data/blob images, and no script. Scripts mode is served through a trusted Broker whose response may frame only a `data:` child and whose nested Artifact document injects its own `frame-src 'none'` CSP. Neither layer enables `unsafe-eval`, network, workers, forms, plugins, or external frames.
- CSP/sandbox declarations alone are not proof that a scripted Artifact emits no requests. Scripts therefore run in an opaque `data:` child behind the Broker, which relays only strict Bridge envelopes and removes the child after a navigation. The Chromium attack matrix observes form, frame, download, self-navigation, meta-refresh and API attacks while asserting zero actual target requests. Managed Desktop additionally hosts the Broker in a unique-partition `WebContentsView` with no main-world Electron API and main-process lease, concurrency, CPU and memory gates; Stop destroys the renderer. Browser process placement is still not independently controllable on ordinary Web, so Web Scripts remain experimental and default-off.
- Generated interactive documents receive a deterministic Bridge bootstrap. It applies allowlisted `--ocix-*` tokens and emits ready/resize/error/heartbeat messages; it does not expose Gateway, Tool, filesystem, storage, cookie, or credential APIs.
- Signed installed HTML documents receive a distinct Business Bridge. `query/execute` emit bounded `artifact.businessRequest` messages; the Host derives extension/Artifact identity, enforces the Artifact's declared action subset and existing confirmation policy, injects credentials server-side, and returns only data or sanitized errors. Raw Connector URLs, Keys, Tools, MCP, storage, and direct network remain unavailable.
- Artifact document responses are private/no-store, nosniff, no-referrer, and permission-restricted. `frame-ancestors` allows the same HTTP OpenChamber origin and the exact packaged Desktop origin `openchamber-ui://app`; no other web or custom-protocol parent is allowed.

Production package signatures, persistent install records, publisher confirmation, lifecycle management, signed static marketplace catalogs, OCIX Connector Authentication v1, first-party Hosted OCIX thin-package delivery, and Phase R1 Remote connect (signed-manifest URL + access key, embedded publisher verification, discovery-only shell, server-side secret handoff with failure rollback) are implemented. A signing key proves origin-key possession and integrity, not code safety, real-world publisher identity, or business API access. Public hosted Marketplace operations, signing-key revocation/transparency, malware review, remote OpenCode installation, Remote resource lazy loading (Phase R2), and Remote health/update scheduling (Phase R3) remain separate work.

## Developer tooling

Create and validate a repository-compatible mixed Interactive UI + HTML Artifact starter from the repository root:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path --id com.acme.operations --name "Acme Operations" --tool-prefix operations
node scripts/interactive-ui-extension.mjs validate /absolute/new/path
```

Create and validate a manifest-only Hosted OCIX thin package:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/hosted-path \
  --delivery hosted \
  --id com.acme.hosted \
  --name "Acme Hosted" \
  --manifest-url https://apps.example.com/manifest.json \
  --initial-permissions /absolute/hosted-permissions.json
node scripts/interactive-ui-extension.mjs validate /absolute/new/hosted-path
```

The same `pack` and `verify` commands handle Local and Hosted delivery. Hosted source validation and packaging reject every file other than `openchamber.extension.json`.

Validation reuses this runtime for discovery, manifest normalization, entry containment, descriptor/bundle/HTML hardening checks, then adds static Declarative primitive/binding/action checks. It substitutes non-secret placeholder values for referenced environment variables, never calls upstream business APIs, and never executes Native code.

The starter manifest includes namespaced `agentRouting` metadata and per-surface routing for Declarative, Trusted Native, and HTML Artifact examples. Developer examples are retained for test corpora and review but are deliberately excluded from the Agent system context to prevent free-text prompt injection.

## Focused validation

```bash
bun run test:interactive-ui
bun run --cwd packages/web test -- server/lib/interactive-ui/artifact-store.test.js server/lib/interactive-ui/routes.artifact.test.js server/lib/interactive-ui/routes.remote.test.js server/lib/interactive-ui/hosted-ocix.test.js server/lib/interactive-ui/manager.test.js server/lib/interactive-ui/workbench-store.test.js server/lib/ui-auth/ui-auth.test.js
bun run test:html-artifact-browser
node --test packages/electron/artifact-runner.test.mjs
node --check packages/web/server/lib/interactive-ui/runtime.js
```
