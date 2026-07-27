import { mergeTests } from "@playwright/test";

import { test as atlasTest } from "./atlas";
import { test as timeTest } from "./time";
import { test as walletTest } from "./wallet";

export * from "@playwright/test";
export { TimeFixture } from "./time";
export { WalletFixture } from "./wallet";
export type { HardhatClient } from "./hardhat";

/**
 * Import `test` from here, not from `@playwright/test`, to get the fixtures.
 * timeTest already extends the hardhat test, so `hardhat` comes along with it.
 */
export const test = mergeTests(walletTest, atlasTest, timeTest);
