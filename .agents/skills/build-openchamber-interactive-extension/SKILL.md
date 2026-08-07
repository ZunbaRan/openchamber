---
name: build-openchamber-interactive-extension
description: Build, sign, package, or modify an OpenChamber OCIX enterprise module containing Interactive UI, sandboxed HTML Artifacts, or both, with a real HTTP Business Gateway, OpenCode Custom Tools, and an Agent Skill. Use for scaffolding extensions, adapting enterprise dashboards or workflows, binding APIs, choosing Declarative versus Trusted Native versus HTML Artifact, producing signed .ocix packages or marketplace catalogs, validating manifests/surfaces/bundles, or testing the complete Agent-to-inline-UI path.
---

# Build OpenChamber Interactive Extension

## Overview

Produce a repository-compatible enterprise extension without modifying OpenCode or OpenChamber feature source for each module. Use the stable 2×2 vocabulary: form is **Interactive UI** or **HTML Artifact**; source is **Agent Generated** or **Third-party Extension**. Treat Agent routing, installed surfaces, business transport, sandboxing, and package trust as separate contracts.

## Required reference

Read [references/contracts.md](references/contracts.md) before editing an extension. Read [references/html-artifacts.md](references/html-artifacts.md) whenever `artifacts[]` or custom HTML/SVG/Canvas is involved. Read [references/distribution.md](references/distribution.md) for signing, package installation, updates, rollback, publisher trust, or marketplace work. Read [references/remote-services.md](references/remote-services.md) whenever the request is a URL+Access-Key Direct Remote service rather than a Local or Hosted thin `.ocix`. Read `docs/OCIX_CONNECTOR_AUTHENTICATION_V1.md` when the extension connects to a real authenticated API. Read `docs/INTERACTIVE_UI_EXTENSION_DEVELOPER_GUIDE.md` when the request includes architecture, installation, deployment, or a real external OpenCode server.

When changing OpenChamber source rather than only an extension package, also load the repository skills triggered by `AGENTS.md`, especially `openchamber-change-discipline`, `theme-system`, `locale-ui-patterns`, and `ui-api-decoupling`.

## Workflow

1. Inventory the business module: namespaced routing domain, bounded read/write intents, short bilingual trigger examples, data authority, read models, writes, destructive operations, auth owner, revision field, empty/error states, and target runtimes.
2. Choose the form inside the 2×2 model:
   - Use Declarative for layout, metrics, charts/tables, status, lists, flow, timeline, activity feed, agenda, funnel, bounded network, comparison, tabs/accordion, code, sparkline, gauge, heatmap, read-only kanban, standard Git graph/tree/diff summary, and simple confirmed row actions.
   - Use Trusted Native for durable enterprise UI that needs custom state, complex coordinated interaction, dialogs/forms, bespoke composition, or an existing React module. Use only Host React, Host UI Kit, semantic tokens, and Gateway methods.
   - Use a Third-party HTML Artifact for signed, durable custom SVG/Canvas, simulation, drag/drop, or explorer experiences that need more expression than the Host UI Kit. It stays sandboxed and calls only declared Gateway actions through `window.openchamber.business`.
   - A single `.ocix` may ship `views[]`, `artifacts[]`, or both; start with Declarative when it can satisfy the task.
   - Agent Generated HTML Artifact remains a separate one-off result with no Connector, Gateway, credential, or network access. Never confuse its authority with an installed Artifact.
3. Choose the delivery workflow. For Local/Hosted package work, scaffold a package:

```bash
node scripts/interactive-ui-extension.mjs create /absolute/new/path \
  --id com.acme.operations \
  --name "Acme Operations" \
  --tool-prefix operations
```

   For Direct Remote, do not create or pack a thin `.ocix`: start from `docs/OCIX_REMOTE_SERVICE_DEVELOPER_GUIDE.md` and the workspace-root `extension/` reference services. The app entry URL itself returns the signed Manifest; UI resources stay remote and lazy, while the Access Key is only for the one declared Business Connector.

