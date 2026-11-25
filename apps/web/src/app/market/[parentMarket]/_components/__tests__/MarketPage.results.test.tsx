import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import {
  fetchSessionResolution,
  type ChildResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * The page reads each market's resolution through `fetchSessionResolution` (the parent with `parentOutcomes: []`,
 * the children with it omitted) and shows the results in the header and on each option card.
 * The one handle these tests name: a winning option's final value is drawn on its slider as an element with
 * `data-testid="final-value-marker"`, placed by an inline `left` percentage of the option's range, as
 * `market-pin` is.
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
const THIRD_CHILD = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;

/** Three options on a 0 to 500 $M scale; the parent is multi-select, so more than one can win. */
const OPTIONS = [
  { index: 0, name: "Denis Villeneuve", market: addresses.childMarkets[0] },
  { index: 1, name: "Greta Gerwig", market: addresses.childMarkets[1] },
  { index: 2, name: "Christopher Nolan", market: THIRD_CHILD },
] as const;
const [VILLENEUVE, GERWIG, NOLAN] = OPTIONS;
const LOWER = 0;
const UPPER = 500;

/** Villeneuve's UP pool priced at half its range: the market price at close reads 250 $M. */
const PRICE_AT_CLOSE = "250 $M";
const VISITOR_ESTIMATE = 400;

const unresolvedChild = (market: Address): ChildResolution => ({ deployed: true, market, resolved: false });
const resolvedChild = (market: Address, finalValue: number): ChildResolution => {
  const share = (finalValue - LOWER) / (UPPER - LOWER);
  const up = BigInt(Math.round(share * 1000));
  return {
    deployed: true,
    market,
    resolved: true,
    invalid: false,
    finalValue,
    payoutNumerators: [1000n - up, up, 0n],
    payoutDenominator: 1000n,
  };
};
const invalidChild = (market: Address): ChildResolution => ({
  deployed: true,
  market,
  resolved: true,
  invalid: true,
  finalValue: null,
  payoutNumerators: [0n, 0n, 1n],
  payoutDenominator: 1n,
});

/** Villeneuve and Gerwig won; Nolan did not. */
const TWO_WINNERS: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0, 1],
  payoutNumerators: [1n, 1n, 0n, 0n],
  payoutDenominator: 2n,
};
const INVALID_PARENT: ParentResolution = {
  resolved: true,
  invalid: true,
  winningOutcomes: [],
  payoutNumerators: [0n, 0n, 0n, 1n],
  payoutDenominator: 1n,
};

