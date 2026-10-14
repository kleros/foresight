import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chainState, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

/** How a node's refusal reaches the app: an internal JSON-RPC error, wrapped by the client. */
const nodeRefusal = (details: string) =>
  new Error("Transaction failed", {
    cause: Object.assign(new Error("Internal JSON-RPC error."), { code: -32603, details }),
  });

/** A wallet whose first send fails with `error`, and whose chain mines everything else. */
function failingGateway(error: Error): TxGateway {
  let sends = 0;
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;
  return {
    sendTransaction: (_tx: FlowTx) => {
      sends += 1;
      if (sends === 1) return Promise.reject(error);
      return Promise.resolve(`0x${sends.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

async function haltOn(error: Error): Promise<PredictProgress> {
  const driver = createPredictRun({
    gateway: failingGateway(error),
    reader: fakeReader({ deployed: true, state: () => chainState() }),
    quoter: fakeQuoter(),
    flowId: `predict-send-failure-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
  });
  drivers.push(driver);
  driver.start();
  await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
  return driver.getProgress();
}

const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

const NETWORK = message({
  stage: "halted",
  steps: [],
  skipped: [],
  batchesDone: 0,
  batches: 0,
  failure: { reason: "rpc", retryable: true },
});

describe("createPredictRun when the node refuses a send", () => {
  it("says the wallet is short of funds, not that the network is slow, and can be tried again", async () => {
    const progress = await haltOn(
      nodeRefusal(
        "Sender doesn't have enough funds to send tx. The max upfront cost is: 9950003977216234881024 and the sender's balance is: 9949997223809980566670.",
      ),
    );

    expect(progress.failure).toEqual({ reason: "funds", retryable: true });
    expect(message(progress)).not.toBe(NETWORK);
  });

  it("reads a client's insufficient-funds wording the same way", async () => {
    const progress = await haltOn(nodeRefusal("insufficient funds for gas * price + value"));

    expect(progress.failure?.reason).toBe("funds");
  });

  it("calls a send the node would revert a revert, not a slow network", async () => {
    const progress = await haltOn(
      nodeRefusal(
        "Error: VM Exception while processing transaction: reverted with custom error 'ERC20InsufficientBalance(\"0x01\", 0, 1)'",
      ),
    );

    expect(progress.failure?.reason).toBe("reverted");
    expect(message(progress)).not.toBe(NETWORK);
  });

  it("still calls an internal error that names no cause a network problem", async () => {
    const progress = await haltOn(nodeRefusal("Internal error"));

    expect(progress.failure).toEqual({ reason: "rpc", retryable: true });
  });
});
