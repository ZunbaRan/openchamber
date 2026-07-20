# Interactive UI shared runtime

This directory owns the shared OCIX view host used by Web, Desktop, hosted mobile, and Capacitor mobile.

## Flow

1. `ToolPart` parses completed string output with `parseInteractiveResultEnvelope` and auto-expands the first valid OCIX result for that ToolPart.
2. `InteractiveUIView` resolves the installed view from `/api/interactive-ui/views/:viewId` and preserves the ordinary tool-output renderer as fallback.
3. Declarative views render through `DeclarativeInteractiveView`; bindings are resolved by `lib/interactive-ui/bindings.ts` without `eval` or arbitrary expressions. Binding paths only read own properties and reject prototype-related segments. The v1 node set includes layout, metrics, text, progress, status, key-value, data-table, chart, list, callout, and ordered `flow` nodes. A successful installed Declarative action refreshes the View's declared queries.
4. The built-in `generated-layout` boundary accepts a model-composed snapshot from `data.layout`, then `lib/interactive-ui/generatedLayout.ts` rebuilds it from an explicit allowlist. Generated layouts cannot declare queries, actions, bindings, scripts, or arbitrary host access, and their depth, node count, rows, columns, series, and string sizes are bounded.
5. Native views lazy-load an authenticated, server-owned ESM URL and register a React component through `nativeRegistry.ts`.
6. Both installed runtimes call business actions through `lib/interactive-ui/client.ts`; components never receive connector URLs or credentials.

## Invariants

- Only the exact `openchamber://interactive-result/v1` schema activates the host.
- A newly completed OCIX ToolPart opens once automatically; a user can still collapse it afterward.
- Tool/view binding is checked again by the server.
- Native code is trusted same-page code, not a sandbox.
- Native extensions use the activation host's React and shared Button rather than bundling another React copy.
- A failed descriptor, bundle, action, or component preserves an observable error and the original tool output.
- Declarative bindings allow safe property segments only; prototype traversal and arbitrary JavaScript are rejected.
- Installed Declarative writes trigger a query refresh after the confirmed Gateway action succeeds; failed or cancelled actions preserve the existing data.
- Model-generated Declarative snapshots are data-only and cannot acquire the query/action privileges of an installed extension definition.
- Query/action HTTP calls always use `runtimeFetch`.
- VS Code returns explicit unsupported behavior until it has an extension-host Gateway implementation.

## Focused validation

```bash
bun test packages/ui/src/lib/interactive-ui/result.test.ts packages/ui/src/lib/interactive-ui/bindings.test.ts packages/ui/src/lib/interactive-ui/generatedLayout.test.ts packages/ui/src/components/interactive-ui/DeclarativeInteractiveView.test.tsx
bun run type-check:ui
bun run lint:ui
```
