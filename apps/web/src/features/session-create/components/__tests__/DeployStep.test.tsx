import { readFileSync } from "node:fs";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { shortHash } from "@/utils/hash";

import { draftAssessment } from "../../__tests__/support/drafts";
import type { SessionDeployDriver, SessionDeployProgress } from "../../deploy/types";
import { batchCount, CHILD_BATCH_SIZE, deployMode } from "../../flow/params";
import { useDraftStore } from "../../stores/draftStore";
import { DeployStep } from "../DeployStep";

const TWO_BATCHES = CHILD_BATCH_SIZE + 2;
const HASH = `0x${"ab".repeat(32)}`;
const GATEWAY = "https://gateway.test/ipfs";

const READY = draftAssessment();

/** Fills the draft with enough outcomes to push the deploy into phased mode. */
function seedDraft(outcomeCount: number) {
  const store = () => useDraftStore.getState();
  store().resetDraft();
  while (store().draft.outcomes.length < outcomeCount) store().addOutcome();
  store().setDraftField("name", "Which director?");
  store().setDraftField("template", "Gross if {outcome} directs");
  store().setDraftField("unit", "$M");
  store().draft.outcomes.forEach((o, i) => store().patchOutcome(o.id, { label: `Director ${i + 1}` }));
}

const progressOf = (outcomeCount: number, over: Partial<SessionDeployProgress> = {}): SessionDeployProgress => ({
  stage: "idle",
  mode: deployMode(outcomeCount),
  batch: 1,
  batches: batchCount(outcomeCount),
  parent: { state: "pending" },
  children: Array.from({ length: outcomeCount }, () => ({ state: "pending" as const })),
  batchSteps: [],
  ...over,
});

/** The step only ever tells the driver things, so recording the calls is enough. */
function stubDriver(): SessionDeployDriver {
  return {
    start: vi.fn(),
    recover: vi.fn(),
    continueRecovered: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    getProgress: () => progressOf(0),
    subscribe: () => () => {},
  };
}

const succeeded = (count: number) => Array.from({ length: count }, () => ({ state: "success" as const }));

type StepOverrides = Partial<React.ComponentProps<typeof DeployStep>>;

