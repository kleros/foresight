import { describe, expect, it, vi } from "vitest";

import type { SwapQuoteRequest } from "@/lib/swap/types";

import { SLIPPAGE_BPS } from "../../oracle/tolerances";
import { MIN_LEG_WEI, previewTrades } from "../../utils/plan";
import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { planPredict, PlansMovedError, STEP_ID, type PredictDeps } from "../plan";
import type { OptionChainState, PredictOption, ShownPlans } from "../types";
import { chainState, ctx, fakeReader, option, poolQuoter, snapshot, WAD, type FakeQuoter } from "./support/fakes";

const OPTIONS = [option(1), option(2)];
const run = snapshot({ options: OPTIONS, deposit: 3n * WAD, collateralIn: 3n * WAD });

/** The pools the popup read: option 1's UP sells to its target, DOWN buys toward its own. */
const shownState = () => chainState();

/** Option 1's pools after a searcher moves `side` to `priceWad` between the build's read and its quotes. */
const movedState = (side: "up" | "down", priceWad: bigint) => (each: PredictOption) => {
  const state = shownState();
  if (each !== OPTIONS[0]) return state;
  const pool = state.pools[side];
  return {
    ...state,
    pools: { ...state.pools, [side]: { ...pool, sqrtPriceX96: sqrtPriceX96FromPrice(priceWad, pool.outcomeIsToken0) } },
  } satisfies OptionChainState;
};

async function build(deps: PredictDeps) {
  const step = planPredict(run, deps).find((each) => each.id === STEP_ID.predict(1))!;
  return Promise.resolve(step.build(ctx(), run)).catch((caught: unknown) => caught);
}

/** Every option's plan as the popup shows it from `shownState`'s pools. */
async function shownPlans(): Promise<ShownPlans> {
  const error = await build({
    reader: fakeReader({ state: shownState }),
    quoter: poolQuoter(OPTIONS, shownState),
    heldTo: () => ({ plans: {} }),
  });
  return (error as PlansMovedError).moved.plans;
}

describe("a predict batch held to the plans the popup showed", () => {
  it("is built when the live quotes pay what was shown", async () => {
    const plans = await shownPlans();
    const onLeftOut = vi.fn();

    const built = await build({
      reader: fakeReader({ state: shownState }),
      quoter: poolQuoter(OPTIONS, shownState),
      heldTo: () => ({ plans }),
      onLeftOut,
    });

    expect(built).toMatchObject({ to: ctx().executor });
    expect(onLeftOut).not.toHaveBeenCalled();
  });

  it.each([
    ["a buy pays fewer outcome tokens", "down", WAD / 2n],
    ["a sell pays less underlying", "up", WAD / 2n],
  ] as const)(
    "stops at moved, with no option left out, when the pool moves after the read and %s than shown",
    async (_, side, priceWad) => {
      const plans = await shownPlans();
      const onLeftOut = vi.fn();
      const moved = movedState(side, priceWad);
      // the build's first read sees the shown pools; the searcher's move lands before the quotes
      const reader = fakeReader({ state: (each) => (reader.asked.length > 1 ? moved(each) : shownState()) });

      const error = await build({
        reader,
        quoter: poolQuoter(OPTIONS, moved),
        heldTo: () => ({ plans }),
        onLeftOut,
      });

      expect(error).toBeInstanceOf(PlansMovedError);
      expect((error as PlansMovedError).moved.markets).toEqual([OPTIONS[0]!.childMarket]);
      expect(onLeftOut).not.toHaveBeenCalled();
    },
  );

  it("asks each leg's minimum of the output shown for it, when the quotes pay a little less", async () => {
    const plans = await shownPlans();
    const pool = poolQuoter(OPTIONS, shownState);
    const requests: SwapQuoteRequest[] = [];
    // half a percent under the plan shown: inside the tolerance, so the batch is built
    const quoter = {
      quote: async (request: SwapQuoteRequest) => {
        requests.push(request);
        const quote = await pool.quote(request);
        return { ...quote, amountOut: (quote.amountOut * 9_950n) / 10_000n };
      },
    };

    const built = await build({ reader: fakeReader({ state: shownState }), quoter, heldTo: () => ({ plans }) });

    expect(built).toMatchObject({ to: ctx().executor });
    const plan = plans[OPTIONS[0]!.childMarket.toLowerCase()]!;
    const sell = requests.find((request) => request.tokenIn === OPTIONS[0]!.upToken)!;
    expect(sell.heldOut).toBe(plan.sells[0]!.underlyingOut);
    const buy = requests.find((request) => request.tokenOut === OPTIONS[0]!.downToken)!;
    expect(buy.heldOut).toBeGreaterThan(0n);
    expect(buy.heldOut!).toBeLessThanOrEqual(plan.buys[0]!.outcomeOut);
  });

  it("is built when a quote pays more than shown", async () => {
    const plans = await shownPlans();

    const built = await build({
      reader: fakeReader({ state: shownState }),
      quoter: poolQuoter(OPTIONS, movedState("down", WAD / 8n)),
      heldTo: () => ({ plans }),
    });

    expect(built).toMatchObject({ to: ctx().executor });
  });
});

describe("a predict batch held to a plan whose buy sits just above the dust floor", () => {
  const only = OPTIONS[0]!;
  /** The least split whose plan still buys, so the buy is a little over `MIN_LEG_WEI`. */
  const split = (() => {
    for (let amount = MIN_LEG_WEI; amount < 2n * MIN_LEG_WEI; amount += 10n ** 12n) {
      const plan = previewTrades(
        {
          pools: shownState().pools,
          targetPriceWad: only.targetPriceWad,
          held: shownState().held,
          splitAmount: amount,
        },
        SLIPPAGE_BPS,
      )!;
      if (plan.buys.length === 1) return amount + 10n ** 13n;
    }
    throw new Error("No split buys.");
  })();
  const small = snapshot({ options: [only], deposit: split, collateralIn: split });
  const buildSmall = async (deps: PredictDeps) => {
    const step = planPredict(small, deps).find((each) => each.id === STEP_ID.predict(1))!;
    return Promise.resolve(step.build(ctx(), small)).catch((caught: unknown) => caught);
  };

  it("stops at moved when a sell quoted a little short leaves too little for the buy shown", async () => {
    const plans = (
      (await buildSmall({
        reader: fakeReader({ state: shownState }),
        quoter: poolQuoter([only], shownState),
        heldTo: () => ({ plans: {} }),
      })) as PlansMovedError
    ).moved.plans;
    // UP moves half a percent between the build's read and its quotes: inside the tolerance, past the buy's margin
    const moved = movedState("up", (WAD * 995n) / 1000n);
    const reader = fakeReader({ state: (each) => (reader.asked.length > 1 ? moved(each) : shownState()) });
    const quoter: FakeQuoter = poolQuoter([only], moved);

    const error = await buildSmall({ reader, quoter, heldTo: () => ({ plans }) });

    expect(error).toBeInstanceOf(PlansMovedError);
  });
});
