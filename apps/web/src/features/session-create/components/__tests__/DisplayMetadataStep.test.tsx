import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { draftAssessment } from "../../__tests__/support/drafts";
import { MAX_IMAGE_BLOCKS } from "../../flow/metadata";
import { useDraftStore } from "../../stores/draftStore";
import { getImageFile, imageSlot, setImageFile } from "../../stores/imageStore";
import { DisplayMetadataStep } from "../DisplayMetadataStep";

/**
 * A branch gallery keeps two stores in step by hand: the draft entry and the
 * bytes under its slot. These pin that neither half can be dropped alone.
 */

const poster = () => new File(["poster-bytes"], "poster.png", { type: "image/png" });

/** The step's file inputs, in screen order: icon, hero, then one per branch. */
const branchInput = (branch: number) => {
  const inputs = document.querySelectorAll<HTMLInputElement>("input[type='file']");
  const input = inputs[2 + branch];
  if (!input) throw new Error(`No uploader for branch ${branch} among ${inputs.length} inputs`);
  return input;
};

const outcomes = () => useDraftStore.getState().draft.outcomes;

beforeEach(() => {
  localStorage.clear();
  const { resetDraft, draft } = useDraftStore.getState();
  for (const image of draft.outcomes.flatMap((o) => o.images)) setImageFile(imageSlot(image.id), null);
  resetDraft();
  // jsdom has no object URLs; the thumbnails only need a stable string.
  URL.createObjectURL ??= vi.fn(() => "blob:test");
  URL.revokeObjectURL ??= vi.fn();
});

const renderStep = () => render(<DisplayMetadataStep assessment={draftAssessment()} active={false} />);

describe("DisplayMetadataStep branch galleries", () => {
  it("stores the picked file and drafts its entry on that branch alone", async () => {
    renderStep();

    await userEvent.upload(branchInput(1), poster());

    expect(outcomes()[0]?.images).toEqual([]);
    const [image] = outcomes()[1]?.images ?? [];
    expect(image?.fileName).toBe("poster.png");
    expect(getImageFile(imageSlot(image!.id))).toBeInstanceOf(File);
  });

  it("removes the entry and the bytes together", async () => {
    renderStep();
    await userEvent.upload(branchInput(0), poster());
    const [image] = outcomes()[0]?.images ?? [];

    await userEvent.click(screen.getByRole("button", { name: "Remove image 1 of outcome 1" }));

    expect(outcomes()[0]?.images).toEqual([]);
    expect(getImageFile(imageSlot(image!.id))).toBeUndefined();
  });

  it("withdraws a full branch's uploader, leaving the other branch its own", () => {
    const { addImage } = useDraftStore.getState();
    const first = outcomes()[0]!.id;
    for (let i = 0; i < MAX_IMAGE_BLOCKS; i++) addImage(first, { id: `g${i}`, title: "Titled", fileName: `g${i}.png` });

    renderStep();

    expect(document.querySelectorAll("input[type='file']")).toHaveLength(3);
    expect(screen.getByText(`All ${MAX_IMAGE_BLOCKS} image slots for this branch are used.`)).toBeInTheDocument();
  });

  it("marks an untitled image until it is titled", async () => {
    renderStep();
    await userEvent.upload(branchInput(0), poster());

    expect(screen.getByText("Required. Shown with the image.")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Title for image 1 of outcome 1" }), "The poster");

    expect(screen.queryByText("Required. Shown with the image.")).not.toBeInTheDocument();
  });
});
