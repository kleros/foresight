import { describe, expect, it } from "vitest";

import type { PredictStage } from "@/features/predict/run/types";

import { predictAction, type PredictActionArgs } from "../predictAction";

const at = (overrides: Partial<PredictActionArgs>): PredictActionArgs => ({
  status: "trading",
  stage: "idle",
  isMoved: false,
  canRetry: false,
  isRecovered: false,
  recoveryPricesReady: true,
  checksChain: false,
  ...overrides,
});

describe("predictAction while trading", () => {
  it.each([
    ["a fresh form", {}, "start"],
    ["moved figures", { stage: "moved", isMoved: true }, "confirm"],
    ["a stored run under review", { stage: "review", isRecovered: true, canRetry: true }, "resume"],
    [
      "a stored run whose credits price is unread",
      { stage: "review", isRecovered: true, recoveryPricesReady: false },
      "none",
    ],
    ["a stopped run to pick up", { stage: "halted", canRetry: true }, "retry"],
    ["a stopped stored run it cannot pick up", { stage: "halted", isRecovered: true }, "none"],
    ["a stopped run with nothing sent", { stage: "halted" }, "start"],
  ] satisfies Array<[string, Partial<PredictActionArgs>, string]>)("%s: %s", (_name, overrides, action) => {
    expect(predictAction(at(overrides))).toBe(action);
  });
});

describe("predictAction on a closed session", () => {
  it.each<Partial<PredictActionArgs>>([
    {},
    { stage: "halted", canRetry: true, checksChain: true },
    { stage: "review", checksChain: true },
  ])("does nothing: %o", (overrides) => {
    expect(predictAction(at({ status: "closed", ...overrides }))).toBe("none");
  });
});

describe.each(["resolved", "unknown"] as const)("predictAction under status %s", (status) => {
  it.each([
    ["a fresh form", {}],
    ["moved figures", { stage: "moved", isMoved: true }],
    ["moved figures over a sent transaction", { stage: "moved", isMoved: true, checksChain: true }],
    ["a stored run under review with nothing outstanding", { stage: "review", isRecovered: true, canRetry: true }],
    ["a stopped run with nothing outstanding", { stage: "halted", canRetry: true }],
    ["a stopped run it cannot pick up, though something is outstanding", { stage: "halted", checksChain: true }],
    ["a run already going", { stage: "signing" as PredictStage, checksChain: true }],
  ] satisfies Array<[string, Partial<PredictActionArgs>]>)("starts and sends nothing for %s", (_name, overrides) => {
    expect(predictAction(at({ status, ...overrides }))).toBe("none");
  });

  it("reads a stopped run's outstanding transaction from the chain", () => {
    expect(predictAction(at({ status, stage: "halted", canRetry: true, checksChain: true }))).toBe("retry");
  });

  it("reads a stored run's outstanding transaction from the chain from review", () => {
    expect(
      predictAction(
        at({
          status,
          stage: "review",
          isRecovered: true,
          canRetry: true,
          checksChain: true,
          recoveryPricesReady: false,
        }),
      ),
    ).toBe("resume");
  });
});
