import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import { collateralVolume } from "../collateralVolume";
import { toSessionDetail } from "../toSessionDetail";
import { sessionChildRow, sessionDetailColumns } from "./fixtures";

const session = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

describe("collateralVolume", () => {
  it("counts an outcome token as one Nth of the collateral", () => {
    // 92000.5 summed over 2 outcomes.
    expect(collateralVolume(session, parseEther("92000.5"))).toBe(46000.25);
  });

  it("falls back to 18 decimals where the collateral read failed", () => {
    const blind = toSessionDetail(
      { ...sessionDetailColumns, collateralDecimals: null, children: [sessionChildRow()] },
      GATEWAY,
    );

    expect(collateralVolume(blind, parseEther("92000.5"))).toBe(46000.25);
  });

  it("reports nothing for a session without outcomes", () => {
    const empty = toSessionDetail({ ...sessionDetailColumns, outcomeCount: "0", children: [] }, GATEWAY);

    expect(collateralVolume(empty, parseEther("1"))).toBeNull();
  });
});
