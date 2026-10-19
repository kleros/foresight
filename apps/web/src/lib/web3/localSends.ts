import type { CreateConnectorFn } from "@wagmi/core";
import { http, type EIP1193RequestFn } from "viem";

import { rpcTimeoutMs } from "@/config/rpc";

/**
 * The connector `create` makes, with `eth_sendTransaction` on a local node given the app's long
 * timeout: wagmi's mock connector sends it with viem's default 10 s, which a fork can outlast.
 */
export function withLocalSendTimeout<T extends CreateConnectorFn>(create: T): T {
  const wrapped: CreateConnectorFn = (config) => {
    const connector = create(config);
    return {
      ...connector,
      async getProvider(params) {
        const provider = (await connector.getProvider(params)) as { request: EIP1193RequestFn };
        const chain = config.chains.find((each) => each.id === params?.chainId) ?? config.chains[0];
        const url = chain.rpcUrls.default.http[0];
        const timeout = url === undefined ? undefined : rpcTimeoutMs(url);
        if (timeout === undefined) return provider;

        // no retry: a send retried after a timeout can mine twice
        const send = http(url, { timeout, retryCount: 0 })({ chain, retryCount: 0 }).request;
        const request: EIP1193RequestFn = (args, options) =>
          args.method === "eth_sendTransaction" ? send(args, options) : provider.request(args, options);
        return { ...provider, request };
      },
    };
  };
  return wrapped as T;
}
