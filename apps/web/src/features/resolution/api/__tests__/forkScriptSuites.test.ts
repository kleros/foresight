// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/test-fork-redeem.sh");
const RUN_TIMEOUT_MS = 120_000;

it(
  "A8 exits non-zero before running anything when one of several named suites matches no file",
  () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
    const result = spawnSync("sh", [SCRIPT, "fork.resolution", "no-such-fork-suite-yy"], {
      env,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain("no-such-fork-suite-yy");
    expect(output).not.toContain("predict.fork.resolution");
  },
  RUN_TIMEOUT_MS,
);
