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

  it("shows for an overflow of 1px or 2px where the least overflow is set to 1px", () => {
    for (const scrollHeight of [301, 302]) {
      sized(scrollHeight, 300);
      const { unmount } = render(
        <ScrollFade cue="More below" minOverflow={1}>
          <p>body</p>
        </ScrollFade>,
      );

      expect(screen.getByTestId("more-below")).toHaveClass("opacity-100");
      unmount();
    }
  });

  it("takes no room while nothing is out of view", () => {
    sized(300, 300);
    render(
      <ScrollFade cue="More below" minOverflow={1}>
        <p>body</p>
      </ScrollFade>,
    );

    expect(screen.getByTestId("more-below")).toHaveClass("hidden");
  });

  it("counts its own 16px strip as room the scroll area gave up", () => {
    // with the strip open, the scroll area is 16px shorter than it would be without it
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(16);
    for (const [scrollHeight, shown] of [
      [317, true],
      [316, false],
    ] as const) {
      sized(scrollHeight, 300);
      const { unmount } = render(
        <ScrollFade cue="More below" minOverflow={1}>
          <p>body</p>
        </ScrollFade>,
      );

      expect(screen.getByTestId("more-below")).toHaveClass(shown ? "flex" : "hidden");
      unmount();
    }
  });
});
