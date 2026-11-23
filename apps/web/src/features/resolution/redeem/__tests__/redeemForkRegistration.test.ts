// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT = path.join(WEB_ROOT, "scripts/test-fork-redeem.sh");
const REDEEM_SUITE_FILE = "predict.fork.redeem.tradeWallet.test.ts";
const RESOLUTION_SUITE_FILE = "predict.fork.resolution.test.ts";
const FORK_RUN_TIMEOUT_MS = 1_800_000;

function registeredSuites(): string[] {
  const match = readFileSync(SCRIPT, "utf8").match(/^REGISTERED_SUITES="([^"]*)"/m);
  if (!match) throw new Error("The fork script declares no REGISTERED_SUITES.");
  return match[1]!.split(/\s+/).filter(Boolean);
}

/** Test files under `src`, relative to the web root; a vitest filter selects the paths that contain it. */
const testFiles = readdirSync(path.join(WEB_ROOT, "src"), { recursive: true, encoding: "utf8" })
  .filter((file) => /\.test\.tsx?$/.test(file))
  .map((file) => path.join("src", file));

const selects = (suite: string, file: string) => testFiles.some((each) => each.includes(suite) && each.endsWith(file));

describe("A9 the fork script's registered suites", () => {
  it("include one that selects this issue's trade wallet redeem fork suite", () => {
    expect(registeredSuites().some((suite) => selects(suite, REDEEM_SUITE_FILE))).toBe(true);
  });

  it("still include one that selects the resolution fork suite", () => {
    expect(registeredSuites().some((suite) => selects(suite, RESOLUTION_SUITE_FILE))).toBe(true);
  });
});

describe.skipIf(!process.env.FORK_RPC_URL)("A9 the fork script on a plain gnosis fork node", () => {
  it(
    "runs the registered suites and lists the trade wallet redeem suite with tests passed",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
      const result = spawnSync("sh", [SCRIPT], { env, encoding: "utf8", timeout: FORK_RUN_TIMEOUT_MS });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(0);
      expect(output).toContain(REDEEM_SUITE_FILE);
      expect(output).toMatch(/Tests\s+\d+ passed/);
    },
    FORK_RUN_TIMEOUT_MS,
  );
});
