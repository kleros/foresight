import type { Address, PublicClient } from "viem";

import { addresses } from "@/testing/fixtures";

import { sessionChildRow, sessionDetailColumns } from "../../../utils/__tests__/fixtures";

const row = sessionDetailColumns;
const child = sessionChildRow();
export const SDAI = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const read = ({
  address,
  functionName,
  args,
}: {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}) => {
  switch (functionName) {
    case "getSession":
      return {
        parentMarket: row.parentMarket,
        childMarkets: [child.id],
        expectedChildCount: 1n,
        completedAt: 1n,
        openedAt: 1n,
        deployer: row.deployer,
        metadataUri: "",
      };
    case "seerMarketFactory":
      return addresses.parentMarket;
    case "collateralToken":
      return SDAI;
    case "decimals":
      return 18;
    case "symbol":
      return "sDAI";
    case "lowerBound":
      return BigInt(child.lowerBound);
    case "upperBound":
      return BigInt(child.upperBound);
    case "parentWrappedOutcome":
      return [child.underlyingToken, "0x"];
    case "wrappedOutcome":
      return [
        address === row.parentMarket
          ? row.invalidToken
          : [child.downToken, child.upToken, child.invalidToken][Number(args?.[0])],
        "0x",
      ];
    default:
      throw new Error(`Unexpected read ${functionName}`);
  }
};
export const verifiedClient = {
  readContract: async (args: Parameters<typeof read>[0]) => read(args),
  multicall: async ({ contracts }: { contracts: Parameters<typeof read>[0][] }) => contracts.map(read),
} as unknown as PublicClient;
