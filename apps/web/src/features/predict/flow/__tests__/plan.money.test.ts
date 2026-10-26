import { decodeFunctionData, encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";

import type { PreviewTrades } from "../../utils/plan";
import {
  assertRoutes,
  heldMoves,
  sizeBatches,
  planPredict,
  PlansMovedError,
  NoRouteError,
  PredictConfigError,
  previewCreditsSwap,
  STEP_ID,
  CreditsUnavailableError,
  type PredictDeps,
} from "../plan";
import type { HeldTo, OptionChainState } from "../types";
import {
  addresses,
  chainState,
  ctx,
  fakeCreditsQuoter,
  fakeQuoter,
  fakeReader,
  option,
  snapshot,
  WAD,
} from "./support/fakes";

const only = option(1);
const key = only.childMarket.toLowerCase();
const sellState: OptionChainState = chainState({
  pools: {
    up: { sqrtPriceX96: 2n ** 96n, liquidity: WAD, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
    down: { sqrtPriceX96: 0n, liquidity: 0n, tick: 0, fee: 0n, ticks: [], outcomeIsToken0: true },
  },
  held: { up: WAD, down: 0n, invalid: 0n },
});
const shown: PreviewTrades = {
  split: 0n,
  sells: [{ side: "up", amountIn: WAD, underlyingOut: WAD / 2n, fee: 0n, toTarget: false }],
  merge: 0n,
  buys: [],
  from: WAD,
  to: WAD / 4n,
  feeValue: 0n,
};
const snap = snapshot({ deposit: 0n, collateralIn: 0n, slippage: { tradeBps: 300, creditsBps: 0 } });
function build(deps: PredictDeps, run = snap, context = ctx()) {
  return planPredict(run, deps)
    .find((each) => each.id === STEP_ID.predict(1))!
    .build(context, run);
}
const deps = (held?: HeldTo): PredictDeps => ({
  reader: fakeReader({ state: () => sellState }),
  quoter: fakeQuoter(),
  ...(held ? { heldTo: () => held } : {}),
});

describe("held money plans", () => {
  it("reviews a two-percent amount move despite three-percent swap slippage", async () => {
    await expect(
      build(deps({ plans: { [key]: { ...shown, sells: [{ ...shown.sells[0]!, amountIn: (102n * WAD) / 100n }] } } })),
    ).rejects.toBeInstanceOf(PlansMovedError);
  });
  it("reviews a two-percent quote shortfall despite three-percent swap slippage", async () => {
    const d = deps({
      plans: { [key]: shown },
      quotes: { [key]: { sells: [{ side: "up", amountIn: WAD, amountOut: WAD / 2n }], buys: [] } },
    });
    const quoter = fakeQuoter();
    d.quoter = { quote: async (request) => ({ ...(await quoter.quote(request)), amountOut: (49n * WAD) / 100n }) };
    await expect(build(d)).rejects.toBeInstanceOf(PlansMovedError);
  });
  it("builds when held metadata has no option plans", async () => {
    await expect(build(deps({}))).resolves.toMatchObject({ to: addresses.executor });
  });
  it("reviews a newly trading sell-only option", async () => {
    await expect(build(deps({ plans: {} }))).rejects.toMatchObject({ moved: { markets: [only.childMarket] } });
  });
  it("matches the held sell rate by side", async () => {
    const d = deps({
      plans: { [key]: shown },
      quotes: {
        [key]: {
          sells: [
            { side: "down", amountIn: WAD, amountOut: 9n * WAD },
            { side: "up", amountIn: WAD, amountOut: WAD / 2n },
          ],
          buys: [],
        },
      },
    });
    const quoter = fakeQuoter();
    d.quoter = quoter;
    await expect(build(d)).rejects.toBeInstanceOf(PlansMovedError);
    expect(quoter.requests[0]!.heldOut).toBe(WAD / 2n);
  });
  it("does not divide by a zero-input held sell", async () => {
    const d = deps({
      plans: { [key]: shown },
      quotes: { [key]: { sells: [{ side: "up", amountIn: 0n, amountOut: 0n }], buys: [] } },
    });
    const quoter = fakeQuoter();
    d.quoter = quoter;
    await build(d);
    expect(quoter.requests[0]!.heldOut).toBeUndefined();
  });
});

describe("credits money boundaries", () => {
  it("refuses credits preview without a configured route", async () => {
    await expect(
      previewCreditsSwap(ctx({ credits: null }), WAD, 0, { reader: fakeReader(), creditsQuoter: fakeCreditsQuoter() }),
    ).rejects.toBeInstanceOf(PredictConfigError);
  });
  it("refuses a missing credits route before reading its manager", async () => {
    const reader = fakeReader();
    reader.managerCollateral = async () => {
      throw new Error("unexpected manager read");
    };
    await expect(
      build(
        { reader, quoter: fakeQuoter(), creditsQuoter: fakeCreditsQuoter() },
        snapshot({ creditsToSpend: WAD }),
        ctx({ credits: null }),
      ),
    ).rejects.toBeInstanceOf(PredictConfigError);
  });
  it("refuses encoded credits amounts different from the request", async () => {
    const real = fakeCreditsQuoter();
    await expect(
      previewCreditsSwap(ctx(), WAD, 0, {
        reader: fakeReader(),
        creditsQuoter: {
          quote: async (request) => {
            const quoted = await real.quote(request);
            const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: quoted.data }).args;
            return {
              ...quoted,
              data: encodeFunctionData({
                abi: ALGEBRA_ROUTER_ABI,
                functionName: "exactInputSingle",
                args: [{ ...params, amountIn: 2n * WAD }],
              }),
            };
          },
        },
      }),
    ).rejects.toBeInstanceOf(CreditsUnavailableError);
  });
  it("accepts the exact minimum rate with zero credits slippage", async () => {
    const result = await previewCreditsSwap(ctx(), WAD, 0, {
      reader: fakeReader(),
      creditsQuoter: fakeCreditsQuoter({ lossBps: 2000n }),
    });
    expect(result).toMatchObject({ quoted: WAD, floor: WAD });
  });
  it("accepts a manager holding exactly the credits spent", async () => {
    await expect(
      build(
        {
          reader: fakeReader({ manager: WAD }),
          quoter: fakeQuoter(),
          creditsQuoter: fakeCreditsQuoter({ lossBps: 0n }),
        },
        snapshot({ creditsToSpend: WAD }),
      ),
    ).resolves.toMatchObject({ to: addresses.executor });
  });
  it("accepts a quote exactly covering the held floor without option plans", async () => {
    const credits = {
      amount: WAD,
      creditsBps: 0,
      quoted: (5n * WAD) / 4n,
      vaultValue: (5n * WAD) / 4n,
      floor: (5n * WAD) / 4n,
      loss: 0n,
      minted: 999900000000000000n,
    };
    await expect(
      build(
        {
          reader: fakeReader(),
          quoter: fakeQuoter(),
          creditsQuoter: fakeCreditsQuoter({ lossBps: 0n }),
          heldTo: () => ({ credits }),
        },
        snapshot({ creditsToSpend: WAD, slippage: { tradeBps: 100, creditsBps: 0 } }),
      ),
    ).resolves.toMatchObject({ to: addresses.executor });
  });
  it.each(["preflight", "review"])("carries the credits mint exactly once into every %s batch", async (mode) => {
    const options = [option(1), option(2)];
    const run = snapshot({
      options,
      optionsPerBatch: 1,
      creditsToSpend: WAD,
      collateralIn: WAD,
      slippage: { tradeBps: 100, creditsBps: 0 },
    });
    const d = {
      reader: fakeReader(),
      quoter: fakeQuoter(),
      creditsQuoter: fakeCreditsQuoter({ lossBps: 0n }),
      heldTo: () => ({ plans: {} }),
    };
    const moved =
      mode === "review"
        ? await heldMoves(ctx(), run, d, new Set())
        : await assertRoutes(ctx(), run, d).catch((error: unknown) => {
            if (!(error instanceof PlansMovedError)) throw error;
            return error.moved;
          });
    expect(moved).toMatchObject({
      plans: {
        [options[0]!.childMarket.toLowerCase()]: { split: 1999900000000000000n },
        [options[1]!.childMarket.toLowerCase()]: { split: 1999900000000000000n },
      },
    });
  });
});

