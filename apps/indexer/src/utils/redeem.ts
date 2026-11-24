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

const firstPerSession = (places: Place[]) =>
  places.filter((place, index) => places.findIndex((each) => each.session_id === place.session_id) === index);

/**
 * What `router` redeems `token` as, one place per session: a parent outcome token at Seer's router, a child's token
 * at the conditional router. Sessions asking the same question share tokens.
 */
async function placesOf(context: EvmOnEventContext, router: string, token: string): Promise<Place[]> {
  if (router === GNOSIS_ROUTER) {
    const [outcomes, children, sessions] = await Promise.all([
      context.ParentOutcomeToken.getWhere({ token: { _eq: token } }),
      context.ChildMarket.getWhere({ underlyingToken: { _eq: token } }),
      context.Session.getWhere({ invalidToken: { _eq: token } }),
    ]);
    return firstPerSession([
      ...outcomes.map(({ session_id, parentOutcomeIndex }) => ({
        session_id,
        childMarket_id: undefined,
        parentOutcomeIndex,
      })),
      ...children.map(({ session_id, parentOutcomeIndex }) => ({
        session_id,
        childMarket_id: undefined,
        parentOutcomeIndex,
      })),
      ...sessions.map((session) => ({
        session_id: session.id,
        childMarket_id: undefined,
        parentOutcomeIndex: session.outcomeCount,
      })),
    ]);
  }

  const children = (
    await Promise.all(
      (["downToken", "upToken", "invalidToken"] as const).map((field) =>
        context.ChildMarket.getWhere({ [field]: { _eq: token } }),
      ),
    )
  ).flat();
  return firstPerSession(
    children.map((child) => ({
      session_id: child.session_id,
      childMarket_id: child.id,
      parentOutcomeIndex: child.parentOutcomeIndex,
    })),
  );
}

/**
 * `account`'s net holdings of `token` in each session it predicted in: its trade wallet's transfers of the token in
 * the transactions that predicted in that session, transaction `hash` left out.
 */
async function holdingsBySession(context: EvmOnEventContext, account: string, token: string, hash: string) {
  const [predictions, transfers] = await Promise.all([
    context.Prediction.getWhere({ executor_id: { _eq: account } }),
    context.Transfer.getWhere({ executor_id: { _eq: account }, token: { _eq: token } }),
  ]);
  const markets = [...new Set(predictions.map((prediction) => prediction.childMarket_id))];
  const children = await Promise.all(markets.map((id) => context.ChildMarket.get(id)));
  const sessionOf = new Map(markets.map((id, index) => [id, children[index]?.session_id]));

  const held = new Map<string, bigint>();
  const sessionsOfTx = new Map<string, Set<string>>();
  for (const prediction of predictions) {
    const session = sessionOf.get(prediction.childMarket_id);
    if (prediction.transactionHash === hash || session === undefined) continue;
    held.set(session, 0n);
    const sessions = sessionsOfTx.get(prediction.transactionHash) ?? new Set();
    sessionsOfTx.set(prediction.transactionHash, sessions.add(session));
  }

  for (const transfer of transfers) {
    for (const session of sessionsOfTx.get(transfer.transactionHash) ?? []) {
      held.set(session, (held.get(session) ?? 0n) + transfer.amount);
    }
  }
  return held;
}

/** `total` split by `weights`, floored, the last positive weight taking the remainder so the shares add up. */
function splitBy(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  let last = weights.length - 1;
  while (last > 0 && weights[last] === 0n) last--;
  let given = 0n;
  return weights.map((weight, index) => {
    const share = index === last ? total - given : (total * weight) / sum;
    given += share;
    return share;
  });
}

/**
 * Each session's part of the pulled amount when `places` name several: pro rata by the account's net holdings of the
 * token in each, else wholly the lowest session id among those it predicted in, else among all.
 */
