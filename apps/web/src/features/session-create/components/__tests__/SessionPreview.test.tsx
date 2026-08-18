import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionDeployProgress } from "../../deploy/types";
import { batchCount, deployMode } from "../../flow/params";
import { useDraftStore } from "../../stores/draftStore";
import { SessionPreview } from "../SessionPreview";

const OUTCOMES = 2;
const LISTED = "This is how the session will be listed once deployed.";

function seedDraft() {
  const store = () => useDraftStore.getState();
  store().resetDraft();
  store().setDraftField("title", "Who directs the sequel?");
  store().setDraftField("name", "Which director?");
  store().draft.outcomes.forEach((o, i) => store().patchOutcome(o.id, { label: `Director ${i + 1}` }));
}

const progressOf = (over: Partial<SessionDeployProgress> = {}): SessionDeployProgress => ({
  stage: "idle",
  mode: deployMode(OUTCOMES),
  batch: 1,
  batches: batchCount(OUTCOMES),
  parent: { state: "pending" },
  children: Array.from({ length: OUTCOMES }, () => ({ state: "pending" as const })),
  batchSteps: [],
  ...over,
});

/** Step 5 is the one that shows the deploy's own state. */
const renderPreview = (progress: SessionDeployProgress) =>
  render(<SessionPreview step={5} activeBranch={null} progress={progress} />);

beforeEach(() => {
  localStorage.clear();
  seedDraft();
});

describe("SessionPreview, while a deploy is under way", () => {
  const SKELETON = /Building the session page while it is indexed/;

  it("waits before there is a decision market to draw a card from", () => {
    renderPreview(progressOf({ stage: "signing" }));

    expect(screen.getByText(SKELETON)).toBeInTheDocument();
  });

  /** Phased signs once per batch, so this stage lasts as long as the whole deploy. */
  it("draws the card once the decision market exists, with batches still to sign", () => {
    const midFlight = progressOf({
      stage: "confirming",
      parent: { state: "success" },
      children: [{ state: "success" }, { state: "pending" }],
    });

    renderPreview(midFlight);

    expect(screen.queryByText(SKELETON)).toBeNull();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText(/Director 2 \(missing\)/)).toBeInTheDocument();
  });

  it("waits again while the session is being indexed", () => {
    const indexing = progressOf({
      stage: "indexing",
      parent: { state: "success" },
      children: [{ state: "success" }, { state: "success" }],
    });

    renderPreview(indexing);

    expect(screen.getByText(SKELETON)).toBeInTheDocument();
  });
});

describe("SessionPreview, on the deploy step", () => {
  it("says what the card will look like while nothing has been deployed", () => {
    renderPreview(progressOf());

    expect(screen.getByText(LISTED)).toBeInTheDocument();
  });

  it("marks the branches that are missing rather than explaining that they are", () => {
    const halfDeployed = progressOf({
      stage: "halted",
      parent: { state: "success" },
      children: [{ state: "success" }, { state: "pending" }],
    });

    renderPreview(halfDeployed);

    expect(screen.getByText(/Director 2 \(missing\)/)).toBeInTheDocument();
    // The chips carry it; a caption repeating them is noise.
    expect(screen.queryByText(LISTED)).toBeNull();
  });
});
