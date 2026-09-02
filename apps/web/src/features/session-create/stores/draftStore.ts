import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { nextBranchColor } from "@/utils/branchColor";

import { MAX_IMAGE_BLOCKS } from "../flow/metadata";
import type { OutcomeDraft, OutcomeImageDraft, SessionDraft } from "../types/draft";
import { slugToken } from "../utils/slugToken";

/**
 * The wizard draft, persisted to localStorage
 */

function blankOutcome(taken: readonly string[]): OutcomeDraft {
  return {
    id: crypto.randomUUID(),
    label: "",
    token: "",
    tokenTouched: false,
    displayName: "",
    color: nextBranchColor(taken),
    colorTouched: false,
    detailsMarkdown: "",
    images: [],
    override: false,
    childQuestion: "",
    lower: "",
    upper: "",
    metricDate: "",
    metricTime: "",
  };
}

function blankDraft(): SessionDraft {
  const first = blankOutcome([]);
  return {
    name: "",
    outcomes: [first, blankOutcome([first.color])],
    multi: false,
    category: "market",
    language: "en_US",
    minBond: "0.1",
    decisionDate: "",
    decisionTime: "12:00",
    template: "",
    unit: "",
    lower: "0",
    upper: "",
    title: "",
    description: "",
    itemName: "",
    itemNamePlural: "",
    heroImageName: null,
    iconName: null,
  };
}

const asString = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
const asBoolean = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const asFileName = (value: unknown) => (typeof value === "string" ? value : null);

function normalizeOutcome(value: unknown, taken: readonly string[]): OutcomeDraft {
  const blank = blankOutcome(taken);
  if (!value || typeof value !== "object") return blank;
  const saved = value as Record<string, unknown>;
  return {
    id: asString(saved.id, blank.id),
    label: asString(saved.label, blank.label),
    token: asString(saved.token, blank.token),
    tokenTouched: asBoolean(saved.tokenTouched, blank.tokenTouched),
    displayName: asString(saved.displayName, blank.displayName),
    color: asString(saved.color, blank.color),
    colorTouched: asBoolean(saved.colorTouched, blank.colorTouched),
    detailsMarkdown: asString(saved.detailsMarkdown, blank.detailsMarkdown),
    images: normalizeImages(saved.images),
    override: asBoolean(saved.override, blank.override),
    childQuestion: asString(saved.childQuestion, blank.childQuestion),
    lower: asString(saved.lower, blank.lower),
    upper: asString(saved.upper, blank.upper),
    metricDate: asString(saved.metricDate, blank.metricDate),
    metricTime: asString(saved.metricTime, blank.metricTime),
  };
}

function normalizeImages(value: unknown): OutcomeImageDraft[] {
  const images: OutcomeImageDraft[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const saved = entry as Record<string, unknown>;
    // The id keys the byte slot and the React row, so a duplicate is unusable.
    if (typeof saved.id !== "string" || !saved.id || seen.has(saved.id)) continue;
    seen.add(saved.id);
    images.push({ id: saved.id, title: asString(saved.title, ""), fileName: asString(saved.fileName, "") });
  }
  return images.slice(0, MAX_IMAGE_BLOCKS);
}

function normalizeOutcomes(value: unknown): OutcomeDraft[] {
  const outcomes: OutcomeDraft[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    outcomes.push(
      normalizeOutcome(
        entry,
        outcomes.map((o) => o.color),
      ),
    );
  }
  // The wizard never goes below two, and every screen indexes into them.
  while (outcomes.length < 2) outcomes.push(blankOutcome(outcomes.map((o) => o.color)));
  return outcomes;
}

/**
 * A draft is only as new as the browser that wrote it: `persist` replaces the
 * whole object rather than filling the gaps, so a field added after someone
 * saved comes back undefined while its type still says otherwise. Everything
 * out of storage goes through here, and comes out complete.
 */
export function normalizeDraft(value: unknown): SessionDraft {
  const blank = blankDraft();
  if (!value || typeof value !== "object") return blank;
  const saved = value as Record<string, unknown>;
  return {
    name: asString(saved.name, blank.name),
    outcomes: normalizeOutcomes(saved.outcomes),
    multi: asBoolean(saved.multi, blank.multi),
    category: asString(saved.category, blank.category),
    language: asString(saved.language, blank.language),
    minBond: asString(saved.minBond, blank.minBond),
    decisionDate: asString(saved.decisionDate, blank.decisionDate),
    decisionTime: asString(saved.decisionTime, blank.decisionTime),
    template: asString(saved.template, blank.template),
    unit: asString(saved.unit, blank.unit),
    lower: asString(saved.lower, blank.lower),
    upper: asString(saved.upper, blank.upper),
    title: asString(saved.title, blank.title),
    description: asString(saved.description, blank.description),
    itemName: asString(saved.itemName, blank.itemName),
    itemNamePlural: asString(saved.itemNamePlural, blank.itemNamePlural),
    heroImageName: asFileName(saved.heroImageName),
    iconName: asFileName(saved.iconName),
  };
}

