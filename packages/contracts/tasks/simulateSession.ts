import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { ContractTransactionReceipt } from "ethers";

import { buildOutcomeSession, OUTCOME_LABELS } from "../test/fixtures/sessionFactory";

const DAY_IN_SECONDS = 24 * 60 * 60;

interface SimulateSessionArgs {
  outcomes: number;
  phased: boolean;
  multi: boolean;
  metadataUri?: string;
}

task("simulate-session", "Deploys a sample session through the deployed SessionFactory")
  .addOptionalParam("outcomes", "Number of parent outcomes (2-4)", 2, types.int)
  .addFlag("phased", "Deploy via openPhasedSession + one child batch tx per child instead of the atomic path")
  .addFlag("multi", "Use a multi-categorical parent market")
  .addOptionalParam(
    "metadataUri",
    "Metadata URI stored on the session; defaults to the shared example document.",
    undefined,
    types.string,
  )
  .setAction(async (args: SimulateSessionArgs, hre: HardhatRuntimeEnvironment) => {
    if (args.outcomes < 2 || args.outcomes > OUTCOME_LABELS.length) {
      throw new Error(`--outcomes must be between 2 and ${OUTCOME_LABELS.length}`);
    }

    const deployment = await hre.deployments.get("SessionFactory").catch(() => {
      throw new Error(
        `SessionFactory is not deployed on network '${hre.network.name}'. ` +
          "Start the local stack (yarn local-stack) or run 'yarn deploy:local' first.",
      );
    });
    const sessionFactory = await hre.ethers.getContractAt("SessionFactory", deployment.address);

    const latestBlock = await hre.ethers.provider.getBlock("latest");
    if (!latestBlock) {
      throw new Error("Could not read the latest block");
    }
    const openingTime = latestBlock.timestamp + DAY_IN_SECONDS;

    const nextSessionId = await sessionFactory.sessionCount();
    const params = buildOutcomeSession(args.outcomes, {
      sessionLabel: `session #${nextSessionId}`,
      openingTime,
      metadataUri: args.metadataUri,
      multiCategoricalParent: args.multi,
    });

    const receipts: ContractTransactionReceipt[] = [];
    const collect = async (txPromise: Promise<{ wait(): Promise<ContractTransactionReceipt | null> }>) => {
      const receipt = await (await txPromise).wait();
      if (!receipt) {
        throw new Error("Transaction receipt missing");
      }
      receipts.push(receipt);
    };

    if (args.phased) {
      console.log(`Opening phased session #${nextSessionId} (${args.outcomes} outcomes)…`);
      await collect(sessionFactory.openPhasedSession(params.parent, params.multiCategoricalParent, params.metadataUri));
      for (const child of params.children) {
        console.log(`Deploying child ${child.parentOutcomeIndex}…`);
        await collect(sessionFactory.deploySessionChildBatch(nextSessionId, [child]));
      }
    } else {
      console.log(`Deploying atomic session #${nextSessionId} (${args.outcomes} outcomes)…`);
      await collect(sessionFactory.deploySession(params));
    }

    let parentMarket: string | undefined;
    const childMarkets: string[] = [];
    for (const receipt of receipts) {
      for (const log of receipt.logs) {
        if (log.address !== deployment.address) continue;
        const parsed = sessionFactory.interface.parseLog(log);
        if (parsed?.name === "ParentMarketDeployed") {
          parentMarket = parsed.args.parentMarket as string;
        } else if (parsed?.name === "ChildMarketDeployed") {
          childMarkets.push(parsed.args.childMarket as string);
        }
      }
    }
    if (!parentMarket) {
      throw new Error("ParentMarketDeployed event not found in receipts");
    }

    // read back through the same views the indexer uses, so a broken stub fails loudly here
    const parent = await hre.ethers.getContractAt("MockSeerMarket", parentMarket);
    console.log(`\nSession #${nextSessionId}`);
    console.log(`  parent  ${parentMarket}  "${await parent.marketName()}"`);
    for (const [index, childAddress] of childMarkets.entries()) {
      const child = await hre.ethers.getContractAt("MockSeerMarket", childAddress);
      const [name, lowerBound, upperBound] = await Promise.all([
        child.marketName(),
        child.lowerBound(),
        child.upperBound(),
      ]);
      console.log(`  child ${index}  ${childAddress}  "${name}" [${lowerBound}, ${upperBound}]`);
    }
  });
