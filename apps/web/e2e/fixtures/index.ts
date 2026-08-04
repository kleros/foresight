import { mergeTests } from "@playwright/test";

import { test as timeTest } from "./time";
import { test as walletTest } from "./wallet";

export * from "@playwright/test";
export { TimeFixture } from "./time";
export { WalletFixture } from "./wallet";
export type { HardhatClient } from "./hardhat";

/**
 * Import `test` from here, not from `@playwright/test`, to get the fixtures.
 * timeTest already extends the hardhat test, so `hardhat` comes along with it.
 *
 * Atlas is served by the @foresight/mock-atlas server (started via playwright's
 * webServer, see playwright.config.ts).
 * The route-based fixture in ./atlas remains as an opt-in backup.
 */
export const test = mergeTests(walletTest, timeTest);
