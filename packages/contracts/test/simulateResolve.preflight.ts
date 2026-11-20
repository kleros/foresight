// Runs the simulate-resolve action with instrumented Seer and Reality contracts. A test may pass its own network
// config and fork metadata; the defaults are an in-process gnosis fork that reports gnosis fork metadata.
import { expect } from "chai";
import hre from "hardhat";
import { ArgumentsParser } from "hardhat/internal/cli/ArgumentsParser";
import type { HardhatRuntimeEnvironment, NetworkConfig } from "hardhat/types";

const NOW = 1_000_000n;
const TIMEOUT = 86_400n;
const QUESTION = "0x" + "11".repeat(32);

interface Question {
  openingTS: bigint;
  finalizeTS: bigint;
  timeout?: bigint;
}

interface Run {
  error: unknown;
  sent: string[];
  signerRequests: number;
  questions: Question[];
  now: bigint;
}

type Metadata = { chainId: number; forkedNetwork?: { chainId: number; forkBlockNumber: number } } | "unsupported";

const forkMetadata = (forkedChainId?: number): Metadata => ({
  chainId: 100,
  ...(forkedChainId !== undefined && { forkedNetwork: { chainId: forkedChainId, forkBlockNumber: 40_000_000 } }),
});

async function runAction(
  questions: Question[],
  args: { answerOnly?: boolean } | string[] = {},
  config?: NetworkConfig,
  metadata: Metadata = forkMetadata(100),
): Promise<Run> {
  const sent: string[] = [];
  let signerRequests = 0;
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
        // Sequential answer transactions mine in different blocks.
        now += 2n;
        const question = byId(id);
        question.finalizeTS = now + (question.timeout ?? TIMEOUT);
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

  const networkConfig = (config ?? {
    ...hre.config.networks.hardhat,
    chainId: 100,
    forking: { enabled: true, url: "https://rpc.gnosischain.com", blockNumber: 40_000_000 },
  }) as NetworkConfig;
  const provider = Object.assign(Object.create(hre.network.provider) as typeof hre.network.provider, {
    send: (method: string, params?: unknown[]) => {
      if (method === "hardhat_metadata") {
        if (metadata === "unsupported") return Promise.reject(new Error("Method not found"));
        return Promise.resolve(metadata);
      }
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
      getSigners: () => {
        signerRequests++;
        return Promise.resolve([{}]);
      },
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
    const taskArgs = Array.isArray(args)
      ? new ArgumentsParser().parseTaskArguments(task, [
          "--session",
          "0",
          "--winners",
          "0",
          ...(children ? ["--children", children] : []),
          ...args,
        ])
      : { session: 0, winners: "0", ...(children && { children }), ...args };
    const noSuper = Object.assign(() => Promise.resolve(), { isDefined: false });
    await task.action(taskArgs, fake, noSuper);
  } catch (caught) {
    error = caught;
  }
  return { error, sent, signerRequests, questions, now };
}

const fresh = (): Question => ({ openingTS: NOW + 3_600n, finalizeTS: 0n });

describe("simulate-resolve refuses a configuration that only looks like a gnosis fork", function () {
  const refused = async (config: NetworkConfig) => {
    const run = await runAction([fresh(), fresh()], {}, config);
    expect(run.error, "the action must exit with an error").to.be.instanceOf(Error);
    expect(run.signerRequests, "a signer was requested").to.equal(0);
    expect(run.sent, "transactions sent").to.deep.equal([]);
  };
  const remote = (url: string) => ({ url, chainId: 100, accounts: "remote", timeout: 20_000 }) as NetworkConfig;

  it("refuses the in-process network whose forking config is disabled", async function () {
    await refused({
      ...hre.config.networks.hardhat,
      chainId: 100,
      forking: { enabled: false, url: "https://rpc.gnosischain.com", blockNumber: 40_000_000 },
    } as NetworkConfig);
  });

  it("refuses a remote host whose name starts with a loopback name", async function () {
    await refused(remote("http://localhost.gnosis.invalid:8545"));
    await refused(remote("http://127.0.0.1.gnosis.invalid:8545"));
  });

  it("refuses a remote host whose name ends with a loopback name", async function () {
    await refused(remote("http://rpc-localhost:8545"));
  });

  it("refuses a remote host whose URL carries a loopback name outside the host", async function () {
    await refused(remote("https://rpc.gnosis.invalid/127.0.0.1?via=localhost"));
  });
});

describe("simulate-resolve checks fork metadata on every loopback host", function () {
  const hosts = ["127.0.0.1", "localhost", "[::1]"];
  const loopback = (host: string) =>
    ({ url: `http://${host}:8545`, chainId: 100, accounts: "remote", timeout: 20_000 }) as NetworkConfig;

  for (const host of hosts) {
    for (const [what, metadata] of [
      ["has no fork metadata method", "unsupported"],
      ["names no forked network", forkMetadata()],
      ["forks a chain other than gnosis", forkMetadata(1)],
    ] as const) {
      it(`refuses ${host} when the node ${what}`, async function () {
        const run = await runAction([fresh(), fresh()], {}, loopback(host), metadata);
        expect(run.error, "the action must exit with an error").to.be.instanceOf(Error);
        expect((run.error as Error).message).to.match(/no fork of gnosis/);
        expect(run.signerRequests, "a signer was requested").to.equal(0);
        expect(run.sent, "transactions sent").to.deep.equal([]);
      });
    }

    it(`passes ${host} when the node reports a gnosis fork (control)`, async function () {
      const run = await runAction([fresh(), fresh()], {}, loopback(host));
      expect(run.error).to.equal(undefined);
      expect(run.signerRequests).to.equal(1);
    });
  }
});

describe("simulate-resolve refuses an open or answered question before sending any answer", function () {
  const refused = async (question: Question, reason: RegExp) => {
    for (const [slot, questions] of [
      ["parent", [question, fresh(), fresh()]],
      ["child 0", [fresh(), question, fresh()]],
      ["child 1", [fresh(), fresh(), question]],
    ] as const) {
      const run = await runAction([...questions]);
      expect(run.error, `the action must exit with an error (${slot})`).to.be.instanceOf(Error);
      expect((run.error as Error).message)
        .to.match(reason)
        .and.to.include(slot);
      expect(run.sent, `transactions sent (${slot})`).to.deep.equal([]);
    }
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
    expect(
      run.sent.filter((label) => label.startsWith("resolve")),
      "resolve calls",
    ).to.deep.equal([]);
    expect(run.questions[1]!.finalizeTS).to.be.greaterThan(run.questions[0]!.finalizeTS);
    for (const question of run.questions) expect(run.now > question.finalizeTS, "final in Reality").to.equal(true);
  });

  it("accepts the CLI flag and waits for the latest finalization, even in the middle of the selection", async function () {
    const run = await runAction(
      [fresh(), { ...fresh(), timeout: TIMEOUT * 3n }, { ...fresh(), timeout: TIMEOUT * 2n }],
      ["--answer-only"],
    );
    expect(run.error).to.equal(undefined);
    expect(run.sent.filter((label) => label.startsWith("submitAnswer"))).to.have.length(3);
    expect(
      run.sent.filter((label) => label.startsWith("resolve")),
      "resolve calls",
    ).to.deep.equal([]);
    expect(run.questions[1]!.finalizeTS).to.be.greaterThan(run.questions[0]!.finalizeTS);
    expect(run.questions[1]!.finalizeTS).to.be.greaterThan(run.questions[2]!.finalizeTS);
    for (const question of run.questions) expect(run.now > question.finalizeTS, "final in Reality").to.equal(true);
  });

  it("keeps resolution enabled when the CLI flag is omitted", async function () {
    const run = await runAction([fresh(), fresh()], []);
    expect(run.error).to.equal(undefined);
    expect(run.sent.filter((label) => label.startsWith("submitAnswer"))).to.have.length(2);
    expect(run.sent.filter((label) => label.startsWith("resolve"))).to.deep.equal([
      "resolve market0",
      "resolve market1",
    ]);
    for (const question of run.questions) expect(run.now > question.finalizeTS, "final in Reality").to.equal(true);
  });
});
