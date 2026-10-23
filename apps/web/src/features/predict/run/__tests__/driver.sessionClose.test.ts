import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const CLOSES_AT = 1_800_000_000;

/** A chain whose clock is `clock.now`, in seconds; every send mines. */
function chainAt(clock: { now: number }) {
  const sends: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const reader = { ...fakeReader({ deployed: true }), latestTimestamp: () => Promise.resolve(BigInt(clock.now)) };
  return { gateway, reader, sends };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function driverOn(chain: ReturnType<typeof chainAt>) {
  const driver = createPredictRun({
    gateway: chain.gateway,
    reader: chain.reader,
    quoter: fakeQuoter(),
    flowId: `predict-close-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    closesAt: CLOSES_AT,
  });
  drivers.push(driver);
  return driver;
}

describe("createPredictRun at the session's close", () => {
  it("signs nothing when the chain's clock has passed the close as Predict is pressed", async () => {
    const chain = chainAt({ now: CLOSES_AT });
    const driver = driverOn(chain);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure).toEqual({ reason: "closed", retryable: false });
    expect(chain.sends).toEqual([]);
  });

  it("stops before the next signed step once the close passes mid-run", async () => {
    const clock = { now: CLOSES_AT - 30 };
    const chain = chainAt(clock);
    const send = chain.gateway.sendTransaction;
    chain.gateway.sendTransaction = (tx, options) => {
      // the deposit lands as the session closes
      if (tx.to === addresses.collateral) clock.now = CLOSES_AT + 5;
      return send(tx, options);
    };
    const driver = driverOn(chain);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure).toEqual({ reason: "closed", retryable: false });
    expect(chain.sends.map((tx) => tx.to)).toEqual([addresses.collateral]);
  });
});
