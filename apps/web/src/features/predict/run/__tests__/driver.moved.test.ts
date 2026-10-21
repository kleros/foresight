import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { UserRejectedRequestError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import type { OptionChainState } from "../../flow/types";
import { SLIPPAGE_BPS } from "../../oracle/tolerances";
import { previewTrades, type PreviewTrades } from "../../utils/plan";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const FLOW_ID = "predict-moved";
const OPTION = option(1);
const KEY = OPTION.childMarket.toLowerCase();
const REQUEST = snapshot({ options: [OPTION], deposit: WAD, collateralIn: WAD });

/** The fakes' pools: UP shallow above the estimate, DOWN deep below it. */
const AS_SHOWN = chainState();
/** UP four times as deep, so selling it to the estimate takes far more than was shown. */
const DEEPER = chainState({ pools: { ...AS_SHOWN.pools, up: { ...AS_SHOWN.pools.up, liquidity: 2n * WAD } } });
/** UP between the two, so the plan moves again. */
const BETWEEN = chainState({ pools: { ...AS_SHOWN.pools, up: { ...AS_SHOWN.pools.up, liquidity: WAD } } });

/** The plan the popup shows for `state`, as `usePricePreview` works it out. */
const planOn = (state: OptionChainState): PreviewTrades =>
  previewTrades(
    {
      pools: state.pools,
      targetPriceWad: OPTION.targetPriceWad,
      held: state.held,
      splitAmount: state.underlying + REQUEST.collateralIn,
    },
    SLIPPAGE_BPS,
  )!;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function setup(initial: OptionChainState) {
  let state = initial;
  const sent: FlowTx[] = [];
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sent.push(tx);
      return Promise.reject(new UserRejectedRequestError(new Error("rejected")));
    },
    waitForReceipt: () => Promise.reject(new Error("nothing was sent")),
    getReceipt: () => Promise.resolve(null),
    isKnown: () => Promise.resolve(false),
  };
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true, state: () => state }),
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    store,
    ctx: () => ctx(),
    snapshot: () => REQUEST,
  });
  drivers.push(driver);
  return { driver, sent, store, moveTo: (next: OptionChainState) => (state = next) };
}

const signed = (driver: PredictDriver) =>
  vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("rejected"));

describe("createPredictRun when Predict is pressed", () => {
  it("goes ahead when the pools still give the plan shown", async () => {
    const { driver, sent } = setup(AS_SHOWN);

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await signed(driver);

    expect(sent).toHaveLength(1);
    expect(driver.getProgress().moved).toBeUndefined();
  });

  it("signs nothing and names the option whose plan the pools moved, with the plan they give now", async () => {
    const { driver, sent, store } = setup(DEEPER);

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

    expect(driver.getProgress().moved).toEqual({ markets: [OPTION.childMarket], plans: { [KEY]: planOn(DEEPER) } });
    expect(driver.getProgress().failure).toBeUndefined();
    expect(sent).toEqual([]);
    expect(store.load(FLOW_ID)).toBeNull();
  });

  it("goes ahead on confirm, against the plan it named", async () => {
    const { driver, sent } = setup(DEEPER);
    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

    driver.confirm();
    await signed(driver);

    expect(sent).toHaveLength(1);
    expect(driver.getProgress().moved).toBeUndefined();
  });

  it("names the plan again rather than signing when the pools move again before confirm", async () => {
    const { driver, sent, moveTo } = setup(DEEPER);
    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

    moveTo(BETWEEN);
    driver.confirm();
    await vi.waitFor(() => expect(driver.getProgress().moved?.plans[KEY]).toEqual(planOn(BETWEEN)));

    expect(driver.getProgress().stage).toBe("moved");
    expect(sent).toEqual([]);
  });

  it("compares nothing for a run started with nothing to hold it to", async () => {
    const { driver, sent } = setup(DEEPER);

    driver.start();
    await signed(driver);

    expect(sent).toHaveLength(1);
  });

  it("drops the named plan on reset", async () => {
    const { driver } = setup(DEEPER);
    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));

    driver.reset();

    expect(driver.getProgress().stage).toBe("idle");
    expect(driver.getProgress().moved).toBeUndefined();
  });
});

describe("createPredictRun's batch count across a moved confirm", () => {
  it("keeps the batches the visitor saw at moved, whatever the node estimates on confirm", async () => {
    const options = [OPTION, option(2), option(3)];
    let estimate = 100_000_000n;
    const driver = createPredictRun({
      gateway: {
        sendTransaction: () => Promise.reject(new UserRejectedRequestError(new Error("rejected"))),
        waitForReceipt: () => Promise.reject(new Error("nothing was sent")),
        getReceipt: () => Promise.resolve(null),
        isKnown: () => Promise.resolve(false),
      },
      // everything already in a deployed trade wallet, so the first batch is estimated live
      reader: fakeReader({
        deployed: true,
        collateral: WAD,
        state: () => DEEPER,
        blockGasLimit: gasLimitFor(3),
        estimateGas: () => Promise.resolve(estimate),
      }),
      quoter: fakeQuoter(),
      flowId: `${FLOW_ID}-sized`,
      store: createFlowRunStore({ storage: createMemoryStorage() }),
      ctx: () => ctx(),
      snapshot: () => ({ ...REQUEST, options, deposit: 0n, collateralBefore: WAD }),
    });
    drivers.push(driver);

    driver.start({ plans: { [KEY]: planOn(AS_SHOWN) } });
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("moved"));
    const shown = driver.getProgress().batches;
    expect(shown).toBe(3);

    estimate = 1_000_000n;
    driver.confirm();
    await signed(driver);

    expect(driver.getProgress().batches).toBe(shown);
  });
});
