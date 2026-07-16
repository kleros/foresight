#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBGRAPH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: $(basename "$0") <hardhatNetwork> [<hardhatNetwork> ...]" >&2
  echo "Example: $(basename "$0") localhost gnosis" >&2
  exit 1
}

resolve_deployments_dir() {
  local network="$1"
  local monorepo_dir="$SUBGRAPH_DIR/../../../packages/contracts/deployments/$network"
  local package_dirs=(
    "$SUBGRAPH_DIR/node_modules/@foresight/contracts/deployments/$network"
    "$SUBGRAPH_DIR/../../node_modules/@foresight/contracts/deployments/$network"
  )

  if [[ "$network" == "localhost" || "$network" == "hardhat" ]]; then
    if [[ -d "$monorepo_dir" ]]; then
      echo "$monorepo_dir"
      return
    fi
  fi

  for package_dir in "${package_dirs[@]}"; do
    if [[ -d "$package_dir" ]]; then
      echo "$package_dir"
      return
    fi
  done

  echo "Deployments not found in @foresight/contracts for network '$network'." >&2
  exit 1
}

sync_network() {
  local network="$1"
  if [[ ! "$network" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid network name: $network" >&2
    exit 1
  fi

  local source_dir
  source_dir="$(resolve_deployments_dir "$network")"
  local target_dir="$SUBGRAPH_DIR/abis/$network"

  echo "Syncing ABIs for $network from $source_dir"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"

  shopt -s nullglob
  local json_files=("$source_dir"/*.json)
  shopt -u nullglob

  if [[ ${#json_files[@]} -eq 0 ]]; then
    echo "No deployment artifacts found in $source_dir" >&2
    exit 1
  fi

  cp "${json_files[@]}" "$target_dir/"
}

if [[ $# -lt 1 ]]; then
  usage
fi

for network in "$@"; do
  sync_network "$network"
done
