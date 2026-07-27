import type { Page } from "@playwright/test";
import { test as base } from "@playwright/test";
import type { MockParameters } from "@wagmi/core";
import type { Address } from "viem";

import { resolveMockAccount, type MockAccountRef } from "@/lib/web3/mock-account";

export class WalletFixture {
  address?: Address;
  private page: Page;

  constructor({ page }: { page: Page }) {
    this.page = page;
  }

  /**
   * Connect to the app as `account`("alice", "bob", or any address). Call after
   * `page.goto`.
   *
   * @dev Signing and sending are forwarded to the connected chain's default RPC,
   * so both need a chain that has the account unlocked (hardhat), not a public one.
   */
  async connect(account: MockAccountRef, features?: MockParameters["features"]) {
    const address = resolveMockAccount(account);

    if (!address) throw new Error(`Unknown mock account "${account}" - pass a name or an address`);

    this.address = address;

    await this.page.waitForFunction(() => "__connectMockAccount" in window);
    await this.page.evaluate(([account, features]) => window.__connectMockAccount!(account, features), [
      account,
      features,
    ] as const);
  }
}

export const test = base.extend<{ wallet: WalletFixture }>({
  wallet: async ({ page }, use) => {
    await use(new WalletFixture({ page }));
  },
});
