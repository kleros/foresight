"use client";

import Link from "next/link";
import React from "react";

import { Copiable } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useAccount } from "wagmi";

import { AddressOrName, ChainDisplay, IdenticonOrAvatar } from "@/components/wallet/AccountDisplay";
import { DisconnectWalletButton } from "@/components/wallet/ConnectWallet";
import EnsureChain from "@/components/wallet/EnsureChain";

const AccountPanel: React.FC = () => {
  const { address, chain } = useAccount();

  if (!address) return null;

  return (
    <>
      <IdenticonOrAvatar size={48} />
      <Copiable copiableContent={address} tooltipProps={{ small: true }}>
        <Link
          href={`${chain?.blockExplorers?.default.url}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <AddressOrName
            className={clsx(
              "text-klerosUIComponentsPrimaryText hover:text-klerosUIComponentsPrimaryBlue",
              "cursor-pointer text-base font-semibold hover:underline",
            )}
          />
        </Link>
      </Copiable>
      <ChainDisplay />
      <DisconnectWalletButton className="mt-4" />
    </>
  );
};

const GeneralSettings: React.FC = () => (
  <div className="flex flex-col items-center gap-3 pt-8">
    <EnsureChain>
      <AccountPanel />
    </EnsureChain>
  </div>
);

export default GeneralSettings;
