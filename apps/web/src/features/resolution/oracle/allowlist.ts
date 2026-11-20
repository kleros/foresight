import type { Address, Hex } from "viem";

/** Who may receive an approval inside a redeem run. */
export type RedeemSpender = "gnosisRouter" | "conditionalRouter";

export interface RedeemAllowList {
  /** Seer's router: redeems parent outcome tokens to sDAI. */
  gnosisRouter: Address;
  /** Seer's conditional router: redeems a child's UP and DOWN through its parent outcome to sDAI. */
  conditionalRouter: Address;
  /**
   * Every call a run may send. A token target means one of the session's outcome tokens; the trade wallet is a
   * target only of a redeem from the connected account's own trade wallet.
   */
  calls: {
    target: "sessionToken" | "gnosisRouter" | "conditionalRouter" | "tradeWallet";
    selector: Hex;
    name: string;
    spender?: RedeemSpender[];
  }[];
}

export const REDEEM_ALLOW_LIST: Record<number, RedeemAllowList> = {
  100: {
    gnosisRouter: "0xeC9048b59b3467415b1a38F63416407eA0c70fB8",
    conditionalRouter: "0x774284d5cDFeC3A0a0eBc7283aD4d5b33013c29c",
    calls: [
      {
        target: "sessionToken",
        selector: "0x095ea7b3",
        name: "approve(address,uint256)",
        spender: ["gnosisRouter", "conditionalRouter"],
      },
      { target: "tradeWallet", selector: "0xb1bdad27", name: "batchExecute((address,bytes)[])" },
      {
        target: "gnosisRouter",
        selector: "0x865955a0",
        name: "redeemPositions(address,address,uint256[],uint256[])",
      },
      {
        target: "conditionalRouter",
        selector: "0xc3eba97a",
        name: "redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
      },
    ],
  },
};
