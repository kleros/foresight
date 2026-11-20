// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/test-fork-redeem.sh");
const RUN_TIMEOUT_MS = 120_000;

function runScript(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
  const result = spawnSync("sh", [SCRIPT, ...args], { env, encoding: "utf8", timeout: RUN_TIMEOUT_MS });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

it(
  "A8 exits non-zero before running anything when one of several named suites matches no file",
  () => {
    const { status, output } = runScript(["fork.resolution", "no-such-fork-suite-yy"]);

    expect(status).not.toBe(0);
    expect(output).toContain("no-such-fork-suite-yy");
    expect(output).not.toContain("predict.fork.resolution");
  },
  RUN_TIMEOUT_MS,
);

it(
  "A8 exits non-zero and names the suite when one named suite skips every test while another passes",
  () => {
    const { status, output } = runScript([
      "getSessionResolution.guards",
      "fork.resolution",
      "--testNamePattern=rejects a session id the factory does not hold",
    ]);

    expect(output).toContain("1 passed");
    expect(status).not.toBe(0);
    expect(output).toContain("No test ran in fork suite fork.resolution");
  },
  RUN_TIMEOUT_MS,
);
