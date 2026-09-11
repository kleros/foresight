"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";

import { wrapWithToast } from "@/utils/wrapWithToast";

import { depositNativeTx, depositTx } from "@/lib/trade-executor/funding";
import type { Asset } from "@/lib/trade-executor/types";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { fundsKeyPrefix } from "./getFunds";

export interface DepositArgs {
  executor: Address;
  asset: Asset;
  /** Set to convert a native deposit into sDAI on the way in. */
  sDaiAdapter?: Address;
}

export function useDepositToExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: DepositArgs) => {
      const tx =
        args.sDaiAdapter && args.asset.token === "native"
          ? depositNativeTx({ executor: args.executor, sDaiAdapter: args.sDaiAdapter, amount: args.asset.amount })
          : depositTx(args);

      return wrapWithToast(wagmiConfig, () =>
        sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, value: tx.value, chainId: DEFAULT_CHAIN_ID }),
      );
    },
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    },
  });
}
