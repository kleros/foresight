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

/** A token besides the collateral the source holds, picked by its address. */
export interface HeldToken extends TokenChoice {
  address: Address;
  balance: bigint;
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
  /** Other tokens the source holds, such as Foresight credits; each offered only when it holds some. */
  held?: HeldToken[];
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
  held = [],
  onSubmit,
  isPending,
  maxIsExact,
}: TransferDialogProps) {
  const [selected, setSelected] = useState(COLLATERAL);
  const [input, setInput] = useState("");

  const useNative = selected === NATIVE && native !== undefined;
  const other = held.find((token) => token.balance > 0n && token.address === selected);
  const funds = useFunds(source, collateral.address);

  const tokens = [
    { id: COLLATERAL, symbol: collateral.symbol, decimals: collateral.decimals },
    ...(native ? [{ id: NATIVE, symbol: native.symbol, decimals: native.decimals }] : []),
    ...held
      .filter((token) => token.balance > 0n)
      .map((token) => ({ id: token.address, symbol: token.symbol, decimals: token.decimals })),
  ];
  // a picked token whose balance re-reads as zero leaves the list, and nothing is sent in its place
  const isPickOffered = tokens.some((token) => token.id === selected);
  const stale = isPickOffered ? undefined : held.find((token) => token.address === selected);

  const chosen = useNative && native ? native : (other ?? stale ?? collateral);
  const available = !isPickOffered
    ? stale?.balance
    : useNative
      ? funds.data?.native
      : other
        ? other.balance
        : (funds.data?.token ?? undefined);

  const amount = parseAmount(input, chosen.decimals);
  const exceedsAvailable = amount !== null && available !== undefined && amount > available;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (amount === null || exceedsAvailable || !isPickOffered) return;

    onSubmit({ token: useNative ? "native" : (other?.address ?? collateral.address), amount });
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} hint={hint}>
      <Form className="flex flex-col items-center gap-4" onSubmit={submit}>
        <TokenAmountField
          value={input}
          onChange={setInput}
          tokens={stale ? [...tokens, { id: stale.address, symbol: stale.symbol, decimals: stale.decimals }] : tokens}
          selected={selected}
          onSelectToken={setSelected}
          available={available}
          decimals={chosen.decimals}
          error={
            exceedsAvailable ? overCap("Not enough balance.", available, chosen.decimals, chosen.symbol) : undefined
          }
          isLoadingBalance={isPickOffered && !other && funds.isPending}
          isReadOnly={isPending}
          maxIsExact={maxIsExact}
        />

        <Button
          type="submit"
          text={actionText}
          isLoading={isPending}
          isDisabled={amount === null || exceedsAvailable || isPending || !source || !isPickOffered}
        />
      </Form>
    </Dialog>
  );
}
