import { QueryClient } from "@tanstack/react-query";

/**
 * Structural data is the client-wide default;
 * hooks for faster-moving data opt into a shorter tier explicitly.
 */
export const STALE_TIME = {
  /** Subgraph / RPC structure: addresses, bounds, resolution params. */
  structural: 5 * 60_000,
  /** Curate + IPFS display payloads. */
  display: 5 * 60_000,
  /** Prices, quotes, pool liquidity. */
  live: 10_000,
  /** Balances and allowances. */
  balance: 5_000,
  /** Facts that cannot change once known. */
  immutable: Infinity,
} as const;

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.structural,
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  });
