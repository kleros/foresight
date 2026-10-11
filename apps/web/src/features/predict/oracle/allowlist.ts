import type { Address, Hex } from "viem";

/** Who may receive an approval inside a predict batch. */
export type Spender = "gnosisRouter" | "swaprRouter";

export interface PredictAllowList {
  tradeExecutorFactory: Address;
  sDaiAdapter: Address;
  gnosisRouter: Address;
  /** Swapr's Algebra router, the target Seer's Lens returns for every swap. */
  swaprRouter: Address;
  /** Signed by the owner. A token target means any of the session's tokens. */
  topLevel: {
    target: "tradeExecutorFactory" | "sDaiAdapter" | "collateral" | "ownExecutor";
    selector: Hex;
    name: string;
  }[];
  /** Run by the owner's executor inside `batchExecute`. */
  inner: {
    target: "sessionToken" | "gnosisRouter" | "swaprRouter";
    selector: Hex;
    name: string;
    spender?: Spender[];
  }[];
}

export const PREDICT_ALLOW_LIST: Record<number, PredictAllowList> = {
  100: {
    tradeExecutorFactory: "0x28e3afBdF711755c4400e3d7F74Df5d3cc9C369C",
    sDaiAdapter: "0xD499b51fcFc66bd31248ef4b28d656d67E591A94",
    gnosisRouter: "0xeC9048b59b3467415b1a38F63416407eA0c70fB8",
    swaprRouter: "0xfFB643E73f280B97809A8b41f7232AB401a04ee1",
    topLevel: [
      { target: "tradeExecutorFactory", selector: "0xf0791d5c", name: "createExecutor()" },
      { target: "collateral", selector: "0xa9059cbb", name: "transfer(address,uint256)" },
      { target: "sDaiAdapter", selector: "0xf716a92b", name: "depositXDAI(address)" },
      { target: "ownExecutor", selector: "0xb1bdad27", name: "batchExecute((address,bytes)[])" },
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
    ],
  },
};
