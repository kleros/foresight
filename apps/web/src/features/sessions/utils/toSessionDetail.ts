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
  const underlying = child.tokens.find((token) => token.outcomeIndex == null);

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
    underlyingToken: asToken(child.underlyingToken),
    underlyingDecimals: underlying?.decimals ?? null,
    underlyingSymbol: underlying?.symbol ?? null,
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
    collateralDecimals: row.collateralDecimals ?? null,
    collateralSymbol: row.collateralSymbol ?? null,
    blocks: displayBlocks(row.blocks, gateway),
    options: row.children.map((child) => toSessionOption(child, gateway)),
  };
}

export function sessionStatus(detail: Pick<SessionDetail, "setupComplete" | "closesAt">, now: Date): SessionStatus {
  if (!detail.setupComplete) return "setting-up";
  if (detail.closesAt && detail.closesAt.getTime() <= now.getTime()) return "closed";
  return "trading";
}
