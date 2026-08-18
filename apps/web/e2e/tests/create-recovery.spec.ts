import type { Page } from "@playwright/test";
import { parseEther } from "viem";

import { ACCEPTABLE_LAG } from "@/features/session-create/deploy/sessionLookup";
import { CHILD_BATCH_SIZE } from "@/features/session-create/flow/params";

import { shortHash } from "@/utils/hash";

import { LOCAL_RPC_URL } from "@/config/chains";

import { expect, test, type HardhatClient } from "../fixtures";
import { CreateWizard } from "../utils/create-wizard";
import { childMarketName, childMarketNames, duneDraft, noonUtc } from "../utils/drafts";
import {
  latestSessionId,
  readSession,
  readSessionMarkets,
  sessionCount,
  submittedDeploy,
} from "../utils/session-chain";

/**
 * Deploys that do not go to plan. Nothing here can be undone, so the failures
 * covered are the expensive ones: gas spent on a deploy that could not work,
 * and a second session opened over one that already exists.
 */

const DEPLOYED = /^Deployed$/;

const RESUME_BANNER = '[data-screen-label="Resume an incomplete session"]';

/** The offer to continue, inside step 5. Locally there is no explorer, so a hash in it is text, not a link. */
const RECOVERED_BANNER = '[data-screen-label="Continue an unfinished deploy"]';

/** Holds until the transaction is with the node: on screen, signing and confirming look alike. */
async function transactionInFlight(hardhat: HardhatClient) {
  await expect
    .poll(async () => (await hardhat.getBlock({ blockTag: "pending" })).transactions.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
}

const RPC_PORT = new URL(LOCAL_RPC_URL).port;

/** Shared by route and unroute, which match a predicate by identity. */
const isChainRequest = (url: URL) => url.port === RPC_PORT;

/**
 * The transaction reaches the node, the hash never comes back: a tab closed with
 * the wallet open.
 *
 * @param nth which send to swallow, 1-based. Earlier ones are left alone, so a
 * phased deploy can lose a batch's hash rather than its parent's.
 */
async function swallowTheTransactionHash(page: Page, nth = 1) {
  let sends = 0;
  await page.route(isChainRequest, async (route) => {
    const body: unknown = route.request().postDataJSON();
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.some((call: { method?: string } | null) => call?.method === "eth_sendTransaction")) {
      return route.fallback();
    }
    sends += 1;
    if (sends < nth) return route.fallback();
    await route.fetch();
    // Left unfulfilled on purpose: the page is reloaded out from under it.
    await new Promise(() => {});
  });
}

/**
 * The wallet prompt opens and is never answered. Unlike a swallowed hash, the
 * request never reaches the node, so nothing is created.
 *
 * @param nth which send to hold, 1-based.
 */
async function walletPromptLeftOpen(page: Page, nth = 1) {
  let sends = 0;
  await page.route(isChainRequest, async (route) => {
    const body: unknown = route.request().postDataJSON();
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.some((call: { method?: string } | null) => call?.method === "eth_sendTransaction")) {
      return route.fallback();
    }
    sends += 1;
    if (sends < nth) return route.fallback();
    // Never forwarded and never fulfilled: the page is reloaded out from under it.
    await new Promise(() => {});
  });
}

test.afterEach(async ({ hardhat }) => {
  // Mined too: the next test reads the pending block for its own transaction.
  await hardhat.setAutomine(true);
  await hardhat.mine({ blocks: 1 });
});

test("a metadata upload that fails costs nothing on chain", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  await page.route("**/ipfs/file", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Atlas is out." }) }),
  );
  const before = await sessionCount();

  await wizard.deployButton.click();

  await expect(page.getByText("Deploy stopped")).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before);
});

