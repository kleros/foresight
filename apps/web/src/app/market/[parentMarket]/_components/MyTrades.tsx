"use client";

import clsx from "clsx";

import type { SessionDetail } from "@/features/sessions/types";
import { collateralVolume } from "@/features/sessions/utils/collateralVolume";

import { formatDisplayAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

import { TradeList, TradeListSkeleton } from "./TradeList";
import { useMyTrades, type OptionPosition } from "./useMyTrades";

/** Outcome tokens and prices per token are 18-decimal. */
const tokens = (value: bigint) => formatDisplayAmount(value, 18, 4);

const toneOf = (pnl: bigint) =>
  pnl > 0n ? "text-fs-tone-success-text" : pnl < 0n ? "text-fs-tone-error-text" : "text-fs-text-primary";

/** A signed P&L in collateral, and its share of the cost where the cost is positive. */
function signedPnl(session: SessionDetail, pnl: bigint, cost: bigint): string {
  const value = collateralVolume(session, pnl < 0n ? -pnl : pnl);
  if (value === null) return "-";
  const sign = pnl > 0n ? "+" : pnl < 0n ? "-" : "";
  const amount = `~${sign}${formatEstimate(value, session.collateralSymbol)}`;
  if (cost <= 0n) return amount;
  const percent = Number((pnl * 10_000n) / cost) / 100;
  return `${amount} (${sign}${formatEstimate(Math.abs(percent), null)}%)`;
}

function sideLine(side: "UP" | "DOWN", held: bigint, entry: bigint | null, spot: bigint | null): string | null {
  if (held === 0n && entry === null) return null;
  const parts = [`${tokens(held)} ${side}`];
  if (entry !== null) parts.push(`avg entry ${tokens(entry)}`);
  if (spot !== null) parts.push(`now ${tokens(spot)}`);
  return parts.join(" · ");
}

function PositionRow({ session, position }: { session: SessionDetail; position: OptionPosition }) {
  const { option, held, entry, spot, pnl } = position;
  const sides = [sideLine("UP", held.up, entry.up, spot.up), sideLine("DOWN", held.down, entry.down, spot.down)].filter(
    (line) => line !== null,
  );

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      {" "}
      <span className="flex min-w-0 flex-col">
        <span className="text-fs-text-primary truncate">{option.name}</span>{" "}
        {sides.map((line) => (
          <span key={line} className="text-fs-text-secondary text-xs tabular-nums">
            {line}{" "}
          </span>
        ))}
      </span>{" "}
      {pnl.available ? (
        <span className={clsx("shrink-0 text-right tabular-nums", toneOf(pnl.pnl))}>
          {signedPnl(session, pnl.pnl, pnl.cost)}
        </span>
      ) : (
        <span className="text-fs-text-secondary shrink-0 text-right">P&L unavailable</span>
      )}
    </li>
  );
}

const NOTICE = {
  disconnected: "Connect a wallet to see your trades.",
  error: "Could not load your trades. Reload in a moment.",
  empty: "You have not traded in this market yet.",
};

/** The connected trade wallet's predictions in the session, under its expected P&L per option and in total. */
export function MyTrades({ session }: { session: SessionDetail }) {
  const mine = useMyTrades(session);

  if (mine.status === "loading") return <TradeListSkeleton />;
  if (mine.status !== "ready") return <p className="text-fs-text-secondary text-sm">{NOTICE[mine.status]}</p>;

  const { total, positions, trades } = mine;
  const excluded = total.excluded;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-fs-panel border-fs-border flex flex-col gap-1 border px-4 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          {" "}
          <span className="text-fs-text-secondary">Expected P&L</span>{" "}
          {excluded === positions.length ? (
            <span className="text-fs-text-secondary">P&L unavailable</span>
          ) : (
            <span className={clsx("text-base font-semibold tabular-nums", toneOf(total.pnl))}>
              {signedPnl(session, total.pnl, total.cost)}
            </span>
          )}{" "}
        </div>
        <p className="text-fs-text-secondary text-xs">
          Held tokens at current pool prices, less what you paid net. Not what selling would return.
          {excluded > 0
            ? ` Excludes ${excluded} ${excluded === 1 ? "option" : "options"} whose P&L is unavailable.`
            : null}
        </p>
        <ul className="divide-fs-border mt-1 divide-y">
          {positions.map((position) => (
            <PositionRow key={position.option.market} session={session} position={position} />
          ))}
        </ul>
      </section>
      {trades.length > 0 ? <TradeList session={session} trades={trades} /> : null}
    </div>
  );
}
