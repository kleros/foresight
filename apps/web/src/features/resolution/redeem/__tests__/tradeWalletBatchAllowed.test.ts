import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { batchExecuteTx, batchValueExecuteTx, type ExecutorCall } from "@/lib/trade-executor/executor";

import {
  approve,
  CHAIN_ID,
  childMarket,
  childToken,
  DOWN,
  LIST,
  OTHER_OWNER,
  OWNER,
  PARENT,
  parentToken,
  planFor,
  redeemChild,
  redeemPositions,
  resolvedParent,
  SCOPE,
  tradeWalletOf,
  unresolvedChild,
  UP,
  valuedChild,
} from "./support/session";
import type { ChildResolution } from "../../api/getSessionResolution";
import { assertRedeemBatchAllowed, redeemBatchDepartures, UnlistedRedeemError } from "../tradeWalletBatchAllowed";

const A = 5n * 10n ** 18n + 1n;
const B = 4n * 10n ** 18n;
const C = 4n * 10n ** 18n - 7n;
const STRANGER = getAddress("0x5700000000000000000000000000000000000c56");

/** Parent token 0, then child 0's UP and DOWN: a batch that keeps to every rule. */
const VALID: ExecutorCall[] = [
  approve(parentToken(0), LIST.gnosisRouter, A),
  redeemPositions([0n], [A]),
  approve(childToken(0, UP), LIST.conditionalRouter, B),
  approve(childToken(0, DOWN), LIST.conditionalRouter, C),
  redeemChild(0, [1n, 0n], [B, C]),
];

const departures = (tx: FlowTx, account: Address = OWNER) =>
  redeemBatchDepartures({ tx, chainId: CHAIN_ID, account, scope: SCOPE });

const batch = (calls: ExecutorCall[]) => batchExecuteTx(tradeWalletOf(OWNER), calls);

/** The departures of the valid batch with `calls` in place of its child part. */
const withChild = (...calls: ExecutorCall[]) => departures(batch([...VALID.slice(0, 2), ...calls]));
/** The departures of the valid batch with `calls` in place of its parent part. */
const withParent = (...calls: ExecutorCall[]) => departures(batch([...calls, ...VALID.slice(2)]));

const naming = (lines: string[], text: string) => lines.filter((line) => line.includes(text));

