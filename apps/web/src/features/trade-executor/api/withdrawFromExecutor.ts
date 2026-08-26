"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction, waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Address } from "viem";

import { withdrawTx } from "@/lib/trade-executor/funding";
import type { Asset } from "@/lib/trade-executor/types";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { fundsKeyPrefix } from "./getFunds";

export interface WithdrawArgs {
  executor: Address;
  recipient: Address;
  assets: Asset[];
}

async function withdrawFromExecutor(config: Config, args: WithdrawArgs): Promise<void> {
  const tx = withdrawTx(args);

  const hash = await sendTransaction(config, { to: tx.to, data: tx.data, chainId: DEFAULT_CHAIN_ID });
  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status !== "success") throw new Error("The withdrawal reverted.");
}

export function useWithdrawFromExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: WithdrawArgs) => withdrawFromExecutor(wagmiConfig, args),
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    },
  });
}
