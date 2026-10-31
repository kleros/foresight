import type { Address } from "viem";

import { fromWad } from "@/utils/amount";
import { branchColor, isLegibleBranchColor } from "@/utils/branchColor";

import type { SessionDetailQuery } from "@/lib/graphql/generated/graphql";

import type { SessionDetail, SessionOption, SessionStatus } from "../types";
import { displayBlocks } from "./displayBlocks";
import { splitMarketName } from "./marketName";
import { toSessionCore } from "./toSessionCore";

export type SessionDetailRow = SessionDetailQuery["Session"][number];

const asToken = (value: string): Address | null => (value ? (value as Address) : null);

function toSessionOption(child: SessionDetailRow["children"][number], gateway: string): SessionOption {
  const index = Number(child.parentOutcomeIndex);
  const { question, unit } = splitMarketName(child.marketName);
  return {
    market: child.id as Address,
    outcomeIndex: index,
    name: child.displayName || child.parentOutcome,
    // The document is hostile input; the wizard's own colour test guards what renders.
    color: child.color && isLegibleBranchColor(child.color) ? child.color : branchColor(index),
    question,
    unit,
    lowerBound: fromWad(child.lowerBound),
    upperBound: fromWad(child.upperBound),
    upToken: asToken(child.upToken),
    downToken: asToken(child.downToken),
    invalidToken: asToken(child.invalidToken),
    underlyingToken: asToken(child.underlyingToken),
    blocks: displayBlocks(child.blocks, gateway),
  };
}

export function toSessionDetail(row: SessionDetailRow, gateway: string): SessionDetail {
  return {
    ...toSessionCore(row, gateway),
    question: row.marketName,
    itemName: row.itemName || null,
    itemNamePlural: row.itemNamePlural || null,
    metadataResolved: row.metadataResolved,
    outcomeCount: Number(row.outcomeCount),
    deployedChildCount: Number(row.deployedChildCount),
    setupComplete: row.completedAt !== "0",
    openedAt: new Date(Number(row.openedAt) * 1000),
    collateralToken: asToken(row.collateralToken ?? ""),
    collateralDecimals: row.collateralDecimals ?? null,
    collateralSymbol: row.collateralSymbol ?? null,
    invalidToken: asToken(row.invalidToken ?? ""),
    blocks: displayBlocks(row.blocks, gateway),
    options: row.children.map((child) => toSessionOption(child, gateway)),
  };
}

/** Whether the Reality question has opened for answers; no liquidity is added from then (L7). */
export const resolutionOpened = (closesAt: Date | null, now: Date): boolean =>
  closesAt !== null && closesAt.getTime() <= now.getTime();

/**
 * @param hasLiquidity whether any of the session's pools holds in-range liquidity; undefined while unread.
 * The pools trade past the resolution date, so a session closes only once they are read with none.
 */
export function sessionStatus(
  detail: Pick<SessionDetail, "setupComplete" | "closesAt">,
  now: Date,
  hasLiquidity: boolean | undefined,
): SessionStatus {
  if (!detail.setupComplete) return "setting-up";
  if (resolutionOpened(detail.closesAt, now) && hasLiquidity === false) return "closed";
  return "trading";
}
