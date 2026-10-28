import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fullRange } from "../../flow/__tests__/support/session";
import { fetchLiquidityPools, liquidityKeyPrefix, useLiquidityPools } from "../getLiquidityPools";
import { fetchLiquidityPositions, useLiquidityPositions } from "../getLiquidityPositions";
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

afterEach(() => {
  vi.useRealTimers();
});

function liveUpPools(chain: Chain) {
  for (const each of chain.branches) {
    chain.setPool(each.upToken, each.outcome, { sqrtPriceX96: Q96, liquidity: 10n * WAD, tickSpacing: 60 });
  }
}

function holdUpPositions(chain: Chain, count: number) {
  const [first] = chain.branches as [Chain["branches"][0]];
  const [token0, token1] = sortPair(first.upToken, first.outcome);
  const { tickLower, tickUpper } = fullRange(60);
  for (let index = 0; index < count; index += 1) {
    chain.holdPosition(owner, { tokenId: 100n + BigInt(index), token0, token1, tickLower, tickUpper, liquidity: WAD });
  }
}

describe("liquidity reads, multicalled", () => {
  async function poolRoundTrips(branchCount: number) {
    const chain = createChain(branchCount);
    liveUpPools(chain);
    await fetchLiquidityPools(chain.client, chain.markets);
    return chain.ethCalls();
  }

  async function positionRoundTrips(positionCount: number) {
    const chain = createChain(1);
    liveUpPools(chain);
    holdUpPositions(chain, positionCount);
    const pools = await fetchLiquidityPools(chain.client, chain.markets);
    const before = chain.ethCalls();
    await fetchLiquidityPositions(chain.client, { pools, owner });
    return chain.ethCalls() - before;
  }

  it("reads a session's pools in as many round trips for four branches as for one", async () => {
    expect(await poolRoundTrips(4)).toBe(await poolRoundTrips(1));
  });

  it("reads the wallet's positions in as many round trips for four positions as for one", async () => {
    expect(await positionRoundTrips(4)).toBe(await positionRoundTrips(1));
  });
});

describe("liquidity reads, cached", () => {
  function setup() {
    const chain = createChain(1);
    current.chain = chain;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const [only] = chain.branches as [Chain["branches"][0]];
    return { chain, queryClient, wrapper, only };
  }

  it("shows a pool created since the last read once the liquidity keys are invalidated", async () => {
    const { chain, queryClient, wrapper, only } = setup();
    const { result } = renderHook(() => useLiquidityPools(chain.markets), { wrapper });
    await waitFor(() => expect(result.current.data?.branches[0]?.up).toEqual({ status: "missing" }));
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: WAD, tickSpacing: 60 });

    await queryClient.invalidateQueries({ queryKey: liquidityKeyPrefix });

    await waitFor(() =>
      expect(result.current.data?.branches[0]?.up).toEqual({
        status: "live",
        sqrtPriceX96: Q96,
        liquidity: WAD,
        tickSpacing: 60,
      }),
    );
  });

  it("shows a position opened since the last read once the liquidity keys are invalidated", async () => {
    const { chain, queryClient, wrapper } = setup();
    liveUpPools(chain);
    const { result } = renderHook(
      () => {
        const pools = useLiquidityPools(chain.markets);
        return useLiquidityPositions(pools.data, owner);
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
    holdUpPositions(chain, 1);

    await queryClient.invalidateQueries({ queryKey: liquidityKeyPrefix });

    await waitFor(() => expect(result.current.data?.map((each) => each.tokenId)).toEqual([100n]));
  });

  it("reads a missing pool again once its read has gone stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { chain, wrapper, only } = setup();
    const first = renderHook(() => useLiquidityPools(chain.markets), { wrapper });
    await waitFor(() => expect(first.result.current.data?.branches[0]?.down).toEqual({ status: "missing" }));
    first.unmount();
    chain.setPool(only.downToken, only.outcome, { sqrtPriceX96: Q96, liquidity: WAD, tickSpacing: 60 });
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);

    const second = renderHook(() => useLiquidityPools(chain.markets), { wrapper });

    await waitFor(() => expect(second.result.current.data?.branches[0]?.down).toMatchObject({ status: "live" }));
  });
});
