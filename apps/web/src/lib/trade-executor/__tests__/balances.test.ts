import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { fetchHolderFunds, fetchTokenMeta } from "../balances";
import { readClient } from "./support/readClient";

const HOLDER: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x3333333333333333333333333333333333333333";

const NATIVE_BALANCE = parseEther("3");
const TOKEN_BALANCE = parseEther("40");

/** Answers erc20 reads the way TOKEN would. */
function tokenClient() {
  return readClient({
    balance: () => NATIVE_BALANCE,
    call: ({ data }) => {
      const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
      if (functionName === "symbol") return encodeFunctionResult({ abi: erc20Abi, functionName, result: "SDAI" });
      if (functionName === "decimals") return encodeFunctionResult({ abi: erc20Abi, functionName, result: 18 });
      if (functionName === "balanceOf") {
        return encodeFunctionResult({ abi: erc20Abi, functionName, result: TOKEN_BALANCE });
      }
      throw new Error(`unexpected token read: ${functionName}`);
    },
  });
}

describe("fetchTokenMeta", () => {
  it("reads symbol and decimals off the token", async () => {
    const meta = await fetchTokenMeta(tokenClient(), TOKEN);

    expect(meta).toEqual({ symbol: "SDAI", decimals: 18 });
  });
});

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
