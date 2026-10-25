import { erc20Abi, isAddress, isAddressEqual, parseAbi, type Address, type PublicClient } from "viem";

import { sessionFactoryAbi, sessionFactoryAddress, sDaiDepositRoute } from "@/config/contracts";

import type { SessionDetailRow } from "../utils/toSessionDetail";

const MARKET_ABI = parseAbi([
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function parentWrappedOutcome() view returns (address wrapped1155, bytes data)",
]);
const FACTORY_ABI = parseAbi(["function collateralToken() view returns (address)"]);

const matches = (indexed: string | null | undefined, actual: Address) =>
  !!indexed && isAddress(indexed, { strict: false }) && isAddressEqual(indexed, actual);

function requireMatch(condition: boolean): asserts condition {
  if (!condition) throw new Error("This session's trading details could not be verified.");
}

/** The query caches only a session whose signing configuration agrees with its factory and markets. */
export async function verifySession(
  client: PublicClient,
  chainId: number,
  row: SessionDetailRow,
  requestedParent: Address,
): Promise<SessionDetailRow> {
  if (!matches(row.parentMarket, requestedParent)) {
    throw new Error("This session does not match the requested decision.");
  }
  const factory = sessionFactoryAddress(chainId);
  if (!factory) throw new Error("This network cannot verify the session.");
  const [session, seerFactory] = await Promise.all([
    client.readContract({
      address: factory,
      abi: sessionFactoryAbi,
      functionName: "getSession",
      args: [BigInt(row.id)],
    }),
    client.readContract({ address: factory, abi: sessionFactoryAbi, functionName: "seerMarketFactory" }),
  ]);
  requireMatch(matches(row.parentMarket, session.parentMarket));
  requireMatch(row.children.length === session.childMarkets.length);

  const [collateral, invalid, children] = await Promise.all([
    client.readContract({ address: seerFactory, abi: FACTORY_ABI, functionName: "collateralToken" }),
    client.readContract({
      address: session.parentMarket,
      abi: MARKET_ABI,
      functionName: "wrappedOutcome",
      args: [session.expectedChildCount],
    }),
    Promise.all(
      row.children.map(async (child, index) => {
        const market = session.childMarkets[index]!;
        requireMatch(matches(child.id, market) && BigInt(child.parentOutcomeIndex) === BigInt(index));
        const contract = { address: market, abi: MARKET_ABI } as const;
        const [lower, upper, down, up, invalid, underlying] = await Promise.all([
          client.readContract({ ...contract, functionName: "lowerBound" }),
          client.readContract({ ...contract, functionName: "upperBound" }),
          client.readContract({ ...contract, functionName: "wrappedOutcome", args: [0n] }),
          client.readContract({ ...contract, functionName: "wrappedOutcome", args: [1n] }),
          client.readContract({ ...contract, functionName: "wrappedOutcome", args: [2n] }),
          client.readContract({ ...contract, functionName: "parentWrappedOutcome" }),
        ]);
        requireMatch(BigInt(child.lowerBound) === lower && BigInt(child.upperBound) === upper);
        requireMatch(
          matches(child.upToken, up[0]) &&
            matches(child.downToken, down[0]) &&
            matches(child.invalidToken, invalid[0]) &&
            matches(child.underlyingToken, underlying[0]),
        );
        return {
          ...child,
          id: market,
          lowerBound: String(lower),
          upperBound: String(upper),
          upToken: up[0],
          downToken: down[0],
          invalidToken: invalid[0],
          underlyingToken: underlying[0],
        };
      }),
    ),
  ]);
  requireMatch(matches(row.collateralToken, collateral) && matches(row.invalidToken, invalid[0]));
  const [decimals, symbol] = sDaiDepositRoute(collateral, chainId)
    ? ([18, "sDAI"] as const)
    : await Promise.all([
        client.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" }),
      ]);
  return {
    ...row,
    parentMarket: session.parentMarket,
    collateralToken: collateral,
    collateralDecimals: decimals,
    collateralSymbol: symbol,
    invalidToken: invalid[0],
    children,
    completedAt: String(session.completedAt),
    openedAt: String(session.openedAt),
    outcomeCount: String(session.expectedChildCount),
    deployedChildCount: String(session.childMarkets.length),
  };
}
