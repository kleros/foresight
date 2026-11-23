// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/test-fork-redeem.sh");
const REDEEM_SUITE = "fork.redeem.tradeWallet";
const RUN_TIMEOUT_MS = 120_000;

it(
  "A9 exits non-zero and names the trade wallet redeem suite when it runs no test",
  () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
    const result = spawnSync("sh", [SCRIPT, REDEEM_SUITE, "--testNamePattern=no test is called this zz"], {
      env,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(`No test ran in fork suite ${REDEEM_SUITE}`);
  },
  RUN_TIMEOUT_MS,
);
