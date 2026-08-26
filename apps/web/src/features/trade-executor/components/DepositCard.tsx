"use client";

import React from "react";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import { successToast } from "@/utils/toast";

import TransferCard from "./TransferCard";
import { useDepositToExecutor } from "../api/depositToExecutor";

const DepositCard: React.FC<{ executor: Address }> = ({ executor }) => {
  const { address: owner } = useAccount();
  const deposit = useDepositToExecutor(() => successToast("Deposit confirmed."));

  return (
    <TransferCard
      title="Deposit"
      source={owner}
      actionText="Deposit"
      onSubmit={(asset) => deposit.mutate({ executor, asset })}
      isPending={deposit.isPending}
      error={deposit.error}
    />
  );
};

export default DepositCard;
