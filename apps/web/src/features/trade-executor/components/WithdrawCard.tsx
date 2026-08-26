"use client";

import React from "react";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import { successToast } from "@/utils/toast";

import TransferCard from "./TransferCard";
import { useWithdrawFromExecutor } from "../api/withdrawFromExecutor";

const WithdrawCard: React.FC<{ executor: Address }> = ({ executor }) => {
  const { address: owner } = useAccount();
  const withdraw = useWithdrawFromExecutor(() => successToast("Withdrawal confirmed."));

  return (
    <TransferCard
      title="Withdraw"
      source={executor}
      actionText="Withdraw"
      onSubmit={(asset) => owner && withdraw.mutate({ executor, recipient: owner, assets: [asset] })}
      isPending={withdraw.isPending}
      error={withdraw.error}
    />
  );
};

export default WithdrawCard;
