import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, isAddressEqual, maxUint256, parseAbi, slice, type Address, type Hex } from "viem";

import { ALGEBRA_ROUTER_ABI } from "@/lib/swap/algebraRouter";
import { executorAddress } from "@/lib/trade-executor/executor";

import { gnosisRouterAbi, tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { POSITION_MANAGER_ABI } from "./abi";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import type { LiquiditySession } from "../types";

/** A liquidity transaction departs from the allow-list or the owner rule, so it is not sent. */
export class UnlistedTxError extends Error {
  constructor(readonly departures: readonly string[]) {
    super(`Not sent: ${departures.join("; ")}.`);
    this.name = "UnlistedTxError";
  }
}

const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
const TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount)"]);

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const selectorOf = (data: Hex): Hex => (data.length >= 10 ? slice(data, 0, 4) : "0x");

/** The session's (parent outcome, child outcome) pools, as token0/token1 keys. */
const sessionPairs = (session: LiquiditySession) =>
  new Set(
    session.branches.flatMap((branch) =>
      [branch.upToken, branch.downToken].map((child) => pairKey(child, branch.outcome)),
    ),
  );

const pairKey = (a: Address, b: Address) => {
  const [low, high] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return `${low}|${high}`.toLowerCase();
};

/**
 * Every way `tx` departs from the chain's allow-list (L5) and the owner rule (L4), as readable lines; empty when
 * it keeps to both. `from` is the account the wallet will send it from. With `tradeWallet`, the owner may also
 * create and fund that trade wallet and have it batch calls, each held to the same rules with the trade wallet as owner.
 */
export function departures(args: {
  tx: FlowTx;
  session: LiquiditySession;
  owner: Address;
  from?: Address;
  tradeWallet?: Address;
}): string[] {
  const { tx, session, owner, from, tradeWallet } = args;
  const list = LIQUIDITY_ALLOW_LIST[session.chainId];
  if (!list) return [`no allow-list for chain ${session.chainId}`];
  const out: string[] = [];
  if (from !== undefined && !same(from, owner)) out.push(`sent from ${from}, not the run's owner ${owner}`);
  const factory = tradeWallet === undefined ? null : tradeExecutorFactoryAddress(session.chainId);
  if (tradeWallet !== undefined && !(factory && same(executorAddress(factory, owner), tradeWallet))) {
    out.push(`${tradeWallet} is not the owner's trade wallet`);
  }
  const data = tx.data ?? "0x";
  const value = tx.value ?? 0n;
  const selector = selectorOf(data);

  const sessionTokens = [
    session.collateral,
    session.parentInvalid,
    ...session.branches.flatMap((b) => [b.outcome, b.upToken, b.downToken, b.invalidToken]),
  ];
  const target = same(tx.to, list.gnosisRouter)
    ? "gnosisRouter"
    : same(tx.to, list.positionManager)
      ? "positionManager"
      : same(tx.to, list.swaprRouter)
        ? "swaprRouter"
        : sessionTokens.some((token) => same(token, tx.to))
          ? "sessionToken"
          : tradeWallet !== undefined && same(tx.to, tradeWallet)
            ? "tradeWallet"
            : factory && same(tx.to, factory)
              ? "tradeWalletFactory"
              : null;
  const entry = list.calls.find((call) => call.target === target && call.selector === selector);
  if (!entry) return [...out, `${tx.to} ${selector} is not allowed`];
  if (value !== 0n && !entry.value) out.push(`${entry.name} carries ${value} native`);

  const pairs = sessionPairs(session);
  const markets = [session.parentMarket, ...session.branches.map((b) => b.childMarket)];

  switch (entry.name) {
    case "approve(address,uint256)": {
      const [spender, amount] = decodeFunctionData({ abi: APPROVE_ABI, data }).args;
      if (!(entry.spender ?? []).some((name) => same(list[name], spender))) out.push(`approves ${spender}`);
      if (amount === maxUint256) out.push("approves an unbounded amount");
      break;
    }
    case "splitPosition(address,address,uint256)":
    case "mergePositions(address,address,uint256)": {
      const decoded = decodeFunctionData({ abi: gnosisRouterAbi, data });
      if (decoded.functionName !== "splitPosition" && decoded.functionName !== "mergePositions") break;
      const [collateral, market] = decoded.args;
      if (!same(collateral, session.collateral)) out.push(`${entry.name} names collateral ${collateral}`);
      if (!markets.some((each) => same(each, market))) out.push(`${entry.name} names market ${market}`);
      break;
    }
    case "splitFromBase(address)": {
      const decoded = decodeFunctionData({ abi: gnosisRouterAbi, data });
      if (decoded.functionName === "splitFromBase" && !same(decoded.args[0], session.parentMarket)) {
        out.push(`splitFromBase names ${decoded.args[0]}, not the session's parent`);
      }
      break;
    }
    case "exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))": {
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data }).args;
      if (!same(params.recipient, owner)) out.push(`swap pays ${params.recipient}`);
      if (params.limitSqrtPrice === 0n) out.push("swap carries no price limit");
      if (!pairs.has(pairKey(params.tokenIn, params.tokenOut))) out.push("swap crosses a pair not of this session");
      break;
    }
    case "multicall(bytes[])":
      out.push(...multicallDepartures(data, list.multicallInner, pairs, owner));
      break;
    case "transfer(address,uint256)": {
      const [to, amount] = decodeFunctionData({ abi: TRANSFER_ABI, data }).args;
      if (!same(tx.to, session.collateral)) out.push(`transfers ${tx.to}, not the session's collateral`);
      if (tradeWallet === undefined || !same(to, tradeWallet)) out.push(`transfer pays ${to}`);
      if (amount === maxUint256) out.push("transfers an unbounded amount");
      break;
    }
    case "batchExecute((address,bytes)[])":
    case "batchValueExecute((address,uint256,bytes)[])": {
      const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data });
      if (decoded.functionName !== "batchExecute" && decoded.functionName !== "batchValueExecute") break;
      const calls: readonly FlowTx[] = decoded.args[0];
      if (calls.length === 0) out.push("batches no calls");
      const paid = calls.reduce((sum, call) => sum + (call.value ?? 0n), 0n);
      if (paid !== value) out.push(`batch carries ${value} native but its calls spend ${paid}`);
      for (const [index, call] of calls.entries()) {
        const inner = departures({ tx: call, session, owner: tx.to });
        out.push(...inner.map((line) => `batch call ${index}: ${line}`));
      }
      break;
    }
  }
  return out;
}

