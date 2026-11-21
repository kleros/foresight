// @vitest-environment node
import { it } from "vitest";

/** A suite for forkScriptRun.test.ts to hand test-fork-redeem.sh; skipped unless FORK_SCRIPT_PROBE=fail. */
it.runIf(process.env.FORK_SCRIPT_PROBE === "fail")("fails, naming the fork RPC URL it was given", () => {
  throw new Error(`probe saw FORK_RPC_URL=${process.env.FORK_RPC_URL}`);
});
