import { createPublicClient } from "viem";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { transports } from "@/config/rpc";

export const publicClient = createPublicClient({
  chain: DEFAULT_CHAIN,
  transport: transports[DEFAULT_CHAIN_ID],
  batch: true,
});
