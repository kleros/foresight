import { gnosis, hardhat } from "viem/chains";

export const isLocalChainEnabled = process.env.NODE_ENV !== "production";

export const DEFAULT_CHAIN = isLocalChainEnabled ? hardhat : gnosis;

export const DEFAULT_CHAIN_ID = DEFAULT_CHAIN.id;

export const SUPPORTED_CHAINS = isLocalChainEnabled ? ([hardhat, gnosis] as const) : ([gnosis] as const);

export const LOCAL_RPC_URL = "http://127.0.0.1:8545";
