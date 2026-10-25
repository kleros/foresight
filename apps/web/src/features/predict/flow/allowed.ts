import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, isAddressEqual, parseAbi, slice, type Address, type Hex } from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";

import { tradeExecutorAbi } from "@/config/contracts";

import type { PredictCtx, PredictOption } from "./types";
import { PREDICT_ALLOW_LIST, type PredictAllowList } from "../oracle/allowlist";

const DEPOSIT_XDAI_ABI = parseAbi(["function depositXDAI(address receiver) payable"]);
const WXDAI_ABI = parseAbi(["function withdraw(uint256 wad)"]);
const TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
const EXECUTE_ABI = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);
const SPLIT_FROM_BASE_ABI = parseAbi(["function splitFromBase(address market) payable"]);

/** A predict transaction departs from the allow-list, the owner rule or the native-value rule, so it is not sent. */
export class UnlistedTxError extends Error {
  constructor(readonly departures: readonly string[]) {
    super(`Not sent: ${departures.join("; ")}.`);
    this.name = "UnlistedTxError";
  }
}

/** The tokens a run's approvals may name: the session's collateral and every option's tokens. */
export const sessionTokensOf = (ctx: Pick<PredictCtx, "collateral">, options: readonly PredictOption[]): Address[] => [
  ctx.collateral,
  ...options.flatMap((option) => [option.underlying, option.upToken, option.downToken, option.invalidToken]),
];

const same = (a: Address, b: Address) => isAddressEqual(a, b);

/**
 * Every way `tx` departs from the chain's allow-list (P5), the owner rule (P4) and the native-value rule, as
 * readable lines; empty when it keeps to all of them. `from` is the account the wallet will send it from.
 */
export function departures(args: {
  tx: FlowTx;
  ctx: PredictCtx;
  sessionTokens: readonly Address[];
  from?: Address;
  list?: PredictAllowList;
}): string[] {
  const { tx, ctx, sessionTokens, from } = args;
  const list = args.list ?? PREDICT_ALLOW_LIST[ctx.chainId];
  if (!list) return [`no allow-list for chain ${ctx.chainId}`];
  const out: string[] = [];
  if (from !== undefined && !same(from, ctx.owner)) out.push(`sent from ${from}, not the run's owner ${ctx.owner}`);
  const data = tx.data ?? "0x";
  const selector = data.length >= 10 ? slice(data, 0, 4) : "0x";
  const value = tx.value ?? 0n;

  const topKind = same(list.tradeExecutorFactory, tx.to)
    ? "tradeExecutorFactory"
    : same(list.sDaiAdapter, tx.to)
      ? "sDaiAdapter"
      : same(ctx.collateral, tx.to)
        ? "collateral"
        : same(list.credits, tx.to)
          ? "credits"
          : same(ctx.executor, tx.to)
            ? "ownExecutor"
            : null;
  const top = list.topLevel.find((entry) => entry.target === topKind && entry.selector === selector);
  if (!top) return [...out, `top-level ${tx.to} ${selector} is not allowed`];

  if (top.name === "depositXDAI(address)") {
    const [to] = decodeFunctionData({ abi: DEPOSIT_XDAI_ABI, data }).args;
    if (!same(to, ctx.executor)) out.push(`depositXDAI names ${to}, not the executor`);
    return out;
  }
  if (value !== 0n) out.push(`${top.name} carries ${value} native`);

  if (top.name === "transfer(address,uint256)") {
    const [to] = decodeFunctionData({ abi: TRANSFER_ABI, data }).args;
    if (!same(to, ctx.executor)) out.push(`transfer names ${to}, not the executor`);
    return out;
  }
  if (topKind !== "ownExecutor") return out;

  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  const calls: { to: Address; data: Hex; value: bigint }[] =
    decoded.functionName === "batchValueExecute"
      ? decoded.args[0].map((call) => ({ to: call.to, data: call.data, value: call.value }))
      : decoded.functionName === "batchExecute"
        ? decoded.args[0].map((call) => ({ to: call.to, data: call.data, value: 0n }))
        : [];

  const spenders: Record<string, Address> = { gnosisRouter: list.gnosisRouter, swaprRouter: list.swaprRouter };
  let withdrawn: bigint | undefined;
  for (const [index, call] of calls.entries()) {
    const at = `call ${index} (${call.to})`;
    const kind = same(list.gnosisRouter, call.to)
      ? "gnosisRouter"
      : same(list.swaprRouter, call.to)
        ? "swaprRouter"
        : same(list.creditsManager, call.to)
          ? "creditsManager"
          : same(list.wxdai, call.to)
            ? "wxdai"
            : sessionTokens.some((token) => same(token, call.to))
              ? "sessionToken"
              : null;
    const innerSelector = call.data.length >= 10 ? slice(call.data, 0, 4) : "0x";
    const entry = list.inner.find((each) => each.target === kind && each.selector === innerSelector);
    if (!entry) {
      out.push(`${at}: ${innerSelector} is not allowed`);
      continue;
    }

    if (call.value !== 0n && !entry.value) out.push(`${at}: ${entry.name} carries ${call.value} native`);
    if (entry.value && call.value !== withdrawn) {
      out.push(`${at}: ${entry.name} carries ${call.value}, not the ${withdrawn} just unwrapped`);
    }

    if (entry.name === "approve(address,uint256)") {
      const [spender, amount] = decodeFunctionData({ abi: APPROVE_ABI, data: call.data }).args;
      const allowed = (entry.spender ?? []).some((name) => same(spenders[name]!, spender));
      if (!allowed) out.push(`${at}: approves ${spender}`);
      if (amount === 2n ** 256n - 1n) out.push(`${at}: approves an unbounded amount`);
    }
    if (entry.name.startsWith("exactInputSingle")) {
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: call.data }).args;
      if (!same(params.recipient, ctx.executor)) out.push(`${at}: swap pays ${params.recipient}`);
      if (params.limitSqrtPrice === 0n) out.push(`${at}: swap carries no price limit`);
    }
    if (entry.name.startsWith("execute(")) {
      const [to, swap, , outputToken] = decodeFunctionData({ abi: EXECUTE_ABI, data: call.data }).args;
      if (!same(to, list.swaprRouter)) out.push(`${at}: credits spent through ${to}`);
      if (!same(outputToken, list.wxdai)) out.push(`${at}: credits buy ${outputToken}`);
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: swap }).args;
      if (!same(params.recipient, ctx.executor)) out.push(`${at}: credits swap pays ${params.recipient}`);
    }
    if (entry.name.startsWith("withdraw(")) {
      withdrawn = decodeFunctionData({ abi: WXDAI_ABI, data: call.data }).args[0];
    }
    if (entry.name.startsWith("splitFromBase(")) {
      const [market] = decodeFunctionData({ abi: SPLIT_FROM_BASE_ABI, data: call.data }).args;
      if (!same(market, ctx.parentMarket)) out.push(`${at}: splits ${market}, not the session's parent`);
    }
  }
  return out;
}

/** Throws `UnlistedTxError` where `tx` departs from any rule `departures` checks. */
export function assertListed(args: Parameters<typeof departures>[0]): void {
  const found = departures(args);
  if (found.length > 0) throw new UnlistedTxError(found);
}
