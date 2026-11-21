// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/test-fork-redeem.sh");
const RUN_TIMEOUT_MS = 120_000;

function runProbe(env: NodeJS.ProcessEnv = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("VITEST") || key === "FORK_RPC_URL") delete childEnv[key];
  }
  const result = spawnSync("sh", [SCRIPT, "forkScriptProbe"], {
    env: { ...childEnv, FORK_SCRIPT_PROBE: "fail", ...env },
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

it(
  "A8 exits non-zero when a named suite's test fails",
  () => {
    const { status, output } = runProbe();

    expect(output).toContain("1 failed");
    expect(status).not.toBe(0);
  },
  RUN_TIMEOUT_MS,
);

it(
  "A9 hands the suites FORK_RPC_URL=http://127.0.0.1:8545 when it is unset",
  () => {
    const { output } = runProbe();

    expect(output).toContain("probe saw FORK_RPC_URL=http://127.0.0.1:8545");
  },
  RUN_TIMEOUT_MS,
);

it(
  "A9 keeps a FORK_RPC_URL the caller sets",
  () => {
    const { output } = runProbe({ FORK_RPC_URL: "http://127.0.0.1:9999" });

    expect(output).toContain("probe saw FORK_RPC_URL=http://127.0.0.1:9999");
  },
  RUN_TIMEOUT_MS,
);
