"use client";

import React, { useState } from "react";

import { describeTxError } from "@foresight/tx-orchestrator";
import { AlertMessage, Button, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";

import { parseTokenAddress } from "@/utils/address";
import { formatAmount, parseAmount } from "@/utils/amount";

import type { Asset } from "@/lib/trade-executor/types";

import { DEFAULT_CHAIN } from "@/config/chains";

import { useFunds } from "../api/getFunds";
import { useTokenMeta } from "../api/getTokenMeta";

interface TransferCardProps {
  title: string;
  /** The account the assets leave, the wallet on a deposit, the executor on a withdrawal. */
  source: Address | undefined;
  actionText: string;
  onSubmit: (asset: Asset) => void;
  isPending: boolean;
  error: unknown;
}

const TransferCard: React.FC<TransferCardProps> = ({ title, source, actionText, onSubmit, isPending, error }) => {
  const [mode, setMode] = useState<"native" | "token">("native");
  const [tokenInput, setTokenInput] = useState("");
  const [amountInput, setAmountInput] = useState("");

  const native = DEFAULT_CHAIN.nativeCurrency;
  const token = mode === "token" ? parseTokenAddress(tokenInput) : null;
  const meta = useTokenMeta(token ?? undefined);
  const funds = useFunds(source, token ?? undefined);

  const decimals = mode === "native" ? native.decimals : meta.data?.decimals;
  const symbol = mode === "native" ? native.symbol : meta.data?.symbol;

  const amount = decimals === undefined ? null : parseAmount(amountInput, decimals);
  const available = mode === "native" ? funds.data?.native : (funds.data?.token ?? undefined);
  const exceedsAvailable = amount !== null && available !== undefined && amount > available;

  const asset: Asset | null =
    amount === null ? null : mode === "native" ? { token: "native", amount } : token && { token, amount };

  return (
    <div
      className={clsx(
        "flex min-w-0 flex-1 basis-72 flex-col gap-4 px-6 py-6",
        "border-klerosUIComponentsStroke border",
        "shadow-default rounded-base bg-klerosUIComponentsWhiteBackground",
      )}
    >
      <h2 className="text-klerosUIComponentsPrimaryText text-lg font-semibold">{title}</h2>

      <div className="flex gap-2">
        <Button
          small
          variant={mode === "native" ? "primary" : "secondary"}
          text={native.symbol}
          onPress={() => setMode("native")}
        />
        <Button
          small
          variant={mode === "token" ? "primary" : "secondary"}
          text="Token"
          onPress={() => setMode("token")}
        />
      </div>

      {mode === "token" ? (
        <TextField
          className="w-full [&_input]:font-mono [&_input]:text-sm"
          label="Token address"
          placeholder="0x…"
          value={tokenInput}
          onChange={setTokenInput}
        />
      ) : null}

      {mode === "token" && meta.isError ? (
        <AlertMessage variant="error" title="Not a token" msg="This address does not answer as a token." />
      ) : null}

      <TextField
        className="w-full [&_input]:text-sm"
        label={symbol ? `Amount (${symbol})` : "Amount"}
        placeholder="0.0"
        value={amountInput}
        onChange={setAmountInput}
      />

      {available !== undefined && decimals !== undefined ? (
        <p className="text-klerosUIComponentsSecondaryText text-sm">
          Available: {formatAmount(available, decimals)} {symbol}
        </p>
      ) : null}

      {exceedsAvailable ? <p className="text-klerosUIComponentsError text-sm">More than is available.</p> : null}

      <Button
        className="self-start"
        text={actionText}
        onPress={() => asset && onSubmit(asset)}
        isLoading={isPending}
        isDisabled={!asset || exceedsAvailable || isPending || !source}
      />

      {error != null ? <AlertMessage variant="error" title={`${title} failed`} msg={describeTxError(error)} /> : null}
    </div>
  );
};

export default TransferCard;
