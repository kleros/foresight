import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem, readTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import {
  planFor,
  resolvedParent,
  SCOPE,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
  OWNER,
  WAD,
} from "@/features/resolution/redeem/__tests__/support/session";
import type { RedeemPlan } from "@/features/resolution/redeem/plan";
import { UnlistedRedeemError } from "@/features/resolution/redeem/tradeWalletBatchAllowed";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { errorToast } from "@/utils/toast";

import {
  NOT_SENT_COPY,
  RedeemPlanChangedError,
  useRedeemFromTradeWallet,
  useTradeWalletRedeem,
  WAITING_REREAD_MS,
} from "../useTradeWalletRedeem";

const account: { address: Address | undefined; chainId: number | undefined } = { address: OWNER, chainId: 100 };

vi.mock("wagmi", () => ({ useAccount: () => account }));
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

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const RESOLVED = TWO_WINNERS.parent;
const STRANGER = "0x5700000000000000000000000000000000000c56" as Address;

const fetchMock = vi.mocked(fetchTradeWalletRedeem);
const readMock = vi.mocked(readTradeWalletRedeem);
const sendMock = vi.mocked(sendTransaction);

function setup(parent: ParentResolution | Error | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ resolution }: { resolution: ParentResolution | Error | undefined }) => ({
      list: useTradeWalletRedeem(SESSION, resolution),
      run: useRedeemFromTradeWallet(),
    }),
    { wrapper, initialProps: { resolution: parent } },
  );
  return { client, ...hook };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  account.address = OWNER;
  account.chainId = 100;
  fetchMock.mockReset();
  readMock.mockReset();
  sendMock.mockClear();
  vi.mocked(errorToast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the redeem list", () => {
  it("is read only once the parent has resolved, for the connected account and the session", async () => {
    fetchMock.mockResolvedValue(planFor());
    const { rerender, result } = setup(undefined);
    for (const resolution of [{ resolved: false } as const, new Error("read failed"), undefined]) {
      rerender({ resolution });
      await act(async () => {});
    }
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ resolution: RESOLVED });
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toEqual({ chainId: 100, owner: OWNER, ...SESSION });
  });

  it("is not read without a connected account, or on another chain", async () => {
    fetchMock.mockResolvedValue(planFor());
    account.address = undefined;
    const first = setup(RESOLVED);
    await act(async () => {});
    first.unmount();
    account.address = OWNER;
    account.chainId = 1;
    setup(RESOLVED);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is read again every 30 s while a held option waits for its result, and no more once none waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const waiting = planFor({
      resolution: { ...TWO_WINNERS, children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) } },
    });
    expect(waiting.waiting).toEqual([1]);
    fetchMock.mockResolvedValueOnce(waiting).mockResolvedValue(planFor());
    setup(RESOLVED);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(WAITING_REREAD_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(3 * WAITING_REREAD_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is read again when the trade wallet's funds are invalidated", async () => {
    fetchMock.mockResolvedValue(planFor());
    const { client, result } = setup(RESOLVED);
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    await act(() => client.invalidateQueries({ queryKey: fundsKeyPrefix }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("a redeem run", () => {
  async function shownList(plan: RedeemPlan = planFor()) {
    fetchMock.mockResolvedValueOnce(plan);
    const hook = setup(RESOLVED);
    await waitFor(() => expect(hook.result.current.list.data).toEqual(plan));
    return { ...hook, shown: plan };
  }

  it("sends the shown batch from the owner, and stays pending until the list is read again", async () => {
    const { result, shown } = await shownList();
    readMock.mockResolvedValue({ plan: planFor(), scope: SCOPE });
    const reread = deferred<RedeemPlan>();
    fetchMock.mockReturnValueOnce(reread.promise);

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![1]).toEqual({ account: OWNER, chainId: 100, to: shown.tx!.to, data: shown.tx!.data });
    expect(readMock.mock.calls[0]![1]).toEqual({ chainId: 100, owner: OWNER, ...SESSION });
    expect(result.current.run.isPending).toBe(true);

    const after = planFor({ parentBalances: [0n, 0n, 7n * WAD, 9n * WAD], childBalances: [] });
    await act(async () => reread.resolve(after));
    await waitFor(() => expect(result.current.run.isSuccess).toBe(true));
    expect(result.current.list.data).toEqual(after);
    expect(after.tx).toBeNull();
  });

  it("sends nothing when a fresh read redeems other amounts, and reads the list again", async () => {
    const { result, shown } = await shownList();
    readMock.mockResolvedValue({ plan: planFor({ parentBalances: [WAD, WAD, 0n, 0n] }), scope: SCOPE });
    fetchMock.mockResolvedValue(planFor());

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(result.current.run.isError).toBe(true));
    expect(result.current.run.error).toBeInstanceOf(RedeemPlanChangedError);
    expect(sendMock).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(new RedeemPlanChangedError().message);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when a fresh read pays differently for the same calls", async () => {
    const { result, shown } = await shownList();
    const repriced = planFor({ resolution: { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 0: valuedChild(0, 50n) } } });
    expect(repriced.tx!.data).toBe(shown.tx!.data);
    expect(repriced.payout).not.toBe(shown.payout);
    readMock.mockResolvedValue({ plan: repriced, scope: SCOPE });
    fetchMock.mockResolvedValue(repriced);

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(result.current.run.error).toBeInstanceOf(RedeemPlanChangedError));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the batch departs from the allow-list against the session's markets", async () => {
    const { result, shown } = await shownList();
    readMock.mockResolvedValue({ plan: planFor(), scope: { ...SCOPE, collateral: STRANGER } });
    fetchMock.mockResolvedValue(planFor());

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(result.current.run.error).toBeInstanceOf(UnlistedRedeemError));
    expect(sendMock).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(NOT_SENT_COPY);
  });

  it("sends nothing, and says so, when the fresh read fails", async () => {
    const { result, shown } = await shownList();
    readMock.mockRejectedValue(new Error("network"));
    fetchMock.mockResolvedValue(planFor());

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(result.current.run.isError).toBe(true));
    expect(sendMock).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a shown list with no batch", async () => {
    const empty = planFor({ resolution: { parent: resolvedParent([0n, 0n, 1n, 0n]), children: TWO_WINNERS.children } });
    const { result, shown } = await shownList({ ...empty, tx: null });
    readMock.mockResolvedValue({ plan: shown, scope: SCOPE });
    fetchMock.mockResolvedValue(shown);

    act(() => result.current.run.mutate({ shown, owner: OWNER, session: SESSION }));

    await waitFor(() => expect(result.current.run.error).toBeInstanceOf(RedeemPlanChangedError));
    expect(sendMock).not.toHaveBeenCalled();
  });
});