async function attribute(context: EvmOnEventContext, places: Place[], moved: Moved) {
  if (places.length < 2) return places.map((place) => ({ place, amount: moved.value }));

  const held = await holdingsBySession(context, moved.from, moved.token, moved.event.transaction.hash);
  const weights = places.map((place) => {
    const net = held.get(place.session_id) ?? 0n;
    return net > 0n ? net : 0n;
  });
  if (weights.some((weight) => weight > 0n)) {
    const shares = splitBy(moved.value, weights);
    return places.map((place, index) => ({ place, amount: shares[index]! })).filter(({ amount }) => amount > 0n);
  }
  const predicted = places.filter((place) => held.has(place.session_id));
  const [lowest] = [...(predicted.length > 0 ? predicted : places)].sort((a, b) =>
    BigInt(a.session_id) < BigInt(b.session_id) ? -1 : 1,
  );
  return [{ place: lowest!, amount: moved.value }];
}

/** A session token entering a router: held until the router's sDAI payout in the same transaction. */
async function notePull(moved: Moved) {
  const { context, event, token, from, to } = moved;
  const places = await placesOf(context, to, token);
  const parts = await attribute(context, places, moved);
  if (context.isPreload) return;

  for (const { place, amount } of parts) {
    context.RedeemPull.set({
      id: `${from}-${to}-${token}-${place.session_id}`,
      account: from,
      router: to,
      token,
      ...place,
      amount,
      transactionHash: event.transaction.hash,
    });
  }
}

/**
 * The session's collateral leaving a router for an account that sent it tokens in this transaction: one `Redeem` row
 * per session and outcome. At Seer's router, INVALID pulled beside an option is a merge, since a resolved parent pays
 * INVALID only alone.
 */
async function notePayout({ context, event, token, from, to, value }: Moved) {
  const hash = event.transaction.hash;
  const pulls = (await context.RedeemPull.getWhere({ transactionHash: { _eq: hash } })).filter(
    (pull) => pull.account === to && pull.router === from,
  );
  const sessionIds = [...new Set(pulls.map((pull) => pull.session_id))];
  const sessions = await Promise.all(sessionIds.map((id) => context.Session.get(id)));
  const outcomeCount = new Map(
    sessions.flatMap((session) => (session?.collateralToken === token ? [[session.id, session.outcomeCount]] : [])),
  );
  const parts = pulls.filter((pull) => outcomeCount.has(pull.session_id));
  const owners =
    from === CONDITIONAL_ROUTER
      ? await Promise.all([...new Set(parts.map((pull) => pull.token))].map((each) => context.Token.get(each)))
      : [];
  if (parts.length === 0 || context.isPreload) return;

  for (const pull of parts) context.RedeemPull.deleteUnsafe(pull.id);
  const isInvalid = (pull: RedeemPull) => pull.parentOutcomeIndex === outcomeCount.get(pull.session_id);
  if (from === GNOSIS_ROUTER && parts.some(isInvalid) && !parts.every(isInvalid)) return;

  // the indexer has no payout numerators, so one payout splits over its outcomes by the amounts pulled
  const shares = splitBy(
    value,
    parts.map((pull) => pull.amount),
  );
  const rows = new Map<string, { pull: RedeemPull; payout: bigint }>();
  parts.forEach((pull, index) => {
    const key = `${pull.session_id}-${pull.parentOutcomeIndex}`;
    rows.set(key, { pull, payout: (rows.get(key)?.payout ?? 0n) + shares[index]! });
  });

  for (const [key, { pull, payout }] of rows) {
    context.Redeem.set({
      id: `${hash}-${event.logIndex}-${key}`,
      account: to,
      session_id: pull.session_id,
      childMarket_id: pull.childMarket_id,
      parentOutcomeIndex: pull.parentOutcomeIndex,
      payout,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: hash,
    });
  }

  // a redeem's outcome tokens leaving the trade wallet were filed as a Prediction under the tokens' own child
  const traded = new Set([
    ...owners.flatMap((owner) => (owner?.childMarket_id === undefined ? [] : [owner.childMarket_id])),
    ...parts.flatMap((pull) => (pull.childMarket_id === undefined ? [] : [pull.childMarket_id])),
  ]);
  for (const child of traded) context.Prediction.deleteUnsafe(predictionId(hash, to, child));
}

/** Records the redeem a transfer to or from one of Seer's routers is part of; other transfers are left alone. */
export async function trackRedeem(moved: Moved) {
  if ((SEER_ROUTERS as readonly string[]).includes(moved.to)) await notePull(moved);
  if ((SEER_ROUTERS as readonly string[]).includes(moved.from)) await notePayout(moved);
}
