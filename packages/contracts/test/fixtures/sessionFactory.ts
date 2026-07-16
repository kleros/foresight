import { parseEther } from "ethers";

import { type SessionFactory } from "../../typechain-types";

type ParentCategoricalConfig = SessionFactory.ParentCategoricalConfigStruct;
type ChildScalarConfig = SessionFactory.ChildScalarConfigStruct;
type DeploySessionParams = SessionFactory.DeploySessionParamsStruct;

export enum MarketKind {
  Categorical,
  MultiCategorical,
  Scalar,
}

export function phasedOpenArgs(params: DeploySessionParams): [ParentCategoricalConfig, boolean] {
  return [params.parent, params.multiCategoricalParent];
}

export function childAt(params: DeploySessionParams, index: number): ChildScalarConfig {
  const child = params.children[index];
  if (!child) {
    throw new Error(`Expected child at index ${index}`);
  }
  return child;
}

export function buildTwoOutcomeSession(overrides?: {
  multiCategoricalParent?: boolean;
  childQuestionPrefix?: string;
}): DeploySessionParams {
  return buildOutcomeSession(2, overrides);
}

export function buildThreeOutcomeSession(overrides?: {
  multiCategoricalParent?: boolean;
  childQuestionPrefix?: string;
}): DeploySessionParams {
  return buildOutcomeSession(3, overrides);
}

function buildOutcomeSession(
  outcomeCount: number,
  overrides?: {
    multiCategoricalParent?: boolean;
    childQuestionPrefix?: string;
  },
): DeploySessionParams {
  const multiCategoricalParent = overrides?.multiCategoricalParent ?? false;
  const childQuestionPrefix = overrides?.childQuestionPrefix ?? "What percentile score will Scooby assign to";

  const movieLabels = ["Movie A", "Movie B", "Movie C", "Movie D"];
  const outcomes = movieLabels.slice(0, outcomeCount);
  const tokenNames = outcomes.map((label) => label.replace(/\s+/g, "_").toUpperCase());

  return {
    multiCategoricalParent,
    parent: {
      marketName: "Which movies will Scooby watch as part of the “Distilled Scooby's Judgement experiment”?",
      outcomes,
      tokenNames,
      category: "movies",
      lang: "en",
      minBond: parseEther("1"),
      openingTime: 1_700_000_000,
    },
    children: outcomes.map((movieLabel, index) => ({
      parentOutcomeIndex: BigInt(index),
      marketName: `${childQuestionPrefix} ${movieLabel}?[%]`,
      outcomes: ["DOWN", "UP"],
      tokenNames: [`${movieLabel}_DOWN`, `${movieLabel}_UP`],
      lowerBound: 0n,
      upperBound: 100n,
      minBond: parseEther("1"),
      openingTime: 1_700_000_100 + index * 100,
      category: "movies",
      lang: "en",
    })),
  };
}

export type { ChildScalarConfig, DeploySessionParams, ParentCategoricalConfig };