/** The step renders from `progress` alone; the driver is only there to be told things. */
function renderStep(outcomeCount: number, overrides: StepOverrides = {}) {
  return render(
    <DeployStep
      assessment={READY}
      active
      walletConnected
      walletSlot={null}
      signedIn
      signInSlot={null}
      progress={progressOf(outcomeCount)}
      driver={stubDriver()}
      gateway={GATEWAY}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("DeployStep, atomic session", () => {
  it("creates every market in one stage and enables deploy", () => {
    seedDraft(3);

    renderStep(3);

    expect(screen.getByText("Creating the decision market and 3 branch markets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeEnabled();
  });
});

describe("DeployStep, phased session", () => {
  it("names the batch in flight and deploys the decision market first", () => {
    seedDraft(TWO_BATCHES);

    renderStep(TWO_BATCHES);

    expect(screen.getByText("Creating the decision market")).toBeInTheDocument();
    expect(screen.getByText("Branch markets, batch 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Branch markets, batch 2 of 2")).toBeInTheDocument();
  });

  it("gives each batch its own transaction", () => {
    seedDraft(TWO_BATCHES);
    const second = `0x${"cd".repeat(32)}`;
    const running = progressOf(TWO_BATCHES, {
      stage: "confirming",
      parent: { state: "success", hash: HASH },
      batchSteps: [{ state: "success", hash: second }, { state: "running" }],
    });

    renderStep(TWO_BATCHES, { progress: running });

    const timeline = within(screen.getByRole("status"));
    expect(timeline.getByText(shortHash(HASH))).toBeInTheDocument();
    expect(timeline.getByText(shortHash(second))).toBeInTheDocument();
  });

  it("names a session left open with branch markets missing", () => {
    seedDraft(TWO_BATCHES);
    // The first batch landed, the second stopped.
    const stopped = progressOf(TWO_BATCHES, {
      stage: "halted",
      batch: 2,
      parent: { state: "success" },
      children: [...succeeded(CHILD_BATCH_SIZE), { state: "pending" }, { state: "pending" }],
    });

    renderStep(TWO_BATCHES, { progress: stopped });

    expect(screen.getByText(`Session opened, 2 of ${TWO_BATCHES} branch markets missing`)).toBeInTheDocument();
    // Shares a line with the batch count, so matched rather than read whole.
    expect(
      screen.getByText(new RegExp(`${CHILD_BATCH_SIZE} of ${TWO_BATCHES} branch markets exist`)),
    ).toBeInTheDocument();
    expect(screen.getByText(`${CHILD_BATCH_SIZE + 1} of ${TWO_BATCHES + 1} created`)).toBeInTheDocument();
  });

  it("reports every market created once the batches are through", () => {
    seedDraft(TWO_BATCHES);
    const done = progressOf(TWO_BATCHES, {
      stage: "complete",
      batch: 2,
      parent: { state: "success" },
      children: succeeded(TWO_BATCHES),
    });

    renderStep(TWO_BATCHES, { progress: done });

    expect(screen.getByText("Deployed")).toBeInTheDocument();
    expect(screen.getByText("Needs liquidity to be tradable")).toBeInTheDocument();
    expect(screen.getByText(`${TWO_BATCHES + 1} of ${TWO_BATCHES + 1} created`)).toBeInTheDocument();
  });

  it("keeps the deployment details folded away until they are asked for", async () => {
    seedDraft(TWO_BATCHES);
    const user = userEvent.setup();
    const done = progressOf(TWO_BATCHES, {
      stage: "complete",
      parent: { state: "success" },
      children: succeeded(TWO_BATCHES),
    });

    renderStep(TWO_BATCHES, { progress: done });

    const details = screen.getByRole("button", { name: /Deployment details/ });
    expect(details).toHaveAttribute("aria-expanded", "false");

    await user.click(details);

    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Copy JSON")).toBeInTheDocument();
  });
});

describe("DeployStep, the stage timeline", () => {
  it("lists the stages before anything is signed", () => {
    seedDraft(3);

    renderStep(3);

    expect(screen.getByText(/Uploading the session details/)).toBeInTheDocument();
    expect(screen.getByText("Indexing session")).toBeInTheDocument();
  });

  it("carries no transaction before anything is signed", () => {
    seedDraft(3);

    renderStep(3);

    expect(screen.queryByText(shortHash(HASH))).toBeNull();
  });

  it("links what was uploaded, each opening on its own", () => {
    seedDraft(3);
    const uploaded = progressOf(3, {
      stage: "signing",
      metadataUri: "/ipfs/QmDocument",
      images: { hero: "/ipfs/QmHero", icon: "/ipfs/QmIcon" },
    });

    renderStep(3, { progress: uploaded });

    const timeline = within(screen.getByRole("status"));
    expect(timeline.getByRole("link", { name: "Icon" })).toHaveAttribute("href", `${GATEWAY}/QmIcon`);
    expect(timeline.getByRole("link", { name: "Hero" })).toHaveAttribute("href", `${GATEWAY}/QmHero`);
    expect(timeline.getByRole("link", { name: "Details" })).toHaveAttribute("target", "_blank");
  });

  it("dims a stage that is over and leaves the rest alone", () => {
    seedDraft(3);
    const confirming = progressOf(3, { stage: "confirming", metadataUri: "/ipfs/QmDocument" });

    renderStep(3, { progress: confirming });

    // The library dims what it is told is disabled; the row is found by the
    // label it puts on every item.
    expect(screen.getByLabelText("Timeline item: Uploading the session details")).toHaveClass("opacity-50");
    expect(screen.getByLabelText("Timeline item: Indexing session")).not.toHaveClass("opacity-50");
  });

  it("shows the transaction for a stage once it has one", () => {
    seedDraft(3);
    const confirming = progressOf(3, { stage: "confirming", parent: { state: "running", hash: HASH } });

    renderStep(3, { progress: confirming });

    // Scoped to the timeline: the market rows show the same hash, so an
    // unscoped query would pass even if the timeline carried none. Locally
    // there is no explorer, so this is text rather than a link, and which of
    // the two it is belongs to TxHashLink's own tests.
    expect(within(screen.getByRole("status")).getByText(shortHash(HASH))).toBeInTheDocument();
  });
});

describe("DeployStep, a stopped run", () => {
  const halted = (failure: SessionDeployProgress["failure"]) =>
    progressOf(3, {
      stage: "halted",
      children: [{ state: "error" }, { state: "pending" }, { state: "pending" }],
      failure,
    });

  it("shows the failure message and a retry", async () => {
    seedDraft(3);
    const driver = stubDriver();
    const user = userEvent.setup();
    renderStep(3, {
      driver,
      progress: halted({ message: "The wallet rejected the request.", retryable: true }),
    });

    expect(screen.getByText("Deploy stopped")).toBeInTheDocument();
    expect(screen.getByText("The wallet rejected the request.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(driver.retry).toHaveBeenCalled();
  });

  it("offers reset instead of retry when a failure is not retryable", () => {
    seedDraft(3);

    renderStep(3, {
      progress: halted({
        message: "The parent market transaction confirmed without a session id in its logs.",
        retryable: false,
      }),
    });

    expect(screen.getByText("Deploy failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument();
    // Including the per-market one.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

/**
 * The stylesheet reaches into the timeline by class name, which no compiler
 * checks. Renaming either side loses the layout and reddens nothing else.
 */
describe("DeployStep, the stage detail line", () => {
  // From the project root: vitest runs there, and `import.meta.url` is not a file url under its transform.
  const STYLESHEET = readFileSync("src/styles/tokens/foresight-components.css", "utf8");

  it("carries the class the stylesheet gives its own line to", () => {
    seedDraft(3);
    renderStep(3, { progress: progressOf(3, { stage: "verifying" }) });

    const selected = /\.fs-narrative :has\(> \.([\w-]+)\)/.exec(STYLESHEET)?.[1];
    const detail = screen.getByText("Reading it back and checking it").parentElement;

    expect(selected).toBeDefined();
    expect([...(detail?.classList ?? [])]).toContain(selected);
  });
});

describe("DeployStep, blocked states", () => {
  it("disables deploy while the draft has unresolved issues", () => {
    seedDraft(3);

    renderStep(3, {
      assessment: draftAssessment({
        issues: [{ step: 1, text: "The decision has no question." }],
        steps: { parent: false, children: true, display: true },
      }),
    });

    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
    expect(screen.getByText(/1 unresolved above/)).toBeInTheDocument();
  });

  it("asks for a wallet before deploying", () => {
    seedDraft(3);

    renderStep(3, { walletConnected: false, walletSlot: <button type="button">Connect</button> });

    expect(screen.getByText("No wallet connected.")).toBeInTheDocument();
    expect(screen.getByText(/stays in this browser/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("asks for a sign-in before deploying", () => {
    seedDraft(3);

    renderStep(3, { signedIn: false, signInSlot: <button type="button">Sign in</button> });

    expect(screen.getByText("Sign in to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // Still visible, so the deploy stays where the eye expects it.
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("asks for no sign-in to continue a run whose document is already on IPFS", () => {
    seedDraft(3);
    const recovered = progressOf(3, { stage: "halted", metadataUri: "/ipfs/QmDocument" });

    renderStep(3, { progress: recovered, signedIn: false, signInSlot: <button type="button">Sign in</button> });

    expect(screen.queryByText("Sign in to continue.")).toBeNull();
  });

  it("still asks for the wallet to continue a run whose document is already on IPFS", () => {
    seedDraft(3);
    const recovered = progressOf(3, { stage: "halted", metadataUri: "/ipfs/QmDocument" });

    renderStep(3, { progress: recovered, walletConnected: false, walletSlot: <button type="button">Connect</button> });

    expect(screen.getByText("No wallet connected.")).toBeInTheDocument();
  });
});
