import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import { TimeoutError, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import type { OptionChainState, PredictOption, SentTx } from "../../flow/types";
import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

/** What the dev wallet's send throws when the node takes longer than its 10 s to answer. */
const sendTimedOut = () =>
  new Error("An unknown RPC error occurred.", {
    cause: new TimeoutError({ body: { method: "eth_sendTransaction" }, url: "http://127.0.0.1:8545" }),
  });

/** Both of `option`'s pools at its estimate. */
const atEstimate = (each: PredictOption): OptionChainState => {
  const base = chainState();
  return chainState({
    pools: {
      up: { ...base.pools.up, sqrtPriceX96: sqrtPriceX96FromPrice(each.targetPriceWad, true) },
      down: { ...base.pools.down, sqrtPriceX96: sqrtPriceX96FromPrice(WAD - each.targetPriceWad, true) },
    },
  });
};

/**
 * A chain that mines the owner's sends in nonce order. A send in `lost` lands `lagMs` after its
 * wallet call has thrown, as a node does when the client gives up waiting for its answer.
 */
function chainWithLostAnswers(lost: { isLost: (tx: FlowTx) => boolean; lagMs: number }) {
  const mined: Array<{ hash: Hash; tx: FlowTx }> = [];
  let broadcast = 0;
  const sends: FlowTx[] = [];
  const waitedOn: Hash[] = [];

  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n, logs: [] }) as unknown as TransactionReceipt;

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      const nonce = broadcast++;
      const hash = `0x${(nonce + 1).toString(16).padStart(64, "0")}` as Hash;
      if (!lost.isLost(tx)) {
        mined[nonce] = { hash, tx };
        return Promise.resolve(hash);
      }
      setTimeout(() => (mined[nonce] = { hash, tx }), lost.lagMs);
      return Promise.reject(sendTimedOut());
    },
    waitForReceipt: ({ hash }) => {
      waitedOn.push(hash);
      return Promise.resolve(receipt(hash));
    },
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };

  const sentWithNonce = ({ nonce }: { nonce: number }): Promise<SentTx> => {
    const landed = mined[nonce];
    if (landed) {
      const { to, value = 0n, data = "0x" } = landed.tx;
      return Promise.resolve({ status: "mined", hash: landed.hash, to, value, input: data, success: true });
    }
    return Promise.resolve(nonce < broadcast ? { status: "pending" } : { status: "none" });
  };

  return {
    gateway,
    sends,
    waitedOn,
    landed: (tx: FlowTx) => mined.some((each) => each?.tx === tx),
    reader: { nextNonce: () => Promise.resolve(broadcast), sentWithNonce },
  };
}

const isBatch = (tx: FlowTx) => tx.to === addresses.executor;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** Every failure the popup was shown, in order. */
function failuresOf(driver: PredictDriver): Array<NonNullable<PredictProgress["failure"]>> {
  const seen: Array<NonNullable<PredictProgress["failure"]>> = [];
  driver.subscribe(() => {
    const failure = driver.getProgress().failure;
    if (failure && seen.at(-1) !== failure) seen.push(failure);
  });
  return seen;
}

describe("createPredictRun when the wallet never answers a send that lands", () => {
  it("completes the run from the landed batch, never reporting it failed", async () => {
    const chain = chainWithLostAnswers({ isLost: isBatch, lagMs: 20 });
    const driver = createPredictRun({
      gateway: chain.gateway,
      reader: { ...fakeReader({ deployed: true }), ...chain.reader },
      quoter: fakeQuoter(),
      flowId: "predict-lost-answer",
      ctx: () => ctx(),
      snapshot: () => snapshot(),
      unansweredSend: { waitMs: 2_000, pollMs: 5 },
    });
    drivers.push(driver);
    const failures = failuresOf(driver);

    driver.start();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

    expect(failures).toEqual([]);
    expect(driver.getProgress().stage).toBe("complete");
    const batches = chain.sends.filter(isBatch);
    expect(batches).toHaveLength(1);
    // the run waited on the landed batch's own receipt
    expect(chain.waitedOn).toHaveLength(2);
  });

  it("on Try the rest, completes from the step's own transaction rather than building it again", async () => {
    const [first, second] = [option(1), option(2)];
    let secondBatch: FlowTx | undefined;
    const chain = chainWithLostAnswers({
      isLost: (tx) => {
        if (!isBatch(tx) || chain.sends.filter(isBatch).length < 2) return false;
        secondBatch = tx;
        return true;
      },
      // lands after the run stopped waiting for it
      lagMs: 60,
    });
    const reader = {
      ...fakeReader({
        deployed: true,
        // the first batch's split hands the second option its underlying, and its own batch moves its pools
        state: (each) =>
          each !== second
            ? chainState()
            : secondBatch && chain.landed(secondBatch)
              ? atEstimate(each)
              : chainState({ underlying: WAD }),
      }),
      ...chain.reader,
    };
    const driver = createPredictRun({
      gateway: chain.gateway,
      reader,
      quoter: fakeQuoter(),
      flowId: "predict-lost-answer-retry",
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: [first, second] }),
      optionsPerBatch: 1,
      unansweredSend: { waitMs: 10, pollMs: 5 },
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.retryable).toBe(true);
    await vi.waitFor(() => expect(secondBatch && chain.landed(secondBatch)).toBe(true));

    driver.retry();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

    expect(driver.getProgress().failure).toBeUndefined();
    expect(driver.getProgress().stage).toBe("complete");
    expect(chain.sends.filter(isBatch)).toHaveLength(2);
  });

  it("on Try the rest while the unanswered send is still unmined, says so and signs nothing", async () => {
    const chain = chainWithLostAnswers({ isLost: isBatch, lagMs: 60_000 });
    const driver = createPredictRun({
      gateway: chain.gateway,
      reader: { ...fakeReader({ deployed: true }), ...chain.reader },
      quoter: fakeQuoter(),
      flowId: "predict-lost-answer-pending",
      ctx: () => ctx(),
      snapshot: () => snapshot(),
      unansweredSend: { waitMs: 10, pollMs: 5 },
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.reason).toBe("pending");

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure?.reason).toBe("pending");
    expect(chain.sends.filter(isBatch)).toHaveLength(1);
  });
});
