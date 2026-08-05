# Interop Acceptance Lab Runbook

Run commands from this directory unless a command says otherwise.

## 1. Prerequisites

- Node.js 22
- Bun (used only to bundle prepared MCP/probe sources)
- Docker Engine with Compose (full lab only; not required by local tldraw mode)
- OpenChamber repository dependencies already available for the OCIX packer
- Network access for first-time pinned asset acquisition and the official
  Excalidraw remote. The independently built `tldraw-mcp-app` distribution does
  not fetch App assets at runtime.

The runtime ceiling is 512 MiB. Builds are intentionally sequential. A first
tldraw monorepo dependency bootstrap is not safe on a 512 MiB builder and is
fail-closed by default.

## Local loopback tldraw MCP

Use this mode when the shared server, tunnel, or wider network is unavailable,
or when diagnosing the MCP 2026/AppBridge path without the rest of the Compose
stack. The service is built and managed by the independent `tldraw-mcp-app`
repository. OpenChamber connects to it only through Streamable HTTP. Do not
start Docker for this path.

### Prepare the verified runtime

In the `tldraw-mcp-app` checkout, verify the checked-in release artifacts before
starting them. Regenerate the official tldraw bundle only on a builder with
adequate memory, and run every heavy step sequentially:

```bash
cd /path/to/tldraw-mcp-app
npm run verify:dist
npm test
```

The independent repository's build produces a single offline App resource with
all official tldraw v5.0.2 JS/CSS, 162 icons, 19 embed icons, 16 fonts, and one
translation bundled locally. Its manager verifies the source commit,
provenance, asset counts, and final HTML SHA-256 before it starts. OpenChamber's
Lab build does not regenerate or copy that implementation.

### Start, inspect, probe, and stop

```bash
cd /path/to/tldraw-mcp-app
npm run start
npm run status
npm run probe
npm run stop
```

Defaults:

- health: `http://127.0.0.1:39512/health`
- MCP 2026 Streamable HTTP: `http://127.0.0.1:39512/mcp`
- state and lifecycle files: the independent repository's private `.runtime/`
- server heap ceiling: 56 MiB

The manager binds loopback only, writes lifecycle files with private modes,
validates endpoint identity, rejects port collisions, and only signals a PID
whose command still contains the exact managed server bundle path. Canvas state
is kept beside that manager's lifecycle metadata; stopping and starting the
service does not discard it.

Override the port, endpoint used by the probe, or local state directory only
when isolation is required:

```bash
cd /path/to/tldraw-mcp-app
TLDRAW_MCP_PORT=39513 \
  TLDRAW_MCP_RUNTIME_DIR=/tmp/oc-tldraw-runtime \
  npm run start

TLDRAW_MCP_URL=http://127.0.0.1:39513/mcp npm run probe
```

The probe is a protocol gate, not a health-only check. It proves strict
`2026-07-28` negotiation, the MCP Apps extension, resource MIME and digest,
model/App versus App-only visibility, an isolated operation/save round trip,
stable canvas identity, revision advancement, and an SVG export receipt.

OpenChamber keeps a separate consumer probe to ensure its pinned MCP client can
consume the independent service:

```bash
cd /path/to/openchamber/extension/interop-acceptance-lab
node scripts/build-probes.mjs
INTEROP_TLDRAW_MCP_URL=http://127.0.0.1:39512/mcp \
  node scripts/probe-local-tldraw-mcp.mjs
```

### Configure OpenCode/OpenChamber

Add the following entry beneath `mcp` in the resolved OpenCode configuration
(normally `~/.config/opencode/opencode.json`), then reload OpenCode or restart
the OpenChamber session:

```json
{
  "mcp": {
    "interop-tldraw-2026": {
      "type": "remote",
      "url": "http://127.0.0.1:39512/mcp",
      "oauth": false,
      "timeout": 30000,
      "enabled": true
    }
  }
}
```

OpenCode uses `type: "remote"` to mean the Streamable HTTP transport. The URL
above is still a local loopback process; this setting does not depend on or
contact a remote machine.

Before treating a blank App, text fallback, or missing App-only call as a
tldraw defect, verify which OpenCode binary OpenChamber actually launched and
inspect its `/global/capabilities` and MCP connection state. An older official
CLI, an externally overridden CLI, or a stale fork can connect to the tool yet
omit MCP Apps capability negotiation, producing the same symptom as a broken
App resource.

Also inspect the CLI log for an App resource size rejection. The verified
tldraw v5.0.2 offline HTML is `4,372,695` bytes: it exceeds the former 4 MiB
OpenCode limit and therefore requires the current fork's bounded 8 MiB limit.
A successful direct `resources/read` probe does not prove that an older CLI
accepted the resource into its App registry.

