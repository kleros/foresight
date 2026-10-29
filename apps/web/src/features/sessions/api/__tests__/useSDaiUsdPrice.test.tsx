import type { ReactNode } from "react";

import { gnosis as contracts } from "@foresight/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { parseEther, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";

import { useSDaiUsdPrice } from "../getPoolBalances";

const readContract = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web3/public-client", () => ({ publicClient: { readContract } }));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));

const S_DAI: Address = contracts.savingsXDaiAddress[100]!;

function renderPrice(collateral: Address) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSDaiUsdPrice(collateral), { wrapper });
}

describe("useSDaiUsdPrice", () => {
  beforeEach(() => {
    readContract.mockReset();
    readContract.mockResolvedValue(parseEther("1.25"));
  });

  it("reads what one sDAI redeems for when the collateral is sDAI", async () => {
    const { result } = renderPrice(S_DAI);

    await waitFor(() => expect(result.current.data).toBe(1.25));
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: S_DAI, functionName: "previewRedeem", args: [parseEther("1")] }),
    );
  });

  it("reads no price for any other collateral", async () => {
    const { result } = renderPrice(addresses.collateralToken);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readContract).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
