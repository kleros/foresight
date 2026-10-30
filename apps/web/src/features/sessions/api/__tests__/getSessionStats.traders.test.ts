import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { fetchSessionStats } from "../getSessionStats";
import { createFakeIndexer } from "./support/fakeIndexer";
import {
  baseTables,
  executorRow,
  OPTIONS,
  predictionRow,
  SESSION_ID,
  swapRow,
  txHash,
} from "./support/tradeHistoryFixtures";

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));

const address = (tail: string) => `0x${tail.padStart(40, "0")}`;

const OWNER_A = address("aa");
const OWNER_B = address("bb");
const OWNER_C = address("cc");
const OWNER_D = address("dd");
const OUTSIDER = address("ee");
const EXECUTOR_A = address("a1");
const EXECUTOR_C = address("c1");
const EXECUTOR_D = address("d1");
const EXECUTOR_OUTSIDE = address("f1");

const OTHER_MARKET = address("0123");
const OTHER_POOL = address("0456");

const executor = (id: string, owner: string) => ({ ...executorRow(id), owner });
const upperCased = (value: string) => `0x${value.slice(2).toUpperCase()}`;

const swap = (index: number, args: { executor: string | null; sender: string | null; market?: "other" }) => ({
  ...swapRow({
    tx: txHash(index),
    logIndex: 0,
    option: OPTIONS.gerwig,
    side: "UP",
    executor: args.executor,
    sender: "",
    timestamp: 1_756_000_000 + index,
    outcomeAmount: "-1",
    underlyingAmount: "1",
    priceBefore: "0.3",
    priceAfter: "0.31",
  }),
  sender: args.sender,
  ...(args.market === "other" ? { pool_id: OTHER_POOL, childMarket_id: OTHER_MARKET } : {}),
});

function tables() {
  const base = baseTables();
  return {
    ...base,
    ChildMarket: [...base.ChildMarket!, { ...base.ChildMarket![0]!, id: OTHER_MARKET, session_id: "other" }],
    Pool: [...base.Pool!, { ...base.Pool![0]!, id: OTHER_POOL, childMarket_id: OTHER_MARKET }],
    Executor: [
      executor(EXECUTOR_A, OWNER_A),
      executor(EXECUTOR_C, OWNER_C),
      executor(EXECUTOR_D, OWNER_D),
      executor(EXECUTOR_OUTSIDE, OUTSIDER),
    ],
    Prediction: [
      predictionRow({ tx: txHash(1), executor: EXECUTOR_A, option: OPTIONS.gerwig, timestamp: 1_756_000_001 }),
      predictionRow({ tx: txHash(2), executor: EXECUTOR_D, option: OPTIONS.villeneuve, timestamp: 1_756_000_002 }),
      predictionRow({ tx: txHash(3), executor: EXECUTOR_C, option: OPTIONS.gerwig, timestamp: 1_756_000_003 }),
      {
        ...predictionRow({ tx: txHash(4), executor: EXECUTOR_OUTSIDE, option: OPTIONS.gerwig, timestamp: 1 }),
        childMarket_id: OTHER_MARKET,
      },
    ],
    Swap: [],
  };
}

function serve(swaps: ReturnType<typeof swap>[], overrides: Partial<ReturnType<typeof tables>> = {}) {
  const fake = createFakeIndexer({ ...tables(), Swap: swaps, ...overrides });
  vi.mocked(fetchGraphql).mockImplementation(fake.answer as typeof fetchGraphql);
}

describe("the session's trader count", () => {
  beforeEach(() => {
    vi.mocked(fetchGraphql).mockReset();
  });

  it("counts each owner once across their predictions and their direct swaps, ignoring case", async () => {
    // A predicted and swapped directly as 0x..AA; B swapped directly only, as 0x..Bb and 0x..bb;
    // D predicted and its executor swap carries D as sender. The trader set is {A, B, D}.
    serve(
      [
        swap(10, { executor: null, sender: upperCased(OWNER_A) }),
        swap(11, { executor: null, sender: address("Bb") }),
        swap(12, { executor: null, sender: OWNER_B }),
        swap(13, { executor: EXECUTOR_D, sender: OWNER_D }),
      ],
      { Prediction: tables().Prediction.filter((row) => row.executor_id !== EXECUTOR_C) },
    );

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(3);
  });

  it("counts a swap indexed without a sender as its executor's owner, and one with neither as nobody", async () => {
    // C never predicted here; its swap predates Swap.sender, so only its executor names it.
    // The trader set is {A, D} from predictions plus C: 3.
    serve(
      [
        swap(20, { executor: EXECUTOR_C, sender: null }),
        swap(21, { executor: null, sender: null }),
        swap(22, { executor: EXECUTOR_A, sender: null }),
      ],
      { Prediction: tables().Prediction.filter((row) => row.executor_id !== EXECUTOR_C) },
    );

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(3);
  });

  it("credits a swap that has a sender to that sender, not to its executor's owner", async () => {
    // C's executor swapped in a transaction B sent; C never predicted here. The trader set is {A, B, D}.
    serve([swap(25, { executor: EXECUTOR_C, sender: OWNER_B })], {
      Prediction: tables().Prediction.filter((row) => row.executor_id !== EXECUTOR_C),
    });

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(3);
  });

  it("counts every predictor, direct sender and senderless executor owner without a row cap", async () => {
    // Eight distinct owners in each of the three sources: 24.
    const PER_SOURCE = 8;
    const owner = (source: number, i: number) => address(`${source}${i}0`);
    const executorOf = (source: number, i: number) => address(`${source}${i}e`);
    const executors = [1, 3].flatMap((source) =>
      Array.from({ length: PER_SOURCE }, (_, i) => executor(executorOf(source, i), owner(source, i))),
    );
    const predictions = Array.from({ length: PER_SOURCE }, (_, i) =>
      predictionRow({ tx: txHash(100 + i), executor: executorOf(1, i), option: OPTIONS.gerwig, timestamp: 1 + i }),
    );
    const swaps = Array.from({ length: PER_SOURCE }, (_, i) => [
      swap(200 + i, { executor: null, sender: owner(2, i) }),
      swap(300 + i, { executor: executorOf(3, i), sender: null }),
    ]).flat();
    serve(swaps, { Executor: executors, Prediction: predictions });

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(3 * PER_SOURCE);
  });

  it("counts the union of foresight traders and direct swappers, and nobody from another session", async () => {
    // Predictors A, C, D; direct-only B; the outsider predicted and swapped in another session only.
    // The trader set is {A, B, C, D}: 4.
    serve([
      swap(30, { executor: null, sender: OWNER_A }),
      swap(31, { executor: null, sender: upperCased(OWNER_B) }),
      swap(32, { executor: EXECUTOR_C, sender: null }),
      swap(33, { executor: null, sender: null }),
      swap(34, { executor: null, sender: OUTSIDER, market: "other" }),
      swap(35, { executor: EXECUTOR_OUTSIDE, sender: null, market: "other" }),
    ]);

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(4);
  });

  it("counts an owner with two trade wallets once", async () => {
    // A owns EXECUTOR_A and EXECUTOR_C, D owns EXECUTOR_D: {A, D}.
    serve([], {
      Executor: [executor(EXECUTOR_A, OWNER_A), executor(EXECUTOR_C, OWNER_A), executor(EXECUTOR_D, OWNER_D)],
    });

    expect((await fetchSessionStats(SESSION_ID)).traders).toBe(2);
  });
});
