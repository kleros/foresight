import { describe, expect, it } from "vitest";

import type { SessionDeployProgress } from "../../deploy/types";
import { interrupted, stagesFor, unfinished } from "../deployStages";

/**
 * The two sequences differ in shape, not just in length: phased carries a row
 * per batch that the atomic path never has.
 */

const progress = (over: Partial<SessionDeployProgress> = {}): SessionDeployProgress => ({
  stage: "idle",
  mode: "atomic",
  batch: 1,
  batches: 1,
  parent: { state: "pending" },
  children: [],
  batchSteps: [],
  ...over,
});

const HASH = `0x${"ab".repeat(32)}`;

describe("stagesFor, the upload row", () => {
  it("pluralizes the image count", () => {
    expect(stagesFor(progress(), 1, 3)[0].label).toBe("Uploading 1 image and the session details");
    expect(stagesFor(progress(), 2, 3)[0].label).toBe("Uploading 2 images and the session details");
  });

  it("omits the image count when there are no images", () => {
    expect(stagesFor(progress(), 0, 3)[0].label).toBe("Uploading the session details");
  });

  it("speaks of the read-back only while it is happening", () => {
    expect(stagesFor(progress({ stage: "uploading" }), 0, 3)[0].detail).toBe("");
    expect(stagesFor(progress({ stage: "verifying" }), 0, 3)[0].detail).toBe("Reading it back and checking it");
  });

  it("links what was uploaded, once the document is on IPFS", () => {
    const uploaded = progress({
      stage: "signing",
      metadataUri: "/ipfs/QmDocument",
      images: { hero: "/ipfs/QmHero", icon: "/ipfs/QmIcon" },
    });

    expect(stagesFor(uploaded, 2, 3)[0].files).toEqual([
      { label: "Icon", uri: "/ipfs/QmIcon" },
      { label: "Hero", uri: "/ipfs/QmHero" },
      { label: "Details", uri: "/ipfs/QmDocument" },
    ]);
  });

  it("links only the images that exist", () => {
    const uploaded = progress({ metadataUri: "/ipfs/QmDocument", images: { hero: "/ipfs/QmHero" } });

    expect(stagesFor(uploaded, 1, 3)[0].files?.map((file) => file.label)).toEqual(["Hero", "Details"]);
  });

  it("has nothing to link before anything is uploaded", () => {
    expect(stagesFor(progress({ stage: "uploading" }), 2, 3)[0].files).toBeUndefined();
  });

  // The uri outlives the stage that produced it, so a run stopped further down
  // still shows its upload as done rather than reverting to waiting.
  it("counts the upload as done from the uri, not from the stage", () => {
    expect(stagesFor(progress({ stage: "uploading" }), 0, 3)[0].state).toBe("active");
    expect(stagesFor(progress({ stage: "halted", metadataUri: "/ipfs/QmDocument" }), 0, 3)[0].state).toBe("done");
  });

  // The document is uploaded but unproven here, so the row is still working.
  it("stays running through the read-back", () => {
    expect(stagesFor(progress({ stage: "verifying" }), 0, 3)[0].state).toBe("active");
  });
});

describe("stagesFor, atomic", () => {
  it("lists the stages in order", () => {
    const stages = stagesFor(progress({ mode: "atomic" }), 0, 12);

    expect(stages.map((s) => s.label)).toEqual([
      "Uploading the session details",
      "Creating the decision market and 12 branch markets",
      "Indexing session",
    ]);
  });

  it("carries the transaction on the row that creates the markets", () => {
    const stages = stagesFor(progress({ parent: { state: "success", hash: HASH } }), 0, 3);

    expect(stages[1]).toMatchObject({ state: "done", hash: HASH });
  });
});

/** Waiting on the wallet is the creator's to act on; waiting on the chain is not. */
describe("stagesFor, the wallet hint", () => {
  const signing = (over: Partial<SessionDeployProgress>) => progress({ stage: "signing", ...over });

  it("asks for a confirmation on the row the wallet is open for", () => {
    expect(stagesFor(signing({ parent: { state: "running" } }), 0, 3)[1]?.detail).toBe("Confirm in your wallet");
  });

  it("says nothing once the transaction is out there and the chain has it", () => {
    expect(stagesFor(progress({ stage: "confirming", parent: { state: "running" } }), 0, 3)[1]?.detail).toBe("");
  });

  it("says nothing on a row whose turn has not come", () => {
    expect(stagesFor(signing({ parent: { state: "pending" } }), 0, 3)[1]?.detail).toBe("");
  });

  it("keeps the branches a batch creates beside the ask", () => {
    const batchSigning = signing({
      mode: "phased",
      batches: 2,
      parent: { state: "success" },
      batchSteps: [{ state: "running" }, { state: "pending" }],
    });

    expect(stagesFor(batchSigning, 0, 7)[2]?.detail).toBe("Branches 1-6 · Confirm in your wallet");
  });
});

