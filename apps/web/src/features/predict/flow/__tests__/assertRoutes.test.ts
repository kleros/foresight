import { describe, expect, it, vi } from "vitest";

import { sqrtPriceX96FromPrice } from "../../utils/poolMath";
import { assertRoutes, AtEstimatesError, NoRouteError } from "../plan";
import type { OptionChainState, PredictOption } from "../types";
import { chainState, ctx, fakeQuoter, fakeReader, option, snapshot, WAD } from "./support/fakes";

const TARGET = WAD / 4n;

/** Both pools already at the estimate, so the option has nothing to trade. */
const atTarget: OptionChainState = chainState({
  pools: {
    up: {
      sqrtPriceX96: sqrtPriceX96FromPrice(TARGET, true),
      liquidity: WAD,
      tick: 0,
      fee: 0n,
      ticks: [],
      outcomeIsToken0: true,
    },
    down: {
      sqrtPriceX96: sqrtPriceX96FromPrice(WAD - TARGET, true),
      liquidity: WAD,
      tick: 0,
      fee: 0n,
      ticks: [],
      outcomeIsToken0: true,
    },
  },
});

const routable = option(1, TARGET);
const stuck = option(2, TARGET);
const state = (each: PredictOption) => (each.childMarket === stuck.childMarket ? atTarget : chainState());

describe("assertRoutes", () => {
  it("refuses when any one batch has nothing to trade", async () => {
    const deps = { reader: fakeReader({ state }), quoter: fakeQuoter() };

    await expect(
      assertRoutes(ctx(), snapshot({ options: [routable, stuck], optionsPerBatch: 1 }), deps),
    ).rejects.toBeInstanceOf(NoRouteError);
  });

  it("says the prices already sit at the estimates only when every batch has nothing to trade", async () => {
    const deps = { reader: fakeReader({ state: () => atTarget }), quoter: fakeQuoter() };

    await expect(
      assertRoutes(ctx(), snapshot({ options: [option(3, TARGET), stuck], optionsPerBatch: 1 }), deps),
    ).rejects.toBeInstanceOf(AtEstimatesError);
  });

  it("passes a batch where one option routes, without reporting the other as left out", async () => {
    const onLeftOut = vi.fn();
    const deps = { reader: fakeReader({ state }), quoter: fakeQuoter(), onLeftOut };

    await expect(assertRoutes(ctx(), snapshot({ options: [routable, stuck] }), deps)).resolves.toBeUndefined();
    expect(onLeftOut).not.toHaveBeenCalled();
  });
});
