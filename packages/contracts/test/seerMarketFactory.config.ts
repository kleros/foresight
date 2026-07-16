import { expect } from "chai";

import { getSeerMarketFactoryAddress } from "../config/seer";

describe("Seer MarketFactory addresses", function () {
  it("reads gnosis MarketFactory from @seer-pm/contracts deployments", function () {
    expect(getSeerMarketFactoryAddress(100)).to.equal("0x83183DA839Ce8228E31Ae41222EaD9EDBb5cDcf1");
  });

  it("returns null for unknown local chain ids", function () {
    expect(getSeerMarketFactoryAddress(31_337)).to.equal(null);
  });
});
