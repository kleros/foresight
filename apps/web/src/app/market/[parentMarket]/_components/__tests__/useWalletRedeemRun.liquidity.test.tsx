import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiquidityBalances } from "@/features/liquidity/api/getLiquidityBalances";
import type { LiquiditySession } from "@/features/liquidity/types";
import { OWNER } from "@/features/resolution/redeem/__tests__/support/session";
import { createRedeemRun, type RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeemRun } from "../useWalletRedeem";

const chain = vi.hoisted(() => ({
  multicall: vi.fn(async () => [0n, 0n]),
  request: vi.fn(async () => "0x0"),
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(), getConnectorClient: vi.fn() }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: chain }));
vi.mock("@/features/resolution/redeem/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/redeem/run")>()),
  createRedeemRun: vi.fn(),
}));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const LIQUIDITY_SESSION: LiquiditySession = {
  chainId: 100,
  parentMarket: "0x00000000000000000000000000000000000000b0",
  collateral: "0xaf204776c7245bF4147c2612BF6e5972Ee483701",
  parentInvalid: "0x00000000000000000000000000000000000000e3",
  branches: [],
};

function fakeDriver() {
  let progress: RedeemProgress = { stage: "idle" };
  const listeners = new Set<() => void>();
  const driver = {
    start: vi.fn(),
    recover: vi.fn(),
    restore: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    discard: vi.fn(async () => {}),
    dispose: vi.fn(),
    getProgress: () => progress,
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
  };
  const set = (next: RedeemProgress) => {
    progress = next;
    for (const listener of listeners) listener();
  };
  return { driver, set };
}

let fake: ReturnType<typeof fakeDriver>;
let client: QueryClient;

beforeEach(() => {
  fake = fakeDriver();
  vi.mocked(createRedeemRun).mockReset();
  vi.mocked(createRedeemRun).mockReturnValue(fake.driver);
  chain.multicall.mockClear();
  client = new QueryClient();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** The redeem run beside the liquidity balances the positions dialog offers Merge from. */
function renderPage() {
  return renderHook(
    () => ({ run: useWalletRedeemRun(SESSION), balances: useLiquidityBalances(LIQUIDITY_SESSION, OWNER) }),
    { wrapper },
  );
}

describe("useWalletRedeemRun and the liquidity balances", () => {
  it.each(["complete", "halted"] as const)(
    "reads the wallet's liquidity balances again once a run is %s",
    async (stage) => {
      const { result } = renderPage();
      await waitFor(() => expect(result.current.balances.isSuccess).toBe(true));
      expect(chain.multicall).toHaveBeenCalledTimes(1);

      act(() => fake.set({ stage }));

      await waitFor(() => expect(chain.multicall).toHaveBeenCalledTimes(2));
    },
  );

  it.each(["signing", "confirming", "review"] as const)("does not read them again while a run is %s", async (stage) => {
    const { result } = renderPage();
    await waitFor(() => expect(result.current.balances.isSuccess).toBe(true));

    act(() => fake.set({ stage }));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chain.multicall).toHaveBeenCalledTimes(1);
  });
});
