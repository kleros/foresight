import { gnosis, hardhat } from "viem/chains";
import { describe, it } from "vitest";

import { sessionFactoryAddress, tradeExecutorFactoryAddress } from "../contracts";

describe("sessionFactoryAddress", () => {
  it("resolves every deployed network", (t) => {
    t.expect(sessionFactoryAddress(gnosis.id)).not.toBeNull();
    t.expect(sessionFactoryAddress(hardhat.id)).not.toBeNull();
    t.expect(sessionFactoryAddress(1)).toBeNull();
  });
});

describe("tradeExecutorFactoryAddress", () => {
  it("resolves every deployed network", (t) => {
    t.expect(tradeExecutorFactoryAddress(gnosis.id)).not.toBeNull();
    t.expect(tradeExecutorFactoryAddress(hardhat.id)).not.toBeNull();
    t.expect(tradeExecutorFactoryAddress(1)).toBeNull();
  });
});