describe("review of options without executable amounts", () => {
  it.each(["empty", "unpriced", "missing"])("does not offer a moved plan for an %s option", async (kind) => {
    const state = {
      ...sellState,
      held: { up: 0n, down: 0n, invalid: 0n },
      pools: { ...sellState.pools, up: { ...sellState.pools.up, sqrtPriceX96: kind === "unpriced" ? 0n : 2n ** 95n } },
    };
    const reader = fakeReader({ state: () => state });
    if (kind === "missing") reader.optionStates = async () => [];
    await expect(
      heldMoves(ctx(), snap, { reader, quoter: fakeQuoter(), heldTo: () => ({ plans: {} }) }, new Set()),
    ).resolves.toBeUndefined();
  });
  it("reports no route for dust below the minimum away from the estimate", async () => {
    const reader = fakeReader({ state: () => ({ ...sellState, held: { up: 1n, down: 0n, invalid: 0n } }) });
    await expect(build({ reader, quoter: fakeQuoter(), heldTo: () => ({ plans: {} }) })).rejects.toBeInstanceOf(
      NoRouteError,
    );
  });
  it("reports no route when the reader supplies no option state", async () => {
    const reader = fakeReader();
    reader.optionStates = async () => [];
    await expect(build({ reader, quoter: fakeQuoter(), heldTo: () => ({ plans: {} }) })).rejects.toBeInstanceOf(
      NoRouteError,
    );
  });
  it("reports the independently moved option alongside a short quote", async () => {
    const options = [only, option(2)];
    const reader = fakeReader({
      state: (each) =>
        reader.asked.length > 1 && each === options[1]
          ? { ...sellState, pools: { ...sellState.pools, up: { ...sellState.pools.up, sqrtPriceX96: 2n ** 95n } } }
          : sellState,
    });
    const quoter = fakeQuoter();
    const d: PredictDeps = {
      reader,
      quoter: {
        quote: async (request) => ({
          ...(await quoter.quote(request)),
          amountOut: request.tokenIn === only.upToken ? 1n : WAD / 2n,
        }),
      },
      heldTo: () => ({ plans: { [key]: shown, [options[1]!.childMarket.toLowerCase()]: shown } }),
    };
    await expect(build(d, { ...snap, options })).rejects.toMatchObject({
      moved: { markets: [only.childMarket, options[1]!.childMarket] },
    });
  });
});

