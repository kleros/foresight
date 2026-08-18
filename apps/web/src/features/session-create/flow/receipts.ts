import { parseEventLogs, type Address, type TransactionReceipt } from "viem";

import { sessionFactoryAbi } from "@/config/contracts";

import type { DeployedMarkets } from "./types";

export function readDeployedMarkets(receipt: TransactionReceipt, factory: Address): DeployedMarkets {
  // scoped to our factory address
  const logs = parseEventLogs({
    abi: sessionFactoryAbi,
    logs: receipt.logs,
    eventName: ["ParentMarketDeployed", "ChildMarketDeployed"],
  }).filter((log) => log.address.toLowerCase() === factory.toLowerCase());

  const found: DeployedMarkets = { childMarkets: [] };

  for (const log of logs) {
    if (log.eventName === "ParentMarketDeployed") {
      found.sessionId = log.args.sessionId;
      found.parentMarket = log.args.parentMarket;
    } else {
      found.childMarkets.push({
        outcomeIndex: Number(log.args.parentOutcomeIndex),
        address: log.args.childMarket,
      });
    }
  }

  found.childMarkets.sort((a, b) => a.outcomeIndex - b.outcomeIndex);
  return found;
}
