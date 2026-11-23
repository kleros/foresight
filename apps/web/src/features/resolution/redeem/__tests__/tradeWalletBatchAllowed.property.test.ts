import fc from "fast-check";
import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import type { ChildResolution } from "../../api/getSessionResolution";
import { planTradeWalletRedeem } from "../plan";
import { tradeWalletBatchDepartures, type RedeemScope } from "../tradeWalletBatchAllowed";

const CHAIN_ID = 100;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);

const SDAI = at("af");
const PARENT = at("b0");
const OWNER = at("1a01");
const CHILD = [at("c1"), at("c2")];
const parentTokens = [at("e00"), at("e01"), at("e02")];
const childTokens = CHILD.map((_, option) => [0, 1, 2].map((slot) => at(`d${option}${slot}`)));

const scope: RedeemScope = {
  collateral: SDAI,
  parentMarket: PARENT,
  parentTokens,
  children: { 0: { market: CHILD[0]!, tokens: childTokens[0]! }, 1: { market: CHILD[1]!, tokens: childTokens[1]! } },
};

const balance = fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 10n ** 30n }));
const numerator = fc.bigInt({ min: 0n, max: 10n ** 18n });
const denominator = fc.bigInt({ min: 1n, max: 10n ** 18n });
const child = (option: number): fc.Arbitrary<ChildResolution> =>
  fc.oneof(
    fc.constant({ deployed: true as const, market: CHILD[option]!, resolved: false as const }),
    fc.record({
      deployed: fc.constant(true as const),
      market: fc.constant(CHILD[option]!),
      resolved: fc.constant(true as const),
      invalid: fc.boolean(),
      finalValue: fc.constant(null),
      payoutNumerators: fc.tuple(numerator, numerator, numerator),
      payoutDenominator: denominator,
    }),
  );

describe("a planned trade wallet redeem, decoded against the allow-list", () => {
  it("departs from it in no way, for any resolution and balances", () => {
    let planned = 0;
    fc.assert(
      fc.property(
        fc.tuple(numerator, numerator, numerator),
        denominator,
        child(0),
        child(1),
        fc.array(balance, { minLength: 3, maxLength: 3 }),
        fc.array(fc.array(balance, { minLength: 3, maxLength: 3 }), { minLength: 2, maxLength: 2 }),
        (parentNumerators, parentDenominator, first, second, parentBalances, childBalances) => {
          const plan = planTradeWalletRedeem({
            chainId: CHAIN_ID,
            owner: OWNER,
            collateral: SDAI,
            parentMarket: PARENT,
            resolution: {
              parent: {
                resolved: true,
                invalid: false,
                winningOutcomes: [],
                payoutNumerators: parentNumerators,
                payoutDenominator: parentDenominator,
              },
              children: { 0: first, 1: second },
            },
            parentTokens: parentTokens.map((token, index) => ({ token, balance: parentBalances[index]! })),
            childTokens: Object.fromEntries(
              childTokens.map((tokens, option) => [
                option,
                tokens.map((token, slot) => ({ token, balance: childBalances[option]![slot]! })),
              ]),
            ),
          });
          if (plan.tx === null) return;
          planned++;
          expect(tradeWalletBatchDepartures({ tx: plan.tx, chainId: CHAIN_ID, account: OWNER, scope })).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
    expect(planned).toBeGreaterThan(100);
  });
});
