import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { shortHash } from "@/utils/hash";

import type { SessionDeployProgress } from "../../deploy/types";
import { batchCount, CHILD_BATCH_SIZE, deployMode } from "../../flow/params";
import { useDraftStore } from "../../stores/draftStore";
import { ResumeBanner } from "../ResumeBanner";

const TWO_BATCHES = CHILD_BATCH_SIZE + 1;
const OPENED_BY = `0x${"e1".repeat(32)}`;

/** Fills the draft with enough outcomes to push the deploy into phased mode. */
function seedDraft(outcomeCount: number) {
  const store = () => useDraftStore.getState();
  store().resetDraft();
  while (store().draft.outcomes.length < outcomeCount) store().addOutcome();
  store().setDraftField("title", "Who directs the sequel?");
  store().setDraftField("name", "Which director?");
  store().draft.outcomes.forEach((o, i) => store().patchOutcome(o.id, { label: `Director ${i + 1}` }));
}

const progressOf = (outcomeCount: number, over: Partial<SessionDeployProgress> = {}): SessionDeployProgress => ({
  stage: "halted",
  mode: deployMode(outcomeCount),
  batch: 1,
  batches: batchCount(outcomeCount),
  parent: { state: "pending" },
  children: Array.from({ length: outcomeCount }, () => ({ state: "pending" as const })),
  batchSteps: [],
  ...over,
});

/** The lists are told apart by their headings, which is how the screen tells them apart. */
const listUnder = (heading: string) => within(screen.getByText(heading).parentElement as HTMLElement);

beforeEach(() => {
  localStorage.clear();
});

describe("ResumeBanner, a session already on chain", () => {
  const halfDeployed = () =>
    progressOf(TWO_BATCHES, {
      parent: { state: "success", hash: OPENED_BY },
      children: [
        ...Array.from({ length: CHILD_BATCH_SIZE }, () => ({ state: "success" as const })),
        { state: "pending" },
      ],
    });

  it("says the session is live but unfinished", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={halfDeployed()} onContinue={() => {}} />);

    expect(screen.getByText(/Who directs the sequel\? is live, but unfinished/)).toBeInTheDocument();
  });

  it("puts the decision market on-chain, with the transaction that opened it", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={halfDeployed()} onContinue={() => {}} />);

    const created = listUnder("Already on-chain");
    expect(created.getByText("Which director?")).toBeInTheDocument();
    expect(created.getByText(shortHash(OPENED_BY))).toBeInTheDocument();
  });

  it("lists only the branches that are missing as missing", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={halfDeployed()} onContinue={() => {}} />);

    const missing = listUnder("Still missing");
    expect(missing.getByText(new RegExp(`^Director ${TWO_BATCHES}:`))).toBeInTheDocument();
    expect(missing.queryByText(/^Director 1:/)).toBeNull();
  });
});

/** The last batch mined after the tab went away, so the chain is done and the run is not. */
describe("ResumeBanner, a session whose markets all exist", () => {
  const allCreated = () =>
    progressOf(TWO_BATCHES, {
      parent: { state: "success", hash: OPENED_BY },
      children: Array.from({ length: TWO_BATCHES }, () => ({ state: "success" as const })),
      resume: { stepId: "children-2", label: "Create branch 7", outcome: "confirmed", canSelfCheck: true },
    });

  it("does not claim a branch market is missing", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={allCreated()} onContinue={() => {}} />);

    expect(screen.getByText(/is on chain, one step from done/)).toBeInTheDocument();
    expect(screen.queryByText("Still missing")).toBeNull();
  });
});

describe("ResumeBanner, a run that never reached the chain", () => {
  const nothingLanded = () =>
    progressOf(TWO_BATCHES, {
      resume: { stepId: "parent", label: "Create the decision market", outcome: "unknown", canSelfCheck: true },
    });

  it("says the deploy stopped rather than that the session is live", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={nothingLanded()} onContinue={() => {}} />);

    expect(screen.getByText(/Who directs the sequel\? has a deploy that stopped/)).toBeInTheDocument();
  });

  it("claims nothing is on chain", () => {
    seedDraft(TWO_BATCHES);

    render(<ResumeBanner progress={nothingLanded()} onContinue={() => {}} />);

    expect(screen.queryByText("Already on-chain")).toBeNull();
    expect(listUnder("Still missing").getByText("Which director?")).toBeInTheDocument();
  });

  it("offers to pick the deploy back up", async () => {
    seedDraft(TWO_BATCHES);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBanner progress={nothingLanded()} onContinue={onContinue} />);

    await user.click(screen.getByRole("button", { name: "Continue where it stopped" }));

    expect(onContinue).toHaveBeenCalled();
  });
});
