import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import { encodeFunctionData, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { gnosisRouterAbi } from "@/config/contracts";

import {
  LIQUIDITY_DEADLINE_SECONDS,
  MAX_SEED_PRICE_BPS,
  MIN_SEED_PRICE_BPS,
  NEW_POOL_TICK_SPACING,
} from "../../oracle/tolerances";
import { departures } from "../allowed";
import { planSeed } from "../plan";
import {
  APPROVE_ABI,
  BPS,
  CHAIN_TIME,
  LIST,
  MAX_UINT128,
  NFPM_ABI,
  approvalMismatches,
  branch,
  decode,
  fullRange,
  mintsOf,
  missing,
  owner,
  sDai,
  session,
  sortPair,
  stranger,
  txsOf,
  userSqrtPrice,
  type BranchTokens,
  type Decoded,
  type PoolStateInput,
} from "./support/session";

const RUNS = { seed: 20261027, numRuns: 100 } as const;
const same = (a: Address, b: Address) => isAddressEqual(a, b);
const WAD = 10n ** 18n;

const seedPrice = fc.bigInt({ min: MIN_SEED_PRICE_BPS, max: MAX_SEED_PRICE_BPS });
const ordering = fc.record({ up: fc.boolean(), down: fc.boolean() });
const spacing = fc.constantFrom(1, 10, 60, 200);

/** A pool state for a child priced at the pool's own `bps`, in the given token order. */
const poolState = (childIsToken0: boolean) =>
  fc.oneof(
    fc.constant(missing),
    fc
      .record({ bps: seedPrice, liquidity: fc.bigInt({ min: 1n, max: MAX_UINT128 }), tickSpacing: spacing })
      .map(({ bps, liquidity, tickSpacing }): PoolStateInput => ({
        status: "live",
        sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
        liquidity,
        tickSpacing,
      })),
    seedPrice.map((bps): PoolStateInput => ({
      status: "empty",
      sqrtPriceX96: userSqrtPrice(bps, childIsToken0),
      tickSpacing: NEW_POOL_TICK_SPACING,
    })),
  );

const branchCase = (index: number) =>
  ordering.chain((order) =>
    fc.record({
      tokens: fc.constant(branch(index, order)),
      upPriceBps: seedPrice,
      depth: fc.bigInt({ min: WAD, max: 10n ** 6n * WAD }),
      up: poolState(order.up),
      down: poolState(order.down),
    }),
  );

const runCase = fc.record({
  branches: fc
    .tuple(branchCase(1), branchCase(2), branchCase(3))
    .chain((all) => fc.integer({ min: 1, max: 3 }).map((count) => all.slice(0, count))),
  chainTime: fc.bigInt({ min: CHAIN_TIME, max: CHAIN_TIME + 10n ** 6n }),
});

type RunCase = typeof runCase extends fc.Arbitrary<infer T> ? T : never;

function buildRun(c: RunCase) {
  const s = session(c.branches.map((each) => each.tokens));
  const total = c.branches.reduce((max, each) => (each.depth > max ? each.depth : max), 0n);
  const plan = planSeed({
    session: s,
    owner,
    total,
    collateral: "sDAI",
    chainTime: c.chainTime,
    branches: c.branches.map((each) => ({
      depth: each.depth,
      upPriceBps: each.upPriceBps,
      pools: { up: each.up, down: each.down },
    })),
  });
  const txs = txsOf(plan.steps);
  return { s, plan, txs, decoded: txs.map(decode) };
}

const pairsOf = (tokens: BranchTokens) =>
  [tokens.upToken, tokens.downToken].map((child) => sortPair(child, tokens.outcome).join("|").toLowerCase());
const pairOf = (call: { token0: Address; token1: Address }) => `${call.token0}|${call.token1}`.toLowerCase();

// each property plans a hundred multi-branch runs, about 2-6s a test under a full parallel run
describe("a seed run across several branches (A1, A4)", { timeout: 30_000 }, () => {
  it("puts each branch's creates and seed mints in one position manager multicall naming only its own pairs", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { plan, txs, decoded } = buildRun(c);

        plan.branches.forEach((planned, index) => {
          const tokens = c.branches[index]!.tokens;
          const seedAt = [planned.pools.up, planned.pools.down].map((pool) => {
            const found = mintsOf(txs).filter(
              ({ mint }) =>
                pairOf(mint) === pairOf(pool) &&
                mint.amount0Desired === pool.amount0 &&
                mint.amount1Desired === pool.amount1,
            );
            expect(found).toHaveLength(1);
            return found[0]!.index;
          });
          expect(seedAt[1]).toBe(seedAt[0]);
          const multicall = decoded[seedAt[0]!]!;
          expect(same(txs[seedAt[0]!]!.to, LIST.positionManager)).toBe(true);
          if (multicall.kind !== "multicall") throw new Error("seed mints outside a multicall");
          const creates = multicall.inner.filter((call) => call.name === "create");
          const created = [planned.pools.up, planned.pools.down].filter((pool) => pool.create);
          expect(creates.map(pairOf)).toEqual(created.map(pairOf));
          for (const call of multicall.inner) {
            if (call.name === "create" || call.name === "mint") expect(pairsOf(tokens)).toContain(pairOf(call));
          }
        });
        const allCreates = decoded.flatMap((d) =>
          d.kind === "multicall" ? d.inner.filter((call) => call.name === "create") : [],
        );
        const expectedCreates = plan.branches.flatMap((b) => [b.pools.up, b.pools.down].filter((p) => p.create));
        expect(allCreates).toHaveLength(expectedCreates.length);
      }),
      RUNS,
    );
  });

  it("splits at the parent before any branch, and each branch before its seed multicall", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { s, plan, txs, decoded } = buildRun(c);
        const splitAt = (market: Address) => decoded.findIndex((d) => d.kind === "split" && same(d.market, market));
        const parentAt = splitAt(s.parentMarket);

        expect(parentAt).toBeGreaterThanOrEqual(0);
        plan.branches.forEach((planned, index) => {
          const branchAt = splitAt(c.branches[index]!.tokens.childMarket);
          const pool = planned.pools.up;
          const seedAt = mintsOf(txs).find(
            ({ mint }) => pairOf(mint) === pairOf(pool) && mint.amount0Desired === pool.amount0,
          )!.index;
          expect(branchAt).toBeGreaterThan(parentAt);
          expect(seedAt).toBeGreaterThan(branchAt);
        });
      }),
      RUNS,
    );
  });

  it("keeps every built transaction to the allow-list and the session's own pairs", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { s, txs } = buildRun(c);

        for (const tx of txs) expect(departures({ tx, session: s, owner, from: owner })).toEqual([]);
      }),
      RUNS,
    );
  });

  it("approves only the router, the position manager and the swap router, each exactly what the next call pulls", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { s, txs, decoded } = buildRun(c);
        const swapped = decoded.some((d) => d.kind === "swap");

        expect(approvalMismatches(s, txs)).toEqual([]);
        for (const d of decoded) {
          if (d.kind !== "approve") continue;
          const allowed = [LIST.gnosisRouter, LIST.positionManager, ...(swapped ? [LIST.swaprRouter] : [])];
          expect(allowed.some((spender) => same(spender, d.spender))).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("pays the owner and dates every mint, swap and withdrawal at the chain's time plus LIQUIDITY_DEADLINE_SECONDS", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { decoded } = buildRun(c);
        const deadline = c.chainTime + LIQUIDITY_DEADLINE_SECONDS;

        for (const d of decoded) {
          if (d.kind === "swap") {
            expect(same(d.recipient, owner)).toBe(true);
            expect(d.deadline).toBe(deadline);
          }
          if (d.kind !== "multicall") continue;
          for (const call of d.inner) {
            if (call.name === "mint" || call.name === "collect") expect(same(call.recipient, owner)).toBe(true);
            if (call.name === "mint" || call.name === "decreaseLiquidity") expect(call.deadline).toBe(deadline);
          }
        }
      }),
      RUNS,
    );
  });

  it("holds every mint and every withdrawal to non-zero minimums of both tokens", () => {
    fc.assert(
      fc.property(runCase, (c) => {
        const { decoded } = buildRun(c);
        const held = decoded.flatMap((d) =>
          d.kind === "multicall"
            ? d.inner.filter((call) => call.name === "mint" || call.name === "decreaseLiquidity")
            : [],
        );

        expect(held.length).toBeGreaterThanOrEqual(2 * c.branches.length);
        for (const call of held) {
          if (call.name !== "mint" && call.name !== "decreaseLiquidity") continue;
          expect(call.amount0Min).toBeGreaterThan(0n);
          expect(call.amount1Min).toBeGreaterThan(0n);
        }
      }),
      RUNS,
    );
  });
});

