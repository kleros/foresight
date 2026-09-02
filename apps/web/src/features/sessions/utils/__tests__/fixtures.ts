import { addresses, dune } from "@/testing/fixtures";

import type { SessionCoreRow } from "../toSessionCore";

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
