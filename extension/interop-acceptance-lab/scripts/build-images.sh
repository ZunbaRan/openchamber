#!/usr/bin/env bash
set -euo pipefail

LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${LAB_ROOT}"

export COMPOSE_PARALLEL_LIMIT=1

docker compose build hosted-ocix
docker compose build legacy-mcp-http
docker compose build excalidraw

TLDRAW_IMAGE="${INTEROP_TLDRAW_MCP_IMAGE:-tldraw-mcp-app:local}"
if ! docker image inspect "${TLDRAW_IMAGE}" >/dev/null 2>&1; then
  if [[ "${TLDRAW_IMAGE}" == *"/"* || "${TLDRAW_IMAGE}" == *@sha256:* ]]; then
    docker pull "${TLDRAW_IMAGE}"
  else
    echo "Missing independent tldraw MCP image: ${TLDRAW_IMAGE}" >&2
    echo "Build it in the tldraw-mcp-app repository or set INTEROP_TLDRAW_MCP_IMAGE." >&2
    exit 1
  fi
fi

echo "OpenChamber images built and the independent tldraw MCP image verified."
echo "Start with: docker compose up -d --no-build"
