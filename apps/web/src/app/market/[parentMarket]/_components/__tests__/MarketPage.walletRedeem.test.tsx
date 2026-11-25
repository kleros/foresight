import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionLiquidity } from "@/features/liquidity/hooks/useSessionLiquidity";
import {
  fetchSessionResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { fetchWalletRedeemInput } from "@/features/resolution/api/getWalletRedeem";
import { sharedLocks } from "@/features/resolution/redeem/__tests__/support/locks";
import { plannerInput } from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem } from "@/features/resolution/redeem/plan";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";
import { walletRedeemKeyPrefix } from "../useWalletRedeem";

const OWNER = "0x1a01000000000000000000000000000000000000" as Address;
const FACTORY = "0x5f00000000000000000000000000000000000000" as Address;

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(async () => ({ parts: [], waiting: [], payout: 0n, tx: null })),
  readTradeWalletRedeem: vi.fn(),
}));
vi.mock("@/features/resolution/api/getWalletRedeem", () => ({ fetchWalletRedeemInput: vi.fn() }));
vi.mock("@/features/liquidity/hooks/useSessionLiquidity", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/liquidity/hooks/useSessionLiquidity")>();
  return { ...original, useSessionLiquidity: vi.fn(original.useSessionLiquidity) };
});
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/features/liquidity/api/getLiquidityPools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/liquidity/api/getLiquidityPools")>()),
  useLiquidityPools: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER, chainId: 100 }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);
const walletMock = vi.mocked(fetchWalletRedeemInput);

const TITLE = "Dune: Part Three, director";
const OPTIONS = [
  { index: 0, name: "Denis Villeneuve", market: addresses.childMarkets[0] },
  { index: 1, name: "Greta Gerwig", market: addresses.childMarkets[1] },
] as const;
const WON: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};
const chain: { parent: ParentResolution } = { parent: WON };

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  const outcomes = request.parentOutcomes ?? OPTIONS.map(({ index }) => index);
  return {
    parent: chain.parent,
    children: Object.fromEntries(
      outcomes.map((index) => [index, { deployed: true, market: OPTIONS[index]!.market, resolved: false }]),
    ),
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** What Remove left in the wallet: parent outcome tokens of the two winners, read for the page's parent. */
const INPUT = { ...plannerInput({ owner: OWNER, childBalances: [] }), parentMarket: addresses.parentMarket };

beforeEach(() => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: sharedLocks().locks });
  window.localStorage.clear();
  chain.parent = WON;
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  walletMock.mockReset();
  walletMock.mockResolvedValue(INPUT);
  vi.mocked(useSessionLiquidity).mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      const children = OPTIONS.map(({ index, name, market }) =>
        sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
      );
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "2", deployedChildCount: "2", openingTime: "1756900800", children },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await waitFor(() => expect(readerMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
}

describe("MarketPage's Redeem popup, for the connected wallet", () => {
  it("lists what the connected wallet itself can redeem once the parent has resolved", async () => {
    await renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Redeem" }));
    const dialog = await screen.findByRole("dialog");
    const list = within(dialog).getByRole("list", { name: "Your wallet" });
    const payout = planWalletRedeem(INPUT).payout;
    expect(payout).toBeGreaterThan(0n);
    expect(within(list).getByText("Winning outcome tokens")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Redeem" })).toBeEnabled();
    expect(walletMock).toHaveBeenCalledTimes(1);
    expect(walletMock.mock.calls[0]![1]).toEqual({
      chainId: 100,
      owner: OWNER,
      sessionFactory: FACTORY,
      sessionId: 1n,
    });
  });

  it("reads nothing while the parent has not resolved", async () => {
    chain.parent = { resolved: false };
    await renderPage();
    await act(async () => {});

    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
    expect(walletMock).not.toHaveBeenCalled();
  });

  it("rereads the wallet's list after every liquidity run, so the tokens a Remove gave back show", async () => {
    await renderPage();

    const reread = vi.mocked(useSessionLiquidity).mock.calls.at(-1)![0].alsoReread;
    expect(reread).toContainEqual(walletRedeemKeyPrefix);
  });
});
