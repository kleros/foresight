"use client";

import { useEffect, type ReactNode } from "react";

import { AtlasProvider, SignupProduct } from "@kleros/kleros-app";
import { WagmiProvider } from "wagmi";

import { getAppKit } from "@/lib/web3/appkit";
import { installMockWallet } from "@/lib/web3/mock-wallet";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { env } from "@/config/env";

export default function Web3Providers({ children }: { children: ReactNode }) {
  getAppKit();

  useEffect(installMockWallet, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <AtlasProvider config={{ uri: env.ATLAS_URI, signupProduct: SignupProduct.Foresight, wagmiConfig }}>
        {children}
      </AtlasProvider>
    </WagmiProvider>
  );
}
