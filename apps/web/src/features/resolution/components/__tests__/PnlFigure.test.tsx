import { render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PnlFigure, PnlFlow, pnlSentence, signedSdai } from "../PnlFigure";

const CENT = 10n ** 16n;

describe("signedSdai", () => {
  it("reads back as the value cut toward zero to whole cents, signed as those cents are", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), (value) => {
        const match = /^([+-]?)([\d,]+)\.(\d{2}) sDAI$/.exec(signedSdai(value));
        expect(match).not.toBeNull();
        const [, sign, whole, cents] = match!;
        const magnitude = value < 0n ? -value : value;

        expect(BigInt(whole!.replaceAll(",", "")) * 100n + BigInt(cents!)).toBe(magnitude / CENT);
        const shown = magnitude / CENT;
        expect(sign).toBe(shown === 0n ? "" : value > 0n ? "+" : "-");
      }),
    );
  });

  it.each([
    [305n * CENT, "+3.05 sDAI"],
    [-325n * CENT, "-3.25 sDAI"],
    [50n * CENT, "+0.50 sDAI"],
    [123_456_700n * CENT, "+1,234,567.00 sDAI"],
    [0n, "0.00 sDAI"],
    [-1n, "0.00 sDAI"],
    [CENT - 1n, "0.00 sDAI"],
    [-(CENT - 1n), "0.00 sDAI"],
    [-CENT, "-0.01 sDAI"],
  ])("shows %s base units as %s", (value, shown) => {
    expect(signedSdai(value)).toBe(shown);
  });
});

describe("PnlFigure", () => {
  it.each([
    [725n * CENT, "text-fs-tone-success-text"],
    [-475n * CENT, "text-fs-tone-error-text"],
    [0n, "text-fs-text-primary"],
    [-1n, "text-fs-text-primary"],
    [3n, "text-fs-text-primary"],
  ])("tones %s base units with %s", (value, tone) => {
    render(<PnlFigure value={value} />);

    expect(screen.getByText(signedSdai(value))).toHaveClass(tone);
    expect(screen.getByText("P&L:")).toBeInTheDocument();
  });
});

describe("PnlFigure arrow (spec D21)", () => {
  it.each([
    [725n * CENT, "up"],
    [-475n * CENT, "down"],
    [0n, null],
    [CENT - 1n, null],
    [-(CENT - 1n), null],
  ])("marks %s base units with arrow %s", (value, arrow) => {
    const { container } = render(<PnlFigure value={value} />);

    const marks = container.querySelectorAll("[data-arrow]");
    expect(marks).toHaveLength(arrow ? 1 : 0);
    if (arrow) {
      expect(marks[0]).toHaveAttribute("data-arrow", arrow);
      expect(marks[0]).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("pnlSentence", () => {
  it.each([
    [200n * CENT, 323n * CENT, 123n * CENT, "Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI"],
    [500n * CENT, 175n * CENT, -325n * CENT, "Put in 5.00 sDAI, back 1.75 sDAI, loss 3.25 sDAI"],
    [CENT, CENT, 0n, "Put in 0.01 sDAI, back 0.01 sDAI, no profit or loss"],
    [CENT, CENT - 1n, -1n, "Put in 0.01 sDAI, back 0.00 sDAI, no profit or loss"],
  ])("reads cost %s, payout %s, pnl %s as one sentence", (cost, payout, pnl, sentence) => {
    expect(pnlSentence({ cost, payout, pnl })).toBe(sentence);
  });
});

describe("PnlFlow (spec D21)", () => {
  const figures = { cost: 200n * CENT, payout: 323n * CENT, pnl: 123n * CENT };

  it("shows what went in, an arrow, what came back, then the signed P&L", () => {
    const { container } = render(<PnlFlow {...figures} />);
    const shown = container.querySelector("[aria-hidden=true]")!;

    expect(shown).toHaveTextContent(/^2\.00 sDAI→3\.23 sDAIP&L:\+1\.23 sDAI$/);
    expect(screen.getByText("+1.23 sDAI")).toHaveClass("text-fs-tone-success-text");
  });

  it("gives screen readers one sentence and hides the drawn figures from them", () => {
    render(<PnlFlow {...figures} />);

    expect(screen.getByText("Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI")).toHaveClass("sr-only");
    expect(screen.getByText("+1.23 sDAI").closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("tones a loss red with a down arrow", () => {
    const { container } = render(<PnlFlow cost={500n * CENT} payout={175n * CENT} pnl={-325n * CENT} />);

    expect(screen.getByText("-3.25 sDAI")).toHaveClass("text-fs-tone-error-text");
    expect(container.querySelector("[data-arrow]")).toHaveAttribute("data-arrow", "down");
  });
});
