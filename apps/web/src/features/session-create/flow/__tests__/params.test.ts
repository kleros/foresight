import { describe, expect, it } from "vitest";

import {
  batchCount,
  buildChildConfigs,
  buildParentConfig,
  childBatches,
  CHILD_BATCH_SIZE,
  deployMode,
} from "../params";
import type { ChildMarketInput, SessionDeployInput } from "../types";

/**
 * These become calldata, and a session cannot be edited once deployed. The
 * shapes below are the ones Seer's factory accepts. The contracts package
 * fixture `buildOutcomeSession` is the reference implementation.
 */

function child(index: number, overrides: Partial<ChildMarketInput> = {}): ChildMarketInput {
  return {
    parentOutcomeIndex: index,
    marketName: `Opening weekend gross if director ${index} directs [$M]`,
    tokenNames: [`D${index}_DOWN`, `D${index}_UP`],
    lowerBound: 0n,
    upperBound: 500_000000000000000000n,
    minBond: 1_000000000000000000n,
    openingTime: 1_800_000_100,
    category: "misc",
    lang: "en_US",
    ...overrides,
  };
}

function input(childCount: number): SessionDeployInput {
  return {
    parent: {
      marketName: "Which director for Dune: Part Three?",
      outcomes: Array.from({ length: childCount }, (_, i) => `Director ${i}`),
      tokenNames: Array.from({ length: childCount }, (_, i) => `DIRECTOR_${i}`),
      category: "misc",
      lang: "en_US",
      minBond: 1_000000000000000000n,
      openingTime: 1_800_000_000,
    },
    children: Array.from({ length: childCount }, (_, i) => child(i)),
    multiCategoricalParent: false,
  };
}

const configs = (children: ChildMarketInput[], opts: { parentOpeningTime?: number } = {}) =>
  buildChildConfigs(children, { parentOutcomeCount: children.length, ...opts });

describe("buildParentConfig", () => {
  it("passes the parent through in the shape the factory expects", () => {
    expect(buildParentConfig(input(2).parent)).toEqual({
      marketName: "Which director for Dune: Part Three?",
      outcomes: ["Director 0", "Director 1"],
      tokenNames: ["DIRECTOR_0", "DIRECTOR_1"],
      category: "misc",
      lang: "en_US",
      minBond: 1_000000000000000000n,
      openingTime: 1_800_000_000,
    });
  });
});

describe("buildChildConfigs", () => {
  it("gives every scalar child Seer's DOWN/UP outcomes", () => {
    const [first] = configs(input(2).children);

    expect(first?.outcomes).toEqual(["DOWN", "UP"]);
    expect(first?.tokenNames).toEqual(["D0_DOWN", "D0_UP"]);
  });

  it("keeps the outcome index", () => {
    expect(configs(input(3).children).map((c) => c.parentOutcomeIndex)).toEqual([0n, 1n, 2n]);
  });

  it("carries the bounds through unscaled", () => {
    const [first] = configs(input(1).children);

    expect(first?.lowerBound).toBe(0n);
    expect(first?.upperBound).toBe(500_000000000000000000n);
  });

  it("refuses a child whose index does not match its position", () => {
    const misordered = [child(0), child(2)];

    expect(() => configs(misordered)).toThrow(/claims outcome/i);
  });

  it("refuses an opening time before the parent's", () => {
    expect(() => configs([child(0, { openingTime: 1_700_000_000 })], { parentOpeningTime: 1_800_000_000 })).toThrow(
      /before the decision/i,
    );
  });

  it("accepts a child opening exactly with the parent", () => {
    expect(() =>
      configs([child(0, { openingTime: 1_800_000_000 })], { parentOpeningTime: 1_800_000_000 }),
    ).not.toThrow();
  });

  it("refuses bounds that are not strictly increasing", () => {
    expect(() => configs([child(0, { lowerBound: 10n, upperBound: 10n })])).toThrow(/no range/i);
  });

  it("refuses fewer branches than the decision has outcomes", () => {
    const short = input(7).children.slice(0, 6);

    expect(() => buildChildConfigs(short, { parentOutcomeCount: 7 })).toThrow(/7 outcomes but 6/);
  });

  it("refuses more branches than the decision has outcomes", () => {
    expect(() => buildChildConfigs(input(7).children, { parentOutcomeCount: 6 })).toThrow(/6 outcomes but 7/);
  });
});

