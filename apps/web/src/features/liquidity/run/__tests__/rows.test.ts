import { describe, expect, it } from "vitest";

import { WAD } from "./support/requests";
import { branch, owner, session } from "../../flow/__tests__/support/session";
import { planMerge } from "../../flow/plan";
import type { MergeInput } from "../../types";
import { rowsOf } from "../rows";

describe("a merge's rows", () => {
  it("names each row by the branch that merges, skipping a branch with no complete set", () => {
    // branch 0 holds its outcome already, so the parent merges once branch 1 has merged
    const input: MergeInput = {
      session: session([branch(1), branch(2)]),
      owner,
      balances: {
        branches: [
          { outcome: 5n * WAD, up: 0n, down: 5n * WAD, invalid: 5n * WAD },
          { outcome: 0n, up: 5n * WAD, down: 5n * WAD, invalid: 5n * WAD },
        ],
        parentInvalid: 5n * WAD,
      },
    };
    const plan = planMerge(input);
    expect(plan.branches.map((each) => each.merge > 0n)).toEqual([false, true]);
    expect(plan.parentMerge).toBeGreaterThan(0n);

    const rows = rowsOf({ kind: "merge", input });

    expect(rows.map((row) => row.id)).toEqual(["branch:1", "parent"]);
    expect(rows.flatMap((row) => row.stepIds)).toEqual(plan.txs.map((_, index) => `merge:${index}`));
  });
});
