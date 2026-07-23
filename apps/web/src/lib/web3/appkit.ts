import { createAppKit } from "@reown/appkit/react";

import { env } from "@/config/env";
import { siteConfig } from "@/config/site";

import { defaultNetwork, networks, wagmiAdapter } from "./wagmi";

let instance: ReturnType<typeof createAppKit> | undefined;

export const getAppKit = () =>
  (instance ??= createAppKit({
    adapters: [wagmiAdapter],
    networks,
    defaultNetwork,
    projectId: env.REOWN_PROJECT_ID,
    metadata: {
      name: siteConfig.name,
      description: siteConfig.description,
      url: env.SITE_URL ?? "http://localhost:3000",
      icons: [],
    },
    enableCoinbase: false,
    features: {
      analytics: false,
    },
  }));
