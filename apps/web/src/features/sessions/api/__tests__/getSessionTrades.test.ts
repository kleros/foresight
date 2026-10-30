import { createElement, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { gnosisRouterAddress } from "@/config/contracts";

import type { ExternalTrade, PredictionTrade, SessionTrade } from "../../types";
import { FIRST_PAGE, TRADE_PAGE } from "../../utils/toSessionTrades";
import { fetchSessionTrades, sessionTradesKey, useSessionTrades } from "../getSessionTrades";
import { createFakeIndexer, type Tables } from "./support/fakeIndexer";
import {
  OPTIONS,
  type Option,
  SESSION_ID,
  baseTables,
  executorRow,
  indexerAnswers,
  predictionRow,
  swapRow,
  traderAddress,
  transferRow,
  txHash,
  wei,
} from "./support/tradeHistoryFixtures";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const { gerwig: GERWIG, villeneuve: VILLENEUVE } = OPTIONS;
/** `count` more options on Gerwig's tokens, each its own child market of the session. */
const extraOptions = (count: number) =>
  Array.from({ length: count }, (_, n): Option => ({ ...GERWIG, id: `0x${(n + 1).toString(16).padStart(40, "c")}` }));
const EXTRA = extraOptions(3);
/** Five options, so one prediction can trade more of them than another. */
const SESSION_OPTIONS = [GERWIG, VILLENEUVE, ...EXTRA];
const TRADERS = Array.from({ length: 4 }, (_, index) => traderAddress(index));
const ROUTER = gnosisRouterAddress(100)!.toLowerCase();
const OUTSIDER = "0x51d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabeef";

const prediction = fc.record({
  block: fc.integer({ min: 1, max: 40 }),
  trader: fc.integer({ min: 0, max: TRADERS.length - 1 }),
  legs: fc.subarray(SESSION_OPTIONS, { minLength: 1 }),
  cents: fc.integer({ min: -9_999, max: 9_999 }),
});
const externalSwap = fc.record({
  option: fc.constantFrom(...SESSION_OPTIONS),
  side: fc.constantFrom("UP" as const, "DOWN" as const),
  bought: fc.boolean(),
  cents: fc.integer({ min: 1, max: 9_999 }),
});
/** One external transaction: one to three swaps through the session's pools. */
const externalTx = fc.record({
  block: fc.integer({ min: 1, max: 40 }),
  swaps: fc.array(externalSwap, { minLength: 1, maxLength: 3 }),
});

const amount = (cents: number) => `${cents < 0 ? "-" : ""}${wei((Math.abs(cents) / 100).toFixed(2))}`;

/** The session's tables with `options` beyond the base two as child markets of it. */
function sessionTables(options: Option[], tables: Tables): Tables {
  const base = baseTables();
  const known = new Set(base.ChildMarket!.map((row) => row.id));
  return {
    ...base,
    ChildMarket: [
      ...base.ChildMarket!,
      ...options
        .filter((option) => !known.has(option.id))
        .map((option) => ({ ...base.ChildMarket![0]!, id: option.id })),
    ],
    ...tables,
  };
}

/** An outright UP buy that paid `cents` for one UP, or a sell of one UP that returned it. */
const upSwapColumns = (cents: number) => ({
  upDelta: amount(cents < 0 ? 100 : -100),
  upSwapTokens: amount(cents < 0 ? 100 : -100),
  upSwapUnderlying: amount(cents),
});

function serve(tables: Tables) {
  const fake = createFakeIndexer(tables);
  vi.mocked(fetchGraphql).mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);
  return fake;
}

async function readEveryPage() {
  const pages: SessionTrade[][] = [];
  let cursor = FIRST_PAGE;
  for (let read = 0; read < 100; read++) {
    const page = await fetchSessionTrades(SESSION_ID, cursor);
    pages.push(page.trades);
    if (!page.next) return pages;
    cursor = page.next;
  }
  throw new Error("The pages never ended");
}

const predictionsOf = (trades: SessionTrade[]) =>
  trades.filter((trade): trade is PredictionTrade => trade.kind === "prediction");
const externalsOf = (trades: SessionTrade[]) =>
  trades.filter((trade): trade is ExternalTrade => trade.kind === "external");

beforeEach(() => {
  vi.mocked(fetchGraphql).mockReset();
});

