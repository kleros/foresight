"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction, waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Address } from "viem";

import { depositTx } from "@/lib/trade-executor/funding";
import type { Asset } from "@/lib/trade-executor/types";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { fundsKeyPrefix } from "./getFunds";

export interface DepositArgs {
  executor: Address;
  asset: Asset;
}

async function depositToExecutor(config: Config, args: DepositArgs): Promise<void> {
  const tx = depositTx(args);

  const hash = await sendTransaction(config, { to: tx.to, data: tx.data, value: tx.value, chainId: DEFAULT_CHAIN_ID });
  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status !== "success") throw new Error("The deposit reverted.");
}

export function useDepositToExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: DepositArgs) => depositToExecutor(wagmiConfig, args),
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    },
  });
}
