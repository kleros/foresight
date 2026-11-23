import { erc20Abi, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { executorAddress } from "@/lib/trade-executor/executor";

import { sDaiAddress, sessionFactoryAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { fetchSessionResolution } from "./getSessionResolution";
import { planTradeWalletRedeem, type RedeemHolding, type RedeemPlan } from "../redeem/plan";
import type { RedeemScope } from "../redeem/tradeWalletBatchAllowed";

const MARKET_ABI = parseAbi([
  "function numOutcomes() view returns (uint256)",
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
]);

/** A scalar child's outcome slots: DOWN, UP, INVALID. */
const CHILD_SLOTS = 3;

export interface TradeWalletRedeemRequest {
  chainId: number;
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

/** The session's markets and each one's `wrappedOutcome` tokens, read on-chain. */
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
  const options = await client.readContract({ address: parentMarket, abi: MARKET_ABI, functionName: "numOutcomes" });

  const children = childMarkets.flatMap((market, option) => (market === zeroAddress ? [] : [{ option, market }]));
  // the parent's options, then INVALID
  const parentCount = Number(options) + 1;
  const reads = [
    ...Array.from({ length: parentCount }, (_, index) => ({ market: parentMarket, index })),
    ...children.flatMap(({ market }) => Array.from({ length: CHILD_SLOTS }, (_, index) => ({ market, index }))),
  ];
  const tokens = (
    (await client.multicall({
      contracts: reads.map(({ market, index }) => ({
        address: market,
        abi: MARKET_ABI,
        functionName: "wrappedOutcome" as const,
        args: [BigInt(index)] as const,
      })),
      allowFailure: false,
      batchSize: 0,
    })) as (readonly [Address, Hex])[]
  ).map(([token]) => token);

  const scope: RedeemScope = { collateral, parentMarket, parentTokens: tokens.slice(0, parentCount), children: {} };
  children.forEach(({ option, market }, position) => {
    const start = parentCount + position * CHILD_SLOTS;
    scope.children[option] = { market, tokens: tokens.slice(start, start + CHILD_SLOTS) };
  });
  return scope;
}

/** Reads the session's resolution, tokens and the owner's trade wallet balances on-chain, then plans the redeem. */
export async function fetchTradeWalletRedeem(
  client: PublicClient,
  request: TradeWalletRedeemRequest,
): Promise<RedeemPlan> {
  const { chainId, owner, sessionFactory, sessionId } = request;
  const factory = tradeExecutorFactoryAddress(chainId);
  if (!factory) throw new Error(`Redeem is not available on chain ${chainId}.`);

  const [scope, resolution] = await Promise.all([
    fetchRedeemScope(client, request),
    fetchSessionResolution(client, { sessionFactory, sessionId }),
  ]);
  const childOptions = Object.keys(scope.children).map(Number);
  const tokens = [...scope.parentTokens, ...childOptions.flatMap((option) => scope.children[option]!.tokens)];
  const tradeWallet = executorAddress(factory, owner);
  const balances = (await client.multicall({
    contracts: tokens.map((token) => ({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [tradeWallet] as const,
    })),
    allowFailure: false,
    batchSize: 0,
  })) as bigint[];

  const holdings: RedeemHolding[] = tokens.map((token, position) => ({ token, balance: balances[position]! }));
  const parentCount = scope.parentTokens.length;
  const childTokens: Partial<Record<number, RedeemHolding[]>> = {};
  childOptions.forEach((option, position) => {
    const start = parentCount + position * CHILD_SLOTS;
    childTokens[option] = holdings.slice(start, start + CHILD_SLOTS);
  });

  return planTradeWalletRedeem({
    chainId,
    owner,
    collateral: scope.collateral,
    parentMarket: scope.parentMarket,
    resolution,
    parentTokens: holdings.slice(0, parentCount),
    childTokens,
  });
}
