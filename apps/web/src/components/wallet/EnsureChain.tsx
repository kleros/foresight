"use client";

import React from "react";

import { useAccount } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { ConnectWallet } from "./ConnectWallet";

const EnsureChain: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const { address, chainId } = useAccount();

  return address && chainId === DEFAULT_CHAIN_ID ? children : <ConnectWallet text="Connect" className={className} />;
};

export default EnsureChain;
