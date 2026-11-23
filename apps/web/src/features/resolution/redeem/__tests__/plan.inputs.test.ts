import { describe, expect, it } from "vitest";

import { planTradeWalletRedeem } from "../plan";
import { plannerInput, TWO_WINNERS } from "./support/session";

describe("the balances a trade wallet redeem is planned from", () => {
  it("must hold one parent token per outcome, INVALID included", () => {
    const input = plannerInput();
    expect(() => planTradeWalletRedeem({ ...input, parentTokens: input.parentTokens.slice(0, -1) })).toThrow(
      "The parent has 4 outcomes but 3 token balances.",
    );
  });

  it("must hold DOWN, UP and INVALID for each winner's deployed child", () => {
    const input = plannerInput();
    expect(() =>
      planTradeWalletRedeem({ ...input, childTokens: { ...input.childTokens, 1: input.childTokens[1]!.slice(0, 2) } }),
    ).toThrow("Option 1's child needs 3 token balances.");
  });

  it("needs no balances for a losing option's child", () => {
    const input = plannerInput({ resolution: TWO_WINNERS });
    expect(() =>
      planTradeWalletRedeem({ ...input, childTokens: { 0: input.childTokens[0], 1: input.childTokens[1] } }),
    ).not.toThrow();
  });
});
