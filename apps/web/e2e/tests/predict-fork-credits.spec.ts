import { gnosis as gnosisContracts } from "@foresight/contracts";
import type { Page } from "@playwright/test";
import { createTestClient, erc20Abi, http, parseAbi, parseEther, publicActions, type Address } from "viem";
import { gnosis } from "viem/chains";

import { shownAmount } from "@/features/predict/utils/funding";

import { LOCAL_RPC_URL } from "@/config/chains";
import { creditsContracts, tradeExecutorFactoryAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { expect, test, WalletFixture } from "../fixtures";
import { grantCredits } from "../fixtures/hardhat";
import { INDEXER_URL } from "../fixtures/indexer";

/**
 * A credits prediction through the real popup on the gnosis fork, as hardhat's tenth account.
 * Needs `yarn local-stack gnosis-fork` with a session seeded with liquidity; on another chain it skips.
 */

const GNOSIS_CHAIN_ID = 100;
/** Hardhat's tenth account; the fork node keeps it unlocked, so the mock wallet can send as it. */
const VISITOR: Address = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
/** Gnosis' sDAI, the session collateral the credits spend as. */
const S_DAI: Address = gnosisContracts.savingsXDaiAddress[GNOSIS_CHAIN_ID];
const WAD = parseEther("1");
/** Half the last decimal the popup shows, the most a shown amount can sit from the wei it stands for. */
const HALF_SHOWN_STEP = 10n ** 14n / 2n;

const chain = createTestClient({ chain: gnosis, mode: "hardhat", transport: http(LOCAL_RPC_URL) }).extend(
  publicActions,
);

const contracts = creditsContracts(GNOSIS_CHAIN_ID)!;
const credits = (holder: Address) =>
  chain.readContract({ address: contracts.credits, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
const supply = () => chain.readContract({ address: contracts.credits, abi: erc20Abi, functionName: "totalSupply" });
const sDai = (holder: Address) =>
  chain.readContract({ address: S_DAI, abi: erc20Abi, functionName: "balanceOf", args: [holder] });

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

/** The visitor's trade wallet, deployed or not. */
function executorOf(owner: Address): Promise<Address> {
  return chain.readContract({
    address: tradeExecutorFactoryAddress(GNOSIS_CHAIN_ID)!,
    abi: tradeExecutorFactoryAbi,
    functionName: "predictExecutor",
    args: [owner],
  });
}

/** Everything the run touches of the visitor's, read at one moment. */
async function ledger(executor: Address) {
  return {
    block: await chain.getBlockNumber({ cacheTime: 0 }),
    wallet: await credits(VISITOR),
    tradeWallet: await credits(executor),
    supply: await supply(),
    xdai: await chain.getBalance({ address: VISITOR }),
    sDai: await sDai(VISITOR),
  };
}

/** The xDAI `from` paid in fees for the transactions it sent after block `since`. */
async function gasPaidSince(from: Address, since: bigint): Promise<bigint> {
  let paid = 0n;
  const head = await chain.getBlockNumber({ cacheTime: 0 });
  for (let number = since + 1n; number <= head; number++) {
    const block = await chain.getBlock({ blockNumber: number, includeTransactions: true });
    for (const tx of block.transactions) {
      if (tx.from.toLowerCase() !== from.toLowerCase()) continue;
      const receipt = await chain.getTransactionReceipt({ hash: tx.hash });
      paid += receipt.gasUsed * receipt.effectiveGasPrice;
    }
  }
  return paid;
}

/** The newest indexed session's page, with the visitor connected. */
async function openSession(page: Page, wallet: { connect: (account: Address) => Promise<void> }) {
  // the session is one the indexer already holds; the run itself reads the chain
  await page.goto(`/market/${await seededParent()}`);
  await wallet.connect(VISITOR);
}

/**
 * Opens the newest indexed session as the visitor, nudges its first option `presses` steps `toward`
 * and opens the popup. Each test nudges to its own estimate, so each leaves the next one a move.
 */
async function openPopup(
  page: Page,
  wallet: { connect: (account: Address) => Promise<void> },
  toward: "ArrowLeft" | "ArrowRight",
  presses = 2,
) {
  await openSession(page, wallet);

  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { level: 3 }) })
    .first()
    .click();
  const slider = page.getByRole("slider").first();
  await expect(slider).toBeEnabled({ timeout: 30_000 });
  await slider.focus();
  for (let press = 0; press < presses; press++) await page.keyboard.press(toward);

  await page.getByRole("button", { name: /^Predict (\d+ )?estimates?$/ }).click();
  const popup = page.getByRole("dialog");
  // ticked by default once credits can be spent
  await expect(popup.getByRole("checkbox", { name: "Use Foresight credits" })).toBeChecked({ timeout: 30_000 });
  return popup;
}

/**
 * Closes the tab at the trade wallet's first batch: before the node sees it, or once it has mined
 * with its hash kept from the page. Resolves when the batch is reached.
 */
