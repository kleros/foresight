import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Address, Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const ATTACKER = "0x00000000000000000000000000000000000000ee" as Address;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** A run on a chain where every send mines; `onSend` sees each transaction the wallet is handed. */
function driverWith(args: {
  live: () => PredictCtx;
  quoter?: ReturnType<typeof fakeQuoter>;
  onSend?: (tx: FlowTx) => void;
}) {
  const sends: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      args.onSend?.(tx);
      return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  const flowId = `predict-allow-${drivers.length}`;
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true }),
    quoter: args.quoter ?? fakeQuoter(),
    flowId,
    store,
    ctx: args.live,
    snapshot: () => snapshot(),
  });
  drivers.push(driver);
  return { driver, sends, stored: () => store.load<PredictSnapshot, PredictCtx>(flowId) };
}

const halted = (driver: PredictDriver) => vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

describe("createPredictRun against the allow-list", () => {
  it("sends a run whose every call keeps to the allow-list", async () => {
    const { driver, sends } = driverWith({ live: () => ctx() });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(sends.map((tx) => tx.to)).toEqual([addresses.collateral, addresses.executor]);
  });

  it("opens no wallet for a batch that splits through a router the allow-list does not name", async () => {
    const { driver, sends, stored } = driverWith({ live: () => ctx({ router: ATTACKER }) });

    driver.start();
    await halted(driver);

    expect(driver.getProgress().failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.map((tx) => tx.to)).toEqual([addresses.collateral]);
    expect(stored()?.snapshot.unanswered).toBeUndefined();
  });

  it("opens no wallet for a batch whose swap goes through a router the allow-list does not name", async () => {
    const quoter = fakeQuoter();
    const quote = quoter.quote;
    const elsewhere = {
      ...quoter,
      quote: async (request: Parameters<typeof quote>[0]) => ({ ...(await quote(request)), router: ATTACKER }),
    };
    const { driver, sends } = driverWith({ live: () => ctx(), quoter: elsewhere });

    driver.start();
    await halted(driver);

    expect(driver.getProgress().failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.map((tx) => tx.to)).toEqual([addresses.collateral]);
  });

  it("opens no wallet once the connected account is not the run's owner", async () => {
    let owner: Address = addresses.owner;
    const { driver, sends } = driverWith({
      live: () => ctx({ owner }),
      onSend: () => {
        owner = ATTACKER;
      },
    });

    driver.start();
    await halted(driver);

    expect(driver.getProgress().failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.map((tx) => tx.to)).toEqual([addresses.collateral]);
  });
});
