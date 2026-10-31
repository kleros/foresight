/**
 * TEMPORARY curation of the homepage listing until test sessions stop landing on the
 * production indexer. Deleting this file and its import in getSessions restores the full listing.
 */
import type { Address } from "viem";

import type { SessionSummary } from "../types";
import type { SessionFilters } from "./listing";

/** Indexed sessions the homepage may list, lowercase as the indexer stores them. */
export const LISTED_PARENT_MARKETS: Address[] = [
  "0xf094a219f85fc9880362fe096bd489bccb9b5359", // DevCon Side Event - Satisfaction
  "0xd1d81ec6c50cac45c9930f31f837b62eedfaefc4", // DevCon Side Event - Attendance
];

const MOVIES_QUESTION = "If watched, what percentile score would Clément give to the movie?";

interface LegacySession extends SessionSummary {
  /** Unix seconds; the end of trading on the legacy deployment. */
  endTime: number;
}

/** Movies sessions deployed before this indexer; their cards open the legacy futarchy-ui. */
const LEGACY_SESSIONS: LegacySession[] = [
  {
    id: "legacy-movies-s3",
    parentMarket: "0xacc15cfa0f4ae4932b12ab14595941285098436a",
    name: "Movies Experiment - Session 3",
    branchCount: 20,
    heroUri: "/legacy/movies-r3-banner.webp",
    href: "https://movies-r3.foresight.kleros.io",
    endTime: 1790812740,
  },
  {
    id: "legacy-movies-s2",
    parentMarket: "0x6b182ffe23a9df5f5bfb2e9b6b4ce5716e84ab1f",
    name: "Movies Experiment - Session 2",
    branchCount: 20,
    heroUri: "/legacy/movies-r2-banner.webp",
    href: "https://movies-r2.foresight.kleros.io",
    endTime: 1783209600,
  },
  {
    id: "legacy-movies-s1",
    parentMarket: "0x6f7ae2815e7e13c14a6560f4b382ae78e7b1493e",
    name: "Movies Experiment",
    branchCount: 16,
    heroUri: "/legacy/movies-banner.webp",
    href: "https://movies.foresight.kleros.io",
    endTime: 1775239200,
  },
].map((session) => ({
  ...session,
  parentMarket: session.parentMarket as Address,
  deployer: "0x0000000000000000000000000000000000000000",
  description: MOVIES_QUESTION,
  iconUri: "/legacy/movie-icon.png",
  closesAt: null,
  branchNoun: "Movies",
  keyword: `${session.name} ${MOVIES_QUESTION}`.toLowerCase(),
}));

/** @param boundary seconds since the epoch, from `boundarySeconds`. */
export function legacySessions({ query, state }: SessionFilters, boundary: number): SessionSummary[] {
  const term = query.trim().toLowerCase();

  return LEGACY_SESSIONS.filter(
    ({ keyword, endTime }) => keyword.includes(term) && (state === "all" || (state === "open") === endTime > boundary),
  ).map(({ endTime: _endTime, ...session }) => session);
}
