import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { parseEther, type Address } from "viem";

import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { addresses, dune } from "@/testing/fixtures";

import { createFakeIndexer, type Tables } from "./fakeIndexer";

/** Indexer rows for the trade-history suites: two options, their four pools, and row builders. */

export const SESSION_ID = sessionDetailColumns.id;

/** Whole tokens as the indexer's 18-decimal `numeric` string: `wei("3.25")` is 3.25 tokens. */
export const wei = (amount: string) => parseEther(amount).toString();

export interface Option {
  id: string;
  name: string;
  upToken: string;
  downToken: string;
  underlyingToken: string;
  upPool: string;
  downPool: string;
}

const GERWIG: Option = {
  id: addresses.childMarkets[0]!,
  name: dune.director.displayName,
  upToken: addresses.upToken,
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  upPool: "0x1111111111111111111111111111111111111111",
  downPool: "0x2222222222222222222222222222222222222222",
};

const VILLENEUVE: Option = {
  id: addresses.childMarkets[1]!,
  name: "Denis Villeneuve",
  upToken: "0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
  downToken: "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
  underlyingToken: "0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3",
  upPool: "0x3333333333333333333333333333333333333333",
  downPool: "0x4444444444444444444444444444444444444444",
};

export const OPTIONS = { gerwig: GERWIG, villeneuve: VILLENEUVE } as const;

/** Both options sit on a 0 to 500 scale, the bounds every estimate below is read against. */
const LOWER = "0";
const UPPER = wei("500");

/**
 * One outcome in the decision, so an amount of underlying is the same amount of collateral under
 * the header's 1/N rule and a size reads the same whichever of the two the row shows.
 */
const OUTCOME_COUNT = "1";

/** Trading until 2100, so the page renders its trading state whatever the wall clock reads. */
export const sessionDetailAnswer = {
  Session: [
    {
      ...sessionDetailColumns,
      outcomeCount: OUTCOME_COUNT,
      openingTime: "4102444800",
      children: [
        sessionChildRow({ id: GERWIG.id as Address, lowerBound: LOWER, upperBound: UPPER }),
        sessionChildRow({
          id: VILLENEUVE.id as Address,
          parentOutcomeIndex: "0",
          displayName: VILLENEUVE.name,
          lowerBound: LOWER,
          upperBound: UPPER,
          upToken: VILLENEUVE.upToken as Address,
          downToken: VILLENEUVE.downToken as Address,
          underlyingToken: VILLENEUVE.underlyingToken as Address,
        }),
      ],
    },
  ],
};

const childMarketRow = (option: Option, parentOutcomeIndex: string) => ({
  id: option.id,
  session_id: SESSION_ID,
  parentOutcomeIndex,
  displayName: option.name,
  marketName: dune.director.marketName,
  lowerBound: LOWER,
  upperBound: UPPER,
  upToken: option.upToken,
  downToken: option.downToken,
  underlyingToken: option.underlyingToken,
  invalidToken: addresses.childInvalidToken,
});

/** sqrt(price) in X96 with the outcome as token0; a fixture's float precision is enough. */
const sqrtX96 = (price: number) => BigInt(Math.round(Math.sqrt(price) * 2 ** 96)).toString();

const poolRow = (option: Option, outcomeIndex: 0 | 1, price: string) => ({
  id: outcomeIndex === 1 ? option.upPool : option.downPool,
  childMarket_id: option.id,
  outcomeToken: outcomeIndex === 1 ? option.upToken : option.downToken,
  underlyingToken: option.underlyingToken,
  outcomeIndex,
  outcomeIsToken0: true,
  price: sqrtX96(Number(price)),
  tick: 0,
  underlyingPerOutcome: wei(price),
  liquidity: "0",
  volumeOutcome: "0",
  volumeUnderlying: "0",
  updatedAt: "1756000000",
});

const tokenRows = (option: Option) => [
  { id: option.downToken, childMarket_id: option.id, outcomeIndex: 0, decimals: 18, symbol: "DOWN" },
  { id: option.upToken, childMarket_id: option.id, outcomeIndex: 1, decimals: 18, symbol: "UP" },
  { id: option.underlyingToken, childMarket_id: null, outcomeIndex: null, decimals: 18, symbol: "UNDERLYING" },
];

/** The tables every suite starts from: the session's options, pools and tokens, and no trades. */
export function baseTables(): Tables {
  return {
    ChildMarket: [childMarketRow(GERWIG, "1"), childMarketRow(VILLENEUVE, "0")],
    Pool: [
      poolRow(GERWIG, 1, "0.3"),
      poolRow(GERWIG, 0, "0.7"),
      poolRow(VILLENEUVE, 1, "0.3"),
      poolRow(VILLENEUVE, 0, "0.7"),
    ],
    Token: [...tokenRows(GERWIG), ...tokenRows(VILLENEUVE)],
    Executor: [],
    Prediction: [],
    Swap: [],
    Transfer: [],
    Position: [],
  };
}

