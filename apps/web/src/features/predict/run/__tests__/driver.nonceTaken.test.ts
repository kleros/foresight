import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import type { LandedTx, SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const internalError = () =>
  new Error("Transaction failed", { cause: Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }) });

const isBatch = (tx: FlowTx) => tx.to === addresses.executor;
const OTHER: FlowTx = { to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 0n };

/**
 * A chain that mines the owner's sends in nonce order. As the second batch's prompt is open, another transaction
 * from the owner takes the nonce read for it; the wallet then broadcasts the batch at the next one and throws.
 */
function chain() {
  const byNonce: Array<{ hash: Hash; tx: FlowTx; block?: bigint }> = [];
  const sends: FlowTx[] = [];
  let head = 1n;
  let intruded = false;
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: head, logs: [] }) as unknown as TransactionReceipt;
  const push = (tx: FlowTx) => {
    byNonce.push({ hash: `0x${(byNonce.length + 1).toString(16).padStart(64, "0")}` as Hash, tx });
    return byNonce.length - 1;
  };

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (!intruded && isBatch(tx) && sends.filter(isBatch).length === 2) {
        intruded = true;
        push(OTHER);
        push(tx);
        return Promise.reject(internalError());
      }
      const nonce = push(tx);
      byNonce[nonce]!.block = ++head;
      return Promise.resolve(byNonce[nonce]!.hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };

  const sentWithNonce = ({ nonce }: { nonce: number }): Promise<SentTx> => {
    const sent = byNonce[nonce];
    if (!sent) return Promise.resolve({ status: "none" });
    if (sent.block === undefined) return Promise.resolve({ status: "pending" });
    const { to, value = 0n, data = "0x" } = sent.tx;
    return Promise.resolve({ status: "mined", hash: sent.hash, to, value, input: data, success: true });
  };

  return {
    gateway,
    batchSends: () => sends.filter(isBatch).length,
    mineOther: () => {
      for (const sent of byNonce) if (sent.tx === OTHER && sent.block === undefined) sent.block = ++head;
    },
    land: () => {
      for (const sent of byNonce) if (sent.block === undefined) sent.block = ++head;
    },
    reader: {
      ...fakeReader({ deployed: true, blockGasLimit: gasLimitFor(1), state: () => chainState({ underlying: WAD }) }),
      latestBlock: () => Promise.resolve(head),
      nextNonce: () => Promise.resolve(byNonce.length),
      hasPending: () => Promise.resolve(byNonce.some((sent) => sent.block === undefined)),
      sentWithNonce,
      landedSince: ({ fromBlock }: { fromBlock: bigint }): Promise<LandedTx[]> =>
        Promise.resolve(
          byNonce
            .filter((sent) => sent.block !== undefined && sent.block >= fromBlock && sent.tx !== OTHER)
            .map(({ tx }) => ({ to: tx.to, value: tx.value ?? 0n, input: tx.data ?? "0x", collateralReceived: WAD })),
        ),
    },
  };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

describe("createPredictRun when another send takes the nonce read for a batch", () => {
  it("signs that batch no second time while the owner still has a send pending", async () => {
    const fake = chain();
    const driver = createPredictRun({
      gateway: fake.gateway,
      reader: fake.reader,
      quoter: fakeQuoter(),
      flowId: "nonce-taken",
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: [option(1), option(2)] }),
      unansweredSend: { waitMs: 20, pollMs: 5 },
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    fake.mineOther();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.reason).toBe("pending");
    expect(fake.batchSends()).toBe(2);

    fake.land();
    driver.retry();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
    expect(fake.batchSends()).toBe(2);
  });
});
