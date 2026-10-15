import { useState, type FormEvent } from "react";

import { Button, Form } from "@kleros/ui-components-library";
import type { Address } from "viem";

import { Dialog } from "@/components/ui/Dialog";

import { parseAmount } from "@/utils/amount";

import type { Asset } from "@/lib/trade-executor/types";

import { overCap } from "./AmountDialog";
import { TokenAmountField } from "./TokenAmountField";
import { useFunds } from "../../api/getFunds";

export interface TokenChoice {
  decimals: number;
  symbol: string;
}

/** The token ids the picker addresses; the native one is not an address. */
const NATIVE = "native";
const COLLATERAL = "collateral";

interface TransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  actionText: string;
  /** Whose balance bounds the amount: the account on a deposit, the wallet on a withdrawal. */
  source: Address | undefined;
  collateral: TokenChoice & { address: Address };
  /** Offered only where the native currency can reach the collateral. */
  native?: TokenChoice;
  onSubmit: (asset: Asset) => void;
  isPending: boolean;
  /** Max takes the whole balance rather than the shown amount. */
  maxIsExact?: boolean;
}

export function TransferDialog({
  isOpen,
  onClose,
  title,
  hint,
  actionText,
  source,
  collateral,
  native,
  onSubmit,
  isPending,
  maxIsExact,
}: TransferDialogProps) {
  const [selected, setSelected] = useState(COLLATERAL);
  const [input, setInput] = useState("");

  const useNative = selected === NATIVE && native !== undefined;
  const funds = useFunds(source, collateral.address);
  const chosen = useNative && native ? native : collateral;
  const available = useNative ? funds.data?.native : (funds.data?.token ?? undefined);

  const amount = parseAmount(input, chosen.decimals);
  const exceedsAvailable = amount !== null && available !== undefined && amount > available;

  const tokens = [
    { id: COLLATERAL, symbol: collateral.symbol, decimals: collateral.decimals },
    ...(native ? [{ id: NATIVE, symbol: native.symbol, decimals: native.decimals }] : []),
  ];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (amount === null || exceedsAvailable) return;

    onSubmit({ token: useNative ? "native" : collateral.address, amount });
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} hint={hint}>
      <Form className="flex flex-col items-center gap-4" onSubmit={submit}>
        <TokenAmountField
          value={input}
          onChange={setInput}
          tokens={tokens}
          selected={selected}
          onSelectToken={setSelected}
          available={available}
          decimals={chosen.decimals}
          error={
            exceedsAvailable ? overCap("Not enough balance.", available, chosen.decimals, chosen.symbol) : undefined
          }
          isLoadingBalance={funds.isPending}
          isReadOnly={isPending}
          maxIsExact={maxIsExact}
        />

        <Button
          type="submit"
          text={actionText}
          isLoading={isPending}
          isDisabled={amount === null || exceedsAvailable || isPending || !source}
        />
      </Form>
    </Dialog>
  );
}
