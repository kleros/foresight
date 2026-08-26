import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { tradeExecutorAbi } from "@/config/contracts";

import type { Asset } from "./types";

export function depositTx(args: { executor: Address; asset: Asset }): FlowTx {
  const { executor, asset } = args;

  if (asset.token === "native") {
    return { to: executor, value: asset.amount };
  }

  return {
    to: asset.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [executor, asset.amount] }),
  };
}

export function withdrawTx(args: { executor: Address; recipient: Address; assets: Asset[] }): FlowTx {
  if (args.assets.length === 0) {
    throw new Error("Nothing to withdraw.");
  }

  const calls = args.assets.map((asset) =>
    asset.token === "native"
      ? { to: args.recipient, value: asset.amount, data: "0x" as Hex }
      : {
          to: asset.token,
          value: 0n,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [args.recipient, asset.amount] }),
        },
  );

  return {
    to: args.executor,
    data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchValueExecute", args: [calls] }),
  };
}
