#!/usr/bin/env bash
set -euo pipefail

LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${LAB_ROOT}"

node .runtime/probes/probe-all.mjs "$@"
node scripts/scan-secrets.mjs --running
