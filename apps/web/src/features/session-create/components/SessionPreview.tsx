import Link from "next/link";

import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";
import { ScrollFade } from "@/components/ui/ScrollFade";

import { formatUtcInstant, utcInstant } from "@/utils/date";

import { paths } from "@/config/paths";

import { ScalarRangeTrack } from "./ScalarRangeTrack";
import { StatusChip } from "./StatusChip";
import type { SessionDeployProgress } from "../deploy/types";
import { useImageUrl } from "../hooks/useImageUrl";
import { useDraftStore } from "../stores/draftStore";
import { branchBounds, branchDisplayName, branchMarketName, parseNumber } from "../utils/branchFields";

const TITLES: Record<number, string> = {
  1: "The session, taking shape",
  2: "The questions, as the oracle sees them",
  3: "The homepage card, as others will see it",
  4: "Complete session",
  5: "The session page",
};
const CAPTIONS: Record<number, string> = {
  1: "The decision, with one branch market per outcome. Add an outcome and a branch grows here.",
  2: "The composed question, unit included. That is the string a human will eventually answer.",
  3: "Artwork, headline and subtitle come from this step. Branch names and the branch count come from the outcomes.",
};

/** The right rail: what the creator is building, from the current step's angle. */
export function SessionPreview({
  step,
  activeBranch,
  progress,
}: {
  step: number;
  /** The branch picked in the rail, if any. */
  activeBranch: number | null;
  progress: SessionDeployProgress;
}) {
  const { draft } = useDraftStore();
  const heroUrl = useImageUrl("hero");
  const iconUrl = useImageUrl("icon");
  const unit = draft.unit.trim();
  const decisionHuman = formatUtcInstant(utcInstant(draft.decisionDate, draft.decisionTime));
  const itemCount = `${draft.outcomes.length} ${
    (draft.outcomes.length === 1 ? draft.itemName : draft.itemNamePlural) || "outcomes"
  }`;

  const showTree = step <= 2 || step === 4;
  const showCards = step === 3;
  const showDeploy = step === 5;
  const building = ["uploading", "verifying", "signing", "confirming"].includes(progress.stage);
  const skeleton = progress.stage === "indexing" || (building && progress.parent.state !== "success");
  const live = progress.stage === "complete";
  /** On chain, but not everything it needs is. */
  const partial = !live && progress.parent.state === "success";

  return (
    <div className="bg-fs-surface border-fs-border rounded-fs border p-5">
      <div className={clsx("text-fs-text-primary text-sm font-semibold", !CAPTIONS[step] && "pb-4.5")}>
        {TITLES[step]}
      </div>
      {CAPTIONS[step] ? (
        <div className="type-caption text-fs-text-secondary pt-1 pb-4.5 text-pretty">{CAPTIONS[step]}</div>
      ) : null}

      {showTree ? (
        <div className="fs-rise">
          <div className="flex items-start gap-2.5">
            <ForesightIcon name="parent-market" size={18} className="text-fs-accent-protocol" />
            <div className="min-w-0 flex-1">
              <div className="type-caption text-fs-text-secondary">
                Decision · {draft.multi ? "multi-categorical" : "categorical"}
              </div>
              <div className="text-fs-text-primary text-sm font-semibold text-pretty">
                {draft.name.trim() || "Your decision question"}
              </div>
            </div>
          </div>
          <div className="flex pt-1.5">
            <div className="flex w-4.5 justify-center">
              <div className="fs-tree__connector min-h-full" />
            </div>
            <div className="relative min-w-0 flex-1 pt-2 pl-3">
              <ScrollFade className="max-h-74">
                <div className="flex flex-col gap-2">
                  {draft.outcomes.map((o, i) => {
                    const bounds = branchBounds(draft, o);
                    return (
                      <div
                        key={o.id}
                        className={clsx(
                          "rounded-fs border px-3 py-2.5 transition-colors",
                          i === activeBranch
                            ? "bg-fs-surface border-fs-border-accent"
                            : "bg-fs-surface-sunken border-fs-border",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 flex-none rounded-xs"
                            style={{ background: o.color }}
                            aria-hidden
                          />
                          <span className="text-fs-text-primary min-w-0 flex-1 text-[13px] font-semibold">
                            {o.label || `Outcome ${i + 1}`}
                          </span>
                          {step >= 2 ? (
                            <span className="type-caption text-fs-text-secondary whitespace-nowrap">
                              {bounds.lower.toLocaleString()} - {bounds.upper.toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        {step === 2 || step === 4 ? (
                          <div className="text-fs-text-secondary pt-1.5 font-mono text-[11px] text-pretty">
                            {branchMarketName(draft, o)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ScrollFade>
            </div>
          </div>
          <div className="border-fs-border mt-4 flex items-baseline gap-2.5 border-t pt-3.5">
            <span className="bg-fs-accent h-1.75 w-1.75 flex-none rounded-xs" aria-hidden />
            <span className="text-fs-text-primary text-xs font-semibold">Trading closes</span>
            <span className="type-caption text-fs-text-secondary whitespace-nowrap">{decisionHuman}</span>
          </div>
        </div>
      ) : null}

      {showCards ? (
        <div className="fs-rise flex flex-col gap-3.5">
          <div className="rounded-xl bg-linear-to-br from-(--fs-grad-from) to-(--fs-grad-to) p-px">
            <div className="bg-fs-surface relative overflow-hidden rounded-[11px]">
              <div
                className={clsx(
                  "type-caption border-fs-border flex h-42 items-center justify-center overflow-hidden border-b",
                  heroUrl
                    ? "bg-fs-surface-sunken"
                    : draft.heroImageName
                      ? "fs-grad-fill text-fs-text-inverse"
                      : "bg-fs-surface-sunken text-fs-text-secondary",
                )}
              >
                {heroUrl ? (
                  /* Local bytes, not IPFS. Nothing is uploaded until deploy, so
                     there is no CID to point at yet. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={heroUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (draft.heroImageName ?? "no hero image")
                )}
              </div>
              <span
                className={clsx(
                  "rounded-fs border-fs-surface text-fs-text-inverse absolute top-36 left-3.5 inline-flex h-10 w-10 items-center justify-center overflow-hidden border-2 text-[9px]",
                  iconUrl ? "bg-fs-surface" : draft.iconName ? "fs-grad-fill" : "bg-fs-accent-protocol",
                )}
              >
                {iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  "0x"
                )}
              </span>
              <div className="flex flex-col gap-2.5 px-4 pt-6.5 pb-4">
                <div className="text-fs-text-primary text-base font-semibold text-pretty">
                  {draft.title.trim() || "Untitled session"}
                </div>
                <div className="type-caption text-fs-text-secondary text-pretty">
                  {draft.description.trim() || "No description. The card works without one."}
                </div>
                <div className="bg-fs-accent h-px" />
                <div className="flex items-center gap-2 pt-8">
                  <ForesightIcon name="session-tree" size={14} className="text-fs-text-secondary" />
                  <span className="text-fs-text-primary text-xs font-semibold">{itemCount}</span>
                </div>
                <div className="type-caption text-fs-text-secondary border-fs-border flex justify-between gap-3 border-t pt-2.5">
                  <span>Trading until {decisionHuman}</span>
                  <span className="whitespace-nowrap">
                    {parseNumber(draft.lower).toLocaleString()} - {parseNumber(draft.upper).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="type-caption text-fs-text-secondary">Branch cards</div>
          {draft.outcomes.map((o, i) => {
            const bounds = branchBounds(draft, o);
            return (
              <div key={o.id} className="border-fs-border rounded-fs bg-fs-surface overflow-hidden border">
                <div className="h-1" style={{ background: o.color }} />
                <div className="flex flex-col gap-2 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 flex-none rounded-xs" style={{ background: o.color }} aria-hidden />
                    <span className="text-fs-text-primary min-w-0 flex-1 text-[13px] font-semibold">
                      {branchDisplayName(o, i)}
                    </span>
                  </div>
                  <div className="type-caption text-fs-text-secondary text-pretty">{branchMarketName(draft, o)}</div>
                  <ScalarRangeTrack lowerBound={bounds.lower} upperBound={bounds.upper} unit={unit} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {showDeploy ? (
        <div className="fs-rise flex flex-col gap-3">
          {skeleton ? (
            <div className="flex flex-col gap-2.5">
              <div className="fs-skeleton h-24" />
              <div className="fs-skeleton h-4.5 w-[70%]" />
              <div className="fs-skeleton h-3 w-[45%]" />
              <div className="type-caption text-fs-text-secondary">
                Building the session page while it is indexed. Nothing is lost.
              </div>
            </div>
          ) : (
            <div className="border-fs-border rounded-fs bg-fs-surface flex flex-col gap-2.5 border p-4">
              <StatusChip
                tone={live ? "done" : partial ? "attention" : "none"}
                label={live ? "Live" : partial ? "Incomplete" : "Not deployed"}
              />
              <div className="text-fs-text-primary text-base font-semibold text-pretty">
                {draft.title.trim() || "Untitled session"}
              </div>
              <div className="flex items-center gap-2">
                <ForesightIcon name="session-tree" size={16} className="text-fs-text-secondary" />
                <span className="text-fs-text-primary text-sm font-semibold">{itemCount}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.outcomes.map((o, i) => {
                  const deployed = progress.children[i]?.state === "success";
                  return (
                    <span
                      key={o.id}
                      className="type-caption inline-flex h-5.5 items-center rounded-full border px-2"
                      style={{
                        borderColor: deployed ? o.color : "var(--fs-border)",
                        color: deployed ? "var(--fs-text-primary)" : "var(--fs-text-secondary)",
                        background: deployed ? `color-mix(in oklch, ${o.color} 12%, transparent)` : "transparent",
                      }}
                    >
                      {o.label || `Outcome ${i + 1}`}
                      {deployed ? "" : " (missing)"}
                    </span>
                  );
                })}
              </div>
              {live && progress.parentMarket ? (
                <Link href={paths.market.getHref(progress.parentMarket)} className="type-label text-fs-accent">
                  Open the session page
                </Link>
              ) : null}
              {/* The chips already mark what is missing, so this only speaks when nothing is. */}
              {!live && !partial ? (
                <div className="type-caption text-fs-text-secondary text-pretty">
                  This is how the session will be listed once deployed.
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
