import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";

import { sessionFactoryAbi } from "@/config/contracts";

/**
 * Real encoded logs and fully populated receipts.
 */

export const FACTORY: Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
export const PARENT: Address = "0x1111111111111111111111111111111111111111";
export const DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const BLOCK_HASH: Hex = `0x${"b1".repeat(32)}`;
const TX_HASH: Hex = `0x${"7a".repeat(32)}`;
const EMPTY_LOGS_BLOOM: Hex = `0x${"0".repeat(512)}`;

/** A log as it appears on a receipt: mined, so none of its fields are null. */
type MinedLog = Log<bigint, number, false>;

/** A distinct, valid address per outcome index. */
export const childAddress = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;

type SessionEvent = "ParentMarketDeployed" | "ChildMarketDeployed";

/**
 * The data half of a log is every non-indexed input, in ABI order. Read off the
 * ABI rather than written out here, so an event that gains, drops or reorders a
 * parameter fails to encode instead of these tests asserting against bytes the
 * contract would never emit.
 */
function eventData(eventName: SessionEvent, values: readonly unknown[]): Hex {
  const event = sessionFactoryAbi.find((item) => item.type === "event" && item.name === eventName);
  if (event?.type !== "event") {
    throw new Error(`${eventName} is not an event on the factory ABI.`);
  }
  return encodeAbiParameters(
    event.inputs.filter((input) => !input.indexed),
    values,
  );
}

function concreteTopics(topics: readonly (Hex | Hex[] | null)[]): [Hex, ...Hex[]] {
  const flat: Hex[] = [];
  for (const topic of topics) {
    if (typeof topic !== "string") throw new Error("A log carries concrete topics; this one came out of a filter.");
    flat.push(topic);
  }
  const [signature, ...rest] = flat;
  if (!signature) throw new Error("An event log always carries its signature topic.");
  return [signature, ...rest];
}

function minedLog(args: { address: Address; topics: [Hex, ...Hex[]]; data: Hex }): MinedLog {
  return {
    address: args.address,
    topics: args.topics,
    data: args.data,
    blockHash: BLOCK_HASH,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    removed: false,
  };
}

export function parentDeployedLog(args: { sessionId: bigint; emittedBy?: Address }): MinedLog {
  return minedLog({
    address: args.emittedBy ?? FACTORY,
    topics: concreteTopics(
      encodeEventTopics({
        abi: sessionFactoryAbi,
        eventName: "ParentMarketDeployed",
        args: { sessionId: args.sessionId, deployer: DEPLOYER, parentMarket: PARENT },
      }),
    ),
    data: eventData("ParentMarketDeployed", [2n, "/ipfs/QmDoc"]),
  });
}

export function childDeployedLog(args: { sessionId: bigint; outcomeIndex: bigint; emittedBy?: Address }): MinedLog {
  return minedLog({
    address: args.emittedBy ?? FACTORY,
    topics: concreteTopics(
      encodeEventTopics({
        abi: sessionFactoryAbi,
        eventName: "ChildMarketDeployed",
        args: {
          sessionId: args.sessionId,
          parentOutcomeIndex: args.outcomeIndex,
          childMarket: childAddress(Number(args.outcomeIndex) + 10),
        },
      }),
    ),
    data: eventData("ChildMarketDeployed", [PARENT]),
  });
}

/** Every field a confirmed receipt carries; none but `logs` affects decoding. */
export function minedReceipt(logs: MinedLog[]): TransactionReceipt {
  return {
    blockHash: BLOCK_HASH,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1_000_000_000n,
    from: DEPLOYER,
    gasUsed: 21_000n,
    logs,
    logsBloom: EMPTY_LOGS_BLOOM,
    status: "success",
    to: FACTORY,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: "eip1559",
  };
}
