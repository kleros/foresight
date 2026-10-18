import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, isAddressEqual, parseAbi, slice, type Address, type Hex } from "viem";

import { creditsManagerAbi, gnosisRouterAbi, tradeExecutorAbi } from "@/config/contracts";

import { PREDICT_ALLOW_LIST, type PredictAllowList } from "../../../oracle/allowlist";
import type { PredictCtx } from "../../types";
import { ALGEBRA_ROUTER_ABI } from "./fakes";

const WXDAI_ABI = parseAbi(["function withdraw(uint256 wad)"]);

/** The contracts a run's calls may name, as the run's context resolves them. */
export interface Resolved {
  factory: Address;
  sDaiAdapter: Address | null;
  gnosisRouter: Address;
  swaprRouter: Address;
  credits: Address | null;
  creditsManager: Address | null;
  wxdai: Address | null;
}

export const resolvedFrom = (ctx: PredictCtx, swaprRouter: Address): Resolved => ({
  factory: ctx.factory,
  sDaiAdapter: ctx.sDaiAdapter,
  gnosisRouter: ctx.router,
  swaprRouter: ctx.credits?.swaprRouter ?? swaprRouter,
  credits: ctx.credits?.token ?? null,
  creditsManager: ctx.credits?.manager ?? null,
  wxdai: ctx.credits?.wxdai ?? null,
});

const same = (a: Address | null, b: Address) => a !== null && isAddressEqual(a, b);

/**
 * Every way `tx` departs from the allow-list (P5), the owner rule (P4) and the native-value rule,
 * as readable lines; empty when it keeps to all of them. `sessionTokens` are the tokens a run's
 * approvals may name.
 */
export function departures(args: {
  tx: FlowTx;
  ctx: PredictCtx;
  resolved: Resolved;
  sessionTokens: Address[];
  list?: PredictAllowList;
}): string[] {
  const { tx, ctx, resolved, sessionTokens } = args;
  const list = args.list ?? PREDICT_ALLOW_LIST[ctx.chainId];
  if (!list) return [`no allow-list for chain ${ctx.chainId}`];
  const out: string[] = [];
  const data = tx.data ?? "0x";
  const selector = data.length >= 10 ? slice(data, 0, 4) : "0x";
  const value = tx.value ?? 0n;

  const topKind = same(resolved.factory, tx.to)
    ? "tradeExecutorFactory"
    : resolved.sDaiAdapter !== null && same(resolved.sDaiAdapter, tx.to)
      ? "sDaiAdapter"
      : same(ctx.collateral, tx.to)
        ? "collateral"
        : resolved.credits !== null && same(resolved.credits, tx.to)
          ? "credits"
          : same(ctx.executor, tx.to)
            ? "ownExecutor"
            : null;
  const top = list.topLevel.find((entry) => entry.target === topKind && entry.selector === selector);
  if (!top) return [`top-level ${tx.to} ${selector} is not allowed`];

  if (top.name === "depositXDAI(address)") {
    const [to] = decodeFunctionData({ abi: parseAbi(["function depositXDAI(address)"]), data }).args;
    if (!isAddressEqual(to, ctx.executor)) out.push(`depositXDAI names ${to}, not the executor`);
    return out;
  }
  if (value !== 0n) out.push(`${top.name} carries ${value} native`);

  if (top.name === "transfer(address,uint256)") {
    const [to] = decodeFunctionData({ abi: erc20Abi, data }).args;
    if (!isAddressEqual(to, ctx.executor)) out.push(`transfer names ${to}, not the executor`);
    return out;
  }
  if (topKind !== "ownExecutor" || top.name === "createExecutor()") return out;

  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
  const calls: { to: Address; data: Hex; value: bigint }[] =
    decoded.functionName === "batchValueExecute"
      ? decoded.args[0].map((call) => ({ to: call.to, data: call.data, value: call.value }))
      : decoded.functionName === "batchExecute"
        ? decoded.args[0].map((call) => ({ to: call.to, data: call.data, value: 0n }))
        : [];

  const spenders: Record<string, Address> = { gnosisRouter: resolved.gnosisRouter, swaprRouter: resolved.swaprRouter };
  let withdrawn: bigint | undefined;
  for (const [index, call] of calls.entries()) {
    const at = `call ${index} (${call.to})`;
    const kind = same(resolved.gnosisRouter, call.to)
      ? "gnosisRouter"
      : same(resolved.swaprRouter, call.to)
        ? "swaprRouter"
        : resolved.creditsManager !== null && same(resolved.creditsManager, call.to)
          ? "creditsManager"
          : resolved.wxdai !== null && same(resolved.wxdai, call.to)
            ? "wxdai"
            : sessionTokens.some((token) => isAddressEqual(token, call.to))
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
      const [spender, amount] = decodeFunctionData({ abi: erc20Abi, data: call.data }).args;
      const allowed = (entry.spender ?? []).some((name) => isAddressEqual(spenders[name]!, spender));
      if (!allowed) out.push(`${at}: approves ${spender}`);
      if (amount === 2n ** 256n - 1n) out.push(`${at}: approves an unbounded amount`);
    }
    if (entry.name.startsWith("exactInputSingle")) {
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: call.data }).args;
      if (!isAddressEqual(params.recipient, ctx.executor)) out.push(`${at}: swap pays ${params.recipient}`);
      if (params.limitSqrtPrice === 0n) out.push(`${at}: swap carries no price limit`);
    }
    if (entry.name.startsWith("execute(")) {
      const [to, swap, , outputToken] = decodeFunctionData({ abi: creditsManagerAbi, data: call.data }).args;
      if (!isAddressEqual(to, resolved.swaprRouter)) out.push(`${at}: credits spent through ${to}`);
      if (resolved.wxdai === null || !isAddressEqual(outputToken, resolved.wxdai)) {
        out.push(`${at}: credits buy ${outputToken}`);
      }
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: swap }).args;
      if (!isAddressEqual(params.recipient, ctx.executor)) out.push(`${at}: credits swap pays ${params.recipient}`);
    }
    if (entry.name.startsWith("withdraw(")) {
      withdrawn = decodeFunctionData({ abi: WXDAI_ABI, data: call.data }).args[0];
    }
    if (entry.name.startsWith("splitFromBase(")) {
      const [market] = decodeFunctionData({ abi: gnosisRouterAbi, data: call.data }).args as readonly [Address];
      if (!isAddressEqual(market, ctx.parentMarket)) out.push(`${at}: splits ${market}, not the session's parent`);
    }
  }
  return out;
}
