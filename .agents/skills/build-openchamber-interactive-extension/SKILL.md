---
name: build-openchamber-interactive-extension
description: Build, sign, package, or modify an OpenChamber OCIX enterprise module using Installed Declarative and/or Trusted Native UI, a real HTTP Business Gateway, OpenCode Custom Tools or MCP, and an Agent Skill. Use for scaffolding an extension, adapting an enterprise dashboard or workflow, binding real APIs, matching OpenChamber visual conventions, producing signed .ocix packages or marketplace catalogs, validating manifests/views/bundles, or testing the complete Agent-to-inline-UI path.
---

# Build OpenChamber Interactive Extension

## Overview

Produce a repository-compatible enterprise extension without modifying OpenCode or OpenChamber feature source for each module. Treat Agent routing, installed UI, business transport, and trust as separate contracts.

## Required reference

Read [references/contracts.md](references/contracts.md) before editing an extension. Read [references/distribution.md](references/distribution.md) for signing, package installation, updates, rollback, publisher trust, or marketplace work. Read `docs/OCIX_CONNECTOR_AUTHENTICATION_V1.md` when the extension connects to a real authenticated API. Read `docs/INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md` when the request includes architecture, installation, deployment, or a real external OpenCode server.

When changing OpenChamber source rather than only an extension package, also load the repository skills triggered by `AGENTS.md`, especially `openchamber-change-discipline`, `theme-system`, `locale-ui-patterns`, and `ui-api-decoupling`.

## Workflow

1. Inventory the business module: user intents, read models, writes, destructive operations, auth owner, revision field, empty/error states, and target runtimes.
2. Choose the UI runtime:
   - Use Declarative for metrics, standard charts/tables, status, lists, flow, and simple confirmed row actions.
   - Use Trusted Native for custom state, multi-step interaction, complex composition, dialogs, or an existing React module.
   - A single extension may ship both; start Declarative when either can satisfy the task.
3. Scaffold a new package:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path \
  --id com.acme.operations \
  --name "Acme Operations" \
  --tool-prefix operations
```

4. Replace the starter API paths and data shape. Choose `api-key` for a key copied from the third-party system or `issued-key` for a server-to-server one-time setup-code exchange. Keep credentials server-side and route Native/Declarative calls through declared Gateway actions. Do not recreate the third party's RBAC/ABAC in OpenChamber.
5. Implement the Agent half under `agent-runtime/`. Put one default-export OpenCode Custom Tool in `agent-runtime/tools/<tool_name>.ts`; its file name is the tool name. Put each routing Skill at `agent-runtime/skills/<skill-name>/SKILL.md` with matching `name` and a useful `description`. A Tool returns the strict Envelope; a Skill says when to call it and is never the API transport. Use separately governed MCP only when the capability truly lives outside the package.
6. Match the host: use semantic classes/tokens, shared Host SDK controls, responsive layouts, loading/empty/error states, and the host locale. Do not bundle React in Native output.
7. Validate before launching:

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/extension
```

8. For a normal managed or conversation test, create an offline Ed25519 key, run `pack`, choose the resulting `.ocix` in Settings, review the embedded publisher identity/fingerprint/capabilities, and confirm installation. The package installs both Host UI/Gateway files and its Agent Runtime; never copy an unsigned directory into the managed versions tree or manually set `OPENCODE_CONFIG_DIR` per extension.
9. Configure the installed Connector under **Business connections**. Test an accepted key, an invalid key (`401`), an insufficient-scope key (`403`), replacement/rotation, disconnect, and uninstall cleanup. The UI and Agent must never receive the raw Key.
10. OpenChamber keeps package sources in its version store, copies managed Tools to `~/.config/opencode/tools`, copies managed Skills to `~/.config/opencode/skills`, and refreshes managed OpenCode. Tool/Skill names must be globally unique; never overwrite an unmanaged file to resolve a collision. Keep each Tool file self-contained except for dependencies available to normal global OpenCode Tools. `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` remains a UI-only local renderer bypass, not a complete conversation install.
11. For an external OpenCode server, `.ocix` installation can manage only the machine running OpenChamber. Deploy the Agent Runtime to that remote server through its own administration channel and report that limitation explicitly.
12. For catalog distribution, generate a signed static marketplace catalog, add only its URL in Extension Manager, review its embedded identity/key fingerprint, and test catalog-hash plus package-signature failure paths.
13. Test in the normal conversation flow: natural-language trigger, explicit tool-name fallback, inline render, query, confirmation, write, refresh, disable/enable, update/rollback, and ordinary Tool UI fallback.

## Security and product boundaries

- Never place tokens in an Envelope, Declarative JSON, Native bundle, URL, logs, or browser storage.
- Never let a Native component call arbitrary URLs. The server validates connector origin, action allowlist, confirmation policy, timeout, response size, and credentials.
- Third-party systems issue Keys and enforce their scope, revocation, RBAC/ABAC, and business rules. OpenChamber owns extension trust, network/action allowlists, confirmation, server-side storage/injection, and error forwarding; do not merge these two authorization layers.
- Treat Native as same-page code authorized by an administrator or a pinned signed marketplace. A valid signature proves origin and integrity, not code safety.
- Do not use HTML Artifact for an enterprise module that needs business credentials; that runtime is for untrusted model-generated presentation code and has a narrow bridge.
- Do not claim VS Code parity: OCIX Gateway calls currently return explicit unsupported behavior there.
- `.ocix` signing, embedded public-key inspection, confirmation-based publisher trust, managed local Tool/Skill deployment, enable/disable, update/rollback, recoverable uninstall, self-describing signed static marketplace catalogs, and Connector Authentication v1 are implemented. An embedded signing key proves package signature self-consistency, not the publisher's real-world identity and is unrelated to a business Access Key. Do not claim an official hosted marketplace, revocation/transparency service, malware review, or remote dual-install negotiation exists.

## Completion checklist

- The manifest, view IDs, bundle registration, and tool names agree exactly.
- Packaged Tool file names are globally unique, default-export one tool each, and packaged Skills have valid frontmatter; no per-extension `OPENCODE_CONFIG_DIR` setup remains in the handoff.
- Query and write actions are declared; write actions require confirmation and carry revision data where relevant.
- Declarative writes refresh live query data; Native writes explicitly refresh.
- The extension validator passes with no unexplained warnings.
- Production packages pass independent `verify`; signing private keys are outside the extension and repository.
- Managed install, disable/enable, update/rollback, tamper rejection, and state-write rollback have focused tests when distribution behavior changed.
- Every authenticated Connector uses `api-key`, `issued-key`, or the legacy `env-bearer`; its safe `GET`/`HEAD` connection test and `401`/`403` behavior are verified without exposing credentials.
- Focused OpenChamber Interactive UI tests pass when core behavior changed.
- A real conversation proves Agent selection and inline rendering; standalone demo pages are only renderer harnesses.
