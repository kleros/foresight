import { useState } from "react";

import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { AlertMessage, Datepicker, NumberField, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";
import InfoCard from "@/components/ui/InfoCard";
import { Select } from "@/components/ui/Select";

import { formatUtcInstant, utcInstant } from "@/utils/date";

import { Chip, FieldLabel, InfoTip } from "./fields";
import { ScalarRangeTrack } from "./ScalarRangeTrack";
import { SectionHeader } from "./SectionHeader";
import { useDraftStore } from "../stores/draftStore";
import type { DraftAssessment } from "../types/draft";
import { LONG_RUN_NOTE } from "../utils/assessDraft";
import { branchBounds, branchMarketName, branchQuestion, parseNumber } from "../utils/branchFields";
import { OUTCOME_PLACEHOLDER } from "../utils/composeMarketName";
import { resolutionExample } from "../utils/resolutionExample";
import { scaleToWei } from "../utils/scaleToWei";
import { isListedUnit, OTHER_UNIT, UNITS } from "../utils/units";

const hasBrackets = (s: string) => /[[\]]/.test(s);

/** The scalar branch markets are generated from the outcomes. Never hand-added. */
export function ChildMarketsStep({
  assessment,
  active,
  activeBranch,
}: {
  assessment: DraftAssessment;
  active: boolean;
  /** The branch picked in the rail, if any. */
  activeBranch: number | null;
}) {
  const { draft, setDraftField, patchOutcome, toggleOverride } = useDraftStore();
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  // Seeded from the draft so a reload reopens the free-text field, and held
  // locally so choosing "Other" survives the field being empty.
  const [unlisted, setUnlisted] = useState(() => !!draft.unit.trim() && !isListedUnit(draft.unit));

  const unit = draft.unit.trim();
  const templateOk =
    !!draft.template.trim() && draft.template.includes(OUTCOME_PLACEHOLDER) && !hasBrackets(draft.template);
  const unitOk = !!unit && !hasBrackets(unit) && !/\s/.test(unit);
  const lowerNum = parseNumber(draft.lower);
  const upperNum = parseNumber(draft.upper);
  const boundsError = lowerNum < 0 || lowerNum >= upperNum;
  const sharedPays = resolutionExample({ lower: scaleToWei(draft.lower), upper: scaleToWei(draft.upper) }, draft.unit);

  const decision = utcInstant(draft.decisionDate, draft.decisionTime);
  const decisionHuman = formatUtcInstant(decision);

  const exampleOutcome = draft.outcomes[Math.min(activeBranch ?? 0, draft.outcomes.length - 1)] ?? draft.outcomes[0];
  const metricError = assessment.issues.some((issue) => issue.text.includes("closes before the decision"));
  const toggleEditor = (id: string) => setOpenBranch((current) => (current === id ? null : id));

  // The assessment names the branch it warns about, the same way it names it everywhere else.
  const longRunning = (i: number) => {
    const branch = draft.outcomes[i]?.label.trim() || `Branch ${i + 1}`;
    return assessment.warnings.some((w) => w.step === 2 && w.text === `${branch} ${LONG_RUN_NOTE}.`);
  };

  return (
    <section
      id="sec2"
      data-screen-label="Step 2: Branch markets"
      className="border-fs-border border-b py-20 max-[1040px]:scroll-mt-16"
    >
      <SectionHeader
        step={2}
        kicker="Branch markets"
        title="What will be measured under each outcome?"
        lede="Write the question once. Every market asks it about one outcome."
        ok={assessment.steps.children}
        active={active}
      />

      <div className="fs-card flex flex-col gap-7 px-8 py-7">
        <div>
          <FieldLabel>
            <span className="type-label text-fs-text-secondary">Question template</span>
            <InfoTip text="Ask the same question about every outcome. That is what makes the results comparable. Write {outcome} where the outcome name belongs." />
          </FieldLabel>
          <TextField
            className="w-full"
            value={draft.template}
            onChange={(v) => setDraftField("template", v)}
            placeholder="The metric to predict, if {outcome} is chosen"
            aria-label="Question template"
            variant={templateOk ? undefined : "error"}
            message={
              hasBrackets(draft.template)
                ? "Remove the square brackets. The unit is appended in them for you."
                : templateOk
                  ? "{outcome} is replaced with each outcome name."
                  : "Include {outcome}. That is where each outcome name goes."
            }
          />
        </div>

        <div>
          <FieldLabel>
            <span className="type-label text-fs-text-secondary">Unit</span>
            <InfoTip text="What the numbers are measured in. It is shown with the question so everyone reads the answer the same way. Pick one from the list where you can: we can then sanity-check your bounds against it." />
          </FieldLabel>
          <div className="flex flex-wrap items-start gap-3">
            <Select
              label="Unit"
              hideLabel
              className="w-56 [&>button]:w-full"
              options={[
                ...UNITS.map((u) => ({
                  id: u.symbol,
                  text: u.symbol === u.name ? u.symbol : `${u.symbol}  ${u.name}`,
                })),
                { id: OTHER_UNIT, text: "Other..." },
              ]}
              value={unlisted ? OTHER_UNIT : draft.unit}
              onChange={(id) => {
                setUnlisted(id === OTHER_UNIT);
                setDraftField("unit", id === OTHER_UNIT ? "" : id);
              }}
            />
            {unlisted ? (
              <TextField
                className="fs-spawn w-56"
                value={draft.unit}
                onChange={(v) => setDraftField("unit", v)}
                placeholder="%"
                aria-label="Unit"
                variant={unitOk ? undefined : "error"}
                message={
                  unitOk
                    ? "Appended in brackets."
                    : hasBrackets(draft.unit)
                      ? "No brackets, just the unit."
                      : "Required. The symbol only, no spaces."
                }
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-fs bg-fs-surface-sunken border-fs-border border px-4 py-3.5">
          <div className="type-caption text-fs-text-secondary pb-1">The question, as it will be asked</div>
          <div className="text-fs-text-primary font-mono text-sm text-pretty">
            {exampleOutcome ? branchMarketName(draft, exampleOutcome) : "-"}
          </div>
        </div>

        <div className="border-fs-border border-t" />

        <div className="fs-three">
          <div>
            <FieldLabel>
              <span className="type-label text-fs-text-secondary">Lower bound</span>
              <InfoTip text="The lowest and highest the answer can be. Decimals are fine, negatives are not. If your metric can go below zero, build the shift into the question, like 'profit plus 100'." />
            </FieldLabel>
            <NumberField
              className="w-full"
              value={draft.lower === "" ? Number.NaN : Number(draft.lower)}
              onChange={(v) => setDraftField("lower", Number.isNaN(v) ? "" : String(v))}
              minValue={0}
              aria-label="Lower bound"
              variant={lowerNum < 0 || lowerNum >= upperNum ? "error" : undefined}
            />
          </div>
          <div>
            <div className="type-label text-fs-text-secondary pb-1">Upper bound</div>
            <NumberField
              className="w-full"
              value={draft.upper === "" ? Number.NaN : Number(draft.upper)}
              onChange={(v) => setDraftField("upper", Number.isNaN(v) ? "" : String(v))}
              minValue={0}
              aria-label="Upper bound"
              variant={lowerNum >= upperNum ? "error" : undefined}
            />
          </div>
          <ScalarRangeTrack
            lowerBound={lowerNum}
            upperBound={upperNum}
            unit={unit}
            label="Range, shared by every branch"
          />
        </div>

        {sharedPays ? (
          <InfoCard
            className="type-label text-pretty"
            msg={
              `An answer of ${sharedPays.midpoint} pays UP and DOWN half each. ` +
              `At or below ${sharedPays.floor}, DOWN takes everything; ` +
              `at or above ${sharedPays.ceiling}, UP takes everything.`
            }
          />
        ) : null}

        {boundsError ? (
          <AlertMessage
            variant="error"
            title={lowerNum < 0 ? "A negative lower bound is impossible." : "Lower bound is not below the upper bound."}
            msg={
              lowerNum < 0
                ? "Bounds cannot go below zero. Write the offset into the question instead, like 'profit in $M, plus 100', with bounds 0 to 200, because the offset becomes part of what is answered."
                : "Set a lower value below the upper one."
            }
          />
        ) : null}

        <div className="rounded-fs bg-fs-surface-sunken border-fs-border flex flex-wrap items-center gap-3 border px-4 py-3">
          <ForesightIcon name="opening-time" size={16} className="text-fs-text-secondary" />
          <span className="type-label text-fs-text-primary">Trading until {decisionHuman}</span>
          <span className="type-caption text-fs-text-secondary text-pretty">
            Every branch closes at the same moment as the decision. A branch can be given a later one below, never an
            earlier one.
          </span>
        </div>

        {metricError ? (
          <AlertMessage
            variant="error"
            title="A branch closes before the decision does."
            msg="A branch asks what follows from the choice, so it cannot close before the choice is made. Move it to the decision's moment or later."
          />
        ) : null}

        <div className="border-fs-border border-t" />

        <div>
          <div className="text-fs-text-primary text-sm font-semibold">{draft.outcomes.length} branch markets</div>
          <div className="type-caption text-fs-text-secondary pt-1 pb-2.5 text-pretty">
            Every branch uses the decision&apos;s closing time, category, language and bond. Give one its own settings
            only if it genuinely differs.
          </div>
          <div className="flex flex-col gap-2">
            {draft.outcomes.map((o, i) => {
              const bounds = branchBounds(draft, o);
              const branch = o.label.trim() || `branch ${i + 1}`;
              const open = openBranch === o.id;
              const verb = open ? "Done" : "Edit";
              return (
                <div
                  key={o.id}
                  id={`branch-${i}`}
                  className={clsx(
                    "rounded-fs border transition-colors",
                    open || i === activeBranch
                      ? "bg-fs-surface border-fs-border-accent"
                      : "bg-fs-surface-sunken border-fs-border",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleEditor(o.id)}
                    aria-expanded={open}
                    aria-label={`${verb} ${branch}`}
                    className="fs-echo rounded-fs flex w-full cursor-pointer items-center gap-3.5 border-none bg-transparent px-4 py-3 text-left"
                  >
                    <span className="h-6 w-1 flex-none rounded-xs" style={{ background: o.color }} aria-hidden />
                    <span className="type-body text-fs-text-primary flex-1 text-pretty">
                      {branchMarketName(draft, o)}
                    </span>
                    {!open && o.override ? <Chip strong>Overridden</Chip> : null}
                    <Chip className="tabular-nums">
                      {bounds.lower.toLocaleString()} - {bounds.upper.toLocaleString()}
                    </Chip>
                    <span className="type-label text-fs-accent whitespace-nowrap">{verb}</span>
                  </button>

                  {open ? (
                    <div className="fs-spawn border-fs-border mx-4 border-t py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Chip strong={o.override}>{o.override ? "Overridden" : "Inherits the decision"}</Chip>
                        <button
                          type="button"
                          onClick={() => toggleOverride(o.id)}
                          className="type-label text-fs-accent cursor-pointer border-none bg-transparent p-0"
                        >
                          {o.override ? "Use the decision's settings" : "Override"}
                        </button>
                      </div>
                      {o.override ? (
                        <div className="fs-spawn fs-two pt-4">
                          <div>
                            <div className="type-label text-fs-text-secondary pb-1">Question, without the unit</div>
                            <TextField
                              className="w-full"
                              value={o.childQuestion || branchQuestion(draft, o)}
                              onChange={(v) => patchOutcome(o.id, { childQuestion: v })}
                              aria-label={`Question for ${o.label}`}
                            />
                          </div>
                          <div>
                            <div className="type-label text-fs-text-secondary pb-1">Bounds</div>
                            <div className="grid grid-cols-2 gap-2">
                              <NumberField
                                className="w-full"
                                value={o.lower === "" ? Number.NaN : Number(o.lower)}
                                onChange={(v) => patchOutcome(o.id, { lower: Number.isNaN(v) ? "" : String(v) })}
                                minValue={0}
                                aria-label={`Lower bound for ${o.label}`}
                              />
                              <NumberField
                                className="w-full"
                                value={o.upper === "" ? Number.NaN : Number(o.upper)}
                                onChange={(v) => patchOutcome(o.id, { upper: Number.isNaN(v) ? "" : String(v) })}
                                minValue={0}
                                aria-label={`Upper bound for ${o.label}`}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="type-label text-fs-text-secondary pb-1">Trading until, for this branch</div>
                            <Datepicker
                              aria-label={`Metric date for ${o.label}`}
                              value={o.metricDate ? parseDate(o.metricDate) : null}
                              onChange={(v) => patchOutcome(o.id, { metricDate: v ? v.toString() : "" })}
                              minValue={draft.decisionDate ? parseDate(draft.decisionDate) : today(getLocalTimeZone())}
                            />
                            {longRunning(i) ? (
                              <div className="type-caption text-fs-status-pending pt-2 text-pretty">
                                This branch {LONG_RUN_NOTE}.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
