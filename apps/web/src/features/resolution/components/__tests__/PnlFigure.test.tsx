import { render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PnlFigure, PnlFlow, pnlSentence, shownPnl, signedSdai } from "../PnlFigure";

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
  });

  it.each([
    [725n * CENT, "profit 7.25 sDAI"],
    [-475n * CENT, "loss 4.75 sDAI"],
    [0n, "no profit or loss"],
  ])("shows no P&L word, and reads %s base units to screen readers as %s", (value, word) => {
    const { container } = render(<PnlFigure value={value} />);

    expect(container).not.toHaveTextContent("P&L");
    expect(screen.getByText(word)).toHaveClass("sr-only");
    expect(screen.getByText(signedSdai(value)).closest("[aria-hidden=true]")).not.toBeNull();
  });
});

describe("shownPnl (spec D21)", () => {
  it("is the shown payout less the shown cost, each cut to cents", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 24n }), fc.bigInt({ min: 0n, max: 10n ** 24n }), (cost, payout) => {
        expect(shownPnl(cost, payout)).toBe(payout - (payout % CENT) - (cost - (cost % CENT)));
      }),
    );
  });

  it("reads 2.65 sDAI to 2.88 sDAI as +0.23, though the exact difference is under 0.23", () => {
    const cost = 2_657_607_962_596_684_975n;
    const payout = 2_882_581_193_218_236_740n;

    expect(payout - cost).toBeLessThan(23n * CENT);
    expect(signedSdai(shownPnl(cost, payout))).toBe("+0.23 sDAI");
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
    [200n * CENT, 323n * CENT, "Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI"],
    [500n * CENT, 175n * CENT, "Put in 5.00 sDAI, back 1.75 sDAI, loss 3.25 sDAI"],
    [CENT, CENT, "Put in 0.01 sDAI, back 0.01 sDAI, no profit or loss"],
    [CENT + 1n, 2n * CENT - 1n, "Put in 0.01 sDAI, back 0.01 sDAI, no profit or loss"],
    [CENT, CENT - 1n, "Put in 0.01 sDAI, back 0.00 sDAI, loss 0.01 sDAI"],
  ])("reads cost %s and payout %s as one sentence", (cost, payout, sentence) => {
    expect(pnlSentence({ cost, payout })).toBe(sentence);
  });
});

describe("PnlFlow (spec D21)", () => {
  const figures = { cost: 200n * CENT, payout: 323n * CENT };

  it("shows what went in, an arrow, what came back, then the signed P&L", () => {
    const { container } = render(<PnlFlow {...figures} />);
    const shown = container.querySelector("[aria-hidden=true]")!;

    expect(shown).toHaveTextContent(/^2\.00 sDAI→3\.23 sDAI\+1\.23 sDAI$/);
    expect(screen.getByText("+1.23 sDAI")).toHaveClass("text-fs-tone-success-text");
  });

  it("gives screen readers one sentence and hides the drawn figures from them", () => {
    render(<PnlFlow {...figures} />);

    expect(screen.getByText("Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI")).toHaveClass("sr-only");
    expect(screen.getByText("+1.23 sDAI").closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("tones a loss red with a down arrow", () => {
    const { container } = render(<PnlFlow cost={500n * CENT} payout={175n * CENT} />);

    expect(screen.getByText("-3.25 sDAI")).toHaveClass("text-fs-tone-error-text");
    expect(container.querySelector("[data-arrow]")).toHaveAttribute("data-arrow", "down");
  });
});

describe("PnlFlow on figures that differ by less than a cent", () => {
  it("shows the shown difference, neutral and with no arrow, where both cut to the same cents", () => {
    const { container } = render(<PnlFlow cost={CENT + 1n} payout={2n * CENT - 1n} />);

    expect(screen.getByText("0.00 sDAI")).toHaveClass("text-fs-text-primary");
    expect(container.querySelector("[data-arrow]")).toBeNull();
  });
});
