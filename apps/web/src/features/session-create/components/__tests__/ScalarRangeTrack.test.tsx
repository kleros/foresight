import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScalarRangeTrack } from "../ScalarRangeTrack";

describe("ScalarRangeTrack", () => {
  it("shows both bounds with the unit", () => {
    render(<ScalarRangeTrack lowerBound={0} upperBound={500} unit="$M" />);

    expect(screen.getByText("0 $M")).toBeInTheDocument();
    expect(screen.getByText("500 $M")).toBeInTheDocument();
  });

  it("reads without a unit, which the draft may not have yet", () => {
    render(<ScalarRangeTrack lowerBound={0} upperBound={500} />);

    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("groups thousands, so a wide range stays readable", () => {
    render(<ScalarRangeTrack lowerBound={0} upperBound={1_250_000} unit="$" />);

    expect(screen.getByText("1,250,000 $")).toBeInTheDocument();
  });
});
