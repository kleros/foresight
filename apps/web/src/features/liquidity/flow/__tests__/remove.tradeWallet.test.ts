import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, encodeFunctionData, isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { batchExecuteTx, executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { LIQUIDITY_DEADLINE_SECONDS } from "../../oracle/tolerances";
import type { RemoveInput } from "../../types";
import { POSITION_MANAGER_ABI } from "../abi";
import { departures } from "../allowed";
import { planRemove } from "../plan";
import {
  CHAIN_TIME,
  LIST,
  MAX_UINT128,
  branch,
  decode,
  fullRange,
  owner,
  session,
  sortPair,
  stranger,
  userSqrtPrice,
} from "./support/session";

const s = session([branch(1)]);
const b = s.branches[0]!;
const [token0, token1] = sortPair(b.upToken, b.outcome);
const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, owner);
const same = (a: Address, c: Address) => isAddressEqual(a, c);

const position = (tokenId: bigint, liquidity: bigint) => {
  const { tickLower, tickUpper } = fullRange(60);
  return { tokenId, token0, token1, tickLower, tickUpper, liquidity };
};

/** Positions 77 and 78 of one pool, withdrawn at UP 40%. */
const held: Omit<RemoveInput, "tradeWallet"> = {
  chainId: 100,
  owner,
  chainTime: CHAIN_TIME,
  sqrtPriceX96: userSqrtPrice(4_000n, true),
  positions: [position(77n, 10n ** 21n), position(78n, 3n * 10n ** 20n)],
};

/** The calls a trade wallet batch makes. */
function batchCalls(tx: FlowTx) {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (decoded.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${decoded.functionName}`);
  return decoded.args[0];
}

describe("a remove of positions the trade wallet holds", () => {
  it("sends one batch to the trade wallet, carrying no native", () => {
    const plan = planRemove({ ...held, tradeWallet });

    expect(plan.tx.to).toBe(tradeWallet);
    expect(plan.tx.value ?? 0n).toBe(0n);
    expect(batchCalls(plan.tx)).toHaveLength(1);
  });

  it("has the trade wallet withdraw, collect to itself and burn each position in one position manager multicall", () => {
    const plan = planRemove({ ...held, tradeWallet });
    expect(plan.tx.to).toBe(tradeWallet);
    const [call] = batchCalls(plan.tx);

    expect(same(call!.to, LIST.positionManager)).toBe(true);
    const d = decode({ to: call!.to, data: call!.data });
    if (d.kind !== "multicall") throw new Error("not a multicall");
    expect(d.inner.map((each) => [each.name, "tokenId" in each ? each.tokenId : undefined])).toEqual([
      ["decreaseLiquidity", 77n],
      ["collect", 77n],
      ["burn", 77n],
      ["decreaseLiquidity", 78n],
      ["collect", 78n],
      ["burn", 78n],
    ]);
    for (const each of d.inner) {
      if (each.name !== "collect") continue;
      expect(each.recipient).toBe(tradeWallet);
      expect(each.amount0Max).toBe(MAX_UINT128);
      expect(each.amount1Max).toBe(MAX_UINT128);
    }
    for (const at of [0, 3]) {
      expect(d.inner[at]).toMatchObject({
        liquidity: held.positions[at / 3]!.liquidity,
        deadline: CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS,
      });
    }
  });

  it("holds the trade wallet's withdrawal to the same amounts and minimums as the wallet's own", () => {
    const own = planRemove(held);
    const plan = planRemove({ ...held, tradeWallet });
    expect(plan.tx.to).toBe(tradeWallet);
    const [call] = batchCalls(plan.tx);
    const inner = decode({ to: call!.to, data: call!.data });
    const direct = decode(own.tx);
    if (inner.kind !== "multicall" || direct.kind !== "multicall") throw new Error("not a multicall");

    for (const field of ["amount0", "amount1", "amount0Min", "amount1Min"] as const) {
      expect(plan[field]).toBe(own[field]);
    }
    const decreases = (calls: typeof inner.inner) => calls.filter((each) => each.name === "decreaseLiquidity");
    expect(decreases(inner.inner)).toEqual(decreases(direct.inner));
  });

  it("still withdraws a wallet-held remove in one direct multicall collecting to the owner", () => {
    const plan = planRemove(held);
    const d = decode(plan.tx);

    expect(same(plan.tx.to, LIST.positionManager)).toBe(true);
    if (d.kind !== "multicall") throw new Error("not a multicall");
    for (const each of d.inner) if (each.name === "collect") expect(same(each.recipient, owner)).toBe(true);
  });
});

describe("a trade wallet remove against the allow-list", () => {
  /** The trade wallet's batch withdrawing position 77, its collect paying `recipient`. */
  const batchPaying = (recipient: Address) =>
    batchExecuteTx(tradeWallet, [
      {
        to: LIST.positionManager,
        data: encodeFunctionData({
          abi: POSITION_MANAGER_ABI,
          functionName: "multicall",
          args: [
            [
              encodeFunctionData({
                abi: POSITION_MANAGER_ABI,
                functionName: "decreaseLiquidity",
                args: [
                  {
                    tokenId: 77n,
                    liquidity: 10n ** 21n,
                    amount0Min: 1n,
                    amount1Min: 1n,
                    deadline: CHAIN_TIME + LIQUIDITY_DEADLINE_SECONDS,
                  },
                ],
              }),
              encodeFunctionData({
                abi: POSITION_MANAGER_ABI,
                functionName: "collect",
                args: [{ tokenId: 77n, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
              }),
              encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: "burn", args: [77n] }),
            ],
          ],
        }),
      },
    ]);

  it("passes the planned trade wallet remove", () => {
    const { tx } = planRemove({ ...held, tradeWallet });
    expect(tx.to).toBe(tradeWallet);

    expect(departures({ tx, session: s, owner, from: owner, tradeWallet })).toEqual([]);
  });

  it("passes a trade wallet batch whose collect pays the trade wallet", () => {
    expect(departures({ tx: batchPaying(tradeWallet), session: s, owner, from: owner, tradeWallet })).toEqual([]);
  });

  it("refuses a trade wallet batch whose collect pays the owner", () => {
    expect(departures({ tx: batchPaying(owner), session: s, owner, from: owner, tradeWallet })).not.toEqual([]);
  });

  it("refuses a trade wallet batch whose collect pays a stranger", () => {
    expect(departures({ tx: batchPaying(stranger), session: s, owner, from: owner, tradeWallet })).not.toEqual([]);
  });

  it("refuses a trade wallet remove checked as a run with no trade wallet", () => {
    expect(departures({ tx: batchPaying(tradeWallet), session: s, owner, from: owner })).not.toEqual([]);
  });
});
