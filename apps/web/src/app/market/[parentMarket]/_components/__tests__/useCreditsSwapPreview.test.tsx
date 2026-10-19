import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addresses, VAULT_RATE, WAD } from "@/features/predict/flow/__tests__/support/fakes";

import { useCreditsSwapPreview } from "../useCreditsSwapPreview";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/predict/run/reader", async () => {
  const { fakeReader } = await import("@/features/predict/flow/__tests__/support/fakes");
  return { createPredictReader: () => fakeReader() };
});
vi.mock("@/lib/swap/lens", async () => {
  const { fakeCreditsQuoter } = await import("@/features/predict/flow/__tests__/support/fakes");
  return { createLensExactInputQuoter: () => fakeCreditsQuoter({ lossBps: 40n }) };
});
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  creditsRoute: () => ({
    token: addresses.credits,
    manager: addresses.manager,
    wxdai: addresses.wxdai,
    swaprRouter: addresses.swapRouter,
  }),
}));

function mount(credits: bigint) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useCreditsSwapPreview({
        sessionId: "1",
        collateral: addresses.collateral,
        tradeWallet: addresses.executor,
        credits,
        creditsBps: 20,
      }),
    { wrapper },
  );
}

describe("useCreditsSwapPreview", () => {
  it("names what the credits swap gives up against the vault rate as quoted now", async () => {
    const { result } = mount(2n * WAD);
    const value = (2n * WAD * VAULT_RATE) / WAD;

    await waitFor(() => expect(result.current.preview).toBeDefined());
    expect(result.current.preview?.loss).toBe(value - (value * (10_000n - 40n)) / 10_000n);
    expect(result.current.failed).toBe(false);
  });

  it("names nothing while no credits are spent", () => {
    expect(mount(0n).result.current).toEqual({ failed: false });
  });
});
