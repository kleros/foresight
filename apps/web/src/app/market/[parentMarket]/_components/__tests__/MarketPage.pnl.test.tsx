import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OptionPosition } from "@/features/predict/utils/position";
import { fetchRealisedPnl } from "@/features/resolution/api/getRealisedPnl";
import {
  fetchSessionResolution,
  type ChildResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import type { OptionRealisedPnl, RealisedPnl } from "@/features/resolution/utils/realisedPnl";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Spec D13: the page shows redeem-7's realised P&L (`fetchRealisedPnl`) as a session total in the header and per
 * option on its card. Handles these tests name: a P&L is read out with "profit" or "loss" (spec D21); a negative figure
 * carries a minus sign (`-` or `−`); amounts are sDAI with two decimals.
 * A visitor "never held anything" when the read returns zero cost and zero payout for the session and every option.
 */
vi.mock("@/features/resolution/api/getRealisedPnl", () => ({ fetchRealisedPnl: vi.fn() }));
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
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => wallet.positions }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: wallet.address, chainId: 100 }),
}));

const OWNER = "0x1a01000000000000000000000000000000000000" as Address;
const SDAI = 10n ** 18n;
/** `units` hundredths of an sDAI. */
const cents = (units: number) => (BigInt(units) * SDAI) / 100n;

const wallet: { address: Address | undefined; positions: Record<string, OptionPosition> } = {
  address: OWNER,
  positions: {},
};

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);
const redeemMock = vi.mocked(fetchTradeWalletRedeem);
const pnlMock = vi.mocked(fetchRealisedPnl);

const TITLE = "Dune: Part Three, director";
const THIRD_CHILD = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;
/** Villeneuve and Gerwig won; Nolan was not selected. */
const OPTIONS = [
  { index: 0, name: "Denis Villeneuve", market: addresses.childMarkets[0] },
  { index: 1, name: "Greta Gerwig", market: addresses.childMarkets[1] },
  { index: 2, name: "Christopher Nolan", market: THIRD_CHILD },
] as const;
const [VILLENEUVE, GERWIG, NOLAN] = OPTIONS;

const TWO_WINNERS: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0, 1],
  payoutNumerators: [1n, 1n, 0n, 0n],
  payoutDenominator: 2n,
};

const resolvedChild = (market: Address): ChildResolution => ({
  deployed: true,
  market,
  resolved: true,
  invalid: false,
  finalValue: 250,
  payoutNumerators: [1n, 1n, 0n],
  payoutDenominator: 2n,
});
const unresolvedChild = (market: Address): ChildResolution => ({ deployed: true, market, resolved: false });

const chain: { children: Record<number, ChildResolution> } = { children: {} };

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  const outcomes = request.parentOutcomes ?? OPTIONS.map(({ index }) => index);
  return {
    parent: TWO_WINNERS,
    children: Object.fromEntries(
      outcomes.map((index) => [index, chain.children[index] ?? unresolvedChild(OPTIONS[index]!.market)]),
    ),
  };
}

const settled = (cost: bigint, payout: bigint): OptionRealisedPnl => ({
  status: "settled",
  cost,
  payout,
  pnl: payout - cost,
});

function pnlOf(options: Record<number, OptionRealisedPnl>): RealisedPnl {
  const session = { cost: 0n, payout: 0n, pnl: 0n, waiting: [] as number[] };
  for (const [index, option] of Object.entries(options)) {
    if (option.status === "waiting") {
      session.waiting.push(Number(index));
      continue;
    }
    session.cost += option.cost;
    session.payout += option.payout;
  }
  session.pnl = session.payout - session.cost;
  return { options, session };
}

