import { gnosis, hardhat } from "viem/chains";
import { describe, it } from "vitest";

import { creditsContracts, sessionFactoryAddress, tradeExecutorFactoryAddress } from "../contracts";

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

describe("creditsContracts", () => {
  it("resolves gnosis, and so its fork, to the live Foresight credits pair", (t) => {
    t.expect(creditsContracts(gnosis.id)).toEqual({
      credits: "0x09E7014D2c15Eb8C5ee25853FE6842FF5E2c94f9",
      manager: "0x17592eFE59a318A6B0AFE32145ee04eAFeeA8A61",
    });
  });

  it("resolves the local chain to its own deployment", (t) => {
    const local = creditsContracts(hardhat.id);

    t.expect(local).not.toBeNull();
    t.expect(local?.credits).not.toBe(local?.manager);
    t.expect(local?.manager).not.toBe(creditsContracts(gnosis.id)?.manager);
  });

  it("has nothing for a chain without credits", (t) => {
    t.expect(creditsContracts(1)).toBeNull();
  });
});
