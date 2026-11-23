import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSessionResolution,
  type ParentResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import type { RedeemPlan } from "@/features/resolution/redeem/plan";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses } from "@/testing/fixtures";


import { MarketPage } from "../MarketPage";

const FACTORY = "0x5f00000000000000000000000000000000000000" as Address;
const OWNER = "0x1a00000000000000000000000000000000000001" as Address;

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", () => ({
  fetchTradeWalletRedeem: vi.fn(),
  fetchRedeemScope: vi.fn(),
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
  useAccount: () => ({ address: OWNER, chainId: DEFAULT_CHAIN_ID }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);
const redeemMock = vi.mocked(fetchTradeWalletRedeem);

const TITLE = "Dune: Part Three, director";
const OPTION = { name: "Denis Villeneuve", market: addresses.childMarkets[0] };

const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};

const PLAN: RedeemPlan = {
  parts: [{ market: OPTION.market, payout: 1_234_567_890_123_456_789n }],
  waiting: [],
  payout: 1_234_567_890_123_456_789n,
  tx: { to: "0x7700000000000000000000000000000000000000", data: "0xb1bdad27" },
};

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function answer(parent: ParentResolution) {
  readerMock.mockImplementation(async (_client, request: SessionResolutionRequest) => ({
    parent,
    children: Object.fromEntries(
      (request.parentOutcomes ?? [0]).map((index) => [
        index,
        { deployed: true, market: OPTION.market, resolved: false },
      ]),
    ),
  }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  redeemMock.mockReset();
  redeemMock.mockResolvedValue(PLAN);
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      const children = [
        sessionChildRow({
          id: OPTION.market,
          parentOutcomeIndex: "0",
          parentOutcome: OPTION.name,
          displayName: OPTION.name,
        }),
      ];
      return { Session: [{ ...sessionDetailColumns, outcomeCount: "1", deployedChildCount: "1", children }] };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
});

describe("MarketPage's Redeem section", () => {
  it("reads the connected account's trade wallet redeem once the parent resolved, and lists it", async () => {
    answer(RESOLVED);

    renderPage();

    const section = await screen.findByRole("region", { name: "Redeem from your trade wallet" });
    expect(section).toHaveTextContent(OPTION.name);
    expect(section).toHaveTextContent("1.234567890123456789 sDAI");
    expect(redeemMock).toHaveBeenCalledWith(expect.anything(), {
      chainId: DEFAULT_CHAIN_ID,
      owner: OWNER,
      sessionFactory: FACTORY,
      sessionId: 1n,
    });
  });

  it("reads nothing and shows no section while the parent has not resolved", async () => {
    answer({ resolved: false });

    renderPage();

    await screen.findByRole("heading", { level: 1, name: TITLE });
    await waitFor(() => expect(readerMock).toHaveBeenCalled());
    expect(redeemMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Redeem from your trade wallet" })).toBeNull();
  });
});
