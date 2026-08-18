import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";

import { formatUtcInstant, utcInstant } from "@/utils/date";

import { Chip } from "./fields";
import { SectionHeader } from "./SectionHeader";
import { useDraftStore } from "../stores/draftStore";
import type { DraftAssessment, WizardStep } from "../types/draft";
import { metricInstant } from "../utils/assessDraft";
import { branchBoundsWei, branchDisplayName, branchMarketName, branchToken } from "../utils/branchFields";
import { formatWeiAmount } from "../utils/scaleToWei";

export function ReviewStep({
  assessment,
  active,
  onGoToStep,
}: {
  assessment: DraftAssessment;
  active: boolean;
  onGoToStep: (step: WizardStep) => void;
}) {
  const { draft } = useDraftStore();
  const ready = assessment.issues.length === 0;
  const unit = draft.unit.trim();
  const decisionHuman = formatUtcInstant(utcInstant(draft.decisionDate, draft.decisionTime));

  return (
    <section
      id="sec4"
      data-screen-label="Step 4: Review"
      className="border-fs-border border-b py-20 max-[1040px]:scroll-mt-16"
    >
      <SectionHeader
        step={4}
        kicker="Review"
        title="Is this the session you meant?"
        lede="A last look at what you are creating. Nothing has been created yet."
        ok={ready}
        active={active}
      />

      <div
        className={clsx(
          "rounded-fs text-fs-text-primary border px-4.5 py-3.5",
          ready
            ? "border-fs-status-registered bg-fs-status-registered-bg"
            : "border-fs-status-pending bg-fs-status-pending-bg",
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={clsx("h-2 w-2 flex-none rounded-xs", ready ? "bg-fs-status-registered" : "bg-fs-status-pending")}
          />
          <span className="text-sm font-semibold">
            {ready
              ? "Every step resolves. This session is ready to deploy."
              : "Deploy is disabled until these resolve."}
          </span>
        </div>
        {assessment.issues.length > 0 ? (
          <ul className="type-label mt-2 list-disc pl-5">
            {assessment.issues.map((issue) => (
              <li key={`${issue.step}-${issue.text}`} className="pb-0.5">
                {issue.text}{" "}
                <button
                  type="button"
                  onClick={() => onGoToStep(issue.step)}
                  className="text-fs-accent cursor-pointer border-none bg-transparent p-0 font-[inherit]"
                >
                  Go there
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {assessment.warnings.length > 0 ? (
        <div className="rounded-fs bg-fs-status-pending-bg border-fs-status-pending text-fs-text-primary mt-3 border px-4.5 py-3.5">
          <div className="flex items-center gap-2.5">
            <ForesightIcon name="info" size={16} className="text-fs-status-pending" />
            <span className="text-sm font-semibold">Worth a second look. These do not block the deploy.</span>
          </div>
          <ul className="type-label mt-2 list-disc pl-5">
            {assessment.warnings.map((warning) => (
              <li key={`${warning.step}-${warning.text}`} className="pb-0.5">
                {warning.text}{" "}
                <button
                  type="button"
                  onClick={() => onGoToStep(warning.step)}
                  className="text-fs-accent cursor-pointer border-none bg-transparent p-0 font-[inherit]"
                >
                  Go there
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="fs-card mt-6 overflow-hidden p-0">
        <div className="border-fs-border flex items-start gap-3.5 border-b px-7 py-6">
          <ForesightIcon name="parent-market" size={20} className="text-fs-accent-protocol" />
          <div className="min-w-0 flex-1">
            <div className="type-caption text-fs-text-secondary">
              Decision · {draft.multi ? "multi-categorical" : "categorical"}
            </div>
            <div className="text-fs-text-primary text-xl font-semibold text-pretty">
              {draft.name || "Untitled decision"}
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <Chip>{draft.outcomes.length} outcomes</Chip>
              <Chip>{draft.multi ? "Multi-categorical" : "One winner"}</Chip>
              <Chip>{draft.category}</Chip>
              <Chip>{draft.language}</Chip>
              <Chip>{draft.minBond} xDAI min bond</Chip>
              <Chip>Trading until {decisionHuman}</Chip>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onGoToStep(1)}
            className="type-label text-fs-accent cursor-pointer border-none bg-transparent p-0"
          >
            Edit
          </button>
        </div>

        {draft.outcomes.map((o, i) => {
          // The name the deploy sends, not a second slugging of it.
          const token = branchToken(o) || "OUTCOME";
          const metricHuman = formatUtcInstant(metricInstant(draft, o));
          const wei = branchBoundsWei(draft, o);
          return (
            <div key={o.id} className="border-fs-border flex gap-4 border-b px-7 py-5">
              <span className="w-1 flex-none self-stretch rounded-xs" style={{ background: o.color }} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="type-caption text-fs-text-secondary whitespace-nowrap">
                  Branch {i + 1} of {draft.outcomes.length}
                </div>
                <div className="text-fs-text-primary text-base font-semibold">{branchDisplayName(o, i)}</div>
                <div className="text-fs-text-primary font-mono text-sm text-pretty">{branchMarketName(draft, o)}</div>
                <div className="flex flex-wrap gap-2">
                  {/* Scaled, not the float the branch list draws. With the unit,
                      since a range in the wrong scale resolves at one end. */}
                  <Chip>
                    {wei.lower === null ? "-" : formatWeiAmount(wei.lower)} -{" "}
                    {wei.upper === null ? "-" : formatWeiAmount(wei.upper)}
                    {unit ? ` ${unit}` : ""}
                  </Chip>
                  <Chip>
                    {token}_UP / {token}_DOWN
                  </Chip>
                  {/* A branch on the decision's settings has nothing of its own to state. */}
                  {o.override ? (
                    <>
                      <Chip strong={metricHuman !== decisionHuman}>Answerable from {metricHuman}</Chip>
                      <Chip strong>Overridden settings</Chip>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onGoToStep(2)}
                className="type-label text-fs-accent cursor-pointer self-start border-none bg-transparent p-0"
              >
                Edit
              </button>
            </div>
          );
        })}

        <div className="bg-fs-surface-sunken flex flex-wrap gap-8 px-7 py-5">
          <div>
            <div className="type-caption text-fs-text-secondary">Markets created</div>
            <div className="text-fs-text-primary text-base font-semibold tabular-nums">
              1 decision + {draft.outcomes.length} branches
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
