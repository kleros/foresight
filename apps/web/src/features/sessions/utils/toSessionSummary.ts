import type { Address } from "viem";

import { tryGatewayUrl } from "@/utils/ipfs";

import type { SessionsQuery } from "@/lib/graphql/generated/graphql";

import type { SessionSummary } from "../types";

export type SessionRow = SessionsQuery["Session"][number];

export function toSessionSummary(row: SessionRow, gateway: string): SessionSummary {
  return {
    id: row.id,
    parentMarket: row.parentMarket as Address,
    deployer: row.deployer as Address,
    name: row.title || row.marketName,
    description: row.description ?? null,
    iconUri: row.icon ? tryGatewayUrl(gateway, row.icon) : null,
    heroUri: row.heroImage ? tryGatewayUrl(gateway, row.heroImage) : null,
    branchCount: Number(row.outcomeCount),
    branchNoun: row.itemNamePlural || "Branches",
    keyword: row.keyword,
    closesAt: row.openingTime ? new Date(Number(row.openingTime) * 1000) : null,
  };
}