For product-level acceptance, do not stop at this protocol probe. In a real
OpenChamber conversation, verify the compact preview, **Edit** fullscreen mode,
Add note, Save without changing `canvasId`, export status, App Board pin and
full-tile workbench layout, and history/session restoration.

## 2. Initialize local-only state

```bash
node scripts/init-env.mjs
node scripts/generate-keys.mjs
set -a
source .env
set +a
```

`init-env.mjs` generates random API keys, a random `PUBLIC_GATE_PATH`, and
Docker secret files under `.runtime/secrets/`. Compose passes only `_FILE`
paths; API-key values do not appear in container environment metadata.

If a temporary public endpoint is exposed or a new acceptance round begins,
rotate only the gate and reset the URL to loopback without changing API keys:

```bash
node scripts/init-env.mjs --rotate-public-endpoint
```

For loopback development, keep:

```text
PUBLIC_BASE_URL=http://127.0.0.1:9510
```

## 3. Prepare artifacts sequentially

Build and verify the `tldraw-mcp-app` release or container in its independent
repository first. For this Lab's Compose path, export its immutable image name:

```bash
export INTEROP_TLDRAW_MCP_IMAGE=tldraw-mcp-app:local
```

The Lab refuses to build an in-tree substitute. It accepts an existing local
image or pulls an explicitly configured remote image/digest.

Then prepare the OpenChamber-owned fixtures in the required sequence:

```bash
./scripts/build-all.sh
```

This performs, sequentially:

1. environment and Docker-secret preparation;
2. publisher key generation;
3. random-path gateway rendering;
4. Hosted OCIX signing for root, `1.0.0`, `1.0.1`, `1.1.0`, and `tampered`;
5. tunnel-aware Local CRM staging, validation, signing, and verification;
6. official Excalidraw release verification/extraction;
7. Legacy MCP preparation;
8. consumer probe bundle preparation.

The subsequent `scripts/build-images.sh` call verifies that the independently
built tldraw image is available before Compose is allowed to start.

No Dockerfile runs npm, Yarn, Bun, or a source build. Dockerfiles only copy
prepared, provenance-checked inputs.

## 4. Build images and start loopback deployment

```bash
./scripts/build-images.sh
docker compose up -d --no-build
docker compose ps
```

Only `127.0.0.1:9510` is published. Check:

```bash
curl --fail http://127.0.0.1:9510/health
```

## 5. Run acceptance probes

```bash
./scripts/probe-all.sh --restart-persistence
```

The optional restart flag deliberately restarts only
`oc-tldraw-mcp-2026` and proves that the same canvas, revision, snapshot, and
save receipt recover from `oc-interop-tldraw-state`.

The probe covers:

- Hosted and Local `/api/v1/...` GET/POST/PATCH routes;
- bearer 401, read-only 403, revision conflicts, invalid request JSON, oversized
  request, timeout, invalid JSON response, and response larger than the product
  2 MiB upstream ceiling;
- root and versioned Hosted signatures/resources, equivalent patch
  permissions, expanded minor permissions, and the signed-but-tampered resource;
- both official Legacy transports, disconnect, and a new SSE session;
- self-hosted official Excalidraw `create_view`, its real MCP App resource, and
  official-remote `create_view`;
- strict MCP discovery, `2026-07-28`, the UI extension capability, exact tldraw
  visibility, canvas isolation, operations, save/export receipts, legacy
  rejection, and text-only fallback without Apps capability.

Evidence is written with mode `0600` under `evidence/`. After protocol probing,
the separate unified scanner checks source, evidence, `docker compose config`,
and running-container inspect metadata for the actual generated credential
values.

## 6. Switch the stable Hosted OCIX release

The thin package always points to the stable public manifest URL:

```text
<PUBLIC_BASE_URL>/hosted/ops/openchamber.hosted.json
```

The manifest and its root `/hosted/ops/resources/*` URLs are served from one
internally selected release channel. Release administration has no HTTP route
and is not forwarded by the public gateway. Switch it only through a local
Compose administration command:

```bash
docker compose exec -T -u node hosted-ocix node /app/release-admin.mjs status
docker compose exec -T -u node hosted-ocix node /app/release-admin.mjs set 1.0.1
docker compose exec -T -u node hosted-ocix node /app/release-admin.mjs set 1.1.0
docker compose exec -T -u node hosted-ocix node /app/release-admin.mjs set tampered
docker compose exec -T -u node hosted-ocix node /app/release-admin.mjs set 1.0.0
```

