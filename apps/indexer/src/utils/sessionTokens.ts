import type { EvmOnEventContext } from "envio";

/** What a token is in one session. */
export interface TokenPlace {
  session: string;
  /** The parent's INVALID is the session's outcomeCount. */
  parentOutcomeIndex: bigint;
  /** Undefined for a parent token. */
  childMarket: string | undefined;
  /** The token's index in its market's payout numerators: the parent outcome, or a child's DOWN 0, UP 1, INVALID 2. */
  slot: number;
  /** The parent's INVALID token. */
  invalid: boolean;
}

export const bySessionId = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/**
 * Every session `token` belongs to, one place each, in session id order. Seer gives sessions asking the same question
 * the same tokens. Parent tokens are read from both the token index and the children priced against them, since a
 * phased session may have no child yet.
 */
export async function placesOf(context: EvmOnEventContext, token: string): Promise<TokenPlace[]> {
  const [indexed, underlying, down, up, childInvalid, parentInvalid] = await Promise.all([
    context.ParentOutcomeToken.getWhere({ token: { _eq: token } }),
    context.ChildMarket.getWhere({ underlyingToken: { _eq: token } }),
    context.ChildMarket.getWhere({ downToken: { _eq: token } }),
    context.ChildMarket.getWhere({ upToken: { _eq: token } }),
    context.ChildMarket.getWhere({ invalidToken: { _eq: token } }),
    context.Session.getWhere({ invalidToken: { _eq: token } }),
  ]);

  const places: TokenPlace[] = [
    ...indexed.map((row) => ({
      session: row.session_id,
      parentOutcomeIndex: row.parentOutcomeIndex,
      childMarket: undefined,
      slot: Number(row.parentOutcomeIndex),
      invalid: row.invalid,
    })),
    ...underlying.map((child) => ({
      session: child.session_id,
      parentOutcomeIndex: child.parentOutcomeIndex,
      childMarket: undefined,
      slot: Number(child.parentOutcomeIndex),
      invalid: false,
    })),
    ...(
      [
        [down, 0],
        [up, 1],
        [childInvalid, 2],
      ] as const
    ).flatMap(([children, slot]) =>
      children.map((child) => ({
        session: child.session_id,
        parentOutcomeIndex: child.parentOutcomeIndex,
        childMarket: child.id,
        slot,
        invalid: false,
      })),
    ),
    ...parentInvalid.map((session) => ({
      session: session.id,
      parentOutcomeIndex: session.outcomeCount,
      childMarket: undefined,
      slot: Number(session.outcomeCount),
      invalid: true,
    })),
  ];

  return places
    .filter((place, index) => places.findIndex((each) => each.session === place.session) === index)
    .sort((a, b) => bySessionId(a.session, b.session));
}
