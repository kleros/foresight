import type { Address } from "viem";

import { tryGatewayUrl } from "@/utils/ipfs";

import type { Session } from "@/lib/graphql/generated/graphql";

import type { SessionCore } from "../types";

export type SessionCoreRow = Pick<
  Session,
  "id" | "parentMarket" | "deployer" | "marketName" | "title" | "description" | "icon" | "heroImage" | "openingTime"
>;

export function toSessionCore(row: SessionCoreRow, gateway: string): SessionCore {
  return {
    id: row.id,
    parentMarket: row.parentMarket as Address,
    deployer: row.deployer as Address,
    name: row.title || row.marketName,
    description: row.description ?? null,
    iconUri: row.icon ? tryGatewayUrl(gateway, row.icon) : null,
    heroUri: row.heroImage ? tryGatewayUrl(gateway, row.heroImage) : null,
    closesAt: row.openingTime ? new Date(Number(row.openingTime) * 1000) : null,
  };
}
