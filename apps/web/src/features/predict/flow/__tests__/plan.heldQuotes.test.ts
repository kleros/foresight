import { describe, expect, it, vi } from "vitest";

import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { planPredict, PlansMovedError, STEP_ID, type PredictDeps } from "../plan";
import type { OptionChainState, PredictOption, ShownPlans } from "../types";
import { chainState, ctx, fakeReader, option, poolQuoter, snapshot, WAD } from "./support/fakes";

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
