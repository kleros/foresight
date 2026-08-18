import { parseEther } from "viem";

import { CHILD_BATCH_SIZE } from "@/features/session-create/flow/params";

import { expect, test } from "../fixtures";
import { CreateWizard } from "../utils/create-wizard";
import { childMarketName, childMarketNames, duneDraft, HERO, ICON, noonUtc } from "../utils/drafts";
import { readIpfsBytes, readMetadataDocument } from "../utils/ipfs-gateway";
import { latestSessionId, readSession, readSessionMarkets, submittedDeploy } from "../utils/session-chain";

/**
 * What was typed, against what exists. Expectations read from the draft, except
 * where the wizard derives rather than carries: a token slugged from a label is
 * written out, since deriving it the app's way would assert nothing.
 */

const DEPLOYED = /^Deployed$/;

/** On chain is not on the page: the session view is built from the subgraph, not from receipts. */
test("the deploy holds at indexing until the subgraph has the session", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await wallet.connect("alice");
  await indexer.caughtUp();

  // Answers with no session however long it is asked, so the wait cannot end.
  await indexer.stalls();

  await wizard.signInAndDeploy();

  await expect(page.getByText("Confirmed on chain. Indexing is catching up")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DEPLOYED)).toHaveCount(0);

  await indexer.comesBack();

  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
});

test("a deployed session says on chain what was typed into the wizard", async ({ page, wallet, indexer }) => {
  const draft = duneDraft(test.info());
  const labels = draft.outcomes.map((outcome) => outcome.label);
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();
  await expect(page.getByText(`${draft.outcomes.length + 1} of ${draft.outcomes.length + 1} created`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Seed liquidity" })).toBeVisible();

  const session = await readSession(sessionId);
  const { parent, children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  // The preview offers the session page, which is the parent market's.
  await expect(page.getByRole("link", { name: "Open the session page" })).toHaveAttribute(
    "href",
    `/market/${parent.address}`,
  );

  expect(session.deployer).toBe(wallet.address);
  expect(session.expectedChildCount).toBe(BigInt(draft.outcomes.length));
  expect(session.completedAt).toBeGreaterThan(0n);

  expect(parent.marketName).toBe(draft.decision);
  expect(parent.outcomes).toEqual(labels);
  expect(parent.parentMarket).toBe("0x0000000000000000000000000000000000000000");
  expect(submitted.multiCategoricalParent).toBe(draft.multi);
  // Slugged from the labels, so written out rather than derived.
  expect(submitted.parent.tokenNames).toEqual(["VILLENEUVE", "GERWIG"]);
  expect(submitted.parent.minBond).toBe(parseEther(draft.minBond!));
  expect(submitted.parent.category).toBe(draft.category);
  expect(submitted.parent.lang).toBe(draft.language);
  expect(submitted.parent.openingTime).toBe(noonUtc(draft.decisionDate));

  expect(children.map((child) => child.marketName)).toEqual(childMarketNames(draft));
  expect(children.map((child) => child.parentOutcome)).toEqual(labels.map((_, index) => BigInt(index)));
  expect(children.every((child) => child.parentMarket === parent.address)).toBe(true);
  // DOWN then UP: Seer pays `high - answer` to outcome 0, `answer - low` to 1.
  expect(children.map((child) => child.outcomes)).toEqual(labels.map(() => ["DOWN", "UP"]));
  expect(children.map((child) => child.lowerBound)).toEqual(labels.map(() => parseEther(draft.lower)));
  expect(children.map((child) => child.upperBound)).toEqual(labels.map(() => parseEther(draft.upper)));
  expect(submitted.children.map((child) => child.tokenNames)).toEqual([
    ["VILLENEUVE_DOWN", "VILLENEUVE_UP"],
    ["GERWIG_DOWN", "GERWIG_UP"],
  ]);
  expect(submitted.children.map((child) => child.openingTime)).toEqual(labels.map(() => noonUtc(draft.decisionDate)));
  expect(submitted.children.map((child) => child.minBond)).toEqual(labels.map(() => parseEther(draft.minBond!)));
});

test("the display metadata on IPFS is the one that was typed, images included", async ({ page, wallet, indexer }) => {
  const draft = duneDraft(test.info());
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  const session = await readSession(sessionId);
  const document = await readMetadataDocument(session.metadataUri);

  expect(document.session.title).toBe(draft.title);
  expect(document.session.description).toBe(draft.description);
  expect(document.session.itemName).toBe(draft.itemName);
  expect(document.session.itemNamePlural).toBe(draft.itemNamePlural);

  // A branch left without a display name of its own is listed under its label.
  expect(document.children).toEqual(
    draft.outcomes.map((outcome, index) => ({
      outcomeIndex: index,
      displayName: outcome.label,
      color: outcome.color,
      blocks: [{ type: "markdown", body: outcome.details }],
    })),
  );

  expect(await readIpfsBytes(document.session.heroImage)).toEqual(HERO.buffer);
  expect(document.session.icon).toBeDefined();
  expect(await readIpfsBytes(document.session.icon!)).toEqual(ICON.buffer);
});

test("the branch markets are deployed in the order the outcomes were left in", async ({ page, wallet, indexer }) => {
  const draft = duneDraft(test.info(), {
    outcomes: [{ label: "Villeneuve" }, { label: "Gerwig" }, { label: "Nolan" }],
  });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  // The list order is the branch order on chain.
  await wizard.moveOutcome("Nolan", "up");
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  const { parent, children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  // The order the move produces, which is the thing under test.
  const reordered = ["Villeneuve", "Nolan", "Gerwig"];

  expect(parent.outcomes).toEqual(reordered);
  expect(children.map((child) => child.marketName)).toEqual(reordered.map((label) => childMarketName(draft, label)));
  expect(children.map((child) => child.parentOutcome)).toEqual(reordered.map((_, index) => BigInt(index)));
  expect(submitted.parent.tokenNames).toEqual(["VILLENEUVE", "NOLAN", "GERWIG"]);
});

test("a branch given its own question, bounds and closing time keeps them", async ({ page, wallet, indexer }) => {
  const draft = duneDraft(test.info());
  const override = {
    question: "Narnia opening weekend gross if Gerwig walks",
    lower: "10",
    upper: "20",
    date: "09212099",
  };
  const overriddenName = `${override.question} [${draft.unit}]`;
  const inherited = draft.outcomes[0]!.label;

  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wizard.overrideBranch(1, draft.outcomes[1]!.label, override);

  // The screen is held to the same answer as the chain.
  const gerwigRow = page.locator("#branch-1");
  await expect(gerwigRow.getByText(overriddenName)).toBeVisible();
  await expect(gerwigRow.getByText(`${override.lower} - ${override.upper}`)).toBeVisible();

  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  const { children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  expect(children[1]?.marketName).toBe(overriddenName);
  expect(children[1]?.lowerBound).toBe(parseEther(override.lower));
  expect(children[1]?.upperBound).toBe(parseEther(override.upper));
  expect(submitted.children[1]?.openingTime).toBe(noonUtc(override.date));

  expect(children[0]?.marketName).toBe(childMarketName(draft, inherited));
  expect(children[0]?.lowerBound).toBe(parseEther(draft.lower));
  expect(children[0]?.upperBound).toBe(parseEther(draft.upper));
  expect(submitted.children[0]?.openingTime).toBe(noonUtc(draft.decisionDate));
});

test("a multi-categorical decision is created through Seer's multi-categorical path", async ({
  page,
  wallet,
  indexer,
}) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info(), { multi: true }));
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  expect((await submittedDeploy(sessionId)).multiCategoricalParent).toBe(true);
});

test("a custom token name is what the outcome's tokens are called", async ({ page, wallet, indexer }) => {
  const draft = duneDraft(test.info(), {
    outcomes: [{ label: "Villeneuve", token: "DUNE3-DV" }, { label: "Gerwig" }],
  });
  const token = draft.outcomes[0]!.token!;
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  const submitted = await submittedDeploy(sessionId);
  // The second is slugged from its label, so it is written out.
  expect(submitted.parent.tokenNames).toEqual([token, "GERWIG"]);
  expect(submitted.children[0]?.tokenNames).toEqual([`${token}_DOWN`, `${token}_UP`]);
});

test("token names stay inside the 31 bytes Seer can wrap an ERC20 name into", async ({ page, wallet, indexer }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(
    duneDraft(test.info(), {
      outcomes: [{ label: "Denis Villeneuve, returning" }, { label: "Greta Gerwig, after Narnia" }],
    }),
  );
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 30_000 });
  const sessionId = await latestSessionId();

  const submitted = await submittedDeploy(sessionId);
  const names = [...submitted.parent.tokenNames, ...submitted.children.flatMap((child) => [...child.tokenNames])];

  // `toString31` in Seer's MarketFactory reverts above one word, and on empty.
  for (const name of names) {
    expect(Buffer.byteLength(name)).toBeLessThan(32);
    expect(name).not.toBe("");
  }
});

