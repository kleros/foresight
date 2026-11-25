import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  keccak256,
  type Address,
} from "viem";
import { describe, expect, it } from "vitest";

import { batchExecuteTx, type ExecutorCall } from "@/lib/trade-executor/executor";

import { tradeExecutorAbi } from "@/config/contracts";

import {
  CHAIN_ID,
  CHILD_BALANCES,
  LIST,
  OTHER_OWNER,
  OWNER,
  PARENT_BALANCES,
  parentToken,
  planFor,
  plannerInput,
  resolvedParent,
  SCOPE,
  SDAI,
  tradeWalletOf,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
  WAD,
} from "./support/session";
import type { ChildResolution, SessionResolution } from "../../api/getSessionResolution";
import { ownerPayBatchDepartures, planTradeWalletRedeemToOwner } from "../payOwner";
import { planTradeWalletRedeem, planWalletRedeem } from "../plan";
import { redeemBatchDepartures, redeemCallsDepartures } from "../tradeWalletBatchAllowed";

/**
 * Spec D12 and D15, oracle R3 and R5: ticked, the trade wallet batch ends, after its last redeem, with exactly one
 * sDAI `transfer` of the R5 payout to the trade wallet's on-chain `owner()`. `ownerPayBatchDepartures` returns the
 * departures as lines, empty when the batch keeps to the rule.
 */

const RUNS = { seed: 20261125, numRuns: 200 } as const;
const TRANSFER = "0xa9059cbb";

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
/** Two on-chain owners, neither the connected account, so a recipient taken from the account shows. */
const ONCHAIN_OWNER = at("0a11");
const OTHER_ONCHAIN_OWNER = at("0a22");
const same = (a: Address, b: Address) => isAddressEqual(a, b);

const transfer = (token: Address, to: Address, amount: bigint): ExecutorCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});

