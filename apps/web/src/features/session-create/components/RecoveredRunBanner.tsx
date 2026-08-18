import { Button } from "@kleros/ui-components-library";

import { ForesightIcon } from "@/components/ui/ForesightIcon";
import EnsureChain from "@/components/wallet/EnsureChain";

import { TxHashLink } from "./TxHashLink";
import type { DeployResume, SessionDeployDriver } from "../deploy/types";

/**
 * Already settled against the chain by the time this renders, so it says what
 * happened to the step and nothing about how that was found out.
 */
const OUTCOME: Record<DeployResume["outcome"], string> = {
  none: "",
  unknown: "",
  pending: "It is still confirming.",
  confirmed: "It went through while you were away.",
  reverted: "It failed, and created nothing.",
  dropped: "It never went through.",
};

/** A hash on an `unknown` outcome means it landed after the wallet stopped reporting. */
const witnessed = (resume: DeployResume) => resume.outcome === "unknown" && Boolean(resume.hash);

/**
 * An unfinished deploy, offered back instead of the deploy button: starting
 * again would strand a phased session only its deployer can finish.
 */
export function RecoveredRunBanner({ resume, driver }: { resume: DeployResume; driver: SessionDeployDriver }) {
  const seen = witnessed(resume);
  const blind = !resume.canSelfCheck && !seen;
  const line = [`It stopped at ${resume.label.toLowerCase()}.`, seen ? OUTCOME.confirmed : OUTCOME[resume.outcome]]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-screen-label="Continue an unfinished deploy"
      className="rounded-fs bg-fs-status-pending-bg border-fs-status-pending flex gap-3.5 border px-5 py-4"
    >
      <ForesightIcon name={blind ? "challenged" : "phased-deploy"} size={20} className="text-fs-status-pending" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-fs-text-primary text-sm font-semibold">Unfinished deploy found</span>
          <TxHashLink hash={resume.hash} />
        </div>
        <div className="type-label text-fs-text-primary text-pretty wrap-break-words">{line}</div>

        {blind ? (
          <div className="type-label text-fs-status-disputed pt-2 text-pretty">
            Check the wallet you deployed with first: if you already signed this, continuing pays for it twice.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4 pt-3">
          {/* Continuing signs. Without the deploying wallet on the right chain
              there is nothing to continue with, so it asks for that first. */}
          <EnsureChain>
            <Button text="Continue this deploy" small onPress={() => driver.continueRecovered()} />
          </EnsureChain>
          <button
            type="button"
            onClick={() => driver.reset()}
            className="type-label text-fs-accent cursor-pointer border-none bg-transparent p-0"
          >
            Discard it
          </button>
          <span className="type-caption text-fs-text-secondary">Discarding undoes nothing already created.</span>
        </div>
      </div>
    </div>
  );
}
