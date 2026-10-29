import fc from "fast-check";
import { isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  LIQUIDITY_DEADLINE_SECONDS,
  LIQUIDITY_SLIPPAGE_BPS,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
} from "../../oracle/tolerances";
import { planMerge, planRemove } from "../plan";
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
  owner,
  session,
  sortPair,
  userSqrtPrice,
} from "./support/session";

const RUNS = { seed: 20261027, numRuns: 150 } as const;
const same = (a: Address, b: Address) => isAddressEqual(a, b);

describe("remove plan (L6)", () => {
  const b = branch(1);
  const [token0, token1] = sortPair(b.upToken, b.outcome);

  function remove(liquidity: bigint, sqrtPriceX96: bigint, tickSpacing = 60, tokenId = 77n) {
    const { tickLower, tickUpper } = fullRange(tickSpacing);
    return planRemove({
      chainId: 100,
      owner,
      chainTime: CHAIN_TIME,
      sqrtPriceX96,
      positions: [{ tokenId, token0, token1, tickLower, tickUpper, liquidity }],
    });
  }

  function position(tokenId: bigint, liquidity: bigint, pair: readonly [Address, Address] = [token0, token1]) {
    const { tickLower, tickUpper } = fullRange(60);
    return { tokenId, token0: pair[0], token1: pair[1], tickLower, tickUpper, liquidity };
  }

  it("withdraws the full liquidity, collects everything to the owner and burns the position, in one multicall", () => {
    const plan = remove(10n ** 21n, userSqrtPrice(4_000n, true));
    const d = decode(plan.tx);

    expect(same(plan.tx.to, LIST.positionManager)).toBe(true);
    expect(plan.tx.value ?? 0n).toBe(0n);
    if (d.kind !== "multicall") throw new Error("not a multicall");
    expect(d.inner.map((call) => call.name)).toEqual(["decreaseLiquidity", "collect", "burn"]);
    expect(d.inner[0]).toEqual({
      name: "decreaseLiquidity",
      tokenId: 77n,
      liquidity: 10n ** 21n,
      amount0Min: plan.amount0Min,
      amount1Min: plan.amount1Min,
      deadline: CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS,
    });
    expect(d.inner[1]).toMatchObject({
      name: "collect",
      tokenId: 77n,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    expect(d.inner[1]!.name === "collect" && same(d.inner[1]!.recipient, owner)).toBe(true);
    expect(d.inner[2]).toEqual({ name: "burn", tokenId: 77n });
  });

  it("withdraws every position of a pool in one multicall, each held to its own minimums, and shows their sum", () => {
    const sqrtP = userSqrtPrice(4_000n, true);
    const [a, b] = [position(77n, 10n ** 21n), position(78n, 3n * 10n ** 20n)];
    const one = (each: typeof a) =>
      planRemove({ chainId: 100, owner, chainTime: CHAIN_TIME, sqrtPriceX96: sqrtP, positions: [each] });

    const plan = planRemove({ chainId: 100, owner, chainTime: CHAIN_TIME, sqrtPriceX96: sqrtP, positions: [a, b] });
    const d = decode(plan.tx);

    if (d.kind !== "multicall") throw new Error("not a multicall");
    expect(d.inner.map((call) => [call.name, "tokenId" in call ? call.tokenId : undefined])).toEqual([
      ["decreaseLiquidity", 77n],
      ["collect", 77n],
      ["burn", 77n],
      ["decreaseLiquidity", 78n],
      ["collect", 78n],
      ["burn", 78n],
    ]);
    for (const [at, each] of [
      [0, a],
      [3, b],
    ] as const) {
      expect(d.inner[at]).toMatchObject({
        liquidity: each.liquidity,
        amount0Min: one(each).amount0Min,
        amount1Min: one(each).amount1Min,
      });
    }
    for (const call of d.inner) if (call.name === "collect") expect(same(call.recipient, owner)).toBe(true);
    for (const field of ["amount0", "amount1", "amount0Min", "amount1Min"] as const) {
      expect(plan[field]).toBe(one(a)[field] + one(b)[field]);
    }
  });

  it("refuses no positions, positions of two pools, and a position named twice", () => {
    const at = { chainId: 100, owner, chainTime: CHAIN_TIME, sqrtPriceX96: userSqrtPrice(4_000n, true) };
    const down = sortPair(b.downToken, b.outcome);

    expect(() => planRemove({ ...at, positions: [] })).toThrow();
    expect(() =>
      planRemove({ ...at, positions: [position(77n, 10n ** 21n), position(78n, 10n ** 21n, down)] }),
    ).toThrow();
    expect(() => planRemove({ ...at, positions: [position(77n, 10n ** 21n), position(77n, 10n ** 21n)] })).toThrow();
  });

  it("shows what a full withdrawal returns at the current price and holds it to LIQUIDITY_SLIPPAGE_BPS below that", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 10n ** 15n, max: 10n ** 30n }),
        fc.bigInt({ min: MIN_SEED_PRICE_BPS, max: MAX_SEED_PRICE_BPS }),
        fc.boolean(),
        fc.constantFrom(1, 10, 60, 200),
        (liquidity, bps, childIsToken0, tickSpacing) => {
          const sqrtP = userSqrtPrice(bps, childIsToken0);
          const { sqrtA, sqrtB } = fullRange(tickSpacing);

          const plan = remove(liquidity, sqrtP, tickSpacing);

          expect(plan.amount0).toBe(amount0Delta(sqrtP, sqrtB, liquidity, false));
          expect(plan.amount1).toBe(amount1Delta(sqrtA, sqrtP, liquidity, false));
          for (const [shown, min] of [
            [plan.amount0, plan.amount0Min],
            [plan.amount1, plan.amount1Min],
          ] as const) {
            const floor = (shown * (BPS - BigInt(LIQUIDITY_SLIPPAGE_BPS))) / BPS;
            expect(min).toBeGreaterThan(0n);
            expect(min).toBeGreaterThanOrEqual(floor);
            expect(min).toBeLessThanOrEqual(floor + 1n);
          }
        },
      ),
      RUNS,
    );
  });
});

