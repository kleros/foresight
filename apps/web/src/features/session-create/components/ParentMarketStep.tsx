import { useState } from "react";

import { parseDate, today, getLocalTimeZone } from "@internationalized/date";
import { Button, Datepicker, Switch, TextField } from "@kleros/ui-components-library";
import clsx from "clsx";

import { Select } from "@/components/ui/Select";

import DragAndDropIcon from "@/assets/svg/drag-and-drop.svg";
import PlusIcon from "@/assets/svg/plus.svg";
import TrashIcon from "@/assets/svg/trash.svg";

import { AdvancedToggle, FieldLabel, InfoTip } from "./fields";
import { SectionHeader } from "./SectionHeader";
import { useDraftStore } from "../stores/draftStore";
import type { DraftAssessment } from "../types/draft";
import { LONG_RUN_NOTE } from "../utils/assessDraft";
import { scaleToWei } from "../utils/scaleToWei";
import { slugToken } from "../utils/slugToken";

const CATEGORIES = ["market", "misc", "technology", "business", "politics", "science", "sports"];
const LANGUAGES = ["en_US", "en_GB", "fr_FR", "es_ES", "pt_BR"];

const hasBrackets = (s: string) => /[[\]]/.test(s);

/** Outcome order is the order the branch markets are created in, so it is deployed state, not presentation. */
export function ParentMarketStep({ assessment, active }: { assessment: DraftAssessment; active: boolean }) {
  const { draft, setDraftField, patchOutcome, setOutcomeToken, addOutcome, removeOutcome, moveOutcome } =
    useDraftStore();
  const [advanced, setAdvanced] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const dupLabels = new Set<string>();
  {
    const seen = new Set<string>();
    for (const o of draft.outcomes) {
      const k = o.label.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) dupLabels.add(k);
      else seen.add(k);
    }
  }
  const tokens = draft.outcomes.map((o) => slugToken(o.token || o.label));
  const dupTokens = new Set(tokens.filter((t, i) => t && tokens.indexOf(t) !== i));

  const namelessTokens = draft.outcomes.some((o) => o.label.trim() && !slugToken(o.token || o.label));

  const bond = scaleToWei(draft.minBond);
  const bondOk = bond !== null && bond > 0n;
  const longRunning = assessment.warnings.some((w) => w.step === 1 && w.text.includes(LONG_RUN_NOTE));
  const advancedNeedsAttention = !bondOk || dupTokens.size > 0 || namelessTokens;

  return (
    <section
      id="sec1"
      data-screen-label="Step 1: Decision market"
      className="border-fs-border scroll-mt-20 border-b pb-20 max-[1040px]:scroll-mt-36"
    >
      <SectionHeader
        step={1}
        kicker="Decision market"
        title="What is being decided?"
        lede="One market per outcome is created from this list, in this order."
        ok={assessment.steps.parent}
        active={active}
      />

      <div className="fs-card flex flex-col gap-7 px-8 py-7">
        <div>
          <FieldLabel>
            <span className="type-label text-fs-text-secondary">Decision</span>
            <InfoTip text="The parent market question. The session's own title and name are set below, in the display step." />
          </FieldLabel>
          <TextField
            className="w-full"
            aria-label="Decision"
            value={draft.name}
            onChange={(v) => setDraftField("name", v)}
            placeholder="Which option should we choose?"
            variant={hasBrackets(draft.name) ? "error" : undefined}
            message={
              hasBrackets(draft.name)
                ? "Square brackets are reserved: the unit is appended in them. Remove them here."
                : undefined
            }
          />
        </div>

        <div>
          <FieldLabel>
            <span className="type-label text-fs-text-secondary">Outcomes</span>
            <InfoTip text="Every outcome gets its own market, in this order, so the order you set here is the order people will see." />
          </FieldLabel>
          <div className="flex flex-col gap-2">
            {draft.outcomes.map((o, index) => {
              const dup = dupLabels.has(o.label.trim().toLowerCase());
              return (
                <div
                  key={o.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId && dragId !== o.id) moveOutcome(dragId, index);
                  }}
                  className={clsx(
                    "fs-echo rounded-fs bg-fs-surface-sunken grid grid-cols-[20px_24px_minmax(0,1fr)_32px] items-center gap-3 border px-2.5 py-1.5",
                    dup || !o.label.trim() ? "border-fs-status-disputed" : "border-fs-border",
                    dragId === o.id && "opacity-60",
                  )}
                >
                  {/* Only the grip drags: a draggable row would hijack text selection in the input.
                      Arrow keys do the same move, since dragging is the one action here a keyboard
                      cannot reach, and the order is deployed state rather than presentation. */}
                  <span
                    draggable
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => setDragId(null)}
                    onKeyDown={(e) => {
                      const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
                      if (to === null || to < 0 || to >= draft.outcomes.length) return;
                      e.preventDefault();
                      moveOutcome(o.id, to);
                    }}
                    className="text-fs-text-secondary cursor-grab"
                    aria-label={`Reorder ${o.label || "outcome"}, currently ${index + 1} of ${draft.outcomes.length}. Use the arrow keys.`}
                    role="button"
                    tabIndex={0}
                  >
                    <DragAndDropIcon width={16} height={16} />
                  </span>
                  <span className="rounded-fs bg-fs-surface-tint type-caption text-fs-text-secondary inline-flex h-6 w-6 flex-none items-center justify-center tabular-nums">
                    {index + 1}
                  </span>
                  <TextField
                    className="w-full"
                    value={o.label}
                    onChange={(v) => patchOutcome(o.id, { label: v })}
                    placeholder="Outcome name"
                    aria-label="Outcome name"
                  />
                  <button
                    type="button"
                    onClick={() => removeOutcome(o.id)}
                    disabled={draft.outcomes.length <= 2}
                    aria-label="Remove outcome"
                    className="fs-echo rounded-fs text-fs-text-secondary flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <TrashIcon width={16} height={16} />
                  </button>
                </div>
              );
            })}
          </div>
          {dupLabels.size > 0 ? (
            <div className="type-caption text-fs-status-disputed pt-2">
              Outcomes must be distinct: one name appears twice.
            </div>
          ) : null}
          <div className="pt-3">
            <Button
              text="Add outcome"
              variant="secondary"
              small
              Icon={PlusIcon}
              onPress={addOutcome}
              className="text-fs-accent"
            />
          </div>
        </div>

        <div>
          <FieldLabel>
            <span className="type-label text-fs-text-secondary">Trading until</span>
            <InfoTip text="The moment trading closes. After it the choice is public and there is nothing left to predict, so setting this is really choosing how long the market runs. Every branch uses the same moment unless you give one its own." />
          </FieldLabel>
          <div className="w-55">
            <Datepicker
              aria-label="Decision date"
              value={draft.decisionDate ? parseDate(draft.decisionDate) : null}
              onChange={(v) => setDraftField("decisionDate", v ? v.toString() : "")}
              minValue={today(getLocalTimeZone())}
            />
          </div>
          {longRunning ? (
            <div className="type-caption text-fs-status-pending pt-2 text-pretty">
              This session {LONG_RUN_NOTE}. Traders&apos; money is tied up until it closes.
            </div>
          ) : null}
        </div>

        <div className="border-fs-border border-t pt-5">
          <AdvancedToggle
            open={advanced}
            onToggle={() => setAdvanced((v) => !v)}
            label="Advanced settings"
            summary={advancedNeedsAttention ? "Something in here needs attention" : undefined}
            summaryTone={advancedNeedsAttention ? "error" : "muted"}
          />
          {advanced ? (
            <div className="fs-spawn flex flex-col gap-6 pt-5">
              <div className="fs-two">
                <Select
                  className="w-full"
                  label="Category"
                  options={CATEGORIES.map((c) => ({ id: c, text: c }))}
                  value={draft.category}
                  onChange={(id) => setDraftField("category", id)}
                />
                <Select
                  className="w-full"
                  label="Language"
                  options={LANGUAGES.map((l) => ({ id: l, text: l }))}
                  value={draft.language}
                  onChange={(id) => setDraftField("language", id)}
                />
                <TextField
                  className="w-full"
                  label="Min bond"
                  value={draft.minBond}
                  onChange={(v) => setDraftField("minBond", v)}
                  variant={bondOk ? undefined : "error"}
                  message={bondOk ? undefined : "Must be above zero."}
                />
              </div>
              <div className="flex items-start gap-3.5">
                <Switch
                  small
                  isSelected={draft.multi}
                  onChange={(v) => setDraftField("multi", v)}
                  aria-label="Multi-categorical"
                  className="mt-1"
                />
                <div>
                  <div className="text-fs-text-primary text-sm font-semibold">Multi-categorical</div>
                  <div className="type-caption text-fs-text-secondary">
                    More than one outcome may win, and payouts split between them.
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-baseline gap-2 pb-2">
                  <span className="type-label text-fs-text-secondary">Token names</span>
                  <span className="type-caption text-fs-text-secondary">Taken from the outcome names.</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {draft.outcomes
                    .filter((o) => o.label.trim())
                    .map((o) => (
                      <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-3">
                        <span className="type-label text-fs-text-secondary">{o.label}</span>
                        <TextField
                          className="w-full"
                          value={o.token}
                          onChange={(v) => setOutcomeToken(o.id, v)}
                          placeholder="TOKEN"
                          aria-label={`Token name for ${o.label}`}
                          variant={
                            !slugToken(o.token || o.label) || dupTokens.has(slugToken(o.token || o.label))
                              ? "error"
                              : undefined
                          }
                          message={slugToken(o.token || o.label) ? undefined : "Required: A-Z and 0-9 only."}
                        />
                      </div>
                    ))}
                </div>
                {dupTokens.size > 0 ? (
                  <div className="type-caption text-fs-status-disputed pt-2">Token names must be distinct.</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
