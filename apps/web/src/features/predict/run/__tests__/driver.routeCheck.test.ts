import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
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
import type { FakeQuoter } from "../../flow/__tests__/support/fakes";
import type { OptionChainState, PredictOption } from "../../flow/types";
import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { predictSteps } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

function fakeGateway(): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;

  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

const reverted = (hash: Hash): TransactionReceipt =>
  ({ transactionHash: hash, status: "reverted", blockNumber: 19_000_000n }) as TransactionReceipt;

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** Both of `each`'s pools at its estimate. */
const atEstimate = (each: PredictOption): OptionChainState => {
  const base = chainState();
  return chainState({
    pools: {
      up: { ...base.pools.up, sqrtPriceX96: sqrtPriceX96FromPrice(each.targetPriceWad, true) },
      down: { ...base.pools.down, sqrtPriceX96: sqrtPriceX96FromPrice(WAD - each.targetPriceWad, true) },
    },
  });
};

function setup(
  quoter: FakeQuoter,
  opts: { state?: (each: PredictOption) => OptionChainState; options?: PredictOption[] } = {},
) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true, state: opts.state }),
    quoter,
    flowId: `predict-route-check-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot(opts.options ? { options: opts.options } : {}),
  });
  drivers.push(driver);
  return { gateway, driver };
}

const settled = (driver: PredictDriver) =>
  vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

describe("createPredictRun route check", () => {
  it("lets a run that routes go through, depositing once", async () => {
    const { gateway, driver } = setup(fakeQuoter());

    driver.start();
    await settled(driver);

    expect(driver.getProgress().stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
  });

  it("starts once when pressed again while the routes are checked", async () => {
    const quoter = fakeQuoter();
    const { gateway, driver } = setup(quoter);

    driver.start();
    expect(driver.getProgress().stage).toBe("quoting");
    driver.start();
    await settled(driver);

    expect(driver.getProgress()).toMatchObject({ stage: "complete", failure: undefined });
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    // one sell and one buy, quoted by the check and again by the build
    expect(quoter.requests).toHaveLength(4);
  });

  it.each([
    ["reset", (driver: PredictDriver) => driver.reset()],
    ["disposed", (driver: PredictDriver) => driver.dispose()],
  ])("signs nothing when %s while the routes are checked", async (_, stop) => {
    const quoter = fakeQuoter();
    const { gateway, driver } = setup(quoter);

    driver.start();
    stop(driver);
    await vi.waitFor(() => expect(quoter.requests).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.signRequests).toEqual([]);
    expect(driver.getProgress()).toMatchObject({ stage: "idle", failure: undefined });
  });

  it("halts as no-route, not retryable, when the route is gone by the time the trade is built", async () => {
    // The default option quotes one sell and one buy; the check spends those two.
    const quoter = fakeQuoter({ refuse: () => quoter.requests.length > 2 });
    const { gateway, driver } = setup(quoter);

    driver.start();
    await settled(driver);

    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(driver.getProgress().stage).toBe("halted");
    expect(driver.getProgress().failure).toEqual({ reason: "no-route", retryable: false });
  });

  it("says the prices already sit at the estimates, signing nothing, when every pool is at its estimate", async () => {
    const { gateway, driver } = setup(fakeQuoter(), { state: atEstimate });

    driver.start();
    await settled(driver);

    expect(gateway.signRequests).toEqual([]);
    expect(driver.getProgress().failure).toEqual({ reason: "at-estimates", retryable: false });
    const { failure } = predictSteps({
      wallet: null,
      toAdd: 0n,
      symbol: "sDAI",
      decimals: 18,
      progress: driver.getProgress(),
    });
    expect(failure).toBe("Prices are already at your estimates. Nothing to trade.");
  });

  it("still says no trade was found when one option is at its estimate and the other has no route", async () => {
    const [atTarget, unroutable] = [option(1), option(2)];
    const quoter = fakeQuoter({
      refuse: (request) => [request.tokenIn, request.tokenOut].includes(unroutable.underlying),
    });
    const { driver } = setup(quoter, {
      options: [atTarget, unroutable],
      state: (each) => (each === atTarget ? atEstimate(each) : chainState()),
    });

    driver.start();
    await settled(driver);

    expect(driver.getProgress().failure).toEqual({ reason: "no-route", retryable: false });
  });

  it("reports a stored batch that reverted as reverted after an earlier no-route halt", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = "predict-route-check-recovered";
    const quoter = fakeQuoter({ refuse: () => quoter.requests.length > 2 });
    const gateway = { ...fakeGateway(), getReceipt: (hash: Hash) => Promise.resolve(reverted(hash)) };
    const make = (gw: TxGateway, q: FakeQuoter) =>
      createPredictRun({
        gateway: gw,
        reader: fakeReader({ deployed: true }),
        quoter: q,
        flowId,
        store,
        ctx: () => ctx(),
        snapshot: () => snapshot(),
      });

    const driver = make(gateway, quoter);
    drivers.push(driver);
    driver.start();
    await settled(driver);
    expect(driver.getProgress().failure).toEqual({ reason: "no-route", retryable: false });
    driver.reset();

    // Another tab leaves the deposit in flight in the shared store.
    const other = make({ ...fakeGateway(), waitForReceipt: () => new Promise(() => {}) }, fakeQuoter());
    other.start();
    await vi.waitFor(() => expect(other.getProgress().stage).toBe("confirming"));
    other.dispose();

    driver.start();
    await settled(driver);

    expect(driver.getProgress().failure).toEqual({ reason: "reverted", retryable: false });
  });
});