const chain: { parent: ParentResolution; children: Record<number, ChildResolution> } = {
  parent: TWO_WINNERS,
  children: {},
};

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  const outcomes = request.parentOutcomes ?? OPTIONS.map(({ index }) => index);
  return {
    parent: chain.parent,
    children: Object.fromEntries(
      outcomes.map((index) => [index, chain.children[index] ?? unresolvedChild(OPTIONS[index]!.market)]),
    ),
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

function answerSession() {
  const children = OPTIONS.map(({ index, name, market }) =>
    sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
  );
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "3", deployedChildCount: "3", openingTime: "1756900800", children },
        ],
      };
    }
    if (queryName(document) === "SessionChart") {
      return {
        Pool: [
          {
            id: "0x00000000000000000000000000000000000000f1",
            childMarket_id: VILLENEUVE.market.toLowerCase(),
            underlyingPerOutcome: "500000000000000000",
            updatedAt: "1756000000",
            swaps: [],
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
  await waitFor(() => expect(screen.getAllByText("Resolved").length).toBeGreaterThan(0));
  // the children's read is the one without `parentOutcomes`; both reads settle before any assertion
  await waitFor(() =>
    expect(readerMock.mock.calls.some(([, request]) => request.parentOutcomes === undefined)).toBe(true),
  );
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
}

const header = () => screen.getByRole("heading", { level: 1, name: TITLE }).closest("header") as HTMLElement;

/** The option card: the Disclosure whose toggle holds the option's name. */
function card(name: string): HTMLElement {
  const toggle = screen
    .getAllByRole("heading", { level: 3, name })
    .map((heading) => heading.closest("button[aria-expanded]"))
    .find((button) => button !== null);
  expect(toggle, `the ${name} card`).toBeTruthy();
  return toggle!.parentElement as HTMLElement;
}

const marker = (name: string) => within(card(name)).queryByTestId("final-value-marker");

beforeEach(() => {
  fetchMock.mockReset();
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  useEstimateStore.setState({ estimates: {} });
  chain.parent = TWO_WINNERS;
  chain.children = {};
  answerSession();
});

describe("MarketPage A1 shows a resolved session's results in the header and on each option card", () => {
  it("winner resolved: the header reads Resolved with no list of winners (D14); its card shows the final value beside the estimate and the price at close", async () => {
    useEstimateStore.getState().setEstimate(PARENT, VILLENEUVE.market, VISITOR_ESTIMATE);
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5), 1: resolvedChild(GERWIG.market, 125) };

    await renderPage();

    await waitFor(() => expect(marker(VILLENEUVE.name)).not.toBeNull());
    expect(header()).toHaveTextContent("Resolved");
    expect(header()).not.toHaveTextContent(/Selected options?/);
    for (const winner of [VILLENEUVE, GERWIG]) expect(header()).not.toHaveTextContent(winner.name);
    expect(header()).not.toHaveTextContent("312.5 $M");
    expect(header()).not.toHaveTextContent("125 $M");

    const villeneuve = card(VILLENEUVE.name);
    expect(villeneuve).toHaveTextContent("312.5 $M");
    expect(villeneuve).toHaveTextContent(`${VISITOR_ESTIMATE} $M`);
    expect(within(villeneuve).getByTestId("market-chip")).toHaveTextContent(PRICE_AT_CLOSE);
    expect(villeneuve).not.toHaveTextContent("Not selected");
    expect(villeneuve).not.toHaveTextContent("Waiting for result");
    expect(marker(GERWIG.name)).not.toBeNull();
  });

  it("winner waiting: its card reads Waiting for result, with no final value, and the header lists no winner", async () => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5) };

    await renderPage();

    await waitFor(() => expect(card(GERWIG.name)).toHaveTextContent("Waiting for result"));
    expect(marker(GERWIG.name)).toBeNull();
    expect(card(GERWIG.name)).not.toHaveTextContent("Not selected");
    expect(header()).not.toHaveTextContent(GERWIG.name);
    expect(header()).not.toHaveTextContent(VILLENEUVE.name);
    expect(card(VILLENEUVE.name)).not.toHaveTextContent("Waiting for result");
  });

  it("loser: its card reads Not selected, never Waiting for result, and the header leaves it out", async () => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5), 1: resolvedChild(GERWIG.market, 125) };

    await renderPage();

    await waitFor(() => expect(card(NOLAN.name)).toHaveTextContent("Not selected"));
    expect(card(NOLAN.name)).not.toHaveTextContent("Waiting for result");
    expect(marker(NOLAN.name)).toBeNull();
    expect(header()).not.toHaveTextContent(NOLAN.name);
    for (const winner of [VILLENEUVE, GERWIG]) expect(card(winner.name)).not.toHaveTextContent("Not selected");
  });

  it("INVALID child: the winner's card reads Invalid, with no final value and no wait", async () => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5), 1: invalidChild(GERWIG.market) };

    await renderPage();

    await waitFor(() => expect(card(GERWIG.name)).toHaveTextContent("Invalid"));
    expect(marker(GERWIG.name)).toBeNull();
    expect(card(GERWIG.name)).not.toHaveTextContent("Waiting for result");
    expect(card(GERWIG.name)).not.toHaveTextContent("Not selected");
    expect(card(VILLENEUVE.name)).not.toHaveTextContent("Invalid");
  });

  it("INVALID parent: the header reads Invalid, and no card shows a final value", async () => {
    chain.parent = INVALID_PARENT;
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5) };

    await renderPage();

    await waitFor(() => expect(header()).toHaveTextContent("Invalid"));
    for (const { name } of OPTIONS) {
      expect(marker(name)).toBeNull();
      expect(card(name)).not.toHaveTextContent("Waiting for result");
    }
  });
});

describe("MarketPage A2 the final-value marker sits at the resolved value on the slider scale", () => {
  it.each([
    { at: "the lower bound", finalValue: LOWER, percent: 0 },
    { at: "a value inside", finalValue: 125, percent: 25 },
    { at: "the upper bound", finalValue: UPPER, percent: 100 },
  ])("at $at ($finalValue) it sits $percent percent along the track", async ({ finalValue, percent }) => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, finalValue) };

    await renderPage();

    await waitFor(() => expect(marker(VILLENEUVE.name)).not.toBeNull());
    expect(parseFloat(marker(VILLENEUVE.name)!.style.left)).toBeCloseTo(percent, 5);
  });
});

describe("MarketPage A7 a final value at a bound reads as open-ended; one inside reads as the value", () => {
  it.each([
    { at: "the upper bound", finalValue: UPPER, reads: "500 $M or more" },
    { at: "the lower bound", finalValue: LOWER, reads: "0 $M or less" },
  ])("a child resolved at $at reads open-ended on its card", async ({ finalValue, reads }) => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, finalValue) };

    await renderPage();

    await waitFor(() => expect(card(VILLENEUVE.name)).toHaveTextContent(reads));
  });

  it("a child resolved inside the bounds reads as the value, neither or more nor or less", async () => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market, 312.5) };

    await renderPage();

    await waitFor(() => expect(card(VILLENEUVE.name)).toHaveTextContent("312.5 $M"));
    expect(card(VILLENEUVE.name)).not.toHaveTextContent(/or more|or less/);
  });
});
