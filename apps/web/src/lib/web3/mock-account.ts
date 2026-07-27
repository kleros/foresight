import { isAddress, type Address } from "viem";

/**
 * The accounts the app can be driven as, for Playwright and hand debugging.
 */

/** Mock wiring is compiled out of production builds entirely. */
export const isMockWalletEnabled = process.env.NODE_ENV !== "production";

/** Hardhat's deterministic accounts. Private keys live in e2e/utils/accounts.ts. */
export const MOCK_ACCOUNTS = {
  alice: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  bob: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
} as const satisfies Record<string, Address>;

export type MockAccountName = keyof typeof MOCK_ACCOUNTS;

/** A known name, or any address you like. */
export type MockAccountRef = MockAccountName | Address;

/** Resolves a name or address to an address, or undefined if it is neither. */
export const resolveMockAccount = (account: MockAccountRef): Address | undefined => {
  if (account in MOCK_ACCOUNTS) return MOCK_ACCOUNTS[account as MockAccountName];

  return isAddress(account) ? account : undefined;
};
