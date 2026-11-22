import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * The route reads the parent's resolution through features/resolution and hands it to sessionStatus. The reader,
 * fetchSessionResolution, is mocked; the pools hold in-range liquidity, so without resolution the page trades.
 */

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0xfac7000000000000000000000000000000000001",
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
  useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce", chainId: 100 }),
}));

const graphqlMock = vi.mocked(fetchGraphql);
const resolutionMock = vi.mocked(fetchSessionResolution);

const RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [1],
  payoutNumerators: [0n, 1n, 0n],
  payoutDenominator: 1n,
};

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function answerParent(parent: ParentResolution | Error) {
  resolutionMock.mockImplementation(async (_client, request) => {
    if (parent instanceof Error) throw parent;
    const children = Object.fromEntries(
      (request.parentOutcomes ?? [0, 1]).map((index) => [
        index,
        { deployed: true as const, market: addresses.childMarkets[0], resolved: false as const },
      ]),
    );
    return { parent, children };
  });
}

function renderPage() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
}

const UNKNOWN = /Couldn't check whether this session has resolved/;

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  graphqlMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return { Session: [{ ...sessionDetailColumns, children: [sessionChildRow()] }] };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [], SessionChart: [] };
  });
});

describe("A7 the route composes the resolution read into the session's status", () => {
  it("shows Resolved when the read says the parent resolved, though its pools hold liquidity", async () => {
    answerParent(RESOLVED);
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });

    expect((await screen.findAllByText("Resolved", undefined, { timeout: 4_000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText("Trading")).toBeNull();
    expect(resolutionMock).toHaveBeenCalled();
    expect(resolutionMock.mock.calls.every(([, request]) => request.sessionId === 1n)).toBe(true);
  });

  it("shows Trading when the read says the parent has not resolved", async () => {
    answerParent({ resolved: false });
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });
    await waitFor(() => expect(resolutionMock).toHaveBeenCalled());

    expect(await screen.findByText("Trading")).toBeInTheDocument();
    expect(screen.queryByText("Resolved")).toBeNull();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it(
    "says it could not check, and shows neither Resolved nor Trading, when the read fails",
    async () => {
      answerParent(new Error("HTTP request failed"));
      renderPage();
      await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });

      expect((await screen.findAllByText(UNKNOWN, undefined, { timeout: 6_000 })).length).toBeGreaterThan(0);
      expect(screen.queryByText("Trading")).toBeNull();
      expect(screen.queryByText("Resolved")).toBeNull();
    },
    10_000,
  );
});
