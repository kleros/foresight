import { test as base } from "@playwright/test";
import { recoverMessageAddress, type Hex } from "viem";

import { MOCK_IPFS_HASH, MOCK_NONCE, MOCK_ROLES } from "../utils/atlas-mocks";
import { createTestJwt } from "../utils/jwt";

// mocking atlas apis
export const test = base.extend<{
  mockAtlas: () => Promise<void>;
}>({
  mockAtlas: [
    async ({ page }, use) => {
      await page.route("*/**/graphql", async (route, request) => {
        const body = request.postDataJSON();
        const operation = body?.operationName;

        // GetNonce
        if (operation === "GetNonce") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                nonce: MOCK_NONCE,
              },
            }),
          });
        }

        // Login
        if (operation === "Login") {
          const signature = body.variables.signature! as Hex;
          const message = body.variables.message! as string;
          const address = await recoverMessageAddress({ message, signature });

          const accessToken = await createTestJwt({
            address,
          });

          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                login: {
                  accessToken,
                },
              },
            }),
          });
        }

        // Roles / restrictions
        if (operation === "Roles") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                roles: MOCK_ROLES,
              },
            }),
          });
        }

        // Default fallback
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: {} }),
        });
      });

      /* ---------------- IPFS upload ---------------- */
      await page.route("**/ipfs/file", async (route) => {
        return route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: MOCK_IPFS_HASH,
        });
      });
      await use(async () => {});
    },
    { auto: true },
  ],
});
