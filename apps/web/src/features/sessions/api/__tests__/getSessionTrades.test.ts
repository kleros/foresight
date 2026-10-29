import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import type { SessionTrade } from "../../types";
import { FIRST_PAGE, TRADE_PAGE } from "../../utils/toSessionTrades";
import { fetchSessionTrades } from "../getSessionTrades";
import { createFakeIndexer } from "./support/fakeIndexer";
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
  txHash,
  wei,
} from "./support/tradeHistoryFixtures";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const { gerwig: GERWIG, villeneuve: VILLENEUVE } = OPTIONS;
/** Five options, so one prediction can take more rows than a page reads per trade. */
const EXTRA = [1, 2, 3].map((n): Option => ({ ...GERWIG, id: `0x${"c".repeat(39)}${n}` }));
const SESSION_OPTIONS = [GERWIG, VILLENEUVE, ...EXTRA];
const TRADERS = Array.from({ length: 4 }, (_, index) => traderAddress(index));

const prediction = fc.record({
  block: fc.integer({ min: 1, max: 40 }),
  trader: fc.integer({ min: 0, max: TRADERS.length - 1 }),
  legs: fc.subarray(SESSION_OPTIONS, { minLength: 1 }),
  cents: fc.integer({ min: -9_999, max: 9_999 }),
});
const swap = fc.record({
  block: fc.integer({ min: 1, max: 40 }),
  option: fc.constantFrom(...SESSION_OPTIONS),
  side: fc.constantFrom("UP" as const, "DOWN" as const),
  bought: fc.boolean(),
  cents: fc.integer({ min: 1, max: 9_999 }),
});

const amount = (cents: number) => `${cents < 0 ? "-" : ""}${wei((Math.abs(cents) / 100).toFixed(2))}`;

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

beforeEach(() => {
  vi.mocked(fetchGraphql).mockReset();
});

describe("fetchSessionTrades, read page after page", () => {
  it("returns every prediction once and every external swap once, newest first, at most a page at a time", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(prediction, { maxLength: 60, size: "max" }),
        fc.array(swap, { maxLength: 30, size: "max" }),
        async (predictions, swaps) => {
          const base = baseTables();
          const fake = createFakeIndexer({
            ...base,
            ChildMarket: [
              ...base.ChildMarket!,
              ...EXTRA.map((option) => ({ ...base.ChildMarket![0]!, id: option.id })),
            ],
            Executor: TRADERS.map(executorRow),
            Prediction: predictions.flatMap((each, index) =>
              each.legs.map((option) =>
                predictionRow({
                  tx: txHash(index + 1),
                  executor: TRADERS[each.trader]!,
                  option,
                  timestamp: each.block,
                  columns: { underlyingDelta: amount(each.cents) },
                }),
              ),
            ),
            Swap: swaps.map((each, index) =>
              swapRow({
                tx: txHash(10_000 + index),
                logIndex: index,
                option: each.option,
                side: each.side,
                executor: null,
                sender: TRADERS[0]!,
                timestamp: each.block,
                outcomeAmount: amount(each.bought ? -100 : 100),
                underlyingAmount: amount(each.bought ? each.cents : -each.cents),
                priceBefore: "0.3",
                priceAfter: "0.31",
              }),
            ),
          });
          vi.mocked(fetchGraphql).mockImplementation(indexerAnswers(fake) as typeof fetchGraphql);

          const pages = await readEveryPage();
          const trades = pages.flat();

          for (const page of pages) expect(page.length).toBeLessThanOrEqual(TRADE_PAGE);
          if (trades.length > 0) for (const page of pages) expect(page.length).toBeGreaterThan(0);
          expect(new Set(trades.map((trade) => trade.id)).size).toBe(trades.length);
          const blocks = trades.map((trade) => Number(trade.blockNumber));
          expect(blocks).toEqual([...blocks].sort((a, b) => b - a));

          const shownPredictions = trades.filter((trade) => trade.kind === "prediction");
          expect(shownPredictions).toHaveLength(predictions.length);
          predictions.forEach((each, index) => {
            const shown = shownPredictions.find((trade) => trade.transactionHash === txHash(index + 1));
            expect(shown?.options.map((option) => option.childMarket).sort()).toEqual(
              each.legs.map((option) => option.id.toLowerCase()).sort(),
            );
            expect(shown?.underlyingDelta).toBe(BigInt(amount(each.cents)) * BigInt(each.legs.length));
          });

          const shownSwaps = trades.filter((trade) => trade.kind === "external");
          expect(shownSwaps).toHaveLength(swaps.length);
          swaps.forEach((each, index) => {
            const shown = shownSwaps.find((trade) => trade.transactionHash === txHash(10_000 + index));
            expect(shown).toMatchObject({
              side: each.side,
              bought: each.bought,
              underlying: BigInt(amount(each.cents)),
            });
          });
        },
      ),
      { numRuns: 40, seed: 20_261_030 },
    );
  }, 60_000);
});
