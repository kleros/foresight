import { StrictMode, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { owner } from "../../flow/__tests__/support/session";
import { seedRequest } from "../../run/__tests__/support/requests";
import { chain, gateway, wallet } from "../../run/__tests__/support/world";
import { createLiquidityRun } from "../../run/driver";
import { liquidityRunStore } from "../../run/store";
import { useLiquidityRun } from "../useLiquidityRun";

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/chains", async (importOriginal) => {
  const { gnosis } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: gnosis.id,
    DEFAULT_CHAIN: gnosis,
  };
});
/** Every driver the hook built, and whether it was disposed. */
const built = vi.hoisted((): { disposed: boolean }[] => []);
vi.mock("../../run/driver", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../run/driver")>();
  return {
    ...real,
    createLiquidityRun: (...args: Parameters<typeof real.createLiquidityRun>) => {
      const driver = real.createLiquidityRun(...args);
      const record = { disposed: false };
      built.push(record);
      return {
        ...driver,
        dispose: () => {
          record.disposed = true;
          driver.dispose();
        },
      };
    },
  };
});
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: owner, chainId: 100, isConnected: true, status: "connected" }),
}));

const PARENT = "0x0845542D4D7fcF46B86Ca5aB777479139eFf5466";

const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  </StrictMode>
);

/** Leaves a seed in this browser's store with its first prompt open, as a tab closed mid-run does. */
async function storeHeldRun() {
  const fake = chain();
  const sends = gateway(fake, owner, { script: () => "hang" });
  const tab = createLiquidityRun({
    gateway: sends.port,
    wallet: wallet(fake, owner).port,
    reader: fake.reader,
    store: liquidityRunStore(),
    flowId: `liquidity:${PARENT.toLowerCase()}:${owner.toLowerCase()}`,
    account: () => owner,
    chainId: () => 100,
    request: () => seedRequest(),
    closesAt: 2_000_000_000n,
  });
  tab.start();
  await sends.held();
  tab.dispose();
  built.length = 0;
}

afterEach(() => {
  localStorage.clear();
  built.length = 0;
});

describe("useLiquidityRun under StrictMode", () => {
  it("shows a run stored by an earlier visit for review", async () => {
    await storeHeldRun();

    const { result } = renderHook(() => useLiquidityRun(PARENT, null), { wrapper });

    await waitFor(() => expect(result.current.progress?.stage).toBe("review"));
  });

  it("acts on resume once the stored run shows for review", async () => {
    await storeHeldRun();
    const { result } = renderHook(() => useLiquidityRun(PARENT, null), { wrapper });
    await waitFor(() => expect(result.current.progress?.stage).toBe("review"));

    act(() => result.current.resume());

    await waitFor(() => expect(result.current.progress?.stage).not.toBe("review"));
  });

  it("disposes every driver it built once unmounted", async () => {
    await storeHeldRun();
    const { result, unmount } = renderHook(() => useLiquidityRun(PARENT, null), { wrapper });
    await waitFor(() => expect(result.current.progress?.stage).toBe("review"));

    unmount();

    expect(built.length).toBeGreaterThan(0);
    expect(built.filter((each) => !each.disposed)).toEqual([]);
  });
});
