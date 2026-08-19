#!/usr/bin/env bash
# Envio Cloud installs this directory alone with pnpm - a `workspace:*` range cannot resolve.
# It also appends its own `--config` to `start`, and envio rejects the flag twice.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/../package.json"

log() { printf '[indexer/check-deployable] %s\n' "$*" >&2; }

failed=0

if grep -q '"workspace:' "$MANIFEST"; then
  log "error: package.json declares a workspace dependency:"
  grep -n '"workspace:' "$MANIFEST" >&2
  log "Envio Cloud installs this directory alone - depend on published packages, or import types only."
  failed=1
fi

if grep -E '^\s*"start":' "$MANIFEST" | grep -q -- '--config'; then
  log "error: the start script passes --config:"
  grep -nE '^\s*"start":' "$MANIFEST" >&2
  log "Envio Cloud passes its own - name the config in start:local instead."
  failed=1
fi

exit "$failed"
