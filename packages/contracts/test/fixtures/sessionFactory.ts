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

export const METADATA_URI = "ipfs://bafybeigd7cvhmnq4session0metadata000000000000000000000000000";

export function phasedOpenArgs(params: DeploySessionParams): [ParentCategoricalConfig, boolean, string] {
  return [params.parent, params.multiCategoricalParent, params.metadataUri];
}

export function childAt(params: DeploySessionParams, index: number): ChildScalarConfig {
  const child = params.children[index];
  if (!child) {
    throw new Error(`Expected child at index ${index}`);
  }
  return child;
}

export const OUTCOME_LABELS = ["Movie A", "Movie B", "Movie C", "Movie D"];

type SessionOverrides = {
  multiCategoricalParent?: boolean;
  childQuestionPrefix?: string;
  metadataUri?: string;
  openingTime?: number;
  /** Appended to market names, so repeated deploys (e.g. simulate-session runs) stay distinguishable. */
  sessionLabel?: string;
};

export function buildTwoOutcomeSession(overrides?: SessionOverrides): DeploySessionParams {
  return buildOutcomeSession(2, overrides);
}

export function buildThreeOutcomeSession(overrides?: SessionOverrides): DeploySessionParams {
  return buildOutcomeSession(3, overrides);
}

export function buildOutcomeSession(outcomeCount: number, overrides?: SessionOverrides): DeploySessionParams {
  const multiCategoricalParent = overrides?.multiCategoricalParent ?? false;
  const childQuestionPrefix = overrides?.childQuestionPrefix ?? "What percentile score will Scooby assign to";
  const openingTime = overrides?.openingTime ?? 1_700_000_000;
  const label = overrides?.sessionLabel ? ` (${overrides.sessionLabel})` : "";

  const outcomes = OUTCOME_LABELS.slice(0, outcomeCount);
  const tokenNames = outcomes.map((outcomeLabel) => outcomeLabel.replace(/\s+/g, "_").toUpperCase());

  return {
    multiCategoricalParent,
    metadataUri: overrides?.metadataUri ?? METADATA_URI,
    parent: {
      marketName: `Which movies will Scooby watch as part of the “Distilled Scooby's Judgement experiment”?${label}`,
      outcomes,
      tokenNames,
      category: "movies",
      lang: "en",
      minBond: parseEther("1"),
      openingTime,
    },
    children: outcomes.map((movieLabel, index) => ({
      parentOutcomeIndex: BigInt(index),
      marketName: `${childQuestionPrefix} ${movieLabel}?${label}[%]`,
      outcomes: ["DOWN", "UP"],
      tokenNames: [`${movieLabel}_DOWN`, `${movieLabel}_UP`],
      lowerBound: 0n,
      upperBound: 100n,
      minBond: parseEther("1"),
      openingTime: openingTime + 100 + index * 100,
      category: "movies",
      lang: "en",
    })),
  };
}

export type { ChildScalarConfig, DeploySessionParams, ParentCategoricalConfig };
