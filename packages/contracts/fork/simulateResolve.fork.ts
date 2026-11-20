// Outside test/ so the default suite stays fork-free. Run from packages/contracts:
// HARDHAT_FORK=gnosis yarn hardhat test fork/simulateResolve.fork.ts
// Omitting --winners leaves the parent as it is; omitting --children resolves no child.
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";
import type { Contract } from "ethers";
import { parseEther, toBeHex } from "ethers";
import hre from "hardhat";
import { ArgumentsParser } from "hardhat/internal/cli/ArgumentsParser";

import { getSeerDeployment } from "../config/seer";

const MARKET_ABI = [
  "function conditionId() view returns (bytes32)",
  "function realityProxy() view returns (address)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
  "function questionsIds() view returns (bytes32[])",
];
const REALITY_PROXY_ABI = [
  "function conditionalTokens() view returns (address)",
  "function realitio() view returns (address)",
  "function resolve(address market)",
];
const CONDITIONAL_TOKENS_ABI = [
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
];

interface Session {
  parent: Contract;
  children: Contract[];
}

let conditionalTokens: Contract;

const market = (address: string) => new hre.ethers.Contract(address, MARKET_ABI, hre.ethers.provider);

async function denominator(target: Contract): Promise<bigint> {
  return (await conditionalTokens.getFunction("payoutDenominator")(
    await target.getFunction("conditionId")(),
  )) as bigint;
}

async function numerators(target: Contract, count: number): Promise<bigint[]> {
  const conditionId = (await target.getFunction("conditionId")()) as string;
  const values: bigint[] = [];
  for (let index = 0; index < count; index++) {
    values.push((await conditionalTokens.getFunction("payoutNumerators")(conditionId, index)) as bigint);
  }
  return values;
}

async function newSession(outcomes: number, multi: boolean): Promise<Session & { id: number }> {
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
  return { id, parent: market(session.parentMarket), children: session.childMarkets.map(market) };
}

describe("simulate-resolve on the gnosis fork", function () {
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

  it("A3 --answer-only from the CLI finalizes chosen markets without reporting payouts", async function () {
    const { id, parent, children } = await newSession(3, true);
    const [valued, untouched, invalid] = children;
    if (!valued || !untouched || !invalid) throw new Error("Expected three child markets");
    const task = hre.tasks["simulate-resolve"];
    if (!task) throw new Error("simulate-resolve is not registered");
    const args = new ArgumentsParser().parseTaskArguments(task, [
      "--session",
      String(id),
      "--winners",
      "0,2",
      "--children",
      "0=42,2=invalid",
      "--answer-only",
    ]);

    await hre.run("simulate-resolve", args);

    const reality = getSeerDeployment(100, "Reality");
    if (!reality) throw new Error("Expected the Seer Reality deployment");
    const proxy = new hre.ethers.Contract(
      (await parent.getFunction("realityProxy")()) as string,
      REALITY_PROXY_ABI,
      hre.ethers.provider,
    );
    const realitio = new hre.ethers.Contract(
      (await proxy.getFunction("realitio")()) as string,
      reality.abi,
      hre.ethers.provider,
    );
    const expected: [Contract, string][] = [
      [parent, toBeHex(0b101n, 32)],
      [valued, toBeHex(parseEther("42"), 32)],
      [invalid, `0x${"ff".repeat(32)}`],
    ];
    for (const [target, answer] of expected) {
      const question = ((await target.getFunction("questionsIds")()) as string[])[0]!;
      expect(await realitio.getFunction("isFinalized")(question), "final in Reality").to.equal(true);
      expect(await realitio.getFunction("resultFor")(question)).to.equal(answer);
      expect(await denominator(target), "payoutDenominator").to.equal(0n);
    }
    const untouchedQuestion = ((await untouched.getFunction("questionsIds")()) as string[])[0]!;
    expect(await realitio.getFunction("getFinalizeTS")(untouchedQuestion)).to.equal(0n);
    expect(await denominator(untouched)).to.equal(0n);
  });

  describe("A1 parent", function () {
    it("answers and resolves a categorical parent for the chosen winner, leaving every child unresolved", async function () {
      const { id, parent, children } = await newSession(3, false);
      expect(await denominator(parent)).to.equal(0n);

      await hre.run("simulate-resolve", { session: id, winners: "1" });

      expect(await denominator(parent)).to.not.equal(0n);
      expect(await numerators(parent, 4)).to.deep.equal([0n, 1n, 0n, 0n]);
      for (const child of children) {
        expect(await denominator(child)).to.equal(0n);
      }
    });

    it("answers and resolves a multi-categorical parent for several chosen winners", async function () {
      const { id, parent } = await newSession(3, true);

      await hre.run("simulate-resolve", { session: id, winners: "0,2" });

      expect(await denominator(parent)).to.not.equal(0n);
      expect(await numerators(parent, 4)).to.deep.equal([1n, 0n, 1n, 0n]);
    });
  });

  describe("A2 and A3 children", function () {
    let session: Session & { id: number };

    before(async function () {
      session = await newSession(3, true);
    });

    it("resolves only the chosen children, one to a value and one to INVALID, leaving the other unresolved", async function () {
      const { id, parent, children } = session;
      const [valued, untouched, invalid] = children;
      if (!valued || !untouched || !invalid) throw new Error("Expected three child markets");

      await hre.run("simulate-resolve", { session: id, winners: "0,1,2", children: "0=42,2=invalid" });

      expect(await denominator(parent)).to.not.equal(0n);
      expect(await numerators(parent, 4)).to.deep.equal([1n, 1n, 1n, 0n]);

      const low = (await valued.getFunction("lowerBound")()) as bigint;
      const high = (await valued.getFunction("upperBound")()) as bigint;
      const answer = parseEther("42");
      expect(await denominator(valued)).to.not.equal(0n);
      expect(await numerators(valued, 3)).to.deep.equal([high - answer, answer - low, 0n]);

      expect(await denominator(invalid)).to.not.equal(0n);
      expect(await numerators(invalid, 3)).to.deep.equal([0n, 0n, 1n]);

      expect(await denominator(untouched)).to.equal(0n);
    });

    it("resolves a remaining child later without touching the resolved markets (Flow 4)", async function () {
      const { id, parent, children } = session;
      const [valued, later, invalid] = children;
      if (!valued || !later || !invalid) throw new Error("Expected three child markets");
      const before = {
        parent: await numerators(parent, 4),
        valued: await numerators(valued, 3),
        invalid: await numerators(invalid, 3),
      };

      await hre.run("simulate-resolve", { session: id, children: "1=7" });

      const low = (await later.getFunction("lowerBound")()) as bigint;
      const high = (await later.getFunction("upperBound")()) as bigint;
      const answer = parseEther("7");
      expect(await denominator(later)).to.not.equal(0n);
      expect(await numerators(later, 3)).to.deep.equal([high - answer, answer - low, 0n]);
      expect(await numerators(parent, 4)).to.deep.equal(before.parent);
      expect(await numerators(valued, 3)).to.deep.equal(before.valued);
      expect(await numerators(invalid, 3)).to.deep.equal(before.invalid);
    });
  });
});
