// @vitest-environment node
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `apps/web/scripts/test-fork-redeem.sh [suite ...] [--vitest-flag=value ...]`
 *   Runs the fork suites it registers (the resolution one, `fork.resolution`) on a plain gnosis fork node.
 *   Arguments not starting with `-` name the suites to run instead of the registered ones; arguments starting
 *   with `-` go to vitest. It exits non-zero when a named suite matches no file, when no test is collected, or
 *   when every collected test is skipped. FORK_RPC_URL defaults to http://127.0.0.1:8545.
 */
const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/test-fork-redeem.sh");
const RUN_TIMEOUT_MS = 120_000;

function runScript(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key === "FORK_RPC_URL") delete env[key];
  }
  const result = spawnSync("sh", [SCRIPT, ...args], { env, encoding: "utf8", timeout: RUN_TIMEOUT_MS });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const nodeOn8545 = await new Promise<boolean>((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port: 8545 });
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});

describe("the resolution fork script's run guards", () => {
  it(
    "A8 exits non-zero and names the suite when a named suite matches no file, without running the others",
    () => {
      const { status, output } = runScript(["no-such-fork-suite-zz"]);

      expect(status).not.toBe(0);
      expect(output).toContain("no-such-fork-suite-zz");
      expect(output).not.toContain("predict.fork.resolution");
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A8 exits non-zero when every collected test is skipped",
    () => {
      const { status } = runScript(["--testNamePattern=no test is called this zz"]);

      expect(status).not.toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A8 exits non-zero when a named suite is given alongside a skip-everything filter",
    () => {
      const { status } = runScript(["fork.resolution", "--testNamePattern=no test is called this zz"]);

      expect(status).not.toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A9 runs the resolution suite against 127.0.0.1:8545 when FORK_RPC_URL is unset, failing with no node there",
    () => {
      if (nodeOn8545) throw new Error("A node listens on 127.0.0.1:8545; stop it before running this test.");
      const { status, output } = runScript([]);

      expect(status).not.toBe(0);
      expect(output).toContain("predict.fork.resolution");
      expect(output).toContain("127.0.0.1:8545");
    },
    RUN_TIMEOUT_MS,
  );
});
