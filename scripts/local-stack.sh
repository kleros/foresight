#!/usr/bin/env bash
# Local stack: hardhat node + envio indexer + web, in one tmux session.
#
#   yarn local-stack        fresh stack (wipes local deployments + indexed data)
#   yarn stop-local-stack   kill tmux session, envio's docker stack and hardhat
#
# start always starts from scratch: a new hardhat chain invalidates anything the
# indexer already indexed, so both are reset together.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="foresight"
DEPLOYMENTS="$ROOT/packages/contracts/deployments/localhost"
DEPLOY_MARKER="$DEPLOYMENTS/SessionFactory.json"
RPC_URL="http://127.0.0.1:8545"
HASURA_URL="http://127.0.0.1:8080"
INDEXER_URL="http://127.0.0.1:${ENVIO_INDEXER_PORT:-9898}"
MOCK_ATLAS_PORT="${MOCK_ATLAS_PORT:-4747}"
MOCK_ATLAS_URL="http://127.0.0.1:${MOCK_ATLAS_PORT}"
TIMEOUT="${LOCAL_STACK_TIMEOUT:-300}"

log() { printf '[local-stack] %s\n' "$*"; }
die() {
  log "error: $*"
  exit 1
}

require_tools() {
  local tool
  for tool in docker tmux curl jq yq lsof; do
    command -v "$tool" >/dev/null || die "$tool not installed"
  done
  docker info >/dev/null 2>&1 || die "docker is not running"
}

rpc_listener_pids() { lsof -tiTCP:8545 -sTCP:LISTEN 2>/dev/null || true; }
mock_atlas_listener_pids() { lsof -tiTCP:"$MOCK_ATLAS_PORT" -sTCP:LISTEN 2>/dev/null || true; }

wait_for() {
  local name="$1" deadline=$(($(date +%s) + TIMEOUT))
  shift
  log "waiting for ${name}…"
  until "$@"; do
    (($(date +%s) < deadline)) || die "timed out waiting for $name"
    sleep 2
  done
  log "✓ $name"
}

rpc_ready() {
  curl -sf -X POST "$RPC_URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' |
    grep -q '"result"'
}

deploy_ready() { [[ -f "$DEPLOY_MARKER" ]]; }

indexer_synced() {
  curl -sf "$INDEXER_URL/metrics" | grep -q '^envio_progress_ready{[^}]*} 1$'
}

hasura_ready() { curl -sf "$HASURA_URL/healthz" >/dev/null; }

indexer_ready() { hasura_ready && indexer_synced; }

mock_atlas_ready() { curl -sf "$MOCK_ATLAS_URL/healthz" >/dev/null; }

# `envio stop` deletes the database and stops the containers for apps/indexer
indexer_down() { yarn workspace foresight-indexer stop >/dev/null 2>&1 || true; }

cmd_stop() {
  log "stopping local stack"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  indexer_down
  local pids
  pids="$(rpc_listener_pids)"
  if [[ -n "$pids" ]]; then
    log "stopping hardhat on :8545 (pid $(tr '\n' ' ' <<<"$pids"))"
    # shellcheck disable=SC2086 # deliberate word split: one pid per line
    kill $pids 2>/dev/null || true
  fi
  pids="$(mock_atlas_listener_pids)"
  if [[ -n "$pids" ]]; then
    log "stopping mock-atlas on :$MOCK_ATLAS_PORT (pid $(tr '\n' ' ' <<<"$pids"))"
    # shellcheck disable=SC2086 # deliberate word split: one pid per line
    kill $pids 2>/dev/null || true
  fi
  log "stopped"
}

cmd_start() {
  require_tools
  cd "$ROOT"

  [[ -z "$(rpc_listener_pids)" ]] || die ":8545 is already in use, run 'yarn stop-local-stack' first"
  [[ -z "$(mock_atlas_listener_pids)" ]] || die ":$MOCK_ATLAS_PORT is already in use, run 'yarn stop-local-stack' first"

  log "resetting indexed data and localhost deployments"
  indexer_down
  rm -rf "$DEPLOYMENTS"

  log "starting hardhat + indexer in tmux session '$SESSION'"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # commands are passed as pane argv, never send-keys: send-keys types into the
  # pane's shell and silently loses characters if the shell is still starting up.
  # hardhat node deploys SessionFactory itself on boot (--tags SessionFactory).
  tmux new-session -d -s "$SESSION" -n stack -c "$ROOT" "yarn local-node:contracts"
  tmux set-option -t "$SESSION" remain-on-exit on # keep a crashed pane's output readable
  tmux set-option -t "$SESSION" pane-border-status top
  tmux set-option -t "$SESSION" pane-border-format ' #{pane_title} '
  tmux select-pane -t "$SESSION:0.0" -T "HARDHAT"

  # mock atlas (auth + ipfs) is independent of the chain; web pushes files to it and
  # the indexer reads them back, so it must be up before either of those.
  local mock_pane
  mock_pane="$(tmux split-window -t "$SESSION:0.0" -v -c "$ROOT" -P -F '#{pane_id}' "MOCK_ATLAS_PORT=$MOCK_ATLAS_PORT yarn workspace @foresight/mock-atlas start")"
  tmux select-pane -t "$mock_pane" -T "MOCK-ATLAS"

  wait_for "hardhat RPC" rpc_ready
  wait_for "mock-atlas ($MOCK_ATLAS_URL)" mock_atlas_ready
  wait_for "localhost deployments" deploy_ready

  log "generating wagmi bindings"
  yarn workspace @foresight/contracts codegen:localhost

  # config.yaml is generated, so the indexer follows whatever address this chain just
  # deployed rather than a constant that silently rots. Naming the network rather than
  # updating every chain means a missing local artifact fails here instead of quietly
  # leaving a placeholder in the config.
  log "wiring indexer config to the local deployment"
  yarn indexer:update:local

  # the indexer only starts once the chain is up, since it reads the address and start
  # block from the deployment above. `--restart` clears what the previous chain left.
  local indexer_pane
  indexer_pane="$(tmux split-window -t "$SESSION:0.0" -h -c "$ROOT" -P -F '#{pane_id}' "ENVIO_IPFS_GATEWAY=$MOCK_ATLAS_URL/ipfs yarn indexer:dev --restart")"
  tmux select-pane -t "$indexer_pane" -T "INDEXER"

  wait_for "indexer (hasura → :8080)" indexer_ready

  log "starting web"
  local web_pane
  web_pane="$(tmux split-window -t "$indexer_pane" -v -c "$ROOT" -P -F '#{pane_id}' "NEXT_PUBLIC_ATLAS_URI=$MOCK_ATLAS_URL yarn dev")"
  tmux select-pane -t "$web_pane" -T "WEB"

  log "web http://localhost:3000  |  graphql $HASURA_URL/v1/graphql (console password 'testing')  |  mock-atlas $MOCK_ATLAS_URL"
  log "detach: Ctrl+b d  |  stop: yarn stop-local-stack"
  if [[ ! -t 1 ]]; then
    log "not a terminal, attach with: tmux attach -t $SESSION"
  elif [[ -n "${TMUX:-}" ]]; then
    tmux switch-client -t "$SESSION"
  else
    exec tmux attach-session -t "$SESSION"
  fi
}

case "${1:-start}" in
start) cmd_start ;;
stop) cmd_stop ;;
*) die "usage: $(basename "$0") [start|stop]" ;;
esac
