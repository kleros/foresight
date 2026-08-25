import { gnosis, hardhat, mainnet, type AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage } from "wagmi";

import { DEFAULT_CHAIN_ID, isLocalChainEnabled } from "@/config/chains";
import { env } from "@/config/env";
import { transports } from "@/config/rpc";

/**
 * Networks the user can select in the wallet modal. Development additionally
 * offers the local Hardhat node.
 */
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = isLocalChainEnabled ? [hardhat, gnosis] : [gnosis];

export const defaultNetwork = isLocalChainEnabled ? hardhat : gnosis;

if (defaultNetwork.id !== DEFAULT_CHAIN_ID) {
  throw new Error(`Chain config drift: AppKit default network is ${defaultNetwork.id}, expected ${DEFAULT_CHAIN_ID}`);
}

/**
 * The adapter additionally carries mainnet so ENS name/avatar reads (chainId 1)
 * resolve, even though users only transact on the networks above.
 */
const adapterNetworks: [AppKitNetwork, ...AppKitNetwork[]] = [...networks, mainnet];

// Signing through the mock connector goes to the network's default RPC, which AppKit
// otherwise points at its own Blockchain API instead of the configured transport.
export const customRpcUrls = env.GNOSIS_RPC
  ? { [`eip155:${gnosis.id}` as const]: [{ url: env.GNOSIS_RPC }] }
  : undefined;

export const wagmiAdapter = new WagmiAdapter({
  networks: adapterNetworks,
  projectId: env.REOWN_PROJECT_ID,
  transports,
  customRpcUrls,
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  batch: { multicall: true },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
