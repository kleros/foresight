import { deployMode } from "../../params";
import type { SessionDeployInput, SessionDeploySnapshot, SessionMetadataInput } from "../../types";

/** One session, sized by branch count: the same one everything downstream tests against. */

/** The clock every test built on these fixtures shares. */
export const NOW_MS = 1_700_000_000_000;

const branches = (childCount: number) => Array.from({ length: childCount }, (_, index) => index);

export function deployInput(childCount: number): SessionDeployInput {
  return {
    multiCategoricalParent: false,
    parent: {
      marketName: "Which director?",
      outcomes: branches(childCount).map((i) => `Director ${i}`),
      tokenNames: branches(childCount).map((i) => `DIRECTOR_${i}`),
      category: "misc",
      lang: "en_US",
      minBond: 10n ** 18n,
      openingTime: 1_800_000_000,
    },
    children: branches(childCount).map((i) => ({
      parentOutcomeIndex: i,
      marketName: `Gross if ${i} directs [$M]`,
      tokenNames: [`D${i}_DOWN`, `D${i}_UP`] as [string, string],
      lowerBound: 0n,
      upperBound: 500n * 10n ** 18n,
      minBond: 10n ** 18n,
      openingTime: 1_800_000_100,
      category: "misc",
      lang: "en_US",
    })),
  };
}

export function metadataInput(childCount: number): Omit<SessionMetadataInput, "heroImage" | "icon"> {
  return {
    title: "Best director",
    description: "Opening weekend gross per director.",
    itemName: "Director",
    itemNamePlural: "Directors",
    children: branches(childCount).map((i) => ({
      outcomeIndex: i,
      displayName: `Director ${i}`,
      color: "#7e1bd4",
    })),
  };
}

/** A run's state as it stands the moment the metadata is on IPFS. */
export function deploySnapshot(
  childCount: number,
  overrides: Partial<SessionDeploySnapshot> = {},
): SessionDeploySnapshot {
  return {
    mode: deployMode(childCount),
    metadataUri: "/ipfs/QmDoc",
    startedAt: Math.floor(NOW_MS / 1000),
    childMarkets: [],
    deploy: deployInput(childCount),
    metadata: { ...metadataInput(childCount), heroImage: "/ipfs/QmHero" },
    ...overrides,
  };
}
