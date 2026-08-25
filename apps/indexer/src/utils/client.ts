import { createPublicClient, fallback, http, type PublicClient } from "viem";

const GNOSIS_PUBLIC_RPCS = ["https://rpc.gnosischain.com", "https://rpc.gnosis.gateway.fm"];

export const rpcUrls = (chainId: number): string[] => {
  switch (chainId) {
    case 31337:
      return [process.env.ENVIO_LOCALHOST_RPC_URL || "http://localhost:8545"];
    case 100: {
      // Env replaces the defaults entirely: a configured deployment (or a local fork) must
      // never quietly fall back to the public real-gnosis endpoints.
      const fromEnv = [process.env.ENVIO_GNOSIS_RPC_URL, process.env.ENVIO_GNOSIS_FALLBACK_RPC_URL].filter(
        (url): url is string => Boolean(url),
      );
      return fromEnv.length > 0 ? fromEnv : GNOSIS_PUBLIC_RPCS;
    }
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
