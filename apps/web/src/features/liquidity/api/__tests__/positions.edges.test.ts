import { describe, expect, it, vi } from "vitest";

import { sqrtPriceAtTick } from "@/lib/swap/tickMath";

import { amount0Delta, fullRange } from "../../flow/__tests__/support/session";
import { fetchLiquidityPools } from "../getLiquidityPools";
import { fetchLiquidityPositions, POSITION_READ_BATCH_BYTES } from "../getLiquidityPositions";
import { createChain, owner, Q96, sortPair, type Chain } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;

describe("fetchLiquidityPositions in an initialized-empty pool", () => {
  it.each(["up", "down"] as const)(
    "lists a position above the price of an empty %s pool, all in token0",
    async (side) => {
      const chain = createChain(1);
      const [only] = chain.branches as [Chain["branches"][0]];
      const child = side === "up" ? only.upToken : only.downToken;
      chain.setPool(child, only.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
      const [token0, token1] = sortPair(child, only.outcome);
      // above the pool's tick 0, so it adds nothing to the pool's active liquidity
      const tickLower = 600;
      const tickUpper = 1_200;
      chain.holdPosition(owner, { tokenId: 7n, token0, token1, tickLower, tickUpper, liquidity: WAD });
      const pools = await fetchLiquidityPools(chain.client, chain.markets);
      expect(pools.branches[0]![side]).toEqual({ status: "empty", sqrtPriceX96: Q96, tickSpacing: 60 });

      const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

      expect(positions).toEqual([
        {
          tokenId: 7n,
          token0,
          token1,
          tickLower,
          tickUpper,
          liquidity: WAD,
          amount0: amount0Delta(sqrtPriceAtTick(tickLower), sqrtPriceAtTick(tickUpper), WAD, false),
          amount1: 0n,
        },
      ]);
    },
  );
});

describe("fetchLiquidityPositions over many NFTs", () => {
  it("lists every position the wallet holds in the session's pools", async () => {
    const chain = createChain(1);
    const [only] = chain.branches as [Chain["branches"][0]];
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
    const [token0, token1] = sortPair(only.upToken, only.outcome);
    const tokenIds = [100n, 101n, 102n, 103n, 104n];
    for (const tokenId of tokenIds) {
      chain.holdPosition(owner, { tokenId, token0, token1, ...fullRange(60), liquidity: WAD });
    }
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions.map((each) => each.tokenId)).toEqual(tokenIds);
  });
});

describe("fetchLiquidityPositions in a wallet others have sent NFTs to", () => {
  /** `positions(uint256)` and `ownerOf(uint256)`: a selector and one word, the shortest calls the read makes. */
  const SHORTEST_CALL_BYTES = 4 + 32;
  /** The most calls one batch of the read can carry. */
  const CALLS_PER_BATCH = Math.floor(POSITION_READ_BATCH_BYTES / SHORTEST_CALL_BYTES);

  it("lists every position when the node refuses one request for all of them", async () => {
    expect(CALLS_PER_BATCH).toBeGreaterThan(1);
    const chain = createChain(1, { maxCallsPerRequest: CALLS_PER_BATCH });
    const [only] = chain.branches as [Chain["branches"][0]];
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
    const [token0, token1] = sortPair(only.upToken, only.outcome);
    // one more NFT than one request may carry, so neither the enumeration nor the reads fit one request
    const tokenIds = Array.from({ length: CALLS_PER_BATCH + 1 }, (_, index) => 1_000n + BigInt(index));
    for (const tokenId of tokenIds) {
      chain.holdPosition(owner, { tokenId, token0, token1, ...fullRange(60), liquidity: WAD });
    }
    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

    expect(positions.map((each) => each.tokenId)).toEqual(tokenIds);
  });

  it.each(["enumeration", "reads", "positions", "ownerOf"] as const)(
    "lists the readable positions when another NFT's %s revert",
    async (reverts) => {
      const chain = createChain(1);
      const [only] = chain.branches as [Chain["branches"][0]];
      chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
      const [token0, token1] = sortPair(only.upToken, only.outcome);
      const position = { token0, token1, ...fullRange(60), liquidity: WAD };
      chain.holdPosition(owner, { tokenId: 200n, ...position });
      chain.holdPosition(owner, { tokenId: 201n, ...position, reverts });
      chain.holdPosition(owner, { tokenId: 202n, ...position });
      const pools = await fetchLiquidityPools(chain.client, chain.markets);

      const positions = await fetchLiquidityPositions(chain.client, { pools, owner });

      expect(positions.map((each) => each.tokenId)).toEqual([200n, 202n]);
    },
  );

  it.each([
    ["reads", 5_030n],
    ["enumeration", 30n],
  ] as const)("fails the read when the node keeps refusing a request of the %s", async (_, carried) => {
    const chain = createChain(1);
    const [only] = chain.branches as [Chain["branches"][0]];
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
    const [token0, token1] = sortPair(only.upToken, only.outcome);
    for (let index = 0n; index < 40n; index += 1n) {
      chain.holdPosition(owner, { tokenId: 5_000n + index, token0, token1, ...fullRange(60), liquidity: WAD });
    }
    const pools = await fetchLiquidityPools(chain.client, chain.markets);
    chain.refuseRequestsCarrying(carried);

    await expect(fetchLiquidityPositions(chain.client, { pools, owner })).rejects.toThrow();
  });
});
