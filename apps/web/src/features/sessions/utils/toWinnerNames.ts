import type { SessionWinnersQuery } from "@/lib/graphql/generated/graphql";

/**
 * The winning options' names in parent outcome order, as the market page names them; an option with no child
 * market goes by the parent's outcome name. Undefined where the indexer holds no such session.
 */
export function toWinnerNames(result: SessionWinnersQuery, winners: readonly number[]): string[] | undefined {
  const session = result.Session?.[0];
  if (session === undefined) return undefined;
  const childNames = new Map(
    session.children.map((child) => [Number(child.parentOutcomeIndex), child.displayName || child.parentOutcome]),
  );
  return [...winners]
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const name = childNames.get(index) ?? session.outcomes[index];
      return name ? [name] : [];
    });
}
