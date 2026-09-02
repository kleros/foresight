import type { SessionCoreRow } from "../toSessionCore";

/** The columns every session query shares; a test spreads in what its own query adds. */
export const sessionColumns = {
  id: "1",
  parentMarket: "0xffffffffffffffffffffffffffffffffffffffff",
  deployer: "0xdddddddddddddddddddddddddddddddddddddddd",
  marketName: "Which director for Dune: Part Three?",
  title: "Dune: Part Three — director",
  description: "Three directors, one weekend.",
  icon: null,
  heroImage: null,
  openingTime: "1756900800",
} satisfies SessionCoreRow;
