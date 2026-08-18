import type { ChildMarketInput, ParentMarketInput } from "./types";

/**
 * The wizard's resolved input, turned into the structs `SessionFactory` takes.
 */

/** Seer creates two outcome tokens for a scalar market, in this order. */
const SCALAR_OUTCOMES = ["DOWN", "UP"] as const;

/**
 * Children per phased transaction.
 */
export const CHILD_BATCH_SIZE = 6;

type ParentConfig = {
  marketName: string;
  outcomes: string[];
  tokenNames: string[];
  category: string;
  lang: string;
  minBond: bigint;
  openingTime: number;
};

export type ChildConfig = {
  parentOutcomeIndex: bigint;
  marketName: string;
  outcomes: string[];
  tokenNames: string[];
  lowerBound: bigint;
  upperBound: bigint;
  minBond: bigint;
  openingTime: number;
  category: string;
  lang: string;
};

function requireText(value: string, what: string): string {
  if (!value.trim()) throw new Error(`${what} is empty.`);
  return value;
}

/** Seer packs every token name into one word, `toString31`, and reverts above it. */
const MAX_TOKEN_BYTES = 31;

function requireTokenNames(names: string[], describe: (index: number) => string): void {
  names.forEach((name, index) => {
    requireText(name, describe(index));
    const bytes = new TextEncoder().encode(name).length;
    if (bytes > MAX_TOKEN_BYTES) {
      throw new Error(`${describe(index)} is ${bytes} bytes. Seer's limit is ${MAX_TOKEN_BYTES}.`);
    }
  });
}

function requireBond(minBond: bigint, what: string): bigint {
  if (minBond <= 0n) {
    throw new Error(`${what} has no minimum bond.`);
  }
  return minBond;
}

export function buildParentConfig(parent: ParentMarketInput): ParentConfig {
  requireText(parent.marketName, "The decision question");
  requireBond(parent.minBond, "The decision market");
  if (parent.outcomes.length < 2) {
    throw new Error("The decision needs at least two outcomes.");
  }
  if (parent.tokenNames.length !== parent.outcomes.length) {
    throw new Error(`The decision has ${parent.outcomes.length} outcomes but ${parent.tokenNames.length} token names.`);
  }
  parent.outcomes.forEach((outcome, index) => requireText(outcome, `Outcome ${index + 1}`));
  // Seer reverts on a token it cannot name, and on one it cannot fit.
  requireTokenNames(parent.tokenNames, (index) => `Token name ${index + 1}`);

  return {
    marketName: parent.marketName,
    outcomes: [...parent.outcomes],
    tokenNames: [...parent.tokenNames],
    category: parent.category,
    lang: parent.lang,
    minBond: parent.minBond,
    openingTime: parent.openingTime,
  };
}

export function buildChildConfigs(
  children: ChildMarketInput[],
  opts: {
    parentOutcomeCount: number;
    parentOpeningTime?: number;
  },
): ChildConfig[] {
  if (children.length !== opts.parentOutcomeCount) {
    throw new Error(`The decision has ${opts.parentOutcomeCount} outcomes but ${children.length} branch markets.`);
  }

  return children.map((child, position) => {
    requireText(child.marketName, `The question for branch ${position + 1}`);
    requireBond(child.minBond, `Branch ${position + 1}`);
    if (child.tokenNames.length !== 2) {
      throw new Error(`Branch ${position + 1} needs two token names, not ${child.tokenNames.length}.`);
    }
    requireTokenNames(child.tokenNames, (index) => `Token name ${index + 1} for branch ${position + 1}`);

    if (child.parentOutcomeIndex !== position) {
      throw new Error(`Branch ${position + 1} claims outcome ${child.parentOutcomeIndex + 1}.`);
    }
    if (child.lowerBound >= child.upperBound) {
      throw new Error(`Branch ${position + 1} has no range: ${child.lowerBound} to ${child.upperBound}.`);
    }
    if (opts.parentOpeningTime !== undefined && child.openingTime < opts.parentOpeningTime) {
      throw new Error(`Branch ${position + 1} closes before the decision does.`);
    }

    return {
      parentOutcomeIndex: BigInt(child.parentOutcomeIndex),
      marketName: child.marketName,
      outcomes: [...SCALAR_OUTCOMES],
      tokenNames: [...child.tokenNames],
      lowerBound: child.lowerBound,
      upperBound: child.upperBound,
      minBond: child.minBond,
      openingTime: child.openingTime,
      category: child.category,
      lang: child.lang,
    };
  });
}

/** One transaction while the children fit, otherwise parent first then batches. */
export function deployMode(childCount: number): "atomic" | "phased" {
  return childCount > CHILD_BATCH_SIZE ? "phased" : "atomic";
}

export function batchCount(childCount: number): number {
  return Math.max(1, Math.ceil(childCount / CHILD_BATCH_SIZE));
}

export function childBatches(children: ChildConfig[]): ChildConfig[][] {
  const batches: ChildConfig[][] = [];
  for (let start = 0; start < children.length; start += CHILD_BATCH_SIZE) {
    batches.push(children.slice(start, start + CHILD_BATCH_SIZE));
  }
  return batches.length > 0 ? batches : [[]];
}
