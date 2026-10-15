import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrollFade } from "../ScrollFade";

/** jsdom lays nothing out, so the scroll container reports the sizes given here. */
function sized(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

afterEach(() => vi.restoreAllMocks());

describe("ScrollFade's cue", () => {
  it("stays hidden when less than a line is out of view", () => {
    sized(309, 300);
    render(
      <ScrollFade cue="More below">
        <p>body</p>
      </ScrollFade>,
    );

    expect(screen.getByTestId("more-below")).toHaveClass("opacity-0");
  });

  it("shows when a line or more is out of view", () => {
    sized(340, 300);
    render(
      <ScrollFade cue="More below">
        <p>body</p>
      </ScrollFade>,
    );

    expect(screen.getByTestId("more-below")).toHaveClass("opacity-100");
  });
});
