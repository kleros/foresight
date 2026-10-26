import { erc20Abi, isAddressEqual, type Address } from "viem";

import { creditsManagerAbi, type CreditsContracts } from "@/config/contracts";

import type { ExecutorReadClient } from "./types";

/** A visitor's Foresight credits and what their manager holds to back them, all in credits. */
export interface CreditsHeld {
  wallet: bigint;
  tradeWallet: bigint;
  /** The manager's collateral, spent one for one per credit, first come first served. */
  manager: bigint;
}

/**
 * The owner's and their trade wallet's credits, and the manager's collateral. Null where the
 * manager spends another token than `collateral`, since its credits cannot fund that session.
 */
export async function fetchCredits(
  client: ExecutorReadClient,
  args: { contracts: CreditsContracts; owner: Address; tradeWallet: Address; collateral: Address },
): Promise<CreditsHeld | null> {
  const { contracts, owner, tradeWallet, collateral } = args;
  const token = await client.readContract({
    address: contracts.manager,
    abi: creditsManagerAbi,
    functionName: "token",
  });
  if (!isAddressEqual(token, collateral)) return null;

  const balance = (holder: Address, of: Address) =>
    client.readContract({ address: of, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  const [wallet, held, manager] = await Promise.all([
    balance(owner, contracts.credits),
    balance(tradeWallet, contracts.credits),
    balance(contracts.manager, token),
  ]);
  return { wallet, tradeWallet: held, manager };
}