/** Villeneuve +7.25, Gerwig +0.55, Nolan -4.75: the session reads +3.05. */
const GAIN = pnlOf({
  0: settled(cents(500), cents(1225)),
  1: settled(cents(500), cents(555)),
  2: settled(cents(475), 0n),
});
/** Villeneuve -1.25, Gerwig -0.75, Nolan -1.25: the session reads -3.25. */
const LOSS = pnlOf({
  0: settled(cents(500), cents(375)),
  1: settled(cents(500), cents(425)),
  2: settled(cents(125), 0n),
});
/** Villeneuve +7.25, Gerwig waiting, Nolan -4.80: the session reads +2.45 and leaves Gerwig out. */
const WITH_WAITING = pnlOf({
  0: settled(cents(500), cents(1225)),
  1: { status: "waiting", cost: cents(350) },
  2: settled(cents(480), 0n),
});
const NEVER_HELD = pnlOf({ 0: settled(0n, 0n), 1: settled(0n, 0n), 2: settled(0n, 0n) });

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

beforeEach(() => {
  wallet.address = OWNER;
  wallet.positions = {};
  chain.children = { 0: resolvedChild(VILLENEUVE.market), 1: resolvedChild(GERWIG.market) };
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  redeemMock.mockReset();
  redeemMock.mockResolvedValue({
    parts: [{ market: addresses.parentMarket, payout: cents(1775) }],
    waiting: [],
    payout: cents(1775),
    tx: { to: OWNER, data: "0x" },
  });
  pnlMock.mockReset();
  pnlMock.mockResolvedValue(GAIN);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      const children = OPTIONS.map(({ index, name, market }) =>
        sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
      );
      // opened 2025-09-03, so the resolution date has passed
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "3", deployedChildCount: "3", openingTime: "1756900800", children },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
});

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>
  );
  const { rerender } = render(page());
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await waitFor(() => expect(screen.getAllByText("Resolved").length).toBeGreaterThan(0));
  await waitFor(() => expect(readerMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
  await waitFor(() => expect(card(NOLAN.name)).toHaveTextContent("Not selected"));
  /** Refetches every read and renders the page again, as after a transaction settles. */
  const reread = async () => {
    await act(async () => {
      await client.invalidateQueries();
    });
    rerender(page());
  };
  return { reread };
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

const MINUS = "[-−]\\s*";
const negative = (amount: string) => new RegExp(`${MINUS}${amount.replace(".", "\\.")}`);
const positive = (amount: string) => new RegExp(`(^|[^-−\\d.])\\+?\\s*${amount.replace(".", "\\.")}`);
/** How a shown P&L is read out (spec D21). */
const PNL_WORD = /profit|loss/;

describe("MarketPage A3 the header shows the session's P&L total in sDAI for a visitor with a position", () => {
  it("a gain reads as a positive total in sDAI", async () => {
    await renderPage();

    await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));
    expect(header()).toHaveTextContent(positive("3.05"));
    expect(header()).not.toHaveTextContent(negative("3.05"));
    expect(header()).toHaveTextContent(/sDAI/);
  });

  it("a loss reads as a negative total in sDAI", async () => {
    pnlMock.mockResolvedValue(LOSS);

    await renderPage();

    await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));
    expect(header()).toHaveTextContent(negative("3.25"));
    expect(header()).toHaveTextContent(/sDAI/);
  });

  it("a visitor who never held anything sees no P&L", async () => {
    const { reread } = await renderPage();
    await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));

    pnlMock.mockResolvedValue(NEVER_HELD);
    await reread();

    await waitFor(() => expect(header()).not.toHaveTextContent(PNL_WORD));
    expect(header()).toHaveTextContent("Resolved");
    for (const { name } of OPTIONS) expect(card(name)).not.toHaveTextContent(/sDAI|profit|loss/);
  });

  it("a visitor with no wallet connected sees no P&L", async () => {
    wallet.address = undefined;

    await renderPage();

    expect(header()).toHaveTextContent("Resolved");
    expect(header()).not.toHaveTextContent(PNL_WORD);
    for (const { name } of OPTIONS) expect(card(name)).not.toHaveTextContent(/sDAI|profit|loss/);
  });
});

