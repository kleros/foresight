import { createPublicClient, http, type PublicClient } from "viem";

const rpcUrl = (chainId: number): string => {
  switch (chainId) {
    case 31337:
      return process.env.ENVIO_RPC_URL ?? "http://localhost:8545";
    default:
      throw new Error(`No RPC configured for chain ${chainId}, add one to src/utils/client.ts`);
  }
};

const clients = new Map<string, PublicClient>();

export const getClient = (chainId: number): PublicClient => {
  const url = rpcUrl(chainId);
  const key = `${chainId}:${url}`;

  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ transport: http(url, { batch: true }) });
    clients.set(key, client);
  }

  return client;
};
