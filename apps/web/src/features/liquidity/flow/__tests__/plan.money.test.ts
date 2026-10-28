import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import { isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  DUST_WEI,
  LIQUIDITY_SLIPPAGE_BPS,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
  MINT_RATE_MARGIN_BPS,
  NEW_POOL_TICK_SPACING,
} from "../../oracle/tolerances";
import { planSeed } from "../plan";
import {
  BPS,
  CHAIN_TIME,
  amount0Delta,
  amount1Delta,
  branch,
  decode,
  fullRange,
  leftoverOf,
  missing,
  mintPulls,
  owner,
  sDai,
  seedMintOf,
  session,
  sortPair,
  txsOf,
  userSqrtPrice,
  type PoolStateInput,
} from "./support/session";

/** Fixed so a failure names a reproducible case; fast-check prints the shrunk counterexample. */
const RUNS = { seed: 20261027, numRuns: 150 } as const;

const size = fc.bigInt({ min: 10n ** 15n, max: 10n ** 24n });
const priceBps = fc.bigInt({ min: MIN_SEED_PRICE_BPS, max: MAX_SEED_PRICE_BPS });
const ordering = fc.record({ up: fc.boolean(), down: fc.boolean() });

type Session = ReturnType<typeof session>;
const same = (a: Address, b: Address) => isAddressEqual(a, b);

/**
 * Replays `txs` against the wallet of a run that starts with `total` sDAI: Seer's split and the mint each pull
 * what the protocol would. A mint meets the sqrt price its multicall's create names, else the pool's live one.
 * `fromBase` is what an xDAI split mints of each parent outcome.
 */
function replay(
  s: Session,
  total: bigint,
  txs: FlowTx[],
  livePrice: (pair: [Address, Address]) => bigint | undefined,
  fromBase = 0n,
) {
  const balance = new Map<string, bigint>([[sDai.toLowerCase(), total]]);
  const move = (token: Address, delta: bigint) => {
    const next = (balance.get(token.toLowerCase()) ?? 0n) + delta;
    if (next < 0n) throw new Error(`the run spends ${-next} more ${token} than the wallet holds`);
    balance.set(token.toLowerCase(), next);
  };
  for (const tx of txs) {
    const d = decode(tx);
    if (d.kind === "splitFromBase") {
      for (const b of s.branches) move(b.outcome, fromBase);
      move(s.parentInvalid, fromBase);
    } else if (d.kind === "split" && same(d.market, s.parentMarket)) {
      move(s.collateral, -d.amount);
      for (const b of s.branches) move(b.outcome, d.amount);
      move(s.parentInvalid, d.amount);
    } else if (d.kind === "split") {
      const b = s.branches.find((each) => same(each.childMarket, d.market))!;
      move(b.outcome, -d.amount);
      for (const token of [b.upToken, b.downToken, b.invalidToken]) move(token, d.amount);
    } else if (d.kind === "multicall") {
      const created = new Map<string, bigint>();
      for (const call of d.inner) {
        if (call.name !== "create" && call.name !== "mint") continue;
        const pair = `${call.token0}|${call.token1}`.toLowerCase();
        if (call.name === "create") {
          created.set(pair, call.sqrtPriceX96);
          continue;
        }
        const sqrtP = created.get(pair) ?? livePrice([call.token0, call.token1]);
        if (sqrtP === undefined) throw new Error(`mint into ${pair}, which neither exists nor is created`);
        const range = { sqrtA: sqrtPriceOf(call.tickLower), sqrtB: sqrtPriceOf(call.tickUpper) };
        const pulled = mintPulls(sqrtP, range.sqrtA, range.sqrtB, call.amount0Desired, call.amount1Desired);
        move(call.token0, -pulled.amount0);
        move(call.token1, -pulled.amount1);
      }
    }
  }
  return (token: Address) => balance.get(token.toLowerCase()) ?? 0n;
}

const sqrtPriceOf = (tick: number) => {
  const spacing = [1, 10, 60, 200].find((each) => fullRange(each).tickUpper === Math.abs(tick));
  if (spacing === undefined) throw new Error(`tick ${tick} is not a full-range bound`);
  return tick < 0 ? fullRange(spacing).sqrtA : fullRange(spacing).sqrtB;
};

