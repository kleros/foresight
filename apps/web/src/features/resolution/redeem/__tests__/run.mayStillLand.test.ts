import type { StepSummary } from "@foresight/tx-orchestrator";
import { describe, expect, it } from "vitest";

import { mayStillLand } from "../run";

const HASH = `0x${"1".repeat(64)}` as const;
const SEND = { tx: { to: "0x00000000000000000000000000000000000000c1" }, nonce: 4, fromBlock: 9n };
const step = (stepId: string, outcome: StepSummary["outcome"]): StepSummary => ({ stepId, label: stepId, outcome });

describe("mayStillLand, which R7's store expiry and every press read", () => {
  it("counts a submitted step with no stored send, since its hash may still mine", () => {
    expect(
      mayStillLand({ snapshot: { sends: {} }, steps: [step("call:0", { status: "submitted", hash: HASH })] }),
    ).toBe(true);
  });

  it("does not count a stored send whose step was skipped, since the chain showed it landed", () => {
    expect(
      mayStillLand({ snapshot: { sends: { "call:0": SEND } }, steps: [step("call:0", { status: "skipped" })] }),
    ).toBe(false);
  });

  it("does not count a stored send whose step confirmed", () => {
    expect(
      mayStillLand({
        snapshot: { sends: { "call:0": SEND } },
        steps: [step("call:0", { status: "confirmed", hash: HASH, blockNumber: 3n })],
      }),
    ).toBe(false);
  });

  it("counts a stored send whose step has not settled", () => {
    expect(
      mayStillLand({ snapshot: { sends: { "call:0": SEND } }, steps: [step("call:0", { status: "pending" })] }),
    ).toBe(true);
  });

  it("counts a batch id whose batch step has not settled, and not one whose batch was skipped as landed", () => {
    expect(
      mayStillLand({ snapshot: { sends: {}, callsId: "0x01" }, steps: [step("batch", { status: "pending" })] }),
    ).toBe(true);
    expect(
      mayStillLand({ snapshot: { sends: {}, callsId: "0x01" }, steps: [step("batch", { status: "skipped" })] }),
    ).toBe(false);
  });
});
