import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { batchExecuteTx, batchValueExecuteTx, executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { NEW_POOL_TICK_SPACING } from "../../oracle/tolerances";
import { rowsOf } from "../../run/rows";
import type { SeedInput } from "../../types";
import { POSITION_MANAGER_ABI } from "../abi";
import { departures } from "../allowed";
import { planSeed } from "../plan";
import {
  CHAIN_TIME,
  LIST,
  branch,
  missing,
  owner,
  session,
  stranger,
  userSqrtPrice,
  type PoolStateInput,
} from "./support/session";

const s = session([branch(1), branch(2)]);
const factory = tradeExecutorFactoryAddress(100)!;
const wallet = executorAddress(factory, owner);
const same = (a: Address, b: Address) => isAddressEqual(a, b);

const seed = (overrides: Partial<SeedInput> = {}): SeedInput => ({
  session: s,
  owner,
  total: 10n ** 21n,
  collateral: "sDAI",
  chainTime: CHAIN_TIME,
  branches: s.branches.map(() => ({ depth: 10n ** 21n, upPriceBps: 5_000n, pools: { up: missing, down: missing } })),
  tradeWallet: { address: wallet, deployed: false },
  ...overrides,
});

const check = (tx: FlowTx, input: SeedInput = seed()) =>
  departures({ tx, session: input.session, owner, from: owner, tradeWallet: input.tradeWallet?.address });

/** The calls a trade wallet batch makes, with their native value. */
function innerCalls(tx: FlowTx) {
  const decoded = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (decoded.functionName !== "batchExecute" && decoded.functionName !== "batchValueExecute") return [];
  return decoded.args[0].map((call) => ({ to: call.to, data: call.data, value: "value" in call ? call.value : 0n }));
}

const txOf = (input: SeedInput, id: string) => planSeed(input).steps.find((step) => step.id === id)!.tx!;

describe("a seed through the owner's trade wallet", () => {
  it("creates and funds the trade wallet, then signs the parent split and each branch once", () => {
    const input = seed();
    const plan = planSeed(input);

    expect(plan.steps.map((step) => step.id)).toEqual([
      "parent:wallet",
      "parent:fund",
      "parent:split",
      "branch:0:seed",
      "branch:1:seed",
    ]);
    expect(rowsOf({ kind: "seed", input }, plan.steps).map((row) => [row.id, row.stepIds.length])).toEqual([
      ["parent", 3],
      ["branch:0", 1],
      ["branch:1", 1],
    ]);
    expect(txOf(input, "parent:fund")).toEqual({
      to: s.collateral,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [wallet, input.total] }),
    });
    for (const step of plan.steps) expect(check(step.tx!)).toEqual([]);
  });

  it("skips the creation once the trade wallet is deployed", () => {
    const plan = planSeed(seed({ tradeWallet: { address: wallet, deployed: true } }));

    expect(plan.steps.map((step) => step.id)).not.toContain("parent:wallet");
  });

  it("mints every seed position to the trade wallet", () => {
    const input = seed();
    const mints = ["branch:0:seed", "branch:1:seed"].flatMap((id) =>
      innerCalls(txOf(input, id))
        .filter((call) => same(call.to, LIST.positionManager))
        .flatMap((call) => {
          const outer = decodeFunctionData({ abi: POSITION_MANAGER_ABI, data: call.data });
          return outer.functionName === "multicall" ? outer.args[0] : [];
        })
        .map((data) => decodeFunctionData({ abi: POSITION_MANAGER_ABI, data }))
        .flatMap((each) => (each.functionName === "mint" ? [each.args[0].recipient] : [])),
    );

    expect(mints).toHaveLength(4);
    for (const recipient of mints) expect(recipient).toBe(wallet);
  });

  it("pays an xDAI seed's split through the parent batch, with no transfer first", () => {
    const input = seed({
      collateral: "xDAI",
      previewDeposit: (10n ** 21n * 9n) / 10n,
      tradeWallet: { address: wallet, deployed: true },
    });
    const plan = planSeed(input);
    const split = txOf(input, "parent:split");

    expect(plan.steps.map((step) => step.id)).toEqual(["parent:split", "branch:0:seed", "branch:1:seed"]);
    expect(split.value).toBe(input.total);
    expect(innerCalls(split).map((call) => call.value)).toEqual([input.total]);
    for (const step of plan.steps) expect(check(step.tx!, input)).toEqual([]);
  });

  it("keeps a realign's dust position in the trade wallet, so every step is built before the run", () => {
    const one = session([branch(1)]);
    const hostile = (childIsToken0: boolean): PoolStateInput => ({
      status: "empty",
      sqrtPriceX96: userSqrtPrice(100n, childIsToken0),
      tickSpacing: NEW_POOL_TICK_SPACING,
    });
    const input = seed({
      session: one,
      branches: [{ depth: 10n ** 21n, upPriceBps: 5_000n, pools: { up: hostile(true), down: hostile(false) } }],
    });
    const plan = planSeed(input);

    expect(plan.steps.every((step) => step.tx !== undefined)).toBe(true);
    const swaps = innerCalls(txOf(input, "branch:0:seed")).filter((call) => same(call.to, LIST.swaprRouter));
    expect(swaps).toHaveLength(2);
    for (const step of plan.steps) expect(check(step.tx!, input)).toEqual([]);
  });
});

describe("trade wallet transactions against the allow-list", () => {
  const input = seed();
  const branchCalls = innerCalls(txOf(input, "branch:0:seed"));

  it("refuses a trade wallet that is not the owner's", () => {
    const other = executorAddress(factory, stranger);
    const tx = batchExecuteTx(other, branchCalls);

    expect(departures({ tx, session: s, owner, tradeWallet: other })).toContain(
      `${other} is not the owner's trade wallet`,
    );
  });

  it("refuses a batch call that pays the owner instead of the trade wallet", () => {
    const own = planSeed({ ...input, tradeWallet: undefined }).steps.find((step) => step.id === "branch:0:seed")!.tx!;
    const tx = batchExecuteTx(wallet, [{ to: own.to, data: own.data! }]);

    expect(check(tx).join("; ")).toMatch(/batch call 0: inner call \d: mint pays/);
  });

  it("refuses a transfer to anyone but the trade wallet, and a transfer inside a batch", () => {
    const pay = (to: Address): FlowTx => ({
      to: s.collateral,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1n] }),
    });

    expect(check(pay(stranger)).map((line) => line.toLowerCase())).toContain(`transfer pays ${stranger}`);
    expect(check(batchExecuteTx(wallet, [{ to: s.collateral, data: pay(wallet).data! }])).join("; ")).toMatch(
      /batch call 0: transfer pays/,
    );
  });

  it("refuses a batch whose native value differs from what its calls spend", () => {
    const tx = { ...batchValueExecuteTx(wallet, branchCalls), value: 1n };

    expect(check(tx)).toContain("batch carries 1 native but its calls spend 0");
  });

  it("refuses trade wallet calls on a run that does not go through one", () => {
    expect(departures({ tx: txOf(input, "parent:wallet"), session: s, owner })).not.toEqual([]);
    expect(departures({ tx: txOf(input, "parent:fund"), session: s, owner })).not.toEqual([]);
    expect(departures({ tx: txOf(input, "branch:0:seed"), session: s, owner })).not.toEqual([]);
  });
});
