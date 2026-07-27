#!/usr/bin/env bash
# Local stack: hardhat node + graph-node + subgraph + web, in one tmux session.
#
#   yarn local-stack        fresh stack (wipes local deployments + graph data)
#   yarn stop-local-stack   kill tmux session, docker stack and hardhat
#
# start always starts from scratch: a new hardhat chain invalidates anything
# graph-node already indexed, so both are reset together.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="foresight"
COMPOSE_FILE="$ROOT/apps/graph-node/docker-compose.yml"
GRAPH_DATA="$ROOT/apps/graph-node/data"
DEPLOYMENTS="$ROOT/packages/contracts/deployments/localhost"
DEPLOY_MARKER="$DEPLOYMENTS/SessionFactory.json"
RPC_URL="http://127.0.0.1:8545"
GRAPH_INDEX_URL="http://127.0.0.1:8030/graphql"
GRAPH_NETWORK="mainnet" # graph-node's alias for the hardhat chain, see docker-compose.yml
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

# graph-node is up *and* talking to the hardhat chain
graph_ready() {
  curl -sf -X POST "$GRAPH_INDEX_URL" -H 'Content-Type: application/json' \
    -d "{\"query\":\"{ blockHashFromNumber(network: \\\"$GRAPH_NETWORK\\\", blockNumber: 0) }\"}" |
    jq -e '.data.blockHashFromNumber != null' >/dev/null
}

cmd_stop() {
  log "stopping local stack"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
  local pids
  pids="$(rpc_listener_pids)"
  if [[ -n "$pids" ]]; then
    log "stopping hardhat on :8545 (pid $(tr '\n' ' ' <<<"$pids"))"
    # shellcheck disable=SC2086 # deliberate word split: one pid per line
    kill $pids 2>/dev/null || true
  fi
  log "stopped"
}

cmd_start() {
  require_tools
  cd "$ROOT"

  [[ -z "$(rpc_listener_pids)" ]] || die ":8545 is already in use, run 'yarn stop-local-stack' first"

  log "resetting graph-node data and localhost deployments"
  docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
  rm -rf "$GRAPH_DATA" "$DEPLOYMENTS" || die "could not wipe $GRAPH_DATA (owned by docker?)"

  log "starting hardhat + graph-node in tmux session '$SESSION'"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # commands are passed as pane argv, never send-keys: send-keys types into the
  # pane's shell and silently loses characters if the shell is still starting up.
  # hardhat node deploys SessionFactory itself on boot (--tags SessionFactory).
  tmux new-session -d -s "$SESSION" -n stack -c "$ROOT" "yarn local-node:contracts"
  tmux set-option -t "$SESSION" remain-on-exit on # keep a crashed pane's output readable
  tmux set-option -t "$SESSION" pane-border-status top
  tmux set-option -t "$SESSION" pane-border-format ' #{pane_title} '
  tmux select-pane -t "$SESSION:0.0" -T "HARDHAT"

  local graph_pane
  graph_pane="$(tmux split-window -t "$SESSION:0.0" -h -c "$ROOT" -P -F '#{pane_id}' "docker compose -f '$COMPOSE_FILE' up")"
  tmux select-pane -t "$graph_pane" -T "GRAPH NODE"

  wait_for "hardhat RPC" rpc_ready
  wait_for "localhost deployments" deploy_ready

  log "generating wagmi bindings"
  yarn workspace @foresight/contracts codegen:localhost

  wait_for "graph-node ($GRAPH_NETWORK → :8545)" graph_ready

  log "deploying subgraph"
  yarn deploy:subgraph

  log "starting web"
  local web_pane
  web_pane="$(tmux split-window -t "$graph_pane" -v -c "$ROOT" -P -F '#{pane_id}' "yarn dev")"
  tmux select-pane -t "$web_pane" -T "WEB"

  log "web http://localhost:3000  |  subgraph http://localhost:8000/subgraphs/name/foresight"
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
