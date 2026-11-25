import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import { decodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTradeWalletRedeem, readTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { readTradeWalletRedeemToOwner } from "@/features/resolution/api/getTradeWalletRedeemToOwner";
import {
  OWNER,
  planFor,
  plannerInput,
  SCOPE,
  SDAI,
  TWO_WINNERS,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planTradeWalletRedeemToOwner, withOwnerTransfer } from "@/features/resolution/redeem/payOwner";
import { UnlistedRedeemError } from "@/features/resolution/redeem/tradeWalletBatchAllowed";

import { errorToast } from "@/utils/toast";

import { tradeExecutorAbi } from "@/config/contracts";

import {
  NOT_SENT_COPY,
  realisedPnlKeyPrefix,
  RedeemPlanChangedError,
  useRedeemFromTradeWallet,
} from "../useTradeWalletRedeem";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({ sendTransaction: vi.fn(async () => "0xhash") }));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/utils/toast", () => ({ errorToast: vi.fn() }));
vi.mock("@/utils/wrapWithToast", () => ({
  wrapWithToast: async (_config: unknown, send: () => Promise<unknown>) => {
    await send();
    return { status: "success" };
  },
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(),
  readTradeWalletRedeem: vi.fn(),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeemToOwner", () => ({ readTradeWalletRedeemToOwner: vi.fn() }));

/** Spec D12: a ticked press sends the batch read again with the owner transfer, only as it was shown. */

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const ONCHAIN_OWNER = getAddress("0x0a22000000000000000000000000000000000bc7");
const OTHER_ONCHAIN_OWNER = getAddress("0x0a33000000000000000000000000000000000bc7");

const readMock = vi.mocked(readTradeWalletRedeemToOwner);
const sendMock = vi.mocked(sendTransaction);

function setup(
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRedeemFromTradeWallet(), { wrapper }).result;
}

/** The fresh ticked read: the plan for `input` paid to `owner`, checked against `resolution`. */
function freshRead(owner: Address, input = plannerInput(), resolution = input.resolution) {
  return { plan: planTradeWalletRedeemToOwner(input, owner), scope: SCOPE, payout: { owner, resolution } };
}

function lastCall(data: `0x${string}`) {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (outer.functionName !== "batchExecute") throw new Error(outer.functionName);
  return outer.args[0].at(-1)!;
}

beforeEach(() => {
  readMock.mockReset();
  sendMock.mockClear();
  vi.mocked(fetchTradeWalletRedeem).mockReset();
  vi.mocked(readTradeWalletRedeem).mockReset();
  vi.mocked(errorToast).mockClear();
});

describe("a ticked redeem run", () => {
  it("sends the shown batch with one transfer of its payout to the shown owner, for two owners", async () => {
    for (const owner of [ONCHAIN_OWNER, OTHER_ONCHAIN_OWNER]) {
      sendMock.mockClear();
      const shown = planFor();
      const fresh = freshRead(owner);
      readMock.mockResolvedValue(fresh);
      const result = setup();

      await act(() => result.current.mutateAsync({ shown, owner: OWNER, session: SESSION, payTo: owner }));

      expect(readMock.mock.calls.at(-1)![1]).toEqual({ chainId: 100, owner: OWNER, ...SESSION });
      expect(readTradeWalletRedeem).not.toHaveBeenCalled();
      expect(sendMock).toHaveBeenCalledTimes(1);
      const sent = sendMock.mock.calls[0]![1] as { to: Address; data: `0x${string}` };
      expect(sent.to).toBe(shown.tx!.to);
      expect(sent.data).toBe(fresh.plan.tx!.data);
      const last = lastCall(sent.data);
      expect(last.to).toBe(SDAI);
      expect(decodeFunctionData({ abi: erc20Abi, data: last.data }).args).toEqual([owner, shown.payout]);
    }
  });

  it("sends nothing, though shown and fresh agree, when the transfer is the payout + 1 or - 1", async () => {
    for (const offset of [1n, -1n]) {
      sendMock.mockClear();
      const base = planFor();
      const shown = { ...base, payout: base.payout + offset };
      readMock.mockResolvedValue({
        plan: withOwnerTransfer(shown, SDAI, ONCHAIN_OWNER),
        scope: SCOPE,
        payout: { owner: ONCHAIN_OWNER, resolution: TWO_WINNERS },
      });
      const result = setup();

      act(() => result.current.mutate({ shown, owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }));

      await waitFor(() => expect(result.current.error).toBeInstanceOf(UnlistedRedeemError));
      expect(sendMock).not.toHaveBeenCalled();
    }
  });

  it("reads the realised P&L again after the run", async () => {
    readMock.mockResolvedValue(freshRead(ONCHAIN_OWNER));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const result = setup(client);

    await act(() =>
      result.current.mutateAsync({ shown: planFor(), owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }),
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: realisedPnlKeyPrefix });
  });

  it("sends nothing when the trade wallet's owner on-chain is not the one shown", async () => {
    readMock.mockResolvedValue(freshRead(OTHER_ONCHAIN_OWNER));
    const result = setup();

    act(() => result.current.mutate({ shown: planFor(), owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(RedeemPlanChangedError));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the fresh read pays another amount than shown", async () => {
    const repriced = plannerInput({
      resolution: { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 0: valuedChild(0, 50n) } },
    });
    readMock.mockResolvedValue(freshRead(ONCHAIN_OWNER, repriced));
    const result = setup();

    act(() => result.current.mutate({ shown: planFor(), owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(RedeemPlanChangedError));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends nothing, and says so, when the transfer departs from the payout the chain's numerators give", async () => {
    const misread = plannerInput({
      resolution: { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 0: valuedChild(0, 43n) } },
    });
    const shown = planFor({ resolution: misread.resolution });
    readMock.mockResolvedValue(freshRead(ONCHAIN_OWNER, misread, TWO_WINNERS));
    const result = setup();

    act(() => result.current.mutate({ shown, owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(UnlistedRedeemError));
    expect(sendMock).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(NOT_SENT_COPY);
  });

  it("sends nothing, and says so, when the fresh read fails", async () => {
    readMock.mockRejectedValue(new Error("owner() reverted"));
    const result = setup();

    act(() => result.current.mutate({ shown: planFor(), owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(sendMock).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a shown list with no batch", async () => {
    readMock.mockResolvedValue(freshRead(ONCHAIN_OWNER));
    const result = setup();

    act(() =>
      result.current.mutate({
        shown: { ...planFor(), tx: null },
        owner: OWNER,
        session: SESSION,
        payTo: ONCHAIN_OWNER,
      }),
    );

    await waitFor(() => expect(result.current.error).toBeInstanceOf(RedeemPlanChangedError));
    expect(sendMock).not.toHaveBeenCalled();
  });
});
