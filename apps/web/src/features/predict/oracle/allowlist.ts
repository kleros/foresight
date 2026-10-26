import type { Address, Hex } from "viem";

/** Who may receive an approval inside a predict batch. */
export type Spender = "gnosisRouter" | "swaprRouter";

export interface PredictAllowList {
  tradeExecutorFactory: Address;
  sDaiAdapter: Address;
  gnosisRouter: Address;
  /** Swapr's Algebra router, the target Seer's Lens returns for every swap, and the one the credits manager whitelists. */
  swaprRouter: Address;
  /** Foresight credits, their manager, and the WXDAI the manager's swap pays out. */
  credits: Address;
  creditsManager: Address;
  wxdai: Address;
  /** Signed by the owner. A token target means any of the session's tokens. */
  topLevel: {
    target: "tradeExecutorFactory" | "sDaiAdapter" | "collateral" | "credits" | "ownExecutor";
    selector: Hex;
    name: string;
  }[];
  /** Run by the owner's executor inside `batchExecute` or `batchValueExecute`. */
  inner: {
    target: "sessionToken" | "gnosisRouter" | "swaprRouter" | "creditsManager" | "wxdai";
    selector: Hex;
    name: string;
    spender?: Spender[];
    /** The one call that may carry native value: exactly the WXDAI unwrapped just before it. */
    value?: true;
  }[];
}

export const PREDICT_ALLOW_LIST: Record<number, PredictAllowList> = {
  100: {
    tradeExecutorFactory: "0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C",
    sDaiAdapter: "0xD499b51fcFc66bd31248ef4b28d656d67E591A94",
    gnosisRouter: "0xeC9048b59b3467415b1a38F63416407eA0c70fB8",
    swaprRouter: "0xfFB643E73f280B97809A8b41f7232AB401a04ee1",
    credits: "0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9",
    creditsManager: "0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61",
    wxdai: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
    topLevel: [
      { target: "tradeExecutorFactory", selector: "0xf0791d5c", name: "createExecutor()" },
      { target: "collateral", selector: "0xa9059cbb", name: "transfer(address,uint256)" },
      { target: "credits", selector: "0xa9059cbb", name: "transfer(address,uint256)" },
      { target: "sDaiAdapter", selector: "0xf716a92b", name: "depositXDAI(address)" },
      { target: "ownExecutor", selector: "0xb1bdad27", name: "batchExecute((address,bytes)[])" },
      { target: "ownExecutor", selector: "0xfc792715", name: "batchValueExecute((address,uint256,bytes)[])" },
    ],
    inner: [
      {
        target: "sessionToken",
        selector: "0x095ea7b3",
        name: "approve(address,uint256)",
        spender: ["gnosisRouter", "swaprRouter"],
      },
      { target: "gnosisRouter", selector: "0xd5f82280", name: "splitPosition(address,address,uint256)" },
      { target: "gnosisRouter", selector: "0x7abef8d1", name: "mergePositions(address,address,uint256)" },
      {
        target: "swaprRouter",
        selector: "0xbc651188",
        name: "exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))",
      },
      { target: "creditsManager", selector: "0x70ec9d08", name: "execute(address,bytes,uint256,address)" },
      { target: "wxdai", selector: "0x2e1a7d4d", name: "withdraw(uint256)" },
      { target: "gnosisRouter", selector: "0x50d9991c", name: "splitFromBase(address)", value: true },
    ],
  },
};
