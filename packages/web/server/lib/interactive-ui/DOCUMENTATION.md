# Interactive UI server runtime

This module owns installed OCIX extension discovery, view assets, and the Business Gateway.

## Extension roots

The runtime discovers extensions from:

1. `<OPENCHAMBER_DATA_DIR>/extensions`
2. each path in `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR`, separated by the platform path delimiter

Each root may be one extension directory or a directory containing extension directories. Discovery is read on demand in v1 so development manifest/view changes are visible without a server restart.

## Routes

- `GET /api/interactive-ui/manager`
- `POST /api/interactive-ui/manager/packages/inspect`
- `POST /api/interactive-ui/manager/packages`
- extension lifecycle and signed marketplace routes under `/api/interactive-ui/manager/*`
- `GET /api/interactive-ui/connections`
- `GET /api/interactive-ui/capabilities`
- `PUT|DELETE /api/interactive-ui/connections/:extensionId/:connectorId`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/provision`
- `POST /api/interactive-ui/connections/:extensionId/:connectorId/test`
- `GET /api/interactive-ui/extensions`
- `GET /api/interactive-ui/views/:viewId?tool=:toolName`
- `GET /api/interactive-ui/extensions/:extensionId/native/:viewId`
- `POST /api/interactive-ui/actions/:actionId`
- `GET /api/interactive-ui/artifacts/capabilities`
- `POST /api/interactive-ui/artifacts/materialize`
- `GET /api/interactive-ui/artifacts/:artifactId/document`
- `GET /api/interactive-ui/artifacts/:artifactId/metadata`
- `DELETE /api/interactive-ui/artifacts/cache`

The capability response reports `scriptsMode: "experimental"` only when the explicit scripts gate is enabled; otherwise it reports `"unsupported"`. Until a Runtime provides an independently terminable renderer process, scripts must not be presented as a production-safe capability.

`runtimeSupport` is explicit for every shared surface. Web and Managed Desktop support Static Artifacts when the static gate is enabled; hosted and Capacitor mobile also support static content but always report scripts as unsupported. VS Code and active E2EE relay report both modes as unsupported instead of falling through to a weaker transport.

Materialization may include `X-OpenChamber-Session-ID`. A valid session ID records a bounded reference to the content-addressed Artifact and returns `sessionReferenceTracked: true`; `cacheHit` distinguishes reuse and `cacheRebuilt` reports replacement of a missing/corrupt cache entry. Successful authoritative `DELETE /api/session/:sessionId` responses release that session's references. Shared content is removed only after the final reference is released; failed session deletion and corrupt unrelated reference indexes preserve content conservatively.

These routes are registered before the generic OpenCode `/api` proxy. Only the Native bundle GET route and an exact 64-hex Artifact document GET path may use short-lived URL authentication. Artifact metadata and all mutations still require normal API authentication.

## Security invariants

- Manifest entries must stay inside the installed extension directory.
- Connectors are fixed HTTP(S) base URLs without embedded credentials.
- Connector origins must be explicitly declared in `permissions.network`.
- Actions use fixed connector-relative paths and declared methods.
- Action IDs, connectors, permissions, and tool/view relationships are checked server-side.
- `ask` actions return `confirmation_required` before any upstream request.
- `api-key` and `issued-key` credentials are stored server-side with owner-only file permissions and are injected only on the final Gateway request. Legacy `env-bearer` values remain server environment-only.
- Credential placement is Header-only; unsafe and host-reserved headers are rejected. Provisioning requires HTTPS except loopback development and an explicitly allowed Origin.
- Connection APIs return status metadata only. Access Keys, setup codes, provisioning URLs, and raw credential responses never enter registry/view responses or Agent output.
- Third-party APIs own Key scopes, revocation, RBAC/ABAC, and final business authorization. Gateway maps `401`/`403` without inventing a second business permission system.
- Upstream requests have a timeout and bounded JSON response size.
- Native assets are served from installed files, not arbitrary internet URLs.
- New `.ocix` and marketplace catalogs carry their Ed25519 public key inside the signed document. Inspection proves signature self-consistency and returns only identity, fingerprint, permissions, and Agent Runtime inventory; first trust still requires an explicit fingerprint confirmation.
- Packaged Agent Tools and Skills are validated before installation. Tool names match their file names, use one default export, cannot replace reserved built-ins, and Skill frontmatter must match its directory.
- For local managed OpenCode, enabled OCIX Tools are copied as OpenChamber-owned global Tools in `~/.config/opencode/tools`; Skills are copied to `~/.config/opencode/skills`. Persisted owner/version/hash metadata drives enable, disable, update, rollback, and uninstall.
- Reconciliation never overwrites unmanaged or externally modified global files. Global file changes and manager-state writes roll back together on failure.
- Optional `agentRouting` and `views[].routing` metadata is validated at package and runtime load. Identifiers, counts, priority, operation, data-authority enums, and multi-view declarations are bounded.
- The capability route exposes only extension/tool/intent/operation/data-authority IDs plus coarse connection state. It excludes examples, display names, Connector origins, credential identifiers, Keys, Tokens, and business response data.
- The fixed routing prompt prioritizes matching business Tools over generic generated UI, caps output at 12,000 characters, and tells external runtimes to call only Tools actually present in their current Tool set.
- Artifact envelopes use an independent exact schema and are revalidated on both client and server. The envelope is capped at 256 KiB, HTML at 192 KiB, markup at 4,000 elements, and display height at 120-900 px.
- `artifact-store.js` stores content-addressed documents under the OpenChamber data directory with owner-only permissions and atomic directory replacement. The hash covers executable content, so title or display metadata cannot create duplicate documents.
- History replay calls `materialize` again. Cache deletion is safe because the Tool result remains the source of truth and deterministically recreates the same Artifact ID.
- Cached metadata and document bytes are compared with the document deterministically derived from the authoritative Envelope. Missing or mismatched entries are atomically rebuilt instead of being trusted by ID alone.
- Static documents reject non-fragment `href`/`xlink:href` targets at materialization. Relative subresources that remain useful in authored markup are still blocked by document CSP; the Chromium verifier asserts that no request reaches the loopback target.
- Static scanning rejects frames, objects, embeds, forms, base/link/meta refresh, remote resources, scripts in static mode, and network/eval/worker/WebAssembly/service-worker primitives in interactive mode. Browser enforcement remains authoritative.
- Static document CSP uses `default-src 'none'`, inline style, data/blob images, and no script. Scripts mode is served through a trusted Broker whose response may frame only a `data:` child and whose nested Artifact document injects its own `frame-src 'none'` CSP. Neither layer enables `unsafe-eval`, network, workers, forms, plugins, or external frames.
- CSP/sandbox declarations alone are not proof that a scripted Artifact emits no requests. Scripts therefore run in an opaque `data:` child behind the Broker, which relays only strict Bridge envelopes and removes the child after a navigation. The Chromium attack matrix observes form, frame, download, self-navigation, meta-refresh and API attacks while asserting zero actual target requests. CPU/memory execution is still not independently terminable, so Scripts remains experimental, default-off, and not production-supported.
- Interactive documents receive a deterministic Bridge bootstrap. It applies allowlisted `--ocix-*` tokens and emits ready/resize/error messages; it does not expose Gateway, Tool, filesystem, storage, cookie, or credential APIs.
- Artifact document responses are private/no-store, nosniff, no-referrer, and permission-restricted. `frame-ancestors` allows the same HTTP OpenChamber origin and the exact packaged Desktop origin `openchamber-ui://app`; no other web or custom-protocol parent is allowed.

