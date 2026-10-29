import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createChain, Q96, type Chain } from "./support/chain";
import { useSessionLiquidity } from "../../hooks/useSessionLiquidity";

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
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: undefined, chainId: undefined, isConnected: false, status: "disconnected" }),
}));

const WAD = 10n ** 18n;

function renderOn(chain: Chain, isReady = true) {
  current.chain = chain;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  // the market page lists its options last outcome first
  const branches = chain.markets.childMarkets
    .map((market, outcomeIndex) => ({ market, outcomeIndex, name: `Option ${outcomeIndex}` }))
    .reverse();
  return renderHook(
    () => useSessionLiquidity({ parentMarket: chain.markets.parentMarket, branches, closesAt: null, isReady }),
    { wrapper },
  );
}

describe("useSessionLiquidity's hasLiquidity", () => {
  it("is true once one pool of the session is live", async () => {
    const chain = createChain(3);
    const last = chain.branches[2]!;
    chain.setPool(last.downToken, last.outcome, { sqrtPriceX96: Q96, liquidity: WAD, tickSpacing: 60 });

    const { result } = renderOn(chain);

    await waitFor(() => expect(result.current.hasLiquidity).toBe(true));
  });

  it("is false when the session's pools are missing or initialized-empty", async () => {
    const chain = createChain(2);
    const first = chain.branches[0]!;
    chain.setPool(first.upToken, first.outcome, { sqrtPriceX96: Q96, liquidity: 0n, tickSpacing: 60 });

    const { result } = renderOn(chain);

    await waitFor(() => expect(result.current.hasLiquidity).toBe(false));
  });

  it("reads no pool and stays unknown until every child market exists", async () => {
    const chain = createChain(2);

    const { result } = renderOn(chain, false);

    await waitFor(() => expect(result.current.pools.fetchStatus).toBe("idle"));
    expect(result.current.hasLiquidity).toBeUndefined();
    expect(chain.ethCalls()).toBe(0);
  });
});
