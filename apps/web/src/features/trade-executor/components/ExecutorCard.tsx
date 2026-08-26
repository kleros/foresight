"use client";

import Link from "next/link";
import React from "react";

import { describeTxError } from "@foresight/tx-orchestrator";
import { AlertMessage, Button, Copiable } from "@kleros/ui-components-library";
import clsx from "clsx";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import Loader from "@/components/ui/Loader";

import { formatAmount } from "@/utils/amount";
import { successToast } from "@/utils/toast";

import { DEFAULT_CHAIN } from "@/config/chains";

import { useCreateExecutor } from "../api/createExecutor";
import { useExecutor } from "../api/getExecutor";
import { useFunds } from "../api/getFunds";

function AddressRow({ address }: { address: Address }) {
  const { chain } = useAccount();
  const explorer = chain?.blockExplorers?.default.url;

  const text = (
    <span className="text-klerosUIComponentsPrimaryText min-w-0 font-mono text-sm wrap-break-word">{address}</span>
  );

  return (
    <Copiable copiableContent={address} tooltipProps={{ small: true }}>
      {explorer ? (
        <Link
          className="hover:underline"
          href={`${explorer}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text}
        </Link>
      ) : (
        text
      )}
    </Copiable>
  );
}

const ExecutorCard: React.FC = () => {
  const executor = useExecutor();
  const create = useCreateExecutor(() => successToast("Executor created."));

  const deployed = executor.data?.deployed ?? null;
  const funds = useFunds(deployed ?? undefined, undefined);
  const native = DEFAULT_CHAIN.nativeCurrency;

  return (
    <div
      className={clsx(
        "flex flex-col gap-4 px-6 py-6",
        "border-klerosUIComponentsStroke border",
        "shadow-default rounded-base bg-klerosUIComponentsWhiteBackground",
      )}
    >
      <h2 className="text-klerosUIComponentsPrimaryText text-lg font-semibold">Your executor</h2>

      {executor.isPending ? <Loader className="size-6 self-center" /> : null}

      {executor.isError ? (
        <AlertMessage
          variant="error"
          title="Could not load"
          msg="Your executor could not be read from the chain. Try again in a moment."
        />
      ) : null}

      {executor.data ? (
        deployed ? (
          <>
            <AddressRow address={deployed} />
            {funds.data ? (
              <p className="text-klerosUIComponentsSecondaryText text-sm">
                Native balance: {formatAmount(funds.data.native, native.decimals)} {native.symbol}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-klerosUIComponentsSecondaryText text-sm">
              You have no executor yet. It will deploy to this address:
            </p>
            <AddressRow address={executor.data.predicted} />
            <Button
              className="self-start"
              text="Create executor"
              onPress={() => create.mutate()}
              isLoading={create.isPending}
              isDisabled={create.isPending}
            />
          </>
        )
      ) : null}

      {create.isError ? (
        <AlertMessage variant="error" title="Creation failed" msg={describeTxError(create.error)} />
      ) : null}
    </div>
  );
};

export default ExecutorCard;