describe("stagesFor, phased", () => {
  const phased = (over: Partial<SessionDeployProgress> = {}) =>
    progress({ mode: "phased", batches: 3, parent: { state: "success" }, ...over });

  it("gives every batch its own row, named by the branches it creates", () => {
    const stages = stagesFor(phased(), 0, 14);

    expect(stages.map((s) => s.label)).toEqual([
      "Uploading the session details",
      "Creating the decision market",
      "Branch markets, batch 1 of 3",
      "Branch markets, batch 2 of 3",
      "Branch markets, batch 3 of 3",
      "Indexing session",
    ]);
    expect(stages.slice(2, 5).map((s) => s.detail)).toEqual(["Branches 1-6", "Branches 7-12", "Branches 13-14"]);
  });

  it("names a single-branch batch in the singular", () => {
    expect(stagesFor(phased({ batches: 2 }), 0, 7)[3]?.detail).toBe("Branch 7");
  });

  it("keeps each batch's own transaction, whichever one is in flight", () => {
    const other = `0x${"cd".repeat(32)}`;
    const stages = stagesFor(
      phased({
        batchSteps: [{ state: "success", hash: HASH }, { state: "running", hash: other }, { state: "pending" }],
      }),
      0,
      14,
    );

    expect(stages[2]).toMatchObject({ state: "done", hash: HASH });
    expect(stages[3]).toMatchObject({ state: "active", hash: other });
    expect(stages[4]).toMatchObject({ state: "todo", hash: undefined });
  });

  it("marks the batch that stopped as failed", () => {
    const stages = stagesFor(phased({ stage: "halted", batchSteps: [{ state: "error", hash: HASH }] }), 0, 14);

    expect(stages[2]?.state).toBe("failed");
  });

  // A recovered run is planned before its steps are, so the rows exist before
  // there is anything to say about them.
  it("waits on a batch the run has no entry for", () => {
    expect(stagesFor(phased({ batchSteps: [] }), 0, 14)[4]?.state).toBe("todo");
  });
});

describe("stagesFor, the indexing row", () => {
  it("runs while indexing and settles when the run completes", () => {
    expect(stagesFor(progress({ stage: "confirming" }), 0, 3).at(-1)?.state).toBe("todo");
    expect(stagesFor(progress({ stage: "indexing" }), 0, 3).at(-1)?.state).toBe("active");
    expect(stagesFor(progress({ stage: "complete" }), 0, 3).at(-1)?.state).toBe("done");
  });
});

describe("unfinished", () => {
  const stopped = (over: Partial<SessionDeployProgress>) => progress({ stage: "halted", ...over });

  it("names a live session with a branch market missing", () => {
    const halfDeployed = stopped({
      parent: { state: "success" },
      children: [{ state: "success" }, { state: "pending" }],
    });

    expect(unfinished(halfDeployed)).toBe(true);
  });

  it("passes over a session whose decision market never landed", () => {
    expect(unfinished(stopped({ children: [{ state: "pending" }] }))).toBe(false);
  });

  it("passes over a session with every branch market created", () => {
    expect(unfinished(stopped({ parent: { state: "success" }, children: [{ state: "success" }] }))).toBe(false);
  });

  it("passes over a run that is still going", () => {
    const confirming = progress({
      stage: "confirming",
      parent: { state: "success" },
      children: [{ state: "pending" }],
    });

    expect(unfinished(confirming)).toBe(false);
  });
});

describe("interrupted", () => {
  const offered: SessionDeployProgress["resume"] = {
    stepId: "parent",
    label: "Create the decision market",
    outcome: "unknown",
    canSelfCheck: true,
  };

  it("names a run found in storage that has yet to reach the chain", () => {
    const recovered = progress({ stage: "halted", children: [{ state: "pending" }], resume: offered });

    expect(interrupted(recovered)).toBe(true);
  });

  it("names a live session with a branch market missing", () => {
    const halfDeployed = progress({
      stage: "halted",
      parent: { state: "success" },
      children: [{ state: "success" }, { state: "pending" }],
    });

    expect(interrupted(halfDeployed)).toBe(true);
  });

  it("passes over a deploy nobody has started", () => {
    expect(interrupted(progress({ children: [{ state: "pending" }] }))).toBe(false);
  });
});
