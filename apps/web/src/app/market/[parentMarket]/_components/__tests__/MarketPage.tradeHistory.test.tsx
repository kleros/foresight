import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexer, type Tables } from "@/features/sessions/api/__tests__/support/fakeIndexer";
import {
  OPTIONS,
  type Option,
  addressSuffix,
  amountPattern,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  swapRow,
  traderAddress,
  transferRow,
  txHash,
  wei,
} from "@/features/sessions/api/__tests__/support/tradeHistoryFixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { gnosisRouterAddress } from "@/config/contracts";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Acceptance tests for the market page's All trades history (issue
 * 2026-10-30-foresight-market-trade-history, A1 to A4), through the whole page against a fake indexer.
 *
 * What the page is held to, beyond the issue's copy:
 * - the history reads the indexer's `Prediction`, `Swap` (with the new `sender` column) and, for
 *   mints, `Transfer` rows; any Hasura query over them is answered (support/fakeIndexer.ts);
 * - the card carries an "All trades" label; a row shows its trader's or sender's short address,
 *   ending in the address's last four hex digits;
 * - "Load more" is a button with that name, and a prediction's popup has role `dialog`.
 */

vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
/* The factory cannot reference imports, so GATEWAY's value is restated. */
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
/* The wallet reaches wagmi and the RPC config, neither of which this page's tests supply. */
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({
  TradeWallet: () => null,
}));
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: undefined }),
}));

const fetchMock = vi.mocked(fetchGraphql);
const { gerwig: GERWIG, villeneuve: VILLENEUVE } = OPTIONS;
const OPTION_NAMES = new RegExp(`${GERWIG.name}|${VILLENEUVE.name}`);

/** A minute ago, so every fixture trade is in the past; trades step back a minute each. */
const NOW = Math.floor(Date.now() / 1000) - 60;

function renderPage(tables: Tables) {
  const fake = createFakeIndexer(tables);
  fetchMock.mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>,
  );
  return { client, fake };
}

const suffixPattern = (address: string) => new RegExp(addressSuffix(address), "i");

/** Every element on the page that shows this address's short form. */
const shown = (address: string) => screen.queryAllByText(suffixPattern(address));

/**
 * The row an address is shown in: the largest ancestor that holds no other listed address and not
 * the card's "All trades" label, so it does not depend on how the list is marked up.
 */
function rowOf(address: string, everyAddress: string[]): HTMLElement {
  const [element] = shown(address);
  if (!element) throw new Error(`No row shows ${address}`);
  const others = everyAddress.filter((each) => each !== address).map(suffixPattern);
  const label = screen.getAllByText("All trades")[0]!;
  let row = element;
  while (row.parentElement) {
    const parent = row.parentElement;
    if (parent.contains(label) || others.some((other) => other.test(parent.textContent ?? ""))) break;
    row = parent;
  }
  return row;
}

/** What a row says, including what it puts in a tooltip or an accessible name. */
const rowText = (row: HTMLElement) =>
  [row, ...row.querySelectorAll("*")]
    .flatMap((element) => [element.getAttribute("title"), element.getAttribute("aria-label")])
    .filter(Boolean)
    .concat(row.textContent ?? "")
    .join(" ");

