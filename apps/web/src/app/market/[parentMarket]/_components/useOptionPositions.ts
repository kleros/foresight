"use client";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import type { OptionPosition } from "@/features/predict/utils/position";
import type { SessionDetail } from "@/features/sessions/types";
import { useExecutor } from "@/features/trade-executor/api/getExecutor";
import { useTokenBalances } from "@/features/trade-executor/api/getTokenBalances";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

/**
 * What the connected account's trade wallet holds of each option's UP and DOWN, keyed by
 * lower-case market; an option it holds none of has no entry. One read for every option.
 */
export function useOptionPositions(session: SessionDetail | undefined): Record<string, OptionPosition> {
  const { address: owner, chainId } = useAccount();
  const executor = useExecutor();
  // reads all go to DEFAULT_CHAIN, so a wallet on another one would be shown someone else's balances
  const holder = owner && chainId === DEFAULT_CHAIN_ID ? (executor.data?.deployed ?? undefined) : undefined;

  const options = (session?.options ?? []).filter(
    (option): option is typeof option & { upToken: Address; downToken: Address } =>
      option.upToken !== null && option.downToken !== null,
  );
  const balances = useTokenBalances(
    holder,
    options.flatMap((option) => [option.upToken, option.downToken]),
  );

  const held = balances.data;
  if (!holder || !held) return {};
  return Object.fromEntries(
    options.flatMap((option, index) => {
      const up = held[index * 2] ?? 0n;
      const down = held[index * 2 + 1] ?? 0n;
      return up > 0n || down > 0n ? [[option.market.toLowerCase(), { up, down }]] : [];
    }),
  );
}