test("the deploy picks up from the upload once it can be uploaded again", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  await page.route("**/ipfs/file", (route) => route.fulfill({ status: 503, body: "{}" }));
  const before = await sessionCount();
  await wizard.deployButton.click();
  await expect(page.getByText("Deploy stopped")).toBeVisible({ timeout: 30_000 });

  await page.unroute("**/ipfs/file");
  await wizard.retryButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

test("a metadata document that reads back changed stops the deploy before any gas", async ({
  page,
  wallet,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  // The gateway serves something other than what was uploaded.
  await page.route(
    (url) => url.pathname.startsWith("/ipfs/") && url.pathname !== "/ipfs/file",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schemaVersion: 1, session: { title: "Something else" }, children: [] }),
      }),
  );
  const before = await sessionCount();

  await wizard.deployButton.click();

  await expect(page.getByText(/do not match what was uploaded/)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before);
});

test("an indexer that is behind stops the deploy rather than risk a second session", async ({
  page,
  wallet,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  // Behind, so "there is no session here" is not an answer to sign on.
  await indexer.fallsBehind(ACCEPTABLE_LAG + 1);
  const before = await sessionCount();

  await wizard.deployButton.click();

  await expect(page.getByText(/Still catching up with the chain/)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before);

  await indexer.comesBack();
  await wizard.retryButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

/** A read that failed says nothing about the next signature, so it stops the run rather than ending it. */
test("an indexer that cannot be reached stops the deploy without ending it", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  await indexer.goesDown();
  const before = await sessionCount();

  await wizard.deployButton.click();

  await expect(page.getByText("Deploy stopped")).toBeVisible({ timeout: 30_000 });
  // Not "Deploy failed": that offers starting over, which would open a second session.
  await expect(page.getByText("Deploy failed")).toHaveCount(0);
  expect(await sessionCount()).toBe(before);

  await indexer.comesBack();
  await wizard.retryButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

test("pressing deploy twice creates one session", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await wizard.deployButton.dblclick();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

test("a deploy whose tab closed mid-transaction is offered back rather than started again", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  // Nothing mined from here: the transaction is signed and left in flight.
  await hardhat.setAutomine(false);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });
  // Offering the deploy button again would pay for the session twice.
  expect(await wizard.deployButton.count()).toBe(0);

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  await hardhat.setAutomine(true);
  await hardhat.mine({ blocks: 1 });

  // The transaction landed while the tab was away, and the indexer has it.
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  // Every market here came from the indexer: this browser saw no receipt.
  await expect(page.getByText("3 of 3 created")).toBeVisible();
  expect(await sessionCount()).toBe(before + 1n);
  expect((await readSession(await latestSessionId())).completedAt).toBeGreaterThan(0n);
});

/** No hash in the browser, a session on the chain: the lookup is the only way to tell. */
test("a deploy whose hash never came back is skipped rather than signed a second time", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await hardhat.setAutomine(false);
  await swallowTheTransactionHash(page);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();
  await page.unroute(isChainRequest);
  // Offered back with no hash in it: nothing came back from the wallet, and the
  // transaction is not mined, so the indexer has nothing to show either.
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(RECOVERED_BANNER).getByText(/^0x/)).toHaveCount(0);

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  await hardhat.setAutomine(true);
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  // Only the indexer can say this session exists.
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("3 of 3 created")).toBeVisible();
  expect(await sessionCount()).toBe(before + 1n);
});

/**
 * The batch equivalent of the test above, and the harder half: the parent's
 * session id is on the snapshot by then, so only the indexer can say whether the
 * branches a swallowed transaction created exist.
 */
test("a branch batch whose hash never came back is skipped rather than signed again", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const outcomes = Array.from({ length: CHILD_BATCH_SIZE + 1 }, (_, index) => ({ label: `Director ${index + 1}` }));
  const draft = duneDraft(test.info(), { outcomes });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  // The parent's hash comes back, the first batch's does not.
  await swallowTheTransactionHash(page, 2);
  await wizard.deployButton.click();

  // Read from the chain, not the screen: the page is told nothing of the batch.
  await expect(page.getByText(`1 of ${outcomes.length + 1} created`)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();
  await expect
    .poll(async () => (await readSessionMarkets(sessionId)).children.length, { timeout: 30_000 })
    .toBe(CHILD_BATCH_SIZE);

  await page.reload();
  await page.unroute(isChainRequest);
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  // A block settles the reconnected wallet; without one the resume button, which
  // waits on the deploying chain, never arrives.
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 60_000 });
  const { children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  expect((await readSession(sessionId)).completedAt).toBeGreaterThan(0n);
  expect(children.map((child) => child.parentOutcome)).toEqual(outcomes.map((_, index) => BigInt(index)));
  // One call per batch and no more: the one it could not see was not signed again.
  expect(submitted.calls.filter((call) => call.functionName === "deploySessionChildBatch")).toHaveLength(2);
});

