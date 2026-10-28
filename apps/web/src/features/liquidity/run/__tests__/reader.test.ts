import { describe, expect, it, vi } from "vitest";

import { createChain, owner, Q96, stranger } from "../../api/__tests__/support/chain";
import { createLiquidityReader } from "../reader";

// the reader takes its client as an argument; the app's own one reads the environment on import
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

describe("the liquidity run's chain reader", () => {
  it("reads a pair's pool in either token order, as missing, empty or live", async () => {
    const chain = createChain(1);
    const [branch] = chain.branches as [(typeof chain.branches)[0]];
    chain.setPool(branch.upToken, branch.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });
    chain.setPool(branch.downToken, branch.outcome, { sqrtPriceX96: 2n * Q96, liquidity: 5n, tickSpacing: 10 });
    const reader = createLiquidityReader(chain.client, 100);

    expect(await reader.pool(branch.outcome, branch.upToken)).toEqual({
      status: "empty",
      sqrtPriceX96: Q96,
      tickSpacing: 60,
    });
    expect(await reader.pool(branch.downToken, branch.outcome)).toEqual({
      status: "live",
      sqrtPriceX96: 2n * Q96,
      liquidity: 5n,
      tickSpacing: 10,
    });
    expect(await reader.pool(branch.invalidToken, branch.outcome)).toEqual({ status: "missing" });
  });

  it("names a position's owner as the position manager does", async () => {
    const chain = createChain(1);
    const [branch] = chain.branches as [(typeof chain.branches)[0]];
    const position = { token0: branch.outcome, token1: branch.upToken, tickLower: -60, tickUpper: 60, liquidity: 1n };
    chain.holdPosition(owner, { tokenId: 3n, ...position });
    chain.holdPosition(owner, { tokenId: 4n, ...position, ownerOf: stranger });
    const reader = createLiquidityReader(chain.client, 100);

    expect(await reader.ownerOf(3n)).toBe(owner);
    expect(await reader.ownerOf(4n)).toBe(stranger);
  });
});
