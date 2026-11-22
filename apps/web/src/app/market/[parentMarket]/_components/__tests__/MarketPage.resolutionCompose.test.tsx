import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionResolution, type ParentResolution } from "@/features/resolution/api/getSessionResolution";
import { sessionResolutionKeys } from "@/features/resolution/api/useSessionResolution";
import type { SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { makeQueryClient } from "@/lib/query";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/** Session 7 with two child markets; the route's read and its pre-send recheck must name this session. */

const FACTORY = "0xfac7000000000000000000000000000000000001";
const CHILDREN = ["0xC1C1000000000000000000000000000000000001", "0xC2C2000000000000000000000000000000000002"];

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0xfac7000000000000000000000000000000000001",
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
  useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce", chainId: 100 }),
}));
const card = vi.hoisted(() => ({
  props: [] as Array<{ status: SessionStatus; recheckStatus?: () => Promise<SessionStatus> }>,
}));
vi.mock("../PredictCard", () => ({
  PredictCard: (props: { status: SessionStatus; recheckStatus?: () => Promise<SessionStatus> }) => {
    card.props.push(props);
    return null;
  },
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
  resolutionMock.mockImplementation(async () => {
    if (parent instanceof Error) throw parent;
    return { parent, children: {} };
  });
}

function renderPage() {
  const client = makeQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  return client;
}

const lastCard = () => card.props.at(-1)!;

beforeEach(() => {
  graphqlMock.mockReset();
  resolutionMock.mockReset();
  card.props.length = 0;
  graphqlMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return {
        Session: [
          {
            ...sessionDetailColumns,
            id: "7",
            outcomeCount: "2",
            deployedChildCount: "2",
            children: CHILDREN.map((id, index) => sessionChildRow({ id, parentOutcomeIndex: String(index) })),
          },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [], SessionChart: [] };
  });
});

describe("the route's resolution read for the open session", () => {
  it("reads session 7 of the chain's factory, keying its child read on the session's child markets", async () => {
    answerParent({ resolved: false });
    const client = renderPage();
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(resolutionMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    for (const [, request] of resolutionMock.mock.calls) {
      expect(request.sessionId).toBe(7n);
      expect(request.sessionFactory).toBe(FACTORY);
    }
    const childKeys = client
      .getQueryCache()
      .findAll({ queryKey: [...sessionResolutionKeys.all, "children", FACTORY, "7"] })
      .map((query) => query.queryKey.at(-1));
    expect(childKeys).toEqual([CHILDREN.map((market) => market.toLowerCase())]);
  });

  it("shows Resolved once the read says session 7's parent resolved", async () => {
    answerParent(RESOLVED);
    renderPage();

    expect((await screen.findAllByText("Resolved", undefined, { timeout: 4_000 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(lastCard().status).toBe("resolved"));
  });
});

describe("the route's pre-send recheck", () => {
  it("reads session 7 afresh and gives the status the fresh read makes", async () => {
    answerParent({ resolved: false });
    renderPage();
    await waitFor(() => expect(lastCard().recheckStatus).toBeDefined());
    await waitFor(() => expect(resolutionMock).toHaveBeenCalled());
    answerParent(RESOLVED);
    const before = resolutionMock.mock.calls.length;

    await expect(lastCard().recheckStatus!()).resolves.toBe("resolved");

    const fresh = resolutionMock.mock.calls.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    for (const [, request] of fresh) {
      expect(request.sessionId).toBe(7n);
      expect(request.parentOutcomes).toEqual([]);
    }
  });

  it("gives unknown when the fresh read fails", async () => {
    answerParent({ resolved: false });
    renderPage();
    await waitFor(() => expect(lastCard().recheckStatus).toBeDefined());
    answerParent(new Error("HTTP request failed"));

    await expect(lastCard().recheckStatus!()).resolves.toBe("unknown");
  });

  it("gives trading when the fresh read says the parent has not resolved", async () => {
    answerParent({ resolved: false });
    renderPage();
    await waitFor(() => expect(lastCard().recheckStatus).toBeDefined());

    await expect(lastCard().recheckStatus!()).resolves.toBe("trading");
  });
});
