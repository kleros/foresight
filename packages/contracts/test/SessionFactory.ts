import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

import { deploySessionFactoryFixture } from "./fixtures/deploy";
import {
  buildThreeOutcomeSession,
  buildTwoOutcomeSession,
  childAt,
  phasedOpenArgs,
  MarketKind,
} from "./fixtures/sessionFactory";

describe("SessionFactory", function () {
  describe("deploySession (atomic)", function () {
    it("deploys parent and all children and marks session complete", async function () {
      const { deployer, seerMarketFactory, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();

      await expect(sessionFactory.connect(deployer).deploySession(params))
        .to.emit(sessionFactory, "ParentMarketDeployed")
        .withArgs(0n, deployer.address, (parent: string) => parent !== hre.ethers.ZeroAddress, 2n)
        .to.emit(sessionFactory, "ChildMarketDeployed");

      const session = await sessionFactory.getSession(0n);
      expect(session.deployer).to.equal(deployer.address);
      expect(session.parentMarket).to.not.equal(hre.ethers.ZeroAddress);
      expect(session.childMarkets).to.have.length(2);
      expect(session.expectedChildCount).to.equal(2n);
      expect(session.completedAt).to.be.gt(0n);
      expect(session.openedAt).to.equal(session.completedAt);
      expect(await sessionFactory.sessionCount()).to.equal(1n);
      expect(await seerMarketFactory.marketCount()).to.equal(3n);
    });

    it("routes categorical vs multi-categorical parent to Seer", async function () {
      const { deployer, seerMarketFactory, sessionFactory } = await loadFixture(deploySessionFactoryFixture);

      const categoricalParams = buildTwoOutcomeSession({ multiCategoricalParent: false });
      await sessionFactory.connect(deployer).deploySession(categoricalParams);
      expect(await seerMarketFactory.lastParentMarketKind()).to.equal(MarketKind.Categorical);

      const multiParams = buildTwoOutcomeSession({
        multiCategoricalParent: true,
      });
      await sessionFactory.connect(deployer).deploySession(multiParams);
      expect(await seerMarketFactory.lastParentMarketKind()).to.equal(MarketKind.MultiCategorical);
    });

    it("reverts when child ordering is invalid", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      params.children[1]!.parentOutcomeIndex = 0n;

      await expect(sessionFactory.connect(deployer).deploySession(params)).to.be.revertedWithCustomError(
        sessionFactory,
        "InvalidConfig",
      );
    });

    it("supports sessions with more than two parent outcomes", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildThreeOutcomeSession();

      await sessionFactory.connect(deployer).deploySession(params);

      const session = await sessionFactory.getSession(0n);
      expect(session.childMarkets).to.have.length(3);
      expect(session.expectedChildCount).to.equal(3n);
      expect(await sessionFactory.sessionCount()).to.equal(1n);
    });

    it("increments session ids across deploys", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();

      await sessionFactory.connect(deployer).deploySession(params);
      await sessionFactory.connect(deployer).deploySession(params);

      expect(await sessionFactory.sessionCount()).to.equal(2n);

      const first = await sessionFactory.getSession(0n);
      const second = await sessionFactory.getSession(1n);
      expect(first.parentMarket).to.not.equal(second.parentMarket);
    });

    it("forwards scalar params to Seer on atomic deploy", async function () {
      const { deployer, seerMarketFactory, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();

      await sessionFactory.connect(deployer).deploySession(params);

      const lastChild = childAt(params, 1);
      const lastParams = await seerMarketFactory.lastParams();
      expect(lastParams.marketName).to.equal(lastChild.marketName);
      expect(await seerMarketFactory.lastOutcomes()).to.deep.equal(lastChild.outcomes);
      expect(await seerMarketFactory.lastTokenNames()).to.deep.equal(lastChild.tokenNames);
      expect(lastParams.lowerBound).to.equal(lastChild.lowerBound);
      expect(lastParams.upperBound).to.equal(lastChild.upperBound);
      expect(lastParams.parentOutcome).to.equal(1n);
    });
  });

  describe("openPhasedSession + deploySessionChildBatch", function () {
    it("completes a session across parent and child batch txs", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();

      const openTx = await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));
      await expect(openTx).to.emit(sessionFactory, "ParentMarketDeployed");

      let session = await sessionFactory.getSession(0n);
      expect(session.childMarkets).to.have.length(0);
      expect(session.completedAt).to.equal(0n);

      await sessionFactory.connect(deployer).deploySessionChildBatch(0n, [childAt(params, 0)]);
      session = await sessionFactory.getSession(0n);
      expect(session.childMarkets).to.have.length(1);
      expect(session.completedAt).to.equal(0n);

      await sessionFactory.connect(deployer).deploySessionChildBatch(0n, [childAt(params, 1)]);
      session = await sessionFactory.getSession(0n);
      expect(session.childMarkets).to.have.length(2);
      expect(session.completedAt).to.be.gt(0n);
    });

    it("rejects non-deployer child batches", async function () {
      const { deployer, other, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));

      await expect(
        sessionFactory.connect(other).deploySessionChildBatch(0n, [childAt(params, 0)]),
      ).to.be.revertedWithCustomError(sessionFactory, "NotSessionDeployer");
    });

    it("rejects batches after completion", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));
      await sessionFactory.connect(deployer).deploySessionChildBatch(0n, params.children);

      await expect(
        sessionFactory.connect(deployer).deploySessionChildBatch(0n, [childAt(params, 0)]),
      ).to.be.revertedWithCustomError(sessionFactory, "SessionAlreadyComplete");
    });

    it("rejects oversized child batches", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));
      await sessionFactory.connect(deployer).deploySessionChildBatch(0n, [childAt(params, 0)]);

      await expect(
        sessionFactory.connect(deployer).deploySessionChildBatch(0n, params.children),
      ).to.be.revertedWithCustomError(sessionFactory, "ChildBatchExceedsExpected");
    });
  });

  describe("getSession", function () {
    it("returns an empty session for unknown ids", async function () {
      const { sessionFactory } = await loadFixture(deploySessionFactoryFixture);

      const session = await sessionFactory.getSession(99n);
      expect(session.deployer).to.equal(hre.ethers.ZeroAddress);
      expect(session.parentMarket).to.equal(hre.ethers.ZeroAddress);
      expect(session.childMarkets).to.have.length(0);
      expect(session.openedAt).to.equal(0n);
      expect(session.completedAt).to.equal(0n);
      expect(session.expectedChildCount).to.equal(0n);
    });

    it("treats unknown session ids as non-deployer on child batches", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();

      await expect(
        sessionFactory.connect(deployer).deploySessionChildBatch(99n, [childAt(params, 0)]),
      ).to.be.revertedWithCustomError(sessionFactory, "NotSessionDeployer");
    });
  });

  describe("validation", function () {
    it("reverts when child count does not match parent outcomes", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      params.children.pop();

      await expect(sessionFactory.connect(deployer).deploySession(params)).to.be.revertedWithCustomError(
        sessionFactory,
        "InvalidConfig",
      );
    });

    it("reverts when phased child batch is empty", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));

      await expect(sessionFactory.connect(deployer).deploySessionChildBatch(0n, [])).to.be.revertedWithCustomError(
        sessionFactory,
        "InvalidConfig",
      );
    });

    it("reverts when phased batch child index is out of order", async function () {
      const { deployer, sessionFactory } = await loadFixture(deploySessionFactoryFixture);
      const params = buildTwoOutcomeSession();
      await sessionFactory.connect(deployer).openPhasedSession(...phasedOpenArgs(params));

      const wrongOrder = [{ ...childAt(params, 1), parentOutcomeIndex: 1n }];
      await expect(
        sessionFactory.connect(deployer).deploySessionChildBatch(0n, wrongOrder),
      ).to.be.revertedWithCustomError(sessionFactory, "InvalidConfig");
    });
  });
});
