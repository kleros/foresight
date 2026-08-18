import type { ReactNode } from "react";

import { Shell } from "@/components/layout/Shell";
import Web3Providers from "@/components/providers/Web3Providers";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { DevWallet } from "@/components/wallet/DevWallet";

export default function CreateLayout({ children }: { children: ReactNode }) {
  return (
    <Web3Providers>
      <Shell walletSlot={<ConnectWallet />}>{children}</Shell>
      {/* Renders nothing in production. */}
      <DevWallet />
    </Web3Providers>
  );
}
