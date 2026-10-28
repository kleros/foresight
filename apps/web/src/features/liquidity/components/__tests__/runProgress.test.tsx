import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { branch, decode, owner, session } from "../../flow/__tests__/support/session";
import { planMerge, planSeed } from "../../flow/plan";
import type { LiquidityRun } from "../../hooks/useLiquidityRun";
import type { LiquidityProgress, LiquidityProgressRow, MergeInput, SeedInput } from "../../types";
import { LiquidityDialog } from "../LiquidityDialog";
import { LiquidityPositionsDialog } from "../LiquidityPositionsDialog";

// the popup reads no chain here: the pools are not passed, and sDAI needs no deposit preview
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

const WAD = 10n ** 18n;
const NAMES = ["Denis Villeneuve", "Greta Gerwig"];
const TWO = session([branch(1), branch(2)]);

const input: SeedInput = {
  session: TWO,
  owner,
  total: 10n * WAD,
  collateral: "sDAI",
  chainTime: 1_900_000_000n,
  branches: TWO.branches.map(() => ({
    depth: 10n * WAD,
    upPriceBps: 5_000n,
    pools: { up: { status: "missing" }, down: { status: "missing" } },
  })),
};

/** The plan's transactions: the parent split's, then each branch's, which the popup lists as three rows. */
const IDS = planSeed(input).steps.map((step) => step.id);
const TOTAL = IDS.length;
const PARENT = IDS.filter((id) => id.startsWith("parent:")).length;
const BRANCH_0 = IDS.filter((id) => id.startsWith("branch:0:")).length;
const BRANCH_1 = IDS.filter((id) => id.startsWith("branch:1:")).length;

const row = (id: string, view: LiquidityProgressRow["view"], done: number, total: number): LiquidityProgressRow => ({
  id,
  view,
  signatures: { done, total },
});

/** A seed on its second branch's first signature, as the driver reports it. */
const signing = (status: "awaiting-signature" | "submitted"): LiquidityProgress => ({
  stage: status === "submitted" ? "confirming" : "signing",
  kind: "seed",
  rows: [
    row("parent", "done", PARENT, PARENT),
    row("branch:0", "done", BRANCH_0, BRANCH_0),
    row("branch:1", "running", 0, BRANCH_1),
  ],
  signatures: { done: PARENT + BRANCH_0, total: TOTAL },
  signature: { position: PARENT + BRANCH_0 + 1, total: TOTAL, status },
});

const declined: LiquidityProgress = {
  stage: "halted",
  failure: { reason: "rejected", retryable: true },
  kind: "seed",
  rows: [
    row("parent", "done", PARENT, PARENT),
    row("branch:0", "done", BRANCH_0, BRANCH_0),
    row("branch:1", "failed", 0, BRANCH_1),
  ],
  signatures: { done: PARENT + BRANCH_0, total: TOTAL },
};

/** The same run stored and reopened: what it settled, held for review. */
const recovered: LiquidityProgress = {
  stage: "review",
  kind: "seed",
  rows: [
    row("parent", "done", PARENT, PARENT),
    row("branch:0", "done", BRANCH_0, BRANCH_0),
    row("branch:1", "idle", 0, BRANCH_1),
  ],
  signatures: { done: PARENT + BRANCH_0, total: TOTAL },
};

function runAt(progress: LiquidityProgress): LiquidityRun {
  const isRunning = progress.stage === "signing" || progress.stage === "confirming";
  return {
    progress,
    start: () => {},
    resume: () => {},
    retry: () => {},
    reset: () => {},
    discard: () => {},
    isRunning,
    isHeld: progress.stage !== "idle" && progress.stage !== "complete",
  };
}

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const addPopup = (progress: LiquidityProgress) =>
  wrap(
    <LiquidityDialog
      isOpen
      onClose={() => {}}
      names={NAMES}
      pools={undefined}
      owner={owner}
      balances={undefined}
      chainTime={undefined}
      closed={false}
      run={runAt(progress)}
    />,
  );

const dialog = (name: string) => screen.getByRole("dialog", { name });
const item = (title: string) => screen.getByRole("listitem", { name: `Timeline item: ${title}` });
const bullet = (title: string) => item(title).querySelector("[data-bullet]")?.getAttribute("data-bullet");
const statusText = (scope: HTMLElement) => within(scope).getByTestId("status-text").textContent;

