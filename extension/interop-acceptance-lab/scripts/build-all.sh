#!/usr/bin/env bash
set -euo pipefail

LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRODUCT_ROOT="$(cd "${LAB_ROOT}/../.." && pwd)"

cd "${LAB_ROOT}"

node scripts/init-env.mjs
node scripts/generate-keys.mjs

set -a
source "${LAB_ROOT}/.env"
set +a

node scripts/prepare-gateway.mjs
node scripts/sign-hosted.mjs
node scripts/prepare-local.mjs

node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" validate \
  "${LAB_ROOT}/.runtime/build/local-crm-package"
LOCAL_PACKAGE="${LAB_ROOT}/.runtime/generated/interop-local-crm.ocix"
if [[ -e "${LOCAL_PACKAGE}" ]]; then
  BACKUP_PACKAGE="${LOCAL_PACKAGE%.ocix}.backup-$(date -u +%Y%m%dT%H%M%SZ).ocix"
  mv "${LOCAL_PACKAGE}" "${BACKUP_PACKAGE}"
  echo "Preserved previous Local OCIX package at ${BACKUP_PACKAGE}"
fi
node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" pack \
  "${LAB_ROOT}/.runtime/build/local-crm-package" \
  --out "${LOCAL_PACKAGE}" \
  --private-key "${LAB_ROOT}/.runtime/keys/publisher.private.pem" \
  --publisher-id com.openchamber.interop.publisher \
  --publisher-name "OpenChamber Interop Lab" \
  --key-id interop-lab-2026
node "${PRODUCT_ROOT}/scripts/interactive-ui-extension.mjs" verify \
  "${LOCAL_PACKAGE}"

node scripts/prepare-excalidraw.mjs
node scripts/build-mcp-runtime.mjs
node scripts/build-probes.mjs

echo "OpenChamber-owned acceptance artifacts are ready."
echo "Build the independent tldraw-mcp-app image before running scripts/build-images.sh."
