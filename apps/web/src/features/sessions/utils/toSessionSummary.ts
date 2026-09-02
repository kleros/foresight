import type { SessionsQuery } from "@/lib/graphql/generated/graphql";

import type { SessionSummary } from "../types";
import { toSessionCore } from "./toSessionCore";

export type SessionRow = SessionsQuery["Session"][number];

export function toSessionSummary(row: SessionRow, gateway: string): SessionSummary {
  return {
    ...toSessionCore(row, gateway),
    branchCount: Number(row.outcomeCount),
    branchNoun: row.itemNamePlural || "Branches",
    keyword: row.keyword,
  };
}
