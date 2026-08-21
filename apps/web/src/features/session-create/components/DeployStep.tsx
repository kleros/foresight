import { Accordion, Button, Copiable, CustomTimeline } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon, type ForesightIconName, type ForesightIconState } from "@/components/ui/ForesightIcon";

import { formatUtcInstant, utcInstant } from "@/utils/date";
import { tryGatewayUrl } from "@/utils/ipfs";

import { DEFAULT_CHAIN } from "@/config/chains";
import { seerMarketUrl } from "@/config/site";

import { RecoveredRunBanner } from "./RecoveredRunBanner";
import { SectionHeader } from "./SectionHeader";
import { TxHashLink } from "./TxHashLink";
import type { MarketDeployState, SessionDeployDriver, SessionDeployProgress } from "../deploy/types";
import { useDraftStore } from "../stores/draftStore";
import type { DraftAssessment } from "../types/draft";
import { branchDisplayName, branchMarketName } from "../utils/branchFields";
import { stagesFor, unfinished, type DeployStage, type StageState } from "../utils/deployStages";

const MARKET_STATE: Record<
  MarketDeployState,
  { icon: ForesightIconName; color: string; word: string; motion?: ForesightIconState }
> = {
  success: { icon: "outcome", color: "var(--fs-status-registered)", word: "created", motion: "drawing" },
  running: { icon: "pending", color: "var(--fs-text-primary)", word: "confirming", motion: "pending" },
  error: { icon: "removed", color: "var(--fs-status-disputed)", word: "failed" },
  pending: { icon: "info", color: "var(--fs-text-secondary)", word: "pending" },
};

const bullet = (state: MarketDeployState) => {
  const { icon, color, motion } = MARKET_STATE[state];
  const Bullet = () => <ForesightIcon name={icon} size={16} state={motion} style={{ color, flex: "none" }} />;
  return Bullet;
};

/**
 * A stage is marked as the market rows are, so one meaning has one look.
 * Defined once each: a component built per render is a new type every time, and
 * React remounts what it draws, restarting the icon's animation.
 */
const STAGE_BULLET: Partial<Record<StageState, () => React.ReactNode>> = {
  done: bullet("success"),
  active: bullet("running"),
  failed: bullet("error"),
};

/** What a stage put on IPFS, each opening in its own tab. */
function StageFiles({ files, gateway }: { files: NonNullable<DeployStage["files"]>; gateway: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      {files.map((file) => {
        // A uri the gateway rules refuse is named without being offered: the
        // file is up either way, and the document it came from records it.
        const url = tryGatewayUrl(gateway, file.uri);
        return url ? (
          <a
            key={file.label}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="type-caption text-fs-accent underline underline-offset-2"
          >
            {file.label}
          </a>
        ) : (
          <span key={file.label}>{file.label}</span>
        );
      })}
    </span>
  );
}

