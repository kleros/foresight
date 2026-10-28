import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

import { amount0Delta, amount1Delta, fullRange } from "../../flow/__tests__/support/session";
import { fetchLiquidityPools } from "../getLiquidityPools";
import { fetchLiquidityPositions } from "../getLiquidityPositions";
import { createChain, owner, Q96, sortPair, stranger } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;

/** LiquidityAmounts.getAmountsForLiquidity, rounded down: what burning `liquidity` returns at `sqrtP`. */
function withdrawal(sqrtP: bigint, tickLower: number, tickUpper: number, liquidity: bigint) {
  const sqrtA = sqrtPriceAtTick(tickLower);
  const sqrtB = sqrtPriceAtTick(tickUpper);
  if (sqrtP <= sqrtA) return { amount0: amount0Delta(sqrtA, sqrtB, liquidity, false), amount1: 0n };
  if (sqrtP < sqrtB) {
    return {
      amount0: amount0Delta(sqrtP, sqrtB, liquidity, false),
      amount1: amount1Delta(sqrtA, sqrtP, liquidity, false),
    };
  }
  return { amount0: 0n, amount1: amount1Delta(sqrtA, sqrtB, liquidity, false) };
}

describe("fetchLiquidityPositions", () => {
  function sessionWithPositions() {
    const chain = createChain(2);
    const [first, second] = chain.branches as [(typeof chain.branches)[0], (typeof chain.branches)[0]];
    const upPrice = (Q96 * 3n) / 2n;
    const downPrice = Q96 / 3n;
    chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: upPrice, liquidity: 100n * WAD, tickSpacing: 60 });
    chain.setPool(second.downToken, second.outcome, {
      sqrtPriceX96: downPrice,
      liquidity: 100n * WAD,
      tickSpacing: 60,
    });
    // a pool of two session tokens that is not a (parent outcome, child outcome) pair of the same branch
    chain.setPool(first.upToken, second.outcome, { sqrtPriceX96: Q96, liquidity: 100n * WAD, tickSpacing: 60 });
    const [up0, up1] = sortPair(first.upToken, first.outcome);
    const [down0, down1] = sortPair(second.downToken, second.outcome);
    const [cross0, cross1] = sortPair(first.upToken, second.outcome);
    const { tickLower, tickUpper } = fullRange(60);
    return {
      chain,
      upPrice,
      downPrice,
      up: [up0, up1],
      down: [down0, down1],
      cross: [cross0, cross1],
      tickLower,
      tickUpper,
    };
  }

  it("lists the wallet's positions in this session's pools with what a full withdrawal returns", async () => {
    const { chain, upPrice, downPrice, up, down, tickLower, tickUpper } = sessionWithPositions();
    chain.holdPosition(owner, {
      tokenId: 101n,
      token0: up[0]!,
      token1: up[1]!,
      tickLower,
      tickUpper,
      liquidity: 3n * WAD,
    });
    chain.holdPosition(owner, {
      tokenId: 102n,
      token0: down[0]!,
      token1: down[1]!,
      tickLower: -24_000,
      tickUpper: -18_000,
      liquidity: 5n * WAD,
    });
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect([...positions].sort((a, b) => Number(a.tokenId - b.tokenId))).toEqual([
      {
        tokenId: 101n,
        token0: up[0],
        token1: up[1],
        tickLower,
        tickUpper,
        liquidity: 3n * WAD,
        ...withdrawal(upPrice, tickLower, tickUpper, 3n * WAD),
      },
      {
        tokenId: 102n,
        token0: down[0],
        token1: down[1],
        tickLower: -24_000,
        tickUpper: -18_000,
        liquidity: 5n * WAD,
        ...withdrawal(downPrice, -24_000, -18_000, 5n * WAD),
      },
    ]);
  });

  it("leaves out a position in a pair that is not one of this session's pools", async () => {
    const { chain, up, cross, tickLower, tickUpper } = sessionWithPositions();
    chain.holdPosition(owner, { tokenId: 101n, token0: up[0]!, token1: up[1]!, tickLower, tickUpper, liquidity: WAD });
    chain.holdPosition(owner, {
      tokenId: 103n,
      token0: cross[0]!,
      token1: cross[1]!,
      tickLower,
      tickUpper,
      liquidity: WAD,
    });
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions.map((each) => each.tokenId)).toEqual([101n]);
  });

  it("leaves out a position with no liquidity left", async () => {
    const { chain, up, tickLower, tickUpper } = sessionWithPositions();
    chain.holdPosition(owner, { tokenId: 101n, token0: up[0]!, token1: up[1]!, tickLower, tickUpper, liquidity: WAD });
    chain.holdPosition(owner, { tokenId: 104n, token0: up[0]!, token1: up[1]!, tickLower, tickUpper, liquidity: 0n });
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions.map((each) => each.tokenId)).toEqual([101n]);
  });

  it("leaves out a position whose ownerOf is not the wallet", async () => {
    const { chain, down, tickLower, tickUpper } = sessionWithPositions();
    chain.holdPosition(owner, {
      tokenId: 102n,
      token0: down[0]!,
      token1: down[1]!,
      tickLower,
      tickUpper,
      liquidity: WAD,
    });
    chain.holdPosition(owner, {
      tokenId: 105n,
      token0: down[0]!,
      token1: down[1]!,
      tickLower,
      tickUpper,
      liquidity: WAD,
      ownerOf: stranger,
    });
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions.map((each) => each.tokenId)).toEqual([102n]);
  });

  it("leaves out another account's positions in the same pools", async () => {
    const { chain, up, tickLower, tickUpper } = sessionWithPositions();
    chain.holdPosition(stranger, {
      tokenId: 106n,
      token0: up[0]!,
      token1: up[1]!,
      tickLower,
      tickUpper,
      liquidity: WAD,
    });
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions).toEqual([]);
  });

  it("reports the rounded-down withdrawal at the pool's price, below, inside or above the range", async () => {
    const tick = fc.integer({ min: -400_000, max: 400_000 });
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 2n ** 100n }),
        tick,
        fc.bigInt({ min: 0n, max: 999n }),
        fc.tuple(tick, tick).filter(([a, b]) => Math.floor(a / 60) !== Math.floor(b / 60)),
        async (liquidity, priceTick, fraction, [a, b]) => {
          const tickLower = Math.floor(Math.min(a, b) / 60) * 60;
          const tickUpper = Math.floor(Math.max(a, b) / 60) * 60;
          const low = sqrtPriceAtTick(priceTick);
          const sqrtPriceX96 = low + ((sqrtPriceAtTick(priceTick + 1) - low) * fraction) / 1_000n;
          const chain = createChain(1);
          const [only] = chain.branches as [(typeof chain.branches)[0]];
          chain.setPool(only.upToken, only.outcome, { sqrtPriceX96, liquidity: liquidity + WAD, tickSpacing: 60 });
          const [token0, token1] = sortPair(only.upToken, only.outcome);
          chain.holdPosition(owner, { tokenId: 7n, token0, token1, tickLower, tickUpper, liquidity });
          const pools = await fetchLiquidityPools(chain.client, chain.markets);

          const [position] = await fetchLiquidityPositions(chain.client, { pools, owner });

          expect(position).toMatchObject(withdrawal(sqrtPriceX96, tickLower, tickUpper, liquidity));
        },
      ),
      { numRuns: 60 },
    );
  });
});