describe("fetchSessionTrades, read page after page", () => {
  it("returns every prediction and every external transaction once, newest first, in full pages", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(prediction, { maxLength: 60, size: "max" }),
        fc.array(externalTx, { maxLength: 30, size: "max" }),
        async (predictions, externals) => {
          serve(
            sessionTables(SESSION_OPTIONS, {
              Executor: TRADERS.map(executorRow),
              Prediction: predictions.flatMap((each, index) =>
                each.legs.map((option) =>
                  predictionRow({
                    tx: txHash(index + 1),
                    executor: TRADERS[each.trader]!,
                    option,
                    timestamp: each.block,
                    columns: upSwapColumns(each.cents),
                  }),
                ),
              ),
              Swap: externals.flatMap((each, index) =>
                each.swaps.map((swap, leg) =>
                  swapRow({
                    tx: txHash(10_000 + index),
                    logIndex: leg,
                    option: swap.option,
                    side: swap.side,
                    executor: null,
                    sender: OUTSIDER,
                    timestamp: each.block,
                    outcomeAmount: amount(swap.bought ? -100 : 100),
                    underlyingAmount: amount(swap.bought ? swap.cents : -swap.cents),
                    priceBefore: "0.3",
                    priceAfter: "0.31",
                  }),
                ),
              ),
            }),
          );

          const pages = await readEveryPage();
          const trades = pages.flat();

          expect(trades).toHaveLength(predictions.length + externals.length);
          for (const page of pages.slice(0, -1)) expect(page).toHaveLength(TRADE_PAGE);
          expect(pages.at(-1)!.length).toBeLessThanOrEqual(TRADE_PAGE);
          if (trades.length > 0) expect(pages.at(-1)!.length).toBeGreaterThan(0);
          expect(new Set(trades.map((trade) => trade.id)).size).toBe(trades.length);
          const blocks = trades.map((trade) => Number(trade.blockNumber));
          expect(blocks).toEqual([...blocks].sort((a, b) => b - a));

          predictions.forEach((each, index) => {
            const shown = predictionsOf(trades).find((trade) => trade.transactionHash === txHash(index + 1));
            expect(shown?.options.map((option) => option.childMarket).sort()).toEqual(
              each.legs.map((option) => option.id.toLowerCase()).sort(),
            );
            expect(shown?.cost).toBe(-BigInt(amount(each.cents)) * BigInt(each.legs.length));
          });

          externals.forEach((each, index) => {
            const shown = externalsOf(trades).find((trade) => trade.transactionHash === txHash(10_000 + index));
            expect(shown?.legs).toEqual(
              each.swaps.map((swap) => ({
                childMarket: swap.option.id.toLowerCase(),
                side: swap.side,
                bought: swap.bought,
                underlying: BigInt(amount(swap.cents)),
              })),
            );
          });
        },
      ),
      { numRuns: 40, seed: 20_261_030 },
    );
  }, 60_000);

  it("fills the first page with a page of two-option predictions and leaves the rest to the next", async () => {
    const count = TRADE_PAGE + 5;
    serve(
      sessionTables([], {
        Executor: TRADERS.map(executorRow),
        Prediction: Array.from({ length: count }, (_, index) =>
          [GERWIG, VILLENEUVE].map((option) =>
            predictionRow({
              tx: txHash(index + 1),
              executor: TRADERS[0]!,
              option,
              timestamp: count - index,
              columns: upSwapColumns(-100),
            }),
          ),
        ).flat(),
      }),
    );

    const pages = await readEveryPage();

    expect(pages.map((page) => page.length)).toEqual([TRADE_PAGE, count - TRADE_PAGE]);
    expect(pages.flat().map((trade) => trade.transactionHash)).toEqual(
      Array.from({ length: count }, (_, index) => txHash(index + 1)),
    );
  });

  it("starts each page where the page before it ended, three pages in", async () => {
    const count = TRADE_PAGE * 2 + 5;
    serve(
      sessionTables([], {
        Executor: [executorRow(TRADERS[0]!)],
        Prediction: Array.from({ length: count }, (_, index) =>
          predictionRow({
            tx: txHash(index + 1),
            executor: TRADERS[0]!,
            option: GERWIG,
            timestamp: count - index,
            columns: upSwapColumns(-100),
          }),
        ),
      }),
    );

    const pages = await readEveryPage();

    expect(pages.map((page) => page.length)).toEqual([TRADE_PAGE, TRADE_PAGE, 5]);
    expect(pages.flat().map((trade) => trade.transactionHash)).toEqual(
      Array.from({ length: count }, (_, index) => txHash(index + 1)),
    );
  });

  it("shows a prediction across more options than two pages of trades as one trade with every option", async () => {
    const options = [GERWIG, VILLENEUVE, ...extraOptions(TRADE_PAGE * 2 + 3)];
    serve(
      sessionTables(options, {
        Executor: [executorRow(TRADERS[0]!)],
        Prediction: options.map((option) =>
          predictionRow({
            tx: txHash(1),
            executor: TRADERS[0]!,
            option,
            timestamp: 10,
            columns: upSwapColumns(-100),
          }),
        ),
      }),
    );

    const pages = await readEveryPage();

    expect(pages).toHaveLength(1);
    const [only] = predictionsOf(pages[0]!);
    expect(pages[0]).toHaveLength(1);
    expect(only!.options).toHaveLength(options.length);
    expect(only!.cost).toBe(BigInt(wei("1")) * BigInt(options.length));
  });

  it("reads the trades 20 to a page", async () => {
    serve(
      sessionTables([], {
        Executor: [executorRow(TRADERS[0]!)],
        Prediction: Array.from({ length: 25 }, (_, index) =>
          predictionRow({
            tx: txHash(index + 1),
            executor: TRADERS[0]!,
            option: GERWIG,
            timestamp: 25 - index,
            columns: upSwapColumns(-100),
          }),
        ),
      }),
    );

    const first = await fetchSessionTrades(SESSION_ID);

    // the issue's page size, a requirement rather than whatever TRADE_PAGE holds
    expect(first.trades).toHaveLength(20);
    expect(first.next).not.toBeNull();
  });

  it("lists a prediction before an external transaction in the same block", async () => {
    serve(
      sessionTables([], {
        Executor: [executorRow(TRADERS[0]!)],
        Prediction: [
          predictionRow({
            tx: txHash(2),
            executor: TRADERS[0]!,
            option: GERWIG,
            timestamp: 5,
            columns: upSwapColumns(-100),
          }),
        ],
        Swap: [
          swapRow({
            tx: txHash(1),
            logIndex: 0,
            option: VILLENEUVE,
            side: "UP",
            executor: null,
            sender: OUTSIDER,
            timestamp: 5,
            outcomeAmount: `-${wei("1")}`,
            underlyingAmount: wei("0.3"),
            priceBefore: "0.3",
            priceAfter: "0.31",
          }),
        ],
      }),
    );

    const { trades } = await fetchSessionTrades(SESSION_ID);

    expect(trades.map((trade) => [trade.kind, trade.transactionHash])).toEqual([
      ["prediction", txHash(2)],
      ["external", txHash(1)],
    ]);
  });

  it("shows two trade wallets' predictions in one transaction once each when a page ends between them", async () => {
    const [first, second, everyoneElse] = [TRADERS[0]!, TRADERS[1]!, TRADERS[2]!];
    const shared = txHash(50);
    const oneOption = (tx: string, executor: string, block: number) =>
      predictionRow({ tx, executor, option: GERWIG, timestamp: block, columns: upSwapColumns(-100) });
    serve(
      sessionTables([], {
        Executor: TRADERS.map(executorRow),
        Prediction: [
          // a page less one of newer trades, so the shared transaction's first wallet ends the page
          ...Array.from({ length: TRADE_PAGE - 1 }, (_, index) =>
            oneOption(txHash(index + 1), everyoneElse, 100 - index),
          ),
          predictionRow({ tx: shared, executor: first, option: GERWIG, timestamp: 50, columns: upSwapColumns(-125) }),
          predictionRow({
            tx: shared,
            executor: second,
            option: VILLENEUVE,
            timestamp: 50,
            columns: upSwapColumns(-250),
          }),
          oneOption(txHash(51), everyoneElse, 10),
          oneOption(txHash(52), everyoneElse, 9),
        ],
      }),
    );

    const pages = await readEveryPage();

    expect(pages.map((page) => page.length)).toEqual([TRADE_PAGE, 3]);
    expect(pages[0]!.at(-1)).toMatchObject({ transactionHash: shared, executor: first });
    expect(pages[1]![0]).toMatchObject({ transactionHash: shared, executor: second });
    const inShared = predictionsOf(pages.flat()).filter((trade) => trade.transactionHash === shared);
    expect(
      inShared.map(({ executor, options, cost }) => [executor, options.map((each) => each.childMarket), cost]),
    ).toEqual([
      [first, [GERWIG.id.toLowerCase()], BigInt(wei("1.25"))],
      [second, [VILLENEUVE.id.toLowerCase()], BigInt(wei("2.5"))],
    ]);
  });

  it("offers no next page when the trades end on a page's last trade", async () => {
    serve(
      sessionTables([], {
        Swap: Array.from({ length: TRADE_PAGE }, (_, index) =>
          swapRow({
            tx: txHash(index + 1),
            logIndex: 0,
            option: GERWIG,
            side: "UP",
            executor: null,
            sender: OUTSIDER,
            timestamp: TRADE_PAGE - index,
            outcomeAmount: `-${wei("1")}`,
            underlyingAmount: wei("0.3"),
            priceBefore: "0.3",
            priceAfter: "0.31",
          }),
        ),
      }),
    );

    const page = await fetchSessionTrades(SESSION_ID);

    expect(page.trades).toHaveLength(TRADE_PAGE);
    expect(page.next).toBeNull();
  });

  it("shows an external transaction that swapped through two pools as one trade with both swaps", async () => {
    const swap = (logIndex: number, option: Option, side: "UP" | "DOWN") =>
      swapRow({
        tx: txHash(7),
        logIndex,
        option,
        side,
        executor: null,
        sender: OUTSIDER,
        timestamp: 5,
        outcomeAmount: `-${wei("2")}`,
        underlyingAmount: wei("0.6"),
        priceBefore: "0.3",
        priceAfter: "0.31",
      });
    serve(sessionTables([], { Swap: [swap(3, GERWIG, "UP"), swap(9, VILLENEUVE, "DOWN")] }));

    const { trades } = await fetchSessionTrades(SESSION_ID);

    expect(trades).toEqual([
      {
        kind: "external",
        id: txHash(7),
        transactionHash: txHash(7),
        blockNumber: 5n,
        timestamp: 5,
        sender: OUTSIDER,
        legs: [
          { childMarket: GERWIG.id.toLowerCase(), side: "UP", bought: true, underlying: BigInt(wei("0.6")) },
          { childMarket: VILLENEUVE.id.toLowerCase(), side: "DOWN", bought: true, underlying: BigInt(wei("0.6")) },
        ],
      },
    ]);
  });
});

