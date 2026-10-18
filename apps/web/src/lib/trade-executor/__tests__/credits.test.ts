import { decodeFunctionData, encodeFunctionResult, erc20Abi, isAddressEqual, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { creditsManagerAbi } from "@/config/contracts";

import { fetchCredits } from "../credits";
import { readClient } from "./support/readClient";

const OWNER: Address = "0x1111111111111111111111111111111111111111";
const TRADE_WALLET: Address = "0x2222222222222222222222222222222222222222";
const CREDITS: Address = "0x3333333333333333333333333333333333333333";
const MANAGER: Address = "0x4444444444444444444444444444444444444444";
const SDAI: Address = "0x5555555555555555555555555555555555555555";
const OTHER: Address = "0x6666666666666666666666666666666666666666";

/** A chain where the manager spends `managerToken`, with each holder's balance of each token. */
function chain(managerToken: Address, balances: Record<string, bigint>) {
  return readClient({
    call: ({ to, data }) => {
      if (isAddressEqual(to, MANAGER)) {
        const { functionName } = decodeFunctionData({ abi: creditsManagerAbi, data });
        if (functionName !== "token") throw new Error(`unexpected manager read: ${functionName}`);
        return encodeFunctionResult({ abi: creditsManagerAbi, functionName, result: managerToken });
      }
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
      if (functionName !== "balanceOf") throw new Error(`unexpected token read: ${functionName}`);
      const result = balances[`${to.toLowerCase()}:${args[0].toLowerCase()}`] ?? 0n;
      return encodeFunctionResult({ abi: erc20Abi, functionName, result });
    },
  });
}

const key = (token: Address, holder: Address) => `${token.toLowerCase()}:${holder.toLowerCase()}`;
const args = { contracts: { credits: CREDITS, manager: MANAGER }, owner: OWNER, tradeWallet: TRADE_WALLET };

describe("fetchCredits", () => {
  it("reads the owner's and the trade wallet's credits and the manager's collateral", async () => {
    const client = chain(SDAI, {
      [key(CREDITS, OWNER)]: parseEther("5"),
      [key(CREDITS, TRADE_WALLET)]: parseEther("2"),
      [key(SDAI, MANAGER)]: parseEther("1322"),
    });

    expect(await fetchCredits(client, { ...args, collateral: SDAI })).toEqual({
      wallet: parseEther("5"),
      tradeWallet: parseEther("2"),
      manager: parseEther("1322"),
    });
  });

  it("offers nothing for a session whose collateral the manager does not spend", async () => {
    const client = chain(SDAI, { [key(CREDITS, OWNER)]: parseEther("5") });

    expect(await fetchCredits(client, { ...args, collateral: OTHER })).toBeNull();
  });
});
