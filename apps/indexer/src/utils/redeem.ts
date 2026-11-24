import type { EvmOnEventContext, RedeemPull } from "envio";

import { predictionId } from "./ids";

/** Seer's routers at their Gnosis addresses, which a Gnosis fork keeps. */
export const GNOSIS_ROUTER = "0xec9048b59b3467415b1a38f63416407ea0c70fb8";
export const CONDITIONAL_ROUTER = "0x774284d5cdfec3a0a0ebc7283ad4d5b33013c29c";
export const SEER_ROUTERS = [GNOSIS_ROUTER, CONDITIONAL_ROUTER] as const;

type Place = Pick<RedeemPull, "session_id" | "childMarket_id" | "parentOutcomeIndex">;

interface Moved {
  context: EvmOnEventContext;
  event: { transaction: { hash: string }; logIndex: number; block: { number: number; timestamp: number } };
  token: string;
  from: string;
  to: string;
  value: bigint;
}

/** What `router` redeems `token` as: a parent outcome token at Seer's router, a child's token at the conditional router. */
async function placeOf(context: EvmOnEventContext, router: string, token: string): Promise<Place | undefined> {
  if (router === GNOSIS_ROUTER) {
    const [[child], [session]] = await Promise.all([
      context.ChildMarket.getWhere({ underlyingToken: { _eq: token } }),
      context.Session.getWhere({ invalidToken: { _eq: token } }),
    ]);
    if (child) {
      return { session_id: child.session_id, childMarket_id: undefined, parentOutcomeIndex: child.parentOutcomeIndex };
    }
    return session && { session_id: session.id, childMarket_id: undefined, parentOutcomeIndex: session.outcomeCount };
  }

  const [known, [invalidOf]] = await Promise.all([
    context.Token.get(token),
    context.ChildMarket.getWhere({ invalidToken: { _eq: token } }),
  ]);
  const child = known?.childMarket_id === undefined ? invalidOf : await context.ChildMarket.get(known.childMarket_id);
  return (
    child && { session_id: child.session_id, childMarket_id: child.id, parentOutcomeIndex: child.parentOutcomeIndex }
  );
}

/** A session token entering a router: held until the router's sDAI payout in the same transaction. */
async function notePull({ context, event, token, from, to, value }: Moved) {
  const place = await placeOf(context, to, token);
  if (place === undefined || context.isPreload) return;

  context.RedeemPull.set({
    id: `${from}-${to}-${token}`,
    account: from,
    router: to,
    ...place,
    amount: value,
    transactionHash: event.transaction.hash,
  });
}

/**
 * The session's collateral leaving a router for an account that sent it tokens in this transaction: one `Redeem`
 * row per redeemed outcome. At Seer's router, pulls naming the parent's INVALID beside an option are read as a
 * merge, on the premise that a resolved parent pays INVALID only alone.
 */
async function notePayout({ context, event, token, from, to, value }: Moved) {
  const hash = event.transaction.hash;
  const pulls = (await context.RedeemPull.getWhere({ transactionHash: { _eq: hash } })).filter(
    (pull) => pull.account === to && pull.router === from,
  );
  const first = pulls[0];
  if (first === undefined) return;
  const session = await context.Session.get(first.session_id);
  if (session?.collateralToken !== token || context.isPreload) return;

  for (const pull of pulls) context.RedeemPull.deleteUnsafe(pull.id);
  const parts = pulls.filter((pull) => pull.session_id === session.id);
  const base = {
    account: to,
    session_id: session.id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    transactionHash: hash,
  };

  if (from === CONDITIONAL_ROUTER) {
    context.Redeem.set({
      ...base,
      id: `${hash}-${event.logIndex}`,
      childMarket_id: first.childMarket_id,
      parentOutcomeIndex: first.parentOutcomeIndex,
      payout: value,
    });
    if (first.childMarket_id !== undefined)
      context.Prediction.deleteUnsafe(predictionId(hash, to, first.childMarket_id));
    return;
  }

  const invalid = parts.some((pull) => pull.parentOutcomeIndex === session.outcomeCount);
  if (invalid && parts.length > 1) return;

  // the indexer has no payout numerators, so one payout splits over its outcomes by the amounts pulled
  const pulled = parts.reduce((sum, pull) => sum + pull.amount, 0n);
  let paid = 0n;
  parts.forEach((pull, index) => {
    const payout = index === parts.length - 1 ? value - paid : (value * pull.amount) / pulled;
    paid += payout;
    context.Redeem.set({
      ...base,
      id: `${hash}-${event.logIndex}-${pull.parentOutcomeIndex}`,
      childMarket_id: undefined,
      parentOutcomeIndex: pull.parentOutcomeIndex,
      payout,
    });
  });
}

/** Records the redeem a transfer to or from one of Seer's routers is part of; other transfers are left alone. */
export async function trackRedeem(moved: Moved) {
  if ((SEER_ROUTERS as readonly string[]).includes(moved.to)) await notePull(moved);
  if ((SEER_ROUTERS as readonly string[]).includes(moved.from)) await notePayout(moved);
}
