import { gnosis, mainnet, type AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mock, type MockParameters } from "@wagmi/core";
import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { cookieStorage, createStorage } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { env } from "@/config/env";
import { transports } from "@/config/rpc";

/** Networks the user can select in the wallet modal: Gnosis only. */
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [gnosis];

export const defaultNetwork = gnosis;

if (defaultNetwork.id !== DEFAULT_CHAIN_ID) {
  throw new Error(`Chain config drift: AppKit default network is ${defaultNetwork.id}, expected ${DEFAULT_CHAIN_ID}`);
}

/**
 * The adapter additionally carries mainnet so ENS name/avatar reads (chainId 1)
 * resolve, even though users only transact on Gnosis.
 */
const adapterNetworks: [AppKitNetwork, ...AppKitNetwork[]] = [gnosis, mainnet];

export const wagmiAdapter = new WagmiAdapter({
  networks: adapterNetworks,
  projectId: env.REOWN_PROJECT_ID,
  transports,
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  batch: true,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

/**
 * A wagmi adapter backed by a mock connector, used to drive the app as an
 * arbitrary account, Playwright fixtures and hand debugging alike. Registered
 * at runtime via `window._setupMockAccount`, see `Web3Providers`.
 */
export const createMockAdapter = (addressOrPrivateKey: Address | Hex, features?: MockParameters["features"]) => {
  const address = isAddress(addressOrPrivateKey) ? addressOrPrivateKey : privateKeyToAddress(addressOrPrivateKey);

  return new WagmiAdapter({
    connectors: [mock({ accounts: [address], features })],
    networks,
    projectId: env.REOWN_PROJECT_ID,
    transports,
  });
};
