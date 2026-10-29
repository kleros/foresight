import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { formatDisplayAmount } from "@/utils/amount";

import { branch, decode, owner, session } from "../../flow/__tests__/support/session";
import { planMerge, planSeed } from "../../flow/plan";
import type { LiquidityRun } from "../../hooks/useLiquidityRun";
import type { ShownMerge, ShownPosition } from "../../hooks/useSessionLiquidity";
import { removeInput, SESSION } from "../../run/__tests__/support/requests";
import type { LiquidityProgress, LiquidityProgressRow, MergeInput, SeedInput, SessionPools } from "../../types";
import { LiquidityDialog } from "../LiquidityDialog";
import { LiquidityPositionsDialog } from "../LiquidityPositionsDialog";
import { LiquiditySection } from "../LiquiditySection";

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

function runAt(progress: LiquidityProgress, start: LiquidityRun["start"] = () => {}): LiquidityRun {
  const isRunning = progress.stage === "signing" || progress.stage === "confirming";
  return {
    progress,
    start,
    resume: () => {},
    retry: () => {},
    reset: () => {},
    discard: () => {},
    isRunning,
    isHeld: progress.stage !== "idle" && progress.stage !== "complete",
  };
}

const wrap = (children: ReactNode) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

/** The session's pools, none of them holding liquidity yet, and a wallet that can pay for the seed. */
const POOLS: SessionPools = {
  session: TWO,
  branches: TWO.branches.map(() => ({ up: { status: "missing" }, down: { status: "missing" } })),
};
const BALANCES = {
  branches: TWO.branches.map(() => ({ outcome: 0n, up: 0n, down: 0n, invalid: 0n })),
  parentInvalid: 0n,
  collateral: 100n * WAD,
  native: 100n * WAD,
};

const addPopup = (progress: LiquidityProgress, opts: { readable?: boolean; onClose?: () => void } = {}) =>
  wrap(
    <LiquidityDialog
      isOpen
      onClose={opts.onClose ?? (() => {})}
      names={NAMES}
      pools={opts.readable ? POOLS : undefined}
      owner={owner}
      balances={opts.readable ? BALANCES : undefined}
      chainTime={opts.readable ? input.chainTime : undefined}
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

    expect(statusText(dialog("Add liquidity"))).toBe(
      `Waiting for signature ${PARENT + BRANCH_0 + 1} of ${TOTAL} to confirm.`,
    );
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

  it("shows the amounts a recovered run signs, not the empty form, before Resume", () => {
    const stored = {
      ...input,
      total: 7n * WAD,
      branches: input.branches.map((branch, index) => ({
        ...branch,
        depth: (7n - BigInt(index)) * WAD,
        upPriceBps: 6_000n,
      })),
    };
    render(addPopup({ ...recovered, request: { kind: "seed", input: stored } }, { readable: true }));

    const popup = dialog("Add liquidity");
    expect(popup.querySelector<HTMLInputElement>('[data-id="total"]')!.value).toBe("7");
    expect(
      within(popup)
        .getAllByRole("textbox", { name: /Depth$/ })
        .map((field) => (field as HTMLInputElement).value),
    ).toEqual(["7", "6"]);
    expect(
      within(popup)
        .getAllByRole("textbox", { name: /UP price$/ })
        .map((field) => (field as HTMLInputElement).value),
    ).toEqual(["0.6", "0.6"]);
    expect(within(popup).getByRole("button", { name: "Resume" })).toBeEnabled();
  });

  it("shows a recovered xDAI run's own plan, every wei of it, not one made again from today's reads (L10)", () => {
    // the stored rate and total differ from anything the live reads would give, and the total has 18 decimals
    const stored: SeedInput = {
      ...input,
      collateral: "xDAI",
      total: 7n * WAD + 1n,
      previewDeposit: (63n * WAD) / 10n + 7n,
      branches: input.branches.map((branch) => ({ ...branch, depth: 6n * WAD + 1n, upPriceBps: 6_000n })),
    };
    const plan = planSeed(stored);
    render(addPopup({ ...recovered, request: { kind: "seed", input: stored } }, { readable: true }));

    const popup = dialog("Add liquidity");
    expect(popup.querySelector<HTMLInputElement>('[data-id="total"]')!.value).toBe("7.000000000000000001");
    for (const branch of plan.branches) {
      for (const pool of [branch.pools.up, branch.pools.down]) {
        for (const amount of [pool.amount0, pool.amount1]) {
          expect(
            within(popup).getAllByText(new RegExp(formatDisplayAmount(amount, 18).replace(".", "\\."))).length,
          ).toBeGreaterThan(0);
        }
      }
    }
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
      wrap(<LiquidityPositionsDialog isOpen onClose={() => {}} names={NAMES} positions={[]} run={runAt(progress)} />),
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
      wrap(<LiquidityPositionsDialog isOpen onClose={() => {}} names={NAMES} positions={[]} run={runAt(declined)} />),
    );

    expect(screen.queryAllByRole("listitem", { name: /^Timeline item/ })).toEqual([]);
    expect(statusText(dialog("Your positions"))).toMatch(/Adding liquidity from this wallet is unfinished/);
  });
});

