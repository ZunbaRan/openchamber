# Interactive UI shared runtime

This directory owns the shared OCIX view host used by Web, Desktop, hosted mobile, and Capacitor mobile.

## Flow

1. `ToolPart` independently parses completed string output with `parseInteractiveResultEnvelope` and `parseHTMLArtifactResultEnvelope`. Exact schemas activate the corresponding renderer; malformed or unknown output remains ordinary Tool UI.
2. `InteractiveUIView` resolves an installed View from `/api/interactive-ui/views/:viewId` and preserves the ordinary Tool renderer as fallback.
3. Declarative views render through `DeclarativeInteractiveView`; bindings are resolved by `lib/interactive-ui/bindings.ts` without `eval` or arbitrary expressions. The v1 set includes layout, metrics, text, progress, status, key-value, data-table, charts, lists, callouts, `flow`, `timeline`, `activity-feed`, `comparison`, `tabs`, `accordion`, `code-block`, `sparkline`, `git-graph`, `tree`, `diff-summary`, and `divider`. A successful installed Declarative action refreshes declared queries.
4. The built-in `generated-layout` boundary accepts a model-composed snapshot from `data.layout`, then `lib/interactive-ui/generatedLayout.ts` rebuilds it from an explicit allowlist. Generated layouts cannot declare queries, actions, bindings, scripts, or arbitrary host access, and their depth, node count, rows, columns, series, and strings are bounded.
5. Native views lazy-load an authenticated, server-owned ESM URL and register a React component through `nativeRegistry.ts`. `NativeUIKit.tsx` and `nativeUIKitRegistry.ts` expose host-owned cards, badges, notices, tables, keyboard-accessible tabs, form controls, progress, skeleton, separator, and empty state in addition to Button. `Table.containerClassName` lets a table merge into an enclosing semantic Card without adding a second full border.
6. Installed Declarative and Native runtimes call business actions through `lib/interactive-ui/client.ts`; components never receive connector URLs or credentials.
7. `HTMLArtifactView` is a lazy chunk. It asks the server to materialize the exact Artifact envelope with the current session ID, resolves the authenticated browser-owned document URL, then renders static content with an empty sandbox or explicitly enabled experimental content with `allow-scripts` only. In scripts mode that outer iframe contains a trusted Broker plus an opaque `data:` child; the same outer iframe switches between inline, workspace, and fullscreen modes.
8. Interactive Artifacts exchange only versioned, sequenced messages accepted by `lib/interactive-ui/artifactBridge.ts`. The Broker forwards only strict Host/Artifact envelopes and reports `broker.navigationBlocked` if its child navigates. Host initialization carries locale, timezone, reduced-motion state, light/dark mode, and an allowlisted token snapshot. Resize, copy, external URL, follow-up proposal, and expansion messages are rate-limited; user-affecting requests require recent browser activation. A proposed follow-up only fills the composer and never sends it.
9. Settings → Interactive UI Extensions loads `/api/interactive-ui/connections` and lets the user configure a manual Key or exchange a one-time setup code, test it, replace it, or disconnect. Only public connection status reaches the browser.
10. Before a message is sent, `lib/interactive-ui/routing.ts` normalizes the redacted capability catalog and `routingInspector.ts` creates a bounded in-memory trace. Relevant Tool parts, Artifact materialization, and View descriptor loading update that trace; Settings → Interactive UI Extensions → Routing Inspector shows the observable path and can copy a redacted report.

## Invariants

- Only the exact `openchamber://interactive-result/v1` schema activates the host.
- Only the exact `openchamber://html-artifact-result/v1` schema activates the Artifact host. It is not an OCIX business Envelope and cannot acquire installed extension permissions.
- A newly completed OCIX ToolPart opens once automatically; a user can still collapse it afterward.
- A completed exact Interactive UI or HTML Artifact Result is rendered as standalone answer content instead of being repeated inside the collapsible Activity group. Its compact Tool row uses the product-level renderer label; extension identity remains in the View metadata and malformed output keeps the ordinary Tool label.
- Ready Interactive Views own their title and summary inside the View body. The Host does not render the Envelope summary a second time. Descriptor/runtime failures show safe state copy and keep the original Tool output behind a collapsed disclosure.
- Tool/view binding is checked again by the server.
- Native code is trusted same-page code, not a sandbox.
- Native extensions use the activation host's React and Host UI Kit rather than bundling another React or component-library copy.
- A failed descriptor, bundle, action, or component preserves an observable error and keeps the original tool output available behind a collapsed disclosure control.
- Declarative bindings allow safe property segments only; prototype traversal and arbitrary JavaScript are rejected.
- Installed Declarative writes trigger a query refresh after the confirmed Gateway action succeeds; failed or cancelled actions preserve the existing data.
- Model-generated Declarative snapshots are data-only and cannot acquire the query/action privileges of an installed extension definition.
- Static Artifacts have no script permission. Interactive Artifacts receive `allow-scripts` only and execute in the Broker's opaque nested child: no same-origin, forms, top navigation, popups, downloads, storage, Connector, Tool, or parent-DOM access. A Broker navigation signal transitions the Host to the blocked state and removes the active content.
- Static Artifact source cannot contain a non-fragment navigation target. Hosted and Capacitor mobile reject script Artifacts before materialization; VS Code and active E2EE relay reject all Artifact rendering with an explicit unsupported state.
- Artifact document navigation is treated as a failure. Materialization or iframe failure preserves the original Tool output and a retry action.
- Artifact history replay rematerializes from the Tool result; `X-OpenChamber-Session-ID` lets the server retain shared content until the last referencing session is deleted, but no session depends on an immortal cache entry.
- Web, Desktop, and direct hosted mobile use the browser-owned Artifact document URL. VS Code and active E2EE relay mode report explicit unsupported behavior instead of using a weaker `srcdoc`/blob fallback.
- Query/action HTTP calls always use `runtimeFetch`.
- Connection inputs are password fields and are sent directly to server management routes; they are never retained in the normalized snapshot, extension props, or Agent result.
- VS Code returns explicit unsupported behavior until it has an extension-host Gateway implementation.
- Routing Inspector retains at most 50 traces for 30 minutes in the current renderer process. It stores session/message references, declared capability IDs, connection status, observed Tool state, and View load state only. It never stores prompt text, model reasoning, Connector URLs, credentials, business responses, or Tool input/output.
- The Inspector labels the injected catalog as available candidates. It does not claim to expose the model's hidden semantic ranking or chain of thought; selection reasons are limited to observable facts such as an explicitly named Tool or the class of the Tool actually called.

## Focused validation

```bash
bun test packages/ui/src/lib/interactive-ui/result.test.ts packages/ui/src/lib/interactive-ui/artifactResult.test.ts packages/ui/src/lib/interactive-ui/artifactBridge.test.ts packages/ui/src/lib/interactive-ui/bindings.test.ts packages/ui/src/lib/interactive-ui/generatedLayout.test.ts packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx packages/ui/src/components/interactive-ui/InteractiveUIStateNotice.test.tsx packages/ui/src/components/interactive-ui/NativeUIKit.test.tsx
bun run type-check:ui
bun run lint:ui
```
