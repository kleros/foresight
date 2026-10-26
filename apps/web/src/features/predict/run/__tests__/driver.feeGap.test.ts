import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SwapQuoter } from "@/lib/swap/types";

import {
  addresses,
  chainState,
  ctx,
  fakeReader,
  option,
  poolQuoter,
  snapshot,
} from "../../flow/__tests__/support/fakes";
import type { HeldTo } from "../../flow/types";
import { previewTrades } from "../../utils/plan";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const OPTION = option(1);
const SNAP = snapshot({ options: [OPTION] });

/**
 * Pays `gapBps` less than the pool maths on every leg, as Lens does when the next swap's fee is above the fee the
 * pool stores, which the pool maths read.
 */
function feeGapQuoter(gapBps: bigint): SwapQuoter {
  const pool = poolQuoter([OPTION]);
  return {
    quote: async (request) => {
      const quote = await pool.quote(request);
      return { ...quote, amountOut: (quote.amountOut * (10_000n - gapBps)) / 10_000n };
    },
  };
}

/** The plan Details shows from the pools as read, which is what Predict holds the run to. */
const shown = (): HeldTo => {
  const state = chainState();
  const plan = previewTrades(
    { pools: state.pools, targetPriceWad: OPTION.targetPriceWad, held: state.held, splitAmount: SNAP.collateralIn },
    SNAP.slippage.tradeBps,
  )!;
  return { plans: { [OPTION.childMarket.toLowerCase()]: plan } };
};

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("createPredictRun when every quote pays a fee the pools as read do not", () => {
  it("goes on from one Confirm at moved, held to the quotes it showed", async () => {
    const sends: FlowTx[] = [];
    const gateway: TxGateway = {
      sendTransaction: (tx) => {
        sends.push(tx);
        return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
      },
      waitForReceipt: ({ hash }) =>
        Promise.resolve({
          transactionHash: hash,
          status: "success",
          blockNumber: 2n,
          logs: [],
        } as unknown as TransactionReceipt),
      getReceipt: () => Promise.resolve(null),
      isKnown: () => Promise.resolve(true),
    };
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true }),
      quoter: feeGapQuoter(150n),
      flowId: "fee-gap",
      ctx: () => ctx(),
      snapshot: () => SNAP,
    });
    drivers.push(driver);

    driver.start(shown());
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
    expect(sends).toEqual([]);

    driver.confirm();
    await vi.waitFor(() => expect(["moved", "halted", "complete"]).toContain(driver.getProgress().stage));

    expect(driver.getProgress().stage).toBe("complete");
    expect(sends.filter((tx) => tx.to === addresses.executor)).toHaveLength(1);
  });
});
