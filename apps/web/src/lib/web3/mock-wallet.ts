import { connect, mock, type MockParameters } from "@wagmi/core";

import { isUndefined } from "@/utils/is-undefined";

import { isMockWalletEnabled, MOCK_ACCOUNTS, resolveMockAccount, type MockAccountRef } from "./mock-account";
import { wagmiConfig } from "./wagmi";

declare global {
  interface Window {
    /** Only present outside production, see `installMockWallet`. */
    __connectMockAccount?: (account: MockAccountRef, features?: MockParameters["features"]) => Promise<void>;
    /** The names `__connectMockAccount` accepts, for discovery from the console. */
    __mockAccounts?: typeof MOCK_ACCOUNTS;
  }
}

/**
 * Connects the app as `account` - a name from {@link MOCK_ACCOUNTS} or any address, without reloading.
 * Call it again to switch accounts.
 */
export const connectMockAccount = async (account: MockAccountRef, features?: MockParameters["features"]) => {
  const address = resolveMockAccount(account);

  if (!address) {
    throw new Error(`Unknown mock account "${account}", use an address or one of: ${Object.keys(MOCK_ACCOUNTS)}`);
  }

  const connector = wagmiConfig._internal.connectors.setup(mock({ accounts: [address], features }));

  wagmiConfig._internal.connectors.setState((connectors) => [...connectors, connector]);

  await connect(wagmiConfig, { connector });
};

/** Publishes the hooks Playwright and hand debugging use. No-op in production. */
export const installMockWallet = () => {
  if (!isMockWalletEnabled || isUndefined(globalThis.window)) return;

  window.__connectMockAccount = connectMockAccount;
  window.__mockAccounts = MOCK_ACCOUNTS;
};
