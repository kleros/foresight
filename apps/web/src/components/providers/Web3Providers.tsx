"use client";

import type { ReactNode } from "react";

import { AtlasProvider, SignupProduct } from "@kleros/kleros-app";
import { WagmiProvider } from "wagmi";

import { getAppKit } from "@/lib/web3/appkit";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { env } from "@/config/env";

export default function Web3Providers({ children }: { children: ReactNode }) {
  getAppKit();

  // pending mockAdapter injection

  return (
    <WagmiProvider config={wagmiConfig}>
      <AtlasProvider config={{ uri: env.ATLAS_URI, signupProduct: SignupProduct.Foresight, wagmiConfig }}>
        {children}
      </AtlasProvider>
    </WagmiProvider>
  );
}
