"use client";

import type { ReactNode } from "react";

import { WagmiProvider } from "wagmi";

import { getAppKit } from "@/lib/web3/appkit";
import { wagmiConfig } from "@/lib/web3/wagmi";

export default function Web3Providers({ children }: { children: ReactNode }) {
  getAppKit();

  // pending mockAdapter injection

  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
