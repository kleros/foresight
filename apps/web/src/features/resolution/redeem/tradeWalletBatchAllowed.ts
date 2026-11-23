import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, isAddressEqual, maxUint256, parseAbi, slice, type Address, type Hex } from "viem";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { conditionalRouterAbi } from "./abi";
import { CHILD_REDEEM_ORDER } from "./plan";
import { REDEEM_ALLOW_LIST, type RedeemAllowList } from "../oracle/allowlist";

/** The session's markets and their `wrappedOutcome` tokens, read on-chain: what a redeem batch may name. */
export interface RedeemScope {
  /** sDAI. */
  collateral: Address;
  parentMarket: Address;
  /** Options then INVALID. */
  parentTokens: Address[];
  /** Keyed by parent outcome index; tokens are [DOWN, UP, INVALID]. */
  children: Partial<Record<number, { market: Address; tokens: Address[] }>>;
}

/** A redeem batch departs from the allow-list (oracle R2 to R4), so it is not sent (R8). */
export class UnlistedRedeemError extends Error {
  constructor(readonly departures: readonly string[]) {
    super(`Not sent: ${departures.join("; ")}.`);
    this.name = "UnlistedRedeemError";
  }
}

type Target = RedeemAllowList["calls"][number]["target"];

interface Approval {
  token: Address;
  spender: Address;
  amount: bigint;
  used: boolean;
}

