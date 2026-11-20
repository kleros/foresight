import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Contract } from "ethers";

import { getSeerDeployment } from "../config/seer";
import { encodeChildAnswer, encodeParentAnswer } from "./resolveAnswers";

const MULTI_SELECT_TEMPLATE = 3n;
const GNOSIS_CHAIN_ID = 100;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface SimulateResolveArgs {
  session?: number;
  winners?: string;
  children?: string;
  answerOnly?: boolean;
}

interface Target {
  label: string;
  market: Contract;
  answer: string;
}

async function advancePast(hre: HardhatRuntimeEnvironment, timestamp: bigint) {
  const latest = await hre.ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest block");
  if (BigInt(latest.timestamp) > timestamp) return;
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp) + 1]);
  await hre.network.provider.send("evm_mine");
}

async function assertGnosisFork(hre: HardhatRuntimeEnvironment) {
  const config = hre.network.config;
  if (!("url" in config)) {
    if (config.forking?.enabled === true) return;
    throw new Error(`Network '${hre.network.name}' is in-process without forking - set HARDHAT_FORK=gnosis.`);
  }
  if (!LOOPBACK_HOSTS.has(new URL(config.url).hostname)) {
    throw new Error(`Refusing ${config.url}: simulate-resolve runs only against a local gnosis fork.`);
  }
  const metadata = (await hre.network.provider.send("hardhat_metadata").catch(() => undefined)) as
    { forkedNetwork?: { chainId?: number } } | undefined;
  if (metadata?.forkedNetwork?.chainId !== GNOSIS_CHAIN_ID) {
    throw new Error(`Refusing ${config.url}: the node reports no fork of gnosis.`);
  }
}

const maxOf = (values: bigint[]) => values.reduce((max, value) => (value > max ? value : max), 0n);

task("simulate-resolve", "Answers a session's Reality questions and resolves its Seer markets (needs a gnosis fork)")
  .addOptionalParam("session", "Session id; defaults to the latest", undefined, types.int)
  .addOptionalParam("winners", 'Winning parent outcome indexes, e.g. "0,2"; omitted leaves the parent as it is')
  .addOptionalParam(
    "children",
    'Child values in the session\'s unit by child index, e.g. "0=42,2=invalid"; omitted resolves no child',
  )
  .addFlag("answerOnly", "Answer and finalize in Reality without resolving the markets")
  .setAction(async (args: SimulateResolveArgs, hre: HardhatRuntimeEnvironment) => {
    await assertGnosisFork(hre);
    const chainId = Number(await hre.getChainId());
    const seerMarket = getSeerDeployment(chainId, "Market");
    const realityProxy = getSeerDeployment(chainId, "RealityProxy");
    const reality = getSeerDeployment(chainId, "Reality");
    if (!seerMarket || !realityProxy || !reality) {
      throw new Error(
        `No Seer Market/RealityProxy/Reality deployment for chain ${chainId} - ` +
          "this task needs real Seer contracts, run against a gnosis fork (yarn local-stack gnosis-fork).",
      );
    }

    const [signer] = await hre.ethers.getSigners();
    if (!signer) throw new Error("No signer available on this network");

    const deployment = await hre.deployments.get("SessionFactory").catch(() => {
      throw new Error(`SessionFactory is not deployed on network '${hre.network.name}'.`);
    });
    const sessionFactory = await hre.ethers.getContractAt("SessionFactory", deployment.address);
    const sessionCount = await sessionFactory.sessionCount();
    if (sessionCount === 0n) throw new Error("No sessions deployed yet - run simulate-session first");
    const sessionId = args.session ?? Number(sessionCount - 1n);
    const session = await sessionFactory.getSession(sessionId);

    const market = (address: string) => new hre.ethers.Contract(address, seerMarket.abi, signer);
    const targets: Target[] = [];

    if (args.winners) {
      const parent = market(session.parentMarket);
      const multi = ((await parent.getFunction("templateId")()) as bigint) === MULTI_SELECT_TEMPLATE;
      const winners = args.winners.split(",").map(Number);
      targets.push({ label: "parent", market: parent, answer: encodeParentAnswer(winners, multi) });
    }

    for (const entry of args.children ? args.children.split(",") : []) {
      const [index, value] = entry.split("=");
      const childAddress = session.childMarkets[Number(index)];
      if (!childAddress || !value) throw new Error(`Bad --children entry "${entry}" for session #${sessionId}`);
      targets.push({ label: `child ${index}`, market: market(childAddress), answer: encodeChildAnswer(value) });
    }

    if (targets.length === 0) throw new Error("Nothing to resolve: pass --winners and/or --children");

    const proxy = new hre.ethers.Contract(
      (await targets[0]!.market.getFunction("realityProxy")()) as string,
      realityProxy.abi,
      signer,
    );
    const realitio = new hre.ethers.Contract((await proxy.getFunction("realitio")()) as string, reality.abi, signer);

    const questions = await Promise.all(
      targets.map(async (target) => ((await target.market.getFunction("questionsIds")()) as string[])[0]!),
    );

    for (const [i, target] of targets.entries()) {
      // Reality keeps finalize_ts at UNANSWERED (0) until the first answer
      if (((await realitio.getFunction("getFinalizeTS")(questions[i])) as bigint) !== 0n) {
        throw new Error(`The ${target.label} question ${questions[i]} already has an answer - nothing was sent.`);
      }
    }

    await advancePast(
      hre,
      maxOf(await Promise.all(questions.map(async (q) => (await realitio.getFunction("getOpeningTS")(q)) as bigint))),
    );

    for (const [i, target] of targets.entries()) {
      const minBond = (await realitio.getFunction("getMinBond")(questions[i])) as bigint;
      // Reality rejects a zero bond
      const bond = minBond > 0n ? minBond : 1n;
      console.log(`Answering ${target.label} ${await target.market.getAddress()} with ${target.answer}…`);
      await (await realitio.getFunction("submitAnswer")(questions[i], target.answer, 0, { value: bond })).wait();
    }

    await advancePast(
      hre,
      maxOf(await Promise.all(questions.map(async (q) => (await realitio.getFunction("getFinalizeTS")(q)) as bigint))),
    );

    if (args.answerOnly) return;
    for (const target of targets) {
      console.log(`Resolving ${target.label}…`);
      await (await proxy.getFunction("resolve")(await target.market.getAddress())).wait();
    }
  });
