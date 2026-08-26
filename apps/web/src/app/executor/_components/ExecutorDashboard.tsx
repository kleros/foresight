"use client";

import React from "react";

import { useExecutor } from "@/features/trade-executor/api/getExecutor";
import DepositCard from "@/features/trade-executor/components/DepositCard";
import ExecutorCard from "@/features/trade-executor/components/ExecutorCard";
import WithdrawCard from "@/features/trade-executor/components/WithdrawCard";

import EnsureChain from "@/components/wallet/EnsureChain";

export function ExecutorDashboard() {
  const executor = useExecutor();
  const deployed = executor.data?.deployed ?? null;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-klerosUIComponentsPrimaryText text-2xl font-semibold">Trade executor</h1>
        <p className="text-klerosUIComponentsSecondaryText text-sm">
          Create the wallet that will hold your collateral and place your trades, and move funds in and out of it.
        </p>
      </header>

      <EnsureChain className="self-center">
        <ExecutorCard />
        {deployed ? (
          <div className="flex flex-wrap gap-6">
            <DepositCard executor={deployed} />
            <WithdrawCard executor={deployed} />
          </div>
        ) : null}
      </EnsureChain>
    </section>
  );
}
