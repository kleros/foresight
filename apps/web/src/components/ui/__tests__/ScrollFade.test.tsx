import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrollFade } from "../ScrollFade";

/** jsdom lays nothing out, so the scroll container reports the sizes given here. */
function sized(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("counts its own 22px strip, padding included, as room the scroll area gave up", () => {
    // with the strip open, the scroll area is 22px shorter than it would be without it
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(22);
    for (const [scrollHeight, shown] of [
      [323, true],
      [322, false],
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

describe("ScrollFade's cue arrow", () => {
  /** jsdom has no matchMedia; this one answers only the reduced-motion query, as `reduce` says. */
  const prefersReducedMotion = (reduce: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
    }));

  const renderCue = () =>
    render(
      <ScrollFade cue="More below">
        <p>body</p>
      </ScrollFade>,
    );

  it("nudges while the cue shows", () => {
    sized(340, 300);
    renderCue();

    expect(screen.getByTestId("more-below-arrow")).toHaveClass("fs-nudge-down");
  });

  it("stays still once its bursts have run, through a later re-measure", () => {
    sized(340, 300);
    renderCue();
    const arrow = screen.getByTestId("more-below-arrow");

    // jsdom has no AnimationEvent, so React listens for the prefixed name
    fireEvent(arrow, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(arrow).not.toHaveClass("fs-nudge-down");
    fireEvent(window, new Event("resize"));
    expect(arrow).not.toHaveClass("fs-nudge-down");
  });

  it("keeps nudging through a scroll the page makes itself", () => {
    sized(340, 300);
    renderCue();
    const scroller = screen.getByText("body").parentElement!;

    fireEvent.scroll(scroller);
    expect(screen.getByTestId("more-below-arrow")).toHaveClass("fs-nudge-down");
  });

  const visitorScrolls: Array<[string, (scroller: HTMLElement) => void]> = [
    ["a wheel", (scroller) => fireEvent.wheel(scroller, { deltaY: 40 })],
    ["a touch drag", (scroller) => fireEvent.touchMove(scroller)],
    ...["ArrowDown", "PageDown", "End", " "].map(
      (key) =>
        [`the ${JSON.stringify(key)} key`, (scroller: HTMLElement) => fireEvent.keyDown(scroller, { key })] as [
          string,
          (scroller: HTMLElement) => void,
        ],
    ),
  ];
  for (const [name, scroll] of visitorScrolls) {
    it(`stays still for good once the visitor scrolls the area with ${name}`, () => {
      sized(340, 300);
      renderCue();
      const arrow = screen.getByTestId("more-below-arrow");
      const scroller = screen.getByText("body").parentElement!;

      scroll(scroller);
      fireEvent.scroll(scroller);
      expect(arrow).not.toHaveClass("fs-nudge-down");
      // still more below after the scroll, so the cue stays
      expect(screen.getByTestId("more-below")).toHaveClass("opacity-100");
      fireEvent(window, new Event("resize"));
      expect(arrow).not.toHaveClass("fs-nudge-down");
    });
  }

  it("keeps nudging while the arrow keys and space go to a field in the area", () => {
    sized(340, 300);
    render(
      <ScrollFade cue="More below">
        <input aria-label="Amount" />
      </ScrollFade>,
    );
    const field = screen.getByRole("textbox", { name: "Amount" });

    for (const key of ["ArrowDown", "PageDown", " "]) fireEvent.keyDown(field, { key });
    expect(screen.getByTestId("more-below-arrow")).toHaveClass("fs-nudge-down");
  });

  it("does not nudge under reduced motion", () => {
    prefersReducedMotion(true);
    sized(340, 300);
    renderCue();

    expect(screen.getByTestId("more-below")).toHaveClass("opacity-100");
    expect(screen.getByTestId("more-below-arrow")).not.toHaveClass("fs-nudge-down");
  });

  it("does not nudge while nothing is out of view", () => {
    sized(300, 300);
    renderCue();

    expect(screen.getByTestId("more-below-arrow")).not.toHaveClass("fs-nudge-down");
  });
});
