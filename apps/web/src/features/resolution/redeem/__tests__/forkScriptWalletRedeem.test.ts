// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

/**
 * `apps/web/scripts/test-fork-redeem.sh` runs the fork suites it registers in `REGISTERED_SUITES` (space-separated
 * vitest filters) on a plain gnosis fork node. This issue's suite is `predict.fork.redeem.connectedWallet.test.ts`.
 */
const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT = path.join(WEB_ROOT, "scripts/test-fork-redeem.sh");
const RUN_TIMEOUT_MS = 120_000;

function registeredSuites(): string[] {
  const match = readFileSync(SCRIPT, "utf8").match(/^REGISTERED_SUITES="([^"]*)"/m);
  if (!match) throw new Error("The fork script declares no REGISTERED_SUITES.");
  return match[1]!.split(/\s+/).filter(Boolean);
}

function filesOf(suite: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
  const vitest = spawnSync("yarn", ["bin", "vitest"], { cwd: WEB_ROOT, env, encoding: "utf8" }).stdout.trim();
  return spawnSync("node", [vitest, "list", "--filesOnly", suite], {
    cwd: WEB_ROOT,
    env,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
  }).stdout;
}

it(
  "A6 registers this issue's connected wallet redeem fork suite in the fork script",
  () => {
    const files = registeredSuites().map(filesOf).join("\n");

    expect(files).toContain("predict.fork.redeem.connectedWallet.test.ts");
  },
  RUN_TIMEOUT_MS,
);

it(
  "A6 keeps the resolution and trade wallet redeem fork suites registered beside it",
  () => {
    const files = registeredSuites().map(filesOf).join("\n");

    expect(files).toContain("predict.fork.resolution.test.ts");
    expect(files).toContain("predict.fork.redeem.tradeWallet.test.ts");
  },
  RUN_TIMEOUT_MS,
);
