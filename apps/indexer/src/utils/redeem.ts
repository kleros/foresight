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

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

const bySessionId = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/** `total` split by `weights`, floored, the last positive weight taking the remainder so the shares add up. */
function splitBy(total: bigint, weights: bigint[]): bigint[] {
  const whole = sum(weights);
  let last = weights.length - 1;
  while (last > 0 && weights[last] === 0n) last--;
  let given = 0n;
  return weights.map((weight, index) => {
    const share = index === last ? total - given : (total * weight) / whole;
    given += share;
    return share;
  });
}

/** One move of a token in or out of an account, as its `Transfer` row holds it. */
export interface LedgerMove {
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
  /** Negative leaving the account. */
  amount: bigint;
}

const inChainOrder = (a: LedgerMove, b: LedgerMove) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

/**
 * The holdings of one token in each of `sessions` (sorted by id), replayed in chain order from `held`: a transaction
 * that predicted in some of them (`sessionsOfTx`) moves theirs, split evenly; any other moves the holders pro rata by
 * what they hold.
 */
export function replayHoldings(
  moves: LedgerMove[],
  sessionsOfTx: ReadonlyMap<string, ReadonlySet<string>>,
  sessions: readonly string[],
  held = new Map<string, bigint>(),
) {
  const nets = new Map<string, bigint>();
  for (const move of [...moves].sort(inChainOrder)) {
    nets.set(move.transactionHash, (nets.get(move.transactionHash) ?? 0n) + move.amount);
  }

  for (const [tx, net] of nets) {
    const own = [...(sessionsOfTx.get(tx) ?? [])].filter((session) => sessions.includes(session)).sort(bySessionId);
    const holders = own.length > 0 ? own : sessions.filter((session) => (held.get(session) ?? 0n) > 0n);
    if (holders.length === 0) continue;
    const weights = own.length > 0 ? own.map(() => 1n) : holders.map((session) => held.get(session)!);
    // an outflow beyond what the holders hold empties them
    const moved = own.length === 0 && -net > sum(weights) ? -sum(weights) : net;
    splitBy(moved, weights).forEach((share, index) => {
      held.set(holders[index]!, (held.get(holders[index]!) ?? 0n) + share);
    });
  }
  return held;
}

/**
 * `account`'s holdings of `token` in each of `sessions` (sorted by id), transaction `hash` left out. A session the
 * account predicted in has an entry, even at zero.
 */
async function holdingsBySession(
  context: EvmOnEventContext,
  account: string,
  token: string,
  hash: string,
  sessions: string[],
) {
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
    if (prediction.transactionHash === hash || session === undefined || !sessions.includes(session)) continue;
    held.set(session, 0n);
    const own = sessionsOfTx.get(prediction.transactionHash) ?? new Set();
    sessionsOfTx.set(prediction.transactionHash, own.add(session));
  }

  return replayHoldings(
    transfers.filter((transfer) => transfer.transactionHash !== hash),
    sessionsOfTx,
    sessions,
    held,
  );
}

/**
 * Each session's part of the pulled amount when `places` name several: pro rata by the account's net holdings of the
 * token in each, else wholly the lowest session id among those it predicted in, else among all.
 */
async function attribute(context: EvmOnEventContext, places: Place[], moved: Moved) {
  if (places.length < 2) return places.map((place) => ({ place, amount: moved.value }));

  const sorted = [...places].sort((a, b) => bySessionId(a.session_id, b.session_id));
  const held = await holdingsBySession(
    context,
    moved.from,
    moved.token,
    moved.event.transaction.hash,
    sorted.map((place) => place.session_id),
  );
  const weights = sorted.map((place) => {
    const net = held.get(place.session_id) ?? 0n;
    return net > 0n ? net : 0n;
  });
  if (weights.some((weight) => weight > 0n)) {
    const shares = splitBy(moved.value, weights);
    return sorted.map((place, index) => ({ place, amount: shares[index]! })).filter(({ amount }) => amount > 0n);
  }
  const predicted = sorted.filter((place) => held.has(place.session_id));
  return [{ place: (predicted.length > 0 ? predicted : sorted)[0]!, amount: moved.value }];
}

/**
 * Each pull's part of one payout from Seer's router. A Seer categorical parent pays each winning outcome 1/k, floored
 * per token, so the k up to `options` whose floors add up to the payout prices each token; failing one, the tokens
 * split it by amount. A token pulled for several sessions splits its part by their amounts.
 */
function parentShares(value: bigint, pulls: RedeemPull[], options: bigint): bigint[] {
  const tokens = [...new Set(pulls.map((pull) => pull.token))];
  const pullsOf = tokens.map((token) => pulls.filter((pull) => pull.token === token));
  const amounts = pullsOf.map((own) => sum(own.map((pull) => pull.amount)));
  let paid = splitBy(value, amounts);
  for (let k = 1n; k <= options; k++) {
    const floors = amounts.map((amount) => amount / k);
    if (sum(floors) === value) {
      paid = floors;
      break;
    }
  }

  const shares = new Map<RedeemPull, bigint>();
  pullsOf.forEach((own, index) => {
    splitBy(
      paid[index]!,
      own.map((pull) => pull.amount),
    ).forEach((share, at) => shares.set(own[at]!, share));
  });
  return pulls.map((pull) => shares.get(pull)!);
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
  const parts = pulls
    .filter((pull) => outcomeCount.has(pull.session_id))
    .sort((a, b) => bySessionId(a.session_id, b.session_id) || a.token.localeCompare(b.token));
  const owners =
    from === CONDITIONAL_ROUTER
      ? await Promise.all([...new Set(parts.map((pull) => pull.token))].map((each) => context.Token.get(each)))
      : [];
  if (parts.length === 0 || context.isPreload) return;

  for (const pull of parts) context.RedeemPull.deleteUnsafe(pull.id);
  const isInvalid = (pull: RedeemPull) => pull.parentOutcomeIndex === outcomeCount.get(pull.session_id);
  if (from === GNOSIS_ROUTER && parts.some(isInvalid) && !parts.every(isInvalid)) return;

  const options = sessions.reduce(
    (most, session) => (session && session.outcomeCount > most ? session.outcomeCount : most),
    0n,
  );
  const shares =
    from === GNOSIS_ROUTER
      ? parentShares(value, parts, options)
      : splitBy(
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
