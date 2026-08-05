# OpenChamber Interop Acceptance Lab

This directory is an isolated, low-memory acceptance stack for OpenChamber
interoperability. It does not modify product source and exposes only one host
socket: `127.0.0.1:9510` on `oc-interop-gateway`.

Use [RUNBOOK.md](./RUNBOOK.md) for preparation, deployment, probing, tunnel
publication, rollback, and artifact installation.

When the shared acceptance server or tunnel is unavailable, the strict tldraw
MCP App can run entirely on the developer machine from the independent
`tldraw-mcp-app` repository. OpenChamber consumes that service only through its
MCP URL; it does not build, bundle, or own the server implementation. The
loopback path does not start Docker, does not require the other lab services,
and does not fetch App assets at runtime. See
[Local loopback tldraw MCP](./RUNBOOK.md#local-loopback-tldraw-mcp) for the
service, OpenCode configuration, and consumer-probe commands.

## Acceptance chains

| Chain | What is real | What is an acceptance fixture |
| --- | --- | --- |
| Hosted OCIX | Ed25519 package and remote-manifest signatures, SHA-256 resource verification, permission comparison, OpenChamber OCIX package format, HTTP authentication and confirmation contracts | The deterministic Ops dataset/API is lab-owned; it is not a third-party operations provider |
| Local OCIX | Full signed OCIX package with Declarative overview, required-`customerId` Native detail, and sales-funnel HTML Artifact | The deterministic CRM dataset/API is lab-owned; it is not a production CRM |
| Legacy MCP | Official `@modelcontextprotocol/server-everything@2025.9.12` behavior over separate Streamable HTTP and legacy HTTP+SSE containers | The transport wrapper and reconnect probe are lab-owned |
| Excalidraw MCP | Official `excalidraw/excalidraw-mcp` v0.3.2 release asset, self-hosted `create_view`, MCP App resource, and the official remote `https://mcp.excalidraw.com/mcp` | The small health/proxy process is lab-owned and reports verified release provenance |
| tldraw MCP | Actual tldraw v5.0.2 editor bundled from the SHA-pinned official tag; real editor snapshots and SVG/PNG rendering | The independent `tldraw-mcp-app` repository owns the strict MCP `2026-07-28` server/App contract because tldraw does not publish this acceptance server; this lab owns only the consumer acceptance path |
| Quick tunnel | Pinned official Cloudflare `cloudflared` image and a real ephemeral HTTPS URL | The URL is temporary and changes when the tunnel is recreated |

No probe synthesizes third-party tool behavior. When an upstream service or
network is unavailable, the probe fails and records no substitute success.

## Services and memory ceiling

| Container | Role | Limit |
| --- | --- | ---: |
| `oc-interop-gateway` | Only host-bound gateway | 24 MiB |
| `oc-hosted-ocix-lab` | Hosted assets and Ops API | 48 MiB |
| `oc-local-crm-api` | Local CRM API | 48 MiB |
| `oc-legacy-mcp-http` | Legacy release, Streamable HTTP | 56 MiB |
| `oc-legacy-mcp-sse` | Legacy release, HTTP+SSE | 56 MiB |
| `oc-excalidraw-mcp` | Official self-hosted Excalidraw MCP plus proxy | 136 MiB |
| `oc-tldraw-mcp-2026` | Independent `tldraw-mcp-app` image and persisted tldraw state | 96 MiB |
| `oc-interop-tunnel` | Optional `tunnel` profile | 24 MiB |

The full profile totals 488 MiB. Every service is `linux/amd64`,
restart-enabled, read-only except explicit tmpfs/secret mounts and the dedicated
tldraw state volume, and has a health check. Before the full profile starts,
`INTEROP_TLDRAW_MCP_IMAGE` must identify an independently built and verified
`tldraw-mcp-app` image.

## Generated material

All credentials, publisher private keys, downloaded release assets, dependency
trees, image inputs, signed packages, and evidence live under `.env`,
`.runtime/`, or `evidence/`. These paths are ignored. The strict
`.dockerignore` excludes dependency trees, downloads, keys, `.env`, and evidence
from every shared Docker build context.

Never commit:

- `.env` or `.runtime/secrets/`
- `.runtime/keys/publisher.private.pem`
- quick-tunnel URLs treated as current deployment configuration
- acceptance evidence containing local environment details

The source tree contains no publisher key or API key.

## Surface inventory

Hosted OCIX publishes:

- `overview` Declarative Surface
- `incident-detail` Declarative Surface with required `incidentId`
- `topology` HTML Artifact
- signed release fixtures `1.0.0`, permission-equivalent `1.0.1`,
  permission-expanded `1.1.0`, and a post-signing tampered negative fixture

Local OCIX publishes:

- CRM overview Declarative Surface
- Native customer detail with required `customerId`
- sales-funnel HTML Artifact

The strict tldraw server exposes exactly:

- `tldraw_open_canvas` — model and App visible; it can atomically seed a new
  canvas with a bounded `initialDiagram` of nodes and edges, so the Agent can
  create the requested first view without receiving access to App-only mutation
  tools. Replaying the identical seed is idempotent, while a different seed
  cannot overwrite an initialized diagram or saved editor state.
- `tldraw_apply_operations` — App only
- `tldraw_save_canvas` — App only
- `tldraw_export_snapshot` — App only

All four carry the explicit `canvasId`. The default acceptance canvas is
`interop-acceptance`; protocol probes use separate IDs for isolation,
idempotency, and initial-diagram persistence. Every canvas is revision-checked
and persisted in `oc-interop-tldraw-state`.

The tldraw MCP App renders as a compact read-only preview while embedded in a
conversation. Its **Edit** action requests the host's `fullscreen` display mode;
only that fullscreen surface enables the complete tldraw editor UI and App-only
save/export operations.

## Local tldraw runtime at a glance

The independent `tldraw-mcp-app` manager binds only `127.0.0.1:39512`, stores
its PID, log, metadata, and persistent canvas state in its own private runtime
directory, and rejects stale or unverified App artifacts. It never terminates a
process unless the PID still belongs to its exact bundled server path.

```bash
cd /path/to/tldraw-mcp-app
npm run verify:dist
npm run start
npm run status
npm run probe
npm run stop

cd /path/to/openchamber/extension/interop-acceptance-lab
node scripts/build-probes.mjs
INTEROP_TLDRAW_MCP_URL=http://127.0.0.1:39512/mcp \
  node scripts/probe-local-tldraw-mcp.mjs
```

The default MCP endpoint is `http://127.0.0.1:39512/mcp`. In OpenCode it is
configured as `type: "remote"` because the OpenCode schema calls Streamable
HTTP connections `remote`; it does **not** mean that the process runs on a
remote host. The server is local-only and survives network changes. The two
deprecated Lab shims accept an explicit `INTEROP_TLDRAW_MCP_REPO_DIR`, but no
normal OpenChamber runtime path depends on a sibling checkout.