describe("fetchSessionTrades, a prediction's steps", () => {
  const trader = TRADERS[0]!;
  const tx = txHash(1);
  /** One transaction on Gerwig: its rows as the indexer keeps them, the swaps and transfers given. */
  const traded = (tables: Pick<Tables, "Swap" | "Transfer">): Tables =>
    sessionTables([], {
      Executor: [executorRow(trader)],
      Prediction: [predictionRow({ tx, executor: trader, option: GERWIG, timestamp: 3 })],
      ...tables,
    });
  const transfer = (logIndex: number, token: string, amount: string, counterparty: string) =>
    transferRow({ tx, logIndex, executor: trader, token, amount, counterparty, timestamp: 3 });
  const ownSwap = (logIndex: number, outcomeAmount: string, underlyingAmount: string) =>
    swapRow({
      tx,
      logIndex,
      option: GERWIG,
      side: "UP",
      executor: trader,
      sender: trader,
      timestamp: 3,
      outcomeAmount,
      underlyingAmount,
      priceBefore: "0.3",
      priceAfter: "0.31",
    });

  async function operationsOf() {
    const { trades } = await fetchSessionTrades(SESSION_ID);
    return predictionsOf(trades)[0]!.options[0]!.operations;
  }

  it("lists each swap that paid out to the trade wallet, a buy and a sell of the same UP both", async () => {
    serve(traded({ Swap: [ownSwap(4, `-${wei("4")}`, wei("1.2")), ownSwap(9, wei("4"), `-${wei("1.1")}`)] }));

    expect(await operationsOf()).toEqual([
      { kind: "swap", logIndex: 4, side: "UP", bought: true, tokens: BigInt(wei("4")), underlying: BigInt(wei("1.2")) },
      {
        kind: "swap",
        logIndex: 9,
        side: "UP",
        bought: false,
        tokens: BigInt(wei("4")),
        underlying: BigInt(wei("1.1")),
      },
    ]);
  });

  it("reads a mint and a merge from DOWN and UP the router handed over and took back", async () => {
    serve(
      traded({
        Transfer: [
          transfer(1, GERWIG.underlyingToken, `-${wei("5")}`, ROUTER),
          transfer(2, GERWIG.downToken, wei("5"), ROUTER),
          transfer(3, GERWIG.upToken, wei("5"), ROUTER),
          transfer(7, GERWIG.downToken, `-${wei("2")}`, ROUTER),
          transfer(8, GERWIG.upToken, `-${wei("2")}`, ROUTER),
          transfer(9, GERWIG.underlyingToken, wei("2"), ROUTER),
        ],
      }),
    );

    expect(await operationsOf()).toEqual([
      { kind: "mint", logIndex: 2, sets: BigInt(wei("5")) },
      { kind: "merge", logIndex: 7, sets: BigInt(wei("2")) },
    ]);
  });

  it("reads each option's mint from its own DOWN and UP when two options minted as many sets", async () => {
    serve(
      sessionTables([], {
        Executor: [executorRow(trader)],
        Prediction: [GERWIG, VILLENEUVE].map((option) => predictionRow({ tx, executor: trader, option, timestamp: 3 })),
        Transfer: [
          transfer(1, VILLENEUVE.underlyingToken, `-${wei("5")}`, ROUTER),
          transfer(2, VILLENEUVE.downToken, wei("5"), ROUTER),
          transfer(3, VILLENEUVE.upToken, wei("5"), ROUTER),
          transfer(5, GERWIG.underlyingToken, `-${wei("5")}`, ROUTER),
          transfer(6, GERWIG.downToken, wei("5"), ROUTER),
          transfer(7, GERWIG.upToken, wei("5"), ROUTER),
        ],
      }),
    );

    const { trades } = await fetchSessionTrades(SESSION_ID);

    const operations = predictionsOf(trades)[0]!.options.map((option) => [option.childMarket, option.operations]);
    expect(Object.fromEntries(operations)).toEqual({
      [GERWIG.id.toLowerCase()]: [{ kind: "mint", logIndex: 6, sets: BigInt(wei("5")) }],
      [VILLENEUVE.id.toLowerCase()]: [{ kind: "mint", logIndex: 2, sets: BigInt(wei("5")) }],
    });
  });

  it("reads no mint from DOWN and UP sent in by any other address", async () => {
    serve(
      traded({
        Transfer: [transfer(2, GERWIG.downToken, wei("5"), OUTSIDER), transfer(3, GERWIG.upToken, wei("5"), OUTSIDER)],
      }),
    );

    expect(await operationsOf()).toEqual([]);
  });
});

