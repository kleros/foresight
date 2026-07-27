import type { Hex } from "viem";

import type { MockAccountName } from "@/lib/web3/mock-account";

/**
 * Private keys for the named accounts in `MOCK_ACCOUNTS`, for tests that need
 * to sign or send directly against the hardhat node.
 *
 * ⚠️ Hardhat test keys, publicly known, never use these outside a local chain.
 */
export const ACCOUNT_PKEYS = {
  // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  alice: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  bob: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const satisfies Record<MockAccountName, Hex>;

export type AccountKey = MockAccountName;
