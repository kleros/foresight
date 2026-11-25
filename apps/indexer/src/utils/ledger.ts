import type { EvmOnEventContext, SessionMove } from "envio";

import { allocate } from "./bigint";
import { GNOSIS_ROUTER } from "./routers";
import { placesOf, type TokenPlace } from "./sessionTokens";

/**
 * A trade wallet's session tokens, credited per session (`SessionMove`). A token several sessions share is split per
 * move: a redeem's pull pro rata by holdings before the transaction (spec D17); another move evenly between the
 * sessions its transaction names by a prediction or a token only one session holds; else pro rata by holdings, or
 * evenly when no session holds it.
 */

export interface LedgerMove {
  account: string;
  token: string;
  /** Positive into the trade wallet. */
  amount: bigint;
  counterparty: string;
  hash: string;
  logIndex: number;
  blockNumber: bigint;
  /** The session of the prediction this move is part of. */
  predicted: string | undefined;
}

/** One shared move of a transaction, before it is split. */
interface SharedMove {
  token: string;
  logIndex: number;
  blockNumber: bigint;
  amount: bigint;
  costly: boolean;
  redeemed: boolean;
}

/** Each move's part per session, keyed by log index; a pull's parts are what left the account, so negative. */
export type Parts = Map<number, Map<string, bigint>>;

const moveId = (hash: string, logIndex: number, account: string, session: string) =>
  `${hash}-${logIndex}-${account}-${session}`;

const txRows = async (context: EvmOnEventContext, account: string, hash: string) =>
  (await context.SessionMove.getWhere({ transactionHash: { _eq: hash } })).filter((row) => row.account === account);

function sharedMoves(rows: SessionMove[]): Map<number, SharedMove> {
  const moves = new Map<number, SharedMove>();
  for (const row of rows.filter((each) => each.shared)) {
    const move = moves.get(row.logIndex) ?? {
      token: row.token,
      logIndex: row.logIndex,
      blockNumber: row.blockNumber,
      amount: 0n,
      costly: false,
      redeemed: false,
    };
    moves.set(row.logIndex, {
      ...move,
      amount: move.amount + row.amount,
      costly: move.costly || row.cost !== 0n,
      redeemed: move.redeemed || row.redeemed,
    });
  }
  return moves;
}

/** The sessions whose predictions the transaction made, from its `Prediction` rows. */
async function predictedSessions(context: EvmOnEventContext, account: string, hash: string) {
  const predictions = (await context.Prediction.getWhere({ transactionHash: { _eq: hash } })).filter(
    (row) => row.executor_id === account,
  );
  const children = await Promise.all(
    [...new Set(predictions.map((row) => row.childMarket_id))].map((id) => context.ChildMarket.get(id)),
  );
  return children.flatMap((child) => (child ? [child.session_id] : []));
}

/** The account's balance of `token` in each session, from the ledger, transaction `hash` left out. */
async function holdingsBefore(context: EvmOnEventContext, account: string, token: string, hash: string) {
  const rows = await context.SessionMove.getWhere({ account: { _eq: account }, token: { _eq: token } });
  const held = new Map<string, bigint>();
  for (const row of rows) {
    if (row.transactionHash === hash) continue;
    held.set(row.session_id, (held.get(row.session_id) ?? 0n) + row.amount);
  }
  return held;
}

