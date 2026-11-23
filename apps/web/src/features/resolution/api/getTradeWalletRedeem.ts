import { erc20Abi, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { executorAddress } from "@/lib/trade-executor/executor";

import { sDaiAddress, sessionFactoryAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { fetchSessionResolution } from "./getSessionResolution";
import {
  CHILD_SLOTS,
  planTradeWalletRedeem,
  type RedeemHolding,
  type RedeemPlan,
  type TradeWalletRedeemInput,
} from "../redeem/plan";
import type { RedeemScope } from "../redeem/tradeWalletBatchAllowed";

const MARKET_ABI = parseAbi([
  "function numOutcomes() view returns (uint256)",
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
]);

export interface TradeWalletRedeemRequest {
  chainId: number;
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

/** The session's markets and each one's `wrappedOutcome` tokens, read on-chain (oracle R4). */
export async function fetchRedeemScope(
  client: PublicClient,
  { chainId, sessionFactory, sessionId }: Omit<TradeWalletRedeemRequest, "owner">,
): Promise<RedeemScope> {
  const collateral = sDaiAddress(chainId);
  if (!collateral) throw new Error(`Redeem is not available on chain ${chainId}.`);
  const { parentMarket, childMarkets } = await client.readContract({
    address: sessionFactory,
    abi: sessionFactoryAbi,
    functionName: "getSession",
    args: [sessionId],
  });
  if (parentMarket === zeroAddress) throw new Error(`Session ${sessionId} does not exist.`);
  const options = Number(
    await client.readContract({ address: parentMarket, abi: MARKET_ABI, functionName: "numOutcomes" }),
  );

  const markets = [
    { market: parentMarket, slots: options + 1 },
    ...childMarkets.map((market) => ({ market, slots: CHILD_SLOTS })),
  ];
  const wrapped = (await client.multicall({
    contracts: markets.flatMap(({ market, slots }) =>
      Array.from({ length: slots }, (_, index) => ({
        address: market,
        abi: MARKET_ABI,
        functionName: "wrappedOutcome" as const,
        args: [BigInt(index)] as const,
      })),
    ),
    allowFailure: false,
    batchSize: 0,
  })) as (readonly [Address, Hex])[];

  let offset = 0;
  const [parentTokens, ...childTokens] = markets.map(({ slots }) => {
    const tokens = wrapped.slice(offset, offset + slots).map(([token]) => token);
    offset += slots;
    return tokens;
  });
  return {
    collateral,
    parentMarket,
    parentTokens: parentTokens!,
    children: Object.fromEntries(
      childMarkets.map((market, option) => [option, { market, tokens: childTokens[option]! }]),
    ),
  };
}

/** The session's resolution, its tokens and `holder`'s balances of them, and the scope they were read against. */
export async function readRedeemInput(
  client: PublicClient,
  request: TradeWalletRedeemRequest,
  holder: Address,
): Promise<{ input: TradeWalletRedeemInput; scope: RedeemScope }> {
  const { chainId, owner, sessionFactory, sessionId } = request;
  const [scope, resolution] = await Promise.all([
    fetchRedeemScope(client, request),
    fetchSessionResolution(client, { sessionFactory, sessionId }),
  ]);
  const tokens = [...scope.parentTokens, ...Object.values(scope.children).flatMap((child) => child!.tokens)];
  const balances = (await client.multicall({
    contracts: tokens.map((token) => ({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [holder] as const,
    })),
    allowFailure: false,
    batchSize: 0,
  })) as bigint[];
  const balanceOf = new Map(tokens.map((token, position) => [token.toLowerCase(), balances[position]!]));
  const held = (token: Address): RedeemHolding => ({ token, balance: balanceOf.get(token.toLowerCase())! });

  const input: TradeWalletRedeemInput = {
    chainId,
    owner,
    collateral: scope.collateral,
    parentMarket: scope.parentMarket,
    resolution,
    parentTokens: scope.parentTokens.map(held),
    childTokens: Object.fromEntries(
      Object.entries(scope.children).map(([option, child]) => [option, child!.tokens.map(held)]),
    ),
  };
  return { input, scope };
}

/** The plan and the scope it was read against, from one set of reads. */
export async function readTradeWalletRedeem(
  client: PublicClient,
  request: TradeWalletRedeemRequest,
): Promise<{ plan: RedeemPlan; scope: RedeemScope }> {
  const factory = tradeExecutorFactoryAddress(request.chainId);
  if (!factory) throw new Error(`Redeem is not available on chain ${request.chainId}.`);
  const { input, scope } = await readRedeemInput(client, request, executorAddress(factory, request.owner));
  return { plan: planTradeWalletRedeem(input), scope };
}

/** Reads the session's resolution, tokens and the owner's trade wallet balances on-chain, then plans the redeem. */
export async function fetchTradeWalletRedeem(
  client: PublicClient,
  request: TradeWalletRedeemRequest,
): Promise<RedeemPlan> {
  return (await readTradeWalletRedeem(client, request)).plan;
}
