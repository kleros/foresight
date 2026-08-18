import { privateKeyToAddress } from "viem/accounts";

import { shortenAddress } from "@/utils/address";

import { MOCK_ACCOUNTS, type MockAccountName } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";
import { ACCOUNT_PKEYS } from "../utils/accounts";

/** Hardhat's third account, deliberately not one of MOCK_ACCOUNTS. */
const UNNAMED_ACCOUNT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

test("connecting swaps the navbar button for the account", async ({ page, wallet }) => {
  // web3 connection not available on homepage.
  await page.goto("/create");

  const navbar = page.getByRole("banner");
  await expect(navbar.getByRole("button", { name: "Connect" })).toBeVisible();

  await wallet.connect("alice");

  await expect(navbar.getByRole("button", { name: "Connect" })).toHaveCount(0);
  await expect(page.getByText(shortenAddress(MOCK_ACCOUNTS.alice))).toBeVisible();
});

test("accounts can be switched without a reload", async ({ page, wallet }) => {
  await page.goto("/create");

  await wallet.connect("alice");
  await expect(page.getByText(shortenAddress(MOCK_ACCOUNTS.alice))).toBeVisible();

  await wallet.connect("bob");
  await expect(page.getByText(shortenAddress(MOCK_ACCOUNTS.bob))).toBeVisible();
});

test("an address works as well as a name", async ({ page, wallet }) => {
  await page.goto("/create");

  await wallet.connect(UNNAMED_ACCOUNT);

  await expect(page.getByText(shortenAddress(UNNAMED_ACCOUNT))).toBeVisible();
});

test("account keys and addresses have not drifted apart", () => {
  for (const [name, privateKey] of Object.entries(ACCOUNT_PKEYS)) {
    expect(privateKeyToAddress(privateKey)).toBe(MOCK_ACCOUNTS[name as MockAccountName]);
  }
});