describe("MarketPage A4 each option card shows that option's P&L", () => {
  it("a winning option and a Not selected one each show their own P&L in sDAI", async () => {
    await renderPage();

    await waitFor(() => expect(card(VILLENEUVE.name)).toHaveTextContent(positive("7.25")));
    expect(card(VILLENEUVE.name)).toHaveTextContent(/sDAI/);
    expect(card(VILLENEUVE.name)).not.toHaveTextContent(negative("4.75"));

    expect(card(NOLAN.name)).toHaveTextContent(negative("4.75"));
    expect(card(NOLAN.name)).toHaveTextContent(/sDAI/);
    expect(card(NOLAN.name)).not.toHaveTextContent("7.25");

    expect(card(GERWIG.name)).toHaveTextContent(positive("0.55"));
  });

  it("an option the visitor never traded shows no P&L beside one that did", async () => {
    pnlMock.mockResolvedValue(
      pnlOf({ 0: settled(cents(500), cents(1225)), 1: settled(cents(500), cents(550)), 2: settled(0n, 0n) }),
    );

    await renderPage();

    await waitFor(() => expect(card(VILLENEUVE.name)).toHaveTextContent(positive("7.25")));
    expect(card(NOLAN.name)).not.toHaveTextContent(/sDAI|profit|loss/);
  });
});

describe("MarketPage A5 an option waiting for its result shows no resolved P&L", () => {
  it("its card shows no P&L, and the header total says it excludes waiting options", async () => {
    chain.children = { 0: resolvedChild(VILLENEUVE.market) };
    pnlMock.mockResolvedValue(WITH_WAITING);

    await renderPage();

    await waitFor(() => expect(card(GERWIG.name)).toHaveTextContent("Waiting for result"));
    await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));
    expect(header()).toHaveTextContent(positive("2.45"));
    expect(header()).toHaveTextContent(/exclud.*waiting|waiting.*exclud/i);

    expect(card(VILLENEUVE.name)).toHaveTextContent(positive("7.25"));
    // its cost may show; a signed figure would read as a resolved P&L
    expect(card(GERWIG.name)).not.toHaveTextContent(negative("3.50"));
    expect(card(GERWIG.name)).not.toHaveTextContent(PNL_WORD);
  });

  it("with no option waiting, the header total says nothing about excluding any", async () => {
    await renderPage();

    await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));
    expect(header()).not.toHaveTextContent(/exclud/i);
  });
});

describe("MarketPage A6 the P&L still shows after a redeem", () => {
  it("the header total and the cards' figures stay once the wallet holds nothing and has nothing left to redeem", async () => {
    wallet.positions = { [VILLENEUVE.market.toLowerCase()]: { up: cents(1000), down: cents(1000) } };

    const { reread } = await renderPage();

    await waitFor(() => expect(header()).toHaveTextContent(positive("3.05")));
    expect(card(VILLENEUVE.name)).toHaveTextContent(positive("7.25"));
    expect(card(NOLAN.name)).toHaveTextContent(negative("4.75"));
    expect(within(card(VILLENEUVE.name)).queryByTestId("position-held")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Redeem( |$)/ })).not.toBeNull();

    // redeemed: the tokens are gone, nothing is left to redeem, and the read takes the payouts from the indexer
    wallet.positions = {};
    redeemMock.mockResolvedValue({ parts: [], waiting: [], payout: 0n, tx: null });
    pnlMock.mockResolvedValue(pnlOf({ ...GAIN.options }));
    const readsBefore = pnlMock.mock.calls.length;
    await reread();

    await waitFor(() => expect(pnlMock.mock.calls.length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(within(card(VILLENEUVE.name)).queryByTestId("position-held")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Redeem( |$)/ })).toBeNull());
    expect(header()).toHaveTextContent(positive("3.05"));
    expect(header()).toHaveTextContent(PNL_WORD);
    expect(card(VILLENEUVE.name)).toHaveTextContent(positive("7.25"));
    expect(card(NOLAN.name)).toHaveTextContent(negative("4.75"));
  });
});
