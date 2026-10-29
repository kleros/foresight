import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { owner } from "../../flow/__tests__/support/session";
import { useLiquidityRun } from "../useLiquidityRun";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/chains", async (importOriginal) => {
  const { hardhat } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: hardhat.id,
    DEFAULT_CHAIN: hardhat,
  };
});
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: owner, chainId: 31337, isConnected: true, status: "connected" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useLiquidityRun on a chain with no liquidity allow list", () => {
  it("renders with a connected wallet and offers no run, so the market page around it still renders", () => {
    const { result } = renderHook(() => useLiquidityRun("0x0845542D4D7fcF46B86Ca5aB777479139eFf5466", null), {
      wrapper,
    });

    expect(result.current.progress).toBeNull();
    expect(result.current.isHeld).toBe(false);
    expect(() => result.current.start({} as never)).not.toThrow();
  });
});
