"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";

import { wrapWithToast } from "@/utils/wrapWithToast";

import { splitTx } from "@/lib/trade-executor/positions";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { gnosisRouterAddress } from "@/config/contracts";

import { fundsKeyPrefix } from "./getFunds";

export interface SplitArgs {
  executor: Address;
  collateral: Address;
  parentMarket: Address;
  amount: bigint;
}

export function useSplitFromExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const router = gnosisRouterAddress(DEFAULT_CHAIN_ID);

  return useMutation({
    mutationFn: (args: SplitArgs) => {
      if (!router) throw new Error("There is no Seer router on this network.");
      const tx = splitTx({ ...args, router });

      return wrapWithToast(wagmiConfig, () =>
        sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, chainId: DEFAULT_CHAIN_ID }),
      );
    },
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    },
  });
}
