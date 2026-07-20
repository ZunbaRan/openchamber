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
- `GET /api/interactive-ui/extensions`
- `GET /api/interactive-ui/views/:viewId?tool=:toolName`
- `GET /api/interactive-ui/extensions/:extensionId/native/:viewId`
- `POST /api/interactive-ui/actions/:actionId`

These routes are registered before the generic OpenCode `/api` proxy. The Native bundle GET route is the only Interactive UI path allowed to use short-lived URL authentication.

## Security invariants

- Manifest entries must stay inside the installed extension directory.
- Connectors are fixed HTTP(S) base URLs without embedded credentials.
- Connector origins must be explicitly declared in `permissions.network`.
- Actions use fixed connector-relative paths and declared methods.
- Action IDs, connectors, permissions, and tool/view relationships are checked server-side.
- `ask` actions return `confirmation_required` before any upstream request.
- Bearer values are read from server environment variables and are never returned in registry/view responses.
- Upstream requests have a timeout and bounded JSON response size.
- Native assets are served from installed files, not arbitrary internet URLs.
- New `.ocix` and marketplace catalogs carry their Ed25519 public key inside the signed document. Inspection proves signature self-consistency and returns only identity, fingerprint, permissions, and Agent Runtime inventory; first trust still requires an explicit fingerprint confirmation.
- Packaged Agent Tools and Skills are validated before installation. Tool names match their file names, use one default export, cannot replace reserved built-ins, and Skill frontmatter must match its directory.
- For local managed OpenCode, enabled OCIX Tools are copied as OpenChamber-owned global Tools in `~/.config/opencode/tools`; Skills are copied to `~/.config/opencode/skills`. Persisted owner/version/hash metadata drives enable, disable, update, rollback, and uninstall.
- Reconciliation never overwrites unmanaged or externally modified global files. Global file changes and manager-state writes roll back together on failure.

Production package signatures, persistent install records, publisher confirmation, lifecycle management, and signed static marketplace catalogs are implemented. A signature proves origin-key possession and integrity, not code safety or real-world publisher identity. Hosted marketplace operations, revocation/transparency, malware review, organization RBAC, and remote OpenCode installation remain separate governance work.

## Developer tooling

Create and validate a repository-compatible Installed Declarative + Trusted Native starter from the repository root:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path --id com.acme.operations --name "Acme Operations" --tool-prefix operations
node scripts/interactive-ui-extension.mjs validate /absolute/new/path
```

Validation reuses this runtime for discovery, manifest normalization, entry containment, descriptor and bundle checks, then adds static Declarative primitive/binding/action checks. It substitutes non-secret placeholder values for referenced environment variables, never calls upstream business APIs, and never executes Native code.

## Focused validation

```bash
bun run test:interactive-ui
bun run --cwd packages/web test -- server/lib/ui-auth/ui-auth.test.js
node --check packages/web/server/lib/interactive-ui/runtime.js
```