describe("useSessionTrades, pages read while trades land", () => {
  const count = TRADE_PAGE + 5;
  /** `count` one-option predictions, newest first from block `count`, and one newer than all of them. */
  const prediction = (index: number, block: number) =>
    predictionRow({
      tx: txHash(index + 1),
      executor: TRADERS[0]!,
      option: GERWIG,
      timestamp: block,
      columns: upSwapColumns(-100),
    });
  const before = Array.from({ length: count }, (_, index) => prediction(index, count - index));
  const landed = prediction(count, count + 1);

  function renderTrades() {
    const fake = serve(sessionTables([], { Executor: TRADERS.map(executorRow), Prediction: before }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useSessionTrades(SESSION_ID), { wrapper });
    return { fake, client, hook };
  }

  it("shows a trade once when a newer one lands between reading one page and the next", async () => {
    const { fake, hook } = renderTrades();
    await waitFor(() => expect(hook.result.current.data).toHaveLength(TRADE_PAGE));

    fake.set("Prediction", [...before, landed]);
    await act(() => hook.result.current.fetchNextPage());

    await waitFor(() => expect(hook.result.current.hasNextPage).toBe(false));
    const ids = hook.result.current.data!.map((trade) => trade.transactionHash);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(before.map((row) => row.transactionHash).sort());
  });

  it("rereads every loaded page once marked stale, the newest trade first and none twice", async () => {
    const { fake, client, hook } = renderTrades();
    await waitFor(() => expect(hook.result.current.data).toHaveLength(TRADE_PAGE));
    await act(() => hook.result.current.fetchNextPage());
    await waitFor(() => expect(hook.result.current.data).toHaveLength(count));

    fake.set("Prediction", [...before, landed]);
    await act(() => client.invalidateQueries({ queryKey: sessionTradesKey(SESSION_ID) }));

    await waitFor(() => expect(hook.result.current.data).toHaveLength(count + 1));
    const ids = hook.result.current.data!.map((trade) => trade.transactionHash);
    expect(ids[0]).toBe(landed.transactionHash);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
