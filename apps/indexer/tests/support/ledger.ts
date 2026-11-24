import { createTestIndexer } from "envio";
import { type Address } from "viem";

import { BLOCK, SDAI, transfer } from "./harness";
import { GNOSIS_ROUTER, inTx, PARENT_INVALID, PARENT_MARKET, type RedeemOption, SESSION_ID } from "./redeem";

type TestIndexer = ReturnType<typeof createTestIndexer>;

export const CTF = "0xceafdd6bc0bef976fdcd1112955828e00543c0ce" as const;
export const POOL_ADDRESS = "0x0000000000000000000000000000000000000900" as const;
export const SESSION_8 = "8";
export const PARENT_MARKET_8 = "0x0000000000000000000000000000000000000b08" as const;
export const PARENT_CONDITION = `0x${"c0".repeat(32)}`;

/** Session 8 asks session 7's parent question, so it has session 7's parent tokens; `options` are its children. */
export const seedSharingSession = async (
  indexer: TestIndexer,
  options: readonly RedeemOption[],
  { id = SESSION_8, parentMarket = PARENT_MARKET_8 as string, parentTokens = [] as string[] } = {},
) => {
  await indexer.Session.set({
    id,
    sessionId: BigInt(id),
    deployer: "0x0000000000000000000000000000000000000d00",
    parentMarket,
    outcomeCount: BigInt(parentTokens.length || options.length),
    deployedChildCount: BigInt(options.length),
    openedAt: BigInt(BLOCK),
    completedAt: BigInt(BLOCK),
    marketName: "Best picture",
    outcomes: (parentTokens.length > 0 ? parentTokens : options).map((_, index) => `Option ${index}`),
    outcomeTokens: parentTokens.length > 0 ? parentTokens : options.map((option) => option.parentToken),
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
  // the token index SessionFactory writes, which session 7's seed leaves out
  const tokens = [
    ...(parentTokens.length > 0 ? parentTokens : options.map((option) => option.parentToken)),
    PARENT_INVALID,
  ];
  for (const [index, token] of tokens.entries()) {
    await indexer.ParentOutcomeToken.set({
      id: `${id}-${token}`,
      token,
      session_id: id,
      parentOutcomeIndex: BigInt(index),
      invalid: index === tokens.length - 1,
    });
  }
  for (const option of options) {
    await indexer.ChildMarket.set({
      id: option.market,
      session_id: id,
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
    // the original child keeps a shared token's row, as SessionFactory writes it
    if ((await indexer.Token.get(option.down)) !== undefined) continue;
    await indexer.Token.set({
      id: option.down,
      childMarket_id: option.market,
      outcomeIndex: 0,
      decimals: 18,
      symbol: "D",
    });
    await indexer.Token.set({
      id: option.up,
      childMarket_id: option.market,
      outcomeIndex: 1,
      decimals: 18,
      symbol: "U",
    });
  }
};

/** Markets' conditions as SessionFactory records them, unresolved. */
export const seedConditions = async (indexer: TestIndexer, conditions: Record<string, string>) => {
  for (const [market, conditionId] of Object.entries(conditions)) {
    await indexer.MarketCondition.set({ id: market.toLowerCase(), conditionId, payoutNumerators: [] });
  }
};

export const resolved = (conditionId: string, payoutNumerators: bigint[], block = BLOCK + 5) => ({
  contract: "ConditionalTokens" as const,
  event: "ConditionResolution" as const,
  srcAddress: CTF,
  block: { number: block, timestamp: block },
  params: {
    conditionId,
    oracle: "0x0000000000000000000000000000000000000a11" as const,
    questionId: `0x${"00".repeat(32)}`,
    outcomeSlotCount: BigInt(payoutNumerators.length),
    payoutNumerators,
  },
});

/** A split of `amount` sDAI at the parent: the sDAI to Seer's router, then every parent token back. */
export const splitLogs = (holder: Address, parentTokens: readonly Address[], amount: bigint, block = BLOCK + 2) => [
  transfer(SDAI, holder, GNOSIS_ROUTER, amount, block),
  ...parentTokens.map((token) => transfer(token, GNOSIS_ROUTER, holder, amount, block)),
];

/** `amount` sets minted at a child: its parent outcome token to Seer's router, then DOWN, UP and INVALID back. */
export const childSplitLogs = (holder: Address, option: RedeemOption, amount: bigint, block = BLOCK + 2) => [
  transfer(option.parentToken, holder, GNOSIS_ROUTER, amount, block),
  ...[option.down, option.up, option.invalid].map((token) => transfer(token, GNOSIS_ROUTER, holder, amount, block)),
];

/** A merge of `amount` whole parent sets back to sDAI. */
export const mergeLogs = (holder: Address, parentTokens: readonly Address[], amount: bigint, block = BLOCK + 3) => [
  ...parentTokens.map((token) => transfer(token, holder, GNOSIS_ROUTER, amount, block)),
  transfer(SDAI, GNOSIS_ROUTER, holder, amount, block),
];

export const tx = <T extends object>(hash: string, logs: T[]) => logs.map((log) => inTx(hash, log));

export const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

type MoveRow = Awaited<ReturnType<TestIndexer["SessionMove"]["getAll"]>>[number];

/** The ledger's balance per session and token, and each session's cost. */
export const ledgerOf = (rows: MoveRow[]) => {
  const balances: Record<string, Record<string, bigint>> = {};
  const costs: Record<string, bigint> = {};
  for (const row of rows) {
    const session = (balances[row.session_id] ??= {});
    session[row.token] = (session[row.token] ?? 0n) + row.amount;
    costs[row.session_id] = (costs[row.session_id] ?? 0n) + row.cost;
  }
  return { balances, costs };
};

export { PARENT_MARKET, SESSION_ID };
