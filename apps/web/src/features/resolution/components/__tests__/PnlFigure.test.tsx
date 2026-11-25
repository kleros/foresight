import { render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PnlFigure, signedSdai } from "../PnlFigure";

const CENT = 10n ** 16n;

describe("signedSdai", () => {
  it("reads back as the value cut toward zero to whole cents, with its sign", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), (value) => {
        const match = /^([+-]?)([\d,]+)\.(\d{2}) sDAI$/.exec(signedSdai(value));
        expect(match).not.toBeNull();
        const [, sign, whole, cents] = match!;
        const magnitude = value < 0n ? -value : value;

        expect(BigInt(whole!.replaceAll(",", "")) * 100n + BigInt(cents!)).toBe(magnitude / CENT);
        expect(sign).toBe(value > 0n ? "+" : value < 0n ? "-" : "");
      }),
    );
  });

  it.each([
    [305n * CENT, "+3.05 sDAI"],
    [-325n * CENT, "-3.25 sDAI"],
    [50n * CENT, "+0.50 sDAI"],
    [123_456_700n * CENT, "+1,234,567.00 sDAI"],
    [0n, "0.00 sDAI"],
  ])("shows %s base units as %s", (value, shown) => {
    expect(signedSdai(value)).toBe(shown);
  });
});

describe("PnlFigure", () => {
  it.each([
    [725n * CENT, "text-fs-tone-success-text"],
    [-475n * CENT, "text-fs-tone-error-text"],
    [0n, "text-fs-text-primary"],
  ])("tones %s base units with %s", (value, tone) => {
    render(<PnlFigure value={value} />);

    expect(screen.getByText(signedSdai(value))).toHaveClass(tone);
    expect(screen.getByText("P&L:")).toBeInTheDocument();
  });
});