const IDLE: LiquidityProgress = { stage: "idle", rows: [], signatures: { done: 0, total: 0 } };
const tone = (scope: HTMLElement) => within(scope).getByRole("status").getAttribute("data-tone");
const timelineItems = () => screen.queryAllByRole("listitem", { name: /^Timeline item/ });

/** Two positions in branch 0's pools: the UP pool's under token 78, the DOWN pool's under token 77. */
const position = (tokenId: bigint, pool: string): ShownPosition => {
  const base = removeInput();
  return {
    key: tokenId.toString(),
    pool,
    count: 1,
    returns: [{ label: "sDAI", amount: WAD }],
    request: { kind: "remove", session: SESSION, input: { ...base, positions: [{ ...base.positions[0]!, tokenId }] } },
  };
};
const UP_POOL = `${NAMES[0]} UP pool`;
const DOWN_POOL = `${NAMES[0]} DOWN pool`;
/** A pool row's Remove, whose name goes on to read out the amounts it returns. */
const removeButton = (pool: string) => new RegExp(`^Remove ${pool}, `);
const POSITIONS = [position(78n, UP_POOL), position(77n, DOWN_POOL)];
const MERGE: ShownMerge = {
  branches: [{ label: NAMES[0]!, amount: WAD }],
  parentMerge: WAD,
  request: { kind: "merge", input: { session: TWO, owner, balances: BALANCES } },
};

const removing = (stage: LiquidityProgress["stage"], tokenId: bigint, extra: Partial<LiquidityProgress> = {}) =>
  ({
    stage,
    kind: "remove",
    tokenIds: [tokenId],
    rows: [row("remove", stage === "review" ? "idle" : "running", 0, 1)],
    signatures: { done: 0, total: 1 },
    ...extra,
  }) satisfies LiquidityProgress;

const positionsPopup = (
  run: LiquidityRun,
  opts: { merge?: ShownMerge; onClose?: () => void; positions?: ShownPosition[]; unread?: boolean } = {},
) =>
  wrap(
    <LiquidityPositionsDialog
      isOpen
      onClose={opts.onClose ?? (() => {})}
      names={NAMES}
      positions={opts.positions ?? POSITIONS}
      positionsUnread={opts.unread}
      merge={opts.merge}
      run={run}
    />,
  );

