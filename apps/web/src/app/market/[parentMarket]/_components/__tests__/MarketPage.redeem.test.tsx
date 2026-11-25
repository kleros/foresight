import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSessionResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { sessionResolutionKeys } from "@/features/resolution/api/useSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

const OWNER = "0x1a01000000000000000000000000000000000000" as Address;
const FACTORY = "0x5f00000000000000000000000000000000000000" as Address;

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(),
  readTradeWalletRedeem: vi.fn(),
}));
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
const redeemMock = vi.mocked(fetchTradeWalletRedeem);

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

beforeEach(() => {
  chain.parent = WON;
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  redeemMock.mockReset();
  redeemMock.mockResolvedValue({
    parts: [{ market: addresses.parentMarket, payout: 3n * 10n ** 18n + 7n }],
    waiting: [],
    payout: 3n * 10n ** 18n + 7n,
    tx: { to: OWNER, data: "0x" },
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      const children = OPTIONS.map(({ index, name, market }) =>
        sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
      );
      // opened 2025-09-03, so the resolution date has passed
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "2", deployedChildCount: "2", openingTime: "1756900800", children },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
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
  return client;
}

describe("MarketPage's Redeem popup, for the trade wallet", () => {
  it("lists what the connected account's trade wallet can redeem once the parent has resolved", async () => {
    await renderPage();

    const button = await screen.findByRole("button", { name: "Redeem 3.00 sDAI" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("3.00 sDAI goes to your trade wallet.")).toBeInTheDocument();
    expect(redeemMock).toHaveBeenCalledTimes(1);
    expect(redeemMock.mock.calls[0]![1]).toMatchObject({ chainId: 100, owner: OWNER, sessionFactory: FACTORY });
  });

  it("reads nothing past the resolution date while the parent has not resolved", async () => {
    chain.parent = { resolved: false };
    await renderPage();
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /^Redeem( |$)/ })).toBeNull();
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it("withdraws a cached redeem when the parent's result cannot be read, then restores it after recovery", async () => {
    const client = await renderPage();
    expect(await screen.findByRole("button", { name: "Redeem 3.00 sDAI" })).toBeEnabled();

    readerMock.mockRejectedValue(new Error("RPC unavailable"));
    await act(() => client.invalidateQueries({ queryKey: sessionResolutionKeys.all }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Redeem( |$)/ })).toBeNull());
    expect(screen.getByText("Could not read this session's result.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Trade wallet" })).toBeNull();
    expect(screen.queryByText("3.00 sDAI goes to your trade wallet.")).toBeNull();

    readerMock.mockImplementation((_client, request) => answer(request));
    await act(() => client.invalidateQueries({ queryKey: sessionResolutionKeys.all }));

    expect(await screen.findByRole("button", { name: "Redeem 3.00 sDAI" })).toBeEnabled();
    expect(screen.queryByText("Could not read this session's result.")).toBeNull();
  });
});
