import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { tradeExecutorAbi } from "@/config/contracts";

import { CHAIN_ID, childMarket, OWNER, plannerInput, SCOPE, TWO_WINNERS, WAD } from "./support/session";
import type { ChildResolution } from "../../api/getSessionResolution";
import { ownerPayBatchDepartures, planTradeWalletRedeemToOwner, withOwnerTransfer } from "../payOwner";
import { planTradeWalletRedeem } from "../plan";

const ONCHAIN_OWNER = getAddress("0x0a11000000000000000000000000000000000000");

/** A child resolved INVALID: its INVALID token pays in full, UP and DOWN pay nothing. */
const invalidChild: ChildResolution = {
  deployed: true,
  market: childMarket(0),
  resolved: true,
  invalid: true,
  finalValue: 0,
  payoutNumerators: [0n, 0n, WAD],
  payoutDenominator: WAD,
};
const RESOLUTION = { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 0: invalidChild } };

function transferAmount(data: `0x${string}`) {
  const outer = decodeFunctionData({ abi: tradeExecutorAbi, data });
  if (outer.functionName !== "batchExecute") throw new Error(outer.functionName);
  return decodeFunctionData({ abi: erc20Abi, data: outer.args[0].at(-1)!.data }).args[1];
}

describe("the owner transfer for a child resolved INVALID", () => {
  it("counts the child's INVALID tokens at their numerator, and the guard passes the ticked batch", () => {
    const plan = planTradeWalletRedeemToOwner(plannerInput({ resolution: RESOLUTION }), ONCHAIN_OWNER);
    const withoutInvalid = planTradeWalletRedeemToOwner(
      plannerInput({
        resolution: RESOLUTION,
        childBalances: [
          [4n * WAD - 1_234_567_891n, 4n * WAD, 0n],
          [3n * WAD, 3n * WAD - 987_654_321n, 3n * WAD],
          [2n * WAD, 2n * WAD, 2n * WAD],
        ],
      }),
      ONCHAIN_OWNER,
    );

    // 4 INVALID tokens pay 4 parent outcome tokens, which pay at the parent outcome's 1/2
    expect(plan.payout - withoutInvalid.payout).toBe(2n * WAD);
    expect(transferAmount(plan.tx!.data!)).toBe(plan.payout);
    expect(
      ownerPayBatchDepartures({
        tx: plan.tx!,
        chainId: CHAIN_ID,
        account: OWNER,
        scope: SCOPE,
        payout: { owner: ONCHAIN_OWNER, resolution: RESOLUTION },
      }),
    ).toEqual([]);
  });

  it("refuses the transfer that leaves the INVALID tokens' payout out", () => {
    const unticked = planTradeWalletRedeem(plannerInput({ resolution: RESOLUTION }));
    const short = withOwnerTransfer(
      { ...unticked, payout: unticked.payout - 2n * WAD },
      SCOPE.collateral,
      ONCHAIN_OWNER,
    );

    expect(
      ownerPayBatchDepartures({
        tx: short.tx!,
        chainId: CHAIN_ID,
        account: OWNER,
        scope: SCOPE,
        payout: { owner: ONCHAIN_OWNER, resolution: RESOLUTION },
      }),
    ).toEqual([`transfers ${unticked.payout - 2n * WAD}, not the payout ${unticked.payout}`]);
  });
});
