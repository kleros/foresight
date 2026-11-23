import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, isAddressEqual, maxUint256, slice, type Address, type Hex } from "viem";

import { executorAddress } from "@/lib/trade-executor/executor";

import { gnosisRouterAbi, tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { conditionalRouterAbi } from "./plan";
import { REDEEM_ALLOW_LIST } from "../oracle/allowlist";

/** The session's markets and tokens as read on-chain, which a redeem batch may name and nothing else. */
export interface RedeemScope {
  /** sDAI. */
  collateral: Address;
  parentMarket: Address;
  /** The parent's `wrappedOutcome(i)`, by index. */
  parentTokens: Address[];
  /** By parent outcome index: the child market and its `wrappedOutcome(0..2)`. */
  children: Partial<Record<number, { market: Address; tokens: Address[] }>>;
}

/** A redeem transaction departs from the allow-list (oracle R8), so it is not sent. */
export class UnlistedRedeemBatchError extends Error {
  constructor(readonly departures: readonly string[]) {
    super(`Not sent: ${departures.join("; ")}.`);
    this.name = "UnlistedRedeemBatchError";
  }
}

/** R4: a child's indexes may only appear in this order. */
const CHILD_ORDER = [1n, 0n, 2n];

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const selectorOf = (data: Hex): Hex => (data.length >= 10 ? slice(data, 0, 4) : "0x");
const ascending = (ranks: number[]) => ranks.every((rank, at) => rank >= 0 && (at === 0 || rank > ranks[at - 1]!));

interface Approval {
  token: Address;
  spender: Address;
  amount: bigint;
}

/**
 * Every way `tx` departs from oracle R2 to R4 when `account` sends it on `chainId`; empty when it keeps to them.
 * Reads only the calldata and `scope`, never the plan that built it.
 */
export function tradeWalletBatchDepartures(args: {
  tx: FlowTx;
  chainId: number;
  account: Address | undefined;
  scope: RedeemScope;
}): string[] {
  const { tx, chainId, account, scope } = args;
  const list = REDEEM_ALLOW_LIST[chainId];
  const factory = tradeExecutorFactoryAddress(chainId);
  if (!list || !factory) return [`no allow-list for chain ${chainId}`];
  if (!account) return ["no connected account"];

  const out: string[] = [];
  if (!same(tx.to, executorAddress(factory, account))) out.push(`${tx.to} is not the connected account's trade wallet`);
  if ((tx.value ?? 0n) !== 0n) out.push(`carries ${tx.value} native`);
  const data = tx.data ?? "0x";
  if (!list.calls.some((call) => call.target === "tradeWallet" && call.selector === selectorOf(data))) {
    return [...out, `${selectorOf(data)} on the trade wallet is not allowed`];
  }
  let calls: readonly { to: Address; data: Hex }[];
  try {
    calls = decodeFunctionData({ abi: tradeExecutorAbi, data }).args[0] as readonly { to: Address; data: Hex }[];
  } catch {
    return [...out, "the batch does not decode"];
  }
  if (calls.length === 0) out.push("batches no calls");

  const tokens = [...scope.parentTokens, ...Object.values(scope.children).flatMap((child) => child?.tokens ?? [])];
  let pending: Approval[] = [];

  /** Takes the one earlier approve of exactly `amount` of `token` to `router`, or reports its absence. */
  const pull = (where: string, token: Address | undefined, router: Address, amount: bigint | undefined) => {
    if (token === undefined) return out.push(`${where} redeems an index the market has no token for`);
    if (!amount) return out.push(`${where} redeems no amount of ${token}`);
    const match = pending.findIndex(
      (each) => same(each.token, token) && same(each.spender, router) && each.amount === amount,
    );
    if (match === -1) return out.push(`${where} pulls ${amount} of ${token} with no exact approve to ${router}`);
    pending = pending.filter((_, index) => index !== match);
  };

  for (const [position, call] of calls.entries()) {
    const where = `call ${position}`;
    const selector = selectorOf(call.data);
    const target = tokens.some((token) => same(token, call.to))
      ? "sessionToken"
      : same(call.to, list.gnosisRouter)
        ? "gnosisRouter"
        : same(call.to, list.conditionalRouter)
          ? "conditionalRouter"
          : null;
    const entry = list.calls.find((each) => each.target === target && each.selector === selector);
    if (!entry) {
      out.push(`${where}: ${selector} on ${call.to} is not allowed`);
      continue;
    }
    try {
      if (entry.target === "sessionToken") {
        const [spender, amount] = decodeFunctionData({ abi: erc20Abi, data: call.data }).args as readonly [
          Address,
          bigint,
        ];
        if (!(entry.spender ?? []).some((name) => same(list[name], spender))) out.push(`${where}: approves ${spender}`);
        if (amount === maxUint256) out.push(`${where}: approves an unbounded amount`);
        pending.push({ token: call.to, spender, amount });
        continue;
      }
      if (entry.target === "gnosisRouter") {
        const [collateral, market, indexes, amounts] = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data })
          .args as readonly [Address, Address, readonly bigint[], readonly bigint[]];
        if (!same(collateral, scope.collateral)) out.push(`${where}: names collateral ${collateral}`);
        if (!same(market, scope.parentMarket)) out.push(`${where}: names market ${market}`);
        if (indexes.length !== amounts.length) out.push(`${where}: indexes and amounts differ in length`);
        if (!ascending(indexes.map(Number))) out.push(`${where}: indexes ${indexes.join(",")} are not ascending`);
        indexes.forEach((index, at) => pull(where, scope.parentTokens[Number(index)], list.gnosisRouter, amounts[at]));
      } else if (entry.target === "conditionalRouter") {
        const [collateral, market, indexes, parentIndexes, amounts] = decodeFunctionData({
          abi: conditionalRouterAbi,
          data: call.data,
        }).args;
        if (!same(collateral, scope.collateral)) out.push(`${where}: names collateral ${collateral}`);
        const option = Object.entries(scope.children).find(([, child]) => child && same(child.market, market));
        if (!option) {
          out.push(`${where}: names market ${market}, not a child of this session`);
        } else {
          const [outcome, child] = [BigInt(option[0]), option[1]!];
          if (parentIndexes.length !== 1 || parentIndexes[0] !== outcome) {
            out.push(`${where}: names parent outcome ${parentIndexes.join(",")}, not ${outcome}`);
          }
          if (!ascending(indexes.map((index) => CHILD_ORDER.indexOf(index)))) {
            out.push(`${where}: outcome indexes ${indexes.join(",")} are not drawn from 1, 0, 2 in that order`);
          }
          if (indexes.length !== amounts.length) out.push(`${where}: indexes and amounts differ in length`);
          indexes.forEach((index, at) => pull(where, child.tokens[Number(index)], list.conditionalRouter, amounts[at]));
        }
      }
    } catch {
      out.push(`${where}: does not decode`);
    }
    if (pending.length > 0) {
      out.push(`${where}: leaves ${pending.length} approve(s) its redeem does not pull`);
      pending = [];
    }
  }
  if (pending.length > 0) out.push(`ends with ${pending.length} approve(s) no redeem pulls`);
  return out;
}

/** Throws `UnlistedRedeemBatchError` unless `tx` keeps to oracle R2 to R4 for `account` (R8). */
export function assertTradeWalletBatchAllowed(args: Parameters<typeof tradeWalletBatchDepartures>[0]): void {
  const departures = tradeWalletBatchDepartures(args);
  if (departures.length > 0) throw new UnlistedRedeemBatchError(departures);
}
