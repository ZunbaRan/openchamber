# OCIX v1 implementation contract

Load this reference whenever creating or changing an installed Interactive UI extension.

## Required package contents

An Agent-usable enterprise module contains two cooperating halves in one `.ocix` archive:

- OpenChamber Host: `openchamber.extension.json`, Declarative JSON, a trusted Native ESM bundle, and/or sandboxed installed HTML Artifact files.
- OpenCode runtime: default-export Custom Tools under `agent-runtime/tools` and routing Skills under `agent-runtime/skills`. A separately governed MCP tool may be used when the capability cannot be packaged locally; a Skill improves tool selection but is not a transport.

Managed local OpenCode receives both halves from one `.ocix` installation. OpenChamber owns Tool copies in `~/.config/opencode/tools` and Skill files in `~/.config/opencode/skills`, synchronizes them across enable/disable/update/rollback/uninstall, and refuses unmanaged name collisions. Do not introduce a per-extension `OPENCODE_CONFIG_DIR`. An external OpenCode server still needs its Agent files installed on that server while the UI package remains on the OpenChamber Host.

## Agent Runtime layout

```text
agent-runtime/
├── tools/
│   └── operations_open.ts
└── skills/
    └── operations-interactive-ui/
        └── SKILL.md
```

- Tool name equals its file name without extension and must match `views[].tools[]` or `artifacts[].tools[]` exactly.
- Use one default export per `.ts`, `.js`, `.mjs`, or `.cjs` Tool file. Built-in OpenCode names and duplicate names are rejected.
- Skill directory names use lowercase kebab-case. `SKILL.md` frontmatter must declare the same `name` and a non-empty `description`.
- Tool and Skill names are global across installed OCIX packages. Treat a collision as an extension design error; do not overwrite another extension or a user-owned global file.

## Agent routing

New OCIX packages should declare both extension-level and surface-level routing:

```json
{
  "agentRouting": {
    "domain": "operations",
    "intents": ["operations.overview", "operations.item.approve"],
    "examples": { "en": ["open operations", "approve an item"] },
    "dataAuthority": "connected-business-system"
  },
  "views": [{
    "id": "com.acme.operations.workspace",
    "tools": ["operations_open_workspace"],
    "routing": {
      "intents": ["operations.overview", "operations.item.approve"],
      "priority": 85,
      "operation": "mixed"
    }
  }]
}
```

- `domain` and intents are bounded identifiers, and intents stay inside the domain namespace. They are not prose.
- `dataAuthority` is one of `generated`, `user-provided`, or `connected-business-system`.
- Extensions with multiple `views[]` and/or `artifacts[]` declare routing on every surface. Surface intents are a subset of extension intents; priority is 0-100; operation is `read`, `write`, or `mixed`.
- Every routed surface binds at least one lowercase underscore Tool name. Package validation checks the schema before signing and again before installation.
- Examples are short bilingual review/test phrases. OpenChamber does not inject them, extension names, URLs, or descriptions into the system prompt.
- The generated capability context is delivered through OpenCode's per-prompt `system` field and refreshes from enabled manifests and coarse Connector state. It never modifies `AGENTS.md`.
- Tool descriptions remain mandatory. State the authoritative business data source, priority over generic `interactive_ui`, read/write semantics, and behavior when setup is missing.
- Routing order is explicit Tool, matching business Tool, other specialized/MCP Tool, generic `interactive_ui`, then text. A missing/expired Connector does not authorize fake generic business data.

## Result Envelopes

An Interactive UI Tool returns:

```json
{
  "$schema": "openchamber://interactive-result/v1",
  "view": "com.acme.operations.workspace",
  "schemaVersion": 1,
  "mode": "live",
  "summary": "Operations workspace opened",
  "context": { "scope": "default" },
  "updatedAt": "2026-07-18T10:30:00Z"
}
```

The manifest view must bind the exact tool name. If parsing, lookup, binding, asset loading, or rendering fails, OpenChamber falls back to ordinary tool output.

An installed HTML Artifact Tool returns only a signed asset reference:

```json
{
  "$schema": "openchamber://installed-html-artifact-result/v1",
  "schemaVersion": 1,
  "artifact": "com.acme.operations.explorer",
  "mode": "live",
  "summary": "Operations explorer opened",
  "context": { "scope": "default" },
  "updatedAt": "2026-07-21T10:30:00Z"
}
```

The manifest Artifact must bind the exact Tool. This Envelope cannot include HTML, URL, Token, Connector, action definition, or executable code.

## Declarative

