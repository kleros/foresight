import type { ReactNode } from "react";

import { gnosis as contracts } from "@foresight/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { parseEther, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";

import { useSDaiUsdPrice } from "../getPoolBalances";

const readContract = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web3/public-client", () => ({ publicClient: { readContract } }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
// a chain with sDAI and no savings adapter to deposit xDAI through
vi.mock("@foresight/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@foresight/contracts")>();
  return { ...actual, gnosis: { ...actual.gnosis, savingsXDaiAdapterAddress: {} } };
});

const S_DAI: Address = contracts.savingsXDaiAddress[100]!;

describe("useSDaiUsdPrice on a chain without the sDAI adapter", () => {
  it("still reads what one sDAI redeems for", async () => {
    readContract.mockResolvedValue(parseEther("1.25"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSDaiUsdPrice(S_DAI), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(1.25));
  });
});