/** Splits every shared move of the transaction again, since a later log can name its session; returns the parts. */
async function split(
  context: EvmOnEventContext,
  account: string,
  hash: string,
  rows: SessionMove[],
  moves: Map<number, SharedMove>,
  named: readonly string[],
): Promise<Parts> {
  const parts: Parts = new Map();
  if (moves.size === 0) return parts;

  const signal = new Set([
    ...named,
    ...rows.filter((row) => !row.shared && row.amount !== 0n).map((row) => row.session_id),
    ...(await predictedSessions(context, account, hash)),
  ]);

  for (const move of [...moves.values()].sort((a, b) => a.logIndex - b.logIndex)) {
    const [places, held] = await Promise.all([
      placesOf(context, move.token),
      holdingsBefore(context, account, move.token, hash),
    ]);
    const sessions = places.map((place) => place.session);
    const holding = sessions.map((session) => {
      const balance = held.get(session) ?? 0n;
      return balance > 0n ? balance : 0n;
    });
    const inSignal = sessions.map((session) => (signal.has(session) ? 1n : 0n));
    const weights =
      !move.redeemed && inSignal.some((weight) => weight > 0n)
        ? inSignal
        : holding.some((weight) => weight > 0n)
          ? holding
          : sessions.map(() => 1n);
    const shares = allocate(move.amount, weights);

    const bySession = new Map<string, bigint>();
    sessions.forEach((session, index) => {
      const amount = shares[index]!;
      const id = moveId(hash, move.logIndex, account, session);
      if (amount === 0n) {
        context.SessionMove.deleteUnsafe(id);
        return;
      }
      bySession.set(session, amount);
      context.SessionMove.set({
        id,
        account,
        session_id: session,
        token: move.token,
        amount,
        cost: move.costly ? amount : 0n,
        shared: true,
        redeemed: move.redeemed,
        logIndex: move.logIndex,
        blockNumber: move.blockNumber,
        transactionHash: hash,
      });
    });
    parts.set(move.logIndex, bySession);
  }
  return parts;
}

/** Credits a trade wallet's move of a session token to the sessions holding it. */
export async function creditMove(context: EvmOnEventContext, move: LedgerMove) {
  const places = await placesOf(context, move.token);
  if (places.length === 0) return;

  // a split mints every parent token, the INVALID one included, from the sDAI or xDAI it was paid
  const costly = move.amount > 0n && move.counterparty === GNOSIS_ROUTER && places.every((place) => place.invalid);
  const rows = await txRows(context, move.account, move.hash);
  const moves = sharedMoves(rows);

  if (places.length === 1) {
    const row: SessionMove = {
      id: moveId(move.hash, move.logIndex, move.account, places[0]!.session),
      account: move.account,
      session_id: places[0]!.session,
      token: move.token,
      amount: move.amount,
      cost: costly ? move.amount : 0n,
      shared: false,
      redeemed: false,
      logIndex: move.logIndex,
      blockNumber: move.blockNumber,
      transactionHash: move.hash,
    };
    context.SessionMove.set(row);
    rows.push(row);
  } else {
    moves.set(move.logIndex, {
      token: move.token,
      logIndex: move.logIndex,
      blockNumber: move.blockNumber,
      amount: move.amount,
      costly,
      redeemed: false,
    });
  }

  await split(context, move.account, move.hash, rows, moves, move.predicted === undefined ? [] : [move.predicted]);
  if (move.amount > 0n && (await context.PoolWithdrawal.get(`${move.hash}-${move.counterparty}`)) !== undefined) {
    await noteUncosted(context, move.account, move.hash, move.logIndex);
  }
}

/** A token's worth in parent outcome tokens, doubled: a DOWN and an UP redeem for one; INVALID tokens count 0. */
const weightOf = (place: TokenPlace | undefined) =>
  place === undefined || place.invalid || place.slot === 2 ? 0n : place.childMarket === undefined ? 2n : 1n;

const uncostedId = (account: string, session: string) => `${account}-${session}`;

/** Each session's part of the moves at `logIndexes`, as the ledger credited them. */
async function partsAt(context: EvmOnEventContext, account: string, hash: string, logIndexes: ReadonlySet<number>) {
  const parts = new Map<string, SessionMove[]>();
  for (const row of await txRows(context, account, hash)) {
    if (!logIndexes.has(row.logIndex) || row.amount === 0n) continue;
    parts.set(row.session_id, [...(parts.get(row.session_id) ?? []), row]);
  }
  return parts;
}