describe("merge plan (L6)", () => {
  const s = session([branch(1), branch(2)]);
  const [b1, b2] = s.branches as [(typeof s.branches)[0], (typeof s.branches)[0]];

  it("merges min(UP, DOWN, INVALID) at each branch, then every parent outcome including INVALID", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 24n }), { minLength: 10, maxLength: 10 }),
        ([o1, up1, down1, inv1, o2, up2, down2, inv2, parentInv]) => {
          const min = (...xs: bigint[]) => xs.reduce((a, x) => (x < a ? x : a));
          const m1 = min(up1!, down1!, inv1!);
          const m2 = min(up2!, down2!, inv2!);
          const parent = min(o1! + m1, o2! + m2, parentInv!);

          const plan = planMerge({
            session: s,
            owner,
            balances: {
              branches: [
                { outcome: o1!, up: up1!, down: down1!, invalid: inv1! },
                { outcome: o2!, up: up2!, down: down2!, invalid: inv2! },
              ],
              parentInvalid: parentInv!,
            },
          });
          const merges = plan.txs.map(decode).flatMap((d) => (d.kind === "merge" ? [d] : []));
          const expected = [
            ...(m1 > 0n ? [[b1.childMarket, m1] as const] : []),
            ...(m2 > 0n ? [[b2.childMarket, m2] as const] : []),
            ...(parent > 0n ? [[s.parentMarket, parent] as const] : []),
          ];

          expect(plan.branches.map((each) => each.merge)).toEqual([m1, m2]);
          expect(plan.parentMerge).toBe(parent);
          expect(merges.map((d) => [d.market.toLowerCase(), d.amount])).toEqual(
            expected.map(([market, amount]) => [market.toLowerCase(), amount]),
          );
          for (const d of merges) expect(same(d.collateral, s.collateral)).toBe(true);
          expect(approvalMismatches(s, plan.txs)).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("approves each of the three tokens a merge pulls to the router, for exactly the merged amount", () => {
    const plan = planMerge({
      session: s,
      owner,
      balances: {
        branches: [
          { outcome: 5n, up: 40n, down: 30n, invalid: 35n },
          { outcome: 50n, up: 9n, down: 9n, invalid: 9n },
        ],
        parentInvalid: 100n,
      },
    });
    const approvals = plan.txs
      .map(decode)
      .flatMap((d) => (d.kind === "approve" ? [[d.token.toLowerCase(), d.spender.toLowerCase(), d.amount]] : []));
    const router = LIST.gnosisRouter.toLowerCase();

    expect(approvals).toEqual(
      expect.arrayContaining([
        [b1.upToken.toLowerCase(), router, 30n],
        [b1.downToken.toLowerCase(), router, 30n],
        [b1.invalidToken.toLowerCase(), router, 30n],
        [b2.upToken.toLowerCase(), router, 9n],
        [b2.downToken.toLowerCase(), router, 9n],
        [b2.invalidToken.toLowerCase(), router, 9n],
        [b1.outcome.toLowerCase(), router, 35n],
        [b2.outcome.toLowerCase(), router, 35n],
        [s.parentInvalid.toLowerCase(), router, 35n],
      ]),
    );
    expect(approvals).toHaveLength(9);
    expect(plan.parentMerge).toBe(35n);
  });

  it("merges the branches before the parent that needs their outcome tokens", () => {
    const plan = planMerge({
      session: s,
      owner,
      balances: {
        branches: [
          { outcome: 0n, up: 10n, down: 10n, invalid: 10n },
          { outcome: 0n, up: 10n, down: 10n, invalid: 10n },
        ],
        parentInvalid: 10n,
      },
    });
    const markets = plan.txs.map(decode).flatMap((d) => (d.kind === "merge" ? [d.market.toLowerCase()] : []));

    expect(markets).toEqual([b1.childMarket.toLowerCase(), b2.childMarket.toLowerCase(), s.parentMarket.toLowerCase()]);
    expect(plan.parentMerge).toBe(10n);
    for (const tx of plan.txs) expect(tx.value ?? 0n).toBe(0n);
  });
});
