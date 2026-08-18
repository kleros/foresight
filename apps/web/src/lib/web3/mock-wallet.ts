import { connect, disconnect, mock, type MockParameters } from "@wagmi/core";

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

const isMock = (connector: { id: string }) => connector.id === "mock";

/**
 * Connects the app as `account` - a name from {@link MOCK_ACCOUNTS} or any address, without reloading.
 * Call it again to switch accounts.
 */
/** Attempts to make a connection stick, and how long each is given to. */
const CONNECT_ATTEMPTS = 4;
const HOLD_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectedAs = (address: string) =>
  wagmiConfig.state.status === "connected" &&
  [...wagmiConfig.state.connections.values()].some((connection) =>
    connection.accounts.some((account) => account.toLowerCase() === address.toLowerCase()),
  );

async function connectOnce(address: string, features?: MockParameters["features"]) {
  for (const stale of wagmiConfig.connectors.filter(isMock)) {
    await disconnect(wagmiConfig, { connector: stale }).catch(() => {});
  }
  wagmiConfig._internal.connectors.setState((connectors) => connectors.filter((existing) => !isMock(existing)));

  const connector = wagmiConfig._internal.connectors.setup(mock({ accounts: [address as `0x${string}`], features }));
  wagmiConfig._internal.connectors.setState((connectors) => [...connectors, connector]);

  await connect(wagmiConfig, { connector });
}

export const connectMockAccount = async (account: MockAccountRef, features?: MockParameters["features"]) => {
  const address = resolveMockAccount(account);

  if (!address) {
    throw new Error(`Unknown mock account "${account}", use an address or one of: ${Object.keys(MOCK_ACCOUNTS)}`);
  }

  // The provider reconnects from storage when it mounts and writes the result
  // when it finishes, which can land either side of this and undo it. Held
  // rather than assumed: the caller is about to act as this account.
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    await connectOnce(address, features);
    await sleep(HOLD_MS);
    if (connectedAs(address)) return;
  }

  throw new Error(`The mock wallet would not stay connected as ${address}.`);
};

/** Publishes the hooks Playwright and hand debugging use. No-op in production. */
export const installMockWallet = () => {
  if (!isMockWalletEnabled || isUndefined(globalThis.window)) return;

  window.__connectMockAccount = connectMockAccount;
  window.__mockAccounts = MOCK_ACCOUNTS;
};
