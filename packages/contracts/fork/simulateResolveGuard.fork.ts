// Outside test/ so the default suite stays fork-free. Run from packages/contracts:
// HARDHAT_FORK=gnosis yarn hardhat test fork/simulateResolveGuard.fork.ts
// Interface fixed by these tests: simulate-resolve flag `answerOnly` (--answer-only) answers the chosen
// questions and lets them finalize in Reality without calling resolve.
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";
import type { Contract } from "ethers";
import { parseEther, toBeHex, ZeroHash } from "ethers";
import hre from "hardhat";

import { getSeerDeployment } from "../config/seer";

const INVALID_ANSWER = `0x${"ff".repeat(32)}`;
const word = (value: bigint) => toBeHex(value, 32);

const REALITY_PROXY_ABI = [
  "function conditionalTokens() view returns (address)",
  "function realitio() view returns (address)",
];
const CONDITIONAL_TOKENS_ABI = ["function payoutDenominator(bytes32 conditionId) view returns (uint256)"];

interface Session {
  id: number;
  parent: Contract;
  children: Contract[];
}

let conditionalTokens: Contract;
let realitio: Contract;

function seer(name: string) {
  const deployment = getSeerDeployment(100, name);
  if (!deployment) throw new Error(`No Seer ${name} deployment for gnosis`);
  return deployment;
}

const market = (address: string) => new hre.ethers.Contract(address, seer("Market").abi, hre.ethers.provider);

async function questionOf(target: Contract): Promise<string> {
  return ((await target.getFunction("questionsIds")()) as string[])[0]!;
}

async function denominator(target: Contract): Promise<bigint> {
  return (await conditionalTokens.getFunction("payoutDenominator")(
    await target.getFunction("conditionId")(),
  )) as bigint;
}

async function advancePast(timestamp: bigint) {
  const latest = await hre.ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest block");
  if (BigInt(latest.timestamp) > timestamp) return;
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp) + 1]);
  await hre.network.provider.send("evm_mine");
}

async function newSession(outcomes: number, multi: boolean): Promise<Session> {
  await hre.run("simulate-session", { outcomes, multi });
  const deployment = await hre.deployments.get("SessionFactory");
  const factory = await hre.ethers.getContractAt("SessionFactory", deployment.address);
  const id = Number((await factory.sessionCount()) - 1n);
  const session = await factory.getSession(id);
  const proxy = new hre.ethers.Contract(
    (await market(session.parentMarket).getFunction("realityProxy")()) as string,
    REALITY_PROXY_ABI,
    hre.ethers.provider,
  );
  conditionalTokens = new hre.ethers.Contract(
    (await proxy.getFunction("conditionalTokens")()) as string,
    CONDITIONAL_TOKENS_ABI,
    hre.ethers.provider,
  );
  realitio = new hre.ethers.Contract(
    (await proxy.getFunction("realitio")()) as string,
    seer("Reality").abi,
    hre.ethers.provider,
  );
  return { id, parent: market(session.parentMarket), children: session.childMarkets.map(market) };
}

// Answers a question straight on Reality from a second account, as another user would.
async function answerDirectly(target: Contract, answer: string) {
  const [, other] = await hre.ethers.getSigners();
  if (!other) throw new Error("Expected a second signer");
  const question = await questionOf(target);
  await advancePast((await realitio.getFunction("getOpeningTS")(question)) as bigint);
  const minBond = (await realitio.getFunction("getMinBond")(question)) as bigint;
  const asOther = realitio.connect(other) as Contract;
  await (await asOther.getFunction("submitAnswer")(question, answer, 0, { value: minBond > 0n ? minBond : 1n })).wait();
}

async function answerState(target: Contract) {
  const question = await questionOf(target);
  return {
    bond: (await realitio.getFunction("getBond")(question)) as bigint,
    historyHash: (await realitio.getFunction("getHistoryHash")(question)) as string,
    finalizeTS: (await realitio.getFunction("getFinalizeTS")(question)) as bigint,
  };
}

describe("simulate-resolve guards and answer-only mode on the gnosis fork", function () {
  this.timeout(30 * 60 * 1000);

  before(async function () {
    if (Number(await hre.getChainId()) !== 100) {
      throw new Error("Run with HARDHAT_FORK=gnosis: this suite needs the live Seer and Reality contracts");
    }
    const artifact = JSON.parse(
      readFileSync(path.join(__dirname, "..", "deployments", "gnosis", "SessionFactory.json"), "utf8"),
    ) as { address: string; abi: unknown[] };
    // in memory only: a chainId 100 file in deployments/hardhat breaks the default suite
    hre.network.saveDeployments = false;
    await hre.deployments.save("SessionFactory", { address: artifact.address, abi: artifact.abi });
  });

  describe("A2 refuses a question that already has an answer, before sending any answer", function () {
    async function expectRefusedWithNothingSent(finalizeFirst: boolean) {
      const { id, children } = await newSession(3, true);
      const [fresh, answered] = children;
      if (!fresh || !answered) throw new Error("Expected child markets");

      await answerDirectly(answered, word(parseEther("13")));
      if (finalizeFirst) await advancePast((await answerState(answered)).finalizeTS);
      const answeredBefore = await answerState(answered);
      expect(answeredBefore.bond).to.not.equal(0n);

      let error: unknown;
      try {
        await hre.run("simulate-resolve", { session: id, children: "0=5,1=7" });
      } catch (caught) {
        error = caught;
      }

      expect(error, "the task must exit with an error").to.be.instanceOf(Error);
      const freshAfter = await answerState(fresh);
      expect(freshAfter.bond, "an answer was sent for the unanswered question").to.equal(0n);
      expect(freshAfter.historyHash).to.equal(ZeroHash);
      expect(await answerState(answered)).to.deep.equal(answeredBefore);
      expect(await denominator(fresh)).to.equal(0n);
      expect(await denominator(answered)).to.equal(0n);
    }

    it("refuses when a chosen question is open with an answer inside its timeout", async function () {
      await expectRefusedWithNothingSent(false);
    });

    it("refuses when a chosen question is answered and final", async function () {
      await expectRefusedWithNothingSent(true);
    });
  });

  describe("A3 answer-only leaves markets final in Reality but unresolved in ConditionalTokens", function () {
    it("finalizes a multi-categorical parent, a valued child and an invalid child without resolving them", async function () {
      const { id, parent, children } = await newSession(3, true);
      const [valued, untouched, invalid] = children;
      if (!valued || !untouched || !invalid) throw new Error("Expected three child markets");

      await hre.run("simulate-resolve", {
        session: id,
        winners: "0,2",
        children: "0=42,2=invalid",
        answerOnly: true,
      });

      const expected: [string, Contract, string][] = [
        ["parent", parent, word(0b101n)],
        ["child 0", valued, word(parseEther("42"))],
        ["child 2", invalid, INVALID_ANSWER],
      ];
      for (const [label, target, answer] of expected) {
        const question = await questionOf(target);
        expect(await realitio.getFunction("isFinalized")(question), `${label} final in Reality`).to.equal(true);
        expect(((await realitio.getFunction("resultFor")(question)) as string).toLowerCase(), label).to.equal(answer);
        expect(await denominator(target), `${label} payoutDenominator`).to.equal(0n);
      }

      expect((await answerState(untouched)).bond).to.equal(0n);
      expect(await denominator(untouched)).to.equal(0n);
    });
  });
});
