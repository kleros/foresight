import { readFileSync } from "node:fs";
import path from "node:path";

import { isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  LIQUIDITY_DEADLINE_SECONDS,
  LIQUIDITY_SLIPPAGE_BPS,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
  NEW_POOL_TICK_SPACING,
  REALIGN_DUST_WEI,
  SEED_PRICE_TOLERANCE_TICKS,
} from "../../oracle/tolerances";
import { planSeed } from "../plan";
import {
  BPS,
  CHAIN_TIME,
  LIST,
  MAX_UINT128,
  amount0Delta,
  amount1Delta,
  approvalMismatches,
  branch,
  decode,
  fullRange,
  liquidityFor,
  mintPulls,
  mintsOf,
  missing,
  movedSqrtPrice,
  owner,
  seedMintOf,
  session,
  sortPair,
  txsOf,
  userSqrtPrice,
  type BranchTokens,
  type PoolStateInput,
} from "./support/session";

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const WAD = 10n ** 18n;
/** Deep enough that one tick of price moves a mint's amounts by many wei. */
const DEPTH = 1_000n * WAD;

function seed(
  pools: { up: PoolStateInput; down: PoolStateInput },
  options: { tokens?: BranchTokens; upPriceBps?: bigint; chainTime?: bigint } = {},
) {
  const s = session([options.tokens ?? branch(1)]);
  const plan = planSeed({
    session: s,
    owner,
    total: DEPTH,
    collateral: "sDAI",
    chainTime: options.chainTime ?? CHAIN_TIME,
    branches: [{ depth: DEPTH, upPriceBps: options.upPriceBps ?? 5_000n, pools }],
  });
  return { s, plan, txs: txsOf(plan.steps) };
}

const live = (bps: bigint, childIsToken0: boolean, tickSpacing: number): PoolStateInput => ({
  status: "live",
  sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
  liquidity: 10n ** 21n,
  tickSpacing,
});
const empty = (bps: bigint, childIsToken0: boolean): PoolStateInput => ({
  status: "empty",
  sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
  tickSpacing: NEW_POOL_TICK_SPACING,
});

/** Within one part in 10^12: the price a sqrt price was rounded to, not a different one. */
const expectNear = (actual: bigint, expected: bigint) => {
  const gap = actual > expected ? actual - expected : expected - actual;
  expect(gap * 10n ** 12n).toBeLessThanOrEqual(expected);
};

/** A mint at a price the run sets fills within SEED_PRICE_TOLERANCE_TICKS of it and not much beyond. */
function expectSeedMins(pool: {
  sqrtPriceX96: bigint;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}) {
  const spacing = [1, 10, 60, 200].find((each) => fullRange(each).tickUpper === pool.tickUpper)!;
  const { sqrtA, sqrtB } = fullRange(spacing);
  const at = (ticks: number) =>
    mintPulls(movedSqrtPrice(pool.sqrtPriceX96, ticks), sqrtA, sqrtB, pool.amount0, pool.amount1);
  const t = SEED_PRICE_TOLERANCE_TICKS;
  // a rising price takes less token0, a falling one less token1
  expect(pool.amount0Min).toBeGreaterThan(0n);
  expect(pool.amount0Min).toBeLessThanOrEqual(at(t).amount0 + 1n);
  expect(pool.amount0Min).toBeGreaterThanOrEqual(at(t + 2).amount0);
  expect(pool.amount1Min).toBeGreaterThan(0n);
  expect(pool.amount1Min).toBeLessThanOrEqual(at(-t).amount1 + 1n);
  expect(pool.amount1Min).toBeGreaterThanOrEqual(at(-(t + 2)).amount1);
}

