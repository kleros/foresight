import { createPublicClient, custom, HttpRequestError, RpcRequestError, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { abi as erc20Abi } from "../../abis/Erc20";
import { isContractRefusal } from "../../src/utils/contracts/contractRefusal";

const TOKEN = "0x0000000000000000000000000000000000000001" as Address;

/** What the real client throws for a scripted transport, so the shapes are viem's own. */
async function thrownBy(request: () => Promise<unknown>): Promise<unknown> {
  const client = createPublicClient({ transport: custom({ request }) });

  return client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" }).then(
    () => {
      throw new Error("the read was supposed to fail");
    },
    (error: unknown) => error,
  );
}

describe("isContractRefusal", () => {
  it("recognizes a revert as the contract's own refusal", async () => {
    const reverted = await thrownBy(async () => {
      throw new RpcRequestError({
        body: {},
        url: "http://rpc.test",
        error: { code: 3, message: "execution reverted" },
      });
    });

    expect(isContractRefusal(reverted)).toBe(true);
  });

  it("recognizes an address with no code behind the call", async () => {
    expect(isContractRefusal(await thrownBy(async () => "0x"))).toBe(true);
  });

  it("does not mistake a dropped connection for a refusal", async () => {
    const dropped = await thrownBy(async () => {
      throw new Error("fetch failed");
    });

    expect(isContractRefusal(dropped)).toBe(false);
  });

  it("does not mistake an http failure for a refusal", async () => {
    const failed = await thrownBy(async () => {
      throw new HttpRequestError({ url: "http://rpc.test" });
    });

    expect(isContractRefusal(failed)).toBe(false);
  });
});
