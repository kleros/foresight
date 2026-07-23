"use client";

import React from "react";

import { Button } from "@kleros/ui-components-library";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

import AccountDisplay from "./AccountDisplay";

export const SwitchChainButton: React.FC<{ className?: string }> = ({ className }) => {
  const { switchChain, isPending } = useSwitchChain();

  return (
    <Button
      small
      text={`Switch to ${DEFAULT_CHAIN.name}`}
      className={className}
      isLoading={isPending}
      isDisabled={isPending}
      onPress={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
    />
  );
};

const ConnectButton: React.FC<{ text?: string; className?: string }> = ({ text, className }) => {
  const { open } = useAppKit();
  const { open: isOpen } = useAppKitState();

  return (
    <Button
      small
      className={className}
      isDisabled={isOpen}
      text={text ?? "Connect"}
      onPress={() => open({ view: "Connect" })}
    />
  );
};

export const ConnectWallet: React.FC<{ text?: string; className?: string }> = ({ text, className }) => {
  const { isConnected, chainId } = useAccount();

  if (isConnected) {
    if (chainId !== DEFAULT_CHAIN_ID) return <SwitchChainButton className={className} />;
    return <AccountDisplay />;
  }

  return <ConnectButton text={text} className={className} />;
};