describe("liquidity plan module (A1)", () => {
  it.each(["plan.ts", "allowed.ts"])("keeps %s free of React and wallet libraries", (file) => {
    const source = readFileSync(path.resolve("src/features/liquidity/flow", file), "utf8");

    expect(source).not.toMatch(/from\s+["'](react|react-dom|wagmi|@wagmi\/[^"']+|@tanstack\/[^"']+|next\/[^"']+)["']/);
  });

  it("builds the same plan twice from the same session, inputs and pool state", () => {
    const pools = { up: empty(100n, true), down: live(4_000n, false, 10) };

    const first = seed(pools);
    const second = seed(pools);

    expect(second.txs).toEqual(first.txs);
    expect(second.plan.branches).toEqual(first.plan.branches);
    expect(second.plan.leftovers).toEqual(first.plan.leftovers);
  });

  it("creates a missing pool, realigns an empty one and locks a live one to its price", () => {
    const { plan } = seed({ up: missing, down: empty(100n, false) });
    const locked = seed({ up: live(3_000n, true, 60), down: missing }).plan;

    expect(plan.branches[0]!.pools.up).toMatchObject({ create: true, realign: false, priceLocked: false });
    expect(plan.branches[0]!.pools.down).toMatchObject({ create: false, realign: true, priceLocked: false });
    expect(locked.branches[0]!.pools.up).toMatchObject({ create: false, realign: false, priceLocked: true });
  });
});

describe("seed prices (L2)", () => {
  it.each([
    [3_000n, { up: true, down: true }],
    [3_000n, { up: false, down: false }],
    [MIN_SEED_PRICE_BPS, { up: true, down: false }],
    [MAX_SEED_PRICE_BPS, { up: false, down: true }],
  ])("prices DOWN at exactly 1 − UP for UP at %s bps, child token0 %o", (up, order) => {
    const { plan, txs } = seed({ up: missing, down: missing }, { tokens: branch(1, order), upPriceBps: up });
    const creates = txs.flatMap((tx) => {
      const d = decode(tx);
      return d.kind === "multicall" ? d.inner.filter((call) => call.name === "create") : [];
    });

    expect(plan.branches[0]!.upPriceBps).toBe(up);
    expect(plan.branches[0]!.downPriceBps).toBe(BPS - up);
    expectNear(plan.branches[0]!.pools.up.sqrtPriceX96, userSqrtPrice(up, order.up));
    expectNear(plan.branches[0]!.pools.down.sqrtPriceX96, userSqrtPrice(BPS - up, order.down));
    expect(creates.map((call) => call.sqrtPriceX96)).toEqual([
      plan.branches[0]!.pools.up.sqrtPriceX96,
      plan.branches[0]!.pools.down.sqrtPriceX96,
    ]);
  });

  it.each([MIN_SEED_PRICE_BPS - 1n, MAX_SEED_PRICE_BPS + 1n, 0n, BPS])("refuses an UP price of %s bps", (up) => {
    expect(() => seed({ up: missing, down: missing }, { upPriceBps: up })).toThrow();
  });

  it.each([
    { up: true, down: false },
    { up: false, down: true },
  ])("holds a new pool's mint to SEED_PRICE_TOLERANCE_TICKS of its price, child token0 %o", (order) => {
    const { plan } = seed({ up: missing, down: missing }, { tokens: branch(1, order), upPriceBps: 2_500n });

    expectSeedMins(plan.branches[0]!.pools.up);
    expectSeedMins(plan.branches[0]!.pools.down);
  });

  it.each([10, 200])("locks a live pool to its own price and tick spacing %s", (tickSpacing) => {
    const state = live(1_234n, true, tickSpacing);
    const { plan, txs } = seed({ up: state, down: missing }, { upPriceBps: 5_000n });
    const pool = plan.branches[0]!.pools.up;
    const { tickLower, tickUpper } = fullRange(tickSpacing);

    expect(pool.sqrtPriceX96).toBe(state.status === "live" ? state.sqrtPriceX96 : 0n);
    expect([pool.tickLower, pool.tickUpper]).toEqual([tickLower, tickUpper]);
    expect(seedMintOf(txs, pool).mint).toMatchObject({ tickLower, tickUpper });
  });

  it("holds a live pool's mint to LIQUIDITY_SLIPPAGE_BPS under the shown amounts", () => {
    const { plan } = seed({ up: live(6_000n, false, 60), down: live(4_000n, true, 60) });

    for (const pool of [plan.branches[0]!.pools.up, plan.branches[0]!.pools.down]) {
      for (const [shown, min] of [
        [pool.amount0, pool.amount0Min],
        [pool.amount1, pool.amount1Min],
      ] as const) {
        const floor = (shown * (BPS - BigInt(LIQUIDITY_SLIPPAGE_BPS))) / BPS;
        expect(min).toBeGreaterThan(0n);
        expect(min).toBeGreaterThanOrEqual(floor);
        expect(min).toBeLessThanOrEqual(floor + 1n);
      }
    }
  });

  it("creates a missing pool at NEW_POOL_TICK_SPACING's full range", () => {
    const { plan } = seed({ up: missing, down: missing });
    const { tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);

    expect(plan.branches[0]!.pools.up).toMatchObject({ tickLower, tickUpper });
    expect(plan.branches[0]!.pools.down).toMatchObject({ tickLower, tickUpper });
  });
});

describe("self-realign of an empty pool (L3)", () => {
  /** Pool at `poolBps`, the run's UP price `target`: the realign has to move it there before the seed. */
  function realign(poolBps: bigint, target: bigint, childIsToken0: boolean) {
    const tokens = branch(1, { up: childIsToken0, down: !childIsToken0 });
    const state = empty(poolBps, childIsToken0);
    const run = seed({ up: state, down: missing }, { tokens, upPriceBps: target });
    const pool = run.plan.branches[0]!.pools.up;
    const [token0, token1] = sortPair(tokens.upToken, tokens.outcome);
    const decoded = run.txs.map(decode);
    const isPair = (call: { token0: Address; token1: Address }) =>
      same(call.token0, token0) && same(call.token1, token1);
    const dustAt = decoded.findIndex(
      (d) =>
        d.kind === "multicall" &&
        d.inner.some((call) => call.name === "mint" && isPair(call) && call.amount0Desired !== pool.amount0),
    );
    const swapAt = decoded.findIndex((d) => d.kind === "swap");
    const withdrawAt = run.plan.steps.findIndex((step) => step.build !== undefined);
    const seedAt = seedMintOf(run.txs, pool).index;
    return { ...run, tokens, state, pool, token0, token1, decoded, dustAt, swapAt, withdrawAt, seedAt };
  }

  const cases = [
    ["a hostile low price, child token0", 100n, 5_000n, true],
    ["a hostile low price, child token1", 100n, 5_000n, false],
    ["a high price, child token0", 9_900n, 3_000n, true],
    ["a high price, child token1", 9_900n, 3_000n, false],
  ] as const;

  it.each(cases)("mints dust, swaps, withdraws the dust, then seeds, from %s", (_, poolBps, target, childIsToken0) => {
    const r = realign(poolBps, target, childIsToken0);

    expect(r.dustAt).toBeGreaterThanOrEqual(0);
    expect(r.swapAt).toBeGreaterThan(r.dustAt);
    expect(r.withdrawAt).toBeGreaterThan(r.swapAt);
    expect(r.seedAt).toBeGreaterThan(r.withdrawAt);
    expect(r.plan.steps[r.withdrawAt]!.withdraws).toBe(r.plan.steps[r.dustAt]!.id);
  });

  it.each(cases)("mints the dust full range at the pool's own price, from %s", (_, poolBps, target, childIsToken0) => {
    const r = realign(poolBps, target, childIsToken0);
    const dust = r.decoded[r.dustAt]!;
    const mints = dust.kind === "multicall" ? dust.inner.filter((call) => call.name === "mint") : [];
    const { tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);

    expect(dust.kind === "multicall" && dust.inner.some((call) => call.name === "create")).toBe(false);
    expect(mints).toHaveLength(1);
    const mint = mints[0]!;
    expect(mint).toMatchObject({ tickLower, tickUpper, recipient: expect.stringMatching(new RegExp(owner, "i")) });
    expect(mint.amount0Desired > mint.amount1Desired ? mint.amount0Desired : mint.amount1Desired).toBe(
      REALIGN_DUST_WEI,
    );
    expect(mint.amount0Desired).toBeGreaterThan(0n);
    expect(mint.amount1Desired).toBeGreaterThan(0n);
    expect(mint.amount0Min).toBeGreaterThan(0n);
    expect(mint.amount1Min).toBeGreaterThan(0n);
    expect(mint.deadline).toBe(CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS);
  });

  it.each(cases)(
    "swaps to the target with the input capped at the dust's need plus LIQUIDITY_SLIPPAGE_BPS, from %s",
    (_, poolBps, target, childIsToken0) => {
      const r = realign(poolBps, target, childIsToken0);
      const dust = r.decoded[r.dustAt]!;
      const mint = dust.kind === "multicall" ? dust.inner.find((call) => call.name === "mint")! : undefined;
      const swap = r.decoded[r.swapAt]!;
      if (swap.kind !== "swap" || mint?.name !== "mint" || r.state.status !== "empty") throw new Error("no realign");
      const cur = r.state.sqrtPriceX96;
      const { sqrtA, sqrtB } = fullRange(NEW_POOL_TICK_SPACING);
      const dustLiquidity = liquidityFor(cur, sqrtA, sqrtB, mint.amount0Desired, mint.amount1Desired);
      const rising = r.pool.sqrtPriceX96 > cur;
      // the pool's fee is not among the plan's inputs, so the need is taken without it
      const need = rising
        ? amount1Delta(cur, r.pool.sqrtPriceX96, dustLiquidity, true)
        : amount0Delta(r.pool.sqrtPriceX96, cur, dustLiquidity, true);

      expectNear(r.pool.sqrtPriceX96, userSqrtPrice(target, childIsToken0));
      expect(swap.limitSqrtPrice).toBe(r.pool.sqrtPriceX96);
      expect(same(swap.tokenIn, rising ? r.token1 : r.token0)).toBe(true);
      expect(same(swap.tokenOut, rising ? r.token0 : r.token1)).toBe(true);
      expect(same(swap.recipient, owner)).toBe(true);
      expect(swap.deadline).toBe(CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS);
      const cap = need + (need * BigInt(LIQUIDITY_SLIPPAGE_BPS)) / BPS;
      expect(swap.amountIn).toBe(cap);
    },
  );

  it.each(cases)(
    "withdraws, collects and burns the whole dust position, from %s",
    (_, poolBps, target, childIsToken0) => {
      const r = realign(poolBps, target, childIsToken0);
      const tokenId = 424_242n;
      const dust = r.decoded[r.dustAt]!;
      const mint = dust.kind === "multicall" ? dust.inner.find((call) => call.name === "mint")! : undefined;
      if (mint?.name !== "mint" || r.state.status !== "empty") throw new Error("no dust mint");
      const { sqrtA, sqrtB } = fullRange(NEW_POOL_TICK_SPACING);

      const withdraw = decode(r.plan.steps[r.withdrawAt]!.build!({ tokenId, sqrtPriceX96: r.pool.sqrtPriceX96 }));

      expect(withdraw.kind).toBe("multicall");
      if (withdraw.kind !== "multicall") return;
      expect(withdraw.inner.map((call) => call.name)).toEqual(["decreaseLiquidity", "collect", "burn"]);
      expect(withdraw.inner[0]).toMatchObject({
        tokenId,
        liquidity: liquidityFor(r.state.sqrtPriceX96, sqrtA, sqrtB, mint.amount0Desired, mint.amount1Desired),
        deadline: CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS,
      });
      expect(withdraw.inner[1]).toMatchObject({ tokenId, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 });
      expect(withdraw.inner[1]!.name === "collect" && same(withdraw.inner[1]!.recipient, owner)).toBe(true);
      expect(withdraw.inner[2]).toEqual({ name: "burn", tokenId });
    },
  );

  it.each(cases)(
    "seeds the realigned pool at the target with no create, from %s",
    (_, poolBps, target, childIsToken0) => {
      const r = realign(poolBps, target, childIsToken0);
      const seedTx = r.decoded[r.seedAt]!;

      expect(
        seedTx.kind === "multicall" &&
          seedTx.inner.some(
            (call) => call.name === "create" && same(call.token0, r.token0) && same(call.token1, r.token1),
          ),
      ).toBe(false);
      expectSeedMins(r.pool);
    },
  );

  it.each(cases)(
    "approves exactly what the dust mint, the swap and the seed pull, from %s",
    (_, poolBps, target, childIsToken0) => {
      const r = realign(poolBps, target, childIsToken0);

      expect(approvalMismatches(r.s, r.txs)).toEqual([]);
    },
  );
});

describe("seed calldata (L4, L5, L7)", () => {
  const mixed = { up: missing, down: live(4_500n, true, 60) };

  it("puts a branch's creates and seed mints in one position manager multicall, each create before its mint", () => {
    const { plan, txs } = seed({ up: missing, down: missing });
    const up = seedMintOf(txs, plan.branches[0]!.pools.up);
    const down = seedMintOf(txs, plan.branches[0]!.pools.down);
    const multicall = decode(txs[up.index]!);

    expect(down.index).toBe(up.index);
    expect(same(txs[up.index]!.to, LIST.positionManager)).toBe(true);
    if (multicall.kind !== "multicall") throw new Error("not a multicall");
    const names = multicall.inner.map((call) => call.name);
    expect(names.filter((name) => name === "create")).toHaveLength(2);
    for (const pool of [plan.branches[0]!.pools.up, plan.branches[0]!.pools.down]) {
      const createAt = multicall.inner.findIndex(
        (call) => call.name === "create" && same(call.token0, pool.token0) && same(call.token1, pool.token1),
      );
      const mintAt = multicall.inner.findIndex(
        (call) => call.name === "mint" && same(call.token0, pool.token0) && same(call.token1, pool.token1),
      );
      expect(createAt).toBeGreaterThanOrEqual(0);
      expect(mintAt).toBeGreaterThan(createAt);
    }
  });

  it("creates no pool that is live", () => {
    const { plan, txs } = seed(mixed);
    const { index } = seedMintOf(txs, plan.branches[0]!.pools.down);
    const multicall = decode(txs[index]!);

    expect(index).toBe(seedMintOf(txs, plan.branches[0]!.pools.up).index);
    expect(multicall.kind === "multicall" && multicall.inner.filter((call) => call.name === "create")).toHaveLength(1);
  });

  it.each([
    ["new pools", { up: missing, down: missing }],
    ["a new and a live pool", mixed],
  ])(
    "approves only the router and the position manager, each for exactly what the next call pulls, with %s",
    (_, pools) => {
      const { s, txs } = seed(pools);
      const spenders = txs.map(decode).flatMap((d) => (d.kind === "approve" ? [d.spender] : []));

      expect(approvalMismatches(s, txs)).toEqual([]);
      expect(spenders.length).toBeGreaterThan(0);
      for (const spender of spenders) {
        expect(same(spender, LIST.gnosisRouter) || same(spender, LIST.positionManager)).toBe(true);
      }
    },
  );

  it("splits at the parent, then the branch, before the branch's mints", () => {
    const { s, plan, txs } = seed({ up: missing, down: missing });
    const decoded = txs.map(decode);
    const parentAt = decoded.findIndex((d) => d.kind === "split" && same(d.market, s.parentMarket));
    const branchAt = decoded.findIndex((d) => d.kind === "split" && same(d.market, s.branches[0]!.childMarket));

    expect(parentAt).toBeGreaterThanOrEqual(0);
    expect(branchAt).toBeGreaterThan(parentAt);
    expect(seedMintOf(txs, plan.branches[0]!.pools.up).index).toBeGreaterThan(branchAt);
    for (const d of decoded) if (d.kind === "split") expect(same(d.collateral, s.collateral)).toBe(true);
  });

  it.each([CHAIN_TIME, CHAIN_TIME + 12_345n])(
    "dates every mint the chain's time %s plus LIQUIDITY_DEADLINE_SECONDS",
    (chainTime) => {
      const { txs } = seed({ up: missing, down: live(4_500n, true, 60) }, { chainTime });

      const mints = mintsOf(txs);
      expect(mints.length).toBe(2);
      for (const { mint } of mints) expect(mint.deadline).toBe(chainTime + LIQUIDITY_DEADLINE_SECONDS);
    },
  );

  it("decodes each seed mint to the pool plan field by field, paying the owner", () => {
    const { s, plan, txs } = seed(mixed);
    const b = s.branches[0]!;

    for (const [side, child] of [
      ["up", b.upToken],
      ["down", b.downToken],
    ] as const) {
      const pool = plan.branches[0]!.pools[side];
      const [token0, token1] = sortPair(child, b.outcome);
      const { mint } = seedMintOf(txs, pool);
      expect(same(pool.token0, token0) && same(pool.token1, token1)).toBe(true);
      expect({ ...mint, recipient: mint.recipient.toLowerCase() }).toEqual({
        token0: mint.token0,
        token1: mint.token1,
        tickLower: pool.tickLower,
        tickUpper: pool.tickUpper,
        amount0Desired: pool.amount0,
        amount1Desired: pool.amount1,
        amount0Min: pool.amount0Min,
        amount1Min: pool.amount1Min,
        recipient: owner.toLowerCase(),
        deadline: CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS,
        name: "mint",
      });
      expect(same(mint.token0, pool.token0) && same(mint.token1, pool.token1)).toBe(true);
    }
  });

  it("splits exactly the amounts the plan shows", () => {
    const { s, plan, txs } = seed(mixed);
    const splits = txs.map(decode).flatMap((d) => (d.kind === "split" ? [d] : []));

    expect(splits.map((d) => d.amount)).toEqual([plan.parentSplit, plan.branches[0]!.split]);
    expect(same(splits[0]!.market, s.parentMarket)).toBe(true);
    expect(same(splits[1]!.market, s.branches[0]!.childMarket)).toBe(true);
  });
});