describe("Your positions during a remove", () => {
  it("names the position the run withdraws, not the one pressed last", async () => {
    const view = render(positionsPopup(runAt(IDLE)));
    await userEvent.click(screen.getByRole("button", { name: removeButton(UP_POOL) }));

    // the stored run of token 77 was recovered for review in place of a new one
    view.rerender(positionsPopup(runAt(removing("review", 77n))));

    expect(timelineItems().map((each) => each.getAttribute("aria-label"))).toEqual([
      `Timeline item: Remove ${DOWN_POOL}`,
    ]);
  });

  it("still names the pool once the removed position drops out of the refetched list", async () => {
    const view = render(positionsPopup(runAt(IDLE)));
    await userEvent.click(screen.getByRole("button", { name: removeButton(DOWN_POOL) }));
    view.rerender(positionsPopup(runAt(removing("signing", 77n))));

    const done = removing("complete", 77n, { rows: [row("remove", "done", 1, 1)], signatures: { done: 1, total: 1 } });
    view.rerender(positionsPopup(runAt(done), { positions: [POSITIONS[0]!] }));

    expect(timelineItems().map((each) => each.getAttribute("aria-label"))).toEqual([
      `Timeline item: Remove ${DOWN_POOL}`,
    ]);
  });

  it("names the pool of a remove of several positions, and once they all burn, says positions", async () => {
    const base = removeInput({ tokenIds: [77n, 79n] });
    const pool: ShownPosition = {
      key: "0:down",
      pool: DOWN_POOL,
      count: 2,
      returns: [{ label: "sDAI", amount: WAD }],
      request: { kind: "remove", session: SESSION, input: base },
    };
    const both = { tokenIds: [77n, 79n] };
    const view = render(positionsPopup(runAt(removing("signing", 77n, both)), { positions: [pool] }));
    expect(timelineItems().map((each) => each.getAttribute("aria-label"))).toEqual([
      `Timeline item: Remove ${DOWN_POOL}`,
    ]);

    const done = removing("complete", 77n, { ...both, rows: [row("remove", "done", 1, 1)] });
    view.rerender(positionsPopup(runAt(done), { positions: [] }));
    expect(timelineItems().map((each) => each.getAttribute("aria-label"))).toEqual([
      "Timeline item: Remove the positions",
    ]);
  });

  it("says the one signature without a count, while the wallet asks and once it is broadcast", () => {
    const view = render(
      positionsPopup(
        runAt(removing("signing", 77n, { signature: { position: 1, total: 1, status: "awaiting-signature" } })),
      ),
    );
    expect(statusText(dialog("Your positions"))).toBe("Confirm in your wallet.");

    view.rerender(
      positionsPopup(runAt(removing("confirming", 77n, { signature: { position: 1, total: 1, status: "submitted" } }))),
    );
    expect(statusText(dialog("Your positions"))).toBe("Waiting for the transaction to confirm.");
  });

  it("keeps Close disabled and ignores Escape while it signs", async () => {
    const onClose = vi.fn();
    render(
      positionsPopup(
        runAt(removing("signing", 77n, { signature: { position: 1, total: 1, status: "awaiting-signature" } })),
        {
          onClose,
        },
      ),
    );

    expect(within(dialog("Your positions")).getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape once nothing runs", async () => {
    const onClose = vi.fn();
    render(positionsPopup(runAt(IDLE), { onClose }));

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

describe("Your positions' actions", () => {
  it("says the positions could not be read, not that the wallet holds none, while still offering the merge", () => {
    render(positionsPopup(runAt(IDLE), { positions: [], unread: true, merge: MERGE }));

    const popup = dialog("Your positions");
    expect(within(popup).getByText("Your positions could not be read.")).toBeVisible();
    expect(within(popup).queryByText(/holds no liquidity/)).toBeNull();
    expect(within(popup).getByRole("button", { name: "Merge" })).toBeEnabled();
  });

  it("offers Remove and Merge while no run holds the session", () => {
    render(positionsPopup(runAt(IDLE), { merge: MERGE }));

    const popup = dialog("Your positions");
    expect(within(popup).getByRole("button", { name: removeButton(UP_POOL) })).toBeEnabled();
    expect(within(popup).getByRole("button", { name: "Merge" })).toBeEnabled();
  });

  it("names two rows of one pool apart by the amounts each Remove reads out", () => {
    const up = position(78n, UP_POOL);
    const alone = { ...position(79n, UP_POOL), returns: [{ label: "Movie A UP", amount: (WAD * 5n) / 2n }] };
    render(positionsPopup(runAt(IDLE), { positions: [up, alone] }));

    const names = within(dialog("Your positions"))
      .getAllByRole("button", { name: removeButton(UP_POOL) })
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([`Remove ${UP_POOL}, 1 sDAI`, `Remove ${UP_POOL}, 2.5 Movie A UP`]);
  });

  it("disables Remove and Merge, and offers no way to carry the seed on, while a seed holds the session", () => {
    render(positionsPopup(runAt(declined), { merge: MERGE }));

    const popup = dialog("Your positions");
    expect(within(popup).getByRole("button", { name: removeButton(UP_POOL) })).toBeDisabled();
    expect(within(popup).getByRole("button", { name: removeButton(DOWN_POOL) })).toBeDisabled();
    expect(within(popup).getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(within(popup).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(popup).queryByRole("button", { name: "Start over" })).toBeNull();
  });
});

describe("the Add liquidity popup while a merge holds the session", () => {
  const mergeHalted: LiquidityProgress = {
    stage: "halted",
    failure: { reason: "rejected", retryable: true },
    kind: "merge",
    rows: [row("branch:0", "failed", 0, 3), row("parent", "idle", 0, 2)],
    signatures: { done: 0, total: 5 },
  };

  it("says where to finish it, lists none of its rows and offers none of its actions", () => {
    render(addPopup(mergeHalted));

    const popup = dialog("Add liquidity");
    expect(statusText(popup)).toMatch(/Removing or merging from this wallet is unfinished/);
    expect(timelineItems()).toEqual([]);
    expect(within(popup).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(popup).queryByRole("button", { name: "Start over" })).toBeNull();
  });

  it("keeps the form editable, but Add liquidity disabled", async () => {
    render(addPopup(mergeHalted, { readable: true }));

    const popup = dialog("Add liquidity");
    const total = within(popup).getByLabelText("Total");
    expect(total).not.toHaveAttribute("readonly");
    await userEvent.type(total, "10");
    expect(within(popup).getByRole("button", { name: "Add liquidity" })).toBeDisabled();
  });

  it("enables Add liquidity for the same form once nothing holds the session", async () => {
    render(addPopup(IDLE, { readable: true }));

    const popup = dialog("Add liquidity");
    await userEvent.type(within(popup).getByLabelText("Total"), "10");

    expect(within(popup).getByRole("button", { name: "Add liquidity" })).toBeEnabled();
  });
});

describe("the Add liquidity popup while its own seed is held", () => {
  it("keeps the form read-only", () => {
    render(addPopup(declined));

    expect(within(dialog("Add liquidity")).getByLabelText("Total")).toHaveAttribute("readonly");
  });

  it("ignores Escape while it signs", async () => {
    const onClose = vi.fn();
    render(addPopup(signing("awaiting-signature"), { onClose }));

    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the status line's tone and words", () => {
  it("warns, rather than errs, when what was sent may still land", () => {
    const view = render(addPopup({ ...declined, failure: { reason: "pending", retryable: true } }));
    expect(tone(dialog("Add liquidity"))).toBe("warning");

    view.rerender(addPopup(declined));
    expect(tone(dialog("Add liquidity"))).toBe("error");
  });

  it("says the chain is checked before a signature, and the button and the row say so too", () => {
    const at = PARENT + BRANCH_0 + 1;
    render(
      addPopup({ ...signing("awaiting-signature"), signature: { position: at, total: TOTAL, status: "building" } }),
    );

    const popup = dialog("Add liquidity");
    expect(statusText(popup)).toBe(`Checking the chain before signature ${at} of ${TOTAL}.`);
    expect(within(popup).getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(within(item(`Seed ${NAMES[1]}`)).getByText(`1 of ${BRANCH_1} · Checking…`)).toBeVisible();
  });

  it("puts the wallet's ask, or the wait to confirm, on the busy button", () => {
    const view = render(addPopup(signing("awaiting-signature")));
    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Confirm in your wallet" })).toBeDisabled();

    view.rerender(addPopup(signing("submitted")));
    expect(within(dialog("Add liquidity")).getByRole("button", { name: "Confirming…" })).toBeDisabled();
  });

  it("says how much of the stopped row went through", () => {
    render(
      addPopup({
        ...declined,
        rows: [
          row("parent", "done", PARENT, PARENT),
          row("branch:0", "failed", 2, BRANCH_0),
          row("branch:1", "idle", 0, BRANCH_1),
        ],
      }),
    );

    expect(within(item(`Seed ${NAMES[0]}`)).getByText(`2 of ${BRANCH_0} went through`)).toBeVisible();
  });

  it("says a batch's rows were signed in one batch", () => {
    render(
      addPopup({
        stage: "complete",
        kind: "seed",
        atomic: true,
        rows: [
          row("parent", "done", PARENT, PARENT),
          row("branch:0", "done", BRANCH_0, BRANCH_0),
          row("branch:1", "done", BRANCH_1, BRANCH_1),
        ],
        signatures: { done: 1, total: 1 },
      }),
    );

    expect(within(item("Split into outcomes")).getByText("In one batch")).toBeVisible();
    expect(within(item(`Seed ${NAMES[1]}`)).getByText("In one batch")).toBeVisible();
  });
});

describe("the market page's Liquidity section", () => {
  it("offers Your positions where only complete sets can merge", () => {
    render(wrap(<LiquiditySection onAdd={() => {}} names={NAMES} positions={[]} merge={MERGE} run={runAt(IDLE)} />));

    expect(screen.getByRole("button", { name: "Your positions" })).toBeEnabled();
  });

  it("opens Add liquidity, where a recovered seed's amounts show, instead of resuming it from the section", async () => {
    const onAdd = vi.fn();
    const run = { ...runAt(recovered), resume: vi.fn() };
    render(wrap(<LiquiditySection onAdd={onAdd} names={NAMES} positions={POSITIONS} run={run} />));

    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(run.resume).not.toHaveBeenCalled();
  });

  it("shows a held merge's stored amounts in Your positions, not what today's balances would merge", async () => {
    const storedInput: MergeInput = {
      session: TWO,
      owner,
      balances: {
        branches: TWO.branches.map(() => ({ outcome: 0n, up: 5n * WAD, down: 5n * WAD, invalid: 5n * WAD })),
        parentInvalid: 0n,
      },
    };
    const run = {
      ...runAt({
        stage: "review",
        kind: "merge",
        request: { kind: "merge", input: storedInput },
        rows: [],
        signatures: { done: 0, total: 1 },
      }),
    };
    render(wrap(<LiquiditySection onAdd={() => {}} names={NAMES} positions={[]} merge={MERGE} run={run} />));

    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    const merge = within(dialog("Your positions")).getByRole("region", { name: "Merge" });
    planMerge(storedInput).branches.forEach((each, index) =>
      expect(merge).toHaveTextContent(`${formatDisplayAmount(each.merge, 18)} ${NAMES[index]}`),
    );
    expect(merge).not.toHaveTextContent(`${formatDisplayAmount(MERGE.branches[0]!.amount, 18)} ${NAMES[0]}`);
  });

  it("opens Your positions for a recovered remove instead of resuming it from the section", async () => {
    const run = { ...runAt(removing("review", 77n)), resume: vi.fn() };
    render(wrap(<LiquiditySection onAdd={() => {}} names={NAMES} positions={POSITIONS} run={run} />));

    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(dialog("Your positions")).toBeVisible();
    expect(run.resume).not.toHaveBeenCalled();
  });
});
