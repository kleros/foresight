import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fullRange } from "../../flow/__tests__/support/session";
import { liquidityKeyPrefix, useLiquidityPools } from "../getLiquidityPools";
import { useLiquidityPositions } from "../getLiquidityPositions";
import { createChain, owner, Q96, sortPair, type Chain } from "./support/chain";

const current = vi.hoisted(() => ({ chain: undefined as unknown as { client: unknown } }));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.chain.client;
  },
}));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));

const WAD = 10n ** 18n;

describe("useLiquidityPositions after a seed", () => {
  it("lists a position minted into a pool that was missing before the run", async () => {
    const chain = createChain(1);
    current.chain = chain;
    const [only] = chain.branches as [Chain["branches"][0]];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        const pools = useLiquidityPools(chain.markets);
        return useLiquidityPositions(pools.data, owner);
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: WAD, tickSpacing: 60 });
    const [token0, token1] = sortPair(only.upToken, only.outcome);
    chain.holdPosition(owner, { tokenId: 100n, token0, token1, ...fullRange(60), liquidity: WAD });

    await queryClient.invalidateQueries({ queryKey: liquidityKeyPrefix });

    await waitFor(() => expect(result.current.data?.map((each) => each.tokenId)).toEqual([100n]));
  });
});
