#!/usr/bin/env sh
# Runs the resolution and redeem fork tests against a plain gnosis fork node (`yarn local-node:contracts:gnosis-fork`).
# simulate-resolve, which the tests call, reaches the fork only at 127.0.0.1:8545.
set -e
cd "$(dirname "$0")/.."
export FORK_RPC_URL="${FORK_RPC_URL:-http://127.0.0.1:8545}"
exec node --env-file=.env.gnosis-fork.example --env-file-if-exists=.env.local --env-file-if-exists=.env.gnosis-fork \
  "$(yarn bin vitest)" run --no-file-parallelism fork.resolution fork.redeem "$@"
