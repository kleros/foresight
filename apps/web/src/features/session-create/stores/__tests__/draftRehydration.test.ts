import { beforeEach, describe, expect, it } from "vitest";

import { useDraftStore } from "../draftStore";

const KEY = "foresight.create-draft.v1";

/** What a browser holds: whatever the shape was when it last saved. */
function saved(draft: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state: { draft }, version: 0 }));
}

async function rehydrate() {
  await useDraftStore.persist.rehydrate();
  return useDraftStore.getState().draft;
}

beforeEach(() => {
  localStorage.clear();
  useDraftStore.getState().resetDraft();
});

describe("rehydrating a draft saved by an older build", () => {
  it("defaults every field the saved draft has no value for", async () => {
    saved({
      name: "Old draft",
      outcomes: [
        { id: "x", label: "Alpha" },
        { id: "y", label: "Beta" },
      ],
    });

    const draft = await rehydrate();

    // Every screen calls `.trim()` on these, so undefined is a blank page.
    expect(draft.unit).toBe("");
    expect(draft.template).toBe("");
    expect(draft.title).toBe("");
    expect(draft.decisionTime).toBe("12:00");
    expect(draft.name).toBe("Old draft");
  });

  it("defaults an outcome's missing fields, keeping the label it was saved with", async () => {
    saved({
      outcomes: [
        { id: "x", label: "Alpha" },
        { id: "y", label: "Beta" },
      ],
    });

    const [first] = (await rehydrate()).outcomes;

    expect(first?.label).toBe("Alpha");
    expect(first?.token).toBe("");
    expect(first?.override).toBe(false);
    expect(first?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps two outcomes when the saved draft has none, since every screen indexes into them", async () => {
    saved({ name: "No outcomes" });

    expect((await rehydrate()).outcomes).toHaveLength(2);
  });

  it("survives a saved draft whose outcomes are not a list", async () => {
    saved({ outcomes: null });

    expect((await rehydrate()).outcomes).toHaveLength(2);
  });

  it("survives a saved draft that is not an object", async () => {
    saved([] as unknown as Record<string, unknown>);

    expect((await rehydrate()).unit).toBe("");
  });

  it("keeps what the saved draft did have", async () => {
    saved({ name: "Kept", title: "Also kept", multi: true, minBond: "5" });

    const draft = await rehydrate();

    expect(draft.name).toBe("Kept");
    expect(draft.title).toBe("Also kept");
    expect(draft.multi).toBe(true);
    expect(draft.minBond).toBe("5");
  });
});
