import type { Address, Hex } from "viem";

/** Who may receive an approval inside a liquidity run. */
export type LiquiditySpender = "gnosisRouter" | "positionManager" | "swaprRouter";

export interface LiquidityAllowList {
  /** Seer's router: splits and merges at the parent and at each branch. */
  gnosisRouter: Address;
  /** Swapr's Algebra NonfungiblePositionManager: creates pools, mints, withdraws and collects positions. */
  positionManager: Address;
  /** The AlgebraFactory `positionManager.factory()` returns; pools are read from it, never called. */
  algebraFactory: Address;
  /** Swapr's Algebra router: only to move an initialized but empty pool to the run's price before its mint. */
  swaprRouter: Address;
  /** Every call a run may send. A token target means the session's collateral or one of its outcome tokens. */
  calls: {
    target: "sessionToken" | "gnosisRouter" | "positionManager" | "swaprRouter";
    selector: Hex;
    name: string;
    spender?: LiquiditySpender[];
    /** The one call that may carry native value: an xDAI split at the parent. */
    value?: true;
  }[];
  /** The only calls a position manager `multicall` may wrap. */
  multicallInner: { selector: Hex; name: string }[];
}

export const LIQUIDITY_ALLOW_LIST: Record<number, LiquidityAllowList> = {
  100: {
    gnosisRouter: "0xeC9048b59b3467415b1a38F63416407eA0c70fB8",
    positionManager: "0x91fD594c46D8B01E62dBDeBed2401dde01817834",
    algebraFactory: "0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766",
    swaprRouter: "0xfFB643E73f280B97809A8b41f7232AB401a04ee1",
    calls: [
      {
        target: "sessionToken",
        selector: "0x095ea7b3",
        name: "approve(address,uint256)",
        spender: ["gnosisRouter", "positionManager", "swaprRouter"],
      },
      { target: "gnosisRouter", selector: "0xd5f82280", name: "splitPosition(address,address,uint256)" },
      { target: "gnosisRouter", selector: "0x50d9991c", name: "splitFromBase(address)", value: true },
      { target: "gnosisRouter", selector: "0x7abef8d1", name: "mergePositions(address,address,uint256)" },
      { target: "positionManager", selector: "0xac9650d8", name: "multicall(bytes[])" },
      {
        target: "swaprRouter",
        selector: "0xbc651188",
        name: "exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))",
      },
    ],
    multicallInner: [
      { selector: "0x51246d6e", name: "createAndInitializePoolIfNecessary(address,address,uint160)" },
      {
        selector: "0x9cc1a283",
        name: "mint((address,address,int24,int24,uint256,uint256,uint256,uint256,address,uint256))",
      },
      { selector: "0x0c49ccbe", name: "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))" },
      { selector: "0xfc6f7865", name: "collect((uint256,address,uint128,uint128))" },
      { selector: "0x42966c68", name: "burn(uint256)" },
    ],
  },
};