/** Tokens back from a liquidity position: they join each session's holdings with no cost behind them. */
async function noteUncosted(context: EvmOnEventContext, account: string, hash: string, logIndex: number) {
  for (const [session, rows] of await partsAt(context, account, hash, new Set([logIndex]))) {
    let weight = 0n;
    for (const row of rows) {
      const place = (await placesOf(context, row.token)).find((each) => each.session === session);
      weight += row.amount * weightOf(place);
    }
    const id = uncostedId(account, session);
    const held = (await context.UncostedHolding.get(id))?.weight ?? 0n;
    context.UncostedHolding.set({ id, account, session_id: session, weight: held + weight });
  }
}

/**
 * Takes off each session's cost what the tokens leaving at `logIndexes` carried, for a merge or a liquidity deposit:
 * the session's cost times their share of its holdings by weight. Uncosted tokens leave first and take no cost.
 */
export async function releaseCost(
  context: EvmOnEventContext,
  account: string,
  hash: string,
  logIndexes: readonly number[],
) {
  for (const [session, moved] of await partsAt(context, account, hash, new Set(logIndexes))) {
    const rows = (await context.SessionMove.getWhere({ account: { _eq: account } })).filter(
      (row) => row.session_id === session,
    );
    const cost = rows.reduce((total, row) => total + row.cost, 0n);
    const balances = new Map<string, bigint>();
    for (const row of rows) balances.set(row.token, (balances.get(row.token) ?? 0n) + row.amount);
    const out = new Map<string, bigint>();
    for (const row of moved) if (row.amount < 0n) out.set(row.token, (out.get(row.token) ?? 0n) - row.amount);

    let [heldWeight, movedWeight] = [0n, 0n];
    for (const [token, balance] of balances) {
      const weight = weightOf((await placesOf(context, token)).find((each) => each.session === session));
      const left = out.get(token) ?? 0n;
      const before = balance + left;
      if (weight === 0n || before <= 0n) continue;
      heldWeight += before * weight;
      movedWeight += (left < before ? left : before) * weight;
    }

    const id = uncostedId(account, session);
    const stored = (await context.UncostedHolding.get(id))?.weight ?? 0n;
    const uncosted = stored < heldWeight ? (stored > 0n ? stored : 0n) : heldWeight;
    const fromUncosted = uncosted < movedWeight ? uncosted : movedWeight;
    if (stored !== uncosted - fromUncosted) {
      context.UncostedHolding.set({ id, account, session_id: session, weight: uncosted - fromUncosted });
    }

    const costedHeld = heldWeight - uncosted;
    if (cost <= 0n || costedHeld <= 0n) continue;
    const share = (cost * (movedWeight - fromUncosted)) / costedHeld;
    const released = share < cost ? share : cost;
    if (released === 0n) continue;
    const last = moved.reduce((latest, row) => (row.logIndex > latest.logIndex ? row : latest));
    context.SessionMove.set({
      id: `${moveId(hash, last.logIndex, account, session)}-released`,
      account,
      session_id: session,
      token: last.token,
      amount: 0n,
      cost: -released,
      shared: false,
      redeemed: false,
      logIndex: last.logIndex,
      blockNumber: last.blockNumber,
      transactionHash: hash,
    });
  }
}

/**
 * Marks the moves at `logIndexes` as what the router made of them: a redeem's pulls, or a merge, which takes off the
 * cost its tokens carried. Returns each move's part per session.
 */
export async function settlePulls(
  context: EvmOnEventContext,
  account: string,
  hash: string,
  logIndexes: readonly number[],
  as: "redeem" | "merge",
): Promise<Parts> {
  const rows = await txRows(context, account, hash);
  const pulled = new Set(logIndexes);
  const settled = rows.map((row): SessionMove =>
    pulled.has(row.logIndex) && as === "redeem" ? { ...row, redeemed: true } : row,
  );
  const parts: Parts = new Map();
  for (const row of settled.filter((each) => !each.shared && pulled.has(each.logIndex))) {
    context.SessionMove.set(row);
    parts.set(row.logIndex, new Map([[row.session_id, row.amount]]));
  }

  const shared = await split(context, account, hash, settled, sharedMoves(settled), []);
  for (const [logIndex, bySession] of shared) parts.set(logIndex, bySession);
  if (as === "merge") await releaseCost(context, account, hash, logIndexes);
  return parts;
}
