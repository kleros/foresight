import { formatEther } from "viem";
import type { Address } from "viem";

import { branchColor, isLegibleBranchColor } from "@/utils/branchColor";

import type { SessionDetailQuery } from "@/lib/graphql/generated/graphql";

import type { SessionDetail, SessionOption, SessionStatus } from "../types";
import { splitMarketName } from "./marketName";
import { toSessionCore } from "./toSessionCore";

export type SessionDetailRow = SessionDetailQuery["Session"][number];

const scaledBound = (bound: string) => Number(formatEther(BigInt(bound)));

const asToken = (value: string): Address | null => (value ? (value as Address) : null);

function toSessionOption(child: SessionDetailRow["children"][number]): SessionOption {
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
    lowerBound: scaledBound(child.lowerBound),
    upperBound: scaledBound(child.upperBound),
    upToken: asToken(child.upToken),
    downToken: asToken(child.downToken),
    underlyingToken: asToken(child.underlyingToken),
    blocks: child.blocks,
  };
}

export function toSessionDetail(row: SessionDetailRow, gateway: string): SessionDetail {
  return {
    ...toSessionCore(row, gateway),
    question: row.marketName,
    itemName: row.itemName ?? null,
    itemNamePlural: row.itemNamePlural ?? null,
    metadataResolved: row.metadataResolved,
    outcomeCount: Number(row.outcomeCount),
    deployedChildCount: Number(row.deployedChildCount),
    setupComplete: row.completedAt !== "0",
    openedAt: new Date(Number(row.openedAt) * 1000),
    blocks: row.blocks,
    options: row.children.map(toSessionOption),
  };
}

export function sessionStatus(detail: Pick<SessionDetail, "setupComplete" | "closesAt">, now: Date): SessionStatus {
  if (!detail.setupComplete) return "setting-up";
  if (detail.closesAt && detail.closesAt.getTime() <= now.getTime()) return "closed";
  return "trading";
}
