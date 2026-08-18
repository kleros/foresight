import { type MarketDeployState, type SessionDeployProgress } from "../deploy/types";
import { CHILD_BATCH_SIZE } from "../flow/params";

/**
 * The deploy screen's view model
 */

export type StageState = "todo" | "active" | "done" | "failed";

/** Something this stage put on IPFS, as a uri to resolve against a gateway. */
export type StageFile = { label: string; uri: string };

export type DeployStage = {
  label: string;
  detail: string;
  state: StageState;
  /** Set once this stage has a transaction to point at. */
  hash?: string;
  files?: StageFile[];
};

export function unfinished(progress: SessionDeployProgress): boolean {
  if (progress.stage !== "halted") return false;
  return progress.parent.state === "success" && progress.children.some((child) => child.state !== "success");
}

/**
 * A deploy the wizard has to arrive back into: a live session missing branches,
 * or a run found in storage that has yet to reach the chain at all.
 */
export function interrupted(progress: SessionDeployProgress): boolean {
  return Boolean(progress.resume) || unfinished(progress);
}

const AS_STAGE: Record<MarketDeployState, StageState> = {
  pending: "todo",
  running: "active",
  success: "done",
  error: "failed",
};

/** The branches a phased batch creates, numbered as the creator numbered them. */
function branchesIn(batchNumber: number, outcomeCount: number): string {
  const first = (batchNumber - 1) * CHILD_BATCH_SIZE + 1;
  const last = Math.min(batchNumber * CHILD_BATCH_SIZE, outcomeCount);
  return first === last ? `Branch ${first}` : `Branches ${first}-${last}`;
}

function uploadStage(progress: SessionDeployProgress, imageCount: number): DeployStage {
  const what =
    imageCount > 0
      ? `${imageCount} ${imageCount === 1 ? "image" : "images"} and the session details`
      : "the session details";

  const files: StageFile[] = [];
  if (progress.images?.icon) files.push({ label: "Icon", uri: progress.images.icon });
  if (progress.images?.hero) files.push({ label: "Hero", uri: progress.images.hero });
  if (progress.metadataUri) files.push({ label: "Details", uri: progress.metadataUri });

  const running = progress.stage === "uploading" || progress.stage === "verifying";

  return {
    label: `Uploading ${what}`,
    detail: progress.stage === "verifying" ? "Reading it back and checking it" : "",
    // The uri is what proves the upload landed: it is only set after the
    // read-back, and it outlives the stage that produced it.
    state: progress.metadataUri ? "done" : running ? "active" : "todo",
    files: files.length > 0 ? files : undefined,
  };
}

function walletHint(progress: SessionDeployProgress, state: MarketDeployState): string {
  return progress.stage === "signing" && state === "running" ? "Confirm in your wallet" : "";
}

/** A stage detail, with the wallet hint added where the wallet is what it waits on. */
function detailWith(hint: string, detail = ""): string {
  return [detail, hint].filter(Boolean).join(" · ");
}

/** The stages the deploy actually goes through, in order. */
export function stagesFor(
  progress: SessionDeployProgress,
  imageCount: number,
  outcomeCount: number,
): [DeployStage, ...DeployStage[]] {
  const upload = uploadStage(progress, imageCount);
  const indexing: DeployStage = {
    label: "Indexing session",
    detail: "",
    state: progress.stage === "complete" ? "done" : progress.stage === "indexing" ? "active" : "todo",
  };

  if (progress.mode === "atomic") {
    return [
      upload,
      {
        label: `Creating the decision market and ${outcomeCount} branch markets`,
        detail: walletHint(progress, progress.parent.state),
        state: AS_STAGE[progress.parent.state],
        hash: progress.parent.hash,
      },
      indexing,
    ];
  }

  return [
    upload,
    {
      label: "Creating the decision market",
      detail: walletHint(progress, progress.parent.state),
      state: AS_STAGE[progress.parent.state],
      hash: progress.parent.hash,
    },
    // One row per batch, so each carries its own transaction.
    ...Array.from({ length: progress.batches }, (_, index): DeployStage => {
      const batch = progress.batchSteps[index] ?? { state: "pending" as const };
      return {
        label: `Branch markets, batch ${index + 1} of ${progress.batches}`,
        detail: detailWith(walletHint(progress, batch.state), branchesIn(index + 1, outcomeCount)),
        state: AS_STAGE[batch.state],
        hash: batch.hash,
      };
    }),
    indexing,
  ];
}
