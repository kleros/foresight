import { gnosis, hardhat } from "viem/chains";

// Read directly, not through `env`: this module must import without the full NEXT_PUBLIC set.
const localChainOverride = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN || undefined;

/** Unset follows NODE_ENV; set to `"false"` to point a dev build at gnosis only. */
export const isLocalChainEnabled =
  localChainOverride === undefined ? process.env.NODE_ENV !== "production" : localChainOverride === "true";

export const DEFAULT_CHAIN = isLocalChainEnabled ? hardhat : gnosis;

export const DEFAULT_CHAIN_ID = DEFAULT_CHAIN.id;

export const SUPPORTED_CHAINS = isLocalChainEnabled ? ([hardhat, gnosis] as const) : ([gnosis] as const);

export const LOCAL_RPC_URL = "http://127.0.0.1:8545";
