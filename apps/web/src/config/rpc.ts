import { fallback, http, type Transport } from "viem";
import { gnosis, hardhat, mainnet } from "viem/chains";

import { LOCAL_RPC_URL } from "./chains";
import { env } from "./env";

/**
 * Gnosis is where the app transacts; mainnet is here only so ENS
 * name/avatar lookups (chainId 1) resolve. Hardhat is always mapped, since a
 * transport is an inert config object, but only reachable in development,
 * because `SUPPORTED_CHAINS` is what decides which networks are offered.
 */

const GNOSIS_FALLBACK_RPCS = ["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"];

// Env replaces the defaults entirely: a configured deployment (or a local fork) must never
// quietly fall back to the public real-gnosis endpoints.
export const gnosisRpcUrls = (envRpc: string | undefined): string[] => (envRpc ? [envRpc] : GNOSIS_FALLBACK_RPCS);

const GNOSIS_RPCS = gnosisRpcUrls(env.GNOSIS_RPC);

const MAINNET_RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"];

export const transports = {
  [gnosis.id]: fallback(GNOSIS_RPCS.map((url) => http(url, { batch: true }))),
  [mainnet.id]: fallback(MAINNET_RPCS.map((url) => http(url, { batch: true }))),
  [hardhat.id]: http(LOCAL_RPC_URL),
} as const satisfies Record<number, Transport>;