test("a run found in storage is named at the top of the page before it reaches the chain", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const draft = duneDraft(test.info());
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  await hardhat.setAutomine(false);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();

  const banner = page.locator(RESUME_BANNER);
  await expect(banner.getByText(`${draft.title} has a deploy that stopped`)).toBeVisible({ timeout: 30_000 });
  // Calling a session live would send the deployer looking for a market that
  // does not exist.
  await expect(banner.getByText("Already on-chain")).toHaveCount(0);
  await expect(banner.getByText(draft.decision, { exact: true })).toBeVisible();

  await hardhat.setAutomine(true);
});

test("a session the indexer already has arrives with its branches marked created", async ({
  page,
  wallet,
  indexer,
}) => {
  const outcomes = Array.from({ length: CHILD_BATCH_SIZE + 1 }, (_, index) => ({ label: `Director ${index + 1}` }));
  const draft = duneDraft(test.info(), { outcomes });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();

  // The parent's hash comes back, the first batch's does not.
  await swallowTheTransactionHash(page, 2);
  await wizard.deployButton.click();

  await expect(page.getByText(`1 of ${outcomes.length + 1} created`)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();
  await expect
    .poll(async () => (await readSessionMarkets(sessionId)).children.length, { timeout: 30_000 })
    .toBe(CHILD_BATCH_SIZE);
  await indexer.caughtUp();

  await page.reload();
  await page.unroute(isChainRequest);

  const banner = page.locator(RESUME_BANNER);
  await expect(banner.getByText(`${draft.title} is live, but unfinished`)).toBeVisible({ timeout: 30_000 });
  // The branches of the batch nobody in this browser saw land.
  for (const outcome of outcomes.slice(0, CHILD_BATCH_SIZE)) {
    await expect(banner.getByText(outcome.label, { exact: true })).toBeVisible();
  }
  await expect(
    banner.getByText(`Director ${outcomes.length}: ${childMarketName(draft, `Director ${outcomes.length}`)}`),
  ).toBeVisible();

  // Read off the chain's own logs: this browser never saw either transaction.
  const { calls } = await submittedDeploy(sessionId);
  await expect(banner.getByText(shortHash(calls[0]!.hash))).toBeVisible();
  // One transaction created the whole batch, so every branch in it points there.
  await expect(banner.getByText(shortHash(calls[1]!.hash))).toHaveCount(CHILD_BATCH_SIZE);
});

test("a decision market left unsigned when the tab closed is signed once on resume", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await walletPromptLeftOpen(page);
  await wizard.deployButton.click();
  // A market row only reads this once the wallet has been asked, which is after
  // the run is stored. Atomic puts every market in one transaction, so they all
  // read it at once; the stage row above is on screen from the start and proves
  // nothing.
  await expect(page.getByText("confirming").first()).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await page.unroute(isChainRequest);
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });
  // Nothing was signed, so nothing exists to be picked up from.
  expect(await sessionCount()).toBe(before);

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  // A block settles the reconnected wallet, which the resume button waits on.
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

/** The parent is paid for by the time this happens, so a second session cannot be the answer. */
test("a branch batch left unsigned when the tab closed keeps the session it belongs to", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const outcomes = Array.from({ length: CHILD_BATCH_SIZE + 1 }, (_, index) => ({ label: `Director ${index + 1}` }));
  const draft = duneDraft(test.info(), { outcomes });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  // The decision market signs and confirms; the first batch's prompt is left open.
  await walletPromptLeftOpen(page, 2);
  await wizard.deployButton.click();
  await expect(page.getByText(`1 of ${outcomes.length + 1} created`)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  await page.reload();
  await page.unroute(isChainRequest);
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  // A block settles the reconnected wallet, which the resume button waits on.
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 60_000 });
  // The session it opened before the reload, finished rather than replaced.
  expect(await sessionCount()).toBe(before + 1n);
  expect(await latestSessionId()).toBe(sessionId);
  const { children } = await readSessionMarkets(sessionId);
  expect(children).toHaveLength(outcomes.length);
});

