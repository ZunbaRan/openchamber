# Third-party HTML Artifact contract

Load this reference when an OCIX package contains `artifacts[]` or needs custom HTML, SVG, Canvas, simulation, drag/drop, or explorer behavior.

## Position in the 2×2 model

| Source / Form | Interactive UI | HTML Artifact |
|---|---|---|
| Agent Generated | strict standard-component JSON; no business API | inline HTML result; sandboxed; no business API |
| Third-party Extension | Installed Declarative or Trusted Native | signed `.html`; sandboxed; declared Business Bridge actions |

The same `.ocix` can contain both Third-party columns. Package trust decides whether the installed source is accepted; sandboxing still limits HTML execution after installation.

## Manifest

```json
{
  "artifacts": [{
    "id": "com.acme.crm.explorer",
    "title": "CRM Explorer",
    "entry": "ui/artifacts/explorer.html",
    "tools": ["crm_open_explorer"],
    "routing": {
      "intents": ["crm.explorer"],
      "priority": 82,
      "operation": "mixed"
    },
    "displayModes": ["inline", "workspace", "fullscreen"],
    "inlineHeight": 520,
    "capabilities": {
      "scripts": true,
      "businessActions": ["com.acme.crm.overview.query", "com.acme.crm.item.approve"]
    }
  }]
}
```

- ID stays inside the extension namespace.
- Entry is one self-contained `.html`, at most 2 MiB.
- Every Tool and routing intent follows the same rules as `views[]`.
- `businessActions` is an Artifact-specific subset of top-level `actions[]`. An undeclared action is rejected by the Host even if the iframe forges a message.
- Multiple views/artifacts require routing on every surface.

## Agent Tool result

```json
{
  "$schema": "openchamber://installed-html-artifact-result/v1",
  "schemaVersion": 1,
  "artifact": "com.acme.crm.explorer",
  "mode": "live",
  "summary": "CRM explorer opened",
  "context": { "scope": "default" },
  "updatedAt": "2026-07-21T10:30:00Z"
}
```

The result references a previously installed, signature-verified Artifact. It cannot contain HTML, a URL, action definitions, tokens, or executable code. OpenChamber verifies that the originating Tool is bound to the Artifact before loading it.

## Browser API

```js
const rows = await window.openchamber.business.query(
  'com.acme.crm.overview.query',
  { scope: 'default' },
);

await window.openchamber.business.execute(
  'com.acme.crm.item.approve',
  { itemId: 'ITEM-1042', revision: 7 },
);
```

`query` and `execute` send a bounded, channel-bound structured message to the Host. The Host derives extension and Artifact identity from the loaded descriptor, invokes the existing Business Gateway, injects credentials server-side, and returns only action data or a sanitized error. `execute` follows the short-lived, one-time confirmation challenge for `permission: ask`; the iframe cannot mint or set the confirmation token itself.

At most four requests run concurrently per Artifact instance. Do not use the bridge for streaming, arbitrary URLs, file access, Tool calls, or MCP passthrough.

## Sandbox and content rules

- Runtime nesting is Host page → authenticated broker iframe → opaque-origin `sandbox="allow-scripts"` content iframe.
- CSP keeps `connect-src`, workers, frames, objects, media, forms, and base navigation disabled.
- Remote assets, iframe/form/object/embed, script `src`, `fetch`, XHR, WebSocket, EventSource, Worker, WebAssembly, `eval`, and dynamic `Function` are rejected before installation and again before serving.
- Theme, locale, viewport, mode, reduced-motion, a bounded execution lease, and Tool result `context` arrive in `host.init`; credentials and connector URLs never do. The injected bootstrap owns the lease heartbeat; extension code must not replace or depend on it.
- Navigation/reload replaces or disables the inner frame. The original Tool output remains available as fallback when rendering fails.
- A stalled heartbeat, the 15-minute execution lease, a runtime error, or the user Stop control removes the active execution surface and offers a fresh restart. Managed Desktop uses an independently terminable, unique-partition `WebContentsView` with no main-world Electron bridge plus main-process CPU/memory/concurrency gates; Scripts are supported there and default on. Ordinary Web keeps the Broker iframe and remains experimental/default-off.
- `OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS=false` is the Managed Desktop emergency kill switch. Never bypass the fallback when it is disabled.
- Agent Generated HTML uses the same visual bridge but is materialized with business access disabled. Never add an option that lets model output opt into the installed bridge.

## Package and acceptance

The standard scaffold creates Declarative, Trusted Native, and HTML Artifact surfaces plus three Agent Tools. Run:

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/extension
node scripts/interactive-ui-extension.mjs pack /absolute/extension --out /absolute/dist/extension.ocix --private-key /absolute/keys/publisher.private.pem --publisher-id com.acme.publisher --publisher-name "Acme" --key-id release-2026
```

Acceptance must prove: Tool discovery after managed install; exact installed result parsing; inline conversation render; light/dark theme; query data; confirmation before write; rejected undeclared action; no secret in descriptor/document/result/logs; disable/enable; update/rollback; and ordinary text fallback. Use Qwen3.7 Plus as the default model routing gate unless the task explicitly requires a multi-provider comparison.
