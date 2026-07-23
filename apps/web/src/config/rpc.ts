import { fallback, http, type Transport } from "viem";
import { gnosis, mainnet } from "viem/chains";

import { env } from "./env";

/**
 * Gnosis is where the app transacts; mainnet is here only so ENS
 * name/avatar lookups (chainId 1) resolve.
 */

const GNOSIS_FALLBACK_RPCS = ["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"];

const GNOSIS_RPCS = env.GNOSIS_RPC ? [env.GNOSIS_RPC, ...GNOSIS_FALLBACK_RPCS] : GNOSIS_FALLBACK_RPCS;

const MAINNET_RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"];

export const transports = {
  [gnosis.id]: fallback(GNOSIS_RPCS.map((url) => http(url, { batch: true }))),
  [mainnet.id]: fallback(MAINNET_RPCS.map((url) => http(url, { batch: true }))),
} as const satisfies Record<number, Transport>;
