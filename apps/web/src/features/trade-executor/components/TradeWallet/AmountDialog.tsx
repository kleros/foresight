import { useState, type FormEvent } from "react";

import { Button, Form } from "@kleros/ui-components-library";

import { Dialog } from "@/components/ui/Dialog";

import { OWNED_DECIMALS, ownedAmount, parseAmount } from "@/utils/amount";

import { AmountField } from "./AmountField";

interface AmountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  actionText: string;
  available: bigint | undefined;
  isLoadingBalance: boolean;
  decimals: number;
  /** Left out for an amount that is not of one token. */
  symbol?: string;
  /** What `available` counts, as in "Balance: 5 sDAI". */
  availableLabel?: string;
  /** Said when the amount is over `available`. */
  overText?: string;
  onSubmit: (amount: bigint) => void;
  isPending: boolean;
}

/** One amount of one token, for the actions that convert between collateral and outcome tokens. */
export function AmountDialog({
  isOpen,
  onClose,
  title,
  hint,
  actionText,
  available,
  isLoadingBalance,
  decimals,
  symbol,
  availableLabel,
  overText = "Not enough balance.",
  onSubmit,
  isPending,
}: AmountDialogProps) {
  const [input, setInput] = useState("");

  const amount = parseAmount(input, decimals);
  const exceedsAvailable = amount !== null && available !== undefined && amount > available;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (amount === null || exceedsAvailable) return;

    onSubmit(amount);
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} hint={hint}>
      <Form className="flex flex-col items-center gap-4" onSubmit={submit}>
        <AmountField
          value={input}
          onChange={setInput}
          available={available}
          decimals={decimals}
          symbol={symbol}
          availableLabel={availableLabel}
          error={exceedsAvailable ? overCap(overText, available, decimals, symbol) : undefined}
          isLoadingBalance={isLoadingBalance}
          isReadOnly={isPending}
        />

        <Button
          type="submit"
          text={actionText}
          isLoading={isPending}
          isDisabled={amount === null || exceedsAvailable || isPending}
        />
      </Form>
    </Dialog>
  );
}

/** The cap is named only when it shows as more than 0. */
export function overCap(overText: string, available: bigint, decimals: number, symbol?: string): string {
  if (available < 10n ** BigInt(Math.max(decimals - OWNED_DECIMALS, 0))) return overText;
  return `${overText} Max ${ownedAmount(available, decimals)}${symbol ? ` ${symbol}` : ""}.`;
}
