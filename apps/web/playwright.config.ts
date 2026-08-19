import { defineConfig, devices } from "@playwright/test";

import { INDEXER_URL } from "./e2e/fixtures/indexer";
import { MOCK_ATLAS_URL } from "./e2e/utils/ipfs-gateway";
import { LOCAL_RPC_URL } from "./src/config/chains";

export default defineConfig({
  testDir: "./e2e/tests",
  // The indexer is not started here: it is a docker stack, and the deploy tests
  // need it answering before the first one runs.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "yarn workspace @foresight/contracts start",
      url: LOCAL_RPC_URL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "yarn workspace @foresight/mock-atlas start",
      url: `${MOCK_ATLAS_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "yarn dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_ATLAS_URI: MOCK_ATLAS_URL,
        NEXT_PUBLIC_IPFS_GATEWAY: `${MOCK_ATLAS_URL}/ipfs`,
        NEXT_PUBLIC_SUBGRAPH_URL: INDEXER_URL,
      },
    },
  ],
});
