import { useState, type FormEvent } from "react";

import { Button, Form } from "@kleros/ui-components-library";

import { Dialog } from "@/components/ui/Dialog";

import { parseAmount } from "@/utils/amount";

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
  symbol: string;
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
          error={exceedsAvailable ? "Not enough balance." : undefined}
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