describe("the Add liquidity popup during a seed", () => {
  it("checks the rows signed, pulses the one signing, and names the signature in the status line", () => {
    render(addPopup(signing("awaiting-signature")));

    expect([bullet("Split into outcomes"), bullet(`Seed ${NAMES[0]}`), bullet(`Seed ${NAMES[1]}`)]).toEqual([
      "done",
      "done",
      "running",
    ]);
    expect(statusText(dialog("Add liquidity"))).toBe(
      `Signature ${PARENT + BRANCH_0 + 1} of ${TOTAL}. Confirm in your wallet.`,
    );
  });

  it("says it waits for the signature to confirm once it is broadcast", () => {
    render(addPopup(signing("submitted")));

    expect(statusText(dialog("Add liquidity"))).toBe(`Waiting for signature ${PARENT + BRANCH_0 + 1} of ${TOTAL} to confirm.`);
  });

  it("follows the run from one signature to the next without remounting a bullet", () => {
    const view = render(addPopup(signing("awaiting-signature")));
    const before = item(`Seed ${NAMES[1]}`).querySelector("[data-bullet]");

    view.rerender(addPopup(declined));

    expect(item(`Seed ${NAMES[1]}`).querySelector("[data-bullet]")).toBe(before);
    expect(bullet(`Seed ${NAMES[1]}`)).toBe("failed");
  });

  it("gives the running row its place among the branch's own signatures", () => {
    render(addPopup(signing("awaiting-signature")));

    expect(within(item(`Seed ${NAMES[1]}`)).getByText(`1 of ${BRANCH_1} · Confirm in your wallet`)).toBeVisible();
  });

  it("crosses the row a declined signature stopped, says why, and offers to try again", () => {
    render(addPopup(declined));

    expect(bullet(`Seed ${NAMES[1]}`)).toBe("failed");
    expect(statusText(dialog("Add liquidity"))).toMatch(/declined/i);
    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Start over" })).toBeEnabled();
  });

  it("shows a recovered run's settled rows as done, and offers to resume it", () => {
    render(addPopup(recovered));

    expect([bullet("Split into outcomes"), bullet(`Seed ${NAMES[0]}`), bullet(`Seed ${NAMES[1]}`)]).toEqual([
      "done",
      "done",
      "idle",
    ]);
    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Resume" })).toBeEnabled();
  });

  it("keeps the close button disabled while it signs", () => {
    render(addPopup(signing("awaiting-signature")));

    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Close" })).toBeDisabled();
  });
});

describe("Your positions during a merge", () => {
  const merge: MergeInput = {
    session: session([branch(1)]),
    owner,
    balances: { branches: [{ outcome: 0n, up: 5n * WAD, down: 5n * WAD, invalid: 5n * WAD }], parentInvalid: 5n * WAD },
  };
  /** The branch merge's approvals and the merge itself, then the parent's. */
  const txs = planMerge(merge).txs;
  const BRANCH_MERGE = txs.findIndex((tx) => decode(tx).kind === "merge") + 1;
  const progress: LiquidityProgress = {
    stage: "signing",
    kind: "merge",
    rows: [row("branch:0", "done", BRANCH_MERGE, BRANCH_MERGE), row("parent", "running", 0, txs.length - BRANCH_MERGE)],
    signatures: { done: BRANCH_MERGE, total: txs.length },
    signature: { position: BRANCH_MERGE + 1, total: txs.length, status: "awaiting-signature" },
  };

  it("lists the merge's rows and names the signature it is on", () => {
    render(
      wrap(
        <LiquidityPositionsDialog
          isOpen
          onClose={() => {}}
          names={NAMES}
          positions={[]}
          run={runAt(progress)}
        />,
      ),
    );

    expect([bullet(`Merge ${NAMES[0]}`), bullet("Merge back to sDAI")]).toEqual(["done", "running"]);
    expect(statusText(dialog("Your positions"))).toBe(
      `Signature ${BRANCH_MERGE + 1} of ${txs.length}. Confirm in your wallet.`,
    );
  });
});

describe("Your positions while a seed holds the session", () => {
  it("lists no steps and says where to finish it", () => {
    render(
      wrap(
        <LiquidityPositionsDialog isOpen onClose={() => {}} names={NAMES} positions={[]} run={runAt(declined)} />,
      ),
    );

    expect(screen.queryAllByRole("listitem", { name: /^Timeline item/ })).toEqual([]);
    expect(statusText(dialog("Your positions"))).toMatch(/Adding liquidity from this wallet is unfinished/);
  });
});
