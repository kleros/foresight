import { tradeExecutorCreationCode } from "@foresight/contracts";
import type { FlowTx } from "@foresight/tx-orchestrator";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  isAddressEqual,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import { tradeExecutorFactoryAbi, tradeExecutorAbi } from "@/config/contracts";

import type { ExecutorReadClient, ExecutorState } from "./types";

export type ExecutorCall = { to: Address; data: Hex };

export type ExecutorValueCall = ExecutorCall & { value: bigint };

/** TradeExecutorFactory's SALT_KEY. */
const SALT_KEY = "foresight.trade-executor.v1";

/** The node named another trade wallet than the factory deploys for this owner, so nothing may be paid to it. */
export class TradeWalletMismatchError extends Error {
  constructor() {
    super("The network answered with another trade wallet than this wallet's.");
    this.name = "TradeWalletMismatchError";
  }
}

/** The trade wallet `factory` deploys for `owner`, worked out as the factory does, with no node asked. */
export function executorAddress(factory: Address, owner: Address): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt: keccak256(encodePacked(["string", "address"], [SALT_KEY, owner])),
    bytecode: concat([tradeExecutorCreationCode, encodeAbiParameters([{ type: "address" }], [owner])]),
  });
}

/** The owner's trade wallet as the factory reports it; every deposit and swap pays it, so the node's answer is checked. */
export async function fetchExecutorState(
  client: ExecutorReadClient,
  args: { factory: Address; owner: Address },
): Promise<ExecutorState> {
  const [predicted, deployed] = await Promise.all([
    client.readContract({
      address: args.factory,
      abi: tradeExecutorFactoryAbi,
      functionName: "predictExecutor",
      args: [args.owner],
    }),
    client.readContract({
      address: args.factory,
      abi: tradeExecutorFactoryAbi,
      functionName: "executorOf",
      args: [args.owner],
    }),
  ]);

  const own = executorAddress(args.factory, args.owner);
  if (!isAddressEqual(predicted, own) || (deployed !== zeroAddress && !isAddressEqual(deployed, own))) {
    throw new TradeWalletMismatchError();
  }
  return { predicted, deployed: deployed === zeroAddress ? null : deployed };
}

export function createExecutorTx(factory: Address): FlowTx {
  return {
    to: factory,
    data: encodeFunctionData({ abi: tradeExecutorFactoryAbi, functionName: "createExecutor" }),
  };
}

/** The executor runs `calls` in order, from its own balances, in one transaction. */
export function batchExecuteTx(executor: Address, calls: ExecutorCall[]): FlowTx {
  return {
    to: executor,
    data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchExecute", args: [calls] }),
  };
}

/** As `batchExecuteTx`, with each call carrying native value out of the executor. */
export function batchValueExecuteTx(executor: Address, calls: ExecutorValueCall[]): FlowTx {
  return {
    to: executor,
    data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchValueExecute", args: [calls] }),
  };
}
