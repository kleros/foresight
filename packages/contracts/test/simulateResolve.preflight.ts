// Runs the simulate-resolve action on an in-process gnosis fork config with instrumented Seer and Reality contracts.
import { expect } from "chai";
import hre from "hardhat";
import type { HardhatRuntimeEnvironment, NetworkConfig } from "hardhat/types";

const NOW = 1_000_000n;
const TIMEOUT = 86_400n;
const QUESTION = "0x" + "11".repeat(32);

interface Question {
  openingTS: bigint;
  finalizeTS: bigint;
}

interface Run {
  error: unknown;
  sent: string[];
  questions: Question[];
  now: bigint;
}

async function runAction(questions: Question[], args: { answerOnly?: boolean } = {}): Promise<Run> {
  const sent: string[] = [];
  let now = NOW;
  const questionId = (i: number) => QUESTION.slice(0, -2) + i.toString(16).padStart(2, "0");
  const byId = (id: string) => {
    const question = questions[Number.parseInt(id.slice(-2), 16)];
    if (!question) throw new Error(`unknown question ${id}`);
    return question;
  };
  const tx = (label: string) => {
    sent.push(label);
    return Promise.resolve({ wait: () => Promise.resolve({}) });
  };

  const functions: Record<string, Record<string, (...params: never[]) => unknown>> = {
    proxy: {
      realitio: () => "realitio",
      resolve: (market: string) => tx(`resolve ${market}`),
    },
    realitio: {
      getOpeningTS: (id: string) => byId(id).openingTS,
      getFinalizeTS: (id: string) => byId(id).finalizeTS,
      getMinBond: () => 0n,
      submitAnswer: (id: string) => {
        byId(id).finalizeTS = now + TIMEOUT;
        return tx(`submitAnswer ${id}`);
      },
    },
  };
  questions.forEach((_, i) => {
    functions[`market${i}`] = {
      templateId: () => 3n,
      realityProxy: () => "proxy",
      questionsIds: () => [questionId(i)],
    };
  });

  class FakeContract {
    constructor(private readonly address: string) {}
    getAddress() {
      return Promise.resolve(this.address);
    }
    getFunction(name: string) {
      const fn = functions[this.address]?.[name];
      if (!fn) throw new Error(`${this.address} has no ${name}`);
      return (...params: never[]) => Promise.resolve(fn(...params));
    }
  }

  const networkConfig = {
    ...hre.config.networks.hardhat,
    chainId: 100,
    forking: { enabled: true, url: "https://rpc.gnosischain.com", blockNumber: 40_000_000 },
  } as NetworkConfig;
  const provider = Object.assign(Object.create(hre.network.provider) as typeof hre.network.provider, {
    send: (method: string, params?: unknown[]) => {
      if (method === "evm_setNextBlockTimestamp") now = BigInt((params as number[])[0]!);
      return Promise.resolve(null);
    },
  });
  const session = { parentMarket: "market0", childMarkets: questions.slice(1).map((_, i) => `market${i + 1}`) };
  const fake = Object.assign(Object.create(hre) as HardhatRuntimeEnvironment, {
    network: { ...hre.network, name: "hardhat", config: networkConfig, provider },
    getChainId: () => Promise.resolve("100"),
    deployments: { ...hre.deployments, get: () => Promise.resolve({ address: "factory" }) },
    ethers: Object.assign(Object.create(hre.ethers) as typeof hre.ethers, {
      Contract: FakeContract,
      provider: { getBlock: () => Promise.resolve({ timestamp: Number(now) }) },
      getSigners: () => Promise.resolve([{}]),
      getContractAt: () =>
        Promise.resolve({ sessionCount: () => Promise.resolve(1n), getSession: () => Promise.resolve(session) }),
    }),
  });

  const children = questions
    .slice(1)
    .map((_, i) => `${i}=42`)
    .join(",");
  const task = hre.tasks["simulate-resolve"];
  if (!task) throw new Error("simulate-resolve is not registered");
  let error: unknown;
  try {
    const noSuper = Object.assign(() => Promise.resolve(), { isDefined: false });
    await task.action({ session: 0, winners: "0", ...(children && { children }), ...args }, fake, noSuper);
  } catch (caught) {
    error = caught;
  }
  return { error, sent, questions, now };
}

const fresh = (): Question => ({ openingTS: NOW + 3_600n, finalizeTS: 0n });

describe("simulate-resolve refuses an open or answered question before sending any answer", function () {
  const refused = async (question: Question, reason: RegExp) => {
    const run = await runAction([fresh(), question]);
    expect(run.error, "the action must exit with an error").to.be.instanceOf(Error);
    expect((run.error as Error).message).to.match(reason);
    expect(run.sent, "transactions sent").to.deep.equal([]);
  };

  it("refuses a question that is open with no answer", async function () {
    await refused({ openingTS: NOW - 10n, finalizeTS: 0n }, /already open/);
  });

  it("refuses a question whose opening time is the latest block's", async function () {
    await refused({ openingTS: NOW, finalizeTS: 0n }, /already open/);
  });

  it("refuses a question answered inside its timeout", async function () {
    await refused({ openingTS: NOW - 10n, finalizeTS: NOW + 100n }, /already has an answer/);
  });

  it("refuses a question that is answered and final", async function () {
    await refused({ openingTS: NOW - 200n, finalizeTS: NOW - 100n }, /already has an answer/);
  });

  it("answers and resolves questions that have not opened (control)", async function () {
    const run = await runAction([fresh(), fresh()]);
    expect(run.error).to.equal(undefined);
    expect(run.sent.filter((label) => label.startsWith("submitAnswer"))).to.have.length(2);
    expect(run.sent.filter((label) => label.startsWith("resolve"))).to.deep.equal([
      "resolve market0",
      "resolve market1",
    ]);
  });
});

describe("simulate-resolve --answer-only", function () {
  it("answers every chosen question and resolves none", async function () {
    const run = await runAction([fresh(), fresh()], { answerOnly: true });
    expect(run.error).to.equal(undefined);
    expect(run.sent.filter((label) => label.startsWith("submitAnswer"))).to.have.length(2);
    expect(run.sent.filter((label) => label.startsWith("resolve")), "resolve calls").to.deep.equal([]);
    for (const question of run.questions) expect(run.now > question.finalizeTS, "final in Reality").to.equal(true);
  });
});
