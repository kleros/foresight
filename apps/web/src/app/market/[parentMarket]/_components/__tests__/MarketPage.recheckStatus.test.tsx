import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import type { SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/** The route hands Predict a re-check that reads the parent again and turns the fresh read into a status. */

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
const card = vi.hoisted(() => ({ recheck: undefined as (() => Promise<SessionStatus>) | undefined }));
vi.mock("../PredictCard", () => ({
  PredictCard: (props: { recheckStatus?: () => Promise<SessionStatus> }) => {
    card.recheck = props.recheckStatus;
    return null;
  },
}));
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

/** Parent-only reads answer from `parents` in order, the last one repeating. */
function answerParents(parents: Array<ParentResolution | Error>) {
  let next = 0;
  resolutionMock.mockImplementation(async (_client, request) => {
    if (request.parentOutcomes?.length !== 0) return { parent: { resolved: false }, children: {} };
    const reply = parents[Math.min(next++, parents.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return { parent: reply, children: {} };
  });
}

const parentReads = () => resolutionMock.mock.calls.filter(([, request]) => request.parentOutcomes?.length === 0);

async function renderPage() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" });
  await screen.findByText("Trading");
  await waitFor(() => expect(card.recheck).toBeDefined());
}

async function recheck() {
  let status: SessionStatus | undefined;
  await act(async () => {
    status = await card.recheck!();
  });
  return status;
}

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  card.recheck = undefined;
  graphqlMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return { Session: [{ ...sessionDetailColumns, children: [sessionChildRow()] }] };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [], SessionChart: [] };
  });
});

describe("the route's status re-check before a send", () => {
  it("reads the parent again and answers resolved once it has resolved", async () => {
    answerParents([{ resolved: false }, RESOLVED]);
    await renderPage();
    const before = parentReads().length;

    expect(await recheck()).toBe("resolved");
    expect(parentReads().length).toBe(before + 1);
    expect(await screen.findAllByText("Resolved")).not.toHaveLength(0);
  });

  it("answers unknown when the fresh read fails", async () => {
    answerParents([{ resolved: false }, new Error("HTTP request failed")]);
    await renderPage();

    expect(await recheck()).toBe("unknown");
  });

  it("answers trading while the parent has still not resolved", async () => {
    answerParents([{ resolved: false }]);
    await renderPage();

    expect(await recheck()).toBe("trading");
  });
});