/** Shapes the factory and Seer assume without checking. */
describe("buildChildConfigs, against a snapshot the wizard did not produce", () => {
  it("refuses anything but two token names on a scalar market", () => {
    const oneToken = [child(0, { tokenNames: ["D0_DOWN"] as unknown as [string, string] })];

    expect(() => configs(oneToken)).toThrow(/two token names/i);
  });

  it("refuses a branch with no question", () => {
    expect(() => configs([child(0, { marketName: "   " })])).toThrow(/is empty/i);
  });

  it("refuses a scalar token Seer could not wrap into one word", () => {
    const tooLong = [child(0, { tokenNames: ["A".repeat(32), "D0_UP"] })];

    expect(() => configs(tooLong)).toThrow(/32 bytes.*limit is 31/i);
  });

  it("refuses a zero bond on a branch", () => {
    expect(() => configs([child(0, { minBond: 0n })])).toThrow(/bond/i);
  });
});

describe("buildParentConfig, against a snapshot the wizard did not produce", () => {
  const parent = (overrides: Partial<SessionDeployInput["parent"]>) => ({ ...input(2).parent, ...overrides });

  it("refuses a decision with one outcome", () => {
    expect(() => buildParentConfig(parent({ outcomes: ["Only"], tokenNames: ["ONLY"] }))).toThrow(/at least two/i);
  });

  it("refuses a token name count that does not match the outcomes", () => {
    expect(() => buildParentConfig(parent({ tokenNames: ["DIRECTOR_0"] }))).toThrow(/token names/i);
  });

  it("refuses a nameless outcome token, which Seer will not wrap", () => {
    expect(() => buildParentConfig(parent({ tokenNames: ["DIRECTOR_0", ""] }))).toThrow(/Token name 2 is empty/i);
  });

  it("refuses an outcome token too long for Seer to wrap into one word", () => {
    expect(() => buildParentConfig(parent({ tokenNames: ["DIRECTOR_0", "A".repeat(32)] }))).toThrow(
      /Token name 2 is 32 bytes/i,
    );
  });

  it("counts the bytes rather than the characters, which multi-byte names differ in", () => {
    // 11 characters, 33 bytes: inside a length check, past Seer's limit.
    expect(() => buildParentConfig(parent({ tokenNames: ["DIRECTOR_0", "北".repeat(11)] }))).toThrow(/is 33 bytes/i);
  });

  it("refuses a decision with no question", () => {
    expect(() => buildParentConfig(parent({ marketName: "" }))).toThrow(/is empty/i);
  });

  it("refuses a zero bond on the decision", () => {
    expect(() => buildParentConfig(parent({ minBond: 0n }))).toThrow(/bond/i);
  });
});

describe("deployMode", () => {
  it("keeps a session that exactly fills a batch atomic", () => {
    expect(deployMode(CHILD_BATCH_SIZE)).toBe("atomic");
  });

  it("goes phased past the batch size", () => {
    expect(deployMode(CHILD_BATCH_SIZE + 1)).toBe("phased");
  });
});

describe("batchCount", () => {
  it("counts one batch for an atomic session", () => {
    expect(batchCount(0)).toBe(1);
    expect(batchCount(CHILD_BATCH_SIZE)).toBe(1);
  });

  it("agrees with childBatches", () => {
    for (const count of [1, 6, 7, 12, 13, 14, 31]) {
      expect(batchCount(count)).toBe(childBatches(configs(input(count).children)).length);
    }
  });
});

describe("childBatches", () => {
  it("leaves an atomic session as one batch", () => {
    expect(childBatches(configs(input(3).children))).toHaveLength(1);
  });

  it("splits a large session into batches, the last one short", () => {
    const batches = childBatches(configs(input(CHILD_BATCH_SIZE * 2 + 2).children));

    expect(batches.map((b) => b.length)).toEqual([CHILD_BATCH_SIZE, CHILD_BATCH_SIZE, 2]);
  });

  it("keeps children in order across batches", () => {
    const batches = childBatches(configs(input(8).children));

    expect(batches.flat().map((c) => c.parentOutcomeIndex)).toEqual(Array.from({ length: 8 }, (_, i) => BigInt(i)));
  });
});