/** One function each, so a call decodes only as the function its selector was allowed as. */
const BATCH_ABI = parseAbi(["function batchExecute((address to, bytes data)[] calls)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
const REDEEM_POSITIONS_ABI = parseAbi([
  "function redeemPositions(address collateralToken, address market, uint256[] outcomeIndexes, uint256[] amounts)",
]);

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const selectorOf = (data: Hex): Hex => (data.length >= 10 ? slice(data, 0, 4) : "0x");

/**
 * Every way `tx` departs from a trade wallet redeem as the oracle allows it, as readable lines; empty when it keeps
 * to it. `account` is the connected account that signs it.
 */
export function redeemBatchDepartures(args: {
  tx: FlowTx;
  chainId: number;
  account: Address;
  scope: RedeemScope;
}): string[] {
  const { tx, chainId, account, scope } = args;
  const list = REDEEM_ALLOW_LIST[chainId];
  const factory = tradeExecutorFactoryAddress(chainId);
  if (!list || !factory) return [`no redeem allow-list for chain ${chainId}`];
  const out: string[] = [];

  const tradeWallet = executorAddress(factory, account);
  if (!same(tx.to, tradeWallet)) out.push(`sent to ${tx.to}, not ${account}'s trade wallet ${tradeWallet}`);
  if ((tx.value ?? 0n) !== 0n) out.push(`carries ${tx.value} native`);
  const data = tx.data ?? "0x";
  const batch = list.calls.find((call) => call.target === "tradeWallet")!;
  if (selectorOf(data) !== batch.selector) return [...out, `${selectorOf(data)} is not ${batch.name}`];
  const [calls] = decodeFunctionData({ abi: BATCH_ABI, data }).args;
  if (calls.length === 0) out.push("batches no calls");
  return [...out, ...redeemCallsDepartures({ calls, chainId, scope })];
}

/**
 * Every way `calls`, run in order by one holder, depart from the approve and redeem calls the oracle allows (R2 to
 * R4); empty when they keep to them.
 */
export function redeemCallsDepartures(args: {
  calls: readonly { to: Address; data?: Hex; value?: bigint }[];
  chainId: number;
  scope: RedeemScope;
}): string[] {
  const { calls, chainId, scope } = args;
  const list = REDEEM_ALLOW_LIST[chainId];
  if (!list) return [`no redeem allow-list for chain ${chainId}`];
  const out: string[] = [];

  const approvals: Approval[] = [];
  /** Uses up the earlier approve of exactly `amount` of `token` to `router`, or says it is missing. */
  const spend = (at: string, token: Address | undefined, router: Address, amount: bigint) => {
    const approval =
      token && approvals.find((each) => !each.used && same(each.token, token) && same(each.spender, router));
    if (!approval || approval.amount !== amount)
      out.push(`${at}: no earlier approve of exactly ${amount} to ${router}`);
    else approval.used = true;
  };

  const sessionTokens = [...scope.parentTokens, ...Object.values(scope.children).flatMap((child) => child!.tokens)];
  calls.forEach(({ to, data: raw, value }, position) => {
    const at = `call ${position}`;
    const inner = raw ?? "0x";
    if ((value ?? 0n) !== 0n) out.push(`${at}: carries ${value} native`);
    const target: Target | null = same(to, list.gnosisRouter)
      ? "gnosisRouter"
      : same(to, list.conditionalRouter)
        ? "conditionalRouter"
        : sessionTokens.some((token) => same(token, to))
          ? "sessionToken"
          : null;
    const entry = list.calls.find((call) => call.target === target && call.selector === selectorOf(inner));
    if (!entry) {
      out.push(`${at}: ${to} ${selectorOf(inner)} is not allowed`);
      return;
    }

    if (entry.target === "sessionToken") {
      const [spender, amount] = decodeFunctionData({ abi: APPROVE_ABI, data: inner }).args;
      if (!(entry.spender ?? []).some((name) => same(list[name], spender))) out.push(`${at}: approves ${spender}`);
      if (amount === 0n || amount === maxUint256) out.push(`${at}: approves ${amount}`);
      approvals.push({ token: to, spender, amount, used: false });
      return;
    }

    if (entry.target === "gnosisRouter") {
      const [collateral, market, indexes, amounts] = decodeFunctionData({
        abi: REDEEM_POSITIONS_ABI,
        data: inner,
      }).args;
      if (!same(collateral, scope.collateral)) out.push(`${at}: names collateral ${collateral}`);
      if (!same(market, scope.parentMarket)) out.push(`${at}: names ${market}, not the session's parent`);
      out.push(...indexDepartures(at, indexes, amounts, scope.parentTokens.length));
      indexes.forEach((index, slot) =>
        spend(at, scope.parentTokens[Number(index)], list.gnosisRouter, amounts[slot] ?? 0n),
      );
      return;
    }

    const [collateral, market, indexes, parentIndexes, amounts] = decodeFunctionData({
      abi: conditionalRouterAbi,
      data: inner,
    }).args;
    const option = Object.keys(scope.children)
      .map(Number)
      .find((each) => same(scope.children[each]!.market, market));
    if (!same(collateral, scope.collateral)) out.push(`${at}: names collateral ${collateral}`);
    if (option === undefined) {
      out.push(`${at}: names ${market}, not a child of the session`);
      return;
    }
    if (parentIndexes.length !== 1 || parentIndexes[0] !== BigInt(option)) {
      out.push(`${at}: names parent outcomes ${parentIndexes.join(",")}, not ${option}`);
    }
    out.push(...indexDepartures(at, indexes, amounts, CHILD_REDEEM_ORDER.length));
    const ranks = indexes.map((index) => CHILD_REDEEM_ORDER.indexOf(Number(index) as 0 | 1 | 2));
    if (ranks.some((rank, slot) => slot > 0 && rank <= ranks[slot - 1]!)) {
      out.push(`${at}: orders indexes ${indexes.join(",")}, not UP, DOWN, INVALID`);
    }
    const tokens = scope.children[option]!.tokens;
    indexes.forEach((index, slot) => spend(at, tokens[Number(index)], list.conditionalRouter, amounts[slot] ?? 0n));
  });

  if (approvals.some((approval) => !approval.used)) out.push("an approve is not spent by a redeem after it");
  return out;
}

/** Each index names one of `slots` outcomes, at most once, with a non-zero amount in the same position. */
function indexDepartures(at: string, indexes: readonly bigint[], amounts: readonly bigint[], slots: number) {
  const out: string[] = [];
  if (indexes.length === 0) out.push(`${at}: redeems no index`);
  if (indexes.length !== amounts.length) out.push(`${at}: ${indexes.length} indexes but ${amounts.length} amounts`);
  if (indexes.some((index) => index >= BigInt(slots))) out.push(`${at}: names an index outside 0..${slots - 1}`);
  if (new Set(indexes).size !== indexes.length) out.push(`${at}: names an index twice`);
  if (amounts.some((amount) => amount === 0n)) out.push(`${at}: redeems a zero amount`);
  return out;
}

/** Throws `UnlistedRedeemError` where `tx` departs from any rule `redeemBatchDepartures` checks. */
export function assertRedeemBatchAllowed(args: Parameters<typeof redeemBatchDepartures>[0]): void {
  const found = redeemBatchDepartures(args);
  if (found.length > 0) throw new UnlistedRedeemError(found);
}
