import type { SplitDeposit } from "./realisedPnl";

/** A parent outcome token moving in or out of the trade wallet, as the indexer's `Transfer` rows hold it. */
export interface ParentMove {
  transactionHash: string;
  /** Lowercase. */
  token: string;
  /** Negative leaving the wallet. */
  amount: bigint;
  blockNumber: bigint;
  logIndex: number;
}

/** Sessions asking the same parent question hold the same parent outcome tokens. */
export interface SharedTokens {
  /** Each lowercase parent token's sessions. */
  sessionsOf: ReadonlyMap<string, readonly string[]>;
  /** Each transaction's sessions the trade wallet predicted in. */
  predictedIn: ReadonlyMap<string, ReadonlySet<string>>;
  moves: ParentMove[];
}

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

const bySessionId = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

const inChainOrder = (a: ParentMove, b: ParentMove) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

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

/**
 * One token's holdings in each of `sessions` (sorted by id), replayed in chain order as the indexer weighs a redeem:
 * a transaction that predicted in some of them moves theirs, split evenly; any other moves the holders pro rata by
 * what they hold. A session predicted in has an entry, even at zero. `moved` is each transaction's move per session.
 */
function replayHoldings(moves: ParentMove[], predictedIn: SharedTokens["predictedIn"], sessions: readonly string[]) {
  const held = new Map<string, bigint>();
  for (const own of predictedIn.values()) {
    for (const session of own) if (sessions.includes(session)) held.set(session, 0n);
  }

  const nets = new Map<string, bigint>();
  for (const move of [...moves].sort(inChainOrder)) {
    nets.set(move.transactionHash, (nets.get(move.transactionHash) ?? 0n) + move.amount);
  }

  const moved = new Map<string, Map<string, bigint>>();
  for (const [tx, net] of nets) {
    const own = [...(predictedIn.get(tx) ?? [])].filter((session) => sessions.includes(session)).sort(bySessionId);
    const holders = own.length > 0 ? own : sessions.filter((session) => (held.get(session) ?? 0n) > 0n);
    if (holders.length === 0) continue;
    const weights = own.length > 0 ? own.map(() => 1n) : holders.map((session) => held.get(session)!);
    // an outflow beyond what the holders hold empties them
    const total = own.length === 0 && -net > sum(weights) ? -sum(weights) : net;
    const shares = splitBy(total, weights);
    holders.forEach((session, index) => held.set(session, (held.get(session) ?? 0n) + shares[index]!));
    moved.set(tx, new Map(holders.map((session, index) => [session, shares[index]!])));
  }
  return { held, moved };
}

/** `session`'s part of `balance` redeemed now, as the indexer files the pull of a token several sessions share. */
function redeemShare(balance: bigint, held: Map<string, bigint>, sessions: readonly string[], session: string) {
  const weights = sessions.map((each) => {
    const net = held.get(each) ?? 0n;
    return net > 0n ? net : 0n;
  });
  if (weights.some((weight) => weight > 0n)) return splitBy(balance, weights)[sessions.indexOf(session)]!;
  const predicted = sessions.filter((each) => held.has(each));
  return (predicted.length > 0 ? predicted : sessions)[0] === session ? balance : 0n;
}

/**
 * `session`'s split deposits and parent token balances when other sessions share its parent tokens. A deposit made
 * by a prediction is its sessions', split evenly; any other goes pro rata by how the replay moved each session's
 * tokens in that transaction. A balance is the part the indexer would file under `session` were it redeemed now.
 */
export function sessionShare(
  session: string,
  { sessionsOf, predictedIn, moves }: SharedTokens,
  { deposits, balances }: { deposits: SplitDeposit[]; balances: ReadonlyMap<string, bigint> },
  parentTokens: readonly string[],
): { splits: SplitDeposit[]; parent: bigint[] } {
  const replays = parentTokens.map((token) => {
    const sessions = [...new Set([session, ...(sessionsOf.get(token) ?? [])])].sort(bySessionId);
    return {
      sessions,
      ...replayHoldings(
        moves.filter((move) => move.token === token),
        predictedIn,
        sessions,
      ),
    };
  });
  const parent = parentTokens.map((token, index) =>
    redeemShare(balances.get(token) ?? 0n, replays[index]!.held, replays[index]!.sessions, session),
  );

  const all = [...new Set(replays.flatMap(({ sessions }) => sessions))].sort(bySessionId);
  const splits = deposits.map((deposit) => {
    const own = [...(predictedIn.get(deposit.transactionHash) ?? [])].filter((each) => all.includes(each));
    const weights =
      own.length > 0
        ? all.map((each) => (own.includes(each) ? 1n : 0n))
        : all.map((each) =>
            sum(
              replays.map(({ moved }) => {
                const share = moved.get(deposit.transactionHash)?.get(each) ?? 0n;
                return share < 0n ? -share : share;
              }),
            ),
          );
    const amount = weights.some((weight) => weight > 0n) ? splitBy(deposit.amount, weights)[all.indexOf(session)]! : 0n;
    return { ...deposit, amount };
  });
  return { splits, parent };
}
