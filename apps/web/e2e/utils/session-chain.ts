import { createPublicClient, decodeFunctionData, getAbiItem, http, parseAbi, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";

import { sessionFactoryAbi, sessionFactoryAddress } from "@/config/contracts";

/**
 * What the chain holds after a deploy, through `SessionFactory`'s ABI and the
 * Seer market views. Knows nothing about the wizard.
 */

export const FACTORY: Address = (() => {
  const address = sessionFactoryAddress(hardhat.id);
  if (!address) throw new Error("No SessionFactory address for the hardhat chain. Is the local node deployed?");
  return address;
})();

/**
 * Verbatim from `@seer-pm/contracts/src/Market.sol`. Written out because the
 * local Seer is a mock, and mocks are kept out of `@foresight/contracts`
 * codegen; a renamed getter stops answering rather than answering wrongly.
 */
const marketAbi = parseAbi([
  "function marketName() view returns (string)",
  "function outcomes(uint256 index) view returns (string)",
  "function numOutcomes() view returns (uint256)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
  "function parentMarket() view returns (address)",
  "function parentOutcome() view returns (uint256)",
]);

const PARENT_DEPLOYED = getAbiItem({ abi: sessionFactoryAbi, name: "ParentMarketDeployed" });
const CHILD_DEPLOYED = getAbiItem({ abi: sessionFactoryAbi, name: "ChildMarketDeployed" });

export const chain = createPublicClient({ chain: hardhat, transport: http() });

export type OnChainMarket = {
  address: Address;
  marketName: string;
  outcomes: string[];
  lowerBound: bigint;
  upperBound: bigint;
  parentMarket: Address;
  parentOutcome: bigint;
};

/** How many sessions this factory has ever opened. Session ids run `0..count-1`. */
export function sessionCount(): Promise<bigint> {
  return chain.readContract({ address: FACTORY, abi: sessionFactoryAbi, functionName: "sessionCount" });
}

/**
 * The session opened most recently. Call once a deploy has landed: ids are
 * global and the chain is not reset between tests, so a count read before one
 * names the previous test's session.
 */
export async function latestSessionId(): Promise<bigint> {
  const count = await sessionCount();
  if (count === 0n) throw new Error("No session has been opened on this factory yet.");
  return count - 1n;
}

export function readSession(sessionId: bigint) {
  return chain.readContract({
    address: FACTORY,
    abi: sessionFactoryAbi,
    functionName: "getSession",
    args: [sessionId],
  });
}

export type OnChainSession = Awaited<ReturnType<typeof readSession>>;

export async function readMarket(address: Address): Promise<OnChainMarket> {
  const market = { address, abi: marketAbi } as const;
  const [marketName, count, lowerBound, upperBound, parentMarket, parentOutcome] = await Promise.all([
    chain.readContract({ ...market, functionName: "marketName" }),
    chain.readContract({ ...market, functionName: "numOutcomes" }),
    chain.readContract({ ...market, functionName: "lowerBound" }),
    chain.readContract({ ...market, functionName: "upperBound" }),
    chain.readContract({ ...market, functionName: "parentMarket" }),
    chain.readContract({ ...market, functionName: "parentOutcome" }),
  ]);

  const outcomes = await Promise.all(
    Array.from({ length: Number(count) }, (_, index) =>
      chain.readContract({ ...market, functionName: "outcomes", args: [BigInt(index)] }),
    ),
  );

  return { address, marketName, outcomes, lowerBound, upperBound, parentMarket, parentOutcome };
}

/** The decision market and every branch market of a session, branches in outcome order. */
export async function readSessionMarkets(
  sessionId: bigint,
): Promise<{ parent: OnChainMarket; children: OnChainMarket[] }> {
  const session = await readSession(sessionId);
  const [parent, ...children] = await Promise.all(
    [session.parentMarket, ...session.childMarkets].map((address) => readMarket(address)),
  );
  if (!parent) throw new Error(`Session ${sessionId} has no parent market.`);
  return { parent, children };
}

/**
 * The factory's arguments, decoded from the transactions. Token names, bond,
 * opening time, category and language are passed through to Seer and are
 * readable nowhere else afterwards.
 */
export type SubmittedParent = {
  marketName: string;
  outcomes: readonly string[];
  tokenNames: readonly string[];
  category: string;
  lang: string;
  minBond: bigint;
  openingTime: number;
};

export type SubmittedChild = {
  parentOutcomeIndex: bigint;
  marketName: string;
  outcomes: readonly string[];
  tokenNames: readonly string[];
  lowerBound: bigint;
  upperBound: bigint;
  minBond: bigint;
  openingTime: number;
  category: string;
  lang: string;
};

export type SubmittedDeploy = {
  parent: SubmittedParent;
  children: SubmittedChild[];
  multiCategoricalParent: boolean;
  metadataUri: string;
  /** Every factory call that built this session, in the order they were mined. */
  calls: Array<{ functionName: string; hash: Hex }>;
};

/** Every transaction that touched `sessionId`, oldest first, each one once. */
async function transactionsFor(sessionId: bigint): Promise<Hex[]> {
  const [opened, appended] = await Promise.all([
    chain.getLogs({ address: FACTORY, event: PARENT_DEPLOYED, args: { sessionId }, fromBlock: 0n }),
    chain.getLogs({ address: FACTORY, event: CHILD_DEPLOYED, args: { sessionId }, fromBlock: 0n }),
  ]);

  return [...opened, ...appended]
    .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)
    .map((log) => log.transactionHash)
    .filter((hash, index, all) => all.indexOf(hash) === index);
}

