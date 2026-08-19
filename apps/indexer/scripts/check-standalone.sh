#!/usr/bin/env bash
# Envio Cloud installs this directory alone with pnpm - a `workspace:*` range cannot resolve.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/../package.json"

if grep -q '"workspace:' "$MANIFEST"; then
  echo "[indexer/check-standalone] error: package.json declares a workspace dependency:" >&2
  grep -n '"workspace:' "$MANIFEST" >&2
  echo "[indexer/check-standalone] Envio Cloud installs this directory alone: depend on published packages, or import types only." >&2
  exit 1
fi
