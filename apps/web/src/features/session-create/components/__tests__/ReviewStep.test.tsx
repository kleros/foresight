import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { draftAssessment } from "../../__tests__/support/drafts";
import { useDraftStore } from "../../stores/draftStore";
import { ReviewStep } from "../ReviewStep";

beforeEach(() => {
  localStorage.clear();
  useDraftStore.getState().resetDraft();
});

describe("ReviewStep, the decision card", () => {
  it("labels the decision date as when resolution opens", () => {
    render(<ReviewStep assessment={draftAssessment()} active onGoToStep={vi.fn()} />);

    expect(screen.getByText(/^Resolution opens /)).toBeInTheDocument();
  });
});
