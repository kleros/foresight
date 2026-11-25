#!/usr/bin/env sh
# Runs the registered fork suites, or the suites named as arguments, against a plain gnosis fork node
# (`yarn local-node:contracts:gnosis-fork`). Arguments starting with `-` go to vitest.
# simulate-resolve, which the tests call, reaches the fork only at 127.0.0.1:8545.
set -e
cd "$(dirname "$0")/.."
REGISTERED_SUITES="fork.resolution fork.redeem.tradeWallet fork.redeem.connectedWallet fork.redeem.popup"
export FORK_RPC_URL="${FORK_RPC_URL:-http://127.0.0.1:8545}"

vitest="$(yarn bin vitest)"
suites=""
for arg do
  case $arg in
    -*) ;;
    *) suites="$suites $arg" ;;
  esac
done
[ -n "$suites" ] || set -- $REGISTERED_SUITES "$@"
for suite in ${suites:-$REGISTERED_SUITES}; do
  if [ -z "$(node "$vitest" list --filesOnly "$suite")" ]; then
    echo "Fork suite '$suite' matches no test file." >&2
    exit 1
  fi
done

report="$(mktemp)"
trap 'rm -f "$report"' EXIT
status=0
node --env-file=.env.gnosis-fork.example --env-file-if-exists=.env.local --env-file-if-exists=.env.gnosis-fork \
  "$vitest" run --no-file-parallelism --reporter=default --reporter=json --outputFile.json="$report" "$@" || status=$?
[ "$status" -eq 0 ] || exit "$status"
node -e '
  const [path, ...suites] = process.argv.slice(1);
  const { testResults } = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  const ran = (suite) =>
    testResults.some(
      (file) => file.name.includes(suite) && file.assertionResults.some((test) => ["passed", "failed"].includes(test.status)),
    );
  const idle = suites.filter((suite) => !ran(suite));
  if (idle.length > 0) {
    console.error(`No test ran in fork suite ${idle.join(", ")}: none collected, or every one skipped.`);
    process.exit(1);
  }
' "$report" ${suites:-$REGISTERED_SUITES}
