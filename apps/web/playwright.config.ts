import { defineConfig, devices } from "@playwright/test";

/** Default port of @foresight/mock-atlas (packages/mock-atlas). */
const MOCK_ATLAS_URL = "http://127.0.0.1:4747";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
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
      command: "yarn workspace @foresight/mock-atlas start",
      url: `${MOCK_ATLAS_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "yarn dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_ATLAS_URI: MOCK_ATLAS_URL },
    },
  ],
});