The allowed slots are:

- `1.0.0`: default baseline;
- `1.0.1`: changed signed resource with equivalent permissions;
- `1.1.0`: expanded permission fixture that requires confirmation;
- `tampered`: valid signed manifest whose selected resource was changed after
  signing and must be rejected.

The command validates that the complete selected channel exists before it
atomically replaces `/data/active-release.json` with mode `0600`. The scoped
`oc-interop-hosted-ocix-state` volume preserves the selection across a
`hosted-ocix` container restart. A missing state file defaults to `1.0.0`; a
malformed state fails closed instead of silently selecting another release.
`GET /health/hosted-ocix` reports only the active slot, version, and whether the
selection is persisted. It never reports credentials or the state-file path.

Verify the local state contract without building an image:

```bash
node --test services/ocix/release-state.test.mjs
```

## 7. Start a quick tunnel, capture its random-path URL, and re-sign

Start only the optional tunnel service:

```bash
docker compose --profile tunnel up -d tunnel
node scripts/capture-tunnel-url.mjs
set -a
source .env
set +a
```

For automation that must not print the gated URL, use a protected file:

```bash
node scripts/capture-tunnel-url.mjs --quiet \
  --output-file /tmp/interop-public-base-url.txt
```

The captured value is:

```text
https://<ephemeral>.trycloudflare.com/<PUBLIC_GATE_PATH>
```

The unprefixed MCP/API routes return 404 for non-local Host headers. Signed
Hosted static resources may remain public, while business APIs additionally
require their own bearer keys. MCP access logs are disabled.

The tunnel URL is part of both OCIX connector/resource URLs, so re-render,
re-sign all four Hosted release fixtures, and repackage Local CRM:

```bash
node scripts/prepare-gateway.mjs
node scripts/sign-hosted.mjs
node scripts/prepare-local.mjs

PRODUCT_ROOT="$(cd ../.. && pwd)"
node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" validate \
  .runtime/build/local-crm-package
if [[ -e .runtime/generated/interop-local-crm.ocix ]]; then
  mv .runtime/generated/interop-local-crm.ocix \
    ".runtime/generated/interop-local-crm.backup-$(date -u +%Y%m%dT%H%M%SZ).ocix"
fi
node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" pack \
  .runtime/build/local-crm-package \
  --out .runtime/generated/interop-local-crm.ocix \
  --private-key .runtime/keys/publisher.private.pem \
  --publisher-id com.openchamber.interop.publisher \
  --publisher-name "OpenChamber Interop Lab" \
  --key-id interop-lab-2026
node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" verify \
  .runtime/generated/interop-local-crm.ocix
```

Rebuild/restart only the Hosted asset image, then probe through the tunnel:

```bash
docker compose build hosted-ocix
docker compose up -d --no-deps hosted-ocix
INTEROP_BASE_URL="${PUBLIC_BASE_URL}" ./scripts/probe-all.sh --tunnel
```

Install these two packages in OpenChamber and configure their Business
connections with the corresponding full-access or read-only lab key:

- `.runtime/generated/hosted-ops/remote-ops.ocix`
- `.runtime/generated/interop-local-crm.ocix`

The Local package must be repacked after the tunnel URL changes. Its connector
uses tunnel HTTPS `/api/v1/...`; loopback is an explicit development mode only.

## 8. Roll back only this lab

Stop this Compose project without touching OpenChamber or other Docker projects:

```bash
docker compose --profile tunnel down
```

This intentionally preserves `oc-interop-tldraw-state`. Do not add `--volumes`
unless the acceptance canvas is intentionally being discarded.

To return from tunnel packaging to loopback development, set
`PUBLIC_BASE_URL=http://127.0.0.1:9510`, source `.env`, and repeat the Hosted
signing and Local staging/pack steps.

## Known boundaries

- Ops and CRM are deterministic lab APIs, not external vendors.
- The official Excalidraw remote probe requires live Internet access and fails
  when it is unreachable.
- Excalidraw self-hosting uses the official v0.3.2 release asset. The wrapper
  only adds health/provenance and forwarding.
- tldraw has no official MCP server artifact for this contract. The App is a
  real official-source v5.0.2 editor; the strict MCP server is owned and
  released by the independent `tldraw-mcp-app` repository.
- A clean tldraw dependency bootstrap remains unsuitable for a 512 MiB builder.
  Build it sequentially on a larger machine, publish the verified distribution
  or image, and let this Lab consume that immutable result.
- Quick-tunnel hostnames are ephemeral; every change requires Hosted re-signing
  and Local repackaging.