async function closeAtBatch(page: Page, executor: Address, when: "before" | "after"): Promise<void> {
  return new Promise((reached) => {
    void page.route(
      (url) => url.port === "8545",
      async (route) => {
        const body = route.request().postDataJSON() as unknown;
        const calls = (Array.isArray(body) ? body : [body]) as Array<{ method?: string; params?: [{ to?: string }] }>;
        const isBatch = calls.some(
          (call) =>
            call.method === "eth_sendTransaction" && call.params?.[0]?.to?.toLowerCase() === executor.toLowerCase(),
        );
        if (!isBatch) return route.continue();
        if (when === "after") {
          const response = await route.fetch();
          const { result } = (await response.json()) as { result: `0x${string}` };
          await chain.waitForTransactionReceipt({ hash: result });
        }
        // the page never hears back, as a closed tab would not
        reached();
      },
    );
  });
}

/** How many transactions `from` sent to `to` after block `since`. */
async function sentSince(from: Address, to: Address, since: bigint): Promise<number> {
  let count = 0;
  const head = await chain.getBlockNumber({ cacheTime: 0 });
  for (let number = since + 1n; number <= head; number++) {
    const block = await chain.getBlock({ blockNumber: number, includeTransactions: true });
    count += block.transactions.filter(
      (tx) => tx.from.toLowerCase() === from.toLowerCase() && tx.to?.toLowerCase() === to.toLowerCase(),
    ).length;
  }
  return count;
}

