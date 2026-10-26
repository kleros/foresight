"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendTransaction } from "@wagmi/core";
import type { Address } from "viem";

import { errorToast } from "@/utils/toast";
import { FEE_ONLY_OUT_OF_FUNDS_COPY } from "@/utils/txErrorText";
import { wrapWithToast } from "@/utils/wrapWithToast";

import { withdrawTx } from "@/lib/trade-executor/funding";
import { PreflightError } from "@/lib/trade-executor/preflightError";
import type { Asset } from "@/lib/trade-executor/types";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { fundsKeyPrefix } from "./getFunds";

export interface WithdrawArgs {
  executor: Address;
  recipient: Address;
  assets: Asset[];
}

export function useWithdrawFromExecutor(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: WithdrawArgs) => {
      const tx = withdrawTx(args);

      return wrapWithToast(
        wagmiConfig,
        () => sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, chainId: DEFAULT_CHAIN_ID }),
        FEE_ONLY_OUT_OF_FUNDS_COPY,
      );
    },
    // wrapWithToast reports everything from the send on
    onError: (error) => {
      if (error instanceof PreflightError) errorToast(error.message);
    },
    onSuccess: () => {
      onSuccess?.();
      void queryClient.invalidateQueries({ queryKey: fundsKeyPrefix });
    },
  });
}
