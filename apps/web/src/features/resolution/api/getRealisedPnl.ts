import type { Address, PublicClient } from "viem";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { executorAddress } from "@/lib/trade-executor/executor";

import { gnosisRouterAddresses, tradeExecutorFactoryAddress } from "@/config/contracts";

import { fetchSessionResolution } from "./getSessionResolution";
import { fetchRedeemScope, type TradeWalletRedeemRequest } from "./getTradeWalletRedeem";
import { realisedPnl, splitDeposits, type RealisedPnl, type RedeemRow } from "../utils/realisedPnl";
import { sessionShare } from "../utils/sharedHoldings";

const REALISED_PNL = graphql(`
  query RealisedPnl(
    $sessionId: String!
    $account: String!
    $tokens: [String!]!
    $parentTokens: [String!]!
    $routers: [String!]!
  ) {
    Redeem(where: { session_id: { _eq: $sessionId }, account: { _eq: $account } }) {
      account
      childMarket_id
      parentOutcomeIndex
      payout
      transactionHash
    }
    accountRedeems: Redeem(where: { account: { _eq: $account } }) {
      account
      childMarket_id
      parentOutcomeIndex
      payout
      transactionHash
    }
    Transfer(where: { executor_id: { _eq: $account }, token: { _in: $tokens }, counterparty: { _in: $routers } }) {
      transactionHash
      token
      amount
    }
    parentMoves: Transfer(where: { executor_id: { _eq: $account }, token: { _in: $parentTokens } }) {
      transactionHash
      token
      amount
      blockNumber
      logIndex
    }
    Prediction(where: { executor_id: { _eq: $account }, childMarket: { underlyingToken: { _in: $parentTokens } } }) {
      transactionHash
      childMarket {
        session_id
      }
    }
    ParentOutcomeToken(where: { token: { _in: $parentTokens } }) {
      token
      session_id
    }
    Position(where: { executor_id: { _eq: $account }, token: { _in: $tokens } }) {
      token
      balance
    }
  }
`);

/**
 * The owner's trade wallet's realised P&L in the session. Resolution and token addresses are read on-chain; the
 * redeems, splits and balances come from one indexer query, so they describe the same indexed block.
 */
export async function fetchRealisedPnl(client: PublicClient, request: TradeWalletRedeemRequest): Promise<RealisedPnl> {
  const factory = tradeExecutorFactoryAddress(request.chainId);
  if (!factory) throw new Error(`P&L is not available on chain ${request.chainId}.`);
  const account = executorAddress(factory, request.owner).toLowerCase();
  const [scope, resolution] = await Promise.all([
    fetchRedeemScope(client, request),
    fetchSessionResolution(client, { sessionFactory: request.sessionFactory, sessionId: request.sessionId }),
  ]);
  const children = Object.entries(scope.children).map(([option, child]) => [option, child!.tokens] as const);
  const tokens = [scope.collateral, ...scope.parentTokens, ...children.flatMap(([, each]) => each)];
  const sessionId = String(request.sessionId);
  const parentTokens = scope.parentTokens.map((token) => token.toLowerCase());

  const result = await fetchGraphql(REALISED_PNL, {
    sessionId,
    account,
    tokens: tokens.map((token) => token.toLowerCase()),
    parentTokens,
    routers: gnosisRouterAddresses().map((router) => router.toLowerCase()),
  });
  const balances = new Map(result.Position.map((row) => [row.token.toLowerCase(), BigInt(row.balance)]));
  const held = (token: Address) => balances.get(token.toLowerCase()) ?? 0n;
  const redeemRow = (row: (typeof result.Redeem)[number]): RedeemRow => ({
    account: row.account,
    childMarket_id: row.childMarket_id ?? null,
    parentOutcomeIndex: BigInt(row.parentOutcomeIndex),
    payout: BigInt(row.payout),
    transactionHash: row.transactionHash,
  });
  const transfers = result.Transfer.map((row) => ({ ...row, amount: BigInt(row.amount) }));
  // a parent redeem of tokens sessions share pays one sDAI transfer that its Redeem rows split across them
  const deposits = splitDeposits(transfers, result.accountRedeems.map(redeemRow), {
    collateral: scope.collateral,
    parentTokens: scope.parentTokens,
  });

  const sessionsOf = new Map<string, string[]>();
  for (const row of result.ParentOutcomeToken) {
    const token = row.token.toLowerCase();
    sessionsOf.set(token, [...(sessionsOf.get(token) ?? []), row.session_id]);
  }
  const shared = parentTokens.some((token) => sessionsOf.get(token)?.some((each) => each !== sessionId));
  const predictedIn = new Map<string, Set<string>>();
  for (const row of result.Prediction) {
    if (!row.childMarket) continue;
    predictedIn.set(
      row.transactionHash,
      (predictedIn.get(row.transactionHash) ?? new Set()).add(row.childMarket.session_id),
    );
  }
  const { splits, parent } = shared
    ? sessionShare(
        sessionId,
        {
          sessionsOf,
          predictedIn,
          moves: result.parentMoves.map((row) => ({
            transactionHash: row.transactionHash,
            token: row.token.toLowerCase(),
            amount: BigInt(row.amount),
            blockNumber: BigInt(row.blockNumber),
            logIndex: row.logIndex,
          })),
        },
        { deposits, balances },
        parentTokens,
      )
    : { splits: deposits, parent: scope.parentTokens.map(held) };

  return realisedPnl({
    account,
    resolution,
    splits,
    holdings: {
      parent,
      children: Object.fromEntries(children.map(([option, each]) => [option, each.map(held)])),
    },
    redeems: result.Redeem.map(redeemRow),
  });
}
