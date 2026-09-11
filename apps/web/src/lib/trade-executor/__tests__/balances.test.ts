import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { fetchHolderFunds, fetchTokenBalances } from "../balances";
import { readClient } from "./support/readClient";

const HOLDER: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x3333333333333333333333333333333333333333";
const OTHER_TOKEN: Address = "0x4444444444444444444444444444444444444444";

const NATIVE_BALANCE = parseEther("3");
const TOKEN_BALANCE = parseEther("40");

/** Answers erc20 reads the way TOKEN would. */
function tokenClient() {
  return readClient({
    balance: () => NATIVE_BALANCE,
    call: ({ data }) => {
      const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
      if (functionName === "balanceOf") {
        return encodeFunctionResult({ abi: erc20Abi, functionName, result: TOKEN_BALANCE });
      }
      throw new Error(`unexpected token read: ${functionName}`);
    },
  });
}

describe("fetchHolderFunds", () => {
  it("reads native and token balances for the holder", async () => {
    const funds = await fetchHolderFunds(tokenClient(), { holder: HOLDER, token: TOKEN });

    expect(funds).toEqual({ native: NATIVE_BALANCE, token: TOKEN_BALANCE });
  });

  it("reads only the native balance when no token is asked for", async () => {
    const funds = await fetchHolderFunds(tokenClient(), { holder: HOLDER });

    expect(funds).toEqual({ native: NATIVE_BALANCE, token: null });
  });
});

describe("fetchTokenBalances", () => {
  it("answers in the order the tokens were asked for", async () => {
    const balances: Record<Address, bigint> = { [TOKEN]: TOKEN_BALANCE, [OTHER_TOKEN]: parseEther("7") };
    const client = readClient({
      call: ({ to, data }) => {
        const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
        if (functionName !== "balanceOf") throw new Error(`unexpected token read: ${functionName}`);

        return encodeFunctionResult({ abi: erc20Abi, functionName, result: balances[to]! });
      },
    });

    await expect(fetchTokenBalances(client, { holder: HOLDER, tokens: [OTHER_TOKEN, TOKEN] })).resolves.toEqual([
      parseEther("7"),
      TOKEN_BALANCE,
    ]);
  });

  it("reads nothing when there are no tokens", async () => {
    const client = readClient({
      call: () => {
        throw new Error("should not read");
      },
    });

    await expect(fetchTokenBalances(client, { holder: HOLDER, tokens: [] })).resolves.toEqual([]);
  });
});
