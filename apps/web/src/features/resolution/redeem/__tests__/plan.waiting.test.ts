import { describe, expect, it } from "vitest";

import { planFor, TWO_WINNERS, unresolvedChild, valuedChild } from "./support/session";

/** Decision 2026-11-23: a waiting row only for a winner in whose child the trade wallet holds a token. */

const bothWaiting = {
  ...TWO_WINNERS,
  children: { 0: unresolvedChild(0), 1: unresolvedChild(1), 2: valuedChild(2, 10n) },
};

describe("the options a trade wallet redeem lists as waiting", () => {
  it("leaves out a winner whose unresolved child the trade wallet holds nothing of", () => {
    const plan = planFor({ resolution: bothWaiting, childBalances: [[0n, 0n, 0n], [0n, 0n, 0n], []] });

    expect(plan.waiting).toEqual([]);
  });

  it("lists a winner for any one held token of its unresolved child, INVALID included", () => {
    for (const slot of [0, 1, 2]) {
      const held = [0n, 0n, 0n];
      held[slot] = 1n;
      expect(planFor({ resolution: bothWaiting, childBalances: [[], held, []] }).waiting).toEqual([1]);
    }
  });

  it("lists every held waiting winner in option order", () => {
    expect(planFor({ resolution: bothWaiting }).waiting).toEqual([0, 1]);
  });

  it("does not list a losing option's unresolved child, though the trade wallet holds it", () => {
    const resolution = { ...TWO_WINNERS, children: { ...TWO_WINNERS.children, 2: unresolvedChild(2) } };
    expect(planFor({ resolution }).waiting).toEqual([]);
  });
});
