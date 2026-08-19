import { createPublicClient, fallback, http, type PublicClient } from "viem";

const GNOSIS_PUBLIC_RPCS = ["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"];

const rpcUrls = (chainId: number): string[] => {
  switch (chainId) {
    case 31337:
      return [process.env.ENVIO_LOCALHOST_RPC_URL || "http://localhost:8545"];
    case 100:
      return [
        process.env.ENVIO_GNOSIS_RPC_URL,
        process.env.ENVIO_GNOSIS_FALLBACK_RPC_URL,
        ...GNOSIS_PUBLIC_RPCS,
      ].filter((url): url is string => Boolean(url));
    default:
      throw new Error(`No RPC configured for chain ${chainId}, add one to src/utils/client.ts`);
  }
};

const clients = new Map<string, PublicClient>();

export const getClient = (chainId: number): PublicClient => {
  const urls = rpcUrls(chainId);
  const key = `${chainId}:${urls.join(",")}`;

  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ transport: fallback(urls.map((url) => http(url, { batch: true }))) });
    clients.set(key, client);
  }

  return client;
};