function seedOne(pools: { up: PoolStateInput; down: PoolStateInput }, tokens: BranchTokens, upPriceBps: bigint) {
  const s = session([tokens]);
  const plan = planSeed({
    session: s,
    owner,
    total: 1_000n * WAD,
    collateral: "sDAI",
    chainTime: CHAIN_TIME,
    branches: [{ depth: 1_000n * WAD, upPriceBps, pools }],
  });
  const txs = txsOf(plan.steps);
  return { plan, txs, decoded: txs.map(decode) };
}

const isSwap = (d: Decoded) => d.kind === "swap";

describe("seed prices as a property (A3)", () => {
  it("prices DOWN at exactly 1 − UP and creates each new pool at the price the plan shows", () => {
    fc.assert(
      fc.property(seedPrice, ordering, (up, order) => {
        const { plan, decoded } = seedOne({ up: missing, down: missing }, branch(1, order), up);
        const planned = plan.branches[0]!;
        const creates = decoded.flatMap((d) =>
          d.kind === "multicall" ? d.inner.filter((call) => call.name === "create") : [],
        );

        expect(planned.upPriceBps).toBe(up);
        expect(planned.downPriceBps).toBe(BPS - up);
        expect(planned.pools.up.sqrtPriceX96).toBe(userSqrtPrice(up, order.up));
        expect(planned.pools.down.sqrtPriceX96).toBe(userSqrtPrice(BPS - up, order.down));
        expect(creates.map((call) => call.sqrtPriceX96)).toEqual([
          planned.pools.up.sqrtPriceX96,
          planned.pools.down.sqrtPriceX96,
        ]);
      }),
      RUNS,
    );
  });

  it("locks a pool holding any liquidity to its own price and tick spacing, with no create and no swap", () => {
    fc.assert(
      fc.property(
        seedPrice,
        seedPrice,
        fc.oneof(fc.constant(1n), fc.bigInt({ min: 1n, max: MAX_UINT128 })),
        spacing,
        fc.boolean(),
        (poolBps, target, liquidity, tickSpacing, childIsToken0) => {
          const sqrtPriceX96 = userSqrtPrice(poolBps, childIsToken0);
          const state: PoolStateInput = { status: "live", sqrtPriceX96, liquidity, tickSpacing };
          const tokens = branch(1, { up: childIsToken0, down: !childIsToken0 });
          const { plan, txs, decoded } = seedOne({ up: state, down: missing }, tokens, target);
          const pool = plan.branches[0]!.pools.up;
          const { tickLower, tickUpper } = fullRange(tickSpacing);
          const creates = decoded.flatMap((d) =>
            d.kind === "multicall" ? d.inner.filter((call) => call.name === "create") : [],
          );

          expect(pool).toMatchObject({ priceLocked: true, realign: false, create: false, sqrtPriceX96 });
          expect([pool.tickLower, pool.tickUpper]).toEqual([tickLower, tickUpper]);
          expect(decoded.some(isSwap)).toBe(false);
          expect(creates.map(pairOf)).not.toContain(pairOf(pool));
          const seed = mintsOf(txs).find(({ mint }) => pairOf(mint) === pairOf(pool))!.mint;
          expect(seed).toMatchObject({ tickLower, tickUpper, amount0Desired: pool.amount0 });
        },
      ),
      RUNS,
    );
  });

  it.each([
    ["one wei of liquidity", 1n, true],
    ["no liquidity", 0n, false],
  ])("locks a live pool to its price with %s: %s", (_, liquidity, locked) => {
    const state: PoolStateInput = {
      status: "live",
      sqrtPriceX96: userSqrtPrice(2_000n, true),
      liquidity,
      tickSpacing: NEW_POOL_TICK_SPACING,
    };

    const { plan, decoded } = seedOne({ up: state, down: missing }, branch(1), 6_000n);

    expect(plan.branches[0]!.pools.up.priceLocked).toBe(locked);
    expect(decoded.some(isSwap)).toBe(!locked);
  });
});