describe("a trade wallet redeem batch checked before the wallet opens (oracle R2 to R4, R8)", () => {
  it("passes the valid batch and the planner's own batch, for two owners", () => {
    expect(departures(batch(VALID))).toEqual([]);
    for (const owner of [OWNER, OTHER_OWNER]) {
      const plan = planFor({ owner });
      expect(plan.tx).not.toBeNull();
      expect(departures(plan.tx!, owner)).toEqual([]);
    }
  });

  it("passes every batch the planner builds over generated balances and results", () => {
    const balance = fc.oneof(fc.constant(0n), fc.bigInt({ min: 10n ** 6n, max: 10n ** 24n }));
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
        fc.constantFrom(OWNER, OTHER_OWNER),
        (numerators, children, parentBalances, childBalances, owner) => {
          const plan = planFor({
            owner,
            resolution: { parent: resolvedParent(numerators), children: { ...children } },
            parentBalances,
            childBalances,
          });
          if (plan.tx) expect(departures(plan.tx, owner)).toEqual([]);
        },
      ),
      { seed: 20261123, numRuns: 200 },
    );
  });

  it("refuses a batch for another account's trade wallet", () => {
    const lines = departures(planFor({ owner: OTHER_OWNER }).tx!, OWNER);
    expect(naming(lines, "trade wallet")).toHaveLength(1);
  });

  it("refuses native value on the batch", () => {
    expect(naming(departures({ ...batch(VALID), value: 1n }), "native")).toHaveLength(1);
  });

  it("refuses a batchValueExecute on the owner's own trade wallet, with or without value in its calls", () => {
    const wallet = tradeWalletOf(OWNER);
    const free = batchValueExecuteTx(
      wallet,
      VALID.map((call) => ({ ...call, value: 0n })),
    );
    const paid = batchValueExecuteTx(
      wallet,
      VALID.map((call) => ({ ...call, value: parseEther("1") })),
    );

    expect(departures(free)).toEqual([expect.stringContaining("is not batchExecute")]);
    expect(departures({ ...paid, value: parseEther("5") })).toEqual([
      expect.stringContaining("native"),
      expect.stringContaining("is not batchExecute"),
    ]);
  });

  it("refuses a batch with no calls", () => {
    expect(departures(batch([]))).toEqual(["batches no calls"]);
  });

  it("refuses a transfer of a session token and an approve on a token outside the session", () => {
    const transfer = {
      to: parentToken(0),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [STRANGER, A] }),
    };
    expect(naming(departures(batch([...VALID, transfer])), "is not allowed")).toHaveLength(1);
    expect(naming(departures(batch([...VALID, approve(STRANGER, LIST.gnosisRouter, 1n)])), "is not allowed")).toHaveLength(1);
  });

  it("refuses each redeem sent to the other router", () => {
    const parentAtConditional = { ...redeemPositions([0n], [A]), to: LIST.conditionalRouter };
    const childAtSeer = redeemChild(0, [1n, 0n], [B, C], { to: LIST.gnosisRouter });
    expect(naming(withParent(approve(parentToken(0), LIST.gnosisRouter, A), parentAtConditional), "is not allowed")).toHaveLength(1);
    expect(naming(withChild(...VALID.slice(2, 4), childAtSeer), "is not allowed")).toHaveLength(1);
  });

  describe("approves", () => {
    it("refuses an approve to a spender that is not a router", () => {
      const lines = departures(batch([approve(parentToken(1), STRANGER, 1n), ...VALID]));
      expect(naming(lines, `approves ${STRANGER}`)).toHaveLength(1);
    });

    it("refuses an unbounded approve, even when the redeem pulls that much", () => {
      const lines = withParent(approve(parentToken(0), LIST.gnosisRouter, maxUint256), redeemPositions([0n], [maxUint256]));
      expect(naming(lines, `approves ${maxUint256}`)).toHaveLength(1);
    });

    it("refuses an approve that differs from the redeemed amount by 1 wei", () => {
      const lines = withParent(approve(parentToken(0), LIST.gnosisRouter, A - 1n), redeemPositions([0n], [A]));
      expect(naming(lines, "no earlier approve of exactly")).toHaveLength(1);
    });

    it("refuses an approve placed after its redeem", () => {
      const lines = withParent(redeemPositions([0n], [A]), approve(parentToken(0), LIST.gnosisRouter, A));
      expect(naming(lines, "no earlier approve of exactly")).toHaveLength(1);
    });

    it("refuses an approve naming the other router", () => {
      const lines = withParent(approve(parentToken(0), LIST.conditionalRouter, A), redeemPositions([0n], [A]));
      expect(naming(lines, "no earlier approve of exactly")).toHaveLength(1);
    });

    it("refuses an approve no redeem spends", () => {
      expect(departures(batch([...VALID, approve(parentToken(1), LIST.gnosisRouter, 1n)]))).toEqual([
        "an approve is not spent by a redeem after it",
      ]);
    });
  });

  describe("redeemPositions", () => {
    const approved = approve(parentToken(0), LIST.gnosisRouter, A);

    it("refuses collateral other than sDAI", () => {
      expect(naming(withParent(approved, redeemPositions([0n], [A], { collateral: STRANGER })), "names collateral")).toHaveLength(1);
    });

    it("refuses a market other than the session's parent", () => {
      const lines = withParent(approved, redeemPositions([0n], [A], { market: childMarket(0) }));
      expect(naming(lines, "not the session's parent")).toHaveLength(1);
    });

    it("refuses an index past the parent's INVALID outcome", () => {
      expect(naming(withParent(approved, redeemPositions([4n], [A])), "outside 0..3")).toHaveLength(1);
    });

    it("refuses an index named twice", () => {
      const lines = withParent(approved, approve(parentToken(0), LIST.gnosisRouter, A), redeemPositions([0n, 0n], [A, A]));
      expect(naming(lines, "twice")).toHaveLength(1);
    });

    it("refuses indexes and amounts of different lengths", () => {
      const lines = withParent(approved, redeemPositions([0n, 1n], [A]));
      expect(naming(lines, "2 indexes but 1 amounts")).toHaveLength(1);
    });

    it("refuses a redeem of no index and a redeem of a zero amount", () => {
      expect(naming(withParent(redeemPositions([], [])), "redeems no index")).toHaveLength(1);
      const lines = withParent(approve(parentToken(0), LIST.gnosisRouter, 0n), redeemPositions([0n], [0n]));
      expect(naming(lines, "zero amount")).toHaveLength(1);
    });
  });

  describe("redeemConditionalToCollateral", () => {
    const approved = VALID.slice(2, 4);

    it("refuses collateral other than sDAI", () => {
      const lines = withChild(...approved, redeemChild(0, [1n, 0n], [B, C], { collateral: STRANGER }));
      expect(naming(lines, "names collateral")).toHaveLength(1);
    });

    it("refuses a market that is not a child of the session", () => {
      const lines = withChild(...approved, redeemChild(0, [1n, 0n], [B, C], { market: PARENT }));
      expect(naming(lines, "not a child of the session")).toHaveLength(1);
    });

    it("refuses a parent outcome other than the child's own, and more than one", () => {
      for (const parentIndexes of [[1n], [0n, 1n], []]) {
        const lines = withChild(...approved, redeemChild(0, [1n, 0n], [B, C], { parentIndexes }));
        expect(naming(lines, "names parent outcomes")).toHaveLength(1);
      }
    });

    it("refuses DOWN before UP", () => {
      const lines = withChild(approved[1]!, approved[0]!, redeemChild(0, [0n, 1n], [C, B]));
      expect(naming(lines, "not UP, DOWN, INVALID")).toHaveLength(1);
    });

    it("refuses indexes and amounts of different lengths", () => {
      const lines = withChild(approved[0]!, redeemChild(0, [1n, 0n], [B]));
      expect(naming(lines, "2 indexes but 1 amounts")).toHaveLength(1);
    });

    it("refuses an index past INVALID", () => {
      expect(naming(withChild(redeemChild(0, [3n], [B])), "outside 0..2")).toHaveLength(1);
    });
  });

  it("throws UnlistedRedeemError naming each departure, and passes a planned batch", () => {
    const args = { chainId: CHAIN_ID, account: OWNER, scope: SCOPE };
    expect(() => assertRedeemBatchAllowed({ ...args, tx: planFor().tx! })).not.toThrow();
    let thrown: unknown;
    try {
      assertRedeemBatchAllowed({ ...args, tx: { ...batch(VALID), value: 1n } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnlistedRedeemError);
    expect((thrown as UnlistedRedeemError).departures).toEqual(["carries 1 native"]);
  });

  it("refuses a chain with no allow-list", () => {
    expect(redeemBatchDepartures({ tx: batch(VALID), chainId: 1, account: OWNER, scope: SCOPE })).toEqual([
      "no redeem allow-list for chain 1",
    ]);
  });
});
