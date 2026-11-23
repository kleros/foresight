import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getConnection, sendTransaction, waitForTransactionReceipt } from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRedeemScope, fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { planTradeWalletRedeem, type TradeWalletRedeemInput } from "@/features/resolution/redeem/plan";
import type { RedeemScope } from "@/features/resolution/redeem/tradeWalletBatchAllowed";
import { fundsKeyPrefix } from "@/features/trade-executor/api/getFunds";

import { errorToast } from "@/utils/toast";

import { useRedeemFromTradeWallet, useTradeWalletRedeem } from "../useTradeWalletRedeem";

vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@wagmi/core", () => ({
  getConnection: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER, chainId: 100 }) }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/utils/toast", () => ({ infoToast: vi.fn(), successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(),
  fetchRedeemScope: vi.fn(),
}));

type Receipt = Awaited<ReturnType<typeof waitForTransactionReceipt>>;

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const OWNER = at("1a01");
const OTHER = at("1a02");
const SDAI = at("af");
const PARENT = at("b0");
const parentTokens = [at("e00"), at("e01")];
const SESSION = { sessionFactory: at("5f"), sessionId: 7n };
const HASH = `0x${"ab".repeat(32)}` as const;
const WAD = 10n ** 18n;

const scope: RedeemScope = { collateral: SDAI, parentMarket: PARENT, parentTokens, children: {} };

/** Option 0 of one won; the trade wallet holds `balance` of its parent token. */
const planFor = (owner: Address, balance = 3n * WAD) =>
  planTradeWalletRedeem({
    chainId: 100,
    owner,
    collateral: SDAI,
    parentMarket: PARENT,
    resolution: {
      parent: {
        resolved: true,
        invalid: false,
        winningOutcomes: [0],
        payoutNumerators: [1n, 0n],
        payoutDenominator: 1n,
      },
      children: {},
    },
    parentTokens: parentTokens.map((token, index) => ({ token, balance: index === 0 ? balance : 0n })),
    childTokens: {},
  } satisfies TradeWalletRedeemInput);

const connected = (...accounts: (Address | undefined)[]) => {
  const mock = vi.mocked(getConnection);
  mock.mockReset();
  for (const address of accounts) mock.mockReturnValueOnce({ address } as ReturnType<typeof getConnection>);
  mock.mockReturnValue({ address: accounts.at(-1) } as ReturnType<typeof getConnection>);
};

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useRedeemFromTradeWallet(), { wrapper });
  return { result, invalidate };
}

beforeEach(() => {
  vi.mocked(errorToast).mockReset();
  vi.mocked(sendTransaction).mockReset().mockResolvedValue(HASH);
  vi.mocked(waitForTransactionReceipt)
    .mockReset()
    .mockResolvedValue({ status: "success" } as Receipt);
  vi.mocked(fetchRedeemScope).mockReset().mockResolvedValue(scope);
  vi.mocked(fetchTradeWalletRedeem)
    .mockReset()
    .mockImplementation(async (_client, { owner }) => planFor(owner));
  connected(OWNER);
});

describe("sending a trade wallet redeem", () => {
  it("signs the shown batch from the connected account, on the session's own reads", async () => {
    const { result } = setup();
    const plan = planFor(OWNER);

    await act(() => result.current.mutateAsync({ plan, session: SESSION }));

    expect(fetchTradeWalletRedeem).toHaveBeenCalledWith(expect.anything(), { chainId: 100, owner: OWNER, ...SESSION });
    expect(fetchRedeemScope).toHaveBeenCalledWith(expect.anything(), { chainId: 100, ...SESSION });
    expect(sendTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      account: OWNER,
      to: plan.tx!.to,
      data: plan.tx!.data,
      chainId: 100,
    });
  });

  it("R6 stops, rereads and sends nothing when a balance changed after the plan was shown", async () => {
    vi.mocked(fetchTradeWalletRedeem).mockImplementation(async (_client, { owner }) => planFor(owner, 2n * WAD));
    const { result, invalidate } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(
      "What your trade wallet can redeem changed. Check the list and press Redeem again.",
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fundsKeyPrefix });
  });

  it("R6 stops when the plan shown was for another account than the one connected at press", async () => {
    connected(OTHER);
    const { result } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(fetchTradeWalletRedeem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ owner: OTHER }));
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("R6 stops when the account switches while the plan is read again", async () => {
    connected(OWNER, OTHER);
    const { result } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      "What your trade wallet can redeem changed. Check the list and press Redeem again.",
    );
  });

  it("R6 stops when the same batch would now pay another amount than the one shown", async () => {
    vi.mocked(fetchTradeWalletRedeem).mockImplementation(async (_client, { owner }) => {
      const fresh = planFor(owner);
      return { ...fresh, payout: fresh.payout + 1n };
    });
    const { result } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("R8 stops as unlisted, with no prompt, when the batch names a token outside the session's markets", async () => {
    vi.mocked(fetchRedeemScope).mockResolvedValue({ ...scope, parentTokens: [at("e09"), parentTokens[1]!] });
    const { result } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      "Not sent: this redeem does not match what Foresight allows for your connected account.",
    );
  });

  it("sends nothing and says so when a read before the send fails", async () => {
    vi.mocked(fetchRedeemScope).mockRejectedValue(new Error("node down"));
    const { result } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith("The network did not answer.");
  });

  it("A5 rereads balances and the list only once the receipt is in", async () => {
    let land: (receipt: Receipt) => void = () => undefined;
    vi.mocked(waitForTransactionReceipt).mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { result, invalidate } = setup();

    act(() => result.current.mutate({ plan: planFor(OWNER), session: SESSION }));
    await waitFor(() => expect(waitForTransactionReceipt).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => land({ status: "success" } as Receipt));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: fundsKeyPrefix }));
  });

  it("A5 rereads after a reverted receipt too", async () => {
    vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "reverted" } as Receipt);
    const { result, invalidate } = setup();

    await act(() => result.current.mutateAsync({ plan: planFor(OWNER), session: SESSION }).catch(() => undefined));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: fundsKeyPrefix });
  });

  it("A5 rereads the shown list after the run, so a second Redeem offers nothing", async () => {
    vi.mocked(fetchTradeWalletRedeem).mockImplementation(async (_client, { owner }) =>
      planFor(owner, vi.mocked(sendTransaction).mock.calls.length > 0 ? 0n : 3n * WAD),
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ list: useTradeWalletRedeem(SESSION), run: useRedeemFromTradeWallet() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.list.data?.payout).toBe(planFor(OWNER).payout));

    await act(() => result.current.run.mutateAsync({ plan: result.current.list.data!, session: SESSION }));

    await waitFor(() => expect(result.current.list.data).toMatchObject({ parts: [], payout: 0n, tx: null }));
  });
});
