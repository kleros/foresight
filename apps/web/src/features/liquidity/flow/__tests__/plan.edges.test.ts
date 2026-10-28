import fc from "fast-check";
import { isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  LIQUIDITY_SLIPPAGE_BPS,
  NEW_POOL_TICK_SPACING,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
} from "../../oracle/tolerances";
import { planMerge, planRemove, planSeed } from "../plan";
import {
  BPS,
  CHAIN_TIME,
  LIST,
  amount0Delta,
  amount1Delta,
  branch,
  decode,
  fullRange,
  missing,
  mintPulls,
  movedSqrtPrice,
  owner,
  session,
  txsOf,
  userSqrtPrice,
  type PoolStateInput,
} from "./support/session";

const RUNS = { seed: 20261027, numRuns: 100 } as const;
const WAD = 10n ** 18n;
const same = (a: Address, b: Address) => isAddressEqual(a, b);

function seed(pools: { up: PoolStateInput; down: PoolStateInput }, upPriceBps = 5_000n, depth = 1_000n * WAD) {
  const s = session([branch(1)]);
  const plan = planSeed({
    session: s,
    owner,
    total: depth,
    collateral: "sDAI",
    chainTime: CHAIN_TIME,
    branches: [{ depth, upPriceBps, pools }],
  });
  return { s, plan, decoded: txsOf(plan.steps).map(decode) };
}

describe("pools that are neither new nor live", () => {
  it("seeds an empty pool already at the target price without a realign, held to the tick tolerance", () => {
    const state: PoolStateInput = {
      status: "empty",
      sqrtPriceX96: userSqrtPrice(3_000n, true),
      tickSpacing: NEW_POOL_TICK_SPACING,
    };
    const { plan, decoded } = seed({ up: state, down: missing }, 3_000n);
    const pool = plan.branches[0]!.pools.up;
    const { sqrtA, sqrtB } = fullRange(NEW_POOL_TICK_SPACING);

    expect(pool).toMatchObject({ create: false, realign: false, priceLocked: false });
    expect(decoded.some((d) => d.kind === "swap")).toBe(false);
    expect(plan.steps.some((step) => step.build !== undefined)).toBe(false);
    expect(pool.amount0Min).toBe(
      mintPulls(movedSqrtPrice(pool.sqrtPriceX96, 1), sqrtA, sqrtB, pool.amount0, pool.amount1).amount0,
    );
    expect(pool.amount1Min).toBe(
      mintPulls(movedSqrtPrice(pool.sqrtPriceX96, -1), sqrtA, sqrtB, pool.amount0, pool.amount1).amount1,
    );
  });

  it("realigns a live pool that holds no liquidity instead of locking to its price", () => {
    const state: PoolStateInput = {
      status: "live",
      sqrtPriceX96: userSqrtPrice(100n, true),
      liquidity: 0n,
      tickSpacing: NEW_POOL_TICK_SPACING,
    };
    const { plan, decoded } = seed({ up: state, down: missing }, 6_000n);

    expect(plan.branches[0]!.pools.up).toMatchObject({ create: false, realign: true, priceLocked: false });
    expect(plan.branches[0]!.pools.up.sqrtPriceX96).toBe(userSqrtPrice(6_000n, true));
    expect(decoded.filter((d) => d.kind === "swap")).toHaveLength(1);
  });
});

describe("a realign's dust withdrawal", () => {
  it.each([
    ["rising, child token0", 100n, 6_000n, true],
    ["rising, child token1", 100n, 6_000n, false],
    ["falling, child token0", 9_900n, 2_000n, true],
    ["falling, child token1", 9_900n, 2_000n, false],
  ] as const)(
    "holds to the dust's amounts at the pool's price read at build less slippage, %s",
    (_, poolBps, target, order) => {
      const pool: PoolStateInput = {
        status: "empty",
        sqrtPriceX96: userSqrtPrice(poolBps, order),
        tickSpacing: NEW_POOL_TICK_SPACING,
      };
      const s = session([branch(1, { up: order, down: !order })]);
      const plan = planSeed({
        session: s,
        owner,
        total: 1_000n * WAD,
        collateral: "sDAI",
        chainTime: CHAIN_TIME,
        branches: [{ depth: 1_000n * WAD, upPriceBps: target, pools: { up: pool, down: missing } }],
      });
      const step = plan.steps.find((each) => each.build !== undefined)!;
      const { sqrtA, sqrtB } = fullRange(NEW_POOL_TICK_SPACING);
      const less = (amount: bigint) => (amount * (BPS - BigInt(LIQUIDITY_SLIPPAGE_BPS))) / BPS;
      // the target, and a capped swap's stop short of it
      const reads = [plan.branches[0]!.pools.up.sqrtPriceX96, userSqrtPrice((poolBps + target) / 2n, order)];

      for (const read of reads) {
        const withdraw = decode(step.build!({ tokenId: 1n, sqrtPriceX96: read }));
        const decrease = withdraw.kind === "multicall" ? withdraw.inner[0]! : undefined;
        if (decrease?.name !== "decreaseLiquidity") throw new Error("no dust withdrawal");

        expect(decrease.amount0Min).toBe(less(amount0Delta(read, sqrtB, decrease.liquidity, false)));
        expect(decrease.amount1Min).toBe(less(amount1Delta(sqrtA, read, decrease.liquidity, false)));
      }
    },
  );
});

