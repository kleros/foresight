import type { Address, PublicClient } from "viem";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { fetchSessionResolution } from "./getSessionResolution";
import { fetchRedeemScope } from "./getTradeWalletRedeem";
import { realisedPnl, type RealisedPnl, type SplitDeposit } from "../utils/realisedPnl";

const REALISED_PNL = graphql(`
  query RealisedPnl($sessionId: String!, $account: String!) {
    SessionMove(where: { session_id: { _eq: $sessionId }, account: { _eq: $account } }) {
      token
      amount
      cost
      transactionHash
    }
    Redeem(where: { session_id: { _eq: $sessionId } }) {
      account
      childMarket_id
      parentOutcomeIndex
      payout
      transactionHash
    }
  }
`);

export interface RealisedPnlRequest {
  chainId: number;
  /** The connected account; the P&L is its trade wallet's. */
  owner: Address;
  sessionFactory: Address;
  sessionId: bigint;
}

/**
 * The trade wallet's realised P&L in one session: its cost, balances and redeems as the indexer credits them to this
 * session, valued at the resolution read on-chain.
 */
export async function fetchRealisedPnl(client: PublicClient, request: RealisedPnlRequest): Promise<RealisedPnl> {
  const factory = tradeExecutorFactoryAddress(request.chainId);
  if (!factory) throw new Error(`Trade wallets are not available on chain ${request.chainId}.`);
  const account = executorAddress(factory, request.owner).toLowerCase();

  const [scope, resolution, indexed] = await Promise.all([
    fetchRedeemScope(client, request),
    fetchSessionResolution(client, { sessionFactory: request.sessionFactory, sessionId: request.sessionId }),
    fetchGraphql(REALISED_PNL, { sessionId: request.sessionId.toString(), account }),
  ]);

  const balances = new Map<string, bigint>();
  const splits = new Map<string, bigint>();
  for (const row of indexed.SessionMove) {
    const token = row.token.toLowerCase();
    balances.set(token, (balances.get(token) ?? 0n) + BigInt(row.amount));
    if (BigInt(row.cost) !== 0n)
      splits.set(row.transactionHash, (splits.get(row.transactionHash) ?? 0n) + BigInt(row.cost));
  }
  const balanceOf = (token: Address) => balances.get(token.toLowerCase()) ?? 0n;

  return realisedPnl({
    account,
    resolution,
    splits: [...splits].map(([transactionHash, amount]): SplitDeposit => ({ transactionHash, amount })),
    holdings: {
      parent: scope.parentTokens.map(balanceOf),
      children: Object.fromEntries(
        Object.entries(scope.children).map(([option, child]) => [option, child!.tokens.map(balanceOf)]),
      ),
    },
    redeems: indexed.Redeem.map((row) => ({
      account: row.account,
      childMarket_id: row.childMarket_id ?? null,
      parentOutcomeIndex: BigInt(row.parentOutcomeIndex),
      payout: BigInt(row.payout),
      transactionHash: row.transactionHash,
    })),
  });
}