function multicallDepartures(
  data: Hex,
  allowed: readonly { selector: Hex }[],
  pairs: Set<string>,
  owner: Address,
): string[] {
  const out: string[] = [];
  const decoded = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data });
  const inner = decoded.functionName === "multicall" ? decoded.args[0] : [];
  const created = new Set<string>();
  const minted = new Set<string>();
  for (const [index, call] of inner.entries()) {
    const at = `inner call ${index}`;
    if (!allowed.some((each) => each.selector === selectorOf(call))) {
      out.push(`${at}: ${selectorOf(call)} is not allowed`);
      continue;
    }
    const each = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: call });
    if (each.functionName === "createAndInitializePoolIfNecessary" || each.functionName === "mint") {
      const [token0, token1] =
        each.functionName === "mint" ? [each.args[0].token0, each.args[0].token1] : [each.args[0], each.args[1]];
      const key = pairKey(token0, token1);
      if (!pairs.has(key)) out.push(`${at}: ${token0}/${token1} is not a pool of this session`);
      (each.functionName === "mint" ? minted : created).add(key);
    }
    if ((each.functionName === "mint" || each.functionName === "collect") && !same(each.args[0].recipient, owner)) {
      out.push(`${at}: ${each.functionName} pays ${each.args[0].recipient}`);
    }
  }
  for (const key of created) if (!minted.has(key)) out.push(`creates ${key} without minting into it`);
  return out;
}

/** Throws `UnlistedTxError` where `tx` departs from any rule `departures` checks. */
export function assertListed(args: Parameters<typeof departures>[0]): void {
  const found = departures(args);
  if (found.length > 0) throw new UnlistedTxError(found);
}
