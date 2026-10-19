import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SwapQuoteRequest } from "@/lib/swap/types";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  type FakeQuoter,
  fakeReader,
  gasLimitFor,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictOption, PredictSnapshot } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

/** What the chain does with one sent transaction. `lost` fails the first receipt wait with an unclassifiable error. */
type Mined = "success" | "revert" | { lost: "success" | "reverted" };

/**
 * A wallet that signs everything, with one script entry per send. A transaction's receipt
 * status is fixed when it is sent, so a later wait or lookup on the same hash agrees with it.
 */
function scriptedGateway(script: Mined[]): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const chain = new Map<Hash, { status: "success" | "reverted"; lostOnce: boolean }>();
  const receipt = (hash: Hash, status: "success" | "reverted") =>
    ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

  return {
    signRequests,
    sendTransaction: (tx) => {
      const mined = script[signRequests.length] ?? "success";
      signRequests.push(tx);
      const hash = `0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash;
      if (typeof mined === "object") chain.set(hash, { status: mined.lost, lostOnce: true });
      else chain.set(hash, { status: mined === "revert" ? "reverted" : "success", lostOnce: false });
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => {
      const entry = chain.get(hash);
      if (!entry) return Promise.reject(new Error("unknown hash", { cause: "opaque" }));
      if (entry.lostOnce) {
        entry.lostOnce = false;
        return Promise.reject(new Error("node said something odd", { cause: "opaque" }));
      }
      return Promise.resolve(receipt(hash, entry.status));
    },
    getReceipt: (hash) => {
      const entry = chain.get(hash);
      return Promise.resolve(entry ? receipt(hash, entry.status) : null);
    },
    isKnown: (hash) => Promise.resolve(chain.has(hash)),
  };
}

/** Like `fakeQuoter`, but every quote's calldata carries a serial number, so a fresh quote reads differently. */
function serialQuoter(refuse: (request: SwapQuoteRequest) => boolean = () => false): FakeQuoter {
  const inner = fakeQuoter({ refuse });
  let serial = 0;
  return {
    requests: inner.requests,
    quote: async (request) => {
      const quote = await inner.quote(request);
      serial += 1;
      return { ...quote, data: `${quote.data}${serial.toString(16).padStart(8, "0")}` as Hex };
    },
  };
}

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;

const hex = (address: Address) => address.slice(2).toLowerCase();

/** The executor transactions that trade `target`, the batch it belongs to. */
const batchTxs = (signed: FlowTx[], target: PredictOption) =>
  signed.filter(
    (tx) => tx.to === addresses.executor && (tx.data ?? "").toLowerCase().includes(hex(target.childMarket)),
  );

const quotesFor = (quoter: FakeQuoter, target: PredictOption) =>
  quoter.requests.filter(
    (request) =>
      [target.upToken, target.downToken].includes(request.tokenIn) ||
      [target.upToken, target.downToken].includes(request.tokenOut),
  );

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** One option per batch, a deposit first, and the executor already deployed. */
function setup(args: {
  options: PredictOption[];
  script: Mined[];
  snap?: Partial<PredictSnapshot>;
  refuse?: (request: SwapQuoteRequest) => boolean;
  optionsPerBatch?: number;
}) {
  const gateway = scriptedGateway(args.script);
  // later batches mint nothing, so they trade the underlying the first batch's split left in the wallet
  const reader = fakeReader({
    deployed: true,
    collateral: 0n,
    state: () => chainState({ underlying: WAD }),
    blockGasLimit: gasLimitFor(args.optionsPerBatch ?? 1),
  });
  const quoter = serialQuoter(args.refuse);
  const driver = createPredictRun({
    gateway,
    reader,
    quoter,
    flowId: `predict-reverted-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options: args.options, deposit: WAD, collateralIn: WAD, ...args.snap }),
  });
  drivers.push(driver);
  return { gateway, reader, quoter, driver };
}

async function haltedOrComplete(driver: PredictDriver) {
  await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
  return driver.getProgress();
}