- Schema: `openchamber://declarative-view/v1`.
- Supported primitives: `stack`, `section`, `row`, `grid`, `metric-grid`, `metric`, `text`, `markdown`, `progress`, `status`, `badge`, `key-value`, `flow`, `chart`, `list`, `callout`, `data-table`, `divider`, `timeline`, `activity-feed`, `comparison`, `tabs`, `accordion`, `code-block`, `sparkline`, `gauge`, `heatmap`, `kanban`, `git-graph`, `tree`, and `diff-summary`.
- Bindings use `$path` against `data`, `context`, `query`, or `host`; table actions use `$row`.
- Installed definitions may declare queries and row actions, but every action must exist in the extension manifest.
- No JavaScript, raw HTML, arbitrary expressions, or host globals are accepted in Declarative definitions.
- Use semantic fields such as tone, trend, state, density, alignment, and format. Do not add colors, arbitrary styles/classes, CSS variables, URLs, or executable content to the View schema.
- First query uses a stable Skeleton. Refresh keeps the last valid data visible; empty, unconfigured, and error are separate states.
- Agent Generated Declarative uses the same visual primitives but passes through a stricter sanitizer and never inherits installed query/action/binding privileges.

## Trusted Native

- Export an object with the manifest's export name, normally `extension`.
- The object must contain the exact extension `id`, `apiVersion: 1`, and `activate(activationHost)`.
- Use `activationHost.react`; do not bundle a second React copy.
- Register only view IDs inside the extension namespace.
- Use `activationHost.ui`: Button; Card/Header/Title/Content; Badge; Notice; Skeleton; Separator; Progress; Table/Header/Body/Row/Head/Cell; Tabs/List/Trigger/Content; Input; Textarea; and EmptyState. Use `Notice` for unavailable, unauthorized, forbidden, stale, and error feedback. Treat this as the stable v1 Host UI Kit and feature-detect additions.
- Use semantic OpenChamber/OCIX CSS classes and tokens only. Do not inject global CSS, override host tokens, hard-code a parallel palette, or reach into private host DOM.
- Use `props.host.business.query/execute`; never fetch business APIs or read credentials in the browser bundle.
- `execute` automatically follows the server's confirmation-required challenge for `permission: ask` actions.
- Explicitly refresh Native query state after a successful write; preserve the previous valid state on failed/cancelled refresh.

## HTML Artifact boundaries

- Agent Generated HTML uses `openchamber://html-artifact-result/v1` with inline HTML. Use it only when safe Declarative primitives cannot reasonably express a one-off custom SVG, simulator, or explorer. It has no Connector, Token, Gateway, Tool, filesystem, storage, parent-DOM, or network access.
- Third-party HTML lives in signed OCIX `artifacts[]` and is selected through `openchamber://installed-html-artifact-result/v1`. It remains sandboxed but may call only its manifest-declared `businessActions` through `window.openchamber.business.query/execute`.
- Neither Artifact type can call a raw URL or receive credentials. The installed bridge derives extension identity in the Host and reuses the server-side Gateway, action allowlist, confirmation challenge, timeout, response limit, and secret injection.
- Standard visualizations should stay Interactive UI. Use installed HTML for durable custom geometry/interaction, not as a way around package signing or Gateway policy.
- Read [html-artifacts.md](html-artifacts.md) for the exact manifest, bridge, sandbox, and acceptance contract.

## Gateway

- Use `api-key` for a user-configured third-party Key, or `issued-key` when the provider exposes the OCIX v1 one-time setup-code exchange. `env-bearer` remains compatibility-only and `none` is for unauthenticated connectors.
- Credential values live only in the OpenChamber server secret store. The manifest declares only placement and, for `issued-key`, the HTTPS provisioning URL.
- Header placement defaults to `Authorization: Bearer <key>`. Query-string placement, embedded URL credentials, unsafe headers, and host-reserved `X-OpenChamber-*` headers are rejected.
- Every connector origin must be repeated in `permissions.network`.
- An `issued-key` provisioning origin must also be repeated in `permissions.network`.
- Declare a fixed, safe `GET`/`HEAD` `test` request so Extension Manager can distinguish invalid (`401`) from insufficient-scope (`403`) Keys.
- Action paths are fixed connector-relative paths.
- Reads normally use `risk: read, permission: allow`; writes use `risk: write|destructive, permission: ask` unless explicitly denied.
- Include a revision/ETag/business version in writes when overwriting stale data is possible.
- Business scopes, RBAC/ABAC, revocation, and final audit belong to the third-party API. OpenChamber does not infer or replace them.

## Validation

Run:

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/extension
node scripts/interactive-ui-extension.mjs pack /absolute/path/to/extension --out /absolute/dist/extension.ocix --private-key /absolute/offline/publisher.private.pem --publisher-id com.acme.publisher --publisher-name "Acme" --key-id release-2026
bun run test:interactive-ui-extension
bun run test:interactive-ui
```

Validation does not execute Native code or make business network requests. It does parse and harden installed HTML entries. The final proof is a real OpenChamber conversation in which the Agent selects the Tool and the inline surface queries and writes through the Gateway. Qwen3.7 Plus is the default routing baseline; other Providers are optional comparison coverage unless a release task explicitly requires them.
