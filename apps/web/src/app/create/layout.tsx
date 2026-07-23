import type { ReactNode } from "react";

import { Shell } from "@/components/layout/Shell";
import Web3Providers from "@/components/providers/Web3Providers";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

export default function CreateLayout({ children }: { children: ReactNode }) {
  return (
    <Web3Providers>
      <Shell walletSlot={<ConnectWallet />}>{children}</Shell>
    </Web3Providers>
  );
}