describe("a realigned branch's budget", () => {
  it("never approves more of a token to the position manager and the swap router than the splits minted", () => {
    const priceBps = fc.bigInt({ min: MIN_SEED_PRICE_BPS, max: MAX_SEED_PRICE_BPS });
    fc.assert(
      fc.property(
        fc.bigInt({ min: 10n ** 15n, max: 10n ** 24n }),
        priceBps,
        priceBps,
        priceBps,
        fc.record({ up: fc.boolean(), down: fc.boolean() }),
        (depth, poolUp, poolDown, target, order) => {
          const tokens = branch(1, order);
          const s = session([tokens]);
          const empty = (bps: bigint, childIsToken0: boolean): PoolStateInput => ({
            status: "empty",
            sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
            tickSpacing: NEW_POOL_TICK_SPACING,
          });
          const plan = planSeed({
            session: s,
            owner,
            total: depth,
            collateral: "sDAI",
            chainTime: CHAIN_TIME,
            branches: [
              { depth, upPriceBps: target, pools: { up: empty(poolUp, order.up), down: empty(poolDown, order.down) } },
            ],
          });
          const approved = (token: Address) =>
            txsOf(plan.steps)
              .map(decode)
              .filter(
                (d) =>
                  d.kind === "approve" &&
                  same(d.token, token) &&
                  (same(d.spender, LIST.positionManager) || same(d.spender, LIST.swaprRouter)),
              )
              .reduce((sum, d) => sum + (d.kind === "approve" ? d.amount : 0n), 0n);
          const split = plan.branches[0]!.split;

          // the realign's dust and swap input are out of the wallet until its withdrawal lands
          expect(approved(tokens.upToken)).toBeLessThanOrEqual(split);
          expect(approved(tokens.downToken)).toBeLessThanOrEqual(split);
          expect(approved(tokens.outcome)).toBeLessThanOrEqual(plan.parentSplit - split);
        },
      ),
      RUNS,
    );
  });
});

describe("plans it refuses to build", () => {
  const s = session([branch(1)]);
  const base = {
    session: s,
    owner,
    chainTime: CHAIN_TIME,
    branches: [{ depth: 10n * WAD, upPriceBps: 5_000n, pools: { up: missing, down: missing } }],
  };

  it("refuses an sDAI seed whose deepest branch needs more than T", () => {
    expect(() => planSeed({ ...base, total: 10n * WAD - 1n, collateral: "sDAI" })).toThrow();
    expect(() => planSeed({ ...base, total: 10n * WAD, collateral: "sDAI" })).not.toThrow();
  });

  it("refuses a seed that leaves a branch of the session unplanned", () => {
    const two = session([branch(1), branch(2)]);

    expect(() => planSeed({ ...base, session: two, total: 10n * WAD, collateral: "sDAI" })).toThrow("every branch");
    expect(() => planSeed({ ...base, session: two, total: 10n * WAD, collateral: "sDAI", branches: [] })).toThrow(
      "every branch",
    );
  });

  it("refuses an xDAI seed without the vault's preview", () => {
    expect(() => planSeed({ ...base, total: 10n * WAD, collateral: "xDAI" })).toThrow();
  });

  it.each([
    ["a new pool", missing, 1n],
    ["a live pool", { status: "live", sqrtPriceX96: userSqrtPrice(5_000n, true), liquidity: WAD, tickSpacing: 60 }, 3n],
  ] satisfies [string, PoolStateInput, bigint][])(
    "refuses a seed into %s too small to carry non-zero minimums",
    (_, up, depth) => {
      const tiny = (d: bigint) =>
        planSeed({
          ...base,
          total: d,
          collateral: "sDAI",
          branches: [{ ...base.branches[0]!, depth: d, pools: { up, down: missing } }],
        });

      expect(() => tiny(depth)).toThrow("non-zero minimums");
      expect(() => tiny(1_000n)).not.toThrow();
    },
  );

  it("refuses a chain without an allow-list", () => {
    const elsewhere = { ...s, chainId: 999_999 };
    const { tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);

    expect(() => planSeed({ ...base, session: elsewhere, total: 10n * WAD, collateral: "sDAI" })).toThrow();
    expect(() =>
      planRemove({
        chainId: 999_999,
        owner,
        chainTime: CHAIN_TIME,
        sqrtPriceX96: userSqrtPrice(5_000n, true),
        position: {
          tokenId: 1n,
          token0: s.branches[0]!.upToken,
          token1: s.branches[0]!.outcome,
          tickLower,
          tickUpper,
          liquidity: WAD,
        },
      }),
    ).toThrow();
    expect(() =>
      planMerge({
        session: elsewhere,
        owner,
        balances: { branches: [{ outcome: 1n, up: 1n, down: 1n, invalid: 1n }], parentInvalid: 1n },
      }),
    ).toThrow();
  });

  it("sends nothing for a merge with no complete set", () => {
    const plan = planMerge({
      session: s,
      owner,
      balances: { branches: [{ outcome: 0n, up: 5n, down: 0n, invalid: 5n }], parentInvalid: 9n },
    });

    expect(plan).toEqual({ branches: [{ merge: 0n }], parentMerge: 0n, txs: [] });
  });
});