describe("createPredictRun when a later prediction batch reverts after the first went through", () => {
  const first = option(1);
  const second = option(2);
  // deposit, batch 1, batch 2 reverts, then batch 2 again
  const script: Mined[] = ["success", "success", "revert", "success"];

  it("halts on the reverted batch with a retry on offer, and signs nothing until the visitor takes it", async () => {
    const { gateway, driver } = setup({ options: [first, second], script });

    driver.start();
    const halted = await haltedOrComplete(driver);

    expect(halted.stage).toBe("halted");
    expect(halted.failure).toEqual({ reason: "reverted", retryable: true });
    expect(halted.batchesDone).toBe(1);
    expect(halted.batches).toBe(2);
    expect(halted.steps.find((step) => step.id === STEP_ID.predict(1))?.state).toBe("success");
    expect(halted.steps.find((step) => step.id === STEP_ID.predict(2))?.state).toBe("error");

    // nothing goes out again on its own: the retry waits for the visitor to review and press it
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gateway.signRequests).toHaveLength(3);
    expect(driver.getProgress().stage).toBe("halted");
  });

  it("re-reads the pools and re-quotes the reverted batch on retry, and sends the rebuilt transaction", async () => {
    const { gateway, reader, quoter, driver } = setup({ options: [first, second], script });

    driver.start();
    await haltedOrComplete(driver);
    const quotesBefore = quotesFor(quoter, second).length;
    const readsBefore = reader.asked.filter((ask) =>
      ask.options.some((each) => each.childMarket === second.childMarket),
    ).length;
    const reverted = batchTxs(gateway.signRequests, second);
    expect(reverted).toHaveLength(1);

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(quotesFor(quoter, second).length).toBeGreaterThan(quotesBefore);
    expect(
      reader.asked.filter((ask) => ask.options.some((each) => each.childMarket === second.childMarket)).length,
    ).toBeGreaterThan(readsBefore);
    const sent = batchTxs(gateway.signRequests, second);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.data).not.toBe(sent[0]!.data);
  });

  it("does not send the confirmed deposit or the batch that went through a second time", async () => {
    const { gateway, driver } = setup({ options: [first, second], script });

    driver.start();
    await haltedOrComplete(driver);
    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, first)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, second)).toHaveLength(2);
    expect(gateway.signRequests).toHaveLength(4);
  });

  it("keeps two earlier batches and the deposit when the third batch reverts and is retried", async () => {
    const third = option(3);
    const { gateway, driver } = setup({
      options: [first, second, third],
      // deposit, batch 1, batch 2, batch 3 reverts, then batch 3 again
      script: ["success", "success", "success", "revert", "success"],
    });

    driver.start();
    const halted = await haltedOrComplete(driver);
    expect(halted.failure).toEqual({ reason: "reverted", retryable: true });
    expect(halted.batchesDone).toBe(2);

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, first)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, second)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, third)).toHaveLength(2);
  });
});

describe("createPredictRun when a later batch's outcome was not seen", () => {
  const first = option(1);
  const second = option(2);

  it("checks the sent batch before retrying, and a revert found there gets a reviewed rebuild, not a blind resend", async () => {
    const { gateway, driver } = setup({
      options: [first, second],
      // deposit, batch 1, batch 2 whose wait fails and which in fact reverted, then batch 2 rebuilt
      script: ["success", "success", { lost: "reverted" }, "success"],
    });

    driver.start();
    const uncertain = await haltedOrComplete(driver);
    expect(uncertain.stage).toBe("halted");
    expect(uncertain.pendingHash).toBeDefined();

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("reverted"));
    const reconciled = driver.getProgress();

    expect(reconciled.stage).toBe("halted");
    expect(reconciled.failure).toEqual({ reason: "reverted", retryable: true });
    expect(reconciled.pendingHash).toBeUndefined();
    // reconciling looked at the chain; it did not sign the batch again
    expect(batchTxs(gateway.signRequests, second)).toHaveLength(1);

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, first)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, second)).toHaveLength(2);
  });

  it("finishes without signing the batch again when the unseen batch had in fact mined", async () => {
    const { gateway, driver } = setup({
      options: [first, second],
      script: ["success", "success", { lost: "success" }],
    });

    driver.start();
    const uncertain = await haltedOrComplete(driver);
    expect(uncertain.pendingHash).toBeDefined();

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, first)).toHaveLength(1);
    expect(batchTxs(gateway.signRequests, second)).toHaveLength(1);
  });
});