test.describe("a credits prediction on the gnosis fork", () => {
  test.beforeEach(async () => {
    test.skip((await chainId()) !== GNOSIS_CHAIN_ID, "needs `yarn local-stack gnosis-fork`");
    test.setTimeout(300_000);
  });

  test("spends the credits the popup shows, adds nothing from the wallet, and counts the estimate placed", async ({
    page,
    wallet,
  }) => {
    const executor = await executorOf(VISITOR);
    const shown = parseEther("2");
    if ((await credits(VISITOR)) + (await credits(executor)) < shown) {
      await grantCredits(contracts.credits, VISITOR, shown);
    }
    const before = await ledger(executor);

    const popup = await openPopup(page, wallet, "ArrowLeft");
    // the visitor holds only xDAI, which the popup picks by default; credits are sDAI shares
    await popup.getByRole("button", { name: /Token/ }).click();
    await page.getByRole("option", { name: "sDAI" }).click();
    const amount = popup.getByRole("spinbutton", { name: "Amount" });
    await amount.fill("2");
    await amount.blur();
    await expect(popup.getByText("≈ 2 sDAI from your credits")).toBeVisible();
    await expect(popup.getByText("Add funds")).toBeVisible();
    const fromWallet = shown > before.tradeWallet ? shown - before.tradeWallet : 0n;
    if (fromWallet > 0n)
      await expect(popup.getByText(`${shownAmount(fromWallet, 18)} credits`, { exact: true })).toBeVisible();

    await popup.getByRole("button", { name: "Predict", exact: true }).click();
    const success = page.getByRole("dialog", { name: "Prediction successful" });
    await expect(success).toBeVisible({ timeout: 240_000 });
    await expect(success.getByText("1 estimate · 2 sDAI")).toBeVisible();

    // what the popup showed is what moved and burned, to the wei, and nothing else of the visitor's
    const after = await ledger(executor);
    expect(before.wallet - after.wallet, "credits moved from the wallet").toBe(fromWallet);
    expect(before.supply - after.supply, "credits burned").toBe(shown);
    expect(after.tradeWallet, "credits left in the trade wallet").toBe(before.tradeWallet + fromWallet - shown);
    expect(after.sDai, "the wallet's sDAI").toBe(before.sDai);
    expect(before.xdai - after.xdai, "the wallet's xDAI, gas aside").toBe(await gasPaidSince(VISITOR, before.block));
  });

  test("with xDAI, spends every credit held first and deposits the xDAI shown for the rest", async ({
    page,
    wallet,
  }) => {
    const executor = await executorOf(VISITOR);
    if ((await credits(VISITOR)) + (await credits(executor)) < parseEther("2")) {
      await grantCredits(contracts.credits, VISITOR, parseEther("2"));
    }
    const before = await ledger(executor);
    const held = before.wallet + before.tradeWallet;
    expect(held % 10n ** 14n, "whole shown decimals, so every credit held is spent").toBe(0n);

    // one sDAI's worth of xDAI past the credits, in whole xDAI, so the wallet pays a part
    const rate = await chain.readContract({
      address: S_DAI,
      abi: parseAbi(["function convertToAssets(uint256 shares) view returns (uint256)"]),
      functionName: "convertToAssets",
      args: [WAD],
    });
    const typed = ((held + WAD) * rate) / WAD / WAD + 1n;

    const popup = await openPopup(page, wallet, "ArrowRight");
    await expect(popup.getByRole("button", { name: /Token/ })).toContainText("xDAI");
    const amount = popup.getByRole("spinbutton", { name: "Amount" });
    await amount.fill(typed.toString());
    await amount.blur();
    await expect(
      popup.getByText(
        new RegExp(
          `^≈ [\\d.,]+ sDAI = ${shownAmount(held, 18).replace(/[.,]/g, "\\$&")} in credits \\+ [\\d.,]+ from your wallet$`,
        ),
      ),
    ).toBeVisible();
    // the step keeps each part whole with no-break spaces
    const step = popup.getByText(/(^|\+\s)[\d.,]+\sxDAI$/);
    await expect(step).toBeVisible();
    const deposit = parseEther((await step.textContent())!.match(/([\d.,]+)\sxDAI$/)![1]!.replace(/,/g, ""));

    await popup.getByRole("button", { name: "Predict", exact: true }).click();
    const success = page.getByRole("dialog", { name: "Prediction successful" });
    await expect(success).toBeVisible({ timeout: 240_000 });
    await expect(success.getByText(`1 estimate · ${typed} xDAI`)).toBeVisible();

    // every credit held burned once, the wallet's moved and none left; the xDAI paid is the xDAI shown
    const after = await ledger(executor);
    expect(before.supply - after.supply, "credits burned").toBe(held);
    expect(after.wallet, "credits left in the wallet").toBe(0n);
    expect(after.tradeWallet, "credits left in the trade wallet").toBe(0n);
    expect(after.sDai, "the wallet's sDAI").toBe(before.sDai);
    expect(deposit, "the wallet pays a part in xDAI").toBeGreaterThan(0n);
    const paid = before.xdai - after.xdai - (await gasPaidSince(VISITOR, before.block));
    const off = paid > deposit ? paid - deposit : deposit - paid;
    expect(off, `paid ${paid} xDAI wei against the ${deposit} shown`).toBeLessThanOrEqual(HALF_SHOWN_STEP);
  });

  for (const [when, toward] of [
    ["before", "ArrowLeft"],
    ["after", "ArrowRight"],
  ] as const) {
    test(`resumed after the tab closed ${when === "before" ? "after Add credits" : "as the batch landed"}, moves and burns the credits once`, async ({
      page,
      wallet,
      context,
    }) => {
      const executor = await executorOf(VISITOR);
      const shown = parseEther("2");
      if ((await credits(VISITOR)) + (await credits(executor)) < shown) {
        await grantCredits(contracts.credits, VISITOR, shown);
      }
      const before = await ledger(executor);
      const fromWallet = shown > before.tradeWallet ? shown - before.tradeWallet : 0n;

      const popup = await openPopup(page, wallet, toward, 4);
      await popup.getByRole("button", { name: /Token/ }).click();
      await page.getByRole("option", { name: "sDAI" }).click();
      const amount = popup.getByRole("spinbutton", { name: "Amount" });
      await amount.fill("2");
      await amount.blur();
      await expect(popup.getByText("≈ 2 sDAI from your credits")).toBeVisible();

      const closed = closeAtBatch(page, executor, when);
      await popup.getByRole("button", { name: "Predict", exact: true }).click();
      await closed;
      // closing skips the page's own handling of the unanswered send, as a closed tab would
      await page.close({ runBeforeUnload: false });
      expect(await credits(executor), "the trade wallet's credits as the tab closed").toBe(
        when === "before" ? before.tradeWallet + fromWallet : before.tradeWallet + fromWallet - shown,
      );

      const reopened = await context.newPage();
      await openSession(reopened, new WalletFixture({ page: reopened }));
      await expect(reopened.getByText("A prediction with 2 in credits did not finish.")).toBeVisible({
        timeout: 30_000,
      });
      await reopened.getByRole("button", { name: "Resume", exact: true }).click();
      const resume = reopened.getByRole("dialog").getByRole("button", { name: "Resume", exact: true });
      await expect(resume).toBeEnabled({ timeout: 60_000 });
      await resume.click();
      const success = reopened.getByRole("dialog", { name: "Prediction successful" });
      await expect(success).toBeVisible({ timeout: 240_000 });
      await expect(success.getByText("1 estimate · 2 sDAI")).toBeVisible();

      // one transfer, one batch, and the credits shown burned once
      const after = await ledger(executor);
      expect(await sentSince(VISITOR, contracts.credits, before.block), "credits transfers").toBe(
        fromWallet > 0n ? 1 : 0,
      );
      expect(await sentSince(VISITOR, executor, before.block), "batches sent").toBe(1);
      expect(before.wallet - after.wallet, "credits moved from the wallet").toBe(fromWallet);
      expect(before.supply - after.supply, "credits burned").toBe(shown);
      expect(after.tradeWallet, "credits left in the trade wallet").toBe(before.tradeWallet + fromWallet - shown);
      expect(after.sDai, "the wallet's sDAI").toBe(before.sDai);
      expect(before.xdai - after.xdai, "the wallet's xDAI, gas aside").toBe(await gasPaidSince(VISITOR, before.block));
    });
  }
});
