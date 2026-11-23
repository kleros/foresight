import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import {
  fetchSessionResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
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
  useAccount: () => ({ address: undefined }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);

const TITLE = "Dune: Part Three, director";
const NAME = "Denis Villeneuve";
const MARKET = addresses.childMarkets[0] as Address;
/** Unix seconds; the option's scale runs 0 to 500 $M. */
const CLOSES_AT = 1756900800;

let parent: ParentResolution;
let pool: Record<string, unknown>;

/** Seeded at 500, priced 250 when trading closed and 400 after a later swap. */
const tradedPool = {
  id: "0x00000000000000000000000000000000000000f1",
  childMarket_id: MARKET.toLowerCase(),
  outcomeIsToken0: true,
  underlyingPerOutcome: "800000000000000000",
  updatedAt: String(CLOSES_AT + 3600),
  swaps: [
    { underlyingPerOutcomeAfter: "500000000000000000", timestamp: String(CLOSES_AT - 3600) },
    { underlyingPerOutcomeAfter: "800000000000000000", timestamp: String(CLOSES_AT + 3600) },
  ],
  firstSwap: [{ priceBefore: String(2n ** 96n) }],
};

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  return {
    parent,
    children: request.parentOutcomes?.length === 0 ? {} : { 0: { deployed: true, market: MARKET, resolved: false } },
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

const card = (name: string) =>
  screen.getByRole("heading", { level: 3, name }).closest("button[aria-expanded]")!.parentElement as HTMLElement;

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  useEstimateStore.setState({ estimates: {} });
  pool = tradedPool;
  const rows = [sessionChildRow({ id: MARKET, parentOutcomeIndex: "0", parentOutcome: NAME, displayName: NAME })];
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return {
        Session: [
          {
            ...sessionDetailColumns,
            outcomeCount: "1",
            deployedChildCount: "1",
            openingTime: String(CLOSES_AT),
            children: rows,
          },
        ],
      };
    }
    if (queryName(document) === "SessionChart") return { Pool: [pool] };
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
});

async function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
}

describe("MarketPage compares a resolved option card with the price at close", () => {
  it("shows the pool's price when trading closed, not a trade after it", async () => {
    parent = {
      resolved: true,
      invalid: false,
      winningOutcomes: [0],
      payoutNumerators: [1n, 0n],
      payoutDenominator: 1n,
    };

    await renderPage();

    await waitFor(() => expect(card(NAME)).toHaveTextContent("Waiting for result"));
    await waitFor(() => expect(within(card(NAME)).getByTestId("market-chip")).toHaveTextContent("250 $M"));
  });

  it("shows the seeded price when the pool's first swap came after close", async () => {
    parent = {
      resolved: true,
      invalid: false,
      winningOutcomes: [0],
      payoutNumerators: [1n, 0n],
      payoutDenominator: 1n,
    };
    // seeded at 0.25 (sqrt price 2^95 with the outcome as token0); the one swap, after close, moved it to 0.8
    pool = {
      ...tradedPool,
      swaps: [{ underlyingPerOutcomeAfter: "800000000000000000", timestamp: String(CLOSES_AT + 3600) }],
      firstSwap: [{ priceBefore: String(2n ** 95n) }],
    };

    await renderPage();

    await waitFor(() => expect(card(NAME)).toHaveTextContent("Waiting for result"));
    await waitFor(() => expect(within(card(NAME)).getByTestId("market-chip")).toHaveTextContent("125 $M"));
  });

  it("shows the latest price while the session is not resolved", async () => {
    parent = { resolved: false };

    await renderPage();

    await waitFor(() => expect(within(card(NAME)).getByTestId("market-chip")).toHaveTextContent("400 $M"));
  });
});