describe("createPredictRun when a batch leaves an option out", () => {
  const first = option(1);
  const unrouted = option(2);
  const third = option(3);
  const refuse = (request: SwapQuoteRequest) =>
    [unrouted.upToken, unrouted.downToken].includes(request.tokenIn) ||
    [unrouted.upToken, unrouted.downToken].includes(request.tokenOut);

  it("still names it once a later batch reverts and is retried", async () => {
    const { driver } = setup({
      options: [first, unrouted, third],
      optionsPerBatch: 2,
      // deposit, batch 1 leaving `unrouted` out, batch 2 reverts, then batch 2 again
      script: ["success", "success", "revert", "success"],
      refuse,
    });

    driver.start();
    const halted = await haltedOrComplete(driver);
    expect(halted.failure?.reason).toBe("reverted");
    expect(halted.leftOut).toEqual([unrouted.childMarket]);

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(after.leftOut).toEqual([unrouted.childMarket]);
  });

  it("still names it when the batch's receipt was unseen and the retry finds it mined", async () => {
    const { gateway, driver } = setup({
      options: [first, unrouted],
      optionsPerBatch: 2,
      script: ["success", { lost: "success" }],
      refuse,
    });

    driver.start();
    const uncertain = await haltedOrComplete(driver);
    expect(uncertain.pendingHash).toBeDefined();

    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(after.leftOut).toEqual([unrouted.childMarket]);
    expect(batchTxs(gateway.signRequests, first)).toHaveLength(1);
  });

  it("gives an option another go when the batch that left it out is rebuilt", async () => {
    let closed = true;
    const { driver } = setup({
      options: [first, unrouted],
      optionsPerBatch: 2,
      // deposit, the batch reverts, then the rebuilt batch with `unrouted` routed
      script: ["success", "revert", "success"],
      refuse: (request) => closed && refuse(request),
    });

    driver.start();
    const halted = await haltedOrComplete(driver);
    expect(halted.leftOut).toEqual([unrouted.childMarket]);

    closed = false;
    driver.retry();
    const after = await haltedOrComplete(driver);

    expect(after.stage).toBe("complete");
    expect(after.leftOut).toEqual([]);
  });
});

describe("createPredictRun when the run cannot succeed as configured", () => {
  it("stops with no further retry when the reverted batch no longer has a route on its rebuild", async () => {
    const first = option(1);
    const second = option(2);
    let routesClosed = false;
    const { gateway, driver } = setup({
      options: [first, second],
      script: ["success", "success", "revert"],
      refuse: () => routesClosed,
    });

    driver.start();
    const halted = await haltedOrComplete(driver);
    expect(halted.failure).toEqual({ reason: "reverted", retryable: true });

    routesClosed = true;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("no-route"));
    const stopped = driver.getProgress();

    expect(stopped.stage).toBe("halted");
    expect(stopped.failure).toEqual({ reason: "no-route", retryable: false });
    expect(gateway.signRequests).toHaveLength(3);
  });

  it("does not offer a retry when the network has no xDAI route into the trade wallet", async () => {
    const gateway = scriptedGateway([]);
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true }),
      quoter: fakeQuoter(),
      flowId: "predict-no-adapter",
      ctx: () => ctx({ sDaiAdapter: null }),
      snapshot: () => snapshot({ deposit: WAD, depositNative: true, collateralIn: WAD }),
    });
    drivers.push(driver);

    driver.start();
    const halted = await haltedOrComplete(driver);

    expect(halted.stage).toBe("halted");
    expect(halted.failure?.retryable).toBe(false);
    expect(gateway.signRequests).toEqual([]);
  });

  it("does not offer a retry when there are no estimates to predict", async () => {
    const gateway = scriptedGateway([]);
    const driver = createPredictRun({
      gateway,
      reader: fakeReader({ deployed: true }),
      quoter: fakeQuoter(),
      flowId: "predict-no-options",
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: [] }),
    });
    drivers.push(driver);

    driver.start();
    const halted = await haltedOrComplete(driver);

    expect(halted.stage).toBe("halted");
    expect(halted.failure?.retryable).toBe(false);
    expect(gateway.signRequests).toEqual([]);
  });
});
