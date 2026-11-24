import { createTestIndexer } from "envio";
import { type Address } from "viem";

import { BLOCK, SDAI, transfer } from "./harness";

type TestIndexer = ReturnType<typeof createTestIndexer>;

/** Seer's routers at their Gnosis addresses; the suite runs on the localhost config, so chain 31337 is fed them too. */
export const GNOSIS_ROUTER = "0xec9048b59b3467415b1a38f63416407ea0c70fb8" as const;
export const CONDITIONAL_ROUTER = "0x774284d5cdfec3a0a0ebc7283ad4d5b33013c29c" as const;

export const SESSION_ID = "7";
export const PARENT_MARKET = "0x0000000000000000000000000000000000000b00" as const;
export const PARENT_INVALID = "0x0000000000000000000000000000000000005d1f" as const;

/** A child market and its parent outcome token, the child's underlying. */
export type RedeemOption = {
  market: Address;
  parentOutcomeIndex: number;
  parentToken: Address;
  down: Address;
  up: Address;
  invalid: Address;
};

/**
 * A session of two options, each with its child market, plus the parent's INVALID token, written as the
 * SessionFactory handler writes them: `outcomeCount` leaves INVALID out, and INVALID has no Token row.
 */
export const seedSession = async (indexer: TestIndexer, options: readonly RedeemOption[]) => {
  await indexer.Session.set({
    id: SESSION_ID,
    sessionId: BigInt(SESSION_ID),
    deployer: "0x0000000000000000000000000000000000000d00",
    parentMarket: PARENT_MARKET,
    outcomeCount: BigInt(options.length),
    deployedChildCount: BigInt(options.length),
    openedAt: BigInt(BLOCK),
    completedAt: BigInt(BLOCK),
    marketName: "Best picture",
    outcomes: options.map((_, index) => `Option ${index}`),
    outcomeTokens: options.map((option) => option.parentToken),
    invalidToken: PARENT_INVALID,
    collateralToken: SDAI,
    collateralDecimals: 18,
    collateralSymbol: "sDAI",
    openingTime: undefined,
    metadataUri: "ipfs://redeem",
    metadataResolved: false,
    title: undefined,
    description: undefined,
    heroImage: undefined,
    icon: undefined,
    itemName: undefined,
    itemNamePlural: undefined,
    blocks: [],
    keyword: "",
    transactionHash: "0x",
  });

  for (const option of options) {
    await indexer.ChildMarket.set({
      id: option.market,
      session_id: SESSION_ID,
      parentOutcomeIndex: BigInt(option.parentOutcomeIndex),
      parentOutcome: `Option ${option.parentOutcomeIndex}`,
      deployedAt: BigInt(BLOCK),
      marketName: "Box office [USD millions]",
      lowerBound: 0n,
      upperBound: 100n,
      downToken: option.down,
      upToken: option.up,
      invalidToken: option.invalid,
      underlyingToken: option.parentToken,
      displayName: undefined,
      color: undefined,
      blocks: [],
      keyword: "",
      transactionHash: "0x",
    });
    await indexer.Token.set({
      id: option.down,
      childMarket_id: option.market,
      outcomeIndex: 0,
      decimals: 18,
      symbol: "DOWN",
    });
    await indexer.Token.set({
      id: option.up,
      childMarket_id: option.market,
      outcomeIndex: 1,
      decimals: 18,
      symbol: "UP",
    });
    await indexer.Token.set({
      id: option.parentToken,
      childMarket_id: undefined,
      outcomeIndex: undefined,
      decimals: 18,
      symbol: `O${option.parentOutcomeIndex}`,
    });
  }
};

/** A log of transaction `hash`. */
export const inTx = <T extends object>(hash: string, log: T) => ({ ...log, transaction: { hash } });

/**
 * The ERC-20 logs a redeem of parent outcome tokens through Seer's router leaves for the holder: each token
 * pulled from the holder by the router, then the router paying the holder its sDAI.
 */
export const parentRedeemLogs = (
  holder: Address,
  pulled: { token: Address; amount: bigint }[],
  payout: bigint,
  block = BLOCK + 10,
) => [
  ...pulled.map(({ token, amount }) => transfer(token, holder, GNOSIS_ROUTER, amount, block)),
  transfer(SDAI, GNOSIS_ROUTER, holder, payout, block),
];

/**
 * The ERC-20 logs a redeem of one child's tokens through the conditional router leaves for the holder: UP, DOWN
 * and INVALID pulled in that order (oracle R4), then the router paying the holder its sDAI.
 */
export const childRedeemLogs = (
  holder: Address,
  option: RedeemOption,
  amounts: { up?: bigint; down?: bigint; invalid?: bigint },
  payout: bigint,
  block = BLOCK + 10,
) => [
  ...(
    [
      [option.up, amounts.up],
      [option.down, amounts.down],
      [option.invalid, amounts.invalid],
    ] as const
  ).flatMap(([token, amount]) =>
    amount === undefined || amount === 0n ? [] : [transfer(token, holder, CONDITIONAL_ROUTER, amount, block)],
  ),
  transfer(SDAI, CONDITIONAL_ROUTER, holder, payout, block),
];
