import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTradeWalletRedeem, readTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { OWNER, planFor, SCOPE, WAD } from "@/features/resolution/redeem/__tests__/support/session";

import { errorToast } from "@/utils/toast";
import { wrapWithToast } from "@/utils/wrapWithToast";

import { RedeemPlanChangedError, useRedeemFromTradeWallet } from "../useTradeWalletRedeem";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(async () => "0xhash") }));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/utils/toast", () => ({ errorToast: vi.fn() }));
vi.mock("@/utils/wrapWithToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/wrapWithToast")>()),
  wrapWithToast: vi.fn(async (_config: unknown, send: () => Promise<unknown>) => {
    await send();
    return { status: "success" };
  }),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(),
  readTradeWalletRedeem: vi.fn(),
}));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };

function setup(toasts?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRedeemFromTradeWallet(toasts === undefined ? undefined : { toasts }), { wrapper });
}

beforeEach(() => {
  vi.mocked(errorToast).mockClear();
  vi.mocked(wrapWithToast).mockClear();
  vi.mocked(fetchTradeWalletRedeem).mockResolvedValue(planFor());
});

describe("the trade wallet's redeem for a popup that says each stage itself", () => {
  it("sends silently, with no toast from the send", async () => {
    const shown = planFor();
    vi.mocked(readTradeWalletRedeem).mockResolvedValue({ plan: shown, scope: SCOPE });
    const { result } = setup(false);

    await act(() => result.current.mutateAsync({ shown, owner: OWNER, session: SESSION }));

    expect(vi.mocked(wrapWithToast).mock.calls[0]![3]).toEqual({ silent: true });
  });

  it("raises no toast for a refused or unread batch, whose failure the popup shows", async () => {
    const shown = planFor();
    vi.mocked(readTradeWalletRedeem).mockResolvedValue({
      plan: planFor({ parentBalances: [WAD, WAD, 0n, 0n] }),
      scope: SCOPE,
    });
    const { result } = setup(false);
    act(() => result.current.mutate({ shown, owner: OWNER, session: SESSION }));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(RedeemPlanChangedError));

    vi.mocked(readTradeWalletRedeem).mockRejectedValue(new Error("network"));
    act(() => result.current.mutate({ shown, owner: OWNER, session: SESSION }));
    await waitFor(() => expect(result.current.failure?.text).toMatch(/Could not read your trade wallet/));

    expect(errorToast).not.toHaveBeenCalled();
  });

  it("keeps its toasts for any other caller", async () => {
    const shown = planFor();
    vi.mocked(readTradeWalletRedeem).mockRejectedValue(new Error("network"));
    const { result } = setup();
    act(() => result.current.mutate({ shown, owner: OWNER, session: SESSION }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorToast).toHaveBeenCalledTimes(1);
  });
});