describe("seed amounts (L1)", () => {
  it("splits max(A_O) at the parent and floor(A_O / 2) at each branch, whatever the depths and prices", () => {
    fc.assert(
      fc.property(size, size, fc.bigInt({ min: 0n, max: 10n ** 24n }), priceBps, priceBps, (d1, d2, extra, p1, p2) => {
        const s = session();
        const total = (d1 > d2 ? d1 : d2) + extra;
        const plan = planSeed({
          session: s,
          owner,
          total,
          collateral: "sDAI",
          chainTime: CHAIN_TIME,
          branches: [
            { depth: d1, upPriceBps: p1, pools: { up: missing, down: missing } },
            { depth: d2, upPriceBps: p2, pools: { up: missing, down: missing } },
          ],
        });
        const splits = txsOf(plan.steps)
          .map(decode)
          .filter((d) => d.kind === "split");

        expect(plan.parentSplit).toBe(d1 > d2 ? d1 : d2);
        expect(plan.branches.map((b) => b.split)).toEqual([d1 / 2n, d2 / 2n]);
        expect(splits.map((d) => [d.market.toLowerCase(), d.amount])).toEqual([
          [s.parentMarket.toLowerCase(), d1 > d2 ? d1 : d2],
          [s.branches[0]!.childMarket.toLowerCase(), d1 / 2n],
          [s.branches[1]!.childMarket.toLowerCase(), d2 / 2n],
        ]);
      }),
      RUNS,
    );
  });

  it("mints each new pool's shown amounts from the liquidity at the exact sqrt price, rounded up, in either token order", () => {
    fc.assert(
      fc.property(size, priceBps, ordering, (depth, up, order) => {
        const s = session([branch(1, order)]);
        const plan = planSeed({
          session: s,
          owner,
          total: depth,
          collateral: "sDAI",
          chainTime: CHAIN_TIME,
          branches: [{ depth, upPriceBps: up, pools: { up: missing, down: missing } }],
        });
        const txs = txsOf(plan.steps);

        for (const side of ["up", "down"] as const) {
          const pool = plan.branches[0]!.pools[side];
          const { sqrtA, sqrtB, tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);
          const { mint } = seedMintOf(txs, pool);
          expect([pool.tickLower, pool.tickUpper, mint.tickLower, mint.tickUpper]).toEqual([
            tickLower,
            tickUpper,
            tickLower,
            tickUpper,
          ]);
          expect(pool.amount0).toBe(amount0Delta(pool.sqrtPriceX96, sqrtB, pool.liquidity, true));
          expect(pool.amount1).toBe(amount1Delta(sqrtA, pool.sqrtPriceX96, pool.liquidity, true));
          const pulled = mintPulls(pool.sqrtPriceX96, sqrtA, sqrtB, mint.amount0Desired, mint.amount1Desired);
          expect(pulled.liquidity).toBeGreaterThanOrEqual(pool.liquidity);
          expect(pool.amount0 - pulled.amount0).toBeGreaterThanOrEqual(0n);
          expect(pool.amount0 - pulled.amount0).toBeLessThanOrEqual(1n);
          expect(pool.amount1 - pulled.amount1).toBeGreaterThanOrEqual(0n);
          expect(pool.amount1 - pulled.amount1).toBeLessThanOrEqual(1n);
        }
      }),
      RUNS,
    );
  });

  it("uses the branch's whole depth across its two new pools, leaving under DUST_WEI of each token", () => {
    fc.assert(
      fc.property(size, priceBps, ordering, (depth, up, order) => {
        const s = session([branch(1, order)]);
        const b = s.branches[0]!;
        const plan = planSeed({
          session: s,
          owner,
          total: depth,
          collateral: "sDAI",
          chainTime: CHAIN_TIME,
          branches: [{ depth, upPriceBps: up, pools: { up: missing, down: missing } }],
        });
        const left = replay(s, depth, txsOf(plan.steps), () => undefined);

        for (const token of [b.outcome, b.upToken, b.downToken]) expect(left(token)).toBeLessThan(DUST_WEI);
      }),
      RUNS,
    );
  });

  it("lists every token the run leaves in the wallet, both INVALIDs and unused depth included", () => {
    fc.assert(
      fc.property(
        size,
        size,
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        priceBps,
        priceBps,
        ordering,
        (d1, d2, extra, p1, p2, order) => {
          const s = session([branch(1, order), branch(2, { up: order.down, down: order.up })]);
          const total = (d1 > d2 ? d1 : d2) + extra;
          const plan = planSeed({
            session: s,
            owner,
            total,
            collateral: "sDAI",
            chainTime: CHAIN_TIME,
            branches: [
              { depth: d1, upPriceBps: p1, pools: { up: missing, down: missing } },
              { depth: d2, upPriceBps: p2, pools: { up: missing, down: missing } },
            ],
          });
          const left = replay(s, total, txsOf(plan.steps), () => undefined);
          const tokens = [
            s.collateral,
            s.parentInvalid,
            ...s.branches.flatMap((b) => [b.outcome, b.upToken, b.downToken, b.invalidToken]),
          ];

          expect(leftoverOf(plan.leftovers, s.collateral)).toBe(extra);
          expect(leftoverOf(plan.leftovers, s.parentInvalid)).toBe(d1 > d2 ? d1 : d2);
          expect(leftoverOf(plan.leftovers, s.branches[0]!.invalidToken)).toBe(d1 / 2n);
          expect(leftoverOf(plan.leftovers, s.branches[1]!.invalidToken)).toBe(d2 / 2n);
          for (const token of tokens) {
            // a mint may pull one wei under its rounded-up shown amount, per pool, and O feeds two pools
            expect(left(token) - leftoverOf(plan.leftovers, token)).toBeGreaterThanOrEqual(0n);
            expect(left(token) - leftoverOf(plan.leftovers, token)).toBeLessThanOrEqual(2n);
          }
        },
      ),
      RUNS,
    );
  });

  it("never spends more of a token than the run has, into live pools at any price and tick spacing", () => {
    const live = fc.record({
      bps: priceBps,
      liquidity: fc.bigInt({ min: 1n, max: 10n ** 24n }),
      tickSpacing: fc.constantFrom(1, 10, 60, 200),
    });
    fc.assert(
      fc.property(size, priceBps, ordering, live, live, (depth, up, order, upPool, downPool) => {
        const s = session([branch(1, order)]);
        const b = s.branches[0]!;
        const state = (pool: typeof upPool, childIsToken0: boolean): PoolStateInput => ({
          status: "live",
          sqrtPriceX96: userSqrtPrice(pool.bps, childIsToken0),
          liquidity: pool.liquidity,
          tickSpacing: pool.tickSpacing,
        });
        const pools = { up: state(upPool, order.up), down: state(downPool, order.down) };
        const plan = planSeed({
          session: s,
          owner,
          total: depth,
          collateral: "sDAI",
          chainTime: CHAIN_TIME,
          branches: [{ depth, upPriceBps: up, pools }],
        });
        const livePrice = ([token0, token1]: [Address, Address]) => {
          for (const [child, pool] of [
            [b.upToken, pools.up],
            [b.downToken, pools.down],
          ] as const) {
            const [t0, t1] = sortPair(child, b.outcome);
            if (same(t0, token0) && same(t1, token1) && pool.status === "live") return pool.sqrtPriceX96;
          }
          return undefined;
        };
        const left = replay(s, depth, txsOf(plan.steps), livePrice);

        for (const token of [b.outcome, b.upToken, b.downToken]) {
          expect(left(token) - leftoverOf(plan.leftovers, token)).toBeGreaterThanOrEqual(0n);
          expect(left(token) - leftoverOf(plan.leftovers, token)).toBeLessThanOrEqual(2n);
        }
        for (const side of ["up", "down"] as const) {
          const pool = plan.branches[0]!.pools[side];
          const { sqrtA, sqrtB, tickUpper } = fullRange((side === "up" ? upPool : downPool).tickSpacing);
          expect(pool.tickUpper).toBe(tickUpper);
          expect(pool.amount0).toBe(amount0Delta(pool.sqrtPriceX96, sqrtB, pool.liquidity, true));
          expect(pool.amount1).toBe(amount1Delta(sqrtA, pool.sqrtPriceX96, pool.liquidity, true));
          for (const [shown, min] of [
            [pool.amount0, pool.amount0Min],
            [pool.amount1, pool.amount1Min],
          ] as const) {
            const floor = (shown * (BPS - BigInt(LIQUIDITY_SLIPPAGE_BPS))) / BPS;
            expect(min).toBeGreaterThanOrEqual(floor);
            expect(min).toBeLessThanOrEqual(floor + 1n);
          }
        }
      }),
      RUNS,
    );
  });
});

