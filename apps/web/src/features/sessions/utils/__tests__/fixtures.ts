import { addresses, dune } from "@/testing/fixtures";

import type { SessionCoreRow } from "../toSessionCore";
import type { SessionDetailRow } from "../toSessionDetail";

/** The columns every session query shares; a test spreads in what its own query adds. */
export const sessionColumns = {
  id: "1",
  parentMarket: addresses.parentMarket,
  deployer: addresses.deployer,
  marketName: dune.question,
  title: dune.title,
  description: dune.description,
  icon: null,
  heroImage: null,
  openingTime: dune.closesAtSeconds,
} satisfies SessionCoreRow;

/** One deployed child with its token rows; a suite overrides what it asserts. */
export function sessionChildRow(overrides: Partial<SessionDetailRow["children"][number]> = {}) {
  return {
    id: addresses.childMarkets[0],
    parentOutcomeIndex: "1",
    parentOutcome: dune.director.outcome,
    marketName: dune.director.marketName,
    lowerBound: dune.director.lowerBound,
    upperBound: dune.director.upperBound,
    displayName: dune.director.displayName,
    color: dune.director.color,
    blocks: [],
    upToken: addresses.upToken,
    downToken: addresses.downToken,
    underlyingToken: addresses.underlyingToken,
    tokens: [
      { outcomeIndex: 0, decimals: 18, symbol: "DUNE-DOWN" },
      { outcomeIndex: 1, decimals: 18, symbol: "DUNE-UP" },
      { outcomeIndex: null, decimals: 18, symbol: "sDAI" },
    ],
    ...overrides,
  } satisfies SessionDetailRow["children"][number];
}

/** The detail-only columns on top; a suite supplies its own children. */
export const sessionDetailColumns = {
  ...sessionColumns,
  itemName: dune.itemName,
  itemNamePlural: dune.itemNamePlural,
  metadataResolved: true,
  collateralToken: addresses.collateralToken,
  collateralDecimals: 18,
  collateralSymbol: "sDAI",
  invalidToken: addresses.invalidToken,
  outcomeCount: "2",
  deployedChildCount: "2",
  openedAt: "1756000000",
  completedAt: "1756000600",
  blocks: [],
} satisfies Omit<SessionDetailRow, "children">;