type DraftStore = {
  draft: SessionDraft;
  setDraftField: <K extends keyof SessionDraft>(field: K, value: SessionDraft[K]) => void;
  patchOutcome: (id: string, patch: Partial<OutcomeDraft>) => void;
  /** @returns false at the branch's cap, with the draft unchanged. */
  addImage: (outcomeId: string, image: OutcomeImageDraft) => boolean;
  /** Image ids are unique across branches, so patch and remove need no outcome. */
  patchImage: (imageId: string, patch: Partial<Pick<OutcomeImageDraft, "title">>) => void;
  removeImage: (imageId: string) => void;
  setOutcomeToken: (id: string, token: string) => void;
  addOutcome: () => void;
  removeOutcome: (id: string) => void;
  moveOutcome: (id: string, toIndex: number) => void;
  toggleOverride: (id: string) => void;
  resetDraft: () => void;
};

export const useDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      draft: blankDraft(),

      setDraftField: (field, value) => set((s) => ({ draft: { ...s.draft, [field]: value } })),

      patchOutcome: (id, patch) =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) => {
              if (o.id !== id) return o;
              const next = { ...o, ...patch };
              // The label seeds token and display name until they diverge.
              if (patch.label !== undefined) {
                if (!o.tokenTouched) next.token = slugToken(patch.label);
                if (o.displayName === o.label && patch.displayName === undefined) {
                  next.displayName = patch.label;
                }
              }
              return next;
            }),
          },
        })),

      addImage: (outcomeId, image) => {
        let added = false;
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) => {
              if (o.id !== outcomeId || o.images.length >= MAX_IMAGE_BLOCKS) return o;
              added = true;
              return { ...o, images: [...o.images, image] };
            }),
          },
        }));
        return added;
      },

      patchImage: (imageId, patch) =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) =>
              o.images.some((i) => i.id === imageId)
                ? { ...o, images: o.images.map((i) => (i.id === imageId ? { ...i, ...patch } : i)) }
                : o,
            ),
          },
        })),

      removeImage: (imageId) =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) =>
              o.images.some((i) => i.id === imageId) ? { ...o, images: o.images.filter((i) => i.id !== imageId) } : o,
            ),
          },
        })),

      setOutcomeToken: (id, token) =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) => (o.id === id ? { ...o, token, tokenTouched: true } : o)),
          },
        })),

      addOutcome: () =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: [...s.draft.outcomes, blankOutcome(s.draft.outcomes.map((o) => o.color))],
          },
        })),

      removeOutcome: (id) =>
        set((s) => {
          if (s.draft.outcomes.length <= 2) return s;
          return {
            draft: { ...s.draft, outcomes: s.draft.outcomes.filter((o) => o.id !== id) },
          };
        }),

      moveOutcome: (id, toIndex) =>
        set((s) => {
          const from = s.draft.outcomes.findIndex((o) => o.id === id);
          if (from < 0) return s;
          const outcomes = [...s.draft.outcomes];
          const [moved] = outcomes.splice(from, 1);
          if (!moved) return s;
          outcomes.splice(Math.max(0, Math.min(toIndex, outcomes.length)), 0, moved);
          return { draft: { ...s.draft, outcomes } };
        }),

      toggleOverride: (id) =>
        set((s) => ({
          draft: {
            ...s.draft,
            outcomes: s.draft.outcomes.map((o) => {
              if (o.id !== id) return o;
              // Switching off leaves the branch's fields where they are: nothing
              // reads them while it inherits, and they are still there if it is
              // switched back on.
              if (o.override) return { ...o, override: false };
              // Switching on opens the editor on what the branch was inheriting,
              // rather than on empty fields.
              return {
                ...o,
                override: true,
                lower: o.lower || s.draft.lower,
                upper: o.upper || s.draft.upper,
                metricDate: o.metricDate || s.draft.decisionDate,
                metricTime: o.metricTime || s.draft.decisionTime,
              };
            }),
          },
        })),

      resetDraft: () => set({ draft: blankDraft() }),
    }),
    {
      name: "foresight.create-draft.v1",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => ({
        ...current,
        draft: normalizeDraft((persisted as { draft?: unknown } | undefined)?.draft),
      }),
    },
  ),
);
