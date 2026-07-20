# OCIX v1 implementation contract

Load this reference whenever creating or changing an installed Interactive UI extension.

## Required package contents

An Agent-usable enterprise module contains two cooperating halves in one `.ocix` archive:

- OpenChamber Host: `openchamber.extension.json`, Declarative JSON, and/or a trusted Native ESM bundle.
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

- Tool name equals its file name without extension and must match `views[].tools[]` exactly.
- Use one default export per `.ts`, `.js`, `.mjs`, or `.cjs` Tool file. Built-in OpenCode names and duplicate names are rejected.
- Skill directory names use lowercase kebab-case. `SKILL.md` frontmatter must declare the same `name` and a non-empty `description`.
- Tool and Skill names are global across installed OCIX packages. Treat a collision as an extension design error; do not overwrite another extension or a user-owned global file.

## Envelope

The completed tool string must be one JSON object with:

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

## Declarative

- Schema: `openchamber://declarative-view/v1`.
- Supported primitives: `stack`, `section`, `row`, `grid`, `metric-grid`, `metric`, `text`, `markdown`, `progress`, `status`, `badge`, `key-value`, `flow`, `chart`, `list`, `callout`, and `data-table`.
- Bindings use `$path` against `data`, `context`, `query`, or `host`; table actions use `$row`.
- Installed definitions may declare queries and row actions, but every action must exist in the extension manifest.
- No JavaScript, raw HTML, arbitrary expressions, or host globals are accepted in Declarative definitions.

## Trusted Native

- Export an object with the manifest's export name, normally `extension`.
- The object must contain the exact extension `id`, `apiVersion: 1`, and `activate(activationHost)`.
- Use `activationHost.react`; do not bundle a second React copy.
- Register only view IDs inside the extension namespace.
- Use `activationHost.ui.Button` and semantic OpenChamber CSS classes/tokens.
- Use `props.host.business.query/execute`; never fetch business APIs or read credentials in the browser bundle.
- `execute` automatically follows the server's confirmation-required challenge for `permission: ask` actions.

## Gateway

- Connector URLs and bearer environment-variable names live in the manifest; bearer values live only on the server.
- Every connector origin must be repeated in `permissions.network`.
- Action paths are fixed connector-relative paths.
- Reads normally use `risk: read, permission: allow`; writes use `risk: write|destructive, permission: ask` unless explicitly denied.
- Include a revision/ETag/business version in writes when overwriting stale data is possible.

## Validation

Run:

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/extension
node scripts/interactive-ui-extension.mjs pack /absolute/path/to/extension --out /absolute/dist/extension.ocix --private-key /absolute/offline/publisher.private.pem --publisher-id com.acme.publisher --publisher-name "Acme" --key-id release-2026
bun run test:interactive-ui-extension
bun run test:interactive-ui
```

Validation does not execute Native code or make business network requests. The final proof is a real OpenChamber conversation in which the Agent selects the tool and the inline module queries and writes through the Gateway.
