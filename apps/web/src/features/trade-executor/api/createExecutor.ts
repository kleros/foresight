"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction, waitForTransactionReceipt, type Config } from "@wagmi/core";
import type { Address } from "viem";

import { createExecutorTx } from "@/lib/trade-executor/executor";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { executorKeyPrefix } from "./getExecutor";

async function createExecutor(config: Config, factory: Address) {
  const tx = createExecutorTx(factory);

  const hash = await sendTransaction(config, { to: tx.to, data: tx.data, chainId: DEFAULT_CHAIN_ID });
  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status !== "success") throw new Error("The deployment reverted.");
}

export function useCreateExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const factory = tradeExecutorFactoryAddress(DEFAULT_CHAIN_ID);

  return useMutation({
    mutationFn: () => {
      if (!factory) throw new Error("There is no executor factory on this network.");
      return createExecutor(wagmiConfig, factory);
    },
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: executorKeyPrefix });
    },
  });
}