test("more branches than one transaction holds are created in batches, in order", async ({ page, wallet, indexer }) => {
  const outcomes = Array.from({ length: CHILD_BATCH_SIZE + 1 }, (_, index) => ({ label: `Director ${index + 1}` }));
  const draft = duneDraft(test.info(), { outcomes });
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);
  await wallet.connect("alice");

  // Nothing is signed while the indexer is behind.
  await indexer.caughtUp();

  await expect(page.getByText("Branch markets, batch 1 of 2")).toBeVisible();
  await wizard.signInAndDeploy();
  await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 60_000 });
  const sessionId = await latestSessionId();

  const session = await readSession(sessionId);
  const { children } = await readSessionMarkets(sessionId);
  const submitted = await submittedDeploy(sessionId);

  expect(session.expectedChildCount).toBe(BigInt(outcomes.length));
  // `completedAt` is non-zero only once every branch exists.
  expect(session.completedAt).toBeGreaterThan(0n);
  expect(children.map((child) => child.parentOutcome)).toEqual(outcomes.map((_, index) => BigInt(index)));
  expect(children.map((child) => child.marketName)).toEqual(childMarketNames(draft));
  expect(submitted.calls.map((call) => call.functionName)).toEqual([
    "openPhasedSession",
    ...Array.from({ length: Math.ceil(outcomes.length / CHILD_BATCH_SIZE) }, () => "deploySessionChildBatch"),
  ]);
});