describe("batch gas money limits", () => {
  const funded = snapshot({
    options: Array.from({ length: 12 }, (_, index) => option(index + 1)),
    deposit: 0n,
    collateralIn: WAD,
  });
  it("infers fixed gas after shrinking by several options", async () => {
    const counts: number[] = [];
    const reader = fakeReader({
      deployed: true,
      estimateGas: async () => {
        const count = reader.asked.at(-1)!.options.length;
        counts.push(count);
        return 12000000n + BigInt(count) * 1000000n;
      },
    });
    expect(await sizeBatches(ctx(), funded, { reader, quoter: fakeQuoter() }, 40000000n)).toBe(4);
    expect(counts).toEqual([10, 7, 4]);
  });
  it("keeps a batch whose gas exactly fills its block share", async () => {
    const reader = fakeReader({ deployed: true, estimateGas: async () => 8500000n });
    expect(await sizeBatches(ctx(), funded, { reader, quoter: fakeQuoter() }, 17000000n)).toBe(5);
  });
  it("does not estimate a batch before the owner's credits arrive", async () => {
    const reader = fakeReader({ deployed: true, estimateGas: async () => 1000000000n });
    expect(
      await sizeBatches(
        ctx(),
        { ...funded, creditsFromEoa: WAD, creditsToSpend: WAD },
        { reader, quoter: fakeQuoter(), creditsQuoter: fakeCreditsQuoter() },
        17000000n,
      ),
    ).toBe(4);
    expect(reader.estimated).toEqual([]);
  });
});

it("reports no route for an unpriced held option without dereferencing a null plan", async () => {
  const reader = fakeReader({
    state: () => ({ ...sellState, pools: { ...sellState.pools, up: { ...sellState.pools.up, sqrtPriceX96: 0n } } }),
  });
  await expect(build({ reader, quoter: fakeQuoter(), heldTo: () => ({ plans: {} }) })).rejects.toBeInstanceOf(
    NoRouteError,
  );
});
it("reviews every unfunded batch without requiring a credits mint", async () => {
  const options = [only, option(2)];
  const moved = await heldMoves(ctx(), { ...snap, options, optionsPerBatch: 1 }, deps({ plans: {} }), new Set());
  expect(moved?.markets).toEqual(options.map((each) => each.childMarket));
});

it("reviews a newly trading buy-only option", async () => {
  const reader = fakeReader({
    state: () => ({
      ...sellState,
      held: { up: 0n, down: 0n, invalid: 0n },
      underlying: WAD,
      pools: { ...sellState.pools, up: { ...sellState.pools.up, liquidity: 10n ** 30n, sqrtPriceX96: 2n ** 95n } },
    }),
  });
  await expect(
    build({ reader, quoter: fakeQuoter(), heldTo: () => ({ plans: {} }) }, { ...snap, options: [option(1, WAD / 2n)] }),
  ).rejects.toMatchObject({ moved: { markets: [only.childMarket] } });
});

it("reviews credits whose quoted output no longer covers the held floor", async () => {
  const credits = {
    amount: WAD,
    creditsBps: 0,
    quoted: (126n * WAD) / 100n,
    vaultValue: (5n * WAD) / 4n,
    floor: (126n * WAD) / 100n,
    loss: 0n,
    minted: WAD,
  };
  await expect(
    build(
      {
        reader: fakeReader(),
        quoter: fakeQuoter(),
        creditsQuoter: fakeCreditsQuoter({ lossBps: 0n }),
        heldTo: () => ({ credits }),
      },
      snapshot({ creditsToSpend: WAD, slippage: { tradeBps: 100, creditsBps: 0 } }),
    ),
  ).rejects.toMatchObject({ moved: { credits: { quoted: (5n * WAD) / 4n } } });
});

it("does not call mixed at-estimate and illiquid options all at their estimates", async () => {
  const options = [only, option(2)];
  const reader = fakeReader({
    state: (each) => ({
      ...sellState,
      held: { up: 0n, down: 0n, invalid: 0n },
      pools: {
        ...sellState.pools,
        up: { ...sellState.pools.up, sqrtPriceX96: each === only ? 2n ** 95n : 2n ** 96n, liquidity: 0n },
      },
    }),
  });
  await expect(build({ reader, quoter: fakeQuoter() }, { ...snap, options })).rejects.toBeInstanceOf(NoRouteError);
});
