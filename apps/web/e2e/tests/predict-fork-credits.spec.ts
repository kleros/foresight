import {
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  publicActions,
  type Address,
} from "viem";
import { gnosis } from "viem/chains";

import { creditsContracts, tradeExecutorFactoryAbi, tradeExecutorFactoryAddress } from "@/config/contracts";
import { LOCAL_RPC_URL } from "@/config/chains";
import { shownAmount } from "@/features/predict/utils/funding";

import { INDEXER_URL } from "../fixtures/indexer";
import { expect, test } from "../fixtures";

/**
 * A credits prediction through the real popup on the gnosis fork, as hardhat's tenth account.
 * Needs `yarn local-stack gnosis-fork` with a session seeded with liquidity; on another chain it skips.
 */

const GNOSIS_CHAIN_ID = 100;
/** Hardhat's tenth account; the fork node keeps it unlocked, so the mock wallet can send as it. */
const VISITOR: Address = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
const CREDITS_GOVERNOR: Address = "0x4EDCA105188a0783Ab3A6f09c50567D1E3F8591D";
const GRANT = parseEther("3");

const chain = createTestClient({ chain: gnosis, mode: "hardhat", transport: http(LOCAL_RPC_URL) }).extend(
  publicActions,
);
const governor = createWalletClient({ account: CREDITS_GOVERNOR, chain: gnosis, transport: http(LOCAL_RPC_URL) });

async function chainId(): Promise<number | null> {
  return chain.getChainId().catch(() => null);
}

/** The newest indexed session whose options have pools, by its parent market. */
async function seededParent(): Promise<string> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": "testing" },
    body: JSON.stringify({
      query: `{ Session(where: {children: {pools: {id: {_is_null: false}}}}, order_by: {openedAt: desc}, limit: 1) { parentMarket } }`,
    }),
  });
  const body = (await response.json()) as { data?: { Session: Array<{ parentMarket: string }> } };
  const parent = body.data?.Session[0]?.parentMarket;
  if (!parent) throw new Error("No session with pools indexed. Run `yarn simulate:session:gnosis-fork --liquidity`.");
  return parent;
}

/** Mints credits to `to` as the governor, impersonated for the one call. */
async function grantCredits(token: Address, to: Address, amount: bigint) {
  await chain.impersonateAccount({ address: CREDITS_GOVERNOR });
  try {
    await chain.setBalance({ address: CREDITS_GOVERNOR, value: parseEther("10") });
    const hash = await governor.sendTransaction({
      to: token,
      data: encodeFunctionData({
        abi: parseAbi(["function mint(address to, uint256 amount)"]),
        functionName: "mint",
        args: [to, amount],
      }),
    });
    await chain.waitForTransactionReceipt({ hash });
  } finally {
    await chain.stopImpersonatingAccount({ address: CREDITS_GOVERNOR });
  }
}

test.describe("a credits prediction on the gnosis fork", () => {
  test("spends the credits the popup shows, adds nothing from the wallet, and counts the estimate placed", async ({
    page,
    wallet,
    indexer,
  }) => {
    test.skip((await chainId()) !== GNOSIS_CHAIN_ID, "needs `yarn local-stack gnosis-fork`");
    test.setTimeout(300_000);
    const contracts = creditsContracts(GNOSIS_CHAIN_ID)!;
    const factory = tradeExecutorFactoryAddress(GNOSIS_CHAIN_ID)!;
    const executor = await chain.readContract({
      address: factory,
      abi: tradeExecutorFactoryAbi,
      functionName: "predictExecutor",
      args: [VISITOR],
    });

    const credits = (holder: Address) =>
      chain.readContract({ address: contracts.credits, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
    const supply = () => chain.readContract({ address: contracts.credits, abi: erc20Abi, functionName: "totalSupply" });

    await grantCredits(contracts.credits, VISITOR, GRANT);
    const before = { wallet: await credits(VISITOR), tradeWallet: await credits(executor), supply: await supply() };

    await indexer.caughtUp();
    await page.goto(`/market/${await seededParent()}`);
    await wallet.connect(VISITOR);

    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { level: 3 }) })
      .first()
      .click();
    const slider = page.getByRole("slider").first();
    await expect(slider).toBeEnabled({ timeout: 30_000 });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    await page.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ }).click();
    const popup = page.getByRole("dialog");
    // ticked by default once credits can be spent
    await expect(popup.getByRole("checkbox", { name: "Use Foresight credits" })).toBeChecked({ timeout: 30_000 });

    const amount = popup.getByRole("spinbutton", { name: "Amount" });
    await amount.fill("2");
    await amount.blur();
    await expect(popup.getByText("≈ 2 sDAI from your credits")).toBeVisible();
    await expect(popup.getByText("Add funds")).toBeVisible();
    await expect(popup.getByText("2 credits", { exact: true })).toBeVisible();

    await popup.getByRole("button", { name: "Predict", exact: true }).click();
    const success = page.getByRole("dialog", { name: "Prediction placed" });
    await expect(success).toBeVisible({ timeout: 240_000 });
    await expect(success.getByText("1 estimate · 2 sDAI")).toBeVisible();

    // what the popup showed is what moved and burned, to the wei
    const after = { wallet: await credits(VISITOR), tradeWallet: await credits(executor), supply: await supply() };
    const shown = parseEther("2");
    const fromWallet = shown > before.tradeWallet ? shown - before.tradeWallet : 0n;
    expect(before.wallet - after.wallet).toBe(fromWallet);
    expect(before.supply - after.supply).toBe(shown);
    expect(after.tradeWallet).toBe(before.tradeWallet + fromWallet - shown);
    expect(shownAmount(before.supply - after.supply, 18)).toBe("2");
  });
});