function innerCalls(tx: FlowTx): ExecutorCall[] {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data! });
  if (outer.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${outer.functionName}`);
  return outer.args[0].map(({ to, data }) => ({ to, data }));
}

const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** Oracle R5, computed here from the numerators: parent tokens floored once, child tokens floored twice. */
function r5Payout(resolution: SessionResolution, parentBalances: bigint[], childBalances: bigint[][]): bigint {
  const { parent, children } = resolution;
  if (!parent.resolved) return 0n;
  let total = parentBalances.reduce(
    (sum, balance, index) => sum + floorPay(balance, parent.payoutNumerators[index]!, parent.payoutDenominator),
    0n,
  );
  for (let option = 0; option < parent.payoutNumerators.length - 1; option++) {
    const child = children[option];
    if (!child?.deployed || !child.resolved || parent.payoutNumerators[option] === 0n) continue;
    const outcomeTokens = (childBalances[option] ?? []).reduce(
      (sum, balance, slot) => sum + floorPay(balance, child.payoutNumerators[slot]!, child.payoutDenominator),
      0n,
    );
    total += floorPay(outcomeTokens, parent.payoutNumerators[option]!, parent.payoutDenominator);
  }
  return total;
}

const EXPECTED = r5Payout(TWO_WINNERS, PARENT_BALANCES, CHILD_BALANCES);

/** The base batch's calls, then `tail`: a ticked batch as the oracle allows it when `tail` is the owner transfer. */
const ticked = (tail: ExecutorCall[], account: Address = OWNER) =>
  batchExecuteTx(tradeWalletOf(account), [...innerCalls(planFor({ owner: account }).tx!), ...tail]);

const departures = (
  tx: FlowTx,
  { owner = ONCHAIN_OWNER, resolution = TWO_WINNERS, account = OWNER } = {} as {
    owner?: Address;
    resolution?: SessionResolution;
    account?: Address;
  },
) => ownerPayBatchDepartures({ tx, chainId: CHAIN_ID, account, scope: SCOPE, payout: { owner, resolution } });

const VALID = () => ticked([transfer(SDAI, ONCHAIN_OWNER, EXPECTED)]);

describe("A4 unticked, the trade wallet batch is the one planTradeWalletRedeem built at base", () => {
  /** keccak256 and byte length of `tx.data` as planTradeWalletRedeem built it at b0730173. */
  const BASE = {
    twoWinners: { hash: "0x7ea111f835f6f083bfcc4679e848e917f78981b0915454f2b4a2ae24229aed81", size: 3044 },
    waiting: { hash: "0x524309d6aa7385cf7a864b616bae3f0a77ad46ae850d1ed461f9f56608bbaf83", size: 2020 },
    invalidParent: { hash: "0x28e13af69767fa582fdf5ec68182fa282c33e1bf601acd7e506859bc17befc45", size: 708 },
  } as const;
  const bytes = (tx: FlowTx | null) => ({ hash: keccak256(tx!.data!), size: (tx!.data!.length - 2) / 2 });

  it("is byte for byte the base batch, to the same trade wallet, for two owners", () => {
    for (const owner of [OWNER, OTHER_OWNER]) {
      const { tx } = planTradeWalletRedeem(plannerInput({ owner }));
      expect(bytes(tx)).toEqual(BASE.twoWinners);
      expect(same(tx!.to, tradeWalletOf(owner))).toBe(true);
      expect(tx!.value ?? 0n).toBe(0n);
    }
  });

  it("is byte for byte the base batch with an option waiting and with the parent resolved INVALID", () => {
    const waiting = planFor({
      resolution: {
        ...TWO_WINNERS,
        children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) },
      },
    });
    const invalidParent = planFor({
      resolution: { parent: resolvedParent([0n, 0n, 0n, 1n]), children: TWO_WINNERS.children },
    });
    expect(bytes(waiting.tx)).toEqual(BASE.waiting);
    expect(bytes(invalidParent.tx)).toEqual(BASE.invalidParent);
  });

  it("holds no transfer", () => {
    for (const call of innerCalls(planFor().tx!)) expect(call.data.startsWith(TRANSFER)).toBe(false);
  });
});

describe("A5 ticked, the batch ends with exactly one sDAI transfer of the payout to the owner it is given", () => {
  it("is the unticked batch byte for byte, then one sDAI transfer of the R5 payout, for two owners", () => {
    for (const owner of [ONCHAIN_OWNER, OTHER_ONCHAIN_OWNER]) {
      const input = plannerInput({ owner: OWNER });
      const unticked = planTradeWalletRedeem(input);
      const plan = planTradeWalletRedeemToOwner(input, owner);

      expect(same(plan.tx!.to, tradeWalletOf(OWNER))).toBe(true);
      expect(plan.tx!.value ?? 0n).toBe(0n);
      const calls = innerCalls(plan.tx!);
      const base = innerCalls(unticked.tx!);
      expect(calls.slice(0, base.length)).toEqual(base);
      expect(calls).toHaveLength(base.length + 1);

      const last = calls.at(-1)!;
      expect(same(last.to, SDAI)).toBe(true);
      const decoded = decodeFunctionData({ abi: erc20Abi, data: last.data });
      expect(decoded.functionName).toBe("transfer");
      const [recipient, amount] = decoded.args as readonly [Address, bigint];
      expect(same(recipient, owner)).toBe(true);
      expect(same(recipient, OWNER)).toBe(false);
      expect(amount).toBe(EXPECTED);
      expect(plan.payout).toBe(EXPECTED);
      expect(calls.filter((call) => call.data.startsWith(TRANSFER))).toHaveLength(1);
    }
  });

  it("keeps the parts, waiting list and payout of the unticked plan", () => {
    const input = plannerInput({
      resolution: {
        ...TWO_WINNERS,
        children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: valuedChild(2, 10n) },
      },
    });
    const { tx: _untickedTx, ...unticked } = planTradeWalletRedeem(input);
    const { tx: _tickedTx, ...plan } = planTradeWalletRedeemToOwner(input, ONCHAIN_OWNER);
    expect(plan).toEqual(unticked);
  });

  it("plans no batch, so no lone transfer, when nothing is redeemable", () => {
    const plan = planTradeWalletRedeemToOwner(
      plannerInput({ parentBalances: [0n, 0n, 7n * WAD, 0n], childBalances: [] }),
      ONCHAIN_OWNER,
    );
    expect(plan.tx).toBeNull();
    expect(plan.payout).toBe(0n);
  });

  it("transfers the R5 payout and passes the guard over generated balances and results", () => {
    const balance = fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 10n ** 24n }));
    const child = (option: number) =>
      fc.oneof(
        fc.constant(unresolvedChild(option)),
        fc.bigInt({ min: 0n, max: 100n }).map((value): ChildResolution => valuedChild(option, value)),
      );
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 3n }), { minLength: 4, maxLength: 4 }).filter((n) => n.some((x) => x > 0n)),
        fc.tuple(child(0), child(1), child(2)),
        fc.array(balance, { minLength: 4, maxLength: 4 }),
        fc.array(fc.array(balance, { minLength: 3, maxLength: 3 }), { minLength: 3, maxLength: 3 }),
        fc.constantFrom(ONCHAIN_OWNER, OTHER_ONCHAIN_OWNER),
        (numerators, children, parentBalances, childBalances, owner) => {
          const resolution: SessionResolution = { parent: resolvedParent(numerators), children: { ...children } };
          const input = plannerInput({ resolution, parentBalances, childBalances });
          const plan = planTradeWalletRedeemToOwner(input, owner);
          const expected = r5Payout(resolution, parentBalances, childBalances);
          expect(plan.payout).toBe(expected);
          if (!plan.tx) return;
          const last = decodeFunctionData({ abi: erc20Abi, data: innerCalls(plan.tx).at(-1)!.data });
          expect(last.args).toEqual([owner, expected]);
          expect(departures(plan.tx, { owner, resolution })).toEqual([]);
        },
      ),
      RUNS,
    );
  });
});

describe("A6 the guard refuses a ticked batch whose transfer departs in any way", () => {
  it("passes the valid ticked batch and the planner's own, for two owners", () => {
    expect(departures(VALID())).toEqual([]);
    for (const owner of [ONCHAIN_OWNER, OTHER_ONCHAIN_OWNER]) {
      const plan = planTradeWalletRedeemToOwner(plannerInput(), owner);
      expect(departures(plan.tx!, { owner })).toEqual([]);
    }
  });

  it("refuses a recipient that is the trade wallet itself", () => {
    expect(departures(ticked([transfer(SDAI, tradeWalletOf(OWNER), EXPECTED)]))).not.toEqual([]);
  });

  it("refuses a recipient that is the conditional router", () => {
    expect(departures(ticked([transfer(SDAI, LIST.conditionalRouter, EXPECTED)]))).not.toEqual([]);
  });

  it("refuses a recipient that is the connected account when the on-chain owner is another address", () => {
    expect(departures(ticked([transfer(SDAI, OWNER, EXPECTED)]))).not.toEqual([]);
  });

  it("refuses an amount of the payout + 1", () => {
    expect(departures(ticked([transfer(SDAI, ONCHAIN_OWNER, EXPECTED + 1n)]))).not.toEqual([]);
  });

  it("refuses an amount of the payout - 1", () => {
    expect(departures(ticked([transfer(SDAI, ONCHAIN_OWNER, EXPECTED - 1n)]))).not.toEqual([]);
  });

  it("refuses a transfer of a session outcome token", () => {
    expect(departures(ticked([transfer(parentToken(0), ONCHAIN_OWNER, EXPECTED)]))).not.toEqual([]);
  });

  it("refuses a transfer of the parent's INVALID token", () => {
    expect(departures(ticked([transfer(parentToken(3), ONCHAIN_OWNER, EXPECTED)]))).not.toEqual([]);
  });

  it("refuses a second transfer, of the same payout or of a split of it", () => {
    const owed = transfer(SDAI, ONCHAIN_OWNER, EXPECTED);
    expect(departures(ticked([owed, owed]))).not.toEqual([]);
    expect(
      departures(ticked([transfer(SDAI, ONCHAIN_OWNER, EXPECTED - 1n), transfer(SDAI, ONCHAIN_OWNER, 1n)])),
    ).not.toEqual([]);
  });

  it("refuses a transfer placed before the last redeem", () => {
    const calls = innerCalls(planFor().tx!);
    const early = [...calls.slice(0, -1), transfer(SDAI, ONCHAIN_OWNER, EXPECTED), calls.at(-1)!];
    expect(departures(batchExecuteTx(tradeWalletOf(OWNER), early))).not.toEqual([]);
  });

  it("still refuses what the unticked guard refuses: native value, and another account's trade wallet", () => {
    expect(departures({ ...VALID(), value: 1n })).not.toEqual([]);
    expect(departures(VALID(), { account: OTHER_OWNER })).not.toEqual([]);
  });

  it("is the only path that allows the transfer: the unticked guard refuses the valid ticked batch", () => {
    expect(redeemBatchDepartures({ tx: VALID(), chainId: CHAIN_ID, account: OWNER, scope: SCOPE })).not.toEqual([]);
  });
});

describe("A7 the guard derives the transfer amount from the resolution it is given, not from the planner", () => {
  /** Child 0 at 50: its odd-wei UP and DOWN pay one wei less through R5's two floors than through one. */
  const ODD_BALANCES = { parentBalances: [0n, 0n, 0n, 0n], childBalances: [[WAD + 1n, WAD + 3n, 0n]] };
  const ODD: SessionResolution = { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 0: valuedChild(0, 50n) } };

  it("accepts the two-floor payout and refuses the single-floor one", () => {
    const twoFloors = r5Payout(ODD, ODD_BALANCES.parentBalances, ODD_BALANCES.childBalances);
    const oneFloor = (((WAD + 1n) * 50n + (WAD + 3n) * 50n) * 1n) / (100n * 2n);
    expect(oneFloor).toBe(twoFloors + 1n);

    const base = innerCalls(planFor({ ...ODD_BALANCES, resolution: ODD }).tx!);
    const withAmount = (amount: bigint) =>
      batchExecuteTx(tradeWalletOf(OWNER), [...base, transfer(SDAI, ONCHAIN_OWNER, amount)]);
    expect(departures(withAmount(twoFloors), { resolution: ODD })).toEqual([]);
    expect(departures(withAmount(oneFloor), { resolution: ODD })).not.toEqual([]);
  });

  it("refuses a plan whose amount was tampered, though its transfer agrees with the plan's own payout", () => {
    const plan = planTradeWalletRedeemToOwner(plannerInput(), ONCHAIN_OWNER);
    const tampered = { ...plan, payout: plan.payout + 10n ** 15n };
    const calls = innerCalls(plan.tx!);
    const tx = batchExecuteTx(tradeWalletOf(OWNER), [
      ...calls.slice(0, -1),
      transfer(SDAI, ONCHAIN_OWNER, tampered.payout),
    ]);
    expect(departures(tx)).not.toEqual([]);
  });

  it("refuses a planner batch built from numerators other than the chain's", () => {
    const misread: SessionResolution = {
      ...TWO_WINNERS,
      children: { ...TWO_WINNERS.children, 0: valuedChild(0, 43n) },
    };
    const plan = planTradeWalletRedeemToOwner(plannerInput({ resolution: misread }), ONCHAIN_OWNER);
    expect(plan.payout).not.toBe(EXPECTED);
    // the redeems pull the same balances; only the transfer amount follows the misread numerators
    expect(departures(plan.tx!, { resolution: misread })).toEqual([]);
    expect(departures(plan.tx!, { resolution: TWO_WINNERS })).not.toEqual([]);
  });

  it("refuses any amount off the R5 payout over generated balances", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 24n }), { minLength: 4, maxLength: 4 }),
        fc.array(fc.array(fc.bigInt({ min: 0n, max: 10n ** 24n }), { minLength: 3, maxLength: 3 }), {
          minLength: 3,
          maxLength: 3,
        }),
        fc.bigInt({ min: 1n, max: 10n ** 18n }),
        fc.boolean(),
        (parentBalances, childBalances, delta, above) => {
          const plan = planFor({ parentBalances, childBalances });
          if (!plan.tx) return;
          const expected = r5Payout(TWO_WINNERS, parentBalances, childBalances);
          const amount = above ? expected + delta : expected - delta;
          fc.pre(amount >= 0n);
          const tx = batchExecuteTx(tradeWalletOf(OWNER), [
            ...innerCalls(plan.tx),
            transfer(SDAI, ONCHAIN_OWNER, amount),
          ]);
          expect(departures(tx)).not.toEqual([]);
        },
      ),
      RUNS,
    );
  });
});

describe("A9 the connected wallet path still refuses any transfer call", () => {
  const callsDepartures = (calls: { to: Address; data?: `0x${string}` }[]) =>
    redeemCallsDepartures({ calls, chainId: CHAIN_ID, scope: SCOPE });

  it("refuses the sDAI transfer a ticked trade wallet batch may end with, in the wallet's calls", () => {
    const { calls, payout } = planWalletRedeem(plannerInput());
    expect(callsDepartures(calls)).toEqual([]);

    const lines = callsDepartures([...calls, transfer(SDAI, ONCHAIN_OWNER, payout)]);
    expect(lines.filter((line) => line.includes("is not allowed"))).toHaveLength(1);
  });

  it("refuses an sDAI transfer to the connected account and one at the start of the wallet's calls", () => {
    const { calls, payout } = planWalletRedeem(plannerInput());
    expect(callsDepartures([...calls, transfer(SDAI, OWNER, payout)])).not.toEqual([]);
    expect(callsDepartures([transfer(SDAI, OWNER, 1n), ...calls])).not.toEqual([]);
  });
});