4. Replace the starter `agentRouting` domain/intents/examples and every `views[].routing` / `artifacts[].routing` block. Use `connected-business-system` for authoritative enterprise data, assign `read`/`write`/`mixed` honestly, and give the more specific business surface a higher bounded priority. Do not put instructions, API URLs, credentials, or business values in routing metadata.
5. Design every surface that should appear in the right-sidebar Extension Workbench. Add a bounded `dashboard` contract with `inputSchema`, safe `defaultContext` and/or `hostContext`, preferred/min/max grid size, instance policy, refresh policy, declared events, and Popout capability. A surface is manually launchable only when defaults plus Host context satisfy every required input. Do not invent a fake default for an ID-dependent detail surface: keep its `itemId` required so the Catalog correctly disables manual launch until an Agent result or a declared Link supplies it. If a release changes stored Context across an incompatible major version, declare bounded `dashboard.migrations` with only `rename`, `move`, and `setDefault`; never add migration JavaScript.
6. Declare same-extension `links[]` for coordinated tiles. The source must declare the event under `dashboard.events.emits`, the target must accept the same event, and every mapped target path must exist in the target `inputSchema`. Use only `$event.payload.*`, `$source.context.*`, `$host.*`, or JSON scalar mappings. Declarative surfaces emit through a row action with `type: "emit"`; Trusted Native uses `props.host.dashboard.emit(event, payload)`; installed HTML uses `window.openchamber.dashboard.emit(event, payload)`. Never route a Link across OCIX package boundaries.
7. Replace the starter API paths and data shape. Choose `api-key` for a key copied from the third-party system or `issued-key` for a server-to-server one-time setup-code exchange. Keep credentials server-side and route Native/Declarative calls through declared Gateway actions. Do not recreate the third party's RBAC/ABAC in OpenChamber.
8. Implement the Agent half under `agent-runtime/`. Put one default-export OpenCode Custom Tool in `agent-runtime/tools/<tool_name>.ts`; its file name is the tool name. Interactive UI Tools return `openchamber://interactive-result/v1`; installed Artifact Tools return `openchamber://installed-html-artifact-result/v1` and only reference an installed Artifact ID—never inline HTML, URLs, or credentials. Tool descriptions must state the authoritative business source, priority over generic visualization, missing-connection behavior, and that a successful result is terminal/already rendered: call at most once per assistant turn and never follow it with the same or another primary Surface Tool. Keep the user-facing `summary` explicit that the requested Surface opened successfully rather than implying the Agent must fetch inline rows. Put each routing Skill at `agent-runtime/skills/<skill-name>/SKILL.md` with matching `name` and a useful `description`. A Skill improves selection and is never the API transport.
9. Match the host. Declarative/Native use semantic fields, OCIX tokens, the Host UI Kit, responsive layouts, and explicit loading/ready/empty/unconfigured/error states. Installed HTML uses a self-contained `.html`, OCIX CSS variables, accessible DOM, `window.openchamber.business.query/execute`, and—when linked—`window.openchamber.dashboard.emit`; it must not use `fetch`, XHR, remote assets, storage, popup authentication, or parent DOM. Do not bundle React or a duplicate component library in Native output. Do not hard-code a parallel palette or inject global CSS.
10. Validate before launching. Local/Hosted packages use the extension CLI; Direct Remote additionally verifies the built signed Manifest and every indexed resource byte/MIME before starting its server:

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/extension
```

11. For a normal managed or conversation test, create an offline Ed25519 key, run `pack`, choose the resulting `.ocix` in Settings, review the embedded publisher identity/fingerprint/capabilities/routing summary, and confirm installation. The package installs both Host UI/Gateway files and its Agent Runtime; never copy an unsigned directory into the managed versions tree or manually set `OPENCODE_CONFIG_DIR` per extension.
12. Configure the installed Connector under **Business connections**. Test an accepted key, an invalid key (`401`), an insufficient-scope key (`403`), replacement/rotation, disconnect, and uninstall cleanup. The UI and Agent must never receive the raw Key.
13. OpenChamber keeps package sources in its version store, copies managed Tools to `~/.config/opencode/tools`, copies managed Skills to `~/.config/opencode/skills`, and refreshes managed OpenCode. Tool/Skill names must be globally unique; never overwrite an unmanaged file to resolve a collision. Keep each Tool file self-contained except for dependencies available to normal global OpenCode Tools. `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` remains a UI-only local renderer bypass, not a complete conversation install.
14. For an external OpenCode server, `.ocix` installation can manage only the machine running OpenChamber. Deploy the Agent Runtime to that remote server through its own administration channel and report that limitation explicitly. The routing Catalog is still sent through the OpenCode prompt API, but it explicitly forbids calling a catalog Tool that is absent from the remote Tool set.
15. For catalog distribution, generate a signed static marketplace catalog, add only its URL in Extension Manager, review its embedded identity/key fingerprint, and test catalog-hash plus package-signature failure paths. Browse the catalog after installation: an exact version must show Installed, a greater semantic version must show Update, and Extension diagnostics must list the managed Tools, Skills, install source, package hash, and any unresolved Tool bindings.
16. Test in the normal conversation flow: natural-language trigger, explicit tool-name fallback, inline render, Pin, Workbench launch, query, confirmation, write, refresh, connector-unconfigured behavior, disable/enable, compatible and incompatible update/rollback, and ordinary Tool UI fallback. Verify the default two-column tile layout, drag/resize persistence, same-DOM Focus, generated snapshot Pin, required-context disabled states, and a declared event opening/updating the linked tile. For incompatible updates, prove successful declarative migration, atomic failure on a conflicting target, and continued Gateway blocking before migration. Before uninstall, verify the confirmation shows the exact affected Workbench Tile/project counts. Verify that the business Tool beats generic `interactive_ui`, while ad-hoc non-business visualization still selects `interactive_ui`.
17. When validating platform routing, cover all applicable 2×2 cells: Agent Generated Interactive UI, Agent Generated HTML Artifact, Third-party Interactive UI, and Third-party HTML Artifact. Agent Generated HTML must never call an API; Third-party HTML must prove a real query and a confirmation-gated write through the Business Bridge. Qwen3.7 Plus is the default model baseline; additional providers are comparison coverage, not a requirement for ordinary local completion.

## Security and product boundaries

- Never place tokens in an Envelope, Declarative JSON, Native bundle, URL, logs, or browser storage.
- Never place free-form instructions in `domain` or `intents`; use namespaced identifiers. Trigger examples are bounded review metadata and are not injected into the model system prompt.
- Never describe a connected business Tool as optional behind generic `interactive_ui`. A matching business Tool wins even when it can only report missing Connector setup; generic generated UI may use only user-provided/model-derived or clearly labeled simulated data.
- Make every Tool description and routing Skill enforce one primary View per assistant turn: after the extension returns an Interactive Result, the Agent must not call `interactive_ui`/`html_artifact` or reconstruct the same data as a second dashboard or long Markdown table.
- Never let a Native component call arbitrary URLs. The server validates connector origin, action allowlist, confirmation policy, timeout, response size, and credentials.
- Third-party systems issue Keys and enforce their scope, revocation, RBAC/ABAC, and business rules. OpenChamber owns extension trust, network/action allowlists, confirmation, server-side storage/injection, and error forwarding; do not merge these two authorization layers.
- Treat Native as same-page code authorized by an administrator or a pinned signed marketplace. A valid signature proves origin and integrity, not code safety.
- Never give Artifact JavaScript a credential or raw connector URL. A Third-party HTML Artifact may access business data only through its signed manifest action allowlist and the Host Business Bridge; an Agent Generated Artifact never receives that bridge.
- Treat Workbench event payloads as untrusted structured data. Declare and validate payload/input schemas, keep mappings bounded, and never use a dashboard Link to smuggle credentials, URLs, code, or arbitrary instructions.
- Do not claim VS Code parity: OCIX Gateway calls currently return explicit unsupported behavior there.
- `.ocix` signing, embedded public-key inspection, confirmation-based publisher trust, managed local Tool/Skill deployment, enable/disable, update/rollback, recoverable uninstall, self-describing signed static marketplace catalogs, and Connector Authentication v1 are implemented. An embedded signing key proves package signature self-consistency, not the publisher's real-world identity and is unrelated to a business Access Key. Do not claim an official hosted marketplace, revocation/transparency service, malware review, or remote dual-install negotiation exists.

## Completion checklist

- The manifest, View/Artifact IDs, bundle registration, HTML entries, and tool names agree exactly.
- A Direct Remote Manifest embeds a valid publisher envelope, is signed over canonical JSON, declares exactly one `api-key` Connector, and is inspectable without fetching any resource.
- `agentRouting.domain` and every intent are namespaced identifiers; `dataAuthority` is correct; every surface in a multi-surface extension has bounded intents, priority, and operation metadata.
- Every installed HTML Artifact is self-contained, declares `capabilities.scripts: true`, and lists only the Gateway actions it actually needs under `capabilities.businessActions`.
- Every Workbench surface has a bounded `dashboard.inputSchema`; defaults/Host mappings satisfy only genuinely defaultable inputs; ID-dependent detail surfaces remain disabled for manual launch until Context is supplied.
- Every declared Link stays within one extension, references a declared emitted/accepted event, maps only allowed sources into declared target paths, and has a focused test for invalid payload and rapid duplicate emission.
- Declarative, Native, and installed HTML event emitters use the Host bridge. Agent Generated surfaces are pinnable snapshots but cannot acquire installed Link or Business Gateway authority.
- Tool descriptions and the Skill agree with the platform order: explicit Tool → matching installed business Tool → other specialized/MCP Tool → generic `interactive_ui` → text.
- Packaged Tool file names are globally unique, default-export one tool each, and packaged Skills have valid frontmatter; no per-extension `OPENCODE_CONFIG_DIR` setup remains in the handoff.
- Query and write actions are declared; write actions require confirmation and carry revision data where relevant.
- Declarative writes refresh live query data; Native writes explicitly refresh.
- Loading preserves layout with Skeleton; refresh failure preserves the last valid data; empty and unconfigured states are not rendered as zero-valued business metrics.
- Declarative/Native layouts remain usable at narrow conversation width and use the Host locale, typography, semantic tones, and light/dark OCIX tokens.
- The extension validator passes with no unexplained warnings.
- Production packages pass independent `verify`; signing private keys are outside the extension and repository.
- Managed install, disable/enable, update/rollback, tamper rejection, and state-write rollback have focused tests when distribution behavior changed.
- Every authenticated Connector uses `api-key`, `issued-key`, or the legacy `env-bearer`; its safe `GET`/`HEAD` connection test and `401`/`403` behavior are verified without exposing credentials.
- Focused OpenChamber Interactive UI tests pass when core behavior changed.
- A real conversation proves Agent selection and inline rendering; standalone demo pages are only renderer harnesses.
- Workbench acceptance proves all four Pin paths, project-scoped persistence, two tiles per default row, drag/resize reload, Focus restoration, linked-tile highlighting, required-input launch blocking, and uninstall cleanup.
- The business-domain unconfigured-Connector case selects the business Tool and reports setup instead of producing fabricated metrics; generated example data is visibly labeled.