export type DeployedSession = {
  sessionId: bigint;
  parentMarket: Address;
  childMarkets: readonly Address[];
  openedAt: bigint;
};

/**
 * The session a deployer opened with this document, asked of the chain.
 *
 * @param since seconds; sessions older than this belong to another run.
 */
export async function findDeployedSession(args: {
  deployer: Address;
  metadataUri: string;
  since: bigint;
}): Promise<DeployedSession | null> {
  const opened = await chain.getLogs({
    address: FACTORY,
    event: PARENT_DEPLOYED,
    args: { deployer: args.deployer },
    fromBlock: 0n,
  });

  for (const log of [...opened].reverse()) {
    const { sessionId, metadataUri } = log.args;
    if (sessionId === undefined || metadataUri !== args.metadataUri) continue;

    const session = await readSession(sessionId);
    if (session.openedAt < args.since) continue;

    return {
      sessionId,
      parentMarket: session.parentMarket,
      childMarkets: session.childMarkets,
      openedAt: session.openedAt,
    };
  }

  return null;
}

export async function submittedDeploy(sessionId: bigint): Promise<SubmittedDeploy> {
  const hashes = await transactionsFor(sessionId);
  if (hashes.length === 0) throw new Error(`No factory transaction created session ${sessionId}.`);

  let parent: SubmittedParent | undefined;
  let multiCategoricalParent: boolean | undefined;
  let metadataUri: string | undefined;
  const children: SubmittedChild[] = [];
  const calls: SubmittedDeploy["calls"] = [];

  for (const hash of hashes) {
    const transaction = await chain.getTransaction({ hash });
    const call = decodeFunctionData({ abi: sessionFactoryAbi, data: transaction.input });
    calls.push({ functionName: call.functionName, hash });

    if (call.functionName === "deploySession") {
      const [params] = call.args;
      parent = params.parent;
      multiCategoricalParent = params.multiCategoricalParent;
      metadataUri = params.metadataUri;
      children.push(...params.children);
    } else if (call.functionName === "openPhasedSession") {
      const [config, multi, uri] = call.args;
      parent = config;
      multiCategoricalParent = multi;
      metadataUri = uri;
    } else if (call.functionName === "deploySessionChildBatch") {
      const [, batch] = call.args;
      children.push(...batch);
    }
  }

  if (!parent || multiCategoricalParent === undefined || metadataUri === undefined) {
    throw new Error(`Session ${sessionId} has no call that opened it.`);
  }

  return { parent, children, multiCategoricalParent, metadataUri, calls };
}
