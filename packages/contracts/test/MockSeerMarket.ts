import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

import { deploySessionFactoryFixture } from "./fixtures/deploy";
import { buildTwoOutcomeSession } from "./fixtures/sessionFactory";

const marketAbi = [
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function parentWrappedOutcome() view returns (address wrapped1155, bytes data)",
];

async function localSession() {
  const { seerMarketFactory, sessionFactory } = await deploySessionFactoryFixture();
  await sessionFactory.deploySession(buildTwoOutcomeSession());
  const session = await sessionFactory.getSession(0n);
  const parent = await hre.ethers.getContractAt(marketAbi, session.parentMarket);
  const children = await Promise.all(
    session.childMarkets.map((address) => hre.ethers.getContractAt(marketAbi, address)),
  );
  return { seerMarketFactory, parent, children };
}

describe("local Seer session verification views", function () {
  it("exposes ERC20 collateral with a readable denomination", async function () {
    const { seerMarketFactory } = await loadFixture(localSession);
    const factory = await hre.ethers.getContractAt(
      ["function collateralToken() view returns (address)"],
      await seerMarketFactory.getAddress(),
    );
    const token = await factory.getFunction("collateralToken")();
    expect(token).not.to.equal(hre.ethers.ZeroAddress);
    const collateral = await hre.ethers.getContractAt("MockERC20", token);
    expect(await collateral.decimals()).to.equal(18n);
    expect(await collateral.symbol()).to.equal("COL");
  });

  it("exposes distinct tokens for named outcomes and INVALID without counting INVALID", async function () {
    const { parent, children } = await loadFixture(localSession);
    const tokens: string[] = [];
    for (const market of [parent, ...children]) {
      const metadata = await hre.ethers.getContractAt("MockSeerMarket", await market.getAddress());
      expect(await metadata.numOutcomes()).to.equal(2n);
      for (let index = 0; index <= 2; index++) {
        const [token, data] = await market.getFunction("wrappedOutcome")(index);
        tokens.push(token);
        expect(token).not.to.equal(hre.ethers.ZeroAddress);
        expect(data).to.equal("0x");
        expect(await hre.ethers.provider.getCode(token)).not.to.equal("0x");
        expect(await market.getFunction("wrappedOutcome")(index)).to.deep.equal([token, data]);
      }
      await expect(market.getFunction("wrappedOutcome")(3)).to.be.reverted;
    }
    expect(new Set(tokens).size).to.equal(9);
  });

  it("links each child's underlying to its selected parent outcome", async function () {
    const { parent, children } = await loadFixture(localSession);
    expect(await parent.getFunction("parentWrappedOutcome")()).to.deep.equal([hre.ethers.ZeroAddress, "0x"]);
    for (const [index, child] of children.entries()) {
      expect(await child.getFunction("parentWrappedOutcome")()).to.deep.equal(
        await parent.getFunction("wrappedOutcome")(index),
      );
    }
  });
});
