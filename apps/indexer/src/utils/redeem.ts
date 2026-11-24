import type { EvmOnEventContext, RedeemPull, Session } from "envio";

import { allocate, sum } from "./bigint";
import { type Parts, settlePulls } from "./ledger";
import { GNOSIS_ROUTER } from "./routers";
import { placesOf, type TokenPlace } from "./sessionTokens";

/** A transfer between an account and one of Seer's routers. */
export interface RouterMove {
  account: string;
  router: string;
  token: string;
  /** Always positive: what left the account in a pull, what reached it in a return. */
  value: bigint;
  hash: string;
  logIndex: number;
  block: { number: number; timestamp: number };
  /** The account is a trade wallet, whose ledger splits shared tokens between sessions. */
  tradeWallet: boolean;
}

/** A session token sent to a router, held until the router answers the account in the same transaction. */
export async function notePull(context: EvmOnEventContext, move: RouterMove) {
  if (move.value === 0n || (await placesOf(context, move.token)).length === 0) return;

  context.RedeemPull.set({
    id: `${move.hash}-${move.logIndex}-${move.account}`,
    account: move.account,
    router: move.router,
    token: move.token,
    amount: move.value,
    logIndex: move.logIndex,
    transactionHash: move.hash,
  });
}

/** One Redeem row in the making: one session's tokens of one market. */
interface Part {
  session: Session;
  childMarket: string | undefined;
  parentOutcomeIndex: bigint;
  pieces: { slot: number; amount: bigint }[];
}

const floorPay = (amount: bigint, numerator: bigint, numerators: readonly bigint[]) =>
  (amount * numerator) / sum(numerators);

const numeratorsOf = async (context: EvmOnEventContext, market: string) => {
  const condition = await context.MarketCondition.get(market);
  return condition && condition.payoutNumerators.length > 0 ? condition.payoutNumerators : undefined;
};

/**
 * What each part pays, from the resolved conditions (oracle R5): floored per token, and a child's part floored again
 * at its parent outcome's fraction. Without a resolution for every market involved, each part weighs its token count.
 */
async function payoutWeights(context: EvmOnEventContext, parts: Part[]): Promise<bigint[]> {
  const computed = await Promise.all(
    parts.map(async (part) => {
      const parent = await numeratorsOf(context, part.session.parentMarket);
      if (parent === undefined) return undefined;
      if (part.childMarket === undefined) {
        return sum(part.pieces.map(({ slot, amount }) => floorPay(amount, parent[slot] ?? 0n, parent)));
      }
      const child = await numeratorsOf(context, part.childMarket);
      if (child === undefined) return undefined;
      const parentTokens = sum(part.pieces.map(({ slot, amount }) => floorPay(amount, child[slot] ?? 0n, child)));
      return floorPay(parentTokens, parent[Number(part.parentOutcomeIndex)] ?? 0n, parent);
    }),
  );
  const counted = parts.map((part) => sum(part.pieces.map(({ amount }) => amount)));
  const weights = computed.every((each) => each !== undefined) ? computed : counted;
  if (sum(weights) > 0n) return weights;
  return sum(counted) > 0n ? counted : parts.map(() => 1n);
}

/**
 * Whether sDAI from Seer's router for these parent tokens returns a merge rather than pays a redeem: the parent is
 * known unresolved; or, with no resolution indexed, the pulls are a whole set of equal amounts paid back in full.
 */
async function isMerge(context: EvmOnEventContext, pulls: RedeemPull[], sessions: Session[], value: bigint) {
  const conditions = await Promise.all(sessions.map((session) => context.MarketCondition.get(session.parentMarket)));
  const known = conditions.filter((condition) => condition !== undefined);
  if (known.length > 0) return known.every((condition) => condition.payoutNumerators.length === 0);

  const tokens = new Set(pulls.map((pull) => pull.token));
  return (
    sessions.some((session) => tokens.size === Number(session.outcomeCount) + 1) &&
    pulls.every((pull) => pull.amount === value)
  );
}

/**
 * What a router sends an account that sent it session tokens earlier in the transaction. The session's collateral
 * pays them as a redeem (one Redeem row per session and market) or returns a merge; a token back means they were
 * split or merged into other tokens.
 */
export async function noteReturn(context: EvmOnEventContext, move: RouterMove) {
  const pulls = (await context.RedeemPull.getWhere({ transactionHash: { _eq: move.hash } }))
    .filter((pull) => pull.account === move.account && pull.router === move.router)
    .sort((a, b) => a.logIndex - b.logIndex);
  if (pulls.length === 0) return;

  const placed = await Promise.all(pulls.map((pull) => placesOf(context, pull.token)));
  const returnedToken = (await placesOf(context, move.token)).length > 0;
  const sessions = (
    await Promise.all(
      [...new Set(placed.flatMap((places) => places.map((place) => place.session)))].map((id) =>
        context.Session.get(id),
      ),
    )
  ).filter((session) => session !== undefined);
  const collateral = sessions.find((session) => session.collateralToken !== undefined)?.collateralToken;
  if (!returnedToken && collateral !== undefined && collateral.toLowerCase() !== move.token) return;

  for (const pull of pulls) context.RedeemPull.deleteUnsafe(pull.id);
  if (returnedToken) return;

  const as =
    move.router === GNOSIS_ROUTER && (await isMerge(context, pulls, sessions, move.value)) ? "merge" : "redeem";
  const shares: Parts | undefined = move.tradeWallet
    ? await settlePulls(
        context,
        move.account,
        move.hash,
        pulls.map((pull) => pull.logIndex),
        as,
      )
    : undefined;
  if (as === "merge") return;

  const parts = new Map<string, Part>();
  pulls.forEach((pull, index) => {
    const places = placed[index]!;
    // a connected wallet keeps no ledger, so a shared token goes to the earliest session, which keeps its Token row
    const bySession = shares?.get(pull.logIndex) ?? new Map([[places[0]!.session, -pull.amount]]);
    for (const [sessionId, moved] of bySession) {
      const amount = -moved;
      const place: TokenPlace | undefined = places.find((each) => each.session === sessionId);
      const session = sessions.find((each) => each.id === sessionId);
      if (place === undefined || session === undefined) continue;
      const key = `${sessionId}-${place.childMarket ?? "parent"}-${place.parentOutcomeIndex}`;
      const part = parts.get(key) ?? {
        session,
        childMarket: place.childMarket,
        parentOutcomeIndex: place.parentOutcomeIndex,
        pieces: [],
      };
      part.pieces.push({ slot: place.slot, amount });
      parts.set(key, part);
    }
  });

  const ordered = [...parts.entries()];
  if (ordered.length === 0) return;
  const payouts = allocate(
    move.value,
    await payoutWeights(
      context,
      ordered.map(([, part]) => part),
    ),
  );
  ordered.forEach(([key, part], index) => {
    context.Redeem.set({
      id: `${move.hash}-${move.logIndex}-${move.account}-${key}`,
      account: move.account,
      session_id: part.session.id,
      childMarket_id: part.childMarket,
      parentOutcomeIndex: part.parentOutcomeIndex,
      payout: payouts[index]!,
      blockNumber: BigInt(move.block.number),
      timestamp: BigInt(move.block.timestamp),
      transactionHash: move.hash,
    });
  });
}
