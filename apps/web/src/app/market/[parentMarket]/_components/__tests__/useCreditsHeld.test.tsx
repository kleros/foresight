import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { expect, it, vi } from "vitest";

import { fetchCredits } from "@/lib/trade-executor/credits";

import { useCreditsHeld } from "../useCreditsHeld";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/lib/trade-executor/credits", () => ({ fetchCredits: vi.fn() }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  creditsContracts: () => ({
    credits: "0x1111111111111111111111111111111111111111",
    manager: "0x2222222222222222222222222222222222222222",
  }),
}));

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;

it("settles a failed read on its first try, so the funding plan does not wait out retries", async () => {
  vi.mocked(fetchCredits).mockRejectedValue(new Error("no code at the manager"));
  // retries on, as src/lib/query.ts sets them, so only the hook can turn them off
  const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 1000 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useCreditsHeld(address("9"), address("8"), address("3")), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 500 });
  expect(result.current.isLoading).toBe(false);
  expect(fetchCredits).toHaveBeenCalledTimes(1);
});
