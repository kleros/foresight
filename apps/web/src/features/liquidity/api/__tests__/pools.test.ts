import fc from "fast-check";
import { isAddressEqual } from "viem";
import { describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import type { PoolState } from "../../types";
import { fetchLiquidityPools, sessionHasLiquidity } from "../getLiquidityPools";
import { at, createChain, LIST, Q96, sortPair } from "./support/chain";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;

describe("fetchLiquidityPools", () => {
  it("reads each branch's UP and DOWN pool as missing, initialized-empty or live", async () => {
    const chain = createChain(2);
    const [first, second] = chain.branches as [(typeof chain.branches)[0], (typeof chain.branches)[0]];
    chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 7n * WAD, tickSpacing: 10 });
    chain.setPool(second.upToken, second.outcome, { sqrtPriceX96: Q96 / 2n, liquidity: 0n, tickSpacing: 60 });
    chain.setPool(second.downToken, second.outcome, { sqrtPriceX96: 3n * Q96, liquidity: WAD, tickSpacing: 200 });

    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    expect(pools.branches).toHaveLength(2);
    expect(pools.branches[0]!.up).toEqual({ status: "live", sqrtPriceX96: Q96, liquidity: 7n * WAD, tickSpacing: 10 });
    expect(pools.branches[0]!.down).toEqual({ status: "missing" });
    expect(pools.branches[1]!.up).toMatchObject({ status: "empty", sqrtPriceX96: Q96 / 2n });
    expect(pools.branches[1]!.down).toEqual({
      status: "live",
      sqrtPriceX96: 3n * Q96,
      liquidity: WAD,
      tickSpacing: 200,
    });
  });

  it("takes every token from wrappedOutcome of the session's own markets", async () => {
    const chain = createChain(3);

    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    expect(pools.session.parentMarket).toBe(chain.parentMarket);
    expect(pools.session.parentInvalid).toBe(chain.parentInvalid);
    expect(pools.session.branches).toEqual(chain.branches);
  });

  it("reads each pool from poolByPair on the allow list's factory, for this session's pairs only", async () => {
    const chain = createChain(2);

    await fetchLiquidityPools(chain.client, chain.markets);

    const asked = chain.calls.filter((call) => call.functionName === "poolByPair");
    expect(asked.every((call) => isAddressEqual(call.to, LIST.algebraFactory))).toBe(true);
    const pairs = new Set(asked.map((call) => sortPair(...(call.args as [`0x${string}`, `0x${string}`])).join("|")));
    const expected = chain.branches.flatMap((each) => [
      sortPair(each.upToken, each.outcome).join("|"),
      sortPair(each.downToken, each.outcome).join("|"),
    ]);
    expect([...pairs].sort()).toEqual(expected.sort());
  });

  it("never asks the indexer", async () => {
    const chain = createChain(2);
    chain.setPool(chain.branches[0]!.upToken, chain.branches[0]!.outcome, {
      sqrtPriceX96: Q96,
      liquidity: WAD,
      tickSpacing: 60,
    });

    await fetchLiquidityPools(chain.client, chain.markets);

    expect(fetchGraphql).not.toHaveBeenCalled();
  });

  it("finds a pool created after an earlier read found it missing", async () => {
    const chain = createChain(1);
    const [only] = chain.branches as [(typeof chain.branches)[0]];
    const before = await fetchLiquidityPools(chain.client, chain.markets);
    chain.setPool(only.downToken, only.outcome, { sqrtPriceX96: 2n * Q96, liquidity: WAD, tickSpacing: 60 });

    const after = await fetchLiquidityPools(chain.client, chain.markets);

    expect(before.branches[0]!.down).toEqual({ status: "missing" });
    expect(after.branches[0]!.down).toEqual({
      status: "live",
      sqrtPriceX96: 2n * Q96,
      liquidity: WAD,
      tickSpacing: 60,
    });
  });
});

describe("sessionHasLiquidity", () => {
  const MISSING: PoolState = { status: "missing" };
  const EMPTY: PoolState = { status: "empty", sqrtPriceX96: Q96, tickSpacing: 60 };
  const LIVE: PoolState = { status: "live", sqrtPriceX96: Q96, liquidity: 1n, tickSpacing: 60 };

  function poolsWith(states: { up: PoolState; down: PoolState }[]) {
    const chain = createChain(states.length);
    const session = {
      chainId: 100,
      parentMarket: chain.parentMarket,
      collateral: at("5d"),
      parentInvalid: chain.parentInvalid,
      branches: chain.branches,
    };
    return { session, branches: states };
  }

  it.each([
    [
      "every pool missing",
      [
        { up: MISSING, down: MISSING },
        { up: MISSING, down: MISSING },
      ],
    ],
    [
      "pools initialized but empty",
      [
        { up: EMPTY, down: MISSING },
        { up: EMPTY, down: EMPTY },
      ],
    ],
  ])("is false with %s", (_, states) => {
    expect(sessionHasLiquidity(poolsWith(states))).toBe(false);
  });

  it.each([
    [
      "one live UP pool among missing ones",
      [
        { up: MISSING, down: MISSING },
        { up: LIVE, down: MISSING },
      ],
    ],
    [
      "one live DOWN pool among empty ones",
      [
        { up: EMPTY, down: LIVE },
        { up: EMPTY, down: EMPTY },
      ],
    ],
  ])("is true with %s", (_, states) => {
    expect(sessionHasLiquidity(poolsWith(states))).toBe(true);
  });

  it("is true exactly when some pool is live", () => {
    const state = fc.constantFrom(MISSING, EMPTY, LIVE);
    fc.assert(
      fc.property(fc.array(fc.record({ up: state, down: state }), { minLength: 1, maxLength: 6 }), (branches) => {
        const anyLive = branches.some((each) => each.up.status === "live" || each.down.status === "live");
        expect(sessionHasLiquidity(poolsWith(branches))).toBe(anyLive);
      }),
    );
  });
});