/** A stalled indexer's height is as stale as its progress, so lag has to be measured against the chain. */
test("an indexer that has stopped keeping up cannot be taken at its word for a second session", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await hardhat.setAutomine(false);
  await swallowTheTransactionHash(page);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();
  await page.unroute(isChainRequest);
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  // Stopped before the session's block, so it never sees it.
  await indexer.stalls();
  await hardhat.setAutomine(true);
  // First block carries the session; the rest put the indexer past the tolerance.
  await hardhat.mine({ blocks: ACCEPTABLE_LAG + 1 });
  await wizard.resumeButton.click();

  await expect(page.getByText(/Still catching up with the chain/)).toBeVisible({ timeout: 30_000 });
  // The one from the swallowed transaction, and nothing signed on top of it.
  expect(await sessionCount()).toBe(before + 1n);
});

test("a browser clock running ahead of the chain does not hide the session from the guard", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  // Two minutes fast, and longer than the deploy takes. Installed before the
  // page loads, so everything in it reads the same clock.
  await page.clock.install({ time: Date.now() + 120_000 });
  await page.clock.resume();

  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await hardhat.setAutomine(false);
  await swallowTheTransactionHash(page);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();
  await page.unroute(isChainRequest);
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });

  // After its own reconnect: connecting mid-way drops the wallet again.
  await expect(page.getByText("No wallet connected.")).toBeVisible();
  await wallet.connect("alice");
  await expect(page.getByText("No wallet connected.")).toHaveCount(0);
  await hardhat.setAutomine(true);
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  expect(await sessionCount()).toBe(before + 1n);
});

test("a phased deploy resumed after a reload finishes the session it already opened", async ({
  page,
  wallet,
  hardhat,
  indexer,
}) => {
  const outcomes = Array.from({ length: CHILD_BATCH_SIZE + 1 }, (_, index) => ({ label: `Director ${index + 1}` }));
  const draft = duneDraft(test.info(), { outcomes });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");
  await wizard.signIn();
  await indexer.caughtUp();
  const before = await sessionCount();

  await hardhat.setAutomine(false);
  await wizard.deployButton.click();
  await transactionInFlight(hardhat);

  await page.reload();
  await expect(page.getByText("Unfinished deploy found")).toBeVisible({ timeout: 30_000 });
  await wallet.connect("alice");

  await hardhat.setAutomine(true);
  await hardhat.mine({ blocks: 1 });
  await indexer.caughtUp();
  await wizard.resumeButton.click();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`${outcomes.length + 1} of ${outcomes.length + 1} created`)).toBeVisible();

  expect(await sessionCount()).toBe(before + 1n);

  const sessionId = await latestSessionId();
  const session = await readSession(sessionId);
  const { children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  expect(session.completedAt).toBeGreaterThan(0n);
  expect(children.map((child) => child.parentOutcome)).toEqual(outcomes.map((_, index) => BigInt(index)));
  // A second `openPhasedSession` would strand the first session for good.
  expect(submitted.calls.filter((call) => call.functionName === "openPhasedSession")).toHaveLength(1);

  // The batches after the reload were built from a snapshot that went through
  // storage and back, so what they carry is what was typed before it.
  expect(children.map((child) => child.marketName)).toEqual(childMarketNames(draft));
  expect(children.map((child) => child.lowerBound)).toEqual(outcomes.map(() => parseEther(draft.lower)));
  expect(children.map((child) => child.upperBound)).toEqual(outcomes.map(() => parseEther(draft.upper)));
  expect(submitted.children.map((child) => child.minBond)).toEqual(outcomes.map(() => parseEther(draft.minBond!)));
  expect(submitted.children.map((child) => child.openingTime)).toEqual(outcomes.map(() => noonUtc(draft.decisionDate)));
});
