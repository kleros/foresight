import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STALE_TIME } from "@/lib/query";

import { useLiquidityPools } from "../getLiquidityPools";
import { createChain, Q96, type Chain } from "./support/chain";

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

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiquidityPools staleness", () => {
  it("reads a missing pool again on the next mount once the live tier has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const chain = createChain(1);
    current.chain = chain;
    const [only] = chain.branches as [Chain["branches"][0]];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useLiquidityPools(chain.markets), { wrapper });
    await waitFor(() => expect(first.result.current.data?.branches[0]?.up).toEqual({ status: "missing" }));
    first.unmount();
    chain.setPool(only.upToken, only.outcome, { sqrtPriceX96: Q96, liquidity: 1n, tickSpacing: 60 });
    vi.setSystemTime(Date.now() + STALE_TIME.live + 1);

    const second = renderHook(() => useLiquidityPools(chain.markets), { wrapper });

    await waitFor(() => expect(second.result.current.data?.branches[0]?.up).toMatchObject({ status: "live" }));
  });
});
