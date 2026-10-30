"use client";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import { useSessionStats } from "@/features/sessions/api/getSessionStats";
import { useWalletTrades } from "@/features/sessions/api/getWalletTrades";
import type { PredictionTrade, SessionDetail, SessionOption } from "@/features/sessions/types";
import { avgEntry, optionPnl, sessionPnl, type OptionPnl } from "@/features/sessions/utils/positionPnl";
import { useExecutor } from "@/features/trade-executor/api/getExecutor";

export interface PositionPnl {
  option: SessionOption;
  held: { up: bigint; down: bigint };
  /** Underlying per token, 1e18-scaled; null until the pool prices. */
  spot: { up: bigint | null; down: bigint | null };
  entry: { up: bigint | null; down: bigint | null };
  pnl: OptionPnl;
}

export type MyTrades =
  | { status: "disconnected" | "loading" | "error" | "empty" }
  | {
      status: "ready";
      trades: PredictionTrade[];
      positions: PositionPnl[];
      total: ReturnType<typeof sessionPnl>;
    };

const lower = (address: Address | null) => address?.toLowerCase() ?? "";

/** The connected account's trade-wallet predictions in the session, and its expected P&L per option they touched. */
export function useMyTrades(session: SessionDetail): MyTrades {
  const { address } = useAccount();
  const executor = useExecutor();
  const wallet = address ? (executor.data?.deployed ?? undefined) : undefined;
  const tokens = session.options.flatMap((option) =>
    [option.upToken, option.downToken, option.invalidToken].filter((token): token is Address => token !== null),
  );
  const trades = useWalletTrades(session.id, wallet, tokens);
  const stats = useSessionStats(session.id);

  if (!address) return { status: "disconnected" };
  if (executor.isPending) return { status: "loading" };
  if (!wallet) return { status: executor.isError ? "error" : "empty" };
  if (trades.isPending || stats.isPending) return { status: "loading" };
  if (trades.isError || stats.isError) return { status: "error" };

  const { balances } = trades.data;
  const spotOf = (option: SessionOption, side: "UP" | "DOWN") =>
    stats.data.pools.find((pool) => pool.market === option.market.toLowerCase() && pool.side === side)
      ?.underlyingPerOutcome ?? null;

  const positions = session.options.flatMap((option): PositionPnl[] => {
    const market = option.market.toLowerCase();
    const predictions = trades.data.trades.flatMap((trade) =>
      trade.options.filter((each) => each.childMarket === market),
    );
    const held = { up: balances[lower(option.upToken)] ?? 0n, down: balances[lower(option.downToken)] ?? 0n };
    if (predictions.length === 0 && held.up === 0n && held.down === 0n) return [];
    const invalid = balances[lower(option.invalidToken)] ?? 0n;
    const spot = { up: spotOf(option, "UP"), down: spotOf(option, "DOWN") };
    return [
      {
        option,
        held,
        spot,
        entry: { up: avgEntry(predictions, "up"), down: avgEntry(predictions, "down") },
        pnl: optionPnl({ predictions, held: { ...held, invalid }, spot }),
      },
    ];
  });

  if (trades.data.trades.length === 0 && positions.length === 0) return { status: "empty" };
  return {
    status: "ready",
    trades: trades.data.trades,
    positions,
    total: sessionPnl(positions.map((position) => position.pnl)),
  };
}
