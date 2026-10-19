import { gnosis, hardhat, mainnet } from "viem/chains";

// Read directly, not through `env`: this module must import without the full NEXT_PUBLIC set.
const localChainOverride = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN || undefined;

/** Unset follows NODE_ENV; set to `"false"` to point a dev build at gnosis only. */
export const isLocalChainEnabled =
  localChainOverride === undefined ? process.env.NODE_ENV !== "production" : localChainOverride === "true";

const gnosisRpc = process.env.NEXT_PUBLIC_GNOSIS_RPC || "";

const LOCAL_NODE = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/;

/** Hardhat unlocks its accounts, so the dev wallet works wherever the chain is a local node. */
export const isDevWalletEnabled = isLocalChainEnabled || LOCAL_NODE.test(gnosisRpc);

// a send on a fork can take longer than viem's default while the node fetches remote state,
// and a send that times out client-side may still mine
export const rpcTimeoutMs = (url: string): number | undefined => (LOCAL_NODE.test(url) ? 120_000 : undefined);

export const DEFAULT_CHAIN = isLocalChainEnabled ? hardhat : gnosis;

export const DEFAULT_CHAIN_ID = DEFAULT_CHAIN.id;

export const SUPPORTED_CHAINS = isLocalChainEnabled ? ([hardhat, gnosis] as const) : ([gnosis] as const);

/** ENS resolves on mainnet only; the app never transacts there. */
export const ENS_CHAIN_ID = mainnet.id;

export const LOCAL_RPC_URL = "http://127.0.0.1:8545";