export function DeployStep({
  assessment,
  active,
  progress,
  driver,
  walletConnected,
  walletSlot,
  signedIn,
  signInSlot,
  gateway,
}: {
  assessment: DraftAssessment;
  active: boolean;
  progress: SessionDeployProgress;
  driver: SessionDeployDriver;
  walletConnected: boolean;
  walletSlot: React.ReactNode;
  signedIn: boolean;
  signInSlot: React.ReactNode;
  /** Where the uploaded files are read back from. */
  gateway: string;
}) {
  const { draft } = useDraftStore();
  const unit = draft.unit.trim();
  const hasMissing = assessment.issues.length > 0;
  const decisionHuman = formatUtcInstant(utcInstant(draft.decisionDate, draft.decisionTime));
  const imageCount = (draft.heroImageName ? 1 : 0) + (draft.iconName ? 1 : 0);

  const stages = stagesFor(progress, imageCount, draft.outcomes.length);
  const seerUrl = progress.parentMarket ? seerMarketUrl(progress.parentMarket, DEFAULT_CHAIN.id) : undefined;
  const deployedChildren = progress.children.filter((c) => c.state === "success").length;
  const createdCount = (progress.parent.state === "success" ? 1 : 0) + deployedChildren;

  const rows = [
    {
      key: "parent",
      label: draft.name || "Decision market",
      color: "var(--fs-accent-protocol)",
      ...progress.parent,
    },
    ...draft.outcomes.map((o, i) => {
      const child = progress.children[i] ?? { state: "pending" as const };
      return {
        key: o.id,
        label: `${branchDisplayName(o, i)}: ${branchMarketName(draft, o)}`,
        color: o.color,
        index: i,
        ...child,
      };
    }),
  ];

  /** Everything a stage has to say under its own name: what, then where. */
  const stageLine = (stage: DeployStage) => {
    if (!stage.detail && !stage.files && !stage.hash) return "";
    return (
      <span className="fs-stage-line type-caption text-fs-text-secondary flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {stage.detail ? <span>{stage.detail}</span> : null}
        {stage.files ? <StageFiles files={stage.files} gateway={gateway} /> : null}
        {stage.hash ? <TxHashLink hash={stage.hash} copiable /> : null}
      </span>
    );
  };

  const timelineItem = (stage: DeployStage) => ({
    title: stage.label,
    party: stageLine(stage),
    subtitle: "",
    Icon: STAGE_BULLET[stage.state],
    state: stage.state === "done" ? ("disabled" as const) : undefined,
  });

  const deployJson = JSON.stringify(
    {
      session: {
        title: draft.title,
        description: draft.description || undefined,
        itemName: draft.itemName || undefined,
        itemNamePlural: draft.itemNamePlural || undefined,
        chain: DEFAULT_CHAIN.name,
      },
      parent: {
        question: draft.name,
        type: "categorical",
        multiCategorical: draft.multi,
        outcomes: draft.outcomes.map((o) => o.label),
        category: draft.category,
        language: draft.language,
        minBond: draft.minBond,
        tradingUntil: decisionHuman,
        hash: progress.parent.hash,
      },
      children: draft.outcomes.map((o, i) => ({
        index: i,
        branch: o.label,
        displayName: o.displayName,
        color: o.color,
        question: branchMarketName(draft, o),
        unit,
        type: "scalar",
        hash: progress.children[i]?.hash,
      })),
      deployment: {
        mode: progress.mode,
        transactions: progress.mode === "phased" ? 1 + progress.batches : 1,
      },
    },
    null,
    2,
  );

  /**
   * What has to happen before deploy can start, in the order it is asked for.
   * Only ever one at a time, so it is one banner with three states rather than
   * three banners that must not appear together.
   *
   * Signing in is what allows the upload, and a recovered run has its document
   * on IPFS already, so continuing one asks for nothing but the wallet.
   */
  const blocker = !walletConnected
    ? {
        title: "No wallet connected.",
        body: "Everything you have typed stays in this browser until you deploy.",
        slot: walletSlot,
      }
    : !signedIn && !progress.metadataUri
      ? {
          title: "Sign in to continue.",
          body: "Your images and session details are uploaded when you deploy, and signing in is what allows that.",
          slot: signInSlot,
        }
      : null;

  return (
    <section id="sec5" data-screen-label="Step 5: Deploy" className="pt-20 max-[1040px]:scroll-mt-16">
      <SectionHeader
        step={5}
        kicker="Deploy"
        title="Sign it into existence"
        ok={progress.stage === "complete"}
        active={active}
      />

      {blocker ? (
        <div className="rounded-fs bg-fs-surface border-fs-border mb-4 flex flex-wrap items-center gap-4 border px-5 py-4">
          <div className="min-w-65 flex-1">
            <div className="text-fs-text-primary text-sm font-semibold">{blocker.title}</div>
            <div className="type-caption text-fs-text-secondary">{blocker.body}</div>
          </div>
          {blocker.slot}
        </div>
      ) : null}

      <div className="fs-card flex flex-col gap-6 px-8 py-7">
        <div>
          <div className="type-label text-fs-text-secondary pb-3">Deploy progress</div>
          <div className="fs-narrative" role="status" aria-live="polite">
            <CustomTimeline items={[timelineItem(stages[0]), ...stages.slice(1).map((s) => timelineItem(s))]} />
          </div>
        </div>

        {progress.stage === "idle" ? (
          <div className="flex flex-wrap items-center gap-4">
            <Button text="Deploy" isDisabled={hasMissing || !!blocker} onPress={() => driver.start()} />
            {hasMissing ? (
              <span className="type-label text-fs-status-pending">
                {assessment.issues.length} unresolved above. The rail marks which.
              </span>
            ) : null}
          </div>
        ) : null}

        {/* The recovered-run banner below says all this and offers the actions,
            so this only speaks when there is no run being offered back. */}
        {unfinished(progress) && !progress.resume ? (
          <div className="rounded-fs bg-fs-status-disputed-bg border-fs-status-disputed flex gap-3.5 border px-4.5 py-4">
            <ForesightIcon name="challenged" size={20} className="text-fs-status-disputed" />
            <div className="min-w-0 flex-1">
              <div className="text-fs-text-primary text-sm font-semibold">
                Session opened, {draft.outcomes.length - deployedChildren} of {draft.outcomes.length} branch markets
                missing
              </div>
              <div className="type-label text-fs-text-primary text-pretty">
                Only the wallet that deployed it can add the rest.
              </div>
              <div className="type-caption text-fs-text-secondary pt-3">
                Batch {progress.batch} of {progress.batches} · {deployedChildren} of {draft.outcomes.length} branch
                markets exist
              </div>
            </div>
          </div>
        ) : null}

        {progress.resume ? <RecoveredRunBanner resume={progress.resume} driver={driver} /> : null}

        {progress.failure ? (
          <div className="rounded-fs bg-fs-status-disputed-bg border-fs-status-disputed flex gap-3.5 border px-4.5 py-4">
            <ForesightIcon name="removed" size={20} className="text-fs-status-disputed" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-fs-text-primary text-sm font-semibold">
                  {progress.failure.retryable ? "Deploy stopped" : "Deploy failed"}
                </span>
                <TxHashLink hash={progress.failure.hash} />
              </div>
              <div className="type-label text-fs-text-primary text-pretty break-words">{progress.failure.message}</div>
              <div className="flex flex-wrap items-center gap-4 pt-3">
                {progress.failure.retryable ? (
                  <Button text="Try again" small onPress={() => driver.retry()} />
                ) : (
                  <Button text="Start over" small onPress={() => driver.reset()} />
                )}
                <span className="type-caption text-fs-text-secondary text-pretty">
                  {progress.failure.retryable
                    ? "Nothing further was signed."
                    : "Anything already created stays on chain."}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {progress.stage !== "idle" ? (
          <div className="rounded-fs border-fs-border overflow-hidden border">
            <div className="bg-fs-surface-sunken border-fs-border flex items-baseline gap-2.5 border-b px-4 py-3">
              <span className="text-fs-text-primary text-sm font-semibold">Markets</span>
              <span className="type-caption text-fs-text-secondary">
                {createdCount} of {draft.outcomes.length + 1} created
              </span>
            </div>
            {rows.map((row, i) => (
              <div
                key={row.key}
                className={clsx(
                  "flex items-center gap-3 px-4 py-2.5",
                  i > 0 && "border-fs-border border-t",
                  row.state === "running" && "bg-fs-surface-tint",
                )}
              >
                <span className="h-5 w-0.75 flex-none rounded-xs" style={{ background: row.color }} aria-hidden />
                <ForesightIcon
                  name={MARKET_STATE[row.state].icon}
                  size={16}
                  state={MARKET_STATE[row.state].motion}
                  style={{ color: MARKET_STATE[row.state].color, flex: "none" }}
                />
                <span className="type-label text-fs-text-primary min-w-0 flex-1 text-pretty">{row.label}</span>
                <TxHashLink hash={row.hash} />
                <span
                  className="type-caption min-w-17 text-right whitespace-nowrap"
                  style={{ color: MARKET_STATE[row.state].color }}
                >
                  {MARKET_STATE[row.state].word}
                </span>
                {row.state === "error" && "index" in row && progress.failure?.retryable ? (
                  <button
                    type="button"
                    onClick={() => driver.retry()}
                    className="type-label text-fs-accent cursor-pointer border-none bg-transparent p-0"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {progress.stage === "indexing" ? (
          <div className="rounded-fs bg-fs-surface-tint border-fs-border flex items-center gap-3.5 border px-4.5 py-4">
            <ForesightIcon name="indexing" size={20} state="pending" className="text-fs-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-fs-text-primary text-sm font-semibold">Indexing session</div>
              <div className="type-label text-fs-text-secondary">
                Confirmed on chain. Indexing is catching up; the session page is being built to the right.
              </div>
            </div>
          </div>
        ) : null}

        {progress.stage === "complete" ? (
          <div className="fs-spawn flex flex-col gap-4">
            <div className="rounded-fs bg-fs-status-pending-bg border-fs-status-pending flex flex-col gap-3.5 border px-5 py-4.5">
              <div>
                <div className="text-fs-text-primary text-base font-semibold">Deployed</div>
                <div className="type-label text-fs-text-primary">Trading until {decisionHuman}</div>
                <div className="type-label text-fs-text-primary">Needs liquidity to be tradable</div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Button text="Seed liquidity" isDisabled />
                {seerUrl ? (
                  <a
                    href={seerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="type-label text-fs-accent underline underline-offset-2"
                  >
                    View on Seer
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => driver.reset()}
                  className="type-label text-fs-accent cursor-pointer border-none bg-transparent p-0"
                >
                  Reset
                </button>
              </div>
            </div>
            <Accordion
              items={[
                {
                  title: "Deployment details",
                  body: (
                    <div className="flex flex-col gap-2">
                      <Copiable copiableContent={deployJson} info="Copy JSON">
                        <span className="type-label text-fs-accent">Copy JSON</span>
                      </Copiable>
                      <pre className="rounded-fs bg-fs-surface-sunken border-fs-border text-fs-text-primary m-0 max-h-75 overflow-auto border p-4 font-mono text-xs">
                        {deployJson}
                      </pre>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
