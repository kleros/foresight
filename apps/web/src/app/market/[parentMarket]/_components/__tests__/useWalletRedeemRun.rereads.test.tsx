import { StrictMode, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER } from "@/features/resolution/redeem/__tests__/support/session";
import { createRedeemRun, type RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeemRun, walletRedeemKeyPrefix } from "../useWalletRedeem";

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
/** Ported from liquidity `useLiquidityRun.rereads.test.tsx` and `useLiquidityRun.recover.test.tsx`. */

const invalidations = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(
    ([filters]) => (filters as { queryKey?: unknown } | undefined)?.queryKey === walletRedeemKeyPrefix,
  ).length;

describe("useWalletRedeemRun rereads the wallet's list", () => {
  it("once per arrival at halted, not on each progress update after it", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    act(() => fake.set({ stage: "halted", failure: { reason: "rejected", retryable: true } }));
    act(() => fake.set({ stage: "halted", failure: { reason: "rejected", retryable: true }, holdsSend: true }));

    expect(invalidations(invalidate)).toBe(1);
  });

  it("again when a retried run halts a second time", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    act(() => fake.set({ stage: "halted", failure: { reason: "rejected", retryable: true } }));
    act(() => fake.set({ stage: "signing" }));
    act(() => fake.set({ stage: "halted", failure: { reason: "rejected", retryable: true } }));

    expect(invalidations(invalidate)).toBe(2);
  });

  it.each(["signing", "confirming", "review"] as const)("not while a run is %s", (stage) => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useWalletRedeemRun(SESSION), { wrapper });

    act(() => fake.set({ stage }));

    expect(invalidations(invalidate)).toBe(0);
  });
});

describe("useWalletRedeemRun under StrictMode", () => {
  const strict = ({ children }: { children: ReactNode }) => <StrictMode>{wrapper({ children })}</StrictMode>;

  it("shows a run stored by an earlier visit for review, recovering on the driver it keeps", () => {
    const built: ReturnType<typeof fakeDriver>[] = [];
    vi.mocked(createRedeemRun).mockImplementation(() => {
      const next = fakeDriver();
      built.push(next);
      return next.driver;
    });

    renderHook(() => useWalletRedeemRun(SESSION), { wrapper: strict });

    const kept = built.filter((each) => each.driver.dispose.mock.calls.length === 0);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.driver.recover).toHaveBeenCalledTimes(1);
  });

  it("acts on resume on the driver it keeps", () => {
    const built: ReturnType<typeof fakeDriver>[] = [];
    vi.mocked(createRedeemRun).mockImplementation(() => {
      const next = fakeDriver();
      built.push(next);
      return next.driver;
    });
    const { result } = renderHook(() => useWalletRedeemRun(SESSION), { wrapper: strict });

    act(() => result.current.resume());

    const kept = built.find((each) => each.driver.dispose.mock.calls.length === 0)!;
    expect(kept.driver.resume).toHaveBeenCalledTimes(1);
  });

  it("disposes every driver it built once unmounted", () => {
    const built: ReturnType<typeof fakeDriver>[] = [];
    vi.mocked(createRedeemRun).mockImplementation(() => {
      const next = fakeDriver();
      built.push(next);
      return next.driver;
    });
    const { unmount } = renderHook(() => useWalletRedeemRun(SESSION), { wrapper: strict });

    unmount();

    expect(built.length).toBeGreaterThan(0);
    expect(built.every((each) => each.driver.dispose.mock.calls.length === 1)).toBe(true);
  });
});
