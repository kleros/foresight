import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER, plannerInput } from "@/features/resolution/redeem/__tests__/support/session";
import { createRedeemRun, type RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeemRun, walletRedeemFlowId, walletRedeemKeyPrefix } from "../useWalletRedeem";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(), getConnectorClient: vi.fn() }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/resolution/redeem/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/redeem/run")>()),
  createRedeemRun: vi.fn(),
}));

const FACTORY = "0x5f00000000000000000000000000000000000000" as Address;
const SESSION = { sessionFactory: FACTORY, sessionId: 7n };

/** A driver whose progress the test sets. */
function fakeDriver() {
  let progress: RedeemProgress = { stage: "idle" };
  const listeners = new Set<() => void>();
  const driver = {
    start: vi.fn(),
    recover: vi.fn(),
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
  client = new QueryClient();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe("useWalletRedeemRun", () => {
  it("loads a run stored by an earlier visit on mount, for review", () => {
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    expect(fake.driver.recover).toHaveBeenCalledTimes(1);
  });

  it("keeps one stored run per session and account", () => {
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    const [args] = vi.mocked(createRedeemRun).mock.calls[0]!;
    expect(args.flowId).toBe(walletRedeemFlowId(SESSION, OWNER));
    expect(walletRedeemFlowId(SESSION, OWNER)).not.toBe(walletRedeemFlowId({ ...SESSION, sessionId: 8n }, OWNER));
    expect(walletRedeemFlowId(SESSION, OWNER)).not.toBe(
      walletRedeemFlowId({ ...SESSION, sessionFactory: "0x5f00000000000000000000000000000000000001" }, OWNER),
    );
    expect(walletRedeemFlowId(SESSION, OWNER)).not.toBe(
      walletRedeemFlowId(SESSION, "0x00000000000000000000000000000000000000b2"),
    );
  });

  it("signs what the section showed when Redeem was pressed", () => {
    const { result } = renderHook(() => useWalletRedeemRun(SESSION), { wrapper });
    const input = plannerInput({ owner: OWNER });

    act(() => result.current.start(input));

    const [args] = vi.mocked(createRedeemRun).mock.calls[0]!;
    expect(fake.driver.start).toHaveBeenCalledTimes(1);
    expect(args.request()).toBe(input);
  });

  it.each(["complete", "halted"] as const)("reads the wallet's list again once a run is %s", (stage) => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    act(() => fake.set({ stage }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: walletRedeemKeyPrefix });
  });

  it("does not read the list again while a run is signing", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    act(() => fake.set({ stage: "signing" }));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("builds no run with no session", () => {
    renderHook(() => useWalletRedeemRun(undefined), { wrapper });

    expect(createRedeemRun).not.toHaveBeenCalled();
  });
});
