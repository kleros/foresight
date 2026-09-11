import type { Address } from "viem";

/** Base of every gateway-URL expectation. */
export const GATEWAY = "https://cdn.example.link/ipfs";

export const addresses = {
  deployer: "0xdddddddddddddddddddddddddddddddddddddddd" as Address,
  parentMarket: "0xffffffffffffffffffffffffffffffffffffffff" as Address,
  childMarkets: [
    "0xcccccccccccccccccccccccccccccccccccccccc" as Address,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
  ],
  upToken: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
  downToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address,
  underlyingToken: "0xabababababababababababababababababababab" as Address,
  collateralToken: "0xadadadadadadadadadadadadadadadadadadadad" as Address,
  invalidToken: "0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0" as Address,
} as const;

export const dune = {
  question: "Which director for Dune: Part Three?",
  title: "Dune: Part Three, director",
  description: "Opening weekend gross per director.",
  itemName: "Director",
  itemNamePlural: "Directors",
  directors: ["Villeneuve", "Gerwig"],
  template: "Opening weekend gross if {outcome} directs",
  unit: "$M",
  closesAtSeconds: "1756900800",
  director: {
    outcome: "Gerwig",
    displayName: "Greta Gerwig",
    color: "#009aff",
    marketName: "Opening weekend gross if Gerwig directs [$M]",
    lowerBound: "0",
    upperBound: "500000000000000000000",
  },
} as const;

export const VALID_CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";
