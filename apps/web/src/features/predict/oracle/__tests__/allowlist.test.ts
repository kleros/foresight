import { erc20Abi, getAbiItem, parseAbi, toFunctionSelector, type Abi } from "viem";
import { describe, expect, it } from "vitest";

import {
  creditsManagerAbi,
  creditsRoute,
  gnosisRouterAbi,
  gnosisRouterAddress,
  sDaiAdapterAbi,
  sDaiDepositRoute,
  swaprRouterAddress,
  tradeExecutorAbi,
  tradeExecutorFactoryAbi,
  tradeExecutorFactoryAddress,
  wxdaiAbi,
} from "@/config/contracts";

import { PREDICT_ALLOW_LIST } from "../allowlist";

const ALGEBRA = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);

/** Each entry's selector, worked out from the ABI the app encodes with. */
const ABIS: Record<string, Abi> = {
  "createExecutor()": tradeExecutorFactoryAbi,
  "transfer(address,uint256)": erc20Abi,
  "approve(address,uint256)": erc20Abi,
  "depositXDAI(address)": sDaiAdapterAbi,
  "batchExecute((address,bytes)[])": tradeExecutorAbi,
  "batchValueExecute((address,uint256,bytes)[])": tradeExecutorAbi,
  "splitPosition(address,address,uint256)": gnosisRouterAbi,
  "mergePositions(address,address,uint256)": gnosisRouterAbi,
  "splitFromBase(address)": gnosisRouterAbi,
  "execute(address,bytes,uint256,address)": creditsManagerAbi,
  "withdraw(uint256)": wxdaiAbi,
  "exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))": ALGEBRA,
};

describe("the predict allow-list on Gnosis", () => {
  const list = PREDICT_ALLOW_LIST[100]!;

  it("names every selector as the app's own ABI encodes it", () => {
    for (const entry of [...list.topLevel, ...list.inner]) {
      const abi = ABIS[entry.name];
      expect(abi, entry.name).toBeDefined();
      const item = getAbiItem({ abi: abi!, name: entry.name.slice(0, entry.name.indexOf("(")) });
      expect(toFunctionSelector(item as never), entry.name).toBe(entry.selector);
    }
  });

  it("lets native value through one call only, the parent split from xDAI", () => {
    expect(list.inner.filter((entry) => entry.value).map((entry) => entry.name)).toEqual(["splitFromBase(address)"]);
  });

  it("names the contracts the app resolves for a credits run", () => {
    const sDai = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    expect(creditsRoute(sDai, 100)).toEqual({
      token: list.credits,
      manager: list.creditsManager,
      wxdai: list.wxdai,
      swaprRouter: list.swaprRouter,
    });
    expect(gnosisRouterAddress(100)).toBe(list.gnosisRouter);
    expect(sDaiDepositRoute(sDai, 100)?.sDaiAdapter).toBe(list.sDaiAdapter);
    expect(swaprRouterAddress(100)).toBe(list.swaprRouter);
    expect(tradeExecutorFactoryAddress(100)).toBe(list.tradeExecutorFactory);
  });
});
