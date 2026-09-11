import { erc20Abi, type Address } from "viem";

import type { ExecutorReadClient, FundsReadClient } from "./types";

export function fetchTokenBalances(
  client: ExecutorReadClient,
  args: { holder: Address; tokens: Address[] },
): Promise<bigint[]> {
  return Promise.all(
    args.tokens.map((token) =>
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [args.holder] }),
    ),
  );
}

export type HolderFunds = {
  native: bigint;
  /** Null when no token was asked for. */
  token: bigint | null;
};

export async function fetchHolderFunds(
  client: FundsReadClient,
  args: { holder: Address; token?: Address },
): Promise<HolderFunds> {
  const [native, token] = await Promise.all([
    client.getBalance({ address: args.holder }),
    args.token
      ? client.readContract({ address: args.token, abi: erc20Abi, functionName: "balanceOf", args: [args.holder] })
      : Promise.resolve(null),
  ]);

  return { native, token };
}
