import { expect } from "chai";

import { isLocalDeployChain, resolveSeerMarketFactoryForChainId } from "../config/deploy";
import { getSeerMarketFactoryAddress } from "../config/seer";

const GNOSIS_CHAIN_ID = 100;
const LOCAL_CHAIN_ID = 31337;

describe("resolveSeerMarketFactoryForChainId", function () {
  it("uses env override when set", function () {
    const envAddress = "0x0000000000000000000000000000000000000001";
    const resolution = resolveSeerMarketFactoryForChainId(GNOSIS_CHAIN_ID, envAddress);
    expect(resolution).to.deep.equal({
      kind: "env",
      address: envAddress,
    });
  });

  it("uses config on gnosis", function () {
    const resolution = resolveSeerMarketFactoryForChainId(GNOSIS_CHAIN_ID, undefined);
    expect(resolution.kind).to.equal("config");
    if (resolution.kind === "config") {
      expect(resolution.address).to.equal(getSeerMarketFactoryAddress(GNOSIS_CHAIN_ID));
    }
  });

  it("allows mock fallback only on local chain", function () {
    expect(isLocalDeployChain(LOCAL_CHAIN_ID)).to.equal(true);
    expect(resolveSeerMarketFactoryForChainId(LOCAL_CHAIN_ID, undefined)).to.deep.equal({
      kind: "mock",
    });
  });

  it("throws on unknown live chain", function () {
    expect(() => resolveSeerMarketFactoryForChainId(999, undefined)).to.throw(/No Seer MarketFactory for chain 999/);
  });
});