describe("the allow-list on calls past the first of a multicall (A6)", () => {
  const s = session([branch(1), branch(2)]);
  const b1 = s.branches[0]!;
  const upPair = sortPair(b1.upToken, b1.outcome);
  const { tickLower, tickUpper } = fullRange(NEW_POOL_TICK_SPACING);

  const mint = ([token0, token1]: [Address, Address], recipient: Address = owner): Hex =>
    encodeFunctionData({
      abi: NFPM_ABI,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          tickLower,
          tickUpper,
          amount0Desired: 7n,
          amount1Desired: 7n,
          amount0Min: 1n,
          amount1Min: 1n,
          recipient,
          deadline: CHAIN_TIME,
        },
      ],
    });
  const create = ([token0, token1]: [Address, Address]): Hex =>
    encodeFunctionData({
      abi: NFPM_ABI,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, 2n ** 96n],
    });
  const decrease = encodeFunctionData({
    abi: NFPM_ABI,
    functionName: "decreaseLiquidity",
    args: [{ tokenId: 1n, liquidity: 7n, amount0Min: 1n, amount1Min: 1n, deadline: CHAIN_TIME }],
  });
  const collect = (recipient: Address) =>
    encodeFunctionData({
      abi: NFPM_ABI,
      functionName: "collect",
      args: [{ tokenId: 1n, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
    });
  const burn = encodeFunctionData({ abi: NFPM_ABI, functionName: "burn", args: [1n] });
  const innerApprove = encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [stranger, 7n] });
  const multicall = (inner: Hex[]): FlowTx => ({
    to: LIST.positionManager,
    data: encodeFunctionData({ abi: NFPM_ABI, functionName: "multicall", args: [inner] }),
  });
  const approve = (token: Address, spender: Address): FlowTx => ({
    to: token,
    data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, 7n] }),
  });
  const check = (tx: FlowTx) => departures({ tx, session: s, owner, from: owner });

  it.each([
    ["an approval of an outcome token to the swap router", approve(b1.outcome, LIST.swaprRouter)],
    ["a withdrawal with the burn last", multicall([decrease, collect(owner), burn])],
  ] satisfies [string, FlowTx][])("accepts %s", (_, tx) => {
    expect(check(tx)).toEqual([]);
  });

  it.each([
    ["an unlisted call after a good mint", multicall([mint(upPair), innerApprove])],
    [
      "a mint into a pair not of this session after a good mint",
      multicall([mint(upPair), mint(sortPair(b1.outcome, stranger))]),
    ],
    ["a collect paying the zero address after a withdrawal", multicall([decrease, burn, collect(zeroAddress)])],
    ["a collect paying someone else third", multicall([mint(upPair), decrease, collect(stranger)])],
    ["a create with no mint into its pool", multicall([create(upPair)])],
    ["an approval to the Algebra factory", approve(b1.outcome, LIST.algebraFactory)],
    [
      "native value on a merge",
      {
        to: LIST.gnosisRouter,
        value: 1n,
        data: encodeFunctionData({
          abi: gnosisRouterAbi,
          functionName: "mergePositions",
          args: [sDai, b1.childMarket, 7n],
        }),
      },
    ],
  ] satisfies [string, FlowTx][])("refuses %s", (_, tx) => {
    expect(check(tx)).not.toEqual([]);
  });
});
