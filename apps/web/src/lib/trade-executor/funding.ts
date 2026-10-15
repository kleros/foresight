import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { sDaiAdapterAbi } from "@/config/contracts";

import { batchValueExecuteTx } from "./executor";
import { PreflightError } from "./preflightError";
import type { Asset } from "./types";

/** Pays xDAI to the adapter, which mints the sDAI it is worth straight to the executor. */
export function depositNativeTx(args: { executor: Address; sDaiAdapter: Address; amount: bigint }): FlowTx {
  return {
    to: args.sDaiAdapter,
    value: args.amount,
    data: encodeFunctionData({ abi: sDaiAdapterAbi, functionName: "depositXDAI", args: [args.executor] }),
  };
}

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
    throw new PreflightError("Nothing to withdraw.");
  }

  return batchValueExecuteTx(
    args.executor,
    args.assets.map((asset) =>
      asset.token === "native"
        ? { to: args.recipient, value: asset.amount, data: "0x" as Hex }
        : {
            to: asset.token,
            value: 0n,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [args.recipient, asset.amount] }),
          },
    ),
  );
}