describe("xDAI seed amounts (L12)", () => {
  it("caps each branch's depth at previewDeposit(T) less MINT_RATE_MARGIN_BPS and sends T as native value", () => {
    fc.assert(
      fc.property(size, fc.bigInt({ min: 9_000n, max: 10_000n }), priceBps, (total, rateBps, up) => {
        const s = session();
        const previewDeposit = (total * rateBps) / BPS;
        const cap = previewDeposit - (previewDeposit * MINT_RATE_MARGIN_BPS) / BPS;
        const lowered = cap / 3n;
        const plan = planSeed({
          session: s,
          owner,
          total,
          collateral: "xDAI",
          previewDeposit,
          chainTime: CHAIN_TIME,
          branches: [
            { depth: total, upPriceBps: up, pools: { up: missing, down: missing } },
            { depth: lowered, upPriceBps: up, pools: { up: missing, down: missing } },
          ],
        });
        const decoded = txsOf(plan.steps).map(decode);
        const native = decoded.filter((d) => d.value !== 0n);

        expect(plan.branches.map((b) => b.depth)).toEqual([cap, lowered]);
        expect(plan.branches.map((b) => b.split)).toEqual([cap / 2n, lowered / 2n]);
        expect(native).toHaveLength(1);
        expect(native[0]!.kind).toBe("splitFromBase");
        expect(native[0]!.kind === "splitFromBase" && same(native[0]!.market, s.parentMarket)).toBe(true);
        expect(native[0]!.value).toBe(total);
        expect(decoded.filter((d) => d.kind === "approve" && same(d.token, s.collateral))).toEqual([]);
      }),
      RUNS,
    );
  });

  it("lists what the split leaves of every parent outcome when the branches take less than it mints", () => {
    fc.assert(
      fc.property(size, fc.bigInt({ min: 9_000n, max: 10_000n }), priceBps, ordering, (total, rateBps, up, order) => {
        const s = session([branch(1, order), branch(2, { up: order.down, down: order.up })]);
        const previewDeposit = (total * rateBps) / BPS;
        const cap = previewDeposit - (previewDeposit * MINT_RATE_MARGIN_BPS) / BPS;
        const plan = planSeed({
          session: s,
          owner,
          total,
          collateral: "xDAI",
          previewDeposit,
          chainTime: CHAIN_TIME,
          branches: [
            { depth: cap / 3n, upPriceBps: up, pools: { up: missing, down: missing } },
            { depth: cap / 5n, upPriceBps: up, pools: { up: missing, down: missing } },
          ],
        });
        const left = replay(s, 0n, txsOf(plan.steps), () => undefined, cap);

        expect(leftoverOf(plan.leftovers, s.parentInvalid)).toBe(cap);
        for (const token of [
          s.parentInvalid,
          ...s.branches.flatMap((b) => [b.outcome, b.upToken, b.downToken, b.invalidToken]),
        ]) {
          expect(left(token) - leftoverOf(plan.leftovers, token)).toBeGreaterThanOrEqual(0n);
          expect(left(token) - leftoverOf(plan.leftovers, token)).toBeLessThanOrEqual(2n);
        }
      }),
      RUNS,
    );
  });
});
