import { describe, expect, it, vi } from "vitest";

import { fetchLiquidityPools } from "../getLiquidityPools";
import { createChain } from "./support/chain";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

describe("fetchLiquidityPools, session guards", () => {
  it("reads a pool created but never initialized as missing", async () => {
    const chain = createChain(1);
    const [only] = chain.branches as [(typeof chain.branches)[0]];
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: 0n, liquidity: 0n, tickSpacing: 60 });

    const pools = await fetchLiquidityPools(chain.client, chain.markets);

    expect(pools.branches[0]!.up).toEqual({ status: "missing" });
  });

  it("refuses child markets listed out of their parent outcomes' order", async () => {
    const chain = createChain(2);
    const childMarkets = [...chain.markets.childMarkets].reverse();

    await expect(fetchLiquidityPools(chain.client, { ...chain.markets, childMarkets })).rejects.toThrow(
      "does not belong to this session",
    );
  });

  it("refuses a child market list shorter than the parent's outcomes", async () => {
    const chain = createChain(2);
    const childMarkets = chain.markets.childMarkets.slice(0, 1);

    await expect(fetchLiquidityPools(chain.client, { ...chain.markets, childMarkets })).rejects.toThrow(
      "do not match its parent market",
    );
  });
});
