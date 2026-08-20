import type { Session_Bool_Exp } from "@/lib/graphql/generated/graphql";

/** Cards per page, matching the three-column grid at two rows. */
export const PER_PAGE = 6;

export const SESSION_STATES = ["all", "open", "closed"] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const STATE_LABELS: Record<SessionState, string> = {
  all: "All",
  open: "Trading",
  closed: "Closed",
};

export interface SessionFilters {
  query: string;
  state: SessionState;
}

export const NO_FILTERS: SessionFilters = { query: "", state: "all" };

export const isFiltered = ({ query, state }: SessionFilters) => state !== "all" || query.trim() !== "";

/**
 * A state tag filters without a search term, so the empty state cannot assume
 * there is a term to quote back.
 */
export function emptyCopy({ query, state }: SessionFilters): { title: string; hint: string } {
  const term = query.trim();

  if (term) return { title: `No session matches \u201C${term}\u201D`, hint: "Try a different search." };
  if (state !== "all")
    return { title: `No ${STATE_LABELS[state].toLowerCase()} sessions`, hint: "Try another status." };

  return { title: "No sessions yet", hint: "Be the first to create one." };
}

/** A state tag is not a search, so the reset is not always "clear search". */
export const clearLabel = ({ query }: SessionFilters) => (query.trim() ? "Clear search" : "Clear filters");

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PER_PAGE));

export function keywordPattern(query: string): string {
  const term = query.trim();
  if (!term) return "%";

  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * The open/closed boundary moves with the clock rather than with an event, so
 * it is rounded to the minute: a raw timestamp would be a new query key on
 * every render.
 */
export const BOUNDARY_TICK_MS = 60_000;

export const boundarySeconds = (now: number) => Math.floor(now / BOUNDARY_TICK_MS) * (BOUNDARY_TICK_MS / 1000);

/**
 * @param boundary seconds since the epoch, from `boundarySeconds`.
 *
 * A session whose opening time could not be read is in neither state, so it is
 * only reachable under "all"
 */
export function sessionWhere({ query, state }: SessionFilters, boundary: number): Session_Bool_Exp {
  const where: Session_Bool_Exp = { keyword: { _ilike: keywordPattern(query) } };

  if (state === "open") where.openingTime = { _gt: String(boundary) };
  if (state === "closed") where.openingTime = { _lte: String(boundary) };

  return where;
}
