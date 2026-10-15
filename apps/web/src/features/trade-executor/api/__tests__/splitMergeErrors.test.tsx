import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import { UserRejectedRequestError, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorToast } from "@/utils/toast";

import { gnosisRouterAddress } from "@/config/contracts";

import { useMergeFromExecutor } from "../mergeFromExecutor";
import { useSplitFromExecutor } from "../splitFromExecutor";

vi.mock("@/utils/toast", () => ({ infoToast: vi.fn(), successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: vi.fn(),
}));

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const ROUTER = address("3");
const split = { executor: address("2"), collateral: address("9"), parentMarket: address("7"), amount: 1n };
const merge = { ...split, outcomeTokens: [address("a"), address("d")], invalidToken: address("8") };

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

async function settle(run: () => void, result: { current: { isError: boolean } }) {
  act(run);
  await waitFor(() => expect(result.current.isError).toBe(true));
}

beforeEach(() => {
  vi.mocked(errorToast).mockReset();
  vi.mocked(sendTransaction).mockReset();
  vi.mocked(gnosisRouterAddress).mockReturnValue(ROUTER);
});

describe("Mint and Merge failing before anything is sent", () => {
  it("toasts once that Mint is not available without a router", async () => {
    vi.mocked(gnosisRouterAddress).mockReturnValue(null);
    const { result } = renderHook(() => useSplitFromExecutor(), { wrapper });

    await settle(() => result.current.mutate(split), result);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("Mint and Merge are not available on this network.");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("toasts once that Merge is not available without a router", async () => {
    vi.mocked(gnosisRouterAddress).mockReturnValue(null);
    const { result } = renderHook(() => useMergeFromExecutor(), { wrapper });

    await settle(() => result.current.mutate(merge), result);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("Mint and Merge are not available on this network.");
  });

  it("toasts once that there is nothing to merge without outcome tokens", async () => {
    const { result } = renderHook(() => useMergeFromExecutor(), { wrapper });

    await settle(() => result.current.mutate({ ...merge, outcomeTokens: [] }), result);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("Nothing to merge.");
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});

describe("Mint and Merge failing once sent", () => {
  beforeEach(() => {
    vi.mocked(sendTransaction).mockRejectedValue(new UserRejectedRequestError(new Error("User denied.")));
  });

  it("leaves Mint's toast to the transaction wrapper, so it shows once", async () => {
    const { result } = renderHook(() => useSplitFromExecutor(), { wrapper });

    await settle(() => result.current.mutate(split), result);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("You declined in your wallet.");
  });

  it("leaves Merge's toast to the transaction wrapper, so it shows once", async () => {
    const { result } = renderHook(() => useMergeFromExecutor(), { wrapper });

    await settle(() => result.current.mutate(merge), result);

    expect(errorToast).toHaveBeenCalledExactlyOnceWith("You declined in your wallet.");
  });
});