/** Names both options, or one of them and "+1" for the other. */
function expectNamesBothOptions(row: HTMLElement) {
  const text = rowText(row);
  const named = [GERWIG.name, VILLENEUVE.name].filter((name) => text.includes(name));
  expect(named.length, text).toBeGreaterThan(0);
  if (named.length === 1) expect(text).toMatch(/\+\s?1(?!\d)/);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("All trades, a prediction across two options (A1)", () => {
  it("lists one transaction by one trade wallet as one row naming both options it traded", async () => {
    const trader = traderAddress(0);
    const other = traderAddress(1);
    const tx = txHash(1);
    renderPage({
      ...baseTables(),
      Executor: [executorRow(trader), executorRow(other)],
      Prediction: [
        predictionRow({
          tx,
          executor: trader,
          option: GERWIG,
          timestamp: NOW,
          columns: { underlyingDelta: `-${wei("3.25")}` },
        }),
        predictionRow({
          tx,
          executor: trader,
          option: VILLENEUVE,
          timestamp: NOW,
          columns: { underlyingDelta: `-${wei("1.5")}` },
        }),
        predictionRow({
          tx: txHash(2),
          executor: other,
          option: GERWIG,
          timestamp: NOW - 60,
          columns: { underlyingDelta: `-${wei("0.6")}` },
        }),
      ],
    });

    await screen.findByText(suffixPattern(trader));

    expect(shown(trader)).toHaveLength(1);
    expectNamesBothOptions(rowOf(trader, [trader, other]));
  });

  it("sizes that row at the sum of both options' net underlying", async () => {
    const trader = traderAddress(0);
    const other = traderAddress(1);
    const tx = txHash(1);
    renderPage({
      ...baseTables(),
      Executor: [executorRow(trader), executorRow(other)],
      Prediction: [
        // 3.25 + 1.5 spent in one transaction
        predictionRow({
          tx,
          executor: trader,
          option: GERWIG,
          timestamp: NOW,
          columns: { underlyingDelta: `-${wei("3.25")}` },
        }),
        predictionRow({
          tx,
          executor: trader,
          option: VILLENEUVE,
          timestamp: NOW,
          columns: { underlyingDelta: `-${wei("1.5")}` },
        }),
        predictionRow({
          tx: txHash(2),
          executor: other,
          option: GERWIG,
          timestamp: NOW - 60,
          columns: { underlyingDelta: `-${wei("0.6")}` },
        }),
      ],
    });

    await screen.findByText(suffixPattern(trader));

    expect(rowText(rowOf(trader, [trader, other]))).toMatch(amountPattern("4.75"));
    expect(rowText(rowOf(other, [trader, other]))).toMatch(amountPattern("0.6"));
  });

  it("gives every (transaction, trade wallet) one row sized at its options' summed net underlying", async () => {
    /** A trade: one or two options, all spent or all received, in cents so the sum is exact. */
    const trade = fc.record({
      cents: fc.array(fc.integer({ min: 1, max: 49_999 }), { minLength: 1, maxLength: 2 }),
      received: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(trade, { minLength: 1, maxLength: 4 }), async (trades) => {
        fetchMock.mockReset();
        const traders = trades.map((_, index) => traderAddress(index));
        renderPage({
          ...baseTables(),
          Executor: traders.map(executorRow),
          Prediction: trades.flatMap((each, index) =>
            each.cents.map((cents, leg) =>
              predictionRow({
                tx: txHash(index + 1),
                executor: traders[index]!,
                option: leg === 0 ? GERWIG : VILLENEUVE,
                timestamp: NOW - index * 60,
                columns: { underlyingDelta: `${each.received ? "" : "-"}${wei((cents / 100).toFixed(2))}` },
              }),
            ),
          ),
        });

        await screen.findByText(suffixPattern(traders[0]!));
        await waitFor(() => expect(shown(traders.at(-1)!)).toHaveLength(1));

        trades.forEach((each, index) => {
          const total = each.cents.reduce((sum, cents) => sum + cents, 0);
          expect(shown(traders[index]!)).toHaveLength(1);
          expect(rowText(rowOf(traders[index]!, traders))).toMatch(amountPattern((total / 100).toFixed(2)));
        });
        cleanup();
      }),
      { numRuns: 8, seed: 20_261_030 },
    );
  }, 60_000);
});

describe("All trades, an external swap beside a prediction (A2)", () => {
  const trader = traderAddress(0);
  /** Not a trade wallet: its swap went straight through the pool. */
  const outsider = "0x51d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabeef";

  const tables = (): Tables => ({
    ...baseTables(),
    Executor: [executorRow(trader)],
    Prediction: [
      predictionRow({
        tx: txHash(1),
        executor: trader,
        option: GERWIG,
        timestamp: NOW,
        columns: {
          underlyingDelta: `-${wei("2.5")}`,
          upDelta: wei("5"),
          upBalance: wei("5"),
          upSwapUnderlying: `-${wei("2.5")}`,
          upSwapTokens: wei("5"),
          upAvgPrice: wei("0.5"),
          upPriceBefore: wei("0.45"),
          upPriceAfter: wei("0.55"),
          impliedPrediction: wei("250"),
        },
      }),
    ],
    Swap: [
      // the prediction's own swap, which is part of its row and not an external one
      swapRow({
        tx: txHash(1),
        logIndex: 4,
        option: GERWIG,
        side: "UP",
        executor: trader,
        sender: trader,
        timestamp: NOW,
        outcomeAmount: `-${wei("5")}`,
        underlyingAmount: wei("2.5"),
        priceBefore: "0.45",
        priceAfter: "0.55",
      }),
      swapRow({
        tx: txHash(2),
        logIndex: 7,
        option: VILLENEUVE,
        side: "UP",
        executor: null,
        sender: outsider,
        timestamp: NOW - 60,
        outcomeAmount: `-${wei("4")}`,
        underlyingAmount: wei("1.2"),
        priceBefore: "0.3",
        priceAfter: "0.32",
      }),
    ],
  });

  it("shows the swap as one row marked external with its sender's address, and the prediction as one row", async () => {
    renderPage(tables());

    await screen.findByText(suffixPattern(outsider));

    expect(shown(outsider)).toHaveLength(1);
    expect(shown(trader)).toHaveLength(1);
    expect(rowText(rowOf(outsider, [trader, outsider]))).toMatch(/external/i);
    expect(rowText(rowOf(trader, [trader, outsider]))).not.toMatch(/external/i);
  });

  it("opens nothing when the external row is clicked", async () => {
    renderPage(tables());
    await screen.findByText(suffixPattern(outsider));
    const row = rowOf(outsider, [trader, outsider]);

    await userEvent.click(within(row).getByText(/external/i));
    await userEvent.click(within(row).getByText(suffixPattern(outsider)));
    await userEvent.click(row);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog when the prediction row is clicked", async () => {
    renderPage(tables());
    await screen.findByText(suffixPattern(trader));
    const row = rowOf(trader, [trader, outsider]);

    await userEvent.click(within(row).getAllByText(OPTION_NAMES)[0]!);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("All trades, a prediction's popup (A3)", () => {
  const trader = traderAddress(0);
  const tx = txHash(1);
  const router = (gnosisRouterAddress(100) ?? "0x5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed").toLowerCase();

  /**
   * One transaction: on Gerwig, mint 9.6 sets (9.6 underlying out, 9.6 DOWN and 9.6 UP in) and sell
   * 8 DOWN for 3.2 at 0.4, moving DOWN from 0.42 to 0.4 (estimate 290 to 300 on 0 to 500); on
   * Villeneuve, buy 6.5 UP for 1.95 at 0.3, moving UP from 0.28 to 0.3 (estimate 140 to 150).
   * Balances before: Gerwig 2.15 DOWN and 2.9 UP, Villeneuve 1.25 DOWN and 0.75 UP.
   * An hour earlier another trader left Gerwig at 290 and Villeneuve at 140, the same estimates the
   * pool prices before this trade give.
   */
  const earlier = traderAddress(1);
  const tables = (): Tables => ({
    ...baseTables(),
    Executor: [executorRow(trader), executorRow(earlier)],
    Prediction: [
      predictionRow({
        tx: txHash(2),
        executor: earlier,
        option: GERWIG,
        timestamp: NOW - 3_600,
        columns: {
          underlyingDelta: wei("0.84"),
          downDelta: `-${wei("2")}`,
          downSwapUnderlying: wei("0.84"),
          downSwapTokens: `-${wei("2")}`,
          downAvgPrice: wei("0.42"),
          impliedPrediction: wei("290"),
        },
      }),
      predictionRow({
        tx: txHash(3),
        executor: earlier,
        option: VILLENEUVE,
        timestamp: NOW - 3_600,
        columns: {
          underlyingDelta: `-${wei("0.56")}`,
          upDelta: wei("2"),
          upSwapUnderlying: `-${wei("0.56")}`,
          upSwapTokens: wei("2"),
          upAvgPrice: wei("0.28"),
          impliedPrediction: wei("140"),
        },
      }),
      predictionRow({
        tx,
        executor: trader,
        option: GERWIG,
        timestamp: NOW,
        columns: {
          underlyingDelta: `-${wei("6.4")}`,
          downDelta: wei("1.6"),
          upDelta: wei("9.6"),
          underlyingBalance: wei("20"),
          downBalance: wei("3.75"),
          upBalance: wei("12.5"),
          downSwapUnderlying: wei("3.2"),
          downSwapTokens: `-${wei("8")}`,
          downAvgPrice: wei("0.4"),
          downPriceBefore: wei("0.42"),
          downPriceAfter: wei("0.4"),
          impliedPrediction: wei("300"),
        },
      }),
      predictionRow({
        tx,
        executor: trader,
        option: VILLENEUVE,
        timestamp: NOW,
        columns: {
          underlyingDelta: `-${wei("1.95")}`,
          upDelta: wei("6.5"),
          underlyingBalance: wei("30"),
          downBalance: wei("1.25"),
          upBalance: wei("7.25"),
          upSwapUnderlying: `-${wei("1.95")}`,
          upSwapTokens: wei("6.5"),
          upAvgPrice: wei("0.3"),
          upPriceBefore: wei("0.28"),
          upPriceAfter: wei("0.3"),
          impliedPrediction: wei("150"),
        },
      }),
    ],
    Swap: [
      swapRow({
        tx,
        logIndex: 10,
        option: GERWIG,
        side: "DOWN",
        executor: trader,
        sender: trader,
        timestamp: NOW,
        outcomeAmount: wei("8"),
        underlyingAmount: `-${wei("3.2")}`,
        priceBefore: "0.42",
        priceAfter: "0.4",
      }),
      swapRow({
        tx,
        logIndex: 20,
        option: VILLENEUVE,
        side: "UP",
        executor: trader,
        sender: trader,
        timestamp: NOW,
        outcomeAmount: `-${wei("6.5")}`,
        underlyingAmount: wei("1.95"),
        priceBefore: "0.28",
        priceAfter: "0.3",
      }),
    ],
    Transfer: [
      [5, GERWIG.underlyingToken, `-${wei("9.6")}`, router],
      [6, GERWIG.downToken, wei("9.6"), router],
      [7, GERWIG.upToken, wei("9.6"), router],
      [9, GERWIG.downToken, `-${wei("8")}`, GERWIG.downPool],
      [11, GERWIG.underlyingToken, wei("3.2"), GERWIG.downPool],
      [19, VILLENEUVE.underlyingToken, `-${wei("1.95")}`, VILLENEUVE.upPool],
      [21, VILLENEUVE.upToken, wei("6.5"), VILLENEUVE.upPool],
    ].map(([logIndex, token, amount, counterparty]) =>
      transferRow({
        tx,
        logIndex: logIndex as number,
        executor: trader,
        token: token as string,
        amount: amount as string,
        counterparty: counterparty as string,
        timestamp: NOW,
      }),
    ),
  });

  async function openPopup() {
    renderPage(tables());
    await screen.findByText(suffixPattern(trader));
    await userEvent.click(within(rowOf(trader, [trader, earlier])).getAllByText(OPTION_NAMES)[0]!);
    return screen.findByRole("dialog");
  }

  /** The largest part of the popup naming this option and not the other: its block. */
  function blockOf(dialog: HTMLElement, name: string, otherName: string): string {
    const blocks = within(dialog)
      .getAllByText(new RegExp(name))
      .map((element) => {
        let block = element;
        while (block.parentElement && block.parentElement !== dialog) {
          if ((block.parentElement.textContent ?? "").includes(otherName)) break;
          block = block.parentElement;
        }
        return block.textContent ?? "";
      });
    return blocks.reduce((longest, each) => (each.length > longest.length ? each : longest), "");
  }

  it("shows each option's estimate before and after the trade, in that order", async () => {
    const dialog = await openPopup();

    const gerwig = blockOf(dialog, GERWIG.name, VILLENEUVE.name);
    const villeneuve = blockOf(dialog, VILLENEUVE.name, GERWIG.name);
    expect(gerwig.search(amountPattern("290"))).toBeGreaterThanOrEqual(0);
    expect(gerwig.search(amountPattern("300"))).toBeGreaterThan(gerwig.search(amountPattern("290")));
    expect(villeneuve.search(amountPattern("140"))).toBeGreaterThanOrEqual(0);
    expect(villeneuve.search(amountPattern("150"))).toBeGreaterThan(villeneuve.search(amountPattern("140")));
  });

  it("shows the DOWN sell on the option that sold it, with its tokens, average price and underlying", async () => {
    const dialog = await openPopup();

    const gerwig = blockOf(dialog, GERWIG.name, VILLENEUVE.name);
    expect(gerwig).toMatch(/sell|sold/i);
    expect(gerwig).toMatch(/DOWN/);
    expect(gerwig).toMatch(amountPattern("8"));
    expect(gerwig).toMatch(amountPattern("0.4"));
    expect(gerwig).toMatch(amountPattern("3.2"));
  });

  it("shows the UP buy on the option that bought it, with its tokens, average price and underlying", async () => {
    const dialog = await openPopup();

    const villeneuve = blockOf(dialog, VILLENEUVE.name, GERWIG.name);
    expect(villeneuve).toMatch(/buy|bought/i);
    expect(villeneuve).toMatch(/\bUP\b/);
    expect(villeneuve).toMatch(amountPattern("6.5"));
    expect(villeneuve).toMatch(amountPattern("0.3"));
    expect(villeneuve).toMatch(amountPattern("1.95"));
  });

  it("shows the mint on the option that minted, and none on the option that only bought", async () => {
    const dialog = await openPopup();

    const gerwig = blockOf(dialog, GERWIG.name, VILLENEUVE.name);
    const villeneuve = blockOf(dialog, VILLENEUVE.name, GERWIG.name);
    expect(gerwig).toMatch(/mint/i);
    expect(gerwig).toMatch(amountPattern("9.6"));
    expect(villeneuve).not.toMatch(/mint/i);
  });

  it("shows each option's DOWN and UP balances after the trade", async () => {
    const dialog = await openPopup();

    const gerwig = blockOf(dialog, GERWIG.name, VILLENEUVE.name);
    const villeneuve = blockOf(dialog, VILLENEUVE.name, GERWIG.name);
    expect(gerwig).toMatch(amountPattern("3.75"));
    expect(gerwig).toMatch(amountPattern("12.5"));
    expect(villeneuve).toMatch(amountPattern("1.25"));
    expect(villeneuve).toMatch(amountPattern("7.25"));
  });
});

describe("All trades, paging (A4)", () => {
  /** A page's worth of trades, the issue's fixed page size. */
  const PAGE = 20;
  /** 24 trades by 24 trade wallets, newest first; the 20th trade spans both options, so 25 Prediction rows. */
  const TRADES = 24;
  const SPLIT = PAGE - 1;
  const traders = Array.from({ length: TRADES }, (_, index) => traderAddress(index));

  const tables = (): Tables => ({
    ...baseTables(),
    Executor: traders.map(executorRow),
    Prediction: traders.flatMap((trader, index) => {
      const slice = (option: Option, amount: string) =>
        predictionRow({
          tx: txHash(index + 1),
          executor: trader,
          option,
          timestamp: NOW - index * 60,
          columns: { underlyingDelta: `-${wei(amount)}` },
        });
      return index === SPLIT ? [slice(GERWIG, "1.25"), slice(VILLENEUVE, "2.5")] : [slice(GERWIG, "1")];
    }),
  });

  /** The traders whose rows are on screen, in the order the page shows them. */
  function shownInOrder(): string[] {
    return traders
      .flatMap((trader) => shown(trader).map((element) => ({ trader, element })))
      .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(({ trader }) => trader);
  }

  it("starts with the newest page, newest first, with no trade shown twice", async () => {
    expect(tables().Prediction).toHaveLength(25);
    renderPage(tables());

    await screen.findByText(suffixPattern(traders[0]!));
    await screen.findByRole("button", { name: /load more/i });

    const first = shownInOrder();
    expect(first.length).toBeGreaterThanOrEqual(PAGE - 1);
    expect(first.length).toBeLessThanOrEqual(PAGE);
    expect(first).toEqual(traders.slice(0, first.length));
  });

  it("loads the next page after the first, newest first, without repeating the trade split across the boundary", async () => {
    renderPage(tables());
    await screen.findByText(suffixPattern(traders[0]!));

    await userEvent.click(await screen.findByRole("button", { name: /load more/i }));

    await waitFor(() => expect(shownInOrder()).toHaveLength(TRADES));
    expect(shownInOrder()).toEqual(traders);
  });

  it("shows the trade split across the boundary as one row with both options and their summed size", async () => {
    renderPage(tables());
    await screen.findByText(suffixPattern(traders[0]!));

    await userEvent.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() => expect(shown(traders.at(-1)!)).toHaveLength(1));

    const split = rowOf(traders[SPLIT]!, traders);
    expect(shown(traders[SPLIT]!)).toHaveLength(1);
    expectNamesBothOptions(split);
    expect(rowText(split)).toMatch(amountPattern("3.75"));
  });
});