/**
 * A trade wallet whose address ends in a suffix unique to it, so a row can be found by the short
 * address it shows. Its owner is the same address, so the row reads the same whichever it shows.
 */
export const traderAddress = (index: number) => `0x${"7".repeat(36)}a${(index + 1).toString(16).padStart(3, "0")}`;
export const addressSuffix = (address: string) => address.slice(-4);

export const executorRow = (address: string) => ({
  id: address,
  owner: address,
  deployedAt: "1756000000",
  transactionHash: txHash(9_000),
});

export const txHash = (index: number) => `0x${index.toString(16).padStart(64, "0")}`;

/** One option's slice of a prediction, every column zero or null unless the test sets it. */
export function predictionRow(args: {
  tx: string;
  executor: string;
  option: Option;
  timestamp: number;
  columns?: Record<string, string | null>;
}) {
  return {
    id: `${args.tx}-${args.executor}-${args.option.id}`,
    executor_id: args.executor,
    childMarket_id: args.option.id,
    transactionHash: args.tx,
    blockNumber: String(args.timestamp),
    timestamp: String(args.timestamp),
    underlyingDelta: "0",
    downDelta: "0",
    upDelta: "0",
    underlyingBalance: "0",
    downBalance: "0",
    upBalance: "0",
    downSwapUnderlying: "0",
    downSwapTokens: "0",
    upSwapUnderlying: "0",
    upSwapTokens: "0",
    downAvgPrice: null,
    upAvgPrice: null,
    downPriceBefore: null,
    downPriceAfter: null,
    upPriceBefore: null,
    upPriceAfter: null,
    impliedPrediction: null,
    ...args.columns,
  };
}

/** A swap through one of the option's pools, amounts signed from the pool's side as the indexer stores them. */
export function swapRow(args: {
  tx: string;
  logIndex: number;
  option: Option;
  side: "UP" | "DOWN";
  executor: string | null;
  sender: string;
  timestamp: number;
  outcomeAmount: string;
  underlyingAmount: string;
  priceBefore: string;
  priceAfter: string;
}) {
  return {
    id: `${args.tx}-${args.logIndex}`,
    pool_id: args.side === "UP" ? args.option.upPool : args.option.downPool,
    childMarket_id: args.option.id,
    executor_id: args.executor,
    sender: args.sender,
    outcomeAmount: args.outcomeAmount,
    underlyingAmount: args.underlyingAmount,
    priceBefore: sqrtX96(Number(args.priceBefore)),
    priceAfter: sqrtX96(Number(args.priceAfter)),
    tickBefore: 0,
    tickAfter: 0,
    underlyingPerOutcomeAfter: wei(args.priceAfter),
    blockNumber: String(args.timestamp),
    timestamp: String(args.timestamp),
    logIndex: args.logIndex,
    transactionHash: args.tx,
  };
}

export function transferRow(args: {
  tx: string;
  logIndex: number;
  executor: string;
  token: string;
  amount: string;
  counterparty: string;
  timestamp: number;
}) {
  return {
    id: `${args.tx}-${args.logIndex}-${args.executor}`,
    executor_id: args.executor,
    token: args.token,
    amount: args.amount,
    counterparty: args.counterparty,
    blockNumber: String(args.timestamp),
    timestamp: String(args.timestamp),
    transactionHash: args.tx,
  };
}

const operationName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/**
 * Answers `fetchGraphql` the way the page's backend would: the session detail, a price history that
 * never arrives (the chart is canvas and has no part in these suites), and every query over the
 * indexer's trade tables from the fake indexer.
 */
export function indexerAnswers(fake: ReturnType<typeof createFakeIndexer>) {
  return async (document: DocumentNode, variables?: Record<string, unknown>) => {
    const name = operationName(document);
    if (name === "SessionDetail") return sessionDetailAnswer;
    if (name === "SessionChart") return new Promise(() => {});
    if (fake.serves(document)) return fake.answer(document, variables);
    return { Prediction: [], Pool: [] };
  };
}

/** Matches an amount however many trailing zeros the page prints: `amountPattern("4.5")` finds 4.5 and 4.50, not 14.5 or 4.55. */
export function amountPattern(amount: string): RegExp {
  const [int, frac = ""] = amount.split(".");
  const digits = frac.replace(/0+$/, "");
  const body = digits ? `${int}\\.${digits}0*` : `${int}(\\.0+)?`;
  return new RegExp(`(?<![\\d.])${body}(?!\\d|\\.\\d)`);
}
