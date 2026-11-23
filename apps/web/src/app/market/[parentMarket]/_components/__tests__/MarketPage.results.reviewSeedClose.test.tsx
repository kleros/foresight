import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSessionResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * A resolved card sets the answer against the market price at the resolution date (`openingTime`), where the
 * chart ends. The chart holds only swap after-prices and the pool's current price, so a pool seeded before that
 * date and first swapped after it is read at its seeded price: the first swap's price before.
 */
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/features/liquidity/api/getLiquidityPools", async (importOriginal) => {
  const token = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
  const session = {
    chainId: 100,
    parentMarket: token(1),
    collateral: token(2),
    parentInvalid: token(3),
    branches: [
      { childMarket: token(4), outcome: token(5), downToken: token(6), upToken: token(7), invalidToken: token(8) },
    ],
  };
  const live = {
    session,
    branches: [
      {
        up: { status: "live", sqrtPriceX96: 2n ** 96n, tickSpacing: 60, liquidity: 10n ** 18n },
        down: { status: "missing" },
      },
    ],
  };
  return {
    ...(await importOriginal<typeof import("@/features/liquidity/api/getLiquidityPools")>()),
    useLiquidityPools: (markets: unknown) => ({ data: markets ? live : undefined, isError: false }),
  };
});
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
const PARENT = addresses.parentMarket;
const VILLENEUVE = { name: "Denis Villeneuve", market: addresses.childMarkets[0] };

/** The resolution date: the session's `openingTime`, unix seconds. */
const CLOSE = 1756900800;
const WAD = 10n ** 18n;
/** UP prices on a 0 to 500 $M scale, 1e18-scaled: 0.5 is 250 $M, 0.8 is 400 $M. */
const PRICE = { "250": String(WAD / 2n), "400": String((WAD * 8n) / 10n) } as const;
/** The X96 sqrt price of an outcome-as-token0 pool priced at 0.25, which is 125 $M. */
const SQRT_AT_125 = String(2n ** 95n);

const RESOLUTION: SessionResolution = {
  parent: { resolved: true, invalid: false, winningOutcomes: [0], payoutNumerators: [1n, 0n], payoutDenominator: 1n },
  children: {
    0: {
      deployed: true,
      market: VILLENEUVE.market,
      resolved: true,
      invalid: false,
      finalValue: 312.5,
      payoutNumerators: [3n, 5n, 0n],
      payoutDenominator: 8n,
    },
  },
};

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  return request.parentOutcomes ? { parent: RESOLUTION.parent, children: {} } : RESOLUTION;
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

interface PoolHistory {
  underlyingPerOutcome: string;
  updatedAt: number;
  swaps: Array<{ underlyingPerOutcomeAfter: string; timestamp: number }>;
  priceBefore?: string;
}

function answerSession(pool: PoolHistory) {
  const children = [
    sessionChildRow({
      id: VILLENEUVE.market,
      parentOutcomeIndex: "0",
      parentOutcome: VILLENEUVE.name,
      displayName: VILLENEUVE.name,
    }),
  ];
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "1", deployedChildCount: "1", openingTime: String(CLOSE), children },
        ],
      };
    }
    if (queryName(document) === "SessionChart") {
      return {
        Pool: [
          {
            id: "0x00000000000000000000000000000000000000f1",
            childMarket_id: VILLENEUVE.market.toLowerCase(),
            outcomeIsToken0: true,
            underlyingPerOutcome: pool.underlyingPerOutcome,
            updatedAt: String(pool.updatedAt),
            swaps: pool.swaps.map(({ underlyingPerOutcomeAfter, timestamp }) => ({
              underlyingPerOutcomeAfter,
              timestamp: String(timestamp),
            })),
            firstSwap: pool.priceBefore ? [{ priceBefore: pool.priceBefore }] : [],
          },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={PARENT} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await waitFor(() =>
    expect(readerMock.mock.calls.some(([, request]) => request.parentOutcomes === undefined)).toBe(true),
  );
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
}

function card(name: string): HTMLElement {
  const toggle = screen
    .getAllByRole("heading", { level: 3, name })
    .map((heading) => heading.closest("button[aria-expanded]"))
    .find((button) => button !== null);
  return toggle!.parentElement as HTMLElement;
}

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
});

describe("MarketPage a resolved card's market price is the price at the resolution date", () => {
  it("reads a pool seeded before the date and first swapped after it at its seeded price", async () => {
    answerSession({
      underlyingPerOutcome: PRICE["400"],
      updatedAt: CLOSE + 3_600,
      swaps: [{ underlyingPerOutcomeAfter: PRICE["400"], timestamp: CLOSE + 3_600 }],
      priceBefore: SQRT_AT_125,
    });

    await renderPage();

    await waitFor(() => expect(within(card(VILLENEUVE.name)).getByTestId("final-value-marker")).toBeTruthy());
    await waitFor(() => expect(within(card(VILLENEUVE.name)).getByTestId("market-chip")).toHaveTextContent("125 $M"));
  });

  it("leaves out a trade after the date", async () => {
    answerSession({
      underlyingPerOutcome: PRICE["400"],
      updatedAt: CLOSE + 3_600,
      swaps: [
        { underlyingPerOutcomeAfter: PRICE["250"], timestamp: CLOSE - 3_600 },
        { underlyingPerOutcomeAfter: PRICE["400"], timestamp: CLOSE + 3_600 },
      ],
      priceBefore: SQRT_AT_125,
    });

    await renderPage();

    await waitFor(() => expect(within(card(VILLENEUVE.name)).getByTestId("market-chip")).toHaveTextContent("250 $M"));
  });
});