Production package signatures, persistent install records, publisher confirmation, lifecycle management, signed static marketplace catalogs, and OCIX Connector Authentication v1 are implemented. A signing key proves origin-key possession and integrity, not code safety, real-world publisher identity, or business API access. Hosted marketplace operations, signing-key revocation/transparency, malware review, and remote OpenCode installation remain separate governance work.

## Developer tooling

Create and validate a repository-compatible Installed Declarative + Trusted Native starter from the repository root:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path --id com.acme.operations --name "Acme Operations" --tool-prefix operations
node scripts/interactive-ui-extension.mjs validate /absolute/new/path
```

Validation reuses this runtime for discovery, manifest normalization, entry containment, descriptor and bundle checks, then adds static Declarative primitive/binding/action checks. It substitutes non-secret placeholder values for referenced environment variables, never calls upstream business APIs, and never executes Native code.

The starter manifest includes namespaced `agentRouting` metadata and per-View routing. Developer examples are retained for test corpora and review but are deliberately excluded from the Agent system context to prevent free-text prompt injection.

## Focused validation

```bash
bun run test:interactive-ui
bun run --cwd packages/web test -- server/lib/interactive-ui/artifact-store.test.js server/lib/interactive-ui/routes.artifact.test.js server/lib/ui-auth/ui-auth.test.js
bun run test:html-artifact-browser
node --check packages/web/server/lib/interactive-ui/runtime.js
```
